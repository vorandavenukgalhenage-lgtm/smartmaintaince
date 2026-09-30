/**
 * Historian Lambda
 * AWS equivalent of services/historian/index.js. Two IoT Core rules
 * invoke this same function: one on "processed/+/+" and one on
 * "events/#" 
 * It writes every processed reading into
 * SensorReadings and every event into EventLog, exactly mirroring the
 * two collections the local version wrote to.
 *
 * This is the clearest illustration of "demonstrably scalable" in the
 * whole system: because each write is just an independent DynamoDB
 * PutItem with no shared in-memory state, AWS can run as many
 * concurrent copies of this Lambda as there are incoming messages,
 * with no coordination needed between them and no server to size or
 * provision - this is the point made in the report's scalability
 * section, backed by the CloudWatch concurrent-executions screenshot
 * taken during load testing.
 */

const { put } = require("./ddb");

const SENSOR_READINGS_TABLE = process.env.SENSOR_READINGS_TABLE || "SmartMaintaince_SensorReadings";
const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE || "SmartMaintaince_EventLog";

exports.handler = async (event, context) => {
  // The IoT rule includes the originating topic as a top-level field
  // when the rule's SELECT clause is "*, topic() as mqtt_topic" (see
  // guide) - this is how one Lambda can tell which of the two rules
  // triggered it, the same way the local historian used the MQTT
  // "topic" argument passed into its message handler.
  const topic = event.mqtt_topic || "";

  if (topic.startsWith("processed/")) {
    await put(SENSOR_READINGS_TABLE, {
      reading_id: `${event.machine_id}-${event.sensor_type}-${Date.now()}`,
      machine_id: event.machine_id,
      sensor_type: event.sensor_type,
      timestamp: event.timestamp,
      raw_value: event.raw_value,
      aggregated_value: event.aggregated_value,
      is_anomaly: false,
    });
  } else if (topic.startsWith("events/")) {
    await put(EVENT_LOG_TABLE, {
      log_id: `${topic}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      topic,
      ...event,
      logged_at: new Date().toISOString(),
    });
  } else {
    console.log("Unrecognised topic, skipping:", topic, JSON.stringify(event));
  }

  return { statusCode: 200 };
};
