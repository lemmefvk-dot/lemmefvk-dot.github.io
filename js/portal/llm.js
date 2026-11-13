/* ============================================================
   llm.js — shared OpenAI-compatible streaming client.

   The default route is Pollinations; callers can override endpoint,
   model and API key when they need a different provider. Credentials
   are accepted only as call options and are never persisted here.

   It reads TEXT only. Nothing here sends pixels anywhere: Lens turns
   a screen region into text first (ocr.js, in the browser) and only
   that text is sent. What the model gets is exactly the `messages`
   passed in. Which model that is, when a caller does not choose, is the
   person's pick in Settings → AI model (aimodel.js).

   stream(messages, { onText, onThink, onWait, signal, params,
                     endpoint, model, apiKey, parallel }) -> Promise<string>
     onThink(chunk)  the model's reasoning, as it arrives (not shown
                     as the answer — Lens uses it for a "thinking" cue)
     onText(full)    the answer so far, re-sent whole on every chunk
     onWait(info)    the request is waiting, not failing:
                       { reason: 'queued', ahead }  another request from
                         this tab is still streaming
                       { reason: 'busy', ms, attempt }  the service said
                         429; retrying after ms
     params          extra body fields (e.g. { temperature, seed })
   Throws LLMError { code: 'offline' | 'busy' | 'http' | 'empty' }.

   Requests in this tab — Lens, Forge, Studio, Asset Lab, Staticum —
   go through one queue by default. Callers may opt specific independent
   requests into parallel mode; a 429 is retried with backoff
   (Retry-After when the service sends it) before it is ever reported
   as 'busy'.
   ============================================================ */

import { chosen } from './aimodel.js';

const ENDPOINT = 'https://text.pollinations.ai/openai';
const MODEL = 'openai-fast';
export const MODEL_LABEL = 'GPT-OSS 20B';
export const HOST = 'text.pollinations.ai';

export class LLMError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* ---- one request at a time, page-wide ---------------------------- */
const queue = [];
let busy = false;
const aborted = () => new DOMException('The request was aborted.', 'AbortError');

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const next = queue.shift();
  next.go();
}

/** Wait for this tab's turn. Resolves to a release() that must be called once. */
function acquire(signal, onWait) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    let done = false;
    const release = () => { if (done) return; done = true; busy = false; pump(); };
    const entry = {
      go() { signal?.removeEventListener('abort', onAbort); resolve(release); },
    };
    function onAbort() {
      const i = queue.indexOf(entry);
      if (i >= 0) { queue.splice(i, 1); reject(aborted()); }
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.push(entry);
    if (busy) { try { onWait?.({ reason: 'queued', ahead: queue.length }); } catch (e) {} }
    pump();
  });
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(aborted()); return; }
  const t = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  function stop() { clearTimeout(t); reject(aborted()); }
  signal?.addEventListener('abort', stop, { once: true });
});

const RETRIES_429 = 3;

export async function stream(messages, {
  onText, onThink, onWait, signal, params,
  endpoint, model, apiKey = '', parallel = false,
} = {}) {
  /* a caller that names no endpoint, model or key follows Settings → AI model (aimodel.js) */
  if (!endpoint && !model && !apiKey) ({ endpoint, model, apiKey } = chosen());
  endpoint = endpoint || ENDPOINT; model = model || MODEL;
  if (parallel) return run(messages, { onText, onThink, onWait, signal, params, endpoint, model, apiKey });
  const release = await acquire(signal, onWait);
  try {
    return await run(messages, { onText, onThink, onWait, signal, params, endpoint, model, apiKey });
  } finally {
    release();
  }
}

async function run(messages, { onText, onThink, onWait, signal, params, endpoint, model, apiKey }) {
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...(params || {}), model, stream: true, messages }),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new LLMError('offline', `Couldn't reach the model service. This network may block ${new URL(endpoint).host}.`);
    }
    if (res.status !== 429 || attempt >= RETRIES_429) break;
    /* the service's own hint wins; otherwise 2 s, 4 s, 8 s */
    const hint = Number(res.headers.get('retry-after'));
    const ms = hint > 0 && hint <= 60 ? hint * 1000 : 2000 * 2 ** attempt;
    try { res.body?.cancel?.(); } catch (e) {}
    try { onWait?.({ reason: 'busy', ms, attempt: attempt + 1 }); } catch (e) {}
    await sleep(ms, signal);
  }
  if (res.status === 429) throw new LLMError('busy', 'The free model is busy right now. Try again in a few seconds.');
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.message || '';
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
    throw new LLMError('http', `The model service answered with HTTP ${res.status}.${detail ? ` ${String(detail).slice(0, 400)}` : ''}`);
  }

  /* no readable body (very old engines): take the whole reply at once */
  if (!res.body || !res.body.getReader) {
    const raw = await res.text();
    const text = parseWhole(raw);
    if (!text) throw new LLMError('empty', 'The model sent back an empty answer.');
    onText?.(text);
    return text;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return finish(text);
      let j;
      try { j = JSON.parse(data); } catch (err) { continue; }
      const d = j.choices?.[0]?.delta || {};
      if (d.reasoning) onThink?.(d.reasoning);
      if (d.content) { text += d.content; onText?.(text); }
    }
  }
  return finish(text);
}

function finish(text) {
  if (!text.trim()) throw new LLMError('empty', 'The model sent back an empty answer.');
  return text;
}

/* a non-streamed body is either the JSON completion or plain text */
function parseWhole(raw) {
  try {
    const j = JSON.parse(raw);
    return String(j.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    return String(raw || '').trim();
  }
}

export default { stream, LLMError, MODEL_LABEL, HOST };
