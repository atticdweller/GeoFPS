import * as THREE from 'three';

const WALL_THICKNESS = 0.15;
const DOOR_WIDTH = 0.9;
const DOOR_HEIGHT = 2.1;
const WINDOW_WIDTH = 1.0;
const WINDOW_HEIGHT = 1.2;
const WINDOW_SILL = 0.9;
const MIN_ROOM_AREA = 6;
const MAX_ROOM_AREA = 30;

/**
 * Generate interior geometry for one floor of a building.
 * Pushes geometry into material buckets for batch merging (no individual meshes).
 */
export function generateInterior(bbox, buildingArea, floorHeight, floorY, floorIndex, tags, buckets) {
  const width = bbox.maxX - bbox.minX;
  const depth = bbox.maxY - bbox.minY;

  if (width < 3 || depth < 3) return;

  // BSP subdivision
  const rooms = bspSubdivide({ x: bbox.minX, z: bbox.minY, w: width, d: depth });
  classifyRooms(rooms, buildingArea, tags);

  // Floor plane
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(bbox.minX + width / 2, floorY + 0.01, bbox.minY + depth / 2);
  floorGeo.computeVertexNormals();
  buckets.floor.push(floorGeo);

  // Ceiling plane
  const ceilGeo = new THREE.PlaneGeometry(width, depth);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.translate(bbox.minX + width / 2, floorY + floorHeight - 0.01, bbox.minY + depth / 2);
  ceilGeo.computeVertexNormals();
  buckets.ceiling.push(ceilGeo);

  // Door connections
  const doorConnections = findDoorConnections(rooms);

  // Walls
  for (const room of rooms) {
    buildRoomWalls(room, rooms, doorConnections, bbox, floorY, floorHeight, buckets);
    placeFurniture(room, floorY, buckets);
  }

  // Windows
  placeWindows(rooms, bbox, floorY, floorHeight, buckets);
}

// ---- BSP ----

function bspSubdivide(rect, depth = 0) {
  const area = rect.w * rect.d;
  if (area <= MAX_ROOM_AREA || depth > 6 || area < MIN_ROOM_AREA * 2) {
    return [rect];
  }

  const splitH = rect.w > rect.d;
  const dim = splitH ? rect.w : rect.d;
  const splitRatio = 0.4 + Math.random() * 0.2;
  const splitPos = dim * splitRatio;

  if (splitPos < 2.5 || (dim - splitPos) < 2.5) return [rect];

  let r1, r2;
  if (splitH) {
    r1 = { x: rect.x, z: rect.z, w: splitPos, d: rect.d };
    r2 = { x: rect.x + splitPos, z: rect.z, w: rect.w - splitPos, d: rect.d };
  } else {
    r1 = { x: rect.x, z: rect.z, w: rect.w, d: splitPos };
    r2 = { x: rect.x, z: rect.z + splitPos, w: rect.w, d: rect.d - splitPos };
  }

  return [...bspSubdivide(r1, depth + 1), ...bspSubdivide(r2, depth + 1)];
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
  // Extra connections for flow
  for (const pair of pairs) {
    if (!connections.includes(pair) && Math.random() < 0.3) {
      connections.push(pair);
    }
  }
  return connections;
}

function getSharedEdge(a, b) {
  const eps = 0.1;
  // Vertical edge (same X boundary)
  if (Math.abs((a.x + a.w) - b.x) < eps || Math.abs((b.x + b.w) - a.x) < eps) {
    const oStart = Math.max(a.z, b.z);
    const oEnd = Math.min(a.z + a.d, b.z + b.d);
    if (oEnd - oStart > DOOR_WIDTH + 0.2) {
      const x = Math.abs((a.x + a.w) - b.x) < eps ? a.x + a.w : a.x;
      return { axis: 'x', pos: x, start: oStart, end: oEnd };
    }
  }
  // Horizontal edge (same Z boundary)
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

  const edges = [
    { axis: 'z', pos: room.z, start: room.x, end: room.x + room.w },
    { axis: 'z', pos: room.z + room.d, start: room.x, end: room.x + room.w },
    { axis: 'x', pos: room.x, start: room.z, end: room.z + room.d },
    { axis: 'x', pos: room.x + room.w, start: room.z, end: room.z + room.d },
  ];

  for (const edge of edges) {
    const door = doorConns.find(c =>
      c.shared.axis === edge.axis && Math.abs(c.shared.pos - edge.pos) < 0.1
    );

    if (door) {
      const dc = (door.shared.start + door.shared.end) / 2;
      const ds = dc - DOOR_WIDTH / 2;
      const de = dc + DOOR_WIDTH / 2;

      if (ds - edge.start > 0.1) addWall(edge, edge.start, ds, wallHeight, wallY, buckets);
      // Above door
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

// ---- Windows ----

function placeWindows(rooms, bbox, floorY, floorHeight, buckets) {
  const edges = [
    { axis: 'z', pos: bbox.minY, start: bbox.minX, end: bbox.maxX },
    { axis: 'z', pos: bbox.maxY, start: bbox.minX, end: bbox.maxX },
    { axis: 'x', pos: bbox.minX, start: bbox.minY, end: bbox.maxY },
    { axis: 'x', pos: bbox.maxX, start: bbox.minY, end: bbox.maxY },
  ];

  for (const edge of edges) {
    const length = edge.end - edge.start;
    const numWin = Math.floor(length / 3);
    const spacing = length / (numWin + 1);

    for (let i = 1; i <= numWin; i++) {
      const pos = edge.start + spacing * i;
      const wGeo = new THREE.PlaneGeometry(WINDOW_WIDTH, WINDOW_HEIGHT);
      const wy = floorY + WINDOW_SILL + WINDOW_HEIGHT / 2;

      if (edge.axis === 'z') {
        if (edge.pos === bbox.maxY) wGeo.rotateY(Math.PI);
        wGeo.translate(pos, wy, edge.pos);
      } else {
        wGeo.rotateY(edge.pos === bbox.minX ? -Math.PI / 2 : Math.PI / 2);
        wGeo.translate(edge.pos, wy, pos);
      }
      wGeo.computeVertexNormals();
      buckets.glass.push(wGeo);
    }
  }
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
  buckets[matName].push(geo);
}

function placeKitchen(room, y, b) {
  addBox(room.w - 0.4, 0.9, 0.6, room.x + room.w / 2, y, room.z + 0.5, 'counter', b);
  if (room.w > 3 && room.d > 3)
    addBox(1.2, 0.75, 0.8, room.x + room.w / 2, y, room.z + room.d / 2, 'wood', b);
}

function placeBedroom(room, y, b) {
  const bedW = Math.min(1.8, room.w - 0.6);
  const bedD = Math.min(2.2, room.d - 0.6);
  const matName = Math.random() > 0.5 ? 'bedRed' : 'bedBlue';
  addBox(bedW, 0.5, bedD, room.x + room.w / 2, y, room.z + bedD / 2 + 0.3, matName, b);
  if (room.w > 3)
    addBox(0.4, 0.5, 0.4, room.x + room.w / 2 + bedW / 2 + 0.3, y, room.z + 0.5, 'wood', b);
  if (room.d > 3)
    addBox(1.0, 0.8, 0.45, room.x + room.w - 0.7, y, room.z + room.d - 0.5, 'wood', b);
}

function placeLivingRoom(room, y, b) {
  const couchW = Math.min(2.2, room.w - 0.6);
  addBox(couchW, 0.6, 0.8, room.x + room.w / 2, y, room.z + room.d - 0.7, 'fabric', b);
  addBox(1.0, 0.4, 0.5, room.x + room.w / 2, y, room.z + room.d / 2, 'wood', b);
  if (room.w > 4)
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
  if (room.w > 3)
    addBox(0.4, 1.8, 1.0, room.x + room.w - 0.4, y, room.z + room.d / 2, 'wood', b);
}
