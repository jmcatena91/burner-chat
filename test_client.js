const io = require("socket.io-client");
const assert = require("assert");

const socket1 = io("http://localhost:3000");
const socket2 = io("http://localhost:3000");

const roomId = "test-room";
const user1 = "Alice";
const user2 = "Bob";

console.log("Starting tests...");

socket1.on("connect", () => {
    console.log("Socket 1 connected");
    socket1.emit("join-room", { roomId, username: user1 });
});

socket2.on("connect", () => {
    console.log("Socket 2 connected");
    socket2.emit("join-room", { roomId, username: user2 });
});

let user1Joined = false;
let user2Joined = false;
let messageReceived = false;
let typingReceived = false;

socket1.on("user-connected", (username) => {
    if (username === user2) {
        console.log("PASS: Socket 1 saw Bob join");
        user2Joined = true;
        checkDone();
    }
});

socket2.on("user-connected", (username) => {
    if (username === user1) {
        console.log("PASS: Socket 2 saw Alice join");
        user1Joined = true;
        // Now Bob types
        socket2.emit("typing", { roomId, username: user2 });
    }
});

socket1.on("user-typing", (username) => {
    if (username === user2) {
        console.log("PASS: Socket 1 saw Bob typing");
        typingReceived = true;
        // Now Bob sends a message
        socket2.emit("chat-message", {
            roomId,
            encryptedData: [1, 2, 3], // Dummy data
            iv: [4, 5, 6],
            username: user2
        });
    }
});

socket1.on("receive-message", (data) => {
    if (data.senderName === user2) {
        console.log("PASS: Socket 1 received message from Bob");
        messageReceived = true;
        checkDone();
    }
});

function checkDone() {
    if (user1Joined && user2Joined && messageReceived && typingReceived) {
        console.log("ALL TESTS PASSED");
        process.exit(0);
    }
}

setTimeout(() => {
    console.error("TIMEOUT: Tests failed to complete");
    process.exit(1);
}, 5000);
