import * as THREE from 'three';
import type { Terrain } from '../world/terrain';
import { events } from '../core/events';

export type CameraMode = 'first' | 'third';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.15;

/** First/third person camera with a cinematic intro fly-in. */
export class PlayerCamera {
  yaw = 0;
  pitch = 0;
  mode: CameraMode = 'first';
  eye = EYE_STAND;
  private tpDist = 4.2;
  private tpCurrent = 4.2;
  private intro = { active: false, t: 0, duration: 7 };
  private tmp = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera, private terrain: Terrain) {}

  get introActive(): boolean {
    return this.intro.active;
  }

  startIntro(): void {
    this.intro = { active: true, t: 0, duration: 7 };
  }

  skipIntro(): void {
    this.intro.active = false;
  }

  toggle(): void {
    this.mode = this.mode === 'first' ? 'third' : 'first';
    events.emit('cameraModeChanged', { mode: this.mode });
  }

  look(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const k = 0.0022 * sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  update(dt: number, feet: { x: number; y: number; z: number }, crouching: boolean, swimmingLow: boolean): void {
    const targetEye = crouching ? EYE_CROUCH : swimmingLow ? 1.3 : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    const head = this.tmp.set(feet.x, feet.y + this.eye, feet.z);
    const cam = this.camera;

    if (this.intro.active) {
      this.intro.t += dt;
      const u = Math.min(1, this.intro.t / this.intro.duration);
      const e = u * u * (3 - 2 * u);
      const ang = this.yaw + Math.PI * (1 - e) * 1.2;
      const radius = 45 * (1 - e) + this.tpDist * e;
      const height = 40 * (1 - e) + 2.2 * e;
      const px = feet.x + Math.sin(ang) * radius;
      const pz = feet.z + Math.cos(ang) * radius;
      const py = Math.max(feet.y + height, this.terrain.heightAt(px, pz) + 2);
      cam.position.set(px, py, pz);
      cam.lookAt(feet.x, feet.y + 1.2, feet.z);
      if (u >= 1) this.intro.active = false;
      return;
    }

    if (this.mode === 'first') {
      cam.position.copy(head);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(this.pitch, this.yaw, 0);
    } else {
      cam.rotation.order = 'YXZ';
      // Orbit behind the player; pull in when terrain would block the view.
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const dirX = Math.sin(this.yaw) * cp, dirZ = Math.cos(this.yaw) * cp;
      let dist = this.tpDist;
      for (; dist > 0.8; dist -= 0.4) {
        const x = head.x + dirX * dist, z = head.z + dirZ * dist;
        const cy = head.y + 0.3 - sp * dist;
        if (cy > this.terrain.heightAt(x, z) + 0.5) break;
      }
      this.tpCurrent += (dist - this.tpCurrent) * Math.min(1, dt * 10);
      const cx = head.x + dirX * this.tpCurrent;
      const cz = head.z + dirZ * this.tpCurrent;
      const cy = Math.max(head.y + 0.3 - sp * this.tpCurrent, this.terrain.heightAt(cx, cz) + 0.4);
      cam.position.set(cx, cy, cz);
      cam.lookAt(head.x, head.y + 0.1, head.z);
    }
  }
}
