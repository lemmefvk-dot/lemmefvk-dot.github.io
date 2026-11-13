/* ============================================================
   arcade/thinker.js — ask the computer opponent for a move without
   blocking the page.

     const brain = thinker();
     brain.ask({ game: 'chess', fen, history, level }) -> Promise<answer | null>
     brain.cancel()    stop any search now (its promise resolves null)
     brain.close()     for good, in the game's stop()
     brain.worker      true while answers come from the Web Worker

   The search runs in ./think.js as a module Worker, so frames keep
   coming while it thinks. Cancelling terminates that worker (the
   only way to stop a busy one) and the next ask starts a fresh one.
   Where a module Worker can't start (an old browser, a blocked
   file), the same search runs here, once the page has painted,
   with a shorter time limit — and `worker` says so.
   ============================================================ */
export function thinker() {
  let w = null, seq = 0, dead = false, failed = false;
  const pending = new Map();           /* id -> resolve */

  const settleAll = v => { for (const res of pending.values()) res(v); pending.clear(); };
  function start() {
    if (w || failed || dead) return w;
    try {
      w = new Worker(new URL('./think.js', import.meta.url), { type: 'module', name: 'arcade-think' });
      w.onmessage = e => {
        const d = e.data || {};
        const res = pending.get(d.id);
        if (!res) return;
        pending.delete(d.id);
        res(d.ok ? d : null);
      };
      w.onerror = e => {
        e?.preventDefault?.();
        /* the worker could not load: answer what's waiting here instead */
        failed = true;
        try { w.terminate(); } catch (err) { /* gone */ }
        w = null;
        const waiting = [...pending.entries()];
        pending.clear();
        for (const [, res] of waiting) res({ retry: true });
      };
    } catch (err) {
      failed = true;
      w = null;
    }
    return w;
  }

  async function local(q) {
    /* let the "thinking…" state paint before the main thread is busy */
    await new Promise(r => setTimeout(r, 30));
    if (dead) return null;
    const { answer } = await import('./think.js');
    const limit = { 1: 300, 2: 600, 3: 900 }[q.level] || 600;
    try { return { ok: true, ...answer({ ...q, timeMs: limit }) }; } catch (err) { console.error('[arcade] think', err); return null; }
  }

  return {
    get worker() { return !!w && !failed; },
    ask(q) {
      if (dead) return Promise.resolve(null);
      const id = ++seq;
      const wk = start();
      if (!wk) return local(q);
      return new Promise(res => {
        pending.set(id, res);
        try { wk.postMessage({ ...q, id }); } catch (err) { pending.delete(id); res({ retry: true }); }
      }).then(v => (v && v.retry ? (dead ? null : local(q)) : v));
    },
    cancel() {
      if (w) { try { w.terminate(); } catch (err) { /* gone */ } w = null; }
      settleAll(null);
    },
    close() {
      dead = true;
      this.cancel();
    },
  };
}

export default thinker;
