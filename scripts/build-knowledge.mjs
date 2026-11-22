// Bundles knowledge/ into server/knowledge.json for Cloudflare Workers.
// (The Node server reads the folder directly and does not need this step.)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../server/knowledge.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, 'knowledge');
const files = (await readdir(dir).catch(() => [])).filter((f) => /\.(md|txt)$/i.test(f)).sort();
const parts = [];
for (const f of files) parts.push(...parseFile(f, await readFile(join(dir, f), 'utf8')));
await writeFile(join(root, 'server/knowledge.json'), JSON.stringify({ parts, files }));
console.log(`Knowledge bundled: ${parts.length} parts from ${files.length} file(s).`);
