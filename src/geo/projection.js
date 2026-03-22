const METERS_PER_DEGREE_LAT = 111320;

let centerLat, centerLng, metersPerDegreeLng;

/** Initialize projection with a center point. Call once before project(). */
export function initProjection(lat, lng) {
  centerLat = lat;
  centerLng = lng;
  metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos(lat * Math.PI / 180);
}

/** Convert lat/lng to local game coordinates (meters from center). */
export function project(lat, lng) {
  return {
    x: (lng - centerLng) * metersPerDegreeLng,
    z: -(lat - centerLat) * METERS_PER_DEGREE_LAT, // -Z = north
  };
}

/** Get bounding box in lat/lng from center + radius in meters. */
export function getBbox(lat, lng, radiusMeters) {
  const dLat = radiusMeters / METERS_PER_DEGREE_LAT;
  const dLng = radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos(lat * Math.PI / 180));
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  };
}

/** Get the size of the bounding box in meters. */
export function bboxSizeMeters(bbox) {
  const width = (bbox.east - bbox.west) * (METERS_PER_DEGREE_LAT * Math.cos(((bbox.south + bbox.north) / 2) * Math.PI / 180));
  const height = (bbox.north - bbox.south) * METERS_PER_DEGREE_LAT;
  return { width, height };
}
