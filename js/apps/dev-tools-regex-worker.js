/* ============================================================
   dev-tools-regex-worker.js - runs the person's regular expression.

   A pattern like (a+)+$ can take longer than the age of the universe on
   a short string. It runs here, in a Worker, so the page never waits on
   it: Dev Tools gives it a time limit and terminates this worker if it
   does not answer.

   in:  { id, source, flags, text, max }
   out: { id, ok:true, matches:[{ index, length, text, groups:[…], named:{…} }], more }
        { id, ok:false, error }
   Text only: nothing here makes markup.
   ============================================================ */
self.onmessage = e => {
  const { id, source, flags, text, max = 1000 } = e.data || {};
  let re;
  try {
    re = new RegExp(source, flags.includes('g') ? flags : flags + 'g');
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
    return;
  }
  const global = flags.includes('g');
  const matches = [];
  let more = false;
  try {
    for (const m of text.matchAll(re)) {
      if (matches.length >= max) { more = true; break; }
      matches.push({
        index: m.index,
        length: m[0].length,
        text: m[0],
        groups: m.slice(1).map(g => (g === undefined ? null : g)),
        named: m.groups ? Object.fromEntries(Object.entries(m.groups).map(([k, v]) => [k, v === undefined ? null : v])) : null,
      });
      if (!global) break;
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
    return;
  }
  self.postMessage({ id, ok: true, matches, more });
};
