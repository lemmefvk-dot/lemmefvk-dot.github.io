/* ============================================================
   drills/geo.js — the Geography tab of Static Drills.

   Flag to country, country to capital, capital to country, over the
   regions you pick. Every wrong answer is explained: what the right
   answer is, what the wrong one really is, and (for flags) the two flags
   side by side.

   The data is loaded when this tab opens, not at start-up: data/geo.json
   (about 20 KB: countries, capitals, regions) and, for the first flag
   question, data/flags.json (about 1.7 MB of SVG; 550 KB over the wire).
   Neither is in the offline copy of the app shell; the service worker
   keeps them after first use. A flag is shown as an <img> from the SVG
   text, so nothing in a flag file can run. The list used, its sources
   and licences, and how disputed places are treated are printed under
   "About this list", read from the data file's own meta block.
   Saved on this device ('portal.drillsGeo'): counts per country and mode.

   US states: two more quizzes, state to capital and capital to state,
   over the Census regions you pick. The table is js/drills/usstates.js
   (checked against USGS and Census Bureau lists, both public domain);
   it is part of the code, with no file of its own to fetch. Its record sits in
   the same place under its own keys ('usc:TX', 'usr:TX').
   ============================================================ */
import * as G from './geocore.js';
import * as US from './usstates.js';
import { record } from './sched.js';

const KEY = 'portal.drillsGeo';
const DEFAULT = { v: 1, stats: {}, rounds: [], p: { mode: 'flag', regions: [...G.REGIONS], usRegions: [...US.US_REGIONS] } };
const ALL_MODES = [...G.MODES, ...US.US_MODES];
/* the country quizzes' record, without the states (a state's code can be a country's: CA, GA, IN…) */
const countryStats = stats => Object.fromEntries(Object.entries(stats).filter(([k]) => !US.isUsMode(k.split(':')[0])));
const plural = (n, w) => `${n} ${n === 1 ? w : /y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`}`;
const pct = (a, b) => `${Math.round(100 * a / b)}%`;

let geoP = null, flagsP = null;
const getJson = url => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
export const loadGeo = () => (geoP ||= getJson('data/geo.json').catch(e => { geoP = null; throw e; }));
export const loadFlags = () => (flagsP ||= getJson('data/flags.json').then(j => j.flags).catch(e => { flagsP = null; throw e; }));
const flagUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const stats = {};
  for (const [k, st] of Object.entries(r.stats && typeof r.stats === 'object' ? r.stats : {})) {
    if (/^(flag|cap|rev|usc|usr):[A-Z]{2}$/.test(k) && st && Number.isFinite(st.n) && Number.isFinite(st.ok)) stats[k] = { n: st.n, ok: st.ok, ms: 0, nm: 0 };
  }
  const p = { ...DEFAULT.p, ...(r.p || {}) };
  if (!ALL_MODES.some(m => m[0] === p.mode)) p.mode = 'flag';
  p.regions = Array.isArray(p.regions) ? p.regions.filter(x => G.REGIONS.includes(x)) : [...G.REGIONS];
  if (!p.regions.length) p.regions = [...G.REGIONS];
  p.usRegions = Array.isArray(p.usRegions) ? p.usRegions.filter(x => US.US_REGIONS.includes(x)) : [...US.US_REGIONS];
  if (!p.usRegions.length) p.usRegions = [...US.US_REGIONS];
  return { v: 1, stats, rounds: Array.isArray(r.rounds) ? r.rounds.slice(-100) : [], p };
}

export function mountGeo(host, ctx) {
  const { api } = ctx;
  const { h, icon, store } = api;
  const S = { data: normalize(store.get(KEY)), geo: null, flags: null, dead: false, run: null, summary: null, err: '', confirmClear: false, timers: new Set() };
  const save = () => { const d = S.data; store.set(KEY, { ...d, stats: { ...d.stats }, rounds: d.rounds.slice(-100), p: { ...d.p, regions: [...d.p.regions], usRegions: [...d.p.usRegions] } }); };
  const root = h('div.dr-geo', { dataset: { fk: 'geo' } });
  host.appendChild(root);
  const chip = (label, on, onclick, fk) => h('button.dr-chip', { type: 'button', class: on ? 'is-on' : '', 'aria-pressed': on ? 'true' : 'false', dataset: { fk }, onclick }, label);

  root.replaceChildren(h('p.dr-none', { dataset: { fk: 'geo-loading' }, role: 'status', text: 'Loading the country list…' }));
  load();
  function load() {
    loadGeo().then(j => { if (S.dead) return; S.geo = j; S.err = ''; paintHome(); }).catch(e => {
      if (S.dead) return;
      root.replaceChildren(h('div.dr-card', h('p.dr-warn', { dataset: { fk: 'geo-error' }, role: 'status', text: `The country list could not be loaded (${e.message}). It needs the network the first time; after that it is kept for offline use.` }),
        h('button.btn', { type: 'button', dataset: { fk: 'geo-retry' }, onclick: () => { root.replaceChildren(h('p.dr-none', { text: 'Loading the country list…' })); load(); } }, 'Try again')));
    });
  }

  function paintHome() {
    S.run = null;
    const d = S.data, p = d.p, geo = S.geo;
    const kids = [];
    if (S.summary) kids.push(S.summary);
    const us = US.isUsMode(p.mode);
    const pool = us ? US.eligibleStates(p.usRegions) : G.eligible(geo.countries, p.regions, p.mode);
    const regionChips = us
      ? US.US_REGIONS.map(r => chip(`${r} (${US.STATES.filter(s => s.region === r).length})`, p.usRegions.includes(r), () => {
        const next = p.usRegions.includes(r) ? p.usRegions.filter(x => x !== r) : [...p.usRegions, r];
        if (next.length) { p.usRegions = US.US_REGIONS.filter(x => next.includes(x)); save(); paintHome(); }
      }, `geo-usregion-${r}`))
      : G.REGIONS.map(r => {
        const n = geo.countries.filter(c => c.region === r).length;
        return chip(`${r} (${n})`, p.regions.includes(r), () => {
          const next = p.regions.includes(r) ? p.regions.filter(x => x !== r) : [...p.regions, r];
          if (next.length) { p.regions = G.REGIONS.filter(x => next.includes(x)); save(); paintHome(); }
        }, `geo-region-${r.replace(/\s+/g, '-')}`);
      });
    kids.push(h('div.dr-card', h('h3.dr-h', { text: 'Quiz me on' }),
      h('div.dr-chips', { role: 'group', 'aria-label': 'Quiz type' }, ...G.MODES.map(([id, name]) => chip(name, p.mode === id, () => { p.mode = id; save(); paintHome(); }, `geo-mode-${id}`))),
      h('div.dr-row', h('small.dim', { text: 'US states' }), h('div.dr-chips', { role: 'group', 'aria-label': 'US states quiz type' },
        ...US.US_MODES.map(([id, name]) => chip(name, p.mode === id, () => { p.mode = id; save(); paintHome(); }, `geo-mode-${id}`)))),
      h('div.dr-row', h('small.dim', { text: us ? 'Census regions' : 'Regions' }), h('div.dr-chips', { role: 'group', 'aria-label': us ? 'Census regions' : 'Regions' }, ...regionChips)),
      h('div.dr-row', h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'geo-start' }, disabled: pool.length < 4, onclick: start }, icon('play'), h('span', { text: `Start (${G.ROUND_QUESTIONS} questions)` })),
        h('small.dim', { dataset: { fk: 'geo-pool' }, text: us ? `${plural(pool.length, 'state')} in this quiz` : `${plural(pool.length, 'country')} in this quiz` })),
      S.err ? h('p.dr-warn', { dataset: { fk: 'geo-error' }, role: 'status', text: S.err }) : null));
    kids.push(progress());
    kids.push(about());
    root.replaceChildren(...kids);
  }

  function progress() {
    const d = S.data;
    const card = h('div.dr-card', { dataset: { fk: 'geo-progress' } }, h('h3.dr-h', { text: 'Your progress' }));
    const sum = G.summarize(countryStats(d.stats), S.geo.countries);
    const total = Object.values(sum.modes).reduce((a, m) => a + m.n, 0);
    const usSum = usSummary(d.stats);
    if (!total && !usSum.n) { card.append(h('p.dr-none', { dataset: { fk: 'geo-none' }, text: 'Nothing yet. Answer some questions and your accuracy by quiz type and region shows up here.' })); return card; }
    if (total) card.append(h('div.dr-ops', ...G.MODES.map(([id, name]) => { const m = sum.modes[id]; return h('div.dr-op', { dataset: { fk: `geo-sum-${id}`, n: String(m ? m.n : 0), ok: String(m ? m.ok : 0) } }, h('b', { text: name }), m ? h('span', { text: `${pct(m.ok, m.n)} right of ${plural(m.n, 'answer')}` }) : h('span.dim', { text: 'not tried' })); })));
    if (total) card.append(h('div.dr-ops', ...G.REGIONS.map(r => { const m = sum.regions[r]; return h('div.dr-op', { dataset: { fk: `geo-reg-${r.replace(/\s+/g, '-')}` } }, h('b', { text: r }), m ? h('span', { text: `${pct(m.ok, m.n)} of ${plural(m.n, 'answer')}` }) : h('span.dim', { text: 'not tried' })); })));
    if (total) card.append(h('h4.dr-h2', { text: 'To work on' }), sum.weak.length ? h('ul.dr-weak', { dataset: { fk: 'geo-weak' } }, ...sum.weak.map(w => h('li', { dataset: { iso: w.iso, mode: w.mode }, text: `${G.MODES.find(m => m[0] === w.mode)[1]}: ${w.name}, missed ${w.miss} of ${w.n}` }))) : h('p.dr-none', { text: 'You have not missed any.' }));
    if (usSum.n) {
      card.append(h('h4.dr-h2', { text: 'US states' }),
        h('div.dr-ops', ...US.US_MODES.map(([id, name]) => { const m = usSum.modes[id]; return h('div.dr-op', { dataset: { fk: `geo-sum-${id}`, n: String(m ? m.n : 0), ok: String(m ? m.ok : 0) } }, h('b', { text: name }), m ? h('span', { text: `${pct(m.ok, m.n)} right of ${plural(m.n, 'answer')}` }) : h('span.dim', { text: 'not tried' })); })),
        usSum.weak.length ? h('ul.dr-weak', { dataset: { fk: 'geo-usweak' } }, ...usSum.weak.map(w => h('li', { dataset: { code: w.code, mode: w.mode }, text: `${US.US_MODES.find(m => m[0] === w.mode)[1]}: ${w.name}, missed ${w.miss} of ${w.n}` }))) : h('p.dr-none', { text: 'No state missed.' }));
    }
    card.append(h('div.dr-row', S.confirmClear
      ? [h('small', { text: 'Clear all geography progress?' }), h('button.btn.btn--sm.btn--danger', { type: 'button', dataset: { fk: 'geo-clear-yes' }, onclick: () => { S.data = normalize({ p: S.data.p }); S.confirmClear = false; save(); paintHome(); } }, 'Clear it'), h('button.btn.btn--sm', { type: 'button', onclick: () => { S.confirmClear = false; paintHome(); } }, 'Keep it')]
      : h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'geo-clear' }, onclick: () => { S.confirmClear = true; paintHome(); } }, 'Clear my geography progress')));
    return card;
  }

  function usSummary(stats) {
    const modes = {}, weak = [];
    let n = 0;
    for (const [k, st] of Object.entries(stats)) {
      const [mode, code] = k.split(':');
      const s = US.isUsMode(mode) && US.STATES.find(x => x.code === code);
      if (!s || !st.n) continue;
      (modes[mode] ||= { n: 0, ok: 0 }); modes[mode].n += st.n; modes[mode].ok += st.ok; n += st.n;
      if (st.ok < st.n) weak.push({ mode, code, name: s.name, n: st.n, miss: st.n - st.ok });
    }
    weak.sort((a, b) => b.miss / b.n - a.miss / a.n || b.n - a.n);
    return { n, modes, weak: weak.slice(0, 6) };
  }

  function about() {
    const m = S.geo.meta;
    return h('details.dr-card.dr-about', { dataset: { fk: 'geo-about' } }, h('summary', { text: 'About this list' }),
      h('p', { dataset: { fk: 'geo-about-list' }, text: m.list }),
      h('p', { text: `Regions: ${m.regions}` }),
      h('p', { text: `Countries and capitals: ${m.countries.source}. Licence: ${m.countries.licence}.` }),
      h('p', { text: `Flags: ${m.flags.source} (${m.flags.url}), commit ${m.flags.commit.slice(0, 7)}. Licence: ${m.flags.licence}` }),
      h('p', { dataset: { fk: 'geo-about-us' }, text: `US states: the 50 states (Washington, D.C. is not a state, so it is not asked about). ${US.SOURCE}` }));
  }

  /* ---------------- a round ---------------- */
  async function start() {
    const p = S.data.p;
    S.summary = null; S.err = '';
    if (p.mode === 'flag' && !S.flags) {
      const b = root.querySelector('[data-fk="geo-start"]');
      if (b) { b.disabled = true; b.lastChild.textContent = 'Loading the flags…'; }
      try { S.flags = await loadFlags(); } catch (e) {
        if (S.dead) return;
        S.err = `The flags could not be loaded (${e.message}). They need the network the first time. The two capital quizzes work without them.`;
        paintHome();
        return;
      }
      if (S.dead) return;
    }
    S.run = { n: 0, ok: 0, q: null, answered: false, missed: [] };
    ask();
  }
  function ask() {
    const R = S.run, d = S.data;
    R.q = US.isUsMode(d.p.mode)
      ? US.makeUsQuestion({ mode: d.p.mode, regions: d.p.usRegions, stats: d.stats, avoidCode: R.q && R.q.iso })
      : G.makeQuestion({ countries: S.geo.countries, similar: S.geo.similar, regions: d.p.regions, mode: d.p.mode, stats: d.stats, avoidIso: R.q && R.q.iso });
    R.answered = false;
    paintRun();
  }
  function answer(opt) {
    const R = S.run, d = S.data;
    if (!R || R.answered) return;
    R.answered = true;
    const q = R.q;
    const us = US.isUsMode(q.mode);
    const ex = us ? US.explainUs(q, opt.iso) : G.explain(q, opt.iso, S.geo.countries, S.geo.similar);
    const key = `${q.mode}:${q.iso}`;
    d.stats[key] = record(d.stats[key], ex.right, null);
    R.n++;
    if (ex.right) R.ok++; else R.missed.push(us ? US.STATES.find(s => s.code === q.iso).name : S.geo.countries.find(c => c.iso === q.iso).name);
    save();
    paintRun(opt, ex);
  }
  function finish() {
    const R = S.run;
    S.data.rounds.push({ t: Date.now(), mode: S.data.p.mode, n: R.n, ok: R.ok });
    save();
    S.summary = h('div.dr-card.dr-result', { role: 'status', dataset: { fk: 'geo-summary', n: String(R.n), ok: String(R.ok) } },
      h('h3.dr-h', { text: 'Round finished' }), h('p', { text: `${R.ok} of ${plural(R.n, 'question')} right.` }),
      R.missed.length ? h('p', { text: `Missed: ${[...new Set(R.missed)].join(', ')}. They will come up more often.` }) : h('p', { text: 'No misses.' }));
    S.run = null;
    paintHome();
  }
  const flagImg = (iso, label, cls = '') => (S.flags && S.flags[iso] ? h('img.dr-flag', { class: cls, src: flagUrl(S.flags[iso]), alt: label, dataset: { iso } }) : null);

  function paintRun(chosen, ex) {
    const R = S.run, q = R.q, geo = S.geo;
    const us = US.isUsMode(q.mode);
    const c = us ? null : geo.countries.find(x => x.iso === q.iso);
    const st = us ? US.STATES.find(x => x.code === q.iso) : null;
    const m = ALL_MODES.find(x => x[0] === q.mode);
    const prompt = us ? h('div.dr-q', { dataset: { fk: 'geo-prompt' }, text: `${m[2]} ${q.mode === 'usc' ? st.name : st.capital}?` })
      : q.mode === 'flag' ? h('div.dr-flagbox', flagImg(q.iso, 'The flag to name', 'dr-flag--big'))
      : q.mode === 'cap' ? h('div.dr-q', { dataset: { fk: 'geo-prompt' }, text: `${m[2]} ${c.name}?` })
        : h('div.dr-q', { dataset: { fk: 'geo-prompt' }, text: `${m[2]} ${G.capitalLabel(c)}?` });
    const buttons = q.options.map((o, i) => {
      const done = !!ex;
      const cls = !done ? '' : o.label === q.answer || (q.mode === 'cap' && c.capitals.some(k => k.name === o.label)) ? 'is-right' : o.iso === chosen.iso ? 'is-wrong' : '';
      return h('button.dr-opt', { type: 'button', class: cls, disabled: done, dataset: { fk: `geo-opt-${i + 1}`, iso: o.iso }, onclick: () => answer(o) }, h('kbd', { text: String(i + 1) }), h('span', { text: o.label }));
    });
    const fb = ex ? h('div.dr-fb', { class: ex.right ? 'is-ok' : 'is-bad', dataset: { fk: 'geo-feedback', right: ex.right ? '1' : '0' }, role: 'status' },
      ...ex.lines.map(l => h('p', { text: l })),
      q.mode === 'flag' && !ex.right ? h('div.dr-flags2', flagImg(q.iso, `Flag of ${c.name}`), flagImg(chosen.iso, `Flag of ${geo.countries.find(x => x.iso === chosen.iso).name}`)) : null) : null;
    const last = R.n >= G.ROUND_QUESTIONS;
    root.replaceChildren(h('div.dr-card.dr-run',
      h('div.dr-run__top', h('span', { dataset: { fk: 'geo-count' }, text: `Question ${Math.min(R.n + (ex ? 0 : 1), G.ROUND_QUESTIONS)} of ${G.ROUND_QUESTIONS}` }), h('b', { text: `${R.ok} right` })),
      prompt, h('div.dr-opts', { role: 'group', 'aria-label': 'Answers' }, ...buttons), fb,
      h('div.dr-row', ex ? h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'geo-next' }, onclick: () => (last ? finish() : ask()) }, last ? 'See the result' : 'Next question') : null,
        h('button.btn.btn--ghost', { type: 'button', dataset: { fk: 'geo-stop' }, onclick: () => (R.n ? finish() : paintHome()) }, R.n ? 'Finish now' : 'Stop'))));
    const next = root.querySelector('[data-fk="geo-next"]');
    if (next) next.focus();
  }

  const onKey = e => {
    if (S.dead || !S.run || !root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!ctx.isActive()) return;
    /* Enter goes to the focused Next button */
    if (e.key >= '1' && e.key <= '4' && !S.run.answered) { const o = S.run.q.options[Number(e.key) - 1]; if (o) { e.preventDefault(); answer(o); } }
  };
  document.addEventListener('keydown', onKey);

  return {
    teardown() {
      S.dead = true;
      document.removeEventListener('keydown', onKey);
    },
    open() { /* nothing to open */ },
  };
}
