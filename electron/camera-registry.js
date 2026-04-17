const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

class CameraRegistry {
  constructor(persistPath) {
    this.slots = new Map();
    this.persistPath = persistPath || null;
    this.load();
  }

  load() {
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
      console.error('[CameraRegistry] Failed to load:', e.message);
    }
  }

  save() {
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
      console.error('[CameraRegistry] Failed to save:', e.message);
    }
  }

  initSlots(names) {
    for (const [id, name] of Object.entries(names)) {
      const slotId = Number(id);
      const existing = this.slots.get(slotId);
      // Reuse existing token if slot exists with same name, else generate new
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
    this.save();
  }
}

module.exports = { CameraRegistry };
