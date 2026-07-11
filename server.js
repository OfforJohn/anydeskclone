const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['polling', 'websocket']
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on("connection", (socket) => {
    console.log(`[CONN] New device connected: ${socket.id}`);

    socket.on("join", (roomId) => {
        socket.join(roomId);
        const clients = io.sockets.adapter.rooms.get(roomId);
        console.log(`[ROOM] ${socket.id} joined ${roomId}. Total peers: ${clients ? clients.size : 0}`);

        // Notify others that a new peer joined (helps trigger offer)
        socket.to(roomId).emit("new-peer", { id: socket.id });
    });

    socket.on("message", (data) => {
        const type = data.offer ? "OFFER" : data.answer ? "ANSWER" : "CANDIDATE";
        console.log(`[MSG] Forwarding ${type} from ${socket.id} to room ${data.roomId}`);

        // Broadcast to everyone else in the room
        socket.to(data.roomId).emit("message", data);
    });

    socket.on("disconnect", () => {
        console.log(`[DISCONN] Device ${socket.id} disconnected`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log("========================================");
    console.log(`Signaling server running on port ${PORT}`);
    console.log(`PC: Open http://localhost:${PORT}`);
    console.log("========================================");
});
