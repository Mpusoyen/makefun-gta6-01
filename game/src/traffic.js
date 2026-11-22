// The living city: traffic cars that drive the road grid keeping right, braking for
// whatever is ahead of them, and pedestrians who stroll the sidewalks, wait to cross and
// run from danger. Both are simple waypoint drivers over the same physics the player uses.
import { CAR_COLORS, CITY, LANE } from './config.js';
import { angleDelta, clamp, dist } from './rng.js';
import { makeCar, stepCar, axleCircles, circleRectPush } from './vehicles.js';
import { roadCenterX, roadCenterY, sidewalkPoint } from './city.js';

const SHIRT_COLORS = ['#e2e0d8', '#c94f6d', '#4f83c9', '#57a773', '#e0a51f', '#8d6fc0', '#d97b3f', '#3fb8b0', '#a8a29a', '#705a48'];

/** A random point on a random road, in a lane, facing along it. */
function roadSpawn(rng) {
  if (rng.chance(0.5)) {
    const i = rng.int(0, CITY.cols);
    const dirY = rng.chance(0.5) ? 1 : -1;
    const cx = roadCenterX(i);
    return { x: cx + (dirY > 0 ? -LANE : LANE), y: rng.range(60, CITY.height - 60), dirX: 0, dirY };
  }
  const j = rng.int(0, CITY.rows);
  const dirX = rng.chance(0.5) ? 1 : -1;
  const cy = roadCenterY(j);
  return { x: rng.range(60, CITY.width - 60), y: cy + (dirX > 0 ? LANE : -LANE), dirX, dirY: 0 };
}

export function spawnTrafficCar(world, avoid) {
  const rng = world.rng;
  for (let tries = 0; tries < 12; tries += 1) {
    const s = roadSpawn(rng);
    if (avoid && dist(s.x, s.y, avoid.x, avoid.y) < 260) continue;
    const car = makeCar({
      x: s.x, y: s.y,
      angle: Math.atan2(s.dirY, s.dirX),
      color: rng.pick(CAR_COLORS),
      kind: 'civil',
      maxSpeed: rng.range(240, 290),
    });
    car.driver = 'ai';
    car.ai = { dirX: s.dirX, dirY: s.dirY, cruise: rng.range(125, 172), junction: '', blockedTime: 0 };
    world.cars.push(car);
    return car;
  }
  return null;
}

export function spawnPed(world) {
  const rng = world.rng;
  const col = rng.int(0, CITY.cols - 1);
  const row = rng.int(0, CITY.rows - 1);
  const p = sidewalkPoint(rng, col, row);
  const ped = {
    x: p.x, y: p.y,
    angle: rng.range(0, Math.PI * 2),
    speed: 0,
    mode: 'walk',
    target: null,
    waitTime: rng.range(0, 2),
    fleeFrom: null, fleeTime: 0, downTime: 0,
    walkSpeed: rng.range(58, 88),
    color: rng.pick(SHIRT_COLORS),
    seed: rng.int(1, 1e9),
  };
  world.peds.push(ped);
  return ped;
}

/** The junction key a car is inside, or '' when it is mid-block. */
function junctionKey(car) {
  const inV = car.x % CITY.pitch < CITY.road;
  const inH = car.y % CITY.pitch < CITY.road;
  if (!inV || !inH) return '';
  return `${Math.floor(car.x / CITY.pitch)}:${Math.floor(car.y / CITY.pitch)}`;
}

/** What is in front of a car: the nearest car or pedestrian inside its lane corridor. */
function obstacleAhead(world, car, lookAhead) {
  const hx = Math.cos(car.angle);
  const hy = Math.sin(car.angle);
  let nearest = Infinity;
  const probe = (x, y, pad) => {
    const dx = x - car.x;
    const dy = y - car.y;
    const fwd = dx * hx + dy * hy;
    const lat = Math.abs(-dx * hy + dy * hx);
    if (fwd > 4 && fwd < lookAhead && lat < 17) nearest = Math.min(nearest, fwd - pad);
  };
  for (const other of world.cars) {
    if (other === car) continue;
    for (const c of axleCircles(other)) probe(c.x, c.y, c.r);
  }
  for (const ped of world.peds) {
    if (ped.mode !== 'down') probe(ped.x, ped.y, 6);
  }
  return nearest;
}

function driveTrafficCar(world, car, dt) {
  const ai = car.ai;
  // Junction choice: on entering a junction, maybe turn. The new heading must follow a road.
  const key = junctionKey(car);
  if (key && key !== ai.junction) {
    ai.junction = key;
    const roll = world.rng.next();
    if (roll > 0.55) {
      const turn = roll > 0.78 ? 1 : -1;
      const ndx = turn * ai.dirY;
      const ndy = -turn * ai.dirX;
      // Only turn when the way on exists (it always does on the full grid, but the
      // car must be near the junction centre to make the corner).
      ai.dirX = ndx; ai.dirY = ndy;
    }
  } else if (!key) {
    ai.junction = '';
  }

  // Aim at a point ahead, pulled onto this direction's lane centre line.
  let tx = car.x + ai.dirX * 85;
  let ty = car.y + ai.dirY * 85;
  if (ai.dirY !== 0) {
    const i = Math.round((car.x - CITY.road / 2) / CITY.pitch);
    tx = roadCenterX(clamp(i, 0, CITY.cols)) + (ai.dirY > 0 ? -LANE : LANE);
  } else {
    const j = Math.round((car.y - CITY.road / 2) / CITY.pitch);
    ty = roadCenterY(clamp(j, 0, CITY.rows)) + (ai.dirX > 0 ? LANE : -LANE);
  }
  const wanted = Math.atan2(ty - car.y, tx - car.x);
  car.steer = clamp(angleDelta(car.angle, wanted) * 2.6, -1, 1);

  // Slow for corners, stop for obstacles.
  let target = ai.cruise * (Math.abs(angleDelta(car.angle, wanted)) > 0.5 ? 0.55 : 1);
  const gap = obstacleAhead(world, car, 62);
  if (gap < 26) target = 0;
  else if (gap < 52) target = Math.min(target, 55);
  if (car.speed < target - 6) car.throttle = 0.85;
  else if (car.speed > target + 4) car.throttle = target === 0 ? -0.9 : -0.25;
  else car.throttle = 0.12;

  if (Math.abs(car.speed) < 4 && target === 0) ai.blockedTime += dt;
  else ai.blockedTime = 0;
  stepCar(car, dt);

  // A car boxed in for a long while quietly leaves and rejoins across town, so a
  // abandoned wreck can never freeze the whole city's traffic.
  if (ai.blockedTime > 12) {
    const s = roadSpawn(world.rng);
    car.x = s.x; car.y = s.y; car.angle = Math.atan2(s.dirY, s.dirX);
    ai.dirX = s.dirX; ai.dirY = s.dirY; ai.blockedTime = 0; car.speed = 0;
  }
}

export function updateTraffic(world, dt) {
  for (const car of world.cars) {
    if (car.kind === 'civil' && car.driver === 'ai') driveTrafficCar(world, car, dt);
  }
}

/** Send a pedestrian running from a point: crashes and crimes nearby do this. */
export function scarePeds(world, x, y, radius) {
  for (const ped of world.peds) {
    if (ped.mode === 'down') continue;
    if (dist(ped.x, ped.y, x, y) < radius) {
      ped.mode = 'flee';
      ped.fleeFrom = { x, y };
      ped.fleeTime = world.rng.range(1.4, 2.6);
    }
  }
}

function updatePed(world, ped, dt) {
  const rng = world.rng;
  if (ped.mode === 'down') {
    ped.downTime -= dt;
    ped.speed = 0;
    if (ped.downTime <= 0) {
      ped.mode = 'flee';
      ped.fleeTime = 2;
      ped.fleeFrom = ped.fleeFrom ?? { x: ped.x + 30, y: ped.y };
    }
    return;
  }

  // Danger sense: a fast car close by, or a scare still fresh, sends them running.
  if (ped.mode !== 'flee') {
    for (const car of world.cars) {
      if (Math.abs(car.speed) < 95) continue;
      const d = dist(ped.x, ped.y, car.x, car.y);
      if (d < 92) {
        const toward = (car.x - ped.x) * Math.cos(car.angle) + (car.y - ped.y) * Math.sin(car.angle);
        if (toward > -20) {
          ped.mode = 'flee';
          ped.fleeFrom = { x: car.x, y: car.y };
          ped.fleeTime = rng.range(1.2, 2.2);
          break;
        }
      }
    }
  }

  let tx;
  let ty;
  let speed;
  if (ped.mode === 'flee' && ped.fleeFrom) {
    ped.fleeTime -= dt;
    if (ped.fleeTime <= 0) { ped.mode = 'walk'; ped.target = null; }
    const away = Math.atan2(ped.y - ped.fleeFrom.y, ped.x - ped.fleeFrom.x);
    tx = ped.x + Math.cos(away) * 120;
    ty = ped.y + Math.sin(away) * 120;
    speed = 228;
  } else {
    if (ped.waitTime > 0) {
      ped.waitTime -= dt;
      ped.speed = 0;
      return;
    }
    if (!ped.target || dist(ped.x, ped.y, ped.target.x, ped.target.y) < 12) {
      if (rng.chance(0.2)) { ped.waitTime = rng.range(0.6, 2.4); ped.target = null; return; }
      const col = clamp(Math.floor(ped.x / CITY.pitch) + rng.int(-1, 1), 0, CITY.cols - 1);
      const row = clamp(Math.floor(ped.y / CITY.pitch) + rng.int(-1, 1), 0, CITY.rows - 1);
      ped.target = sidewalkPoint(rng, col, row);
    }
    tx = ped.target.x;
    ty = ped.target.y;
    speed = ped.walkSpeed;
  }

  const wanted = Math.atan2(ty - ped.y, tx - ped.x);
  ped.angle += clamp(angleDelta(ped.angle, wanted), -6 * dt, 6 * dt);
  ped.speed = speed;
  ped.x += Math.cos(ped.angle) * speed * dt;
  ped.y += Math.sin(ped.angle) * speed * dt;

  // Buildings are solid to walkers too: slide out along the push.
  for (const b of world.city.buildings) {
    const push = circleRectPush(ped.x, ped.y, 8, b);
    if (push) { ped.x += push.x; ped.y += push.y; }
  }
  ped.x = clamp(ped.x, 10, CITY.width - 10);
  ped.y = clamp(ped.y, 10, CITY.height - 10);
}

export function updatePeds(world, dt) {
  for (const ped of world.peds) updatePed(world, ped, dt);
}
