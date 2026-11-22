// Sound from oscillators alone — no audio files. A tiny synth for the moments that
// need one (a parcel grabbed, a till ringing, a crash, a job done), an engine hum that
// follows the car's speed, and a two-tone siren that swells while the police are close.
// Everything is guarded: with no gesture yet, or no WebAudio at all, the game is silent.
import { dist } from './rng.js';
import { starsOf } from './police.js';

export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenFlip = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      engineOsc = ctx.createOscillator();
      engineGain = ctx.createGain();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain).connect(ctx.destination);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenGain = ctx.createGain();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain).connect(ctx.destination);
      sirenOsc.start();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function tone(freq, dur, type = 'square', vol = 0.05, when = 0, slide = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    pickup() { tone(880, 0.09, 'square', 0.045); tone(1320, 0.12, 'square', 0.04, 0.07); },
    cash() { tone(990, 0.08, 'square', 0.05); tone(1320, 0.1, 'square', 0.05, 0.06); tone(1760, 0.16, 'square', 0.045, 0.13); },
    crash(big) { tone(120, 0.22, 'sawtooth', big ? 0.11 : 0.06, 0, -70); tone(64, 0.3, 'square', big ? 0.08 : 0.04, 0, -30); },
    steal() { tone(392, 0.09, 'square', 0.045); tone(523, 0.12, 'square', 0.045, 0.07); },
    fail() { tone(330, 0.16, 'square', 0.05); tone(262, 0.24, 'square', 0.05, 0.13); },
    spray() { tone(520, 0.3, 'sine', 0.05, 0, 380); },
    busted() { tone(392, 0.2, 'triangle', 0.07); tone(330, 0.2, 'triangle', 0.07, 0.18); tone(262, 0.4, 'triangle', 0.07, 0.36); },

    /** Per-frame: the engine note and the siren follow the world. */
    update(world, dt) {
      if (!ctx) return;
      const car = world.player.car;
      const target = car ? 0.012 + Math.abs(car.speed) / 9000 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.09);
      if (car) engineOsc.frequency.setTargetAtTime(52 + Math.abs(car.speed) * 0.42, ctx.currentTime, 0.06);

      let sirenVol = 0;
      if (starsOf(world.heat) > 0) {
        let nearest = Infinity;
        for (const c of world.cars) {
          if (c.kind === 'police') nearest = Math.min(nearest, dist(c.x, c.y, world.player.x, world.player.y));
        }
        if (nearest < 640) sirenVol = 0.016 * (1 - nearest / 700);
      }
      sirenGain.gain.setTargetAtTime(sirenVol, ctx.currentTime, 0.12);
      if (sirenVol > 0) {
        sirenFlip += dt;
        if (sirenFlip > 0.34) {
          sirenFlip = 0;
          sirenOsc.frequency.setValueAtTime(sirenOsc.frequency.value === 700 ? 950 : 700, ctx.currentTime);
        }
      }
    },
  };
}
