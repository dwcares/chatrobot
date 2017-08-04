// This #include statement was automatically added by the Particle IDE.
#include "SimpleRingBuffer.h"
#include <SparkIntervalTimer.h>
#include <Debounce.h>

// #define SERIAL_DEBUG_ON true

#define MOTOR_REVERSE_PIN D1
#define MOTOR_FORWARD_PIN D2
#define DRIVE_DISTANCE_FREQ 1000

#define TRIG_PIN D4
#define ECHO_PIN D5
#define EYES_LED A4

#define SINGLE_PACKET_MIN 512
#define SINGLE_PACKET_MAX 1024
#define END_PACKET_SIZE 100

#define SERVER_HOST  "192.168.2.64"
#define SERVER_PORT 3000

#define AUDIO_TIMING_VAL 62 /* 16kHz */
#define PLAYBACK_TIMING_VAL 62
// #define PLAYBACK_TIMING_VAL 124 /* for 8khz */

#define VOLUME 0.06

#define MICROPHONE_PIN DAC1
#define AUDIO_BUFFER_MAX 8192
#define RECEIVE_BUFFER_MAX 32*1024

#define BUTTON_PIN D0
#define SPEAKER_PIN A3

#define PING_SENSOR_DELAY_MS 10

uint8_t txBuffer[SINGLE_PACKET_MAX + 1];
SimpleRingBuffer audio_buffer;
SimpleRingBuffer recv_buffer;

unsigned long lastSend = millis();

bool eyesBusy = false;
unsigned int eyesVal = 0;
int eyesDir = 1;

TCPClient client;
IntervalTimer readMicTimer;

int _sendBufferLength = 0;
unsigned int lastPublished = 0;

bool _isRecording = false;
bool _isPlayback = false;
bool _isDriving = false;

bool _isConnected = false;
float _volumeRatio = VOLUME;
int lastClientCheck;

Debounce debouncer = Debounce(); 
Debounce longPressDebouncer = Debounce();
bool sensorInit = false;

unsigned long lastDriveUpdateTime = millis();
int currentDriveSpeed = 0;

void setup() {
    #if SERIAL_DEBUG_ON
    Serial.begin(115200);
    #endif

    Particle.function("drive", drive);
    Particle.function("stop", stop);
    
    pinMode(MICROPHONE_PIN, INPUT);
    pinMode(SPEAKER_PIN, OUTPUT);
    pinMode(EYES_LED, OUTPUT);
    pinMode(D7, OUTPUT);
    
    pinMode(MOTOR_REVERSE_PIN, OUTPUT);
    pinMode(MOTOR_FORWARD_PIN, OUTPUT);
    setMotorSpeed(0);
    
    setADCSampleTime(ADC_SampleTime_3Cycles);
    recv_buffer.init(RECEIVE_BUFFER_MAX);
    audio_buffer.init(AUDIO_BUFFER_MAX);
    
    debouncer.attach(BUTTON_PIN, INPUT_PULLUP);
    debouncer.interval(20);
    
    longPressDebouncer.attach(BUTTON_PIN, INPUT_PULLUP);
    longPressDebouncer.interval(5000);
    
    checkWifiConfig();
}

void loop() {

    updateRecordAndPlay();
    updateEyes();
    //updateDriveDistance();
}

/////////////// MAIN RECORD LOOP //////////////

void updateRecordAndPlay() {
    verifyConnected();
    debouncer.update();

    // Record and send audio
    if (debouncer.read() == LOW && _isConnected) {
        startRecording();
        sendEvery(100);
    }  else {
        stopRecording();
        
        if (_isConnected) {
            readAndPlay();
        }
    }
}

void checkWifiConfig() {
    if (digitalRead(BUTTON_PIN) == LOW ) {
        digitalWrite(EYES_LED, HIGH);
        WiFi.listen();
    }
}

int recognized(String text) {
    Serial.println("Recognized: " + text);
    
     if (text.indexOf("go") >= 0) {
    } else {
    }

    // if (text.toLowerCase().indexOf("stop") >= 0) {
    //     motor.run (BRAKE | BACKWARD);
    // }

    return 0;
}

////////////////// MOTORS AND EYES //////////////////

int setMotor(String speed) {
    setMotorSpeed(speed.toInt());
    return 1;
}

void updateDriveDistance() {

    if (_isDriving) {
        uint32_t inches = measureInches(TRIG_PIN, ECHO_PIN, PING_SENSOR_DELAY_MS);
        
        Serial.println(inches);

        if (inches > 30) {
            setMotorSpeed(255);
        }
        else if (inches > 10) {
            setMotorSpeed(120);
        }  else {
            setMotorSpeed(-100);
        }
        lastDriveUpdateTime = millis();
    }
}

int drive(String speed) {
 
   setMotorSpeed(150);
   return 1;
}

int stop(String args) {
    setMotorSpeed(0);
    return 1;
}


void setMotorSpeed(int speed) {
    
    if (speed == currentDriveSpeed) return; 
    
    if (speed > 0) {
        _isDriving = true;
        analogWrite(MOTOR_FORWARD_PIN, 255 - speed);
        digitalWrite(MOTOR_REVERSE_PIN, HIGH);
    } else if (speed < 0) {
        _isDriving = true;
      analogWrite(MOTOR_REVERSE_PIN, 255 + speed);
      digitalWrite(MOTOR_FORWARD_PIN, HIGH);
    } else {
        _isDriving = false;
        digitalWrite(MOTOR_FORWARD_PIN, HIGH);
        digitalWrite(MOTOR_REVERSE_PIN, HIGH);
    }
    
    currentDriveSpeed = speed;
}

void updateEyes() {
    if (_isRecording || _isPlayback || _isDriving) {
        digitalWrite(EYES_LED, HIGH);
    } else {
        if (eyesVal > 1500) {
            eyesDir = -1;
        } 
        
        if (eyesVal <= 0) {
            eyesDir = 1;
        }
        
       eyesVal += eyesDir;
    
       analogWrite(EYES_LED, eyesVal);
    }
}

////////////////// DISTANCE SENSOR ///////////////////

int measureInches(pin_t trig_pin, pin_t echo_pin, uint32_t wait)
{
    uint32_t duration, inches, cm;
    if (!sensorInit) {
        pinMode(trig_pin, OUTPUT);
        digitalWriteFast(trig_pin, LOW);
        pinMode(echo_pin, INPUT);
        delay(50);
        sensorInit = true;
    }

    digitalWriteFast(trig_pin, HIGH);
    delayMicroseconds(wait);
    digitalWriteFast(trig_pin, LOW);
  
    duration = pulseIn(echo_pin, HIGH);

    inches = duration / 74 / 2;
    cm = duration / 29 / 2;
    
    return inches;
}


////////////////// RECORDING AUDIO ////////////////////

void startRecording() {
    if (!_isRecording) {
        _isRecording = true;
        readMicTimer.begin(readMic, AUDIO_TIMING_VAL, uSec);
    }
}

void stopRecording() {
    if (_isRecording) {
        _isRecording = false;
        readMicTimer.end();
        sendEnd();
    }
}

void readMic(void) {
    //read audio
    uint16_t value = analogRead(MICROPHONE_PIN);
    value = map(value, 0, 4095, 0, 255);
    audio_buffer.put(value);
}

void sendEvery(int delay) {
    // if it's been longer than 100ms since our last broadcast, then broadcast.
    if ((millis() - lastSend) >= delay) {
        sendAudio();
        lastSend = millis();
    }
}

void sendAudio(void) {
    int count = 0;
    int storedSoundBytes = audio_buffer.getSize();

    // don't read out more than the max of our ring buffer
    // remember, we're also recording while we're sending
    while (count < storedSoundBytes) {

        if (audio_buffer.getSize() < SINGLE_PACKET_MIN) {
            break;
        }
        // for loop should be faster, since we can check our buffer size just once?
        int size = min(audio_buffer.getSize(), SINGLE_PACKET_MAX);

        for(int c = 0; c < size; c++) {
            txBuffer[c] = audio_buffer.get();
        }
        count += size;

        client.write(txBuffer, size);
    }
}

void sendEnd(void) {
    
    for(int c = 0; c < END_PACKET_SIZE; c++) {
        txBuffer[c] = NULL;
    }
    
    client.write(txBuffer, END_PACKET_SIZE);
}

////////////////// AUDIO PLAYBACK ////////////////////

void playRxAudio() {
    unsigned long lastWrite = micros();
	unsigned long now, diff;
	

    int value = 0;


    while (recv_buffer.getSize() > 0) {
        _isPlayback = true;

        //play audio
        value = recv_buffer.get();
        value = map(value, 0,  255, 0, 4095); // wha it should be, but quiet?

        now = micros();
        diff = (now - lastWrite);
        if (diff < PLAYBACK_TIMING_VAL) {
            delayMicroseconds(PLAYBACK_TIMING_VAL - diff);
        }

        analogWrite(SPEAKER_PIN, value);
        lastWrite = micros();
    }


    _isPlayback = false;
    
}

void readAndPlay() {
    while (client.available()) {
      recv_buffer.put(client.read());
    }
    
    playRxAudio();

}


int BitShiftCombine( uint8_t x_high, uint8_t x_low)
{
    int combined = 0; 
    combined = x_high; //send x_high to rightmost 8 bits
    combined = combined<<8; //shift x_high over to leftmost 8 bits
    combined |= x_low; //logical OR keeps x_high intact in combined and fills in rightmost 8 bits
    
    return combined;
}

void write_socket(TCPClient socket, uint8_t *buffer, int count) {
    socket.write(buffer, count);
}

// http://neyric.com/2006/10/14/decoding-mu-law-audio-stream-to-pcm/#.WAznF4WcH9Q
unsigned short mulaw_decode(unsigned char mulaw) {
  mulaw = ~mulaw;
  int sign = mulaw & 0x80;
  int exponent = (mulaw & 0x70) >> 4;
  int data = mulaw & 0x0f;
  data |= 0x10;
  data <<= 1;
  data += 1;
  data <<= exponent + 2;
  data -= 0x84;
  return (short)(sign == 0 ? data : -data);
}

unsigned short signed_pcm_to_dac(unsigned short pcm) {
    return map(pcm, -2^15, 2^15 -1 , 0, 4095);
}

bool verifyConnected() {
    if (_isDriving) return false;
    
    unsigned int now = millis();
    if ((now - lastClientCheck) > 100) {
        lastClientCheck = now;

        if (client.connected()) {
            _isConnected = true;
        }
        else {
            _isConnected = client.connect(SERVER_HOST, SERVER_PORT);
        }
    }
    
    return _isConnected;
}

