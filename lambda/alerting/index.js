/**
 * Alerting Lambda
 * AWS equivalent of services/alerting/index.js. Triggered by an IoT
 * Core rule on "events/anomaly". For "high" severity anomalies it
 * publishes to an SNS topic (SmartMaintaince-Alerts) instead of just
 * printing to a console - if a real phone number/email is subscribed
 * to that topic, this genuinely sends an SMS/email, which is a nice,
 * cheap ("pay per notification") way to demonstrate a real notification channel for the
 * final report without needing a call centre or a pager service.
 * The 60-second cooldown logic is unchanged from the local version -
 * only the storage it checks against changed (DynamoDB scan instead of
 * a JSON-file read), to avoid spamming a duplicate alert every ~2
 * seconds during one sustained fault.
 */

const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const { put, scanFiltered } = require("./ddb"); // copy of shared/ddb.js, bundled into this function's own zip

const sns = new SNSClient({});
const ALERTS_TABLE = process.env.ALERTS_TABLE || "SmartMaintaince_Alerts";
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN;

const COOLDOWN_MS = 60 * 1000;

async function hasRecentAlert(machineId, severity) {
  const cutoff = Date.now() - COOLDOWN_MS;
  const existing = await scanFiltered(
    ALERTS_TABLE,
    (a) =>
      a.machine_id === machineId &&
      a.severity === severity &&
      new Date(a.created_at).getTime() > cutoff
  );
  return existing.length > 0;
}

exports.handler = async (event) => {
  const anomaly = event;

  if (await hasRecentAlert(anomaly.machine_id, anomaly.severity)) {
    console.log("Skipping duplicate alert within cooldown window:", JSON.stringify(anomaly));
    return { statusCode: 200, skipped: true };
  }

  const alert = {
    alert_id: `ALT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    machine_id: anomaly.machine_id,
    severity: anomaly.severity,
    description: `${anomaly.sensor_type} reading of ${anomaly.value} is ${anomaly.z_score} standard deviations from baseline`,
    created_at: new Date().toISOString(),
    status: "open",
  };

  await put(ALERTS_TABLE, alert);

  if (anomaly.severity === "high" && ALERT_TOPIC_ARN) {
    await sns.send(
      new PublishCommand({
        TopicArn: ALERT_TOPIC_ARN,
        Subject: `SmartMaintaince Alert - ${alert.machine_id}`,
        Message: `${alert.description}\nAlert ID: ${alert.alert_id}`,
      })
    );
    console.log("Published high-severity alert to SNS:", alert.alert_id);
  } else {
    console.log("Logged alert (no SNS notification):", alert.alert_id);
  }

  return { statusCode: 200, alert };
};
