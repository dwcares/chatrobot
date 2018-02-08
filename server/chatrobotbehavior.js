const LUISClient = require('./luis_sdk')
const EventEmitter = require("events").EventEmitter



class ChatRobotBehavior {
    constructor(token, behaviorHandler) {
        this._token = token
        this._behaviorHandler = behaviorHandler
    }
    async run(entities) {
        await this._behaviorHandler(entities)
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

class ChatRobotBehaviorManager extends EventEmitter {
    constructor(chatrobot) {
        super()

        this._chatrobot = chatrobot
        this._behaviors = new ChatRobotBehaviorCollection()
        this._luis = new LUISClient({
            appId: process.env.MICROSOFT_LUIS_APPID,
            appKey: process.env.MICROSOFT_LUIS_KEY,
            verbose: true
        })

        this._chatrobot.on('message', async (utterance) => {

            if (utterance) {
                const response = await this._luis.predictIntent(utterance)
                this.emit('info',`${this._luis.format(response)}` )

                let behavior = this._behaviors.lookup(response.topScoringIntent.intent)

                behavior = behavior ? behavior : this._defaultBehavior

                await behavior.run(response.entities)
            } else {
                await this._errorBehavior.run()
            }
        })

        this._chatrobot.on('status', (status) => {
            this.emit('status', status)
        })
        
        this._chatrobot.on('info', (info) => {
            this.emit('info', info)
        })

        this._chatrobot.on('error', (err) => {
            this.emit('error', err)
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
        this.addCustom(token, async function(utterance) {
            await this._chatrobot.speak(response)
        })
    }
    addDefaultReply(response) {
        this._defaultBehavior = new ChatRobotBehavior(null, 
            async function(utterance) {
            await this._chatrobot.speak(response)
        })
        this._defaultBehavior._chatrobot = this._chatrobot
    }
    addErrorReply(response) {
        this._errorBehavior = new ChatRobotBehavior(null, 
            async function(utterance) {
            await this._chatrobot.speak(response)
        })
        this._errorBehavior._chatrobot = this._chatrobot
    }
    async start() {
        await this._chatrobot.start()        
    }
}

module.exports = {
    ChatRobotBehavior,
    ChatRobotBehaviorCollection,
    ChatRobotBehaviorManager
}
