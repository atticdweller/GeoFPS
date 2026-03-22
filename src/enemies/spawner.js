import * as THREE from 'three';
import { scene } from '../core/scene.js';
import { onUpdate } from '../core/loop.js';
import { getPlayerPosition } from '../player/controller.js';
import { onHit } from '../player/weapon.js';
import { damage, addKill, setWave } from '../player/hud.js';
import { createZombieModel, animateZombie } from './zombie.js';
import { updateZombieAI } from './ai.js';
import { randRange } from '../utils/math.js';

const zombies = [];
let wave = 0;
let zombiesRemaining = 0;
let spawnTimer = 0;
let toSpawn = 0;
let elapsed = 0;

const SPAWN_RADIUS = 50;
const SPAWN_INTERVAL = 1.5; // seconds between spawns within a wave
const ZOMBIE_HP = 3;

export function initEnemies() {
  // Start wave 1
  startWave();

  // Handle hits on zombies
  onHit((hit) => {
    // Walk up the parent chain to find zombie group
    let obj = hit.object;
    while (obj) {
      if (obj.userData.isZombie) {
        const zombie = zombies.find((z) => z.group === obj);
        if (zombie && zombie.hp > 0) {
          zombie.hp--;
          // Flash white briefly
          obj.traverse((child) => {
            if (child.isMesh && child.material) {
              const origColor = child.material.color.getHex();
              child.material.color.setHex(0xffffff);
              setTimeout(() => child.material.color.setHex(origColor), 80);
            }
          });
          if (zombie.hp <= 0) {
            killZombie(zombie);
          }
        }
        break;
      }
      obj = obj.parent;
    }
  });

  // Update loop
  onUpdate((dt) => {
    elapsed += dt;
    const playerPos = getPlayerPosition();

    // Spawn queued zombies
    if (toSpawn > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnOne(playerPos);
        toSpawn--;
        spawnTimer = SPAWN_INTERVAL;
      }
    }

    // Update living zombies
    for (const zombie of zombies) {
      if (zombie.hp <= 0) continue;
      const action = updateZombieAI(zombie, playerPos, dt);
      animateZombie(zombie.group, elapsed + zombie.timeOffset, zombie.speed);
      if (action === 'attack') {
        damage(10);
      }
    }

    // Check if wave is cleared
    if (toSpawn <= 0 && zombies.every((z) => z.hp <= 0) && zombies.length > 0) {
      setTimeout(() => startWave(), 2000);
    }
  });
}

function startWave() {
  wave++;
  setWave(wave);
  toSpawn = 3 + wave * 2;
  zombiesRemaining = toSpawn;
  spawnTimer = 0;
}

function spawnOne(playerPos) {
  const model = createZombieModel();
  // Spawn around the edge
  const angle = Math.random() * Math.PI * 2;
  const radius = SPAWN_RADIUS + Math.random() * 20;
  model.position.set(
    playerPos.x + Math.cos(angle) * radius,
    0,
    playerPos.z + Math.sin(angle) * radius,
  );
  scene.add(model);

  zombies.push({
    group: model,
    speed: randRange(1.2, 2.5),
    hp: ZOMBIE_HP,
    attackTimer: 0,
    timeOffset: Math.random() * 10,
  });
}

function killZombie(zombie) {
  addKill();
  zombiesRemaining--;

  // Death animation: scatter parts
  const parts = [];
  zombie.group.traverse((child) => {
    if (child.isMesh) parts.push(child);
  });

  // Detach parts and give them random velocities
  for (const part of parts) {
    const worldPos = new THREE.Vector3();
    part.getWorldPosition(worldPos);
    scene.attach(part);
    part.position.copy(worldPos);
    part.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      Math.random() * 5 + 2,
      (Math.random() - 0.5) * 4,
    );
    part.userData.deathTimer = 2.0;
  }

  scene.remove(zombie.group);

  // Animate falling parts
  const animateParts = (dt) => {
    let allDone = true;
    for (const part of parts) {
      if (!part.parent) continue;
      part.userData.deathTimer -= dt;
      if (part.userData.deathTimer <= 0) {
        scene.remove(part);
        continue;
      }
      allDone = false;
      part.userData.velocity.y -= 9.8 * dt;
      part.position.addScaledVector(part.userData.velocity, dt);
      part.rotation.x += dt * 3;
      part.rotation.z += dt * 2;
      if (part.position.y < 0) {
        part.position.y = 0;
        part.userData.velocity.y = 0;
        part.userData.velocity.multiplyScalar(0.5);
      }
    }
  };

  // Hook into update for death animation
  onUpdate(animateParts);
}
