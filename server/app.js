var net = require('net');
var request = require('request');
var uuid = require('node-uuid');

var port = process.env.PORT || 3000;

var fs = require("fs");
var samplesLength = 1000;
var sampleRate = 8000;
var audioFileName = "recording.wav";

net.createServer(function(sock) {
	console.log('CONNECTED: ' + sock.remoteAddress +':'+ sock.remotePort);
	var outStream = fs.createWriteStream(audioFileName);

	writeWavHeader(outStream);

	sock.on('data', function(data) {
		try {
			console.log("GOT DATA");
			outStream.write(data);
			console.log("got chunk of " + data.toString('hex'));
		}
		catch (ex) {
			console.error("Er!" + ex);
		}
	});

	setTimeout(function() {
		console.log('Recorded for 10 seconds');
		outStream.end();
		sock.destroy();

		getAccessToken(process.env.MICROSOFT_SPEECH_API_KEY, function(err, token) {
			console.log('Got speech access token');
			speechToText(audioFileName, token, function(err, body) {
				if(err) {
					console.log(err);
				}
				else if (body.header.status === 'success') {
					console.log(body.header.name);
				} else {
					console.log(body.header)
				};
			});
		});
		
	}, 10 * 1000);

	
	// Add a 'close' event handler to this instance of socket
	sock.on('close', function(data) {
		console.log('CLOSED: ' + sock.remoteAddress +' '+ sock.remotePort);
	});

}).listen(port);
console.log('Waiting for TCP client connection on port: ' + port);

var getAccessToken = function(key, callback) {
  request.post({
    url: 'https://api.cognitive.microsoft.com/sts/v1.0/issueToken', 
	headers: {
       'Content-Type': 'application/x-www-form-urlencoded',
		'Content-length': 0, 
		'Ocp-Apim-Subscription-Key': key
      }
  }, function(err, resp, body) {
    if(err) return callback(err);
    try {
      var accessToken = body
	  callback(null, accessToken);
    } catch(e) {
      callback(e);
    }
  });
}

var writeWavHeader = function(outStream) {
	var b = new Buffer(1024);
	b.write('RIFF', 0);
	/* file length */
	b.writeUInt32LE(32 + samplesLength * 2, 4);
	//b.writeUint32LE(0, 4);

	b.write('WAVE', 8);
	/* format chunk identifier */
	b.write('fmt ', 12);

	/* format chunk length */
	b.writeUInt32LE(16, 16);

	/* sample format (raw) */
	b.writeUInt16LE(1, 20);

	/* channel count */
	b.writeUInt16LE(1, 22);

	/* sample rate */
	b.writeUInt32LE(sampleRate, 24);

	/* byte rate (sample rate * block align) */
	b.writeUInt32LE(sampleRate * 2, 28);

	/* block align (channel count * bytes per sample) */
	b.writeUInt16LE(2, 32);

	/* bits per sample */
	b.writeUInt16LE(16, 34);

	/* data chunk identifier */
	b.write('data', 36);

	/* data chunk length */
	//b.writeUInt32LE(40, samplesLength * 2);
	b.writeUInt32LE(0, 40);


	outStream.write(b.slice(0, 50));
};

var speechToText = function (filename, accessToken, callback) {
  fs.readFile(filename, function(err, waveData) {
    if(err) return callback(err);
    request.post({
      url: 'https://speech.platform.bing.com/recognize',
      qs: {
        'scenarios': 'smd',
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
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'audio/wav; samplerate=8000',
        'Content-Length' : waveData.length
      }
    }, function(err, resp, body) {
      if(err) return callback(err);
      try {
        callback(null, JSON.parse(body));
      } catch(e) {
        callback(e);
      }
    });
  });
}


