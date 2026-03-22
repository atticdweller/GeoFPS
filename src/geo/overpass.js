/**
 * Fetch building footprints and road data from OpenStreetMap via Overpass API.
 */

/**
 * Fetch both buildings and roads in a single Overpass query.
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

  const url = 'https://overpass-api.de/api/interpreter';
  const res = await fetch(url, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const data = await res.json();

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
