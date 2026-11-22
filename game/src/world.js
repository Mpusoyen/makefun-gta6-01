// The world: every moving thing in Palmera and the rules that bind them. Owns the
// player (on foot and behind the wheel), all cars and pedestrians, collisions, crimes,
// damage, the bust, the spray bay and the camera. Rendering and sound live elsewhere;
// this file only changes state, in fixed steps, and reports what happened as events.
import { CAR_COLORS, CITY, FOOT, HEAT } from './config.js';
import { clamp, dist } from './rng.js';
import { makeRng } from './rng.js';
import { buildCity, roadCenterX, roadCenterY } from './city.js';
import { makeCar, stepCar, collideCarWithCity, collideCars, axleCircles, circleRectPush, nearCar } from './vehicles.js';
import { spawnTrafficCar, spawnPed, updateTraffic, updatePeds, scarePeds } from './traffic.js';
import { commitCrime, starsOf, updateWanted } from './police.js';
import { startMission, updateMission } from './missions.js';

export const EV = { CRASH: 1, STEAL: 2, CASH: 4, BUSTED: 8, WASTED: 16, SPRAY: 32 };

const TRAFFIC_TARGET = 13;
const PED_TARGET = 40;

export function createWorld(seed, saved) {
  const rng = makeRng(seed);
  const city = buildCity(rng);
  const world = {
    rng, city,
    time: 0,
    player: {
      x: roadCenterX(2) - 19, y: roadCenterY(2) + 50,
      angle: -Math.PI / 2, car: null, health: 100, bust: 0, lastHurtAt: -99,
    },
    cars: [], peds: [], particles: [], messages: [],
    cash: saved?.cash ?? 60,
    stage: saved?.stage ?? 0,
    endless: saved?.endless ?? 0,
    heat: 0, lastCrimeAt: -99, unseenTime: 0, decaying: false, seenByPolice: false,
    policeCooldown: 0, sprayCooldown: 0, trafficTimer: 0,
    mission: null, objective: null, missionEvents: 0,
    events: 0, prompt: '', dirty: false,
    camera: { x: 0, y: 0 },
    solids: [...city.buildings, ...city.crates],

    focus() { return this.player.car ?? this.player; },
    say(text) {
      this.messages.push({ text, at: this.time });
      if (this.messages.length > 4) this.messages.shift();
    },
  };
  world.camera.x = world.player.x;
  world.camera.y = world.player.y;

  // Parked cars at the curbs, waiting to be stolen.
  const spots = [...city.parking];
  for (let i = spots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  for (const spot of spots.slice(0, 16)) {
    const car = makeCar({ x: spot.x, y: spot.y, angle: spot.angle, color: rng.pick(CAR_COLORS), kind: 'civil' });
    car.parked = true;
    world.cars.push(car);
  }
  for (let i = 0; i < TRAFFIC_TARGET; i += 1) spawnTrafficCar(world, world.player);
  for (let i = 0; i < PED_TARGET; i += 1) spawnPed(world);

  world.step = (input, dt) => stepWorld(world, input, dt);
  world.applyPenalty = (kind) => applyPenalty(world, kind);
  return world;
}

function sparks(world, x, y, n, color) {
  for (let i = 0; i < n; i += 1) {
    const a = world.rng.range(0, Math.PI * 2);
    const s = world.rng.range(30, 130);
    world.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: world.rng.range(0.25, 0.6), max: 0.6, size: world.rng.range(1.5, 3), color, kind: 'spark' });
  }
}

function enterCar(world, car) {
  const player = world.player;
  if (car.driver === 'ai' && car.kind === 'civil') {
    // Yank the driver out: they hit the pavement and run.
    const ped = spawnPed(world);
    ped.x = car.x + 16; ped.y = car.y + 10;
    ped.mode = 'flee'; ped.fleeFrom = { x: player.x, y: player.y }; ped.fleeTime = 2.4;
    world.say('You yank the driver out. The whole street saw that.');
  }
  commitCrime(world, 'steal', car.x, car.y);
  if (car.kind === 'police') {
    world.heat = clamp(world.heat + 0.6, 0, HEAT.max);
    world.say('Stealing a patrol car — bold. Very bold.');
  }
  car.driver = 'player';
  car.parked = false;
  car.ai = null;
  player.car = car;
  world.events |= EV.STEAL;
}

function exitCar(world) {
  const player = world.player;
  const car = player.car;
  if (!car) return;
  const side = world.rng.chance(0.5) ? 1 : -1;
  for (const s of [side, -side]) {
    const px = car.x + Math.cos(car.angle + Math.PI / 2) * s * (car.wid / 2 + 15);
    const py = car.y + Math.sin(car.angle + Math.PI / 2) * s * (car.wid / 2 + 15);
    let blocked = false;
    for (const b of world.solids) if (circleRectPush(px, py, FOOT.radius, b)) { blocked = true; break; }
    if (!blocked) { player.x = px; player.y = py; break; }
  }
  player.angle = car.angle;
  car.driver = null;
  car.throttle = 0;
  car.steer = 0;
  player.car = null;
}

function nearestStealable(world) {
  const p = world.player;
  let best = null;
  let bestD = Infinity;
  for (const car of world.cars) {
    if (car.driver === 'player') continue;
    const d = dist(p.x, p.y, car.x, car.y);
    if (d < FOOT.enterRange + car.len / 2 && d < bestD) { best = car; bestD = d; }
  }
  return best;
}

function hurtPlayer(world, amount, atX, atY) {
  const player = world.player;
  player.health -= amount;
  player.lastHurtAt = world.time;
  if (atX !== undefined) {
    const a = Math.atan2(player.y - atY, player.x - atX);
    if (!player.car) { player.x += Math.cos(a) * 22; player.y += Math.sin(a) * 22; }
  }
  if (player.health <= 0 && !(world.events & EV.WASTED)) world.events |= EV.WASTED;
}

function stepPlayer(world, input, dt) {
  const player = world.player;
  if (input.enter) {
    if (player.car) {
      if (Math.abs(player.car.speed) < 170) exitCar(world);
    } else {
      const car = nearestStealable(world);
      if (car) enterCar(world, car);
      else if (dist(player.x, player.y, world.city.val.x, world.city.val.y) < 50 && !world.mission) {
        startMission(world);
      }
    }
  }

  if (player.car) {
    const car = player.car;
    car.throttle = input.throttle;
    car.steer = input.steer;
    stepCar(car, dt);
    const impact = collideCarWithCity(car, world.solids);
    if (impact > 105) {
      car.health -= (impact - 95) * 0.10;
      world.events |= EV.CRASH;
      sparks(world, car.x, car.y, Math.min(14, impact / 14), '#ffcf6e');
      scarePeds(world, car.x, car.y, 190);
      if (impact > 200) hurtPlayer(world, (impact - 190) * 0.05);
    }
    player.x = car.x; player.y = car.y; player.angle = car.angle;
    return;
  }

  // On foot.
  const mag = Math.hypot(input.moveX, input.moveY);
  if (mag > 0.01) {
    const speed = input.run ? FOOT.runSpeed : FOOT.walkSpeed;
    player.angle = Math.atan2(input.moveY, input.moveX);
    player.x += (input.moveX / mag) * speed * dt;
    player.y += (input.moveY / mag) * speed * dt;
  }
  for (const b of world.solids) {
    const push = circleRectPush(player.x, player.y, FOOT.radius, b);
    if (push) { player.x += push.x; player.y += push.y; }
  }
  for (const t of world.city.trees) {
    const d = dist(player.x, player.y, t.x, t.y);
    if (d < FOOT.radius + t.r * 0.5 && d > 0.01) {
      player.x += ((player.x - t.x) / d) * (FOOT.radius + t.r * 0.5 - d);
      player.y += ((player.y - t.y) / d) * (FOOT.radius + t.r * 0.5 - d);
    }
  }
  player.x = clamp(player.x, 10, CITY.width - 10);
  player.y = clamp(player.y, 10, CITY.height - 10);
}

function stepCollisions(world) {
  const cars = world.cars;
  // Every moving car meets the buildings.
  for (const car of cars) {
    if (car.parked || Math.abs(car.speed) < 1) continue;
    if (car.driver === 'player') continue; // the player's car already met them
    const impact = collideCarWithCity(car, world.solids);
    if (impact > 120) {
      car.health -= (impact - 100) * 0.08;
      sparks(world, car.x, car.y, 8, '#ffcf6e');
    }
  }
  // Cars meet each other.
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i];
      const b = cars[j];
      if (a.parked && b.parked) continue;
      const impact = collideCars(a, b);
      if (impact < 60) continue;
      sparks(world, (a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(16, impact / 12), '#ffb35c');
      if (impact > 110) {
        a.health -= (impact - 100) * 0.09;
        b.health -= (impact - 100) * 0.09;
        world.events |= EV.CRASH;
        scarePeds(world, a.x, a.y, 200);
      }
      const playerCar = world.player.car;
      if (playerCar && (a === playerCar || b === playerCar)) {
        const other = a === playerCar ? b : a;
        if (other.kind === 'civil' && impact > 125 && other.hitCooldown <= 0) {
          commitCrime(world, 'hitCar', other.x, other.y);
          other.hitCooldown = 1.4;
        }
        if (impact > 210) hurtPlayer(world, (impact - 200) * 0.05);
      }
      // A civilian driver whose car is wrecked bails out and runs.
      for (const c of [a, b]) {
        if (c.kind === 'civil' && c.driver === 'ai' && c.health < 22) {
          const ped = spawnPed(world);
          ped.x = c.x + 14; ped.y = c.y;
          ped.mode = 'flee'; ped.fleeFrom = { x: world.focus().x, y: world.focus().y }; ped.fleeTime = 2.6;
          c.driver = null;
          c.ai = null;
          world.say('The driver bails out and runs.');
        }
      }
    }
  }
  // Cars meet pedestrians, and meet the player on foot.
  for (const car of cars) {
    if (Math.abs(car.speed) < 52) continue;
    for (const c of axleCircles(car)) {
      for (const ped of world.peds) {
        if (ped.mode === 'down') continue;
        if (dist(ped.x, ped.y, c.x, c.y) < c.r + 8) {
          ped.mode = 'down';
          ped.downTime = 4;
          ped.fleeFrom = { x: car.x, y: car.y };
          ped.x += Math.cos(car.angle) * 16;
          ped.y += Math.sin(car.angle) * 16;
          if (car.driver === 'player') {
            commitCrime(world, 'hitPed', ped.x, ped.y);
            world.events |= EV.CRASH;
            car.speed *= 0.55;
          }
        }
      }
      const p = world.player;
      if (!p.car && dist(p.x, p.y, c.x, c.y) < c.r + FOOT.radius) {
        hurtPlayer(world, (Math.abs(car.speed) - 45) * 0.075, car.x, car.y);
        world.events |= EV.CRASH;
      }
    }
  }
}

function stepBustAndSpray(world, dt) {
  const player = world.player;
  const stars = starsOf(world.heat);
  // The bust: police close to a player who cannot drive away.
  const vulnerable = !player.car || player.car.health <= 0;
  let nearCop = false;
  if (stars > 0 && vulnerable) {
    for (const car of world.cars) {
      if (car.kind === 'police' && dist(car.x, car.y, player.x, player.y) < 64) { nearCop = true; break; }
    }
  }
  if (nearCop) {
    player.bust = Math.min(1, player.bust + dt / 1.5);
    if (player.bust >= 1 && !(world.events & EV.BUSTED)) world.events |= EV.BUSTED;
  } else {
    player.bust = Math.max(0, player.bust - dt * 0.6);
  }

  // Reyes' spray bay: money for a clean slate and a straightened car.
  world.sprayCooldown -= dt;
  const spray = world.city.spray;
  if (player.car
    && player.x > spray.x - 6 && player.x < spray.x + spray.w + 6
    && player.y > spray.y - 6 && player.y < spray.y + spray.h + 6) {
    if ((world.heat > 0 || player.car.health < 100) && world.sprayCooldown <= 0) {
      if (world.cash >= 150) {
        world.cash -= 150;
        world.heat = 0;
        world.lastCrimeAt = -99;
        player.car.health = 100;
        player.car.color = world.rng.pick(CAR_COLORS);
        world.sprayCooldown = 4;
        world.events |= EV.SPRAY;
        world.dirty = true;
        world.say('Reyes works fast: new paint, straight panels, no heat. -$150.');
      } else {
        world.prompt = 'Respray and lose the heat: $150 — you are short.';
      }
    }
  }
}

function stepPrompt(world) {
  const player = world.player;
  if (world.prompt.startsWith('Respray')) return; // the spray bay already spoke
  if (player.car) {
    world.prompt = Math.abs(player.car.speed) < 170 ? 'F — get out' : '';
    return;
  }
  const car = nearestStealable(world);
  if (car) {
    world.prompt = car.kind === 'police' ? 'F — steal the patrol car' : car.driver === 'ai' ? 'F — pull the driver out' : 'F — steal this car';
  } else if (!world.mission && dist(player.x, player.y, world.city.val.x, world.city.val.y) < 50) {
    world.prompt = 'F — talk to Val';
  } else world.prompt = '';
}

function stepParticles(world, dt) {
  // Damaged cars smoke.
  for (const car of world.cars) {
    if (car.health < 38 && car.health > 0 && world.rng.chance(0.3)) {
      world.particles.push({ x: car.x + world.rng.range(-8, 8), y: car.y + world.rng.range(-8, 8), vx: world.rng.range(-6, 6), vy: world.rng.range(-26, -14), life: world.rng.range(0.7, 1.3), max: 1.3, size: world.rng.range(5, 10), color: '#55525e', kind: 'smoke' });
    }
    if (car.health <= 0 && world.rng.chance(0.5)) {
      world.particles.push({ x: car.x + world.rng.range(-8, 8), y: car.y - 4, vx: 0, vy: -20, life: 0.5, max: 0.5, size: world.rng.range(4, 8), color: '#e2703a', kind: 'smoke' });
    }
  }
  for (let i = world.particles.length - 1; i >= 0; i -= 1) {
    const p = world.particles[i];
    p.life -= dt;
    if (p.life <= 0) { world.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === 'smoke') p.size += 9 * dt;
  }
}

function stepWorld(world, input, dt) {
  world.time += dt;
  world.events = 0;
  world.missionEvents = 0;
  world.prompt = '';

  stepPlayer(world, input, dt);
  updateTraffic(world, dt);
  updateWanted(world, dt);
  stepCollisions(world);
  updatePeds(world, dt);
  updateMission(world, dt);
  stepBustAndSpray(world, dt);
  stepPrompt(world);
  stepParticles(world, dt);

  // Keep the city's population topped up.
  world.trafficTimer -= dt;
  if (world.trafficTimer <= 0) {
    world.trafficTimer = 2.5;
    const aiCars = world.cars.filter((c) => c.kind === 'civil' && c.driver === 'ai').length;
    if (aiCars < TRAFFIC_TARGET - 3) spawnTrafficCar(world, world.focus());
    while (world.peds.length < PED_TARGET - 4) spawnPed(world);
  }

  // Health creeps back once the trouble is past.
  const player = world.player;
  if (world.time - player.lastHurtAt > 6 && player.health > 0) {
    player.health = Math.min(100, player.health + 3.2 * dt);
  }

  // Camera: follow the focus with a lean into its motion.
  const f = world.focus();
  const lead = player.car ? 0.34 : 0.12;
  const tx = f.x + Math.cos(f.angle) * (player.car ? Math.abs(player.car.speed) * lead : 0);
  const ty = f.y + Math.sin(f.angle) * (player.car ? Math.abs(player.car.speed) * lead : 0);
  const k = 1 - Math.exp(-4.6 * dt);
  world.camera.x += (tx - world.camera.x) * k;
  world.camera.y += (ty - world.camera.y) * k;
  world.camera.x = clamp(world.camera.x, 640, CITY.width - 640);
  world.camera.y = clamp(world.camera.y, 400, CITY.height - 400);
}

/** After a bust or a wreck: pay up, wake up somewhere official, heat gone. */
export function applyPenalty(world, kind) {
  const player = world.player;
  const stars = starsOf(world.heat);
  if (player.car) {
    player.car.driver = null;
    player.car.throttle = 0;
    player.car = null;
  }
  if (kind === 'busted') {
    const fine = Math.min(world.cash, 120 + 90 * stars);
    world.cash -= fine;
    world.say(`Busted. The fine is $${fine} and the car is impounded.`);
    player.x = world.city.station.x;
    player.y = world.city.station.y;
  } else {
    const bill = Math.min(world.cash, Math.max(50, Math.round(world.cash * 0.1)));
    world.cash -= bill;
    world.say(`You wake at the hospital. The bill is $${bill}.`);
    player.x = world.city.hospital.x;
    player.y = world.city.hospital.y;
  }
  world.heat = 0;
  world.lastCrimeAt = -99;
  player.health = 100;
  player.bust = 0;
  world.cars = world.cars.filter((c) => c.kind !== 'police');
  world.camera.x = player.x;
  world.camera.y = player.y;
  world.dirty = true;
}
