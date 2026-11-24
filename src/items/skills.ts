export type SkillId = 'crafting' | 'foraging' | 'fieldcraft';

export type Skills = Record<SkillId, number>; // xp

export const SKILL_NAMES: Record<SkillId, string> = { crafting: 'Crafting', foraging: 'Foraging', fieldcraft: 'Fieldcraft' };
export const MAX_SKILL_LEVEL = 5;

export const createSkills = (): Skills => ({ crafting: 0, foraging: 0, fieldcraft: 0 });

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
