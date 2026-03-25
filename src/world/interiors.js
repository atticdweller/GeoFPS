import * as THREE from 'three';

const WALL_THICKNESS = 0.15;
const DOOR_WIDTH = 0.9;
const DOOR_HEIGHT = 2.1;
const MIN_ROOM_AREA = 6;
const MAX_ROOM_AREA = 30;

/**
 * Generate interior geometry for one floor of a building.
 * Pushes geometry into material buckets for batch merging.
 */
export function generateInterior(bbox, buildingArea, floorHeight, floorY, floorIndex, tags, buckets, doorInfo) {
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;

  if (width < 2 || depth < 2) return;

  const buildingType = classifyBuildingType(tags);

  // Floor plane
  const floorMatName = (buildingType !== 'residential') ? 'commercialFloor' : 'floor';
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(bbox.minX + width / 2, floorY + 0.01, bbox.minY + depth / 2);
  floorGeo.computeVertexNormals();
  if (!buckets[floorMatName]) buckets[floorMatName] = [];
  buckets[floorMatName].push(floorGeo);

  // Ceiling plane
  const ceilGeo = new THREE.PlaneGeometry(width, depth);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.translate(bbox.minX + width / 2, floorY + floorHeight - 0.01, bbox.minY + depth / 2);
  ceilGeo.computeVertexNormals();
  buckets.ceiling.push(ceilGeo);

  // Generate layout based on building type
  switch (buildingType) {
    case 'grocery':
      generateGroceryLayout(bbox, floorY, floorHeight, buckets, doorInfo);
      break;
    case 'restaurant':
      generateRestaurantLayout(bbox, floorY, floorHeight, buckets, doorInfo);
      break;
    case 'retail':
      generateRetailLayout(bbox, floorY, floorHeight, buckets, doorInfo);
      break;
    case 'office':
      generateOfficeLayout(bbox, buildingArea, floorY, floorHeight, buckets);
      break;
    default:
      // Residential — existing BSP layout
      generateResidentialLayout(bbox, buildingArea, floorY, floorHeight, tags, buckets, doorInfo);
      break;
  }
}

// ---- Building Type Classification ----

function classifyBuildingType(tags) {
  if (tags.shop === 'supermarket' || tags.shop === 'grocery' || tags.shop === 'convenience') return 'grocery';
  if (['restaurant', 'cafe', 'bar', 'fast_food', 'pub'].includes(tags.amenity)) return 'restaurant';
  if (tags.shop) return 'retail';
  if (tags.office) return 'office';
  if (['commercial', 'retail'].includes(tags.building)) return 'retail';
  if (['office'].includes(tags.building)) return 'office';
  if (['apartments', 'residential', 'house', 'detached', 'terrace', 'semidetached_house'].includes(tags.building)) return 'residential';
  return 'residential';
}

// ---- Grocery Layout ----

function generateGroceryLayout(bbox, floorY, floorHeight, buckets, doorInfo) {
  const y = floorY + 0.01;
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;
  const margin = 0.8;

  // Determine front side (where door is) — shelves run perpendicular to front
  const isWide = width > depth;

  // Parallel rows of shelving units
  const shelfH = 1.8;
  const shelfW = 0.5;
  const aisleWidth = 1.8;

  if (isWide) {
    // Shelves run along X (depth direction), aisles along Z
    const numAisles = Math.max(1, Math.floor((depth - 2 * margin) / (shelfW + aisleWidth)));
    const startZ = bbox.minY + margin + aisleWidth;
    for (let i = 0; i < numAisles; i++) {
      const sz = startZ + i * (shelfW + aisleWidth);
      if (sz + shelfW > bbox.maxY - margin) break;
      addBox(width - 2 * margin - 2, shelfH, shelfW,
        bbox.minX + width / 2, y, sz + shelfW / 2, 'shelf', buckets);
    }
  } else {
    // Shelves run along Z (width direction), aisles along X
    const numAisles = Math.max(1, Math.floor((width - 2 * margin) / (shelfW + aisleWidth)));
    const startX = bbox.minX + margin + aisleWidth;
    for (let i = 0; i < numAisles; i++) {
      const sx = startX + i * (shelfW + aisleWidth);
      if (sx + shelfW > bbox.maxX - margin) break;
      addBox(shelfW, shelfH, depth - 2 * margin - 2,
        sx + shelfW / 2, y, bbox.minY + depth / 2, 'shelf', buckets);
    }
  }

  // Checkout counters near front wall
  const numRegisters = Math.max(1, Math.floor(Math.min(width, depth) / 2.5));
  for (let i = 0; i < numRegisters; i++) {
    const t = (i + 0.5) / numRegisters;
    if (isWide) {
      addBox(0.8, 0.9, 0.5,
        bbox.minX + margin + t * (width - 2 * margin), y, bbox.minY + margin, 'counter', buckets);
    } else {
      addBox(0.5, 0.9, 0.8,
        bbox.minX + margin, y, bbox.minY + margin + t * (depth - 2 * margin), 'counter', buckets);
    }
  }

  // Cooler units along back wall
  if (isWide) {
    addBox(width - 2 * margin, 2.0, 0.7,
      bbox.minX + width / 2, y, bbox.maxY - margin - 0.35, 'metal', buckets);
  } else {
    addBox(0.7, 2.0, depth - 2 * margin,
      bbox.maxX - margin - 0.35, y, bbox.minY + depth / 2, 'metal', buckets);
  }
}

// ---- Restaurant Layout ----

function generateRestaurantLayout(bbox, floorY, floorHeight, buckets, doorInfo) {
  const y = floorY + 0.01;
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;
  const margin = 0.6;

  // Kitchen area (back 30%)
  const kitchenDepth = depth * 0.3;
  const kitchenZ = bbox.maxY - kitchenDepth;

  // Kitchen divider wall
  addWallSegment(bbox.minX, kitchenZ, bbox.maxX, kitchenZ, floorY, floorHeight - 0.2, buckets);

  // Kitchen counters
  addBox(width - 1, 0.9, 0.6,
    bbox.minX + width / 2, y, kitchenZ + kitchenDepth / 2, 'counter', buckets);

  // Dining area — grid of tables
  const diningDepth = depth - kitchenDepth - margin;
  const tableSpacingX = 2.5;
  const tableSpacingZ = 2.5;
  const numTablesX = Math.max(1, Math.floor((width - 2 * margin) / tableSpacingX));
  const numTablesZ = Math.max(1, Math.floor((diningDepth - margin) / tableSpacingZ));

  for (let tx = 0; tx < numTablesX; tx++) {
    for (let tz = 0; tz < numTablesZ; tz++) {
      const cx = bbox.minX + margin + (tx + 0.5) * ((width - 2 * margin) / numTablesX);
      const cz = bbox.minY + margin + (tz + 0.5) * ((diningDepth - margin) / numTablesZ);

      // Table
      addBox(0.8, 0.75, 0.8, cx, y, cz, 'wood', buckets);
      // Chairs
      addBox(0.4, 0.8, 0.4, cx - 0.7, y, cz, 'wood', buckets);
      addBox(0.4, 0.8, 0.4, cx + 0.7, y, cz, 'wood', buckets);
    }
  }

  // Counter/bar near front
  if (width > 4) {
    addBox(Math.min(3, width * 0.4), 1.0, 0.5,
      bbox.minX + width * 0.75, y, bbox.minY + margin + 0.5, 'counter', buckets);
  }
}

// ---- Retail Layout ----

function generateRetailLayout(bbox, floorY, floorHeight, buckets, doorInfo) {
  const y = floorY + 0.01;
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;
  const margin = 0.6;

  // Back room / storage (back 20%)
  const backDepth = depth * 0.2;
  const backZ = bbox.maxY - backDepth;
  addWallSegment(bbox.minX, backZ, bbox.maxX, backZ, floorY, floorHeight - 0.2, buckets);

  // Counter near back wall of main area
  addBox(width * 0.4, 0.95, 0.5,
    bbox.minX + width / 2, y, backZ - margin - 0.25, 'counter', buckets);

  // Display shelving along side walls
  if (depth > 4) {
    addBox(0.5, 1.5, depth * 0.5,
      bbox.minX + margin + 0.25, y, bbox.minY + depth * 0.35, 'shelf', buckets);
    addBox(0.5, 1.5, depth * 0.5,
      bbox.maxX - margin - 0.25, y, bbox.minY + depth * 0.35, 'shelf', buckets);
  }

  // Display tables in center
  const numTables = Math.max(1, Math.floor(width / 3));
  for (let i = 0; i < numTables; i++) {
    const t = (i + 0.5) / numTables;
    const tx = bbox.minX + margin + t * (width - 2 * margin);
    addBox(1.0, 0.8, 0.8, tx, y, bbox.minY + depth * 0.45, 'wood', buckets);
  }
}

// ---- Office Layout ----

function generateOfficeLayout(bbox, buildingArea, floorY, floorHeight, buckets) {
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;

  // BSP with larger room sizes for offices
  const rooms = bspSubdivide({ x: bbox.minX, z: bbox.minY, w: width, d: depth }, 0, 15, 50);

  const sorted = [...rooms].sort((a, b) => (b.w * b.d) - (a.w * a.d));
  const types = ['open_office', 'conference', 'reception'];
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].type = i < types.length ? types[i] : (i % 2 === 0 ? 'open_office' : 'private_office');
  }

  const doorConnections = findDoorConnections(rooms);
  for (const room of rooms) {
    buildRoomWalls(room, rooms, doorConnections, bbox, floorY, floorHeight, buckets);
    placeOfficeFurniture(room, floorY + 0.01, buckets);
  }
}

function placeOfficeFurniture(room, y, b) {
  switch (room.type) {
    case 'open_office': {
      // Rows of desks
      const numDesks = Math.max(1, Math.floor(room.w / 2));
      const numRows = Math.max(1, Math.floor(room.d / 2.5));
      for (let r = 0; r < numRows; r++) {
        for (let d = 0; d < numDesks; d++) {
          const dx = room.x + 0.5 + (d + 0.5) * ((room.w - 1) / numDesks);
          const dz = room.z + 0.8 + r * 2.2;
          if (dz + 1 > room.z + room.d) break;
          addBox(1.2, 0.75, 0.6, dx, y, dz, 'wood', b);
          addBox(0.5, 0.8, 0.5, dx, y, dz + 0.6, 'fabric', b);
        }
      }
      break;
    }
    case 'conference': {
      const tw = Math.min(2.5, room.w - 1);
      const td = Math.min(1.2, room.d - 1);
      addBox(tw, 0.75, td, room.x + room.w / 2, y, room.z + room.d / 2, 'wood', b);
      // Chairs around table
      const numChairs = Math.max(2, Math.floor((tw + td) * 2 / 0.8));
      for (let i = 0; i < Math.min(numChairs, 8); i++) {
        const angle = (i / numChairs) * Math.PI * 2;
        const cx = room.x + room.w / 2 + Math.cos(angle) * (tw / 2 + 0.5);
        const cz = room.z + room.d / 2 + Math.sin(angle) * (td / 2 + 0.5);
        if (cx > room.x + 0.3 && cx < room.x + room.w - 0.3 &&
            cz > room.z + 0.3 && cz < room.z + room.d - 0.3) {
          addBox(0.5, 0.8, 0.5, cx, y, cz, 'fabric', b);
        }
      }
      break;
    }
    case 'reception': {
      addBox(Math.min(2.0, room.w - 0.6), 1.0, 0.6,
        room.x + room.w / 2, y, room.z + room.d * 0.6, 'counter', b);
      // Waiting chairs
      if (room.w > 3) {
        addBox(1.5, 0.5, 0.6, room.x + 0.9, y, room.z + 0.5, 'fabric', b);
      }
      break;
    }
    case 'private_office': {
      addBox(1.4, 0.75, 0.6, room.x + room.w / 2, y, room.z + 0.5, 'wood', b);
      addBox(0.5, 0.8, 0.5, room.x + room.w / 2, y, room.z + 1.2, 'fabric', b);
      if (room.w > 2.5) {
        addBox(0.4, 1.5, 0.8, room.x + room.w - 0.4, y, room.z + room.d / 2, 'wood', b);
      }
      break;
    }
  }
}

// ---- Residential Layout (original) ----

function generateResidentialLayout(bbox, buildingArea, floorY, floorHeight, tags, buckets, doorInfo) {
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;

  const rooms = bspSubdivide({ x: bbox.minX, z: bbox.minY, w: width, d: depth });
  classifyRooms(rooms, buildingArea, tags);

  const doorConnections = findDoorConnections(rooms);
  for (const room of rooms) {
    buildRoomWalls(room, rooms, doorConnections, bbox, floorY, floorHeight, buckets);
    placeFurniture(room, floorY, buckets);
  }
}

// ---- BSP ----

function bspSubdivide(rect, depth = 0, minArea = MIN_ROOM_AREA, maxArea = MAX_ROOM_AREA) {
  const area = rect.w * rect.d;
  if (area <= maxArea || depth > 6 || area < minArea * 2) {
    return [rect];
  }

  const splitH = rect.w > rect.d;
  const dim = splitH ? rect.w : rect.d;
  const splitRatio = 0.4 + Math.random() * 0.2;
  const splitPos = dim * splitRatio;

  if (splitPos < 1.8 || (dim - splitPos) < 1.8) return [rect];

  let r1, r2;
  if (splitH) {
    r1 = { x: rect.x, z: rect.z, w: splitPos, d: rect.d };
    r2 = { x: rect.x + splitPos, z: rect.z, w: rect.w - splitPos, d: rect.d };
  } else {
    r1 = { x: rect.x, z: rect.z, w: rect.w, d: splitPos };
    r2 = { x: rect.x, z: rect.z + splitPos, w: rect.w, d: rect.d - splitPos };
  }

  return [...bspSubdivide(r1, depth + 1, minArea, maxArea), ...bspSubdivide(r2, depth + 1, minArea, maxArea)];
}

// ---- Room Classification ----

function classifyRooms(rooms, buildingArea, tags) {
  const sorted = [...rooms].sort((a, b) => (b.w * b.d) - (a.w * a.d));
  let types;
  if (buildingArea < 40) types = ['living', 'bathroom'];
  else if (buildingArea < 80) types = ['living', 'kitchen', 'bedroom', 'bathroom'];
  else if (buildingArea < 130) types = ['living', 'kitchen', 'bedroom', 'bedroom', 'bathroom'];
  else if (buildingArea < 200) types = ['living', 'kitchen', 'bedroom', 'bedroom', 'bedroom', 'bathroom', 'bathroom'];
  else types = ['living', 'kitchen', 'dining', 'bedroom', 'bedroom', 'bedroom', 'bathroom', 'bathroom', 'study'];

  for (let i = 0; i < sorted.length; i++) {
    sorted[i].type = i < types.length ? types[i] : 'bedroom';
  }
}

// ---- Door Connections (MST) ----

function findDoorConnections(rooms) {
  const pairs = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const shared = getSharedEdge(rooms[i], rooms[j]);
      if (shared) pairs.push({ i, j, shared });
    }
  }

  const parent = rooms.map((_, i) => i);
  function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }

  pairs.sort(() => Math.random() - 0.5);
  const connections = [];
  for (const pair of pairs) {
    if (find(pair.i) !== find(pair.j)) {
      parent[find(pair.i)] = find(pair.j);
      connections.push(pair);
    }
  }
  for (const pair of pairs) {
    if (!connections.includes(pair) && Math.random() < 0.3) {
      connections.push(pair);
    }
  }
  return connections;
}

function getSharedEdge(a, b) {
  const eps = 0.1;
  if (Math.abs((a.x + a.w) - b.x) < eps || Math.abs((b.x + b.w) - a.x) < eps) {
    const oStart = Math.max(a.z, b.z);
    const oEnd = Math.min(a.z + a.d, b.z + b.d);
    if (oEnd - oStart > DOOR_WIDTH + 0.2) {
      const x = Math.abs((a.x + a.w) - b.x) < eps ? a.x + a.w : a.x;
      return { axis: 'x', pos: x, start: oStart, end: oEnd };
    }
  }
  if (Math.abs((a.z + a.d) - b.z) < eps || Math.abs((b.z + b.d) - a.z) < eps) {
    const oStart = Math.max(a.x, b.x);
    const oEnd = Math.min(a.x + a.w, b.x + b.w);
    if (oEnd - oStart > DOOR_WIDTH + 0.2) {
      const z = Math.abs((a.z + a.d) - b.z) < eps ? a.z + a.d : a.z;
      return { axis: 'z', pos: z, start: oStart, end: oEnd };
    }
  }
  return null;
}

// ---- Walls ----

function buildRoomWalls(room, allRooms, doorConns, bbox, floorY, floorHeight, buckets) {
  const wallHeight = floorHeight - 0.2;
  const wallY = floorY + wallHeight / 2;
  const eps = 0.2;

  const edges = [
    { axis: 'z', pos: room.z, start: room.x, end: room.x + room.w },
    { axis: 'z', pos: room.z + room.d, start: room.x, end: room.x + room.w },
    { axis: 'x', pos: room.x, start: room.z, end: room.z + room.d },
    { axis: 'x', pos: room.x + room.w, start: room.z, end: room.z + room.d },
  ];

  for (const edge of edges) {
    // Skip edges on the building perimeter — exterior walls already handle those
    if (edge.axis === 'z' && (Math.abs(edge.pos - bbox.minY) < eps || Math.abs(edge.pos - bbox.maxY) < eps)) continue;
    if (edge.axis === 'x' && (Math.abs(edge.pos - bbox.minX) < eps || Math.abs(edge.pos - bbox.maxX) < eps)) continue;

    const door = doorConns.find(c =>
      c.shared.axis === edge.axis && Math.abs(c.shared.pos - edge.pos) < 0.1
    );

    if (door) {
      const dc = (door.shared.start + door.shared.end) / 2;
      const ds = dc - DOOR_WIDTH / 2;
      const de = dc + DOOR_WIDTH / 2;

      if (ds - edge.start > 0.1) addWall(edge, edge.start, ds, wallHeight, wallY, buckets);
      const aboveH = wallHeight - DOOR_HEIGHT;
      if (aboveH > 0.1) addWall(edge, ds, de, aboveH, floorY + DOOR_HEIGHT + aboveH / 2, buckets);
      if (edge.end - de > 0.1) addWall(edge, de, edge.end, wallHeight, wallY, buckets);
    } else {
      addWall(edge, edge.start, edge.end, wallHeight, wallY, buckets);
    }
  }
}

function addWall(edge, start, end, height, y, buckets) {
  const length = end - start;
  if (length < 0.05) return;

  let geo;
  if (edge.axis === 'z') {
    geo = new THREE.BoxGeometry(length, height, WALL_THICKNESS);
    geo.translate(start + length / 2, y, edge.pos);
  } else {
    geo = new THREE.BoxGeometry(WALL_THICKNESS, height, length);
    geo.translate(edge.pos, y, start + length / 2);
  }
  geo.computeVertexNormals();
  buckets.wallInterior.push(geo);
}

function addWallSegment(x0, z0, x1, z1, floorY, wallHeight, buckets) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.1) return;
  const angle = Math.atan2(z1 - z0, x1 - x0);
  const geo = new THREE.BoxGeometry(len, wallHeight, WALL_THICKNESS);
  geo.rotateY(-angle);
  geo.translate((x0 + x1) / 2, floorY + wallHeight / 2, (z0 + z1) / 2);
  geo.computeVertexNormals();
  buckets.wallInterior.push(geo);
}

// ---- Furniture ----

function placeFurniture(room, floorY, buckets) {
  const y = floorY + 0.01;
  switch (room.type) {
    case 'kitchen': placeKitchen(room, y, buckets); break;
    case 'bedroom': placeBedroom(room, y, buckets); break;
    case 'living': placeLivingRoom(room, y, buckets); break;
    case 'bathroom': placeBathroom(room, y, buckets); break;
    case 'dining': placeDining(room, y, buckets); break;
    case 'study': placeStudy(room, y, buckets); break;
  }
}

function addBox(w, h, d, x, y, z, matName, buckets) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y + h / 2, z);
  geo.computeVertexNormals();
  if (!buckets[matName]) buckets[matName] = [];
  buckets[matName].push(geo);
}

function placeKitchen(room, y, b) {
  addBox(room.w - 0.4, 0.9, 0.6, room.x + room.w / 2, y, room.z + 0.5, 'counter', b);
  if (room.w > 2 && room.d > 2)
    addBox(1.2, 0.75, 0.8, room.x + room.w / 2, y, room.z + room.d / 2, 'wood', b);
}

function placeBedroom(room, y, b) {
  const bedW = Math.min(1.8, room.w - 0.6);
  const bedD = Math.min(2.2, room.d - 0.6);
  const matName = Math.random() > 0.5 ? 'bedRed' : 'bedBlue';
  addBox(bedW, 0.5, bedD, room.x + room.w / 2, y, room.z + bedD / 2 + 0.3, matName, b);
  if (room.w > 2)
    addBox(0.4, 0.5, 0.4, room.x + room.w / 2 + bedW / 2 + 0.3, y, room.z + 0.5, 'wood', b);
  if (room.d > 2)
    addBox(1.0, 0.8, 0.45, room.x + room.w - 0.7, y, room.z + room.d - 0.5, 'wood', b);
}

function placeLivingRoom(room, y, b) {
  const couchW = Math.min(2.2, room.w - 0.6);
  addBox(couchW, 0.6, 0.8, room.x + room.w / 2, y, room.z + room.d - 0.7, 'fabric', b);
  addBox(1.0, 0.4, 0.5, room.x + room.w / 2, y, room.z + room.d / 2, 'wood', b);
  if (room.w > 2.5)
    addBox(0.8, 0.6, 0.8, room.x + 0.7, y, room.z + room.d / 2, 'fabric', b);
}

function placeBathroom(room, y, b) {
  addBox(Math.min(1.6, room.w - 0.4), 0.5, 0.7, room.x + room.w / 2, y, room.z + 0.55, 'porcelain', b);
  addBox(0.4, 0.4, 0.5, room.x + room.w - 0.5, y, room.z + room.d - 0.5, 'porcelain', b);
  addBox(0.5, 0.1, 0.4, room.x + 0.5, y + 0.75, room.z + room.d - 0.4, 'porcelain', b);
}

function placeDining(room, y, b) {
  const tx = room.x + room.w / 2, tz = room.z + room.d / 2;
  addBox(1.6, 0.75, 0.9, tx, y, tz, 'wood', b);
  addBox(0.4, 0.8, 0.4, tx - 0.9, y, tz, 'wood', b);
  addBox(0.4, 0.8, 0.4, tx + 0.9, y, tz, 'wood', b);
}

function placeStudy(room, y, b) {
  addBox(1.4, 0.75, 0.6, room.x + room.w / 2, y, room.z + 0.5, 'wood', b);
  addBox(0.5, 0.8, 0.5, room.x + room.w / 2, y, room.z + 1.2, 'fabric', b);
  if (room.w > 2)
    addBox(0.4, 1.8, 1.0, room.x + room.w - 0.4, y, room.z + room.d / 2, 'wood', b);
}

// ---- Floorplan extraction (for QA/debug) ----

/**
 * Returns room layout data for a single floor without generating geometry.
 * @returns {Array<{x, z, w, d, type}>} rooms in local coords
 */
export function getFloorplan(bbox, buildingArea, tags) {
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;
  if (width < 2 || depth < 2) return [];

  const buildingType = classifyBuildingType(tags);

  switch (buildingType) {
    case 'grocery': return getGroceryFloorplan(bbox);
    case 'restaurant': return getRestaurantFloorplan(bbox);
    case 'retail': return getRetailFloorplan(bbox);
    case 'office': return getOfficeFloorplan(bbox, buildingArea);
    default: return getResidentialFloorplan(bbox, buildingArea, tags);
  }
}

function getResidentialFloorplan(bbox, buildingArea, tags) {
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;
  const rooms = bspSubdivide({ x: bbox.minX, z: bbox.minY, w: width, d: depth });
  classifyRooms(rooms, buildingArea, tags);
  return rooms;
}

function getOfficeFloorplan(bbox, buildingArea) {
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;
  const rooms = bspSubdivide({ x: bbox.minX, z: bbox.minY, w: width, d: depth }, 0, 50, 15);
  const sorted = [...rooms].sort((a, b) => (b.w * b.d) - (a.w * a.d));
  const officeTypes = ['open_office', 'conference', 'reception'];
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].type = i < officeTypes.length ? officeTypes[i] : (i % 2 === 0 ? 'open_office' : 'private_office');
  }
  return rooms;
}

function getGroceryFloorplan(bbox) {
  const w = bbox.maxX - bbox.minX;
  const d = bbox.maxY - bbox.minY;
  return [
    { x: bbox.minX, z: bbox.minY, w, d: d * 0.15, type: 'checkout' },
    { x: bbox.minX, z: bbox.minY + d * 0.15, w, d: d * 0.7, type: 'aisles' },
    { x: bbox.minX, z: bbox.minY + d * 0.85, w, d: d * 0.15, type: 'coolers' },
  ];
}

function getRestaurantFloorplan(bbox) {
  const w = bbox.maxX - bbox.minX;
  const d = bbox.maxY - bbox.minY;
  return [
    { x: bbox.minX, z: bbox.minY, w, d: d * 0.7, type: 'dining' },
    { x: bbox.minX, z: bbox.minY + d * 0.7, w, d: d * 0.3, type: 'kitchen' },
  ];
}

function getRetailFloorplan(bbox) {
  const w = bbox.maxX - bbox.minX;
  const d = bbox.maxY - bbox.minY;
  return [
    { x: bbox.minX, z: bbox.minY, w, d: d * 0.8, type: 'showroom' },
    { x: bbox.minX, z: bbox.minY + d * 0.8, w, d: d * 0.2, type: 'storage' },
  ];
}
