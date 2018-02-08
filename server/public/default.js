var socket = io();

socket.on("connect", function(msg) {
    document.body.classList.remove('off');
});

socket.on("disconnect", function(msg) {
    document.body.classList.add('off');    
});

socket.on("message", function(msg) {
    if (msg.startsWith('*clear')) {
        clear();
    } else if (msg.startsWith('*splash')) {
        clear();      
        printSplash();      
    } else if (msg.startsWith('*prompt')) {
        print('\n> ');
    } else if (msg.startsWith('*reset')) {
        clear();  
    }
    else {
        print(msg, true, 80);      
    }
});

function doCommand(msg) {
    socket.emit('speak', msg);
}

function printSplash() {
    print("Chatbot Shell v0.1 .................................................\n");
    print("\n\n", true);                                                      

    print("github.com/dwcares/originalchatbot\n", true);
    print("@originalchatbot\n\n", true);

    print("  ____   _   _      _      _____   ____     ___    _____              ___        _ \n", true); 
    print(" / ___| | | | |    / \\    |_   _| | __ )   / _ \\  |_   _|   __   __  / _ \\      / |\n", true);
    print("| |     | |_| |   / _ \\     | |   |  _ \\  | | | |   | |     \\ \\ / / | | | |     | |\n", true);
    print("| |___  |  _  |  / ___ \\    | |   | |_) | | |_| |   | |      \\ V /  | |_| |  _  | |\n", true);
    print(" \\____| |_| |_| /_/   \\_\\   |_|   |____/   \\___/    |_|       \\_/    \\___/  (_) |_|\n", true);
    print("\n\n\n", true);                                                      

    print(padCenter("Chatbot® YU-U-ZO® #5404 by Tomy® 1985.", 80), true);
    print("\n", true);
}