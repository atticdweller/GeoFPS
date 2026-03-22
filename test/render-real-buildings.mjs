/**
 * Render real buildings from cached Brooklyn data.
 * Picks several buildings of different sizes, renders them via the test scene.
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-output', 'real-buildings');

// Load cached data
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'default-location-data.json'), 'utf-8'));
const { buildings, location } = data;

// Project lat/lng to local meter coords (same as projection.js)
const METERS_PER_DEG_LAT = 111320;
const centerLat = location.lat;
const centerLng = location.lng;
const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);

function project(lat, lng) {
  return {
    x: (lng - centerLng) * metersPerDegLng,
    z: (lat - centerLat) * METERS_PER_DEG_LAT,
  };
}

// Compute area of each building and pick representative samples
const buildingsWithArea = buildings.map(b => {
  const pts = b.polygon.map(p => project(p.lat, p.lng));
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].z - pts[i].z);
  }
  area = Math.abs(area / 2);
  return { ...b, projectedPolygon: pts, area };
}).filter(b => b.area >= 10);

// Sort by area descending
buildingsWithArea.sort((a, b) => b.area - a.area);

console.log(`${buildingsWithArea.length} buildings with area >= 10m²`);
console.log(`Largest: ${Math.round(buildingsWithArea[0].area)}m² (${buildingsWithArea[0].tags.building})`);
console.log(`Smallest: ${Math.round(buildingsWithArea[buildingsWithArea.length-1].area)}m²\n`);

// Pick 8 representative buildings
const picks = [
  { label: 'largest', building: buildingsWithArea[0] },
  { label: 'second-largest', building: buildingsWithArea[1] },
  { label: 'mid-large', building: buildingsWithArea[Math.floor(buildingsWithArea.length * 0.1)] },
  { label: 'medium', building: buildingsWithArea[Math.floor(buildingsWithArea.length * 0.3)] },
  { label: 'mid-small', building: buildingsWithArea[Math.floor(buildingsWithArea.length * 0.6)] },
  { label: 'small', building: buildingsWithArea[Math.floor(buildingsWithArea.length * 0.8)] },
  { label: 'tiny', building: buildingsWithArea[buildingsWithArea.length - 1] },
];

// Also find a non-rectangular building (>4 vertices)
const irregular = buildingsWithArea.find(b => b.projectedPolygon.length > 4 && b.area > 50);
if (irregular) picks.push({ label: 'irregular', building: irregular });

for (const pick of picks) {
  const b = pick.building;
  console.log(`${pick.label}: id=${b.id}, area=${Math.round(b.area)}m², vertices=${b.projectedPolygon.length}, tags=${JSON.stringify(b.tags)}`);
}

// Write configs for the test scene
const configs = picks.map(pick => {
  const b = pick.building;
  // Center the polygon at origin
  let cx = 0, cz = 0;
  for (const p of b.projectedPolygon) { cx += p.x; cz += p.z; }
  cx /= b.projectedPolygon.length;
  cz /= b.projectedPolygon.length;

  return {
    name: `real-${pick.label}`,
    description: `Real Brooklyn building (${Math.round(b.area)}m², ${b.projectedPolygon.length} vertices, ${b.tags.building})`,
    polygon: b.projectedPolygon.map(p => ({ x: p.x - cx, z: p.z - cz })),
    tags: b.tags,
  };
});

// Write temp configs
const configPath = path.join(__dirname, 'real-building-configs.json');
fs.writeFileSync(configPath, JSON.stringify(configs, null, 2));

// Now use puppeteer to render each one
console.log('\nStarting render...');
const server = await createServer({ root: ROOT, server: { port: 5174, strictPort: false }, logLevel: 'error' });
await server.listen();
const port = server.config.server.port;

await new Promise(r => setTimeout(r, 2000));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader-webgl'],
  defaultViewport: { width: 1280, height: 720 },
});

try {
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.error('  [page]', msg.text()); });

  await page.goto(`http://localhost:${port}/test/building-test.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__testAPI !== undefined, { timeout: 15000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    console.log(`\n[${i+1}/${configs.length}] ${config.name}: ${config.description}`);

    // Inject the config and render
    await page.evaluate((cfg) => {
      // Dynamically add config and load it
      const { createSingleBuildingMesh } = window.__adapter || {};
      // We need to use the test API differently — load via injected polygon
      window.__tempConfig = cfg;
    }, config);

    // Use evaluate to create the building directly
    const dataUrl = await page.evaluate(async (cfg) => {
      // Import adapter dynamically
      const { createSingleBuildingMesh } = await import('./building-adapter.js');
      const THREE = await import('three');

      // Remove previous building
      const scene = window.__testScene;
      const oldGroup = scene.getObjectByName('realBuilding');
      if (oldGroup) {
        scene.remove(oldGroup);
        oldGroup.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      }

      const result = createSingleBuildingMesh(cfg.polygon, cfg.tags);
      result.group.name = 'realBuilding';
      scene.add(result.group);

      // Position camera for aerial view
      const { center, bbox, height } = result;
      const w = bbox.maxX - bbox.minX;
      const d = bbox.maxY - bbox.minY;
      const maxDim = Math.max(w, d);
      const aerialDist = Math.max(maxDim, height) * 1.5 + 5;

      const camera = window.__testCamera;
      camera.position.set(
        center.x + aerialDist * 0.7,
        height * 1.5,
        center.z + aerialDist * 0.7
      );
      camera.lookAt(center.x, height * 0.3, center.z);

      window.__testRenderer.render(scene, camera);
      return window.__testRenderer.domElement.toDataURL('image/png');
    }, config);

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(OUT_DIR, `${config.name}-aerial.png`), Buffer.from(base64, 'base64'));
    console.log(`  aerial ✓`);

    // Front view
    const frontUrl = await page.evaluate((cfg) => {
      const scene = window.__testScene;
      const group = scene.getObjectByName('realBuilding');
      if (!group) return null;

      const box = new (window.__THREE || THREE).Box3().setFromObject(group);
      const center = box.getCenter(new (window.__THREE || THREE).Vector3());
      const size = box.getSize(new (window.__THREE || THREE).Vector3());
      const dist = Math.max(size.x, size.z) * 1.2 + 5;

      const camera = window.__testCamera;
      camera.position.set(center.x, size.y * 0.5, center.z + dist);
      camera.lookAt(center.x, size.y * 0.5, center.z);

      window.__testRenderer.render(scene, camera);
      return window.__testRenderer.domElement.toDataURL('image/png');
    }, config);

    if (frontUrl) {
      const base64f = frontUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(OUT_DIR, `${config.name}-front.png`), Buffer.from(base64f, 'base64'));
      console.log(`  front ✓`);
    }
  }

  console.log(`\nDone! Screenshots saved to ${OUT_DIR}`);
} finally {
  await browser.close();
  await server.close();
}
