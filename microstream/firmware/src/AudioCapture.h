#ifndef MICROSTREAM_AUDIOCAPTURE_H
#define MICROSTREAM_AUDIOCAPTURE_H

#include "application.h"
#include <SparkIntervalTimer.h>
#include "RingBuffer.h"

/**
 * Interrupt-driven audio capture from an analog microphone.
 *
 * Samples the ADC at a configurable rate using a hardware timer interrupt,
 * maps the 12-bit ADC value to 8-bit, and stores in a ring buffer.
 */
class AudioCapture {
public:
  AudioCapture();

  void begin(pin_t micPin, unsigned int sampleRate, unsigned int bufferSize = 8192);

  void startCapture();
  void stopCapture();

  bool isCapturing() const;

  // Access the ring buffer directly for reading samples
  RingBuffer& buffer();

  unsigned long getOverflowCount() const;

private:
  static AudioCapture* _instance;
  static void _isrReadMic();

  void _readMic();

  pin_t _micPin;
  unsigned int _sampleRate;
  unsigned int _timingMicros; // microseconds between samples
  bool _capturing;

  RingBuffer _buffer;
  IntervalTimer _timer;
};

#endif
