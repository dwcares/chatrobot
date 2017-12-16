(function() {
    var express = require('express');
    var app = express();
    app.use(express.static('public'));
    var http = require('http').Server(app);
    var io = require('socket.io')(http);
    var port = process.env.PORT || 3000;
   
    var events = require("events");
    var EventEmitter = require("events").EventEmitter;
    var ee = new EventEmitter();

    app.get('/', function(req, res) {
        res.sendFile(__dirname + '/public/default.html');   
    });

    var log = function(message, noReturn) {
        if (!noReturn) {
            if (!message.startsWith('*')) console.log(message);		
            message = message + "\n\n";
        }
        io.emit('message', message);				
    }

    io.on('connection', function(socket) {

        ee.emit('connection');

        socket.on('speak', function(msg) {
            ee.emit('speak',msg);
        });

    });

    http.listen(port, function() {
        console.log('Shell listening on *: ' + port);	
    });

    module.exports.log = function(message, noReturn) {
        return log(message, noReturn);
    }

    module.exports.events = ee;

}());

	
