import * as THREE from 'three';
import { CELL, bearing, angleDiff, compassLabel, cellOf } from '../exploration/exploration';
import type { Game } from '../game';
import { WATER_Y, type Terrain } from '../world/terrain';

export interface MapView { cx: number; cz: number; /** pixels per meter */ scale: number }

interface CellInfo { r: number; g: number; b: number; h: number }
const caches = new WeakMap<Terrain, Map<number, CellInfo>>();

function cellInfo(t: Terrain, cx: number, cz: number): CellInfo {
  let m = caches.get(t);
  if (!m) { m = new Map(); caches.set(t, m); }
  const key = (cx + 32768) * 65536 + (cz + 32768);
  let c = m.get(key);
  if (!c) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    const h = t.heightAt(x, z);
    const col: [number, number, number] = [0, 0, 0];
    t.colorAt(x, z, col);
    const shade = 0.72 + 0.28 * Math.max(0, Math.min(1, h / 70));
    if (h < WATER_Y) {
      const depth = Math.min(1, (WATER_Y - h) / 4);
      c = { r: 30 - 10 * depth, g: 85 - 25 * depth, b: 140 - 30 * depth, h };
    } else c = { r: col[0] * 255 * shade, g: col[1] * 255 * shade, b: col[2] * 255 * shade, h };
    m.set(key, c);
  }
  return c;
}

export const w2s = (v: MapView, w: number, h: number, x: number, z: number): [number, number] => [w / 2 + (x - v.cx) * v.scale, h / 2 + (z - v.cz) * v.scale];
export const s2w = (v: MapView, w: number, h: number, px: number, py: number): [number, number] => [v.cx + (px - w / 2) / v.scale, v.cz + (py - h / 2) / v.scale];

export const POI_COLOR: Record<string, string> = {
  landmark: '#f0e0a0', campsite: '#e0a050', cave: '#b0a0e0', summit: '#ffffff', extraction: '#60e0a0', cairn: '#e0d0b0', beacon: '#ffd060',
};

export interface MapOpts { markers: boolean; labels: boolean; contours: boolean }

/** Draw fog of war terrain, contours, markers and the player. Used by both the minimap and the full map. */
export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, view: MapView, game: Game, heading: number, opts: MapOpts): void {
  const session = game.session;
  const terrain = game.terrain;
  ctx.fillStyle = '#0c120d';
  ctx.fillRect(0, 0, w, h);
  if (!session) return;
  const ex = session.exploration;
  const [wx0, wz0] = s2w(view, w, h, 0, 0);
  const [wx1, wz1] = s2w(view, w, h, w, h);
  const c0x = cellOf(wx0) - 1, c1x = cellOf(wx1) + 1, c0z = cellOf(wz0) - 1, c1z = cellOf(wz1) + 1;
  const size = CELL * view.scale;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      if (!ex.isRevealed(cx, cz)) continue;
      const info = cellInfo(terrain, cx, cz);
      const [px, py] = w2s(view, w, h, cx * CELL, cz * CELL);
      ctx.fillStyle = `rgb(${info.r | 0},${info.g | 0},${info.b | 0})`;
      ctx.fillRect(px, py, size + 1, size + 1);
      if (opts.contours && size > 3) {
        const bucket = Math.floor(info.h / 10);
        ctx.fillStyle = 'rgba(30,20,10,0.45)';
        if (ex.isRevealed(cx + 1, cz) && Math.floor(cellInfo(terrain, cx + 1, cz).h / 10) !== bucket) ctx.fillRect(px + size, py, 1, size + 1);
        if (ex.isRevealed(cx, cz + 1) && Math.floor(cellInfo(terrain, cx, cz + 1).h / 10) !== bucket) ctx.fillRect(px, py + size, size + 1, 1);
      }
    }
  }
  if (!opts.markers) { drawPlayer(ctx, w, h, view, game, heading); return; }

  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const p of session.allPois()) {
    const known = session.isDiscovered(p);
    if (!known) continue;
    const [px, py] = w2s(view, w, h, p.x, p.z);
    if (px < -10 || py < -10 || px > w + 10 || py > h + 10) continue;
    ctx.fillStyle = POI_COLOR[p.kind] ?? '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    if (p.kind === 'summit') { ctx.moveTo(px, py - 6); ctx.lineTo(px + 6, py + 5); ctx.lineTo(px - 6, py + 5); ctx.closePath(); }
    else if (p.kind === 'cave') ctx.arc(px, py, 5, Math.PI, 0);
    else if (p.kind === 'campsite') { ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py + 4); ctx.lineTo(px - 5, py + 4); ctx.closePath(); }
    else ctx.rect(px - 4, py - 4, 8, 8);
    ctx.fill(); ctx.stroke();
    if (opts.labels) {
      ctx.fillStyle = '#fff';
      ctx.fillText(`${p.name} (${Math.round(p.y)} m)`, px, py - 9);
    }
  }
  for (const wp of ex.waypoints) {
    const [px, py] = w2s(view, w, h, wp.x, wp.z);
    ctx.strokeStyle = '#ffd060'; ctx.fillStyle = '#ffd060';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, py - 12); ctx.lineTo(px + 8, py - 9); ctx.lineTo(px, py - 6); ctx.closePath(); ctx.fill();
    if (opts.labels) { ctx.fillStyle = '#fff'; ctx.fillText(wp.name, px, py + 12); }
  }
  const obj = session.navAssist ? session.objectiveTarget() : null;
  if (obj) {
    const [px, py] = w2s(view, w, h, obj.x, obj.z);
    ctx.strokeStyle = '#ff6040'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fillStyle = '#ff6040'; ctx.fill();
    ctx.lineWidth = 1;
    if (opts.labels) { ctx.fillStyle = '#ffb090'; ctx.fillText(obj.label, px, py - 14); }
  }
  const tgt = session.trackTarget();
  if (tgt) {
    const f = game.character.feet;
    const [ax, ay] = w2s(view, w, h, f.x, f.z);
    const [bx, by] = w2s(view, w, h, tgt.x, tgt.z);
    ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,208,96,0.8)';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
  }
  drawPlayer(ctx, w, h, view, game, heading);
}

function drawPlayer(ctx: CanvasRenderingContext2D, w: number, h: number, view: MapView, game: Game, heading: number): void {
  const f = game.character.feet;
  const [px, py] = w2s(view, w, h, f.x, f.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(heading);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#102010';
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

const tmp = new THREE.Vector3();
/** Heading of the camera in radians, 0 = north, clockwise. */
export function headingOf(game: Game): number {
  game.camera.getWorldDirection(tmp);
  return Math.atan2(tmp.x, -tmp.z);
}

export function drawCompass(ctx: CanvasRenderingContext2D, w: number, h: number, game: Game, heading: number): void {
  ctx.clearRect(0, 0, w, h);
  const span = Math.PI; // visible arc
  const ppr = w / span;
  ctx.fillStyle = 'rgba(8,14,9,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let deg = 0; deg < 360; deg += 15) {
    const a = angleDiff(heading, (deg * Math.PI) / 180);
    if (Math.abs(a) > span / 2) continue;
    const x = w / 2 + a * ppr;
    const major = deg % 45 === 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(x, h - 4); ctx.lineTo(x, h - (major ? 14 : 8)); ctx.stroke();
    if (major) { ctx.fillStyle = deg === 0 ? '#ff8a70' : '#ffffff'; ctx.fillText(compassLabel((deg * Math.PI) / 180), x, 13); }
  }
  ctx.fillStyle = '#ffd060';
  ctx.beginPath(); ctx.moveTo(w / 2, h - 1); ctx.lineTo(w / 2 - 5, h + 5); ctx.lineTo(w / 2 + 5, h + 5); ctx.fill();
  const session = game.session;
  if (!session) return;
  const f = game.character.feet;
  const mark = (x: number, z: number, color: string, label: string) => {
    const a = angleDiff(heading, bearing(f.x, f.z, x, z));
    const cl = Math.max(-span / 2 + 0.05, Math.min(span / 2 - 0.05, a));
    const px = w / 2 + cl * ppr;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(px, 15); ctx.lineTo(px + 5, 21); ctx.lineTo(px, 27); ctx.lineTo(px - 5, 21); ctx.closePath(); ctx.fill();
    if (label) { ctx.fillStyle = '#fff'; ctx.font = '10px system-ui, sans-serif'; ctx.fillText(label, px, 36); }
  };
  for (const wp of session.exploration.waypoints) mark(wp.x, wp.z, '#ffd060', '');
  const tgt = session.trackTarget();
  if (tgt) mark(tgt.x, tgt.z, '#ff6040', `${tgt.label} ${Math.round(Math.hypot(tgt.x - f.x, tgt.z - f.z))} m`);
}
