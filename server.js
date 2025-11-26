const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// The "Blind Relay" Logic
io.on('connection', (socket) => {
  // User joins a specific room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    // Notify others in room (optional, good for debugging)
    // socket.to(roomId).emit('user-connected'); 
  });

  // Relay the ENCRYPTED message
  // server sees: { room: '123', content: '8f9s8d9f8s...' }
  socket.on('chat-message', ({ roomId, encryptedData, iv }) => {
    // Broadcast to everyone else in that room
    socket.to(roomId).emit('receive-message', { encryptedData, iv });
  });

  socket.on('disconnect', () => {
    // Socket.io handles leaving rooms automatically
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
