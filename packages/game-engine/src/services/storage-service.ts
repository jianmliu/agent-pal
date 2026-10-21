import EventBus from './event-bus.js';

const SAVE_STORAGE_PREFIX = 'PAL-SAVE-';
const LAST_SLOT_KEY = `${SAVE_STORAGE_PREFIX}lastSlot`;

type SlotPayload = unknown;
type SlotId = number | string;
type SlotSavedEvent = { slot: SlotId; payload: SlotPayload };
type SlotRemovedEvent = { slot: SlotId };

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch (ex) {
    return null;
  }
}

class StorageService extends EventBus {
  private storage: Storage | null;

  constructor() {
    super();
    this.storage = getStorage();
  }

  fire(event: string, payload?: SlotSavedEvent | SlotRemovedEvent): unknown {
    const parent: any = this as any;
    if (parent && typeof parent.fire === 'function' && parent !== this) {
      return parent.fire(event, payload);
    }
    return undefined;
  }

  isAvailable(): boolean {
    return !!this.storage;
  }

  private _key(slot: SlotId): string {
    return `${SAVE_STORAGE_PREFIX}${slot}`;
  }

  readSlot(slot: SlotId): SlotPayload | null {
    if (!this.storage) return null;
    const raw = this.storage.getItem(this._key(slot));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SlotPayload;
    } catch {
      return null;
    }
  }

  writeSlot(slot: SlotId, payload: SlotPayload): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this._key(slot), JSON.stringify(payload));
      this.storage.setItem(LAST_SLOT_KEY, String(slot));
      this.fire('slotSaved', { slot, payload });
      return true;
    } catch {
      return false;
    }
  }

  getLastSlot(): number | null {
    if (!this.storage) return null;
    const raw = this.storage.getItem(LAST_SLOT_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  }

  listSlots(range: [number, number] = [1, 5]): Array<{ slot: number; payload: SlotPayload | null }> {
    if (!this.storage) return [];
    const [start, end] = range;
    const slots: Array<{ slot: number; payload: SlotPayload | null }> = [];
    for (let i = start; i <= end; i++) {
      slots.push({ slot: i, payload: this.readSlot(i) });
    }
    return slots;
  }

  removeSlot(slot: SlotId): void {
    if (!this.storage) return;
    this.storage.removeItem(this._key(slot));
    this.fire('slotRemoved', { slot });
  }
}

const storageService = new StorageService();

export { StorageService };
export default storageService;
