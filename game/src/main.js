// Boot and the frame loop. Screens: title (the living city behind the panel, Enter to
// play, N for a new game), play, pause (P/Esc or when the tab hides), and the busted /
// wasted screens, which apply their penalty as you leave them. The world advances in
// fixed steps whatever the display rate. Cash and job progress persist in localStorage.
// With ?shot=<scene> the game stages that scene deterministically, steps it, draws, and
// raises window.__shotReady — that is how the entry's screenshots are taken.
import { CITY, SAVE_KEY, STEP } from './config.js';
import { createWorld, EV } from './world.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_NEW, ACTION_PAUSE, createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';
import { EVENTS as MISSION_EVENTS } from './missions.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();
const params = new URLSearchParams(location.search);

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s.cash !== 'number' || typeof s.stage !== 'number') return null;
    return { cash: Math.max(0, Math.floor(s.cash)), stage: Math.min(3, Math.max(0, Math.floor(s.stage))), endless: Math.max(0, Math.floor(s.endless || 0)) };
  } catch {
    return null;
  }
}

function writeSave(world) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: world.cash, stage: world.stage, endless: world.endless }));
  } catch { /* storage off: the run just does not persist */ }
}

function announce(text) {
  if (statusEl) statusEl.textContent = text;
}

const seedParam = params.get('seed');
const baseSeed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : (Date.now() % 100000) + 1;

// --- Screenshot mode: stage, step, draw, done. ---
const shot = params.get('shot');
if (shot) {
  const world = createWorld(7, null);
  const staged = stageShot(shot, world);
  for (let i = 0; i < staged.steps; i += 1) world.step(staged.input, STEP);
  renderer.draw(world, SCREEN_PLAY, null);
  renderer.draw(world, SCREEN_PLAY, null);
  window.__shotReady = true;
} else {
  let save = readSave();
  let world = createWorld(baseSeed, save);
  let screen = SCREEN_TITLE;
  let elapsed = 0;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) screen = SCREEN_PAUSED;
  });
  window.addEventListener('pagehide', () => writeSave(world));
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  function reactToEvents() {
    const ev = world.events;
    if (ev & EV.CRASH) audio.crash(Boolean(world.player.car));
    if (ev & EV.STEAL) audio.steal();
    if (ev & EV.CASH) audio.cash();
    if (ev & EV.SPRAY) audio.spray();
    if (world.missionEvents & MISSION_EVENTS.PICKUP) audio.pickup();
    if (world.missionEvents & MISSION_EVENTS.DONE) audio.cash();
    if (world.missionEvents & MISSION_EVENTS.FAIL) audio.fail();
    if (ev & EV.BUSTED) {
      screen = SCREEN_BUSTED;
      audio.busted();
      announce('Busted. Press Enter to continue.');
    } else if (ev & EV.WASTED) {
      screen = SCREEN_WASTED;
      audio.fail();
      announce('Wasted. Press Enter to continue.');
    }
  }

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    const actions = input.takeActions();

    if (screen === SCREEN_TITLE) {
      // The city lives behind the panel; the camera drifts over it.
      acc += dt;
      while (acc >= STEP) { world.step({ moveX: 0, moveY: 0, steer: 0, throttle: 0, run: false, brake: false, enter: false }, STEP); acc -= STEP; }
      elapsed += dt;
      world.camera.x = CITY.width / 2 + Math.sin(elapsed * 0.07) * 430;
      world.camera.y = CITY.height / 2 + Math.cos(elapsed * 0.053) * 300;
      if (actions & ACTION_NEW) {
        try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
        save = null;
        world = createWorld(baseSeed + 7, null);
        screen = SCREEN_PLAY;
        announce('New game. Find Val by the park.');
      } else if (actions & ACTION_CONFIRM) {
        screen = SCREEN_PLAY;
        announce(save ? 'Welcome back to Palmera.' : 'Find Val by the park — the gold V.');
      }
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
      } else {
        const controls = input.controls();
        controls.enter = Boolean(actions & ACTION_ENTER);
        acc += dt;
        let guard = 0;
        while (acc >= STEP && guard < 16) {
          world.step(controls, STEP);
          controls.enter = false; // one press, one step
          acc -= STEP;
          guard += 1;
          reactToEvents();
          if (screen !== SCREEN_PLAY) { acc = 0; break; }
        }
        if (world.dirty) { writeSave(world); world.dirty = false; save = readSave(); }
        audio.update(world, dt);
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) screen = SCREEN_PLAY;
    } else if (screen === SCREEN_BUSTED || screen === SCREEN_WASTED) {
      if (actions & ACTION_CONFIRM) {
        world.applyPenalty(screen === SCREEN_BUSTED ? 'busted' : 'wasted');
        writeSave(world);
        save = readSave();
        screen = SCREEN_PLAY;
        announce('Back on the street.');
      }
    }

    renderer.draw(world, screen, screen === SCREEN_TITLE ? save : null);
  }
  requestAnimationFrame(frame);
}
