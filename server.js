const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { spawn } = require('child_process');

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

// --- AUTOMATIC AI CLIENT SPAWNER (Improved) ---
function startAIClient() {
    console.log("[AI] Starting Python AI Client automatically...");

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    // RENDER FIX: Use 127.0.0.1 and the dynamic PORT assigned by Render
    const serverUrl = `http://127.0.0.1:${PORT}`;

    console.log(`[AI] Spawning Python client pointing to: ${serverUrl}`);

    // Improved spawning logic for better reliability on VPS
    const pythonProcess = spawn(pythonCmd, [
        path.join(__dirname, 'meo_ai_client.py'),
        serverUrl
    ], {
        cwd: __dirname,
        env: process.env
    });

    pythonProcess.stdout.on('data', (data) => {
        console.log(`[AI-PYTHON] ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[AI-ERROR] ${data.toString().trim()}`);
    });

    pythonProcess.on('error', (err) => {
        console.error("[AI-SPAWN-ERROR]", err);
    });

    pythonProcess.on('close', (code) => {
        console.log(`[AI] Python client exited with code ${code}. Restarting in 5s...`);
        setTimeout(startAIClient, 5000);
    });
}
// ------------------------------------

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on("connection", (socket) => {
    socket.on("join", (roomId) => {
        socket.join(roomId);
        console.log(`[ROOM] ${socket.id} joined ${roomId}`);
        socket.to(roomId).emit("new-peer", { id: socket.id });
    });

    socket.on("message", (data) => {
        socket.to(data.roomId).emit("message", data);
    });

    // New: Broadcast click events to Python AI Client
    socket.on("device_click", (data) => {
        const roomId = data.roomId || Array.from(socket.rooms).find(r => r !== socket.id);

        const clickPayload = { ...data, roomId: roomId };

        // 1. Send to other peers in the same room
        socket.to(roomId).emit("device_click_broadcast", clickPayload);

        // 2. Broadcast to AI Room
        const aiRoomSize = io.sockets.adapter.rooms.get("ai-room")?.size || 0;
        console.log(`[DEBUG] Click in ${roomId}. Broadcasting to ${aiRoomSize} AI clients.`);

        io.to("ai-room").emit("device_click_broadcast", clickPayload);
    });

    // New: Handle AI responses and broadcast to web UI
    socket.on("ai_key_guess", (data) => {
        console.log(`[DEBUG] AI Guess in room ${data.roomId}: ${data.guessed_key}`);
        // Send the AI guess back to the specific room that generated the click
        if (data.roomId) {
            io.to(data.roomId).emit("ai_key_guess_broadcast", data);
        }
    });

    socket.on("unlock_event", (data) => {
        console.log(`[DEBUG] Unlock event in room ${data.roomId}`);
        io.to("ai-room").emit("device_unlock_broadcast", data);
    });

    socket.on("disconnect", (reason) => {
        console.log(`[DISCONN] Device ${socket.id} disconnected.`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log("========================================");
    console.log(`Signaling server running on port ${PORT}`);
    console.log("========================================");

    // Start AI automatically when server is ready
    startAIClient();
});
