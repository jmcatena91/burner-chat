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
    const storedName = localStorage.getItem('burner_username');
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
        localStorage.setItem('burner_username', username);
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
            const jwkKey = JSON.parse(atob(parts[1])); // Decode key
            cryptoKey = await importKey(jwkKey);
            addSystemMessage("Joined Secure Room.");
        } catch (e) {
            addSystemMessage("Error: Invalid Room Link.");
            return;
        }
    } else {
        // User is creating a new room
        roomId = Math.random().toString(36).substring(2, 10);
        cryptoKey = await generateKey();
        const exportedKey = await exportKey(cryptoKey);
        const hashString = `${roomId}-${btoa(JSON.stringify(exportedKey))}`;

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

async function exportKey(key) {
    return await window.crypto.subtle.exportKey("jwk", key);
}

async function encryptMessage(text) {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv }, cryptoKey, enc.encode(text)
    );
    return {
        data: Array.from(new Uint8Array(encrypted)), // Convert to array for socket
        iv: Array.from(iv)
    };
}

async function decryptMessage(data, iv) {
    const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        cryptoKey,
        new Uint8Array(data)
    );
    return new TextDecoder().decode(decrypted);
}

// 3. Chat Logic
async function sendMessage(e) {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !cryptoKey) return;

    // Encrypt
    const { data, iv } = await encryptMessage(text);

    // Send to server
    socket.emit('chat-message', {
        roomId,
        encryptedData: data,
        iv,
        username: username // Send username in plain text (metadata)
    });

    addMessage(text, 'my-message', username);
    messageInput.value = '';
    socket.emit('stop-typing', roomId);
}

socket.on('receive-message', async ({ encryptedData, iv, senderName, timestamp }) => {
    try {
        const text = await decryptMessage(encryptedData, iv);
        addMessage(text, 'their-message', senderName, timestamp);
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

socket.on('room-users', (count) => {
    if (onlineCountEl) onlineCountEl.innerText = count;
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
function addMessage(text, className, senderName, timeStr) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${className}`;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'username-label';
    nameLabel.textContent = senderName || 'Unknown';

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    msgDiv.textContent = text;

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

// Start
init();
