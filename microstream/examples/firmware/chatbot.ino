#include "Microstream.h"

// --- Hardware Pins ---
#define LED_PIN      A4
#define BUTTON_PIN   D3
#define MIC_PIN      A6
#define SPEAKER_PIN  A3

// --- Server ---
#define SERVER_HOST "192.168.7.77"
#define SERVER_PORT 5000
#define SERVER_PATH "/"

Microstream mic;

bool buttonDown = false;
unsigned long lastStatusTime = 0;
unsigned long connectedSince = 0;
unsigned int ledBreathVal = 0;
int ledBreathDir = 1;

// --- Callbacks ---
void onMicConnected() {
  connectedSince = millis();
  Serial.println("Connected to server");
}

void onMicDisconnected() {
  connectedSince = 0;
  Serial.println("Disconnected from server");
}

void onPlaybackStart() {
  Serial.println("Playing response...");
}

void onPlaybackEnd() {
  Serial.println("Playback done");
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("--- Chatbot ---");

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  MicrostreamConfig cfg;
  cfg.sampleRate = 16000;
  cfg.bitDepth = 8;
  cfg.micPin = MIC_PIN;
  cfg.speakerPin = SPEAKER_PIN;
  cfg.captureBufferSize = 8192;
  cfg.playbackBufferSize = 32768;

  Serial.printlnf("Connecting to %s:%d%s", SERVER_HOST, SERVER_PORT, SERVER_PATH);

  mic.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH, cfg);
  mic.onConnected(onMicConnected);
  mic.onDisconnected(onMicDisconnected);
  mic.onPlaybackStart(onPlaybackStart);
  mic.onPlaybackEnd(onPlaybackEnd);
}

void loop() {
  mic.update();

  // --- Push-to-talk button ---
  bool pressed = (digitalRead(BUTTON_PIN) == LOW);

  if (pressed && !buttonDown && mic.isConnected() && !mic.isPlaying()) {
    buttonDown = true;
    mic.startRecording();
    Serial.println("Recording...");
  }

  if (!pressed && buttonDown) {
    buttonDown = false;
    if (mic.isRecording()) {
      mic.stopRecording();
      Serial.println("Sent audio, waiting for response...");
    }
  }

  // --- LED feedback ---
  if (mic.isRecording()) {
    // Solid while recording
    digitalWrite(LED_PIN, HIGH);
  } else if (mic.isPlaying()) {
    // Fast blink while playing response
    digitalWrite(LED_PIN, (millis() / 100) % 2 ? HIGH : LOW);
  } else if (mic.isConnected()) {
    // Breathing when idle + connected
    if (ledBreathVal >= 200) ledBreathDir = -1;
    if (ledBreathVal <= 0) ledBreathDir = 1;
    ledBreathVal += ledBreathDir;
    analogWrite(LED_PIN, ledBreathVal);
  } else {
    // Off when disconnected
    digitalWrite(LED_PIN, LOW);
  }

  // --- Status ---
  if (millis() - lastStatusTime > 5000) {
    lastStatusTime = millis();
    if (mic.isConnected()) {
      Serial.printlnf("Status: CONNECTED | Uptime: %lus", (millis() - connectedSince) / 1000);
    } else {
      Serial.println("Status: DISCONNECTED");
    }
  }
}
