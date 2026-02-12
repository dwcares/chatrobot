const { EventEmitter } = require('events')
const { randomUUID } = require('crypto')
const { MessageType, decode, encodeAudioData, encodeHeartbeat, encodeConfig } = require('./Protocol')
const AudioBuffer = require('./AudioBuffer')

const State = {
  IDLE: 'idle',
  RECORDING: 'recording'
}

class Session extends EventEmitter {
  constructor (ws, audioConfig) {
    super()

    this.id = randomUUID()
    this._ws = ws
    this._audioConfig = audioConfig
    this._state = State.IDLE
    this._audioBuffer = new AudioBuffer(audioConfig)
    this._heartbeatInterval = null
    this._lastHeartbeat = Date.now()

    this._ws.on('message', (data, isBinary) => {
      if (!isBinary) return
      this._handleMessage(data)
    })

    this._ws.on('close', () => this._cleanup())
    this._ws.on('error', (err) => {
      this.emit('error', err)
      this._cleanup()
    })

    // Send config to device on connect
    this._sendConfig()

    // Start heartbeat monitoring
    this._startHeartbeat()
  }

  get state () {
    return this._state
  }

  get connected () {
    return this._ws.readyState === this._ws.OPEN
  }

  play (pcmBuffer) {
    if (!this.connected) return

    const buf = Buffer.from(pcmBuffer)
    const chunkSize = 512

    // Send audio in chunks to avoid overwhelming the device
    for (let offset = 0; offset < buf.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, buf.length)
      const chunk = buf.slice(offset, end)
      this._send(encodeAudioData(chunk))
    }
  }

  close () {
    this._cleanup()
    if (this._ws.readyState === this._ws.OPEN) {
      this._ws.close()
    }
  }

  _handleMessage (data) {
    const msg = decode(data)
    if (!msg) return

    switch (msg.type) {
      case MessageType.AUDIO_DATA:
        this._onAudioData(msg.payload)
        break
      case MessageType.AUDIO_END:
        this._onAudioEnd()
        break
      case MessageType.HEARTBEAT:
        this._lastHeartbeat = Date.now()
        break
      case MessageType.ERROR:
        this.emit('error', new Error(msg.payload.toString('utf8')))
        break
    }
  }

  _onAudioData (chunk) {
    if (this._state === State.IDLE) {
      this._state = State.RECORDING
      this._audioBuffer.clear()
      this.emit('audioStart')
    }

    this._audioBuffer.append(chunk)
    this.emit('audioData', chunk)
  }

  _onAudioEnd () {
    if (this._state !== State.RECORDING) return

    this._state = State.IDLE
    const wavBuffer = this._audioBuffer.toWav()
    this.emit('audioEnd', wavBuffer)
    this._audioBuffer.clear()
  }

  _sendConfig () {
    this._send(encodeConfig(this._audioConfig))
  }

  _startHeartbeat () {
    this._heartbeatInterval = setInterval(() => {
      if (!this.connected) {
        this._cleanup()
        return
      }

      // Check if we've received a heartbeat recently (15s timeout = 3 missed beats)
      if (Date.now() - this._lastHeartbeat > 15000) {
        this.emit('error', new Error('Heartbeat timeout'))
        this._cleanup()
        return
      }

      this._send(encodeHeartbeat())
    }, 5000)
  }

  _send (data) {
    if (this.connected) {
      this._ws.send(data, { binary: true })
    }
  }

  _cleanup () {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval)
      this._heartbeatInterval = null
    }
    this.emit('disconnect')
  }
}

module.exports = Session
