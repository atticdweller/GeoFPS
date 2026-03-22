import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { materials } from '../utils/materials.js';

const SIDEWALK_Y = 0.14; // road Y + curb height

/**
 * Place street furniture along sidewalks.
 * All geometry pushed into buckets for batch merging.
 */
export function placeStreetFurniture(projectedRoads, world, buckets) {
  let lampCount = 0, hydrantCount = 0, mailboxCount = 0, trashCount = 0, benchCount = 0;

  for (const road of projectedRoads) {
    if (road.sidewalkWidth <= 0) continue;

    const totalOffset = road.roadWidth / 2 + 0.15 + road.sidewalkWidth * 0.8;

    // Walk along the road placing props at intervals
    let distAccum = 0;
    let lampDist = 0, hydrantDist = 0, mailboxDist = 0, trashDist = 0, benchDist = 0;

    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.5) continue;

      const dx = (b.x - a.x) / segLen;
      const dz = (b.z - a.z) / segLen;
      // Perpendicular (right side)
      const px = -dz;
      const pz = dx;

      let d = 0;
      while (d < segLen) {
        const t = d / segLen;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;

        lampDist += 1;
        hydrantDist += 1;
        mailboxDist += 1;
        trashDist += 1;
        benchDist += 1;

        // Street lamps — every ~25m, both sides
        if (lampDist >= 25) {
          lampDist = 0;
          placeStreetLamp(x + px * totalOffset, SIDEWALK_Y, z + pz * totalOffset, buckets, world);
          placeStreetLamp(x - px * totalOffset, SIDEWALK_Y, z - pz * totalOffset, buckets, world);
          lampCount += 2;
        }

        // Fire hydrants — every ~70m, right side only
        if (hydrantDist >= 70) {
          hydrantDist = 0;
          placeHydrant(x + px * totalOffset, SIDEWALK_Y, z + pz * totalOffset, buckets, world);
          hydrantCount++;
        }

        // Mailboxes — every ~120m, residential only
        if (mailboxDist >= 120 && (road.highway === 'residential' || road.highway === 'living_street')) {
          mailboxDist = 0;
          placeMailbox(x - px * totalOffset, SIDEWALK_Y, z - pz * totalOffset, buckets, world);
          mailboxCount++;
        }

        // Garbage cans — every ~50m
        if (trashDist >= 50) {
          trashDist = 0;
          placeGarbageCan(x + px * (totalOffset - 0.3), SIDEWALK_Y, z + pz * (totalOffset - 0.3), buckets, world);
          trashCount++;
        }

        // Benches — every ~90m
        if (benchDist >= 90) {
          benchDist = 0;
          placeBench(x - px * (totalOffset - 0.3), SIDEWALK_Y, z - pz * (totalOffset - 0.3),
            dx, dz, buckets, world);
          benchCount++;
        }

        d += 1; // step 1m
      }

      distAccum += segLen;
    }
  }

  // Merge street furniture into scene
  const furnitureGroup = new THREE.Group();
  furnitureGroup.name = 'streetFurniture';

  const furnitureKeys = ['lampPost', 'lampHead', 'hydrant', 'mailbox', 'garbageCan', 'metal', 'wood'];
  for (const matName of furnitureKeys) {
    if (!buckets[matName] || buckets[matName].length === 0) continue;
    const merged = mergeGeometries(buckets[matName]);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[matName]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    furnitureGroup.add(mesh);
  }

  scene.add(furnitureGroup);
  console.log(`Placed street furniture: ${lampCount} lamps, ${hydrantCount} hydrants, ${mailboxCount} mailboxes, ${trashCount} trash cans, ${benchCount} benches`);
}

function placeStreetLamp(x, y, z, buckets, world) {
  // Pole
  addCylinder(0.08, 5.0, x, y, z, 'lampPost', buckets, 12);

  // Arm
  addBox(1.0, 0.08, 0.08, x, y + 5.0, z, 'lampPost', buckets);

  // Lamp head
  addBox(0.3, 0.15, 0.3, x + 0.5, y + 4.9, z, 'lampHead', buckets);

  // Physics
  addStaticBox(world, x, y + 2.5, z, 0.15, 2.5, 0.15);
}

function placeHydrant(x, y, z, buckets, world) {
  // Body
  addCylinder(0.15, 0.6, x, y, z, 'hydrant', buckets, 8);

  // Cap
  addCylinder(0.18, 0.1, x, y + 0.6, z, 'hydrant', buckets, 8);

  // Physics
  addStaticBox(world, x, y + 0.35, z, 0.2, 0.35, 0.2);
}

function placeMailbox(x, y, z, buckets, world) {
  // Post
  addBox(0.1, 1.0, 0.1, x, y, z, 'metal', buckets);

  // Box
  addBox(0.4, 0.5, 0.35, x, y + 1.0, z, 'mailbox', buckets);

  // Physics
  addStaticBox(world, x, y + 0.75, z, 0.25, 0.75, 0.2);
}

function placeGarbageCan(x, y, z, buckets, world) {
  addCylinder(0.3, 0.9, x, y, z, 'garbageCan', buckets, 8);

  // Physics
  addStaticBox(world, x, y + 0.45, z, 0.3, 0.45, 0.3);
}

function placeBench(x, y, z, dirX, dirZ, buckets, world) {
  // Seat
  addBox(1.5, 0.05, 0.4, x, y + 0.4, z, 'wood', buckets);

  // Legs (4)
  addBox(0.05, 0.4, 0.05, x - 0.6, y, z - 0.15, 'metal', buckets);
  addBox(0.05, 0.4, 0.05, x + 0.6, y, z - 0.15, 'metal', buckets);
  addBox(0.05, 0.4, 0.05, x - 0.6, y, z + 0.15, 'metal', buckets);
  addBox(0.05, 0.4, 0.05, x + 0.6, y, z + 0.15, 'metal', buckets);

  // Back
  addBox(1.5, 0.4, 0.05, x, y + 0.45, z - 0.17, 'wood', buckets);

  // Physics
  addStaticBox(world, x, y + 0.25, z, 0.8, 0.4, 0.25);
}

// ---- Helpers ----

function addBox(w, h, d, x, y, z, matName, buckets) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y + h / 2, z);
  geo.computeVertexNormals();
  if (!buckets[matName]) buckets[matName] = [];
  buckets[matName].push(geo);
}

function addCylinder(radius, height, x, y, z, matName, buckets, segments = 8) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments);
  geo.translate(x, y + height / 2, z);
  geo.computeVertexNormals();
  if (!buckets[matName]) buckets[matName] = [];
  buckets[matName].push(geo);
}

function addStaticBox(world, x, y, z, hx, hy, hz) {
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
  });
  body.position.set(x, y, z);
  world.addBody(body);
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
