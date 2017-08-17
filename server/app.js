const net = require('net');
const request = require('request');
const uuid = require('uuid');
const Particle = require('particle-api-js');
const fs = require('fs');
const Throttle = require('throttle');
const PcmFormatTransform = require('pcm-format');
const LUISClient = require("./luis_sdk");
const Weather = require('npm-openweathermap');
const os = require('os');

var particle = new Particle();
var particleLoginToken = "";

Weather.api_key = process.env.WEATHER_KEY;
Weather.temp = 'k';
var port = process.env.PORT || 3000;
var connected = false;

var songFilename = "./audio/song.wav";
var audioRecordingFilename = "./audio/recording.wav";
var audioSynthFilename = "./audio/synth.wav";
var isRecording = false;

var recordingStart = 0;
var recordingLength = 0;
var samplesLength = 1000;
var sampleRate = 16000;
var endPacketSize = 100;
var bitsPerSample = 8;
var numChannels = 1;
var outStream;

var luis = LUISClient({
	appId: process.env.MICROSOFT_LUIS_APPID,
	appKey: process.env.MICROSOFT_LUIS_KEY,
	verbose: true
});

net.createServer(function (sock) {
	console.log('CONNECTED: ' + sock.remoteAddress + ':' + sock.remotePort);
	console.log("Ready for data");
	connected = true;

	try {
		sock.setKeepAlive(true, 30000);
	} catch (exception) {
		console.log('exception', exception);
	}

	sock.on('data', function (data) {
		saveIncomingAudio(data, function () {
			recognizeRecording(function (recognizedText, speechToken) {
				aiPredict(recognizedText, function (botResponseText) {
					textToSpeech(botResponseText, audioSynthFilename, speechToken, function (err, data) {
						if (!err) {
							var audioSynthStream = fs.createReadStream(audioSynthFilename);

							streamAudioOut(audioSynthStream, function () {

								if (botResponseText.indexOf("song") >= 0) {
									var songStream = fs.createReadStream(songFilename);
									streamAudioOut(songStream);
								}
							});
						}
					});
				});
			});
		});
	});

	sock.on('error', function (err) {
		console.log('ERROR: ' + err + ' at ' + sock.address + ' ' + sock.remotePort);
		connected = false;
	});

	sock.on('end', function (data) {
		console.log('END: ' + sock.remoteAddress + ' ' + sock.remotePort);
		connected = false;
	});

	sock.on('close', function (data) {
		console.log('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort);
		connected = false;
	});

	var streamAudioOut = function (readableStream, callback) {

		var pcmTransform = new PcmFormatTransform(
			{ bitDepth: 16, signed: true },
			{ bitDepth: 8, signed: false });

		var throttle = new Throttle({ bps: 32 * 1040, chunkSize: 64 });

		readableStream.pipe(throttle).pipe(pcmTransform).pipe(sock, { end: false });

		readableStream.on('end', function () {
			if (callback) { callback(); }
		});

	}

}).listen(port);
console.log('Waiting for TCP client connection on port: ' + port);

var loginToParticle = function () { // Note: self executing
	particle.login({ username: process.env.PARTICLE_USERNAME, password: process.env.PARTICLE_PASSWORD }).then(function (data) {
		console.log('Logged into Particle Cloud')
		particleLoginToken = data.body.access_token;

		setTimeout(updateServer, 3000); // if it doesn't connect in 3 seconds give it the latest IP
	});
}.call(this)

var updateServer = function () {
	if (!connected) {
		particle.getDevice({ deviceId: process.env.PARTICLE_DEVICE_ID, auth: particleLoginToken }).then(function (deviceInfo) {
			if (!deviceInfo.body.connected || connected) return;
			host = getWifiAddress();
			particle.callFunction({ deviceId: process.env.PARTICLE_DEVICE_ID, name: 'updateServer', argument: host + ":" + port, auth: particleLoginToken }).then(function (hostData) {
				console.log('Particle: Updated server: ' + host + ":" + port);

			}, function (err) { console.log("Particle 'updateServer': " + err) });
		}, function (err) { });
	}
}

function getWifiAddress() {
	var result;
	var ifaces = os.networkInterfaces();
	ifaces["Wi-Fi"].forEach(function (iface) {
		if ('IPv4' !== iface.family || iface.internal !== false) {
			// skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
			return;
		}

		result = iface.address;
	});

	return result;
}



var saveIncomingAudio = function (data, callback) {
	if (!isRecording)
		writeWavHeader(audioRecordingFilename);

	try {
		if (isRecordingDone(data)) {
			isRecording = false;
			console.log();
			console.log('Recorded for ' + recordingLength / 1000 + ' seconds');

			callback();
		} else {
			process.stdout.write(".");
			outStream.write(data);
		}
	} catch (ex) {
		console.error("Error saving incoming audio: " + ex);
	}
}

var writeWavHeader = function (audioFilename) {
	outStream = fs.createWriteStream(audioFilename);

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
	outStream.write(b.slice(0, 50));
	recordingStart = Date.now();
	isRecording = true;
};

var isRecordingDone = function (data) {
	recordingLength = Date.now() - recordingStart;
	return (data.slice(data.length - endPacketSize, data.length).readUInt8(0) == 0);
}

var recognizeRecording = function (callback) {
	getAccessToken(process.env.MICROSOFT_SPEECH_API_KEY, function (err, token) {
		console.log('Got speech access token');
		speechToText(audioRecordingFilename, token, function (err, body) {
			if (err) {
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

var getAccessToken = function (key, callback) {
	request.post({
		url: 'https://api.cognitive.microsoft.com/sts/v1.0/issueToken',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-length': 0,
			'Ocp-Apim-Subscription-Key': key
		}
	}, function (err, resp, body) {
		if (err) return callback(err);
		try {
			var accessToken = body
			callback(null, accessToken);
		} catch (e) {
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
			'Content-Type': 'application/ssml+xml',
			'X-Microsoft-OutputFormat': 'raw-16khz-16bit-mono-pcm',
			'X-Search-AppId': '68AE0F3ADB0C427B935F34E68C579FBE',
			'X-Search-ClientID': '68AE0F3ADB0C427B935F34E68C579FBE',
			'User-Agent': 'Chat Robot'
		}
	}, function (err, resp, body) {
		if (err) {
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

var lookupAndRespond = function (intent, respond) {
	var response = ""

	switch (intent) {
		case "Greeting":
			respond("Hello friend!");
			break;

		case "Greeting.HowAreYou":
			respond("Hi, I'm doing great!");
			break;

		case "Name":
			respond("My name is Chat Bot.");
			break;

		case "Joke":
			respond("Why was the robot angry? Because someone kept pushing his buttons!");
			break;

		case "Weather.GetCondition":
			getWeatherToday(respond);
			break;

		case "Weather.GetForecast":
			respond("The weather looks like it's going to be great!");
			break;
		case "Song":
			respond("I'd love to sing you a song!")
			break;
		case "Laws": 
			respond("A robot may not injure a human being, or, through inaction, allow a human being to come to harm.");
			break;
		case "None":
		default:
			respond("Sorry Dave, I can't do that");
			break;

	}

}

var getWeatherToday = function (callback) {

	Weather.current_weather()
		.then(function (result) {
			var currentWeather = "It's " + result.weather[0].description + " and the current temp is " + parseInt(1.8 * (result.main.temp - 273) + 32) + "degrees!";

			callback(currentWeather);
		}, function (error) {
			callback("Sorry, I couldn't get the weather");
		});

}

var aiPredict = function (predictText, botRespond) {
	luis.predict(predictText, {
		onSuccess: function (response) {
			console.log(response)

			lookupAndRespond(response.topScoringIntent.intent, botRespond);
		},
		onFailure: function (err) {
			console.error(err);

			lookupAndRespond("None", botRespond);
		}
	});
}

var speechToText = function (filename, accessToken, callback) {
	fs.readFile(filename, function (err, waveData) {
		if (err) return callback(err);
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
				'Content-Type': 'audio/wav; samplerate=' + sampleRate + '; sourcerate=' + sampleRate,
				'Content-Length': waveData.length
			}
		}, function (err, resp, body) {
			if (err) return callback(err);
			try {
				callback(null, JSON.parse(body));
			} catch (e) {
				callback(e);
			}
		});
	});
}


