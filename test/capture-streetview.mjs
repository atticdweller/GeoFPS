/**
 * Capture street-view photos of every building in the Brooklyn dataset.
 * Renders the FULL scene (terrain + streets + buildings + furniture)
 * and photographs each building from across the street.
 *
 * Usage: node test/capture-streetview.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-output', 'streetview');

async function main() {
  console.log('Starting Vite dev server...');
  const server = await createServer({
    root: ROOT,
    server: { port: 5175, strictPort: false },
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
      const text = msg.text();
      if (msg.type() === 'error') console.error('  [page]', text);
      else if (text.startsWith('Loaded:') || text.startsWith('Scene ready') || text.startsWith('Generating') || text.startsWith('Placing') || text.startsWith('Street debug') || text.startsWith('Generated')) {
        console.log('  [page]', text);
      }
    });

    console.log('Loading full Brooklyn scene (this may take a moment)...');
    await page.goto(`http://localhost:${port}/test/streetview-test.html`, {
      waitUntil: 'load',
      timeout: 120000,
    });

    // Wait for the scene to fully initialize
    await page.waitForFunction(() => window.__streetAPI !== undefined, { timeout: 120000 });
    console.log('Scene loaded!\n');

    const count = await page.evaluate(() => window.__streetAPI.getBuildingCount());
    console.log(`${count} buildings to photograph\n`);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (let i = 0; i < count; i++) {
      const info = await page.evaluate((idx) => window.__streetAPI.getBuildingInfo(idx), i);
      const safeName = `${i}-${(info.label || 'building').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}`;

      // Position camera across the street
      await page.evaluate((idx) => window.__streetAPI.setCameraForBuilding(idx), i);

      // Capture
      const dataUrl = await page.evaluate(() => window.__streetAPI.capture());
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const filePath = path.join(OUT_DIR, `${safeName}.png`);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

      // Also write meta
      fs.writeFileSync(path.join(OUT_DIR, `${safeName}.json`), JSON.stringify({
        index: i,
        label: info.label,
        area: info.area,
        height: info.height,
        tags: info.tags,
      }, null, 2));

      const type = info.tags.building || 'unknown';
      console.log(`[${i + 1}/${count}] ${info.label} (${type}, ${info.area}m²) ✓`);
    }

    console.log(`\nDone! ${count} street-view photos saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(e => {
  console.error('Capture failed:', e);
  process.exit(1);
});
