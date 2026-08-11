// --- RESCUE CONNECTIVITY CONFIG ---
const socket = io(window.location.origin, {
    transports: ['polling', 'websocket'], // Force polling first for maximum stability
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity
});

// On-screen logger to see errors without opening F12
function debugUI(msg, color = "#888") {
    const statusInfo = document.getElementById('status-text');
    if (statusInfo) {
        statusInfo.innerHTML = msg;
        statusInfo.style.color = color;
    }
    console.log(`[DEBUG-UI] ${msg}`);
}

socket.on('connect', () => {
    debugUI("SERVER CONNECTED", "#00ff88");
    console.log("Connected with ID:", socket.id);
});

socket.on('connect_error', (err) => {
    debugUI(`CONN ERROR: ${err.message}`, "#ff4444");
});

let peerConnection;
let dataChannel;

const remoteVideo = document.getElementById('remoteVideo');
const drawCanvas = document.getElementById('draw-overlay');
const drawCtx = drawCanvas.getContext('2d');
const dinoLoader = document.getElementById('dino-loader');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdInput = document.getElementById('roomId');

const pinSimulator = document.getElementById('pin-simulator');
const patternSimulator = document.getElementById('pattern-simulator');
const unlockInput = document.getElementById('unlock-pin');
const confirmBtn = document.getElementById('send-unlock');

let isPatternMode = false;
let isPinMode = false;
let patternPoints = [];

// Make elements draggable and resizable
function makeMovable(element) {
    const header = element.querySelector('.modal-header');
    const resizer = element.querySelector('.resize-handle');

    let isDragging = false;
    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseInt(window.getComputedStyle(element).left);
        startTop = parseInt(window.getComputedStyle(element).top);
        element.style.zIndex = 3000;
        document.querySelectorAll('.simulator-overlay').forEach(el => {
           if(el !== element) el.style.zIndex = 2000;
        });
    });

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = parseInt(window.getComputedStyle(element).width);
        startHeight = parseInt(window.getComputedStyle(element).height);
        e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            element.style.left = (startLeft + dx) + 'px';
            element.style.top = (startTop + dy) + 'px';
            element.style.right = 'auto';
        }
        if (isResizing) {
            const dw = e.clientX - startX;
            const dh = e.clientY - startY;
            element.style.width = Math.max(150, startWidth + dw) + 'px';
            element.style.height = Math.max(150, startHeight + dh) + 'px';
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
    });
}

makeMovable(pinSimulator);
makeMovable(patternSimulator);

// Saved Room ID
const savedRoomId = localStorage.getItem('lastRoomId');
if (savedRoomId) roomIdInput.value = savedRoomId;

function updateStatus(status, isActive) {
    statusText.innerText = status;
    statusDot.className = 'status-dot' + (isActive ? ' active' : '');
    if (isActive) {
        document.getElementById('remote-controls').style.display = 'flex';
        document.getElementById('active-info').style.display = 'block';
    }
}

function toggleUnlockInput() {
    isPinMode = !isPinMode;
    const btn = document.getElementById('unlock-toggle');
    if (isPinMode) {
        pinSimulator.style.display = 'flex';
        unlockInput.style.display = 'block';
        confirmBtn.style.display = 'block';
        btn.classList.add('active-mode');
        btn.innerHTML = '<i class="fas fa-times"></i> Close PIN';
        wakeDevice(); // Also try to wake when opening PIN
    } else {
        pinSimulator.style.display = 'none';
        unlockInput.style.display = 'none';
        confirmBtn.style.display = 'none';
        btn.classList.remove('active-mode');
        btn.innerHTML = '<i class="fas fa-keyboard"></i> PIN';
    }
}

function sendUnlock() {
    const pin = unlockInput.value;
    if (pin && dataChannel?.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'unlock', pin: pin }));
        toggleUnlockInput();
        unlockInput.value = "";
    }
}

function togglePatternMode() {
    isPatternMode = !isPatternMode;
    const btn = document.getElementById('pattern-toggle');
    if (isPatternMode) {
        patternSimulator.style.display = 'flex';
        btn.classList.add('active-mode');
        btn.innerHTML = '<i class="fas fa-fingerprint"></i> DRAW ON SCREEN';

        drawCanvas.width = remoteVideo.clientWidth;
        drawCanvas.height = remoteVideo.clientHeight;
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

        wakeDevice(); // Also try to wake when opening Pattern
    } else {
        patternSimulator.style.display = 'none';
        btn.classList.remove('active-mode');
        btn.innerHTML = '<i class="fas fa-braille"></i> Pattern Mode';
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }
}

let isSecurityOverride = false;

function toggleSecurityOverride() {
    isSecurityOverride = !isSecurityOverride;
    const btn = document.getElementById('security-mode');
    if (isSecurityOverride) {
        btn.classList.add('active-mode');
        btn.innerHTML = '<i class="fas fa-eye"></i> OVERRIDE ON';
        // When override is on, we ensure the video container stays interactive even if stream is blank
        remoteVideo.style.display = 'block';
        remoteVideo.style.background = '#111'; // Dark grey instead of total black
        dinoLoader.style.display = 'none';
    } else {
        btn.classList.remove('active-mode');
        btn.innerHTML = '<i class="fas fa-shield-alt"></i> Security Override';
        if (!remoteVideo.srcObject) {
            remoteVideo.style.display = 'none';
            dinoLoader.style.display = 'flex';
        }
    }
}

function wakeDevice() {
    if (dataChannel?.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'wake' }));
    }
}

function sendTypeText() {
    const input = document.getElementById('remote-type-input');
    const text = input.value;
    if (text && dataChannel?.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'type', text: text }));
        input.value = "";
        debugUI("Text Sent", "#00ff88");
    }
}

// Add Enter key support for typing
document.getElementById('remote-type-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendTypeText();
    }
});

function getCoords(e) {
    const rect = remoteVideo.getBoundingClientRect();
    const videoRatio = remoteVideo.videoWidth / remoteVideo.videoHeight || 1;
    const elementRatio = rect.width / rect.height;
    let actualWidth, actualHeight, offsetX, offsetY;
    if (elementRatio > videoRatio) {
        actualHeight = rect.height; actualWidth = actualHeight * videoRatio;
        offsetX = (rect.width - actualWidth) / 2; offsetY = 0;
    } else {
        actualWidth = rect.width; actualHeight = actualWidth / videoRatio;
        offsetX = 0; offsetY = (rect.height - actualHeight) / 2;
    }
    return {
        x: (e.clientX - rect.left - offsetX) / actualWidth,
        y: (e.clientY - rect.top - offsetY) / actualHeight,
        canvasX: e.clientX - rect.left,
        canvasY: e.clientY - rect.top
    };
}

function showClickEffect(e) {
    const effect = document.createElement('div');
    effect.className = 'click-indicator';
    effect.style.left = e.clientX + 'px';
    effect.style.top = e.clientY + 'px';
    document.body.appendChild(effect);
    setTimeout(() => effect.remove(), 500);
}

let isMouseDown = false;
let startX, startY, startTime;

remoteVideo.addEventListener('mousedown', (e) => {
    if (remoteVideo.style.display === 'none') return;
    showClickEffect(e);
    isMouseDown = true;
    const coords = getCoords(e);
    startX = coords.x; startY = coords.y; startTime = Date.now();

    if (isPatternMode) {
        patternPoints = [{ x: coords.x, y: coords.y }];
        drawCtx.beginPath();
        drawCtx.lineWidth = 4;
        drawCtx.strokeStyle = "#00ff88";
        drawCtx.moveTo(coords.canvasX, coords.canvasY);
    }
    e.preventDefault();
});

remoteVideo.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    const coords = getCoords(e);
    if (isPatternMode) {
        patternPoints.push({ x: coords.x, y: coords.y });
        drawCtx.lineTo(coords.canvasX, coords.canvasY);
        drawCtx.stroke();
    }
});

remoteVideo.addEventListener('mouseup', (e) => {
    if (!isMouseDown) return;
    isMouseDown = false;
    const coords = getCoords(e);
    const duration = Date.now() - startTime;
    const dist = Math.sqrt(Math.pow(coords.x - startX, 2) + Math.pow(coords.y - startY, 2));

    if (dataChannel?.readyState === 'open') {
        if (isPatternMode && patternPoints.length > 5) {
            const clickId = Date.now();
            dataChannel.send(JSON.stringify({ type: 'unlock', points: patternPoints }));

            // Log the pattern attempt locally
            displayCoordinates(startX, startY, "Pattern Attempt");

            // Send to AI for pattern analysis
            if (socket && socket.connected) {
                const roomId = roomIdInput.value || localStorage.getItem('lastRoomId');
                socket.emit("unlock_event", {
                    roomId: roomId,
                    points: patternPoints,
                    clickId: clickId
                });
            }

            setTimeout(togglePatternMode, 1000);
        } else if (dist < 0.01) {
            dataChannel.send(JSON.stringify({ type: 'click', x: startX, y: startY }));
        } else {
            dataChannel.send(JSON.stringify({
                type: 'swipe', x1: startX, y1: startY,
                x2: coords.x, y2: coords.y, duration: Math.max(duration, 100)
            }));
        }
    }
});

remoteVideo.addEventListener('mouseleave', () => { isMouseDown = false; });

function startSharing() {
    const roomId = roomIdInput.value;
    if (!roomId) return;
    localStorage.setItem('lastRoomId', roomId);
    document.getElementById('setup-screen').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('active-info').style.display = 'block';
        document.getElementById('display-room-id').innerText = roomId;
        dinoLoader.style.display = 'flex';
    }, 300);
    socket.emit("join", roomId);
    updateStatus("Connecting...", false);
    createPeerConnection(roomId);
}

function refreshConnection() {
    const roomId = roomIdInput.value || localStorage.getItem('lastRoomId');
    if (!roomId) return;
    updateStatus("Refreshing...", false);
    if (peerConnection) peerConnection.close();
    peerConnection = null;
    dataChannel = null;
    remoteVideo.style.display = 'none';
    dinoLoader.style.display = 'flex';
    socket.emit("join", roomId);
    createPeerConnection(roomId);
}

async function createPeerConnection(roomId) {
    if (peerConnection) return;
    const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    peerConnection = new RTCPeerConnection(config);
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        dataChannel.onopen = () => updateStatus("Live Control", true);

        // Handle messages from device
        dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log("DataChannel Message:", data);

                // RESCUE: Ensure phone clicks are SENT TO SERVER
                if (data.type === 'device_click' || data.type === 'click_feedback') {
                    const rid = roomIdInput.value || localStorage.getItem('lastRoomId');
                    socket.emit("device_click", {
                        roomId: rid,
                        x: data.x,
                        y: data.y,
                        label: data.label || "Device Touch",
                        clickId: Date.now()
                    });
                    debugUI(`Tap Sent to AI: ${rid}`, "#ffaa00");
                }

                if (data.type === 'click_feedback') {
                    displayCoordinates(data.x, data.y, "Laptop Tap");
                } else if (data.type === 'device_click') {
                    displayCoordinates(data.x, data.y, data.label || "Device Tap");
                }
            } catch (e) {
                console.error("Error parsing data channel message", e);
            }
        };
    };
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
        remoteVideo.style.display = 'block';
        dinoLoader.style.display = 'none';
    };
    const offer = await peerConnection.createOffer({ offerToReceiveVideo: true });
    await peerConnection.setLocalDescription(offer);
    socket.emit("message", { roomId, offer });
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) socket.emit("message", { roomId, candidate: event.candidate });
    };
}

function toggleMainPanel() {
    const panel = document.getElementById('main-actions-panel');
    const btn = document.getElementById('panel-toggle');
    const icon = btn.querySelector('i');

    panel.classList.toggle('expanded');
    btn.classList.toggle('active');

    if (panel.classList.contains('expanded')) {
        icon.className = 'fas fa-chevron-right';
    } else {
        icon.className = 'fas fa-chevron-left';
    }
}

let clickCount = 0;

function displayCoordinates(x, y, source = "Tap") {
    clickCount++;

    // Send click to server for Python AI tracking
    const clickId = Date.now();
    if (socket && socket.connected) {
        const roomId = roomIdInput.value || localStorage.getItem('lastRoomId');
        console.log(`[SOCKET] Sending click to AI. Room: ${roomId}, State: Connected`);
        socket.emit("device_click", {
            roomId: roomId,
            x: x,
            y: y,
            label: source.includes("Device") ? "Physical Touch" : "Laptop Click",
            source: source,
            clickId: clickId
        });
    } else {
        console.error("[SOCKET] NOT CONNECTED. Cannot send click to AI.");
    }

    const logContent = document.getElementById('click-log-content');

    // Remove placeholder if it's the first click
    if (clickCount === 1) logContent.innerHTML = '';

    const xPct = (x * 100).toFixed(1);
    const yPct = (y * 100).toFixed(1);

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.setAttribute('data-click-id', clickId);
    if (source.includes("Device")) {
        entry.style.borderLeft = "2px solid #ff4d6d"; // Red for device clicks
    }

    entry.innerHTML = `
        <span><b>${getOrdinal(clickCount)}</b> ${source}:</span>
        <span>${xPct}%, ${yPct}%</span>
    `;

    logContent.insertBefore(entry, logContent.firstChild);

    // Also update the small badge at the top
    const coordInfo = document.getElementById('coord-info');
    coordInfo.innerText = `${source}: ${xPct}%, ${yPct}%`;
    coordInfo.style.display = 'block';
}

// --- Interceptor: guess nearest known UI target for any click ---
const knownTargets = [
    { name: 'Navigation Home', x: 0.499, y: 0.972 },
    { name: 'Play Store', x: 0.151, y: 0.733 },
    { name: 'Gallery', x: 0.616, y: 0.732 },
    { name: 'Discord', x: 0.849, y: 0.733 },
    { name: 'Back', x: 0.78, y: 0.972 },
    { name: 'Settings', x: 0.284, y: 0.738 },
    { name: 'Recents', x: 0.219, y: 0.972 },
    { name: 'Binance', x: 0.5, y: 0.423 }
];

function interceptLabel(x, y) {
    // x,y are normalized 0..1
    const pctX = x * 100;
    const pctY = y * 100;
    let best = null;
    let bestDist = Infinity;
    for (const t of knownTargets) {
        const dx = (t.x * 100) - pctX;
        const dy = (t.y * 100) - pctY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < bestDist) { bestDist = dist; best = t; }
    }
    // Accept guess if within 6% absolute distance (tunable)
    if (best && bestDist <= 6.0) return { label: best.name, distance: bestDist };
    return null;
}

// Patch displayCoordinates to also run interceptor and annotate entries
const _origDisplayCoordinates = displayCoordinates;
displayCoordinates = function(x, y, source = "Tap") {
    // Run original behavior first
    _origDisplayCoordinates(x, y, source);

    try {
        const guess = interceptLabel(x, y);
        if (guess) {
            const logContent = document.getElementById('click-log-content');
            // Find most recent entry (first child)
            const first = logContent.firstChild;
            if (first && first.classList && first.classList.contains('log-entry')) {
                // Append intercept label if not already present
                if (!first.innerHTML.includes('(INTERCEPT:')) {
                    const badge = ` <span style="color:#00aaff; font-size:0.75rem; font-weight:bold;">(INTERCEPT: ${guess.label})</span>`;
                    const span = first.querySelector('span:first-child');
                    if (span) span.innerHTML += badge;
                }
            }

            // Optionally notify server about the guessed label so AI can learn
            if (socket && socket.connected) {
                socket.emit('ai_key_guess', { guessed_key: guess.label, x: x, y: y, clickId: Date.now() });
            }
        }
    } catch (e) {
        console.error('Interceptor error', e);
    }
};

function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"],
          v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function clearClickLog() {
    clickCount = 0;
    document.getElementById('click-log-content').innerHTML =
        '<div style="color: #666; font-style: italic; text-align: center; padding: 10px;">Waiting for taps...</div>';
    document.getElementById('coord-info').style.display = 'none';
}

// Hotspot: emit fixed Navigation Home coordinates when clicked
try {
    const navHotspot = document.getElementById('hotspot-nav-home');
    if (navHotspot) {
        navHotspot.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // Fixed normalized coordinates for Navigation Home (from spec)
            const x = 0.499; // 49.9%
            const y = 0.972; // 97.2%

            // Local visual + log
            displayCoordinates(x, y, "Navigation Home");

            // Send to server for AI routing
            if (socket && socket.connected) {
                const roomId = roomIdInput.value || localStorage.getItem('lastRoomId');
                socket.emit('device_click', {
                    roomId: roomId,
                    x: x,
                    y: y,
                    label: 'Navigation Home',
                    source: 'Hotspot',
                    clickId: Date.now()
                });
            } else {
                console.warn('Socket not connected; hotspot click not emitted');
            }
        });
    }
} catch (e) {
    console.error('Error attaching hotspot listener', e);
}

socket.on("message", async (data) => {
    if (data.offer) {
        if (!peerConnection) await createPeerConnection(data.roomId);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit("message", { roomId: data.roomId, answer });
    } else if (data.answer) {
        if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate && peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

// Listen for AI feedback from Python
socket.on("ai_key_guess_broadcast", (data) => {
    console.log("AI Guess Received:", data);

    // Visual indicator that AI is working
    const statusText = document.getElementById('status-text');
    const originalText = statusText.innerText;
    statusText.innerText = `AI: ${data.guessed_key}`;
    statusText.style.color = "#ffaa00";
    setTimeout(() => {
        statusText.innerText = originalText;
        statusText.style.color = "";
    }, 1000);

    const logContent = document.getElementById('click-log-content');

    // 1. Try to match by clickId (Most Reliable)
    if (data.clickId) {
        const matchedEntry = logContent.querySelector(`.log-entry[data-click-id="${data.clickId}"]`);
        if (matchedEntry) {
            const labelSpan = matchedEntry.querySelector('span:first-child');
            if (labelSpan && !labelSpan.innerHTML.includes('(AI:')) {
                labelSpan.innerHTML += ` <span style="color:#ffaa00; font-size:0.65rem; font-weight:bold;">(AI: ${data.guessed_key})</span>`;
                return;
            }
        }
    }

    // 2. Fallback: Search all entries for coordinate match (Fuzzy Match)
    const entries = logContent.querySelectorAll('.log-entry');
    for (let entry of entries) {
        const entryText = entry.innerText || entry.textContent;
        // Parse percentages from entry text (e.g., "50.3%, 79.9%")
        const matches = entryText.match(/(\d+\.\d+)%,\s+(\d+\.\d+)%/);
        if (matches) {
            const entryX = parseFloat(matches[1]);
            const entryY = parseFloat(matches[2]);
            const aiX = data.x * 100;
            const aiY = data.y * 100;

            // Allow 1.5% tolerance for rounding differences on Render
            if (Math.abs(entryX - aiX) < 1.5 && Math.abs(entryY - aiY) < 1.5) {
                const labelSpan = entry.querySelector('span:first-child');
                if (labelSpan && !labelSpan.innerHTML.includes('(AI:')) {
                    labelSpan.innerHTML += ` <span style="color:#ffaa00; font-size:0.65rem; font-weight:bold;">(AI: ${data.guessed_key})</span>`;
                    break;
                }
            }
        }
    }
});

// Listen for device click broadcasts from server and forward to device via dataChannel
socket.on('device_click_broadcast', (data) => {
    try {
        // Show locally in the laptop UI
        if (typeof data.x === 'number' && typeof data.y === 'number') {
            displayCoordinates(data.x, data.y, data.label || 'Device Tap');
        }

        // Forward to connected device via dataChannel (if present)
        if (dataChannel && dataChannel.readyState === 'open') {
            const payload = {
                type: 'click_feedback',
                x: data.x,
                y: data.y,
                label: data.label || 'Device Tap',
                clickId: data.clickId || Date.now()
            };
            try {
                dataChannel.send(JSON.stringify(payload));
                console.log('[FORWARD] Sent click_feedback to device', payload);
            } catch (sendErr) {
                console.warn('[FORWARD] Failed to send to dataChannel', sendErr);
            }
        } else {
            console.log('[FORWARD] dataChannel not open; cannot forward to device');
        }
    } catch (e) {
        console.error('Error handling device_click_broadcast', e);
    }
});

// Also listen for server acknowledgements (useful if device connects directly to socket.io)
socket.on('device_click_ack', (data) => {
    try {
        if (typeof data.x === 'number' && typeof data.y === 'number') {
            displayCoordinates(data.x, data.y, data.label || 'Device Tap');
        }

        // Forward ack back to device via dataChannel as click_feedback
        if (dataChannel && dataChannel.readyState === 'open') {
            const payload = {
                type: 'click_feedback',
                x: data.x,
                y: data.y,
                label: data.label || 'Device Tap',
                clickId: data.clickId || Date.now()
            };
            try {
                dataChannel.send(JSON.stringify(payload));
                console.log('[FORWARD-ACK] Sent click_feedback to device', payload);
            } catch (sendErr) {
                console.warn('[FORWARD-ACK] Failed to send to dataChannel', sendErr);
            }
        } else {
            console.log('[FORWARD-ACK] dataChannel not open; cannot forward ack to device');
        }
    } catch (e) {
        console.error('Error handling device_click_ack', e);
    }
});
