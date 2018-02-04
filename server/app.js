(function () {
	const fs = require('fs-extra')
	const Shell = require('./shell')
	const ChatRobot = require('./chatrobot')
	const {
			ChatRobotBehavior,
			ChatRobotReply,
			ChatRobotBehaviorCollection,
			ChatRobotBehaviorManager
		  } = require('./chatrobotbehavior.js')

	const Weather = require('npm-openweathermap')
	Weather.api_key = process.env.WEATHER_KEY
	Weather.temp = 'k'

	let chatrobot = new ChatRobot({
		deviceId: process.env.PARTICLE_DEVICE_ID,
		username: process.env.PARTICLE_USERNAME,
		password: process.env.PARTICLE_PASSWORD
	},
		process.env.CHATBOT_HOST,
		process.env.CHATBOT_PORT
	)

	const chatrobotBehaviorManger = new ChatRobotBehaviorManager(chatrobot)

	chatrobotBehaviorManger.addDefaultReply(`Sorry Dave, I can't do that`)
	chatrobotBehaviorManger.addErrorReply(`Huh?`)

	chatrobotBehaviorManger.addReply(`Greeting`, `Hello friend!`)
	chatrobotBehaviorManger.addReply(`Greeting.HowAreYou`, `Hi, I'm doing great!`)
	chatrobotBehaviorManger.addReply(`Name`, `My name is Chat Bot.`)
	chatrobotBehaviorManger.addReply(`Laws`, `A robot may not injure a human being, or, through inaction, allow a human being to come to harm.`)
	chatrobotBehaviorManger.addReply(`Birthday`, `I was born November 7th, 1985 in Katsushika Tokyo.`)
	chatrobotBehaviorManger.addReply(`Joke`, `Why was the robot angry? Because someone kept pushing his buttons!`)

	chatrobotBehaviorManger.addCustom(`Weather.GetCondition`, async function (entities) {
			const result = await Weather.current_weather()
			const currentWeather = `It's ${result.weather[0].description} and the current temp is ${parseInt(1.8 * (result.main.temp - 273) + 32)} degrees!`
			await this.speak(currentWeather)
		}
	)

	chatrobotBehaviorManger.addCustom(`Weather.GetForecast`, async function (entities) {
			const result = await Weather.forecast_weather()

			let forecastWeather = `Tomorow it will be ${result[4].weather[0].description} and ${parseInt(1.8 * (result[4].main.temp - 273) + 32)} degrees at ${(new Date(result[4].dt_txt)).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })}`

			forecastWeather += `, and ${result[7].weather[0].description} and ${parseInt(1.8 * (result[7].main.temp - 273) + 32)} degrees at ${(new Date(result[7].dt_txt)).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })}`

			await this.speak(forecastWeather)
		}
	)

	chatrobotBehaviorManger.addCustom(`Drive`, async function (entities) {
			await this.speak(`Ok, let's go!`)

			const seconds = entities &&
				entities[0] &&
				entities[0].type === 'builtin.number' ? entities[0].resolution.value : 5

			await this._chatrobot.drive(seconds)
		}
	)

	chatrobotBehaviorManger.addCustom(`Song`, async function() {
		await this.speak(`I'd love to sing you a song!`)

	    const songStream = await fs.createReadStream('./audio/song.wav')
		await this._chatrobot.play(songStream)
	})


	chatrobot.on('status', (status) => {
		// DEVICE_ONLINE
		// DEVICE_OFFLINE
		// STREAM_CONNECTED
		// STREAM_DISCONNECTED
	})

	chatrobot.on('info', (info) => {
		Shell.log(info)
	})

	chatrobotBehaviorManger.start()


	Shell.events.on('connection', function () {

	})

	Shell.events.on('speak', async (message) => {

		const audio = await speech.textToSpeech(message)
		chatrobot.play(audio)
	})

}())



setupShell()
loginToParticle()
	.then(setupPhoton)
	.then(listenForPhoton)
	.then(setupAudioServer) //S.waitforaudio