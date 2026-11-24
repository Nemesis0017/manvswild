export type ItemId =
  | 'wood' | 'stone' | 'branch' | 'leaf' | 'fiber' | 'berries' | 'salvage'
  | 'water_dirty' | 'water_clean' | 'fish_raw' | 'fish_cooked'
  | 'rope' | 'stone_axe' | 'stone_knife' | 'torch' | 'fishing_rod' | 'waterskin' | 'purifier'
  | 'fiber_jacket' | 'leaf_poncho' | 'backpack' | 'signal_kit' | 'raft';

export type EquipSlot = 'hand' | 'body' | 'back';
export type Category = 'resource' | 'food' | 'drink' | 'tool' | 'clothing' | 'gear' | 'misc';

export interface UseEffect {
  hunger?: number;
  thirst?: number;
  health?: number;
  /** Chance (0..1) of mild sickness. */
  sickChance?: number;
  /** Warms the body a bit for a moment (in deg C of body temp). */
  warm?: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  category: Category;
  /** Max stack size. 1 means not stackable. */
  stack: number;
  /** kg per unit. */
  weight: number;
  /** If set, each unit instance has this many durability points. */
  durability?: number;
  equip?: EquipSlot;
  use?: UseEffect;
  /** Clothing insulation 0..1. */
  insulation?: number;
  /** Clothing rain protection 0..1. */
  rainProof?: number;
  /** Extra carry weight (kg) and slots while worn. */
  backpack?: { slots: number; weight: number };
  /** Multiplier on gathering yield when held. */
  gather?: number;
  description: string;
}

const d = (x: ItemDef): ItemDef => x;

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: d({ id: 'wood', name: 'Wood', category: 'resource', stack: 20, weight: 1.2, description: 'Split logs. Fuel and building material.' }),
  stone: d({ id: 'stone', name: 'Stone', category: 'resource', stack: 20, weight: 0.8, description: 'Useful for tools, fire rings and throwing to distract animals.' }),
  branch: d({ id: 'branch', name: 'Branch', category: 'resource', stack: 30, weight: 0.3, description: 'Light sticks and poles.' }),
  leaf: d({ id: 'leaf', name: 'Leaf', category: 'resource', stack: 40, weight: 0.05, description: 'Large leaves for thatch and wrapping.' }),
  fiber: d({ id: 'fiber', name: 'Plant Fiber', category: 'resource', stack: 40, weight: 0.05, description: 'Stringy plant fibers for binding.' }),
  berries: d({ id: 'berries', name: 'Berries', category: 'food', stack: 20, weight: 0.1, use: { hunger: 8, thirst: 3 }, description: 'Wild berries. A little food and water.' }),
  salvage: d({ id: 'salvage', name: 'Salvage', category: 'resource', stack: 10, weight: 0.5, description: 'Scrap metal and plastic from wreckage.' }),
  water_dirty: d({ id: 'water_dirty', name: 'Untreated Water', category: 'drink', stack: 8, weight: 0.5, use: { thirst: 30, sickChance: 0.6 }, description: 'Risky to drink. Boil it at a campfire or use a purifier.' }),
  water_clean: d({ id: 'water_clean', name: 'Clean Water', category: 'drink', stack: 8, weight: 0.5, use: { thirst: 35 }, description: 'Safe drinking water.' }),
  fish_raw: d({ id: 'fish_raw', name: 'Raw Fish', category: 'food', stack: 10, weight: 0.4, use: { hunger: 12, sickChance: 0.35 }, description: 'Better cooked.' }),
  fish_cooked: d({ id: 'fish_cooked', name: 'Cooked Fish', category: 'food', stack: 10, weight: 0.4, use: { hunger: 35, health: 5 }, description: 'A proper meal.' }),
  rope: d({ id: 'rope', name: 'Rope', category: 'resource', stack: 10, weight: 0.3, description: 'Twisted fiber rope.' }),
  stone_axe: d({ id: 'stone_axe', name: 'Stone Axe', category: 'tool', stack: 1, weight: 1.5, durability: 40, equip: 'hand', gather: 1.6, description: 'Hold it to gather more wood and branches.' }),
  stone_knife: d({ id: 'stone_knife', name: 'Stone Knife', category: 'tool', stack: 1, weight: 0.5, durability: 40, equip: 'hand', gather: 1.3, description: 'Hold it to gather more fiber, leaves and berries.' }),
  torch: d({ id: 'torch', name: 'Torch', category: 'tool', stack: 1, weight: 0.5, durability: 300, equip: 'hand', description: 'Hold it for light and a little warmth. Burns down while held (300 seconds).' }),
  fishing_rod: d({ id: 'fishing_rod', name: 'Fishing Rod', category: 'tool', stack: 1, weight: 0.8, durability: 30, equip: 'hand', description: 'Hold it and face water, then press E to cast.' }),
  waterskin: d({ id: 'waterskin', name: 'Waterskin', category: 'tool', stack: 1, weight: 0.3, description: 'A container. Keep one in your pack to collect water from lakes and rivers (face the water, press E).' }),
  purifier: d({ id: 'purifier', name: 'Water Purifier', category: 'tool', stack: 1, weight: 0.8, durability: 12, description: 'Keep it in your pack. Untreated water is purified automatically when you drink it. Wears out.' }),
  fiber_jacket: d({ id: 'fiber_jacket', name: 'Fiber Jacket', category: 'clothing', stack: 1, weight: 1, equip: 'body', insulation: 0.55, rainProof: 0.3, description: 'Warm woven jacket.' }),
  leaf_poncho: d({ id: 'leaf_poncho', name: 'Leaf Poncho', category: 'clothing', stack: 1, weight: 0.6, equip: 'body', insulation: 0.2, rainProof: 0.8, description: 'Keeps most rain off.' }),
  backpack: d({ id: 'backpack', name: 'Backpack', category: 'gear', stack: 1, weight: 1, equip: 'back', backpack: { slots: 10, weight: 15 }, description: 'More slots and a higher weight limit while worn.' }),
  signal_kit: d({ id: 'signal_kit', name: 'Signal Kit', category: 'tool', stack: 1, weight: 1, description: 'Use in the open to raise a tall smoke signal for rescuers.' }),
  raft: d({ id: 'raft', name: 'Raft', category: 'gear', stack: 1, weight: 6, durability: 100, equip: 'hand', description: 'Hold it while swimming to paddle faster and tire less. Wears out.' }),
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const BASE_SLOTS = 16;
export const BASE_WEIGHT_LIMIT = 25;
export const HOTBAR_SLOTS = 9;
