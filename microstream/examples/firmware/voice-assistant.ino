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

Microstream stream;
Debounce debouncer = Debounce();

unsigned int ledBreathVal = 0;
int ledBreathDir = 1;

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  debouncer.attach(BUTTON_PIN, INPUT_PULLUP);
  debouncer.interval(20);

  stream.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH, {
    .sampleRate = 16000,
    .bitDepth = 8,
    .micPin = MIC_PIN,
    .speakerPin = SPEAKER_PIN,
    .captureBufferSize = 8192,
    .playbackBufferSize = 32768
  });

  stream.onConnected([]() {
    Serial.println("Connected to server");
    digitalWrite(LED_PIN, HIGH);
    delay(200);
    digitalWrite(LED_PIN, LOW);
  });

  stream.onDisconnected([]() {
    Serial.println("Disconnected from server");
  });

  stream.onPlaybackStart([]() {
    Serial.println("Playing response...");
  });

  stream.onPlaybackEnd([]() {
    Serial.println("Playback done");
  });

  Particle.connect();
}

void loop() {
  stream.update();
  debouncer.update();

  // Button press = record, release = stop
  if (debouncer.fell() && stream.isConnected()) {
    Serial.println("Recording...");
    stream.startRecording();
  }

  if (debouncer.rose() && stream.isRecording()) {
    Serial.println("Stopped recording");
    stream.stopRecording();
  }

  updateLed();
}

void updateLed() {
  if (stream.isRecording()) {
    // Solid bright while recording
    digitalWrite(LED_PIN, HIGH);
  } else if (stream.isPlaying()) {
    // Solid bright while playing
    digitalWrite(LED_PIN, HIGH);
  } else if (stream.isConnected()) {
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
