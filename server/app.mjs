// WELCOME server: one request handler, written with standard Request and Response,
// so the same code runs in Node (server/node.mjs) and on Cloudflare Workers.
//
//   GET  /api/session  -> { appId, region, sessionToken, avatars, face, name, greeting, questions, lang }
//   POST /api/ask      -> body: { text } or recorded audio  ->  { question, answer, source, quote }
//   POST /api/speak    -> body: { text }  ->  the voice, PCM16 mono 24 kHz (streamed)
//
// OpenAI is reached through OPENAI_BASE_URL. With your own OPENAI_API_KEY it is OpenAI itself.
// Without it, the requests go to the Spatius starter service, signed with your Spatius key.

import { answerMessages, readAnswer, speakable } from './brain.mjs';
import { elevenSpeech, elevenOf } from './voices.mjs';

const FACES = {
  julian: 'dbb01388-7c57-47bf-ab59-c492caeb9d90',
  nadia: '9078fde3-8e55-4311-a8d6-7740185b5b0d',
  grace: 'fc259540-c009-44f3-a6ed-ccaedb999dba',
  victor: '566981dd-1d95-4844-953e-d67e18b2fde8',
};
const VOICES = { julian: 'ash', nadia: 'coral', grace: 'sage', victor: 'onyx' };
const STARTER_URL = 'https://starter.spatius.app/v1';
const isStarter = (u) => /starter\.spatius\.app|demotius-starter/.test(u || '');

export function settings(env) {
  const face = (env.WELCOME_FACE || 'julian').toLowerCase();
  const ownKey = !!env.OPENAI_API_KEY;
  // Your own OpenAI key only ever goes to OpenAI (or the OPENAI_BASE_URL you set), never to the starter service.
  // Without a key, requests go to the starter service, signed with your Spatius key.
  const starterUrl = env.SPATIUS_STARTER_URL || STARTER_URL;
  const base = ownKey ? (env.OPENAI_BASE_URL && !isStarter(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1') : starterUrl;
  return {
    apiKey: env.SPATIUS_API_KEY || '',
    eleven: elevenOf(env), // ElevenLabs voices when ELEVENLABS_API_KEY is set
    appId: env.SPATIUS_APP_ID || '',
    region: env.SPATIUS_REGION || 'us-west',
    avatarId: env.SPATIUS_AVATAR_ID || FACES[face] || FACES.julian,
    face,
    name: env.WELCOME_NAME || face.charAt(0).toUpperCase() + face.slice(1),
    voice: env.OPENAI_VOICE || VOICES[face] || 'ash',
    lang: env.WELCOME_LANG || 'en',
    company: env.WELCOME_COMPANY || 'our company',
    openai: {
      base: base.replace(/\/$/, ''),
      key: ownKey ? env.OPENAI_API_KEY : env.SPATIUS_API_KEY,
      starter: !ownKey,
      chat: env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
      stt: env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      tts: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    },
  };
}

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

// Starter minutes left, passed on from the starter service when it sends them.
function starterHeaders(res) {
  const left = res.headers.get('x-starter-minutes-left');
  return left === null ? {} : { 'X-Starter-Minutes-Left': left };
}

// A clear message for each way OpenAI or the starter service can say no.
async function openaiError(res, s) {
  if (s.openai.starter && res.status === 402)
    return { status: 402, error: 'Your starter minutes are used. Add your own OPENAI_API_KEY to .env to keep going.', starterUsed: true };
  if (s.openai.starter && (res.status === 404 || res.status >= 500 || res.status === 0))
    return { status: 503, error: 'The starter service is not available right now. Try again, or add your own OPENAI_API_KEY to .env.' };
  if (res.status === 401) return { status: 401, error: s.openai.starter ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.' : 'Your OPENAI_API_KEY was not accepted.' };
  if (res.status === 429) return { status: 429, error: 'Too many requests to the language service. Please wait a moment.' };
  return { status: 502, error: `The language service answered with HTTP ${res.status}.` };
}

async function callOpenAI(s, path, init) {
  try {
    const starter = s.openai.starter ? { 'X-Spatius-Region': s.region } : {};
    return await fetch(`${s.openai.base}${path}`, { ...init, headers: { Authorization: `Bearer ${s.openai.key}`, ...starter, ...(init.headers || {}) } });
  } catch {
    // network failure: a plain object, because a Response cannot have status 0
    return { ok: false, status: 0, body: null, headers: new Headers(), json: async () => ({}), text: async () => '' };
  }
}

// ---------- Spatius session token (cached for 50 minutes) ----------
let tokenCache = { token: '', until: 0, key: '' };
async function sessionToken(s) {
  if (tokenCache.token && tokenCache.key === s.apiKey && Date.now() < tokenCache.until) return tokenCache.token;
  const domain = s.region.startsWith('cn') ? 'spatialwalk.top' : 'spatius.ai';
  const res = await fetch(`https://console.${s.region}.${domain}/v1/console/session-tokens`, {
    method: 'POST',
    headers: { 'X-Api-Key': s.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expireAt: Math.floor(Date.now() / 1000) + 3600 }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.sessionToken) {
    const err = new Error(res.status === 401 || res.status === 403
      ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.'
      : `Spatius did not give a session (HTTP ${res.status}).`);
    err.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw err;
  }
  // reuse a token for 20 minutes, so every visitor gets one with at least 40 minutes left
  tokenCache = { token: body.sessionToken, until: Date.now() + 20 * 60_000, key: s.apiKey };
  return body.sessionToken;
}

// ---------- the answer (the rules are in brain.mjs) ----------
async function transcribe(s, request) {
  const type = request.headers.get('content-type') || 'audio/webm';
  const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([await request.arrayBuffer()], { type }), `question.${ext}`);
  form.append('model', s.openai.stt);
  const res = await callOpenAI(s, '/audio/transcriptions', { method: 'POST', body: form });
  if (!res.ok) return { error: await openaiError(res, s) };
  const body = await res.json().catch(() => ({}));
  return { text: String(body.text || '').trim(), headers: starterHeaders(res) };
}

async function ask(s, request, knowledge) {
  let question = '';
  let extra = {};
  if ((request.headers.get('content-type') || '').startsWith('application/json')) {
    question = String((await request.json().catch(() => ({}))).text || '').trim().slice(0, 500);
  } else {
    const t = await transcribe(s, request);
    if (t.error) return json(t.error.status, t.error);
    question = t.text.slice(0, 500);
    extra = t.headers;
  }
  if (!question) return json(400, { error: "I didn't catch that. Please try again." });

  const res = await callOpenAI(s, '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: s.openai.chat,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: answerMessages({ name: s.name, company: s.company, lang: s.lang }, knowledge, question),
    }),
  });
  if (!res.ok) { const e = await openaiError(res, s); return json(e.status, e); }
  const body = await res.json().catch(() => ({}));
  return json(200, { question, ...readAnswer(body.choices?.[0]?.message?.content) }, { ...extra, ...starterHeaders(res) });
}

async function speak(s, request) {
  const { text } = await request.json().catch(() => ({}));
  const input = speakable(text);
  if (!input) return json(400, { error: 'Nothing to say.' });
  // response_format "pcm" is raw PCM16 mono at 24 kHz: exactly what the avatar takes, so it is passed on untouched
  // ElevenLabs first when ELEVENLABS_API_KEY is set (each person has their own voice); the OpenAI voice if it is not set or says no
  const el = await elevenSpeech(s.eleven, s.avatarId, input, s.lang);
  if (el) return new Response(el.body, { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000', 'Cache-Control': 'no-store' } });
  const res = await callOpenAI(s, '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.tts, voice: s.voice, input, response_format: 'pcm', instructions: 'Warm, clear and friendly, like a helpful front desk. Natural pace.' }),
  });
  if (!res.ok || !res.body) { const e = await openaiError(res, s); return json(e.status, e); }
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000', 'Cache-Control': 'no-store', ...starterHeaders(res) } });
}

// A simple limit per visitor, so nobody can spend your keys by calling the API in a loop.
// It is kept in memory: enough for one server; use your host's rate limiting for more.
const hits = new Map();
function tooMany(request) {
  const ip = request.headers.get('cf-connecting-ip') || String(request.headers.get('x-forwarded-for') || '').split(',').pop().trim() || 'local';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > 30;
}

export async function handle(request, env, knowledge) {
  const url = new URL(request.url);
  const s = settings(env);
  if (url.pathname.startsWith('/api/') && tooMany(request)) return json(429, { error: 'Too many requests. Please wait a minute.' });
  try {
    if (url.pathname === '/api/session' && request.method === 'GET') {
      if (!s.apiKey || !s.appId) return json(500, { error: 'Add SPATIUS_API_KEY and SPATIUS_APP_ID to .env, then restart.' });
      return json(200, {
        appId: s.appId, region: s.region, sessionToken: await sessionToken(s),
        avatars: { [s.face]: s.avatarId }, face: s.face, name: s.name, lang: s.lang, company: s.company,
        starter: s.openai.starter, knowledgeParts: knowledge.parts.length,
        greeting: env.WELCOME_GREETING || `Hi, I'm ${s.name}. Ask me anything about ${s.company}.`,
        questions: (env.WELCOME_QUESTIONS || '').split('|').map((q) => q.trim()).filter(Boolean),
      });
    }
    if (url.pathname === '/api/ask' && request.method === 'POST') return await ask(s, request, knowledge);
    if (url.pathname === '/api/speak' && request.method === 'POST') return await speak(s, request);
    return null;
  } catch (err) {
    return json(err.status || 500, { error: err.message || 'Something went wrong.' });
  }
}
