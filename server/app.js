const fs = require('fs-extra')
const Shell = require('./shell')
const ChatRobot = require('./chatrobot')
const {
	ChatRobotBehavior,
	ChatRobotBehaviorCollection,
	ChatRobotBehaviorManager
} = require('./chatrobotbehavior.js')

const Weather = require('npm-openweathermap')
Weather.api_key = process.env.WEATHER_KEY
Weather.temp = 'k'

let chatrobot = new ChatRobot(
	{
		deviceId: process.env.PARTICLE_DEVICE_ID,
		username: process.env.PARTICLE_USERNAME,
		password: process.env.PARTICLE_PASSWORD
	},
	{
		key: process.env.MICROSOFT_SPEECH_API_KEY,
		gender: 'female'
	},
	process.env.CHATBOT_HOST,
	process.env.CHATBOT_PORT
)

const chatrobotBehaviorManager = new ChatRobotBehaviorManager(
	chatrobot, {
		appId: process.env.MICROSOFT_LUIS_APPID,
		appKey: process.env.MICROSOFT_LUIS_KEY,
		verbose: true
	}, true)


chatrobotBehaviorManager.addPhraseList('./chatrobotphraselist.hson')
chatrobotBehaviorManager.addDefaultReply(`Sorry Dave, I can't do that`)
chatrobotBehaviorManager.addErrorReply(`Huh?`)
chatrobotBehaviorManager.addShutdown(`shut down`, `Good bye Dave`)

chatrobotBehaviorManager.addCustom(`Weather.GetCondition`, async function (entities) {
	const location = entities &&
		entities[0] &&
		entities[0].type === 'Weather.Location' ? entities[0].entity : 'Minneapolis'

	const result = await Weather.get_weather_custom('city', location, 'weather')

	if (result.weather) {
		const currentWeather = `In ${result.name}, there is ${result.weather[0].description} and the current temp is ${parseInt(1.8 * (result.main.temp - 273) + 32)} degrees!`
		await this._chatrobot.speak(currentWeather)
	} else {
		await this._chatrobot.speak(`I'm not sure`)
	}

})

chatrobotBehaviorManager.addCustom(`Weather.GetForecast`, async function (entities) {

	const location = entities &&
	entities[0] &&
	entities[0].type === 'Weather.Location' ? entities[0].entity : 'Minneapolis'

	const result = await Weather.get_weather_custom('city', location, 'forecast')

	if (result[4]) {
		let forecastWeather = `Tomorow in ${location}, there will be ${result[4].weather[0].description} and ${parseInt(1.8 * (result[4].main.temp - 273) + 32)} degrees at ${(new Date(result[4].dt_txt)).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })}`
		forecastWeather += `, and ${result[7].weather[0].description} and ${parseInt(1.8 * (result[7].main.temp - 273) + 32)} degrees at ${(new Date(result[7].dt_txt)).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })}`
		await this._chatrobot.speak(forecastWeather)
	} else {
		await this._chatrobot.speak(`I'm not sure`)
	}


})

chatrobotBehaviorManager.addCustom(`Drive`, async function (entities) {
	await this._chatrobot.speak(`Ok, let's go!`)

	const seconds = entities &&
		entities[0] &&
		entities[0].type === 'builtin.number' ? entities[0].resolution.value : 5

	await this._chatrobot.drive(seconds)
})

chatrobotBehaviorManager.addCustom('Melody', async function (entities) {
	let phrase = `Ok!`
	let melody = `4C6;260`

	let entity = entities[0] && entities[0].type === 'Song' ? entities[0].resolution.values[0] : null;

	switch (entity) {
		case 'twinkle, twinkle':
			phrase += ` Let's play ${entities[0].entity}`

			let key = 5
			let tempo = 260
			melody = `4C${key},4C${key},4G${key},4G${key},4A${key},4A${key},4G${key},4  ,4F${key},4F${key},4E${key},4E${key},4D${key},4D${key},4C${key};${tempo}`

			break
		default:
			break
	}

	await this._chatrobot.speak(phrase)

	await this._chatrobot.playTone(melody)
})


chatrobotBehaviorManager.addCustom(`Sing`, async function () {
	await this._chatrobot.speak(`I'd love to sing you a song!`)

	const songStream = await fs.createReadStream('./audio/song.wav')
	await this._chatrobot.play(songStream)
})

chatrobotBehaviorManager.on('error', console.log)
chatrobotBehaviorManager.on('info', Shell.log)
chatrobotBehaviorManager.on('command', () => Shell.log('*prompt'))
chatrobotBehaviorManager.on('status', (status => {
	console.log('STATUS: ' + status)

	if (status == chatrobot.statusCode.CHATBOT_READY)
		Shell.log('*prompt')
}))

Shell.events.on('connection', function () {
})

Shell.events.on('speak', async (message) => {
	let response = await chatrobotBehaviorManager.speakAndSpell(message)

	Shell.log('\nCHATGPT> ' + response)

	await chatrobot.speak(response)

	Shell.log('*prompt')
})

Shell.events.on('drive', async (message) => {

	Shell.log('\nDriving ')

	await this._chatrobot.speak(`Ok, let's go!`)

	await this._chatrobot.drive(5)

	Shell.log('*prompt')
})


chatrobotBehaviorManager.start()
