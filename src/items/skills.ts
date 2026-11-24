export type SkillId =
  | 'crafting' | 'foraging' | 'fieldcraft'
  | 'navigation' | 'endurance' | 'shelter' | 'swimming' | 'climbing' | 'awareness' | 'wildlife';

export type Skills = Record<SkillId, number>; // xp

export const SKILL_IDS: SkillId[] = [
  'navigation', 'endurance', 'crafting', 'foraging', 'shelter', 'swimming', 'climbing', 'awareness', 'wildlife', 'fieldcraft',
];

export const SKILL_NAMES: Record<SkillId, string> = {
  crafting: 'Crafting', foraging: 'Gathering', fieldcraft: 'Fieldcraft',
  navigation: 'Navigation', endurance: 'Endurance', shelter: 'Shelter', swimming: 'Swimming',
  climbing: 'Climbing', awareness: 'Awareness', wildlife: 'Wildlife observation',
};

export const SKILL_EFFECTS: Record<SkillId, string> = {
  crafting: 'Unlocks advanced recipes.',
  foraging: 'Each level adds 10 percent to gathering yields.',
  fieldcraft: 'Unlocks shelter and signal recipes. Gained by fishing, cooking and boiling.',
  navigation: 'Each level widens the area you reveal on the map.',
  endurance: 'Each level restores stamina a little faster.',
  shelter: 'Gained by building. Each level slows shelter wear.',
  swimming: 'Each level adds swim speed.',
  climbing: 'Each level adds climbing speed.',
  awareness: 'Each level lets you spot points of interest from farther away.',
  wildlife: 'Each level makes animals notice you a little later.',
};

export const MAX_SKILL_LEVEL = 5;

export const createSkills = (): Skills => ({
  crafting: 0, foraging: 0, fieldcraft: 0, navigation: 0, endurance: 0, shelter: 0, swimming: 0, climbing: 0, awareness: 0, wildlife: 0,
});

/** Fill missing skills in loaded data. */
export const normalizeSkills = (s: Partial<Skills>): Skills => ({ ...createSkills(), ...s });

/** Level 1 at 0 xp; thresholds 20, 60, 120, 200 xp for levels 2..5. */
export function skillLevel(xp: number): number {
  const thresholds = [20, 60, 120, 200];
  let lvl = 1;
  for (const t of thresholds) if (xp >= t) lvl++;
  return Math.min(lvl, MAX_SKILL_LEVEL);
}

/** Add xp; returns the new level if it increased, else 0. */
export function addXp(skills: Skills, id: SkillId, amount: number): number {
  const before = skillLevel(skills[id]);
  skills[id] += amount;
  const after = skillLevel(skills[id]);
  return after > before ? after : 0;
}
