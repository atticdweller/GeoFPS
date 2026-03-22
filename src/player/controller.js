import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { camera, scene } from '../core/scene.js';
import { onUpdate } from '../core/loop.js';
import { keys, initInput } from '../core/input.js';

export let controls;
let physicsBody;
let canJump = false;
const direction = new THREE.Vector3();

const MOVE_SPEED = 8;
const SPRINT_MULTIPLIER = 2.5;
const FLY_SPRINT_MULTIPLIER = 8;
const JUMP_VELOCITY = 8;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;

let wasDebugMode = true; // track toggle transitions

export function initPlayer(world) {
  initInput();

  // Pointer lock controls
  controls = new PointerLockControls(camera, document.body);

  const blocker = document.getElementById('blocker');
  blocker.addEventListener('click', () => controls.lock());

  controls.addEventListener('lock', () => {
    blocker.style.display = 'none';
  });

  controls.addEventListener('unlock', () => {
    blocker.style.display = 'flex';
  });

  // Physics body — cylinder approximated as a sphere for simplicity
  const shape = new CANNON.Sphere(PLAYER_RADIUS);
  physicsBody = new CANNON.Body({
    mass: 80,
    shape,
    linearDamping: 0.05,
    fixedRotation: true,
    material: new CANNON.Material({ friction: 0.1, restitution: 0 }),
  });
  physicsBody.position.set(0, PLAYER_HEIGHT + 5, 0);
  world.addBody(physicsBody);

  // Detect ground contact for jumping
  physicsBody.addEventListener('collide', (e) => {
    const contactNormal = new CANNON.Vec3();
    const contact = e.contact;
    if (contact.bi.id === physicsBody.id) {
      contact.ni.negate(contactNormal);
    } else {
      contactNormal.copy(contact.ni);
    }
    // If normal points mostly upward, we're on ground
    if (contactNormal.y > 0.5) {
      canJump = true;
    }
  });

  // Register update
  onUpdate((dt) => updatePlayer(dt));
}

function updatePlayer(dt) {
  if (!controls.isLocked) return;

  // Handle debug mode toggle transitions
  if (!keys.debugMode && wasDebugMode) {
    // Switching from debug to normal: teleport physics body to camera
    physicsBody.position.set(camera.position.x, camera.position.y - PLAYER_HEIGHT + PLAYER_RADIUS, camera.position.z);
    physicsBody.velocity.set(0, 0, 0);
  }
  wasDebugMode = keys.debugMode;

  if (keys.debugMode) {
    updateDebugMode(dt);
  } else {
    updateNormalMode(dt);
  }
}

function updateDebugMode(dt) {
  const speed = MOVE_SPEED * (keys.sprint ? FLY_SPRINT_MULTIPLIER : 1);

  // Movement direction from keys
  direction.z = Number(keys.forward) - Number(keys.backward);
  direction.x = Number(keys.right) - Number(keys.left);
  direction.y = Number(keys.up) - Number(keys.down);
  direction.normalize();

  // Full 3D camera-relative movement (don't zero Y for forward/back)
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.normalize();

  const right = new THREE.Vector3();
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  const up = new THREE.Vector3(0, 1, 0);

  // Move camera directly — no physics
  camera.position.x += (forward.x * direction.z + right.x * direction.x) * speed * dt;
  camera.position.y += (forward.y * direction.z + up.y * direction.y) * speed * dt;
  camera.position.z += (forward.z * direction.z + right.z * direction.x) * speed * dt;

  // Keep physics body in sync but don't let it interfere
  physicsBody.velocity.set(0, 0, 0);
  physicsBody.position.set(camera.position.x, camera.position.y - PLAYER_HEIGHT + PLAYER_RADIUS, camera.position.z);
}

function updateNormalMode(dt) {
  const speed = MOVE_SPEED * (keys.sprint ? SPRINT_MULTIPLIER : 1);

  // Movement direction from keys
  direction.z = Number(keys.forward) - Number(keys.backward);
  direction.x = Number(keys.right) - Number(keys.left);
  direction.normalize();

  // Get camera-relative movement
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3();
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  // Set velocity directly for responsive FPS movement
  const moveX = (forward.x * direction.z + right.x * direction.x) * speed;
  const moveZ = (forward.z * direction.z + right.z * direction.x) * speed;
  physicsBody.velocity.x = moveX;
  physicsBody.velocity.z = moveZ;

  // Jump
  if (keys.jump && canJump) {
    physicsBody.velocity.y = JUMP_VELOCITY;
    canJump = false;
  }

  // Sync camera to physics body
  camera.position.set(
    physicsBody.position.x,
    physicsBody.position.y + PLAYER_HEIGHT - PLAYER_RADIUS,
    physicsBody.position.z,
  );
}

export function getPlayerPosition() {
  return camera.position;
}
