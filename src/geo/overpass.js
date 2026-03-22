/**
 * Fetch building footprints from OpenStreetMap via Overpass API.
 * Returns array of { id, polygon: [{lat, lng}], tags: {...} }
 */
export async function fetchBuildings(bbox) {
  const { south, west, north, east } = bbox;

  const query = `
    [out:json][timeout:30];
    (
      way["building"](${south},${west},${north},${east});
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

  // Extract building ways
  const buildings = [];
  for (const el of data.elements) {
    if (el.type === 'way' && el.tags && el.tags.building) {
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
        buildings.push({
          id: el.id,
          polygon,
          tags: el.tags,
        });
      }
    }
  }

  console.log(`Fetched ${buildings.length} buildings from Overpass`);
  return buildings;
}
