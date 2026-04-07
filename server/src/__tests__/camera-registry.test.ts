import { CameraRegistry } from '../camera-registry';
import { SlotId } from '../../../shared/types';

describe('CameraRegistry', () => {
  let registry: CameraRegistry;

  beforeEach(() => {
    registry = new CameraRegistry();
  });

  describe('initSlots', () => {
    it('should initialize 4 slots with names and tokens', () => {
      registry.initSlots({ 1: 'GAUCHE', 2: 'DROITE', 3: 'FOND', 4: 'JUGE' });

      const slots = registry.getAllSlots();
      expect(slots).toHaveLength(4);
      expect(slots[0].name).toBe('GAUCHE');
      expect(slots[1].name).toBe('DROITE');
      expect(slots[2].name).toBe('FOND');
      expect(slots[3].name).toBe('JUGE');
    });

    it('should generate unique tokens for each slot', () => {
      registry.initSlots({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' });

      const slots = registry.getAllSlots();
      const tokens = slots.map((s) => s.token);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(4);
    });

    it('should set all slots as disconnected initially', () => {
      registry.initSlots({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' });

      for (const slot of registry.getAllSlots()) {
        expect(slot.cameraConnected).toBe(false);
        expect(slot.arbitreConnected).toBe(false);
      }
    });
  });

  describe('validateToken', () => {
    beforeEach(() => {
      registry.initSlots({ 1: 'GAUCHE', 2: 'DROITE', 3: 'FOND', 4: 'JUGE' });
    });

    it('should validate correct token', () => {
      const slot = registry.getSlot(1 as SlotId);
      expect(slot).toBeDefined();
      expect(registry.validateToken(1 as SlotId, slot!.token)).toBe(true);
    });

    it('should reject incorrect token', () => {
      expect(registry.validateToken(1 as SlotId, 'wrong-token')).toBe(false);
    });

    it('should reject token for non-existent slot', () => {
      expect(registry.validateToken(99 as SlotId, 'any-token')).toBe(false);
    });
  });

  describe('setCameraConnected', () => {
    beforeEach(() => {
      registry.initSlots({ 1: 'GAUCHE', 2: 'DROITE', 3: 'FOND', 4: 'JUGE' });
    });

    it('should set camera as connected', () => {
      const slot = registry.setCameraConnected(1 as SlotId, true);
      expect(slot?.cameraConnected).toBe(true);
    });

    it('should set camera as disconnected', () => {
      registry.setCameraConnected(1 as SlotId, true);
      const slot = registry.setCameraConnected(1 as SlotId, false);
      expect(slot?.cameraConnected).toBe(false);
    });

    it('should return undefined for non-existent slot', () => {
      const slot = registry.setCameraConnected(99 as SlotId, true);
      expect(slot).toBeUndefined();
    });
  });

  describe('setArbitreConnected', () => {
    beforeEach(() => {
      registry.initSlots({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' });
    });

    it('should set arbitre as connected', () => {
      const slot = registry.setArbitreConnected(1 as SlotId, true);
      expect(slot?.arbitreConnected).toBe(true);
    });
  });

  describe('isInitialized', () => {
    it('should return false when not initialized', () => {
      expect(registry.isInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      registry.initSlots({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' });
      expect(registry.isInitialized()).toBe(true);
    });
  });

  describe('resetSlots', () => {
    it('should clear all slots', () => {
      registry.initSlots({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' });
      registry.resetSlots();
      expect(registry.isInitialized()).toBe(false);
      expect(registry.getAllSlots()).toHaveLength(0);
    });
  });

  describe('getSlot', () => {
    it('should return slot by id', () => {
      registry.initSlots({ 1: 'GAUCHE', 2: 'DROITE', 3: 'FOND', 4: 'JUGE' });
      const slot = registry.getSlot(2 as SlotId);
      expect(slot?.name).toBe('DROITE');
      expect(slot?.slotId).toBe(2);
    });

    it('should return undefined for non-existent slot', () => {
      expect(registry.getSlot(1 as SlotId)).toBeUndefined();
    });
  });
});
