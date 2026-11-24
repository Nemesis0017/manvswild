import { describe, expect, it } from 'vitest';
import { Inventory, capacityFor, equipFromSlot, unequip } from './inventory';
import { BASE_SLOTS, BASE_WEIGHT_LIMIT, ITEMS } from './items';

describe('inventory stacking', () => {
  it('stacks up to the item stack size, then opens a new slot', () => {
    const inv = new Inventory();
    expect(inv.add('branch', 35)).toBe(0);
    expect(inv.slots[0]).toEqual({ id: 'branch', count: 30 });
    expect(inv.slots[1]).toEqual({ id: 'branch', count: 5 });
    expect(inv.count('branch')).toBe(35);
  });

  it('tops up partial stacks before using new slots', () => {
    const inv = new Inventory();
    inv.add('leaf', 10);
    inv.add('leaf', 10);
    expect(inv.slots.filter(Boolean).length).toBe(1);
    expect(inv.count('leaf')).toBe(20);
  });

  it('does not stack tools and gives them full durability', () => {
    const inv = new Inventory();
    inv.add('stone_axe', 2);
    expect(inv.slots[0]).toEqual({ id: 'stone_axe', count: 1, dur: 40 });
    expect(inv.slots[1]).toEqual({ id: 'stone_axe', count: 1, dur: 40 });
  });

  it('removes across stacks and refuses if not enough', () => {
    const inv = new Inventory();
    inv.add('stone', 25);
    expect(inv.remove('stone', 30)).toBe(false);
    expect(inv.count('stone')).toBe(25);
    expect(inv.remove('stone', 22)).toBe(true);
    expect(inv.count('stone')).toBe(3);
  });
});

describe('inventory weight and capacity', () => {
  it('refuses items beyond the weight limit and reports the leftover', () => {
    const inv = new Inventory();
    const per = ITEMS.wood.weight;
    const fits = Math.floor(BASE_WEIGHT_LIMIT / per);
    const left = inv.add('wood', fits + 5);
    expect(left).toBe(5);
    expect(inv.weight()).toBeLessThanOrEqual(BASE_WEIGHT_LIMIT);
  });

  it('refuses items when slots are full', () => {
    const inv = new Inventory(2, 1000);
    inv.add('stone_axe', 2);
    expect(inv.add('torch', 1)).toBe(1);
    expect(inv.canAdd('torch', 1)).toBe(false);
  });

  it('wear reduces durability and breaks the tool at zero', () => {
    const inv = new Inventory();
    inv.add('stone_knife', 1);
    expect(inv.wear(0, 10)).toBe(false);
    expect(inv.slots[0]!.dur).toBe(30);
    expect(inv.wear(0, 30)).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });

  it('a backpack adds slots and weight limit and only comes off when the extra slots are empty', () => {
    const inv = new Inventory();
    inv.add('backpack', 1);
    expect(equipFromSlot(inv, 0)).toBeNull();
    expect(inv.size).toBe(capacityFor(inv.equipment).slots);
    expect(inv.size).toBeGreaterThan(BASE_SLOTS);
    expect(inv.weightLimit).toBeGreaterThan(BASE_WEIGHT_LIMIT);
    inv.slots[inv.size - 1] = { id: 'leaf', count: 1 };
    expect(unequip(inv, 'back')).toMatch(/Empty/);
    inv.slots[inv.size - 1] = null;
    expect(unequip(inv, 'back')).toBeNull();
    expect(inv.size).toBe(BASE_SLOTS);
    expect(inv.count('backpack')).toBe(1);
  });

  it('serialization round trips', () => {
    const inv = new Inventory();
    inv.add('rope', 3);
    inv.add('torch', 1);
    const copy = Inventory.deserialize(JSON.parse(JSON.stringify(inv.serialize())));
    expect(copy.count('rope')).toBe(3);
    expect(copy.slots[1]!.dur).toBe(300);
  });
});
