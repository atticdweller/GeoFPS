import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { materials } from '../utils/materials.js';

/**
 * Create terrain mesh from real elevation data.
 * @param {CANNON.World} world
 * @param {{ grid, width, height, minElev, maxElev }} elevData
 * @param {{ width, height }} sizeMeters — dimensions in meters
 */
export function createTerrain(world, elevData, sizeMeters) {
  const { grid, width: cols, height: rows, minElev } = elevData;
  const terrainWidth = sizeMeters.width;
  const terrainDepth = sizeMeters.height;

  // Create plane geometry
  const geometry = new THREE.PlaneGeometry(
    terrainWidth, terrainDepth,
    cols - 1, rows - 1,
  );
  geometry.rotateX(-Math.PI / 2);

  // Set vertex heights from elevation grid (normalized: subtract minElev)
  const positions = geometry.attributes.position;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // PlaneGeometry vertices go left-to-right, top-to-bottom after rotation
      const vertIdx = r * cols + c;
      const elev = (grid[rows - 1 - r]?.[c] ?? 0) - minElev;
      positions.setY(vertIdx, elev);
    }
  }
  geometry.computeVertexNormals();

  // Vertex colors based on elevation
  const colors = new Float32Array(positions.count * 3);
  const grassColor = new THREE.Color(0x4a7c3f);
  const dirtColor = new THREE.Color(0x8b7355);
  const range = elevData.maxElev - minElev || 1;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const t = Math.min(y / range, 1);
    const color = grassColor.clone().lerp(dirtColor, t * t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, terrainMat);
  mesh.receiveShadow = true;
  mesh.userData.noShoot = true;
  scene.add(mesh);

  // Physics ground — use a simple infinite plane at Y=0
  // (Heightfield is unreliable; flat plane works for now since elevation
  //  data is typically CORS-blocked and falls back to flat anyway)
  const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: new CANNON.Material({ friction: 0.5, restitution: 0.1 }),
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  return mesh;
}

/**
 * Flatten terrain vertices that fall within road corridors.
 * Call after createTerrain() but before rendering.
 */
export function flattenTerrainUnderRoads(terrainMesh, projectedRoads, sizeMeters) {
  if (!projectedRoads || projectedRoads.length === 0) return;

  const positions = terrainMesh.geometry.attributes.position;
  const colors = terrainMesh.geometry.attributes.color;
  const asphaltColor = new THREE.Color(0x444444);

  for (let i = 0; i < positions.count; i++) {
    const vx = positions.getX(i);
    const vz = positions.getZ(i);

    let minDist = Infinity;
    let roadY = 0;
    let corridor = 0;

    // Check distance to each road segment centerline
    for (const road of projectedRoads) {
      const totalCorridor = road.roadWidth / 2 + (road.sidewalkWidth > 0 ? 0.15 + road.sidewalkWidth : 0);

      for (let j = 0; j < road.points.length - 1; j++) {
        const a = road.points[j];
        const b = road.points[j + 1];
        const dist = pointToSegmentDist(vx, vz, a.x, a.z, b.x, b.z);
        if (dist < minDist) {
          minDist = dist;
          corridor = totalCorridor;
          roadY = 0; // roads sit at Y=0
        }
      }
    }

    if (minDist < corridor) {
      // Flatten vertex to road level
      positions.setY(i, roadY);
      // Darken vertex color to hint at road area
      colors.setXYZ(i, asphaltColor.r, asphaltColor.g, asphaltColor.b);
    }
  }

  positions.needsUpdate = true;
  colors.needsUpdate = true;
  terrainMesh.geometry.computeVertexNormals();
}

function pointToSegmentDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.001) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/**
 * Get terrain elevation at a world position by sampling the elevation grid.
 */
export function getTerrainElevation(elevData, sizeMeters, x, z) {
  if (!elevData || !elevData.grid) return 0;

  const { grid, width: cols, height: rows, minElev } = elevData;

  // Convert world coords to grid coords
  const gridX = ((x + sizeMeters.width / 2) / sizeMeters.width) * (cols - 1);
  const gridZ = ((-z + sizeMeters.height / 2) / sizeMeters.height) * (rows - 1);

  const c = Math.max(0, Math.min(cols - 1, Math.round(gridX)));
  const r = Math.max(0, Math.min(rows - 1, Math.round(gridZ)));

  return (grid[r]?.[c] ?? 0) - minElev;
}
