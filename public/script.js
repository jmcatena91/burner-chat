const socket = io();
let cryptoKey = null;
let roomId = null;
let username = null;
let typingTimeout = null;

// DOM Elements
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const linkBox = document.getElementById('link-box');
const typingIndicator = document.getElementById('typing-indicator');
const onlineCountEl = document.getElementById('online-count-num');
const modalOverlay = document.getElementById('modal-overlay');
const usernameInput = document.getElementById('username-input');

// 1. Initialization Logic
async function init() {
    // Check for username
    const storedName = sessionStorage.getItem('burner_username');
    if (storedName) {
        username = storedName;
        modalOverlay.classList.add('hidden');
        startChat();
    } else {
        usernameInput.focus();
    }
}

function setUsername() {
    const name = usernameInput.value.trim();
    if (name) {
        username = name;
        sessionStorage.setItem('burner_username', username);
        modalOverlay.classList.add('hidden');
        startChat();
    }
}

async function startChat() {
    const hash = window.location.hash.substring(1); // Get content after #

    if (hash) {
        // User is joining an existing room
        const parts = hash.split('-');
        roomId = parts[0];
        try {
            let jwkKey;
            // Check if it's the old JSON format or new Raw format
            if (parts[1].startsWith('{') || parts[1].startsWith('%7B')) {
                // Legacy JSON format (Base64 encoded)
                jwkKey = JSON.parse(atob(parts[1]));
                cryptoKey = await importKey(jwkKey);
            } else {
                // New Raw format (Base64 encoded raw bytes)
                const rawBytes = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
                cryptoKey = await importRawKey(rawBytes);
            }
            addSystemMessage("Joined Secure Room.");
        } catch (e) {
            console.error(e);
            addSystemMessage("Error: Invalid Room Link.");
            return;
        }
    } else {
        // User is creating a new room
        roomId = Math.random().toString(36).substring(2, 10);
        cryptoKey = await generateKey();

        // Export as Raw for shorter URL
        const rawKey = await exportRawKey(cryptoKey);
        // Convert to Base64 string
        const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));

        const hashString = `${roomId}-${base64Key}`;

        // Update URL without reloading
        window.history.replaceState(null, null, `#${hashString}`);
        addSystemMessage("Room Created. Share the URL to invite others.");
    }

    updateLinkBox();

    // Join the socket room
    socket.emit('join-room', { roomId, username });
}

// 2. Crypto Helpers (Web Crypto API)
async function generateKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

async function importKey(jwk) {
    return await window.crypto.subtle.importKey(
        "jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
    );
}

async function importRawKey(rawBytes) {
    return await window.crypto.subtle.importKey(
        "raw", rawBytes, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
    );
}

async function exportKey(key) {
    return await window.crypto.subtle.exportKey("jwk", key);
}

async function exportRawKey(key) {
    return await window.crypto.subtle.exportKey("raw", key);
}

async function encryptData(dataBuffer) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv }, cryptoKey, dataBuffer
    );
    return {
        data: Array.from(new Uint8Array(encrypted)), // Convert to array for socket
        iv: Array.from(iv)
    };
}

async function decryptData(data, iv) {
    return await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        cryptoKey,
        new Uint8Array(data)
    );
}

// 3. Chat Logic
async function sendMessage(e) {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !cryptoKey) return;

    const enc = new TextEncoder();
    const { data, iv } = await encryptData(enc.encode(text));

    socket.emit('chat-message', {
        roomId,
        encryptedData: data,
        iv,
        username,
        type: 'text'
    });

    addMessage({ type: 'text', content: text }, 'my-message', username);
    messageInput.value = '';
    socket.emit('stop-typing', roomId);
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        addSystemMessage("Error: File too large (Max 2MB)");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        const buffer = event.target.result;
        const { data, iv } = await encryptData(buffer);

        const type = file.type.startsWith('image/') ? 'image' : 'file';

        socket.emit('chat-message', {
            roomId,
            encryptedData: data,
            iv,
            username,
            type: type,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type
        });

        // For local display
        const blob = new Blob([buffer], { type: file.type });
        const url = URL.createObjectURL(blob);
        addMessage({ type, content: url, fileName: file.name, fileSize: file.size }, 'my-message', username);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // Reset input
}

// WebRTC Logic
let localStream = null;
let peerConnection = null;
const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const videoOverlay = document.getElementById('video-call-overlay');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const callStatus = document.getElementById('call-status');

async function startCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        videoOverlay.classList.remove('hidden');
        callStatus.innerText = "Waiting for peer...";

        createPeerConnection();
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        sendSignal({ type: 'offer', sdp: offer });
    } catch (err) {
        console.error("Error starting call:", err);
        addSystemMessage("Error: Could not start call.");
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(config);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ type: 'candidate', candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        callStatus.innerText = "Connected";
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected') {
            endCall();
        }
    };
}

async function handleSignal(signal, senderId) {
    if (!peerConnection) {
        // Incoming call
        if (signal.type === 'offer') {
            const accept = confirm("Incoming Video Call. Accept?");
            if (!accept) return; // TODO: Send reject

            videoOverlay.classList.remove('hidden');
            callStatus.innerText = "Connecting...";

            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localVideo.srcObject = localStream;

                createPeerConnection();
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

                await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);

                sendSignal({ type: 'answer', sdp: answer }, senderId);
            } catch (err) {
                console.error("Error answering call:", err);
                endCall();
            }
        }
    } else {
        // Existing call
        if (signal.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.type === 'candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    }
}

async function sendSignal(data, target = null) {
    // Encrypt signal data using the room key
    const enc = new TextEncoder();
    const { data: encryptedData, iv } = await encryptData(enc.encode(JSON.stringify(data)));

    socket.emit('signal', {
        roomId,
        signalData: { encryptedData, iv },
        target
    });
}

socket.on('signal', async ({ signalData, sender }) => {
    try {
        const decryptedBuffer = await decryptData(signalData.encryptedData, signalData.iv);
        const signal = JSON.parse(new TextDecoder().decode(decryptedBuffer));
        handleSignal(signal, sender);
    } catch (err) {
        console.error("Signal decryption failed", err);
    }
});

function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    videoOverlay.classList.add('hidden');
    remoteVideo.srcObject = null;
}

socket.on('receive-message', async ({ encryptedData, iv, senderName, timestamp, type, fileName, fileSize, mimeType }) => {
    try {
        const decryptedBuffer = await decryptData(encryptedData, iv);
        let content;

        if (type === 'text') {
            content = new TextDecoder().decode(decryptedBuffer);
        } else {
            const blob = new Blob([decryptedBuffer], { type: mimeType || 'application/octet-stream' });
            content = URL.createObjectURL(blob);
        }

        addMessage({ type: type || 'text', content, fileName, fileSize }, 'their-message', senderName, timestamp);
    } catch (err) {
        console.error("Decryption failed", err);
    }
});

socket.on('user-connected', (name) => {
    addSystemMessage(`${name || 'A user'} joined the room.`);
});

socket.on('user-disconnected', (name) => {
    addSystemMessage(`${name || 'A user'} left the room.`);
});

socket.on('room-users', (users) => {
    const userListEl = document.getElementById('user-list');
    const userCountBadge = document.getElementById('user-count-badge');

    if (!Array.isArray(users)) {
        console.error("Invalid user list received:", users);
        return;
    }

    if (userListEl) {
        userListEl.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user;
            userListEl.appendChild(li);
        });
    }

    if (userCountBadge) {
        userCountBadge.innerText = users.length;
    }
});

// Typing Indicators
messageInput.addEventListener('input', () => {
    socket.emit('typing', { roomId, username });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop-typing', roomId);
    }, 1000);
});

socket.on('user-typing', (name) => {
    typingIndicator.innerText = `${name} is typing...`;
    typingIndicator.classList.add('visible');
});

socket.on('user-stop-typing', () => {
    typingIndicator.classList.remove('visible');
});


// UI Helpers
function addMessage(msgData, className, senderName, timeStr) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${className}`;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'username-label';
    nameLabel.textContent = senderName || 'Unknown';

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';

    // Handle Content Type
    if (msgData.type === 'text') {
        msgDiv.textContent = msgData.content;
    } else if (msgData.type === 'image') {
        const img = document.createElement('img');
        img.src = msgData.content;
        img.onload = () => wrapper.scrollIntoView({ behavior: 'smooth' }); // Scroll after load
        msgDiv.appendChild(img);
    } else if (msgData.type === 'file') {
        const link = document.createElement('a');
        link.href = msgData.content;
        link.download = msgData.fileName || 'download';
        link.className = 'file-attachment';

        link.innerHTML = `
            <div class="file-icon">📄</div>
            <div class="file-info">
                <span class="file-name">${msgData.fileName}</span>
                <span class="file-size">${formatBytes(msgData.fileSize)}</span>
            </div>
        `;
        msgDiv.appendChild(link);
    }

    const timeDiv = document.createElement('div');
    timeDiv.className = 'timestamp';
    const date = timeStr ? new Date(timeStr) : new Date();
    timeDiv.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgDiv.appendChild(timeDiv);

    if (className === 'their-message') {
        wrapper.appendChild(nameLabel);
    }
    wrapper.appendChild(msgDiv);

    chatContainer.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = text;
    chatContainer.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
}

function updateLinkBox() {
    linkBox.innerHTML = `
        <span>🔒 Secure Room Link</span>
        <span style="font-size: 0.8em; opacity: 0.7;">(Click to Copy)</span>
    `;
}

function copyLink() {
    navigator.clipboard.writeText(window.location.href);

    const original = linkBox.innerHTML;
    linkBox.innerHTML = `<span style="color: var(--success-color);">✓ Link Copied!</span>`;
    setTimeout(() => {
        linkBox.innerHTML = original;
    }, 2000);
}

// Global exposure for HTML event handlers
window.copyLink = copyLink;
window.sendMessage = sendMessage;
window.setUsername = setUsername;
window.handleFileSelect = handleFileSelect;
window.startCall = startCall;
window.endCall = endCall;

// Start
init();
