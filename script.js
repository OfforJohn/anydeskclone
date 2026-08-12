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
const dinoLoader = document.getElementById('dino-loader');
const dinoLoader2 = document.getElementById('dino-loader-2');
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

// --- SMART MATCHING BUFFER ---
const pendingAIGuesses = new Map();

function showRemoteClickIndicator(x, y, label = 'Tap', container = remoteContainer) {
    if (!container) return;
    const indicator = document.createElement('div');
    indicator.className = 'remote-tap-indicator';
    indicator.title = label;
    indicator.style.left = `${(x * 100).toFixed(1)}%`;
    indicator.style.top = `${(y * 100).toFixed(1)}%`;
    container.appendChild(indicator);
    setTimeout(() => indicator.remove(), 800);
}

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
                        roomId: rid,
                        x: data.x,
                        y: data.y,
                        label: data.label || "Device Tap",
                        clickId: data.clickId || Date.now()
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

let clickCount = 0;
function displayCoordinates(x, y, source = "Tap", clickId = null, aiGuess = null) {
    const logContent = document.getElementById('click-log-content');
    if (!logContent) return;

    const normalizedClickId = clickId ? String(clickId) : null;
    const pendingAI = normalizedClickId ? pendingAIGuesses.get(normalizedClickId) : null;
    const effectiveAiGuess = aiGuess || pendingAI || '';

    updateMockAndroidUI({
        roomId: roomIdInput.value || 'unknown',
        clickId: normalizedClickId,
        label: source,
        x, y,
        aiGuess: effectiveAiGuess
    });

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
    if (normalizedClickId) {
        entry.setAttribute('data-click-id', normalizedClickId);
        entry.dataset.order = getOrdinal(clickCount);
    }
    entry.innerHTML = `<span><b>${getOrdinal(clickCount)}</b> ${label}:</span><span>${(x*100).toFixed(1)}%, ${(y*100).toFixed(1)}%</span>`;
    logContent.insertBefore(entry, logContent.firstChild);

    showRemoteClickIndicator(x, y, label, remoteContainer);
    showRemoteClickIndicator(x, y, label, remoteContainer2);
}

socket.on("ai_key_guess_broadcast", (data) => {
    logRawPayload('AI Guess', data);
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

    const aiSuggestionText = document.getElementById('ai-suggestion-text');
    if (aiSuggestionText) {
        aiSuggestionText.innerText = data.guessed_key;
        document.getElementById('ai-suggestion').style.display = 'block';
    }
});

socket.on('device_click_broadcast', (data) => {
    logRawPayload('Device Event', data);
    if (typeof data.x === 'number' && typeof data.y === 'number') {
        displayCoordinates(data.x, data.y, data.label || 'Device Tap', data.clickId);
    }
});

function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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
    peerConnection = null;
    dataChannel = null;
    remoteVideo.style.display = 'none';
    remoteVideo2.style.display = 'none';
    dinoLoader.style.display = 'flex';
    dinoLoader2.style.display = 'flex';
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
    const btn = document.getElementById('panel-toggle');
    panel.classList.toggle('expanded');
    btn.classList.toggle('active');
    btn.querySelector('i').className = panel.classList.contains('expanded') ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
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
        confirmBtn.style.display = 'block';
        btn.classList.add('active-mode');
        btn.innerHTML = '<i class="fas fa-times"></i> PIN';
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
        btn.innerHTML = '<i class="fas fa-fingerprint"></i> DRAW';
        drawCanvas.width = remoteVideo.clientWidth;
        drawCanvas.height = remoteVideo.clientHeight;
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    } else {
        patternSimulator.style.display = 'none';
        btn.classList.remove('active-mode');
        btn.innerHTML = '<i class="fas fa-braille"></i> Pattern';
    }
}

function toggleSecurityOverride() {
    const btn = document.getElementById('security-mode');
    const isAct = btn.classList.toggle('active-mode');
    btn.innerHTML = isAct ? '<i class="fas fa-eye"></i> ON' : '<i class="fas fa-shield-alt"></i> Override';

    if (isAct) {
        remoteVideo.style.display = 'block';
        remoteVideo.style.background = '#111';
        remoteVideo2.style.display = 'block';
        remoteVideo2.style.background = '#111';
        dinoLoader.style.display = 'none';
        dinoLoader2.style.display = 'none';
    }
}

function sendTypeText() {
    const input = document.getElementById('remote-type-input');
    if (input.value && dataChannel?.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'type', text: input.value }));
        input.value = "";
    }
}

function updateMockAndroidUI(payload) {
    document.getElementById('mock-ui-label').innerText = payload.label || 'Tap';
    document.getElementById('mock-ui-meta').innerText = `AI: ${payload.aiGuess || '...'} • ${(payload.x*100).toFixed(1)}%`;
    document.getElementById('mock-ui-json').innerText = JSON.stringify(payload, null, 2);
    document.getElementById('mock-ui-window').style.display = 'flex';
}

function resetMockAndroidUI() {
    document.getElementById('mock-ui-window').style.display = 'none';
}

function logRawPayload(label, payload) {
    const box = document.getElementById('debug-payload-log');
    if (!box) return;
    if (box.innerHTML.includes('No data')) box.innerHTML = '';
    const entry = document.createElement('div');
    entry.style.fontSize = '0.65rem';
    entry.style.borderBottom = '1px solid #333';
    entry.innerHTML = `<span style="color:#00ff88">${label}:</span> ${JSON.stringify(payload)}`;
    box.insertBefore(entry, box.firstChild);
}

function clearClickLog() {
    clickCount = 0;
    document.getElementById('click-log-content').innerHTML = '<div style="color:#666; font-style:italic; text-align:center; padding:10px;">Waiting...</div>';
}

function handleInteraction(e, element) {
    if (element.style.display === 'none') return;
    const rect = element.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'click', x, y, clickId: Date.now() }));
}

remoteVideo.addEventListener('mousedown', (e) => handleInteraction(e, remoteVideo));
remoteVideo2.addEventListener('mousedown', (e) => handleInteraction(e, remoteVideo2));

function makeMovable(element) {
    const header = element.querySelector('.modal-header');
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        startLeft = parseInt(window.getComputedStyle(element).left);
        startTop = parseInt(window.getComputedStyle(element).top);
        element.style.zIndex = 3000;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        element.style.left = (startLeft + e.clientX - startX) + 'px';
        element.style.top = (startTop + e.clientY - startY) + 'px';
    });

    window.addEventListener('mouseup', () => isDragging = false);
}
makeMovable(pinSimulator);
makeMovable(patternSimulator);
