/**
 * Building test scene — renders a single building at a time for visual inspection.
 * Exposes window.__testAPI for Puppeteer automation and Claude's debug tools.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configs } from './building-configs.js';
import { createSingleBuildingMesh } from './building-adapter.js';

const WIDTH = 1280;
const HEIGHT = 720;

// ── Scene setup ──

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
// No fog — we want full visibility for inspection

const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.05, 500);
camera.position.set(15, 10, 15);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true, // Required for toDataURL() screenshots
});
renderer.setSize(WIDTH, HEIGHT);
renderer.setPixelRatio(1); // Fixed 1x for consistent screenshot size
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ── Lighting (matches production scene.js) ──

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 150;
scene.add(sun);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.3);
scene.add(hemiLight);

// ── Ground plane ──

const groundGeo = new THREE.PlaneGeometry(100, 100);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a7c3f });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ── Orbit controls (manual mode) ──

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.1;

// ── State ──

let currentResult = null; // { group, center, bbox, height, numFloors, area, buildingType }
let currentConfigIndex = 0;

// ── Building management ──

function loadBuilding(index) {
  // Remove previous building
  if (currentResult) {
    scene.remove(currentResult.group);
    currentResult.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
    });
  }

  const config = configs[index];
  currentConfigIndex = index;
  currentResult = createSingleBuildingMesh(config.polygon, config.tags);
  scene.add(currentResult.group);

  // Update shadow camera bounds to fit this building
  const maxDim = Math.max(
    currentResult.bbox.maxX - currentResult.bbox.minX,
    currentResult.bbox.maxY - currentResult.bbox.minY,
    currentResult.height
  );
  const shadowBound = maxDim * 1.2 + 5;
  sun.shadow.camera.left = -shadowBound;
  sun.shadow.camera.right = shadowBound;
  sun.shadow.camera.top = shadowBound;
  sun.shadow.camera.bottom = -shadowBound;
  sun.shadow.camera.updateProjectionMatrix();

  updateInfo(config);
  return currentResult;
}

function loadBuildingByName(name) {
  const index = configs.findIndex(c => c.name === name);
  if (index === -1) throw new Error(`Config not found: ${name}`);
  return loadBuilding(index);
}

// ── Camera positioning ──

function getCameraPositions() {
  if (!currentResult) return {};

  const { center, bbox, height } = currentResult;
  const cx = center.x;
  const cz = center.z;
  const w = bbox.maxX - bbox.minX;
  const d = bbox.maxY - bbox.minY;
  const maxDim = Math.max(w, d);
  const dist = maxDim * 1.2 + 5;
  const eyeH = height * 0.5;
  const aerialDist = Math.max(maxDim, height) * 1.5 + 5;

  return {
    front:    { pos: [cx, eyeH, cz + dist],  target: [cx, eyeH, cz] },
    right:    { pos: [cx + dist, eyeH, cz],   target: [cx, eyeH, cz] },
    back:     { pos: [cx, eyeH, cz - dist],   target: [cx, eyeH, cz] },
    left:     { pos: [cx - dist, eyeH, cz],   target: [cx, eyeH, cz] },
    aerial:   { pos: [cx + aerialDist * 0.7, height * 1.5, cz + aerialDist * 0.7],
                target: [cx, height * 0.3, cz] },
    top:      { pos: [cx, height + aerialDist, cz + 0.01],
                target: [cx, 0, cz] },
    // Interior: offset from center toward one corner, look along the longest axis
    interior: w > d
      ? { pos: [cx - w * 0.3, 1.6, cz], target: [cx + w * 0.3, 1.6, cz] }
      : { pos: [cx, 1.6, cz - d * 0.3], target: [cx, 1.6, cz + d * 0.3] },
  };
}

function setCameraView(viewName) {
  const positions = getCameraPositions();
  const view = positions[viewName];
  if (!view) return;

  camera.position.set(...view.pos);
  camera.lookAt(...view.target);
  orbitControls.target.set(...view.target);
  orbitControls.update();
}

function setCameraCustom(px, py, pz, tx, ty, tz) {
  camera.position.set(px, py, pz);
  camera.lookAt(tx, ty, tz);
  orbitControls.target.set(tx, ty, tz);
  orbitControls.update();
}

function capture() {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

function getBuildingInfo() {
  if (!currentResult) return null;
  const config = currentConfigIndex >= 0 ? configs[currentConfigIndex] : null;
  return {
    name: config ? config.name : 'custom',
    description: config ? config.description : 'Custom polygon',
    center: currentResult.center,
    bbox: currentResult.bbox,
    height: currentResult.height,
    numFloors: currentResult.numFloors,
    area: currentResult.area,
    type: currentResult.buildingType,
  };
}

// ── Public API for Puppeteer / Claude ──

// Load arbitrary polygon+tags (for real OSM data testing)
function loadCustomBuilding(polygon, tags) {
  if (currentResult) {
    scene.remove(currentResult.group);
    currentResult.group.traverse(child => { if (child.geometry) child.geometry.dispose(); });
  }
  currentConfigIndex = -1;
  currentResult = createSingleBuildingMesh(polygon, tags);
  scene.add(currentResult.group);

  const maxDim = Math.max(
    currentResult.bbox.maxX - currentResult.bbox.minX,
    currentResult.bbox.maxY - currentResult.bbox.minY,
    currentResult.height
  );
  const shadowBound = maxDim * 1.2 + 5;
  sun.shadow.camera.left = -shadowBound;
  sun.shadow.camera.right = shadowBound;
  sun.shadow.camera.top = shadowBound;
  sun.shadow.camera.bottom = -shadowBound;
  sun.shadow.camera.updateProjectionMatrix();

  return currentResult;
}

// ── Floorplan capture (top-down interior shot with roof clipped) ──

function captureFloorplan() {
  if (!currentResult) return null;
  const { center, bbox, height } = currentResult;
  const cx = center.x;
  const cz = center.z;
  const w = bbox.maxX - bbox.minX;
  const d = bbox.maxY - bbox.minY;
  const pad = 1;
  const halfW = (w / 2) + pad;
  const halfD = (d / 2) + pad;

  // Orthographic camera looking straight down, just below the roof
  const ortho = new THREE.OrthographicCamera(-halfW, halfW, halfD, -halfD, 0.1, height + 5);
  ortho.position.set(cx, height - 0.05, cz);
  ortho.lookAt(cx, 0, cz);
  ortho.updateProjectionMatrix();

  renderer.render(scene, ortho);
  return renderer.domElement.toDataURL('image/png');
}

window.__testAPI = {
  getConfigs: () => configs.map(c => c.name),
  getCameraViews: () => ['front', 'right', 'back', 'left', 'aerial', 'top', 'interior', 'floorplan'],
  loadBuilding: (index) => loadBuilding(index),
  loadBuildingByName: (name) => loadBuildingByName(name),
  loadCustomBuilding: (polygon, tags) => loadCustomBuilding(polygon, tags),
  setCameraView: (view) => setCameraView(view),
  setCameraCustom: (px, py, pz, tx, ty, tz) => setCameraCustom(px, py, pz, tx, ty, tz),
  capture: () => capture(),
  captureFloorplan: () => captureFloorplan(),
  render: () => renderer.render(scene, camera),
  getBuildingInfo: () => getBuildingInfo(),
};

// ── UI Controls ──

const configSelect = document.getElementById('config-select');
const cameraSelect = document.getElementById('camera-select');
const captureBtn = document.getElementById('capture-btn');

// Populate building dropdown
configs.forEach((config, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = `${config.name}`;
  configSelect.appendChild(opt);
});

configSelect.addEventListener('change', () => {
  loadBuilding(parseInt(configSelect.value));
  setCameraView(cameraSelect.value);
});

cameraSelect.addEventListener('change', () => {
  setCameraView(cameraSelect.value);
});

captureBtn.addEventListener('click', () => {
  const dataUrl = capture();
  const link = document.createElement('a');
  const config = configs[currentConfigIndex];
  link.download = `${config.name}_${cameraSelect.value}.png`;
  link.href = dataUrl;
  link.click();
});

function updateInfo(config) {
  const info = document.getElementById('info');
  if (!currentResult) return;
  info.innerHTML = [
    `<b>${config.name}</b>`,
    config.description,
    `Type: ${currentResult.buildingType}`,
    `Area: ${Math.round(currentResult.area)}m² | Height: ${currentResult.height.toFixed(1)}m | Floors: ${currentResult.numFloors}`,
    `BBox: ${(currentResult.bbox.maxX - currentResult.bbox.minX).toFixed(1)}×${(currentResult.bbox.maxY - currentResult.bbox.minY).toFixed(1)}m`,
  ].join('<br>');
}

// ── Animation loop ──

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, camera);
}

// ── Init ──

loadBuilding(0);
setCameraView('aerial');
animate();
