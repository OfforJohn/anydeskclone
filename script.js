// --- RESCUE CONNECTIVITY CONFIG ---
const socket = io(window.location.origin, {
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity
});

function debugUI(msg, color = "#888") {
    const statusInfo = document.getElementById('status-text');
    if (statusInfo) {
        statusInfo.innerHTML = msg;
        statusInfo.style.color = color;
    }
}

socket.on('connect', () => debugUI("SERVER CONNECTED", "#00ff88"));
socket.on('connect_error', (err) => debugUI(`CONN ERROR`, "#ff4444"));

let peerConnection;
let dataChannel;

const remoteVideo = document.getElementById('remoteVideo');
const remoteVideo2 = document.getElementById('remoteVideo2'); // Virtual video for AI
const aiCanvas = document.getElementById('ai-canvas');
const aiCtx = aiCanvas.getContext('2d');
const aiOverlay = document.getElementById('draw-overlay-2');
const aiOverlayCtx = aiOverlay ? aiOverlay.getContext('2d') : null;
const remoteContainer = document.getElementById('remote-container');

// Pulses storage for timed annotation rendering
const aiPulses = [];

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdInput = document.getElementById('roomId');
const dinoLoader = document.getElementById('dino-loader');
const dinoLoader2 = document.getElementById('dino-loader-2');

const pendingAIGuesses = new Map();

// --- AI RECONSTRUCTION ENGINE ---
let aiReconstructionActive = false;

function startAIRenderLoop() {
    if (aiReconstructionActive) return;
    aiReconstructionActive = true;

    function render() {
        if (!aiReconstructionActive) return;

        // Match canvas + overlay size to container
        if (aiCanvas.width !== aiCanvas.clientWidth) {
            aiCanvas.width = aiCanvas.clientWidth;
            aiCanvas.height = aiCanvas.clientHeight;
        }
        if (aiOverlay && (aiOverlay.width !== aiOverlay.clientWidth)) {
            aiOverlay.width = aiOverlay.clientWidth;
            aiOverlay.height = aiOverlay.clientHeight;
        }

        // Draw video snapshot as background if available, otherwise draw scanlines
        if (remoteVideo && remoteVideo.readyState >= 2) {
            try {
                aiCtx.drawImage(remoteVideo, 0, 0, aiCanvas.width, aiCanvas.height);
            } catch (e) {
                // fallback to scanlines if drawImage fails
                aiCtx.fillStyle = '#050505';
                aiCtx.fillRect(0, 0, aiCanvas.width, aiCanvas.height);
            }
        } else {
            aiCtx.fillStyle = '#050505';
            aiCtx.fillRect(0, 0, aiCanvas.width, aiCanvas.height);
            aiCtx.strokeStyle = 'rgba(0, 255, 136, 0.05)';
            aiCtx.lineWidth = 1;
            for (let i = 0; i < aiCanvas.height; i += 20) {
                aiCtx.beginPath();
                aiCtx.moveTo(0, i);
                aiCtx.lineTo(aiCanvas.width, i);
                aiCtx.stroke();
            }
        }

        // Render pulses on overlay with fade-out
        if (aiOverlayCtx) {
            aiOverlayCtx.clearRect(0, 0, aiOverlay.width, aiOverlay.height);
            const now = Date.now();
            for (let i = aiPulses.length - 1; i >= 0; i--) {
                const p = aiPulses[i];
                const age = (now - p.ts) / 800; // 0..1
                if (age > 1) { aiPulses.splice(i, 1); continue; }
                const alpha = 1 - age;
                const rx = p.x * aiOverlay.width;
                const ry = p.y * aiOverlay.height;
                aiOverlayCtx.beginPath();
                aiOverlayCtx.arc(rx, ry, 20 + 30 * age, 0, Math.PI * 2);
                aiOverlayCtx.strokeStyle = `rgba(0,255,136,${0.9 * alpha})`;
                aiOverlayCtx.lineWidth = 2;
                aiOverlayCtx.stroke();
                aiOverlayCtx.fillStyle = `rgba(0,255,136,${0.9 * alpha})`;
                aiOverlayCtx.font = `${12 + 8 * (1 - age)}px monospace`;
                aiOverlayCtx.fillText(p.label.toString().toUpperCase(), rx + 24, ry - 8);
            }
        }

        requestAnimationFrame(render);
    }
    render();
}

function drawAIElement(x, y, label) {
    const realX = x * aiCanvas.width;
    const realY = y * aiCanvas.height;

    // Draw "Pulse" on AI Screen
    aiCtx.beginPath();
    aiCtx.arc(realX, realY, 30, 0, Math.PI * 2);
    aiCtx.strokeStyle = '#00ff88';
    aiCtx.lineWidth = 2;
    aiCtx.stroke();

    // Draw ID Tag
    aiCtx.fillStyle = '#00ff88';
    aiCtx.font = '10px monospace';
    aiCtx.fillText(label.toUpperCase(), realX + 10, realY - 10);

    // Draw Box
    aiCtx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
    aiCtx.strokeRect(realX - 25, realY - 25, 50, 50);
}

function showRemoteClickIndicator(x, y, label = 'Tap') {
    if (!remoteContainer) return;
    const indicator = document.createElement('div');
    indicator.className = 'remote-tap-indicator';
    indicator.title = label;
    indicator.style.left = `${(x * 100).toFixed(1)}%`;
    indicator.style.top = `${(y * 100).toFixed(1)}%`;
    remoteContainer.appendChild(indicator);
    setTimeout(() => indicator.remove(), 800);
}

// --- PEER CONNECTION ---
async function createPeerConnection(roomId) {
    if (peerConnection) return;
    const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    peerConnection = new RTCPeerConnection(config);

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        dataChannel.onopen = () => updateStatus("Live Control", true);
        dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'device_click' || data.type === 'click_feedback') {
                    socket.emit("device_click", {
                        roomId: roomIdInput.value || localStorage.getItem('lastRoomId'),
                        x: data.x, y: data.y, label: data.label || "Device Tap",
                        clickId: data.clickId || Date.now()
                    });
                }
            } catch (e) {}
        };
    };

    peerConnection.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        remoteVideo.srcObject = stream;
        remoteVideo.style.display = 'block';
        dinoLoader.style.display = 'none';
        dinoLoader2.style.display = 'none';

        startAIRenderLoop();
        debugUI("AI ENGINE LIVE", "#00ff88");
    };

    const offer = await peerConnection.createOffer({ offerToReceiveVideo: true });
    await peerConnection.setLocalDescription(offer);
    socket.emit("message", { roomId, offer });
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) socket.emit("message", { roomId, candidate: event.candidate });
    };
}

let clickCount = 0;
function displayCoordinates(x, y, source = "Tap", clickId = null, aiGuess = null) {
    const logContent = document.getElementById('click-log-content');
    if (!logContent) return;

    const normalizedClickId = clickId ? String(clickId) : null;
    const pendingAI = normalizedClickId ? pendingAIGuesses.get(normalizedClickId) : null;
    const effectiveAiGuess = aiGuess || pendingAI || '';

    // Draw on AI Canvas
    drawAIElement(x, y, effectiveAiGuess || source);
    // Also show a transient indicator on the main remote container
    try {
        showRemoteClickIndicator(x, y, effectiveAiGuess || source);
    } catch (e) {
        console.warn('[UI] showRemoteClickIndicator failed', e);
    }

    if (normalizedClickId) {
        const existing = logContent.querySelector(`.log-entry[data-click-id="${normalizedClickId}"]`);
        if (existing) {
            const label = effectiveAiGuess ? `${source} (AI: ${effectiveAiGuess})` : source;
            existing.innerHTML = `<span><b>${existing.dataset.order}</b> ${label}:</span><span>${(x*100).toFixed(1)}%, ${(y*100).toFixed(1)}%</span>`;
            return;
        }
    }

    if (clickCount === 0) logContent.innerHTML = '';
    clickCount++;

    const label = effectiveAiGuess ? `${source} (AI: ${effectiveAiGuess})` : source;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (normalizedClickId) { entry.setAttribute('data-click-id', normalizedClickId); entry.dataset.order = getOrdinal(clickCount); }
    entry.innerHTML = `<span><b>${getOrdinal(clickCount)}</b> ${label}:</span><span>${(x*100).toFixed(1)}%, ${(y*100).toFixed(1)}%</span>`;
    logContent.insertBefore(entry, logContent.firstChild);
}

socket.on("ai_key_guess_broadcast", (data) => {
    console.log('[CLIENT] ai_key_guess_broadcast', data);
    if (!aiReconstructionActive) startAIRenderLoop();
    const normalizedClickId = data.clickId ? String(data.clickId) : null;
    const guess = data.guessed_key || data.guessedKey || data.guess || '';
    const aiBadge = document.getElementById('ai-suggestion');
    if (aiBadge) {
        aiBadge.innerText = `AI: ${guess}`;
        aiBadge.style.display = 'block';
        setTimeout(() => { aiBadge.style.display = 'none'; }, 4000);
    }
    const drawX = (data.originalX !== undefined && data.originalX !== null) ? data.originalX : (data.x || 0);
    const drawY = (data.originalY !== undefined && data.originalY !== null) ? data.originalY : (data.y || 0);
    if (normalizedClickId) {
        pendingAIGuesses.set(normalizedClickId, guess);
        // Refresh display if the click already arrived (use original coords when available)
        displayCoordinates(drawX, drawY, "Device Tap", normalizedClickId, guess);
    } else {
        // Draw the guess even if no clickId (useful for heuristics)
        displayCoordinates(drawX, drawY, "AI Guess", null, guess);
    }
});

socket.on('device_click_broadcast', (data) => {
    console.log('[CLIENT] device_click_broadcast', data);
    if (!aiReconstructionActive) startAIRenderLoop();
    // Prefer original coordinates carried in the payload when available
    const drawX = (data.originalX !== undefined && data.originalX !== null) ? data.originalX : data.x;
    const drawY = (data.originalY !== undefined && data.originalY !== null) ? data.originalY : data.y;
    if (typeof drawX === 'number' && typeof drawY === 'number') {
        displayCoordinates(drawX, drawY, data.label || 'Device Tap', data.clickId);
    }
});

function getOrdinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

function startSharing() {
    const roomId = roomIdInput.value;
    if (!roomId) return;
    localStorage.setItem('lastRoomId', roomId);
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('active-info').style.display = 'block';
    document.getElementById('display-room-id').innerText = roomId;
    dinoLoader.style.display = 'flex';
    socket.emit("join", roomId);
    createPeerConnection(roomId);
}

function refreshConnection() {
    const roomId = roomIdInput.value || localStorage.getItem('lastRoomId');
    if (!roomId) return;
    if (peerConnection) peerConnection.close();
    peerConnection = null;
    remoteVideo.style.display = 'none';
    dinoLoader.style.display = 'flex';
    socket.emit("join", roomId);
    createPeerConnection(roomId);
}

function updateStatus(status, isActive) {
    statusText.innerText = status;
    statusDot.className = 'status-dot' + (isActive ? ' active' : '');
    if (isActive) {
        document.getElementById('remote-controls').style.display = 'flex';
        document.getElementById('active-info').style.display = 'block';
    }
}

function toggleMainPanel() {
    document.getElementById('main-actions-panel').classList.toggle('expanded');
}

function wakeDevice() {
    if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'wake' }));
}

function toggleUnlockInput() {
    isPinMode = !isPinMode;
    const btn = document.getElementById('unlock-toggle');
    document.getElementById('pin-simulator').style.display = isPinMode ? 'flex' : 'none';
    document.getElementById('unlock-pin').style.display = isPinMode ? 'block' : 'none';
    btn.classList.toggle('active-mode');
}

function sendUnlock() {
    const pin = document.getElementById('unlock-pin').value;
    if (pin && dataChannel?.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'unlock', pin: pin }));
        toggleUnlockInput();
    }
}

function togglePatternMode() {
    isPatternMode = !isPatternMode;
    document.getElementById('pattern-toggle').classList.toggle('active-mode');
    document.getElementById('pattern-simulator').style.display = isPatternMode ? 'flex' : 'none';
}

function toggleSecurityOverride() {
    const btn = document.getElementById('security-mode');
    if (btn.classList.toggle('active-mode')) {
        remoteVideo.style.display = 'block';
        remoteVideo.style.background = '#111';
        dinoLoader.style.display = 'none';
    }
}

function sendTypeText() {
    const input = document.getElementById('remote-type-input');
    if (input.value && dataChannel?.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'type', text: input.value }));
        input.value = "";
    }
}

function clearClickLog() {
    clickCount = 0;
    document.getElementById('click-log-content').innerHTML = '';
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

// Coordinate conversion for clicks
function handleInteraction(e, element) {
    if (element.style.display === 'none') return;
    const rect = element.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // Render locally immediately so the AI visualizer captures where the user clicked
    const localClickId = `local-${Date.now()}`;
    try {
        displayCoordinates(x, y, 'Local Click', localClickId);
        showRemoteClickIndicator(x, y, 'Local Click');
    } catch (e) {
        console.warn('[LOCAL-CAPTURE] failed to render local click', e);
    }

    // Also forward the click to the device via the data channel, using the same clickId
    if (dataChannel?.readyState === 'open') {
        try {
            dataChannel.send(JSON.stringify({ type: 'click', x, y, clickId: localClickId }));
        } catch (e) {
            console.warn('[DATACHANNEL] failed to send click', e);
        }
    }
}

remoteVideo.addEventListener('mousedown', (e) => handleInteraction(e, remoteVideo));
