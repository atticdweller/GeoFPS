import * as THREE from 'three';
import { camera, scene } from '../core/scene.js';
import { onUpdate } from '../core/loop.js';
import { controls } from './controller.js';
import { materials } from '../utils/materials.js';

const raycaster = new THREE.Raycaster();
raycaster.far = 200;

let ammo = 30;
let maxAmmo = 30;
let reloading = false;
let reloadTimer = 0;
const RELOAD_TIME = 1.5;
const FIRE_RATE = 0.12; // seconds between shots
let fireCooldown = 0;

// Muzzle flash mesh (created lazily in initWeapon)
const flashGeo = new THREE.PlaneGeometry(0.15, 0.15);
let flashMesh;

// Hit marker timing
let hitMarkerTimer = 0;
let hitMarkerEl;
let ammoEl;

// Callbacks for when we hit something
const hitCallbacks = [];

export function onHit(fn) {
  hitCallbacks.push(fn);
}

export function initWeapon() {
  // Create muzzle flash now that scene exists
  flashMesh = new THREE.Mesh(flashGeo, materials.muzzleFlash);
  flashMesh.visible = false;
  scene.add(flashMesh);

  hitMarkerEl = document.getElementById('hit-marker');
  ammoEl = document.getElementById('ammo-display');

  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && controls.isLocked) {
      shoot();
    }
  });

  // Reload on R
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && !reloading && ammo < maxAmmo) {
      startReload();
    }
  });

  onUpdate((dt) => {
    fireCooldown = Math.max(0, fireCooldown - dt);

    // Muzzle flash auto-hide
    if (flashMesh.visible) {
      flashMesh.userData.timer -= dt;
      if (flashMesh.userData.timer <= 0) flashMesh.visible = false;
    }

    // Hit marker fade
    if (hitMarkerTimer > 0) {
      hitMarkerTimer -= dt;
      if (hitMarkerTimer <= 0) {
        hitMarkerEl.style.opacity = '0';
      }
    }

    // Reload
    if (reloading) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        ammo = maxAmmo;
        reloading = false;
        updateAmmoDisplay();
      }
    }
  });
}

function shoot() {
  if (fireCooldown > 0 || reloading) return;
  if (ammo <= 0) {
    startReload();
    return;
  }

  ammo--;
  fireCooldown = FIRE_RATE;
  updateAmmoDisplay();

  // Cast ray from camera center
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const intersects = raycaster.intersectObjects(scene.children, true);

  // Muzzle flash
  const flashPos = new THREE.Vector3(0.15, -0.1, -0.5);
  flashPos.applyMatrix4(camera.matrixWorld);
  flashMesh.position.copy(flashPos);
  flashMesh.lookAt(camera.position);
  flashMesh.visible = true;
  flashMesh.userData.timer = 0.05;

  if (intersects.length > 0) {
    const hit = intersects[0];

    // Skip non-shootable
    if (hit.object.userData.noShoot) return;

    // Show hit marker
    hitMarkerEl.style.opacity = '1';
    hitMarkerTimer = 0.15;

    // Create hit spark
    const sparkGeo = new THREE.SphereGeometry(0.05, 4, 4);
    const spark = new THREE.Mesh(sparkGeo, materials.hitSpark);
    spark.position.copy(hit.point);
    scene.add(spark);
    setTimeout(() => scene.remove(spark), 100);

    // Notify callbacks
    for (const fn of hitCallbacks) {
      fn(hit);
    }
  }

  // Auto reload when empty
  if (ammo <= 0) {
    startReload();
  }
}

function startReload() {
  reloading = true;
  reloadTimer = RELOAD_TIME;
  ammoEl.textContent = 'Reloading...';
}

function updateAmmoDisplay() {
  if (!reloading) {
    ammoEl.textContent = `${ammo} / ${maxAmmo}`;
  }
}
