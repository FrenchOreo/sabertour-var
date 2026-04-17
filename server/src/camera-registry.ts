import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SlotId, SlotState } from '../../shared/types';

export class CameraRegistry {
  private slots: Map<SlotId, SlotState> = new Map();
  private persistPath: string | null;

  constructor(persistPath: string | null = null) {
    this.persistPath = persistPath;
    this.load();
  }

  private load(): void {
    if (!this.persistPath) return;
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
        if (Array.isArray(data)) {
          for (const slot of data) {
            this.slots.set(slot.slotId, {
              slotId: slot.slotId,
              name: slot.name,
              cameraConnected: false,
              arbitreConnected: false,
              token: slot.token,
            });
          }
        }
      }
    } catch (e) {
      console.error('[CameraRegistry] Failed to load:', (e as Error).message);
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = Array.from(this.slots.values()).map((s) => ({
        slotId: s.slotId,
        name: s.name,
        token: s.token,
      }));
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[CameraRegistry] Failed to save:', (e as Error).message);
    }
  }

  initSlots(names: Record<number, string>): void {
    for (const [id, name] of Object.entries(names)) {
      const slotId = Number(id) as SlotId;
      const existing = this.slots.get(slotId);
      const token = existing && existing.name === name ? existing.token : randomUUID();
      this.slots.set(slotId, {
        slotId,
        name,
        cameraConnected: false,
        arbitreConnected: false,
        token,
      });
    }
    this.save();
  }

  validateToken(slotId: SlotId, token: string): boolean {
    return this.slots.get(slotId)?.token === token;
  }

  getSlot(slotId: SlotId): SlotState | undefined {
    return this.slots.get(slotId);
  }

  getAllSlots(): SlotState[] {
    return Array.from(this.slots.values());
  }

  setCameraConnected(slotId: SlotId, connected: boolean): SlotState | undefined {
    const slot = this.slots.get(slotId);
    if (slot) {
      slot.cameraConnected = connected;
    }
    return slot;
  }

  setArbitreConnected(slotId: SlotId, connected: boolean): SlotState | undefined {
    const slot = this.slots.get(slotId);
    if (slot) {
      slot.arbitreConnected = connected;
    }
    return slot;
  }

  isInitialized(): boolean {
    return this.slots.size > 0;
  }

  resetSlots(): void {
    this.slots.clear();
    this.save();
  }
}
