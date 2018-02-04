(function () {
    const net = require('net')
    const Particle = require('particle-api-js')
    const fs = require('fs-extra')
    const streamifier = require('streamifier')
    const Throttle = require('throttle')
    const PcmFormatTransform = require('pcm-format')
    const os = require('os')
    const EventEmitter = require("events").EventEmitter

    class ChatRobot extends EventEmitter {
        constructor(deviceInfo, serverHost, serverPort = 5000) {
            super()

            this._serverHost = serverHost
            this._serverPort = serverPort
            this._deviceInfo = deviceInfo

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
                recordingLength: 0,
            }

        }
        async start() {

            this._deviceInfo.authToken = await this._loginToParticle()
                .catch((err) => {
                    console.error("PARTICLE ERROR: Logging into particle - " + err)
                })

            await this._listenForPhoton()
                .catch((err) => {
                    console.error("PARTICLE ERROR: Getting Device Stream - " + err)
                })

            await this._startStreamingServer()
                .catch((err) => {
                    // BUGBUG: Doesn't catch exceptions
                    console.error("CHATBOT ERROR: Starting Streaming Server - " + err)
                })

            this._listenForAudio()
                .catch((err) => {
                    console.error("CHATBOT ERROR: Starting audio listener - " + err)
                })

        }
        play(audio) {
            if (!this._streamingInfo.isConnected)
                throw new Error("CHATROBOT ERROR: Must be connected to streaming server to play audio")

            return this._streamAudioOut(this._streamingInfo.sock, audio)
        }
        async playTone(tone) {
            await this._particle.callFunction({
                deviceId: this._deviceInfo.deviceId,
                name: 'playTone', argument: '' + tone,
                auth: this._deviceInfo.authToken
            }).catch(err => {
                console.info('PARTICLE ERROR: \'playTone\': ' + err)
            })
        }
        async drive(seconds) {
            await this._particle.callFunction({
                deviceId: this._deviceInfo.deviceId,
                name: 'drive', argument: '' + seconds,
                auth: this._deviceInfo.authToken
            }).catch(err => {
                console.info('PARTICLE ERROR: \'drive\': ' + err)
            })

        }
        async spinEyes(seconds) {
            await this._particle.callFunction({
                deviceId: this._deviceInfo.deviceId,
                name: 'spinEyes', argument: '' + seconds,
                auth: this._deviceInfo.authToken
            }).catch(err => {
                console.info('PARTICLE ERROR: \'spinEyes\': ' + err)
            })
        }


        /////////////////////////////////////////////////////
        /////////// Particle Device Config //////////////////
        /////////////////////////////////////////////////////

        async _loginToParticle() {

            const data = await this._particle.login(this._deviceInfo)
            const access_token = data.body.access_token

            this._deviceInfo.details = await this._particle.getDevice({
                deviceId: this._deviceInfo.deviceId,
                auth: access_token
            })

            return access_token
        }

        async _listenForPhoton() {

            const stream = await this._particle.getEventStream({
                deviceId: this._deviceInfo.deviceId,
                auth: this._deviceInfo.authToken
            })

            stream.once('spark/status', async (msg) => {
                if (msg.data === 'online') {
                    console.log('Chatbot online')

                    if (!this._streamingInfo.isConnected)
                        await this._updatePhotonWithHost()

                } else if (msg.data == 'offline') {
                    console.log('Chatbot offline')
                }
            })
        }

        async _updatePhotonWithHost() {

            if (!this._serverHost)
                this._serverHost = this._getWifiAddress()

            console.log('Server Host: ' + this._serverHost)

            const hostData = await this._particle
                .callFunction({
                    deviceId: this._deviceInfo.deviceId,
                    name: 'updateServer',
                    argument: this._serverHost + ':' + this._serverPort,
                    auth: this._deviceInfo.authToken
                })
                .catch((err) => { console.error('Particle \'updatePhotonWithHost\': ' + err) })

            console.log('Updated photon host: ' + this._serverHost + ':' + this._serverPort)
        }

        _getWifiAddress() {

            try {
                var ifaces = os.networkInterfaces()
                console.log(JSON.stringify(ifaces))
                ifaces['Wi-Fi'].forEach((iface) => {
                    if ('IPv4' !== iface.family || iface.internal !== false) {
                        return
                    }

                    result = iface.address
                })

            } catch (ex) {
                console.log('Error getting local IP: ' + ex)
            }

            return result
        }

        /////////////////////////////////////////////////////
        /////////// Audio Streaming TCP Server //////////////
        /////////////////////////////////////////////////////

        async _startStreamingServer() {
            return new Promise(async (resolve, reject) => {
                net.createServer((sock) => {
                    console.log(`Streaming client connected ${sock.remoteAddress}:${sock.remotePort}`)

                    this._streamingInfo.isConnected = true
                    sock.setKeepAlive(true, 1000)

                    sock.on('error', (err) => {
                        console.error(err + ' at ' + sock.address + ' ' + sock.remotePort)
                        this._streamingInfo.isConnected = false

                        sock.removeAllListeners()
                        sock.end()
                        sock.destroy()
                    })

                    sock.on('end', (data) => {
                        console.error('END: ' + sock.remoteAddress + ' ' + sock.remotePort)
                        this._streamingInfo.isConnected = false
                    })

                    sock.on('close', (data) => {
                        console.error('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort)
                        this._streamingInfo.isConnected = false

                    })

                    this._streamingInfo.sock = sock

                    resolve(sock)
                }).listen(this._serverPort)

                console.info(`Streaming server started on port: ${this._serverPort}`)
            })
        }

        async _listenForAudio() {
            this._streamingInfo.sock.on('data', async (data) => {
                const audio = await this._saveIncomingAudio(data)

                if (audio) {
                    this.emit('audioMessage', audio)
                }
            })
        }

        //////////////////////////////////////////////////
        /////////// Audio Streaming Helpers //////////////
        //////////////////////////////////////////////////

        async _saveIncomingAudio(data) {

            if (!this._streamingInfo.isRecording) {
                console.info('Listening...')
                await this._writeWavHeader(this._options.audioRecordingFilename)
            }

            if (this._isRecordingDone(data)) {
                this._streamingInfo.isRecording = false
                console.info(`Listened for ${this._streamingInfo.recordingLength / 1000} seconds`)

                return await fs.readFile(this._options.audioRecordingFilename)
            } else {
                await this._streamingInfo.outStream.write(data)
                process.stdout.write('.')
            }
        }

        _isRecordingDone(data) {
            this._streamingInfo.recordingLength = Date.now() - this._streamingInfo.recordingStart
            return (data.slice(data.length - this._options.endPacketSize, data.length).readUInt8(0) == 0)
        }

        async _writeWavHeader(audioFilename) {
            this._streamingInfo.outStream = await fs.createWriteStream(audioFilename)

            var b = new Buffer(1024)
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

        _streamAudioOut(sock, audio) {
            return new Promise((resolve, reject) => {
                if (!sock)
                    throw new Error("Socket not availaible ")

                const readableStream = audio.readable ?  audio : streamifier.createReadStream(audio);

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
                    throw new Error(err)
                })
            })
        }
    }

    module.exports = ChatRobot

}())