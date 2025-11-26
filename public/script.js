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
        // Check if it contains a key (has a dash)
        if (hash.includes('-')) {
            // User is joining with a link containing the key
            const parts = hash.split('-');
            roomId = parts[0];
            const keyPart = parts[1];

            try {
                let jwkKey;
                // Check if it's the old JSON format or new Raw format
                if (keyPart.startsWith('{') || keyPart.startsWith('%7B')) {
                    // Legacy JSON format (Base64 encoded)
                    jwkKey = JSON.parse(atob(keyPart));
                    cryptoKey = await importKey(jwkKey);
                } else {
                    // New Raw format (Base64 encoded raw bytes)
                    const rawBytes = Uint8Array.from(atob(keyPart), c => c.charCodeAt(0));
                    cryptoKey = await importRawKey(rawBytes);
                }

                // Save key to session storage
                const rawKey = await exportRawKey(cryptoKey);
                const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
                sessionStorage.setItem(`burner_key_${roomId}`, base64Key);

                // Clean URL (remove key)
                window.history.replaceState(null, null, `#${roomId}`);

                addSystemMessage("Joined Secure Room. Key saved to session.");
            } catch (e) {
                console.error(e);
                addSystemMessage("Error: Invalid Room Link.");
                return;
            }
        } else {
            // User is joining/reloading with just roomId
            roomId = hash;

            // Try to get key from session
            const storedKey = sessionStorage.getItem(`burner_key_${roomId}`);
            if (storedKey) {
                try {
                    const rawBytes = Uint8Array.from(atob(storedKey), c => c.charCodeAt(0));
                    cryptoKey = await importRawKey(rawBytes);
                    addSystemMessage("Restored session key.");
                } catch (e) {
                    console.error("Error restoring key", e);
                    addSystemMessage("Error: Could not restore session key.");
                    return;
                }
            } else {
                addSystemMessage("Error: Missing encryption key. Please use the full invite link.");
                return;
            }
        }
    } else {
        // User is creating a new room
        roomId = Math.random().toString(36).substring(2, 10);
        cryptoKey = await generateKey();

        // Export as Raw
        const rawKey = await exportRawKey(cryptoKey);
        // Convert to Base64 string
        const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));

        // Save to session
        sessionStorage.setItem(`burner_key_${roomId}`, base64Key);

        const hashString = `${roomId}-${base64Key}`;

        // Update URL (we show the full URL initially so they can copy it, 
        // but maybe we should clean it immediately? 
        // The user request says "Keys should ... be cleared from the URL immediately".
        // But if we clear it immediately, how do they copy it?
        // The "Copy Link" button should generate the full link with key from session/memory.
        // So yes, we can clean it immediately.

        window.history.replaceState(null, null, `#${roomId}`);
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

    const payload = {
        type: 'text',
        content: text,
        timestamp: Date.now()
    };

    const enc = new TextEncoder();
    const { data, iv } = await encryptData(enc.encode(JSON.stringify(payload)));

    socket.emit('chat-message', {
        roomId,
        encryptedData: data,
        iv,
        username
    });

    addMessage(payload, 'my-message', username);
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

        // Convert array buffer to base64 string
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64Content = btoa(binary);

        const type = file.type.startsWith('image/') ? 'image' : 'file';

        const payload = {
            type: type,
            content: base64Content,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            timestamp: Date.now()
        };

        const enc = new TextEncoder();
        const { data, iv } = await encryptData(enc.encode(JSON.stringify(payload)));

        socket.emit('chat-message', {
            roomId,
            encryptedData: data,
            iv,
            username
        });

        // For local display, we can use the buffer directly
        const blob = new Blob([buffer], { type: file.type });
        const url = URL.createObjectURL(blob);
        addMessage({ type, content: url, fileName: file.name, fileSize: file.size }, 'my-message', username);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // Reset input
}

// WebRTC Logic
let localStream = null;
let peers = {}; // { socketId: RTCPeerConnection }
const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const videoOverlay = document.getElementById('video-call-overlay');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video'); // Note: This might need to handle multiple videos in future, but for now 1:1 viewing
const callStatus = document.getElementById('call-status');

// Helper to create a peer connection
function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(config);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ type: 'candidate', candidate: event.candidate }, targetId);
        }
    };

    pc.ontrack = (event) => {
        // For now, we assume we are viewing one stream at a time or the last one joined
        remoteVideo.srcObject = event.streams[0];
        callStatus.innerText = "Connected";
        videoOverlay.classList.remove('hidden');
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            closePeer(targetId);
        }
    };

    peers[targetId] = pc;
    return pc;
}

function closePeer(targetId) {
    if (peers[targetId]) {
        peers[targetId].close();
        delete peers[targetId];
    }
    // If no peers left, hide overlay? Or just clear video
    if (Object.keys(peers).length === 0) {
        videoOverlay.classList.add('hidden');
        remoteVideo.srcObject = null;
    }
}

async function joinStream(targetId) {
    // Viewer initiates connection
    try {
        const pc = createPeerConnection(targetId);

        // Create offer to receive (recvonly) or send/recv? 
        // Usually viewer just wants to see. 
        // But standard WebRTC requires at least one track or data channel for some setups, 
        // but recvonly is fine.
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignal({ type: 'offer', sdp: offer }, targetId);
        callStatus.innerText = "Connecting...";
        videoOverlay.classList.remove('hidden');
    } catch (err) {
        console.error("Error joining stream:", err);
    }
}

async function handleSignal(signal, senderId) {
    let pc = peers[senderId];

    if (signal.type === 'offer') {
        // Incoming offer (likely from a viewer if we are sharing, OR from a sharer if they initiated - but we changed flow)
        // In our new flow: Viewer sends offer (recvonly). Sharer answers.

        if (!pc) {
            pc = createPeerConnection(senderId);
        }

        // If we are sharing, add our tracks
        if (screenStream) {
            screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
        }

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignal({ type: 'answer', sdp: answer }, senderId);

    } else if (signal.type === 'answer') {
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }
    } else if (signal.type === 'candidate') {
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
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
        target // Target is now required for 1:1 signaling in Mesh
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
    // Close all peers
    Object.keys(peers).forEach(id => closePeer(id));

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    videoOverlay.classList.add('hidden');
    remoteVideo.srcObject = null;
}

socket.on('receive-message', async ({ encryptedData, iv, senderName, timestamp }) => {
    try {
        const decryptedBuffer = await decryptData(encryptedData, iv);
        const jsonStr = new TextDecoder().decode(decryptedBuffer);
        const payload = JSON.parse(jsonStr);

        let content = payload.content;

        // If it's binary data (image, file, audio), convert base64 back to blob URL
        if (['image', 'file', 'audio'].includes(payload.type)) {
            const binaryString = atob(payload.content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: payload.mimeType || 'application/octet-stream' });
            content = URL.createObjectURL(blob);
        }

        addMessage({
            type: payload.type,
            content: content,
            fileName: payload.fileName,
            fileSize: payload.fileSize
        }, 'their-message', senderName, timestamp);
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

            // Handle object structure { username, isSharing } or legacy string
            let name = user;
            let isSharing = false;
            let socketId = null;

            if (typeof user === 'object') {
                name = user.username;
                isSharing = user.isSharing;
                // We need socketId to join, but room-users array values are just the user objects. 
                // Wait, server sends Object.values(roomUsers[roomId]). 
                // roomUsers[roomId] is { socketId: { username, isSharing } }.
                // So Object.values loses the socketId key! 
                // I need to update server to include socketId in the object.
            }

            li.textContent = name;

            if (isSharing && name !== username) {
                const joinBtn = document.createElement('button');
                joinBtn.innerText = 'Join Stream';
                joinBtn.className = 'join-btn';
                // We need the socketId here. 
                // Temporary fix: I will update server.js to include id.
                // For now, let's assume I fix server.js next.
                joinBtn.onclick = () => joinStream(user.id);
                li.appendChild(joinBtn);
            }

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
    } else if (msgData.type === 'audio') {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.className = 'audio-player';
        audio.src = msgData.content; // Blob URL
        msgDiv.appendChild(audio);
    } else {
        // Default to text message with Markdown (including 'text' type)
        msgDiv.innerHTML = marked.parse(msgData.content);
        msgDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
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

async function copyLink() {
    // Reconstruct full URL with key
    let fullUrl = window.location.href;
    if (cryptoKey) {
        const rawKey = await exportRawKey(cryptoKey);
        const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
        // Ensure we don't double append if it's already there (though we clean it)
        const baseUrl = window.location.href.split('#')[0];
        fullUrl = `${baseUrl}#${roomId}-${base64Key}`;
    }

    navigator.clipboard.writeText(fullUrl);

    const original = linkBox.innerHTML;
    linkBox.innerHTML = `<span style="color: var(--success-color);">✓ Link Copied!</span>`;
    setTimeout(() => {
        linkBox.innerHTML = original;
    }, 2000);
}

// QR Code
async function showQRCode(event) {
    const modalOverlay = document.getElementById('qr-modal-overlay');
    const modal = modalOverlay.querySelector('.modal');
    const container = document.getElementById('qrcode-container');
    container.innerHTML = '';

    // Calculate origin for animation
    if (event && event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;
        const buttonCenterY = rect.top + rect.height / 2;

        const viewportCenterX = window.innerWidth / 2;
        const viewportCenterY = window.innerHeight / 2;

        const deltaX = buttonCenterX - viewportCenterX;
        const deltaY = buttonCenterY - viewportCenterY;

        modal.style.setProperty('--origin-x', `${deltaX}px`);
        modal.style.setProperty('--origin-y', `${deltaY}px`);
    }

    let fullUrl = window.location.href;
    if (cryptoKey) {
        const rawKey = await exportRawKey(cryptoKey);
        const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
        const baseUrl = window.location.href.split('#')[0];
        fullUrl = `${baseUrl}#${roomId}-${base64Key}`;
    }

    QRCode.toCanvas(fullUrl, { width: 200 }, function (err, canvas) {
        if (err) console.error(err);
        container.appendChild(canvas);
    });

    modalOverlay.classList.remove('hidden');
    modal.classList.remove('animate-out');
    modal.classList.add('animate-in');
}

function hideQRCode() {
    const modalOverlay = document.getElementById('qr-modal-overlay');
    const modal = modalOverlay.querySelector('.modal');

    modal.classList.remove('animate-in');
    modal.classList.add('animate-out');
    modalOverlay.classList.add('hidden');

    // Wait for animation to finish
    setTimeout(() => {
        modal.classList.remove('animate-out');
    }, 300); // Match CSS animation duration
}
async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        // Broadcast that we are sharing
        socket.emit('start-screen-share', roomId);

        // Show local preview
        localVideo.srcObject = screenStream;
        videoOverlay.classList.remove('hidden');
        callStatus.innerText = "Sharing Screen (Waiting for viewers...)";

        screenTrack.onended = () => {
            stopScreenShare();
        };

    } catch (err) {
        console.error("Error sharing screen:", err);
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;

        socket.emit('stop-screen-share', roomId);

        // Close all peer connections as we are no longer sharing
        endCall();
    }
}

// Voice Messages
let mediaRecorder = null;
let audioChunks = [];

async function toggleRecording() {
    const btn = document.getElementById('mic-btn');

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.classList.remove('recording');
        btn.innerText = '🎤';
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });

                // Convert to Base64
                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64data = reader.result.split(',')[1]; // Remove data URL prefix

                    const payload = {
                        type: 'audio',
                        content: base64data,
                        mimeType: 'audio/webm',
                        timestamp: Date.now()
                    };

                    const enc = new TextEncoder();
                    const { data, iv } = await encryptData(enc.encode(JSON.stringify(payload)));

                    socket.emit('chat-message', {
                        roomId,
                        encryptedData: data,
                        iv,
                        username
                    });

                    const url = URL.createObjectURL(blob);
                    addMessage({ type: 'audio', content: url }, 'my-message', username);
                };
                reader.readAsDataURL(blob);

                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            btn.classList.add('recording');
            btn.innerText = '⏹️';
        } catch (err) {
            console.error("Error accessing microphone:", err);
            addSystemMessage("Error: Could not access microphone.");
        }
    }
}

// Exports
window.copyLink = copyLink;
window.sendMessage = sendMessage;
window.setUsername = setUsername;
window.handleFileSelect = handleFileSelect;
window.startCall = startCall;
window.endCall = endCall;
window.startScreenShare = startScreenShare;
window.toggleRecording = toggleRecording;
window.showQRCode = showQRCode;
window.hideQRCode = hideQRCode;
window.joinStream = joinStream;

// UI
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

// Start
init();
