/* ============================================================
   aimodel.js — which AI model StaticOS's AI apps talk to.

   llm.js uses this choice whenever a caller does not pass its own
   endpoint, model or key, so Lens, Studio, Static Markets and the rest
   all follow one setting (Settings → AI model).

   Two sources, nothing else:
     · Free with no key — the live list at https://text.pollinations.ai/models,
       keeping only models whose tier is "anonymous" (the only tier that
       works without a key). New free ones appear and removed ones
       disappear by themselves. If the list cannot be fetched, the
       built-in default is the only choice shown.
     · More free models with the person's own free OpenRouter key —
       https://openrouter.ai/api/v1/models, keeping models whose prompt
       and completion price are both "0". The key is stored per person
       (store 'ai', via profiles.js) and is sent only to openrouter.ai.

   Whatever is chosen, requests go straight from this browser to that
   host; nothing is proxied. chosen() never returns a model that cannot
   work: an OpenRouter choice with no key falls back to the default.
   ============================================================ */
import { store } from '../core/store.js';

export const POLLINATIONS = { host: 'text.pollinations.ai', endpoint: 'https://text.pollinations.ai/openai', list: 'https://text.pollinations.ai/models' };
export const OPENROUTER = { host: 'openrouter.ai', endpoint: 'https://openrouter.ai/api/v1/chat/completions', list: 'https://openrouter.ai/api/v1/models' };
export const DEFAULT = { provider: 'pollinations', model: 'openai-fast', name: 'GPT-OSS 20B (default)' };
const TTL = 10 * 60e3;

const saved = () => { const v = store.get('ai'); return v && typeof v === 'object' ? v : {}; };
const write = patch => store.set('ai', { ...saved(), ...patch });

export const hasKey = () => !!saved().orKey;
export const getKey = () => saved().orKey || '';
export function setKey(k) { write({ orKey: String(k || '').trim() }); if (!getKey() && saved().provider === 'openrouter') write({ provider: DEFAULT.provider, model: DEFAULT.model, name: DEFAULT.name }); }
export const clearKey = () => setKey('');

/** the person's choice, as stored: { provider, model, name } */
export function selection() {
  const s = saved();
  if (s.provider === 'openrouter' && s.model && s.orKey) return { provider: 'openrouter', model: s.model, name: s.name || s.model };
  if (s.provider === 'pollinations' && s.model) return { provider: 'pollinations', model: s.model, name: s.name || s.model };
  return { ...DEFAULT };
}
export function choose(provider, model, name) { write({ provider, model, name: name || model }); }

/** what llm.js sends to: { endpoint, model, apiKey } */
export function chosen() {
  const s = selection();
  if (s.provider === 'openrouter') return { endpoint: OPENROUTER.endpoint, model: s.model, apiKey: getKey() };
  return { endpoint: POLLINATIONS.endpoint, model: s.model, apiKey: '' };
}
/** a label for the UI: name, where requests go */
export function describe() {
  const s = selection();
  return { ...s, host: s.provider === 'openrouter' ? OPENROUTER.host : POLLINATIONS.host };
}

/* ---- the live lists, cached for ten minutes ---- */
const cache = {};
async function getJson(url, signal) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  signal?.addEventListener('abort', () => ac.abort(), { once: true });
  try {
    const r = await fetch(url, { signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
/** models that work with no key. { models, live } — live is false when the list could not be fetched */
export async function anonymousModels({ force = false, signal } = {}) {
  const c = cache.poll;
  if (!force && c && Date.now() - c.t < TTL) return c.v;
  let v;
  try {
    const j = await getJson(POLLINATIONS.list, signal);
    const models = (Array.isArray(j) ? j : []).filter(m => m && m.tier === 'anonymous' && typeof m.name === 'string' && (!m.output_modalities || m.output_modalities.includes('text')))
      .map(m => ({ provider: 'pollinations', model: m.name, name: modelName(m), host: POLLINATIONS.host }));
    if (!models.length) throw new Error('no anonymous models');
    v = { models, live: true };
    const s = saved();
    if (s.provider === 'pollinations' && s.model && !models.some(m => m.model === s.model)) write({ provider: DEFAULT.provider, model: DEFAULT.model, name: DEFAULT.name });   /* removed upstream */
  } catch (e) {
    if (signal?.aborted) throw e;
    v = { models: [{ ...DEFAULT, host: POLLINATIONS.host, name: DEFAULT.name }], live: false };
  }
  cache.poll = { t: Date.now(), v };
  return v;
}
const modelName = m => { const d = String(m.description || '').split('(')[0].trim(); return d ? `${d} (${m.name})` : m.name; };

/** models that cost nothing on OpenRouter; only with a key (the key is not needed to list them, but without one they cannot be used) */
export async function openrouterFree({ force = false, signal } = {}) {
  if (!hasKey()) return { models: [], live: false, needsKey: true };
  const c = cache.or;
  if (!force && c && Date.now() - c.t < TTL) return c.v;
  try {
    const j = await getJson(OPENROUTER.list, signal);
    const models = (j.data || []).filter(m => m && m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 && m.pricing.prompt != null && m.pricing.completion != null
      && (!m.architecture || (m.architecture.output_modalities || ['text']).includes('text') && (m.architecture.input_modalities || ['text']).includes('text')))
      .map(m => ({ provider: 'openrouter', model: m.id, name: m.name || m.id, host: OPENROUTER.host })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80);
    const v = { models, live: true };
    cache.or = { t: Date.now(), v };
    return v;
  } catch (e) {
    if (signal?.aborted) throw e;
    return { models: [], live: false, error: 'Could not load the OpenRouter list.' };
  }
}
export const forgetLists = () => { delete cache.poll; delete cache.or; delete cache.vision; };

/* ---- can the chosen model look at a picture? ----
   Never assumed: the model's own entry in the live list has to say it takes
   images (OpenRouter: architecture.input_modalities includes "image";
   Pollinations: input_modalities includes "image", or vision is true).
   When the list can't be fetched or has no such entry the answer is "no". */
export async function visionCheck({ signal } = {}) {
  const s = selection();
  const host = s.provider === 'openrouter' ? OPENROUTER.host : POLLINATIONS.host;
  const base = { ok: false, host, name: s.name, model: s.model };
  const hit = cache.vision;
  if (hit && hit.key === `${s.provider}|${s.model}` && Date.now() - hit.t < TTL) return hit.v;
  let v;
  try {
    if (s.provider === 'openrouter') {
      const j = await getJson(OPENROUTER.list, signal);
      const m = (j.data || []).find(x => x && x.id === s.model);
      v = { ...base, ok: !!m && Array.isArray(m.architecture?.input_modalities) && m.architecture.input_modalities.includes('image') };
    } else {
      const j = await getJson(POLLINATIONS.list, signal);
      const m = (Array.isArray(j) ? j : []).find(x => x && x.name === s.model);
      v = { ...base, ok: !!m && (m.vision === true || (Array.isArray(m.input_modalities) && m.input_modalities.includes('image'))) };
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ...base, unknown: true };            /* not cached: try again next time */
  }
  cache.vision = { key: `${s.provider}|${s.model}`, t: Date.now(), v };
  return v;
}
