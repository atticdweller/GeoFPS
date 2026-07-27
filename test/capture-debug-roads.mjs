/**
 * Captures debug views of roads: top-down + a few street-level shots.
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-output', 'debug-roads');

async function main() {
  const server = await createServer({ root: ROOT, server: { port: 5176, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = server.config.server.port;
  console.log(`Vite on http://localhost:${port}`);

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--enable-webgl'],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log(`  [page] ${msg.text()}`));

    await page.goto(`http://localhost:${port}/test/debug-roads.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__debugAPI !== undefined, { timeout: 30000 });

    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Top-down view
    console.log('Capturing top-down...');
    const topDown = await page.evaluate(() => window.__debugAPI.captureTopDown());
    fs.writeFileSync(path.join(OUT_DIR, 'top-down.png'), Buffer.from(topDown.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('  top-down ✓');

    // Street-level views from road midpoints
    const roadPts = await page.evaluate(() => window.__debugAPI.getRoadPoints());
    console.log(`${roadPts.length} road midpoints available`);

    for (let i = 0; i < Math.min(10, roadPts.length); i++) {
      const pt = roadPts[i];
      const img = await page.evaluate((p) => window.__debugAPI.captureStreetLevel(p.x, p.z, p.lookX, p.lookZ), pt);
      fs.writeFileSync(path.join(OUT_DIR, `street-${i}-${pt.highway}.png`), Buffer.from(img.replace(/^data:image\/png;base64,/, ''), 'base64'));
      console.log(`  street-${i} (${pt.highway}) ✓`);
    }

    console.log(`\nDone! Saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
