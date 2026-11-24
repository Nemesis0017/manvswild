import type { Action } from '../core/input';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump / swim up / skip intro', sprint: 'Sprint', crouch: 'Crouch (sneak)',
  interact: 'Interact / gather / place', toggleCamera: 'First / third person', inventory: 'Backpack and crafting', map: 'Map', pause: 'Pause',
  use: 'Use held item', build: 'Build mode', rest: 'Rest', throw: 'Throw a stone', rotate: 'Rotate building piece', primary: 'Primary (use / place)', secondary: 'Secondary (cancel build)',
  journal: 'Journal', waypoint: 'Place waypoint', hideHud: 'Hide HUD', quickSave: 'Quick save', quickLoad: 'Quick load',
};

export const ACTION_ORDER: Action[] = [
  'forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch', 'interact', 'use', 'primary', 'secondary', 'throw', 'build', 'rotate', 'rest',
  'inventory', 'map', 'journal', 'waypoint', 'toggleCamera', 'hideHud', 'pause', 'quickSave', 'quickLoad',
];

export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Mouse0') return 'Left click';
  if (code === 'Mouse1') return 'Middle click';
  if (code === 'Mouse2') return 'Right click';
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow';
  return code.replace('Left', ' L').replace('Right', ' R');
}
