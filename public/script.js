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
const passwordInput = document.getElementById('password-input');

// 1. Initialization Logic
// Immediate URL handling to prevent history leaks
(async function handleUrl() {
    const hash = window.location.hash.substring(1);
    if (hash && hash.includes('-')) {
        const parts = hash.split('-');
        const rId = parts[0];
        const keyPart = parts[1];

        // Save to session immediately
        sessionStorage.setItem(`burner_pending_key_${rId}`, keyPart);

        // Clean URL immediately
        window.history.replaceState(null, null, `#${rId}`);
    }
})();

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

function toggleUsernameInput() {
    const checkbox = document.getElementById('anon-checkbox');
    usernameInput.disabled = checkbox.checked;
    if (checkbox.checked) {
        usernameInput.value = '';
        usernameInput.placeholder = 'Anonymous';
    } else {
        usernameInput.placeholder = 'Your Name';
    }
}

function setUsername() {
    const checkbox = document.getElementById('anon-checkbox');
    const name = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (checkbox.checked) {
        username = 'Anonymous';
    } else if (name) {
        username = name;
    } else {
        return; // Require name if not anon
    }

    if (username) {
        sessionStorage.setItem('burner_username', username);
        if (password) {
            sessionStorage.setItem('burner_room_password', password);
        }
        modalOverlay.classList.add('hidden');
        startChat();
    }
}

async function startChat() {
    const hash = window.location.hash.substring(1); // Get content after #

    if (hash) {
        roomId = hash; // URL is already cleaned or just roomId

        // Check for pending key from immediate handler
        const pendingKey = sessionStorage.getItem(`burner_pending_key_${roomId}`);
        if (pendingKey) {
            try {
                let jwkKey;
                if (pendingKey.startsWith('{') || pendingKey.startsWith('%7B')) {
                    jwkKey = JSON.parse(atob(pendingKey));
                    cryptoKey = await importKey(jwkKey);
                } else {
                    const rawBytes = Uint8Array.from(atob(pendingKey), c => c.charCodeAt(0));
                    cryptoKey = await importRawKey(rawBytes);
                }

                // Save properly
                const rawKey = await exportRawKey(cryptoKey);
                const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
                sessionStorage.setItem(`burner_key_${roomId}`, base64Key);
                sessionStorage.removeItem(`burner_pending_key_${roomId}`);

                addSystemMessage("Joined Secure Room. Key saved to session.");
            } catch (e) {
                console.error(e);
                addSystemMessage("Error: Invalid Room Link.");
                return;
            }
        } else {
            // Try to get key from session (normal restore)
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
        const randomBytes = new Uint8Array(5);
        window.crypto.getRandomValues(randomBytes);
        roomId = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        cryptoKey = await generateKey();

        // Export as Raw
        const rawKey = await exportRawKey(cryptoKey);
        const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));

        // Save to session
        sessionStorage.setItem(`burner_key_${roomId}`, base64Key);

        window.history.replaceState(null, null, `#${roomId}`);
        addSystemMessage("Room Created. Share the URL to invite others.");
    }

    updateLinkBox();

    // Join the socket room
    // Send "Anonymous" to server to hide metadata
    const password = sessionStorage.getItem('burner_room_password');
    socket.emit('join-room', { roomId, username: 'Anonymous', password });

    // Announce real identity via encrypted channel
    setTimeout(announceIdentity, 500); // Wait for connection
}

// Map socketId -> realUsername
const userMap = {};

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

async function announceIdentity() {
    if (!cryptoKey || !username) return;

    const payload = {
        type: 'identity',
        content: username,
        timestamp: Date.now()
    };

    const enc = new TextEncoder();
    const { data, iv } = await encryptData(enc.encode(JSON.stringify(payload)));

    socket.emit('chat-message', {
        roomId,
        encryptedData: data,
        iv,
        username: 'Anonymous' // Metadata hidden
    });
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

    // Stop typing immediately
    sendTypingStatus(false);
}

async function sendTypingStatus(isTyping) {
    if (!cryptoKey) return;
    const payload = {
        type: 'typing_status',
        content: { isTyping },
        timestamp: Date.now()
    };
    const enc = new TextEncoder();
    const { data, iv } = await encryptData(enc.encode(JSON.stringify(payload)));
    socket.emit('chat-message', { roomId, encryptedData: data, iv, username });
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
// const localVideo = document.getElementById('local-video'); // Removed
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

socket.on('receive-message', async ({ encryptedData, iv, senderName, senderId, timestamp }) => {
    try {
        const decryptedBuffer = await decryptData(encryptedData, iv);
        const jsonStr = new TextDecoder().decode(decryptedBuffer);
        const payload = JSON.parse(jsonStr);

        if (payload.type === 'identity') {
            // Update user map
            if (senderId) {
                userMap[senderId] = payload.content;
                updateUserList(); // Refresh list with new name
            }
            return;
        }


        if (payload.type === 'typing_status') {
            const { isTyping } = payload.content;
            const realName = (userMap[senderId]) ? userMap[senderId] : senderName;
            updateTypingIndicator(realName, isTyping);
            return;
        }

        if (payload.type === 'read_receipt') {
            const { messageId } = payload.content;
            const msgDiv = document.getElementById(`msg-${messageId}`);
            if (msgDiv) {
                const statusSpan = msgDiv.querySelector('.read-status');
                if (statusSpan) {
                    statusSpan.innerText = ' ✓✓';
                    statusSpan.title = 'Read';
                    statusSpan.style.color = '#4ade80'; // Green
                }
            }
            return;
        }

        if (payload.type === 'whiteboard') {
            const { action } = payload.content;

            // Notification for drawing (debounced)
            if (action === 'draw') {
                const realName = (userMap[senderId]) ? userMap[senderId] : senderName;
                notifyWhiteboardActivity(realName);
            }

            if (action === 'clear') {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const realName = (userMap[senderId]) ? userMap[senderId] : senderName;
                addSystemMessage(`${realName} cleared the whiteboard.`);
            } else if (action === 'draw') {
                const { x0, y0, x1, y1, color, width } = payload.content;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.stroke();
            }
            return;
        }

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

        // Use mapped name if available
        const realName = (userMap[senderId]) ? userMap[senderId] : senderName;

        addMessage({
            type: payload.type,
            content: content,
            fileName: payload.fileName,
            fileSize: payload.fileSize
        }, 'their-message', realName, timestamp);
    } catch (err) {
        console.error("Decryption failed", err);
    }
});

socket.on('user-connected', ({ username, id }) => {
    // username is 'Anonymous' usually
    addSystemMessage(`A user joined the room.`);

    // Announce our identity to this specific user?
    // Or just broadcast again? Broadcast is easier.
    announceIdentity();
});

socket.on('user-disconnected', ({ username, id }) => {
    const name = userMap[id] || 'A user';
    addSystemMessage(`${name} left the room.`);
    delete userMap[id];
    updateUserList();
});

let currentRoomUsers = []; // Store raw list from server
let previousSharingStates = {}; // Map socketId -> boolean

socket.on('room-users', (users) => {
    // Check for sharing status changes
    users.forEach(user => {
        const wasSharing = previousSharingStates[user.id] || false;
        const isSharing = user.isSharing;

        if (isSharing && !wasSharing) {
            const name = userMap[user.id] || user.username;
            addSystemMessage(`${name} started sharing their screen.`);
        } else if (!isSharing && wasSharing) {
            const name = userMap[user.id] || user.username;
            addSystemMessage(`${name} stopped sharing their screen.`);
        }

        previousSharingStates[user.id] = isSharing;
    });

    currentRoomUsers = users;
    updateUserList();
});

socket.on('error-message', (msg) => {
    alert(msg);
    // If password error, reload to try again
    if (msg === 'Incorrect password') {
        sessionStorage.removeItem('burner_room_password');
        window.location.reload();
    }
});

function updateUserList() {
    const userListEl = document.getElementById('user-list');
    const userCountBadge = document.getElementById('user-count-badge');

    if (!Array.isArray(currentRoomUsers)) return;

    if (userListEl) {
        userListEl.innerHTML = '';
        currentRoomUsers.forEach(user => {
            const li = document.createElement('li');

            // Handle object structure { username, isSharing, id }
            let name = user.username;
            let isSharing = user.isSharing;
            let socketId = user.id;

            // Use mapped name if available
            if (userMap[socketId]) {
                name = userMap[socketId];
            } else if (socketId === socket.id && username) {
                // If it's me, use my local username variable (unless I'm anon)
                name = username;
            }

            li.textContent = name;

            if (isSharing && name !== username) {
                const joinBtn = document.createElement('button');
                joinBtn.innerText = 'Join Stream';
                joinBtn.className = 'join-btn';
                joinBtn.onclick = () => joinStream(socketId);
                li.appendChild(joinBtn);
            }

            userListEl.appendChild(li);
        });
    }

    if (userCountBadge) {
        userCountBadge.innerText = currentRoomUsers.length;
    }
}

// Typing Indicators
messageInput.addEventListener('input', () => {
    sendTypingStatus(true);

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        sendTypingStatus(false);
    }, 1000);
});

function updateTypingIndicator(name, isTyping) {
    if (isTyping) {
        typingIndicator.innerText = `${name} is typing...`;
        typingIndicator.classList.add('visible');
    } else {
        typingIndicator.classList.remove('visible');
    }
}


// UI Helpers
function addMessage(data, className, senderName, timestamp = Date.now()) {
    const chatContainer = document.getElementById('chat-container');
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${className}`;

    // Generate a unique ID for the message to track read status
    const messageId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    wrapper.id = `msg-${messageId}`;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'username-label';
    nameLabel.innerText = senderName;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';

    // Content handling...
    if (data.type === 'text') {
        const cleanHtml = DOMPurify.sanitize(marked.parse(data.content));
        msgDiv.innerHTML = cleanHtml;
        msgDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } else if (data.type === 'image') {
        const img = document.createElement('img');
        img.src = data.content;
        msgDiv.appendChild(img);
    } else if (data.type === 'file') {
        const link = document.createElement('a');
        link.href = data.content;
        link.download = data.fileName;
        link.className = 'file-attachment';
        link.innerHTML = `📄 ${data.fileName} <span style="font-size:0.8em; opacity:0.7">(${formatBytes(data.fileSize)})</span>`;
        msgDiv.appendChild(link);
    } else if (data.type === 'audio') {
        const audio = document.createElement('audio');
        audio.src = data.content;
        audio.controls = true;
        audio.className = 'audio-player';
        msgDiv.appendChild(audio);
    } else {
        const rawHtml = marked.parse(data.content);
        const cleanHtml = DOMPurify.sanitize(rawHtml);
        msgDiv.innerHTML = cleanHtml;
        msgDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    const timeDiv = document.createElement('span');
    timeDiv.className = 'timestamp';
    const date = timestamp ? new Date(timestamp) : new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Add read status indicator for my messages
    let statusHtml = '';
    if (className === 'my-message') {
        statusHtml = ` <span class="read-status" style="margin-left:5px; font-weight:bold;">✓</span>`;
    }

    timeDiv.innerHTML = `${timeStr}${statusHtml}`;
    msgDiv.appendChild(timeDiv);

    if (className === 'their-message') {
        if (senderName !== 'Anonymous') {
            wrapper.appendChild(nameLabel);
        }
        // Observe for read receipt
        observeMessage(wrapper, messageId);
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

// Read Receipt Observer
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const messageId = entry.target.dataset.messageId;
            if (messageId) {
                sendReadReceipt(messageId);
                observer.unobserve(entry.target); // Only send once
            }
        }
    });
}, { threshold: 0.5 });

function observeMessage(element, messageId) {
    element.dataset.messageId = messageId;
    observer.observe(element);
}

async function sendReadReceipt(messageId) {
    if (!cryptoKey) return;

    const payload = {
        type: 'read_receipt',
        content: { messageId },
        timestamp: Date.now()
    };

    const enc = new TextEncoder();
    const { data: encrypted, iv } = await encryptData(enc.encode(JSON.stringify(payload)));

    socket.emit('chat-message', { roomId, encryptedData: encrypted, iv, username });
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

        // Do NOT show local preview in the main video overlay (hall of mirrors)
        // Instead, show a floating status
        const statusDiv = document.createElement('div');
        statusDiv.id = 'screen-share-status';
        statusDiv.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff4444;
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            z-index: 3000;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            font-weight: bold;
        `;
        statusDiv.innerText = "Stop Sharing Screen";
        statusDiv.onclick = stopScreenShare;
        document.body.appendChild(statusDiv);

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

        // Remove status overlay
        const statusDiv = document.getElementById('screen-share-status');
        if (statusDiv) statusDiv.remove();
    }
}

// Voice Messages
let mediaRecorder = null;
let audioChunks = [];
let audioContext = null;
let mediaStreamSource = null;
let workletNode = null;

async function toggleRecording() {
    const btn = document.getElementById('mic-btn');
    const effect = document.getElementById('voice-effect').value;

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.classList.remove('recording');
        btn.innerText = '🎤';

        // Cleanup AudioContext if used
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            let recordingStream = stream;

            if (effect === 'robot') {
                // Initialize AudioContext
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                mediaStreamSource = audioContext.createMediaStreamSource(stream);

                // Create Ring Modulator Effect
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sine';
                oscillator.frequency.value = 50; // Low frequency for robotic growl

                const gainNode = audioContext.createGain();
                gainNode.gain.value = 0.0; // Start at 0, will be modulated

                // We want to multiply source * oscillator.
                // Web Audio API doesn't have a simple "multiply" node, but we can use GainNode modulation.
                // Source -> GainNode (gain controlled by Oscillator) -> Destination

                // Actually, a better "Robot" effect is often a Ring Modulator.
                // Source -> GainNode (Input)
                // Oscillator -> GainNode.gain

                const ringMod = audioContext.createGain();
                ringMod.gain.value = 0.0; // Controlled by oscillator

                // Connect Oscillator to Gain param
                oscillator.connect(ringMod.gain);

                // Connect Source to Ring Mod
                mediaStreamSource.connect(ringMod);

                // Create Destination
                const dest = audioContext.createMediaStreamDestination();
                ringMod.connect(dest);

                oscillator.start();
                recordingStream = dest.stream;
            }

            mediaRecorder = new MediaRecorder(recordingStream);
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

                // Stop all tracks
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

function endChat() {
    if (confirm("Are you sure? This will delete all local data and leave the chat.")) {
        // Clear all storage
        sessionStorage.clear();
        localStorage.clear();

        // Close socket
        socket.disconnect();

        // Attempt to close window
        window.close();

        // If window.close() fails (which it often does if not opened by script), show overlay
        document.body.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#111; color:#fff; font-family:sans-serif;">
                <h1>Chat Ended</h1>
                <p>All local data has been destroyed.</p>
                <p>You can safely close this tab now.</p>
                <button onclick="window.location.href='/'" style="margin-top:20px; padding:10px 20px; cursor:pointer;">Go Home</button>
            </div>
        `;
    }
}

// Whiteboard Logic
const canvas = document.getElementById('whiteboard-canvas');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let lastX = 0;
let lastY = 0;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 50; // Subtract controls height
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function toggleWhiteboard() {
    const wb = document.getElementById('whiteboard-overlay');
    wb.classList.toggle('hidden');
    if (!wb.classList.contains('hidden')) {
        resizeCanvas();
    }
}

function clearWhiteboard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sendDrawEvent('clear', {});
}

function startDrawing(e) {
    isDrawing = true;
    [lastX, lastY] = [e.offsetX || e.touches[0].clientX, e.offsetY || e.touches[0].clientY - 50]; // Adjust for header
}

function draw(e) {
    if (!isDrawing) return;

    const x = e.offsetX || e.touches[0].clientX;
    const y = e.offsetY || (e.touches[0].clientY - 50);

    const color = document.getElementById('wb-color').value;
    const width = document.getElementById('wb-width').value;

    // Draw locally
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Send event
    sendDrawEvent('draw', {
        x0: lastX, y0: lastY, x1: x, y1: y, color, width
    });

    [lastX, lastY] = [x, y];
}

function stopDrawing() {
    isDrawing = false;
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// Touch support
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startDrawing(e);
});
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    draw(e);
});
canvas.addEventListener('touchend', stopDrawing);

async function sendDrawEvent(action, data) {
    if (!cryptoKey) return;

    const payload = {
        type: 'whiteboard',
        content: { action, ...data },
        timestamp: Date.now()
    };

    const enc = new TextEncoder();
    const { data: encrypted, iv } = await encryptData(enc.encode(JSON.stringify(payload)));

    socket.emit('chat-message', { roomId, encryptedData: encrypted, iv, username });
}

// Exports
window.copyLink = copyLink;
window.sendMessage = sendMessage;
window.setUsername = setUsername;
window.handleFileSelect = handleFileSelect;
window.startScreenShare = startScreenShare;
window.toggleRecording = toggleRecording;
window.showQRCode = showQRCode;
window.hideQRCode = hideQRCode;
window.joinStream = joinStream;
window.toggleWhiteboard = toggleWhiteboard;
window.clearWhiteboard = clearWhiteboard;
window.toggleUsernameInput = toggleUsernameInput;

// UI
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

// Whiteboard Notification Debounce
let wbNotificationTimeout = {};
function notifyWhiteboardActivity(name) {
    if (wbNotificationTimeout[name]) return;

    addSystemMessage(`${name} is drawing on the whiteboard.`);
    wbNotificationTimeout[name] = setTimeout(() => {
        delete wbNotificationTimeout[name];
    }, 30000); // Notify at most once every 30 seconds per user
}

// Start
init();
