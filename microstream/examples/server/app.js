require('dotenv').config()

const { MicrostreamServer } = require('microstream-server')
const SpeechPipeline = require('./SpeechPipeline')

const PORT = process.env.PORT || 5000

const server = new MicrostreamServer({
  port: PORT,
  audio: { sampleRate: 16000, bitDepth: 8, channels: 1 }
})

const pipeline = new SpeechPipeline({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-4o',
  voice: process.env.OPENAI_VOICE || 'alloy',
  systemPrompt: process.env.SYSTEM_PROMPT || undefined
})

server.on('session', (session) => {
  const tag = session.id.slice(0, 8)
  console.log(`[${tag}] Device connected`)

  pipeline.initSession(session.id)

  session.on('audioStart', () => {
    console.log(`[${tag}] Recording started`)
  })

  session.on('audioEnd', async (wavBuffer) => {
    console.log(`[${tag}] Recording ended (${wavBuffer.length} bytes)`)

    try {
      const result = await pipeline.processAudio(session.id, wavBuffer)
      if (result && result.audio) {
        session.play(result.audio)
      }
    } catch (err) {
      console.error(`[${tag}] Pipeline error:`, err.message)
    }
  })

  session.on('disconnect', () => {
    console.log(`[${tag}] Device disconnected`)
    pipeline.cleanupSession(session.id)
  })

  session.on('error', (err) => {
    console.error(`[${tag}] Session error:`, err.message)
  })
})

server.on('error', (err) => {
  console.error('Server error:', err.message)
})

server.on('listening', (port) => {
  console.log(`Microstream server listening on port ${port}`)
  console.log(`Waiting for device connections...`)
})

server.listen()
