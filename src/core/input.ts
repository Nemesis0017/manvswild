export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sprint' | 'crouch' | 'interact'
  | 'toggleCamera' | 'inventory' | 'map' | 'pause'
  | 'use' | 'build' | 'rest' | 'throw' | 'rotate' | 'primary' | 'secondary'
  | 'journal' | 'waypoint' | 'hideHud' | 'quickSave' | 'quickLoad';

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  interact: ['KeyE'],
  toggleCamera: ['KeyV'],
  inventory: ['KeyI', 'Tab'],
  map: ['KeyM'],
  pause: ['KeyP'],
  use: ['KeyF'],
  build: ['KeyB'],
  rest: ['KeyR'],
  throw: ['KeyG'],
  rotate: ['KeyQ'],
  primary: ['Mouse0'],
  secondary: ['Mouse2'],
  journal: ['KeyJ'],
  waypoint: ['KeyX'],
  hideHud: ['KeyH'],
  quickSave: ['F5'],
  quickLoad: ['F9'],
};

const BIND_KEY = 'manvswild.bindings.v1';

export class InputManager {
  bindings: Bindings;
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private pressedCodes = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  private padAxes = { lx: 0, ly: 0, rx: 0, ry: 0 };
  private padButtons: Record<string, boolean> = {};
  private prevPadButtons: Record<string, boolean> = {};
  locked = false;
  private cleanup: Array<() => void> = [];

  constructor(private element: HTMLElement) {
    this.bindings = this.loadBindings();
    const add = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(t, f);
      this.cleanup.push(() => window.removeEventListener(t, f));
    };
    add('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedCodes.add(e.code);
      if (this.locked && (e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
    });
    add('keyup', (e) => this.down.delete(e.code));
    add('mousedown', (e) => {
      if (!this.locked) return;
      const code = 'Mouse' + e.button;
      this.down.add(code);
      this.pressedCodes.add(code);
    });
    add('mouseup', (e) => this.down.delete('Mouse' + e.button));
    add('blur', () => this.down.clear());
    add('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    const onLock = () => {
      this.locked = document.pointerLockElement === this.element;
    };
    document.addEventListener('pointerlockchange', onLock);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', onLock));
  }

  requestLock(): void {
    this.element.requestPointerLock?.();
  }

  private loadBindings(): Bindings {
    try {
      const raw = localStorage.getItem(BIND_KEY);
      if (raw) return { ...DEFAULT_BINDINGS, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return structuredClone(DEFAULT_BINDINGS);
  }

  rebind(action: Action, codes: string[]): void {
    this.bindings[action] = codes;
    try {
      localStorage.setItem(BIND_KEY, JSON.stringify(this.bindings));
    } catch {
      /* ignore */
    }
  }

  isDown(a: Action): boolean {
    return this.bindings[a].some((c) => this.down.has(c)) || !!this.padButtons[a];
  }

  wasPressed(a: Action): boolean {
    return this.bindings[a].some((c) => this.pressedCodes.has(c)) ||
      (!!this.padButtons[a] && !this.prevPadButtons[a]);
  }

  /** Raw key code pressed this frame (for hotbar digits). */
  codePressed(code: string): boolean {
    return this.pressedCodes.has(code);
  }

  /** Movement axes in [-1,1]; x right, y forward. */
  moveAxes(): { x: number; y: number } {
    let x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let y = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    x += this.padAxes.lx;
    y -= this.padAxes.ly;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** Called once per frame before consumers; polls gamepad. */
  poll(): void {
    this.prevPadButtons = this.padButtons;
    this.padButtons = {};
    const pads = navigator.getGamepads?.() ?? [];
    const gp = Array.from(pads).find((p) => p && p.connected);
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    if (gp) {
      this.padAxes = { lx: dz(gp.axes[0] ?? 0), ly: dz(gp.axes[1] ?? 0), rx: dz(gp.axes[2] ?? 0), ry: dz(gp.axes[3] ?? 0) };
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      this.padButtons = {
        jump: b(0), crouch: b(1), interact: b(2), toggleCamera: b(3),
        sprint: b(10), inventory: b(4), map: b(5), pause: b(9),
        use: b(7), throw: b(6), build: b(8), journal: b(12), rest: b(13), rotate: b(14), hideHud: b(15),
      };
    } else {
      this.padAxes = { lx: 0, ly: 0, rx: 0, ry: 0 };
    }
  }

  /** Look delta in radians-ish units (before sensitivity), consumes mouse. */
  consumeLook(dt: number): { dx: number; dy: number } {
    const dx = this.mouseDX + this.padAxes.rx * 600 * dt;
    const dy = this.mouseDY + this.padAxes.ry * 600 * dt;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  endFrame(): void {
    this.pressedCodes.clear();
    this.pressed.clear();
  }

  dispose(): void {
    this.cleanup.forEach((f) => f());
  }
}
