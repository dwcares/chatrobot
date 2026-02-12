/**
 * Audio round-trip test — no mic, button, or DAC needed.
 *
 * 1. Starts a MicrostreamServer (echo mode)
 * 2. Connects a fake WebSocket "device"
 * 3. Sends a generated 440 Hz sine-wave tone through the protocol
 * 4. Server saves received audio  → audio/server-received.wav
 * 5. Server echoes it back to client
 * 6. Client saves echoed audio    → audio/client-received.wav
 *
 * Uses 8-bit unsigned PCM at 16kHz to match the device firmware.
 *
 * Usage:  node roundtrip-test.js
 */

const fs = require('fs')
const path = require('path')
const WebSocket = require('../../server/node_modules/ws')
const { MicrostreamServer } = require('microstream-server')
const { MessageType, decode, encodeAudioData, encodeAudioEnd, encodeHeartbeat } = require('../../server/src/Protocol')
const AudioBuffer = require('../../server/src/AudioBuffer')

// --- Config (matches firmware: 16kHz 8-bit mono) ---
const PORT = 5111
const SAMPLE_RATE = 16000
const BIT_DEPTH = 8
const CHANNELS = 1
const TONE_HZ = 440
const DURATION_S = 2

const audioDir = path.join(__dirname, 'audio')
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir)

// --- Generate test tone (8-bit unsigned PCM) ---
function generateSinePcm () {
  const numSamples = SAMPLE_RATE * DURATION_S
  const buf = Buffer.alloc(numSamples) // 8-bit = 1 byte per sample

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE
    // 8-bit unsigned: silence = 128, range 0-255
    const sample = Math.round(Math.sin(2 * Math.PI * TONE_HZ * t) * 127 + 128)
    buf[i] = sample
  }

  return buf
}

// --- Save a PCM buffer as WAV ---
function saveWav (filePath, pcmBuffer) {
  const wav = AudioBuffer.wrapPcmAsWav(pcmBuffer, {
    sampleRate: SAMPLE_RATE,
    bitDepth: BIT_DEPTH,
    channels: CHANNELS
  })
  fs.writeFileSync(filePath, wav)
  console.log(`  Saved ${filePath} (${wav.length} bytes)`)
}

// --- Main ---
const pcm = generateSinePcm()
console.log(`Generated ${DURATION_S}s ${TONE_HZ} Hz tone (${pcm.length} bytes, ${BIT_DEPTH}-bit PCM)\n`)

// Save the original as reference
saveWav(path.join(audioDir, 'original-tone.wav'), pcm)

const server = new MicrostreamServer({
  port: PORT,
  audio: { sampleRate: SAMPLE_RATE, bitDepth: BIT_DEPTH, channels: CHANNELS }
})

server.on('error', (err) => {
  console.error('[server] Error:', err.message)
  process.exit(1)
})

server.on('session', (session) => {
  const tag = session.id.slice(0, 8)
  console.log(`[server] Device connected (${tag})`)

  session.on('audioEnd', (wavBuffer) => {
    // Strip the 44-byte WAV header to get raw PCM
    const receivedPcm = wavBuffer.slice(44)
    console.log(`[server] Received audio: ${receivedPcm.length} bytes PCM`)
    saveWav(path.join(audioDir, 'server-received.wav'), receivedPcm)

    // Echo it back
    console.log('[server] Echoing audio back to client...')
    session.play(receivedPcm)

    // Give echoed chunks time to be delivered, then shut down
    setTimeout(() => {
      session.close()
    }, 1000)
  })

  session.on('disconnect', () => {
    console.log(`[server] Device disconnected (${tag})`)
  })

  session.on('error', (err) => {
    console.error(`[server] Session error:`, err.message)
  })
})

server.listen(() => {
  console.log(`[server] Listening on port ${PORT}\n`)

  // --- Fake device client ---
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const receivedChunks = []

  ws.on('error', (err) => {
    console.error('[client] WebSocket error:', err.message)
  })

  ws.on('open', () => {
    console.log('[client] Connected to server')
  })

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return
    const msg = decode(data)
    if (!msg) return

    switch (msg.type) {
      case MessageType.CONFIG:
        console.log('[client] Got config:', JSON.parse(msg.payload.toString()))
        sendAudio(ws)
        break

      case MessageType.AUDIO_DATA:
        receivedChunks.push(Buffer.from(msg.payload))
        break

      case MessageType.HEARTBEAT:
        ws.send(encodeHeartbeat())
        break
    }
  })

  ws.on('close', () => {
    console.log('[client] Disconnected')

    if (receivedChunks.length > 0) {
      const echoed = Buffer.concat(receivedChunks)
      console.log(`[client] Received ${echoed.length} bytes echoed PCM`)
      saveWav(path.join(audioDir, 'client-received.wav'), echoed)
    } else {
      console.log('[client] No audio received back')
    }

    console.log('\nDone! Compare the WAV files in examples/server/audio/')
    server.close(() => process.exit(0))
  })
})

// Send PCM in protocol-sized chunks, then AUDIO_END
function sendAudio (ws) {
  const chunkSize = 512
  let sent = 0

  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, pcm.length)
    const chunk = pcm.slice(offset, end)
    ws.send(encodeAudioData(chunk))
    sent += chunk.length
  }

  ws.send(encodeAudioEnd())
  console.log(`[client] Sent ${sent} bytes PCM + AUDIO_END`)
}

// Safety timeout
setTimeout(() => {
  console.error('\nTimed out after 10s')
  process.exit(1)
}, 10000)
