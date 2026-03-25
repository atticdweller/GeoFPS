/**
 * Aggregates building feedback into an HTML report.
 * Reads feedback.txt files from test-output/brooklyn/ and generates
 * test-output/brooklyn/feedback-report.html
 *
 * Usage: node test/feedback-report.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROOKLYN_DIR = path.join(__dirname, '..', 'test-output', 'brooklyn');
const VALID_CATEGORIES = new Set(['ROOF', 'WALLS', 'WINDOWS', 'DOOR', 'INTERIOR', 'GEOMETRY', 'LAYOUT', 'OVERALL', 'NO_ISSUES']);

function scanFeedback() {
  const entries = fs.readdirSync(BROOKLYN_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const buildings = [];

  for (const entry of entries) {
    const dir = path.join(BROOKLYN_DIR, entry.name);
    const feedbackPath = path.join(dir, 'feedback.txt');
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(feedbackPath) || !fs.existsSync(metaPath)) continue;

    const feedback = fs.readFileSync(feedbackPath, 'utf-8').trim();
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    // Parse feedback into categorized issues
    const issues = [];
    for (const line of feedback.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'NO_ISSUES') {
        issues.push({ category: 'NO_ISSUES', text: 'Building looks correct' });
        continue;
      }
      const match = trimmed.match(/^([A-Z_]+):\s*(.+)/);
      if (match && VALID_CATEGORIES.has(match[1])) {
        issues.push({ category: match[1], text: match[2] });
      }
    }

    buildings.push({ name: entry.name, meta, feedback, issues });
  }

  return buildings;
}

function generateReport(buildings) {
  // Aggregate stats
  const catCounts = {};
  const catIssues = {};
  let noIssueCount = 0;

  for (const b of buildings) {
    const cats = new Set(b.issues.map(i => i.category));
    if (cats.has('NO_ISSUES')) { noIssueCount++; continue; }
    for (const issue of b.issues) {
      if (issue.category === 'NO_ISSUES') continue;
      catCounts[issue.category] = (catCounts[issue.category] || 0) + 1;
      if (!catIssues[issue.category]) catIssues[issue.category] = [];
      catIssues[issue.category].push({ label: b.meta.label, text: issue.text, dirName: b.name });
    }
  }

  // Sort categories by frequency
  const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

  // Summary section
  const summaryRows = sortedCats.map(([cat, count]) => {
    const pct = Math.round(count / buildings.length * 100);
    return `<tr><td>${cat}</td><td>${count}</td><td>${pct}%</td></tr>`;
  }).join('');

  // Category detail sections
  const categoryDetails = sortedCats.map(([cat, count]) => {
    const issues = catIssues[cat].slice(0, 20); // show top 20 per category
    const issueRows = issues.map(i => {
      const aerialImg = `${i.dirName}/aerial.png`;
      const frontImg = `${i.dirName}/front.png`;
      return `
        <div class="issue-row">
          <div class="issue-images">
            <img src="${aerialImg}" loading="lazy" onclick="this.classList.toggle('zoomed')">
            <img src="${frontImg}" loading="lazy" onclick="this.classList.toggle('zoomed')">
          </div>
          <div class="issue-text"><strong>${i.label}</strong>: ${escapeHtml(i.text)}</div>
        </div>`;
    }).join('');

    const remaining = catIssues[cat].length - 20;
    const moreNote = remaining > 0 ? `<p class="more">...and ${remaining} more</p>` : '';

    return `
      <div class="category-section" id="cat-${cat}">
        <h2>${cat} <span class="count">(${count} issues across ${buildings.length} buildings)</span></h2>
        ${issueRows}
        ${moreNote}
      </div>`;
  }).join('\n');

  // Per-building details
  const buildingDetails = buildings.map(b => {
    const feedbackHtml = escapeHtml(b.feedback).replace(/\n/g, '<br>');
    const imgs = ['aerial', 'front', 'top'].map(v => {
      const imgPath = `${b.name}/${v}.png`;
      return `<img src="${imgPath}" loading="lazy" onclick="this.classList.toggle('zoomed')">`;
    }).join('');

    return `
      <div class="building-detail" id="${b.name}">
        <h3>${b.meta.label} <span class="type-badge">${b.meta.tags.building || 'unknown'}</span></h3>
        <div class="detail-grid">
          <div class="detail-images">${imgs}</div>
          <div class="detail-feedback">${feedbackHtml}</div>
        </div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Building QA Feedback Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 20px; }
    h1 { margin-bottom: 8px; }
    h2 { margin-bottom: 12px; color: #fff; }
    h3 { margin-bottom: 8px; }
    .summary-meta { color: #888; margin-bottom: 24px; }
    .stats { margin-bottom: 30px; }
    .stats table { border-collapse: collapse; width: 100%; max-width: 500px; }
    .stats th, .stats td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; }
    .stats th { color: #aaa; }
    .stats td:first-child { font-weight: bold; color: #f90; }
    .no-issues { color: #4c4; margin-bottom: 20px; }
    .category-section { margin-bottom: 40px; border: 1px solid #333; border-radius: 8px; padding: 16px; background: #1a1a1a; }
    .count { font-size: 0.7em; color: #888; font-weight: normal; }
    .issue-row { display: flex; gap: 12px; margin-bottom: 12px; padding: 8px; background: #222; border-radius: 6px; align-items: center; }
    .issue-images { display: flex; gap: 4px; flex-shrink: 0; }
    .issue-images img { width: 120px; height: 68px; object-fit: cover; border-radius: 4px; cursor: pointer; }
    .issue-images img.zoomed { width: 400px; height: auto; z-index: 10; position: relative; }
    .issue-text { font-size: 0.9em; color: #ccc; }
    .more { color: #666; font-size: 0.85em; margin-top: 8px; }
    .type-badge { font-size: 0.7em; color: #888; background: #333; padding: 2px 8px; border-radius: 4px; }
    .building-detail { margin-bottom: 24px; border: 1px solid #333; border-radius: 8px; padding: 12px; background: #1a1a1a; }
    .detail-grid { display: flex; gap: 16px; }
    .detail-images { display: flex; gap: 4px; flex-shrink: 0; }
    .detail-images img { width: 160px; border-radius: 4px; cursor: pointer; }
    .detail-images img.zoomed { width: 400px; z-index: 10; position: relative; }
    .detail-feedback { font-size: 0.85em; color: #ccc; line-height: 1.6; }
    .section-title { margin: 30px 0 16px; font-size: 1.3em; color: #6cf; border-bottom: 1px solid #333; padding-bottom: 8px; }
  </style>
</head>
<body>
  <h1>Building QA Feedback Report</h1>
  <div class="summary-meta">${buildings.length} buildings reviewed &middot; Generated ${new Date().toLocaleString()}</div>

  <div class="no-issues">${noIssueCount} building(s) with no issues</div>

  <div class="stats">
    <h2>Issue Frequency</h2>
    <table>
      <tr><th>Category</th><th>Count</th><th>% of Buildings</th></tr>
      ${summaryRows}
    </table>
  </div>

  <div class="section-title">Issues by Category</div>
  ${categoryDetails}

  <div class="section-title">All Buildings</div>
  ${buildingDetails}
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Main
const buildings = scanFeedback();
if (buildings.length === 0) {
  console.error('No feedback files found. Run npm run test:feedback first.');
  process.exit(1);
}

const html = generateReport(buildings);
const outPath = path.join(BROOKLYN_DIR, 'feedback-report.html');
fs.writeFileSync(outPath, html);
console.log(`Feedback report generated: ${outPath} (${buildings.length} buildings)`);
