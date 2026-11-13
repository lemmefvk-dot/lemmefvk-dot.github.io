/* ============================================================
   convert.js — Static Convert: a unit converter.

   Everything except Currency is fully offline and uses exact
   conversion factors (length, mass, area, volume, speed, time,
   data and angle scale linearly against a base unit; temperature
   is affine, so each unit carries a to-Kelvin / from-Kelvin pair).
   A conversion is therefore just  x · f(from) / f(to)  — computed
   in double precision, formatted to at most 10 significant digits.

   Both fields are live and reversible: type in either side and the
   other recomputes. A panel below lists the value in every unit of
   the category, and each row is a shortcut to that "to" unit.

   Currency is the one online category. Rates come from the free,
   key-less, CORS-open open.er-api.com/v6/latest/USD, fetched once
   and cached in the store with the API's own "as of" date. When the
   network is unavailable we fall back to the cached rates and say so,
   or show an honest error if we have never fetched any. A rate is
   never invented — only currencies the API returned are offered.

   House style mirrors calculator.js / lens.js: a header comment, a
   self-injected stylesheet guarded by a link id, defineApp() with a
   mount(ctx) that returns a teardown removing every listener,
   observer and in-flight request.
   ============================================================ */
import { defineApp } from '../core/registry.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-convert-css')) {
  const l = document.createElement('link');
  l.id = 'feat-convert-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-convert.css';
  document.head.appendChild(l);
}

const KEY = 'portal.convert';
const FX_URL = 'https://open.er-api.com/v6/latest/USD';

/* ---------- categories -----------------------------------------------
   Linear units: [symbol, name, factor-to-base].
   Temperature:  [symbol, name, toKelvin(x), fromKelvin(k)]. */
const lin = (name, icon, base, units) => ({ name, icon, kind: 'lin', base, units });

const CATS = {
  length: lin('Length', 'sliders', 'm', [
    ['km', 'Kilometre', 1000],
    ['m', 'Metre', 1],
    ['cm', 'Centimetre', 0.01],
    ['mm', 'Millimetre', 0.001],
    ['µm', 'Micrometre', 1e-6],
    ['nm', 'Nanometre', 1e-9],
    ['mi', 'Mile', 1609.344],
    ['yd', 'Yard', 0.9144],
    ['ft', 'Foot', 0.3048],
    ['in', 'Inch', 0.0254],
    ['nmi', 'Nautical mile', 1852],
  ]),
  mass: lin('Mass', 'package', 'kg', [
    ['t', 'Tonne (metric)', 1000],
    ['kg', 'Kilogram', 1],
    ['g', 'Gram', 0.001],
    ['mg', 'Milligram', 1e-6],
    ['µg', 'Microgram', 1e-9],
    ['lb', 'Pound', 0.45359237],
    ['oz', 'Ounce', 0.028349523125],
    ['st', 'Stone', 6.35029318],
    ['ton', 'Ton (US short)', 907.18474],
    ['ct', 'Carat', 0.0002],
    ['gr', 'Grain', 0.00006479891],
  ]),
  temperature: {
    name: 'Temperature', icon: 'thermometer', kind: 'temp', base: 'K',
    units: [
      ['°C', 'Celsius', c => c + 273.15, k => k - 273.15],
      ['°F', 'Fahrenheit', f => (f - 32) * 5 / 9 + 273.15, k => (k - 273.15) * 9 / 5 + 32],
      ['K', 'Kelvin', k => k, k => k],
      ['°R', 'Rankine', r => r * 5 / 9, k => k * 9 / 5],
    ],
  },
  area: lin('Area', 'grid', 'm²', [
    ['km²', 'Square kilometre', 1e6],
    ['ha', 'Hectare', 10000],
    ['m²', 'Square metre', 1],
    ['cm²', 'Square centimetre', 1e-4],
    ['mm²', 'Square millimetre', 1e-6],
    ['mi²', 'Square mile', 2589988.110336],
    ['ac', 'Acre', 4046.8564224],
    ['yd²', 'Square yard', 0.83612736],
    ['ft²', 'Square foot', 0.09290304],
    ['in²', 'Square inch', 0.00064516],
  ]),
  volume: lin('Volume', 'droplet', 'L', [
    ['m³', 'Cubic metre', 1000],
    ['L', 'Litre', 1],
    ['mL', 'Millilitre', 0.001],
    ['cm³', 'Cubic centimetre', 0.001],
    ['ft³', 'Cubic foot', 28.316846592],
    ['in³', 'Cubic inch', 0.016387064],
    ['gal', 'Gallon (US)', 3.785411784],
    ['qt', 'Quart (US)', 0.946352946],
    ['pt', 'Pint (US)', 0.473176473],
    ['cup', 'Cup (US)', 0.2365882365],
    ['fl oz', 'Fluid ounce (US)', 0.0295735295625],
    ['tbsp', 'Tablespoon (US)', 0.01478676478125],
    ['tsp', 'Teaspoon (US)', 0.00492892159375],
    ['gal-uk', 'Gallon (imperial)', 4.54609],
    ['pt-uk', 'Pint (imperial)', 0.56826125],
  ]),
  speed: lin('Speed', 'gauge', 'm/s', [
    ['m/s', 'Metre / second', 1],
    ['km/h', 'Kilometre / hour', 1000 / 3600],
    ['mph', 'Mile / hour', 1609.344 / 3600],
    ['ft/s', 'Foot / second', 0.3048],
    ['kn', 'Knot', 1852 / 3600],
  ]),
  time: lin('Time', 'clock', 's', [
    ['ns', 'Nanosecond', 1e-9],
    ['µs', 'Microsecond', 1e-6],
    ['ms', 'Millisecond', 0.001],
    ['s', 'Second', 1],
    ['min', 'Minute', 60],
    ['h', 'Hour', 3600],
    ['d', 'Day', 86400],
    ['wk', 'Week', 604800],
    ['yr', 'Year (365.25 d)', 31557600],
  ]),
  data: lin('Data', 'database', 'B', [
    ['bit', 'Bit', 0.125],
    ['B', 'Byte', 1],
    ['kB', 'Kilobyte (1000)', 1e3],
    ['MB', 'Megabyte (1000)', 1e6],
    ['GB', 'Gigabyte (1000)', 1e9],
    ['TB', 'Terabyte (1000)', 1e12],
    ['PB', 'Petabyte (1000)', 1e15],
    ['KiB', 'Kibibyte (1024)', 1024],
    ['MiB', 'Mebibyte (1024)', 1048576],
    ['GiB', 'Gibibyte (1024)', 1073741824],
    ['TiB', 'Tebibyte (1024)', 1099511627776],
    ['PiB', 'Pebibyte (1024)', 1125899906842624],
  ]),
  angle: lin('Angle', 'compass', '°', [
    ['°', 'Degree', 1],
    ['rad', 'Radian', 180 / Math.PI],
    ['grad', 'Gradian', 0.9],
    ['turn', 'Turn', 360],
    ['mrad', 'Milliradian', 180 / Math.PI / 1000],
    ['′', 'Arcminute', 1 / 60],
    ['″', 'Arcsecond', 1 / 3600],
  ]),
  currency: { name: 'Currency', icon: 'globe', kind: 'fx', base: 'USD', units: [] },
};

const CAT_ORDER = ['length', 'mass', 'temperature', 'area', 'volume', 'speed', 'time', 'data', 'angle', 'currency'];

/* Common currency names — shown when the API returns that code. Codes we do
   not have a name for still appear, labelled by their ISO code alone. */
const CCY = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', JPY: 'Japanese Yen', CNY: 'Chinese Yuan',
  CAD: 'Canadian Dollar', AUD: 'Australian Dollar', CHF: 'Swiss Franc', INR: 'Indian Rupee',
  MXN: 'Mexican Peso', BRL: 'Brazilian Real', KRW: 'South Korean Won', SGD: 'Singapore Dollar',
  HKD: 'Hong Kong Dollar', SEK: 'Swedish Krona', NOK: 'Norwegian Krone', NZD: 'New Zealand Dollar',
  ZAR: 'South African Rand', TRY: 'Turkish Lira', RUB: 'Russian Ruble', AED: 'UAE Dirham',
  SAR: 'Saudi Riyal', PLN: 'Polish Zloty', THB: 'Thai Baht', IDR: 'Indonesian Rupiah',
  DKK: 'Danish Krone', ILS: 'Israeli Shekel', PHP: 'Philippine Peso', CZK: 'Czech Koruna',
  CLP: 'Chilean Peso', COP: 'Colombian Peso', ARS: 'Argentine Peso', EGP: 'Egyptian Pound',
  MYR: 'Malaysian Ringgit', VND: 'Vietnamese Dong', NGN: 'Nigerian Naira', UAH: 'Ukrainian Hryvnia',
  HUF: 'Hungarian Forint', RON: 'Romanian Leu', BGN: 'Bulgarian Lev', PKR: 'Pakistani Rupee',
  BDT: 'Bangladeshi Taka', KES: 'Kenyan Shilling', MAD: 'Moroccan Dirham', QAR: 'Qatari Riyal',
  KWD: 'Kuwaiti Dinar', BHD: 'Bahraini Dinar', OMR: 'Omani Rial', ISK: 'Icelandic Krona',
  TWD: 'New Taiwan Dollar', LKR: 'Sri Lankan Rupee', VES: 'Venezuelan Bolívar',
};
const CCY_POPULAR = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'CHF', 'INR', 'MXN', 'BRL', 'SGD', 'HKD', 'ZAR', 'SEK'];

/* ---------- number helpers ------------------------------------------- */
function parseVal(s) {
  const t = String(s == null ? '' : s).trim().replace(/,/g, '').replace(/\s+/g, '');
  if (t === '' || t === '-' || t === '.' || t === '-.' || t === '+') return NaN;
  return Number(t);
}

/** thousands separators, leaving any decimal/exponent tail intact */
function group(s) {
  if (/[eE]/.test(s)) return s;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [int, dec] = body.split('.');
  const gi = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + gi + (dec !== undefined ? '.' + dec : '');
}

/** at most 10 significant digits; exponent only when it truly overflows */
function fmtOut(n) {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs < 1e-9 || abs >= 1e15) return n.toExponential(6).replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
  return group(String(Number(n.toPrecision(10))));
}

/** full-precision plain string for copy / the reverse field */
function fmtRaw(n) {
  if (!Number.isFinite(n)) return '';
  return String(Number(n.toPrecision(12)));
}

/* ---------- conversion ----------------------------------------------- */
function convert(cat, from, to, x) {
  if (!Number.isFinite(x)) return NaN;
  if (cat.kind === 'temp') return to.fromK(from.toK(x));
  if (cat.kind === 'fx') {
    if (!from.rate || !to.rate) return NaN;
    return x / from.rate * to.rate;      // rates are per 1 USD
  }
  return x * from.f / to.f;
}

/** normalised unit objects for a category (fx pulls live rates in) */
function unitsOf(cat, fx) {
  if (cat.kind === 'fx') {
    if (!fx || !fx.rates) return [];
    return Object.keys(fx.rates).sort().map(code => ({
      sym: code, name: CCY[code] || code, rate: fx.rates[code],
      label: CCY[code] ? `${code} — ${CCY[code]}` : code,
    }));
  }
  return cat.units.map(u => cat.kind === 'temp'
    ? { sym: u[0], name: u[1], toK: u[2], fromK: u[3], label: `${u[1]} (${u[0]})` }
    : { sym: u[0], name: u[1], f: u[2], label: `${u[1]} (${u[0]})` });
}

const DEFAULTS = {
  length: ['km', 'mi'], mass: ['kg', 'lb'], temperature: ['°C', '°F'],
  area: ['m²', 'ft²'], volume: ['L', 'gal'], speed: ['km/h', 'mph'],
  time: ['h', 'min'], data: ['GB', 'MiB'], angle: ['°', 'rad'], currency: ['USD', 'EUR'],
};

defineApp({
  id: 'convert',
  name: 'Static Convert',
  icon: 'refresh',
  g1: '#4fd1c5', g2: '#2f7fb0',
  category: 'Utilities',
  keywords: ['unit', 'units', 'convert', 'converter', 'measure', 'metric', 'imperial',
    'length', 'distance', 'mass', 'weight', 'temperature', 'celsius', 'fahrenheit', 'kelvin',
    'area', 'volume', 'litre', 'gallon', 'speed', 'time', 'data', 'bytes', 'angle',
    'currency', 'exchange rate', 'money', 'usd', 'eur'],
  desc: 'Convert length, mass, temperature, data, currency and more',
  singleton: true,
  win: { w: 600, h: 600, minW: 360, minH: 440 },

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, fmt } = api;

    const reduce = () => store.get('prefs.reduceMotion') ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* ------- persisted state ------- */
    const saved = store.get(KEY) || {};
    const S = {
      catId: CATS[saved.catId] ? saved.catId : 'length',
      pick: { ...(saved.pick || {}) },          /* catId -> [fromSym, toSym] */
      fromStr: typeof saved.fromStr === 'string' ? saved.fromStr : '1',
      fx: saved.fx && saved.fx.rates ? saved.fx : null,
      fxLoading: false,
      fxError: '',
      ac: null,
      dead: false,
    };
    const persist = () => {
      try { store.set(KEY, { catId: S.catId, pick: { ...S.pick }, fromStr: S.fromStr, fx: S.fx }); }
      catch (e) { /* private mode / quota — the app still runs */ }
    };

    /* ------- shell ------- */
    const sideEl = h('aside.app__side.cv__side', { role: 'tablist', 'aria-label': 'Categories' });
    const titleEl = h('div.cv__ttl');
    const statusEl = h('div.cv__status');
    const barEl = h('header.app__bar.cv__bar', titleEl, h('span.cv__spacer'), statusEl);
    const bodyEl = h('div.app__content.cv__body');
    const mainEl = h('div.app__main', barEl, bodyEl);
    const appEl = h('div.app.cv', sideEl, mainEl);
    root.appendChild(appEl);

    /* references rebuilt on every category render */
    let R = null;

    /* ------- category rail ------- */
    function paintSide() {
      clear(sideEl);
      const grp = h('div.side__group');
      for (const id of CAT_ORDER) {
        const c = CATS[id];
        const on = id === S.catId;
        grp.appendChild(h('button.side__item.cv__cat', {
          role: 'tab', 'aria-selected': on ? 'true' : 'false',
          class: on ? 'is-on' : '', onclick: () => setCat(id),
        }, icon(c.icon), h('span', { text: c.name })));
      }
      sideEl.appendChild(grp);
    }

    /* ------- helpers for current category ------- */
    const cat = () => CATS[S.catId];
    function unitList() { return unitsOf(cat(), S.fx); }
    function pickOf() {
      const list = unitList();
      if (!list.length) return null;
      const has = sym => list.find(u => u.sym === sym);
      let [fromSym, toSym] = S.pick[S.catId] || DEFAULTS[S.catId] || [];
      let from = has(fromSym) || has((DEFAULTS[S.catId] || [])[0]) || list[0];
      let to = has(toSym) || has((DEFAULTS[S.catId] || [])[1]) || list[Math.min(1, list.length - 1)];
      if (to === from && list.length > 1) to = list.find(u => u !== from) || to;
      S.pick[S.catId] = [from.sym, to.sym];
      return { from, to, list };
    }

    /* ------- category switch ------- */
    function setCat(id) {
      if (id === S.catId && R) return;
      S.catId = id;
      persist();
      renderCategory();
      if (id === 'currency' && !S.fx && !S.fxLoading) fetchFx(false);
    }

    /* ------- render the working area for the current category ------- */
    function renderCategory() {
      paintSide();
      titleEl.textContent = cat().name;
      clear(bodyEl);
      R = null;

      if (cat().kind === 'fx' && !S.fx) {
        paintStatus();
        bodyEl.appendChild(fxPlaceholder());
        return;
      }

      const p = pickOf();
      const fromSel = unitSelect(p.list, p.from.sym, sym => { S.pick[S.catId][0] = sym; persist(); recompute('from'); });
      const toSel = unitSelect(p.list, p.to.sym, sym => { S.pick[S.catId][1] = sym; persist(); recompute('to'); });

      const fromIn = h('input.cv__in', {
        type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
        'aria-label': 'Value to convert from', value: S.fromStr,
        oninput: () => { S.fromStr = fromIn.value; persist(); recompute('from'); },
      });
      const toIn = h('input.cv__in', {
        type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
        'aria-label': 'Converted value (editable)',
        oninput: () => { onReverse(toIn.value); },
      });

      const swap = h('button.cv__swap.tip', {
        type: 'button', 'data-tip': 'Swap units', 'aria-label': 'Swap the two units',
        onclick: doSwap,
      }, icon('repeat'));

      const io = h('div.cv__io',
        h('div.cv__row',
          h('label.cv__lab', { text: 'From' }),
          h('div.cv__group', fromIn, fromSel)),
        h('div.cv__mid', swap),
        h('div.cv__row',
          h('label.cv__lab', { text: 'To' }),
          h('div.cv__group', toIn, toSel)));

      const rateEl = h('div.cv__rate', { 'aria-live': 'polite' });
      const copyBtn = h('button.btn.btn--sm.cv__copy', { type: 'button', onclick: copyResult }, icon('copy'), h('span', { text: 'Copy result' }));
      const allEl = h('div.cv__all');

      bodyEl.append(io, h('div.cv__detail', rateEl, copyBtn),
        h('div.cv__alltitle', { text: 'In every unit' }), allEl);

      R = { fromSel, toSel, fromIn, toIn, rateEl, allEl, copyBtn };
      paintStatus();
      recompute('from');
      fitNarrow();
    }

    function unitSelect(list, value, onchange) {
      const sel = h('select.cv__unit', { 'aria-label': 'Unit', onchange: e => onchange(e.target.value) });
      for (const u of list) sel.appendChild(h('option', { value: u.sym, text: u.label }));
      sel.value = value;
      return sel;
    }

    /* ------- live computation ------- */
    function currentPick() {
      const list = unitList();
      const [fs, ts] = S.pick[S.catId] || [];
      const from = list.find(u => u.sym === fs) || list[0];
      const to = list.find(u => u.sym === ts) || list[Math.min(1, list.length - 1)];
      return { list, from, to };
    }

    /** side === 'from' means the From field is authoritative (default). */
    function recompute(side) {
      if (!R) return;
      const { list, from, to } = currentPick();
      const x = parseVal(S.fromStr);
      const result = convert(cat(), from, to, x);
      if (side !== 'to-typing') {
        R.toIn.value = Number.isFinite(result) ? fmtOut(result) : (S.fromStr.trim() ? '' : '');
      }
      paintRate(from, to, x, result);
      paintAll(list, from, x);
      R.copyBtn.toggleAttribute('disabled', !Number.isFinite(result));
    }

    /** the To field was edited: solve backwards for the From value. */
    function onReverse(str) {
      const { from, to } = currentPick();
      const y = parseVal(str);
      const back = convert(cat(), to, from, y);   // symmetric: convert to->from
      S.fromStr = Number.isFinite(back) ? fmtRaw(back) : '';
      if (R) R.fromIn.value = S.fromStr;
      persist();
      recompute('to-typing');
    }

    function paintRate(from, to, x, result) {
      if (!R) return;
      clear(R.rateEl);
      const c = cat();
      if (!from || !to) return;
      if (c.kind === 'temp') {
        R.rateEl.append(h('span.cv__rk', { text: '0 ' + from.sym + ' = ' }),
          h('b', { text: fmtOut(convert(c, from, to, 0)) + ' ' + to.sym }),
          h('span.cv__rdim', { text: '  ·  step of 1 ' + from.sym + ' = ' + fmtOut(convert(c, from, to, 1) - convert(c, from, to, 0)) + ' ' + to.sym }));
        return;
      }
      const one = convert(c, from, to, 1);
      R.rateEl.append(h('span.cv__rk', { text: '1 ' + from.sym + ' = ' }), h('b', { text: fmtOut(one) + ' ' + to.sym }));
      if (Number.isFinite(one) && one !== 0) {
        R.rateEl.append(h('span.cv__rdim', { text: '  ·  1 ' + to.sym + ' = ' + fmtOut(1 / one) + ' ' + from.sym }));
      }
    }

    function paintAll(list, from, x) {
      if (!R) return;
      clear(R.allEl);
      const c = cat();
      let rows = list;
      if (c.kind === 'fx') {
        const pop = CCY_POPULAR.filter(code => list.find(u => u.sym === code));
        const extra = [from.sym, (S.pick[S.catId] || [])[1]].filter(Boolean);
        const set = [...new Set([...pop, ...extra])];
        rows = set.map(code => list.find(u => u.sym === code)).filter(Boolean);
      }
      const toSym = (S.pick[S.catId] || [])[1];
      for (const u of rows) {
        const v = convert(c, from, u, x);
        const isTo = u.sym === toSym;
        R.allEl.appendChild(h('button.cv__arow', {
          type: 'button', class: isTo ? 'is-on' : '',
          'aria-label': `Set ${u.name} as the target unit`,
          onclick: () => { S.pick[S.catId][1] = u.sym; if (R) R.toSel.value = u.sym; persist(); recompute('from'); },
        },
          h('span.cv__aname', h('b', { text: u.sym }), h('small', { text: u.name })),
          h('span.cv__aval', { text: Number.isFinite(v) ? fmtOut(v) : '—' })));
      }
    }

    function doSwap() {
      const p = currentPick();
      if (!p.from || !p.to) return;
      const shownTo = R ? R.toIn.value : '';
      S.pick[S.catId] = [p.to.sym, p.from.sym];
      if (R) { R.fromSel.value = p.to.sym; R.toSel.value = p.from.sym; }
      /* carry the number across so the swap reads naturally */
      const carry = parseVal(shownTo);
      if (Number.isFinite(carry)) { S.fromStr = fmtRaw(carry); if (R) R.fromIn.value = S.fromStr; }
      persist();
      recompute('from');
      if (R && !reduce()) R.fromSel.closest('.cv__io')?.querySelector('.cv__swap')
        ?.animate?.([{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], { duration: 260, easing: 'ease-out' });
    }

    async function copyResult() {
      if (!R) return;
      const { from, to } = currentPick();
      const result = convert(cat(), from, to, parseVal(S.fromStr));
      if (!Number.isFinite(result)) return;
      const text = fmtRaw(result);
      try {
        await navigator.clipboard.writeText(text);
        api.notify({ app: 'Static Convert', icon: 'copy', title: 'Copied', message: `${text} ${to.sym}`, timeout: 2200 });
      } catch (e) {
        api.notify({ app: 'Static Convert', icon: 'alert', title: 'Could not copy', message: 'The clipboard is unavailable here.' });
      }
    }

    /* ------- currency status / fetch ------- */
    function asOf() {
      if (!S.fx) return '';
      const u = S.fx.updatedUnix ? new Date(S.fx.updatedUnix * 1000) : null;
      if (u && !isNaN(u)) return u.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      return S.fx.updatedUtc || '';
    }

    function paintStatus() {
      clear(statusEl);
      if (cat().kind !== 'fx') return;
      if (S.fxLoading) {
        statusEl.append(h('span.spinner'), h('span.cv__stx', { text: 'Fetching rates…' }));
        return;
      }
      if (S.fx) {
        statusEl.append(
          h('span.cv__stx', { text: 'Rates as of ' + asOf() }),
          h('button.ibtn.tip', { type: 'button', 'data-tip': 'Refresh rates', 'aria-label': 'Refresh rates', onclick: () => fetchFx(true) }, icon('refresh')));
        if (S.fxError) statusEl.append(h('span.cv__sterr', { text: '· ' + S.fxError }));
      } else {
        statusEl.append(h('button.btn.btn--sm', { type: 'button', onclick: () => fetchFx(true) }, icon('download'), h('span', { text: 'Get rates' })));
      }
    }

    function fxPlaceholder() {
      const wrap = h('div.cv__fxempty.empty');
      if (S.fxLoading) {
        wrap.append(h('span.spinner'), h('b', { text: 'Fetching exchange rates…' }),
          h('small', { text: 'From the free open.er-api.com service — no key, updated daily.' }));
      } else if (S.fxError) {
        wrap.append(icon('wifi-off'), h('b', { text: 'No rates yet' }),
          h('small', { text: S.fxError + ' Rates are never made up — connect once and they are cached for offline use.' }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => fetchFx(true) }, icon('refresh'), h('span', { text: 'Try again' })));
      } else {
        wrap.append(icon('globe'), h('b', { text: 'Live exchange rates' }),
          h('small', { text: 'Fetched once from the free open.er-api.com service and cached with its publish date. A rate is never invented.' }),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => fetchFx(true) }, icon('download'), h('span', { text: 'Get rates' })));
      }
      return wrap;
    }

    async function fetchFx(force) {
      if (S.fxLoading) return;
      if (S.fx && !force) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        S.fxError = 'You appear to be offline.';
        if (S.catId === 'currency') { if (S.fx) paintStatus(); else renderCategory(); }
        return;
      }
      S.fxLoading = true;
      S.fxError = '';
      if (S.catId === 'currency') { if (S.fx) paintStatus(); else renderCategory(); }
      const ac = new AbortController();
      S.ac = ac;
      const timer = setTimeout(() => ac.abort(), 12000);
      try {
        const res = await fetch(FX_URL, { signal: ac.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        if (j.result !== 'success' || !j.rates || !j.rates.USD) throw new Error(j['error-type'] || 'unexpected response');
        S.fx = {
          rates: j.rates, base: j.base_code || 'USD',
          updatedUnix: j.time_last_update_unix || 0, updatedUtc: j.time_last_update_utc || '',
          fetchedAt: Date.now(),
        };
        S.fxError = '';
        persist();
      } catch (err) {
        if (err.name === 'AbortError' && S.dead) return;
        S.fxError = (typeof navigator !== 'undefined' && navigator.onLine === false)
          ? 'You appear to be offline.'
          : (err.name === 'AbortError' ? 'The rate service timed out.' : 'Could not reach the rate service (' + err.message + ').');
      } finally {
        clearTimeout(timer);
        if (S.ac === ac) S.ac = null;
        if (!S.dead) {
          S.fxLoading = false;
          if (S.catId === 'currency') renderCategory();
        }
      }
    }

    /* ------- responsive: rail on top when the window is narrow ------- */
    function fitNarrow() {
      const narrow = appEl.clientWidth > 0 && appEl.clientWidth < 480;
      appEl.classList.toggle('is-narrow', narrow);
    }
    let ro = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => fitNarrow());
      ro.observe(appEl);
    }

    /* ------- toolbar ------- */
    win.setTools(
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'Copy result', 'aria-label': 'Copy result', onclick: copyResult }, icon('copy')),
    );

    /* ------- open at a given conversion -------
       opts { cat, from, to, value } — Spotlight's "Open in Static Convert"
       passes the conversion it just answered. Units are checked against
       this app's own list; anything it doesn't have is ignored. */
    function applyOpts(o) {
      if (!o || typeof o !== 'object' || !CATS[o.cat] || CATS[o.cat].kind === 'fx') return false;
      const list = unitsOf(CATS[o.cat], S.fx);
      if (!list.some(u => u.sym === o.from) || !list.some(u => u.sym === o.to)) return false;
      S.catId = o.cat;
      S.pick[o.cat] = [o.from, o.to];
      if (o.value !== undefined && o.value !== null && Number.isFinite(Number(o.value))) S.fromStr = String(o.value);
      persist();
      return true;
    }
    applyOpts(ctx.opts);
    win.onReopen(o => { if (!S.dead && applyOpts(o)) renderCategory(); });

    /* ------- boot ------- */
    renderCategory();
    if (S.catId === 'currency' && !S.fx && !S.fxLoading) fetchFx(false);
    fitNarrow();
    setTimeout(() => { if (!S.dead && R) R.fromIn.focus(); }, 60);

    /* ------- teardown ------- */
    return () => {
      S.dead = true;
      try { S.ac?.abort(); } catch (e) { /* already settled */ }
      try { ro?.disconnect(); } catch (e) { /* never observed */ }
      ro = null;
      R = null;
    };
  },
});
