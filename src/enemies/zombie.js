import * as THREE from 'three';
import { materials } from '../utils/materials.js';

/**
 * Create a procedural blocky zombie model.
 * Returns a THREE.Group with body parts as children.
 */
export function createZombieModel() {
  const group = new THREE.Group();
  group.userData.isZombie = true;

  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    materials.zombieFlesh,
  );
  head.position.y = 1.85;
  head.castShadow = true;
  group.add(head);

  // Torso
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.8, 0.35),
    materials.zombieClothes,
  );
  torso.position.y = 1.2;
  torso.castShadow = true;
  group.add(torso);

  // Left arm
  const leftArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.7, 0.2),
    materials.zombieFlesh,
  );
  leftArm.position.set(-0.45, 1.25, 0);
  leftArm.castShadow = true;
  leftArm.name = 'leftArm';
  group.add(leftArm);

  // Right arm
  const rightArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.7, 0.2),
    materials.zombieFlesh,
  );
  rightArm.position.set(0.45, 1.25, 0);
  rightArm.castShadow = true;
  rightArm.name = 'rightArm';
  group.add(rightArm);

  // Left leg
  const leftLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.7, 0.25),
    materials.zombieDark,
  );
  leftLeg.position.set(-0.15, 0.35, 0);
  leftLeg.castShadow = true;
  leftLeg.name = 'leftLeg';
  group.add(leftLeg);

  // Right leg
  const rightLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.7, 0.25),
    materials.zombieDark,
  );
  rightLeg.position.set(0.15, 0.35, 0);
  rightLeg.castShadow = true;
  rightLeg.name = 'rightLeg';
  group.add(rightLeg);

  // Eyes (small red cubes)
  const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.06);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.12, 1.9, 0.25);
  group.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.12, 1.9, 0.25);
  group.add(rightEye);

  return group;
}

/**
 * Animate zombie walking — call each frame with elapsed time.
 */
export function animateZombie(group, time, speed) {
  const swingAmount = 0.5 * speed;
  const swingSpeed = 6;

  const leftArm = group.getObjectByName('leftArm');
  const rightArm = group.getObjectByName('rightArm');
  const leftLeg = group.getObjectByName('leftLeg');
  const rightLeg = group.getObjectByName('rightLeg');

  if (leftLeg) leftLeg.rotation.x = Math.sin(time * swingSpeed) * swingAmount;
  if (rightLeg) rightLeg.rotation.x = -Math.sin(time * swingSpeed) * swingAmount;
  // Arms reach forward (zombie pose) + slight swing
  if (leftArm) leftArm.rotation.x = -1.2 + Math.sin(time * swingSpeed * 0.5) * 0.2;
  if (rightArm) rightArm.rotation.x = -1.2 - Math.sin(time * swingSpeed * 0.5) * 0.2;
}
