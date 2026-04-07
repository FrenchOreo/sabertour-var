import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'https';
import { CameraRegistry } from './camera-registry';
import { SlotId, WsMessage } from '../../shared/types';

interface ClientInfo {
  ws: WebSocket;
  role: 'camera' | 'arbitre' | 'unknown';
  slotId?: SlotId;
}

export function setupSignaling(server: Server, registry: CameraRegistry): void {
  const wss = new WebSocketServer({ server });
  const clients = new Map<WebSocket, ClientInfo>();

  function broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  function sendTo(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function findClient(role: string, slotId?: SlotId): ClientInfo | undefined {
    for (const info of clients.values()) {
      if (info.role === role && (slotId === undefined || info.slotId === slotId)) {
        return info;
      }
    }
    return undefined;
  }

  wss.on('connection', (ws) => {
    const info: ClientInfo = { ws, role: 'unknown' };
    clients.set(ws, info);

    ws.on('message', (raw) => {
      let msg: WsMessage;
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
          if (slot) {
            broadcast({ type: 'slot-updated', slot });
          }
          // Send current slots state to the new camera
          sendTo(ws, { type: 'slots-state', slots: registry.getAllSlots() });
          break;
        }

        case 'camera-leave': {
          const slot = registry.setCameraConnected(msg.slotId, false);
          if (slot) {
            broadcast({ type: 'slot-updated', slot });
          }
          break;
        }

        case 'camera-offer': {
          // Relay offer to the arbitre
          const arbitre = findClient('arbitre');
          if (arbitre) {
            sendTo(arbitre.ws, { type: 'relay-offer', slotId: msg.slotId, sdp: msg.sdp });
          }
          break;
        }

        case 'camera-ice': {
          const arbitre = findClient('arbitre');
          if (arbitre) {
            sendTo(arbitre.ws, { type: 'relay-ice', slotId: msg.slotId, candidate: msg.candidate, from: 'camera' });
          }
          break;
        }

        case 'arbitre-join': {
          info.role = 'arbitre';
          sendTo(ws, { type: 'slots-state', slots: registry.getAllSlots() });
          break;
        }

        case 'arbitre-connect': {
          // Arbitre wants to connect to a slot — tell the camera to create an offer
          const camera = findClient('camera', msg.slotId);
          if (camera) {
            sendTo(camera.ws, { type: 'relay-connect-request', slotId: msg.slotId });
          }
          break;
        }

        case 'arbitre-answer': {
          const camera = findClient('camera', msg.slotId);
          if (camera) {
            sendTo(camera.ws, { type: 'relay-answer', slotId: msg.slotId, sdp: msg.sdp });
          }
          break;
        }

        case 'arbitre-ice': {
          const camera = findClient('camera', msg.slotId);
          if (camera) {
            sendTo(camera.ws, { type: 'relay-ice', slotId: msg.slotId, candidate: msg.candidate, from: 'arbitre' });
          }
          break;
        }

        default:
          sendTo(ws, { type: 'error', message: `Unknown message type` });
      }
    });

    ws.on('close', () => {
      const clientInfo = clients.get(ws);
      if (clientInfo?.role === 'camera' && clientInfo.slotId) {
        const slot = registry.setCameraConnected(clientInfo.slotId, false);
        if (slot) {
          broadcast({ type: 'slot-updated', slot });
        }
      }
      clients.delete(ws);
    });
  });
}
