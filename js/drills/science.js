/* ============================================================
   drills/science.js — the Science tab of Static Drills.

   Element symbols (symbol to name, name to symbol), element groups,
   and SI unit prefixes: rounds of ten four-choice questions, the way
   the Geography tab asks them. Every element fact is read from
   data/elements.json (PubChem, the file the Periodic Table shows),
   fetched when this tab opens; the prefixes are the SI table in
   js/drills/sciencecore.js. A wrong answer says what the right one is
   and what the wrong pick really is.

   Everything shown as progress is counted from answers given. Saved
   on this device ('portal.drillsScience'): counts per fact, rounds.
   ============================================================ */
import * as C from './sciencecore.js';
import { record } from './sched.js';

const KEY = 'portal.drillsScience';
const DEFAULT = { v: 1, stats: {}, rounds: [], p: { mode: 'sym', upTo: 20 } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pct = (a, b) => `${Math.round(100 * a / b)}%`;

let elsP = null;
export const loadElements = () => (elsP ||= fetch('data/elements.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).catch(e => { elsP = null; throw e; }));

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const stats = {};
  for (const [k, st] of Object.entries(r.stats && typeof r.stats === 'object' ? r.stats : {})) {
    if (/^(sym|name|cat):[A-Z][a-z]{0,2}$|^pre:[a-z]+$/.test(k) && st && Number.isFinite(st.n) && Number.isFinite(st.ok)) stats[k] = { n: st.n, ok: st.ok, ms: 0, nm: 0 };
  }
  const p = { ...DEFAULT.p, ...(r.p || {}) };
  if (!C.MODES.some(m => m[0] === p.mode)) p.mode = 'sym';
  if (!C.RANGES.some(x => x[0] === p.upTo)) p.upTo = 20;
  return { v: 1, stats, rounds: Array.isArray(r.rounds) ? r.rounds.filter(x => x && Number.isFinite(x.n)).slice(-100) : [], p };
}

export function mountScience(host, ctx) {
  const { api } = ctx;
  const { h, icon, store } = api;
  const S = { data: normalize(store.get(KEY)), els: null, src: null, dead: false, run: null, summary: null, confirmClear: false };
  const save = () => { const d = S.data; store.set(KEY, { ...d, stats: { ...d.stats }, rounds: d.rounds.slice(-100), p: { ...d.p } }); };
  const root = h('div.dr-sci', { dataset: { fk: 'sci' } });
  host.appendChild(root);
  const chip = (label, on, onclick, fk) => h('button.dr-chip', { type: 'button', class: on ? 'is-on' : '', 'aria-pressed': on ? 'true' : 'false', dataset: { fk }, onclick }, label);

  root.replaceChildren(h('p.dr-none', { role: 'status', dataset: { fk: 'sci-loading' }, text: 'Loading the element data…' }));
  load();
  function load() {
    loadElements().then(j => { if (S.dead) return; S.els = j.elements; S.src = j; paintHome(); }).catch(e => {
      if (S.dead) return;
      /* the prefixes need no data: they still work */
      S.els = [];
      S.err = `The element data could not be loaded (${e.message}). The unit prefixes work without it.`;
      if (S.data.p.mode !== 'pre') S.data.p.mode = 'pre';
      paintHome();
    });
  }

  function paintHome() {
    S.run = null;
    const d = S.data, p = d.p;
    const kids = [];
    if (S.summary) kids.push(S.summary);
    const noData = !S.els.length;
    const pool = p.mode === 'pre' ? C.PREFIXES : C.eligible(S.els, p.mode, p.upTo);
    kids.push(h('div.dr-card', h('h3.dr-h', { text: 'Quiz me on' }),
      h('div.dr-chips', { role: 'group', 'aria-label': 'Quiz type' }, ...C.MODES.map(([id, name]) => {
        const b = chip(name, p.mode === id, () => { p.mode = id; save(); paintHome(); }, `sci-mode-${id}`);
        if (noData && id !== 'pre') b.disabled = true;
        return b;
      })),
      p.mode !== 'pre' ? h('div.dr-row', h('small.dim', { text: 'Elements' }), h('div.dr-chips', { role: 'group', 'aria-label': 'Which elements' },
        ...C.RANGES.map(([n, name]) => chip(name, p.upTo === n, () => { p.upTo = n; save(); paintHome(); }, `sci-range-${n}`)))) : null,
      h('p.dr-sub', { dataset: { fk: 'sci-note' }, text: p.mode === 'pre' ? `The ${C.PREFIXES.length} SI prefixes used most in school science, tera (10¹²) to pico (10⁻¹²), from the SI Brochure's table of prefixes.`
        : p.mode === 'cat' ? 'Groups here are the element categories in PubChem’s data (alkali metals, halogens, noble gases and so on), the ones the Periodic Table colours by, not the numbered columns.'
          : 'Symbols and names are read from PubChem’s data, the same file the Periodic Table shows.' }),
      h('div.dr-row', h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'sci-start' }, disabled: pool.length < 4, onclick: start }, icon('play'), h('span', { text: `Start (${C.ROUND_QUESTIONS} questions)` })),
        h('small.dim', { dataset: { fk: 'sci-pool' }, text: p.mode === 'pre' ? `${C.PREFIXES.length} prefixes` : `${plural(pool.length, 'element')} in this quiz` })),
      S.err ? h('p.dr-warn', { role: 'status', dataset: { fk: 'sci-error' }, text: S.err }) : null));
    kids.push(progress());
    if (S.src) kids.push(h('p.dr-sub.dim', { dataset: { fk: 'sci-source' }, text: `Element data: ${S.src.source}, fetched ${S.src.fetched}.` }));
    root.replaceChildren(...kids);
  }

  function progress() {
    const d = S.data;
    const card = h('div.dr-card', { dataset: { fk: 'sci-progress' } }, h('h3.dr-h', { text: 'Your progress' }));
    const sum = C.summarize(d.stats, S.els);
    const total = Object.values(sum.modes).reduce((a, m) => a + m.n, 0);
    if (!total) { card.append(h('p.dr-none', { dataset: { fk: 'sci-none' }, text: 'Nothing yet. Answer some questions and your accuracy for each quiz shows up here.' })); return card; }
    card.append(h('div.dr-ops', ...C.MODES.map(([id, name]) => {
      const m = sum.modes[id];
      return h('div.dr-op', { dataset: { fk: `sci-sum-${id}`, n: String(m ? m.n : 0), ok: String(m ? m.ok : 0) } }, h('b', { text: name }),
        m ? h('span', { text: `${pct(m.ok, m.n)} right of ${plural(m.n, 'answer')}` }) : h('span.dim', { text: 'not tried' }));
    })));
    card.append(h('h4.dr-h2', { text: 'To work on' }), sum.weak.length
      ? h('ul.dr-weak', { dataset: { fk: 'sci-weak' } }, ...sum.weak.map(w => h('li', { dataset: { key: w.key }, text: `${C.MODES.find(m => m[0] === w.mode)[1]}: ${w.name}, missed ${w.miss} of ${w.n}` })))
      : h('p.dr-none', { text: 'You have not missed any.' }));
    card.append(h('div.dr-row', S.confirmClear
      ? [h('small', { text: 'Clear all science progress?' }), h('button.btn.btn--sm.btn--danger', { type: 'button', dataset: { fk: 'sci-clear-yes' }, onclick: () => { S.data = normalize({ p: S.data.p }); S.confirmClear = false; save(); paintHome(); } }, 'Clear it'), h('button.btn.btn--sm', { type: 'button', onclick: () => { S.confirmClear = false; paintHome(); } }, 'Keep it')]
      : h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'sci-clear' }, onclick: () => { S.confirmClear = true; paintHome(); } }, 'Clear my science progress')));
    return card;
  }

  /* ---------------- a round ---------------- */
  function start() {
    S.summary = null;
    S.run = { n: 0, ok: 0, q: null, answered: false, missed: [] };
    ask();
  }
  function ask() {
    const R = S.run, p = S.data.p;
    R.q = C.makeQuestion({ elements: S.els, mode: p.mode, upTo: p.upTo, stats: S.data.stats, avoidKey: R.q && R.q.key });
    R.answered = false;
    if (!R.q) { S.run = null; paintHome(); return; }
    paintRun();
  }
  function answer(opt) {
    const R = S.run, d = S.data;
    if (!R || R.answered) return;
    R.answered = true;
    const ex = C.explain(R.q, opt.id, S.els);
    d.stats[R.q.key] = record(d.stats[R.q.key], ex.right, null);
    R.n++;
    if (ex.right) R.ok++;
    else R.missed.push(R.q.mode === 'pre' ? `${R.q.answer}-` : (S.els.find(e => e.s === R.q.sym) || {}).name || R.q.sym);
    save();
    paintRun(opt, ex);
  }
  function finish() {
    const R = S.run;
    S.data.rounds.push({ t: Date.now(), mode: S.data.p.mode, upTo: S.data.p.mode === 'pre' ? null : S.data.p.upTo, n: R.n, ok: R.ok });
    save();
    S.summary = h('div.dr-card.dr-result', { role: 'status', dataset: { fk: 'sci-summary', n: String(R.n), ok: String(R.ok) } },
      h('h3.dr-h', { text: 'Round finished' }), h('p', { text: `${R.ok} of ${plural(R.n, 'question')} right.` }),
      R.missed.length ? h('p', { dataset: { fk: 'sci-missed' }, text: `Missed: ${[...new Set(R.missed)].join(', ')}. They will come up more often.` }) : h('p', { text: 'No misses.' }));
    S.run = null;
    paintHome();
  }
  function paintRun(chosen, ex) {
    const R = S.run, q = R.q;
    const buttons = q.options.map((o, i) => {
      const cls = !ex ? '' : o.id === q.answer ? 'is-right' : o.id === chosen.id ? 'is-wrong' : '';
      return h('button.dr-opt', { type: 'button', class: cls, disabled: !!ex, dataset: { fk: `sci-opt-${i + 1}`, id: o.id }, onclick: () => answer(o) }, h('kbd', { text: String(i + 1) }), h('span', { text: o.label }));
    });
    const fb = ex ? h('div.dr-fb', { class: ex.right ? 'is-ok' : 'is-bad', dataset: { fk: 'sci-feedback', right: ex.right ? '1' : '0' }, role: 'status' }, ...ex.lines.map(l => h('p', { text: l }))) : null;
    const last = R.n >= C.ROUND_QUESTIONS;
    root.replaceChildren(h('div.dr-card.dr-run',
      h('div.dr-run__top', h('span', { dataset: { fk: 'sci-count' }, text: `Question ${Math.min(R.n + (ex ? 0 : 1), C.ROUND_QUESTIONS)} of ${C.ROUND_QUESTIONS}` }), h('b', { text: `${R.ok} right` })),
      h('div.dr-q.dr-q--text', { dataset: { fk: 'sci-prompt', key: q.key } , text: q.prompt }),
      h('div.dr-opts', { role: 'group', 'aria-label': 'Answers' }, ...buttons), fb,
      h('div.dr-row', ex ? h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'sci-next' }, onclick: () => (last ? finish() : ask()) }, last ? 'See the result' : 'Next question') : null,
        h('button.btn.btn--ghost', { type: 'button', dataset: { fk: 'sci-stop' }, onclick: () => (R.n ? finish() : paintHome()) }, R.n ? 'Finish now' : 'Stop'))));
    const next = root.querySelector('[data-fk="sci-next"]');
    if (next) next.focus();
  }

  const onKey = e => {
    if (S.dead || !S.run || !root.isConnected || e.ctrlKey || e.metaKey || e.altKey || !ctx.isActive()) return;
    if (e.key >= '1' && e.key <= '4' && !S.run.answered) { const o = S.run.q.options[Number(e.key) - 1]; if (o) { e.preventDefault(); answer(o); } }
  };
  document.addEventListener('keydown', onKey);

  return {
    teardown() { S.dead = true; document.removeEventListener('keydown', onKey); },
    open() { /* nothing to open */ },
  };
}
