import { BASE_SLOTS, BASE_WEIGHT_LIMIT, ITEMS, type EquipSlot, type ItemId } from './items';

export interface Stack {
  id: ItemId;
  count: number;
  /** Remaining durability for items that have it (stack size 1). */
  dur?: number;
}

export type Equipment = Partial<Record<Exclude<EquipSlot, 'hand'>, Stack>>;

export const cloneStack = (s: Stack): Stack => ({ ...s });

/** Slot-based inventory with stacking, a weight limit and per-item durability. */
export class Inventory {
  slots: (Stack | null)[];
  weightLimit: number;
  equipment: Equipment = {};

  constructor(slots = BASE_SLOTS, weightLimit = BASE_WEIGHT_LIMIT) {
    this.slots = Array.from({ length: slots }, () => null);
    this.weightLimit = weightLimit;
  }

  get size(): number { return this.slots.length; }

  weight(): number {
    let w = 0;
    for (const s of this.slots) if (s) w += ITEMS[s.id].weight * s.count;
    return w;
  }

  /** Weight of equipped items counts too. */
  totalWeight(): number {
    let w = this.weight();
    for (const s of Object.values(this.equipment)) if (s) w += ITEMS[s.id].weight * s.count;
    return w;
  }

  count(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  has(id: ItemId, count = 1): boolean { return this.count(id) >= count; }

  /** Largest number of units of `id` that fit by weight alone. */
  private weightRoom(id: ItemId): number {
    const w = ITEMS[id].weight;
    if (w <= 0) return Infinity;
    return Math.max(0, Math.floor((this.weightLimit - this.totalWeight() + 1e-9) / w));
  }

  /** Add items. Returns the number that did not fit (0 means all added). */
  add(id: ItemId, count: number, dur?: number): number {
    const def = ITEMS[id];
    let left = Math.min(count, this.weightRoom(id));
    const refused = count - left;
    // Fill existing stacks first.
    if (def.stack > 1) {
      for (const s of this.slots) {
        if (!s || s.id !== id || left <= 0) continue;
        const n = Math.min(left, def.stack - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(left, def.stack);
      const st: Stack = { id, count: n };
      if (def.durability) st.dur = dur ?? def.durability;
      this.slots[i] = st;
      left -= n;
    }
    return refused + left;
  }

  /** Whether `count` of `id` would fit right now. */
  canAdd(id: ItemId, count: number): boolean {
    const c = this.clone();
    return c.add(id, count) === 0;
  }

  /** Remove units. Returns false (and removes nothing) if not enough. */
  remove(id: ItemId, count: number): boolean {
    if (this.count(id) < count) return false;
    let left = count;
    // Take from the smallest stacks first.
    const idx = this.slots.map((s, i) => (s && s.id === id ? i : -1)).filter((i) => i >= 0)
      .sort((a, b) => this.slots[a]!.count - this.slots[b]!.count);
    for (const i of idx) {
      const s = this.slots[i]!;
      const n = Math.min(left, s.count);
      s.count -= n;
      left -= n;
      if (s.count <= 0) this.slots[i] = null;
      if (left <= 0) break;
    }
    return true;
  }

  removeAt(i: number, count = 1): Stack | null {
    const s = this.slots[i];
    if (!s) return null;
    const n = Math.min(count, s.count);
    const out: Stack = { ...s, count: n };
    s.count -= n;
    if (s.count <= 0) this.slots[i] = null;
    return out;
  }

  swap(a: number, b: number): void {
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
  }

  /** Reduce durability of the stack in a slot; breaks the item at zero. Returns true if it broke. */
  wear(i: number, amount: number): boolean {
    const s = this.slots[i];
    if (!s || s.dur === undefined) return false;
    s.dur -= amount;
    if (s.dur <= 0) { this.slots[i] = null; return true; }
    return false;
  }

  /** Index of the first slot holding `id`, or -1. */
  find(id: ItemId): number {
    return this.slots.findIndex((s) => s?.id === id);
  }

  /** Change slot count and weight limit. Fails (returns false) if items would be lost. */
  resize(slots: number, weightLimit: number): boolean {
    if (slots < this.slots.length) {
      for (let i = slots; i < this.slots.length; i++) if (this.slots[i]) return false;
      this.slots.length = slots;
    } else {
      while (this.slots.length < slots) this.slots.push(null);
    }
    this.weightLimit = weightLimit;
    return true;
  }

  clone(): Inventory {
    const c = new Inventory(this.slots.length, this.weightLimit);
    c.slots = this.slots.map((s) => (s ? cloneStack(s) : null));
    c.equipment = Object.fromEntries(Object.entries(this.equipment).map(([k, v]) => [k, cloneStack(v!)]));
    return c;
  }

  serialize(): { slots: (Stack | null)[]; equipment: Equipment; weightLimit: number } {
    return { slots: this.slots.map((s) => (s ? cloneStack(s) : null)), equipment: { ...this.equipment }, weightLimit: this.weightLimit };
  }

  static deserialize(d: ReturnType<Inventory['serialize']>): Inventory {
    const inv = new Inventory(d.slots.length, d.weightLimit);
    inv.slots = d.slots.map((s) => (s ? cloneStack(s) : null));
    inv.equipment = { ...d.equipment };
    return inv;
  }
}

/** Slots and weight limit implied by what is worn. */
export function capacityFor(equipment: Equipment): { slots: number; weight: number } {
  const bp = equipment.back ? ITEMS[equipment.back.id].backpack : undefined;
  return { slots: BASE_SLOTS + (bp?.slots ?? 0), weight: BASE_WEIGHT_LIMIT + (bp?.weight ?? 0) };
}

/** Wear or swap in an equippable item from slot i. Returns an error message or null. */
export function equipFromSlot(inv: Inventory, i: number): string | null {
  const st = inv.slots[i];
  if (!st) return 'Nothing there';
  const def = ITEMS[st.id];
  if (!def.equip || def.equip === 'hand') return 'Cannot wear that';
  const slot = def.equip;
  const previous = inv.equipment[slot];
  const next: Equipment = { ...inv.equipment, [slot]: st };
  const cap = capacityFor(next);
  const test = inv.clone();
  test.slots[i] = previous ? { ...previous } : null;
  test.equipment = next;
  if (!test.resize(cap.slots, cap.weight)) return 'Empty your extra pack slots first';
  inv.slots[i] = previous ?? null;
  inv.equipment = next;
  inv.resize(cap.slots, cap.weight);
  return null;
}

/** Take off equipment into the inventory. */
export function unequip(inv: Inventory, slot: Exclude<EquipSlot, 'hand'>): string | null {
  const st = inv.equipment[slot];
  if (!st) return 'Nothing worn';
  const next: Equipment = { ...inv.equipment };
  delete next[slot];
  const cap = capacityFor(next);
  const test = inv.clone();
  if (!test.resize(cap.slots, cap.weight)) return 'Empty your extra pack slots first';
  const free = inv.slots.findIndex((s, i) => !s && i < cap.slots);
  if (free < 0) return 'No free slot';
  inv.slots[free] = st;
  inv.equipment = next;
  inv.resize(cap.slots, cap.weight);
  return null;
}
