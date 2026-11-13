/* ============================================================
   proxy.status.js — what the directory has actually observed.

   The catalogue ships with a status for every entry, but public
   proxies die constantly and school networks block different
   ones. So observations are recorded here, persist between
   visits, and override the shipped value.

   TWO DIFFERENT CLAIMS, KEPT SEPARATE
   It matters not to conflate these, because only one of them is
   machine-checkable from a browser:

     reachable   The host answered. Provable: we fetch its
                 landing page through a CORS relay and see real
                 HTML come back. This says the service is alive.
                 It does NOT say it will render in a frame.

     framed      It actually rendered inside Static. NOT provable
                 from script — a page blocked by X-Frame-Options
                 fires the same load event as one that worked,
                 and its document is cross-origin either way, so
                 there is nothing to read. This is recorded only
                 when a person says they saw it.

   Anything else stays 'untested'. The directory would rather
   admit it does not know than guess and be wrong.
   ============================================================ */

const KEY = 'proxy.observed';

/* The relays used to ask "is this host alive". Ordered; the first
   that answers wins. These are the same ones Static Reader races. */
const RELAYS = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${u}`,
  u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
];

let store = null;         // injected by the app on first use
const mem = new Map();    // id -> record, mirrors the persisted map

export function attach(apiStore) {
  store = apiStore;
  const raw = store.get(KEY, {});
  mem.clear();
  if (raw && typeof raw === 'object') {
    for (const [id, rec] of Object.entries(raw)) {
      if (rec && typeof rec === 'object') mem.set(id, rec);
    }
  }
  return mem.size;
}

const persist = () => {
  if (!store) return;
  /* A fresh object every time: the store short-circuits on identity,
     so mutating the existing one would write nothing. */
  store.set(KEY, Object.fromEntries(mem));
};

export const observed = id => mem.get(id) || null;

/** The status to show: an observation if there is one, else the shipped value. */
export function statusOf(entry) {
  const rec = mem.get(entry.id);
  if (!rec) return entry.status;
  if (rec.framed === true) return 'verified';
  if (rec.framed === false) return 'blocked';
  if (rec.reachable === true) return 'reachable';
  if (rec.reachable === false) return 'dead';
  return entry.status;
}

export const LABEL = {
  verified: 'confirmed working',
  reachable: 'host is up',
  untested: 'not checked',
  blocked: 'will not frame',
  dead: 'no answer',
};

export const TONE = {
  verified: 'ok', reachable: 'warn', untested: '', blocked: 'bad', dead: 'bad',
};

/** Record that a person saw this one render (or fail to). */
export function setFramed(id, ok) {
  const rec = mem.get(id) || {};
  rec.framed = !!ok;
  rec.at = Date.now();
  mem.set(id, rec);
  persist();
  return rec;
}

export function clear(id) {
  if (id) mem.delete(id); else mem.clear();
  persist();
}

/**
 * Is the host alive? Fetches its landing page through a CORS relay.
 *
 * This deliberately does NOT claim anything about framing — see the
 * note at the top. It answers one question honestly: did anything
 * come back.
 */
export async function probe(entry, { timeout = 12000 } = {}) {
  const url = entry.host ? `https://${entry.host.replace(/^https?:\/\//, '')}/` : '';
  if (!url) return null;

  for (const build of RELAYS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(build(url), { signal: ac.signal, cache: 'no-store' });
      if (!res.ok) continue;
      const body = await res.text();
      if (!body || body.length < 200) continue;
      const rec = mem.get(entry.id) || {};
      rec.reachable = true;
      rec.bytes = body.length;
      rec.at = Date.now();
      /* A Cloudflare interstitial is a live host that will still never
         work for us — worth recording so the list can say why. */
      rec.gated = /just a moment|checking your browser|cf-browser-verification|attention required/i.test(body.slice(0, 4000));
      mem.set(entry.id, rec);
      persist();
      return rec;
    } catch (err) {
      /* try the next relay */
    } finally {
      clearTimeout(timer);
    }
  }

  const rec = mem.get(entry.id) || {};
  rec.reachable = false;
  rec.at = Date.now();
  mem.set(entry.id, rec);
  persist();
  return rec;
}

/** Probe many, a few at a time, calling back after each. */
export async function probeAll(entries, { concurrency = 4, onEach, signal } = {}) {
  const queue = [...entries];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) return;
      const entry = queue.shift();
      const rec = await probe(entry).catch(() => null);
      done++;
      onEach?.(entry, rec, done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return done;
}

export default {
  attach, observed, statusOf, setFramed, clear, probe, probeAll, LABEL, TONE,
};
