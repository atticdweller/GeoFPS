/**
 * Fetch building footprints and road data from OpenStreetMap via Overpass API.
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Fetch both buildings and roads in a single Overpass query.
 * Retries each endpoint up to 2 times before trying the next.
 * @returns {{ buildings: Array, roads: Array }}
 */
export async function fetchOSMData(bbox) {
  const { south, west, north, east } = bbox;

  const query = `
    [out:json][timeout:30];
    (
      way["building"](${south},${west},${north},${east});
      way["highway"](${south},${west},${north},${east});
    );
    out body;>;out skel qt;
  `;

  const body = `data=${encodeURIComponent(query)}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  let lastError;
  for (const url of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        const res = await fetch(url, { method: 'POST', body, headers });
        if (res.ok) {
          const data = await res.json();
          return parseOSMResponse(data);
        }
        lastError = new Error(`Overpass API error: ${res.status} from ${url}`);
      } catch (e) {
        lastError = e;
      }
    }
  }

  throw lastError;
}

function parseOSMResponse(data) {
  // Build node lookup: id → {lat, lng}
  const nodes = {};
  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lng: el.lon };
    }
  }

  const buildings = [];
  const roads = [];

  for (const el of data.elements) {
    if (el.type !== 'way' || !el.tags) continue;

    if (el.tags.building) {
      // Building: closed polygon
      const polygon = [];
      let valid = true;
      for (const nodeId of el.nodes) {
        const node = nodes[nodeId];
        if (!node) { valid = false; break; }
        polygon.push(node);
      }
      if (valid && polygon.length >= 4) {
        // Remove last point if it duplicates first (closed way)
        const first = polygon[0];
        const last = polygon[polygon.length - 1];
        if (first.lat === last.lat && first.lng === last.lng) {
          polygon.pop();
        }
        buildings.push({ id: el.id, polygon, tags: el.tags });
      }
    } else if (el.tags.highway) {
      // Road: open polyline — do NOT remove the last node
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

  console.log(`Fetched ${buildings.length} buildings and ${roads.length} roads from Overpass`);
  return { buildings, roads };
}

/**
 * Backward-compatible wrapper — returns only buildings.
 */
export async function fetchBuildings(bbox) {
  const { buildings } = await fetchOSMData(bbox);
  return buildings;
}
