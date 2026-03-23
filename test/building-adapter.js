/**
 * Building adapter — creates a single building mesh from polygon + tags,
 * decoupled from the game's scene/project/terrain dependencies.
 * Duplicates core geometry logic from src/world/buildings.js.
 */
import * as THREE from 'three';
import { materials } from '../src/utils/materials.js';
import { generateInterior } from '../src/world/interiors.js';

const DOOR_WIDTH = 0.9;
const DOOR_HEIGHT = 2.1;

// ── Seeded PRNG for reproducible BSP layouts ──

let _seed = 42;
function seededRandom() {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed - 1) / 2147483646;
}

/**
 * Create a single building mesh from polygon points and OSM tags.
 * @param {Array<{x,z}>} polygon — vertices in local meter coords
 * @param {Object} tags — OSM-style tags
 * @param {Object} options — { baseY, seed }
 * @returns {{ group, center, bbox, height, numFloors, area, buildingType }}
 */
export function createSingleBuildingMesh(polygon, tags, options = {}) {
  const { baseY = 0, seed = 42 } = options;

  // Seed the RNG for reproducible interiors
  _seed = seed;
  const origRandom = Math.random;
  Math.random = seededRandom;

  try {
    return _createBuilding(polygon, tags, baseY);
  } finally {
    Math.random = origRandom;
  }
}

function _createBuilding(polygon, tags, baseY) {
  const points2D = polygon.map(p => new THREE.Vector2(p.x, p.z));

  const area = computeArea2D(points2D);
  const center = getCenter(points2D);
  const bbox2D = getBBox2D(points2D);

  // Height — single-story shops/restaurants get one tall floor; offices and apartments get multiple
  const isSingleStoryCommercial = tags.shop || tags.amenity ||
    ['retail', 'commercial'].includes(tags.building);
  const isOffice = tags.office || tags.building === 'office';

  let height = 6.4;
  if (tags.height) {
    height = parseFloat(tags.height) || height;
  } else if (tags['building:levels']) {
    height = (parseInt(tags['building:levels']) || 2) * 3.2;
  } else if (isSingleStoryCommercial) {
    height = 4.5; // single tall floor
  } else if (isOffice) {
    height = 9.6; // 3 floors
  } else if (tags.building === 'apartments') {
    height = 12.8; // 4 floors
  }

  const numFloors = isSingleStoryCommercial && !tags['building:levels'] && !tags.height
    ? 1
    : Math.max(1, Math.round(height / 3.2));
  const floorHeight = height / numFloors;

  const isCommercial = ['commercial', 'retail', 'office', 'industrial'].includes(tags.building) ||
    tags.shop || tags.amenity || tags.office;
  const wallMatName = isCommercial ? 'wallCommercial' : 'wallExterior';

  // Buckets for geometry collection
  const buckets = {
    wallExterior: [], wallCommercial: [], wallInterior: [],
    floor: [], ceiling: [], glass: [], wood: [], fabric: [],
    counter: [], porcelain: [], bedRed: [], bedBlue: [], metal: [],
    door: [], windowFrame: [],
    shelf: [], commercialFloor: [],
  };

  // Find front edge (longest, since no road data)
  const frontEdge = findLongestEdge(points2D);
  const doorInfo = computeDoorPosition(points2D, frontEdge);

  // Determine building type for reporting
  const buildingType = classifyType(tags);

  // Build exterior walls per edge per floor
  for (let i = 0; i < points2D.length; i++) {
    const j = (i + 1) % points2D.length;
    const p0 = points2D[i];
    const p1 = points2D[j];
    const edgeLen = p0.distanceTo(p1);
    if (edgeLen < 0.1) continue;

    const dx = p1.x - p0.x;
    const dz = p1.y - p0.y;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;

    const isFrontEdge = (i === frontEdge);

    for (let floor = 0; floor < numFloors; floor++) {
      const floorY = baseY + floor * floorHeight;
      const isGroundFloor = floor === 0;

      if (isFrontEdge && isGroundFloor && doorInfo) {
        generateWallWithDoor(p0, p1, floorY, floorHeight, doorInfo, nx, nz, wallMatName, buckets);
      } else {
        generateWallWithWindows(p0, p1, floorY, floorHeight, nx, nz, wallMatName, isCommercial, isGroundFloor, buckets);
      }
    }
  }

  // Roof cap
  const roofShape = new THREE.Shape();
  roofShape.moveTo(points2D[0].x, points2D[0].y);
  for (let i = 1; i < points2D.length; i++) {
    roofShape.lineTo(points2D[i].x, points2D[i].y);
  }
  roofShape.closePath();
  const roofGeo = new THREE.ShapeGeometry(roofShape);
  roofGeo.rotateX(-Math.PI / 2);
  roofGeo.translate(0, baseY + height, 0);
  roofGeo.computeVertexNormals();
  buckets[wallMatName].push(roofGeo);

  // Floor cap
  const floorGeo = new THREE.ShapeGeometry(roofShape);
  floorGeo.rotateX(Math.PI / 2);
  floorGeo.translate(0, baseY + 0.01, 0);
  floorGeo.computeVertexNormals();
  buckets.floor.push(floorGeo);

  // Interior generation: rotate coordinate system to match building orientation
  const longestIdx = findLongestEdge(points2D);
  const le0 = points2D[longestIdx];
  const le1 = points2D[(longestIdx + 1) % points2D.length];
  const buildingAngle = Math.atan2(le1.y - le0.y, le1.x - le0.x);

  const cx = center.x, cy = center.y;
  const cosA = Math.cos(-buildingAngle), sinA = Math.sin(-buildingAngle);
  const rotatedPts = points2D.map(p => new THREE.Vector2(
    cx + (p.x - cx) * cosA - (p.y - cy) * sinA,
    cy + (p.x - cx) * sinA + (p.y - cy) * cosA
  ));
  const rotBbox = getInscribedBBox(rotatedPts);

  for (let floor = 0; floor < numFloors; floor++) {
    const floorY = baseY + floor * floorHeight;

    const beforeCounts = {};
    for (const [k, v] of Object.entries(buckets)) beforeCounts[k] = v.length;

    generateInterior(rotBbox, area, floorHeight, floorY, floor, tags, buckets, doorInfo);

    if (Math.abs(buildingAngle) > 0.01) {
      for (const [k, v] of Object.entries(buckets)) {
        for (let i = beforeCounts[k] || 0; i < v.length; i++) {
          rotateGeometryAroundPoint(v[i], cx, cy, buildingAngle);
        }
      }
    }
  }

  // Merge buckets into group
  const group = new THREE.Group();
  for (const [matName, geometries] of Object.entries(buckets)) {
    if (geometries.length === 0) continue;
    const merged = mergeGeometries(geometries);
    if (!merged) continue;
    const mat = materials[matName];
    if (!mat) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = matName.startsWith('wall') || matName === 'door';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return {
    group,
    center: { x: center.x, z: center.y },
    bbox: bbox2D,
    height,
    numFloors,
    area,
    buildingType,
  };
}

// ── Wall generation (duplicated from buildings.js) ──

function generateWallWithDoor(p0, p1, floorY, floorHeight, doorInfo, nx, nz, matName, buckets) {
  const wallHeight = floorHeight;
  const edgeLen = p0.distanceTo(p1);
  const doorT = doorInfo.t;
  const doorHalfW = DOOR_WIDTH / 2;
  const doorStartT = Math.max(0, doorT - doorHalfW / edgeLen);
  const doorEndT = Math.min(1, doorT + doorHalfW / edgeLen);

  if (doorStartT > 0.01) {
    const wP1 = new THREE.Vector2(
      p0.x + (p1.x - p0.x) * doorStartT,
      p0.y + (p1.y - p0.y) * doorStartT
    );
    addWallQuad(p0, wP1, floorY, wallHeight, nx, nz, matName, buckets);
  }

  if (doorEndT < 0.99) {
    const wP0 = new THREE.Vector2(
      p0.x + (p1.x - p0.x) * doorEndT,
      p0.y + (p1.y - p0.y) * doorEndT
    );
    addWallQuad(wP0, p1, floorY, wallHeight, nx, nz, matName, buckets);
  }

  const aboveH = wallHeight - DOOR_HEIGHT;
  if (aboveH > 0.05) {
    const dP0 = new THREE.Vector2(
      p0.x + (p1.x - p0.x) * doorStartT,
      p0.y + (p1.y - p0.y) * doorStartT
    );
    const dP1 = new THREE.Vector2(
      p0.x + (p1.x - p0.x) * doorEndT,
      p0.y + (p1.y - p0.y) * doorEndT
    );
    addWallQuad(dP0, dP1, floorY + DOOR_HEIGHT, aboveH, nx, nz, matName, buckets);
  }

  // Door panel
  const doorCx = p0.x + (p1.x - p0.x) * doorT;
  const doorCz = p0.y + (p1.y - p0.y) * doorT;
  const inset = 0.05;
  const doorGeo = new THREE.PlaneGeometry(DOOR_WIDTH, DOOR_HEIGHT);
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  doorGeo.rotateY(-angle + Math.PI / 2);
  doorGeo.translate(doorCx - nx * inset, floorY + DOOR_HEIGHT / 2, doorCz - nz * inset);
  doorGeo.computeVertexNormals();
  buckets.door.push(doorGeo);

  // Door step
  const stepGeo = new THREE.BoxGeometry(DOOR_WIDTH + 0.2, 0.1, 0.5);
  stepGeo.translate(doorCx + nx * 0.25, floorY + 0.05, doorCz + nz * 0.25);
  stepGeo.computeVertexNormals();
  buckets.wallInterior.push(stepGeo);
}

function generateWallWithWindows(p0, p1, floorY, floorHeight, nx, nz, matName, isCommercial, isGroundFloor, buckets) {
  const wallHeight = floorHeight;
  const edgeLen = p0.distanceTo(p1);

  let winW, winH, winSill, spacing;
  if (isCommercial && isGroundFloor) {
    winW = 1.4; winH = 1.6; winSill = 0.6; spacing = 2.5;
  } else {
    winW = 0.9; winH = 1.1; winSill = 0.9; spacing = 3.0;
  }

  const margin = 0.5;
  const usableLen = edgeLen - 2 * margin;

  if (usableLen < winW + 0.5) {
    addWallQuad(p0, p1, floorY, wallHeight, nx, nz, matName, buckets);
    return;
  }

  const numWin = Math.max(1, Math.floor(usableLen / spacing));
  const actualSpacing = usableLen / numWin;

  const windows = [];
  for (let w = 0; w < numWin; w++) {
    const centerT = (margin + actualSpacing * (w + 0.5)) / edgeLen;
    const halfWT = (winW / 2) / edgeLen;
    windows.push({ startT: centerT - halfWT, endT: centerT + halfWT, centerT });
  }

  let prevT = 0;
  for (const win of windows) {
    if (win.startT - prevT > 0.001) {
      addWallQuad(lerpVec2(p0, p1, prevT), lerpVec2(p0, p1, win.startT), floorY, wallHeight, nx, nz, matName, buckets);
    }
    if (winSill > 0.05) {
      addWallQuad(lerpVec2(p0, p1, win.startT), lerpVec2(p0, p1, win.endT), floorY, winSill, nx, nz, matName, buckets);
    }
    const aboveY = floorY + winSill + winH;
    const aboveH = wallHeight - winSill - winH;
    if (aboveH > 0.05) {
      addWallQuad(lerpVec2(p0, p1, win.startT), lerpVec2(p0, p1, win.endT), aboveY, aboveH, nx, nz, matName, buckets);
    }

    const wx = p0.x + (p1.x - p0.x) * win.centerT;
    const wz = p0.y + (p1.y - p0.y) * win.centerT;
    const wy = floorY + winSill + winH / 2;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const glassGeo = new THREE.PlaneGeometry(winW, winH);
    glassGeo.rotateY(-angle + Math.PI / 2);
    glassGeo.translate(wx, wy, wz);
    glassGeo.computeVertexNormals();
    buckets.glass.push(glassGeo);

    prevT = win.endT;
  }

  if (1 - prevT > 0.001) {
    addWallQuad(lerpVec2(p0, p1, prevT), p1, floorY, wallHeight, nx, nz, matName, buckets);
  }
}

function lerpVec2(a, b, t) {
  return new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

function addWallQuad(p0, p1, y, height, nx, nz, matName, buckets) {
  const positions = new Float32Array([
    p0.x, y, p0.y,
    p1.x, y, p1.y,
    p1.x, y + height, p1.y,
    p0.x, y + height, p0.y,
  ]);
  const normals = new Float32Array([
    nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  buckets[matName].push(geo);
}

// ── Geometry utilities ──

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

function getInscribedBBox(points) {
  const full = getBBox2D(points);

  // If polygon nearly fills its bbox (axis-aligned rectangle), no shrinking needed
  const bboxArea = (full.maxX - full.minX) * (full.maxY - full.minY);
  const polyArea = computeArea2D(points);
  if (bboxArea < 1 || polyArea > bboxArea * 0.9) return full;

  let { minX, maxX, minY, maxY } = { ...full };
  const eps = 0.1;
  const step = 0.25;
  for (let iter = 0; iter < 80; iter++) {
    const corners = [
      { x: minX + eps, y: minY + eps }, { x: maxX - eps, y: minY + eps },
      { x: maxX - eps, y: maxY - eps }, { x: minX + eps, y: maxY - eps },
    ];
    let allInside = true;
    for (const c of corners) {
      if (!pointInPolygon2D(c.x, c.y, points)) {
        allInside = false;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        if (Math.abs(c.x - cx) > Math.abs(c.y - cy)) {
          if (c.x > cx) maxX -= step; else minX += step;
        } else {
          if (c.y > cy) maxY -= step; else minY += step;
        }
      }
    }
    if (allInside) break;
  }

  if (maxX <= minX + 1 || maxY <= minY + 1) return full;

  return { minX, maxX, minY, maxY };
}

function pointInPolygon2D(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function rotateGeometryAroundPoint(geometry, cx, cz, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) - cx;
    const z = positions.getZ(i) - cz;
    positions.setX(i, cx + x * cos - z * sin);
    positions.setZ(i, cz + x * sin + z * cos);
    if (normals) {
      const nx = normals.getX(i);
      const nz = normals.getZ(i);
      normals.setX(i, nx * cos - nz * sin);
      normals.setZ(i, nx * sin + nz * cos);
    }
  }
  positions.needsUpdate = true;
  if (normals) normals.needsUpdate = true;
}

function findLongestEdge(points2D) {
  let maxLen = 0, bestEdge = 0;
  for (let i = 0; i < points2D.length; i++) {
    const j = (i + 1) % points2D.length;
    const len = points2D[i].distanceTo(points2D[j]);
    if (len > maxLen) { maxLen = len; bestEdge = i; }
  }
  return bestEdge;
}

function computeDoorPosition(points2D, edgeIndex) {
  const p0 = points2D[edgeIndex];
  const p1 = points2D[(edgeIndex + 1) % points2D.length];
  const edgeLen = p0.distanceTo(p1);
  if (edgeLen < DOOR_WIDTH + 0.2) return null;
  return {
    edgeIndex,
    t: 0.5,
    x: (p0.x + p1.x) / 2,
    z: (p0.y + p1.y) / 2,
  };
}

function classifyType(tags) {
  if (tags.shop === 'supermarket' || tags.shop === 'grocery' || tags.shop === 'convenience') return 'grocery';
  if (['restaurant', 'cafe', 'bar', 'fast_food', 'pub'].includes(tags.amenity)) return 'restaurant';
  if (tags.shop) return 'retail';
  if (tags.office) return 'office';
  if (['commercial', 'retail'].includes(tags.building)) return 'retail';
  return 'residential';
}

function mergeGeometries(geometries) {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0];

  let totalVerts = 0, totalIndices = 0;
  for (const g of geometries) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);
  let vertOffset = 0, idxOffset = 0;

  for (const g of geometries) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const idx = g.index;

    for (let i = 0; i < pos.count; i++) {
      positions[(vertOffset + i) * 3] = pos.getX(i);
      positions[(vertOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertOffset + i) * 3 + 2] = pos.getZ(i);
    }
    if (norm) {
      for (let i = 0; i < norm.count; i++) {
        normals[(vertOffset + i) * 3] = norm.getX(i);
        normals[(vertOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vertOffset + i) * 3 + 2] = norm.getZ(i);
      }
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices[idxOffset + i] = idx.getX(i) + vertOffset;
      idxOffset += idx.count;
    } else {
      for (let i = 0; i < pos.count; i++) indices[idxOffset + i] = vertOffset + i;
      idxOffset += pos.count;
    }
    vertOffset += pos.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}
