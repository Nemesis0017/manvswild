import type { Inventory } from './inventory';
import { ITEMS, type ItemId } from './items';
import { skillLevel, type SkillId, type Skills } from './skills';

export type Station = 'campfire';
export type BuildKind = 'campfire' | 'shelter' | 'sleeping_area' | 'storage';

export interface Recipe {
  id: string;
  name: string;
  inputs: { id: ItemId; count: number }[];
  /** Item produced, or a build piece to place with B mode. */
  output?: { id: ItemId; count: number };
  build?: BuildKind;
  skill?: { id: SkillId; level: number };
  /** Needs a lit campfire nearby. */
  station?: Station;
  xp?: number;
  description: string;
}

const i = (id: ItemId, count: number) => ({ id, count });

export const RECIPES: Recipe[] = [
  { id: 'rope', name: 'Rope', inputs: [i('fiber', 3)], output: i('rope', 1), xp: 3, description: 'Twist fibers into rope.' },
  { id: 'stone_knife', name: 'Stone Knife', inputs: [i('stone', 1), i('branch', 1), i('fiber', 1)], output: i('stone_knife', 1), xp: 4, description: 'Better yields from plants.' },
  { id: 'stone_axe', name: 'Stone Axe', inputs: [i('stone', 2), i('branch', 2), i('rope', 1)], output: i('stone_axe', 1), xp: 5, description: 'Better yields from wood.' },
  { id: 'torch', name: 'Torch', inputs: [i('branch', 2), i('fiber', 2)], output: i('torch', 1), xp: 3, description: 'Light and a bit of warmth.' },
  { id: 'waterskin', name: 'Waterskin', inputs: [i('leaf', 4), i('fiber', 3)], output: i('waterskin', 1), xp: 3, description: 'Carry water.' },
  { id: 'purifier', name: 'Water Purifier', inputs: [i('stone', 2), i('leaf', 3), i('salvage', 1)], output: i('purifier', 1), skill: { id: 'crafting', level: 2 }, xp: 8, description: 'Makes untreated water safe.' },
  { id: 'fishing_rod', name: 'Fishing Rod', inputs: [i('branch', 2), i('rope', 1), i('salvage', 1)], output: i('fishing_rod', 1), skill: { id: 'crafting', level: 2 }, xp: 8, description: 'For catching fish.' },
  { id: 'leaf_poncho', name: 'Leaf Poncho', inputs: [i('leaf', 10), i('fiber', 3)], output: i('leaf_poncho', 1), xp: 5, description: 'Rain gear.' },
  { id: 'fiber_jacket', name: 'Fiber Jacket', inputs: [i('fiber', 10), i('leaf', 6), i('rope', 1)], output: i('fiber_jacket', 1), skill: { id: 'crafting', level: 2 }, xp: 8, description: 'Warm clothing.' },
  { id: 'backpack', name: 'Backpack', inputs: [i('rope', 2), i('leaf', 8), i('fiber', 6), i('salvage', 1)], output: i('backpack', 1), skill: { id: 'crafting', level: 3 }, xp: 12, description: 'Carry more.' },
  { id: 'signal_kit', name: 'Signal Kit', inputs: [i('branch', 3), i('leaf', 6), i('wood', 2)], output: i('signal_kit', 1), skill: { id: 'fieldcraft', level: 2 }, xp: 8, description: 'Raise a smoke signal.' },
  { id: 'raft', name: 'Raft', inputs: [i('wood', 8), i('rope', 4)], output: i('raft', 1), skill: { id: 'crafting', level: 3 }, xp: 15, description: 'Cross water with less effort.' },
  // Station recipes
  { id: 'boil_water', name: 'Boil Water', inputs: [i('water_dirty', 1)], output: i('water_clean', 1), station: 'campfire', xp: 1, description: 'Needs a lit campfire nearby.' },
  { id: 'cook_fish', name: 'Cook Fish', inputs: [i('fish_raw', 1)], output: i('fish_cooked', 1), station: 'campfire', xp: 2, description: 'Needs a lit campfire nearby.' },
  // Buildables (placed with B)
  { id: 'build_campfire', name: 'Campfire', inputs: [i('wood', 3), i('stone', 4)], build: 'campfire', xp: 5, description: 'Warmth, light, cooking, boiling water.' },
  { id: 'build_shelter', name: 'Shelter', inputs: [i('branch', 8), i('leaf', 10), i('rope', 1)], build: 'shelter', skill: { id: 'fieldcraft', level: 2 }, xp: 10, description: 'Blocks rain and wind, shade.' },
  { id: 'build_sleeping_area', name: 'Sleeping Area', inputs: [i('leaf', 12), i('fiber', 4)], build: 'sleeping_area', xp: 5, description: 'Press R nearby to rest.' },
  { id: 'build_storage', name: 'Storage Box', inputs: [i('wood', 6), i('rope', 1)], build: 'storage', xp: 5, description: 'Stash items.' },
];

export const recipeById = (id: string): Recipe | undefined => RECIPES.find((r) => r.id === id);

export interface CraftContext {
  skills: Skills;
  nearCampfire: boolean;
}

export function missingSkill(r: Recipe, skills: Skills): boolean {
  return !!r.skill && skillLevel(skills[r.skill.id]) < r.skill.level;
}

export function hasInputs(inv: Inventory, r: Recipe): boolean {
  return r.inputs.every((x) => inv.has(x.id, x.count));
}

/** Why the recipe cannot be crafted right now, or null if it can. */
export function craftBlocker(inv: Inventory, r: Recipe, ctx: CraftContext): string | null {
  if (missingSkill(r, ctx.skills)) return `Needs ${r.skill!.id} level ${r.skill!.level}`;
  if (r.station && !ctx.nearCampfire) return 'Stand near a lit campfire';
  if (!hasInputs(inv, r)) return 'Missing materials';
  if (r.output) {
    const test = inv.clone();
    for (const x of r.inputs) test.remove(x.id, x.count);
    if (!test.canAdd(r.output.id, r.output.count)) return 'No room to carry it';
  }
  return null;
}

export interface CraftResult { ok: boolean; reason?: string; item?: ItemId }

/** Consume real inventory items and add the product. Build recipes are placed via the build system instead. */
export function craft(inv: Inventory, r: Recipe, ctx: CraftContext): CraftResult {
  if (!r.output) return { ok: false, reason: 'Place this with build mode (B)' };
  const why = craftBlocker(inv, r, ctx);
  if (why) return { ok: false, reason: why };
  for (const x of r.inputs) inv.remove(x.id, x.count);
  inv.add(r.output.id, r.output.count);
  return { ok: true, item: r.output.id };
}

/** Consume materials for placing a build recipe. */
export function payBuildCost(inv: Inventory, r: Recipe, skills: Skills): CraftResult {
  if (!r.build) return { ok: false, reason: 'Not a building' };
  if (missingSkill(r, skills)) return { ok: false, reason: `Needs ${r.skill!.id} level ${r.skill!.level}` };
  if (!hasInputs(inv, r)) return { ok: false, reason: 'Missing materials' };
  for (const x of r.inputs) inv.remove(x.id, x.count);
  return { ok: true };
}

export const describeInputs = (r: Recipe): string => r.inputs.map((x) => `${x.count} ${ITEMS[x.id].name}`).join(', ');
