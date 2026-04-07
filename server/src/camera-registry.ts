import { randomUUID } from 'crypto';
import { SlotId, SlotState } from '../../shared/types';

export class CameraRegistry {
  private slots: Map<SlotId, SlotState> = new Map();

  initSlots(names: Record<number, string>): void {
    for (const [id, name] of Object.entries(names)) {
      const slotId = Number(id) as SlotId;
      this.slots.set(slotId, {
        slotId,
        name,
        cameraConnected: false,
        arbitreConnected: false,
        token: randomUUID(),
      });
    }
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
  }
}
