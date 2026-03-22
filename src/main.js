import * as CANNON from 'cannon-es';
import { initScene } from './core/scene.js';
import { startLoop, onUpdate } from './core/loop.js';
import { initPlayer } from './player/controller.js';
import { initWeapon } from './player/weapon.js';
import { initEnemies } from './enemies/spawner.js';
import { showPicker } from './geo/picker.js';
import { initProjection, getBbox } from './geo/projection.js';
import { bboxSizeMeters } from './geo/projection.js';
import { fetchOSMData } from './geo/overpass.js';
import { fetchElevation } from './geo/elevation.js';
import { createTerrain, flattenTerrainUnderRoads } from './world/terrain.js';
import { generateBuildings } from './world/buildings.js';
import { generateStreets } from './world/streets.js';
import { placeStreetFurniture } from './world/streetFurniture.js';
import { placeParkedCars, initTraffic } from './world/vehicles.js';

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
  // 1. Init Three.js scene
  initScene();

  // 2. Show location picker
  const location = await showPicker();
  console.log(`Selected location: ${location.lat}, ${location.lng}`);

  // 3. Init projection centered on chosen location
  initProjection(location.lat, location.lng);
  const radius = 200; // meters
  const bbox = getBbox(location.lat, location.lng, radius);
  const sizeMeters = bboxSizeMeters(bbox);

  // 4. Fetch data
  showLoading('Fetching map data...', 10);

  let buildingData, roadData, elevData;
  try {
    const [osmResult, elevResult] = await Promise.all([
      fetchOSMData(bbox),
      (showLoading('Fetching elevation data...', 20), fetchElevation(bbox, 32)),
    ]);
    buildingData = osmResult.buildings;
    roadData = osmResult.roads;
    elevData = elevResult;
  } catch (e) {
    console.error('Data fetch error:', e);
    buildingData = [];
    roadData = [];
    elevData = {
      grid: Array.from({ length: 32 }, () => new Float32Array(32)),
      width: 32, height: 32, minElev: 0, maxElev: 0,
    };
  }

  showLoading('Generating terrain...', 40);
  await tick();

  // 5. Physics world
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -20, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);

  onUpdate((dt) => {
    world.step(1 / 60, dt, 3);
  });

  // 6. Create terrain
  const terrainMesh = createTerrain(world, elevData, sizeMeters);

  // 7. Generate streets & sidewalks
  showLoading('Generating streets...', 50);
  await tick();

  // Street geometry buckets (separate from building buckets since streets merge independently)
  const streetBuckets = {
    asphalt: [], sidewalk: [], curb: [],
    laneMarkingWhite: [], laneMarkingYellow: [],
  };

  let roadGraph = null;
  let projectedRoads = [];

  if (roadData.length > 0) {
    const result = generateStreets(world, roadData, sizeMeters, streetBuckets);
    roadGraph = result.roadGraph;
    projectedRoads = result.projectedRoads;

    // Flatten terrain under roads
    flattenTerrainUnderRoads(terrainMesh, projectedRoads, sizeMeters);
  }

  // 8. Generate buildings with interiors
  showLoading(`Generating ${buildingData.length} buildings...`, 60);
  await tick();

  generateBuildings(world, buildingData, projectedRoads, elevData, sizeMeters);

  // 9. Street furniture
  showLoading('Placing street furniture...', 75);
  await tick();

  const furnitureBuckets = {
    lampPost: [], lampHead: [], hydrant: [], mailbox: [],
    garbageCan: [], metal: [], wood: [],
  };

  if (projectedRoads.length > 0) {
    placeStreetFurniture(projectedRoads, world, furnitureBuckets);
  }

  // 10. Vehicles
  showLoading('Placing vehicles...', 85);
  await tick();

  if (projectedRoads.length > 0) {
    placeParkedCars(projectedRoads, world);
  }

  if (roadGraph) {
    initTraffic(roadGraph);
  }

  // 11. Player (debug mode on by default)
  showLoading('Spawning player...', 90);
  await tick();

  initPlayer(world);

  // 12. Weapon
  initWeapon();

  // 13. Enemies
  initEnemies();

  showLoading('Ready!', 100);
  await tick();

  // 14. Show game
  hideLoading();
  document.getElementById('hud').style.display = 'block';
  document.getElementById('blocker').style.display = 'flex';

  // 15. Start game loop
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
