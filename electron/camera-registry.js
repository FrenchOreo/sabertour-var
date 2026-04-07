const { randomUUID } = require('crypto');

class CameraRegistry {
  constructor() {
    this.slots = new Map();
  }

  initSlots(names) {
    for (const [id, name] of Object.entries(names)) {
      const slotId = Number(id);
      this.slots.set(slotId, {
        slotId,
        name,
        cameraConnected: false,
        arbitreConnected: false,
        token: randomUUID(),
      });
    }
  }

  validateToken(slotId, token) {
    const slot = this.slots.get(slotId);
    return slot?.token === token;
  }

  getSlot(slotId) {
    return this.slots.get(slotId);
  }

  getAllSlots() {
    return Array.from(this.slots.values());
  }

  setCameraConnected(slotId, connected) {
    const slot = this.slots.get(slotId);
    if (slot) slot.cameraConnected = connected;
    return slot;
  }

  setArbitreConnected(slotId, connected) {
    const slot = this.slots.get(slotId);
    if (slot) slot.arbitreConnected = connected;
    return slot;
  }

  isInitialized() {
    return this.slots.size > 0;
  }

  resetSlots() {
    this.slots.clear();
  }
}

module.exports = { CameraRegistry };
