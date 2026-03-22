/**
 * Test building configurations — representative shapes/sizes for each building type.
 * Polygons are in local meter coords (x = east, z = north), centered roughly at origin.
 */
export const configs = [
  // ── Residential ──

  {
    name: 'residential-small-rect',
    description: 'Small rectangular rowhouse, 2 floors',
    polygon: [
      { x: -3, z: -7.5 }, { x: 3, z: -7.5 },
      { x: 3, z: 7.5 },   { x: -3, z: 7.5 },
    ],
    tags: { building: 'house' },
  },
  {
    name: 'residential-medium-rect',
    description: 'Medium detached house, 2 floors',
    polygon: [
      { x: -5, z: -6 }, { x: 5, z: -6 },
      { x: 5, z: 6 },   { x: -5, z: 6 },
    ],
    tags: { building: 'detached' },
  },
  {
    name: 'residential-apartments',
    description: 'Apartment building, 4 floors (12.8m)',
    polygon: [
      { x: -10, z: -8 }, { x: 10, z: -8 },
      { x: 10, z: 8 },   { x: -10, z: 8 },
    ],
    tags: { building: 'apartments' },
  },
  {
    name: 'residential-l-shape',
    description: 'L-shaped house, tests non-rectangular polygon',
    polygon: [
      { x: -6, z: -7 }, { x: 6, z: -7 },
      { x: 6, z: 1 },   { x: 1, z: 1 },
      { x: 1, z: 7 },   { x: -6, z: 7 },
    ],
    tags: { building: 'house' },
  },
  {
    name: 'residential-tiny',
    description: 'Tiny studio, minimum room subdivision',
    polygon: [
      { x: -2.5, z: -3.5 }, { x: 2.5, z: -3.5 },
      { x: 2.5, z: 3.5 },   { x: -2.5, z: 3.5 },
    ],
    tags: { building: 'house' },
  },

  // ── Grocery ──

  {
    name: 'grocery-small-convenience',
    description: 'Small convenience store / bodega, 1 floor',
    polygon: [
      { x: -4, z: -3 }, { x: 4, z: -3 },
      { x: 4, z: 3 },   { x: -4, z: 3 },
    ],
    tags: { building: 'commercial', shop: 'convenience' },
  },
  {
    name: 'grocery-large-supermarket',
    description: 'Large supermarket with many aisles, 1 floor',
    polygon: [
      { x: -12.5, z: -9 }, { x: 12.5, z: -9 },
      { x: 12.5, z: 9 },   { x: -12.5, z: 9 },
    ],
    tags: { building: 'commercial', shop: 'supermarket' },
  },

  // ── Restaurant ──

  {
    name: 'restaurant-small-cafe',
    description: 'Small cafe, kitchen + dining, 1 floor',
    polygon: [
      { x: -3.5, z: -4 }, { x: 3.5, z: -4 },
      { x: 3.5, z: 4 },   { x: -3.5, z: 4 },
    ],
    tags: { building: 'commercial', amenity: 'cafe' },
  },
  {
    name: 'restaurant-medium',
    description: 'Medium restaurant, many tables, 1 floor',
    polygon: [
      { x: -7, z: -5 }, { x: 7, z: -5 },
      { x: 7, z: 5 },   { x: -7, z: 5 },
    ],
    tags: { building: 'commercial', amenity: 'restaurant' },
  },

  // ── Retail ──

  {
    name: 'retail-small-shop',
    description: 'Small retail shop with back room, 1 floor',
    polygon: [
      { x: -3, z: -4 }, { x: 3, z: -4 },
      { x: 3, z: 4 },   { x: -3, z: 4 },
    ],
    tags: { building: 'retail', shop: 'clothes' },
  },
  {
    name: 'retail-large',
    description: 'Large retail / department store, 1 floor',
    polygon: [
      { x: -9, z: -7 }, { x: 9, z: -7 },
      { x: 9, z: 7 },   { x: -9, z: 7 },
    ],
    tags: { building: 'retail', shop: 'department_store' },
  },

  // ── Office ──

  {
    name: 'office-small',
    description: 'Small office building, 3 floors (9.6m)',
    polygon: [
      { x: -5, z: -5 }, { x: 5, z: -5 },
      { x: 5, z: 5 },   { x: -5, z: 5 },
    ],
    tags: { building: 'office', office: 'yes' },
  },
  {
    name: 'office-large',
    description: 'Large office, BSP rooms, 3 floors',
    polygon: [
      { x: -11, z: -8 }, { x: 11, z: -8 },
      { x: 11, z: 8 },   { x: -11, z: 8 },
    ],
    tags: { building: 'office', office: 'company' },
  },

  // ── Edge Cases ──

  {
    name: 'irregular-pentagon',
    description: 'Irregular 5-sided building, tests ShapeGeometry',
    polygon: [
      { x: -5, z: -6 }, { x: 5, z: -7 },
      { x: 9, z: 0 },   { x: 3, z: 6 },
      { x: -7, z: 4 },
    ],
    tags: { building: 'yes' },
  },
  {
    name: 'narrow-building',
    description: 'Very narrow building, edge case for windows/door',
    polygon: [
      { x: -1.75, z: -7 }, { x: 1.75, z: -7 },
      { x: 1.75, z: 7 },   { x: -1.75, z: 7 },
    ],
    tags: { building: 'house' },
  },
  {
    name: 'tall-5-floor',
    description: '5-floor apartment, tests multi-floor stacking',
    polygon: [
      { x: -6, z: -6 }, { x: 6, z: -6 },
      { x: 6, z: 6 },   { x: -6, z: 6 },
    ],
    tags: { building: 'apartments', 'building:levels': '5' },
  },
];
