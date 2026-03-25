/**
 * Batch capture — renders all building configs × all camera views.
 * Saves PNGs to test-output/{config-name}/{view}.png
 *
 * Usage: node test/capture.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-output');

async function main() {
  // Start Vite dev server
  console.log('Starting Vite dev server...');
  const server = await createServer({
    root: ROOT,
    server: { port: 5174, strictPort: true },
    logLevel: 'error',
  });
  await server.listen();
  console.log('Vite server running on http://localhost:5174');

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('  [page]', msg.text());
    });

    // Wait a moment for Vite to fully initialize
    await new Promise(r => setTimeout(r, 2000));

    await page.goto('http://localhost:5174/test/building-test.html', {
      waitUntil: 'load',
      timeout: 60000,
    });

    // Wait for test API
    await page.waitForFunction(() => window.__testAPI !== undefined, { timeout: 15000 });
    console.log('Test page loaded, API ready.');

    // Get configs and views
    const configNames = await page.evaluate(() => window.__testAPI.getConfigs());
    const views = await page.evaluate(() => window.__testAPI.getCameraViews());

    console.log(`Capturing ${configNames.length} buildings × ${views.length} views = ${configNames.length * views.length} screenshots\n`);

    for (let i = 0; i < configNames.length; i++) {
      const configName = configNames[i];
      const configDir = path.join(OUT_DIR, configName);
      fs.mkdirSync(configDir, { recursive: true });

      // Load building
      await page.evaluate((idx) => window.__testAPI.loadBuilding(idx), i);
      // Small delay for geometry to settle
      await new Promise(r => setTimeout(r, 100));

      const info = await page.evaluate(() => window.__testAPI.getBuildingInfo());
      console.log(`[${i + 1}/${configNames.length}] ${configName} (${info.type}, ${Math.round(info.area)}m², ${info.numFloors}F)`);

      for (const view of views) {
        await page.evaluate((v) => {
          window.__testAPI.setCameraView(v);
          window.__testAPI.render();
        }, view);

        // Capture via toDataURL (canvas only, no DOM overlay)
        const dataUrl = await page.evaluate(() => window.__testAPI.capture());
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const filePath = path.join(configDir, `${view}.png`);
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

        process.stdout.write(`  ${view} ✓  `);
      }
      console.log('');
    }

    console.log(`\nDone! ${configNames.length * views.length} screenshots saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(e => {
  console.error('Capture failed:', e);
  process.exit(1);
});
