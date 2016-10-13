var net = require('net');
var request = require('request');
var uuid = require('node-uuid');
var Particle = require('particle-api-js');
var particle = new Particle();
var particleLoginToken = "";

var port = process.env.PORT || 3000;

var fs = require("fs");
var samplesLength = 1000;
var sampleRate = 16000;
var endPacketSize = 100;
var bitsPerSample = 8;
var numChannels = 1;
var audioRecordingFilename = "recording.wav";
var audioSynthFilename = "synth.wav";
var isRecording = false;

var recordingStart = 0;
var recordingLength = 0;

var outStream;

net.createServer(function(sock) {

	console.log('CONNECTED: ' + sock.remoteAddress +':'+ sock.remotePort);

	particle.login({username: process.env.PARTICLE_USERNAME, password: process.env.PARTICLE_PASSWORD}).then(
		function(data) {
			particleLoginToken = data.body.access_token;
	});

	console.log("Ready for data");

	sock.on('data', function(data) {
		if (!isRecording) 
			writeWavHeader(audioRecordingFilename);

		try {			
			// DEBUG
			// console.log("got chunk of " + data.toString('hex'));

			if (isRecordingDone(data)) {
				console.log();
				console.log('Recorded for ' + recordingLength / 1000 + ' seconds');
				outStream.end();
				recognizeRecording();
			} else {
				process.stdout.write(".");
				outStream.write(data);
			}
		} catch (ex) {
			console.error("Er!" + ex);
		}
	});

	// Add a 'close' event handler to this instance of socket
	sock.on('close', function(data) {
		console.log('CLOSED: ' + sock.remoteAddress +' '+ sock.remotePort);
	});

}).listen(port);
console.log('Waiting for TCP client connection on port: ' + port);

var recognizeRecording = function() {
		getAccessToken(process.env.MICROSOFT_SPEECH_API_KEY, function(err, token) {
			console.log('Got speech access token');
			speechToText(audioRecordingFilename, token, function(err, body) {
				if(err) {
					console.log(err);
				}
				else if (body.header.status === 'success') {
					particle.callFunction({ deviceId: process.env.PARTICLE_DEVICE_ID, name: 'recognized', argument: body.header.name, auth: particleLoginToken });
					console.log("Recognized text: " + body.header.name);
					textToSpeech(body.header.name, audioSynthFilename, token, function(err) {
						if(err) console.log(err);
						else console.log("Wrote audio: " + audioSynthFilename)
					});
				} else {
						console.log(body.header);
				};
			});
		});
}

var getAccessToken = function(key, callback) {
  request.post({
    url: 'https://api.cognitive.microsoft.com/sts/v1.0/issueToken', 
	headers: {
       'Content-Type': 'application/x-www-form-urlencoded',
			 'Content-length': 0, 
			 'Ocp-Apim-Subscription-Key': key
      }
  }, function(err, resp, body) {
    if(err) return callback(err);
    try {
      var accessToken = body
	  	callback(null, accessToken);
    } catch(e) {
      callback(e);
    }
  });
}

var writeWavHeader = function(audioFilename) {
	outStream = fs.createWriteStream(audioFilename);

	var b = new Buffer(1024);
	b.write('RIFF', 0);
	/* file length */
	b.writeUInt32LE(32 + samplesLength * numChannels, 4);
	//b.writeUint32LE(0, 4);

	b.write('WAVE', 8);

	/* format chunk identifier */
	b.write('fmt ', 12);

	/* format chunk length */
	b.writeUInt32LE(16, 16);

	/* sample format (raw) */
	b.writeUInt16LE(1, 20);

	/* channel count */
	b.writeUInt16LE(1, 22);

	/* sample rate */
	b.writeUInt32LE(sampleRate, 24);

	/* byte rate (sample rate * block align) */
	b.writeUInt32LE(sampleRate * 1, 28);
	//b.writeUInt32LE(sampleRate * 2, 28);

	/* block align (channel count * bytes per sample) */
	b.writeUInt16LE(numChannels * 1, 32);
	//b.writeUInt16LE(2, 32);

	/* bits per sample */
	b.writeUInt16LE(bitsPerSample, 34);

	/* data chunk identifier */
	b.write('data', 36);

	/* data chunk length */
	//b.writeUInt32LE(40, samplesLength * 2);
	b.writeUInt32LE(0, 40);


	outStream.write(b.slice(0, 50));

	recordingStart = Date.now();

	isRecording = true;
};

var isRecordingDone = function(data) {
		recordingLength = Date.now() - recordingStart;
		var val = (parseInt(data.slice(data.length - endPacketSize, data.length).toString("hex")) === 0 && recordingLength > 20);

		isRecording = !val;
		return val;
}

var textToSpeech = function (text, filename, accessToken, callback) {
  var ssmlPayload = "<speak version='1.0' xml:lang='en-us'><voice xml:lang='en-US' xml:gender='Male' name='Microsoft Server Speech Text to Speech Voice (en-US, BenjaminRUS)'>" + text + "</voice></speak>";
  request.post({
    url: 'https://speech.platform.bing.com/synthesize',
    body: ssmlPayload,
    encoding: null,
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type' : 'application/ssml+xml',
      'X-Microsoft-OutputFormat' : 'riff-16khz-16bit-mono-pcm',
      'X-Search-AppId': '68AE0F3ADB0C427B935F34E68C579FBE',
      'X-Search-ClientID': '68AE0F3ADB0C427B935F34E68C579FBE',
			'User-Agent': 'Chat Robot'
    }
  }, function(err, resp, body) {
    if(err) return callback(err);
    fs.writeFile(filename, body, 'binary', function (err) {
      if (err) return callback(err);
      callback(null);
    });
  });
}

var speechToText = function (filename, accessToken, callback) {
  fs.readFile(filename, function(err, waveData) {
    if(err) return callback(err);
    request.post({
      url: 'https://speech.platform.bing.com/recognize',
      qs: {
        'scenarios': 'ulm',
        'appid': 'D4D52672-91D7-4C74-8AD8-42B1D98141A5', // This magic value is required
        'locale': 'en-US',
        'device.os': 'wp7',
        'version': '3.0',
        'format': 'json',
        'requestid': uuid.v4(),
        'instanceid': 'f7370be0-c9b3-46a6-bf6e-a7f6049a1aba'
      },
      body: waveData,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'audio/wav; samplerate='+sampleRate + '; sourcerate='+sampleRate,
        'Content-Length' : waveData.length
      }
    }, function(err, resp, body) {
      if(err) return callback(err);
      try {
        callback(null, JSON.parse(body));
      } catch(e) {
        callback(e);
      }
    });
  });
}