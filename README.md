# 🔥 Burner Chat

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16-green.svg)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-black.svg)
![WebRTC](https://img.shields.io/badge/WebRTC-Enabled-red.svg)

**Burner Chat** is a secure, ephemeral, and lightweight real-time messaging application. Designed for privacy, it ensures that your conversations, files, and video calls are encrypted and leave no trace once the session ends.

---

## ✨ Features

- **🔒 End-to-End Encryption**: All messages and files are encrypted using AES-GCM (256-bit) before leaving your browser. The server never sees the raw content.
- **👻 Ephemeral**: No database. No message history. Once you close the tab, the data is gone forever.
- **📹 Secure Video Calling**: Peer-to-peer encrypted video calls using WebRTC.
- **📂 File Sharing**: Send images and files (up to 2MB) securely.
- **🔗 Short, Secure Links**: Shareable links contain the encryption key in the URL fragment, ensuring only those with the link can decrypt the chat.
- **👥 User List**: See who is currently in the room with you.
- **🎨 Modern UI**: A sleek, dark-themed interface with glassmorphism effects.

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
