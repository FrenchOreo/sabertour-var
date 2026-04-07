import https from 'https';
import http from 'http';
import express from 'express';
import path from 'path';
import os from 'os';
import { createServer } from 'net';
import { ensureCertificates } from './tls';
import { setupSignaling } from './signaling';
import { CameraRegistry } from './camera-registry';
import exportRouter from './export';

const app = express();
app.use(express.json());

// Camera registry
const registry = new CameraRegistry();
let serverPort = 3000;

// API routes
app.use(exportRouter);

// Setup API — initialize slots
app.post('/api/setup', (req, res) => {
  const { slots } = req.body;
  if (!slots || typeof slots !== 'object') {
    return res.status(400).json({ error: 'Invalid slots configuration' });
  }
  registry.initSlots(slots);
  res.json({ slots: registry.getAllSlots() });
});

app.get('/api/slots', (_req, res) => {
  res.json({ slots: registry.getAllSlots() });
});

app.get('/api/network', (_req, res) => {
  res.json({ ips: getLocalIPs(), port: serverPort });
});

// Serve static client files
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));

// SPA fallback — all non-API routes serve index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Find free port
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(start, () => {
      s.close(() => resolve(start));
    });
    s.on('error', () => resolve(findFreePort(start + 1)));
  });
}

// Get local IPs sorted by priority
function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  // Sort by priority: 192.168.x.x first, 10.x.x.x second, 172.16-31.x.x third, others last
  const priority = (ip: string): number => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    const parts = ip.split('.');
    if (parts[0] === '172') {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return 2;
    }
    return 3;
  };
  ips.sort((a, b) => priority(a) - priority(b));
  return ips;
}

async function main() {
  const preferredPort = parseInt(process.env.PORT || '3000', 10);
  const port = await findFreePort(preferredPort);
  serverPort = port;

  const { key, cert } = ensureCertificates();
  const server = https.createServer({ key, cert }, app);

  // Also start HTTP server that redirects to HTTPS
  const httpApp = express();
  httpApp.get('*', (req, res) => {
    res.redirect(`https://${req.hostname}:${port}${req.url}`);
  });
  const httpServer = http.createServer(httpApp);

  setupSignaling(server, registry);

  server.listen(port, () => {
    const ips = getLocalIPs();
    const urls = ips.map((ip) => `https://${ip}:${port}/setup`);

    console.log('');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║  SABER VAR — Système VAR actif                    ║');
    console.log('║                                                   ║');
    console.log('║  ⚠️  Sur les téléphones :                          ║');
    console.log('║  1. Ouvrir l\'URL ci-dessous                       ║');
    console.log('║  2. Appuyer "Avancé" → "Continuer quand même"     ║');
    console.log('║     (avertissement certificat — normal)           ║');
    console.log('║                                                   ║');
    console.log('║  URLs disponibles :                               ║');
    for (const url of urls) {
      console.log(`║  → ${url.padEnd(45)}║`);
    }
    if (urls.length === 0) {
      console.log(`║  → https://localhost:${port}/setup`.padEnd(52) + '║');
    }
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');

    // Open browser
    const setupUrl = `https://localhost:${port}/setup`;
    const cmd =
      process.platform === 'win32'
        ? `start ${setupUrl}`
        : process.platform === 'darwin'
        ? `open ${setupUrl}`
        : `xdg-open ${setupUrl}`;
    require('child_process').exec(cmd, () => {});
  });

  // HTTP redirect on port+1 (best effort)
  httpServer.listen(port + 1, () => {}).on('error', () => {});
}

main().catch(console.error);
