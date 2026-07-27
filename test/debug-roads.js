/**
 * Debug scene: renders ONLY roads from the Brooklyn dataset.
 * Top-down orthographic view + street-level perspective view.
 * Captures both to test-output/debug-roads/
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { initScene, scene } from '../src/core/scene.js';
import { initProjection, project, getBbox, bboxSizeMeters } from '../src/geo/projection.js';
import { generateStreets } from '../src/world/streets.js';

const WIDTH = 1280;
const HEIGHT = 720;

async function init() {
  initScene();

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  document.body.innerHTML = '';
  document.body.appendChild(renderer.domElement);

  // Load data
  const resp = await fetch('/test/default-location-data.json');
  const data = await resp.json();
  const { location, roads: roadData } = data;
  console.log(`Loaded: ${roadData.length} roads`);

  initProjection(location.lat, location.lng);
  const bbox = getBbox(location.lat, location.lng, 200);
  const sizeMeters = bboxSizeMeters(bbox);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });

  // Generate ONLY streets
  const streetBuckets = {
    asphalt: [], sidewalk: [], curb: [],
    laneMarkingWhite: [], laneMarkingYellow: [],
  };
  const result = generateStreets(world, roadData, sizeMeters, streetBuckets);
  const projectedRoads = result.projectedRoads;

  const streetGroup = scene.getObjectByName('streets');
  console.log(`Streets: ${streetGroup?.children.length} meshes, asphalt=${streetBuckets.asphalt.length}, sidewalk=${streetBuckets.sidewalk.length}`);
  if (streetGroup) {
    streetGroup.children.forEach((child, i) => {
      if (child.isMesh) {
        const pos = child.geometry.attributes.position;
        let yMin = Infinity, yMax = -Infinity;
        for (let j = 0; j < Math.min(pos.count, 100); j++) {
          const y = pos.getY(j);
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
        console.log(`  Mesh ${i}: ${pos.count} verts, Y range [${yMin.toFixed(3)}, ${yMax.toFixed(3)}], material=${child.material.color.getHexString()}`);
      }
    });
  }

  // Log road extents
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const road of projectedRoads) {
    for (const pt of road.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
  }
  console.log(`Road extents: X [${minX.toFixed(1)}, ${maxX.toFixed(1)}], Z [${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
  console.log(`Terrain size: ${sizeMeters.width.toFixed(1)} x ${sizeMeters.height.toFixed(1)}`);

  // Add a red ground plane for contrast
  const groundGeo = new THREE.PlaneGeometry(sizeMeters.width * 2, sizeMeters.height * 2);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ color: 0x220000 }));
  ground.position.y = -0.5;
  scene.add(ground);

  // Raise streets and make double-sided (normals may face down)
  if (streetGroup) {
    streetGroup.position.y = 0.06;
    streetGroup.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.side = THREE.DoubleSide;
      }
    });
  }

  // Draw road centerlines as bright red lines for debugging
  for (const road of projectedRoads) {
    const pts = road.points.map(p => new THREE.Vector3(p.x, 0.2, p.z));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff0000 }));
    scene.add(line);
  }

  window.__debugAPI = {
    captureTopDown: () => {
      const halfW = sizeMeters.width / 2 + 10;
      const halfD = sizeMeters.height / 2 + 10;
      const ortho = new THREE.OrthographicCamera(-halfW, halfW, halfD, -halfD, 0.1, 500);
      ortho.position.set(0, 100, 0);
      ortho.lookAt(0, 0, 0);
      renderer.render(scene, ortho);
      return renderer.domElement.toDataURL('image/png');
    },

    captureStreetLevel: (x, z, lookX, lookZ) => {
      const cam = new THREE.PerspectiveCamera(65, WIDTH / HEIGHT, 0.1, 500);
      cam.position.set(x, 1.7, z);
      cam.lookAt(lookX, 1.7, lookZ);
      renderer.render(scene, cam);
      return renderer.domElement.toDataURL('image/png');
    },

    getRoadPoints: () => {
      // Return a few road midpoints for street-level testing
      const pts = [];
      for (const road of projectedRoads) {
        if (road.points.length >= 2) {
          const mid = Math.floor(road.points.length / 2);
          const p = road.points[mid];
          const next = road.points[Math.min(mid + 1, road.points.length - 1)];
          pts.push({ x: p.x, z: p.z, lookX: next.x, lookZ: next.z, highway: road.highway });
        }
      }
      return pts;
    },
  };

  console.log('Debug scene ready');
}

init().catch(e => console.error('Init failed:', e));
