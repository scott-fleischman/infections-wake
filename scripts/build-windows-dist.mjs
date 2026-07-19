// Assemble the self-contained Windows 10 distribution.
//   npm run dist:win     (runs `vite build` first, then this script)
//
// Produces  ./Infections-Wake-Windows/  containing:
//   game/                    the built static site (from dist/)
//   server.mjs               zero-dependency Node static server
//   serve.ps1                zero-install PowerShell static server
//   Play-InfectionsWake.bat  double-click launcher (Node or PowerShell)
//   README-WINDOWS.txt       player instructions
//
// Zip that folder and it will run on any Windows 10 machine.

import { cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const WIN_SRC = join(ROOT, 'windows');
const OUT = join(ROOT, 'Infections-Wake-Windows');
const OUT_GAME = join(OUT, 'game');

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

if (!existsSync(DIST)) {
  console.error('\n  No dist/ folder found. Run `npm run build` first (or use `npm run dist:win`).\n');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT_GAME, { recursive: true });

// built site -> game/
await cp(DIST, OUT_GAME, { recursive: true });

// launcher files -> distribution root
for (const f of ['server.mjs', 'serve.ps1', 'Play-InfectionsWake.bat', 'README-WINDOWS.txt']) {
  await cp(join(WIN_SRC, f), join(OUT, f));
}

const mb = (await dirSize(OUT) / 1048576).toFixed(1);
console.log(`\n  Windows distribution ready: Infections-Wake-Windows/  (${mb} MB)`);
console.log('  Copy or zip that whole folder onto a Windows 10 machine, then');
console.log('  double-click  Play-InfectionsWake.bat  to play.\n');
