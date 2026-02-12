#include "Microstream.h"
#include <Debounce.h>

// --- Configuration ---
#define BUTTON_PIN D3
#define MIC_PIN DAC1
#define SPEAKER_PIN A3
#define LED_PIN A4

#define SERVER_HOST "192.168.1.100"  // Change to your server IP or tunnel hostname
#define SERVER_PORT 5000
#define SERVER_PATH "/"

// --- Globals ---
SYSTEM_MODE(SEMI_AUTOMATIC);
SYSTEM_THREAD(ENABLED);

Microstream mic;
Debounce debouncer = Debounce();

unsigned int ledBreathVal = 0;
int ledBreathDir = 1;

// --- Callbacks (regular functions, not lambdas — .ino preprocessor breaks on lambdas) ---
void onMicConnected() {
  Serial.println("Connected to server");
  digitalWrite(LED_PIN, HIGH);
  delay(200);
  digitalWrite(LED_PIN, LOW);
}

void onMicDisconnected() {
  Serial.println("Disconnected from server");
}

void onMicPlaybackStart() {
  Serial.println("Playing response...");
}

void onMicPlaybackEnd() {
  Serial.println("Playback done");
}

void setup() {
  Serial.begin(115200);
  Particle.connect();

  pinMode(LED_PIN, OUTPUT);
  debouncer.attach(BUTTON_PIN, INPUT_PULLUP);
  debouncer.interval(20);

  MicrostreamConfig cfg;
  cfg.sampleRate = 16000;
  cfg.bitDepth = 8;
  cfg.micPin = MIC_PIN;
  cfg.speakerPin = SPEAKER_PIN;
  cfg.captureBufferSize = 8192;
  cfg.playbackBufferSize = 32768;

  mic.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH, cfg);

  mic.onConnected(onMicConnected);
  mic.onDisconnected(onMicDisconnected);
  mic.onPlaybackStart(onMicPlaybackStart);
  mic.onPlaybackEnd(onMicPlaybackEnd);
}

void loop() {
  mic.update();
  debouncer.update();

  // Button press = record, release = stop
  if (debouncer.fell() && mic.isConnected()) {
    Serial.println("Recording...");
    mic.startRecording();
  }

  if (debouncer.rose() && mic.isRecording()) {
    Serial.println("Stopped recording");
    mic.stopRecording();
  }

  updateLed();
}

void updateLed() {
  if (mic.isRecording()) {
    // Solid bright while recording
    digitalWrite(LED_PIN, HIGH);
  } else if (mic.isPlaying()) {
    // Solid bright while playing
    digitalWrite(LED_PIN, HIGH);
  } else if (mic.isConnected()) {
    // Breathing effect when idle + connected
    if (ledBreathVal >= 200) ledBreathDir = -1;
    if (ledBreathVal <= 0) ledBreathDir = 1;
    ledBreathVal += ledBreathDir;
    analogWrite(LED_PIN, ledBreathVal);
  } else {
    // Off when disconnected
    digitalWrite(LED_PIN, LOW);
  }
}
