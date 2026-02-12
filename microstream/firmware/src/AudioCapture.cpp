#include "AudioCapture.h"

AudioCapture* AudioCapture::_instance = NULL;

AudioCapture::AudioCapture()
  : _micPin(A0), _sampleRate(16000), _timingMicros(62), _capturing(false) {}

void AudioCapture::begin(pin_t micPin, unsigned int sampleRate, unsigned int bufferSize) {
  _micPin = micPin;
  _sampleRate = sampleRate;
  _timingMicros = 1000000 / sampleRate; // e.g., 1000000/16000 = 62 us

  pinMode(_micPin, INPUT);
  setADCSampleTime(ADC_SampleTime_3Cycles);

  _buffer.init(bufferSize);

  _instance = this;
}

void AudioCapture::startCapture() {
  if (_capturing) return;

  _buffer.clear();
  _buffer.resetOverflowCount();
  _capturing = true;
  _timer.begin(_isrReadMic, _timingMicros, uSec);
}

void AudioCapture::stopCapture() {
  if (!_capturing) return;

  _timer.end();
  _capturing = false;
}

bool AudioCapture::isCapturing() const {
  return _capturing;
}

RingBuffer& AudioCapture::buffer() {
  return _buffer;
}

unsigned long AudioCapture::getOverflowCount() const {
  return _buffer.getOverflowCount();
}

void AudioCapture::_isrReadMic() {
  if (_instance) {
    _instance->_readMic();
  }
}

void AudioCapture::_readMic() {
  uint16_t raw = analogRead(_micPin);
  uint8_t sample = map(raw, 0, 4095, 0, 255);
  _buffer.put(sample);
}
