/**
 * Runs Claude agents in parallel to review building screenshots.
 * Each agent analyzes 7 camera angles of a building and writes feedback.
 *
 * Usage:
 *   node test/feedback-agent.mjs                        # 10 buildings, 10 parallel
 *   node test/feedback-agent.mjs --limit 5              # 5 buildings
 *   node test/feedback-agent.mjs --limit 20 --concurrency 10
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BROOKLYN_DIR = path.join(ROOT, 'test-output', 'brooklyn');
const VIEWS = ['aerial', 'front', 'back', 'left', 'right', 'top', 'interior', 'floorplan'];

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : defaultVal;
}
const LIMIT = getArg('limit', 10);
const CONCURRENCY = getArg('concurrency', 10);

// Read source code once for prompt context
const buildingsCode = fs.readFileSync(path.join(ROOT, 'src/world/buildings.js'), 'utf-8');
const interiorsCode = fs.readFileSync(path.join(ROOT, 'src/world/interiors.js'), 'utf-8');

function classifyType(tags) {
  if (tags.shop === 'supermarket' || tags.shop === 'grocery' || tags.shop === 'convenience') return 'grocery';
  if (['restaurant', 'cafe', 'bar', 'fast_food', 'pub'].includes(tags.amenity)) return 'restaurant';
  if (tags.shop) return 'retail';
  if (tags.office) return 'office';
  if (['commercial', 'retail'].includes(tags.building)) return 'retail';
  if (['office'].includes(tags.building)) return 'office';
  return 'residential';
}

function getRelevantCode(type) {
  // Common: roof + exterior wall generation
  const commonLines = extractLines(buildingsCode, 120, 212);
  const windowLines = extractLines(buildingsCode, 342, 420);

  // Type-specific interior code
  let interiorLines;
  switch (type) {
    case 'grocery':    interiorLines = extractLines(interiorsCode, 58, 130); break;
    case 'restaurant': interiorLines = extractLines(interiorsCode, 58, 176); break;
    case 'retail':     interiorLines = extractLines(interiorsCode, 58, 210); break;
    case 'office':     interiorLines = extractLines(interiorsCode, 58, 286); break;
    default:           interiorLines = extractLines(interiorsCode, 58, 69) + '\n... (residential BSP layout)'; break;
  }

  return `=== buildings.js (exterior + roof) ===\n${commonLines}\n\n=== buildings.js (windows) ===\n${windowLines}\n\n=== interiors.js (${type} layout) ===\n${interiorLines}`;
}

function extractLines(code, start, end) {
  return code.split('\n').slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
}

function needsReview(buildingDir) {
  const feedbackPath = path.join(buildingDir, 'feedback.txt');
  if (!fs.existsSync(feedbackPath)) return true;

  const feedbackMtime = fs.statSync(feedbackPath).mtimeMs;
  for (const view of VIEWS) {
    const imgPath = path.join(buildingDir, `${view}.png`);
    if (fs.existsSync(imgPath) && fs.statSync(imgPath).mtimeMs > feedbackMtime) {
      return true; // image is newer than feedback
    }
  }
  return false;
}

function buildPrompt(meta, buildingDir, type, codeContext) {
  const imagePaths = VIEWS
    .map(v => path.join(buildingDir, `${v}.png`))
    .filter(p => fs.existsSync(p));

  const imageInstructions = imagePaths
    .map(p => `Read and analyze the image at: ${p}`)
    .join('\n');

  return `Building: ${meta.label} | Type: ${type} | Area: ${meta.area}m² | Vertices: ${meta.vertices}
Tags: ${JSON.stringify(meta.tags)}

${imageInstructions}

Check for: missing/misaligned roof cap, wall gaps or z-fighting, missing window glass, missing door, empty interiors or furniture clipping through walls, floating/misscaled geometry.

The floorplan image shows the 2D room layout with colored rooms and labels. Check that: rooms have sensible types for the building (e.g. residential should have living room, kitchen, bedrooms, bathroom), rooms fill the building footprint reasonably, room sizes make sense.

Source code context:
${codeContext}`;
}

function runAgent(buildingDir, meta) {
  const type = classifyType(meta.tags);
  const codeContext = getRelevantCode(type);
  const prompt = buildPrompt(meta, buildingDir, type, codeContext);

  const systemPrompt = `You are a defect-only QA reviewer for a 3D building generator. Output format rules:
- Report ONLY defects (broken, missing, wrong things)
- Each line: CATEGORY: description (view)
- Valid categories: ROOF, WALLS, WINDOWS, DOOR, INTERIOR, GEOMETRY, LAYOUT
- If zero defects found, output exactly: NO_ISSUES
- NEVER describe things that look correct
- NEVER write preamble, markdown, summaries, or per-view analysis
- Your response must contain ONLY defect lines or NO_ISSUES, nothing else`;

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
        fs.writeFileSync(path.join(buildingDir, 'feedback.txt'), stdout.trim());
        resolve({ label: meta.label, status: 'ok', feedback: stdout.trim() });
      } else {
        // Don't write feedback.txt on error — allows retry on next run
        const errMsg = stderr.trim() || `exit code ${code}`;
        resolve({ label: meta.label, status: 'error', feedback: `ERROR: ${errMsg}` });
      }
    });

    child.on('error', (err) => {
      resolve({ label: meta.label, status: 'error', feedback: `ERROR: ${err.message}` });
    });

    // Pipe prompt via stdin
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
      console.log(`[${i + 1}/${tasks.length}] Reviewing: ${task.meta.label} (${classifyType(task.meta.tags)})`);
      const result = await runAgent(task.dir, task.meta);
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
if (!fs.existsSync(BROOKLYN_DIR)) {
  console.error('No test-output/brooklyn/ found. Run npm run test:brooklyn first.');
  process.exit(1);
}

const entries = fs.readdirSync(BROOKLYN_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));

const tasks = [];
let skipped = 0;

for (const entry of entries) {
  const dir = path.join(BROOKLYN_DIR, entry.name);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) continue;

  if (!needsReview(dir)) {
    skipped++;
    continue;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  tasks.push({ dir, meta });

  if (tasks.length >= LIMIT) break;
}

console.log(`Found ${tasks.length} buildings to review (${skipped} skipped as up-to-date)`);
console.log(`Running ${Math.min(CONCURRENCY, tasks.length)} agents in parallel\n`);

if (tasks.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const results = await runBatch(tasks, CONCURRENCY);

const ok = results.filter(r => r.status === 'ok').length;
const errors = results.filter(r => r.status === 'error').length;
console.log(`\nDone! ${ok} reviewed, ${errors} errors, ${skipped} skipped`);
