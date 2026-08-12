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
const remoteVideo2 = document.getElementById('remoteVideo2'); // Second video element
const remoteContainer = document.getElementById('remote-container');
const remoteContainer2 = document.getElementById('remote-container-2');
const dinoLoader = document.getElementById('dino-loader');
const dinoLoader2 = document.getElementById('dino-loader-2');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdInput = document.getElementById('roomId');

const pendingAIGuesses = new Map();
const pendingClicks = new Map();
const mockPayloadByClickId = new Map();

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
                if (typeof data.x === 'number' && typeof data.y === 'number') {
                    const rid = roomIdInput.value || localStorage.getItem('lastRoomId');
                    socket.emit("device_click", {
                        roomId: rid,
                        x: data.x,
                        y: data.y,
                        label: data.label || "Device Touch",
                        clickId: data.clickId || Date.now()
                    });
                }
            } catch (e) {}
        };
    };

    peerConnection.ontrack = (event) => {
        console.log("[VIDEO] Track Received");
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

    if (normalizedClickId) {
        const existing = logContent.querySelector(`.log-entry[data-click-id="${normalizedClickId}"]`);
        if (existing) {
            const label = effectiveAiGuess ? `${source} (AI: ${effectiveAiGuess})` : source;
            const xPct = (x * 100).toFixed(1);
            const yPct = (y * 100).toFixed(1);
            existing.innerHTML = `
                <span><b>${existing.dataset.order}</b> ${label}:</span>
                <span>${xPct}%, ${yPct}%</span>
            `;
            if (normalizedClickId && pendingAIGuesses.has(normalizedClickId)) pendingAIGuesses.delete(normalizedClickId);
            return;
        }
    }

    if (clickCount === 0) logContent.innerHTML = '';
    clickCount++;

    const label = effectiveAiGuess ? `${source} (AI: ${effectiveAiGuess})` : source;
    const xPct = (x * 100).toFixed(1);
    const yPct = (y * 100).toFixed(1);

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (normalizedClickId) {
        entry.setAttribute('data-click-id', normalizedClickId);
        entry.dataset.order = getOrdinal(clickCount);
    }

    entry.innerHTML = `
        <span><b>${getOrdinal(clickCount)}</b> ${label}:</span>
        <span>${xPct}%, ${yPct}%</span>
    `;

    logContent.insertBefore(entry, logContent.firstChild);

    const coordInfo = document.getElementById('coord-info');
    coordInfo.innerText = `${label}: ${xPct}%, ${yPct}%`;
    coordInfo.style.display = 'block';

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

function toggleSecurityOverride() {
    const btn = document.getElementById('security-mode');
    const isAct = btn.classList.toggle('active-mode');
    btn.innerHTML = isAct ? '<i class="fas fa-eye"></i> ON' : '<i class="fas fa-shield-alt"></i> Override';
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
    document.getElementById('click-log-content').innerHTML = '<div style="color: #666; font-style: italic; text-align: center; padding: 10px;">Waiting...</div>';
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

function handleInteraction(e, element) {
    if (element.style.display === 'none') return;
    const rect = element.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'click', x, y, clickId: Date.now() }));
}

remoteVideo.addEventListener('mousedown', (e) => handleInteraction(e, remoteVideo));
remoteVideo2.addEventListener('mousedown', (e) => handleInteraction(e, remoteVideo2));
