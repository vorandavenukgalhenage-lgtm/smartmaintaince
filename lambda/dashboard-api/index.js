import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const ALERTS_TABLE = process.env.ALERTS_TABLE;
const WORK_ORDERS_TABLE = process.env.WORK_ORDERS_TABLE;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Content-Type": "application/json",
};

export const handler = async () => {
  try {
    const [alertsResult, workOrdersResult] = await Promise.all([
      docClient.send(new ScanCommand({ TableName: ALERTS_TABLE })),
      docClient.send(new ScanCommand({ TableName: WORK_ORDERS_TABLE })),
    ]);

    const alerts = (alertsResult.Items || []).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const workOrders = (workOrdersResult.Items || []).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const machineIds = [
      ...new Set(alerts.map((a) => a.machine_id)),
    ];

    const machines = machineIds.map((id) => {
      const machineAlerts = alerts.filter((a) => a.machine_id === id);
      const openHigh = machineAlerts.filter(
        (a) => a.status === "open" && a.severity === "high"
      ).length;
      const status = openHigh > 0 ? "critical" : machineAlerts.some(a => a.status === "open") ? "warning" : "healthy";
      return {
        machine_id: id,
        status,
        open_alert_count: machineAlerts.filter((a) => a.status === "open").length,
        latest_alert: machineAlerts[0] || null,
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        machines,
        alerts: alerts.slice(0, 50),
        workOrders: workOrders.slice(0, 50),
        summary: {
          total_alerts: alerts.length,
          open_alerts: alerts.filter((a) => a.status === "open").length,
          high_severity_open: alerts.filter((a) => a.status === "open" && a.severity === "high").length,
          open_work_orders: workOrders.filter((w) => w.status === "open").length,
        },
      }),
    };
  } catch (err) {
    console.error("Dashboard API error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to fetch dashboard data" }),
    };
  }
};