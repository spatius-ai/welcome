// The brain of WELCOME: what makes it a website help desk, and nothing else.
// Plain functions with no network, no avatar and no web server, so you can copy this file
// (with knowledge.mjs) into any app or agent (your own backend, a LiveKit agent, a phone bot).
//
//   answerMessages(who, knowledge, question) -> the messages to send to any chat LLM (JSON mode)
//   readAnswer(raw)                          -> { answer, source, url, quote } from the LLM's answer
//   speakable(text)                          -> the answer cleaned up for a voice
//
// "who" is { name, company, lang }: the avatar's name (optional), the company it speaks for,
// and the language to use when a question is too short to tell (en, es, zh, ar, fr).

import { pickContext } from './knowledge.mjs';

const LANG_NAMES = { en: 'English', es: 'Spanish', zh: 'Chinese (Simplified)', ar: 'Arabic', fr: 'French' };

/** The rules: speak for the company, answer only from its knowledge, and point to where the answer is. */
export function answerPrompt({ name, company, lang }, context) {
  return `You are ${name ? `${name}, ` : ''}the voice of ${company}'s website. You answer visitor questions out loud.
Rules:
- You speak FOR the company, as "we" and "our". Questions like "what do you do" or "who are you" are about the company and its products, never about you as an assistant.
- Answer ONLY from the KNOWLEDGE below. If the answer is not there, say you don't know, and point to the contact details if the knowledge has them.
- Speak naturally, in 1 to 3 short sentences. No lists, no markdown, no links read out, no emoji.
- Answer in the same language as the visitor's question. Only if the question is too short to tell, answer in ${LANG_NAMES[lang] || 'English'}.
- Return JSON: {"answer": string, "source": string (the title of the knowledge section you used, or ""), "url": string (its URL, or ""), "quote": string (3 to 8 words copied exactly from that section, so the page can show where it is, or "")}.

KNOWLEDGE:
${context}`;
}

/** Everything the LLM needs: the rules with the best-matching knowledge, and the question. */
export function answerMessages(who, knowledge, question) {
  return [{ role: 'system', content: answerPrompt(who, pickContext(knowledge, question)) }, { role: 'user', content: question }];
}

/** The LLM's JSON, made safe to show: only plain web links come back (a website's text can try to steer an answer). */
export function readAnswer(raw) {
  let out = {};
  try { out = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { /* an empty answer */ }
  return {
    answer: String(out.answer || '').trim() || "Sorry, I don't have an answer for that.",
    source: String(out.source || ''),
    url: /^https?:\/\//i.test(String(out.url || '')) ? String(out.url) : '',
    quote: String(out.quote || ''),
  };
}

/** What a voice can say: no brackets, no markdown, no dashes read aloud. */
export const speakable = (t) => String(t || '').replace(/\[[^\]]*\]|\*+/g, '').replace(/[–—]/g, ', ').replace(/\s+/g, ' ').trim().slice(0, 800);
