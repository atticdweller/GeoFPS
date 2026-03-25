/**
 * Generates an HTML report from captured building screenshots.
 * Scans a directory for building subdirs with PNGs and creates report.html
 *
 * Usage:
 *   node test/report.mjs                  # scans test-output/
 *   node test/report.mjs --dir brooklyn   # scans test-output/brooklyn/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_OUT = path.join(__dirname, '..', 'test-output');
const VIEWS = ['front', 'right', 'back', 'left', 'aerial', 'top', 'interior', 'floorplan'];

// Parse --dir arg
const dirArg = process.argv.indexOf('--dir');
const subDir = dirArg !== -1 ? process.argv[dirArg + 1] : null;
const OUT_DIR = subDir ? path.join(BASE_OUT, subDir) : BASE_OUT;

function scanBuildings() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`No ${OUT_DIR} directory found. Run the capture script first.`);
    process.exit(1);
  }

  const entries = fs.readdirSync(OUT_DIR, { withFileTypes: true });
  const buildings = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(OUT_DIR, entry.name);
    const images = {};
    let meta = null;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.png')) {
        const view = file.replace('.png', '');
        images[view] = `${entry.name}/${file}`;
      }
      if (file === 'meta.json') {
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch {}
      }
    }
    if (Object.keys(images).length > 0) {
      buildings.push({ name: entry.name, images, meta });
    }
  }

  return buildings.sort((a, b) => a.name.localeCompare(b.name));
}

function generateHTML(buildings, title) {
  const buildingSections = buildings.map(b => {
    const imageCards = VIEWS.map(view => {
      if (b.images[view]) {
        return `
          <div class="card">
            <img src="${b.images[view]}" alt="${b.name} ${view}" loading="lazy" onclick="this.classList.toggle('zoomed')">
            <div class="label">${view}</div>
          </div>`;
      }
      return `
          <div class="card missing">
            <div class="placeholder">No ${view} image</div>
            <div class="label">${view}</div>
          </div>`;
    }).join('');

    const metaLine = b.meta
      ? `<div class="building-meta">${b.meta.label} &mdash; ${b.meta.area}m&sup2; &middot; ${b.meta.vertices} vertices &middot; ${Object.entries(b.meta.tags).map(([k,v]) => `${k}=${v}`).join(', ')}</div>`
      : '';

    return `
      <div class="building" id="${b.name}">
        <h2>${b.meta ? b.meta.label : b.name}</h2>
        ${metaLine}
        <div class="grid">${imageCards}
        </div>
      </div>`;
  }).join('\n');

  const tocLinks = buildings.map(b =>
    `<a href="#${b.name}">${b.meta ? b.meta.label : b.name}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #111; color: #eee; padding: 20px; }
    h1 { margin-bottom: 8px; font-size: 1.6em; }
    .summary { color: #888; margin-bottom: 20px; font-size: 0.9em; }
    .toc { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 30px; }
    .toc a { color: #6cf; font-size: 0.8em; text-decoration: none; padding: 3px 8px; background: #222; border-radius: 4px; }
    .toc a:hover { background: #333; }
    .building { margin-bottom: 40px; border: 1px solid #333; border-radius: 8px; padding: 16px; background: #1a1a1a; }
    .building h2 { font-size: 1.2em; margin-bottom: 4px; color: #fff; }
    .building-meta { font-size: 0.8em; color: #888; margin-bottom: 12px; word-break: break-all; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
    .card { background: #222; border-radius: 6px; overflow: hidden; }
    .card img { width: 100%; display: block; cursor: pointer; transition: transform 0.2s; }
    .card img.zoomed { transform: scale(2); z-index: 10; position: relative; }
    .card .label { padding: 4px 8px; font-size: 0.8em; color: #aaa; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
    .card.missing { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 120px; }
    .card .placeholder { color: #555; font-size: 0.85em; padding: 40px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="summary">${buildings.length} buildings &middot; ${VIEWS.length} views each &middot; Generated ${new Date().toLocaleString()}</div>
  <div class="toc">${tocLinks}</div>
  ${buildingSections}
</body>
</html>`;
}

const buildings = scanBuildings();
const title = subDir
  ? `Brooklyn Buildings QA Report (${buildings.length} buildings)`
  : `Building Generation QA Report`;
const html = generateHTML(buildings, title);
const outPath = path.join(OUT_DIR, 'report.html');
fs.writeFileSync(outPath, html);
console.log(`Report generated: ${outPath} (${buildings.length} buildings)`);
