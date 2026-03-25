/**
 * Batch capture — renders ALL buildings from the cached Brooklyn dataset.
 * Uses loadCustomBuilding() to inject each real OSM polygon.
 * Saves PNGs to test-output/brooklyn/{building-id}/{view}.png
 *
 * Usage: node test/capture-brooklyn.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-output', 'brooklyn');
const VIEWS = ['front', 'right', 'back', 'left', 'aerial', 'top', 'interior'];

// Load and project cached Brooklyn data
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'default-location-data.json'), 'utf-8'));
const { buildings, location } = data;

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

function computeArea(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].z - pts[i].z);
  }
  return Math.abs(area / 2);
}

// Project all buildings and filter
const projected = buildings.map((b, idx) => {
  const pts = b.polygon.map(p => project(p.lat, p.lng));
  const area = computeArea(pts);
  // Center polygon at origin for rendering
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  cx /= pts.length;
  cz /= pts.length;
  const centered = pts.map(p => ({ x: p.x - cx, z: p.z - cz }));

  const label = b.tags['addr:street']
    ? `${b.tags['addr:housenumber'] || ''} ${b.tags['addr:street']}`.trim()
    : b.tags.name || `building-${idx}`;
  const safeName = `${idx}-${label.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}`;

  return { ...b, idx, polygon: centered, area, label, safeName };
}).filter(b => b.area >= 10);

console.log(`${projected.length} buildings to render (area >= 10m²)`);
console.log(`Total screenshots: ${projected.length} × ${VIEWS.length} = ${projected.length * VIEWS.length}\n`);

async function main() {
  console.log('Starting Vite dev server...');
  const server = await createServer({
    root: ROOT,
    server: { port: 5174, strictPort: false },
    logLevel: 'error',
  });
  await server.listen();
  const port = server.config.server.port;
  console.log(`Vite server running on http://localhost:${port}`);

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl'],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('  [page]', msg.text());
    });

    await new Promise(r => setTimeout(r, 2000));
    await page.goto(`http://localhost:${port}/test/building-test.html`, {
      waitUntil: 'load',
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__testAPI !== undefined, { timeout: 15000 });
    console.log('Test page loaded, API ready.\n');

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (let i = 0; i < projected.length; i++) {
      const b = projected[i];
      const configDir = path.join(OUT_DIR, b.safeName);
      fs.mkdirSync(configDir, { recursive: true });

      // Load building via custom polygon
      await page.evaluate((polygon, tags) => {
        window.__testAPI.loadCustomBuilding(polygon, tags);
      }, b.polygon, b.tags);
      await new Promise(r => setTimeout(r, 50));

      const type = b.tags.building || 'unknown';
      const floors = b.tags['building:levels'] || b.tags.height || '?';
      console.log(`[${i + 1}/${projected.length}] ${b.label} (${type}, ${Math.round(b.area)}m², ${b.polygon.length}v)`);

      for (const view of VIEWS) {
        await page.evaluate((v) => {
          window.__testAPI.setCameraView(v);
          window.__testAPI.render();
        }, view);

        const dataUrl = await page.evaluate(() => window.__testAPI.capture());
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(path.join(configDir, `${view}.png`), Buffer.from(base64, 'base64'));
        process.stdout.write(`  ${view} ✓ `);
      }

      // Capture floorplan (2D canvas render)
      const floorplanUrl = await page.evaluate(() => window.__testAPI.captureFloorplan());
      if (floorplanUrl) {
        const fpBase64 = floorplanUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(path.join(configDir, 'floorplan.png'), Buffer.from(fpBase64, 'base64'));
        process.stdout.write('  floorplan ✓ ');
      }

      // Write metadata
      fs.writeFileSync(path.join(configDir, 'meta.json'), JSON.stringify({
        index: b.idx,
        label: b.label,
        area: Math.round(b.area),
        vertices: b.polygon.length,
        tags: b.tags,
      }, null, 2));

      console.log('');
    }

    console.log(`\nDone! ${projected.length * VIEWS.length} screenshots saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(e => {
  console.error('Capture failed:', e);
  process.exit(1);
});
