// Drawing only: the world state in, pixels out. The city is painted from the camera's
// view at dusk — flat roofs with long shadows, neon signs, lamp glow and headlight cones
// laid over an indigo tint — then the HUD: cash, health, wanted stars, the mission
// banner, messages, speed and the minimap. Screens (title, pause, busted, wasted) are
// panels over the world.
import { CITY, FONT, PALETTE, VIEW } from './config.js';
import { clamp, dist } from './rng.js';
import { blockX, blockY, BLOCK_SIZE, roadCenterX, roadCenterY } from './city.js';
import { starsOf } from './police.js';
import { objectiveText } from './missions.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';

const NEON = ['#ff5da2', '#39d5e8', '#ffc233', '#8dff57', '#c792ff'];

/** A deterministic 0..1 hash from an integer seed, for roof clutter and faces. */
const hash = (n, k) => {
  const v = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function shade(hex, f) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = VIEW.width;
  canvas.height = VIEW.height;

  function text(str, x, y, size, color, align = 'left', weight = 600, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function star(cx, cy, r, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.stroke(); }
  }

  // ---------- the world ----------

  function drawGround(world, vx, vy, vw, vh) {
    ctx.fillStyle = PALETTE.asphalt;
    ctx.fillRect(vx, vy, vw, vh);
    // Blocks: sidewalk slab, then the inner ground.
    for (let row = 0; row < CITY.rows; row += 1) {
      for (let col = 0; col < CITY.cols; col += 1) {
        const bx = blockX(col);
        const by = blockY(row);
        if (bx > vx + vw || by > vy + vh || bx + BLOCK_SIZE < vx || by + BLOCK_SIZE < vy) continue;
        ctx.fillStyle = PALETTE.sidewalk;
        ctx.fillRect(bx, by, BLOCK_SIZE, BLOCK_SIZE);
        const isPark = col === 1 && row === 1;
        const isDocks = col === 6 && row === 5;
        ctx.fillStyle = isPark ? '#4d6b41' : isDocks ? '#6f6a61' : (col + row) % 2 ? PALETTE.blockGround : PALETTE.blockGroundAlt;
        const s = CITY.sidewalk;
        ctx.fillRect(bx + s, by + s, BLOCK_SIZE - s * 2, BLOCK_SIZE - s * 2);
        if (isPark) {
          ctx.fillStyle = '#77694f';
          ctx.fillRect(bx + s, by + BLOCK_SIZE / 2 - 5, BLOCK_SIZE - s * 2, 10);
          ctx.fillRect(bx + BLOCK_SIZE / 2 - 5, by + s, 10, BLOCK_SIZE - s * 2);
        }
      }
    }
    // Lane dashes down the middle of every road in view.
    ctx.fillStyle = PALETTE.laneMark;
    for (let i = 0; i <= CITY.cols; i += 1) {
      const cx = roadCenterX(i);
      if (cx < vx - 4 || cx > vx + vw + 4) continue;
      for (let y = Math.floor(vy / 48) * 48; y < vy + vh; y += 48) {
        if ((y / CITY.pitch) % 1 < CITY.road / CITY.pitch && y % CITY.pitch < CITY.road) continue; // gap at junctions
        ctx.fillRect(cx - 2, y, 4, 26);
      }
    }
    for (let j = 0; j <= CITY.rows; j += 1) {
      const cy = roadCenterY(j);
      if (cy < vy - 4 || cy > vy + vh + 4) continue;
      for (let x = Math.floor(vx / 48) * 48; x < vx + vw; x += 48) {
        if (x % CITY.pitch < CITY.road) continue;
        ctx.fillRect(x, cy - 2, 26, 4);
      }
    }
    // Crosswalks at the junctions in view.
    ctx.fillStyle = PALETTE.crosswalk;
    for (let i = 0; i <= CITY.cols; i += 1) {
      for (let j = 0; j <= CITY.rows; j += 1) {
        const x0 = i * CITY.pitch;
        const y0 = j * CITY.pitch;
        if (x0 > vx + vw || y0 > vy + vh || x0 + CITY.road < vx || y0 + CITY.road < vy) continue;
        for (let sIdx = 0; sIdx < 4; sIdx += 1) {
          const off = 8 + sIdx * 16;
          ctx.fillRect(x0 + off, y0 - 7, 9, 5);
          ctx.fillRect(x0 + off, y0 + CITY.road + 2, 9, 5);
          ctx.fillRect(x0 - 7, y0 + off, 5, 9);
          ctx.fillRect(x0 + CITY.road + 2, y0 + off, 5, 9);
        }
      }
    }
  }

  function drawSprayBay(world) {
    const s = world.city.spray;
    ctx.fillStyle = 'rgba(38,166,154,0.30)';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeStyle = '#26a69a';
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.save();
    ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
    ctx.rotate(Math.PI / 2);
    text('RESPRAY $150', 0, 0, 13, '#a7f3ea', 'center', 800);
    ctx.restore();
  }

  function drawBuildings(world, vx, vy, vw, vh) {
    for (const b of world.city.buildings) {
      if (b.x > vx + vw || b.y > vy + vh || b.x + b.w > vx || b.y + b.h < vy) continue;
      ctx.fillStyle = 'rgba(10,8,24,0.38)';
      ctx.fillRect(b.x + 11, b.y + 13, b.w, b.h);
      ctx.fillStyle = b.shaded ??= shade(b.color, b.shade);
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(b.x, b.y, b.w, 4);
      ctx.fillRect(b.x, b.y, 4, b.h);
      ctx.strokeStyle = 'rgba(20,14,30,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
      // Roof clutter: vents and plant boxes from the building's own seed.
      ctx.fillStyle = 'rgba(30,24,40,0.30)';
      const vents = 1 + Math.floor(hash(b.seed, 1) * 3);
      for (let k = 0; k < vents; k += 1) {
        const w = 12 + hash(b.seed, k + 2) * 20;
        const h = 10 + hash(b.seed, k + 5) * 16;
        const x = b.x + 12 + hash(b.seed, k + 7) * Math.max(10, b.w - 24 - w);
        const y = b.y + 12 + hash(b.seed, k + 11) * Math.max(10, b.h - 24 - h);
        ctx.fillRect(x, y, w, h);
      }
      if (b.sign) {
        const neon = NEON[Math.floor(hash(b.seed, 3) * NEON.length)];
        ctx.save();
        ctx.shadowColor = neon;
        ctx.shadowBlur = 9;
        text(b.sign, b.x + b.w / 2, b.y + 15, 12.5, neon, 'center', 800);
        ctx.restore();
      }
    }
    // Crates at the docks.
    for (const c of world.city.crates) {
      if (c.x > vx + vw || c.y > vy + vh || c.x + c.w < vx || c.y + c.h < vy) continue;
      ctx.fillStyle = '#8a6b42';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = 'rgba(40,26,10,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
      ctx.beginPath();
      ctx.moveTo(c.x + 2, c.y + 2);
      ctx.lineTo(c.x + c.w - 2, c.y + c.h - 2);
      ctx.moveTo(c.x + c.w - 2, c.y + 2);
      ctx.lineTo(c.x + 2, c.y + c.h - 2);
      ctx.stroke();
    }
    // Trees: a dark trunk and a triple canopy.
    for (const t of world.city.trees) {
      if (t.x < vx - 30 || t.y < vy - 30 || t.x > vx + vw + 30 || t.y > vy + vh + 30) continue;
      ctx.fillStyle = 'rgba(10,8,24,0.30)';
      ctx.beginPath(); ctx.arc(t.x + 5, t.y + 6, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e4a2a';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f6b35';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#548547';
      ctx.beginPath(); ctx.arc(t.x + t.r * 0.25, t.y + t.r * 0.15, t.r * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawMarkers(world) {
    const t = world.time;
    if (!world.mission) {
      const v = world.city.val;
      const pulse = 1 + Math.sin(t * 4) * 0.16;
      ctx.strokeStyle = PALETTE.objective;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(v.x, v.y, 17 * pulse, 0, Math.PI * 2); ctx.stroke();
      text('V', v.x, v.y - 34 - Math.sin(t * 3) * 4, 25, PALETTE.objective, 'center', 900);
    }
    const o = world.objective;
    if (o) {
      const pulse = 1 + Math.sin(t * 5) * 0.2;
      const grad = ctx.createLinearGradient(0, o.y - 130, 0, o.y);
      grad.addColorStop(0, 'rgba(255,194,51,0)');
      grad.addColorStop(1, 'rgba(255,194,51,0.30)');
      ctx.fillStyle = grad;
      ctx.fillRect(o.x - 13, o.y - 130, 26, 130);
      ctx.strokeStyle = PALETTE.objective;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(o.x, o.y, 20 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.translate(o.x, o.y - 40 - Math.sin(t * 3) * 4);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = PALETTE.objective;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
    }
  }

  function drawCar(car, world) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.fillStyle = 'rgba(8,6,20,0.35)';
    ctx.beginPath(); ctx.ellipse(4, 6, car.len / 2, car.wid / 2 + 2, car.angle, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(car.angle);
    // Wheels.
    ctx.fillStyle = '#14151c';
    const wx = car.len * 0.31;
    const wy = car.wid / 2 - 1;
    ctx.fillRect(-wx - 5, -wy - 2.5, 10, 5);
    ctx.fillRect(wx - 5, -wy - 2.5, 10, 5);
    ctx.fillRect(-wx - 5, wy - 2.5, 10, 5);
    ctx.fillRect(wx - 5, wy - 2.5, 10, 5);
    // Body.
    ctx.fillStyle = car.color;
    ctx.beginPath(); ctx.roundRect(-car.len / 2, -car.wid / 2, car.len, car.wid, 6); ctx.fill();
    if (car.kind === 'police') {
      ctx.fillStyle = '#274b9f';
      ctx.fillRect(-car.len * 0.16, -car.wid / 2, car.len * 0.3, car.wid);
    }
    // Cabin and glass.
    ctx.fillStyle = '#1b2635';
    ctx.beginPath(); ctx.roundRect(-car.len * 0.14, -car.wid / 2 + 3, car.len * 0.36, car.wid - 6, 4); ctx.fill();
    ctx.fillStyle = 'rgba(160,210,235,0.5)';
    ctx.fillRect(car.len * 0.20, -car.wid / 2 + 4, 3.5, car.wid - 8);
    // Police light bar.
    if (car.kind === 'police') {
      const phase = Math.floor(world.time * 3.4 + car.id) % 2 === 0;
      ctx.fillStyle = PALETTE.policeRed;
      ctx.fillRect(-7, -car.wid / 2 + 3, 6.5, car.wid / 2 - 3);
      ctx.fillStyle = PALETTE.policeBlue;
      ctx.fillRect(-0.5, 0, 6.5, car.wid / 2 - 3);
      ctx.fillStyle = phase ? '#ffd7dc' : '#d7e6ff';
      ctx.fillRect(-7, phase ? -car.wid / 2 + 3 : 0, 6.5, car.wid / 2 - 3);
    }
    // Brake lights and headlights (the cones come in the light pass).
    ctx.fillStyle = car.brakeLight ? '#ff5a4d' : '#8c2f28';
    ctx.fillRect(-car.len / 2, -car.wid / 2 + 2.5, 3, 5);
    ctx.fillRect(-car.len / 2, car.wid / 2 - 7.5, 3, 5);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(car.len / 2 - 3, -car.wid / 2 + 2.5, 3, 5);
    ctx.fillRect(car.len / 2 - 3, car.wid / 2 - 7.5, 3, 5);
    ctx.restore();

    // A gold chevron over the player's own car.
    if (car.driver === 'player') {
      const bob = Math.sin(world.time * 4) * 3;
      ctx.fillStyle = PALETTE.objective;
      ctx.beginPath();
      ctx.moveTo(car.x, car.y - 34 + bob);
      ctx.lineTo(car.x - 7, car.y - 44 + bob);
      ctx.lineTo(car.x + 7, car.y - 44 + bob);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawPed(ped, world) {
    ctx.fillStyle = 'rgba(8,6,20,0.3)';
    ctx.beginPath(); ctx.arc(ped.x + 2, ped.y + 3, 7, 0, Math.PI * 2); ctx.fill();
    if (ped.mode === 'down') {
      ctx.save();
      ctx.translate(ped.x, ped.y);
      ctx.rotate(ped.angle);
      ctx.fillStyle = ped.color;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8b08a';
      ctx.beginPath(); ctx.arc(12, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = ped.color;
    ctx.beginPath(); ctx.arc(ped.x, ped.y, 6.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ['#e8b08a', '#c98d64', '#8a5a3b', '#f0c8a0'][Math.floor(hash(ped.seed, 2) * 4)];
    ctx.beginPath(); ctx.arc(ped.x, ped.y, 4.1, 0, Math.PI * 2); ctx.fill();
    if (ped.mode === 'flee') text('!', ped.x, ped.y - 16, 15, '#ffffff', 'center', 900);
  }

  function drawPlayer(world) {
    const p = world.player;
    if (p.car) return;
    ctx.fillStyle = 'rgba(8,6,20,0.32)';
    ctx.beginPath(); ctx.arc(p.x + 2, p.y + 3, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,63,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 12.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = PALETTE.player;
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8b08a';
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#20242e';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(p.angle) * 9, p.y + Math.sin(p.angle) * 9);
    ctx.stroke();
  }

  function drawParticles(world) {
    for (const p of world.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'smoke') {
        ctx.fillStyle = `rgba(70,66,82,${0.30 * a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawLights(world, vx, vy, vw, vh) {
    // Dusk tint over everything the street lights have not reached.
    ctx.fillStyle = 'rgba(26,18,64,0.13)';
    ctx.fillRect(vx, vy, vw, vh);
    ctx.globalCompositeOperation = 'lighter';
    // Lamp glow.
    for (const l of world.city.lamps) {
      if (l.x < vx - 60 || l.y < vy - 60 || l.x > vx + vw + 60 || l.y > vy + vh + 60) continue;
      const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 52);
      g.addColorStop(0, 'rgba(255,190,90,0.16)');
      g.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(l.x, l.y, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,214,140,0.9)';
      ctx.beginPath(); ctx.arc(l.x, l.y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    // Headlight cones.
    for (const car of world.cars) {
      if (car.x < vx - 160 || car.y < vy - 160 || car.x > vx + vw + 160 || car.y > vy + vh + 160) continue;
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      const bx = car.x + fx * car.len / 2;
      const by = car.y + fy * car.len / 2;
      const tx = bx + fx * 118;
      const ty = by + fy * 118;
      const px = -fy;
      const py = fx;
      const g = ctx.createLinearGradient(bx, by, tx, ty);
      g.addColorStop(0, 'rgba(255,232,170,0.13)');
      g.addColorStop(1, 'rgba(255,232,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx + px * 7, by + py * 7);
      ctx.lineTo(tx + px * 30, ty + py * 30);
      ctx.lineTo(tx - px * 30, ty - py * 30);
      ctx.lineTo(bx - px * 7, by - py * 7);
      ctx.closePath(); ctx.fill();
      // Police flashers wash the street.
      if (car.kind === 'police') {
        const phase = Math.floor(world.time * 3.4 + car.id) % 2 === 0;
        const col = phase ? '255,71,87' : '63,125,255';
        const fg = ctx.createRadialGradient(car.x, car.y, 4, car.x, car.y, 74);
        fg.addColorStop(0, `rgba(${col},0.20)`);
        fg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(car.x, car.y, 74, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawWorld(world) {
    const cam = world.camera;
    const vx = cam.x - VIEW.width / 2;
    const vy = cam.y - VIEW.height / 2;
    ctx.save();
    ctx.translate(-vx, -vy);
    drawGround(world, vx, vy, VIEW.width, VIEW.height);
    drawSprayBay(world);
    drawBuildings(world, vx, vy, VIEW.width, VIEW.height);
    drawMarkers(world);
    for (const car of world.cars) {
      if (car.x < vx - 90 || car.y < vy - 90 || car.x > vx + VIEW.width + 90 || car.y > vy + VIEW.height + 90) continue;
      drawCar(car, world);
    }
    for (const ped of world.peds) drawPed(ped, world);
    drawPlayer(world);
    drawParticles(world);
    drawLights(world, vx, vy, VIEW.width, VIEW.height);
    ctx.restore();
  }

  // ---------- the HUD ----------

  function bar(x, y, w, h, frac, color, bg = 'rgba(10,12,20,0.55)') {
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2); ctx.fill();
    }
  }

  function drawMinimap(world) {
    const mw = 214;
    const mh = 178;
    const x0 = 16;
    const y0 = VIEW.height - mh - 16;
    const sx = mw / CITY.width;
    const sy = mh / CITY.height;
    ctx.fillStyle = 'rgba(8,10,18,0.78)';
    ctx.beginPath(); ctx.roundRect(x0, y0, mw, mh, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(245,239,228,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x0, y0, mw, mh, 10); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x0, y0, mw, mh, 10); ctx.clip();
    for (let row = 0; row < CITY.rows; row += 1) {
      for (let col = 0; col < CITY.cols; col += 1) {
        ctx.fillStyle = (col + row) % 2 ? '#3c4636' : '#454034';
        ctx.fillRect(x0 + blockX(col) * sx, y0 + blockY(row) * sy, BLOCK_SIZE * sx, BLOCK_SIZE * sy);
      }
    }
    const dot = (x, y, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x0 + x * sx, y0 + y * sy, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const car of world.cars) {
      if (car.kind === 'civil' && car.driver === 'ai') dot(car.x, car.y, 1.8, '#9aa3ad');
    }
    const phase = Math.floor(world.time * 3.4) % 2 === 0;
    for (const car of world.cars) {
      if (car.kind === 'police') dot(car.x, car.y, 3, phase ? '#ff5964' : '#5b8cff');
    }
    dot(world.city.spray.x + world.city.spray.w / 2, world.city.spray.y + world.city.spray.h / 2, 3, '#2ee6c8');
    if (!world.mission) dot(world.city.val.x, world.city.val.y, 3.4, PALETTE.objective);
    if (world.objective) {
      const o = world.objective;
      const r = 4 + Math.sin(world.time * 5) * 1.2;
      ctx.save();
      ctx.translate(x0 + o.x * sx, y0 + o.y * sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = PALETTE.objective;
      ctx.fillRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
      ctx.restore();
    }
    const f = world.focus();
    ctx.save();
    ctx.translate(x0 + f.x * sx, y0 + f.y * sy);
    ctx.rotate(f.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4.5, -4); ctx.lineTo(-4.5, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
    text('PALMERA', x0 + 8, y0 + 13, 10, 'rgba(245,239,228,0.65)', 'left', 800);
  }

  function drawEdgeArrow(world) {
    const target = world.objective ?? (!world.mission ? { ...world.city.val, label: 'Val' } : null);
    if (!target) return;
    const cam = world.camera;
    const sx = target.x - cam.x + VIEW.width / 2;
    const sy = target.y - cam.y + VIEW.height / 2;
    if (sx > 30 && sx < VIEW.width - 30 && sy > 30 && sy < VIEW.height - 30) return;
    const cx = VIEW.width / 2;
    const cy = VIEW.height / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const ex = clamp(cx + Math.cos(a) * (VIEW.width / 2 - 56), 44, VIEW.width - 44);
    const ey = clamp(cy + Math.sin(a) * (VIEW.height / 2 - 56), 44, VIEW.height - 44);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = PALETTE.objective;
    ctx.beginPath();
    ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    const metres = Math.round(dist(world.focus().x, world.focus().y, target.x, target.y) / 8);
    text(`${metres}m`, ex, ey + 24, 12.5, PALETTE.objective, 'center', 800);
  }

  function drawHud(world) {
    // Cash and health, top left.
    text(`$${world.cash.toLocaleString('en-US')}`, 22, 30, 30, PALETTE.cash, 'left', 900);
    bar(22, 52, 168, 11, world.player.health / 100, world.player.health > 30 ? '#7be495' : '#ff5964');
    text('HEALTH', 200, 58, 10.5, PALETTE.muted, 'left', 800);
    if (world.player.car) {
      bar(22, 70, 168, 11, world.player.car.health / 100, '#ffc233');
      text('CAR', 200, 76, 10.5, PALETTE.muted, 'left', 800);
    }

    // Wanted stars, top right — gold for the level, hollow above it, blinking as they fall.
    const stars = starsOf(world.heat);
    const blink = world.decaying && Math.floor(world.time * 3) % 2 === 0;
    for (let i = 0; i < 5; i += 1) {
      const cx = VIEW.width - 34 - (4 - i) * 40;
      if (i < stars) star(cx, 34, 14, blink ? 'rgba(255,194,51,0.35)' : '#ffc233', '#8a6a14');
      else star(cx, 34, 14, 'rgba(16,18,28,0.5)', 'rgba(245,239,228,0.4)');
    }
    if (world.player.bust > 0.02) {
      bar(VIEW.width - 222, 56, 200, 11, world.player.bust, '#ff4757');
      text('BUSTED', VIEW.width - 122, 82, 13, '#ff8089', 'center', 900);
    }

    // The mission banner, top centre.
    const obj = objectiveText(world);
    ctx.fillStyle = 'rgba(8,10,18,0.55)';
    const wLine = Math.max(obj.title.length, obj.line.length);
    const bw = clamp(wLine * 8.4 + 36, 240, 560);
    ctx.beginPath(); ctx.roundRect(VIEW.width / 2 - bw / 2, 14, bw, world.mission?.timer != null ? 76 : 60, 10); ctx.fill();
    text(obj.title.toUpperCase(), VIEW.width / 2, 34, 16.5, PALETTE.objective, 'center', 900);
    text(obj.line, VIEW.width / 2, 58, 13.5, PALETTE.text, 'center', 500);
    if (world.mission?.timer != null) {
      const t = Math.max(0, world.mission.timer);
      const label = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      text(label, VIEW.width / 2, 79, 13, t < 15 ? '#ff8089' : PALETTE.text, 'center', 800);
    }

    // The word on the street: recent messages, bottom centre.
    const fresh = world.messages.filter((m) => world.time - m.at < 5).slice(-3);
    fresh.forEach((m, i) => {
      const age = world.time - m.at;
      const alpha = age > 4 ? 1 - (age - 4) : 1;
      const y = VIEW.height - 44 - (fresh.length - 1 - i) * 27;
      ctx.fillStyle = `rgba(8,10,18,${0.5 * alpha})`;
      const w = m.text.length * 7.1 + 26;
      ctx.beginPath(); ctx.roundRect(VIEW.width / 2 - w / 2, y - 12, w, 24, 12); ctx.fill();
      text(m.text, VIEW.width / 2, y + 1, 13.5, PALETTE.text, 'center', 600, alpha);
    });

    // The contextual prompt.
    if (world.prompt) {
      const y = VIEW.height - 128;
      ctx.fillStyle = 'rgba(8,10,18,0.66)';
      const w = world.prompt.length * 8 + 34;
      ctx.beginPath(); ctx.roundRect(VIEW.width / 2 - w / 2, y - 15, w, 30, 15); ctx.fill();
      text(world.prompt, VIEW.width / 2, y + 1, 15, '#ffe9a8', 'center', 800);
    }

    // Speed, bottom right, when driving.
    if (world.player.car) {
      const kmh = Math.round(Math.abs(world.player.car.speed) * 0.36);
      text(String(kmh), VIEW.width - 26, VIEW.height - 52, 40, PALETTE.text, 'right', 900);
      text('km/h', VIEW.width - 26, VIEW.height - 24, 12, PALETTE.muted, 'right', 700);
    }

    drawMinimap(world);
    drawEdgeArrow(world);
  }

  // ---------- screens ----------

  function panel(w, h) {
    ctx.fillStyle = 'rgba(10,10,22,0.82)';
    ctx.beginPath(); ctx.roundRect(VIEW.width / 2 - w / 2, VIEW.height / 2 - h / 2, w, h, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,51,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.roundRect(VIEW.width / 2 - w / 2, VIEW.height / 2 - h / 2, w, h, 16); ctx.stroke();
  }

  function drawTitle(world, save) {
    ctx.fillStyle = 'rgba(14,10,34,0.45)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const cx = VIEW.width / 2;
    ctx.save();
    ctx.shadowColor = '#ff5da2';
    ctx.shadowBlur = 26;
    text('PALMERA HEAT', cx, 168, 84, '#ffd23f', 'center', 900);
    ctx.restore();
    text('An open-world crime story in the city of Palmera', cx, 222, 19, '#f5efe4', 'center', 500);
    panel(620, 300);
    const lines = [
      ['W A S D / arrows', 'walk and drive'],
      ['Shift', 'run / —'],
      ['F', 'enter a car · steal it · talk to Val'],
      ['Space', 'handbrake'],
      ['P or Esc', 'pause'],
      ['', ''],
      ['', 'Steal cars, run Val\'s jobs, dodge the heat.'],
      ['', 'Lose the police by breaking sight — or respray at Reyes\'.'],
    ];
    lines.forEach((ln, i) => {
      const y = VIEW.height / 2 - 118 + i * 30;
      if (ln[0]) text(ln[0], cx - 268, y, 15.5, '#ffc233', 'left', 800);
      text(ln[1] ?? ln[0], ln[0] ? cx - 96 : cx, y, 15.5, '#f5efe4', ln[0] ? 'left' : 'center', 500);
    });
    if (save) {
      text(`Saved game: $${save.cash.toLocaleString('en-US')} · ${save.stage} of 3 jobs done`, cx, VIEW.height / 2 + 196, 15, '#7be495', 'center', 600);
      text('ENTER — continue      N — new game', cx, VIEW.height / 2 + 228, 17, '#ffe9a8', 'center', 800);
    } else {
      text('ENTER — start', cx, VIEW.height / 2 + 212, 18, '#ffe9a8', 'center', 800);
    }
  }

  function drawEnd(world, screen) {
    ctx.fillStyle = screen === SCREEN_BUSTED ? 'rgba(16,26,64,0.55)' : 'rgba(64,10,16,0.55)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const last = world.messages[world.messages.length - 1];
    text(screen === SCREEN_BUSTED ? 'BUSTED' : 'WASTED', VIEW.width / 2, 300, 76, screen === SCREEN_BUSTED ? '#8fb4ff' : '#ff8089', 'center', 900);
    if (last) text(last.text, VIEW.width / 2, 372, 17, '#f5efe4', 'center', 500);
    text('ENTER — back on the street', VIEW.width / 2, 428, 17, '#ffe9a8', 'center', 800);
  }

  /** Paint one frame: the world, the HUD in play, and the screen's overlay if any. */
  function draw(world, screen, save) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14121f';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    drawWorld(world);
    if (screen === SCREEN_TITLE) { drawTitle(world, save); return; }
    drawHud(world);
    if (screen === SCREEN_PAUSED) {
      ctx.fillStyle = 'rgba(10,10,22,0.55)';
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      text('PAUSED', VIEW.width / 2, 340, 54, '#f5efe4', 'center', 900);
      text('P — resume', VIEW.width / 2, 402, 17, '#ffe9a8', 'center', 800);
    } else if (screen === SCREEN_BUSTED || screen === SCREEN_WASTED) {
      drawEnd(world, screen);
    }
  }

  return { draw };
}
