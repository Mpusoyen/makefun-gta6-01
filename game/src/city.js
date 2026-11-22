// Palmera's map: a grid of blocks and roads built once from a seed. Produces the building
// rectangles everything collides with, the trees and lamps, the special places (Reyes'
// pay-and-spray, Val's corner, the docks checkpoint, the hospital and the police station)
// and the spots where parked cars and mission parcels sit.
import { CITY, LANE, ROOF_COLORS, SHOP_SIGNS } from './config.js';

/** Centre line x of vertical road i (0..cols). */
export const roadCenterX = (i) => i * CITY.pitch + CITY.road / 2;
/** Centre line y of horizontal road j (0..rows). */
export const roadCenterY = (j) => j * CITY.pitch + CITY.road / 2;
/** Left/top edge of block (col,row). */
export const blockX = (col) => col * CITY.pitch + CITY.road;
export const blockY = (row) => row * CITY.pitch + CITY.road;
export const BLOCK_SIZE = CITY.pitch - CITY.road;

/** Is the point on a road (not on a block)? */
export function onRoad(x, y) {
  const inV = x % CITY.pitch < CITY.road;
  const inH = y % CITY.pitch < CITY.road;
  return inV || inH;
}

/** A point on the sidewalk ring of a random block, for parcels and strolling. */
export function sidewalkPoint(rng, col, row) {
  const bx = blockX(col) + CITY.sidewalk / 2;
  const by = blockY(row) + CITY.sidewalk / 2;
  const inner = BLOCK_SIZE - CITY.sidewalk;
  const side = rng.int(0, 3);
  const t = rng.next();
  if (side === 0) return { x: bx + t * inner, y: by };
  if (side === 1) return { x: bx + t * inner, y: by + inner };
  if (side === 2) return { x: bx, y: by + t * inner };
  return { x: bx + inner, y: by + t * inner };
}

export function buildCity(rng) {
  const buildings = [];
  const trees = [];
  const lamps = [];
  const crates = [];
  let signIndex = 0;

  const addBuilding = (x, y, w, h, forceSign) => {
    const sign = forceSign ?? (rng.chance(0.34) ? SHOP_SIGNS[signIndex++ % SHOP_SIGNS.length] : null);
    buildings.push({
      x, y, w, h,
      color: rng.pick(ROOF_COLORS),
      shade: rng.range(0.85, 1.12),
      sign,
      seed: rng.int(1, 1e9),
    });
  };

  for (let row = 0; row < CITY.rows; row += 1) {
    for (let col = 0; col < CITY.cols; col += 1) {
      const bx = blockX(col);
      const by = blockY(row);
      const inner = BLOCK_SIZE - CITY.sidewalk * 2;
      const ix = bx + CITY.sidewalk;
      const iy = by + CITY.sidewalk;

      // The park block: lawns, palms and paths, no buildings.
      if (col === 1 && row === 1) {
        for (let t = 0; t < 14; t += 1) {
          trees.push({ x: bx + rng.range(24, BLOCK_SIZE - 24), y: by + rng.range(24, BLOCK_SIZE - 24), r: rng.range(11, 17) });
        }
        continue;
      }
      // The docks block: low warehouses and crate stacks, wide open concrete.
      if (col === 6 && row === 5) {
        addBuilding(ix, iy, 92, 70);
        addBuilding(ix + 112, iy, 92, 70);
        for (let c = 0; c < 9; c += 1) {
          crates.push({ x: ix + rng.range(0, inner - 26), y: iy + 96 + rng.range(0, inner - 130), w: 26, h: 26 });
        }
        continue;
      }
      // The hospital and police station blocks: one big civic building each.
      if ((col === 0 && row === 0) || (col === 6 && row === 0)) {
        addBuilding(ix + 14, iy + 14, inner - 28, inner - 28, col === 0 ? 'HOSPITAL' : 'POLICIA');
        continue;
      }
      // Reyes' garage block: the workshop, with the spray bay on its west face.
      if (col === 5 && row === 1) {
        addBuilding(ix + 58, iy + 20, inner - 70, inner - 40, 'TALLER REYES');
        continue;
      }
      // Ordinary blocks: one, two or four buildings with alleys between.
      const layout = rng.int(0, 2);
      const gap = 14;
      if (layout === 0) {
        addBuilding(ix + 8, iy + 8, inner - 16, inner - 16);
      } else if (layout === 1) {
        const w = (inner - gap) / 2;
        addBuilding(ix, iy + 6, w, inner - 12);
        addBuilding(ix + w + gap, iy + 6, w, inner - 12);
      } else {
        const w = (inner - gap) / 2;
        const h = (inner - gap) / 2;
        addBuilding(ix, iy, w, h);
        addBuilding(ix + w + gap, iy, w, h);
        addBuilding(ix, iy + h + gap, w, h);
        addBuilding(ix + w + gap, iy + h + gap, w, h);
      }
      // A few trees soften the sidewalk corners.
      if (rng.chance(0.7)) trees.push({ x: bx + 12, y: by + 12, r: rng.range(9, 13) });
      if (rng.chance(0.7)) trees.push({ x: bx + BLOCK_SIZE - 12, y: by + BLOCK_SIZE - 12, r: rng.range(9, 13) });
    }
  }

  // Street lamps: both corners of every intersection and mid-block along the avenues.
  for (let i = 0; i <= CITY.cols; i += 1) {
    for (let j = 0; j <= CITY.rows; j += 1) {
      lamps.push({ x: roadCenterX(i) - CITY.road / 2 - 5, y: roadCenterY(j) - CITY.road / 2 - 5 });
      lamps.push({ x: roadCenterX(i) + CITY.road / 2 + 5, y: roadCenterY(j) + CITY.road / 2 + 5 });
    }
  }

  // The pay-and-spray bay: a painted rectangle on the road west of Taller Reyes.
  const spray = { x: blockX(5) - CITY.road + 6, y: blockY(1) + 66, w: CITY.road - 12, h: 96 };
  // Val waits on the corner by the park, south-east of it.
  const val = { x: blockX(2) - 24, y: blockY(2) - 24 };
  // The docks checkpoint, in the open yard of the docks block.
  const docks = { x: blockX(6) + BLOCK_SIZE / 2, y: blockY(5) + BLOCK_SIZE - 44 };
  // Respawn doors.
  const hospital = { x: blockX(0) + BLOCK_SIZE / 2, y: blockY(0) + BLOCK_SIZE + 20 };
  const station = { x: blockX(6) + BLOCK_SIZE / 2, y: blockY(0) + BLOCK_SIZE + 20 };

  // Parking places along the block curbs: the car's centre sits 8 px inside the block
  // edge, snug against the pavement, clear of the traffic lanes. Parked cars are
  // placed by the world, not the city.
  const parking = [];
  for (let row = 0; row < CITY.rows; row += 1) {
    for (let col = 0; col < CITY.cols; col += 1) {
      const bx = blockX(col);
      const by = blockY(row);
      const spots = rng.int(0, 3);
      for (let s = 0; s < spots; s += 1) {
        const edge = rng.int(0, 3);
        const t = rng.range(50, BLOCK_SIZE - 50);
        if (edge === 0) parking.push({ x: bx + t, y: by + 8, angle: 0 });
        else if (edge === 1) parking.push({ x: bx + t, y: by + BLOCK_SIZE - 8, angle: Math.PI });
        else if (edge === 2) parking.push({ x: bx + 8, y: by + t, angle: Math.PI / 2 });
        else parking.push({ x: bx + BLOCK_SIZE - 8, y: by + t, angle: -Math.PI / 2 });
      }
    }
  }

  return { buildings, trees, lamps, crates, spray, val, docks, hospital, station, parking };
}
