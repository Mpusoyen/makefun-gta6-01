// The screenshot scenes behind ?shot=chase|drive|mission|foot. Each stages a real moment
// of the game — a police chase at three stars, a cruise across town on a courier run, a
// parcel pickup, a car about to be stolen — directly in the world state, then the caller
// steps the world forward with a fixed input so the frame is a game honestly in motion,
// the same from the same seed every time.
import { STEP } from './config.js';
import { makeCar } from './vehicles.js';
import { roadCenterY } from './city.js';
import { startMission } from './missions.js';
import { dist } from './rng.js';

const IDLE = { moveX: 0, moveY: 0, steer: 0, throttle: 0, run: false, brake: false, enter: false };
const DRIVE = { ...IDLE, throttle: 1 };

function givePlayerCar(world, x, y, angle, color, speed) {
  const car = makeCar({ x, y, angle, color, kind: 'civil' });
  car.driver = 'player';
  car.speed = speed;
  world.cars.push(car);
  world.player.car = car;
  world.player.x = x;
  world.player.y = y;
  world.camera.x = x;
  world.camera.y = y;
  return car;
}

function addPolice(world, x, y, angle, speed) {
  const car = makeCar({ x, y, angle, color: '#eef1f4', kind: 'police', maxSpeed: 322 });
  car.driver = 'ai';
  car.ai = { mode: 'pursue', stuckTime: 0, reverseTime: 0 };
  car.speed = speed;
  world.cars.push(car);
  return car;
}

function addTraffic(world, x, y, dirX) {
  const car = makeCar({ x, y, angle: Math.atan2(0, dirX), color: '#3fb8b0', kind: 'civil' });
  car.driver = 'ai';
  car.ai = { dirX, dirY: 0, cruise: 148, junction: '', blockedTime: 0 };
  car.speed = 130;
  world.cars.push(car);
  return car;
}

/** Stage the named scene in `world`; returns how many steps to run and with what input. */
export function stageShot(name, world) {
  const avenue = roadCenterY(2); // the long east-west avenue through the middle of town

  if (name === 'drive') {
    world.stage = 3; // story done: a courier run is on
    givePlayerCar(world, 1560, roadCenterY(3) + 19, Math.PI, '#3fb8b0', 168);
    startMission(world);
    // A clear stretch of avenue ahead, so the shot is a cruise, not a pile-up.
    world.cars = world.cars.filter((c) => c === world.player.car || c.parked
      || dist(c.x, c.y, world.player.x, world.player.y) > 560);
    return { steps: 55, input: { ...IDLE, throttle: 0.85 } };
  }

  if (name === 'mission') {
    world.stage = 1;
    startMission(world); // Four Parcels
    // Stage the most central parcel, so the shot frames player and objective together.
    let best = 0;
    let bestScore = -Infinity;
    world.mission.targets.forEach((t, i) => {
      const score = -Math.abs(t.x - 1130) - Math.abs(t.y - 974);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    world.mission.targetIndex = best;
    world.mission.timer = 96;
    const t = world.mission.targets[best];
    world.player.x = t.x - 62;
    world.player.y = t.y + 24;
    world.player.angle = Math.atan2(t.y - world.player.y, t.x - world.player.x);
    world.camera.x = world.player.x;
    world.camera.y = world.player.y;
    world.objective = { ...t, label: 'parcel 2 of 4' };
    return { steps: 24, input: IDLE };
  }

  if (name === 'foot') {
    const parked = makeCar({ x: 776, y: avenue + 8, angle: 0, color: '#d94f3d', kind: 'civil' });
    parked.parked = true;
    world.cars.push(parked);
    world.player.x = 726;
    world.player.y = avenue + 18;
    world.player.angle = 0;
    world.camera.x = world.player.x;
    world.camera.y = world.player.y;
    world.heat = 1.0;
    world.lastCrimeAt = 0;
    addPolice(world, 420, avenue, 0, 190);
    return { steps: 26, input: IDLE };
  }

  // 'chase' — the cover: three stars on the avenue, the docks run on the clock.
  startMission(world); // Hot Wheels, stage 'steal'
  givePlayerCar(world, 905, avenue + 19, 0, '#e0a51f', 238);
  world.mission.stage = 'drive';
  world.mission.timer = 74;
  world.objective = { ...world.city.docks, label: 'the docks' };
  world.heat = 3.2;
  world.lastCrimeAt = 0;
  addPolice(world, 688, avenue + 12, 0, 246);
  addPolice(world, 612, avenue + 30, 0, 252);
  addPolice(world, 742, avenue - 22, 0, 232);
  addTraffic(world, 1310, avenue + 19, 1);
  addTraffic(world, 1620, avenue - 19, -1);
  return { steps: 55, input: DRIVE };
}

export { STEP };
