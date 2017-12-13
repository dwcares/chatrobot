#include "SimpleRingBuffer.h"
#include <SparkIntervalTimer.h>
#include <Debounce.h>

#define SERIAL_DEBUG_ON true

#define MOTOR_REVERSE_PIN D1
#define MOTOR_FORWARD_PIN D2
#define DRIVE_UPDATE_FREQ 300
#define PING_SENSOR_DELAY_MS 10

#define TRIG_PIN D4
#define ECHO_PIN D5
#define EYES_LED A4

#define SINGLE_PACKET_MIN 512
#define SINGLE_PACKET_MAX 1024
#define END_PACKET_SIZE 100

#define AUDIO_TIMING_VAL 62 /* 16kHz */
#define PLAYBACK_TIMING_VAL 62

#define VOLUME 0.06

#define MICROPHONE_PIN DAC1
#define AUDIO_BUFFER_MAX 8192
#define RECEIVE_BUFFER_MAX 32*1024

#define BUTTON_PIN D0
#define SPEAKER_PIN A3

#define TONE_PIN WKP


SYSTEM_MODE(SEMI_AUTOMATIC);
SYSTEM_THREAD(ENABLED);

String serverHost =  "192.168.1.1";
int serverPort = 3000;


uint8_t txBuffer[SINGLE_PACKET_MAX + 1];
SimpleRingBuffer audio_buffer;
SimpleRingBuffer recv_buffer;

unsigned long lastSend = millis();

bool eyesBusy = false;
unsigned int eyesVal = 0;
int eyesDir = 1;
unsigned int eyeMax = 200;

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
bool sensorInit = false;

unsigned long lastUpdateDriveTime = millis();
int currentDriveSpeed = 0;
int currentDistance = 0;

unsigned long driveUntilTime = millis();

void setup() {
    #if SERIAL_DEBUG_ON
    Serial.begin(115200);
    #endif

    Particle.function("drive", drive);
    Particle.function("stop", stop);
    Particle.function("setMotor", setMotor);

    Particle.function("updateServer", updateServer);

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
    
    checkWifiConfig();
    
    playTone();
}

void loop() {

    updateRecordAndPlay();
    updateEyes();
    updateDriveDistance();
    
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
            eyeMax = 1500;
            readAndPlay();
        }
    }
}

void checkWifiConfig() {
    debouncer.update();

    if (debouncer.read() == LOW ) {
        digitalWrite(EYES_LED, HIGH);
        WiFi.on();
        WiFi.listen();
    } else {
        Particle.connect();
        eyeMax = 800;
        
        // loadStateFromEEPROM();

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

int updateServer(String server) {
    Serial.println("server: " + server);
    int splitIndex = server.indexOf(":");
        Serial.println("index: " + splitIndex);

    String host = "";
    String port = "";
    
    if (splitIndex >= 0) {
        host = server.substring(0, splitIndex);
        port = server.substring(splitIndex + 1);
    } else {
        host = server;
        port = "80";
    }
    
    serverHost = host;
    serverPort = port.toInt();
    
    //saveStateToEEPROM();
   return 0;
}

void loadStateFromEEPROM () {
     
    EEPROM.get(0, serverPort);
    if(serverPort == 0) {
      serverPort = 80;
    }
    
    EEPROM.get(40, serverHost);
    if(serverHost == "") {
      serverHost = "192.168.1.99";
    }
    
    Serial.println("State loaded from EEPROM: " + serverHost + ":" + serverPort);
}

void saveStateToEEPROM () {
    EEPROM.put(0, serverPort);
    EEPROM.put(40, serverHost);
    
    Serial.println("State saved to EEPROM: " + serverHost + ":" + serverPort);
}

////////////////// MOTORS AND EYES AND TONES //////////////////

void updateDriveDistance() {
    
    if (_isDriving && millis() > driveUntilTime)  {
        stop("");
        return;
    }
    

    if (_isDriving && millis() > lastUpdateDriveTime + DRIVE_UPDATE_FREQ) {
        
      
        
        uint32_t inchesRAW = measureInches(TRIG_PIN, ECHO_PIN, PING_SENSOR_DELAY_MS);

 
        Serial.println(inchesRAW);

        if (inchesRAW > 20) {
            setMotorSpeed(180);

        } else if (inchesRAW > 12 && currentDriveSpeed >= 0) {
            setMotorSpeed(80);
        } else if (inchesRAW > 12 && currentDriveSpeed < 0) {
            setMotorSpeed(-100);
        }
        else  {
            setMotorSpeed(-80);
        }
          
        lastUpdateDriveTime = millis();
    }

}

int playTone() {
    
    int melody[] = {1908,2551,2551,2273,2551,0,2024,1908}; //C4,G3,G3,A3,G3,0,B3,C4
    int noteDurations[] = {4,8,8,4,4,4,4,4 };
    for (int thisNote = 0; thisNote < 8; thisNote++) {

        // to calculate the note duration, take one second
        // divided by the note type.
        //e.g. quarter note = 1000 / 4, eighth note = 1000/8, etc.
        int noteDuration = 1000/noteDurations[thisNote];
        tone(TONE_PIN, melody[thisNote],noteDuration);
    
        // to distinguish the notes, set a minimum time between them.
        // the note's duration + 30% seems to work well:
        int pauseBetweenNotes = noteDuration * 1.30;
        delay(pauseBetweenNotes);
        // stop the tone playing:
        noTone(TONE_PIN);
    }

}

int drive(String args) {
    _isDriving = true;
    driveUntilTime = args.toInt()*1000 + millis();
    
    return 1;
}

int stop(String args) {
    _isDriving = false;

    setMotorSpeed(0);
    
    playTone();

    return 1;
}


int setMotor(String speed) {
    setMotorSpeed(speed.toInt());
    return 1;
}


void setMotorSpeed(int speed) {

    if (speed == currentDriveSpeed) return; 
    
    if (speed > 0) {
        analogWrite(MOTOR_FORWARD_PIN, 255 - speed);
        digitalWrite(MOTOR_REVERSE_PIN, HIGH);
    } else if (speed < 0) {
      analogWrite(MOTOR_REVERSE_PIN, 255 + speed);
      digitalWrite(MOTOR_FORWARD_PIN, HIGH);
    } else {
        digitalWrite(MOTOR_FORWARD_PIN, HIGH);
        digitalWrite(MOTOR_REVERSE_PIN, HIGH);
    }
    
    currentDriveSpeed = speed;
}

void updateEyes() {
    if (_isRecording || _isPlayback || _isDriving) {
        digitalWrite(EYES_LED, HIGH);
    } else {
        if (eyesVal > eyeMax) {
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
        //value*=20;
        value = map(value, 0,  255, 0, 4095);

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
    if ((now - lastClientCheck) > 2000) {
        lastClientCheck = now;

        if (client.connected()) {
            _isConnected = true;
        }
        else {
            _isConnected = client.connect(serverHost, serverPort);
        }
    }
    
    return _isConnected;
}

