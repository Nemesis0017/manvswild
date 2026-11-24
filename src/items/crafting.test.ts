import { describe, expect, it } from 'vitest';
import { RECIPES, craft, craftBlocker, payBuildCost, recipeById } from './crafting';
import { Inventory } from './inventory';
import { addXp, createSkills, skillLevel } from './skills';

const ctx = () => ({ skills: createSkills(), nearCampfire: false });

describe('crafting', () => {
  it('consumes real inventory items and produces the output', () => {
    const inv = new Inventory();
    inv.add('fiber', 7);
    const res = craft(inv, recipeById('rope')!, ctx());
    expect(res.ok).toBe(true);
    expect(inv.count('fiber')).toBe(4);
    expect(inv.count('rope')).toBe(1);
  });

  it('fails without materials and consumes nothing', () => {
    const inv = new Inventory();
    inv.add('stone', 1);
    inv.add('branch', 1);
    const res = craft(inv, recipeById('stone_knife')!, ctx());
    expect(res.ok).toBe(false);
    expect(inv.count('stone')).toBe(1);
    expect(inv.count('branch')).toBe(1);
  });

  it('refuses to craft when the product would not fit, without consuming', () => {
    const inv = new Inventory(1, 100);
    inv.add('fiber', 3);
    // One slot holding 3 fiber; crafting 1 rope frees the slot so it fits.
    expect(craft(inv, recipeById('rope')!, ctx()).ok).toBe(true);
    const full = new Inventory(1, 100);
    full.add('fiber', 6);
    expect(craftBlocker(full, recipeById('rope')!, ctx())).toBe('No room to carry it');
    expect(full.count('fiber')).toBe(6);
  });

  it('gates recipes behind skill levels that rise with experience', () => {
    const inv = new Inventory();
    inv.add('stone', 2); inv.add('leaf', 3); inv.add('salvage', 1);
    const c = ctx();
    const purifier = recipeById('purifier')!;
    expect(craft(inv, purifier, c).reason).toMatch(/crafting level 2/);
    expect(addXp(c.skills, 'crafting', 25)).toBe(2);
    expect(skillLevel(c.skills.crafting)).toBe(2);
    expect(craft(inv, purifier, c).ok).toBe(true);
    expect(inv.count('purifier')).toBe(1);
  });

  it('cooking and boiling need a lit campfire nearby', () => {
    const inv = new Inventory();
    inv.add('water_dirty', 1);
    const boil = recipeById('boil_water')!;
    expect(craft(inv, boil, ctx()).ok).toBe(false);
    expect(craft(inv, boil, { skills: createSkills(), nearCampfire: true }).ok).toBe(true);
    expect(inv.count('water_clean')).toBe(1);
    expect(inv.count('water_dirty')).toBe(0);
  });

  it('build recipes are paid with real materials via payBuildCost', () => {
    const inv = new Inventory();
    inv.add('wood', 3); inv.add('stone', 3);
    const fire = recipeById('build_campfire')!;
    expect(payBuildCost(inv, fire, createSkills()).ok).toBe(false);
    expect(inv.count('wood')).toBe(3);
    inv.add('stone', 1);
    expect(payBuildCost(inv, fire, createSkills()).ok).toBe(true);
    expect(inv.count('wood')).toBe(0);
    expect(inv.count('stone')).toBe(0);
    expect(craft(inv, fire, ctx()).reason).toMatch(/build mode/);
  });

  it('every recipe has inputs that exist and either an output or a build piece', () => {
    for (const r of RECIPES) {
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(!!r.output !== !!r.build).toBe(true);
    }
    const names = ['campfire', 'shelter', 'container', 'purifier', 'rope', 'torch', 'fishing', 'signal', 'raft', 'backpack'];
    const text = RECIPES.map((r) => r.id).join(' ');
    for (const n of ['campfire', 'shelter', 'purifier', 'rope', 'torch', 'fishing', 'signal', 'raft', 'backpack', 'waterskin', 'poncho', 'axe']) expect(text).toContain(n);
    void names;
  });
});
