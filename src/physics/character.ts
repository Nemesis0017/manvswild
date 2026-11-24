import { RAPIER, type PhysicsWorld } from './physics';
import type { Terrain } from '../world/terrain';
import { WATER_Y } from '../world/terrain';
import { events } from '../core/events';

export interface MoveCommand {
  x: number; // strafe right
  y: number; // forward
  yaw: number;
  jump: boolean;
  jumpPressed: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Optional movement speed multiplier from encumbrance, injuries, weather, grip. */
  speedMul?: number;
  /** Optional extra water velocity (river current) in m/s. */
  current?: { x: number; z: number };
}

export const CAPSULE_RADIUS = 0.35;
export const CAPSULE_HALF = 0.55; // half-height of the cylindrical part
export const BODY_HALF_HEIGHT = CAPSULE_HALF + CAPSULE_RADIUS; // centre to feet

export interface CharacterState {
  grounded: boolean;
  swimming: boolean;
  climbing: boolean;
  sliding: boolean;
  crouching: boolean;
  sprinting: boolean;
  speed: number; // horizontal m/s
}

export const WALK_SPEED = 4.2;
export const SPRINT_SPEED = 7.4;
export const CROUCH_SPEED = 2.0;
export const SWIM_SPEED = 2.6;
const GRAVITY = 22;
const JUMP_V = 7.6;
const CLIMB_SPEED = 2.2;

/** Kinematic Rapier character: walk, run, sprint, jump, crouch, swim, slope slide and climbing of rock faces. */
export class CharacterController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  readonly state: CharacterState = {
    grounded: false, swimming: false, climbing: false, sliding: false,
    crouching: false, sprinting: false, speed: 0,
  };
  vx = 0; vy = 0; vz = 0;
  /** Disables terrain safety net while underground in caves. */
  underground = false;
  frozen = false;
  private wasGrounded = false;
  private lastVy = 0;
  /** Decaying push velocity, for knockbacks. */
  knockX = 0; knockZ = 0;

  constructor(physics: PhysicsWorld, private terrain: Terrain, feetX: number, feetY: number, feetZ: number) {
    const w = physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feetX, feetY + BODY_HALF_HEIGHT, feetZ),
    );
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS), this.body);
    this.ctrl = w.createCharacterController(0.02);
    this.ctrl.setUp({ x: 0, y: 1, z: 0 });
    this.ctrl.setSlideEnabled(true);
    this.ctrl.enableAutostep(0.45, 0.2, false);
    this.ctrl.enableSnapToGround(0.35);
    this.ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.ctrl.setApplyImpulsesToDynamicBodies(false);
  }

  get feet(): { x: number; y: number; z: number } {
    const t = this.body.translation();
    return { x: t.x, y: t.y - BODY_HALF_HEIGHT, z: t.z };
  }

  /** Add a knockback impulse (m/s) that fades over about half a second. */
  push(x: number, z: number): void {
    this.knockX += x;
    this.knockZ += z;
  }

  teleport(x: number, feetY: number, z: number): void {
    this.body.setTranslation({ x, y: feetY + BODY_HALF_HEIGHT, z }, true);
    this.vx = this.vy = this.vz = 0;
  }

  update(dt: number, cmd: MoveCommand): void {
    const st = this.state;
    if (this.frozen) { st.speed = 0; return; }
    const t = this.body.translation();
    const feetY = t.y - BODY_HALF_HEIGHT;
    const gh = this.underground ? -Infinity : this.terrain.heightAt(t.x, t.z);

    // Environment checks.
    const waterDepth = this.underground ? 0 : WATER_Y - gh;
    const swimming = waterDepth > 1.0 && feetY < WATER_Y - 0.9;
    st.swimming = swimming;

    st.crouching = cmd.crouch && !swimming;
    st.sprinting = cmd.sprint && !st.crouching && cmd.y > 0 && !swimming;
    let speed = st.crouching ? CROUCH_SPEED : st.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (swimming) speed = SWIM_SPEED * (cmd.sprint ? 1.4 : 1);
    speed *= cmd.speedMul ?? 1;
    const inputLen = Math.hypot(cmd.x, cmd.y);

    // Camera-relative horizontal direction (yaw 0 looks toward -Z).
    const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
    const dirX = cmd.x * cos - cmd.y * sin;
    const dirZ = -cmd.x * sin - cmd.y * cos;
    const targetX = dirX * speed, targetZ = dirZ * speed;
    const accel = st.grounded || swimming ? 14 : 3.5;
    const k = Math.min(1, accel * dt);
    this.vx += (targetX - this.vx) * k;
    this.vz += (targetZ - this.vz) * k;

    // Climbing marked rock faces: walking into a steep, climbable slope.
    let climbing = false;
    if (!this.underground && cmd.y > 0 && !swimming && inputLen > 0.1) {
      const hx = dirX / (inputLen || 1), hz = dirZ / (inputLen || 1);
      const ax = t.x + hx * 0.7, az = t.z + hz * 0.7;
      const slope = this.terrain.slopeAt(ax, az, 0.6);
      const ahead = this.terrain.heightAt(ax, az);
      if (slope > 1.05 && this.terrain.isClimbable(ax, az) && ahead > feetY - 0.2) climbing = true;
    }
    st.climbing = climbing;

    if (climbing) {
      this.vy = CLIMB_SPEED;
      this.vx *= 0.35; this.vz *= 0.35;
    } else if (swimming) {
      const surfaceFeet = WATER_Y - 1.35; // head and shoulders above the water
      let target = (surfaceFeet - feetY) * 2.2;
      if (cmd.jump) target = 2.2;
      if (cmd.crouch) target = -2.4;
      this.vy += (target - this.vy) * Math.min(1, 6 * dt);
    } else {
      this.vy -= GRAVITY * dt;
      if (st.grounded && cmd.jumpPressed && !st.sliding) {
        this.vy = JUMP_V;
        events.emit('playerJumped', undefined);
      }
      if (this.vy < -45) this.vy = -45;
    }

    const cur = swimming && cmd.current ? cmd.current : { x: 0, z: 0 };
    const kd = Math.exp(-5 * dt);
    this.knockX *= kd; this.knockZ *= kd;
    const desired = { x: (this.vx + cur.x + this.knockX) * dt, y: this.vy * dt, z: (this.vz + cur.z + this.knockZ) * dt };
    this.ctrl.computeColliderMovement(this.collider, desired);
    const m = this.ctrl.computedMovement();
    const grounded = this.ctrl.computedGrounded();
    this.lastVy = this.vy;

    if (grounded && this.vy <= 0) this.vy = 0;
    // Head bump.
    if (this.vy > 0 && m.y < desired.y * 0.5 && !climbing && !swimming) this.vy = 0;

    st.grounded = grounded && !climbing;
    st.sliding = false;
    if (grounded && !climbing) {
      const sl = this.terrain.slopeAt(t.x, t.z, 0.8);
      st.sliding = sl > Math.tan((55 * Math.PI) / 180);
    }
    if (st.grounded && !this.wasGrounded && this.lastVy < -9) {
      events.emit('playerLanded', { speed: -this.lastVy });
    }
    this.wasGrounded = st.grounded;

    let nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    // Safety net: never let the player fall through unloaded or thin terrain.
    if (!this.underground) {
      const g = this.terrain.heightAt(nx, nz);
      if (ny - BODY_HALF_HEIGHT < g - 2.5) {
        ny = g + BODY_HALF_HEIGHT + 0.05;
        this.vy = 0;
      }
    }
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    st.speed = Math.hypot(m.x, m.z) / dt;
  }
}
