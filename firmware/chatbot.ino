#define MICROPHONE_PIN A5
#define AUDIO_BUFFER_MAX 8192

int audioStartIdx = 0, audioEndIdx = 0;
uint16_t audioBuffer[AUDIO_BUFFER_MAX];
uint16_t txBuffer[AUDIO_BUFFER_MAX];

// version without timers
unsigned long lastRead = micros();

TCPClient client;

void setup() {
    Serial.begin(115200);
    pinMode(MICROPHONE_PIN, INPUT);
     
     client.connect("chatrobot.azurewebsites.net");

    lastRead = micros();
}

void loop() {
    
    if (client.connected()) {
        listenAndSend(500);
    }
}

void listenAndSend(int delay) {
    unsigned long startedListening = millis();
    
    while ((millis() - startedListening) < delay) {
        unsigned long time = micros();
        
        if (lastRead > time) {
            // time wrapped?
            //lets just skip a beat for now, whatever.
            lastRead = time;
        }
        
        //125 microseconds is 1/8000th of a second
        if ((time - lastRead) > 125) {
            lastRead = time;
            readMic();
        }
    }
    sendAudio();
}

 
void readMic(void) {
    uint16_t value = analogRead(MICROPHONE_PIN);
    if (audioEndIdx >= AUDIO_BUFFER_MAX) {
        audioEndIdx = 0;
    }
    audioBuffer[audioEndIdx++] = value;
}

void copyAudio(uint16_t *bufferPtr) {
    //if end is after start, read from start->end
    //if end is before start, then we wrapped, read from start->max, 0->end
    
    int endSnapshotIdx = audioEndIdx;
    bool wrapped = endSnapshotIdx < audioStartIdx;
    int endIdx = (wrapped) ? AUDIO_BUFFER_MAX : endSnapshotIdx;
    int c = 0;
    
    for(int i=audioStartIdx;i<endIdx;i++) {
        // do a thing
        bufferPtr[c++] = audioBuffer[i];
    }
    
    if (wrapped) {
        //we have extra
        for(int i=0;i<endSnapshotIdx;i++) {
            // do more of a thing.
            bufferPtr[c++] = audioBuffer[i];
        }
    }
    
    //and we're done.
    audioStartIdx = audioEndIdx;
    
    if (c < AUDIO_BUFFER_MAX) {
        bufferPtr[c] = -1;
    }
}

void sendAudio(void) {
    copyAudio(txBuffer);
    
    int i=0;
    uint16_t val = 0;
        
    if (client.connected()) {
       write_socket(client, txBuffer);
    }
    else {
        while( (val = txBuffer[i++]) < 65535 ) {
            Serial.print(val);
            Serial.print(',');
        }
        Serial.println("DONE");
    }
}

// an audio sample is 16bit, we need to convert it to bytes for sending over the network
void write_socket(TCPClient socket, uint16_t *buffer) {
    int i=0;
    uint16_t val = 0;
    
    int tcpIdx = 0;
    uint8_t tcpBuffer[1024];
    
    while( (val = buffer[i++]) < 65535 ) {
        if ((tcpIdx+1) >= 1024) {
            socket.write(tcpBuffer, tcpIdx);
            tcpIdx = 0;
        }
        
        tcpBuffer[tcpIdx] = val & 0xff;
        tcpBuffer[tcpIdx+1] = (val >> 8);
        tcpIdx += 2;
    }
    
    // any leftovers?
    if (tcpIdx > 0) {
        socket.write(tcpBuffer, tcpIdx);
    }
}

