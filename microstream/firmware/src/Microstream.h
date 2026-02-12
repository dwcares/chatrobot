#ifndef MICROSTREAM_H
#define MICROSTREAM_H

#include "application.h"
#include "AudioCapture.h"
#include "AudioPlayback.h"
#include "Protocol.h"
#include "RingBuffer.h"

// Forward declare WebSocketClient from the Particle library
class WebSocketClient;

struct MicrostreamConfig {
  unsigned int sampleRate;
  uint8_t bitDepth;
  pin_t micPin;
  pin_t speakerPin;
  unsigned int captureBufferSize;
  unsigned int playbackBufferSize;
};

typedef void (*MicrostreamCallback)();

class Microstream {
public:
  Microstream();
  ~Microstream();

  void begin(const char* host, int port, const char* path, MicrostreamConfig config);

  // Call from loop() — handles connection, heartbeats, playback
  void update();

  void startRecording();
  void stopRecording();

  bool isRecording() const;
  bool isPlaying() const;
  bool isConnected() const;

  // Event callbacks
  void onConnected(MicrostreamCallback cb);
  void onDisconnected(MicrostreamCallback cb);
  void onPlaybackStart(MicrostreamCallback cb);
  void onPlaybackEnd(MicrostreamCallback cb);

private:
  void _connect();
  void _sendAudio();
  void _sendEnd();
  void _sendHeartbeat();
  void _receiveAndPlay();
  void _handleMessage(const uint8_t* data, unsigned int len);

  char _host[128];
  int _port;
  char _path[64];
  MicrostreamConfig _config;

  TCPClient _tcpClient;
  bool _connected;
  bool _recording;
  bool _wasPlaying;

  AudioCapture _capture;
  AudioPlayback _playback;

  uint8_t _txBuffer[1026]; // 1 byte type + 1024 bytes payload + 1 spare

  unsigned long _lastSendTime;
  unsigned long _lastHeartbeatTime;
  unsigned long _lastConnectAttempt;
  unsigned int _reconnectDelay;

  static const unsigned int SEND_INTERVAL_MS = 100;
  static const unsigned int HEARTBEAT_INTERVAL_MS = 5000;
  static const unsigned int MIN_SEND_SIZE = 512;
  static const unsigned int MAX_SEND_SIZE = 1024;
  static const unsigned int MAX_RECONNECT_DELAY_MS = 30000;

  MicrostreamCallback _onConnected;
  MicrostreamCallback _onDisconnected;
  MicrostreamCallback _onPlaybackStart;
  MicrostreamCallback _onPlaybackEnd;
};

#endif
