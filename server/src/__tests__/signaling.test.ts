import { WebSocket, WebSocketServer } from 'ws';
import https from 'https';
import { CameraRegistry } from '../camera-registry';
import { setupSignaling } from '../signaling';
import { SlotId, WsMessage } from '../../../shared/types';
import selfsigned from 'selfsigned';

describe('Signaling', () => {
  let server: https.Server;
  let registry: CameraRegistry;
  let port: number;
  const openSockets: WebSocket[] = [];

  beforeAll((done) => {
    registry = new CameraRegistry();
    registry.initSlots({ 1: 'GAUCHE', 2: 'DROITE', 3: 'FOND', 4: 'JUGE' });

    const pems = selfsigned.generate([{ name: 'commonName', value: 'test' }], { days: 1 });
    server = https.createServer({ key: pems.private, cert: pems.cert });
    setupSignaling(server, registry);

    server.listen(0, () => {
      port = (server.address() as any).port;
      done();
    });
  });

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    openSockets.length = 0;
  });

  afterAll((done) => {
    server.close(() => done());
  });

  function createWs(): Promise<WebSocket> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`wss://localhost:${port}`, {
        rejectUnauthorized: false,
      });
      openSockets.push(ws);
      ws.on('open', () => resolve(ws));
    });
  }

  function waitForMessage(ws: WebSocket): Promise<WsMessage> {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  function collectMessages(ws: WebSocket, count: number): Promise<WsMessage[]> {
    return new Promise((resolve) => {
      const messages: WsMessage[] = [];
      const handler = (data: any) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= count) {
          ws.off('message', handler);
          resolve(messages);
        }
      };
      ws.on('message', handler);
    });
  }

  it('should send slots-state on arbitre-join', async () => {
    const ws = await createWs();
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify({ type: 'arbitre-join' }));
    const msg = await msgPromise;

    expect(msg.type).toBe('slots-state');
    if (msg.type === 'slots-state') {
      expect(msg.slots).toHaveLength(4);
      expect(msg.slots[0].name).toBe('GAUCHE');
    }
  });

  it('should accept camera-join with valid token and send both messages', async () => {
    const ws = await createWs();
    const slot = registry.getSlot(1 as SlotId)!;

    // Camera-join triggers both a broadcast (slot-updated) and a direct send (slots-state)
    const msgsPromise = collectMessages(ws, 2);
    ws.send(JSON.stringify({ type: 'camera-join', slotId: 1, token: slot.token, name: '' }));
    const msgs = await msgsPromise;

    const types = msgs.map((m) => m.type);
    expect(types).toContain('slots-state');
    expect(types).toContain('slot-updated');
  });

  it('should reject camera-join with invalid token', async () => {
    const ws = await createWs();
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify({ type: 'camera-join', slotId: 1, token: 'bad-token', name: '' }));
    const msg = await msgPromise;

    expect(msg.type).toBe('error');
    if (msg.type === 'error') {
      expect(msg.message).toContain('Invalid token');
    }
  });

  it('should broadcast slot-updated when camera connects', async () => {
    const arbitreWs = await createWs();
    const cameraWs = await createWs();

    // Arbitre joins
    const arbitreMsg = waitForMessage(arbitreWs);
    arbitreWs.send(JSON.stringify({ type: 'arbitre-join' }));
    await arbitreMsg; // slots-state

    // Camera joins — arbitre should receive slot-updated
    const slot = registry.getSlot(2 as SlotId)!;
    const updatePromise = waitForMessage(arbitreWs);
    cameraWs.send(JSON.stringify({ type: 'camera-join', slotId: 2, token: slot.token, name: '' }));
    const update = await updatePromise;

    expect(update.type).toBe('slot-updated');
    if (update.type === 'slot-updated') {
      expect(update.slot.slotId).toBe(2);
      expect(update.slot.cameraConnected).toBe(true);
    }
  });

  it('should handle invalid JSON gracefully', async () => {
    const ws = await createWs();
    const msgPromise = waitForMessage(ws);

    ws.send('not valid json');
    const msg = await msgPromise;

    expect(msg.type).toBe('error');
    if (msg.type === 'error') {
      expect(msg.message).toContain('Invalid JSON');
    }
  });

  it('should relay arbitre-connect as relay-connect-request to camera', async () => {
    const arbitreWs = await createWs();
    const cameraWs = await createWs();

    // Camera joins slot 3
    const slot = registry.getSlot(3 as SlotId)!;
    const camMsg = collectMessages(cameraWs, 2); // slot-updated + slots-state
    cameraWs.send(JSON.stringify({ type: 'camera-join', slotId: 3, token: slot.token, name: '' }));
    await camMsg;

    // Arbitre joins
    const arbMsg = waitForMessage(arbitreWs);
    arbitreWs.send(JSON.stringify({ type: 'arbitre-join' }));
    await arbMsg;

    // Arbitre requests connection to slot 3
    const relayPromise = waitForMessage(cameraWs);
    arbitreWs.send(JSON.stringify({ type: 'arbitre-connect', slotId: 3 }));
    const relayMsg = await relayPromise;

    expect(relayMsg.type).toBe('relay-connect-request');
    if (relayMsg.type === 'relay-connect-request') {
      expect(relayMsg.slotId).toBe(3);
    }
  });
});
