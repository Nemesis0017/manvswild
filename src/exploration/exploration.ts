/** Fog of war, waypoints and exploration percent. Pure data, no rendering. */

export const CELL = 32;
/** Radius of the world area that counts toward the exploration percent. */
export const EXPLORE_RADIUS = 1200;
const OFFSET = 32768;

export const cellOf = (v: number): number => Math.floor(v / CELL);
const pack = (cx: number, cz: number): number => (cx + OFFSET) * 65536 + (cz + OFFSET);
const unpack = (k: number): [number, number] => [Math.floor(k / 65536) - OFFSET, (k % 65536) - OFFSET];

export interface Waypoint { id: number; name: string; x: number; z: number }

export interface ExplorationData { cells: number[]; waypoints: Waypoint[]; discovered: string[]; nextWaypoint: number }

export class Exploration {
  private cells = new Set<number>();
  waypoints: Waypoint[] = [];
  discovered = new Set<string>();
  private nextWaypoint = 1;
  /** Cells that count toward the percent. */
  readonly totalCells: number;

  constructor(readonly originX = 0, readonly originZ = 0) {
    this.totalCells = Math.round(Math.PI * (EXPLORE_RADIUS / CELL) ** 2);
  }

  isRevealed(cx: number, cz: number): boolean {
    return this.cells.has(pack(cx, cz));
  }

  isRevealedAt(x: number, z: number): boolean {
    return this.isRevealed(cellOf(x), cellOf(z));
  }

  get revealedCount(): number { return this.cells.size; }

  /** Reveal a disc. Returns the number of newly revealed cells. */
  reveal(x: number, z: number, radius: number): number {
    const r = Math.ceil(radius / CELL);
    const pcx = cellOf(x), pcz = cellOf(z);
    let added = 0;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        const wx = (cx + 0.5) * CELL, wz = (cz + 0.5) * CELL;
        if (Math.hypot(wx - x, wz - z) > radius) continue;
        const k = pack(cx, cz);
        if (!this.cells.has(k)) { this.cells.add(k); added++; }
      }
    }
    return added;
  }

  /** 0..100, counting only cells within the exploration radius of the origin. */
  percent(): number {
    let inside = 0;
    for (const k of this.cells) {
      const [cx, cz] = unpack(k);
      if (Math.hypot((cx + 0.5) * CELL - this.originX, (cz + 0.5) * CELL - this.originZ) <= EXPLORE_RADIUS) inside++;
    }
    return Math.min(100, (inside / this.totalCells) * 100);
  }

  addWaypoint(x: number, z: number, name?: string): Waypoint {
    const wp: Waypoint = { id: this.nextWaypoint++, name: name ?? `Waypoint ${this.nextWaypoint - 1}`, x, z };
    this.waypoints.push(wp);
    return wp;
  }

  removeWaypoint(id: number): void {
    this.waypoints = this.waypoints.filter((w) => w.id !== id);
  }

  renameWaypoint(id: number, name: string): void {
    const w = this.waypoints.find((q) => q.id === id);
    if (w) w.name = name.slice(0, 30) || w.name;
  }

  serialize(): ExplorationData {
    return { cells: [...this.cells], waypoints: this.waypoints.map((w) => ({ ...w })), discovered: [...this.discovered], nextWaypoint: this.nextWaypoint };
  }

  static deserialize(d: ExplorationData, originX = 0, originZ = 0): Exploration {
    const e = new Exploration(originX, originZ);
    for (const c of d.cells) e.cells.add(c);
    e.waypoints = d.waypoints.map((w) => ({ ...w }));
    e.discovered = new Set(d.discovered);
    e.nextWaypoint = d.nextWaypoint;
    return e;
  }
}

/** Bearing from a to b in radians, 0 = north (-Z), clockwise positive. */
export const bearing = (ax: number, az: number, bx: number, bz: number): number => Math.atan2(bx - ax, -(bz - az));

/** Smallest signed difference between two angles. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function compassLabel(heading: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[i];
}
