const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on("connection", (socket) => {
    const transport = socket.conn.transport.name;
    console.log(`[CONN] New device connected: ${socket.id} (Transport: ${transport})`);

    socket.on("join", (roomId) => {
        socket.join(roomId);
        const clients = io.sockets.adapter.rooms.get(roomId);
        const peerCount = clients ? clients.size : 0;
        console.log(`[ROOM] ${socket.id} joined ${roomId}. Total peers now: ${peerCount}`);

        // Notify others that a new peer joined (helps trigger offer)
        socket.to(roomId).emit("new-peer", { id: socket.id });
    });

    socket.on("message", (data) => {
        const type = data.offer ? "OFFER" : data.answer ? "ANSWER" : "CANDIDATE";
        let detail = "";
        if (data.candidate) detail = `(${data.candidate.candidate.substring(0, 40)}...)`;

        console.log(`[MSG] [${data.roomId}] Forwarding ${type} from ${socket.id} ${detail}`);

        // Broadcast to everyone else in the room
        socket.to(data.roomId).emit("message", data);
    });

    socket.on("disconnect", (reason) => {
        console.log(`[DISCONN] Device ${socket.id} disconnected. Reason: ${reason}`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log("========================================");
    console.log(`Signaling server running on port ${PORT}`);
    console.log(`PC: Open http://localhost:${PORT}`);
    console.log("========================================");
});
