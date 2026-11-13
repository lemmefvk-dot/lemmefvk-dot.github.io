/* ============================================================
   drills/math.js — the Math tab of Static Drills.

   Times tables and quick arithmetic. Pick an operation and a level (for
   times tables, which tables), then a timed round (60 seconds, as many
   as you can) or practice (10 questions, no clock). Facts you miss or
   answer slowly come up more often (js/drills/sched.js).

   The progress panel is only what happened: every answer is added to
   the record of its fact (attempts, correct, time of the correct timed
   ones), and accuracy and speed are worked out from that record when the
   panel is drawn. A table you have not tried says so. There are no
   streaks and no points. Saved on this device ('portal.drillsMath').
   ============================================================ */
import * as M from './mathcore.js';
import { record, MAX_MS } from './sched.js';

const KEY = 'portal.drillsMath';
const MAX_FACTS = 3000, MAX_ROUNDS = 100;
const DEFAULT = { v: 1, facts: {}, rounds: [], p: { op: 'x', level: 'medium', tables: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], mode: 'timed' } };
const now = () => performance.now();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const secs = ms => `${(ms / 1000).toFixed(1)} s`;
const pct = x => `${Math.round(x * 100)}%`;

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = { ...DEFAULT.p, ...(r.p || {}) };
  if (!M.OPS.some(o => o[0] === p.op)) p.op = 'x';
  if (!M.LEVELS.some(o => o[0] === p.level)) p.level = 'medium';
  if (p.mode !== 'timed' && p.mode !== 'practice') p.mode = 'timed';
  p.tables = Array.isArray(p.tables) ? [...new Set(p.tables.map(Number).filter(t => t >= 1 && t <= 12))].sort((a, b) => a - b) : DEFAULT.p.tables;
  const facts = {};
  for (const [k, st] of Object.entries(r.facts && typeof r.facts === 'object' ? r.facts : {})) {
    if (st && Number.isFinite(st.n) && Number.isFinite(st.ok)) facts[k] = { n: st.n, ok: st.ok, ms: Number(st.ms) || 0, nm: Number(st.nm) || 0, last: Number(st.last) || 0 };
  }
  return { v: 1, facts, rounds: Array.isArray(r.rounds) ? r.rounds.filter(x => x && Number.isFinite(x.n)).slice(-MAX_ROUNDS) : [], p };
}

export function mountMath(host, ctx) {
  const { api } = ctx;
  const { h, icon, store } = api;
  const S = { data: normalize(store.get(KEY)), run: null, timer: null, dead: false, resultMsg: null, confirmClear: false };

  const save = () => {
    const d = S.data;
    const keys = Object.keys(d.facts);
    if (keys.length > MAX_FACTS) for (const k of keys.sort((a, b) => d.facts[a].last - d.facts[b].last).slice(0, keys.length - MAX_FACTS)) delete d.facts[k];
    store.set(KEY, { ...d, facts: { ...d.facts }, rounds: d.rounds.slice(-MAX_ROUNDS), p: { ...d.p, tables: [...d.p.tables] } });
  };

  const root = h('div.dr-math', { dataset: { fk: 'math' } });
  host.appendChild(root);
  const chip = (label, on, onclick, fk, title) => h('button.dr-chip', { type: 'button', 'aria-pressed': on ? 'true' : 'false', class: on ? 'is-on' : '', dataset: { fk }, onclick, title: title || '' }, label);

  /* ---------------- setup + progress ---------------- */
  function paintHome() {
    const d = S.data, p = d.p;
    const kids = [];
    const ops = h('div.dr-chips', { role: 'group', 'aria-label': 'Operation' }, ...M.OPS.map(([id, sym, name]) => chip(`${sym} ${name}`, p.op === id, () => { p.op = id; save(); paintHome(); }, `op-${id}`)));
    const levels = h('div.dr-chips', { role: 'group', 'aria-label': 'Level' }, ...M.LEVELS.map(([id, name]) => chip(name, p.level === id, () => { p.level = id; save(); paintHome(); }, `level-${id}`)));
    kids.push(h('div.dr-card', h('h3.dr-h', { text: 'What to practise' }), ops,
      p.op === 'x' ? h('div.dr-row', h('small.dim', { text: 'Tables' }), h('div.dr-chips', { role: 'group', 'aria-label': 'Times tables' },
        ...Array.from({ length: 12 }, (_, i) => i + 1).map(t => chip(String(t), p.tables.includes(t), () => {
          p.tables = p.tables.includes(t) ? p.tables.filter(x => x !== t) : [...p.tables, t].sort((a, b) => a - b);
          save(); paintHome();
        }, `table-${t}`))),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'tables-all' }, onclick: () => { p.tables = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; save(); paintHome(); } }, 'All')) : null,
      h('div.dr-row', h('small.dim', { text: 'Level' }), levels,
        h('small.dim', { text: p.op === 'x' ? 'Easy asks up to × 10, Medium and Hard up to × 12.' : p.op === 'mix' ? 'Mixed uses the same level for + − × ÷.' : '' })),
      h('div.dr-row', h('small.dim', { text: 'How' }), h('div.dr-chips', { role: 'group', 'aria-label': 'Timed or practice' },
        chip('Timed: 60 seconds', p.mode === 'timed', () => { p.mode = 'timed'; save(); paintHome(); }, 'mode-timed'),
        chip('Practice: 10 questions, no clock', p.mode === 'practice', () => { p.mode = 'practice'; save(); paintHome(); }, 'mode-practice'))),
      h('div.dr-row', h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'math-start' }, disabled: p.op === 'x' && !p.tables.length, onclick: start }, icon('play'), h('span', { text: 'Start' })),
        p.op === 'x' && !p.tables.length ? h('small.dim', { text: 'Pick at least one table.' }) : null)));
    if (S.resultMsg) kids.unshift(S.resultMsg);

    /* ---- progress, from the record ---- */
    const has = Object.keys(d.facts).length > 0;
    const prog = h('div.dr-card', { dataset: { fk: 'math-progress' } }, h('h3.dr-h', { text: 'Your progress' }));
    if (!has) prog.append(h('p.dr-none', { dataset: { fk: 'math-none' }, text: 'Nothing yet. Answer some questions and your accuracy and speed for each table show up here.' }));
    else {
      prog.append(h('p.dr-sub', { text: 'Accuracy and average speed of correct answers, from every answer you have given. Speed is left out of a table until a correct answer on it has been timed.' }));
      const grid = h('div.dr-tables', { role: 'list', 'aria-label': 'Times tables' });
      for (let t = 1; t <= 12; t++) {
        const s = M.tableSummary(d.facts, t);
        grid.append(h('div.dr-table', { role: 'listitem', dataset: { fk: `tbl-${t}`, n: String(s.n) }, class: s.n ? '' : 'is-none' },
          h('b', { text: `${t}×` }),
          s.n ? h('span', { dataset: { fk: `tbl-${t}-acc` }, text: `${pct(s.accuracy)} right` }) : h('span', { text: 'not tried' }),
          s.n ? h('small', { dataset: { fk: `tbl-${t}-n` }, text: plural(s.n, 'answer') }) : null,
          s.avgMs != null ? h('small', { dataset: { fk: `tbl-${t}-ms` }, text: `${secs(s.avgMs)} each` }) : null));
      }
      prog.append(grid);
      const others = h('div.dr-ops');
      for (const [id, sym, name] of M.OPS.filter(o => o[0] !== 'x' && o[0] !== 'mix')) {
        const s = M.opSummary(d.facts, id);
        others.append(h('div.dr-op', { dataset: { fk: `opsum-${id}` } }, h('b', { text: `${sym} ${name}` }),
          s.n ? h('span', { text: `${pct(s.accuracy)} right of ${plural(s.n, 'answer')}${s.avgMs != null ? `, ${secs(s.avgMs)} each` : ''}` }) : h('span.dim', { text: 'not tried' })));
      }
      prog.append(others);
      const weak = M.weakFacts(d.facts);
      prog.append(h('h4.dr-h2', { text: 'Facts to work on' }),
        weak.length ? h('ul.dr-weak', { dataset: { fk: 'math-weak' } }, ...weak.map(w => h('li', { dataset: { key: w.key }, text: `${w.text}: ${w.ok} of ${w.n} right${w.avgMs != null ? `, ${secs(w.avgMs)} each` : ''}` })))
          : h('p.dr-none', { text: 'None: every fact you have tried has been right and quick.' }));
      const timed = d.rounds.filter(r => r.mode === 'timed');
      if (timed.length) {
        const best = new Map();
        for (const r of timed) { const k = `${r.op}/${r.level}`; if (!best.has(k) || r.ok > best.get(k).ok) best.set(k, r); }
        prog.append(h('h4.dr-h2', { text: 'Timed rounds' }), h('ul.dr-weak', { dataset: { fk: 'math-rounds' } },
          ...[...best.values()].map(r => h('li', { dataset: { key: `${r.op}/${r.level}` }, text: `Best at ${M.OPS.find(o => o[0] === r.op)[2]} (${r.level}): ${r.ok} right in ${r.secs} seconds of ${plural(timed.filter(x => x.op === r.op && x.level === r.level).length, 'round')}` }))));
      }
      prog.append(h('div.dr-row', S.confirmClear
        ? [h('small', { text: 'Clear every drill answer on this device?' }), h('button.btn.btn--sm.btn--danger', { type: 'button', dataset: { fk: 'math-clear-yes' }, onclick: () => { S.data = normalize({ p: S.data.p }); S.confirmClear = false; save(); paintHome(); } }, 'Clear it'), h('button.btn.btn--sm', { type: 'button', onclick: () => { S.confirmClear = false; paintHome(); } }, 'Keep it')]
        : h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'math-clear' }, onclick: () => { S.confirmClear = true; paintHome(); } }, 'Clear my math progress')));
    }
    kids.push(prog);
    root.replaceChildren(...kids);
  }

  /* ---------------- a round ---------------- */
  function start() {
    const p = S.data.p;
    const items = M.pool(p.op, p.level, p.tables);
    if (!items.length) return;
    S.resultMsg = null;
    S.run = { items, n: 0, ok: 0, q: null, shownAt: 0, t0: now(), mode: p.mode, last: null, hold: false, over: false };
    paintRun();
    ask();
    if (p.mode === 'timed') {
      S.timer = setInterval(tick, 200);
    }
  }
  const left = () => Math.max(0, M.ROUND_SECONDS * 1000 - (now() - S.run.t0));
  function tick() {
    if (!S.run || S.dead) return;
    const el = root.querySelector('[data-fk="math-timer"]');
    if (el) el.textContent = `${Math.ceil(left() / 1000)} s left`;
    if (left() <= 0) finish();
  }
  function ask() {
    const R = S.run;
    R.q = M.nextQuestion(R.items, S.data.facts, Math.random, R.q && R.q.key);
    R.shownAt = now();
    R.hold = false;
    const q = root.querySelector('[data-fk="math-q"]'), inp = root.querySelector('[data-fk="math-in"]');
    if (q) q.textContent = `${R.q.text} =`;
    if (inp) { inp.value = ''; inp.focus(); }
    const hint = root.querySelector('[data-fk="math-hint"]');
    if (hint) hint.textContent = '';
    paintCount();
  }
  function paintCount() {
    const R = S.run, c = root.querySelector('[data-fk="math-count"]');
    if (c) c.textContent = R.mode === 'practice' ? `Question ${Math.min(R.n + 1, M.ROUND_QUESTIONS)} of ${M.ROUND_QUESTIONS}` : `${R.ok} right so far`;
  }
  function submit() {
    const R = S.run;
    if (!R || R.over) return;
    if (R.hold) { if (R.n >= M.ROUND_QUESTIONS && R.mode === 'practice') finish(); else ask(); return; }
    const inp = root.querySelector('[data-fk="math-in"]');
    const val = M.parseAnswer(inp.value);
    const hint = root.querySelector('[data-fk="math-hint"]');
    if (val == null) { if (hint) hint.textContent = 'Type a whole number.'; return; }
    const ms = now() - R.shownAt;
    const good = val === R.q.answer;
    /* an answer that came after the clock ran out does not count */
    if (R.mode === 'timed' && left() <= 0) { finish(); return; }
    const d = S.data;
    const st = record(d.facts[R.q.key], good, ms);
    st.last = Date.now();
    d.facts[R.q.key] = st;
    R.n++;
    if (good) R.ok++;
    save();
    const fb = root.querySelector('[data-fk="math-feedback"]');
    if (good) {
      if (fb) { fb.className = 'dr-fb is-ok'; fb.textContent = `${R.q.text} = ${R.q.answer}: right${ms <= MAX_MS ? ` (${secs(ms)})` : ''}`; }
      paintCount();
      if (R.mode === 'practice' && R.n >= M.ROUND_QUESTIONS) finish(); else ask();
    } else {
      if (fb) { fb.className = 'dr-fb is-bad'; fb.textContent = `${R.q.text} = ${R.q.answer}, not ${val}`; }
      paintCount();
      if (R.mode === 'practice') {
        R.hold = true;
        if (hint) hint.textContent = R.n >= M.ROUND_QUESTIONS ? 'Press Enter to see your result.' : 'Press Enter for the next question.';
      } else ask();
    }
  }
  function finish() {
    const R = S.run;
    if (!R || R.over) return;
    R.over = true;
    clearInterval(S.timer); S.timer = null;
    const secsUsed = R.mode === 'timed' ? M.ROUND_SECONDS : Math.round((now() - R.t0) / 1000);
    if (R.n > 0) {
      S.data.rounds.push({ t: Date.now(), mode: R.mode, op: S.data.p.op, level: S.data.p.level, n: R.n, ok: R.ok, secs: secsUsed });
      save();
    }
    S.resultMsg = R.n > 0
      ? h('div.dr-card.dr-result', { role: 'status', dataset: { fk: 'math-summary', n: String(R.n), ok: String(R.ok) } },
        h('h3.dr-h', { text: R.mode === 'timed' ? 'Time is up' : 'Round finished' }),
        h('p', { text: `${R.ok} right out of ${plural(R.n, 'answer')}${R.n ? ` (${pct(R.ok / R.n)})` : ''}${R.mode === 'timed' ? ' in 60 seconds' : ` in ${secsUsed} seconds`}.` }))
      : h('div.dr-card', { role: 'status', dataset: { fk: 'math-summary', n: '0', ok: '0' } }, h('p', { text: 'No answers were given, so nothing was recorded.' }));
    S.run = null;
    paintHome();
  }
  function paintRun() {
    const R = S.run;
    const inp = h('input.dr-in', { type: 'text', inputmode: 'numeric', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Your answer', dataset: { fk: 'math-in' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } });
    root.replaceChildren(h('div.dr-card.dr-run',
      h('div.dr-run__top', h('span', { dataset: { fk: 'math-count' } }), R.mode === 'timed' ? h('b', { dataset: { fk: 'math-timer' }, 'aria-hidden': 'true', text: `${M.ROUND_SECONDS} s left` }) : null),
      h('div.dr-q', { dataset: { fk: 'math-q' }, 'aria-live': 'polite' }),
      inp,
      h('div.dr-fb', { dataset: { fk: 'math-feedback' }, role: 'status' }),
      h('small.dim', { dataset: { fk: 'math-hint' } }),
      h('div.dr-row', h('button.btn.btn--primary', { type: 'button', onclick: submit, dataset: { fk: 'math-submit' } }, 'Answer'),
        h('button.btn.btn--ghost', { type: 'button', dataset: { fk: 'math-stop' }, onclick: finish }, R.mode === 'timed' ? 'Stop the round' : 'Finish now'))));
  }

  paintHome();

  return {
    teardown() {
      S.dead = true;
      clearInterval(S.timer);
    },
    open() { /* nothing to open */ },
  };
}
