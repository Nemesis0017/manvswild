import * as THREE from 'three';
import type { PhysicsWorld, RAPIER } from '../physics/physics';
import { SimplexNoise } from './noise';
import { hashInts } from './rng';
import type { CaveSite } from './features';

export const CAVE_TRIGGER_RADIUS = 2.4;

/** Rock arch with a dark opening, placed on a hillside, facing downhill. */
export function buildCaveEntrance(site: CaveSite): THREE.Group {
  const g = new THREE.Group();
  const rock = new THREE.MeshLambertMaterial({ color: 0x5a5651, flatShading: true });
  const dark = new THREE.MeshBasicMaterial({ color: 0x020202, side: THREE.DoubleSide });
  const mk = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rock);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.rotation.set(x, y, z);
    g.add(m);
  };
  mk(1.9, -2.3, 1.6, 0, 1, 1.5, 1);
  mk(1.9, 2.3, 1.6, 0, 1, 1.5, 1);
  mk(2.3, 0, 3.9, 0, 1.4, 0.8, 1);
  mk(1.6, -3.3, 0.7, 0.8);
  mk(1.6, 3.3, 0.7, 0.8);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.8, 16), dark);
  hole.position.set(0, 1.8, 0.1);
  hole.scale.set(1, 1.1, 1);
  g.add(hole);
  g.position.set(site.x, site.y - 0.2, site.z);
  // Local +Z faces outward (downhill).
  g.rotation.y = Math.atan2(site.dx, site.dz);
  return g;
}

/** World-space point just in front of the entrance where the player stands when exiting. */
export function caveOutsidePoint(site: CaveSite, terrainHeight: (x: number, z: number) => number) {
  const x = site.x + site.dx * 4.5, z = site.z + site.dz * 4.5;
  return { x, z, y: terrainHeight(x, z) };
}

/**
 * Underground chamber reached through a cave entrance. It is a separate enclosed room far below the
 * terrain (not a continuous tunnel through the heightfield), with its own trimesh collider.
 */
export class CaveInterior {
  readonly group = new THREE.Group();
  readonly floorY: number;
  readonly center: THREE.Vector3;
  readonly portal: THREE.Vector3;
  private body: RAPIER.RigidBody;
  private geos: THREE.BufferGeometry[] = [];

  constructor(private physics: PhysicsWorld, site: CaveSite) {
    const c = site.chamber;
    this.center = new THREE.Vector3(c.x, c.y, c.z);
    const noise = new SimplexNoise(hashInts(Math.round(site.x), Math.round(site.z)));
    const geo = new THREE.IcosahedronGeometry(1, 5);
    const p = geo.attributes.position;
    const floor = -4;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i), dy = p.getY(i), dz = p.getZ(i);
      const r = 19 + noise.fbm(dx * 2.2, dz * 2.2 + dy, 3) * 5 + noise.noise2(dx * 6 + dy, dz * 6) * 0.6;
      let y = dy * r * 0.45;
      if (y < floor) y = floor + noise.noise2(dx * 5, dz * 5) * 0.25;
      p.setXYZ(i, dx * r, y, dz * r);
    }
    geo.computeVertexNormals();
    this.floorY = c.y + floor + 0.3;
    this.geos.push(geo);
    const mat = new THREE.MeshLambertMaterial({ color: 0x6b645c, side: THREE.BackSide, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    this.group.add(mesh);

    // Glowing crystals (emissive, low colour intensity).
    const cg = new THREE.OctahedronGeometry(0.5, 0);
    this.geos.push(cg);
    const cm = new THREE.MeshBasicMaterial({ color: 0x66e0ff });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + noise.noise2(i, 3);
      const rr = 8 + (i % 4) * 2;
      const m = new THREE.Mesh(cg, cm);
      m.position.set(Math.cos(a) * rr, floor + 0.5, Math.sin(a) * rr);
      m.scale.set(0.8, 1.6 + (i % 3) * 0.6, 0.8);
      m.rotation.y = i;
      this.group.add(m);
    }
    const l1 = new THREE.PointLight(0xffc880, 70, 60, 1.6);
    l1.position.set(0, 3, 0);
    const l2 = new THREE.PointLight(0x66ccff, 40, 40, 1.8);
    l2.position.set(-8, -1, 6);
    this.group.add(l1, l2);

    // Exit portal at the +X wall.
    const pg = new THREE.TorusGeometry(1.2, 0.18, 8, 20);
    this.geos.push(pg);
    const portal = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    portal.position.set(11, floor + 1.4, 0);
    portal.rotation.y = Math.PI / 2;
    this.group.add(portal);
    this.portal = new THREE.Vector3(c.x + 11, this.floorY + 1, c.z);

    this.group.position.copy(this.center);
    const positions = new Float32Array(p.array as ArrayLike<number>);
    const idx = geo.index
      ? new Uint32Array(geo.index.array as ArrayLike<number>)
      : Uint32Array.from({ length: p.count }, (_, i) => i);
    this.body = physics.addStaticTrimesh(c.x, c.y, c.z, positions, idx);
  }

  /** Where the player appears when entering. */
  get spawn(): { x: number; y: number; z: number } {
    return { x: this.center.x - 8, y: this.floorY + 0.1, z: this.center.z };
  }

  dispose(): void {
    this.physics.remove(this.body);
    this.geos.forEach((g) => g.dispose());
  }
}
