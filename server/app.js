const net = require('net');
const request = require('request');
const uuid = require('uuid');
const Particle = require('particle-api-js');
const fs = require('fs');
const Throttle = require('throttle');
const PcmFormatTransform = require('pcm-format');
const LUISClient = require('./luis_sdk');
const Weather = require('npm-openweathermap');
const os = require('os');
const shell = require('./shell');

var chatbotPort = process.env.CHATBOT_PORT || 5000;

var particle = new Particle();
var particleLoginToken = '';

var luis = LUISClient({
	appId: process.env.MICROSOFT_LUIS_APPID,
	appKey: process.env.MICROSOFT_LUIS_KEY,
	verbose: true
});

var speechToken = '';

Weather.api_key = process.env.WEATHER_KEY;
Weather.temp = 'k';

var connected = false;

var audioRecordingFilename = './audio/recording.wav';
var audioSynthFilename = './audio/synth.wav';
var isRecording = false;

var songFilename = './audio/song.wav';
var dialupFilename = './audio/dialup.wav';

var recordingStart = 0;
var recordingLength = 0;
var samplesLength = 1000;
var sampleRate = 16000;
var endPacketSize = 100;
var bitsPerSample = 8;
var numChannels = 1;
var outStream;

function loginToParticle() {
	
	return particle.login({ username: process.env.PARTICLE_USERNAME, password: process.env.PARTICLE_PASSWORD }).then(function (data) {
		particleLoginToken = data.body.access_token;

	}, function(err) {
		console.log ("Particle login failed")
	});
}

function setupPhoton() {
	return particle
		.getDevice({
				deviceId: process.env.PARTICLE_DEVICE_ID, 
				auth: particleLoginToken })
		.catch(function (err) { 
			console.error('Particle: Get Device: ' + err) })
		.then(function (deviceInfo) {
			return particle.getEventStream({
				deviceId: process.env.PARTICLE_DEVICE_ID, 
				auth: particleLoginToken })
		})
		.catch(function(err) {
			console.error('Particle: Get Event Stream: ' + err);
		});
}

var listenForPhoton = function (stream) {
	shell.log('Logged into Particle Cloud')

	stream.on('spark/status', function(msg) {
		if (msg.data === 'online') {
			shell.log('Chatbot online');
			updatePhotonWithHost();	
		} else if (msg.data == 'offline') {
			shell.log('Chatbot offline');
		} 
	})
}

var updatePhotonWithHost = function () {
	var host = getWifiAddress();
	console.log('host: ' + host);
	
	particle.callFunction({ deviceId: process.env.PARTICLE_DEVICE_ID, name: 'updateServer', argument: host + ':' + chatbotPort, auth: particleLoginToken }).then(function (hostData) {
		console.log('Updated photon host: ' + host + ':' + chatbotPort);		
	}, function (err) { console.error('Particle \'updatePhotonWithHost\': ' + err) });
}

function getWifiAddress() {
	var result = process.env.CHATBOT_HOST;
	
	if (!connected && !process.env.CHATBOT_HOST) {

		try {

			var ifaces = os.networkInterfaces();
			console.log(JSON.stringify(ifaces));
			ifaces['Wi-Fi'].forEach(function (iface) {
				if ('IPv4' !== iface.family || iface.internal !== false) {
					// skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
					return;
				}
		
				result = iface.address;
			});
		
		} catch(ex) {
			console.log('Error getting local IP: ' + ex);
		}
	}


	return result;
}

/////////////////////////////////////////////////////
/////////// Audio Streaming TCP Server //////////////
/////////////////////////////////////////////////////

var setupAudioServer = function() {	
	
	net.createServer(function (sock) {

		
		shell.log('Chatbot connected to AI');
		console.log('Host:  ' + sock.remoteAddress + ':' + sock.remotePort);
		shell.log('*prompt');
		connected = true;

		try {
			sock.setKeepAlive(true, 1000);
		} catch (exception) {
			console.log('exception', exception);
		}

		getSpeechAccessToken(process.env.MICROSOFT_SPEECH_API_KEY, function (err, token) {
			speechToken = token;
		});

		sock.on('data', function (data) {
			saveIncomingAudio(data, function () {
				recognizeRecording(function (recognizedText) {
					aiPredict(recognizedText, function (botResponseText, afterBotResponseCallback) {
						shell.log('Responding: \'' + botResponseText +'\'');
						speak(botResponseText, function(){
							
							if (botResponseText.indexOf('song') >= 0) {
								shell.log('Singing.........................');							
								var songStream = fs.createReadStream(songFilename);
								streamAudioOut(songStream, function() {
									shell.log('*prompt');								
								});
							}
							else {
								if (afterBotResponseCallback) { afterBotResponseCallback(); }
								shell.log('*prompt');							
							}						
						}, function(err) {
							console.log(err);
						});
					});

				});
			});
		});

		sock.on('error', function (err) {
			console.error(err + ' at ' + sock.address + ' ' + sock.remotePort);
			connected = false;

			shell.events.removeAllListeners();
			sock.removeAllListeners();
			sock.end();
			sock.destroy();
			sock = null;
			
		});

		sock.on('end', function (data) {
			console.error('END: ' + sock.remoteAddress + ' ' + sock.remotePort);
			connected = false;
		});

		sock.on('close', function (data) {
			console.error('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort);
			connected = false;

			shell.log('Chatbot client disconnected from AI');
		});

		var streamAudioOut = function (readableStream, callback) {

			if (!sock) return;

			var pcmTransform = new PcmFormatTransform(
				{ bitDepth: 16, signed: true },
				{ bitDepth: 8, signed: false });

			var throttle = new Throttle({ bps: 16 * 1024, chunkSize: 16,  highWaterMark: 500 });

			var stream = readableStream.pipe(pcmTransform).pipe(throttle);
			stream.pipe(sock, { end: false });

			stream.on('end', function () {
				if (callback) { callback(); }
			});

			stream.on('error', function (err) {
				console.error(err);
			});

		}

		var speak = function(msg, success, err) {
			textToSpeech(msg, audioSynthFilename, speechToken, function (err, data) {
				if (!err) {
					var audioSynthStream = fs.createReadStream(audioSynthFilename);
		
					streamAudioOut(audioSynthStream, function streamEnded() {
						if (success) success();							
					});	
				} else {
					if (err) err('Text to Speech Error'+ err);
				}
			});
		}

		shell.events.on('speak', function(msg) {
			shell.log('Speaking: ' + msg);
			speak(msg, function() {
				shell.log('*prompt');
			});
		});

	}).listen(chatbotPort);
	shell.log('Chatbot AI Server started on port: ' + chatbotPort);
}

//////////////////////////////////////////////////
/////////// Audio Streaming //////////////////////
//////////////////////////////////////////////////

var saveIncomingAudio = function (data, callback) {
	if (!isRecording) {
		shell.log('Listening')
		writeWavHeader(audioRecordingFilename);
	}
	
	try {
		if (isRecordingDone(data)) {
			isRecording = false;
			shell.log('');
			shell.log('Listened for ' + recordingLength / 1000 + ' seconds');

			if (callback) { callback(); }
		} else {
			shell.log('.',true);
			process.stdout.write('.');
			outStream.write(data);
		}
	} catch (ex) {
		console.error('Error saving incoming audio: ' + ex);
		shell.log('*prompt');		
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
	speechToText(audioRecordingFilename, speechToken, function (err, body) {
		if (err) {
			shell.log('Speech to text error: ' + JSON.stringify(err));
			shell.log('*prompt');
			
		}
		else if (body.header.status === 'success') {
			shell.log('Recognized speech: ' + body.header.name);
			callback(body.header.name)
		} else {
			shell.log('Speech to text error: ' + body.header);
			shell.log('*prompt');
			
		};
	});
}


/////////////////////////////////////////////
/////////// Bing Speech API /////////////////
/////////////////////////////////////////////

function getSpeechAccessToken(key, callback) {
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

function textToSpeech(text, filename, accessToken, callback, male) {
	 var ssmlPayload = "<speak version='1.0' xml:lang='en-us'><voice xml:lang='en-US' xml:gender='Female' name='Microsoft Server Speech Text to Speech Voice (en-US, ZiraRUS)'>" + text + "</voice></speak>";

	 if (male) {
		ssmlPayload = "<speak version='1.0' xml:lang='en-us'><voice xml:lang='en-US' xml:gender='Male' name='Microsoft Server Speech Text to Speech Voice (en-US, BenjaminRUS)'>" + text + "</voice></speak>";
	 }
	
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
			shell.log('Text to Speech Error: ' + err);
			return callback(err);
		}

		fs.writeFile(filename, body, 'binary', function (err) {
			if (err) {
				shell.log('Error processing audio: ' + err);
				return callback(err);
			}

			callback(null, body);
		});
	});
}

function speechToText(filename, accessToken, callback) {
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


//////////////////////////////////////////////////
/////////// Chatbot AI Behaviors /////////////////
//////////////////////////////////////////////////

function lookupAndRespond(intent, respond, entities) {

	switch (intent) {
		case 'Greeting':
			respond('Hello friend!');
			break;

		case 'Greeting.HowAreYou':
			respond('Hi, I\'m doing great!');
			break;

		case 'Name':
			respond('My name is Chat Bot.');
			break;

		case 'Joke':
			respond('Why was the robot angry? Because someone kept pushing his buttons!');
				
			break;

		case 'Weather.GetCondition':
			getWeatherToday(respond);
			break;

		case 'Weather.GetForecast':
			getWeatherForecast(respond);
			break;

		case 'Drive':
			let seconds = entities && entities[0] && entities[0].type === 'builtin.number' ? entities[0].resolution.value : 5;

			respond('ok, Let\'s go!', function() {
				shell.log('Drive for ' + seconds + ' seconds');				
				drive(seconds);				
			});
			break;
		case 'Song':
			respond('I\'d love to sing you a song!')
			break;
		case 'Laws': 
			respond('A robot may not injure a human being, or, through inaction, allow a human being to come to harm.');
			break;
		case 'Birthday': 
			respond('I was born November 7th, 1985 in Katsushika Tokyo.');
			break;
		case 'None':
		default:
			respond('Sorry Dave, I can\'t do that');
			break;

	}

}
function aiPredict(predictText, botRespond) {
	luis.predict(predictText, {
		onSuccess: function (response) {

			shell.log(JSON.stringify(response.topScoringIntent, null, '   '));

			lookupAndRespond(response.topScoringIntent.intent, botRespond, response.entities);
		},
		onFailure: function (err) {
			console.error(err);

			lookupAndRespond('None', botRespond);
		}
	});
}

function drive(seconds) {
	particle.callFunction({ deviceId: process.env.PARTICLE_DEVICE_ID, name: 'drive', argument: ''+seconds, auth: particleLoginToken }).then(function (data) {

	}, function (err) { shell.log('Particle \'drive\': ' + err) });
}

function readBook(bookpath, respond) {
	var book = fs.readFileSync(bookpath);
	book = JSON.parse(book);

	var queue = book.paragraphs.reverse();
	
	var read = function() {
		if (queue.length > 0) {
			respond(queue.pop(), read())					
		}
	}

	respond(queue.pop(), read);
}

function getWeatherToday(callback) {

	Weather.current_weather()
		.then(function (result) {
			var currentWeather = 'It\'s ' + result.weather[0].description + ' and the current temp is ' + parseInt(1.8 * (result.main.temp - 273) + 32) + ' degrees!';

			callback(currentWeather);
		}, function (error) {
			callback('Sorry, I couldn\'t get the weather');
		});

}

function getWeatherForecast(callback) {
	
		Weather.forecast_weather()
			.then(function (result) {
				var forecastWeather = 'Tomorow it will be ' + 
					result[4].weather[0].description + ' and ' +
					parseInt(1.8 * (result[4].main.temp - 273) + 32) + 
					' degrees at ' + (new Date(result[4].dt_txt)).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });

				forecastWeather += ', and ' + 
					result[7].weather[0].description + ' and ' +
					parseInt(1.8 * (result[7].main.temp - 273) + 32) + 
					' degrees at ' + (new Date(result[7].dt_txt)).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });


				callback(forecastWeather);
			}, function (error) {
				callback('Sorry, I couldn\'t get the weather forecast');
			});
	
	}

function setupShell() {
	
	shell.events.on('connection', function() {
		shell.log('*splash');			

		if (connected) {
			shell.log('*prompt');
		}
	});
}


setupShell()
loginToParticle()
	.then(setupPhoton)
	.then(listenForPhoton)
	.then(setupAudioServer) //S.waitforaudio