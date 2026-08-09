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
    // ULTIMATE DEBUG: Log every single event arriving at the server
    socket.onAny((eventName, ...args) => {
        console.log(`[EVENT] From ${socket.id}: ${eventName}`, args);
    });

    socket.on("join", (roomId) => {
        socket.join(roomId);
        console.log(`[ROOM] ${socket.id} joined ${roomId}`);
        socket.to(roomId).emit("new-peer", { id: socket.id });
    });

    socket.on("message", (data) => {
        // If the Android app sends a device_click via the message channel (signaling)
        if (data && data.type === "device_click") {
            const roomId = data.roomId;
            const clickPayload = { ...data, source: "Device Tap" };
            console.log(`[DEBUG] Signaling click to AI for room: ${roomId}`);
            io.in(roomId).emit("device_click_broadcast", clickPayload);
            io.in("ai-room").emit("device_click_broadcast", clickPayload);
        }
        socket.to(data.roomId).emit("message", data);
    });

    // New: Broadcast click events to Python AI Client
    socket.on("device_click", (data) => {
        const roomId = data.roomId || "global";

        const clickPayload = {
            ...data,
            roomId: roomId,
            source: data.source || "Physical Touch"
        };

        // 1. Send to laptop browser specifically
        io.to(roomId).emit("device_click_broadcast", clickPayload);

        // 2. ULTIMATE FIX: Broadcast to EVERYONE in ai-room (The AI)
        io.emit("device_click_broadcast", clickPayload);

        console.log(`[AI-ROUTING] Shout click from ${roomId} to all listeners.`);
    });

    // New: Handle AI responses and broadcast to web UI
    socket.on("ai_key_guess", (data) => {
        // ULTIMATE FIX: Shout the guess to EVERY connected browser
        // This bypasses all Room ID mismatch issues
        io.emit("ai_key_guess_broadcast", data);

        console.log(`[AI-ROUTING] Shout guess '${data.guessed_key}' to all browsers.`);
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

// Health check for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log("========================================");
    console.log(`Signaling server running on port ${PORT}`);
    console.log("========================================");

    // Start AI automatically when server is ready
    startAIClient();
});
