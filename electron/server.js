const https = require('https');
const express = require('express');
const path = require('path');
const os = require('os');
const { createServer } = require('net');
const { WebSocketServer, WebSocket } = require('ws');
const { ensureCertificates } = require('./tls');
const { CameraRegistry } = require('./camera-registry');

function findFreePort(start) {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(start, () => {
      s.close(() => resolve(start));
    });
    s.on('error', () => resolve(findFreePort(start + 1)));
  });
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

function setupSignaling(server, registry) {
  const wss = new WebSocketServer({ server });
  const clients = new Map();

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  function sendTo(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function findClient(role, slotId) {
    for (const info of clients.values()) {
      if (info.role === role && (slotId === undefined || info.slotId === slotId)) {
        return info;
      }
    }
    return undefined;
  }

  wss.on('connection', (ws) => {
    const info = { ws, role: 'unknown' };
    clients.set(ws, info);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendTo(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      switch (msg.type) {
        case 'camera-join': {
          if (!registry.validateToken(msg.slotId, msg.token)) {
            sendTo(ws, { type: 'error', message: 'Invalid token for slot' });
            return;
          }
          info.role = 'camera';
          info.slotId = msg.slotId;
          const slot = registry.setCameraConnected(msg.slotId, true);
          if (slot) broadcast({ type: 'slot-updated', slot });
          sendTo(ws, { type: 'slots-state', slots: registry.getAllSlots() });
          break;
        }
        case 'camera-leave': {
          const slot = registry.setCameraConnected(msg.slotId, false);
          if (slot) broadcast({ type: 'slot-updated', slot });
          break;
        }
        case 'camera-offer': {
          const arbitre = findClient('arbitre');
          if (arbitre) sendTo(arbitre.ws, { type: 'relay-offer', slotId: msg.slotId, sdp: msg.sdp });
          break;
        }
        case 'camera-ice': {
          const arbitre = findClient('arbitre');
          if (arbitre) sendTo(arbitre.ws, { type: 'relay-ice', slotId: msg.slotId, candidate: msg.candidate, from: 'camera' });
          break;
        }
        case 'arbitre-join': {
          info.role = 'arbitre';
          sendTo(ws, { type: 'slots-state', slots: registry.getAllSlots() });
          break;
        }
        case 'arbitre-connect': {
          const camera = findClient('camera', msg.slotId);
          if (camera) sendTo(camera.ws, { type: 'relay-connect-request', slotId: msg.slotId });
          break;
        }
        case 'arbitre-answer': {
          const camera = findClient('camera', msg.slotId);
          if (camera) sendTo(camera.ws, { type: 'relay-answer', slotId: msg.slotId, sdp: msg.sdp });
          break;
        }
        case 'arbitre-ice': {
          const camera = findClient('camera', msg.slotId);
          if (camera) sendTo(camera.ws, { type: 'relay-ice', slotId: msg.slotId, candidate: msg.candidate, from: 'arbitre' });
          break;
        }
        default:
          sendTo(ws, { type: 'error', message: 'Unknown message type' });
      }
    });

    ws.on('close', () => {
      const clientInfo = clients.get(ws);
      if (clientInfo?.role === 'camera' && clientInfo.slotId) {
        const slot = registry.setCameraConnected(clientInfo.slotId, false);
        if (slot) broadcast({ type: 'slot-updated', slot });
      }
      clients.delete(ws);
    });
  });
}

async function startServer() {
  const appExpress = express();
  appExpress.use(express.json());

  const registry = new CameraRegistry();

  // API routes
  appExpress.post('/api/setup', (req, res) => {
    const { slots } = req.body;
    if (!slots || typeof slots !== 'object') {
      return res.status(400).json({ error: 'Invalid slots configuration' });
    }
    registry.initSlots(slots);
    res.json({ slots: registry.getAllSlots() });
  });

  appExpress.get('/api/slots', (_req, res) => {
    res.json({ slots: registry.getAllSlots() });
  });

  // Serve static client files
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  appExpress.use(express.static(clientDist));
  // SPA fallback — Express v5 uses {*path} instead of *
  appExpress.get('{*path}', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // Find port & start
  const port = await findFreePort(parseInt(process.env.PORT || '3000', 10));
  const { key, cert } = ensureCertificates();
  const server = https.createServer({ key, cert }, appExpress);

  setupSignaling(server, registry);

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const ips = getLocalIPs();
      const urls = ips.map((ip) => `https://${ip}:${port}/setup`);
      if (urls.length === 0) urls.push(`https://localhost:${port}/setup`);
      resolve({ server, port, urls, ips });
    });
    server.on('error', reject);
  });
}

module.exports = { startServer };
