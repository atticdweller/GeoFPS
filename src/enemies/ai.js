import * as THREE from 'three';
import { scene } from '../core/scene.js';
import { distXZ } from '../utils/math.js';

const _dir = new THREE.Vector3();

const ATTACK_RANGE = 1.8;
const ATTACK_COOLDOWN = 1.0;

/**
 * Update a single zombie's AI. Returns 'attack' if in attack range.
 * @param {Object} zombie — { group, speed, hp, attackTimer }
 * @param {THREE.Vector3} playerPos
 * @param {number} dt
 */
export function updateZombieAI(zombie, playerPos, dt) {
  const { group, speed } = zombie;

  // Face player
  _dir.set(
    playerPos.x - group.position.x,
    0,
    playerPos.z - group.position.z,
  );
  const dist = _dir.length();
  _dir.normalize();

  // Rotate to face player
  const angle = Math.atan2(_dir.x, _dir.z);
  group.rotation.y = angle;

  // Move toward player if not in attack range
  if (dist > ATTACK_RANGE) {
    group.position.x += _dir.x * speed * dt;
    group.position.z += _dir.z * speed * dt;
  }

  // Attack logic
  zombie.attackTimer -= dt;
  if (dist <= ATTACK_RANGE && zombie.attackTimer <= 0) {
    zombie.attackTimer = ATTACK_COOLDOWN;
    return 'attack';
  }

  return null;
}
