#include "Protocol.h"

namespace MicrostreamProtocol {

  unsigned int encode(uint8_t* buffer, MessageType type, const uint8_t* payload, unsigned int payloadLen) {
    buffer[0] = (uint8_t)type;
    if (payload && payloadLen > 0) {
      memcpy(buffer + 1, payload, payloadLen);
    }
    return 1 + payloadLen;
  }

  unsigned int encodeAudioData(uint8_t* buffer, const uint8_t* samples, unsigned int sampleCount) {
    return encode(buffer, AUDIO_DATA, samples, sampleCount);
  }

  unsigned int encodeAudioEnd(uint8_t* buffer) {
    return encode(buffer, AUDIO_END, NULL, 0);
  }

  unsigned int encodeHeartbeat(uint8_t* buffer) {
    return encode(buffer, HEARTBEAT, NULL, 0);
  }

  MessageType decodeType(const uint8_t* data) {
    return (MessageType)data[0];
  }

  const uint8_t* decodePayload(const uint8_t* data) {
    return data + 1;
  }
}
