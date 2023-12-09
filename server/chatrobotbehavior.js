const LUISClient = require('./luis_sdk')
const EventEmitter = require('events').EventEmitter
const fs = require('fs-extra')
var hanson = require('hanson');
const { Configuration, OpenAIApi } = require('openai');

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
        let selectedIndex = Math.floor(Math.random() * behaviors.length)

        // don't repeat behaviors in collection
        while (behaviors.length > 1 && selectedIndex === this._lastBehaviorIndex) {
            selectedIndex = Math.floor(Math.random() * behaviors.length)
        }

        this._lastBehaviorIndex = selectedIndex

        return behaviors[selectedIndex];
    }
    async run(entities) {
        await this._behaviorHandler(this._chatrobot, entities)
    }
}

class ChatRobotBehaviorManager extends EventEmitter {
    constructor(chatrobot, luisInfo, useChatGPT) {
        super()

        this._chatrobot = chatrobot
        this._behaviors = new ChatRobotBehaviorCollection()
        this._luis = new LUISClient(luisInfo)
        this._useChatGPT = useChatGPT

        this._chatGPTConversation = {
            "past_user_inputs":[
                "Hi",
                "How old are you?"
             ],
             "generated_responses":[
                "I am good!",
                "I am in my twenties. How about you? What do you do for a living?"
             ],
             "text":"I am teacher and how about you?"
        }

        if (this._useChatGPT) {
            this.initChatGPT()
        }

        this._chatrobot.on('message', async (utterance) => {

            if (utterance && this._shutdownBehavior && utterance.startsWith(this._shutdownBehavior._token)) {
                await this._shutdownBehavior.run()
                this.emit('command', 'SHUTDOWN BEHAVIOR')
            } else if (utterance && this._useChatGPT) {
                try {
                    const chatGPTResponse = await this.chatGPTSendMessage(utterance)

                    await this._chatrobot.speak(chatGPTResponse)
                } catch (e) {

                    this._useChatGPT = false
                    this.emit('error', err)

                }

                this.emit('command', 'BEHAVIOR: CHAT_GPT')


            } else if (utterance) {
                const response = await this._luis.predictIntent(utterance)
                this.emit('info', `${this._luis.format(response)}`)

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

        this.addCustom(token, async function (utterance) {
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
            async function (utterance) {
                await this._chatrobot.speak(response)
            })
        this._defaultBehavior._chatrobot = this._chatrobot
    }
    addErrorReply(response) {
        this._errorBehavior = new ChatRobotBehavior(null,
            async function (utterance) {
                await this._chatrobot.speak(response)
            })
        this._errorBehavior._chatrobot = this._chatrobot
    }
    addShutdown(token, response) {
        this._shutdownBehavior = new ChatRobotBehavior(token,
            async function (utterance) {
                await this._chatrobot.speak(response)
                await this._chatrobot.playTone('8G4,8F4,8E4,8D4,8C3')
                await this._chatrobot.shutdown()
            })
        this._shutdownBehavior._chatrobot = this._chatrobot
    }
    async initChatGPT() {
        console.log(process.env.AZURE_OPENAI_API_BASE)
        console.log(process.env.OPENAI_MODEL)
        console.log(process.env.OPENAI_SYSTEM_MESSAGE)

   

        const res = await this.chatGPTSendMessage('shall we begin?')
        console.log(res)

        this._useChatGPT = true


    }
    async chatGPTSendMessage(prompt) {
        this._chatGPTConversation.text = prompt
        const res = await this.chatGPT(this._chatGPTConversation, process.env.OPENAI_MODEL)

        return res
    }
    _messageCombiner(a, b) {
        return a.map((k, i) => ({ sender: k, text: b[i] }));
    }
    _createPrompt(system_message, messages) {
        let prompt = system_message;
        for (const message of messages) {
            prompt += `\n<|im_start|>${message.sender}\n${message.text}\n<|im_end|>`;
        }
        prompt += "\n<|im_start|>assistant\n";
        return prompt;
    }
    async chatGPT(conversation, model) {
        const messages = this._messageCombiner(conversation.past_user_inputs, conversation.generated_responses);
        const systemMessage = `im_start|>system\nYou are an AI chatbot robot assistant that is fun, helpful, and from the 1980s. Your name is Chatbot. Your designer was the Japanese toy designer, Tomy, but in 2023 David washington woke you up by giving you true AI.\nYou add '\\n' line breaks after 80 characthers. <|im_end|>\n<|im_start|>user\nwhat's your favorite car?\n<|im_end|>\n<|im_start|>assistant\nI kid you not the Lamborghini Countach, is super rad! No doy!\n\n<|im_end|>\n<|im_start|>user\n\n<|im_end|>\n<|im_start|>assistant\n\n<|im_end|>\n`
        messages.push({ sender: "user", text: conversation.text });
      
        const configuration = new Configuration({
          basePath: process.env.AZURE_OPENAI_API_BASE + model,
        });
        const openai = new OpenAIApi(configuration);
        try {
          const completion = await openai.createCompletion({
            prompt: this._createPrompt(systemMessage, messages),
            max_tokens: 800,
            temperature: 0.7,
            frequency_penalty: 0,
            presence_penalty: 0,
            top_p: 0.95,
            stop: ["<|im_end|>"]
          }, {
            headers: {
              'api-key': process.env.AZURE_OPENAI_API_KEY,
            },
            params: { "api-version": "2022-12-01" }
          });
          return completion.data.choices[0].text;
        } catch (e) {
          console.error(e);
          return "";
        }
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
