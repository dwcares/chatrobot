/////////////////////////////////////////////
/////////// Bing Speech API /////////////////
/////////////////////////////////////////////

const request = require('request-promise-native');
const uuid = require('uuid');

class Speech {
    constructor() {
        this.accessToken;
        this.accessTokenExpiry;
        this.appid = '68AE0F3ADB0C427B935F34E68C579FBE';
        this.userAgent = 'Chat Robot';
        this.TTSoutputFormat = 'raw-16khz-16bit-mono-pcm';
        this.STTsampleRate = 16000;
    }
    getSpeechAccessToken(key, forceUpdate) {
        if (!key)
            throw new Error("Speech API Error: API Key is required");

        if (!forceUpdate && this.accessToken && this.accessTokenExpiry > Date.now())
            return this.accessToken

        return request.post({
            url: 'https://westus.api.cognitive.microsoft.com/sts/v1.0/issueToken',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-length': 0,
                'Ocp-Apim-Subscription-Key': key
            }
        }).then((accessToken) => {
            this.accessTokenExpiry = Date.now() + 10*60*1000;
            this.accessToken = accessToken;
            return accessToken;
        })
    }
    textToSpeech(text, gender) {
        if (!this.accessToken) 
            throw new Error("Speech API Error:  Needs access token. Call GetAccessToken() first");
       
        if (this.accessTokenExpiry < Date.now())
            throw new Error("Speech API Error:  Access token expired. Call GetAccessToken()");

        var ssmlPayload;

        switch (gender) {
            case 'male':
                ssmlPayload = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-ChristopherNeural">${text}</voice></speak>`;
                break
            case 'female':
            default:
                ssmlPayload = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice style="chat" styledegree="2" name="en-US-JennyNeural">${text}</voice></speak>`;
                break
        }
        return request.post({
            url: 'https://westus.tts.speech.microsoft.com/cognitiveservices/v1',
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

                   
        if (this.accessTokenExpiry < Date.now())
            throw new Error("Speech API Error:  Access token expired. Call GetAccessToken()");

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
