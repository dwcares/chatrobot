const { EventEmitter } = require('events')
const net = require('net')
const http = require('http')
const { WebSocketServer } = require('ws')
const Session = require('./Session')

/**
 * Wraps a raw TCP net.Socket to look like a WebSocket (ws),
 * so Session can work with both connection types.
 */
class TcpSocketAdapter extends EventEmitter {
  constructor (socket) {
    super()
    this.OPEN = 1
    this._socket = socket
    this._readyState = 1

    socket.on('data', (data) => {
      this.emit('message', data, true)
    })

    socket.on('close', () => {
      this._readyState = 3
      this.emit('close')
    })

    socket.on('error', (err) => {
      this._readyState = 3
      this.emit('error', err)
    })
  }

  get readyState () {
    return this._readyState
  }

  send (data, options) {
    if (this._readyState === 1) {
      this._socket.write(Buffer.from(data))
    }
  }

  close () {
    this._readyState = 3
    this._socket.end()
  }
}

class MicrostreamServer extends EventEmitter {
  constructor (options = {}) {
    super()

    this._port = options.port || 5000
    this._audioConfig = Object.assign(
      { sampleRate: 16000, bitDepth: 16, channels: 1 },
      options.audio
    )
    this._sessions = new Map()
    this._server = null
    this._httpServer = null
    this._wss = null
  }

  get sessions () {
    return this._sessions
  }

  get port () {
    return this._port
  }

  listen (callback) {
    this._httpServer = http.createServer()

    this._wss = new WebSocketServer({ server: this._httpServer })

    this._wss.on('connection', (ws) => {
      this._createSession(ws, 'ws')
    })

    this._wss.on('error', (err) => {
      this.emit('error', err)
    })

    // Raw TCP server that detects protocol on first bytes
    this._server = net.createServer((socket) => {
      socket.once('readable', () => {
        const chunk = socket.read()
        if (!chunk || chunk.length === 0) return

        // WebSocket upgrade starts with "GET "
        if (chunk.length >= 4 && chunk.toString('utf8', 0, 4) === 'GET ') {
          // It's HTTP/WebSocket — hand off to the HTTP server
          socket.unshift(chunk)
          this._httpServer.emit('connection', socket)
        } else {
          // Raw TCP — wrap in adapter and create session
          socket.unshift(chunk)
          const adapter = new TcpSocketAdapter(socket)
          this._createSession(adapter, 'tcp')
        }
      })
    })

    this._server.on('error', (err) => {
      this.emit('error', err)
    })

    this._server.listen(this._port, () => {
      this.emit('listening', this._port)
      if (callback) callback()
    })
  }

  _createSession (ws, type) {
    const session = new Session(ws, this._audioConfig)
    this._sessions.set(session.id, session)

    session.on('disconnect', () => {
      this._sessions.delete(session.id)
    })

    this.emit('session', session)
  }

  close (callback) {
    for (const session of this._sessions.values()) {
      session.close()
    }
    this._sessions.clear()

    let pending = 0
    const done = () => {
      pending--
      if (pending <= 0 && callback) callback()
    }

    if (this._wss) {
      pending++
      this._wss.close(done)
      this._wss = null
    }

    if (this._server) {
      pending++
      this._server.close(done)
      this._server = null
    }

    this._httpServer = null

    if (pending === 0 && callback) callback()
  }
}

module.exports = MicrostreamServer
