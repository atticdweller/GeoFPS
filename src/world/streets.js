import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { project } from '../geo/projection.js';
import { materials } from '../utils/materials.js';

// Road width defaults by highway type (meters)
const ROAD_WIDTHS = {
  motorway: 12, trunk: 10, primary: 9, secondary: 8, tertiary: 7,
  residential: 6, unclassified: 6, living_street: 5,
  service: 4, footway: 1.5, path: 1.5, cycleway: 2, pedestrian: 3,
};

// Sidewalk width by highway type (0 = no sidewalk)
const SIDEWALK_WIDTHS = {
  motorway: 0, trunk: 0, primary: 2.0, secondary: 2.0, tertiary: 1.8,
  residential: 1.5, unclassified: 1.5, living_street: 1.5,
  service: 0, footway: 0, path: 0, cycleway: 0, pedestrian: 0,
};

const CURB_WIDTH = 0.15;
const CURB_HEIGHT = 0.12;
const ROAD_Y = 0.02;       // slightly above terrain to prevent z-fighting
const SIDEWALK_Y = ROAD_Y + CURB_HEIGHT;
const MARKING_Y = ROAD_Y + 0.01;

/**
 * Generate street meshes from OSM road data.
 * @returns {{ roadGraph, projectedRoads }} — road graph for vehicles, projected roads for building door placement
 */
export function generateStreets(world, roadData, sizeMeters, buckets) {
  const projectedRoads = [];
  const nodePositions = new Map(); // OSM nodeId → {x, z}
  const nodeRefCount = new Map(); // OSM nodeId → count (for intersection detection)

  // Project all road nodes and count references for intersection detection
  for (const road of roadData) {
    const points = [];
    for (const node of road.nodes) {
      const { x, z } = project(node.lat, node.lng);
      points.push({ x, z, id: node.id });
      nodePositions.set(node.id, { x, z });
      nodeRefCount.set(node.id, (nodeRefCount.get(node.id) || 0) + 1);
    }

    const highway = road.tags.highway || 'residential';
    let roadWidth = ROAD_WIDTHS[highway] ?? 6;
    if (road.tags.width) roadWidth = parseFloat(road.tags.width) || roadWidth;
    else if (road.tags.lanes) roadWidth = (parseInt(road.tags.lanes) || 2) * 3.5;
    const sidewalkWidth = SIDEWALK_WIDTHS[highway] ?? 0;

    projectedRoads.push({ points, highway, roadWidth, sidewalkWidth, tags: road.tags });
  }

  // Detect intersection nodes (referenced by 2+ ways)
  const intersectionNodes = new Set();
  for (const [id, count] of nodeRefCount) {
    if (count >= 2) intersectionNodes.add(id);
  }

  // Generate geometry for each road
  for (const road of projectedRoads) {
    generateRoadGeometry(road, intersectionNodes, buckets);
  }

  // Build road graph for vehicles
  const roadGraph = buildRoadGraph(projectedRoads, nodePositions, intersectionNodes);

  // Merge and add to scene
  const streetGroup = new THREE.Group();
  streetGroup.name = 'streets';

  const streetBucketKeys = ['asphalt', 'sidewalk', 'curb', 'laneMarkingWhite', 'laneMarkingYellow'];
  for (const matName of streetBucketKeys) {
    if (!buckets[matName] || buckets[matName].length === 0) continue;
    const merged = mergeGeometries(buckets[matName]);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[matName]);
    mesh.receiveShadow = true;
    mesh.userData.noShoot = true;
    streetGroup.add(mesh);
  }

  scene.add(streetGroup);
  console.log(`Generated streets for ${projectedRoads.length} roads`);

  return { roadGraph, projectedRoads };
}

function generateRoadGeometry(road, intersectionNodes, buckets) {
  const { points, roadWidth, sidewalkWidth, highway } = road;
  const halfW = roadWidth / 2;

  if (points.length < 2) return;

  // Compute perpendiculars at each point (miter-joined for smooth polylines)
  const perps = computeMiterPerps(points);

  // Road surface quads
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    const n0 = perps[i], n1 = perps[i + 1];

    // Road surface
    addQuad(
      p0.x + n0.x * halfW, ROAD_Y, p0.z + n0.z * halfW,
      p0.x - n0.x * halfW, ROAD_Y, p0.z - n0.z * halfW,
      p1.x - n1.x * halfW, ROAD_Y, p1.z - n1.z * halfW,
      p1.x + n1.x * halfW, ROAD_Y, p1.z + n1.z * halfW,
      buckets, 'asphalt'
    );

    // Sidewalks (skip at intersections and for types without sidewalks)
    if (sidewalkWidth > 0) {
      const isStartIntersection = intersectionNodes.has(p0.id);
      const isEndIntersection = intersectionNodes.has(p1.id);

      // Right sidewalk
      const rInner = halfW + CURB_WIDTH;
      const rOuter = rInner + sidewalkWidth;
      if (!isStartIntersection || !isEndIntersection) {
        addQuad(
          p0.x + n0.x * rOuter, SIDEWALK_Y, p0.z + n0.z * rOuter,
          p0.x + n0.x * rInner, SIDEWALK_Y, p0.z + n0.z * rInner,
          p1.x + n1.x * rInner, SIDEWALK_Y, p1.z + n1.z * rInner,
          p1.x + n1.x * rOuter, SIDEWALK_Y, p1.z + n1.z * rOuter,
          buckets, 'sidewalk'
        );

        // Left sidewalk
        addQuad(
          p0.x - n0.x * rInner, SIDEWALK_Y, p0.z - n0.z * rInner,
          p0.x - n0.x * rOuter, SIDEWALK_Y, p0.z - n0.z * rOuter,
          p1.x - n1.x * rOuter, SIDEWALK_Y, p1.z - n1.z * rOuter,
          p1.x - n1.x * rInner, SIDEWALK_Y, p1.z - n1.z * rInner,
          buckets, 'sidewalk'
        );

        // Right curb (vertical face)
        addQuad(
          p0.x + n0.x * rInner, ROAD_Y, p0.z + n0.z * rInner,
          p1.x + n1.x * rInner, ROAD_Y, p1.z + n1.z * rInner,
          p1.x + n1.x * rInner, SIDEWALK_Y, p1.z + n1.z * rInner,
          p0.x + n0.x * rInner, SIDEWALK_Y, p0.z + n0.z * rInner,
          buckets, 'curb'
        );

        // Left curb (vertical face)
        addQuad(
          p1.x - n1.x * rInner, ROAD_Y, p1.z - n1.z * rInner,
          p0.x - n0.x * rInner, ROAD_Y, p0.z - n0.z * rInner,
          p0.x - n0.x * rInner, SIDEWALK_Y, p0.z - n0.z * rInner,
          p1.x - n1.x * rInner, SIDEWALK_Y, p1.z - n1.z * rInner,
          buckets, 'curb'
        );
      }
    }

    // Lane markings — center line
    if (highway !== 'footway' && highway !== 'path' && highway !== 'cycleway') {
      const markHalfW = 0.05;
      const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const isResidential = highway === 'residential' || highway === 'living_street' || highway === 'unclassified';
      const matName = isResidential ? 'laneMarkingYellow' : 'laneMarkingWhite';

      if (isResidential) {
        // Dashed center line
        generateDashedLine(p0, p1, n0, n1, markHalfW, segLen, buckets, matName);
      } else {
        // Solid center line
        addQuad(
          p0.x + n0.x * markHalfW, MARKING_Y, p0.z + n0.z * markHalfW,
          p0.x - n0.x * markHalfW, MARKING_Y, p0.z - n0.z * markHalfW,
          p1.x - n1.x * markHalfW, MARKING_Y, p1.z - n1.z * markHalfW,
          p1.x + n1.x * markHalfW, MARKING_Y, p1.z + n1.z * markHalfW,
          buckets, matName
        );
      }
    }
  }

  // Intersection patches — fill asphalt circles at intersection nodes
  for (const pt of points) {
    if (intersectionNodes.has(pt.id)) {
      const patchRadius = halfW + (sidewalkWidth > 0 ? CURB_WIDTH + sidewalkWidth : 0);
      addIntersectionPatch(pt.x, pt.z, patchRadius, buckets);
    }
  }
}

function generateDashedLine(p0, p1, n0, n1, halfW, segLen, buckets, matName) {
  const dashLen = 1.0;
  const gapLen = 2.0;
  const cycle = dashLen + gapLen;
  const numCycles = Math.floor(segLen / cycle);

  for (let c = 0; c < numCycles; c++) {
    const t0 = (c * cycle) / segLen;
    const t1 = Math.min((c * cycle + dashLen) / segLen, 1);

    const x0 = p0.x + (p1.x - p0.x) * t0;
    const z0 = p0.z + (p1.z - p0.z) * t0;
    const x1 = p0.x + (p1.x - p0.x) * t1;
    const z1 = p0.z + (p1.z - p0.z) * t1;

    // Interpolate perpendiculars
    const nx0 = n0.x + (n1.x - n0.x) * t0;
    const nz0 = n0.z + (n1.z - n0.z) * t0;
    const nx1 = n0.x + (n1.x - n0.x) * t1;
    const nz1 = n0.z + (n1.z - n0.z) * t1;

    addQuad(
      x0 + nx0 * halfW, MARKING_Y, z0 + nz0 * halfW,
      x0 - nx0 * halfW, MARKING_Y, z0 - nz0 * halfW,
      x1 - nx1 * halfW, MARKING_Y, z1 - nz1 * halfW,
      x1 + nx1 * halfW, MARKING_Y, z1 + nz1 * halfW,
      buckets, matName
    );
  }
}

function addIntersectionPatch(cx, cz, radius, buckets) {
  // Simple octagon patch (slightly above road surface to prevent z-fighting)
  const PATCH_Y = ROAD_Y + 0.005;
  const segments = 8;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      cx, PATCH_Y, cz,
      cx + Math.cos(a0) * radius, PATCH_Y, cz + Math.sin(a0) * radius,
      cx + Math.cos(a1) * radius, PATCH_Y, cz + Math.sin(a1) * radius,
    ]);
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2]);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    buckets.asphalt.push(geo);
  }
}

function computeMiterPerps(points) {
  const perps = [];

  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      // First point: perpendicular to first segment
      perps.push(segmentPerp(points[0], points[1]));
    } else if (i === points.length - 1) {
      // Last point: perpendicular to last segment
      perps.push(segmentPerp(points[i - 1], points[i]));
    } else {
      // Interior point: average of adjacent segment perpendiculars (miter join)
      const p0 = segmentPerp(points[i - 1], points[i]);
      const p1 = segmentPerp(points[i], points[i + 1]);
      let mx = (p0.x + p1.x) / 2;
      let mz = (p0.z + p1.z) / 2;
      let len = Math.hypot(mx, mz);
      if (len < 0.001) {
        perps.push(p0);
      } else {
        mx /= len;
        mz /= len;
        // Clamp miter to avoid spikes on sharp turns
        const dot = p0.x * p1.x + p0.z * p1.z;
        const miterScale = 1 / Math.max(0.5, (1 + dot) / 2);
        if (miterScale > 2) {
          perps.push(p0); // Fall back for very sharp corners
        } else {
          perps.push({ x: mx, z: mz });
        }
      }
    }
  }

  return perps;
}

function segmentPerp(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return { x: 1, z: 0 };
  return { x: -dz / len, z: dx / len };
}

function addQuad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, buckets, matName) {
  const positions = new Float32Array([
    x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3,
  ]);

  // Compute face normal from first triangle (negated to fix winding direction)
  const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
  const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
  let nx = -(ay * bz - az * by);
  let ny = -(az * bx - ax * bz);
  let nz = -(ax * by - ay * bx);
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen > 0) { nx /= nLen; ny /= nLen; nz /= nLen; }
  else { nx = 0; ny = 1; nz = 0; }

  const normals = new Float32Array([
    nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz,
  ]);
  const indices = new Uint16Array([2, 1, 0, 3, 2, 0]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  if (!buckets[matName]) buckets[matName] = [];
  buckets[matName].push(geo);
}

function buildRoadGraph(projectedRoads, nodePositions, intersectionNodes) {
  const nodes = new Map();  // nodeId → { x, z }
  const edges = [];
  const adjacency = new Map(); // nodeId → [edgeIndex, ...]

  // Collect all intersection and endpoint node positions
  for (const road of projectedRoads) {
    const pts = road.points;
    // Add start/end as graph nodes
    for (const pt of [pts[0], pts[pts.length - 1]]) {
      if (!nodes.has(pt.id)) {
        nodes.set(pt.id, { x: pt.x, z: pt.z });
        adjacency.set(pt.id, []);
      }
    }
    // Add all intersection nodes
    for (const pt of pts) {
      if (intersectionNodes.has(pt.id) && !nodes.has(pt.id)) {
        nodes.set(pt.id, { x: pt.x, z: pt.z });
        adjacency.set(pt.id, []);
      }
    }
  }

  // Build edges: split each road at intersection nodes
  for (const road of projectedRoads) {
    const pts = road.points;
    let segStart = 0;

    for (let i = 1; i < pts.length; i++) {
      const isEnd = i === pts.length - 1;
      const isIntersection = intersectionNodes.has(pts[i].id);

      if (isEnd || isIntersection) {
        const edgePoints = pts.slice(segStart, i + 1);
        let length = 0;
        for (let j = 1; j < edgePoints.length; j++) {
          length += Math.hypot(
            edgePoints[j].x - edgePoints[j - 1].x,
            edgePoints[j].z - edgePoints[j - 1].z
          );
        }

        const fromId = pts[segStart].id;
        const toId = pts[i].id;

        // Ensure nodes exist
        if (!nodes.has(fromId)) {
          nodes.set(fromId, { x: pts[segStart].x, z: pts[segStart].z });
          adjacency.set(fromId, []);
        }
        if (!nodes.has(toId)) {
          nodes.set(toId, { x: pts[i].x, z: pts[i].z });
          adjacency.set(toId, []);
        }

        const edgeIdx = edges.length;
        edges.push({
          from: fromId,
          to: toId,
          points: edgePoints.map(p => ({ x: p.x, z: p.z })),
          length,
          highway: road.highway,
          roadWidth: road.roadWidth,
        });

        adjacency.get(fromId).push(edgeIdx);
        adjacency.get(toId).push(edgeIdx);

        segStart = i;
      }
    }
  }

  return { nodes, edges, adjacency };
}

// Simple geometry merge (same as buildings.js pattern)
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
