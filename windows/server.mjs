// Zero-dependency static file server for the Infection's Wake Windows build.
// Uses only Node's built-in modules — no `npm install`, no node_modules.
// Serves the ./game folder over http://localhost:8137/ and opens the browser.
//
//   node server.mjs            (double-click Play-InfectionsWake.bat instead)
//   set PORT=9000 & node server.mjs   (use a different port)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize, dirname, sep } from 'node:path';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, 'game');
const PORT = Number(process.env.PORT) || 8137;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(ROOT)) {
  console.error(`\n  Could not find the "game" folder next to server.mjs.\n  Expected: ${ROOT}\n  Keep server.mjs and the game folder together.\n`);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const filePath = normalize(join(ROOT, path));
    // never serve outside the game folder (path-traversal guard)
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Server error');
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.\n  Close the other program, or run:  set PORT=9000 & node server.mjs\n`);
  } else {
    console.error('\n  Server failed to start:', e.message, '\n');
  }
  process.exit(1);
});

// Open the default browser without a shell (args are passed separately, so
// there is no command-injection surface — the URL is a fixed localhost value).
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* the user can open the URL manually */ }
}

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Infection's Wake is running.`);
  console.log(`  Play in your browser at:  ${url}`);
  console.log(`  Keep this window open while you play. Close it to stop the game.\n`);
  openBrowser(url);
});
