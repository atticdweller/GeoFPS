import * as CANNON from 'cannon-es';
import { initScene } from './core/scene.js';
import { startLoop, onUpdate } from './core/loop.js';
import { initPlayer } from './player/controller.js';
import { initWeapon, onHit } from './player/weapon.js';
import { initEnemies } from './enemies/spawner.js';
import { showPicker } from './geo/picker.js';
import { initProjection, getBbox } from './geo/projection.js';
import { bboxSizeMeters } from './geo/projection.js';
import { fetchBuildings } from './geo/overpass.js';
import { fetchElevation } from './geo/elevation.js';
import { createTerrain } from './world/terrain.js';
import { generateBuildings } from './world/buildings.js';

// Loading screen helpers
const loadingEl = document.getElementById('loading');
const loadingStatus = document.getElementById('loading-status');
const loadingBar = document.getElementById('loading-bar-inner');

function showLoading(msg, pct) {
  loadingEl.style.display = 'flex';
  loadingStatus.textContent = msg;
  loadingBar.style.width = `${pct}%`;
}

function hideLoading() {
  loadingEl.style.display = 'none';
}

async function main() {
  // 1. Init Three.js scene (needed for rendering during loading)
  initScene();

  // 2. Show location picker — wait for user to choose a spot
  const location = await showPicker();
  console.log(`Selected location: ${location.lat}, ${location.lng}`);

  // 3. Init projection centered on chosen location
  initProjection(location.lat, location.lng);
  const radius = 200; // meters
  const bbox = getBbox(location.lat, location.lng, radius);
  const sizeMeters = bboxSizeMeters(bbox);

  // 4. Show loading screen
  showLoading('Fetching building data...', 10);

  // 5. Fetch data in parallel
  let buildingData, elevData;
  try {
    const [bldResult, elevResult] = await Promise.all([
      fetchBuildings(bbox),
      (showLoading('Fetching elevation data...', 20), fetchElevation(bbox, 32)),
    ]);
    buildingData = bldResult;
    elevData = elevResult;
  } catch (e) {
    console.error('Data fetch error:', e);
    // Fallback: empty buildings, flat terrain
    buildingData = [];
    elevData = {
      grid: Array.from({ length: 32 }, () => new Float32Array(32)),
      width: 32, height: 32, minElev: 0, maxElev: 0,
    };
  }

  showLoading('Generating terrain...', 50);
  await tick(); // yield to let UI update

  // 6. Physics world
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -20, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);

  // Physics step in game loop
  onUpdate((dt) => {
    world.step(1 / 60, dt, 3);
  });

  // 7. Create terrain
  createTerrain(world, elevData, sizeMeters);

  showLoading(`Generating ${buildingData.length} buildings...`, 65);
  await tick();

  // 8. Generate buildings with interiors
  generateBuildings(world, buildingData, elevData, sizeMeters);

  showLoading('Spawning player...', 90);
  await tick();

  // 9. Player
  initPlayer(world);

  // 10. Weapon
  initWeapon();

  // 11. Enemies
  initEnemies();

  showLoading('Ready!', 100);
  await tick();

  // 12. Hide loading, show blocker (click to play)
  hideLoading();
  document.getElementById('hud').style.display = 'block';
  document.getElementById('blocker').style.display = 'flex';

  // 13. Start game loop
  startLoop();
}

/** Yield to browser for one frame (lets loading UI update). */
function tick() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

main().catch(e => {
  console.error('Game init error:', e);
  showLoading(`Error: ${e.message}`, 0);
});
