// Run WELCOME on your computer: npm start  ->  http://localhost:3000
// Serves the built page from dist/ and the /api routes from app.mjs.
import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, settings } from './app.mjs';
import { parseFile } from './knowledge.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm' };

async function loadKnowledge() {
  const dir = join(root, 'knowledge');
  const files = (await readdir(dir).catch(() => [])).filter((f) => /\.(md|txt)$/i.test(f)).sort();
  const parts = [];
  for (const f of files) parts.push(...parseFile(f, await readFile(join(dir, f), 'utf8')));
  return { parts, files };
}

const knowledge = await loadKnowledge();
const s = settings(process.env);
const missing = ['SPATIUS_API_KEY', 'SPATIUS_APP_ID'].filter((k) => !process.env[k]);

async function serveFile(path, res) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, safe === '/' ? 'index.html' : safe);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Run "npm start" so the page is built first.');
  }
}

const MAX_BODY = 6_000_000; // a recorded question is far smaller

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) return await serveFile(url.pathname, res);
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413, { 'Content-Type': 'application/json' }); return res.end('{"error":"Too large."}'); }
      chunks.push(c);
    }
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = (await handle(request, process.env, knowledge)) || new Response('{"error":"Not found"}', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const c of response.body) { if (res.destroyed) break; res.write(c); }
    res.end();
  } catch (err) {
    // the visitor went away mid-request, or something else failed: answer if we still can, keep running
    if (!res.headersSent && !res.destroyed) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Something went wrong."}'); }
    else res.destroy();
  }
}).listen(PORT, () => {
  console.log(`\n  WELCOME is running: http://localhost:${PORT}\n`);
  console.log(`  Face: ${s.name}    Knowledge: ${knowledge.parts.length} parts from ${knowledge.files.length} file(s)`);
  console.log(`  Language and voice: ${s.openai.starter ? 'Spatius starter minutes (no OPENAI_API_KEY set)' : 'your own OpenAI key'}`);
  if (missing.length) console.log(`\n  Missing in .env: ${missing.join(', ')}. The avatar will not start until you add them.`);
  if (!knowledge.parts.length) console.log('\n  The knowledge folder is empty: the avatar can only say it does not know.\n  Add files to knowledge/, or run: npm run learn -- https://yourcompany.com');
  console.log('');
});
