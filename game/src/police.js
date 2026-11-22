// The heat: crimes the city sees raise it, hiding lowers it, and the Palmera police
// answer it — patrol cars spawn on the roads around the player, hunt, ram, and try to
// hold the player still long enough to make the bust. Lose every tail and the stars
// blink out one by one; Reyes' spray bay wipes them for cash.
import { CITY, HEAT } from './config.js';
import { angleDelta, clamp, dist } from './rng.js';
import { makeCar, stepCar } from './vehicles.js';
import { roadCenterX, roadCenterY } from './city.js';

export const starsOf = (heat) => (heat <= 0.05 ? 0 : Math.min(5, Math.ceil(heat)));

/** How many patrol cars a star level sends. */
const POLICE_FOR_STARS = [0, 1, 2, 3, 4, 5];

/** Did anyone see it? A pedestrian in earshot, or any police car in sight. */
export function witnessed(world, x, y, radius = HEAT.witnessRadius) {
  for (const ped of world.peds) {
    if (ped.mode !== 'down' && dist(ped.x, ped.y, x, y) < radius) return true;
  }
  for (const car of world.cars) {
    if (car.kind === 'police' && dist(car.x, car.y, x, y) < HEAT.policeSight) return true;
  }
  return false;
}

/** Register a crime: heat rises by the witnessed or the quiet amount, and the clock restarts. */
export function commitCrime(world, kind, x, y) {
  let amount;
  if (kind === 'steal') amount = witnessed(world, x, y) ? HEAT.stealWitnessed : HEAT.stealUnseen;
  else if (kind === 'hitCar') amount = witnessed(world, x, y) ? HEAT.hitCar : HEAT.hitCarUnseen;
  else amount = HEAT.hitPed; // knocking someone down is never quiet
  const before = starsOf(world.heat);
  world.heat = clamp(world.heat + amount, 0, HEAT.max);
  world.lastCrimeAt = world.time;
  if (starsOf(world.heat) > before) world.say(`Wanted level ${starsOf(world.heat)} — the police are coming.`);
}

function spawnPolice(world) {
  const rng = world.rng;
  const p = world.focus();
  for (let tries = 0; tries < 14; tries += 1) {
    const vertical = rng.chance(0.5);
    const i = rng.int(0, CITY.cols);
    const j = rng.int(0, CITY.rows);
    const x = vertical ? roadCenterX(i) : rng.range(80, CITY.width - 80);
    const y = vertical ? rng.range(80, CITY.height - 80) : roadCenterY(j);
    const d = dist(x, y, p.x, p.y);
    if (d < 500 || d > 860) continue;
    const car = makeCar({
      x, y,
      angle: Math.atan2(p.y - y, p.x - x),
      color: '#eef1f4', kind: 'police', maxSpeed: 322,
    });
    car.driver = 'ai';
    car.ai = { mode: 'pursue', stuckTime: 0, reverseTime: 0 };
    world.cars.push(car);
    return car;
  }
  return null;
}

function drivePolice(world, car, dt) {
  const ai = car.ai;
  const target = world.focus();
  const d = dist(car.x, car.y, target.x, target.y);
  const wanted = Math.atan2(target.y - car.y, target.x - car.x);
  const delta = angleDelta(car.angle, wanted);

  // Aim a little ahead of a moving target; on foot, pull up beside them, not over them.
  const onFoot = !world.player.car;
  let throttle = 1;
  if (ai.reverseTime > 0) {
    ai.reverseTime -= dt;
    throttle = -1;
    car.steer = -Math.sign(delta || 1);
  } else {
    car.steer = clamp(delta * 2.4, -1, 1);
    if (onFoot && d < 74) throttle = d < 46 ? -0.4 : 0.25;
    else if (!onFoot && d < 60) throttle = 0.55; // sit on their bumper
    if (Math.abs(delta) > 2.4) throttle = 0.4; // target is behind: swing round
  }
  car.throttle = throttle;
  stepCar(car, dt);

  // Stuck on a wall? Back out and try again.
  if (Math.abs(car.speed) < 9 && throttle > 0.5) {
    ai.stuckTime += dt;
    if (ai.stuckTime > 1.1) { ai.reverseTime = 0.65; ai.stuckTime = 0; }
  } else ai.stuckTime = 0;

  if (d < HEAT.policeSight) world.seenByPolice = true;
}

/**
 * Advance the whole wanted machine one step: police numbers follow the stars, sight
 * keeps the heat alive, hiding lets it bleed away.
 */
export function updateWanted(world, dt) {
  world.seenByPolice = false;
  const stars = starsOf(world.heat);
  const police = world.cars.filter((c) => c.kind === 'police');

  for (const car of police) drivePolice(world, car, dt);

  // Numbers: too few, send more (on a short cooldown); far too many for the stars
  // and the extras peel off and despawn.
  world.policeCooldown -= dt;
  if (police.length < POLICE_FOR_STARS[stars] && world.policeCooldown <= 0) {
    if (spawnPolice(world)) world.policeCooldown = 1.6;
  }
  if (stars === 0) {
    for (const car of police) {
      if (dist(car.x, car.y, world.focus().x, world.focus().y) > 620) car.gone = true;
    }
  }
  if (world.cars.some((c) => c.gone)) world.cars = world.cars.filter((c) => !c.gone);

  // The heat clock: being seen holds it; hiding drains it.
  if (world.seenByPolice || world.time - world.lastCrimeAt < 2.5) {
    world.unseenTime = 0;
    world.decaying = false;
  } else {
    world.unseenTime += dt;
    world.decaying = world.heat > 0 && world.unseenTime > HEAT.hideSeconds;
    if (world.decaying) {
      world.heat = Math.max(0, world.heat - HEAT.decayPerSecond * dt);
      if (world.heat === 0) world.say('You lost them. The heat is off — for now.');
    }
  }
}
