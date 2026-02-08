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
const uint16_t PEN_MOVE_DELAY_MS = 120;

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
// NOTE: "localhost" will NOT work from the ESP32.
// Use the LAN IP of the machine running server/ws-server.js.
const char* WIFI_SSID = "AhmadSamsung";
const char* WIFI_PASSWORD = "applePie123";
const char* WS_HOST = "172.24.21.89";
const uint16_t WS_PORT = 3001;
const char* WS_PATH = "/";

const char* CAR_NAME = "ESP32";
const bool RUN_SELF_TEST = true;

WebSocketsClient webSocket;
uint32_t lastStatusLogMs = 0;
uint32_t lastWsLogMs = 0;
uint32_t lastWsReconnectMs = 0;
uint8_t wsFailureStreak = 0;

// ---------------- PWM settings (NEW API) --------------
const int PWM_FREQ = 200;     // 100–500Hz often gives better torque on L298N
const int PWM_RES  = 8;       // 0..255

// ================= SERVO ==============================
void enableServo() {
  // Required in your environment for ESP32Servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  penServo.setPeriodHertz(50);
  penServo.attach(SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US);
}

void penUp() {
  penServo.write(PEN_UP_ANGLE);
  delay(PEN_MOVE_DELAY_MS);
}

void penDown() {
  penServo.write(PEN_DOWN_ANGLE);
  delay(PEN_MOVE_DELAY_MS);
}

// ================= PWM (Motors) =======================
// NEW API: attach PWM directly to a pin
void pwmInit() {
  // Attach PWM generators to ENA/ENB pins
  // (No channels needed in this API style)
  ledcAttach(ENA, PWM_FREQ, PWM_RES);
  ledcAttach(ENB, PWM_FREQ, PWM_RES);

  // Start stopped
  ledcWrite(ENA, 0);
  ledcWrite(ENB, 0);
}

void setPWM(int l, int r) {
  l = constrain(l, 0, 255);
  r = constrain(r, 0, 255);
  ledcWrite(ENA, l);
  ledcWrite(ENB, r);
}

// ================= MOTORS =============================
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
  delay(ms);
  stopMotors();
  delay(PAUSE_MS);
}

void moveTimedWithPen(void (*dirFn)(), uint32_t ms, int spL, int spR) {
  penDown();
  moveTimed(dirFn, ms, spL, spR);
  penUp();
}

// ================= SHORT MOVES ========================
void forwardStep() { moveTimed(forward, STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void backStep()    { moveTimed(back,    STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void leftStep()    { moveTimed(left,    TURN_STEP_MS, SPEED_TURN, SPEED_TURN); }
void rightStep()   { moveTimed(right,   TURN_STEP_MS, SPEED_TURN, SPEED_TURN); }

void forwardMicro() { moveTimed(forward, MICRO_STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void backMicro()    { moveTimed(back,    MICRO_STEP_MS, SPEED_MOVE, SPEED_MOVE); }
void leftMicro()    { moveTimed(left,    TURN_MICRO_STEP_MS, SPEED_TURN, SPEED_TURN); }
void rightMicro()   { moveTimed(right,   TURN_MICRO_STEP_MS, SPEED_TURN, SPEED_TURN); }

// Precision (slower) moves for better cornering control
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

// ================= NETWORK ============================
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
  if (message.indexOf("\"type\":\"sketch\"") >= 0) {
    // TODO: parse sketch payload and convert to motor commands.
    // For now just acknowledge receipt by briefly pulsing the servo.
    penServo.write(60);
    delay(120);
    penServo.write(90);
    return;
  }

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

  if (message.indexOf("\"type\":\"ping\"") >= 0) {
    webSocket.sendTXT("{\"type\":\"pong\"}");
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("WS connected");
      Serial.print("WS URL: ws://");
      Serial.print(WS_HOST);
      Serial.print(":");
      Serial.print(WS_PORT);
      Serial.println(WS_PATH);
      wsFailureStreak = 0;
      sendRegister();
      break;
    case WStype_TEXT: {
      String message = String(reinterpret_cast<char*>(payload), length);
      handleTextMessage(message);
      break;
    }
    case WStype_DISCONNECTED:
      Serial.println("WS disconnected");
      if (wsFailureStreak < 255) wsFailureStreak++;
      break;
    case WStype_ERROR:
      Serial.println("WS error");
      break;
    default:
      break;
  }
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

  // optional: ensure motors are stopped at boot
  stopMotors();

  connectWiFi();

  Serial.print("WS connecting to ws://");
  Serial.print(WS_HOST);
  Serial.print(":");
  Serial.print(WS_PORT);
  Serial.println(WS_PATH);
  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  webSocket.loop();

  if (millis() - lastWsLogMs > 10000) {
    lastWsLogMs = millis();
    Serial.print("WS state: ");
    Serial.println(webSocket.isConnected() ? "connected" : "disconnected");
  }

  // If hotspot keeps stale connections, force a full Wi-Fi reconnect
  if (!webSocket.isConnected() && WiFi.status() == WL_CONNECTED) {
    if (millis() - lastWsReconnectMs > 20000 || wsFailureStreak >= 3) {
      Serial.println("WS stuck, forcing Wi-Fi reconnect...");
      lastWsReconnectMs = millis();
      wsFailureStreak = 0;
      webSocket.disconnect();
      WiFi.disconnect(true);
      delay(200);
      connectWiFi();
      webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
      webSocket.onEvent(webSocketEvent);
      webSocket.setReconnectInterval(5000);
      webSocket.enableHeartbeat(15000, 3000, 2);
    }
  }

  if (RUN_SELF_TEST) {
    moveTimedWithPen(forward, MOVE_MS, SPEED_MOVE, SPEED_MOVE);
    moveTimedWithPen(right,   TURN_MS, SPEED_TURN, SPEED_TURN);
    moveTimedWithPen(back,    MOVE_MS, SPEED_MOVE, SPEED_MOVE);
    moveTimedWithPen(left,    TURN_MS, SPEED_TURN, SPEED_TURN);
  }

  if (millis() - lastStatusLogMs > 10000) {
    lastStatusLogMs = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi dropped, reconnecting...");
      connectWiFi();
    }
  }
}
