/**
 * Work-Order Lambda
 * AWS equivalent of services/work-order/index.js. Triggered by the
 * same IoT Core rule on "events/anomaly" as the alerting Lambda (one
 * rule, two actions - both fire independently off the same event,
 * exactly like two separate MQTT subscribers locally).
 * Only creates a work order for "high" severity anomalies, and keeps
 * the same 60-second per machine+sensor cooldown as the local version
 * so a single ongoing fault produces one ticket, not one per reading.
 * Machine auto-registration is unchanged in spirit: DynamoDB has no
 * concept of a SQL foreign key either, so this Lambda still does its
 * own lightweight existence check before creating a work order -
 * exactly the tradeoff noted in the local version's comments and the
 * project report's data-design section.
 */

const { put, scanFiltered } = require("./ddb");
const { GetCommand, DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MACHINES_TABLE = process.env.MACHINES_TABLE || "SmartMaintaince_Machines";
const WORK_ORDERS_TABLE = process.env.WORK_ORDERS_TABLE || "SmartMaintaince_WorkOrders";

const COOLDOWN_MS = 60 * 1000;

async function hasRecentOpenWorkOrder(machineId, sensorType) {
  const cutoff = Date.now() - COOLDOWN_MS;
  const existing = await scanFiltered(
    WORK_ORDERS_TABLE,
    (wo) =>
      wo.machine_id === machineId &&
      wo.sensor_type === sensorType &&
      wo.status === "open" &&
      new Date(wo.created_at).getTime() > cutoff
  );
  return existing.length > 0;
}

async function ensureMachineExists(machineId) {
  const result = await doc.send(
    new GetCommand({ TableName: MACHINES_TABLE, Key: { machine_id: machineId } })
  );
  if (result.Item) return;

  await put(MACHINES_TABLE, {
    machine_id: machineId,
    name: machineId,
    location: "Unknown - auto-registered",
    machine_type: "Unknown",
    install_date: null,
  });
  console.log("Auto-registered new machine:", machineId);
}

exports.handler = async (event) => {
  const anomaly = event;

  if (anomaly.severity !== "high") {
    return { statusCode: 200, skipped: "not high severity" };
  }

  if (await hasRecentOpenWorkOrder(anomaly.machine_id, anomaly.sensor_type)) {
    console.log("Skipping duplicate work order within cooldown window:", JSON.stringify(anomaly));
    return { statusCode: 200, skipped: "cooldown" };
  }

  await ensureMachineExists(anomaly.machine_id);

  const workOrder = {
    work_order_id: `WO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    machine_id: anomaly.machine_id,
    sensor_type: anomaly.sensor_type,
    reason: `Anomalous ${anomaly.sensor_type} reading (z=${anomaly.z_score})`,
    assigned_to: "unassigned",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: null,
  };

  await put(WORK_ORDERS_TABLE, workOrder);
  console.log("WORK ORDER CREATED:", workOrder.work_order_id);

  return { statusCode: 200, workOrder };
};
