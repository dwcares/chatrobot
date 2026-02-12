const OpenAI = require('openai')

class SpeechPipeline {
  constructor (options = {}) {
    this._openai = new OpenAI({ apiKey: options.apiKey || process.env.OPENAI_API_KEY })
    this._model = options.model || 'gpt-4o'
    this._voice = options.voice || 'alloy'
    this._systemPrompt = options.systemPrompt || 'You are a helpful voice assistant running on a small robot. Keep responses concise — under 2 sentences.'

    // Per-session conversation history
    this._conversations = new Map()
  }

  initSession (sessionId) {
    this._conversations.set(sessionId, [
      { role: 'system', content: this._systemPrompt }
    ])
  }

  cleanupSession (sessionId) {
    this._conversations.delete(sessionId)
  }

  async processAudio (sessionId, wavBuffer) {
    // 1. Speech-to-text via Whisper
    const transcript = await this._transcribe(wavBuffer)
    if (!transcript) return null

    console.log(`[${sessionId.slice(0, 8)}] User: ${transcript}`)

    // 2. Chat completion via GPT
    const response = await this._chat(sessionId, transcript)
    console.log(`[${sessionId.slice(0, 8)}] Assistant: ${response}`)

    // 3. Text-to-speech → convert to device format
    const ttsBuffer = await this._synthesize(response)
    const deviceAudio = SpeechPipeline.convertTtsToDevice(ttsBuffer)

    console.log(`[${sessionId.slice(0, 8)}] Audio: ${ttsBuffer.length}b TTS → ${deviceAudio.length}b device`)

    return { transcript, response, audio: deviceAudio }
  }

  async _transcribe (wavBuffer) {
    const file = new File([wavBuffer], 'recording.wav', { type: 'audio/wav' })
    const result = await this._openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: file,
      response_format: 'text'
    })
    return result.trim()
  }

  async _chat (sessionId, userMessage) {
    const history = this._conversations.get(sessionId)
    if (!history) return 'Sorry, session not found.'

    history.push({ role: 'user', content: userMessage })

    const completion = await this._openai.chat.completions.create({
      model: this._model,
      messages: history
    })

    const response = completion.choices[0].message.content
    history.push({ role: 'assistant', content: response })

    // Keep conversation history manageable (last 20 exchanges)
    if (history.length > 41) { // system + 20 pairs
      history.splice(1, 2) // remove oldest user/assistant pair
    }

    return response
  }

  async _synthesize (text) {
    const response = await this._openai.audio.speech.create({
      model: 'tts-1',
      voice: this._voice,
      input: text,
      response_format: 'pcm' // raw 24kHz 16-bit signed LE mono
    })

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  /**
   * Convert OpenAI TTS output to device format.
   *
   * TTS returns:  24kHz, 16-bit signed LE, mono
   * Device needs:  16kHz, 8-bit unsigned, mono
   */
  static convertTtsToDevice (ttsBuffer) {
    const inputSamples = ttsBuffer.length / 2 // 2 bytes per 16-bit sample
    const outputSamples = Math.floor(inputSamples * 16000 / 24000)
    const output = Buffer.alloc(outputSamples)
    const ratio = 24000 / 16000 // 1.5

    for (let i = 0; i < outputSamples; i++) {
      // Nearest-neighbor resample: pick source sample at position i * 1.5
      const srcIndex = Math.min(Math.floor(i * ratio), inputSamples - 1)
      const sample16 = ttsBuffer.readInt16LE(srcIndex * 2)

      // 16-bit signed (-32768..32767) → 8-bit unsigned (0..255)
      const sample8 = Math.max(0, Math.min(255, (sample16 >> 8) + 128))
      output[i] = sample8
    }

    return output
  }
}

module.exports = SpeechPipeline
