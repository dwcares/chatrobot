#include "AudioPlayback.h"

AudioPlayback::AudioPlayback()
  : _speakerPin(A3), _sampleRate(16000), _timingMicros(62), _playing(false) {}

void AudioPlayback::begin(pin_t speakerPin, unsigned int sampleRate, unsigned int bufferSize) {
  _speakerPin = speakerPin;
  _sampleRate = sampleRate;
  _timingMicros = 1000000 / sampleRate;

  pinMode(_speakerPin, OUTPUT);
  _buffer.init(bufferSize);
}

void AudioPlayback::feed(uint8_t sample) {
  _buffer.put(sample);
}

void AudioPlayback::feed(const uint8_t* data, unsigned int len) {
  for (unsigned int i = 0; i < len; i++) {
    _buffer.put(data[i]);
  }
}

bool AudioPlayback::play() {
  if (_buffer.getSize() == 0) {
    _playing = false;
    return false;
  }

  _playing = true;
  unsigned long lastWrite = micros();

  while (_buffer.getSize() > 0) {
    uint8_t value = _buffer.get();

    // Map 8-bit unsigned PCM to 12-bit DAC range
    int dacValue = map(value, 0, 255, 0, 4095);

    // Maintain precise sample timing
    unsigned long now = micros();
    unsigned long diff = now - lastWrite;
    if (diff < _timingMicros) {
      delayMicroseconds(_timingMicros - diff);
    }

    analogWrite(_speakerPin, dacValue);
    lastWrite = micros();
  }

  _playing = false;
  return true;
}

bool AudioPlayback::isPlaying() const {
  return _playing;
}

RingBuffer& AudioPlayback::buffer() {
  return _buffer;
}
