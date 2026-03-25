/**
 * Full-scene Brooklyn renderer for street-view QA.
 * Uses the actual production scene/projection/generation pipeline
 * to render the complete Brooklyn neighborhood, then captures
 * per-building street-view photos.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { initScene, scene } from '../src/core/scene.js';
import { initProjection, project, getBbox, bboxSizeMeters } from '../src/geo/projection.js';
import { generateStreets } from '../src/world/streets.js';
import { generateBuildings } from '../src/world/buildings.js';
import { placeStreetFurniture } from '../src/world/streetFurniture.js';

const WIDTH = 1280;
const HEIGHT = 720;

async function init() {
  // Use the production scene setup (creates scene, lights — but its renderer lacks preserveDrawingBuffer)
  initScene();

  // Create our own renderer with preserveDrawingBuffer for toDataURL
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Replace the production renderer's canvas
  document.body.innerHTML = '';
  document.body.appendChild(renderer.domElement);

  // Our own camera for street-view shots
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 500);

  // Disable fog for clearer QA shots
  scene.fog = null;

  // Load cached Brooklyn data
  const resp = await fetch('/test/default-location-data.json');
  const data = await resp.json();
  const { location, buildings: buildingData, roads: roadData } = data;
  console.log(`Loaded: ${buildingData.length} buildings, ${roadData.length} roads`);

  // Init projection
  initProjection(location.lat, location.lng);
  const bbox = getBbox(location.lat, location.lng, 200);
  const sizeMeters = bboxSizeMeters(bbox);

  // Physics world
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });

  // Flat elevation (no real elevation API in test)
  const elevData = {
    grid: Array.from({ length: 32 }, () => new Float32Array(32)),
    width: 32, height: 32, minElev: 0, maxElev: 0,
  };

  // Generate full scene
  // Ground plane well below street level — streets render at Y=0.02+
  const groundGeo = new THREE.PlaneGeometry(sizeMeters.width * 2, sizeMeters.height * 2);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a6a30 });
  const terrainMesh = new THREE.Mesh(groundGeo, groundMat);
  terrainMesh.position.y = -0.01;
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Also make sure the production initScene terrain (if any) doesn't interfere
  // Remove the production terrain that initScene may have added
  const existingTerrain = scene.children.find(c => c.geometry && c.geometry.parameters &&
    c.geometry.parameters.width === sizeMeters.width);
  // (won't find one since we don't call createTerrain)

  console.log('Generating streets...');
  const streetBuckets = {
    asphalt: [], sidewalk: [], curb: [],
    laneMarkingWhite: [], laneMarkingYellow: [],
  };
  let projectedRoads = [];
  if (roadData.length > 0) {
    const result = generateStreets(world, roadData, sizeMeters, streetBuckets);
    projectedRoads = result.projectedRoads;
    // Skip flattenTerrainUnderRoads — our simple ground plane doesn't need it

    // Debug: check if streets rendered
    const streetGroup = scene.getObjectByName('streets');
    console.log(`Street debug: group=${!!streetGroup}, children=${streetGroup?.children.length}, buckets: asphalt=${streetBuckets.asphalt.length} sidewalk=${streetBuckets.sidewalk.length}`);

    // Raise streets above ground plane to prevent z-fighting
    if (streetGroup) {
      streetGroup.position.y = 0.06;
    }
  }

  console.log('Generating buildings...');
  generateBuildings(world, buildingData, projectedRoads, elevData, sizeMeters);

  console.log('Placing street furniture...');
  const furnitureBuckets = {
    lampPost: [], lampHead: [], hydrant: [], mailbox: [],
    garbageCan: [], metal: [], wood: [],
  };
  if (projectedRoads.length > 0) {
    placeStreetFurniture(projectedRoads, world, furnitureBuckets);
  }

  // Pre-compute building info for camera positioning
  const buildingCenters = buildingData.map((bld, idx) => {
    const pts = bld.polygon.map(p => project(p.lat, p.lng));
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p.x; cz += p.z; }
    cx /= pts.length; cz /= pts.length;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }

    let height = 6.4;
    if (bld.tags.height) height = parseFloat(bld.tags.height) || 6.4;
    else if (bld.tags['building:levels']) height = (parseInt(bld.tags['building:levels']) || 2) * 3.2;

    // Find nearest road point for camera placement
    let bestDist = Infinity, bestPt = null;
    for (const road of projectedRoads) {
      for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i], b = road.points[i + 1];
        const dist = ptSegDist(cx, cz, a.x, a.z, b.x, b.z);
        if (dist < bestDist) {
          bestDist = dist;
          const dx = b.x - a.x, dz = b.z - a.z;
          const lenSq = dx * dx + dz * dz;
          let t = lenSq > 0 ? ((cx - a.x) * dx + (cz - a.z) * dz) / lenSq : 0;
          t = Math.max(0, Math.min(1, t));
          bestPt = { x: a.x + t * dx, z: a.z + t * dz };
        }
      }
    }

    const label = bld.tags['addr:street']
      ? `${bld.tags['addr:housenumber'] || ''} ${bld.tags['addr:street']}`.trim()
      : bld.tags.name || `building-${idx}`;

    return { idx, cx, cz, w: maxX - minX, d: maxZ - minZ, height, label, tags: bld.tags, bestPt, bestDist };
  });

  console.log(`Scene ready. ${buildingCenters.length} buildings indexed.`);

  // ── API for Puppeteer ──
  window.__streetAPI = {
    getBuildingCount: () => buildingCenters.length,

    getBuildingInfo: (idx) => {
      const b = buildingCenters[idx];
      return { label: b.label, area: Math.round(b.w * b.d), height: b.height, tags: b.tags };
    },

    setCameraForBuilding: (idx) => {
      const b = buildingCenters[idx];
      const maxDim = Math.max(b.w, b.d, b.height);

      // Calculate distance needed to fit the building in frame
      const baseFov = maxDim > 20 ? 80 : 65;
      const halfFov = baseFov * Math.PI / 360;
      const neededDist = maxDim / (2 * Math.tan(halfFov)) * 0.8;

      let camX, camZ;
      if (b.bestPt && b.bestDist < 50) {
        const dx = b.bestPt.x - b.cx;
        const dz = b.bestPt.z - b.cz;
        const dist = Math.hypot(dx, dz) || 1;
        // Stand past the road, far enough to frame the building
        const extra = Math.max(3, neededDist - b.bestDist);
        camX = b.bestPt.x + (dx / dist) * extra;
        camZ = b.bestPt.z + (dz / dist) * extra;
      } else {
        camX = b.cx;
        camZ = b.cz + Math.max(15, neededDist);
      }

      // Cap look height so the street is always visible in the bottom of frame
      const lookHeight = Math.min(b.height * 0.35, 4.0);

      camera.position.set(camX, 1.7, camZ);
      camera.lookAt(b.cx, lookHeight, b.cz);
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    },

    capture: () => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
  };
}

function ptSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.001) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

init().catch(e => console.error('Init failed:', e));
