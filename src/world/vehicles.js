import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { onUpdate } from '../core/loop.js';
import { materials } from '../utils/materials.js';

const CAR_LENGTH = 4.0;
const CAR_WIDTH = 1.8;
const CAR_HEIGHT = 1.0;
const CABIN_LENGTH = 2.0;
const CABIN_HEIGHT = 0.8;
const WHEEL_RADIUS = 0.35;
const ROAD_Y = 0.02;

const PAINT_MATERIALS = ['carPaintRed', 'carPaintBlue', 'carPaintWhite', 'carPaintBlack', 'carPaintSilver'];

/**
 * Place parked cars along streets.
 */
export function placeParkedCars(projectedRoads, world) {
  const vehicleGroup = new THREE.Group();
  vehicleGroup.name = 'parkedCars';

  let count = 0;

  for (const road of projectedRoads) {
    // Only park on residential/secondary/tertiary
    if (!['residential', 'secondary', 'tertiary', 'unclassified', 'living_street'].includes(road.highway)) continue;
    if (road.roadWidth < 5) continue; // too narrow

    const parkOffset = road.roadWidth / 2 - 1.0; // park near road edge

    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < CAR_LENGTH + 2) continue;

      const dx = (b.x - a.x) / segLen;
      const dz = (b.z - a.z) / segLen;
      const px = -dz; // perpendicular
      const pz = dx;
      const angle = Math.atan2(dz, dx);

      // Place cars along right side
      let d = 2; // start 2m from segment start
      while (d + CAR_LENGTH < segLen - 1) {
        // 70% fill rate
        if (Math.random() < 0.7) {
          const t = d / segLen;
          const cx = a.x + (b.x - a.x) * t + px * parkOffset;
          const cz = a.z + (b.z - a.z) * t + pz * parkOffset;

          const car = createCarModel();
          car.rotation.y = -angle;
          car.position.set(cx, ROAD_Y, cz);
          vehicleGroup.add(car);

          // Physics body for parked car
          const body = new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: new CANNON.Box(new CANNON.Vec3(CAR_LENGTH / 2, CAR_HEIGHT / 2 + CABIN_HEIGHT / 2, CAR_WIDTH / 2)),
          });
          body.position.set(cx, ROAD_Y + CAR_HEIGHT / 2 + CABIN_HEIGHT / 4, cz);
          body.quaternion.setFromEuler(0, -angle, 0);
          world.addBody(body);

          count++;
        }
        d += CAR_LENGTH + 1.5 + Math.random() * 2; // car length + gap
      }
    }
  }

  scene.add(vehicleGroup);
  console.log(`Placed ${count} parked cars`);
  return vehicleGroup;
}

/**
 * Initialize driving cars on the road network.
 */
export function initTraffic(roadGraph) {
  if (!roadGraph || roadGraph.edges.length === 0) return;

  const drivingCars = [];
  const trafficGroup = new THREE.Group();
  trafficGroup.name = 'traffic';

  // Spawn 5-15 cars depending on road network size
  const numCars = Math.min(15, Math.max(5, Math.floor(roadGraph.edges.length / 3)));

  for (let i = 0; i < numCars; i++) {
    const edgeIdx = Math.floor(Math.random() * roadGraph.edges.length);
    const edge = roadGraph.edges[edgeIdx];

    // Skip very short edges or footways
    if (edge.length < 10 || edge.highway === 'footway' || edge.highway === 'path') {
      continue;
    }

    const car = createCarModel();
    trafficGroup.add(car);

    drivingCars.push({
      mesh: car,
      edgeIdx,
      progress: Math.random() * edge.length,
      speed: 8 + Math.random() * 4, // 8-12 m/s
      direction: 1, // 1 = from→to, -1 = to→from
    });
  }

  scene.add(trafficGroup);

  // Update loop
  onUpdate((dt) => {
    for (const car of drivingCars) {
      updateDrivingCar(car, roadGraph, drivingCars, dt);
    }
  });

  console.log(`Spawned ${drivingCars.length} driving cars`);
}

function updateDrivingCar(car, roadGraph, allCars, dt) {
  const edge = roadGraph.edges[car.edgeIdx];
  if (!edge) return;

  // Check distance to car ahead on same edge
  let minAheadDist = Infinity;
  for (const other of allCars) {
    if (other === car || other.edgeIdx !== car.edgeIdx) continue;
    const ahead = (other.progress - car.progress) * car.direction;
    if (ahead > 0 && ahead < minAheadDist) {
      minAheadDist = ahead;
    }
  }

  // Slow down if car ahead is close
  let speed = car.speed;
  if (minAheadDist < 8) {
    speed *= Math.max(0.1, (minAheadDist - 2) / 6);
  }

  car.progress += speed * dt * car.direction;

  // If reached end of edge, pick next edge
  if (car.progress >= edge.length || car.progress <= 0) {
    const nodeId = car.direction > 0 ? edge.to : edge.from;
    const adj = roadGraph.adjacency.get(nodeId);

    if (adj && adj.length > 0) {
      // Pick a random outgoing edge (prefer not reversing)
      const candidates = adj.filter(idx => idx !== car.edgeIdx);
      const nextIdx = candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : adj[Math.floor(Math.random() * adj.length)];

      const nextEdge = roadGraph.edges[nextIdx];
      car.edgeIdx = nextIdx;

      // Determine direction on new edge
      if (nextEdge.from === nodeId) {
        car.direction = 1;
        car.progress = 0;
      } else {
        car.direction = -1;
        car.progress = nextEdge.length;
      }
    } else {
      // Dead end — reverse
      car.direction *= -1;
      car.progress = Math.max(0, Math.min(edge.length, car.progress));
    }
  }

  // Position car along edge
  positionCarOnEdge(car, roadGraph);
}

function positionCarOnEdge(car, roadGraph) {
  const edge = roadGraph.edges[car.edgeIdx];
  if (!edge || edge.points.length < 2) return;

  // Find position along the polyline at car.progress distance
  let dist = 0;
  for (let i = 0; i < edge.points.length - 1; i++) {
    const a = edge.points[i];
    const b = edge.points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);

    if (dist + segLen >= car.progress) {
      const t = (car.progress - dist) / segLen;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const angle = Math.atan2(b.z - a.z, b.x - a.x);

      // Offset to right lane
      const laneOffset = edge.roadWidth ? edge.roadWidth / 4 : 1.5;
      const px = -Math.sin(angle) * laneOffset * car.direction;
      const pz = Math.cos(angle) * laneOffset * car.direction;

      car.mesh.position.set(x + px, ROAD_Y + WHEEL_RADIUS, z + pz);
      car.mesh.rotation.y = -(angle + (car.direction < 0 ? Math.PI : 0));
      return;
    }

    dist += segLen;
  }

  // Fallback: place at end
  const last = edge.points[edge.points.length - 1];
  car.mesh.position.set(last.x, ROAD_Y + WHEEL_RADIUS, last.z);
}

function createCarModel() {
  const group = new THREE.Group();
  const paintMat = PAINT_MATERIALS[Math.floor(Math.random() * PAINT_MATERIALS.length)];

  // Body
  const bodyGeo = new THREE.BoxGeometry(CAR_LENGTH, CAR_HEIGHT, CAR_WIDTH);
  bodyGeo.translate(0, CAR_HEIGHT / 2, 0);
  const body = new THREE.Mesh(bodyGeo, materials[paintMat]);
  body.castShadow = true;
  group.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(CABIN_LENGTH, CABIN_HEIGHT, CAR_WIDTH - 0.2);
  cabinGeo.translate(-0.3, CAR_HEIGHT + CABIN_HEIGHT / 2, 0);
  const cabin = new THREE.Mesh(cabinGeo, materials.carWindow);
  cabin.castShadow = true;
  group.add(cabin);

  // Wheels
  const wheelPositions = [
    { x: CAR_LENGTH / 2 - 0.6, z: CAR_WIDTH / 2 + 0.05 },
    { x: CAR_LENGTH / 2 - 0.6, z: -CAR_WIDTH / 2 - 0.05 },
    { x: -CAR_LENGTH / 2 + 0.6, z: CAR_WIDTH / 2 + 0.05 },
    { x: -CAR_LENGTH / 2 + 0.6, z: -CAR_WIDTH / 2 - 0.05 },
  ];

  const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.2, 8);
  wheelGeo.rotateX(Math.PI / 2);

  for (const wp of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo.clone(), materials.tire);
    wheel.position.set(wp.x, WHEEL_RADIUS, wp.z);
    group.add(wheel);
  }

  // Headlights
  const hlGeo = new THREE.BoxGeometry(0.05, 0.15, 0.3);
  const hlL = new THREE.Mesh(hlGeo, materials.headlight);
  hlL.position.set(CAR_LENGTH / 2, CAR_HEIGHT * 0.6, CAR_WIDTH / 2 - 0.3);
  group.add(hlL);
  const hlR = new THREE.Mesh(hlGeo.clone(), materials.headlight);
  hlR.position.set(CAR_LENGTH / 2, CAR_HEIGHT * 0.6, -CAR_WIDTH / 2 + 0.3);
  group.add(hlR);

  return group;
}
