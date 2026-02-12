#ifndef MICROSTREAM_RINGBUFFER_H
#define MICROSTREAM_RINGBUFFER_H

#include "application.h"

/**
 * Thread-safe(ish) circular buffer for audio samples.
 *
 * Improvements over the original SimpleRingBuffer:
 * - Tracks overflow count so callers know when samples were lost
 * - Uses volatile for fields accessed from ISR context
 * - Properly handles concurrent put() from ISR and get() from main loop
 */
class RingBuffer {
public:
  RingBuffer();
  ~RingBuffer();

  void init(unsigned int capacity);
  void destroy();

  bool put(uint8_t value);
  uint8_t get();

  void clear();

  volatile unsigned int getSize() const;
  unsigned int getCapacity() const;

  unsigned long getOverflowCount() const;
  void resetOverflowCount();

private:
  uint8_t* _data;
  unsigned int _capacity;
  volatile unsigned int _head;  // read position
  volatile unsigned int _tail;  // write position
  volatile unsigned int _count; // current number of items
  unsigned long _overflowCount;
};

#endif
