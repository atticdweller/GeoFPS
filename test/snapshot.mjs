/**
 * Single-shot capture — Claude's targeted debug tool.
 * Takes one screenshot of a specific building from a preset or custom camera angle.
 *
 * Usage:
 *   node test/snapshot.mjs --building residential-small-rect --view aerial
 *   node test/snapshot.mjs --building restaurant-medium --pos 3,1.6,5 --target 7,1,4
 *   node test/snapshot.mjs --building grocery-large-supermarket --view interior --out test-output/debug.png
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { building: null, view: null, pos: null, target: null, out: null, polygon: null, tags: null };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--building': result.building = args[++i]; break;
      case '--view': result.view = args[++i]; break;
      case '--pos': result.pos = args[++i].split(',').map(Number); break;
      case '--target': result.target = args[++i].split(',').map(Number); break;
      case '--out': result.out = args[++i]; break;
      case '--polygon': result.polygon = JSON.parse(fs.readFileSync(args[++i], 'utf-8')); break;
      case '--tags': result.tags = JSON.parse(args[++i]); break;
    }
  }

  if (!result.building && !result.polygon) {
    console.error('Usage:');
    console.error('  node test/snapshot.mjs --building <name> [--view <preset>] [--pos x,y,z --target x,y,z]');
    console.error('  node test/snapshot.mjs --polygon <file.json> --tags \'{"building":"yes"}\' [--view aerial]');
    process.exit(1);
  }

  // Default view if neither --view nor --pos specified
  if (!result.view && !result.pos) result.view = 'aerial';

  // Default output path
  if (!result.out) {
    const viewLabel = result.view || 'custom';
    result.out = path.join(ROOT, 'test-output', `${result.building}_${viewLabel}.png`);
  }

  return result;
}

async function main() {
  const args = parseArgs();

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(args.out), { recursive: true });

  // Start Vite dev server
  const server = await createServer({
    root: ROOT,
    server: { port: 5174, strictPort: false },
    logLevel: 'error',
  });
  await server.listen();
  const port = server.config.server.port;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader-webgl'],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('[page]', msg.text());
    });

    await page.goto(`http://localhost:${port}/test/building-test.html`, {
      waitUntil: 'load',
      timeout: 60000,
    });

    await page.waitForFunction(() => window.__testAPI !== undefined, { timeout: 15000 });

    // Load building
    if (args.polygon) {
      await page.evaluate((poly, tags) => window.__testAPI.loadCustomBuilding(poly, tags || { building: 'yes' }), args.polygon, args.tags);
    } else {
      await page.evaluate((name) => window.__testAPI.loadBuildingByName(name), args.building);
    }
    await new Promise(r => setTimeout(r, 100));

    // Position camera
    if (args.pos && args.target) {
      await page.evaluate(
        (p, t) => window.__testAPI.setCameraCustom(p[0], p[1], p[2], t[0], t[1], t[2]),
        args.pos, args.target
      );
    } else {
      await page.evaluate((v) => window.__testAPI.setCameraView(v), args.view);
    }

    // Capture
    const dataUrl = await page.evaluate(() => window.__testAPI.capture());
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(args.out, Buffer.from(base64, 'base64'));

    const info = await page.evaluate(() => window.__testAPI.getBuildingInfo());
    console.log(`Captured: ${args.building} (${info.type}, ${Math.round(info.area)}m², ${info.numFloors}F)`);
    console.log(`Camera: ${args.view || `pos=${args.pos} target=${args.target}`}`);
    console.log(`Saved: ${args.out}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(e => {
  console.error('Snapshot failed:', e);
  process.exit(1);
});
