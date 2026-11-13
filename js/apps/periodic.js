/* ============================================================
   periodic.js — Periodic Table: all 118 elements, searchable.

   Every fact comes from data/elements.json, which tools/sync-elements.mjs
   copies from PubChem's public-domain periodic table. A field PubChem
   does not have is not shown — there is no filler, and nothing here is
   typed in from memory. The one thing worked out locally is the layout
   (which row and column an element sits in), from its number.

   · Click or arrow-key to an element for its details.
   · Search by name, symbol or number; the rest dim. Enter opens the
     first match.
   · The legend filters by category.
   · The temperature slider says whether each element is solid, liquid
     or gas, computed from its real melting and boiling points.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';

const CATS = [
  ['Alkali metal', 8], ['Alkaline earth metal', 38], ['Transition metal', 205], ['Post-transition metal', 165],
  ['Metalloid', 100], ['Nonmetal', 130], ['Halogen', 285], ['Noble gas', 265], ['Lanthanide', 330], ['Actinide', 350],
];

/** Row and column in the standard 18-column layout, from the atomic number. */
export function place(n) {
  if (n === 1) return [1, 1];
  if (n === 2) return [1, 18];
  if (n <= 4) return [2, n - 2];
  if (n <= 10) return [2, n + 8];
  if (n <= 12) return [3, n - 10];
  if (n <= 18) return [3, n];
  if (n <= 36) return [4, n - 18];
  if (n <= 54) return [5, n - 36];
  if (n <= 56) return [6, n - 54];
  if (n <= 70) return [9, n - 54];            /* La–Yb, the lanthanide row */
  if (n <= 86) return [6, n - 68];            /* Lu begins group 3 */
  if (n <= 88) return [7, n - 86];
  if (n <= 102) return [10, n - 86];          /* Ac–No, the actinide row */
  return [7, n - 100];
}

/** Solid, liquid or gas at a temperature in kelvin — only from the melting and boiling points PubChem has. */
export function stateAt(e, T) {
  const { mp, bp } = e;
  if (mp !== undefined && bp !== undefined) return T < mp ? 'solid' : T < bp ? 'liquid' : 'gas';
  if (mp !== undefined) return T < mp ? 'solid' : 'above';      /* melted, boiling point unknown */
  if (bp !== undefined) return T >= bp ? 'gas' : 'unknown';
  return 'unknown';
}
const STATE_TEXT = {
  solid: 'Solid', liquid: 'Liquid', gas: 'Gas',
  above: 'Liquid or gas (no boiling point in PubChem)',
  unknown: 'Unknown (no melting or boiling point in PubChem)',
};
const STATE_MARK = { solid: 's', liquid: 'l', gas: 'g', above: '', unknown: '' };

const fmt = (n, d = 6) => String(Number(n.toPrecision(d)));
const celsius = k => fmt(k - 273.15, 6);

const CSS = `
.pt{--ptc:var(--ink-2);flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1);container-type:inline-size}
.pt *{box-sizing:border-box}
.pt__bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-4);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.pt__search{flex:1 1 180px;min-width:140px;max-width:280px;height:30px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;font-size:var(--fs-13)}
.pt__search::placeholder{color:var(--ink-3)}
.pt__search:focus{outline:2px solid var(--accent);outline-offset:1px}
.pt__temp{display:flex;align-items:center;gap:var(--sp-3);flex:1 1 260px;font-size:var(--fs-12);color:var(--ink-2)}
.pt__temp input{flex:1;min-width:100px;accent-color:var(--accent)}
.pt__temp b{min-width:96px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-0);font-weight:600}
.pt__count{font-size:var(--fs-12);color:var(--ink-3);min-width:70px}
.pt__main{flex:1;min-height:0;display:flex;gap:var(--sp-4);padding:var(--sp-4);overflow:auto}
.pt__tablewrap{flex:1 1 0;min-width:420px;container-type:inline-size}
.pt__grid{display:grid;grid-template-columns:repeat(18,minmax(0,1fr));grid-template-rows:repeat(7,auto) .5fr repeat(2,auto);gap:3px}
.pt__c{--c:var(--ink-3);position:relative;aspect-ratio:1/1.08;min-width:0;padding:0;border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:color-mix(in srgb,var(--c) 24%,var(--fill-0));border:1px solid color-mix(in srgb,var(--c) 55%,transparent);color:var(--ink-0);cursor:pointer;line-height:1.05;
  transition:opacity var(--t-fast),transform var(--t-fast)}
.pt__c:hover{transform:scale(1.08);z-index:2;background:color-mix(in srgb,var(--c) 38%,var(--fill-1))}
.pt__c:focus-visible{outline:2px solid var(--accent);outline-offset:1px;z-index:3}
.pt__c.is-sel{outline:2px solid var(--ink-0);outline-offset:1px;z-index:3}
.pt__c.is-dim{opacity:.22}
.pt__c small{font-size:clamp(7px,1.15cqw,10px);color:var(--ink-2)}
.pt__c b{font-size:clamp(10px,2.1cqw,17px);font-weight:700}
.pt__c span{display:none;font-size:clamp(6px,.95cqw,9px);color:var(--ink-2);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@container (min-width:700px){.pt__c span{display:block}}
.pt__c i{position:absolute;right:3px;top:1px;font-style:normal;font-size:clamp(6px,.9cqw,9px);font-weight:700;color:var(--ink-2);text-transform:uppercase}
.pt__c[data-state=gas]{border-style:dashed}
.pt__c[data-state=liquid]{box-shadow:inset 0 -3px 0 #4aa3ff}
.pt__c[data-state=unknown],.pt__c[data-state=above]{border-style:dotted}
.pt__legend{grid-column:3/13;grid-row:1/4;display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;padding:0 var(--sp-3)}
.pt__chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:var(--r-pill);font-size:var(--fs-11);color:var(--ink-1);
  background:var(--fill-0);border:1px solid var(--line-1)}
.pt__chip::before{content:"";width:9px;height:9px;border-radius:3px;background:var(--c);flex:none}
.pt__chip:hover{background:var(--fill-2)}
.pt__chip[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.pt__key{flex-basis:100%;font-size:var(--fs-10);color:var(--ink-3);line-height:1.5}
.pt__flabel{grid-column:1/3;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-size:var(--fs-10);color:var(--ink-3);text-align:right}
.pt__side{flex:0 0 250px;display:flex;flex-direction:column;gap:var(--sp-3);padding:var(--sp-4);border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-0);align-self:flex-start;max-height:100%;overflow:auto}
@container (max-width:520px){.pt__side{flex-basis:100%}}
.pt__tile{--c:var(--ink-3);display:flex;align-items:center;gap:var(--sp-4)}
.pt__sym{width:68px;height:68px;border-radius:var(--r-md);display:grid;place-items:center;font-size:30px;font-weight:800;color:var(--ink-0);
  background:color-mix(in srgb,var(--c) 28%,var(--fill-0));border:1px solid color-mix(in srgb,var(--c) 60%,transparent);position:relative}
.pt__sym small{position:absolute;left:6px;top:3px;font-size:var(--fs-11);font-weight:600;color:var(--ink-2)}
.pt__name{font-size:var(--fs-18);font-weight:700;color:var(--ink-0)}
.pt__cat{font-size:var(--fs-12);color:var(--ink-2)}
.pt__facts{display:grid;grid-template-columns:auto 1fr;gap:5px var(--sp-4);margin:0;font-size:var(--fs-12)}
.pt__facts dt{color:var(--ink-3)}
.pt__facts dd{margin:0;color:var(--ink-0);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.pt__src{font-size:var(--fs-10);color:var(--ink-3);line-height:1.5}
.pt__empty{color:var(--ink-3);font-size:var(--fs-12);line-height:1.5}
.pt__err{padding:var(--sp-6);color:var(--ink-2)}
.pt__tabs{display:flex;gap:var(--sp-2)}
.pt__tabs button{height:28px;padding:0 var(--sp-4);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;font-size:var(--fs-12)}
.pt__tabs button[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.pt__tabs button:disabled{opacity:.5}
.pt--chem .pt__search,.pt--chem .pt__count,.pt--chem .pt__temp,.pt--chem .pt__main{display:none}
.pt__chem{flex:1;min-height:0;display:flex}
.pt__chem[hidden]{display:none}
`;

defineApp({
  id: 'periodic',
  name: 'Periodic Table',
  icon: 'grid',
  g1: '#7be0c3', g2: '#0f7d73',
  category: 'Utilities',
  keywords: ['chemistry', 'elements', 'atom', 'science', 'periodic', 'element', 'atomic number', 'mass', 'school', 'molar mass', 'formula', 'balance', 'equation', 'molecular weight', 'stoichiometry'],
  desc: 'All 118 elements and their facts, from PubChem, plus molar mass and equation balancing',
  win: { w: 940, h: 640, minW: 560, minH: 420 },
  shortcuts: [
    ['Left / Right / Up / Down', 'Move between elements'],
    ['Enter', 'Open the first search match'],
    ['/', 'Search'],
  ],

  mount({ root, win, opts }) { return build(root, win, opts); },
});

function build(root, win, opts) {
  let dead = false;
  const offs = [];
  const S = { els: [], sel: null, q: '', cat: null, T: 298 };
  const cells = new Map();                       /* number -> button */
  const hue = new Map(CATS);
  const colour = cat => `hsl(${hue.get(cat) ?? 210} 62% 52%)`;

  const search = h('input.pt__search', { type: 'search', placeholder: 'Name, symbol or number', 'aria-label': 'Search elements by name, symbol or number', autocomplete: 'off', spellcheck: 'false' });
  const count = h('span.pt__count', { role: 'status', 'aria-live': 'polite' });
  const range = h('input', { type: 'range', min: 0, max: 6000, step: 1, value: 298, 'aria-label': 'Temperature in kelvin' });
  const tempOut = h('b');
  const grid = h('div.pt__grid', { role: 'group', 'aria-label': 'Periodic table' });
  const side = h('aside.pt__side', { role: 'region', 'aria-label': 'Element details', 'aria-live': 'polite' });
  const tabBtn = (id, label) => h('button', { type: 'button', 'aria-pressed': String(id === 'table'), dataset: { tab: id }, disabled: id === 'formulas', onclick: () => showTab(id) }, h('span', { text: label }));
  const tabs = h('div.pt__tabs', { role: 'group', 'aria-label': 'Periodic Table views' }, tabBtn('table', 'Table'), tabBtn('formulas', 'Formulas'));
  const chemHost = h('div.pt__chem', { hidden: true });
  const bar = h('div.pt__bar', tabs, search, count, h('label.pt__temp', h('span', { text: 'Temperature' }), range, tempOut));
  const el = h('div.pt', h('style', { text: CSS }), bar, h('div.pt__main', h('div.pt__tablewrap', grid), side), chemHost);
  root.appendChild(el);
  let chem = null;
  /* the Formulas tab: code and the element data are used once it is opened */
  async function showTab(id) {
    if (id === 'formulas' && !S.els.length) return;
    const chemOn = id === 'formulas';
    el.classList.toggle('pt--chem', chemOn);
    chemHost.hidden = !chemOn;
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.tab === id));
    win.setSubtitle(chemOn ? 'Formulas · molar mass and balancing' : '118 elements · PubChem');
    if (chemOn && !chem) {
      chem = {};
      try {
        const { mountChem } = await import('../school/chem.js');
        if (dead) return;
        chem = mountChem(chemHost, { elements: S.els });
      } catch (err) { chem = null; chemHost.replaceChildren(h('div.pt__err', { text: 'The formula tools could not be loaded (' + err.message + ').' })); }
    }
    if (chemOn && chem && chem.focus) chem.focus();
  }

  const note = text => { grid.replaceChildren(); side.replaceChildren(h('div.pt__err', { text })); };
  grid.append(h('div.pt__empty', { text: 'Loading elements…' }));

  fetch('data/elements.json')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(j => { if (!dead) init(j); })
    .catch(err => { if (!dead) note('The element data could not be loaded (' + err.message + '). Check your connection and reopen the app.'); });

  let source = null;
  function init(j) {
    source = j;
    S.els = j.elements;
    tabs.querySelector('[data-tab="formulas"]').disabled = false;
    const legend = h('div.pt__legend', { role: 'group', 'aria-label': 'Filter by category' },
      ...CATS.map(([name]) => {
        const b = h('button.pt__chip', { type: 'button', text: name, 'aria-pressed': 'false', dataset: { cat: name }, style: { '--c': colour(name) } });
        b.onclick = () => { S.cat = S.cat === name ? null : name; refresh(); };
        return b;
      }),
      h('div.pt__key', { text: 'Corner letter and cell edge show the state at the chosen temperature: s solid, l liquid (blue base), g gas (dashed).' }));
    const cellEls = [legend];
    for (const e of S.els) {
      const [r, c] = place(e.n);
      const b = h('button.pt__c', { type: 'button', tabindex: '-1', dataset: { n: e.n, sym: e.s }, style: { gridRow: r, gridColumn: c, '--c': colour(e.cat) },
        onclick: () => select(e.n, true) },
        h('small', { text: String(e.n) }), h('b', { text: e.s }), h('span', { text: e.name }), h('i'));
      cells.set(e.n, b);
      cellEls.push(b);
    }
    cellEls.push(h('div.pt__flabel', { style: { gridRow: 9 }, text: 'La–Yb' }), h('div.pt__flabel', { style: { gridRow: 10 }, text: 'Ac–No' }));
    grid.replaceChildren(...cellEls);
    cells.get(1).tabIndex = 0;
    const want = opts && (opts.symbol ? S.els.find(e => e.s.toLowerCase() === String(opts.symbol).toLowerCase()) : opts.n ? S.els.find(e => e.n === +opts.n) : null);
    refresh();
    if (want) select(want.n, false);
    else paintSide();
    if (opts && opts.tab === 'formulas') showTab('formulas');
  }

  /* ---- search / filter / temperature ---- */
  const norm = s => String(s).toLowerCase().trim();
  function matches(e) {
    if (S.cat && e.cat !== S.cat) return false;
    const q = norm(S.q);
    if (!q) return true;
    if (/^\d+$/.test(q)) return String(e.n) === q;
    return e.s.toLowerCase() === q || e.name.toLowerCase().includes(q);
  }
  function refresh() {
    let shown = 0, first = null;
    for (const e of S.els) {
      const b = cells.get(e.n);
      const hit = matches(e);
      if (hit) { shown++; first = first || e; }
      b.classList.toggle('is-dim', !hit);
      b.dataset.match = hit ? '1' : '0';
      const st = stateAt(e, S.T);
      b.dataset.state = st;
      b.querySelector('i').textContent = STATE_MARK[st];
      b.setAttribute('aria-label', `${e.name}, number ${e.n}, ${e.cat || 'category unknown'}, ${STATE_TEXT[st].split(' (')[0].toLowerCase()} at ${S.T} kelvin`);
    }
    for (const chip of el.querySelectorAll('.pt__chip')) chip.setAttribute('aria-pressed', String(chip.dataset.cat === S.cat));
    const filtering = !!(S.q.trim() || S.cat);
    count.textContent = filtering ? `${shown} of ${S.els.length}` : `${S.els.length} elements`;
    S.first = filtering ? first : null;
    tempOut.textContent = `${S.T} K · ${celsius(S.T)} °C`;
    if (S.sel) paintSide();
  }
  function select(n, focus) {
    S.sel = n;
    for (const [k, b] of cells) { b.classList.toggle('is-sel', k === n); b.tabIndex = k === n ? 0 : -1; }
    if (focus) cells.get(n).focus({ preventScroll: true });
    paintSide();
  }

  /* ---- the details ---- */
  function paintSide() {
    const e = S.els.find(x => x.n === S.sel);
    if (!e) {
      side.replaceChildren(h('div.pt__empty', { text: 'Choose an element to see its number, mass, configuration, melting and boiling points and more. Facts come from PubChem; anything it does not list is left out.' }), srcLine());
      return;
    }
    const rows = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== '') rows.push(h('dt', { text: k }), h('dd', { text: v })); };
    const st = stateAt(e, S.T);
    add('Atomic number', String(e.n));
    add('Symbol', e.s);
    add('Name', e.name);
    add('Atomic mass', e.mass !== undefined ? `${fmt(e.mass, 10)} u` : undefined);
    add('Category', e.cat);
    add('Electron configuration', e.cfg);
    add('Electronegativity', e.en !== undefined ? fmt(e.en) : undefined);
    add('Density', e.den !== undefined ? `${fmt(e.den)} g/cm³` : undefined);
    add('Melting point', e.mp !== undefined ? `${fmt(e.mp)} K (${celsius(e.mp)} °C)` : undefined);
    add('Boiling point', e.bp !== undefined ? `${fmt(e.bp)} K (${celsius(e.bp)} °C)` : undefined);
    add('Discovered', e.yr === 'Ancient' ? 'Known since antiquity' : e.yr);
    add('Standard state', e.std);
    add('Atomic radius', e.rad !== undefined ? `${fmt(e.rad)} pm` : undefined);
    add('Ionisation energy', e.ie !== undefined ? `${fmt(e.ie)} eV` : undefined);
    add('Electron affinity', e.ea !== undefined ? `${fmt(e.ea)} eV` : undefined);
    add('Oxidation states', e.ox);
    add(`State at ${S.T} K`, STATE_TEXT[st]);
    side.replaceChildren(
      h('div.pt__tile', { style: { '--c': colour(e.cat) } },
        h('div.pt__sym', h('small', { text: String(e.n) }), e.s),
        h('div', h('div.pt__name', { text: e.name }), h('div.pt__cat', { text: e.cat || '' }))),
      h('dl.pt__facts', ...rows),
      srcLine());
    side.dataset.n = e.n;
  }
  const srcLine = () => h('div.pt__src', { text: source ? `Source: ${source.source}, fetched ${source.fetched}. Temperature states use the melting and boiling points listed here.` : '' });

  /* ---- input ---- */
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  on(search, 'input', () => { S.q = search.value; refresh(); });
  on(search, 'keydown', e => {
    if (e.key === 'Enter' && S.first) { e.preventDefault(); select(S.first.n, true); }
    else if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; S.q = ''; refresh(); }
  });
  on(range, 'input', () => { S.T = Number(range.value); refresh(); });
  on(grid, 'keydown', e => {
    const m = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    const cur = Number(document.activeElement?.dataset?.n);
    if (!m || !cur) return;
    e.preventDefault();
    /* the nearest element in that direction, by grid position */
    const [r0, c0] = place(cur);
    let best = null, bd = Infinity;
    for (const x of S.els) {
      const [r, c] = place(x.n);
      const dr = r - r0, dc = c - c0;
      if (m[0] ? Math.sign(dr) !== m[0] : Math.sign(dc) !== m[1]) continue;
      const d = m[0] ? Math.abs(dr) * 3 + Math.abs(dc) : Math.abs(dc) * 3 + Math.abs(dr);
      if (d < bd) { bd = d; best = x; }
    }
    if (best) select(best.n, true);
  });
  on(window, 'keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !win.el.classList.contains('is-active')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault(); search.focus();
  });
  tempOut.textContent = `${S.T} K · ${celsius(S.T)} °C`;
  win.setSubtitle('118 elements · PubChem');

  return () => { dead = true; offs.splice(0).forEach(f => f()); if (chem && chem.teardown) chem.teardown(); };
}
