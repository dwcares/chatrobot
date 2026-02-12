#ifndef MICROSTREAM_AUDIOPLAYBACK_H
#define MICROSTREAM_AUDIOPLAYBACK_H

#include "application.h"
#include "RingBuffer.h"

/**
 * Timed audio playback to a DAC/PWM speaker pin.
 *
 * Drains a ring buffer at a precise sample rate using microsecond timing.
 * Call play() from the main loop — it blocks until the buffer is empty.
 */
class AudioPlayback {
public:
  AudioPlayback();

  void begin(pin_t speakerPin, unsigned int sampleRate, unsigned int bufferSize = 32768);

  // Buffer incoming audio data for playback
  void feed(uint8_t sample);
  void feed(const uint8_t* data, unsigned int len);

  // Play all buffered audio. Blocks until buffer is drained.
  // Returns true if any audio was played.
  bool play();

  bool isPlaying() const;

  RingBuffer& buffer();

private:
  pin_t _speakerPin;
  unsigned int _sampleRate;
  unsigned int _timingMicros;
  bool _playing;
  RingBuffer _buffer;
};

#endif
