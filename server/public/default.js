var socket = io();

socket.on("connect", function(msg) {
    init();
    document.body.classList.remove('off');
    printSplash();      
});

socket.on("disconnect", function(msg) {
    document.body.classList.add('off');   
    clear(); 
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
        msg = msg.replace(/(.{90})/g, "$1-\n");
        print(msg);      
    }
});

function doCommand(msg) {
    socket.emit('speak', msg);
}

function printSplash() {
    print("Chatbot Shell v0.4 .................................................\n");
    print("\n\n", true);                                                      

    print("github.com/dwcares/originalchatbot\n", true);
    print("@originalchatbot\n\n", true);

    // LOGO CHATBOT v0.4
    // http://patorjk.com/software/taag/#p=display&h=0&f=Standard&t=CHATBOT%20v0.4


    let chatbotLogo = String.raw`` +  
    String.raw`     ____   _   _      _      _____   ____     ___    _____              ___        _  _   ` +`\n` +
    String.raw`    / ___| | | | |    / \    |_   _| | __ )   / _ \  |_   _|   __   __  / _ \      | || |  ` +`\n` +
    String.raw`   | |     | |_| |   / _ \     | |   |  _ \  | | | |   | |     \ \ / / | | | |     | || |_ ` +`\n` +
    String.raw`   | |___  |  _  |  / ___ \    | |   | |_) | | |_| |   | |      \ V /  | |_| |  _  |__   _|` +`\n` +
    String.raw`    \____| |_| |_| /_/   \_\   |_|   |____/   \___/    |_|       \_/    \___/  (_)    |_|  ` +`\n\n\n`
                                                                                                                                                     
    print (chatbotLogo,true) 
    print("\n\n\n", true);                                                      
                                                                             
    print(padCenter("Chatbot® YU-U-ZO® #5404 by Tomy® 1985.", 90), true);
    print("\n\n\n", true);
}