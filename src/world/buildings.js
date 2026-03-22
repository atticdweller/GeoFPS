import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { project } from '../geo/projection.js';
import { materials } from '../utils/materials.js';
import { getTerrainElevation } from './terrain.js';
import { generateInterior } from './interiors.js';

/**
 * Generate 3D buildings from OSM building data.
 * Merges all geometry by material to minimize draw calls.
 */
export function generateBuildings(world, buildingData, elevData, sizeMeters) {
  // Collect geometries by material for batch merging
  const buckets = {
    wallExterior: [],
    wallCommercial: [],
    wallInterior: [],
    floor: [],
    ceiling: [],
    glass: [],
    wood: [],
    fabric: [],
    counter: [],
    porcelain: [],
    bedRed: [],
    bedBlue: [],
    metal: [],
  };

  let count = 0;

  for (const bld of buildingData) {
    try {
      if (createBuilding(world, bld, elevData, sizeMeters, buckets)) {
        count++;
      }
    } catch (e) {
      // Skip invalid buildings
    }
  }

  // Merge each bucket into a single mesh
  const buildingGroup = new THREE.Group();
  buildingGroup.name = 'buildings';

  for (const [matName, geometries] of Object.entries(buckets)) {
    if (geometries.length === 0) continue;
    const merged = mergeGeometries(geometries);
    if (!merged) continue;
    const mat = materials[matName];
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = matName.startsWith('wall');
    mesh.receiveShadow = true;
    buildingGroup.add(mesh);
  }

  scene.add(buildingGroup);
  console.log(`Generated ${count} buildings (${Object.values(buckets).reduce((s, b) => s + b.length, 0)} geometries merged into ${buildingGroup.children.length} meshes)`);
  return buildingGroup;
}

function mergeGeometries(geometries) {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0];

  // Use BufferGeometryUtils-style merge
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geometries) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vertOffset = 0;
  let idxOffset = 0;

  for (const g of geometries) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const idx = g.index;

    // Copy positions
    for (let i = 0; i < pos.count; i++) {
      positions[(vertOffset + i) * 3] = pos.getX(i);
      positions[(vertOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertOffset + i) * 3 + 2] = pos.getZ(i);
    }

    // Copy normals
    if (norm) {
      for (let i = 0; i < norm.count; i++) {
        normals[(vertOffset + i) * 3] = norm.getX(i);
        normals[(vertOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vertOffset + i) * 3 + 2] = norm.getZ(i);
      }
    }

    // Copy indices
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[idxOffset + i] = idx.getX(i) + vertOffset;
      }
      idxOffset += idx.count;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[idxOffset + i] = vertOffset + i;
      }
      idxOffset += pos.count;
    }

    vertOffset += pos.count;
    g.dispose(); // free original
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function createBuilding(world, bld, elevData, sizeMeters, buckets) {
  const { polygon, tags } = bld;

  const points2D = polygon.map(p => {
    const { x, z } = project(p.lat, p.lng);
    return new THREE.Vector2(x, z);
  });

  const area = computeArea2D(points2D);
  if (area < 10) return false;

  // Height
  let height = 6.4;
  if (tags.height) {
    height = parseFloat(tags.height) || height;
  } else if (tags['building:levels']) {
    height = (parseInt(tags['building:levels']) || 2) * 3.2;
  } else if (['commercial', 'retail', 'office'].includes(tags.building)) {
    height = 9.6;
  } else if (tags.building === 'apartments') {
    height = 12.8;
  }

  const numFloors = Math.max(1, Math.round(height / 3.2));
  const floorHeight = height / numFloors;

  const center = getCenter(points2D);
  const baseY = getTerrainElevation(elevData, sizeMeters, center.x, center.y);

  // Exterior shell
  const shape = new THREE.Shape();
  shape.moveTo(points2D[0].x, points2D[0].y);
  for (let i = 1; i < points2D.length; i++) {
    shape.lineTo(points2D[i].x, points2D[i].y);
  }
  shape.closePath();

  const isCommercial = ['commercial', 'retail', 'office', 'industrial'].includes(tags.building);
  const matName = isCommercial ? 'wallCommercial' : 'wallExterior';

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, baseY, 0);

  // Compute normals before adding to bucket
  geometry.computeVertexNormals();
  buckets[matName].push(geometry);

  // Interior for each floor
  const bbox2D = getBBox2D(points2D);
  for (let floor = 0; floor < numFloors; floor++) {
    const floorY = baseY + floor * floorHeight;
    generateInterior(bbox2D, area, floorHeight, floorY, floor, tags, buckets);
  }

  // Physics — static box
  const bboxW = bbox2D.maxX - bbox2D.minX;
  const bboxD = bbox2D.maxY - bbox2D.minY;
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(bboxW / 2, height / 2, bboxD / 2)),
  });
  body.position.set(center.x, baseY + height / 2, center.y);
  world.addBody(body);

  return true;
}

function computeArea2D(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(area / 2);
}

function getCenter(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

function getBBox2D(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}
