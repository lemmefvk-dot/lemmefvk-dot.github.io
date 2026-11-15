/* ============================================================
   codesql.js — the SQL playground in Static Code's preview column.

   sqlPane({ h, icon, clear }) -> { el, show(file), run(text, { line }), stop(), dispose(), running }

   · The engine is SQLite compiled to WebAssembly: sql.js 1.13.0
     (MIT, vendor/sqljs/, licence and checksums in its README). Nothing
     is downloaded until the first Run; then its two files (about
     0.7 MB) are fetched once for the visit. They aren't in the offline
     copy.
   · It runs in a Web Worker, so the window keeps responding while a
     query runs, and Stop ends even a query that never finishes (a
     recursive WITH with no end) by ending the worker.
   · The database lives only in that worker's memory. It starts as one
     of the sample databases (core/codesqldata.js) or empty; queries
     can change it, nothing is saved, and Reset builds the sample
     again. A first-line comment "-- database: library" picks the
     sample a file starts with.
   · Each statement's result shows on its own: its rows (the first
     ROWS_MAX of them; the count is the real count, up to COUNT_MAX), or
     how many rows it changed, or its error with the line it is on and
     a button that goes there.
   · Every value is added as text, never as HTML.
   ============================================================ */
import { SAMPLES, sampleById } from './codesqldata.js';

const BASE = 'vendor/sqljs/';
const ROWS_MAX = 500;
const COUNT_MAX = 100000;

let assetsP = null;
/** The engine's two files, fetched once per page load. */
function download() {
  if (assetsP) return assetsP;
  const get = async (name, how) => {
    const res = await fetch(new URL(BASE + name, document.baseURI), { cache: 'default' });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return how === 'text' ? res.text() : res.arrayBuffer();
  };
  assetsP = Promise.all([get('sql-wasm.js', 'text'), get('sql-wasm.wasm', 'buf')]).then(([js, wasm]) => ({ js, wasm }));
  assetsP.catch(() => { assetsP = null; });
  return assetsP;
}

/* ---------------- inside the worker ---------------- */
function workerMain() {
  var SQL = null, db = null;
  var post = function (m) { self.postMessage(m); };
  var lineAt = function (text, i) { var n = 1; for (var k = 0; k < i && k < text.length; k++) if (text.charCodeAt(k) === 10) n++; return n; };
  /* where a statement really starts: past spaces and comments */
  var startOf = function (text, i) {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith('--', i)) { var e = text.indexOf('\n', i); i = e < 0 ? text.length : e + 1; continue; }
      if (text.startsWith('/*', i)) { var c = text.indexOf('*/', i + 2); i = c < 0 ? text.length : c + 2; continue; }
      return i;
    }
  };
  var cell = function (v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Uint8Array) return { blob: v.length };
    return v;
  };
  var tables = function () {
    var out = [];
    var r = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
    var names = r.length ? r[0].values.map(function (x) { return x[0]; }) : [];
    names.forEach(function (n) {
      var cols = db.exec('PRAGMA table_info("' + String(n).replace(/"/g, '""') + '")');
      var count = null;
      try { var c = db.exec('SELECT COUNT(*) FROM "' + String(n).replace(/"/g, '""') + '"'); count = c[0].values[0][0]; } catch (e) { /* a view that fails */ }
      out.push({ name: n, cols: cols.length ? cols[0].values.map(function (x) { return { name: x[1], type: x[2] }; }) : [], rows: count });
    });
    return out;
  };
  var changes = function () { try { return db.exec('SELECT total_changes()')[0].values[0][0]; } catch (e) { return 0; } };
  self.onmessage = function (e) {
    var d = e.data || {};
    try {
      if (d.t === 'init') {
        /* sql-wasm.js came first in this worker's script: initSqlJs is its loader */
        initSqlJs({ wasmBinary: d.wasm }).then(function (S) { SQL = S; post({ t: 'ready' }); }, function (err) { post({ t: 'fatal', text: String((err && err.message) || err) }); });
        return;
      }
      if (d.t === 'open') {
        if (db) db.close();
        db = new SQL.Database();
        if (d.script) db.exec(d.script);
        post({ t: 'opened', id: d.id, tables: tables() });
        return;
      }
      if (d.t === 'tables') { post({ t: 'tables', id: d.id, tables: tables() }); return; }
      if (d.t === 'run') {
        var text = String(d.sql), out = [];
        var it = db.iterateStatements(text);
        for (;;) {
          var rest = it.getRemainingSQL();
          var at = startOf(text, text.length - rest.length);
          var st;
          try { var r = it.next(); if (r.done) break; st = r.value; }
          catch (err) { out.push({ line: lineAt(text, at), sql: text.slice(at, at + 160), error: String((err && err.message) || err) }); break; }
          var before = changes();
          var q = st.getSQL();
          var res = { line: lineAt(text, at), sql: q.slice(startOf(q, 0)).trim().slice(0, 400) };
          try {
            var cols = st.getColumnNames(), rows = [], n = 0;
            while (st.step()) {
              n++;
              if (rows.length < d.rowsMax) rows.push(st.get().map(cell));
              else if (n >= d.countMax) { res.more = true; break; }
            }
            if (cols.length) { res.columns = cols; res.rows = rows; res.count = n; }
            else res.changed = changes() - before;
          } catch (err) { res.error = String((err && err.message) || err); }
          st.free();
          out.push(res);
          if (res.error) break;
        }
        post({ t: 'done', id: d.id, results: out, tables: tables() });
      }
    } catch (err) { post({ t: 'done', id: d.id, results: [{ line: 1, sql: '', error: String((err && err.message) || err) }], tables: [] }); }
  };
}

/** The sample a file asks for in a "-- database: name" comment near its top. */
export function wantedSample(text) {
  const m = /^\s*--\s*database\s*:\s*([\w-]+)/im.exec(String(text || '').split('\n').slice(0, 5).join('\n'));
  return m && sampleById(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

export function sqlPane({ h, icon, clear }) {
  const status = h('span.cpy__status.csq__status', { role: 'status', 'aria-live': 'polite', text: 'Press Run to run this file' });
  const pick = h('select.csq__db', { 'aria-label': 'Sample database', onchange: () => { S.sample = pick.value; S.picked = true; reset(); } },
    ...SAMPLES.map(s => h('option', { value: s.id, text: s.name })));
  const resetBtn = h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'sql-reset', title: 'Build the sample database again', onclick: () => reset() }, icon('rotate-ccw'), h('span', { text: 'Reset' }));
  const stopBtn = h('button.btn.btn--sm.btn--ghost.cpy__stop', { type: 'button', 'aria-label': 'Stop the query', hidden: true, onclick: () => stop() }, icon('square'), h('span', { text: 'Stop' }));
  const tablesEl = h('div.csq__tables', { 'aria-label': 'Tables in the database' });
  const out = h('div.csq__out', { role: 'log', 'aria-label': 'Query results', tabindex: '0' });
  const note = h('p.cpy__note', { text: 'SQLite runs in a worker in this window. It starts from the sample you pick; your queries can change it, but nothing is saved, and Reset builds the sample again.' });
  const el = h('div.cpy.csq', h('div.cpy__head', icon('database'), h('b', { text: 'SQL' }), status, h('div.grow'), pick, resetBtn, stopBtn), tablesEl, out, note);

  const S = { w: null, ready: null, seq: 0, mid: 0, waits: new Map(), sample: 'shop', picked: false, file: null, running: false, dead: false, reveal: null, opened: null };

  const setStatus = t => { status.textContent = t; };
  const setRunning = on => { S.running = on; stopBtn.hidden = !on; };

  function kill() {
    S.w?.terminate();
    S.w = null;
    S.ready = null;
    S.opened = null;
    for (const [, w] of S.waits) w({ t: 'done', results: [], stopped: true });
    S.waits.clear();
  }

  /* a worker with sqlite in it, and the chosen sample loaded */
  function engine() {
    if (S.ready) return S.ready;
    S.ready = (async () => {
      setStatus('Getting SQLite ready… (about 0.7 MB, once)');
      const a = await download();
      if (S.dead) throw new Error('closed');
      /* sql.js's loader, then ours, as one classic worker script */
      const blob = new Blob([a.js, `\n;(${workerMain})();\n`], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      S.w = w;
      await new Promise((res, rej) => {
        w.onmessage = e => {
          const d = e.data || {};
          if (d.t === 'ready') { URL.revokeObjectURL(url); res(); return; }
          if (d.t === 'fatal') { rej(new Error(d.text)); return; }
          const wait = S.waits.get(d.id);
          if (wait) { S.waits.delete(d.id); wait(d); }
        };
        w.onerror = ev => rej(new Error(ev.message || 'the SQLite worker stopped'));
        w.postMessage({ t: 'init', wasm: a.wasm.slice(0) });
      });
      return w;
    })();
    S.ready.catch(() => { S.ready = null; });
    return S.ready;
  }
  const ask = msg => new Promise(resolve => { const id = ++S.mid; S.waits.set(id, resolve); S.w.postMessage({ ...msg, id }); });

  async function open() {
    await engine();
    const s = sampleById(S.sample) || SAMPLES[0];
    const d = await ask({ t: 'open', script: s.sql });
    S.opened = s.id;
    paintTables(d.tables || []);
    return d;
  }

  function paintTables(list) {
    clear(tablesEl);
    if (!list.length) { tablesEl.append(h('small.dim', { text: S.opened ? 'No tables yet. CREATE TABLE makes one.' : '' })); return; }
    tablesEl.append(h('small.dim', { text: 'Tables:' }), ...list.map(t => h('button.csq__table', {
      type: 'button', title: t.cols.map(c => `${c.name}${c.type ? ` ${c.type}` : ''}`).join(', '),
      'aria-label': `Show the first rows of ${t.name}`,
      onclick: () => run(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 50;`, { line: 0, quick: true }),
    }, icon('table', { size: 11 }), h('span', { text: t.name }), t.rows != null ? h('small', { text: String(t.rows) }) : null)));
  }

  async function reset() {
    if (S.running) stop(false);
    clear(out);
    /* nothing is fetched until the first Run */
    if (!S.w) { setStatus(`${(sampleById(S.sample) || SAMPLES[0]).name}: press Run to load it`); return; }
    try { await open(); setStatus(`Fresh copy of ${(sampleById(S.sample) || SAMPLES[0]).name}`); }
    catch (e) { if (!S.dead) { setStatus('Could not start'); out.append(h('div.csq__err', { text: `SQLite couldn’t be loaded (${e.message || e}). It is fetched from this site the first time you press Run; check the connection and try again.` })); } }
  }

  const fmtCell = v => (v === null ? null : typeof v === 'object' && v.blob != null ? `BLOB (${v.blob} bytes)` : String(v));

  function block(r, base, quick) {
    const line = r.line + base;
    const head = h('div.csq__head', h('code.csq__sql', { text: r.sql.replace(/\s+/g, ' ').slice(0, 140) }));
    if (!quick && r.line) head.append(h('button.cpv__go', { type: 'button', title: `Show line ${line} in the editor`, 'aria-label': `Go to line ${line}`, onclick: () => S.reveal?.(line) }, h('span', { text: `line ${line}` })));
    if (r.error) return h('div.csq__block.is-err', head, h('div.csq__err', { role: 'alert', text: r.error }));
    if (!r.columns) return h('div.csq__block', head, h('div.csq__ok', { text: r.changed ? `${r.changed.toLocaleString()} row${r.changed === 1 ? '' : 's'} changed` : 'Done' }));
    const shown = r.rows.length;
    const count = r.more ? `more than ${COUNT_MAX.toLocaleString()} rows` : `${r.count.toLocaleString()} row${r.count === 1 ? '' : 's'}`;
    const table = h('table.csq__grid',
      h('thead', h('tr', ...r.columns.map(c => h('th', { text: c })))),
      h('tbody', ...r.rows.map(row => h('tr', ...row.map(v => { const t = fmtCell(v); return t === null ? h('td.is-null', { text: 'NULL' }) : h('td', { class: typeof v === 'number' ? 'is-num' : null, text: t }); })))));
    return h('div.csq__block', head,
      h('div.csq__meta', { text: shown < r.count || r.more ? `${count}, showing the first ${shown.toLocaleString()}` : count }),
      h('div.csq__wrap', table));
  }

  /** Run text (the file or a selection); line = the line it starts on in the file, minus one. */
  async function run(text, { line = 0, quick = false } = {}) {
    if (S.dead) return;
    if (!String(text).trim()) { setStatus('Nothing to run: the file is empty'); return; }
    const my = ++S.seq;
    setRunning(true);
    if (!quick) clear(out);
    try {
      if (!S.w || S.opened !== S.sample) await open();
    } catch (e) {
      if (S.dead || my !== S.seq) return;
      setRunning(false);
      setStatus('Could not start');
      out.append(h('div.csq__err', { text: `SQLite couldn’t be loaded (${e.message || e}). It is fetched from this site the first time you press Run; check the connection and try again.` }));
      return;
    }
    setStatus('Running…');
    const t0 = performance.now();
    const d = await ask({ t: 'run', sql: String(text), rowsMax: ROWS_MAX, countMax: COUNT_MAX });
    if (S.dead || d.stopped || my !== S.seq) return;
    setRunning(false);
    const ms = Math.round(performance.now() - t0);
    if (quick) clear(out);
    const res = d.results || [];
    for (const r of res) out.append(block(r, line, quick));
    if (!res.length) out.append(h('div.csq__ok', { text: 'No statements to run (only comments?).' }));
    paintTables(d.tables || []);
    const errs = res.filter(r => r.error).length;
    setStatus(errs ? `Stopped at an error · ${ms} ms` : `${res.length} statement${res.length === 1 ? '' : 's'} · ${ms} ms`);
    out.scrollTop = 0;
  }

  /** Stop: the worker goes, and with it the database (Reset or Run makes a new one). */
  function stop(say = true) {
    if (!S.w) return;
    kill();
    setRunning(false);
    paintTables([]);
    if (say) {
      setStatus('Stopped');
      out.append(h('div.csq__err', { text: 'Stopped. The database was in the stopped worker, so it starts again from the sample next time.' }));
    }
  }

  /** A .sql file came into view: pick the sample it asks for (once per file). */
  function show(f, reveal) {
    S.reveal = reveal;
    if (S.file !== f.path) {
      S.file = f.path;
      const want = wantedSample(f.text);
      if (want && !S.picked) S.sample = want;
      pick.value = S.sample;
      if (!S.running && !out.firstChild) setStatus('Press Run to run this file (or the selected lines)');
    }
  }

  return {
    el, run, stop, show, reset,
    get running() { return S.running; },
    get sample() { return S.sample; },
    dispose() { S.dead = true; kill(); },
  };
}

export default { sqlPane, wantedSample };
