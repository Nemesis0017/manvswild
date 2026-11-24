import * as THREE from 'three';

/** Procedural humanoid with simple walk, run, swim, crouch and climb animation. */
export class PlayerModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head: THREE.Mesh;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private phase = 0;
  private yawSmooth = 0;
  private lean = 0;

  constructor() {
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a57c });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x6a7f4a });
    const pants = new THREE.MeshLambertMaterial({ color: 0x4a4036 });
    const pack = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const box = (w: number, h: number, d: number, m: THREE.Material, y = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.y = y;
      mesh.castShadow = true;
      return mesh;
    };
    this.hips.position.y = 0.95;
    this.root.add(this.hips);
    this.torso.position.y = 0.05;
    this.torso.add(box(0.5, 0.65, 0.28, shirt, 0.32));
    const bp = box(0.4, 0.5, 0.2, pack, 0.35);
    bp.position.z = 0.24;
    this.torso.add(bp);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
    this.head.position.y = 0.82;
    this.head.castShadow = true;
    this.torso.add(this.head);
    const hat = box(0.34, 0.06, 0.34, pack, 0.95);
    this.torso.add(hat);
    this.hips.add(this.torso);
    for (const [arm, x] of [[this.armL, -0.33], [this.armR, 0.33]] as const) {
      arm.position.set(x, 0.62, 0);
      const a = box(0.14, 0.58, 0.14, shirt, -0.26);
      arm.add(a);
      this.torso.add(arm);
    }
    for (const [leg, x] of [[this.legL, -0.14], [this.legR, 0.14]] as const) {
      leg.position.set(x, 0, 0);
      leg.add(box(0.18, 0.92, 0.18, pants, -0.46));
      this.hips.add(leg);
    }
    this.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : 0));
  }

  /** Place with feet at (x,y,z), facing `yaw` (0 faces -Z). */
  update(
    dt: number,
    feet: { x: number; y: number; z: number },
    yaw: number,
    s: { speed: number; grounded: boolean; swimming: boolean; climbing: boolean; crouching: boolean },
    reducedMotion = false,
  ): void {
    this.root.position.set(feet.x, feet.y, feet.z);
    let d = yaw - this.yawSmooth;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yawSmooth += d * Math.min(1, dt * 12);
    this.root.rotation.y = this.yawSmooth;

    const moving = s.speed > 0.2;
    const rate = s.swimming ? 4 : 1.6 + s.speed * 0.9;
    if (moving || s.climbing) this.phase += dt * rate * (s.climbing ? 1.2 : 1);
    const amp = reducedMotion ? 0.3 : 1;
    const swing = Math.min(1, s.speed / 4) * 0.9 * amp;
    const sw = Math.sin(this.phase * 2);

    if (s.swimming) {
      this.hips.position.y = 0.2;
      this.hips.rotation.x = -1.2 * (s.speed > 0.2 ? 1 : 0.4);
      this.legL.rotation.x = sw * 0.5;
      this.legR.rotation.x = -sw * 0.5;
      this.armL.rotation.x = Math.PI + sw * 0.9;
      this.armR.rotation.x = Math.PI - sw * 0.9;
      this.lean = 0;
    } else if (s.climbing) {
      this.hips.position.y = 0.95;
      this.hips.rotation.x = -0.25;
      this.legL.rotation.x = sw * 0.7;
      this.legR.rotation.x = -sw * 0.7;
      this.armL.rotation.x = Math.PI * 0.85 - sw * 0.5;
      this.armR.rotation.x = Math.PI * 0.85 + sw * 0.5;
    } else {
      const crouchY = s.crouching ? 0.78 : 0.95;
      this.hips.position.y += (crouchY - this.hips.position.y) * Math.min(1, dt * 12);
      this.lean += ((s.speed > 5.5 ? 0.25 : 0.05) - this.lean) * Math.min(1, dt * 8);
      this.hips.rotation.x = s.crouching ? 0.25 : this.lean;
      if (!s.grounded) {
        this.legL.rotation.x = -0.5; this.legR.rotation.x = 0.3;
        this.armL.rotation.x = -0.8; this.armR.rotation.x = -0.8;
      } else {
        this.legL.rotation.x = sw * swing;
        this.legR.rotation.x = -sw * swing;
        this.armL.rotation.x = -sw * swing * 0.9;
        this.armR.rotation.x = sw * swing * 0.9;
      }
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }
}
