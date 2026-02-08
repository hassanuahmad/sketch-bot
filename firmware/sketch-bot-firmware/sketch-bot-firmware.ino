/*
  ESP32 + L298N + Servo + WebSocket (ROBUST)

  FIXES:
  - No long blocking delays that starve WebSocket.
  - All motion/pen timing uses delayWithWS() so webSocket.loop() runs continuously.
  - Self-test runs ONCE (optional) instead of forever.
  - Heartbeat enabled (ping/pong) to keep servers happy.
  - Safe boot: motors stopped, pen up.

  Motors (L298N):
    IN1 17, IN2 16, ENA 25 (Left PWM)
    IN3 27, IN4 26, ENB 33 (Right PWM)

  Servo:
    SERVO_PIN 14

  WebSocket:
    ws://172.24.21.89:3001/
*/

#include <Arduino.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <WebSocketsClient.h>

// ---------------- L298N Direction Pins ----------------
const int IN1 = 17;   // Left motor dir
const int IN2 = 16;
const int IN3 = 27;   // Right motor dir
const int IN4 = 26;

// ---------------- L298N PWM Pins ----------------------
const int ENA = 25;   // Left motor PWM  (remove ENA jumper)
const int ENB = 33;   // Right motor PWM (remove ENB jumper)

// ---------------- Servo -------------------------------
const int SERVO_PIN = 14;
Servo penServo;
const int SERVO_MIN_US = 500;
const int SERVO_MAX_US = 2400;
const int PEN_UP_ANGLE = 120;
const int PEN_DOWN_ANGLE = 60;
const uint16_t PEN_MOVE_DELAY_MS = 140;

// ---------------- Motion tuning -----------------------
int SPEED_MOVE = 255;       // 0..255
int SPEED_TURN = 255;       // 0..255
int SPEED_MOVE_SLOW = 140;  // slower, more controllable
int SPEED_TURN_SLOW = 140;  // slower, more controllable

uint32_t MOVE_MS  = 800;
uint32_t TURN_MS  = 350;
uint32_t PAUSE_MS = 200;

const uint32_t STEP_MS = 60;
const uint32_t MICRO_STEP_MS = 25;
const uint32_t TURN_STEP_MS = 40;
const uint32_t TURN_MICRO_STEP_MS = 20;
const uint32_t CORNER_APPROACH_MS = 50;

// ---------------- WiFi / WebSocket --------------------
const char* WIFI_SSID     = "AhmadSamsung";
const char* WIFI_PASSWORD = "applePie123";

const char* WS_HOST = "172.24.21.89";
const uint16_t WS_PORT = 3001;
const char* WS_PATH = "/";

const char* CAR_NAME = "ESP32";

// Set true if you want a one-time motion test after WS connects (or after boot)
const bool RUN_SELF_TEST_ONCE = false;

WebSocketsClient webSocket;

// ---------------- PWM settings ------------------------
// NOTE: "ledcAttach/ledcWrite" exist only in newer ESP32 core.
// If you get compile errors, you must switch to ledcSetup/ledcAttachPin API.
const int PWM_FREQ = 200;     // 100–500Hz often gives better torque on L298N
const int PWM_RES  = 8;       // 0..255

// self test latch
bool didSelfTest = false;

// --------------- helpers: keep WS alive ---------------
void delayWithWS(uint32_t ms) {
  uint32_t start = millis();
  while (millis() - start < ms) {
    webSocket.loop();
    delay(1); // yield to WiFi stack
  }
}

// --------------- SERVO -------------------------------
void enableServo() {
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  penServo.setPeriodHertz(50);
  penServo.attach(SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US);
}

void penUp() {
  penServo.write(PEN_UP_ANGLE);
  delayWithWS(PEN_MOVE_DELAY_MS);
}

void penDown() {
  penServo.write(PEN_DOWN_ANGLE);
  delayWithWS(PEN_MOVE_DELAY_MS);
}

// --------------- PWM (Motors) ------------------------
// NEW API: attach PWM directly to a pin
void pwmInit() {
  ledcAttach(ENA, PWM_FREQ, PWM_RES);
  ledcAttach(ENB, PWM_FREQ, PWM_RES);
  ledcWrite(ENA, 0);
  ledcWrite(ENB, 0);
}

void setPWM(int l, int r) {
  l = constrain(l, 0, 255);
  r = constrain(r, 0, 255);
  ledcWrite(ENA, l);
  ledcWrite(ENB, r);
}

// --------------- MOTORS ------------------------------
void stopMotors() {
  // Brake (both inputs HIGH)
  digitalWrite(IN1, HIGH); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, HIGH);
  setPWM(0, 0);
}

void forward() {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
}

void back() {
  digitalWrite(IN1, LOW);  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);  digitalWrite(IN4, HIGH);
}

void right() {
  // spin right: left forward, right backward
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);  digitalWrite(IN4, HIGH);
}

void left() {
  // spin left: left backward, right forward
  digitalWrite(IN1, LOW);  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
}

void moveTimed(void (*dirFn)(), uint32_t ms, int spL, int spR) {
  dirFn();
  setPWM(spL, spR);
  delayWithWS(ms);
  stopMotors();
  delayWithWS(PAUSE_MS);
}

void moveTimedWithPen(void (*dirFn)(), uint32_t ms, int spL, int spR) {
  penDown();
  moveTimed(dirFn, ms, spL, spR);
  penUp();
}

// --------------- SHORT MOVES -------------------------
void forwardStep() { moveTimed(forward, STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void backStep()    { moveTimed(back,    STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void leftStep()    { moveTimed(left,    TURN_STEP_MS, SPEED_TURN, SPEED_TURN); }
void rightStep()   { moveTimed(right,   TURN_STEP_MS, SPEED_TURN, SPEED_TURN); }

void forwardMicro() { moveTimed(forward, MICRO_STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void backMicro()    { moveTimed(back,    MICRO_STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void leftMicro()    { moveTimed(left,    TURN_MICRO_STEP_MS, SPEED_TURN, SPEED_TURN); }
void rightMicro()   { moveTimed(right,   TURN_MICRO_STEP_MS, SPEED_TURN, SPEED_TURN); }

void forwardStepSlow() { moveTimed(forward, STEP_MS, SPEED_MOVE_SLOW, SPEED_MOVE_SLOW); }
void backStepSlow()    { moveTimed(back,    STEP_MS, SPEED_MOVE_SLOW, SPEED_MOVE_SLOW); }
void leftStepSlow()    { moveTimed(left,    TURN_STEP_MS, SPEED_TURN_SLOW, SPEED_TURN_SLOW); }
void rightStepSlow()   { moveTimed(right,   TURN_STEP_MS, SPEED_TURN_SLOW, SPEED_TURN_SLOW); }

void forwardMicroSlow() { moveTimed(forward, MICRO_STEP_MS, SPEED_MOVE_SLOW, SPEED_MOVE_SLOW); }
void backMicroSlow()    { moveTimed(back,    MICRO_STEP_MS, SPEED_MOVE_SLOW, SPEED_MOVE_SLOW); }
void leftMicroSlow()    { moveTimed(left,    TURN_MICRO_STEP_MS, SPEED_TURN_SLOW, SPEED_TURN_SLOW); }
void rightMicroSlow()   { moveTimed(right,   TURN_MICRO_STEP_MS, SPEED_TURN_SLOW, SPEED_TURN_SLOW); }

// Corner helper: approach with pen down, lift, turn, drop
void cornerLeft() {
  penDown();
  moveTimed(forward, CORNER_APPROACH_MS, SPEED_MOVE_SLOW, SPEED_MOVE_SLOW);
  penUp();
  moveTimed(left, TURN_STEP_MS, SPEED_TURN_SLOW, SPEED_TURN_SLOW);
  penDown();
}

void cornerRight() {
  penDown();
  moveTimed(forward, CORNER_APPROACH_MS, SPEED_MOVE_SLOW, SPEED_MOVE_SLOW);
  penUp();
  moveTimed(right, TURN_STEP_MS, SPEED_TURN_SLOW, SPEED_TURN_SLOW);
  penDown();
}

// --------------- NETWORK -----------------------------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t start = millis();
  Serial.print("WiFi connecting to ");
  Serial.println(WIFI_SSID);

  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
    if (millis() - start > 20000) {
      Serial.println();
      Serial.println("WiFi connect timeout");
      break;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
  }
}

void sendRegister() {
  String msg = "{\"type\":\"register\",\"role\":\"car\",\"carName\":\"";
  msg += CAR_NAME;
  msg += "\"}";
  Serial.print("WS register: ");
  Serial.println(msg);
  webSocket.sendTXT(msg);
}

void handleTextMessage(const String& message) {
  Serial.print("WS text: ");
  Serial.println(message);

  // very basic string matching commands
  if (message.indexOf("\"cmd\":\"forward_step\"") >= 0) { forwardStep(); return; }
  if (message.indexOf("\"cmd\":\"back_step\"") >= 0) { backStep(); return; }
  if (message.indexOf("\"cmd\":\"left_step\"") >= 0) { leftStep(); return; }
  if (message.indexOf("\"cmd\":\"right_step\"") >= 0) { rightStep(); return; }

  if (message.indexOf("\"cmd\":\"forward_micro\"") >= 0) { forwardMicro(); return; }
  if (message.indexOf("\"cmd\":\"back_micro\"") >= 0) { backMicro(); return; }
  if (message.indexOf("\"cmd\":\"left_micro\"") >= 0) { leftMicro(); return; }
  if (message.indexOf("\"cmd\":\"right_micro\"") >= 0) { rightMicro(); return; }

  if (message.indexOf("\"cmd\":\"forward_step_slow\"") >= 0) { forwardStepSlow(); return; }
  if (message.indexOf("\"cmd\":\"back_step_slow\"") >= 0) { backStepSlow(); return; }
  if (message.indexOf("\"cmd\":\"left_step_slow\"") >= 0) { leftStepSlow(); return; }
  if (message.indexOf("\"cmd\":\"right_step_slow\"") >= 0) { rightStepSlow(); return; }

  if (message.indexOf("\"cmd\":\"forward_micro_slow\"") >= 0) { forwardMicroSlow(); return; }
  if (message.indexOf("\"cmd\":\"back_micro_slow\"") >= 0) { backMicroSlow(); return; }
  if (message.indexOf("\"cmd\":\"left_micro_slow\"") >= 0) { leftMicroSlow(); return; }
  if (message.indexOf("\"cmd\":\"right_micro_slow\"") >= 0) { rightMicroSlow(); return; }

  if (message.indexOf("\"cmd\":\"corner_left\"") >= 0) { cornerLeft(); return; }
  if (message.indexOf("\"cmd\":\"corner_right\"") >= 0) { cornerRight(); return; }

  if (message.indexOf("\"cmd\":\"pen_up\"") >= 0) { penUp(); return; }
  if (message.indexOf("\"cmd\":\"pen_down\"") >= 0) { penDown(); return; }

  // ping/pong (if you use app-level ping)
  if (message.indexOf("\"type\":\"ping\"") >= 0) {
    webSocket.sendTXT("{\"type\":\"pong\"}");
    return;
  }

  // sample: sketch payload ack
  if (message.indexOf("\"type\":\"sketch\"") >= 0) {
    // quick ack wiggle (non-blocking-ish via delayWithWS)
    penServo.write(60);
    delayWithWS(120);
    penServo.write(90);
    return;
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("WS connected");
      sendRegister();
      break;

    case WStype_TEXT: {
      String message = String(reinterpret_cast<char*>(payload), length);
      handleTextMessage(message);
      break;
    }

    case WStype_DISCONNECTED:
      Serial.println("WS disconnected");
      break;

    case WStype_ERROR:
      Serial.println("WS error");
      break;

    default:
      break;
  }
}

void connectWebSocket() {
  Serial.print("WS connecting to ws://");
  Serial.print(WS_HOST);
  Serial.print(":");
  Serial.print(WS_PORT);
  Serial.println(WS_PATH);

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);

  // Keep trying if it drops
  webSocket.setReconnectInterval(5000);

  // Heartbeat: ping every 15s, wait 3s for pong, fail after 2 misses
  webSocket.enableHeartbeat(15000, 3000, 2);
}

// --------------- optional self test -------------------
void runSelfTestOnce() {
  Serial.println("Running self-test once...");
  moveTimedWithPen(forward, MOVE_MS, SPEED_MOVE, SPEED_MOVE);
  moveTimedWithPen(right,   TURN_MS, SPEED_TURN, SPEED_TURN);
  moveTimedWithPen(back,    MOVE_MS, SPEED_MOVE, SPEED_MOVE);
  moveTimedWithPen(left,    TURN_MS, SPEED_TURN, SPEED_TURN);
  Serial.println("Self-test complete.");
}

// ================= SETUP / LOOP =======================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("Booting SketchBot firmware...");

  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);

  pwmInit();

  enableServo();
  penUp();

  stopMotors();

  connectWiFi();
  connectWebSocket();

  Serial.println("Setup complete.");
}

void loop() {
  // Always service WS frequently
  webSocket.loop();

  // If WiFi drops, reconnect (and WS will auto-reconnect)
  static uint32_t lastWifiCheck = 0;
  if (millis() - lastWifiCheck > 2000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi dropped, reconnecting...");
      connectWiFi();
    }
  }

  // Optional one-time self-test (won't starve WS because we use delayWithWS)
  if (RUN_SELF_TEST_ONCE && !didSelfTest) {
    didSelfTest = true;
    runSelfTestOnce();
  }

  // tiny idle yield (keeps loop smooth)
  delay(1);
}