const shell = require('./shell');
const ChatRobot = require('./chatrobot');
const LUISClient = require('./luis_sdk');
const Speech = require('./speech_sdk');

const Weather = require('npm-openweathermap');

const songFilename = './audio/song.wav';
const audioSynthFilename = './audio/synth.wav';

let speech = new Speech();
let chatrobot = new ChatRobot({
								deviceId: process.env.PARTICLE_DEVICE_ID,
							   	username: process.env.PARTICLE_USERNAME, 
							   	password: process.env.PARTICLE_PASSWORD },
							  process.env.CHATBOT_HOST, 
							  process.env.CHATBOT_PORT);

setupShell();							  
chatrobot.start();

chatrobot.on('status', (status) => {
	// DEVICE_ONLINE
	// DEVICE_OFFLINE
	// STREAM_CONNECTED
	// STREAM_DISCONNECTED
});

chatrobot.on('info', (info) => {
	shell.log(info);
});

chatrobot.on('audioMessage', (audio) => {
	// start the STT, LUIS, then TTS flow

	speech.getSpeechAccessToken(process.env.MICROSOFT_SPEECH_API_KEY)
	.then((accessToken) => {
		return speech.speechToText(audio);
	})
	.then((recognizedText) => {
		console.log(recognizedText);
	})
	.catch(function(reason) {
		console.log(reason);
	})


	// aiPredict(recognizedText, function (botResponseText, afterBotResponseCallback) {
	// 	shell.log('Responding: \'' + botResponseText +'\'');
	// 	speak(botResponseText, function(){
			
	// 		if (botResponseText.indexOf('song') >= 0) {
	// 			shell.log('Singing.........................');							
	// 			var songStream = fs.createReadStream(songFilename);
	// 			streamAudioOut(songStream, function() {
	// 				shell.log('*prompt');								
	// 			});
	// 		}
	// 		else {
	// 			if (afterBotResponseCallback) { afterBotResponseCallback(); }
	// 			shell.log('*prompt');							
	// 		}						
	// 	}, function(err) {
	// 		console.log(err);
	// 	});
	// });
});

function setupShell() {
	
	shell.events.on('connection', function() {

	});
	
	shell.events.on('speak', (message) => {

		speech
		.textToSpeech(message)
		.then((audio) => {
			chatrobot.play(audio)
		});
	})
}



//////////////////////////////////////////////////
/////////// Chatbot AI Behaviors /////////////////
//////////////////////////////////////////////////

var luis = LUISClient({
	appId: process.env.MICROSOFT_LUIS_APPID,
	appKey: process.env.MICROSOFT_LUIS_KEY,
	verbose: true
});

Weather.api_key = process.env.WEATHER_KEY;
Weather.temp = 'k';

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


function getWeatherToday(callback) {
	Weather.current_weather()
		.then(function (result) {
			var currentWeather = 'It\'s ' + result.weather[0].description + ' and the current temp is ' + parseInt(1.8 * (result.main.temp - 273) + 32) + ' degrees!';

			callback(currentWeather);
		}, function (error) {
			callback('Sorry, I couldn\'t get the weather');
		});
}

var getWeatherForecast = function (callback) {
	
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




