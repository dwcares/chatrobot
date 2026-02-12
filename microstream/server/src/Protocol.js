/**
 * Binary message protocol for microstream.
 *
 * Each WebSocket binary message:
 *   [ type (1 byte) | payload (0-N bytes) ]
 *
 * WebSocket handles framing, so no length field is needed.
 */

const MessageType = {
  AUDIO_DATA: 0x01,
  AUDIO_END: 0x02,
  HEARTBEAT: 0x03,
  CONFIG: 0x04,
  ERROR: 0x05
}

function encode (type, payload) {
  const payloadBuf = payload ? Buffer.from(payload) : Buffer.alloc(0)
  const msg = Buffer.allocUnsafe(1 + payloadBuf.length)
  msg.writeUInt8(type, 0)
  if (payloadBuf.length > 0) {
    payloadBuf.copy(msg, 1)
  }
  return msg
}

function decode (data) {
  const buf = Buffer.from(data)
  if (buf.length < 1) {
    return null
  }
  return {
    type: buf.readUInt8(0),
    payload: buf.length > 1 ? buf.slice(1) : Buffer.alloc(0)
  }
}

function encodeAudioData (pcmChunk) {
  return encode(MessageType.AUDIO_DATA, pcmChunk)
}

function encodeAudioEnd () {
  return encode(MessageType.AUDIO_END)
}

function encodeHeartbeat () {
  return encode(MessageType.HEARTBEAT)
}

function encodeConfig (audioConfig) {
  const json = JSON.stringify(audioConfig)
  return encode(MessageType.CONFIG, Buffer.from(json, 'utf8'))
}

function encodeError (reason) {
  return encode(MessageType.ERROR, Buffer.from(reason, 'utf8'))
}

module.exports = {
  MessageType,
  encode,
  decode,
  encodeAudioData,
  encodeAudioEnd,
  encodeHeartbeat,
  encodeConfig,
  encodeError
}
