// WELCOME: a talking avatar that answers your visitors from your own knowledge.
// Launcher in the corner -> panel with the live face, captions, questions, microphone.
import './widget.css';
import { canDraw, getSession, initSdk, loadSeat, type Seat, type Session } from './seat';

interface Config extends Session {
  face: string; name: string; lang: string; company: string; greeting: string; questions: string[]; starter: boolean; knowledgeParts: number;
}
interface Answer { question: string; answer: string; source: string; url: string; quote: string; error?: string; starterUsed?: boolean }

const ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};
const FACE_IMG: Record<string, string> = { julian: '/assets/face.jpg', nadia: '/assets/nadia.webp', grace: '/assets/grace.webp', victor: '/assets/victor.webp' };
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const root = document.createElement('div');
root.id = 'welcome-widget';
root.className = 'spatius-website-theme';
root.innerHTML = `
  <div class="ww-greet ww-card" hidden><span class="hp-type-mono ww-tag"><span class="ww-dot"></span>Live · answers from this site</span><p class="hp-type-body-ui" id="ww-greet-text"></p></div>
  <button class="ww-launcher" type="button" aria-label="Talk to the website avatar">
    <span class="ww-face-wrap"><span class="ww-breath"></span><span class="ww-face"><img alt=""></span></span>
    <span class="ww-txt"><span class="hp-type-action" id="ww-ask-name">Ask</span><span class="hp-type-mono">Voice or text</span></span>
  </button>
  <section class="ww-panel ww-card" aria-label="Website avatar" hidden>
    <div class="ww-stage">
      <div class="ww-avatar" id="ww-avatar"></div>
      <div class="ww-loading hp-type-label" id="ww-loading">Getting ready…</div>
      <div class="ww-top">
        <span class="ww-pill hp-type-mono"><span class="ww-dot"></span><span id="ww-state">Ready</span><span class="ww-bars"><i></i><i></i><i></i><i></i></span></span>
        <button class="ww-icon ww-sp" type="button" id="ww-min" aria-label="Minimise">${ICON.min}</button>
        <button class="ww-icon" type="button" id="ww-close" aria-label="End conversation">${ICON.close}</button>
      </div>
      <div class="ww-caption hp-type-body-ui" id="ww-caption" aria-live="polite"></div>
    </div>
    <div class="ww-starter hp-type-label" id="ww-starter" hidden></div>
    <div class="ww-convo" id="ww-convo"><p class="ww-tip hp-type-card-copy">Speak or type. Answers come only from this website.</p></div>
    <div class="ww-dock">
      <div class="ww-chips" id="ww-chips"></div>
      <form class="ww-ask" id="ww-form">
        <label class="ww-field"><input id="ww-q" autocomplete="off" placeholder="Ask a question" aria-label="Your question"><button class="ww-send" type="submit" aria-label="Send">${ICON.send}</button></label>
        <button class="ww-mic" type="button" id="ww-mic" aria-label="Speak" aria-pressed="false">${ICON.mic}</button>
      </form>
      <div class="ww-powered hp-type-mono">Powered by Spatius</div>
    </div>
  </section>`;
document.body.appendChild(root);

const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
const panel = $('.ww-panel'), greet = $('.ww-greet'), launcher = $('.ww-launcher'), convo = $('#ww-convo'), cap = $('#ww-caption');
const stateEl = $('#ww-state'), stage = $('.ww-stage');
let cfg: Config | null = null;
let seat: Seat | null = null;
let seatLoading: Promise<Seat | null> | null = null;
let drawable = true;
let busy = false;

function setState(t: string, listening = false) { stateEl.textContent = t; stage.classList.toggle('ww-listening', listening); }
function say(cls: string, html: string) {
  root.querySelector('.ww-tip')?.remove();
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  convo.appendChild(el);
  convo.scrollTop = convo.scrollHeight;
  return el;
}
function starter(left: string | null, used = false) {
  const box = $('#ww-starter');
  if (used) { box.hidden = false; box.className = 'ww-starter ww-used hp-type-label'; box.innerHTML = '<b>Your starter minutes are used.</b> Add your own OPENAI_API_KEY to .env to keep going.'; return; }
  if (left === null) return;
  const n = Number(left);
  if (n <= 5) { box.hidden = false; box.className = 'ww-starter hp-type-label'; const m = Math.max(0, Math.ceil(n)); box.textContent = `${m} starter minute${m === 1 ? '' : 's'} left.`; }
}

// ---------- start ----------
async function boot() {
  try {
    cfg = (await getSession()) as Config;
  } catch (e) {
    greet.hidden = false;
    $('#ww-greet-text').textContent = (e as Error).message;
    return;
  }
  ($('.ww-face img') as HTMLImageElement).src = FACE_IMG[cfg.face] || FACE_IMG.julian;
  $('#ww-ask-name').textContent = `Ask ${cfg.name}`;
  $('#ww-greet-text').textContent = cfg.greeting;
  greet.hidden = false;
  const qs = cfg.questions.length ? cfg.questions : [];
  $('#ww-chips').innerHTML = qs.map((q) => `<button class="ww-chip hp-type-label" type="button">${esc(q)}</button>`).join('');
  root.querySelectorAll<HTMLButtonElement>('.ww-chip').forEach((b) => (b.onclick = () => ask(b.textContent || '')));
  drawable = await canDraw();
  if (drawable) void initSdk(cfg).catch((e) => console.warn('[welcome] avatar SDK', e));
}

function getSeat(): Promise<Seat | null> {
  if (!cfg || !drawable) return Promise.resolve(null);
  return (seatLoading ??= (async () => {
    try {
      await initSdk(cfg!);
      const { start } = await loadSeat($('#ww-avatar'), cfg!.avatars[cfg!.face], (f) => ($('#ww-loading').textContent = `Getting ready… ${Math.round(f * 100)}%`));
      $('#ww-loading').hidden = true;
      seat = await start();
      void seat.connect().catch(() => undefined);
      return seat;
    } catch (e) {
      console.warn('[welcome] the face could not load, voice only', e);
      $('#ww-loading').textContent = 'Voice only on this device';
      drawable = false;
      return null;
    }
  })());
}

function open() {
  panel.hidden = false; greet.hidden = true; launcher.hidden = true;
  void getSeat();
}
function fold() { panel.hidden = true; launcher.hidden = false; seat?.interrupt(); setState('Ready'); }
launcher.onclick = open;
$('#ww-min').onclick = fold;
$('#ww-close').onclick = () => { fold(); clearMarks(); seat?.disconnect(); };

// ---------- voice ----------
async function voice(text: string): Promise<() => Promise<Int16Array | null>> {
  const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  starter(r.headers.get('x-starter-minutes-left'));
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || 'The voice did not come through.');
  const reader = r.body.getReader();
  let held = new Uint8Array(0);
  let ended = false;
  return async () => {
    for (;;) {
      if (held.length >= 9600 || (ended && held.length >= 2)) {
        const whole = ended ? held.length - (held.length % 2) : held.length - (held.length % 2);
        const out = new Int16Array(held.slice(0, whole).buffer);
        held = held.slice(whole);
        return out;
      }
      if (ended) return null;
      const { value, done } = await reader.read();
      if (done) { ended = true; continue; }
      const next = new Uint8Array(held.length + value.length);
      next.set(held); next.set(value, held.length); held = next;
    }
  };
}

// devices that cannot draw the face still hear the answer
async function playPlain(next: () => Promise<Int16Array | null>) {
  const ctx = new AudioContext({ sampleRate: 24000 });
  let at = ctx.currentTime + 0.05;
  for (let c = await next(); c; c = await next()) {
    const buf = ctx.createBuffer(1, c.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < c.length; i++) ch[i] = c[i] / 32768;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(at); at += buf.duration;
  }
  await new Promise((r) => setTimeout(r, Math.max(0, (at - ctx.currentTime) * 1000)));
}

function captions(text: string, started: Promise<number>) {
  const cjk = !/\s/.test(text.trim());
  const words = cjk ? [...text] : text.split(/\s+/);
  const size = cjk ? 14 : 8;
  const rate = cjk ? 6 : 2.7; // units per second, close to the voice
  let k = 0;
  let timer = 0;
  void started.then(() => {
    timer = window.setInterval(() => {
      const s = Math.floor(k / size) * size;
      cap.innerHTML = words.slice(s, s + size).map((w, j) => `<span class="${s + j <= k ? 'on' : ''}">${esc(w)}</span>`).join(cjk ? '' : ' ');
      if (++k >= words.length) window.clearInterval(timer);
    }, 1000 / rate);
  });
  return () => { window.clearInterval(timer); window.setTimeout(() => (cap.innerHTML = ''), 2500); };
}

// ---------- Show me: find the quoted words on this page and mark them ----------
function clearMarks() { document.querySelectorAll('.ww-lit').forEach((e) => e.classList.remove('ww-lit')); }
function findOnPage(quote: string): HTMLElement | null {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  if (q.length < 6) return null;
  // the smallest block on the page that holds the quoted words
  let best: HTMLElement | null = null;
  for (const el of document.body.querySelectorAll<HTMLElement>('p, li, td, dd, blockquote, section, article, div')) {
    if (root.contains(el)) continue;
    const t = norm(el.textContent || '');
    if (t.includes(q) && (!best || t.length < norm(best.textContent || '').length)) best = el;
  }
  if (best && best.tagName === 'P' && best.parentElement && norm(best.parentElement.textContent || '').length < 400) best = best.parentElement;
  return best;
}
function showMe(target: HTMLElement) {
  clearMarks();
  target.classList.add('ww-lit');
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  fold();
  greet.hidden = false;
  $('#ww-greet-text').textContent = 'Here it is. Tap me to keep talking.';
}

// ---------- ask ----------
async function ask(text: string, audio?: Blob) {
  if (busy || (!text && !audio)) return;
  busy = true;
  const s = getSeat();
  if (text) say('ww-you hp-type-card-copy', esc(text));
  setState('Thinking');
  try {
    const r = await fetch('/api/ask', audio
      ? { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    starter(r.headers.get('x-starter-minutes-left'));
    const a = (await r.json().catch(() => ({ error: 'No answer came back.' }))) as Answer;
    if (!r.ok || a.error) { if (a.starterUsed) starter(null, true); say('ww-bot ww-err hp-type-card-copy', esc(a.error || 'Something went wrong.')); return; }
    if (audio) say('ww-you hp-type-card-copy', esc(a.question));
    const bot = say('ww-bot', `<p class="hp-type-card-copy">${esc(a.answer)}</p>`);
    const target = a.quote ? findOnPage(a.quote) : null;
    if (a.source || target || a.url) {
      const row = document.createElement('div');
      row.className = 'ww-src-row';
      row.innerHTML = a.source ? `<span class="ww-src hp-type-mono">From · ${esc(a.source)}</span>` : '';
      if (target) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ww-show'; b.innerHTML = `Show me${ICON.send}`;
        b.onclick = () => showMe(target); row.appendChild(b);
      } else if (a.url && a.url !== location.href) {
        row.insertAdjacentHTML('beforeend', `<a class="ww-show" href="${esc(a.url)}">Open page${ICON.send}</a>`);
      }
      bot.appendChild(row);
    }
    setState('Speaking');
    const next = await voice(a.answer);
    const st = await s;
    if (st) {
      const pb = st.stream(next);
      const stop = captions(a.answer, pb.started);
      await pb.done; stop();
    } else {
      let mark!: (n: number) => void; const started = new Promise<number>((r) => (mark = r));
      const stop = captions(a.answer, started); mark(performance.now());
      await playPlain(next); stop();
    }
  } catch (e) {
    say('ww-bot ww-err hp-type-card-copy', esc((e as Error).message));
  } finally {
    busy = false;
    setState('Ready');
  }
}

$('#ww-form').onsubmit = (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('#ww-q');
  const v = q.value.trim();
  q.value = '';
  void ask(v);
};

// ---------- microphone: stops by itself after a short silence ----------
let rec: MediaRecorder | null = null;
$('#ww-mic').onclick = async () => {
  const mic = $('#ww-mic');
  if (rec) { rec.stop(); return; }
  if (busy) { seat?.interrupt(); return; }
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { say('ww-bot ww-err hp-type-card-copy', 'Allow the microphone, or type your question.'); return; }
  void getSeat();
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  rec = r;
  const parts: Blob[] = [];
  r.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const ac = new AudioContext();
  const an = ac.createAnalyser(); an.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  let heard = false, quietSince = performance.now();
  const began = performance.now();
  const tick = window.setInterval(() => {
    an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((n, x) => n + x * x, 0) / buf.length);
    if (rms > 0.02) { heard = true; quietSince = performance.now(); }
    const now = performance.now();
    if ((heard && now - quietSince > 1200) || now - began > 15000 || (!heard && now - began > 6000)) r.stop();
  }, 100);
  r.onstop = () => {
    window.clearInterval(tick); void ac.close(); stream.getTracks().forEach((t) => t.stop());
    rec = null; mic.classList.remove('ww-on'); mic.setAttribute('aria-pressed', 'false'); setState('Ready');
    if (heard && parts.length) void ask('', new Blob(parts, { type: r.mimeType || 'audio/webm' }));
  };
  r.start(250);
  mic.classList.add('ww-on'); mic.setAttribute('aria-pressed', 'true'); setState('Listening', true);
};

void boot();
