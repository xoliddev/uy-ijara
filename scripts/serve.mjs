// Static server that mirrors the GitHub Pages layout of the demo:
//   /            -> demo/index.html
//   /demo/*, /webapp/*, /shared/*  -> the same folders in the repo
//   node scripts/serve.mjs [port]      (default 4296)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4296);
const ALLOWED = ['demo', 'webapp', 'shared'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/uy-ijara/, '');
    const rel = path === '/' || path === '/index.html' ? 'demo/index.html' : normalize(path.slice(1));
    const file = join(ROOT, rel);
    if (!ALLOWED.includes(rel.split(sep)[0].split('/')[0]) || !file.startsWith(ROOT + sep)) {
      res.writeHead(404).end('not found');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
  console.log(`demo on http://127.0.0.1:${PORT}/`); // eslint-disable-line no-console
}
