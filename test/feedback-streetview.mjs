/**
 * Runs Claude agents to review street-view photos of buildings.
 * Each agent analyzes one street-view image and writes feedback.
 *
 * Usage:
 *   node test/feedback-streetview.mjs --limit 10 --concurrency 10
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SV_DIR = path.join(ROOT, 'test-output', 'streetview');

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : defaultVal;
}
const LIMIT = getArg('limit', 10);
const CONCURRENCY = getArg('concurrency', 10);

// Read source code for context
const buildingsCode = fs.readFileSync(path.join(ROOT, 'src/world/buildings.js'), 'utf-8');
const streetsCode = fs.readFileSync(path.join(ROOT, 'src/world/streets.js'), 'utf-8');

function extractLines(code, start, end) {
  return code.split('\n').slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
}

function getCodeContext() {
  const streetSnippet = extractLines(streetsCode, 1, 60);
  const buildingSnippet = extractLines(buildingsCode, 120, 200);
  return `=== streets.js (road generation) ===\n${streetSnippet}\n\n=== buildings.js (exterior) ===\n${buildingSnippet}`;
}

function needsReview(pngPath) {
  const feedbackPath = pngPath.replace('.png', '.feedback.txt');
  if (!fs.existsSync(feedbackPath)) return true;
  const fbMtime = fs.statSync(feedbackPath).mtimeMs;
  const imgMtime = fs.statSync(pngPath).mtimeMs;
  return imgMtime > fbMtime;
}

function buildPrompt(meta, imagePath, codeContext) {
  return `Building: ${meta.label} | Area: ${meta.area}m² | Height: ${meta.height}m
Tags: ${JSON.stringify(meta.tags)}

Read and analyze the image at: ${imagePath}

This is a street-view photo taken from across the street in a full Brooklyn neighborhood scene with terrain, streets, sidewalks, and buildings all rendered together. Evaluate what you see:

Check for:
- CAMERA: Is the building fully in frame? Can you see the full facade? Is the camera too close, too far, or at a bad angle?
- STREET: Is there a visible road/asphalt surface? Sidewalks with curbs? Lane markings? Or is the ground just flat grass/terrain?
- DOOR: Is there a visible door on the ground floor facing the street? Is it at the right height?
- WALLS: Are the building walls complete? Any gaps, z-fighting, or overlapping with neighboring buildings?
- WINDOWS: Are glass panes visible? Regular spacing?
- ROOF: Is the roof visible and properly capping the building?
- NEIGHBORS: Are adjacent buildings overlapping, clipping into each other, or floating?
- FURNITURE: Are street elements visible (lamp posts, hydrants, etc)?
- OVERALL: Does this look like a plausible street scene?

Source code context:
${codeContext}`;
}

const systemPrompt = `You are a defect-only QA reviewer for a 3D city generator. Output format rules:
- Report ONLY defects (broken, missing, wrong things)
- Each line: CATEGORY: description
- Valid categories: CAMERA, STREET, DOOR, WALLS, WINDOWS, ROOF, NEIGHBORS, FURNITURE, OVERALL
- If zero defects found, output exactly: NO_ISSUES
- NEVER describe things that look correct
- NEVER write preamble, markdown, summaries, or per-element analysis
- Your response must contain ONLY defect lines or NO_ISSUES, nothing else`;

function runAgent(pngPath, meta) {
  const codeContext = getCodeContext();
  const prompt = buildPrompt(meta, pngPath, codeContext);
  const feedbackPath = pngPath.replace('.png', '.feedback.txt');

  return new Promise((resolve) => {
    const child = spawn('claude', [
      '-p',
      '--model', 'haiku',
      '--output-format', 'text',
      '--system-prompt', systemPrompt,
      '--allowedTools', 'Read',
      '--max-budget-usd', '0.05',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        fs.writeFileSync(feedbackPath, stdout.trim());
        resolve({ label: meta.label, status: 'ok', feedback: stdout.trim() });
      } else {
        resolve({ label: meta.label, status: 'error', feedback: `ERROR: ${stderr.trim() || `exit ${code}`}` });
      }
    });

    child.on('error', (err) => {
      resolve({ label: meta.label, status: 'error', feedback: `ERROR: ${err.message}` });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runBatch(tasks, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      const task = tasks[i];
      console.log(`[${i + 1}/${tasks.length}] Reviewing: ${task.meta.label}`);
      const result = await runAgent(task.pngPath, task.meta);
      const preview = result.feedback.split('\n')[0].substring(0, 80);
      console.log(`  → ${result.status === 'ok' ? '✓' : '✗'} ${preview}`);
      results.push(result);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Main
if (!fs.existsSync(SV_DIR)) {
  console.error('No test-output/streetview/ found. Run npm run test:streetview first.');
  process.exit(1);
}

const pngs = fs.readdirSync(SV_DIR).filter(f => f.endsWith('.png')).sort();
const tasks = [];
let skipped = 0;

for (const png of pngs) {
  const pngPath = path.join(SV_DIR, png);
  const metaPath = path.join(SV_DIR, png.replace('.png', '.json'));
  if (!fs.existsSync(metaPath)) continue;

  if (!needsReview(pngPath)) {
    skipped++;
    continue;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  tasks.push({ pngPath, meta });

  if (tasks.length >= LIMIT) break;
}

console.log(`Found ${tasks.length} photos to review (${skipped} skipped as up-to-date)`);
console.log(`Running ${Math.min(CONCURRENCY, tasks.length)} agents in parallel\n`);

if (tasks.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const results = await runBatch(tasks, CONCURRENCY);
const ok = results.filter(r => r.status === 'ok').length;
const errors = results.filter(r => r.status === 'error').length;
console.log(`\nDone! ${ok} reviewed, ${errors} errors, ${skipped} skipped`);
