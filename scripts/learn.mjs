// npm run learn -- https://yourcompany.com [--pages 50]
// Reads the public pages of one website (same site only, robots.txt respected)
// and saves each page as a text file in knowledge/, ready for the avatar.
import { mkdir, writeFile, readdir, unlink, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const pagesAt = args.indexOf('--pages');
const max = pagesAt >= 0 ? Number(args[pagesAt + 1]) || 50 : 50;
const start = args.find((a, i) => !a.startsWith('--') && i !== pagesAt + 1);
if (!start) {
  console.log('Usage: npm run learn -- https://yourcompany.com [--pages 50]');
  process.exit(1);
}
const first = new URL(/^https?:\/\//.test(start) ? start : `https://${start}`);
const dir = join(fileURLToPath(new URL('..', import.meta.url)), 'knowledge');
const UA = 'WELCOME-template (reads your public pages once)';

// robots.txt: skip what it disallows for every robot
let disallow = [];
try {
  const r = await fetch(new URL('/robots.txt', first), { headers: { 'User-Agent': UA } });
  if (r.ok) {
    let all = false;
    for (const line of (await r.text()).split('\n')) {
      const [k, ...v] = line.split(':');
      const key = k.trim().toLowerCase(), val = v.join(':').trim();
      if (key === 'user-agent') all = val === '*';
      else if (all && key === 'disallow' && val) disallow.push(val);
    }
  }
} catch { /* no robots.txt */ }
const allowed = (u) => !disallow.some((d) => u.pathname.startsWith(d));

const code = (n) => { try { return String.fromCodePoint(n); } catch { return ' '; } };
const decode = (t) => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => code(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => code(+n)).replace(/&amp;/g, '&');
function toText(html) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  let body = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<body[\s\S]*?<\/body>/i)?.[0] || html;
  body = body
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, (_, h) => `\n\n## ${h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`)
    .replace(/<(br|\/p|\/li|\/div|\/tr|\/h[4-6])[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  const text = decode(body).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title, text };
}

const seen = new Set();
const queue = [first.href];
const pages = [];
// the site's own names: what was typed, its www twin, and where pages really land
const bare = first.hostname.replace(/^www\./, '');
const hosts = new Set([first.hostname, bare, `www.${bare}`]);
while (queue.length && pages.length < max) {
  const href = queue.shift();
  const u = new URL(href);
  u.hash = '';
  if (seen.has(u.href) || !hosts.has(u.hostname) || !allowed(u) || /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|css|js|xml)$/i.test(u.pathname)) continue;
  seen.add(u.href);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) continue;
    hosts.add(new URL(r.url).hostname);
    const html = (await r.text()).slice(0, 1_500_000);
    const { title, text } = toText(html);
    if (text.length > 80) {
      pages.push({ url: u.href, title: title || u.pathname, text });
      process.stdout.write(`  read ${pages.length}: ${u.pathname}\n`);
    }
    for (const m of html.matchAll(/href="([^"#]+)"/gi)) {
      try { const n = new URL(decode(m[1]), u); if (hosts.has(n.hostname) && queue.length < 500) queue.push(n.href); } catch { /* bad link */ }
    }
  } catch { /* page could not be read */ }
}

if (!pages.length) {
  console.log(`\nNo pages could be read from ${first.host}. The site may block robots or need JavaScript to show its text.`);
  process.exit(1);
}
await mkdir(dir, { recursive: true });
// replace the pages from an earlier run of this site, keep your own files
for (const f of await readdir(dir)) if (f.startsWith(`site-${bare}-`) || f.startsWith(`site-${first.host}-`)) await unlink(join(dir, f));
// the example shop must not mix with your company: move it out of knowledge/
const example = join(dir, 'maple-bikes.md');
try {
  if ((await readFile(example, 'utf8')).includes('This is an example.')) {
    const keep = join(dir, '..', 'examples');
    await mkdir(keep, { recursive: true });
    await rename(example, join(keep, 'maple-bikes.md'));
    console.log('Moved the example file (maple-bikes.md) to examples/, so it does not mix with your company.');
  }
} catch { /* no example file */ }
for (const [i, p] of pages.entries()) {
  const slug = (p.url.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home').slice(0, 60);
  await writeFile(join(dir, `site-${bare}-${String(i).padStart(2, '0')}-${slug}.md`), `url: ${p.url}\ntitle: ${p.title}\n\n${p.text}\n`);
}
console.log(`\nSaved ${pages.length} page(s) from ${first.host} to knowledge/. Restart the app (npm start) to use them.`);
