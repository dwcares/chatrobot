const net = require('net')
const Particle = require('particle-api-js')
const fs = require('fs-extra')
const Speech = require('./speech_sdk')
const streamifier = require('streamifier')
const Throttle = require('throttle')
const PcmFormatTransform = require('pcm-format')
const os = require('os')
const EventEmitter = require('events').EventEmitter

class ChatRobot extends EventEmitter {
  constructor (deviceInfo, speechInfo, serverHost, serverPort = 5000) {
    super()

    this._serverHost = serverHost
    this._serverPort = serverPort
    this._deviceInfo = deviceInfo
    this._speechInfo = speechInfo
    this._speech = new Speech()

    this.statusCode = {
      DEVICE_ONLINE: 'DEVICE_ONLINE',
      DEVICE_OFFLINE: 'DEVICE_OFFLINE',
      STREAM_CONNECTED: 'STREAM_CONNECTED',
      STREAM_DISCONNECTED: 'STREAM_DISCONNECTED',
      CHATBOT_READY: 'CHATBOT_READY'
    }

    this._options = {
      audioRecordingFilename: './audio/recording.wav',
      samplesLength: 1000,
      sampleRate: 16000,
      endPacketSize: 100,
      bitsPerSample: 8,
      numChannels: 1
    }

    this._particle = new Particle()

    this._streamingInfo = {
      isConnected: false,
      isRecording: false,
      recordingStart: 0,
      recordingLength: 0
    }
  }
  async start () {
    try {
      this._deviceInfo.authToken = await this._loginToParticle()

      await this._listenForPhoton()
      await this._startStreamingServer()
      await this._speech.getSpeechAccessToken(this._speechInfo.key)
    } catch (e) {
      this.emit('error', `Chatbot start error: ${e}`)
    }
  }
  async speak (utterance) {
    if (!this._streamingInfo.isConnected) {
      this.emit('error', 'Must be connected to streaming server to speak')
      return
    }

    this.emit('info', `Speaking: ${utterance}`)
    await this._speech.getSpeechAccessToken(this._speechInfo.key)
    const audio = await this._speech.textToSpeech(utterance, this._speechInfo.gender)
    await this.play(audio)
  }
  play (audio) {
    if (!this._streamingInfo.isConnected) {
      this.emit('error', 'Must be connected to streaming server to play audio')
      return
    }

    return this._streamAudioOut(this._streamingInfo.sock, audio)
  }
  async playTone (tone) {
    if (!this._streamingInfo.isConnected) {
      this.emit('error', 'Must be connected to streaming server to play tone')
      return
    }

    this.emit('info', `Playing tone: ${tone}`)

    await this._particle.callFunction({
      deviceId: this._deviceInfo.deviceId,
      name: 'playTone',
      argument: tone,
      auth: this._deviceInfo.authToken
    }).catch(err => {
      console.error(`PARTICLE ERROR: 'playTone': ${err}`)
    })
  }
  async drive (seconds) {
    if (!this._streamingInfo.isConnected) {
      this.emit('error', 'Must be connected to streaming server to drive')
      return
    }

    await this._particle.callFunction({
      deviceId: this._deviceInfo.deviceId,
      name: 'drive',
      argument: '' + seconds,
      auth: this._deviceInfo.authToken
    }).catch(err => {
      console.error(`PARTICLE ERROR: 'drive': ${err}`)
    })
  }
  async spinEyes (seconds, speed) {
    await this._particle.callFunction({
      deviceId: this._deviceInfo.deviceId,
      name: 'eyesSpin',
      argument: '' + seconds + ';' + speed,
      auth: this._deviceInfo.authToken
    }).catch(err => {
      console.error(`PARTICLE ERROR: 'eyesSpin': ${err}`)
    })
  }
  async shutdown () {
    await this._particle.callFunction({
      deviceId: this._deviceInfo.deviceId,
      name: 'shutdown',
      argument: '',
      auth: this._deviceInfo.authToken
    }).catch(err => {
      console.error(`PARTICLE ERROR: 'shutdown': ${err}`)
    })
  }

  /// //////////////////////////////////////////////////
  /// //////// Particle Device Config //////////////////
  /// //////////////////////////////////////////////////

  async _loginToParticle () {
    const data = await this._particle.login(this._deviceInfo)
    const accessToken = data.body.access_token

    this._deviceInfo.details = await this._particle.getDevice({
      deviceId: this._deviceInfo.deviceId,
      auth: accessToken
    })

    return accessToken
  }

  async _listenForPhoton () {
    const stream = await this._particle.getEventStream({
      deviceId: this._deviceInfo.deviceId,
      auth: this._deviceInfo.authToken
    })

    stream.on('spark/status', async (msg) => {
      if (msg.data === 'online') {
        this.emit('info', 'Chatbot online')
        this.emit('status', this.statusCode.DEVICE_ONLINE)

        if (!this._streamingInfo.isConnected) { await this._updatePhotonWithHost() }
      } else if (msg.data === 'offline') {
        this.emit('info', 'Chatbot offline')
        this.emit('status', this.statusCode.DEVICE_OFFLINE)
        this._streamingInfo.isConnected = false
      }
    })

    stream.on('error', (msg) => {
      this.emit('info', 'Particle event streaming error')
    })
  }

  async _updatePhotonWithHost () {
    if (!this._serverHost) { this._serverHost = this._getWifiAddress() }

    await this._particle
      .callFunction({
        deviceId: this._deviceInfo.deviceId,
        name: 'updateServer',
        argument: this._serverHost + ':' + this._serverPort,
        auth: this._deviceInfo.authToken
      })
      .catch((err) => { console.error(`Particle 'updatePhotonWithHost': ${err}`) })

    this.emit('info', `Updated client with streaming server host`)
  }

  _getWifiAddress () {
    let result

    try {
      var ifaces = os.networkInterfaces()
      ifaces['Wi-Fi'].forEach((iface) => {
        if (iface.family !== 'IPv4' || iface.internal !== false) {
          return
        }

        result = iface.address
      })
    } catch (ex) {
      console.error('Error getting local IP: ' + ex)
    }

    return result
  }

  /// //////////////////////////////////////////////////
  /// //////// Audio Streaming TCP Server //////////////
  /// //////////////////////////////////////////////////

  async _startStreamingServer () {
    return new Promise(async (resolve, reject) => {
      net.createServer((sock) => {
        this.emit('info', `Streaming client connected`)

        this._streamingInfo.isConnected = true
        sock.setKeepAlive(true, 1000)

        sock.on('error', (err) => {
          console.error(err + ' at ' + sock.address + ' ' + sock.remotePort)
          this.emit('status', this.statusCode.STREAM_DISCONNECTED)
        })

        sock.on('close', (data) => {
          console.log('TCP socket closed')
          this._streamingInfo.isConnected = false
          this.emit('status', this.statusCode.STREAM_DISCONNECTED)
        })

        this._streamingInfo.sock = sock
        this.emit('status', this.statusCode.STREAM_CONNECTED)

        this._listenForAudio()

        this.emit('info', 'Chatbot ready!')
        this.emit('status', this.statusCode.CHATBOT_READY)
        resolve(sock)
      }).listen(this._serverPort)

      this.emit('info', `Streaming server started on port: ${this._serverPort}`)
    })
  }

  async _listenForAudio () {
    this._streamingInfo.sock.on('data', async (data) => {
      try {
        const audio = await this._saveIncomingAudio(data)

        if (audio) {
          this.spinEyes(1, 6)
          this.emit('audioMessage', audio)

          await this._speech.getSpeechAccessToken(this._speechInfo.key)

          const utterance = await this._speech.speechToText(audio)
          this.emit('message', utterance)

          if (utterance) {
            this.emit('info', `Recognized text: ${utterance}`)
          }
        }
      } catch (e) {
        console.log(`Audio streaming error ${e}`)
      }
    })
  }

  /// ///////////////////////////////////////////////
  /// //////// Audio Streaming Helpers //////////////
  /// ///////////////////////////////////////////////

  async _saveIncomingAudio (data) {
    if (!this._streamingInfo.isRecording) {
      this.emit('info', 'Listening...')
      await this._writeWavHeader(this._options.audioRecordingFilename)
    }

    if (this._isRecordingDone(data)) {
      this._streamingInfo.isRecording = false
      this.emit('info', `Listened for ${this._streamingInfo.recordingLength / 1000} seconds`)

      return fs.readFile(this._options.audioRecordingFilename)
    } else {
      await this._streamingInfo.outStream.write(data)
      process.stdout.write('.')
    }
  }

  _isRecordingDone (data) {
    this._streamingInfo.recordingLength = Date.now() - this._streamingInfo.recordingStart
    return (data.slice(data.length - this._options.endPacketSize, data.length).readUInt8(0) == 0)
  }

  async _writeWavHeader (audioFilename) {
    this._streamingInfo.outStream = await fs.createWriteStream(audioFilename)

    var b = Buffer.alloc(1024)
    b.write('RIFF', 0)
    b.writeUInt32LE(32 + this._options.samplesLength * this._options.numChannels, 4)
    b.write('WAVE', 8)
    b.write('fmt ', 12)
    b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20)
    b.writeUInt16LE(1, 22)
    b.writeUInt32LE(this._options.sampleRate, 24)
    b.writeUInt32LE(this._options.sampleRate * 1, 28)
    b.writeUInt16LE(this._options.numChannels * 1, 32)
    b.writeUInt16LE(this._options.bitsPerSample, 34)
    b.write('data', 36)
    b.writeUInt32LE(0, 40)
    await this._streamingInfo.outStream.write(b.slice(0, 50))
    this._streamingInfo.recordingStart = Date.now()
    this._streamingInfo.isRecording = true
  }

  _streamAudioOut (sock, audio) {
    return new Promise((resolve, reject) => {
      if (!sock) { throw new Error('Socket not availaible') }

      const readableStream = audio.readable ? audio : streamifier.createReadStream(audio)

      var pcmTransform = new PcmFormatTransform(
        { bitDepth: 16, signed: true },
        { bitDepth: 8, signed: false })

      var throttle = new Throttle({ bps: 16 * 1024, chunkSize: 16, highWaterMark: 500 })

      var stream = readableStream.pipe(pcmTransform).pipe(throttle)

      stream.pipe(sock, { end: false })

      stream.on(`finish`, () => {
        resolve()
      })

      stream.on('error', (err) => {
        this.emit('error', `Streaming Error: ${err}`)
      })
    })
  }
}

module.exports = ChatRobot
