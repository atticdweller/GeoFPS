import * as THREE from 'three';

// Shared material palette — reuse these everywhere for consistency + perf
export const materials = {
  // Terrain
  grass: new THREE.MeshLambertMaterial({ color: 0x4a7c3f }),
  dirt: new THREE.MeshLambertMaterial({ color: 0x8b6914 }),

  // Buildings
  wallExterior: new THREE.MeshLambertMaterial({ color: 0xd4c5a9 }),
  wallInterior: new THREE.MeshLambertMaterial({ color: 0xf0ead6 }),
  wallCommercial: new THREE.MeshLambertMaterial({ color: 0x9a9a9a }),
  roof: new THREE.MeshLambertMaterial({ color: 0x8b4513 }),
  floor: new THREE.MeshLambertMaterial({ color: 0xc4a76c }),
  ceiling: new THREE.MeshLambertMaterial({ color: 0xeeeee4 }),
  glass: new THREE.MeshLambertMaterial({
    color: 0x88ccff, transparent: true, opacity: 0.3,
  }),

  // Furniture
  wood: new THREE.MeshLambertMaterial({ color: 0x8b6c42 }),
  fabric: new THREE.MeshLambertMaterial({ color: 0x3a4a6b }),
  metal: new THREE.MeshLambertMaterial({ color: 0x888888 }),
  porcelain: new THREE.MeshLambertMaterial({ color: 0xf5f5f0 }),
  counter: new THREE.MeshLambertMaterial({ color: 0x444444 }),
  bedRed: new THREE.MeshLambertMaterial({ color: 0x993333 }),
  bedBlue: new THREE.MeshLambertMaterial({ color: 0x335599 }),

  // Roads
  asphalt: new THREE.MeshLambertMaterial({ color: 0x333333 }),
  sidewalk: new THREE.MeshLambertMaterial({ color: 0xaaaaaa }),
  curb: new THREE.MeshLambertMaterial({ color: 0x999999 }),
  laneMarkingWhite: new THREE.MeshLambertMaterial({ color: 0xeeeeee }),
  laneMarkingYellow: new THREE.MeshLambertMaterial({ color: 0xdddd44 }),

  // Building extras
  door: new THREE.MeshLambertMaterial({ color: 0x6b4226 }),
  windowFrame: new THREE.MeshLambertMaterial({ color: 0x555555 }),

  // Commercial interiors
  shelf: new THREE.MeshLambertMaterial({ color: 0x666666 }),
  commercialFloor: new THREE.MeshLambertMaterial({ color: 0xbbbbbb }),

  // Street furniture
  lampPost: new THREE.MeshLambertMaterial({ color: 0x333333 }),
  lampHead: new THREE.MeshBasicMaterial({ color: 0xffeeaa }),
  hydrant: new THREE.MeshLambertMaterial({ color: 0xcc2222 }),
  mailbox: new THREE.MeshLambertMaterial({ color: 0x2255aa }),
  garbageCan: new THREE.MeshLambertMaterial({ color: 0x444444 }),

  // Vehicles
  carPaintRed: new THREE.MeshLambertMaterial({ color: 0xcc2222 }),
  carPaintBlue: new THREE.MeshLambertMaterial({ color: 0x2244aa }),
  carPaintWhite: new THREE.MeshLambertMaterial({ color: 0xdddddd }),
  carPaintBlack: new THREE.MeshLambertMaterial({ color: 0x222222 }),
  carPaintSilver: new THREE.MeshLambertMaterial({ color: 0xaaaaaa }),
  carWindow: new THREE.MeshLambertMaterial({ color: 0x335566, transparent: true, opacity: 0.5 }),
  tire: new THREE.MeshLambertMaterial({ color: 0x222222 }),
  headlight: new THREE.MeshBasicMaterial({ color: 0xffffcc }),

  // Zombie
  zombieFlesh: new THREE.MeshLambertMaterial({ color: 0x5a7a4a }),
  zombieDark: new THREE.MeshLambertMaterial({ color: 0x3a4a2a }),
  zombieClothes: new THREE.MeshLambertMaterial({ color: 0x4a3a2a }),

  // FX
  muzzleFlash: new THREE.MeshBasicMaterial({
    color: 0xffff44, transparent: true, opacity: 0.8,
  }),
  hitSpark: new THREE.MeshBasicMaterial({ color: 0xffaa00 }),
};
