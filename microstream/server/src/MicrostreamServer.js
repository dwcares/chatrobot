const { EventEmitter } = require('events')
const { WebSocketServer } = require('ws')
const Session = require('./Session')

class MicrostreamServer extends EventEmitter {
  constructor (options = {}) {
    super()

    this._port = options.port || 5000
    this._audioConfig = Object.assign(
      { sampleRate: 16000, bitDepth: 16, channels: 1 },
      options.audio
    )
    this._sessions = new Map()
    this._wss = null
  }

  get sessions () {
    return this._sessions
  }

  get port () {
    return this._port
  }

  listen (callback) {
    this._wss = new WebSocketServer({ port: this._port })

    this._wss.on('connection', (ws) => {
      const session = new Session(ws, this._audioConfig)
      this._sessions.set(session.id, session)

      session.on('disconnect', () => {
        this._sessions.delete(session.id)
      })

      this.emit('session', session)
    })

    this._wss.on('error', (err) => {
      this.emit('error', err)
    })

    this._wss.on('listening', () => {
      this.emit('listening', this._port)
      if (callback) callback()
    })
  }

  close (callback) {
    for (const session of this._sessions.values()) {
      session.close()
    }
    this._sessions.clear()

    if (this._wss) {
      this._wss.close(callback)
      this._wss = null
    } else if (callback) {
      callback()
    }
  }
}

module.exports = MicrostreamServer
