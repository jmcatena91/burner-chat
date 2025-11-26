const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
// Serve static files from the 'public' directory
app.use(express.static('public'));
app.use('/libs/marked', express.static(__dirname + '/node_modules/marked'));
app.use('/libs/highlight.js', express.static(__dirname + '/node_modules/highlight.js'));
app.use('/libs/dompurify', express.static(__dirname + '/node_modules/dompurify'));

// Store room users: { roomId: { socketId: username } }
const roomUsers = {};
// Store room passwords: { roomId: passwordHash }
const roomPasswords = {};

io.on('connection', (socket) => {

  socket.on('join-room', ({ roomId, username, password }) => {
    // Check if room exists
    if (roomUsers[roomId]) {
      // Room exists, check password
      if (roomPasswords[roomId] && roomPasswords[roomId] !== password) {
        socket.emit('error-message', 'Incorrect password');
        return;
      }
    } else {
      // Room doesn't exist, create it and set password if provided
      if (password) {
        roomPasswords[roomId] = password;
      }
    }

    socket.join(roomId);

    // Store user info
    if (!roomUsers[roomId]) roomUsers[roomId] = {};
    roomUsers[roomId][socket.id] = { username, isSharing: false, id: socket.id };

    // Notify others
    socket.to(roomId).emit('user-connected', { username, id: socket.id });

    // Update user list for everyone in room
    io.to(roomId).emit('room-users', Object.values(roomUsers[roomId]));
  });

  socket.on('start-screen-share', (roomId) => {
    if (roomUsers[roomId] && roomUsers[roomId][socket.id]) {
      roomUsers[roomId][socket.id].isSharing = true;
      io.to(roomId).emit('room-users', Object.values(roomUsers[roomId]));
    }
  });

  socket.on('stop-screen-share', (roomId) => {
    if (roomUsers[roomId] && roomUsers[roomId][socket.id]) {
      roomUsers[roomId][socket.id].isSharing = false;
      io.to(roomId).emit('room-users', Object.values(roomUsers[roomId]));
    }
  });

  socket.on('chat-message', ({ roomId, encryptedData, iv, username }) => {
    // Broadcast to everyone else in that room
    socket.to(roomId).emit('receive-message', {
      encryptedData,
      iv,
      senderName: username,
      senderId: socket.id,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('signal', ({ roomId, signalData, target }) => {
    // Relay signal to specific target or broadcast
    if (target) {
      io.to(target).emit('signal', { signalData, sender: socket.id });
    } else {
      socket.to(roomId).emit('signal', { signalData, sender: socket.id });
    }
  });

  socket.on('typing', ({ roomId, username }) => {
    socket.to(roomId).emit('user-typing', username);
  });

  socket.on('stop-typing', (roomId) => {
    socket.to(roomId).emit('user-stop-typing');
  });

  socket.on('disconnecting', () => {
    // Check which rooms the user was in
    for (const roomId of socket.rooms) {
      if (roomUsers[roomId] && roomUsers[roomId][socket.id]) {
        const { username } = roomUsers[roomId][socket.id];

        // Notify others
        socket.to(roomId).emit('user-disconnected', { username, id: socket.id });

        // Remove user
        delete roomUsers[roomId][socket.id];
        if (Object.keys(roomUsers[roomId]).length === 0) {
          delete roomUsers[roomId];
        } else {
          // Update user list
          io.to(roomId).emit('room-users', Object.values(roomUsers[roomId]));
        }
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
