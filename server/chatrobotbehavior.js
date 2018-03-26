const LUISClient = require('./luis_sdk')
const EventEmitter = require('events').EventEmitter
const fs = require('fs-extra')
var hanson = require('hanson');

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
        super(...args)
        this._token = token
        this._lastBehaviorIndex = 0
    }
    async _behaviorHandler(chatrobot, entities) {
        for (const i = 0; i < this.length; i++) {
            // No nesting
            if (typeof this[i] === 'ChatRobotBehaviorHandler')
                await this[i]._behaviorHandler(chatrobot, entities)
        }
    }
    lookup(token) {
        const behaviors = this.filter(element => element._token === token)
        let selectedIndex = Math.floor(Math.random()*behaviors.length)

        // don't repeat behaviors in collection
        while (behaviors.length > 1 && selectedIndex === this._lastBehaviorIndex) {
            selectedIndex = Math.floor(Math.random()*behaviors.length)
        }

        this._lastBehaviorIndex = selectedIndex

        return behaviors[selectedIndex];
    }
    async run(entities) {
        await this._behaviorHandler(this._chatrobot, entities)
    }
}

class ChatRobotBehaviorManager extends EventEmitter {
    constructor(chatrobot, luisInfo) {
        super()

        this._chatrobot = chatrobot
        this._behaviors = new ChatRobotBehaviorCollection()
        this._luis = new LUISClient(luisInfo)

        this._chatrobot.on('message', async (utterance) => {

            if (utterance && this._shutdownBehavior && utterance.startsWith(this._shutdownBehavior._token)) {
                await this._shutdownBehavior.run()
                this.emit('command', 'SHUTDOWN BEHAVIOR')
            } else if (utterance) {
                const response = await this._luis.predictIntent(utterance)
                this.emit('info',`${this._luis.format(response)}` )

                let behavior = this._behaviors.lookup(response.topScoringIntent.intent)

                behavior = behavior ? behavior : this._defaultBehavior

                await behavior.run(response.entities)
                this.emit('command', 'BEHAVIOR: ' + behavior._token)

            } else {
                await this._errorBehavior.run()
                this.emit('command', 'ERROR BEHAVIOR')
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
    async addPhraseList(path) {
        let phraseListText = await fs.readFile(path)
        phraseListText = `{"phrases": ${phraseListText}}`
        const phraseList = hanson.parse(phraseListText).phrases

        for (let i = 0; i < phraseList.length; i++) {
            for (let j = 0; j < phraseList[i].phrases.length; j++) {
                this.addReply(phraseList[i].token, phraseList[i].phrases[j])
            }
        }
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
    addShutdown(token, response) {
        this._shutdownBehavior = new ChatRobotBehavior(token, 
            async function(utterance) {
                await this._chatrobot.speak(response)
                await this._chatrobot.playTone('8G4,8F4,8E4,8D4,8C3')
                await this._chatrobot.shutdown()
        })
        this._shutdownBehavior._chatrobot = this._chatrobot
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
