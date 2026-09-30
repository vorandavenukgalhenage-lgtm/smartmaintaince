/**
 * SmartMaintaince - Machine Sensor Simulator
 * ---------------------------------------------
 * This script pretends to be a single factory machine.
 * It generates realistic vibration, temperature and current-draw
 * readings and publishes them over MQTT every few seconds.
 *
 * You can run MULTIPLE COPIES of this script (with different
 * MACHINE_ID values) to simulate multiple machines at once.
 *
 * Usage:
 *   MACHINE_ID=M-001 node simulator.js
 *   MACHINE_ID=M-002 node simulator.js
 *   ...
 */

require("dotenv").config();
const mqtt = require("mqtt");

// ---------- CONFIGURATION ----------
// These values come from your .env file (see .env.example)
const MACHINE_ID = process.env.MACHINE_ID || "M-001";
const BROKER_URL = process.env.BROKER_URL || "mqtt://localhost:1883";
const PUBLISH_INTERVAL_MS = parseInt(process.env.PUBLISH_INTERVAL_MS || "2000", 10);

// MQTT connection options (used later for AWS IoT Core certificates)
const mqttOptions = {
  clientId: `simulator-${MACHINE_ID}-${Math.random().toString(16).slice(2, 8)}`,
};

// If certificate paths are provided (needed for AWS IoT Core), load them.
if (process.env.CA_PATH && process.env.CERT_PATH && process.env.KEY_PATH) {
  const fs = require("fs");
  mqttOptions.ca = fs.readFileSync(process.env.CA_PATH);
  mqttOptions.cert = fs.readFileSync(process.env.CERT_PATH);
  mqttOptions.key = fs.readFileSync(process.env.KEY_PATH);
  mqttOptions.protocol = "mqtts"; // secure MQTT over TLS
}

// ---------- SENSOR STATE ----------
// Each machine has a "normal" baseline for each sensor.
// Real readings will wobble slightly around this baseline (noise),
// and every so often we inject a fault pattern (drift/spike) so the
// anomaly detection work later in the project has something to detect.
const state = {
  vibration: { baseline: 4.5, current: 4.5 },   // mm/s (typical RMS vibration)
  temperature: { baseline: 45, current: 45 },   // degrees C
  current: { baseline: 12, current: 12 },       // amps
  faultActive: false,
  faultTicksRemaining: 0,
};

// Adds small random noise around a baseline value
function withNoise(value, noiseAmount) {
  return value + (Math.random() * 2 - 1) * noiseAmount;
}

// Occasionally starts a "developing fault" that drifts the readings
// upward for a while, then recovers - simulating a machine issue.
function maybeTriggerFault() {
  if (!state.faultActive && Math.random() < 0.01) { // ~1% chance each tick
    state.faultActive = true;
    state.faultTicksRemaining = 15 + Math.floor(Math.random() * 15); // lasts a while
    console.log(`[${MACHINE_ID}] ⚠ Fault pattern starting (simulated)`);
  }
}

function generateReadings() {
  maybeTriggerFault();

  let vibrationDrift = 0;
  let temperatureDrift = 0;
  let currentDrift = 0;

  if (state.faultActive) {
    // While a fault is active, values drift upward
    vibrationDrift = 3.0;
    temperatureDrift = 8.0;
    currentDrift = 2.0;
    state.faultTicksRemaining--;
    if (state.faultTicksRemaining <= 0) {
      state.faultActive = false;
      console.log(`[${MACHINE_ID}] ✔ Fault pattern ended (simulated recovery)`);
    }
  }

  const vibration = withNoise(state.vibration.baseline + vibrationDrift, 0.3);
  const temperature = withNoise(state.temperature.baseline + temperatureDrift, 1.0);
  const currentDraw = withNoise(state.current.baseline + currentDrift, 0.4);

  return {
    vibration: Number(vibration.toFixed(2)),
    temperature: Number(temperature.toFixed(2)),
    current: Number(currentDraw.toFixed(2)),
    faultActive: state.faultActive,
  };
}

// ---------- MQTT CONNECTION ----------
console.log(`[${MACHINE_ID}] Connecting to broker: ${BROKER_URL}`);
const client = mqtt.connect(BROKER_URL, mqttOptions);

client.on("connect", () => {
  console.log(`[${MACHINE_ID}] ✅ Connected to MQTT broker`);
  console.log(`[${MACHINE_ID}] Publishing every ${PUBLISH_INTERVAL_MS}ms...`);

  setInterval(() => {
    const readings = generateReadings();
    const timestamp = new Date().toISOString();

    // Publish each sensor type to its own topic, matching the
    // convention: factory/<machine_id>/<sensor_type>
    const payloads = {
      [`factory/${MACHINE_ID}/vibration`]: {
        machine_id: MACHINE_ID,
        sensor_type: "vibration",
        value: readings.vibration,
        timestamp,
      },
      [`factory/${MACHINE_ID}/temperature`]: {
        machine_id: MACHINE_ID,
        sensor_type: "temperature",
        value: readings.temperature,
        timestamp,
      },
      [`factory/${MACHINE_ID}/current`]: {
        machine_id: MACHINE_ID,
        sensor_type: "current",
        value: readings.current,
        timestamp,
      },
    };

    for (const [topic, payload] of Object.entries(payloads)) {
      client.publish(topic, JSON.stringify(payload));
    }

    console.log(
      `[${MACHINE_ID}] vibration=${readings.vibration} temp=${readings.temperature} current=${readings.current}` +
      (readings.faultActive ? "  <-- FAULT ACTIVE" : "")
    );
  }, PUBLISH_INTERVAL_MS);
});

client.on("error", (err) => {
  console.error(`[${MACHINE_ID}] ❌ MQTT connection error:`, err.message);
});

client.on("close", () => {
  console.log(`[${MACHINE_ID}] Connection closed`);
});
