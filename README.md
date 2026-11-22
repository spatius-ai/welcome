# WELCOME chatbot

## Overview

WELCOME is a talking avatar for any website. A visitor asks a question by voice or by typing, and a live Spatius avatar answers out loud, with lip sync and captions. It answers only from the company's own knowledge: the pages of its website and any files you add. When it can, it shows the visitor where the answer is on the page.

This repository is a small, complete template. It runs on your computer in a few minutes with only your Spatius API key and App ID, and it is written to be read and changed: one API file (shared by the local server and Cloudflare), one widget, one folder of knowledge.

It is for developers who want a website help desk, front desk or product guide with a face, and for anyone who wants to see how a Spatius avatar is wired to speech, an LLM and a web page.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/spatius-ai/welcome)

## Why this matters

Most website chatbots are a text box. WELCOME gives the company a face and a voice, answers only from what the company has published, and says "I don't know" instead of guessing. It runs on your own Spatius account, so you can put it on your own site and change everything.

## User flow

1. The visitor opens a page with WELCOME on it and sees a small launcher in the corner with the avatar's face.
2. The visitor clicks it, then speaks or types a question, or picks one of the suggested questions.
3. The server turns speech into text, finds the answer in the knowledge, and turns the answer into speech.
4. The avatar says the answer live, with captions, and lists the page the answer came from.
5. If the answer is on the current page, "Show me" scrolls to it and marks it.

## Architecture

```text
welcome/
  README.md
  LICENSE
  package.json
  vite.config.mjs           builds the web page and copies the avatar engine files
  wrangler.jsonc            Cloudflare Workers settings
  .env.example              settings for running on your computer
  .dev.vars.example         secrets for Cloudflare
  knowledge/
    maple-bikes.md          example knowledge; replace it with yours
  scripts/
    learn.mjs               reads a website into knowledge/
    build-knowledge.mjs     bundles knowledge/ for Cloudflare
  server/
    brain.mjs               WELCOME itself: the answering rules, reading the answer, a clean voice line
    voices.mjs              optional ElevenLabs voices, one per person (used when ELEVENLABS_API_KEY is set)
    app.mjs                 the API: session token, answer, voice (uses brain.mjs)
    knowledge.mjs           reads the knowledge files and picks the parts for each question
    node.mjs                runs the app on your computer
    worker.mjs              runs the app on Cloudflare Workers
  web/
    index.html              an example website (Maple Bikes) with the widget on it
    src/widget.ts           the launcher, the panel, the microphone and "Show me"
    src/widget.css          the widget's look, kept inside the widget
    src/seat.ts             the Spatius avatar: load, connect, speak
    public/assets/          fonts, faces and the example site's pictures
```

The code has three parts, so you can keep the part you need. `server/brain.mjs` (with `knowledge.mjs`) is what makes it a help desk; `server/app.mjs` connects it to OpenAI and the browser; `web/src/seat.ts` connects the avatar. The same `server/app.mjs` runs in both places. It only uses the standard `fetch`, `Request` and `Response`, so `node.mjs` and `worker.mjs` are thin wrappers around it.

## Runtime modes

| Mode | Command | Knowledge |
| --- | --- | --- |
| On your computer | `npm start` | Read from `knowledge/` at start |
| Cloudflare Workers, local | `cp .dev.vars.example .dev.vars`, then `npm run dev:cf` | Bundled at build time |
| Cloudflare Workers, online | `npm run deploy` or the Deploy button | Bundled at build time |

**Starter minutes or your own OpenAI key.** Speech to text, the answer and the voice use OpenAI. Without `OPENAI_API_KEY`, WELCOME uses free Spatius starter minutes (30 minutes per Spatius key), sent through `starter.spatius.app` with your Spatius key. When they are used, the widget asks you to add your own key. With `OPENAI_API_KEY` set, WELCOME calls OpenAI directly and the starter service is not used.

## Protocols and contracts

The browser talks to the server through three routes.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/session` | none | `appId`, `region`, `sessionToken`, `avatars`, `face`, `name`, `lang`, `company`, `greeting`, `questions`, `starter`, `knowledgeParts` |
| `POST /api/ask` | JSON `{ "text": "..." }`, or recorded audio as the body | `{ question, answer, source, url, quote }` |
| `POST /api/speak` | JSON `{ "text": "..." }` | The voice as raw PCM16, mono, 24 kHz, streamed |

Errors come back as `{ "error": "..." }` with a matching HTTP status; when starter minutes are used up the status is 402 and `starterUsed` is `true`.

The voice is passed to the avatar exactly as it arrives (24 kHz), with no resampling, so the lips and the sound stay together and the voice stays clear. `quote` is a few words copied from the knowledge; the widget looks for them on the page to power "Show me".

## Use it in your own app

Pick the row that matches what you have.

| You have | Do this |
| --- | --- |
| Any website, and you want WELCOME on it | Build it once and serve it with its API (see "Put it on your own website" under Setup), or deploy to Cloudflare. The widget is two lines in your page. |
| Your own backend, in any language | Copy `server/brain.mjs` and `server/knowledge.mjs` (or port them: plain functions, no network). Call `answerMessages()` before your LLM call and `readAnswer()` after it. |
| Your own web page, and you want the avatar | Copy `web/src/seat.ts`. It loads a Spatius avatar into any element and plays 24 kHz PCM16 audio on it with lip sync. |
| A LiveKit or Agora voice agent | Start from Spatius's official example, [livekit-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/livekit-demo) or [agora-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/agora-demo), then call `answerMessages()` / `readAnswer()` from your agent's LLM step. The brain is plain functions, so this demo's standout feature works the same over LiveKit or Agora. |
| Another LLM, or an OpenAI-compatible gateway | Set `OPENAI_BASE_URL` with your own `OPENAI_API_KEY`. The brain works with any chat model that can return JSON. |

Spatius's official examples show how to connect an avatar (Direct, LiveKit, Agora, iOS, Android, Flutter): [spatius-integration-demo](https://github.com/spatius-ai/spatius-integration-demo), [livekit-plugins-spatius](https://github.com/spatius-ai/livekit-plugins-spatius) and [create-spatius-app](https://github.com/spatius-ai/create-spatius-app). This template shows what to build on top: the use case and its standout feature, in a brain you can plug into any of them.

## Technical stack

- Spatius avatar SDK (`@spatius/avatarkit`) in Direct mode, drawn in the browser
- OpenAI: `gpt-4o-mini-transcribe` (speech to text), `gpt-4.1-mini` (answers), `gpt-4o-mini-tts` (voice); all can be changed in settings
- Vite for the web page, plain Node for the local server, Cloudflare Workers for hosting
- No database and no framework

## Setup and local development

You need Node 20.3 or newer, a Spatius account (for an API key and App ID from [app.spatius.ai](https://app.spatius.ai)) and a browser with WebGPU or WebGL2.

```sh
git clone https://github.com/spatius-ai/welcome
cd welcome
cp .env.example .env      # paste SPATIUS_API_KEY and SPATIUS_APP_ID
npm install
npm start                 # open http://localhost:3000
```

**Use your own website.** Read up to 50 public pages of your site into `knowledge/`, then restart:

```sh
npm run learn -- https://yourcompany.com
npm start
```

The example shop moves to `examples/` so it does not mix with your company. You can also put your own `.md` or `.txt` files in `knowledge/`. Small knowledge is sent to the model whole; large knowledge is cut down to the parts that best match each question.

**Put it on your own website.** The widget calls `/api/...` and loads `/assets/...` on the same address as the page, so the page, the built files and the API must be served from one origin:

1. Replace the example shop in `web/index.html` with your own page, or copy its two WELCOME lines (the stylesheet line and the script line) into your page.
2. Run `npm run build`. Serve the `dist/` folder and the `/api` routes together, for example with `server/node.mjs` behind your domain, or deploy to Cloudflare, which does both.

## Environment configuration

| Setting | Needed | What it does |
| --- | --- | --- |
| `SPATIUS_API_KEY` | Yes | Your Spatius API key |
| `SPATIUS_APP_ID` | Yes | Your Spatius App ID |
| `SPATIUS_REGION` | No | `us-west` (default) or your region |
| `OPENAI_API_KEY` | No | Your OpenAI key; without it, starter minutes are used |
| `ELEVENLABS_API_KEY` | No | ElevenLabs voices: each person has their own voice, and a native voice for Arabic. Without it, the OpenAI voice is used, and it is also used if ElevenLabs refuses a request. Model: `ELEVENLABS_MODEL` (default `eleven_v4_turbo`) |
| `OPENAI_BASE_URL` | No | Another OpenAI-compatible address for your own key. Your OpenAI key is never sent to the starter service. |
| `SPATIUS_STARTER_URL` | No | Another starter service address (for testing) |
| `WELCOME_COMPANY` | No | The company name the avatar speaks for |
| `WELCOME_FACE` | No | `julian`, `nadia`, `grace` or `victor` |
| `SPATIUS_AVATAR_ID` | No | Any other avatar from your Spatius account |
| `WELCOME_LANG` | No | Default answer language, for example `en`, `es`, `zh`, `ar` |
| `WELCOME_QUESTIONS` | No | Suggested questions, separated by `\|` |
| `WELCOME_NAME`, `WELCOME_GREETING` | No | The avatar's name and first line |
| `OPENAI_VOICE`, `OPENAI_CHAT_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL` | No | Voice and models |
| `PORT` | No | Local port, 3000 by default |

On Cloudflare, put the keys in `.dev.vars` (local) or as secrets (online); the other settings are in `wrangler.jsonc` under `vars`.

## Security and deployment guidance

- Keys stay on the server. The browser only receives a short-lived Spatius session token.
- The `/api` routes are open to anyone who can reach your site, and each answer spends your OpenAI key or starter minutes and your Spatius minutes. WELCOME allows 30 API requests per minute per visitor; for a public site, also turn on your host's rate limiting (for example Cloudflare rate limiting rules) and set a monthly limit in your OpenAI account.
- `.env` and `.dev.vars` are ignored by git. Never commit them.
- WELCOME answers only from your knowledge and is told not to guess. Check your knowledge files before you go live: whatever is in them can be said out loud.
- Starter minutes are for trying WELCOME. For a live website, use your own OpenAI key and set limits in your OpenAI account.
- The avatar SDK sends basic performance data to Spatius so failures can be found. See the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/).

## License and use constraints

The code in this repository is under the MIT License (see `LICENSE`). The Spatius avatar SDK (`@spatius/avatarkit`) and the Spatius service are not part of this license; they are covered by the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/). The fonts in `web/public/assets/fonts/` (Inter, Geist Mono, Space Grotesk) are under the SIL Open Font License; their license texts are in `web/public/assets/licenses/`. The example shop, its pictures and the face photos are examples for this template.
