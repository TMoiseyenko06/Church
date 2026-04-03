const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

if (!DEEPGRAM_API_KEY) {
  console.warn('[WARN] DEEPGRAM_API_KEY not set — transcription will be disabled, audio relay still works');
}

// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Track connected clients
const boothClients = new Set();
const listenerClients = new Set();

let deepgramConnection = null;
let deepgramClient = null;

function timestamp() {
  return new Date().toISOString();
}

function broadcastToListeners(data) {
  for (const client of listenerClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastListenerCount() {
  const msg = JSON.stringify({ type: 'listeners', count: listenerClients.size });
  for (const client of boothClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

async function openDeepgramConnection() {
  if (!DEEPGRAM_API_KEY) return;

  try {
    const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
    deepgramClient = createClient(DEEPGRAM_API_KEY);

    deepgramConnection = deepgramClient.listen.live({
      model: 'nova-2',
      language: 'en-US',
      encoding: 'opus',
      sample_rate: 48000,
      interim_results: true,
      punctuate: true,
      endpointing: 300,
    });

    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
      console.log(`[${timestamp()}] Deepgram connection opened`);
    });

    deepgramConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = data?.channel?.alternatives?.[0];
      if (!alt || !alt.transcript) return;

      const msg = JSON.stringify({
        type: 'transcript',
        text: alt.transcript,
        is_final: data.is_final,
      });
      broadcastToListeners(msg);
    });

    deepgramConnection.on(LiveTranscriptionEvents.Error, (err) => {
      console.error(`[${timestamp()}] Deepgram error:`, err);
    });

    deepgramConnection.on(LiveTranscriptionEvents.Close, () => {
      console.log(`[${timestamp()}] Deepgram connection closed`);
      deepgramConnection = null;
    });

  } catch (err) {
    console.error(`[${timestamp()}] Failed to open Deepgram connection:`, err);
    deepgramConnection = null;
  }
}

function closeDeepgramConnection() {
  if (deepgramConnection) {
    try {
      deepgramConnection.finish();
    } catch (e) {
      // ignore
    }
    deepgramConnection = null;
  }
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[${timestamp()}] WebSocket connected from ${ip}`);

  let clientType = null;

  ws.on('message', (data, isBinary) => {
    if (clientType === null) {
      // First message must be JSON identification
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'booth') {
          clientType = 'booth';
          boothClients.add(ws);
          console.log(`[${timestamp()}] Booth connected (${ip})`);

          // Send current listener count to new booth
          ws.send(JSON.stringify({ type: 'listeners', count: listenerClients.size }));

          // Open Deepgram connection for this booth session
          if (!deepgramConnection) {
            openDeepgramConnection();
          }

        } else if (msg.type === 'listener') {
          clientType = 'listener';
          listenerClients.add(ws);
          console.log(`[${timestamp()}] Listener connected (${ip}) — total: ${listenerClients.size}`);
          broadcastListenerCount();

        } else {
          console.warn(`[${timestamp()}] Unknown client type: ${msg.type}`);
        }
      } catch (e) {
        console.error(`[${timestamp()}] Failed to parse identification message:`, e);
      }
      return;
    }

    if (clientType === 'booth') {
      if (isBinary) {
        // Forward audio to all listeners
        broadcastToListeners(data);

        // Forward audio to Deepgram
        if (deepgramConnection) {
          try {
            deepgramConnection.send(data);
          } catch (e) {
            console.error(`[${timestamp()}] Error sending to Deepgram:`, e);
          }
        }
      }
    }
    // Listeners don't send meaningful messages after identification
  });

  ws.on('close', () => {
    if (clientType === 'booth') {
      boothClients.delete(ws);
      console.log(`[${timestamp()}] Booth disconnected (${ip})`);

      // Close Deepgram if no more booth clients
      if (boothClients.size === 0) {
        closeDeepgramConnection();
      }
    } else if (clientType === 'listener') {
      listenerClients.delete(ws);
      console.log(`[${timestamp()}] Listener disconnected (${ip}) — total: ${listenerClients.size}`);
      broadcastListenerCount();
    }
  });

  ws.on('error', (err) => {
    console.error(`[${timestamp()}] WebSocket error (${ip}):`, err.message);
    boothClients.delete(ws);
    listenerClients.delete(ws);
    broadcastListenerCount();
  });
});

server.listen(PORT, () => {
  console.log(`[${timestamp()}] Church translator server running on port ${PORT}`);
  console.log(`  Booth:    http://localhost:${PORT}/booth.html`);
  console.log(`  Listener: http://localhost:${PORT}/listener.html`);
  if (!DEEPGRAM_API_KEY) {
    console.log('  Transcription: DISABLED (set DEEPGRAM_API_KEY to enable)');
  }
});
