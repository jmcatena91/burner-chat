# 🔥 Burner Chat

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16-green.svg)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-black.svg)
![WebRTC](https://img.shields.io/badge/WebRTC-Enabled-red.svg)

**Burner Chat** is a secure, ephemeral, and lightweight real-time messaging application. Designed for privacy, it ensures that your conversations, files, and video calls are encrypted and leave no trace once the session ends.

---

## ✨ Features

- **🔒 End-to-End Encryption**: All messages, files, and drawings are encrypted using AES-GCM (256-bit) before leaving your browser.
- **👻 Ephemeral**: No database. No message history. Data is wiped from memory when the room closes.
- **🔐 Room Passwords**: Optional password protection for extra security when creating rooms.
- **🕵️ Anonymous Mode**: Join without a name. Your identity remains hidden in the chat and user list.
- **🤖 Voice Masking**: Send voice messages with a "Robot" voice effect to mask your real voice.
- **✏️ Encrypted Whiteboard**: Collaborate in real-time on a shared, end-to-end encrypted drawing board.
- **✅ Read Receipts**: See when your messages have been delivered (✓) and read (✓✓) by others.
- **🖥️ Privacy-First Screen Sharing**: Share your screen without a "hall of mirrors" effect, with clear status indicators.
- **❌ Secure End Chat**: Instantly wipe all local data and close the session with a single click.
- **📂 File Sharing**: Send images and files (up to 2MB) securely.
- **🎨 Modern UI**: A sleek, dark-themed interface optimized for both desktop and mobile.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** (v16 or higher)
- **npm** (Node Package Manager)

### Installation

1. **Clone the repository** (if applicable) or download the source code.
2. **Install dependencies**:
   ```bash
   npm install
   ```

### Running the Server

Start the server using the provided script:
```bash
./restart_server.sh
```
*Or manually:*
```bash
node server.js
```

The server will start on port **3000** by default.
## Security

Burner Chat uses Web Crypto API (AES-GCM) for end-to-end encryption. Keys are generated client-side and never sent to the server.

### Features
- **End-to-End Encryption**: Messages and files are encrypted before leaving your device.
- **Ephemeral**: No logs are kept on the server. Data exists only in memory while the room is active.
- **Metadata Protection**: Usernames are encrypted and exchanged only between peers. The server sees all users as "Anonymous".
- **XSS Protection**: All message content is sanitized using DOMPurify.

### Limitations
- **Forward Secrecy**: The same key is used for the duration of the room session. If a key is compromised, past messages in that session could be decrypted.
- **Trust**: The client code is served by the host. In a high-threat model, a compromised host could serve malicious code. For maximum security, audit the code and host it yourself.
- **Browser History**: While we clear the URL immediately, the encryption key may briefly appear in your browser history. Use Incognito mode for better privacy.
### Accessing the App

Open your browser and navigate to:
```
http://localhost:3000
```

1. Click **"Start Chatting"**.
2. Enter a **Display Name**.
3. Share the **Secure Room Link** (top right) with a friend.
4. Start chatting, sharing files, or video calling!

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3 (Variables, Flexbox/Grid), Vanilla JavaScript
- **Backend**: Node.js, Express
- **Real-time Communication**: Socket.IO
- **P2P Video**: WebRTC (STUN via Google)
- **Cryptography**: Web Crypto API (AES-GCM)

---

## 🔒 Security Model

1. **Key Generation**: When a room is created, a random 256-bit AES-GCM key is generated in the browser.
2. **URL Sharing**: This key is encoded in the URL fragment (`#...`). URL fragments are **never sent to the server**.
3. **Encryption**: Every message is encrypted with this key + a unique IV (Initialization Vector) before being sent over the WebSocket.
4. **Decryption**: The recipient's browser uses the key from the URL to decrypt the message.

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to improve features or security.

---

## 📄 License

This project is open-source and available under the MIT License.
