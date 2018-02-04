(function() {
    const net = require('net')
    const Particle = require('particle-api-js')
    const fs = require('fs-extra')
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

            this._particle = new Particle();

            this._streamingInfo = {
                isConnected: false,
                isRecording: false,
                recordingStart: 0,
                recordingLength: 0,
            }
             
        }
        start() {
            return this._loginToParticle()
                .then((authToken) => {
                    this._deviceInfo.authToken = authToken
                    this._setupPhoton().bind(this)
                })
                .then(this._listenForPhoton)
                .then(this._startStreamingServer)
                .then(this._listenForAudio)
       }
        play(audio) {
            if (!this._streamingInfo.isConnected) 
                throw new Error("CHATROBOT ERROR: Must be connected to streaming server to play audio")

            return streamAudioOut(this._streamingInfo.sock, audio)
           
        }
        playTone(tone) {

        }
        drive(seconds) {
           return this._particle.callFunction({ deviceId: this._deviceInfo.deviceId, name: 'drive', argument: ''+seconds, auth: this._deviceInfo.authToken }).then(function (data) {
           }, (err) => { 
               console.info('Particle \'drive\': ' + err) 
            });
        }
        spinEyes(seconds) {

        }
        
        
        /////////////////////////////////////////////////////
        /////////// Particle Device Config //////////////////
        /////////////////////////////////////////////////////

        _loginToParticle() {
            
            return this._particle
                .login(this._deviceInfo)
                .then((data) => {
                    return data.body.access_token;
                })
                .catch((err) => {
                    console.error("Particle login failed")
                });
        }

        _setupPhoton() {
             return this._particle
                .getDevice({
                        deviceId: this._deviceInfo.deviceId, 
                        auth: this._deviceInfo.authToken })
                .catch((err) => { 
                    console.error('Particle: Get Device: ' + err) })
                .then((deviceInfo) => {
                    return this._particle.getEventStream({
                        deviceId: this._deviceInfo.deviceId, 
                        auth: this._deviceInfo.authToken })
                })
                .catch((err) => {
                    console.error('Particle: Get Event Stream: ' + err);
                });
        }

        _listenForPhoton(stream) {
            console.log('Logged into Particle Cloud')

            stream.on('spark/status', function(msg) {
                if (msg.data === 'online') {
                    console.log('Chatbot online');
                    
                    if (!this._streamingInfo.isConnected) 
                        _updatePhotonWithHost();	

                } else if (msg.data == 'offline') {
                    console.log('Chatbot offline');
                } 
            })
        }

        _updatePhotonWithHost() {
            
            if (!this.serverHost) 
                this.serverHost = _getWifiAddress();

            console.log('Server Host: ' + this.serverHost);
            
            this._particle
                .callFunction({ 
                    deviceId: this._deviceInfo.deviceId, 
                    name: 'updateServer', 
                    argument: host + ':' + this.serverPort, 
                    auth: this._deviceInfo.authToken })
                .then((hostData) => {
                    console.log('Updated photon host: ' + host + ':' + this.serverPort);		
                }, (err) => { console.error('Particle \'updatePhotonWithHost\': ' + err) });
        }

        _getWifiAddress() {
            
            try {
                var ifaces = os.networkInterfaces();
                console.log(JSON.stringify(ifaces));
                ifaces['Wi-Fi'].forEach((iface) => {
                    if ('IPv4' !== iface.family || iface.internal !== false) {
                        return;
                    }
            
                    result = iface.address;
                });
            
            } catch(ex) {
                console.log('Error getting local IP: ' + ex);
            }

            return result;
        }

        /////////////////////////////////////////////////////
        /////////// Audio Streaming TCP Server //////////////
        /////////////////////////////////////////////////////

        _startStreamingServer() {
            return new Promise((resolve, reject) => {
                net.createServer((sock) => {
                    console.log('Host:  ' + sock.remoteAddress + ':' + sock.remotePort);
            
                    this._streamingInfo.isConnected = true;        
                    sock.setKeepAlive(true, 1000);

                    sock.on('error', (err) => {
                        console.error(err + ' at ' + sock.address + ' ' + sock.remotePort);
                        this._streamingInfo.isConnected = false;
            
                        sock.removeAllListeners();
                        sock.end();
                        sock.destroy();
                    });
            
                    sock.on('end', (data) => {
                        console.error('END: ' + sock.remoteAddress + ' ' + sock.remotePort);
                        this._streamingInfo.isConnected = false;
                    });
            
                    sock.on('close', (data) => {
                        console.error('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort);
                        this._streamingInfo.isConnected = false;
            
                    });

                    this._streamingInfo.sock = sock;

                    resolve(sock);
                }).listen(this.chatbotPort);
                console.info('Chatbot AI Server started on port: ' + chatbotPort);
            })
        }

        _listenForAudio(sock) {
            sock.on('data', (data) => {
                _saveIncomingAudio(data)
                .then((audio) => {
                    this.emit('audioMessage', audio)
                })
            })
        }

        //////////////////////////////////////////////////
        /////////// Audio Streaming Helpers //////////////
        //////////////////////////////////////////////////

        _saveIncomingAudio(data) {

            return new Promise((resolve,reject) => {
                if (!_streamingInfo.isRecording) {
                    console.info('Listening...')
                    _writeWavHeader(this._options.audioRecordingFilename);
                }
                
                if (_isRecordingDone(data)) {
                    this._streamingInfo.isRecording = false;
                    console.info('Listened for ' + this._streamingInfo.recordingLength / 1000 + ' seconds');

                    return fs.readFile(this._options.audioRecordingFilename)
                } else {
                    process.stdout.write('.');
                    this._streamingInfo.outStream.write(data);
                }
            })
        }

        _isRecordingDone(data) {
            this._streamingInfo.recordingLength = Date.now() - this._streamingInfo.recordingStart;
            return (data.slice(data.length - this._options.endPacketSize, data.length).readUInt8(0) == 0);
        }

        _writeWavHeader(audioFilename) {
            this._streamingInfo.outStream = fs.createWriteStream(audioFilename);
        
            var b = new Buffer(1024);
            b.write('RIFF', 0);
            b.writeUInt32LE(32 + samplesLength * numChannels, 4);
            b.write('WAVE', 8);
            b.write('fmt ', 12);
            b.writeUInt32LE(16, 16);
            b.writeUInt16LE(1, 20);
            b.writeUInt16LE(1, 22);
            b.writeUInt32LE(sampleRate, 24);
            b.writeUInt32LE(sampleRate * 1, 28);
            b.writeUInt16LE(numChannels * 1, 32);
            b.writeUInt16LE(bitsPerSample, 34);
            b.write('data', 36);
            b.writeUInt32LE(0, 40);
            this._streamingInfo.outStream.write(b.slice(0, 50));
            this._streamingInfo.recordingStart = Date.now();
            this._streamingInfo.isRecording = true;
        };


        _streamAudioOut(sock, readableStream) {

            if (!sock)
                throw new Error("Socket not availaible ");

            return new Promise((resolve, reject) => {

                var pcmTransform = new PcmFormatTransform(
                    { bitDepth: 16, signed: true },
                    { bitDepth: 8, signed: false });

                var throttle = new Throttle({ bps: 16 * 1024, chunkSize: 16,  highWaterMark: 500 });

                var stream = readableStream.pipe(pcmTransform).pipe(throttle)
                stream.pipe(sock, { end: false })
                

                stream.on('end', () => {
                    resolve()
                })

                stream.on('error', (err) => {
                    throw new Error(err);
                })

            })

        }

    }

    module.exports = ChatRobot;

}());