import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { project } from '../geo/projection.js';
import { materials } from '../utils/materials.js';
import { getTerrainElevation } from './terrain.js';
import { generateInterior } from './interiors.js';

const DOOR_WIDTH = 0.9;
const DOOR_HEIGHT = 2.1;
const WALL_THICKNESS = 0.3; // physics wall thickness

/**
 * Generate 3D buildings from OSM building data.
 * Merges all geometry by material to minimize draw calls.
 */
export function generateBuildings(world, buildingData, roadSegments, elevData, sizeMeters) {
  // Collect geometries by material for batch merging
  const buckets = {
    wallExterior: [], wallCommercial: [], wallInterior: [],
    floor: [], ceiling: [], glass: [], wood: [], fabric: [],
    counter: [], porcelain: [], bedRed: [], bedBlue: [], metal: [],
    door: [], windowFrame: [],
    shelf: [], commercialFloor: [],
  };

  let count = 0;

  for (const bld of buildingData) {
    try {
      if (createBuilding(world, bld, roadSegments, elevData, sizeMeters, buckets)) {
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
    if (!mat) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = matName.startsWith('wall') || matName === 'door';
    mesh.receiveShadow = true;
    buildingGroup.add(mesh);
  }

  scene.add(buildingGroup);
  console.log(`Generated ${count} buildings`);
  return buildingGroup;
}

function mergeGeometries(geometries) {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0];

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
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function createBuilding(world, bld, roadSegments, elevData, sizeMeters, buckets) {
  const { polygon, tags } = bld;

  const points2D = polygon.map(p => {
    const { x, z } = project(p.lat, p.lng);
    return new THREE.Vector2(x, z);
  });

  const area = computeArea2D(points2D);
  if (area < 10) return false;

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

  const center = getCenter(points2D);
  const baseY = getTerrainElevation(elevData, sizeMeters, center.x, center.y);

  const isCommercial = ['commercial', 'retail', 'office', 'industrial'].includes(tags.building) ||
    tags.shop || tags.amenity || tags.office;
  const wallMatName = isCommercial ? 'wallCommercial' : 'wallExterior';

  // Find the front wall (closest edge to a road) for door placement
  const frontEdge = findFrontEdge(points2D, roadSegments);
  const doorInfo = computeDoorPosition(points2D, frontEdge, baseY);

  // Build exterior walls as individual quads per edge (instead of ExtrudeGeometry)
  // This allows us to place doors and windows properly
  for (let i = 0; i < points2D.length; i++) {
    const j = (i + 1) % points2D.length;
    const p0 = points2D[i];
    const p1 = points2D[j];
    const edgeLen = p0.distanceTo(p1);
    if (edgeLen < 0.1) continue;

    const isFrontEdge = (i === frontEdge);

    // Direction and normal for this edge
    const dx = p1.x - p0.x;
    const dz = p1.y - p0.y;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len; // outward normal
    const nz = dx / len;

    for (let floor = 0; floor < numFloors; floor++) {
      const floorY = baseY + floor * floorHeight;
      const isGroundFloor = floor === 0;

      if (isFrontEdge && isGroundFloor && doorInfo) {
        // Ground floor front wall: split around door
        generateWallWithDoor(p0, p1, floorY, floorHeight, doorInfo, nx, nz, wallMatName, buckets);
      } else {
        // Regular wall with windows
        generateWallWithWindows(p0, p1, floorY, floorHeight, nx, nz, wallMatName, isCommercial, isGroundFloor, buckets);
      }
    }

  }

  // Roof (flat top cap) — ensure correct winding for ShapeGeometry
  const roofShape = new THREE.Shape();
  // Three.js Shape expects counter-clockwise winding; check and reverse if needed
  const signedArea = computeSignedArea2D(points2D);
  const orderedPts = signedArea < 0 ? [...points2D].reverse() : points2D;
  roofShape.moveTo(orderedPts[0].x, orderedPts[0].y);
  for (let i = 1; i < orderedPts.length; i++) {
    roofShape.lineTo(orderedPts[i].x, orderedPts[i].y);
  }
  roofShape.closePath();
  const roofGeo = new THREE.ShapeGeometry(roofShape);
  roofGeo.rotateX(-Math.PI / 2);
  roofGeo.translate(0, baseY + height, 0);
  roofGeo.computeVertexNormals();
  buckets[wallMatName].push(roofGeo);


  // Per-wall physics bodies (with door gap on front wall)
  for (let i = 0; i < points2D.length; i++) {
    const j = (i + 1) % points2D.length;
    const p0 = points2D[i];
    const p1 = points2D[j];
    const edgeLen = p0.distanceTo(p1);
    if (edgeLen < 0.1) continue;

    const isFrontEdge = (i === frontEdge);

    if (isFrontEdge && doorInfo) {
      // Split physics into two segments with a gap for the door
      addWallPhysicsWithDoorGap(world, p0, p1, baseY, height, doorInfo);
    } else {
      addWallPhysics(world, p0, p1, baseY, height);
    }
  }

  // Interior generation: rotate coordinate system to match building orientation
  // so rooms fill the building properly even for rotated polygons
  const longestIdx = findLongestEdge(points2D);
  const le0 = points2D[longestIdx];
  const le1 = points2D[(longestIdx + 1) % points2D.length];
  const buildingAngle = Math.atan2(le1.y - le0.y, le1.x - le0.x);

  // Rotate polygon to axis-aligned around its center
  const cx = center.x, cy = center.y;
  const cosA = Math.cos(-buildingAngle), sinA = Math.sin(-buildingAngle);
  const rotatedPts = points2D.map(p => new THREE.Vector2(
    cx + (p.x - cx) * cosA - (p.y - cy) * sinA,
    cy + (p.x - cx) * sinA + (p.y - cy) * cosA
  ));
  const rotBbox = getInscribedBBox(rotatedPts);

  for (let floor = 0; floor < numFloors; floor++) {
    const floorY = baseY + floor * floorHeight;

    // Track which geometries are added during this call
    const beforeCounts = {};
    for (const [k, v] of Object.entries(buckets)) beforeCounts[k] = v.length;

    generateInterior(rotBbox, area, floorHeight, floorY, floor, tags, buckets, doorInfo);

    // Rotate all newly generated interior geometry back to world orientation
    if (Math.abs(buildingAngle) > 0.01) {
      for (const [k, v] of Object.entries(buckets)) {
        for (let i = beforeCounts[k] || 0; i < v.length; i++) {
          rotateGeometryAroundPoint(v[i], cx, cy, buildingAngle);
        }
      }
    }
  }

  return true;
}

function generateWallWithDoor(p0, p1, floorY, floorHeight, doorInfo, nx, nz, matName, buckets) {
  const wallHeight = floorHeight;
  const edgeLen = p0.distanceTo(p1);

  // Door position along the edge (parametric t)
  const doorT = doorInfo.t;
  const doorHalfW = DOOR_WIDTH / 2;
  const doorStartT = Math.max(0, doorT - doorHalfW / edgeLen);
  const doorEndT = Math.min(1, doorT + doorHalfW / edgeLen);

  // Left wall section (before door)
  if (doorStartT > 0.01) {
    const wP0 = p0;
    const wP1 = new THREE.Vector2(
      p0.x + (p1.x - p0.x) * doorStartT,
      p0.y + (p1.y - p0.y) * doorStartT
    );
    addWallQuad(wP0, wP1, floorY, wallHeight, nx, nz, matName, buckets);
  }

  // Right wall section (after door)
  if (doorEndT < 0.99) {
    const wP0 = new THREE.Vector2(
      p0.x + (p1.x - p0.x) * doorEndT,
      p0.y + (p1.y - p0.y) * doorEndT
    );
    const wP1 = p1;
    addWallQuad(wP0, wP1, floorY, wallHeight, nx, nz, matName, buckets);
  }

  // Wall above door
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

  // Door panel (slightly inset)
  const doorCx = p0.x + (p1.x - p0.x) * doorT;
  const doorCz = p0.y + (p1.y - p0.y) * doorT;
  const inset = 0.05;

  const doorGeo = new THREE.PlaneGeometry(DOOR_WIDTH, DOOR_HEIGHT);
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  doorGeo.rotateY(-angle + Math.PI / 2);
  doorGeo.translate(
    doorCx - nx * inset,
    floorY + DOOR_HEIGHT / 2,
    doorCz - nz * inset
  );
  doorGeo.computeVertexNormals();
  buckets.door.push(doorGeo);

  // Door step
  const stepGeo = new THREE.BoxGeometry(DOOR_WIDTH + 0.2, 0.1, 0.5);
  stepGeo.translate(
    doorCx + nx * 0.25,
    floorY + 0.05,
    doorCz + nz * 0.25
  );
  stepGeo.computeVertexNormals();
  buckets.wallInterior.push(stepGeo);
}

function generateWallWithWindows(p0, p1, floorY, floorHeight, nx, nz, matName, isCommercial, isGroundFloor, buckets) {
  const wallHeight = floorHeight;
  const edgeLen = p0.distanceTo(p1);

  // Window parameters based on building type
  let winW, winH, winSill, spacing;
  if (isCommercial && isGroundFloor) {
    winW = 1.4; winH = 1.6; winSill = 0.6; spacing = 2.5;
  } else {
    winW = 0.9; winH = 1.1; winSill = 0.9; spacing = 3.0;
  }

  const margin = 0.5;
  const usableLen = edgeLen - 2 * margin;

  // If wall too short for windows, just a solid wall
  if (usableLen < winW + 0.5) {
    addWallQuad(p0, p1, floorY, wallHeight, nx, nz, matName, buckets);
    return;
  }

  const numWin = Math.max(1, Math.floor(usableLen / spacing));
  const actualSpacing = usableLen / numWin;

  // Compute window positions as parametric t values along the edge
  const windows = [];
  for (let w = 0; w < numWin; w++) {
    const centerT = (margin + actualSpacing * (w + 0.5)) / edgeLen;
    const halfWT = (winW / 2) / edgeLen;
    windows.push({ startT: centerT - halfWT, endT: centerT + halfWT, centerT });
  }

  // Split wall into sections around window openings
  let prevT = 0;
  for (const win of windows) {
    // Wall section before this window (full height)
    if (win.startT - prevT > 0.001) {
      const wP0 = lerpVec2(p0, p1, prevT);
      const wP1 = lerpVec2(p0, p1, win.startT);
      addWallQuad(wP0, wP1, floorY, wallHeight, nx, nz, matName, buckets);
    }

    // Wall below window (sill)
    if (winSill > 0.05) {
      const wP0 = lerpVec2(p0, p1, win.startT);
      const wP1 = lerpVec2(p0, p1, win.endT);
      addWallQuad(wP0, wP1, floorY, winSill, nx, nz, matName, buckets);
    }

    // Wall above window
    const aboveY = floorY + winSill + winH;
    const aboveH = wallHeight - winSill - winH;
    if (aboveH > 0.05) {
      const wP0 = lerpVec2(p0, p1, win.startT);
      const wP1 = lerpVec2(p0, p1, win.endT);
      addWallQuad(wP0, wP1, aboveY, aboveH, nx, nz, matName, buckets);
    }

    // Glass pane in the opening
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

  // Wall section after last window
  if (1 - prevT > 0.001) {
    const wP0 = lerpVec2(p0, p1, prevT);
    addWallQuad(wP0, p1, floorY, wallHeight, nx, nz, matName, buckets);
  }
}

function lerpVec2(a, b, t) {
  return new THREE.Vector2(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t
  );
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

function addWallPhysics(world, p0, p1, baseY, height) {
  const edgeLen = p0.distanceTo(p1);
  if (edgeLen < 0.1) return;

  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.y + p1.y) / 2;
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);

  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(edgeLen / 2, height / 2, WALL_THICKNESS / 2)),
  });
  body.position.set(cx, baseY + height / 2, cz);
  body.quaternion.setFromEuler(0, -angle, 0);
  world.addBody(body);
}

function addWallPhysicsWithDoorGap(world, p0, p1, baseY, height, doorInfo) {
  const edgeLen = p0.distanceTo(p1);
  const doorHalfW = DOOR_WIDTH / 2;
  const doorStartT = Math.max(0, doorInfo.t - doorHalfW / edgeLen);
  const doorEndT = Math.min(1, doorInfo.t + doorHalfW / edgeLen);
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);

  // Left segment
  if (doorStartT > 0.02) {
    const segLen = edgeLen * doorStartT;
    const sx = p0.x + (p1.x - p0.x) * doorStartT / 2;
    const sz = p0.y + (p1.y - p0.y) * doorStartT / 2;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(segLen / 2, height / 2, WALL_THICKNESS / 2)),
    });
    body.position.set(sx, baseY + height / 2, sz);
    body.quaternion.setFromEuler(0, -angle, 0);
    world.addBody(body);
  }

  // Right segment
  if (doorEndT < 0.98) {
    const segLen = edgeLen * (1 - doorEndT);
    const midT = (doorEndT + 1) / 2;
    const sx = p0.x + (p1.x - p0.x) * midT;
    const sz = p0.y + (p1.y - p0.y) * midT;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(segLen / 2, height / 2, WALL_THICKNESS / 2)),
    });
    body.position.set(sx, baseY + height / 2, sz);
    body.quaternion.setFromEuler(0, -angle, 0);
    world.addBody(body);
  }

  // Wall above door
  const aboveH = height - DOOR_HEIGHT;
  if (aboveH > 0.1) {
    const doorSegLen = edgeLen * (doorEndT - doorStartT);
    const midT = (doorStartT + doorEndT) / 2;
    const sx = p0.x + (p1.x - p0.x) * midT;
    const sz = p0.y + (p1.y - p0.y) * midT;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(doorSegLen / 2, aboveH / 2, WALL_THICKNESS / 2)),
    });
    body.position.set(sx, baseY + DOOR_HEIGHT + aboveH / 2, sz);
    body.quaternion.setFromEuler(0, -angle, 0);
    world.addBody(body);
  }
}

function findFrontEdge(points2D, roadSegments) {
  if (!roadSegments || roadSegments.length === 0) {
    // No roads — use longest edge
    let maxLen = 0;
    let bestEdge = 0;
    for (let i = 0; i < points2D.length; i++) {
      const j = (i + 1) % points2D.length;
      const len = points2D[i].distanceTo(points2D[j]);
      if (len > maxLen) { maxLen = len; bestEdge = i; }
    }
    return bestEdge;
  }

  let minDist = Infinity;
  let bestEdge = 0;

  for (let i = 0; i < points2D.length; i++) {
    const j = (i + 1) % points2D.length;
    const midX = (points2D[i].x + points2D[j].x) / 2;
    const midZ = (points2D[i].y + points2D[j].y) / 2;

    for (const seg of roadSegments) {
      for (let k = 0; k < seg.points.length - 1; k++) {
        const a = seg.points[k];
        const b = seg.points[k + 1];
        const dist = pointToSegDist2D(midX, midZ, a.x, a.z, b.x, b.z);
        if (dist < minDist) {
          minDist = dist;
          bestEdge = i;
        }
      }
    }
  }

  return bestEdge;
}

function computeDoorPosition(points2D, edgeIndex, baseY) {
  if (edgeIndex < 0 || edgeIndex >= points2D.length) return null;

  const p0 = points2D[edgeIndex];
  const p1 = points2D[(edgeIndex + 1) % points2D.length];
  const edgeLen = p0.distanceTo(p1);

  if (edgeLen < DOOR_WIDTH + 0.2) return null;

  const t = 0.5; // center of edge
  return {
    edgeIndex,
    t,
    x: p0.x + (p1.x - p0.x) * t,
    z: p0.y + (p1.y - p0.y) * t,
    baseY,
  };
}

function findLongestEdge(points2D) {
  let maxLen = 0, best = 0;
  for (let i = 0; i < points2D.length; i++) {
    const j = (i + 1) % points2D.length;
    const len = points2D[i].distanceTo(points2D[j]);
    if (len > maxLen) { maxLen = len; best = i; }
  }
  return best;
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

function pointToSegDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.001) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function computeSignedArea2D(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return area / 2;
}

function computeArea2D(points) {
  return Math.abs(computeSignedArea2D(points));
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
  const eps = 0.1; // inset test points slightly to avoid boundary ambiguity
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

  // If bbox collapsed, fall back to full
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
