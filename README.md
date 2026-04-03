# Church Live Translation

Real-time audio translation distribution system. A translator speaks into a mic in the booth — their audio streams live to listener phones, with live word-by-word transcription powered by Deepgram.

## Project Structure

```
church-translator/
├── server/
│   ├── server.js        # Node.js WebSocket + Express server
│   └── package.json
└── public/
    ├── booth.html       # Translator input page
    └── listener.html    # Congregation output page
```

## Setup & Run

**1. Install dependencies**
```bash
cd server && npm install
```

**2. Set your Deepgram API key** (required for transcription; audio relay works without it)
```bash
export DEEPGRAM_API_KEY=your_key_here
```

**3. Start the server**
```bash
node server.js
```

**4. Open pages**
- Translator booth: `http://localhost:3000/booth.html`
- Listener phones: `http://localhost:3000/listener.html`

> Listeners must be on the same network. Use the machine's **LAN IP** (e.g. `http://192.168.1.x:3000/listener.html`), not `localhost`.

---

## Production / Internet Access

Deploy the `server/` directory to a VPS (Railway, Render, DigitalOcean, etc.).

The HTML files automatically use `wss://` (secure WebSocket) when served over HTTPS — no code changes needed.

Set the `DEEPGRAM_API_KEY` environment variable in your hosting platform's dashboard.

---

## How It Works

1. **Booth** captures mic audio via `MediaRecorder` (WebM/Opus, 250ms chunks) and sends binary chunks over WebSocket.
2. **Server** fans out the binary audio to all connected listener clients and simultaneously forwards it to Deepgram for transcription.
3. **Listeners** receive binary audio chunks, decode them with the Web Audio API, and play them back with a jitter buffer to avoid gaps. Transcript text appears line by line as Deepgram returns results.

### iOS Note
Safari on iOS requires a user gesture to start audio playback. Listeners on iPhone/iPad will see a "Tap to Start Audio" prompt on first connection.
