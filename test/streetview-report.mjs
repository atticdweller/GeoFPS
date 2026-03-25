/**
 * Generates an HTML report from street-view captures.
 * Scans test-output/streetview/ for PNGs and creates a gallery.
 *
 * Usage: node test/streetview-report.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'test-output', 'streetview');

function scan() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error('No test-output/streetview/ found. Run npm run test:streetview first.');
    process.exit(1);
  }

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).sort();
  return files.map(f => {
    const metaPath = path.join(OUT_DIR, f.replace('.png', '.json'));
    let meta = null;
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
    }
    return { file: f, meta };
  });
}

function generateHTML(photos) {
  const cards = photos.map(p => {
    const label = p.meta ? p.meta.label : p.file.replace('.png', '');
    const info = p.meta ? `${p.meta.area}m² · ${p.meta.height}m · ${p.meta.tags.building || 'building'}` : '';
    return `
      <div class="card" id="${p.file}">
        <img src="${p.file}" alt="${label}" loading="lazy" onclick="this.classList.toggle('zoomed')">
        <div class="info">
          <div class="label">${label}</div>
          <div class="meta">${info}</div>
        </div>
      </div>`;
  }).join('\n');

  const toc = photos.map(p => {
    const label = p.meta ? p.meta.label : p.file.replace('.png', '');
    return `<a href="#${p.file}">${label}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Street View QA Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 20px; }
    h1 { margin-bottom: 8px; }
    .summary { color: #888; margin-bottom: 20px; font-size: 0.9em; }
    .toc { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 30px; }
    .toc a { color: #6cf; font-size: 0.75em; text-decoration: none; padding: 2px 6px; background: #222; border-radius: 4px; }
    .toc a:hover { background: #333; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 12px; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
    .card img { width: 100%; display: block; cursor: pointer; }
    .card img.zoomed { transform: scale(1.8); z-index: 10; position: relative; }
    .info { padding: 8px 12px; }
    .label { font-weight: bold; font-size: 0.95em; }
    .meta { color: #888; font-size: 0.8em; margin-top: 2px; }
  </style>
</head>
<body>
  <h1>Street View QA Report</h1>
  <div class="summary">${photos.length} buildings &middot; Generated ${new Date().toLocaleString()}</div>
  <div class="toc">${toc}</div>
  <div class="grid">${cards}</div>
</body>
</html>`;
}

const photos = scan();
const html = generateHTML(photos);
const outPath = path.join(OUT_DIR, 'report.html');
fs.writeFileSync(outPath, html);
console.log(`Report generated: ${outPath} (${photos.length} buildings)`);
