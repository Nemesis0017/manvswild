import RAPIER from '@dimforge/rapier3d-compat';
import type { Placement } from '../world/vegetation';

export { RAPIER };

/** Thin wrapper around the Rapier world. WASM is inlined by rapier3d-compat, so no network fetch occurs. */
export class PhysicsWorld {
  readonly world: RAPIER.World;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** Static terrain trimesh (vertices local to chunk origin) plus trunk/rock colliders. */
  addChunkCollider(
    ox: number, oz: number,
    positions: Float32Array, indices: Uint32Array,
    solids: Placement[],
  ): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(ox, 0, oz));
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(0.8), body);
    for (const s of solids) {
      if (s.radius <= 0) continue;
      const h = Math.min(s.height, 6);
      const desc = RAPIER.ColliderDesc.cylinder(h / 2, s.radius).setTranslation(s.x - ox, s.y + h / 2, s.z - oz);
      this.world.createCollider(desc, body);
    }
    return body;
  }

  /** Static trimesh at an arbitrary position (cave chambers). */
  addStaticTrimesh(x: number, y: number, z: number, positions: Float32Array, indices: Uint32Array): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(0.8), body);
    return body;
  }

  remove(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
  }
}
