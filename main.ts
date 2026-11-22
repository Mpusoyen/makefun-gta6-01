// The gta6-01 entry program for Palmera Heat (Node 22, standard library only).
//
// The game itself is the game/ folder beside this file: plain static files —
// game/index.html and its ES modules, no library, no build step, no network — that a
// desktop browser plays offline. This program hands the entry in: it copies game/ and
// screenshots/ into the output directory and writes dossier.json there with the vendored
// make.fun library, the summary the judge reads.
//
// Play it locally first: `node serve.ts`, then http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Stage the playable game and its screenshots side by side in the output.
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps come from the competition's gate (reference/gate.json): text_max_bytes shapes
// how much source text the dossier carries; the rest refuse, here rather than at the
// scorer, an entry that would be refused there — over 4 screenshots or one past 256 KiB,
// over 993 files or 48 MiB under game/, or a single game path past 1000 bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`Palmera Heat handed in: dossier written to ${join(out, 'dossier.json')}`);
