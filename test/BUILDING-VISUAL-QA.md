# Building Generation Visual QA Process

This project includes a self-serve visual testing system for building generation. Claude can render any building type, take screenshots from arbitrary angles, review them, fix the code, and re-render — without human involvement.

## Tools

| Script | Purpose | Example |
|--------|---------|---------|
| `npm run test:buildings` | Batch capture: all 16 configs × 7 angles = 112 PNGs | `npm run test:buildings` |
| `node test/snapshot.mjs` | Single-shot: one building, one angle | See below |
| `/test/building-test.html` | Manual inspection in browser with OrbitControls | `npm run dev` → open `/test/building-test.html` |

## Snapshot CLI

```bash
# Preset camera angle
node test/snapshot.mjs --building <name> --view <preset>

# Custom camera position + look-at target
node test/snapshot.mjs --building <name> --pos x,y,z --target x,y,z

# Custom output path
node test/snapshot.mjs --building <name> --view aerial --out test-output/my-shot.png
```

**Preset views:** `front`, `right`, `back`, `left`, `aerial`, `top`, `interior`

**Building names:** `residential-small-rect`, `residential-medium-rect`, `residential-apartments`, `residential-l-shape`, `residential-tiny`, `grocery-small-convenience`, `grocery-large-supermarket`, `restaurant-small-cafe`, `restaurant-medium`, `retail-small-shop`, `retail-large`, `office-small`, `office-large`, `irregular-pentagon`, `narrow-building`, `tall-5-floor`

## Debug Loop

The intended workflow for iterating on building generation:

### 1. Initial sweep

Run the batch capture to get a baseline of all building types:

```bash
npm run test:buildings
```

This saves 112 PNGs to `test-output/{building-name}/{view}.png`.

### 2. Review

Read screenshots to evaluate each building. Check for:

- **Exterior walls** — gaps, z-fighting, missing faces, correct color (beige for residential, gray for commercial)
- **Door** — visible on the correct wall, brown panel, step in front, walkable opening
- **Windows** — correct intervals per floor, glass pane + dark frame visible, not clipping roof or floor
- **Interior** — matches building type (shelves in grocery, tables in restaurant, desks in office, beds in bedrooms)
- **Geometry** — floating objects, clipping, wrong scale, missing caps

### 3. Targeted investigation

When an issue is spotted, take a closer look with custom camera angles:

```bash
# Look at the kitchen area of a restaurant from inside
node test/snapshot.mjs --building restaurant-medium --pos 0,1.6,3 --target 0,1.6,-3

# Check if 3rd-floor windows clip the roof on a tall building
node test/snapshot.mjs --building tall-5-floor --pos 15,14,0 --target 0,14,0

# Bird's-eye view of grocery shelving layout
node test/snapshot.mjs --building grocery-large-supermarket --pos 0,8,0 --target 0,0,0.01
```

Then read the output PNG to inspect the problem.

### 4. Fix

Edit the generation code:

- **Exterior walls/doors/windows:** `src/world/buildings.js`
- **Interior layouts/furniture:** `src/world/interiors.js`
- **Materials/colors:** `src/utils/materials.js`
- **Test adapter (if adding new geometry):** `test/building-adapter.js`

### 5. Verify

Re-capture just the affected building to confirm the fix:

```bash
node test/snapshot.mjs --building grocery-large-supermarket --view aerial
node test/snapshot.mjs --building grocery-large-supermarket --view interior
```

### 6. Regression check

Once satisfied, re-run the full batch to make sure nothing else broke:

```bash
npm run test:buildings
```

## Test Scene API

The test page exposes `window.__testAPI` for programmatic control:

```js
__testAPI.getConfigs()                            // → ['residential-small-rect', ...]
__testAPI.getCameraViews()                        // → ['front', 'right', ...]
__testAPI.loadBuilding(index)                     // load by index
__testAPI.loadBuildingByName('grocery-large-supermarket')  // load by name
__testAPI.setCameraView('aerial')                 // preset angle
__testAPI.setCameraCustom(px, py, pz, tx, ty, tz) // arbitrary camera
__testAPI.capture()                               // render + return PNG data URL
__testAPI.getBuildingInfo()                        // → { name, type, area, height, numFloors, ... }
```

## File Layout

```
test/
  building-test.html      # Standalone Three.js test page
  building-test.js         # Scene setup, camera, __testAPI
  building-configs.js      # 16 building type/size configs
  building-adapter.js      # Builds one building mesh (decoupled from game)
  capture.mjs              # Batch: all buildings × all angles
  snapshot.mjs             # Single-shot with CLI args
  PROCESS.md               # This file
test-output/               # Generated screenshots (gitignored)
```

## Adding a New Building Config

1. Add an entry to `test/building-configs.js` with `name`, `polygon`, `tags`, and `description`
2. Run `node test/snapshot.mjs --building <new-name> --view aerial` to verify it renders
3. Run `npm run test:buildings` to include it in the full batch
