import * as THREE from 'three';

const _v3 = new THREE.Vector3();

/** Clamp a number between min and max */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/** Random float in [min, max) */
export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

/** Random integer in [min, max] inclusive */
export function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

/** Distance between two Vector3-like objects on the XZ plane */
export function distXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Compute area of a 2D polygon given as [{x, y}, ...] */
export function polygonArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(area / 2);
}
