// The company knowledge: every .md or .txt file in knowledge/, cut into parts by heading.
// A file may start with "url: https://..." and "title: ..." lines (npm run learn writes them).
// Small knowledge goes to the model whole; large knowledge is cut down to the parts
// that share the most words with the question. No extra service is needed.

const LIMIT = 30_000; // characters sent to the model per question

export function parseFile(name, raw) {
  const meta = {};
  const lines = String(raw).replace(/\r/g, '').split('\n');
  while (lines.length && /^(url|title):\s*/i.test(lines[0])) {
    const [, k, v] = lines.shift().match(/^(\w+):\s*(.*)$/);
    meta[k.toLowerCase()] = v.trim();
  }
  const base = meta.title || name.replace(/\.(md|txt)$/i, '').replace(/[-_]+/g, ' ');
  const parts = [];
  let title = base;
  let buf = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) parts.push({ title, url: meta.url || '', text });
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) { flush(); title = h[1].trim() || base; } else buf.push(line);
  }
  flush();
  return parts;
}

const words = (t) => new Set(String(t).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));

export function pickContext(knowledge, question) {
  const parts = knowledge.parts;
  if (!parts.length) return '(No knowledge has been added yet.)';
  const show = (p) => `### ${p.title}${p.url ? ` (${p.url})` : ''}\n${p.text}`;
  const all = parts.map(show).join('\n\n');
  if (all.length <= LIMIT) return all;
  const q = words(question);
  const scored = parts
    .map((p, i) => {
      const w = words(p.title + ' ' + p.text);
      let hit = 0;
      for (const x of q) if (w.has(x)) hit++;
      return { p, i, score: hit / Math.sqrt(w.size + 1) };
    })
    .sort((a, b) => b.score - a.score);
  const out = [];
  let size = 0;
  for (const { p } of scored) {
    const s = show(p);
    if (size + s.length > LIMIT) continue;
    out.push(s);
    size += s.length;
  }
  return out.join('\n\n');
}
