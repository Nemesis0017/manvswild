import * as THREE from 'three';
import type { BuildKind } from '../items/crafting';

const lam = (c: number, side: THREE.Side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ color: c, side });
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
const sph = new THREE.SphereGeometry(0.5, 7, 5);
const cone = new THREE.ConeGeometry(0.5, 1, 7);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.scale.set(sx, sy, sz);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

export interface PieceMesh {
  root: THREE.Group;
  /** Flame objects to flicker when lit. */
  flame?: THREE.Object3D;
}

/** Procedural low-poly model for each build piece, origin at ground level. */
export function makePieceMesh(kind: BuildKind): PieceMesh {
  const root = new THREE.Group();
  const out: PieceMesh = { root };
  switch (kind) {
    case 'campfire': {
      const stone = lam(0x76766e), wood = lam(0x5a3a22);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        root.add(mesh(sph, stone, 0.3, 0.22, 0.3, Math.cos(a) * 0.65, 0.1, Math.sin(a) * 0.65));
      }
      for (let i = 0; i < 3; i++) {
        const l = mesh(cyl, wood, 0.12, 0.9, 0.12, 0, 0.2, 0);
        l.rotation.set(Math.PI / 2 - 0.2, (i / 3) * Math.PI * 2, 0);
        root.add(l);
      }
      const flame = new THREE.Group();
      flame.add(mesh(cone, new THREE.MeshBasicMaterial({ color: 0xff8a20 }), 0.45, 0.9, 0.45, 0, 0.7, 0));
      flame.add(mesh(cone, new THREE.MeshBasicMaterial({ color: 0xffe070 }), 0.25, 0.55, 0.25, 0, 0.55, 0));
      root.add(flame);
      out.flame = flame;
      break;
    }
    case 'shelter': {
      const pole = lam(0x6a4a2a), thatch = lam(0x4f7a30, THREE.DoubleSide);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        root.add(mesh(cyl, pole, 0.08, sx > 0 ? 1.0 : 2.0, 0.08, sx * 1.5, sx > 0 ? 0.5 : 1.0, sz * 1.6));
      }
      const roof = mesh(box, thatch, 3.6, 0.07, 3.8, 0, 1.5, 0);
      roof.rotation.z = Math.atan2(1.0, 3.0);
      root.add(roof);
      const back = mesh(box, thatch, 0.07, 1.9, 3.8, -1.55, 1.0, 0);
      root.add(back);
      break;
    }
    case 'sleeping_area': {
      root.add(mesh(box, lam(0x6f8a3a), 1.1, 0.12, 2.0, 0, 0.06, 0));
      root.add(mesh(box, lam(0x8aa04a), 0.9, 0.08, 1.7, 0, 0.14, 0));
      root.add(mesh(sph, lam(0xd8caa0), 0.5, 0.2, 0.35, 0, 0.25, -0.75));
      break;
    }
    case 'storage': {
      const w = lam(0x7a5430);
      root.add(mesh(box, w, 1.1, 0.7, 0.8, 0, 0.35, 0));
      root.add(mesh(box, lam(0x4a3220), 1.14, 0.08, 0.84, 0, 0.72, 0));
      root.add(mesh(box, lam(0x4a3220), 0.1, 0.72, 0.86, 0.3, 0.36, 0));
      root.add(mesh(box, lam(0x4a3220), 0.1, 0.72, 0.86, -0.3, 0.36, 0));
      break;
    }
  }
  return out;
}

/** Recolor a model into a translucent preview. */
export function makeGhost(kind: BuildKind): PieceMesh {
  const m = makePieceMesh(kind);
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
      mesh.castShadow = false;
    }
  });
  return m;
}

export function setGhostValid(ghost: PieceMesh, valid: boolean): void {
  ghost.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) (mesh.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0x40ff60 : 0xff4040);
  });
}
