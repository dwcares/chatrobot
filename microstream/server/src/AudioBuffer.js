/**
 * Accumulates raw PCM chunks and produces a valid WAV buffer.
 *
 * Unlike the original chatrobot code, this writes the WAV header with
 * the correct file size after all audio data is collected.
 */

class AudioBuffer {
  constructor (audioConfig) {
    this._config = {
      sampleRate: audioConfig.sampleRate || 16000,
      bitDepth: audioConfig.bitDepth || 16,
      channels: audioConfig.channels || 1
    }
    this._chunks = []
    this._totalBytes = 0
  }

  append (chunk) {
    this._chunks.push(Buffer.from(chunk))
    this._totalBytes += chunk.length
  }

  clear () {
    this._chunks = []
    this._totalBytes = 0
  }

  get size () {
    return this._totalBytes
  }

  toWav () {
    const pcmData = Buffer.concat(this._chunks, this._totalBytes)
    return AudioBuffer.wrapPcmAsWav(pcmData, this._config)
  }

  toPcm () {
    return Buffer.concat(this._chunks, this._totalBytes)
  }

  static wrapPcmAsWav (pcmBuffer, config) {
    const sampleRate = config.sampleRate || 16000
    const bitDepth = config.bitDepth || 16
    const channels = config.channels || 1

    const bytesPerSample = bitDepth / 8
    const byteRate = sampleRate * channels * bytesPerSample
    const blockAlign = channels * bytesPerSample
    const dataSize = pcmBuffer.length

    // 44-byte standard WAV header
    const header = Buffer.alloc(44)

    // RIFF chunk
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataSize, 4) // file size - 8
    header.write('WAVE', 8)

    // fmt sub-chunk
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16) // fmt chunk size (PCM = 16)
    header.writeUInt16LE(1, 20) // audio format (1 = PCM)
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitDepth, 34)

    // data sub-chunk
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40)

    return Buffer.concat([header, pcmBuffer])
  }
}

module.exports = AudioBuffer
