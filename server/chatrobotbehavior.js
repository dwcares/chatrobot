(function () {

    const LUISClient = require('./luis_sdk')
    const Speech = require('./speech_sdk')
    const speech = new Speech()


    class ChatRobotBehavior {
        constructor(token, behaviorHandler) {
            this._token = token
            this._behaviorHandler = behaviorHandler
        }
        async run(entities) {
            await this._behaviorHandler(entities)
        }
        async speak(utterance) {
            console.log(`Speaking: ${utterance}`)
            const audio = await speech.textToSpeech(utterance)
            await this._chatrobot.play(audio)
        }
    }

    class ChatRobotBehaviorCollection extends Array {
        constructor(token, ...args) {
            super(...args);
            this._token = token
        }
        lookup(token) {
            return this.find(function (element) {
                return element._token === token;
            })
        }
        async _behaviorHandler(chatrobot, entities) {
            for (const i = 0; i < this.length; i++) {
                // No nesting
                if (typeof this[i] === 'ChatRobotBehaviorHandler')
                    await this[i]._behaviorHandler(chatrobot, entities)
            }
        }
        async run(entities) {
            await this._behaviorHandler(this._chatrobot, entities)
        }
    }

    class ChatRobotReply extends ChatRobotBehavior {
        constructor(token, reply) {
            super(token)
            this._reply = reply
            this._behaviorHandler = async () => {
                await this.speak(this._reply)
            }
        }
    }

    class ChatRobotBehaviorManager {
        constructor(chatrobot) {
            this._chatrobot = chatrobot
            this._behaviors = new ChatRobotBehaviorCollection()
            this._luis = new LUISClient({
                appId: process.env.MICROSOFT_LUIS_APPID,
                appKey: process.env.MICROSOFT_LUIS_KEY,
                verbose: true
            })
        }
        add(behavior) {
            behavior._chatrobot = this._chatrobot
            this._behaviors.push(behavior)
        }
        addCustom(token, handler) {
            const behavior = new ChatRobotBehavior(token, handler);
            this.add(behavior)
        }
        addReply(token, response) {
            const behavior = new ChatRobotReply(token, response)
            this.add(behavior)
        }
        addDefaultReply(response) {
            this._defaultBehavior = new ChatRobotReply(null, response)
            this._defaultBehavior._chatrobot = this._chatrobot
        }
        addErrorReply(response) {
            this._errorBehavior = new ChatRobotReply(null, response)
            this._errorBehavior._chatrobot = this._chatrobot
        }
        async start() {

            await this._chatrobot.start()
            await speech.getSpeechAccessToken(process.env.MICROSOFT_SPEECH_API_KEY)

            this._chatrobot.on('audioMessage', async (audio) => {

                const recognizedText = await speech.speechToText(audio)

                if (recognizedText) {
                    console.log(`Recognized text: ${recognizedText}`)

                    const response = await this._luis.predictIntent(recognizedText)
                    let behavior = this._behaviors.lookup(response.topScoringIntent.intent)

                    behavior = behavior ? behavior : this._defaultBehavior

                    await behavior.run(response.entities)
                } else {
                    await this._errorBehavior.run()
                }

            })

            console.log(`Chatbot ready!`)
        }
    }

    module.exports = {
        ChatRobotBehavior,
        ChatRobotReply,
        ChatRobotBehaviorCollection,
        ChatRobotBehaviorManager
    }
}())