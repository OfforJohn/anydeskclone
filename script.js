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
const remoteContainer = document.getElementById('remote-container');
const drawCanvas = document.getElementById('draw-overlay');
const drawCtx = drawCanvas.getContext('2d');
const dinoLoader = document.getElementById('dino-loader');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const roomIdInput = document.getElementById('roomId');

const KNOWN_TAP_ZONES = [
    { name: 'NAV BAR', x: 0.50, y: 0.97, radius: 0.15 },
    { name: 'TOP BAR', x: 0.50, y: 0.10, radius: 0.18 },
    { name: 'CENTER', x: 0.50, y: 0.50, radius: 0.20 },
    { name: 'LOWER', x: 0.50, y: 0.80, radius: 0.20 },
    { name: 'KEY 2', x: 0.50, y: 0.44, radius: 0.12 },
    { name: 'KEY P2', x: 0.50, y: 0.35, radius: 0.12 },
    { name: 'KEY DEL', x: 0.25, y: 0.80, radius: 0.12 },
    { name: 'KEY ENTER', x: 0.90, y: 0.85, radius: 0.12 }
];

const mockPayloadByClickId = new Map();

function distance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function inferScreenLabel(x, y, sourceLabel, aiGuess) {
    const lowerLabel = sourceLabel ? sourceLabel.toLowerCase() : '';
    const genericTap = lowerLabel.includes('tap') || lowerLabel.includes('touch') || lowerLabel.includes('device');
    if (genericTap || lowerLabel.includes('home') || lowerLabel.includes('nav') || lowerLabel.includes('screen area')) {
        const nearest = KNOWN_TAP_ZONES.reduce((best, zone) => {
            const d = distance(x, y, zone.x, zone.y);
            return d < best.dist ? { zone, dist: d } : best;
        }, { zone: null, dist: Infinity });

        if (nearest.zone && nearest.dist < 0.16) {
            if (aiGuess && !aiGuess.toLowerCase().includes('screen')) {
                return `${nearest.zone.name} (AI: ${aiGuess})`;
            }
            return nearest.zone.name;
        }
        return `Screen Area${aiGuess ? ` (AI: ${aiGuess})` : ''}`;
    }

    if (aiGuess && !sourceLabel.includes(aiGuess)) {
        return `${sourceLabel} (AI: ${aiGuess})`;
    }

    return sourceLabel;
}

function formatTrackerLabel(label, aiGuess) {
    const baseLabel = label || 'Device Tap';
    return aiGuess ? `${baseLabel} (AI: ${aiGuess})` : baseLabel;
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

// --- SMART MATCHING BUFFER ---
const pendingAIGuesses = new Map();
// Buffer clicks that are ambiguous (Screen Area) until AI labels them
const pendingClicks = new Map();

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
                        label: data.label || (data.type === 'click' ? 'Device Tap' : 'Device Click'),
                        clickId: data.clickId || Date.now()
                    });
                }
            } catch (e) {
                console.warn('[DATA CHANNEL] failed to parse click message', e);
            }
        };
    };

    peerConnection.ontrack = (event) => {
        console.log("[VIDEO] Track Received");
        remoteVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
        remoteVideo.style.display = 'block';
        dinoLoader.style.display = 'none';
        debugUI("VIDEO ACTIVE", "#00ff88");
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

    // Update mock UI separately
    updateMockAndroidUI({
        roomId: document.getElementById('roomId')?.value || 'unknown',
        clickId: normalizedClickId,
        label: source,
        x,
        y,
        aiGuess: effectiveAiGuess
    });

    // If an entry for this clickId already exists, update it instead of inserting a duplicate
    if (normalizedClickId) {
        mockPayloadByClickId.set(normalizedClickId, { roomId: document.getElementById('roomId')?.value || 'unknown', clickId: normalizedClickId, label: source, x, y, aiGuess: effectiveAiGuess });
        const existing = logContent.querySelector(`.log-entry[data-click-id="${normalizedClickId}"]`);
        if (existing) {
            const label = formatTrackerLabel(source, effectiveAiGuess);
            const xPct = (x * 100).toFixed(1);
            const yPct = (y * 100).toFixed(1);
            existing.innerHTML = `
                <span><b>${existing.querySelector('span:first-child') ? existing.dataset.order : getOrdinal(clickCount)}</b> ${label}:</span>
                <span>${xPct}%, ${yPct}%</span>
            `;
            const coordInfo = document.getElementById('coord-info');
            coordInfo.innerText = `${label}: ${xPct}%, ${yPct}%`;
            coordInfo.style.display = 'block';
            showRemoteClickIndicator(x, y, label);
            if (normalizedClickId && pendingAIGuesses.has(normalizedClickId)) pendingAIGuesses.delete(normalizedClickId);
            return;
        }
    }

    if (clickCount === 0) logContent.innerHTML = '';
    clickCount++;

    const label = formatTrackerLabel(source, aiGuess || (clickId ? pendingAIGuesses.get(clickId) : null));
    const xPct = (x * 100).toFixed(1);
    const yPct = (y * 100).toFixed(1);

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (clickId) {
        entry.setAttribute('data-click-id', clickId);
        // store the ordinal for later updates
        entry.dataset.order = getOrdinal(clickCount);
    }
    entry.innerHTML = `
        <span><b>${getOrdinal(clickCount)}</b> ${label}:</span>
        <span>${xPct}%, ${yPct}%</span>
    `;

    if (clickId && pendingAIGuesses.has(clickId) && !aiGuess) {
        pendingAIGuesses.delete(clickId);
    }

    logContent.insertBefore(entry, logContent.firstChild);
    const coordInfo = document.getElementById('coord-info');
    coordInfo.innerText = `${label}: ${xPct}%, ${yPct}%`;
    coordInfo.style.display = 'block';
    showRemoteClickIndicator(x, y, label);
}

function formatTrackerLabel(source, aiGuess) {
    if (!aiGuess) return source;
    return `${source} (AI: ${aiGuess})`;
}

function updateMockAndroidUI(payload) {
    const mockLabel = document.getElementById('mock-ui-label');
    const mockMeta = document.getElementById('mock-ui-meta');
    const mockJson = document.getElementById('mock-ui-json');
    const mockWindow = document.getElementById('mock-ui-window');
    if (!mockLabel || !mockMeta || !mockJson || !mockWindow) return;

    mockWindow.style.display = 'flex';
    mockLabel.innerText = payload.label || 'Tap received';
    mockMeta.innerText = `AI: ${payload.aiGuess || 'pending'} • ${((payload.x || 0) * 100).toFixed(1)}%, ${((payload.y || 0) * 100).toFixed(1)}%`;
    mockJson.innerText = JSON.stringify({
        roomId: payload.roomId,
        clickId: payload.clickId,
        label: payload.label,
        x: payload.x,
        y: payload.y,
        aiGuess: payload.aiGuess
    }, null, 2);
}

function refreshMockAndroidUIWithGuess(clickId, aiGuess) {
    const normalizedClickId = clickId ? String(clickId) : null;
    if (!normalizedClickId || !mockPayloadByClickId.has(normalizedClickId)) return;
    const payload = mockPayloadByClickId.get(normalizedClickId);
    payload.aiGuess = aiGuess;
    updateMockAndroidUI(payload);
}

function resetMockAndroidUI() {
    const mockLabel = document.getElementById('mock-ui-label');
    const mockMeta = document.getElementById('mock-ui-meta');
    const mockJson = document.getElementById('mock-ui-json');
    const mockWindow = document.getElementById('mock-ui-window');
    if (!mockLabel || !mockMeta || !mockJson || !mockWindow) return;
    mockWindow.style.display = 'none';
    mockLabel.innerText = 'Awaiting tap...';
    mockMeta.innerText = 'Real device tap will appear here.';
    mockJson.innerText = `{
  "roomId": "",
  "clickId": "",
  "label": "",
  "x": 0,
  "y": 0,
  "aiGuess": ""
}`;
}

socket.on("ai_key_guess_broadcast", (data) => {
    logRawPayload('ai_key_guess_broadcast', data);
    const normalizedClickId = data.clickId ? String(data.clickId) : null;
    const logContent = document.getElementById('click-log-content');
    const matchedEntry = normalizedClickId ? logContent.querySelector(`.log-entry[data-click-id="${normalizedClickId}"]`) : null;
    if (matchedEntry) {
        const labelSpan = matchedEntry.querySelector('span:first-child');
        if (!labelSpan.innerHTML.includes('(AI:')) {
            labelSpan.innerHTML += ` <span style="color:#ffaa00; font-size:0.65rem; font-weight:bold;">(AI: ${data.guessed_key})</span>`;
        }
        refreshMockAndroidUIWithGuess(normalizedClickId, data.guessed_key);
    } else if (normalizedClickId && pendingClicks.has(normalizedClickId)) {
        const click = pendingClicks.get(normalizedClickId);
        pendingClicks.delete(normalizedClickId);
        if (click && click._timeout) clearTimeout(click._timeout);
        displayCoordinates(click.x, click.y, click.label || 'Device Tap', normalizedClickId, data.guessed_key);
    } else if (normalizedClickId) {
        pendingAIGuesses.set(normalizedClickId, data.guessed_key);
        setTimeout(() => pendingAIGuesses.delete(normalizedClickId), 5000);
    }

    // Update AI suggestion badge for immediate visibility
    const aiSuggestion = document.getElementById('ai-suggestion');
    const aiSuggestionText = document.getElementById('ai-suggestion-text');
    if (aiSuggestion && aiSuggestionText) {
        aiSuggestionText.innerText = data.guessed_key;
        aiSuggestion.style.display = 'block';
    }

    // Developer helper: duplicate an AI guess as a synthetic welcome message
    // so you can visually verify AI routing without touching the device.
    try {
        const welcomePayload = {
            roomId: data.roomId || (document.getElementById('roomId')?.value || 'unknown'),
            clickId: `welcome-${Date.now()}`,
            label: 'WELCOME',
            x: 0.5,
            y: 0.05,
            aiGuess: 'Welcome John'
        };
        // Log it in the raw payload panel for traceability
        logRawPayload('synthetic_welcome', welcomePayload);
        // Also show it in the mock UI briefly
        mockPayloadByClickId.set(welcomePayload.clickId, welcomePayload);
        updateMockAndroidUI(welcomePayload);
    } catch (e) {
        console.warn('[SYNTHETIC] failed to create welcome payload', e);
    }
});

socket.on('device_click_broadcast', (data) => {
    logRawPayload('device_click_broadcast', data);
    if (typeof data.x === 'number' && typeof data.y === 'number') {
        const cid = data.clickId ? String(data.clickId) : String(Date.now());
        const aiGuess = cid ? pendingAIGuesses.get(cid) : null;
        const candidateLabel = inferScreenLabel(data.x, data.y, data.label || 'Device Tap', aiGuess);

        if (candidateLabel && candidateLabel.toLowerCase().includes('screen area') && !aiGuess) {
            const t = setTimeout(() => {
                if (pendingClicks.has(cid)) {
                    const c = pendingClicks.get(cid);
                    pendingClicks.delete(cid);
                    displayCoordinates(c.x, c.y, c.label || 'Screen Area', cid, null);
                }
            }, 800);

            pendingClicks.set(cid, { x: data.x, y: data.y, label: data.label || 'Device Tap', _timeout: t });
        } else {
            displayCoordinates(data.x, data.y, data.label || 'Device Tap', cid, aiGuess || null);
        }
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
    socket.emit("join", roomId);
    createPeerConnection(roomId);
}

function refreshConnection() {
    const roomId = roomIdInput.value || localStorage.getItem('lastRoomId');
    if (!roomId) return;
    if (peerConnection) peerConnection.close();
    peerConnection = null;
    dataChannel = null;
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
    const panel = document.getElementById('main-actions-panel');
    const btn = document.getElementById('panel-toggle');
    panel.classList.toggle('expanded');
    btn.classList.toggle('active');
    btn.querySelector('i').className = panel.classList.contains('expanded') ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
}

function wakeDevice() {
    if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'wake' }));
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

function logRawPayload(label, payload) {
    const box = document.getElementById('debug-payload-log');
    if (!box) return;
    const stamp = new Date().toLocaleTimeString();

    // Remove placeholder text on first real payload so it doesn't stay visible.
    if (box.children.length === 1 && box.firstChild.textContent?.includes('No payloads yet.')) {
        box.innerHTML = '';
    }

    const entry = document.createElement('div');
    entry.style.marginBottom = '6px';
    entry.style.borderTop = '1px solid rgba(255,255,255,0.08)';
    entry.style.paddingTop = '6px';
    entry.innerHTML = `<div style="color:#00ff88;">${stamp} • ${label}</div><div>${JSON.stringify(payload)}</div>`;
    box.insertBefore(entry, box.firstChild);
    if (box.children.length > 12) {
        box.removeChild(box.lastChild);
    }
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
remoteVideo.addEventListener('mousedown', (e) => {
    if (remoteVideo.style.display === 'none') return;
    const rect = remoteVideo.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    if (dataChannel?.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'click', x, y, clickId: Date.now() }));
        showRemoteClickIndicator(x, y, 'Local Click');
    }
});
