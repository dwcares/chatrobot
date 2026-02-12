#include "Microstream.h"

// --- Configuration ---
#define LED_PIN A4

#define SERVER_HOST "192.168.7.77"
#define SERVER_PORT 5000
#define SERVER_PATH "/"

Microstream mic;

unsigned long lastStatusTime = 0;
unsigned int ledBreathVal = 0;
int ledBreathDir = 1;

// --- Callbacks ---
void onMicConnected() {
  Serial.println("Connected to server");
  digitalWrite(LED_PIN, HIGH);
  delay(200);
  digitalWrite(LED_PIN, LOW);
}

void onMicDisconnected() {
  Serial.println("Disconnected from server");
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("--- Connection Test ---");

  pinMode(LED_PIN, OUTPUT);

  MicrostreamConfig cfg;
  cfg.sampleRate = 16000;
  cfg.bitDepth = 8;
  cfg.captureBufferSize = 8192;
  cfg.playbackBufferSize = 32768;

  Serial.printlnf("Connecting to %s:%d%s", SERVER_HOST, SERVER_PORT, SERVER_PATH);

  mic.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH, cfg);
  mic.onConnected(onMicConnected);
  mic.onDisconnected(onMicDisconnected);
}

void loop() {
  mic.update();

  // Print status every 5 seconds
  if (millis() - lastStatusTime > 5000) {
    lastStatusTime = millis();
    Serial.printlnf("Status: %s | Uptime: %lus",
      mic.isConnected() ? "CONNECTED" : "DISCONNECTED",
      millis() / 1000);
  }

  // LED: breathing when connected, off when disconnected
  if (mic.isConnected()) {
    if (ledBreathVal >= 200) ledBreathDir = -1;
    if (ledBreathVal <= 0) ledBreathDir = 1;
    ledBreathVal += ledBreathDir;
    analogWrite(LED_PIN, ledBreathVal);
  } else {
    digitalWrite(LED_PIN, LOW);
  }
}
