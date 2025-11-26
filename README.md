**Burner Chat**

A minimal, lightweight chat demo built with Node.js, Express and Socket.IO. This repository contains a simple static client (`index.html`) and a small server (`server.js`) so you can run a local real-time chat quickly for testing or demos.

**Features**
- **Minimal**: Small code surface; easy to read and adapt.
- **Real-time**: Uses `socket.io` for bi-directional realtime messaging.
- **Standalone**: Single-server setup — no database required for ephemeral chats.

**Quick Start**
- **Prerequisites**: Node.js (v16+) and `npm` installed.
- **Install dependencies**: `npm install`
- **Run the server**: `node server.js`
- **Open the client**: open `index.html` in your browser or visit `http://localhost:3000` if the server serves the file.

If you prefer an `npm` script for starting, add this to `package.json` under `scripts`:

```
"start": "node server.js"
```

Then run: `npm start`.

**Files of interest**
- **`index.html`**: The client UI — open directly or served by the server.
- **`server.js`**: Express + Socket.IO server implementation.
- **`package.json`**: Project metadata and dependencies (`express`, `socket.io`).

**Configuration**
- **Port**: The server listens on port `3000` by default (check `server.js`). To change it, set the `PORT` environment variable: `PORT=8080 node server.js`.

**Development**
- Edit `index.html` and `server.js` to customize behavior and UI.
- Helpful commands:
  - `npm install` : Install dependencies
  - `node server.js` : Start the server

**Deploying / Production Notes**
- This project is intended as a demo. For production use, add:
  - Input sanitization and rate limiting
  - Authentication and session handling
  - Persistent storage if you want message history
  - HTTPS and proper CORS configuration

**Contributing**
- Feel free to open issues or pull requests with improvements, examples or bug fixes.

**License**
- This project does not include an explicit license file. Add a `LICENSE` if you want to define usage terms.

**Contact**
- For quick help, open an issue in this repository.
