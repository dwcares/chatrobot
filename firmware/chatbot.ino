#include <MelodySpeaker.h>
#include "SimpleRingBuffer.h"
#include <SparkIntervalTimer.h>
#include <Debounce.h>

#define SERIAL_DEBUG_ON true

#define MOTOR_FORWARD_PIN D1
#define MOTOR_REVERSE_PIN D2
#define DRIVE_UPDATE_FREQ 300
#define PING_SENSOR_DELAY_MS 10

#define EYES_LED A4
#define EYES_SERVO D0
#define TRIG_PIN D4
#define ECHO_PIN D5

#define SINGLE_PACKET_MIN 512
#define SINGLE_PACKET_MAX 1024
#define END_PACKET_SIZE 100

#define AUDIO_TIMING_VAL 62 /* 16kHz */
#define PLAYBACK_TIMING_VAL 62

#define MICROPHONE_PIN DAC1
#define AUDIO_BUFFER_MAX 8192
#define RECEIVE_BUFFER_MAX 32*1024

#define BUTTON_PIN D3
#define SPEAKER_PIN A3

#define TONE_PIN WKP
#define DEFAULT_TEMPO 240


SYSTEM_MODE(SEMI_AUTOMATIC);
SYSTEM_THREAD(ENABLED);

String serverHost =  "192.168.1.1";
int serverPort = 3030;

MelodySpeaker melodySpeaker = MelodySpeaker(TONE_PIN, false);

uint8_t txBuffer[SINGLE_PACKET_MAX + 1];
SimpleRingBuffer audio_buffer;
SimpleRingBuffer recv_buffer;

unsigned long lastSend = millis();

bool eyesBusy = false;
unsigned int eyesVal = 0;
int eyesDir = 1;
unsigned int eyeMax = 200;
Servo eyesServo;


TCPClient client;
IntervalTimer readMicTimer;

int _sendBufferLength = 0;
unsigned int lastPublished = 0;

bool _isRecording = false;
bool _isPlayback = false;
bool _isDriving = false;

bool _isConnected = false;
int lastClientCheck;

Debounce debouncer = Debounce(); 
bool sensorInit = false;

unsigned long lastUpdateDriveTime = millis();
int currentDriveSpeed = 0;
int currentDistance = 0;

unsigned long driveUntilTime = millis();
unsigned long eyesServoUntilTime = millis();

void setup() {
    #if SERIAL_DEBUG_ON
    Serial.begin(115200);
    #endif

    Particle.function("drive", drive);
    Particle.function("stop", stop);
    Particle.function("setMotor", setMotor);
    Particle.function("eyesSpin" , eyesSpin);
    Particle.function("playTone", playTone);
    Particle.function("updateServer", updateServer);
    

    pinMode(MICROPHONE_PIN, INPUT);
    pinMode(SPEAKER_PIN, OUTPUT);
    pinMode(EYES_LED, OUTPUT);

    pinMode(MOTOR_REVERSE_PIN, OUTPUT);
    pinMode(MOTOR_FORWARD_PIN, OUTPUT);
    setMotorSpeed(0);
    
    eyesServo.attach(EYES_SERVO);
    eyesServo.write(0);  

    
    setADCSampleTime(ADC_SampleTime_3Cycles);
    recv_buffer.init(RECEIVE_BUFFER_MAX);
    audio_buffer.init(AUDIO_BUFFER_MAX);
    
    debouncer.attach(BUTTON_PIN, INPUT_PULLUP);
    debouncer.interval(20);
    
    checkWifiConfig();
    
    melodySpeaker.begin();
    melodySpeaker.setTempo(DEFAULT_TEMPO);

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
    melodySpeaker.processMelody();

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

        loadStateFromEEPROM();
    }
}

int updateServer(String server) {
    Serial.println("server: " + server);
    int splitIndex = server.indexOf(":");

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
    
    saveStateToEEPROM();
   return 0;
}

void loadStateFromEEPROM () {
    char serverHostBuf[20];
     
    EEPROM.get(0, serverPort);
    if(serverPort == 0) {
      serverPort = 80;
    }
    
    EEPROM.get(40, serverHostBuf);
    serverHost = serverHostBuf;
    
    Serial.print("Loaded host from EEPROM: ");
    Serial.print(serverHost);
    Serial.print(":");
    Serial.println(serverPort);
}

void saveStateToEEPROM () {
    EEPROM.clear();
    
    char serverHostBuf[20];
    serverHost.toCharArray(serverHostBuf, 20);
    EEPROM.put(0, serverPort);
    EEPROM.put(40, serverHostBuf);
    
    Serial.print("Saved host to EEPROM: ");
    Serial.print(serverHost);
    Serial.print(":");
    Serial.println(serverPort);
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

int playTone(String args) {
    int tempoIndex = args.lastIndexOf(';');
    
    if (tempoIndex > 0) {
        String tempo = args.substring(tempoIndex);
        int tempoVal = tempo.toInt();
        
        if (tempoVal > 0) {
            melodySpeaker.setTempo(tempoVal);
        }
     
        args = args.substring(0, tempoIndex);
    } else {
        melodySpeaker.setTempo(DEFAULT_TEMPO);
    }
    
    melodySpeaker.setMelody(const_cast<char*>(args.c_str()));
    return 1;
}

int drive(String args) {
    _isDriving = true;
    driveUntilTime = args.toInt()*1000 + millis();
    
    return 1;
}

int stop(String args) {
    _isDriving = false;

    setMotorSpeed(0);
    

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
       
         if (millis() > eyesServoUntilTime)  {
          eyesServo.write(0);  
        }
    }
}

int eyesSpin(String args) {
    
     int speedIndex = args.lastIndexOf(';');
     int speedVal = 10;
    
    if (speedIndex > 0) {
        String speedStr = args.substring(speedIndex + 1);
        speedVal = speedStr.toInt();

        args = args.substring(0, speedIndex);
    }

    eyesServoUntilTime = args.toInt()*1000 + millis();
    eyesServo.write(speedVal);  

    return 1;
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
        playTone("8b4");
        _isRecording = true;
        readMicTimer.begin(readMic, AUDIO_TIMING_VAL, uSec);
    }
}

void stopRecording() {
    if (_isRecording) {
        playTone("8b3");
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
        value = map(value, 50,  255, 0, 4095);

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