/**
 * Fetch elevation data for a bounding box.
 * Returns { grid: Float32Array[], width, height, minElev, maxElev }
 * where grid[row][col] is elevation in meters.
 */
export async function fetchElevation(bbox, resolution = 32) {
  const { south, west, north, east } = bbox;
  const rows = resolution;
  const cols = resolution;

  // Build grid of sample points
  const locations = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = south + (north - south) * (r / (rows - 1));
      const lng = west + (east - west) * (c / (cols - 1));
      locations.push({ lat, lng });
    }
  }

  // Batch requests to Open Topo Data (max 100 per request)
  const BATCH_SIZE = 100;
  const elevations = new Array(locations.length).fill(0);
  let fetched = 0;

  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);
    const locStr = batch.map(l => `${l.lat},${l.lng}`).join('|');

    try {
      const res = await fetch(
        `https://api.opentopodata.org/v1/srtm30m?locations=${locStr}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.results) {
          for (let j = 0; j < data.results.length; j++) {
            elevations[i + j] = data.results[j].elevation ?? 0;
          }
          fetched += data.results.length;
        }
      }
    } catch (e) {
      console.warn('Elevation fetch failed for batch, using flat:', e.message);
    }

    // Rate limit: 1 request per second for open topo data
    if (i + BATCH_SIZE < locations.length) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  console.log(`Fetched ${fetched}/${locations.length} elevation points`);

  // Build 2D grid
  const grid = [];
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let r = 0; r < rows; r++) {
    const row = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      const elev = elevations[r * cols + c];
      row[c] = elev;
      if (elev < minElev) minElev = elev;
      if (elev > maxElev) maxElev = elev;
    }
    grid.push(row);
  }

  return { grid, width: cols, height: rows, minElev, maxElev };
}
