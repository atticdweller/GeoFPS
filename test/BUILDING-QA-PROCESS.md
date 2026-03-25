# Building QA Process

Iterative loop for finding and fixing building generation issues using automated Claude agents.

## Prerequisites

```bash
npm install
```

## The Loop

### 1. Render buildings

Capture all 388 Brooklyn buildings from 7 camera angles (aerial, front, back, left, right, top, interior):

```bash
npm run test:brooklyn
```

Output: `test-output/brooklyn/{building-dir}/{view}.png` + `meta.json`

First run takes ~5 minutes. Re-renders everything each time.

### 2. Run QA agents

Spawn Claude agents to review the screenshots and write per-building feedback:

```bash
# Review 10 buildings, 10 agents in parallel (default)
node test/feedback-agent.mjs

# Custom batch size and concurrency
node test/feedback-agent.mjs --limit 20 --concurrency 10
```

Output: `test-output/brooklyn/{building-dir}/feedback.txt`

**Staleness handling:** Buildings are automatically skipped if their `feedback.txt` is newer than all their PNGs. After re-rendering (step 1), only buildings with updated images get re-reviewed. Buildings that errored are always retried.

### 3. Generate feedback report

```bash
npm run test:feedback-report
```

Opens `test-output/brooklyn/feedback-report.html` — shows issue frequency by category (ROOF, WALLS, WINDOWS, DOOR, INTERIOR, GEOMETRY, OVERALL), top issues ranked by count, and per-building details with thumbnails.

### 4. Fix code

Edit the building generation source based on the feedback:

- `src/world/buildings.js` — exterior walls, roof, windows, doors, physics
- `src/world/interiors.js` — interior layouts per building type
- `src/utils/materials.js` — material definitions
- `test/building-adapter.js` — standalone test adapter (mirror fixes here too)

### 5. Repeat

Go back to step 1. The staleness check means you only pay for re-reviewing buildings whose images actually changed.

## Quick Reference

| Command | What it does |
|---|---|
| `npm run test:brooklyn` | Render all 388 Brooklyn buildings (7 angles each) |
| `npm run test:brooklyn-report` | HTML gallery of all rendered buildings |
| `npm run test:feedback` | Run QA agents (default: 10 buildings, 10 parallel) |
| `npm run test:feedback-report` | Aggregate feedback into HTML report |
| `npm run test:buildings` | Render 16 test configs (not Brooklyn data) |
| `npm run test:report` | HTML gallery of test config buildings |

## Feedback format

Agents output one line per issue:

```
ROOF: No roof cap visible in aerial or top view
WALLS: Gap between wall sections on right side near back corner
DOOR: No door visible on front wall ground floor
```

Valid categories: `ROOF`, `WALLS`, `WINDOWS`, `DOOR`, `INTERIOR`, `GEOMETRY`, `OVERALL`, `NO_ISSUES`
