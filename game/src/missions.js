// Val's jobs: a short story in three missions, then endless courier runs. Val stands on
// her corner by the park; walk into her marker to take the next job. Each mission drives
// the HUD's objective marker and pays cash into the save.
import { CITY } from './config.js';
import { dist } from './rng.js';
import { sidewalkPoint } from './city.js';

export const EVENTS = { DONE: 1, FAIL: 2, PICKUP: 4 };

const STORY = [
  {
    kind: 'wheels',
    title: 'Hot Wheels',
    from: 'Val',
    intro: 'Val: "My cousin needs a car at the docks before anyone asks questions. Take one — any one — and get it there."',
    pay: 250,
  },
  {
    kind: 'parcels',
    title: 'Four Parcels',
    from: 'Val',
    intro: 'Val: "Four parcels got scattered over Palmera. Pick them up, all of them, and do not open them."',
    pay: 400,
  },
  {
    kind: 'heat',
    title: 'Lose the Heat',
    from: 'Val',
    intro: 'Val: "You want work? Earn it. Get the whole city looking for you — then disappear."',
    pay: 600,
  },
];

/** The offer waiting at Val's marker: the next story mission, or a courier run. */
export function missionOffer(world) {
  if (world.stage < STORY.length) return STORY[world.stage];
  return { kind: 'courier', title: 'Courier Run', from: 'Val', intro: 'Val: "Package in the car, address on the dash. Fast and clean."' };
}

export function startMission(world) {
  const def = missionOffer(world);
  const m = { ...def, stage: 'start', timer: null, targets: [], targetIndex: 0 };
  world.mission = m;
  world.say(def.intro);
  if (def.kind === 'wheels') {
    m.stage = 'steal';
  } else if (def.kind === 'parcels') {
    m.timer = 170;
    for (let i = 0; i < 4; i += 1) {
      m.targets.push(sidewalkPoint(world.rng, world.rng.int(0, CITY.cols - 1), world.rng.int(0, CITY.rows - 1)));
    }
  } else if (def.kind === 'heat') {
    m.stage = 'escape';
    world.heat = Math.max(world.heat, 3.0);
    world.lastCrimeAt = world.time;
    world.say('Three stars. Now lose them — break sight, hide, or pay Reyes a visit.');
  } else if (def.kind === 'courier') {
    const p = world.focus();
    let target = p;
    for (let tries = 0; tries < 12; tries += 1) {
      const cand = { x: world.rng.range(140, CITY.width - 140), y: world.rng.range(140, CITY.height - 140) };
      if (dist(cand.x, cand.y, p.x, p.y) > 620) { target = cand; break; }
      target = cand;
    }
    m.targets = [target];
    const d = dist(target.x, target.y, p.x, p.y);
    m.timer = Math.round(24 + d / 10.5);
    m.pay = 90 + Math.round(d / 11);
  }
  syncObjective(world);
}

/** Keep world.objective pointing at whatever the mission needs next. */
export function syncObjective(world) {
  const m = world.mission;
  if (!m) { world.objective = null; return; }
  if (m.kind === 'wheels' && m.stage === 'drive') world.objective = { ...world.city.docks, label: 'the docks' };
  else if (m.kind === 'parcels') world.objective = { ...m.targets[m.targetIndex], label: `parcel ${m.targetIndex + 1} of 4` };
  else if (m.kind === 'courier') world.objective = { ...m.targets[0], label: 'the drop-off' };
  else world.objective = null;
}

/** The two HUD lines for the current mission (or the standing invitation). */
export function objectiveText(world) {
  const m = world.mission;
  if (!m) return { title: 'Free roam', line: 'See Val (V) by the park for work.' };
  if (m.kind === 'wheels') {
    return m.stage === 'steal'
      ? { title: m.title, line: 'Steal any car — F next to one.' }
      : { title: m.title, line: 'Get the car to the docks, south-east corner.' };
  }
  if (m.kind === 'parcels') return { title: m.title, line: `Pick up parcel ${m.targetIndex + 1} of 4.` };
  if (m.kind === 'heat') return { title: m.title, line: 'Lose the heat: reach zero stars.' };
  return { title: m.title, line: 'Reach the drop-off before the clock runs out.' };
}

function complete(world) {
  const m = world.mission;
  world.cash += m.pay;
  if (m.kind !== 'courier') world.stage += 1;
  else world.endless += 1;
  world.say(`${m.title} done — $${m.pay} in your pocket. ${world.stage < STORY.length ? 'Val has more work.' : 'Val always has another run.'}`);
  world.mission = null;
  world.objective = null;
  world.missionEvents |= EVENTS.DONE;
  world.dirty = true;
}

function fail(world, why) {
  world.say(`${world.mission.title} failed — ${why} Val shrugs: "Again, then."`);
  world.mission = null;
  world.objective = null;
  world.missionEvents |= EVENTS.FAIL;
}

/** Advance the mission one step; completions are checked against the player's focus. */
export function updateMission(world, dt) {
  const m = world.mission;
  if (!m) return;
  const p = world.focus();

  if (m.timer !== null && m.timer !== undefined) {
    m.timer -= dt;
    if (m.timer <= 0) { fail(world, 'out of time.'); return; }
  }

  if (m.kind === 'wheels') {
    if (m.stage === 'steal' && world.player.car) {
      m.stage = 'drive';
      m.timer = 100;
      world.say('Wheels acquired. The docks — south-east, by the water. Go.');
      syncObjective(world);
    } else if (m.stage === 'drive' && dist(p.x, p.y, world.city.docks.x, world.city.docks.y) < 46) {
      complete(world);
    }
  } else if (m.kind === 'parcels') {
    const t = m.targets[m.targetIndex];
    if (dist(p.x, p.y, t.x, t.y) < 34) {
      m.targetIndex += 1;
      m.timer += 15;
      world.missionEvents |= EVENTS.PICKUP;
      if (m.targetIndex >= m.targets.length) { complete(world); return; }
      world.say(`Parcel ${m.targetIndex} of 4 in hand — ${m.targets.length - m.targetIndex} to go.`);
      syncObjective(world);
    }
  } else if (m.kind === 'heat') {
    if (world.heat <= 0.05 && world.time - world.lastCrimeAt > 1) complete(world);
  } else if (m.kind === 'courier') {
    const t = m.targets[0];
    if (dist(p.x, p.y, t.x, t.y) < 40) complete(world);
  }
}
