const net = require('net');
const	request = require('request');
const	uuid = require('node-uuid');
const Particle = require('particle-api-js');
const fs = require('fs');
const wav = require('wav');
const Throttle = require('throttle');

var particle = new Particle();
var particleLoginToken = "";

var port = process.env.PORT || 3000;

var audioRecordingFilename = "recording.wav";
var audioSynthFilename = "synth.wav";
var isRecording = false;
var recordingStart = 0;
var recordingLength = 0;
var samplesLength = 1000;
var sampleRate = 16000;
var endPacketSize = 100;
var bitsPerSample = 8;
var numChannels = 1;
var outStream;


net.createServer(function(sock) {
	console.log('CONNECTED: ' + sock.remoteAddress +':'+ sock.remotePort);
	console.log("Ready for data");

	loginToParticle(process.env.PARTICLE_USERNAME, process.env.PARTICLE_PASSWORD);

	sock.on('data', function(data) {
		saveIncomingAudio(data, function() {
			recognizeRecording(function(recognizedText, speechToken) {

			// TODO: pipe to bot api, for now just echo
			botResponseText = recognizedText;

			textToSpeech(botResponseText, audioSynthFilename, speechToken, function(err, data) {
				if(!err) {

					// TODO: stream this back to the device
					var readableStream = fs.createReadStream(audioRecordingFilename); // working with incoming text, not TTS file (downsample?)
					var wavReader = new wav.Reader();
					wavReader.on('format', function(format){
		
						var throttle = new Throttle({ bps: 32 * 1024, chunkSize: 512});
						wavReader.pipe(throttle).pipe(sock);
					});
					readableStream.pipe(wavReader);
					
				}
			});
		});
		});
	});
	
	sock.on('close', function(data) {
		console.log('CLOSED: ' + sock.remoteAddress +' '+ sock.remotePort);
	});

}).listen(port);
console.log('Waiting for TCP client connection on port: ' + port);

var loginToParticle = function(username, password) {
		particle.login({username: username, password: password}).then(function(data) {
			console.log('Logged into Particle Cloud')
			particleLoginToken = data.body.access_token;
	});
}

var saveIncomingAudio = function (data, callback) {
		if (!isRecording) 
			writeWavHeader(audioRecordingFilename);

		try {			
			if (isRecordingDone(data)) {
				console.log();
				console.log('Recorded for ' + recordingLength / 1000 + ' seconds');

				outStream.end();
				callback();
			} else {
				process.stdout.write(".");
				outStream.write(data);
			}
		} catch (ex) {
			console.error("Error saving incoming audio: " + ex);
		}
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

var recognizeRecording = function(callback) {
		getAccessToken(process.env.MICROSOFT_SPEECH_API_KEY, function(err, token) {
			console.log('Got speech access token');
			speechToText(audioRecordingFilename, token, function(err, body) {
				if(err) {
					console.log("Speech to text error: " + err);
				}
				else if (body.header.status === 'success') {
					 console.log("Recognized text: " + body.header.name);
					 callback(body.header.name, token)
				} else {
						console.log("Speech to text error: " + body.header);
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
    if(err) { 
			console.log('Text to Speech Error: ' + err);
			return callback(err);
		}

		fs.writeFile(filename, body, 'binary', function (err) {
      if (err) { 
				console.log('Error writing audio: ' + err);
				return callback(err);
			}

			console.log("Wrote audio file: " + audioSynthFilename);
      callback(null, body);
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