// Voices from ElevenLabs, used when ELEVENLABS_API_KEY is set (otherwise the OpenAI voice is used, as before).
// Each person has one voice of their own, the same in every Spatius demo, and a native voice for Arabic.
// ElevenLabs sends raw PCM16 mono at 24 kHz (output_format pcm_24000): exactly what the avatar takes, so it is passed on untouched.

export const ELEVEN_VOICES = {
  'dbb01388-7c57-47bf-ab59-c492caeb9d90': { name: 'Julian', voice: 'iP95p4xoKVk53GoZ742B', ar: 'Ughw9ouHSYmmbRa0am9u' }, // Chris; Arabic: Rami
  '9078fde3-8e55-4311-a8d6-7740185b5b0d': { name: 'Nadia', voice: 'hpp4J3VqNfWAUOO0d1Us', ar: 'isQLuoVuANx6FjDxyasX' }, // Bella; Arabic: Noura
  'fc259540-c009-44f3-a6ed-ccaedb999dba': { name: 'Grace', voice: 'EXAVITQu4vr4xnSDxMaL', ar: 'ulJ49j1YlxrYnPoj5o12' }, // Sarah; Arabic: Lama
  '566981dd-1d95-4844-953e-d67e18b2fde8': { name: 'Victor', voice: 'JBFqnCBsd6RMkjVDRZzb', ar: 'IES4nrmZdUBHByLBde0P' }, // George; Arabic: Haytham
  '82d7dce9-ec05-4102-969f-2fe341af28cd': { name: 'Camille', voice: 'cgSgspJ2msm6clMCkdW9', ar: 'ulJ49j1YlxrYnPoj5o12' }, // Jessica; Arabic: Lama
  '56f31c71-58ff-410f-85d2-11b9658c7b49': { name: 'Owen', voice: 'cjVigY5qzO86Huf0OWal', ar: 'IYnFszSKzmym2OstwHS0' }, // Eric; Arabic: Hadi
  '8b86dda1-98ed-4acd-8a4e-b1a00ba69268': { name: 'Nora', voice: 'XrExE9yKIg1WjnnlVkGX', ar: 'isQLuoVuANx6FjDxyasX' }, // Matilda; Arabic: Noura
  '94a457d0-fa28-4aa8-a37a-e41e9f448f89': { name: 'Sofia', voice: 'Xb7hH8MSUJpSbSDYk0k2', ar: 'ulJ49j1YlxrYnPoj5o12' }, // Alice; Arabic: Lama
  '3854e8f8-d4d9-42e2-af7e-9f6971ad18e2': { name: 'Amara', voice: 'pFZP5JQG7iQjIQuC4Bku', ar: 'isQLuoVuANx6FjDxyasX' }, // Lily; Arabic: Noura
};

/** The ElevenLabs settings from the environment: { key, model }. */
export const elevenOf = (env) => ({ key: env.ELEVENLABS_API_KEY || '', model: env.ELEVENLABS_MODEL || 'eleven_v4_turbo' });

/**
 * The voice for this person from ElevenLabs, as a streaming response of 24 kHz PCM, or null when there is no key,
 * no voice for this face, or ElevenLabs says no (for example the credit cap): then the caller uses the OpenAI voice.
 */
export async function elevenSpeech(eleven, avatarId, text, lang = '') {
  const v = ELEVEN_VOICES[avatarId];
  if (!eleven?.key || !v || !text) return null;
  const arabic = lang === 'ar' || /[؀-ۿ]/.test(text);
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${arabic && v.ar ? v.ar : v.voice}/stream?output_format=pcm_24000`, {
      method: 'POST', headers: { 'xi-api-key': eleven.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: eleven.model }),
    });
    return r.ok && r.body ? r : null;
  } catch { return null; }
}
