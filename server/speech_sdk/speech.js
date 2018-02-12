/////////////////////////////////////////////
/////////// Bing Speech API /////////////////
/////////////////////////////////////////////

const request = require('request-promise-native');
const uuid = require('uuid');

class Speech {
    constructor() {
        this.accessToken;
        this.appid = '68AE0F3ADB0C427B935F34E68C579FBE';
        this.userAgent = 'Chat Robot';
        this.TTSoutputFormat = 'raw-16khz-16bit-mono-pcm';
        this.STTsampleRate = 16000;
    }
    getSpeechAccessToken(key) {
        if (!key)
            throw new Error("Speech API Error: API Key is required");

        return request.post({
            url: 'https://api.cognitive.microsoft.com/sts/v1.0/issueToken',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-length': 0,
                'Ocp-Apim-Subscription-Key': key
            }
        }).then((accessToken) => {
            this.accessToken = accessToken;
            return accessToken;
        })
    }
    textToSpeech(text, gender) {
        if (!this.accessToken)
            throw new Error("Speech API Error:  Needs access token. Call GetAccessToken() first");

        var ssmlPayload;

        switch (gender) {
            case 'male':
                ssmlPayload = "<speak version='1.0' xml:lang='en-us'><voice xml:lang='en-US' xml:gender='Male' name='Microsoft Server Speech Text to Speech Voice (en-US, BenjaminRUS)'>" + text + "</voice></speak>"
                break
            case 'female':
            default:
                ssmlPayload = "<speak version='1.0' xml:lang='en-us'><voice xml:lang='en-US' xml:gender='Female' name='Microsoft Server Speech Text to Speech Voice (en-US, ZiraRUS)'>" + text + "</voice></speak>";
                break
        }

        return request.post({
            url: 'https://speech.platform.bing.com/synthesize',
            body: ssmlPayload,
            encoding: null,
            headers: {
                'Authorization': 'Bearer ' + this.accessToken,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': this.TTSoutputFormat,
                'X-Search-AppId': this.appid,
                'X-Search-ClientID': this.appid,
                'User-Agent': this.userAgent
            }
        });
    }
    speechToText(waveData, verboseOutput) {
        if (!this.accessToken)
            throw new Error("Speech API Error:  Needs access token. Call GetAccessToken() first");

        return request.post({
            url: 'https://speech.platform.bing.com/recognize',
            qs: {
                'scenarios': 'ulm',
                'appid': 'D4D52672-91D7-4C74-8AD8-42B1D98141A5', // This magic value is required
                'locale': 'en-US',
                'device.os': 'wp7',
                'version': '3.0',
                'format': 'json',
                'requestid': uuid.v4(),
                'instanceid': 'f7370be0-c9b3-46a6-bf6e-a7f6049a1aba'
            },
            body: waveData,
            headers: {
                'Authorization': 'Bearer ' + this.accessToken,
                'Content-Type': 'audio/wav; samplerate=' + this.STTsampleRate + '; sourcerate=' + this.STTsampleRate,
                'Content-Length': waveData.length
            }
        }).then((result) => {
            let recognizedText
            result = JSON.parse(result)

            if (result.header.status === 'success') {
                recognizedText = verboseOutput ? result :
                    result.header.name
            }

            return recognizedText
        })

    }
}

module.exports = Speech;
