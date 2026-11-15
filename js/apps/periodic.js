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
   · Colour by: the category (the default), or any property the data
     has (mass, electronegativity, density, melting and boiling points,
     radius, ionisation energy, electron affinity, year discovered,
     standard state). An element without that value is grey and says
     "not in the data". The legend gives the range the colours span.
   · Compare: pick a second element and the panel shows the two side by
     side, every row from the data.
   · Each element's panel draws its electron shells from the
     configuration in the data (js/school/ptprops.js) and can add the
     element to Static Study as a flashcard, on a click.
   · Save picture: the table as it is coloured, as a PNG in ~/Pictures.
   · Tabs: Trends charts a property across the elements, a period or a
     group (js/school/pttrends.js); Quiz asks rounds of ten
     (js/school/ptquiz.js); Formulas is molar mass and equations.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { vfs } from '../core/vfs.js';
import media from '../core/media.js';
import { PROPS, STATES, STATE_COLOURS, propOf, valueOf, valueText, rangeOf, position, rampColour, RAMP_CSS, shellsOf } from '../school/ptprops.js';

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
.pt__sym{width:68px;height:68px;border-radius:var(--r-md);display:grid;place-items:center;font-size:calc(30px * var(--fs-k,1));font-weight:800;color:var(--ink-0);
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
.pt:not([data-view=table]) .pt__search,.pt:not([data-view=table]) .pt__count,.pt:not([data-view=table]) .pt__temp,.pt:not([data-view=table]) .pt__main,.pt:not([data-view=table]) .pt__tools{display:none}
.pt__tools{display:flex;gap:var(--sp-3);align-items:center;font-size:var(--fs-12);color:var(--ink-2)}
.pt__tools select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;font-size:var(--fs-12);padding:0 6px}
.pt__act{height:28px;padding:0 10px;border-radius:var(--r-sm);border:1px solid var(--line-1);background:var(--fill-1);color:var(--ink-0);font:inherit;font-size:var(--fs-12);white-space:nowrap}
.pt__act:hover{background:var(--fill-2)}
.pt__act[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2)}
.pt:not([data-by=cat]) .pt__c{background:color-mix(in srgb,var(--c) 62%,var(--fill-0));border-color:color-mix(in srgb,var(--c) 85%,transparent)}
.pt:not([data-by=cat]) .pt__c:hover{background:color-mix(in srgb,var(--c) 75%,var(--fill-1))}
.pt .pt__c[data-nodata="1"]{--c:var(--ink-3)!important;background:repeating-linear-gradient(135deg,var(--fill-0) 0 4px,var(--fill-1) 4px 8px);border-style:dotted}
.pt__c.is-cmp{outline:2px dashed var(--accent);outline-offset:1px;z-index:3}
.pt__ramp{flex-basis:100%;display:flex;flex-direction:column;gap:3px;font-size:var(--fs-10);color:var(--ink-2)}
.pt__ramp i{display:block;height:9px;border-radius:5px;max-width:320px}
.pt__ramp span{display:flex;justify-content:space-between;max-width:320px;font-variant-numeric:tabular-nums}
.pt__states{display:flex;flex-wrap:wrap;gap:4px 10px}
.pt__states b{display:inline-flex;align-items:center;gap:4px;font-weight:500}
.pt__states b::before{content:"";width:9px;height:9px;border-radius:3px;background:var(--c)}
.pt__acts{display:flex;flex-wrap:wrap;gap:var(--sp-2)}
.pt__shells{display:flex;flex-direction:column;align-items:center;gap:4px}
.pt__shells svg{width:100%;max-width:210px;height:auto}
.pt__shells small{font-size:var(--fs-11);color:var(--ink-2);text-align:center;line-height:1.4}
.pt__cmp{width:100%;border-collapse:collapse;font-size:var(--fs-12)}
.pt__cmp th,.pt__cmp td{padding:4px 4px;border-bottom:1px solid var(--line-1);text-align:left;vertical-align:top;font-variant-numeric:tabular-nums}
.pt__cmp th{color:var(--ink-3);font-weight:500}
.pt__cmp td.is-none{color:var(--ink-3);font-style:italic}
.pt__pick{font-size:var(--fs-12);color:var(--ink-1);padding:var(--sp-3);border-radius:var(--r-sm);border:1px dashed var(--accent);line-height:1.5}
.pt__host{flex:1;min-height:0;display:flex}
.pt__host[hidden]{display:none}
`;

defineApp({
  id: 'periodic',
  name: 'Periodic Table',
  icon: 'grid',
  g1: '#7be0c3', g2: '#0f7d73',
  category: 'Utilities',
  keywords: ['chemistry', 'elements', 'atom', 'science', 'periodic', 'element', 'atomic number', 'mass', 'school', 'molar mass', 'formula', 'balance', 'equation', 'molecular weight', 'stoichiometry', 'electronegativity', 'trends', 'electron shells', 'quiz', 'percent composition'],
  desc: 'All 118 elements and their facts, from PubChem: colour by property, trends, a quiz, molar mass and equation balancing',
  win: { w: 940, h: 640, minW: 560, minH: 420 },
  shortcuts: [
    ['Left / Right / Up / Down', 'Move between elements'],
    ['Enter', 'Open the first search match'],
    ['/', 'Search'],
  ],

  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const offs = [];
  const S = { els: [], sel: null, q: '', cat: null, T: 298, by: 'cat', cmp: null };   /* cmp: { a, b, picking } */
  const cells = new Map();                       /* number -> button */
  const hue = new Map(CATS);
  const colour = cat => `hsl(${hue.get(cat) ?? 210} 62% 52%)`;
  const say = (title, message, icon = 'grid', actions) => api && api.notify({ app: 'Periodic Table', icon, title, message, timeout: 7000, actions });

  const search = h('input.pt__search', { type: 'search', placeholder: 'Name, symbol or number', 'aria-label': 'Search elements by name, symbol or number', autocomplete: 'off', spellcheck: 'false' });
  const count = h('span.pt__count', { role: 'status', 'aria-live': 'polite' });
  const range = h('input', { type: 'range', min: 0, max: 6000, step: 1, value: 298, 'aria-label': 'Temperature in kelvin' });
  const tempOut = h('b');
  const grid = h('div.pt__grid', { role: 'group', 'aria-label': 'Periodic table' });
  const side = h('aside.pt__side', { role: 'region', 'aria-label': 'Element details', 'aria-live': 'polite' });
  const tabBtn = (id, label) => h('button', { type: 'button', 'aria-pressed': String(id === 'table'), dataset: { tab: id }, disabled: id !== 'table', onclick: () => showTab(id) }, h('span', { text: label }));
  const tabs = h('div.pt__tabs', { role: 'group', 'aria-label': 'Periodic Table views' }, tabBtn('table', 'Table'), tabBtn('trends', 'Trends'), tabBtn('quiz', 'Quiz'), tabBtn('formulas', 'Formulas'));
  const chemHost = h('div.pt__chem', { hidden: true });
  const trendsHost = h('div.pt__host', { hidden: true, dataset: { host: 'trends' } });
  const quizHost = h('div.pt__host', { hidden: true, dataset: { host: 'quiz' } });
  const byPick = h('select', { 'aria-label': 'Colour the table by', dataset: { fk: 'pt-colour' }, onchange: e => { S.by = e.target.value; refresh(); } },
    h('option', { value: 'cat', text: 'Category' }), ...PROPS.map(p => h('option', { value: p.id, text: p.label })), h('option', { value: 'std', text: 'Standard state' }));
  const tools = h('div.pt__tools', h('span', { text: 'Colour by' }), byPick,
    h('button.pt__act', { type: 'button', dataset: { fk: 'pt-picture' }, title: 'Save the table, coloured as it is, as a PNG in Pictures', onclick: () => savePicture() }, 'Save picture'));
  const bar = h('div.pt__bar', tabs, search, count, tools, h('label.pt__temp', h('span', { text: 'Temperature' }), range, tempOut));
  const el = h('div.pt', { dataset: { view: 'table' } }, h('style', { text: CSS }), bar, h('div.pt__main', h('div.pt__tablewrap', grid), side), chemHost, trendsHost, quizHost);
  root.appendChild(el);
  let chem = null, trends = null, quiz = null;
  /* the other tabs: their code is loaded the first time each is opened */
  async function showTab(id) {
    if (id !== 'table' && !S.els.length) return;
    el.dataset.view = id;
    el.classList.toggle('pt--chem', id === 'formulas');
    chemHost.hidden = id !== 'formulas';
    trendsHost.hidden = id !== 'trends';
    quizHost.hidden = id !== 'quiz';
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.tab === id));
    win.setSubtitle(id === 'formulas' ? 'Formulas · molar mass and balancing' : id === 'trends' ? 'Trends · from PubChem’s data' : id === 'quiz' ? 'Quiz' : '118 elements · PubChem');
    const load = async (path, mount, host, err) => {
      try { const m = await import(path); if (dead) return null; return mount(m); } catch (e) { host.replaceChildren(h('div.pt__err', { text: `${err} (${e.message}).` })); return null; }
    };
    if (id === 'formulas' && !chem) {
      chem = {};
      chem = await load('../school/chem.js', m => m.mountChem(chemHost, { elements: S.els }), chemHost, 'The formula tools could not be loaded');
    }
    if (id === 'trends' && !trends) {
      trends = {};
      trends = await load('../school/pttrends.js', m => m.mountTrends(trendsHost, { elements: S.els, place, onPick: n => { showTab('table'); select(n, true); } }), trendsHost, 'The trend charts could not be loaded');
    }
    if (id === 'quiz' && !quiz) {
      quiz = {};
      quiz = await load('../school/ptquiz.js', m => m.mountQuiz(quizHost, { elements: S.els, place, isActive: () => win.el.classList.contains('is-active'), onAddCards: list => addCards(list) }), quizHost, 'The quiz could not be loaded');
    }
    const now = id === 'formulas' ? chem : id === 'trends' ? trends : id === 'quiz' ? quiz : null;
    if (now && now.focus) now.focus();
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
    for (const b of tabs.children) b.disabled = false;
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
    if (opts && ['formulas', 'trends', 'quiz'].includes(opts.tab)) showTab(opts.tab);
  }

  /* ---- colour by: the category, or a property the data has ---- */
  function colourOf(e) {
    if (S.by === 'cat') return { c: colour(e.cat), none: false };
    if (S.by === 'std') return e.std && STATE_COLOURS[e.std] ? { c: STATE_COLOURS[e.std], none: false } : { c: null, none: true };
    /* "known since antiquity" is in the data; it just isn't a year, so it gets a colour of its own */
    if (S.by === 'yr' && e.yr === 'Ancient') return { c: ANCIENT, none: false, ancient: true };
    const t = position(valueOf(e, S.by), S.rng, S.by);
    return t === undefined ? { c: null, none: true } : { c: rampColour(t), none: false };
  }
  const ANCIENT = 'hsl(24 45% 38%)';
  function paintLegend() {
    const legend = el.querySelector('.pt__legend');
    if (!legend) return;
    legend.querySelector('.pt__ramp')?.remove();
    legend.querySelector('.pt__key').hidden = S.by !== 'cat';
    if (S.by === 'cat') return;
    const p = propOf(S.by);
    const missing = S.els.filter(e => colourOf(e).none);
    const ancient = S.by === 'yr' ? S.els.filter(e => e.yr === 'Ancient').length : 0;
    const tail = (ancient ? `Brown: known since antiquity (${ancient}). ` : '') + (missing.length ? `Grey, hatched: not in the data (${missing.length} element${missing.length === 1 ? '' : 's'}).` : 'Every element has a value.');
    const ramp = S.by === 'std'
      ? h('div.pt__ramp', { dataset: { fk: 'pt-ramp', missing: String(missing.length) } }, h('div.pt__states', ...STATES.filter(s => S.els.some(e => e.std === s)).map(s => h('b', { style: { '--c': STATE_COLOURS[s] }, text: s }))), h('small', { text: `Standard state, as PubChem gives it. ${tail}` }))
      : h('div.pt__ramp', { dataset: { fk: 'pt-ramp', min: String(S.rng.min), max: String(S.rng.max), missing: String(missing.length) } },
        h('i', { style: { background: RAMP_CSS } }),
        h('span', h('b', { text: valueText({ [S.by]: S.rng.min, yr: String(S.rng.min) }, S.by) }), h('b', { text: valueText({ [S.by]: S.rng.max, yr: String(S.rng.max) }, S.by) })),
        h('small', { text: `${p.label}${p.unit ? (p.unit.startsWith('(') ? ` ${p.unit}` : ` (${p.unit})`) : ''}, low to high${p.log ? ', on a log scale' : ''}. ${tail}` }));
    legend.append(ramp);
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
    S.rng = S.by !== 'cat' && S.by !== 'std' ? rangeOf(S.els, S.by) : null;
    el.dataset.by = S.by;
    for (const e of S.els) {
      const b = cells.get(e.n);
      const hit = matches(e);
      if (hit) { shown++; first = first || e; }
      b.classList.toggle('is-dim', !hit);
      b.dataset.match = hit ? '1' : '0';
      const st = stateAt(e, S.T);
      b.dataset.state = st;
      b.querySelector('i').textContent = STATE_MARK[st];
      const col = colourOf(e);
      b.style.setProperty('--c', col.c || 'var(--ink-3)');
      b.dataset.nodata = col.none ? '1' : '0';
      b.dataset.colour = col.c || '';
      const by = S.by === 'cat' ? '' : `, ${S.by === 'std' ? 'standard state' : propOf(S.by).label.toLowerCase()} ${valueText(e, S.by)}`;
      b.setAttribute('aria-label', `${e.name}, number ${e.n}, ${e.cat || 'category unknown'}, ${STATE_TEXT[st].split(' (')[0].toLowerCase()} at ${S.T} kelvin${by}`);
    }
    paintLegend();
    for (const chip of el.querySelectorAll('.pt__chip')) chip.setAttribute('aria-pressed', String(chip.dataset.cat === S.cat));
    const filtering = !!(S.q.trim() || S.cat);
    count.textContent = filtering ? `${shown} of ${S.els.length}` : `${S.els.length} elements`;
    S.first = filtering ? first : null;
    tempOut.textContent = `${S.T} K · ${celsius(S.T)} °C`;
    if (S.sel) paintSide();
  }
  function select(n, focus) {
    /* comparing: the next element picked is the second one, and the first stays */
    if (S.cmp && S.cmp.picking) {
      if (n !== S.cmp.a) { S.cmp.b = n; S.cmp.picking = false; }
      for (const [k, b] of cells) { b.classList.toggle('is-cmp', k === S.cmp.b); b.tabIndex = k === n ? 0 : -1; }
      if (focus) cells.get(n).focus({ preventScroll: true });
      paintSide();
      return;
    }
    S.sel = n;
    if (S.cmp && S.cmp.a !== n) S.cmp = null;
    for (const [k, b] of cells) { b.classList.toggle('is-sel', k === n); b.classList.toggle('is-cmp', !!S.cmp && k === S.cmp.b); b.tabIndex = k === n ? 0 : -1; }
    if (focus) cells.get(n).focus({ preventScroll: true });
    paintSide();
  }
  function startCompare() {
    if (!S.sel) return;
    S.cmp = { a: S.sel, b: null, picking: true };
    paintSide();
  }
  function stopCompare() {
    S.cmp = null;
    for (const b of cells.values()) b.classList.remove('is-cmp');
    paintSide();
  }

  /* ---- the details ---- */
  function paintSide() {
    const e = S.els.find(x => x.n === S.sel);
    if (e && S.cmp && S.cmp.b) return paintCompare(e, S.els.find(x => x.n === S.cmp.b));
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
    side.replaceChildren(...[
      h('div.pt__tile', { style: { '--c': colour(e.cat) } },
        h('div.pt__sym', h('small', { text: String(e.n) }), e.s),
        h('div', h('div.pt__name', { text: e.name }), h('div.pt__cat', { text: e.cat || '' }))),
      h('div.pt__acts',
        h('button.pt__act', { type: 'button', dataset: { fk: 'pt-compare' }, 'aria-pressed': String(!!(S.cmp && S.cmp.picking)), onclick: () => (S.cmp && S.cmp.picking ? stopCompare() : startCompare()) }, S.cmp && S.cmp.picking ? 'Cancel compare' : 'Compare with…'),
        h('button.pt__act', { type: 'button', dataset: { fk: 'pt-card' }, onclick: () => addCards([e]) }, 'Add to flashcards')),
      S.cmp && S.cmp.picking ? h('div.pt__pick', { role: 'status', dataset: { fk: 'pt-picking' }, text: `Now click another element to compare with ${e.name}.` }) : null,
      h('dl.pt__facts', ...rows),
      shellView(e),
      srcLine()].filter(Boolean));
    side.dataset.n = e.n;
  }

  /* the electron shells, from the configuration in the data */
  function shellView(e) {
    const sh = shellsOf(e, S.bySym || (S.bySym = Object.fromEntries(S.els.map(x => [x.s, x]))));
    if (!sh) return h('small.pt__src', { dataset: { fk: 'pt-shells', none: '1' }, text: 'No shell diagram: the electron configuration in the data does not add up to this element’s number of electrons.' });
    const NS = 'http://www.w3.org/2000/svg';
    const S2 = (tag, attrs, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
    const R = 100, gap = Math.min(15, 78 / sh.shells.length), r0 = 20;
    const svg = S2('svg', { viewBox: `0 0 ${R * 2} ${R * 2}`, role: 'img', 'aria-label': `Electron shells of ${e.name}: ${sh.shells.join(', ')}` });
    svg.append(S2('circle', { cx: R, cy: R, r: r0 - 4, fill: colour(e.cat), 'fill-opacity': '.35', stroke: 'currentColor', 'stroke-opacity': '.4' }),
      S2('text', { x: R, y: R + 4, 'text-anchor': 'middle', 'font-size': '12', 'font-weight': '700', fill: 'currentColor' }, e.s));
    sh.shells.forEach((count, i) => {
      const rr = r0 + gap * (i + 1);
      svg.append(S2('circle', { cx: R, cy: R, r: rr, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.25' }));
      for (let k = 0; k < count; k++) {
        const a = (2 * Math.PI * k) / count - Math.PI / 2;
        svg.append(S2('circle', { cx: (R + rr * Math.cos(a)).toFixed(2), cy: (R + rr * Math.sin(a)).toFixed(2), r: count > 18 ? 1.6 : 2.4, fill: 'var(--accent)', 'data-shell': String(i + 1) }));
      }
    });
    return h('div.pt__shells', { dataset: { fk: 'pt-shells', shells: sh.shells.join(',') } }, svg,
      h('small', { text: `Electrons per shell: ${sh.shells.join(', ')}. Counted from the configuration ${sh.cfg.replace(/\s*\((predicted|calculated)\)/i, '')} in the data${sh.predicted ? ', which PubChem gives as predicted' : ''}.` }));
  }

  /* two elements side by side: every row from the data, "not in the data" where it has none */
  function paintCompare(a, b) {
    const ROWS = [['Atomic number', x => String(x.n)], ['Symbol', x => x.s], ['Category', x => x.cat || 'not in the data'],
      ...PROPS.map(p => [p.label, x => valueText(x, p.id), p.id]), ['Standard state', x => x.std || 'not in the data'], ['Electron configuration', x => x.cfg || 'not in the data'],
      ['Electron shells', x => { const s = shellsOf(x, S.bySym || (S.bySym = Object.fromEntries(S.els.map(y => [y.s, y])))); return s ? s.shells.join(', ') : 'not in the data'; }],
      ['Oxidation states', x => x.ox || 'not in the data']];
    const cell = v => h('td', { class: v === 'not in the data' ? 'is-none' : '', text: v });
    side.replaceChildren(
      h('div.pt__acts', h('b', { text: `${a.name} and ${b.name}` }), h('button.pt__act', { type: 'button', dataset: { fk: 'pt-cmp-stop' }, onclick: stopCompare }, 'Stop comparing')),
      h('table.pt__cmp', { dataset: { fk: 'pt-cmp', a: String(a.n), b: String(b.n) }, 'aria-label': `${a.name} compared with ${b.name}` },
        h('thead', h('tr', h('th', { text: '' }), h('th', { scope: 'col', text: a.s }), h('th', { scope: 'col', text: b.s }))),
        h('tbody', ...ROWS.map(([label, f, id]) => h('tr', { dataset: { prop: id || label } }, h('th', { scope: 'row', text: label }), cell(f(a)), cell(f(b)))))),
      srcLine());
    side.dataset.n = a.n;
  }

  /* ---- flashcards in Static Study: on a click, into the deck "Periodic Table" ---- */
  const DECK = 'Periodic Table';
  async function addCards(list) {
    const els = list.filter(Boolean);
    if (!els.length) return;
    const FC = await import('../core/flashcards.js');
    if (dead) return;
    const data = FC.read();
    let deck = data.decks.find(d => d.name === DECK);
    if (!deck) {
      if (data.decks.length >= FC.MAX_DECKS) { say('Study has as many decks as it can hold', `Delete one in Study › Flashcards first (the most is ${FC.MAX_DECKS}).`, 'alert'); return; }
      deck = FC.normDeck({ name: DECK });
      data.decks.push(deck);
    }
    const have = new Set(deck.cards.map(c => c.front.trim().toLowerCase()));
    let added = 0, there = 0;
    for (const e of els) {
      const front = `${e.s}`;
      if (have.has(front.toLowerCase())) { there++; continue; }
      if (deck.cards.length >= FC.MAX_CARDS) break;
      const back = [`${e.name}, atomic number ${e.n}`, e.cat, e.mass !== undefined ? `atomic mass ${fmt(e.mass, 10)} u` : ''].filter(Boolean).join(' · ');
      deck.cards.push(FC.normCard({ front, back, tags: ['chemistry'] }));
      have.add(front.toLowerCase());
      added++;
    }
    const written = FC.write(data);
    const id = (written.decks.find(d => d.name === DECK) || deck).id;
    const study = api && api.getApp && api.getApp('study');
    say(added ? `${added === 1 ? `${els[0].name} added` : `${added} elements added`} to “${DECK}”` : `Already in “${DECK}”`,
      [`Each card is a symbol, with its name, number${els.some(e => e.mass !== undefined) ? ' and mass' : ''} from PubChem on the back.`, there ? `${there} ${there === 1 ? 'was' : 'were'} there already.` : ''].filter(Boolean).join(' '), 'layers',
      study ? [{ label: 'Study now', onClick: () => api.openApp('study', { tab: 'cards', deck: id, start: 'study' }) }, { label: 'Open deck', onClick: () => api.openApp('study', { tab: 'cards', deck: id }) }] : []);
    root.dataset.lastCards = JSON.stringify({ deck: id, added, there });
  }

  /* ---- the table as a picture, coloured as it is now ---- */
  async function savePicture() {
    if (!S.els.length) return;
    const CW = 54, CH = 58, G = 4, M = 24, TOP = 54;
    const W = M * 2 + 18 * CW + 17 * G, H = TOP + 10 * CH + 9 * G + 70;
    const cv = document.createElement('canvas');
    cv.width = W * 2; cv.height = H * 2;
    const x = cv.getContext('2d');
    x.scale(2, 2);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1d1a26'; x.font = '700 18px Inter, system-ui, sans-serif'; x.textBaseline = 'alphabetic';
    const byName = S.by === 'cat' ? 'category' : S.by === 'std' ? 'standard state' : propOf(S.by).label.toLowerCase();
    x.fillText(`Periodic Table, coloured by ${byName}`, M, 32);
    x.font = '12px Inter, system-ui, sans-serif'; x.fillStyle = '#5c5868';
    x.fillText(`Data: ${source ? source.source : 'PubChem'}${source && source.fetched ? `, fetched ${source.fetched}` : ''}`, M, 48);
    for (const e of S.els) {
      const [r, c] = place(e.n);
      const row = r > 7 ? r - 1.5 : r - 1;          /* the lanthanide and actinide rows, half a row below the rest */
      const cx = M + (c - 1) * (CW + G), cy = TOP + row * (CH + G);
      const col = colourOf(e);
      x.fillStyle = col.none ? '#eceaf1' : col.c;
      x.globalAlpha = col.none ? 1 : 0.55;
      x.fillRect(cx, cy, CW, CH);
      x.globalAlpha = 1;
      x.strokeStyle = col.none ? '#a9a6b3' : col.c; x.lineWidth = 1.2;
      if (col.none) x.setLineDash([3, 2]);
      x.strokeRect(cx + 0.5, cy + 0.5, CW - 1, CH - 1);
      x.setLineDash([]);
      x.fillStyle = '#1d1a26';
      x.font = '10px Inter, system-ui, sans-serif'; x.textAlign = 'left'; x.fillText(String(e.n), cx + 4, cy + 12);
      x.font = '700 18px Inter, system-ui, sans-serif'; x.textAlign = 'center'; x.fillText(e.s, cx + CW / 2, cy + 36);
      x.font = '8px Inter, system-ui, sans-serif'; x.fillText(e.name.length > 11 ? `${e.name.slice(0, 10)}…` : e.name, cx + CW / 2, cy + 50);
    }
    x.textAlign = 'left'; x.font = '12px Inter, system-ui, sans-serif'; x.fillStyle = '#5c5868';
    const ly = TOP + 10 * (CH + G) + 4;
    if (S.by === 'cat') {
      let lx = M;
      for (const [name] of CATS) { x.fillStyle = colour(name); x.fillRect(lx, ly, 10, 10); x.fillStyle = '#5c5868'; x.fillText(name, lx + 14, ly + 9); lx += x.measureText(name).width + 30; if (lx > W - 140) break; }
    } else if (S.by === 'std') {
      x.fillText('Standard state, as PubChem gives it. Grey, dashed: not in the data.', M, ly + 9);
    } else {
      const g = x.createLinearGradient(M, 0, M + 240, 0);
      [0, 0.25, 0.5, 0.75, 1].forEach(t => g.addColorStop(t, rampColour(t)));
      x.fillStyle = g; x.fillRect(M, ly, 240, 10);
      x.fillStyle = '#5c5868';
      const p = propOf(S.by);
      x.fillText(`${valueText({ [S.by]: S.rng.min, yr: String(S.rng.min) }, S.by)} to ${valueText({ [S.by]: S.rng.max, yr: String(S.rng.max) }, S.by)}${p.log ? ' (log scale)' : ''}.${S.by === 'yr' ? ' Brown: known since antiquity.' : ''} Grey, dashed: not in the data.`, M + 252, ly + 9);
    }
    try {
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      if (!blob) throw new Error('The picture could not be made.');
      const out = await media.save(`${vfs.HOME}/Pictures`, 'Periodic table.png', blob);
      if (dead) return;
      root.dataset.lastPicture = JSON.stringify({ path: out.path, w: cv.width, h: cv.height, by: S.by });
      say('Saved a picture', `${out.path.replace(vfs.HOME, '~')} · ${cv.width}×${cv.height}`, 'image');
    } catch (err) { say('Could not save the picture', String(err.message || err), 'alert'); }
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

  return () => { dead = true; offs.splice(0).forEach(f => f()); for (const v of [chem, trends, quiz]) if (v && v.teardown) v.teardown(); };
}
