/**
 * Anomaly Detection Lambda
 * AWS equivalent of services/anomaly-detection/index.js from the local
 * microservices version. Instead of an always-on MQTT subscriber, this
 * runs as a Lambda triggered by an AWS IoT Core topic rule on
 * "processed/+/+" 
 * The core anomaly logic (rolling mean/std-dev, z-score threshold) is
 * IDENTICAL to the local version - only where the rolling baseline is
 * stored had to change. A Lambda function does not keep reliable memory
 * between invocations (each one can run in a fresh container, and many
 * can run concurrently side by side under load), so the baseline that
 * used to live in a plain in-memory object now lives in a small
 * DynamoDB table (Baselines) instead. This is the one real code change
 * needed to make this service horizontally scalable in AWS - everything
 * else about the algorithm is unchanged.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns"); // not used directly here, kept for parity/extension

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

const BASELINES_TABLE = process.env.BASELINES_TABLE || "SmartMaintaince_Baselines";
const IOT_DATA_ENDPOINT = process.env.IOT_DATA_ENDPOINT; // used to publish events/anomaly back onto IoT Core

const Z_SCORE_THRESHOLD = 2.5;
const BASELINE_WINDOW = 20;

const {
  IoTDataPlaneClient,
  PublishCommand: IoTPublishCommand,
} = require("@aws-sdk/client-iot-data-plane");
const iotData = new IoTDataPlaneClient({ endpoint: IOT_DATA_ENDPOINT });

function keyFor(machineId, sensorType) {
  return `${machineId}:${sensorType}`;
}

async function loadHistory(key) {
  const result = await doc.send(
    new GetCommand({ TableName: BASELINES_TABLE, Key: { sensor_key: key } })
  );
  return (result.Item && result.Item.history) || [];
}

async function saveHistory(key, history) {
  await doc.send(
    new PutCommand({
      TableName: BASELINES_TABLE,
      Item: { sensor_key: key, history },
    })
  );
}

async function updateBaselineAndCheck(machineId, sensorType, value) {
  const key = keyFor(machineId, sensorType);
  const history = await loadHistory(key);

  let isAnomaly = false;
  let zScore = 0;

  if (history.length >= 5) {
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance =
      history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
    const stdDev = Math.sqrt(variance) || 0.0001;

    zScore = (value - mean) / stdDev;
    isAnomaly = Math.abs(zScore) > Z_SCORE_THRESHOLD;
  }

  if (!isAnomaly) {
    history.push(value);
    if (history.length > BASELINE_WINDOW) history.shift();
    await saveHistory(key, history);
  }

  return { isAnomaly, zScore: Number(zScore.toFixed(2)) };
}

/**
 * IoT rule invokes this Lambda once per matching MQTT message, passing
 * the message payload as the event object directly (this is how the
 * Lambda action works when the rule's SELECT is just "*").
 */
exports.handler = async (event) => {
  const { machine_id, sensor_type, aggregated_value } = event;
  if (aggregated_value === undefined) {
    console.log("Ignoring message with no aggregated_value:", JSON.stringify(event));
    return;
  }

  const { isAnomaly, zScore } = await updateBaselineAndCheck(
    machine_id,
    sensor_type,
    aggregated_value
  );

  if (isAnomaly) {
    const severity = Math.abs(zScore) > 4 ? "high" : "medium";
    const anomalyEvent = {
      machine_id,
      sensor_type,
      value: aggregated_value,
      z_score: zScore,
      severity,
      detected_at: new Date().toISOString(),
    };

    console.log("ANOMALY DETECTED:", JSON.stringify(anomalyEvent));

    // Publish back onto IoT Core so the alerting/work-order/historian
    // rules (subscribed to events/anomaly) pick it up - this keeps the
    // same "everything talks over the event bus, nothing calls anything
    // else directly" architecture as the local version, just with IoT
    // Core's topic routing standing in for the Mosquitto broker.
    await iotData.send(
      new IoTPublishCommand({
        topic: "events/anomaly",
        payload: Buffer.from(JSON.stringify(anomalyEvent)),
        qos: 1,
      })
    );
  }

  return { statusCode: 200 };
};
