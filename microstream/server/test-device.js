/**
 * Simulates a Particle device connecting and streaming audio.
 * Run: node test-device.js
 *
 * Starts the server, connects a fake WebSocket client,
 * sends a recording (audioData frames + audioEnd), and
 * verifies the server produces a valid WAV buffer.
 */

const WebSocket = require('ws')
const { MicrostreamServer, Protocol } = require('./src')

const PORT = 9123

// Start server
const server = new MicrostreamServer({
  port: PORT,
  audio: { sampleRate: 16000, bitDepth: 8, channels: 1 }
})

let passed = 0
let failed = 0

function assert (condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`)
    passed++
  } else {
    console.error(`  FAIL: ${label}`)
    failed++
  }
}

server.on('session', (session) => {
  console.log('\n--- Session events ---')

  session.on('audioStart', () => {
    console.log('  audioStart fired')
    assert(true, 'audioStart event received')
  })

  session.on('audioData', (chunk) => {
    assert(chunk.length > 0, `audioData received (${chunk.length} bytes)`)
  })

  session.on('audioEnd', (wavBuffer) => {
    console.log('\n--- WAV verification ---')
    assert(wavBuffer.length > 44, `WAV buffer has data (${wavBuffer.length} bytes)`)
    assert(wavBuffer.slice(0, 4).toString() === 'RIFF', 'WAV starts with RIFF')
    assert(wavBuffer.slice(8, 12).toString() === 'WAVE', 'WAV contains WAVE marker')

    const dataSize = wavBuffer.readUInt32LE(40)
    assert(dataSize === wavBuffer.length - 44, `WAV data size correct (${dataSize})`)

    const sampleRate = wavBuffer.readUInt32LE(24)
    assert(sampleRate === 16000, `Sample rate is 16000 (got ${sampleRate})`)
  })

  session.on('disconnect', () => {
    console.log('\n--- Results ---')
    console.log(`  ${passed} passed, ${failed} failed`)
    server.close(() => process.exit(failed > 0 ? 1 : 0))
  })
})

server.on('listening', () => {
  console.log(`Test server on port ${PORT}`)
  runFakeDevice()
})

server.listen()

function runFakeDevice () {
  const ws = new WebSocket(`ws://localhost:${PORT}`)

  ws.on('open', () => {
    console.log('Fake device connected')

    // Simulate a 0.5 second recording at 16kHz 8-bit = 8000 bytes
    const totalSamples = 8000
    const chunkSize = 512

    // Send audio in chunks (like the firmware does every 100ms)
    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
      const size = Math.min(chunkSize, totalSamples - offset)
      const samples = Buffer.alloc(size)

      // Generate a simple sine wave for test audio
      for (let i = 0; i < size; i++) {
        const t = (offset + i) / 16000
        samples[i] = Math.floor(128 + 100 * Math.sin(2 * Math.PI * 440 * t))
      }

      ws.send(Protocol.encodeAudioData(samples))
    }

    // Send end-of-recording
    ws.send(Protocol.encodeAudioEnd())

    // Disconnect after a short delay
    setTimeout(() => ws.close(), 500)
  })

  ws.on('message', (data) => {
    const msg = Protocol.decode(data)
    if (msg) {
      if (msg.type === Protocol.MessageType.CONFIG) {
        const config = JSON.parse(msg.payload.toString())
        console.log('Received config from server:', config)
        assert(config.sampleRate === 16000, 'Config sampleRate matches')
      } else if (msg.type === Protocol.MessageType.HEARTBEAT) {
        // respond to heartbeat
        ws.send(Protocol.encodeHeartbeat())
      }
    }
  })
}
