# SmartMaintaince - Week 2 Setup Guide
Sensor Simulators and MQTT Broker (Mosquitto → AWS IoT Core)

Follow it in order.

---

## PART A - Install Node.js

1. Go to https://nodejs.org
2. Download the **LTS version** (the button that says "Recommended for most users").
3. Run the installer, clicking "Next" through the defaults.
4. Verify it worked — open a terminal (Command Prompt/PowerShell on Windows,
   Terminal on Mac/Linux) and run:
   ```
   node -v
   npm -v
   ```
   You should see version numbers (e.g. v20.11.0). If you see "command not
   found," restart your terminal/computer and try again.

---

## PART B - Install and run Mosquitto (local MQTT broker)

Mosquitto is free software that acts as the "post office" your simulators
will send messages to. We test locally first, before touching AWS.

### Windows
1. Go to https://mosquitto.org/download/
2. Download the Windows installer and run it (keep default options).
3. Open Command Prompt **as Administrator** and run:
   ```
   cd "C:\Program Files\mosquitto"
   mosquitto -v
   ```
   `-v` means verbose, so you can see activity logs.
4. Leave this window open — this is your broker running. Do all other
   steps in a *new* terminal window.

### Mac
1. Install Homebrew if you don't have it: https://brew.sh
2. Run:
   ```
   brew install mosquitto
   brew services start mosquitto
   ```
3. Check it's running:
   ```
   brew services list
   ```
   You should see mosquitto listed as "started".

### Linux (Ubuntu/Debian)
```
sudo apt update
sudo apt install mosquitto mosquitto-clients
sudo systemctl start mosquitto
sudo systemctl status mosquitto
```

### Test the broker works (all platforms)
Open two NEW terminal windows.

In terminal 1 (subscribe / listen):
```
mosquitto_sub -h localhost -t "test/topic"
```

In terminal 2 (publish / send a test message):
```
mosquitto_pub -h localhost -t "test/topic" -m "hello world"
```

If terminal 1 prints `hello world`, your broker is working correctly.
Press Ctrl+C to stop the subscriber.

---

## PART C - Set up the simulator project

1. Download/unzip the `sensor-sim` folder I've provided.
2. Open a terminal inside that folder:
   ```
   cd path/to/sensor-sim
   ```
3. Install the required packages:
   ```
   npm install
   ```
   This reads `package.json` and downloads the `mqtt` and `dotenv`
   libraries into a `node_modules` folder.
4. Create your personal config file from the example:
   ```
   cp .env.example .env
   ```
   (On Windows Command Prompt, use `copy .env.example .env` instead.)
5. Open `.env` in any text editor. For now, leave it as-is — it's already
   set to talk to `localhost:1883`, which is your local Mosquitto broker.

---

## PART D - Run your first simulated machine

1. In your terminal (inside the `sensor-sim` folder), run:
   ```
   npm start
   ```
2. You should see output like:
   ```
   [M-001] Connecting to broker: mqtt://localhost:1883
   [M-001] ✅ Connected to MQTT broker
   [M-001] Publishing every 2000ms...
   [M-001] vibration=4.61 temp=44.87 current=12.13
   ```
3. In a SEPARATE terminal, subscribe to see the actual messages arriving:
   ```
   mosquitto_sub -h localhost -t "factory/M-001/#" -v
   ```
   The `#` is a wildcard meaning "all topics under this machine." You
   should see JSON messages streaming in every 2 seconds.
4. Take a screenshot of both terminals side by side — **this is your
   evidence of progress** for the project status report.

---

## PART E - Run multiple simulated machines at once

This is the important part for later scalability testing — you want to
show you can simulate many machines, not just one.

Open a new terminal for each machine and run:

```
# Terminal 1
MACHINE_ID=M-001 npm start

# Terminal 2
MACHINE_ID=M-002 npm start

# Terminal 3
MACHINE_ID=M-003 npm start
```

(On Windows Command Prompt, environment variables are set differently:
```
set MACHINE_ID=M-002 && npm start
```
On Windows PowerShell:
```
$env:MACHINE_ID="M-002"; npm start
```
)

Subscribe to ALL machines at once to confirm they're all publishing:
```
mosquitto_sub -h localhost -t "factory/#" -v
```

Screenshot this — showing 3+ machines publishing simultaneously is good
evidence for your status report and sets you up nicely for the Week 7
scalability experiments.

---

## PART F - Move from local Mosquitto to AWS IoT Core

Once local testing works, connect to the real AWS service.

### Step 1: Create an AWS account (if you don't have one)
Go to https://aws.amazon.com and sign up. You'll need a card for
verification, but the services used in this project fall within the
AWS Free Tier for the small scale you're testing at early on — just
keep an eye on usage later during Week 7 load testing.

### Step 2: Create an "IoT Thing" (this represents one machine in AWS)
1. Log into the AWS Console → search for **"IoT Core"** → open it.
2. In the left sidebar: **Manage → All devices → Things**.
3. Click **Create things** → **Create single thing**.
4. Give it a name, e.g. `M-001`.
5. Click through to **Auto-generate a new certificate** (this is what
   proves your simulator is allowed to connect).
6. On the download page, download ALL of these files:
   - Device certificate (`xxxxx-certificate.pem.crt`)
   - Private key (`xxxxx-private.pem.key`)
   - Amazon Root CA 1 (`AmazonRootCA1.pem`)
   **Important:** you can only download these once — keep them safe.
7. Attach a policy so the device is allowed to publish. If you don't
   have one yet: **Security → Policies → Create policy**, name it
   `SimulatorPublishPolicy`, and give it this JSON (Advanced mode):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["iot:Connect", "iot:Publish", "iot:Subscribe", "iot:Receive"],
         "Resource": "*"
       }
     ]
   }
   ```
   (Note: `"Resource": "*"` is fine for early development/testing, but
   you should tighten this to specific topics before Week 8's security
   hardening — mention this as a planned improvement in your report.)
8. Attach this policy to the certificate you just created.
9. Click **Activate** on the certificate, then **Done**.

### Step 3: Find your AWS IoT endpoint
1. In IoT Core, go to **Settings** (bottom of left sidebar).
2. Copy the **Device data endpoint** — it looks like:
   `a1b2c3d4e5f6g7-ats.iot.ap-southeast-2.amazonaws.com`

### Step 4: Put the certificate files into your project
1. Inside your `sensor-sim` folder, create a new folder called `certs`.
2. Move the three downloaded files into it, renaming for clarity:
   - `AmazonRootCA1.pem`
   - `device-certificate.pem.crt`
   - `private.pem.key`

### Step 5: Update your `.env` file
Comment out the local broker line and uncomment/fill in the AWS section:
```
# BROKER_URL=mqtt://localhost:1883

BROKER_URL=mqtts://a1b2c3d4e5f6g7-ats.iot.ap-southeast-2.amazonaws.com:8883
CA_PATH=./certs/AmazonRootCA1.pem
CERT_PATH=./certs/device-certificate.pem.crt
KEY_PATH=./certs/private.pem.key
```
(Replace the endpoint with YOUR actual endpoint from Step 3.)

### Step 6: Test it
1. Run `npm start` again.
2. In the AWS Console, go to **IoT Core → MQTT test client** (left
   sidebar) → **Subscribe to a topic** → enter `factory/#` → Subscribe.
3. You should see your simulator's messages appearing live in the AWS
   console — this is excellent evidence for your status report
   (screenshot this!).

If you get a connection error, the most common causes are:
- Wrong endpoint (double-check Step 3)
- Certificate not activated (Step 2, last point)
- Policy not attached to the certificate (Step 2)

