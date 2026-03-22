/**
 * Fetch and cache OSM + elevation data from the default Brooklyn location.
 * Saves to test/default-location-data.json for reuse in testing.
 */

// Default location from src/geo/picker.js
const DEFAULT_LAT = 40.6370;
const DEFAULT_LNG = -73.9474;
const RADIUS = 200; // meters, same as main.js

// Replicate getBbox from projection.js
const METERS_PER_DEG_LAT = 111320;
const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(DEFAULT_LAT * Math.PI / 180);

const bbox = {
  south: DEFAULT_LAT - RADIUS / METERS_PER_DEG_LAT,
  north: DEFAULT_LAT + RADIUS / METERS_PER_DEG_LAT,
  west: DEFAULT_LNG - RADIUS / metersPerDegLng,
  east: DEFAULT_LNG + RADIUS / metersPerDegLng,
};

console.log('Bounding box:', bbox);
console.log(`Center: ${DEFAULT_LAT}, ${DEFAULT_LNG}, radius: ${RADIUS}m\n`);

// Fetch OSM data (buildings + roads)
const query = `
  [out:json][timeout:30];
  (
    way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  );
  out body;>;out skel qt;
`;

console.log('Fetching OSM data from Overpass API...');
const osmRes = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: `data=${encodeURIComponent(query)}`,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

if (!osmRes.ok) throw new Error(`Overpass API error: ${osmRes.status}`);
const osmRaw = await osmRes.json();

// Parse into buildings and roads (same logic as overpass.js)
const nodes = {};
for (const el of osmRaw.elements) {
  if (el.type === 'node') nodes[el.id] = { lat: el.lat, lng: el.lon };
}

const buildings = [];
const roads = [];

for (const el of osmRaw.elements) {
  if (el.type !== 'way' || !el.tags) continue;

  if (el.tags.building) {
    const polygon = [];
    let valid = true;
    for (const nodeId of el.nodes) {
      const node = nodes[nodeId];
      if (!node) { valid = false; break; }
      polygon.push(node);
    }
    if (valid && polygon.length >= 4) {
      const first = polygon[0];
      const last = polygon[polygon.length - 1];
      if (first.lat === last.lat && first.lng === last.lng) polygon.pop();
      buildings.push({ id: el.id, polygon, tags: el.tags });
    }
  } else if (el.tags.highway) {
    const lineNodes = [];
    let valid = true;
    for (const nodeId of el.nodes) {
      const node = nodes[nodeId];
      if (!node) { valid = false; break; }
      lineNodes.push({ ...node, id: nodeId });
    }
    if (valid && lineNodes.length >= 2) {
      roads.push({ id: el.id, nodes: lineNodes, tags: el.tags });
    }
  }
}

console.log(`Parsed: ${buildings.length} buildings, ${roads.length} roads`);

// Print some building tag stats
const tagCounts = {};
for (const b of buildings) {
  const type = b.tags.building || 'unknown';
  tagCounts[type] = (tagCounts[type] || 0) + 1;
  if (b.tags.shop) tagCounts[`shop:${b.tags.shop}`] = (tagCounts[`shop:${b.tags.shop}`] || 0) + 1;
  if (b.tags.amenity) tagCounts[`amenity:${b.tags.amenity}`] = (tagCounts[`amenity:${b.tags.amenity}`] || 0) + 1;
}
console.log('\nBuilding type breakdown:', tagCounts);

// Road type breakdown
const roadTypes = {};
for (const r of roads) {
  const type = r.tags.highway;
  roadTypes[type] = (roadTypes[type] || 0) + 1;
}
console.log('Road type breakdown:', roadTypes);

// Save to file
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, 'default-location-data.json');

const data = {
  location: { lat: DEFAULT_LAT, lng: DEFAULT_LNG, radius: RADIUS },
  bbox,
  buildings,
  roads,
  fetchedAt: new Date().toISOString(),
};

writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`\nSaved to ${outPath} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
