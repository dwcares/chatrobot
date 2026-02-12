#ifndef MICROSTREAM_PROTOCOL_H
#define MICROSTREAM_PROTOCOL_H

#include "application.h"

/**
 * Binary message protocol matching the server-side Protocol.js.
 *
 * Each WebSocket binary message:
 *   [ type (1 byte) | payload (0-N bytes) ]
 */

namespace MicrostreamProtocol {

  enum MessageType : uint8_t {
    AUDIO_DATA = 0x01,
    AUDIO_END  = 0x02,
    HEARTBEAT  = 0x03,
    CONFIG     = 0x04,
    MSG_ERROR  = 0x05
  };

  // Encode a message into a buffer. Returns total message size.
  // Buffer must be at least 1 + payloadLen bytes.
  unsigned int encode(uint8_t* buffer, MessageType type, const uint8_t* payload, unsigned int payloadLen);

  // Encode an audio data message. Returns total size.
  unsigned int encodeAudioData(uint8_t* buffer, const uint8_t* samples, unsigned int sampleCount);

  // Encode an audio end message. Returns total size (1 byte).
  unsigned int encodeAudioEnd(uint8_t* buffer);

  // Encode a heartbeat message. Returns total size (1 byte).
  unsigned int encodeHeartbeat(uint8_t* buffer);

  // Decode the type byte from a received message.
  MessageType decodeType(const uint8_t* data);

  // Get pointer to payload (data + 1). Caller must know the payload length
  // from the WebSocket frame size minus 1.
  const uint8_t* decodePayload(const uint8_t* data);
}

#endif
