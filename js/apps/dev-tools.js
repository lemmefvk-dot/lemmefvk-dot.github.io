/* ============================================================
   dev-tools.js - Dev Tools: a regex tester, a JSON viewer and a
   password generator, in one small window.

   Why one app: all three are the same kind of tool (paste or type,
   see the answer at once, copy it out), none had a home, and no existing
   app is the natural one - Code edits web projects, Static Developer
   inspects StaticOS itself, Static Color already has its own picker.

   REGEX  The pattern runs in a Worker (dev-tools-regex-worker.js) with a
   time limit. If it does not answer in time the worker is terminated and
   the window says so - a pattern like (a+)+$ cannot freeze the page.
   Matches are drawn as text nodes and <mark> elements, never as HTML.

   JSON   dev-tools-json.js parses, locates errors (line and column),
   re-indents the source text without touching a token, and lists only
   the rows that are open; this file draws just the rows in view, so a
   file of several megabytes costs about what is on screen. `.json` files
   open here from Files (defineApp `exts`). Keys and values are text.

   PASSWORDS  dev-tools-pw.js. crypto.getRandomValues with rejection
   sampling. The generated text lives in this window's memory only: it is
   never written to the store, the file system, the console or a
   notification, and nothing is requested from the network. Copy uses
   clipboard.writeUnrecorded - the browser's own writeText, not the wrapper
   that records every other copy in Static Clipboard's history (core/
   clipboard.js wraps navigator.clipboard.writeText). The text also sits
   in [data-clip-ignore], so selecting it and pressing copy is skipped. The system clipboard itself keeps
   it until something else is copied - the window says so.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import media from '../core/media.js';
import { writeUnrecorded } from '../core/clipboard.js';
import { TEXT_MAX } from '../core/fileimport.js';
import * as J from './dev-tools-json.js';
import * as P from './dev-tools-pw.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-dev-tools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-dev-tools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-dev-tools.css';
  document.head.appendChild(l);
}

const KEY = 'portal.dev-tools';
const RX_LIMIT_MS = 1500;
const RX_FLAGS = [['g', 'Find all matches'], ['i', 'Ignore case'], ['m', 'Multiline: ^ and $ match at each line'], ['s', 'Dot matches line breaks'], ['u', 'Unicode'], ['y', 'Sticky: match only at the last position']];
const ROW_H = 24;
const PW_DEFAULTS = { mode: 'random', length: 20, lower: true, upper: true, digits: true, symbols: true, noLookalikes: false, words: 5, separator: 'hyphen', capitalise: false, number: false };

const bitsText = b => `${b >= 100 ? Math.round(b) : (Math.round(b * 10) / 10)} bits`;
const sizeText = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

defineApp({
  id: 'dev-tools',
  name: 'Dev Tools',
  icon: 'wrench',
  g1: '#7fe0c0', g2: '#1d6b73',
  category: 'Utilities',
  keywords: ['regex', 'regular expression', 'pattern', 'match', 'json', 'viewer', 'format', 'minify', 'prettify', 'password', 'passphrase', 'generator', 'random', 'entropy', 'developer', 'tools'],
  desc: 'Test regular expressions, explore JSON files and make strong passwords - all on this device',
  singleton: true,
  exts: ['json'],
  win: { w: 900, h: 640, minW: 420, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, store, vfs } = api;
    const timers = new Set();
    const cleanups = [];
    let dead = false;
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); return t; };
    const listen = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); cleanups.push(() => el.removeEventListener(ev, fn, o)); };

    const saved = (store.get(KEY) && typeof store.get(KEY) === 'object') ? store.get(KEY) : {};
    const S = {
      tab: ['regex', 'json', 'pw'].includes(saved.tab) ? saved.tab : 'regex',
      pattern: typeof saved.pattern === 'string' ? saved.pattern.slice(0, 500) : '(\\w+)@(\\w+)\\.com',
      flags: typeof saved.flags === 'string' ? saved.flags.replace(/[^gimsuy]/g, '') : 'g',
      pw: { ...PW_DEFAULTS, ...(saved.pw && typeof saved.pw === 'object' ? saved.pw : {}) },
    };
    /* only settings are kept - never the generated text, the test text or any JSON */
    function persist() {
      store.set(KEY, { tab: S.tab, pattern: S.pattern, flags: S.flags, pw: { ...S.pw } });
    }
    let persistT = 0;
    const schedulePersist = () => { clearTimeout(persistT); persistT = later(persist, 300); };

    const btn = (label, ic, onclick, extra = {}) => h('button.btn.btn--sm', { type: 'button', onclick, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));

    /* ====================================================================
       REGEX
       ==================================================================== */
    const rx = (() => {
      const pat = h('input.dt__in.mono', { type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Pattern', placeholder: 'e.g. (\\d+)-(\\d+)', value: S.pattern });
      const flagBoxes = RX_FLAGS.map(([f, tip]) => {
        const cb = h('input', { type: 'checkbox', checked: S.flags.includes(f), 'aria-label': tip, dataset: { flag: f } });
        return h('label.dt__flag.tip', { 'data-tip': tip }, cb, h('span.mono', { text: f }));
      });
      const text = h('textarea.dt__ta.mono', { spellcheck: 'false', 'aria-label': 'Test text', placeholder: 'Paste or type the text to test against', rows: 5 });
      text.value = 'Mail ada@lovelace.com or alan@turing.com\nNo match on this line.';
      const status = h('div.dt__status', { role: 'status', 'aria-live': 'polite' });
      const hl = h('div.dt__hl.mono', { 'aria-label': 'Test text with matches highlighted', role: 'region' });
      const list = h('ol.dt__matches', { 'aria-label': 'Matches' });
      let worker = null, pending = null, seq = 0, debounce = 0;

      const flags = () => flagBoxes.map(l => l.firstChild).filter(c => c.checked).map(c => c.dataset.flag).join('');
      const killWorker = () => { if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } worker = null; } };
      function say(msg, cls = '') { status.textContent = msg; status.className = 'dt__status' + (cls ? ' is-' + cls : ''); }

      function paintText(plain) { hl.replaceChildren(document.createTextNode(plain)); list.replaceChildren(); }

      function render(res, source) {
        const t = text.value;
        const ms = res.matches;
        const parts = [];
        let at = 0;
        for (const m of ms) {
          if (m.length === 0 || m.index < at) continue;
          if (m.index > at) parts.push(document.createTextNode(t.slice(at, m.index)));
          parts.push(h('mark.dt__mark', { text: t.slice(m.index, m.index + m.length) }));
          at = m.index + m.length;
        }
        parts.push(document.createTextNode(t.slice(at)));
        hl.replaceChildren(...parts);
        list.replaceChildren(...ms.map((m, i) => {
          const groups = [];
          m.groups.forEach((g, gi) => groups.push(h('li', h('span.dt__gk', { text: `Group ${gi + 1}` }), g === null ? h('span.dt__gnone', { text: 'did not take part' }) : h('code.dt__gv', { text: g }))));
          if (m.named) for (const [k, v] of Object.entries(m.named)) groups.push(h('li', h('span.dt__gk', { text: k }), v === null ? h('span.dt__gnone', { text: 'did not take part' }) : h('code.dt__gv', { text: v })));
          return h('li.dt__match',
            h('div.dt__mhead', h('span.dt__mn', { text: `Match ${i + 1}` }), h('span.dt__mpos', { text: m.length ? `at ${m.index}-${m.index + m.length}` : `empty, at ${m.index}` }),
              h('code.dt__mv', { text: m.text })),
            groups.length ? h('ul.dt__groups', groups) : null);
        }));
        const n = ms.length;
        say(n === 0 ? 'No matches.' : `${n}${res.more ? '+' : ''} match${n === 1 ? '' : 'es'}${res.more ? ` (showing the first ${n})` : ''}.`, n ? 'ok' : '');
      }

      function run() {
        clearTimeout(debounce);
        S.pattern = pat.value; S.flags = flags(); schedulePersist();
        if (!pat.value) { paintText(text.value); say('Type a pattern to see its matches.'); return; }
        /* a run still going means the last pattern is slow: abandon its worker */
        if (pending) { clearTimeout(pending.timer); pending = null; killWorker(); }
        if (typeof Worker === 'undefined') { paintText(text.value); say('Matching runs in a background worker, which this browser does not offer.', 'bad'); return; }
        const id = ++seq;
        try {
          if (!worker) {
            worker = new Worker(new URL('./dev-tools-regex-worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = onMsg;
            worker.onerror = () => { if (pending) { clearTimeout(pending.timer); pending = null; } killWorker(); say('The matcher could not start.', 'bad'); };
          }
        } catch (err) { say('The matcher could not start: ' + (err.message || err), 'bad'); return; }
        say('Matching...');
        pending = {
          id,
          timer: setTimeout(() => {
            if (!pending || pending.id !== id) return;
            pending = null; killWorker();
            paintText(text.value);
            say(`Timed out after ${RX_LIMIT_MS / 1000} seconds. This pattern backtracks too much on this text (nested repeats like (a+)+ are the usual cause), so matching was stopped.`, 'bad');
          }, RX_LIMIT_MS),
        };
        worker.postMessage({ id, source: pat.value, flags: flags(), text: text.value, max: 1000 });
      }
      function onMsg(e) {
        const d = e.data;
        if (dead || !pending || d.id !== pending.id) return;
        clearTimeout(pending.timer); pending = null;
        if (!d.ok) { paintText(text.value); say(d.error, 'bad'); return; }
        render(d, pat.value);
      }
      const soon = () => { clearTimeout(debounce); debounce = later(run, 120); };
      listen(pat, 'input', soon);
      listen(text, 'input', soon);
      flagBoxes.forEach(l => listen(l.firstChild, 'change', run));
      cleanups.push(() => { clearTimeout(debounce); if (pending) clearTimeout(pending.timer); pending = null; killWorker(); });

      const el = h('div.dt__panel',
        h('label.dt__lab', { for: 'dt-rx-pat', text: 'Pattern' }),
        h('div.dt__patrow', h('span.dt__slash.mono', { text: '/' }), (pat.id = 'dt-rx-pat', pat), h('span.dt__slash.mono', { text: '/' }), h('div.dt__flags', { role: 'group', 'aria-label': 'Flags' }, flagBoxes)),
        h('label.dt__lab', { for: 'dt-rx-text', text: 'Test text' }),
        (text.id = 'dt-rx-text', text),
        status,
        h('div.dt__split',
          h('div.dt__col', h('div.dt__lab', { text: 'Highlighted' }), hl),
          h('div.dt__col', h('div.dt__lab', { text: 'Matches and groups' }), list)));
      return { el, run, focus: () => pat.focus() };
    })();

    /* ====================================================================
       JSON
       ==================================================================== */
    const js = (() => {
      const M = { text: '', value: undefined, ok: false, err: null, name: '', path: '', dirty: false, view: 'tree', parseMs: 0, bytes: 0 };
      let expanded = new Set(['']);
      let R = [];
      let sel = '';            /* id of the selected row */
      let hits = [], hitAt = -1, hitSet = new Set(), taStale = false, parseT = 0, searchT = 0;

      const fileIn = h('input.dt__native', { type: 'file', accept: '.json,.geojson,.jsonc,.txt,application/json,text/plain', 'aria-label': 'Open a JSON file', tabindex: '-1' });
      const indentSel = h('select.dt__sel', { 'aria-label': 'Indent' },
        h('option', { value: '2', text: '2 spaces' }), h('option', { value: '4', text: '4 spaces' }), h('option', { value: 'tab', text: 'Tab' }));
      const say = h('div.dt__jstatus', { role: 'status', 'aria-live': 'polite' });
      const errBar = h('div.dt__err', { role: 'alert', hidden: true });
      const fileName = h('span.dt__fname', { text: 'No file open' });
      const info = h('span.dt__finfo');

      /* ---- the tree ---- */
      const spacer = h('div.dt__spacer');
      const rowsEl = h('div.dt__rows');
      const tree = h('div.dt__tree', { tabindex: '0', role: 'tree', 'aria-label': 'JSON tree' }, spacer, rowsEl);
      const empty = h('div.dt__empty', { text: 'Open a JSON file, or switch to Text and paste some.' });
      const detailPath = h('code.dt__dpath', { text: '' });
      const detailVal = h('span.dt__dval');
      const copyPathBtn = btn('Copy path', 'copy', () => { const r = selRow(); if (r) copy(J.pathOf(r), 'path'); }, { disabled: true });
      const copyValBtn = btn('Copy value', 'copy', () => { const r = selRow(); if (r) copy(J.isBranch(r.value) ? JSON.stringify(r.value, null, 2) : (typeof r.value === 'string' ? r.value : String(r.value)), 'value'); }, { disabled: true });
      const detail = h('div.dt__detail', h('span.dt__dlab', { text: 'Selected' }), detailPath, detailVal, h('span.dt__grow'), copyPathBtn, copyValBtn);

      const selRow = () => R.find(r => r.id === sel) || null;

      function rowEl(r, idx) {
        const branch = J.isBranch(r.value);
        const key = r.key === null ? null : h('span.dt__k' + (typeof r.key === 'number' ? '.is-idx' : ''), { text: String(r.key) });
        let val;
        if (branch) val = h('span.dt__v.is-sum', { text: Array.isArray(r.value) ? `[${r.count} ${r.count === 1 ? 'item' : 'items'}]` : `{${r.count} ${r.count === 1 ? 'key' : 'keys'}}` });
        else {
          const s = r.type === 'string' ? JSON.stringify(r.value) : String(r.value);
          val = h('span.dt__v.is-' + r.type, { text: s.length > 300 ? s.slice(0, 300) + '...' : s });
        }
        const tw = branch ? h('span.dt__tw', { 'aria-hidden': 'true', dataset: { tw: '1' } }, icon(r.open ? 'chevron-down' : 'chevron-right')) : h('span.dt__tw.is-leaf', { 'aria-hidden': 'true' });
        return h('div.dt__row' + (r.id === sel ? '.is-sel' : '') + (hitSet.has(r.id) ? '.is-hit' : ''), {
          role: 'treeitem', id: 'dtr-' + idx, 'aria-level': String(r.depth + 1), 'aria-selected': r.id === sel ? 'true' : 'false',
          'aria-expanded': branch ? String(r.open) : null,
          style: { paddingLeft: `${8 + r.depth * 16}px`, height: ROW_H + 'px' },
          dataset: { i: String(idx) },
        }, tw, key, key ? h('span.dt__c', { text: ':' }) : null, val);
      }

      function paint() {
        const top = tree.scrollTop, hgt = tree.clientHeight || 400;
        const a = Math.max(0, Math.floor(top / ROW_H) - 6), b = Math.min(R.length, Math.ceil((top + hgt) / ROW_H) + 6);
        rowsEl.style.transform = `translateY(${a * ROW_H}px)`;
        const kids = [];
        for (let i = a; i < b; i++) kids.push(rowEl(R[i], i));
        rowsEl.replaceChildren(...kids);
        const at = R.findIndex(r => r.id === sel);
        if (at >= a && at < b) tree.setAttribute('aria-activedescendant', 'dtr-' + at); else tree.removeAttribute('aria-activedescendant');
      }
      function refresh() {
        R = M.ok ? J.rows(M.value, expanded) : [];
        spacer.style.height = R.length * ROW_H + 'px';
        paint();
        const r = selRow();
        detailPath.textContent = r ? J.pathOf(r) : '';
        detailVal.textContent = r ? (J.isBranch(r.value) ? (Array.isArray(r.value) ? `array, ${r.count} items` : `object, ${r.count} keys`) : `${r.type}${r.type === 'string' ? `, ${r.value.length} characters` : ''}`) : '';
        copyPathBtn.disabled = copyValBtn.disabled = !r;
        empty.hidden = M.ok;
        tree.hidden = !M.ok || M.view !== 'tree';
        detail.hidden = tree.hidden;
      }
      listen(tree, 'scroll', () => requestAnimationFrame(() => { if (!dead) paint(); }));
      cleanups.push(() => { /* nothing outstanding: scroll paints are one frame */ });

      function select(id, scroll) {
        sel = id;
        const at = R.findIndex(r => r.id === id);
        if (scroll && at >= 0) {
          const y = at * ROW_H;
          if (y < tree.scrollTop) tree.scrollTop = y;
          else if (y + ROW_H > tree.scrollTop + tree.clientHeight) tree.scrollTop = y + ROW_H - tree.clientHeight;
        }
        refresh();
      }
      function toggle(id, open) {
        const r = R.find(x => x.id === id);
        if (!r || !J.isBranch(r.value)) return;
        const want = open === undefined ? !expanded.has(id) : open;
        if (want) expanded.add(id); else expanded.delete(id);
        refresh();
      }
      listen(tree, 'click', e => {
        const row = e.target.closest('.dt__row');
        if (!row) return;
        const r = R[+row.dataset.i];
        if (!r) return;
        if (e.target.closest('[data-tw]')) { sel = r.id; toggle(r.id); } else select(r.id);
        tree.focus({ preventScroll: true });
      });
      listen(tree, 'dblclick', e => { const row = e.target.closest('.dt__row'); const r = row && R[+row.dataset.i]; if (r) toggle(r.id); });
      listen(tree, 'keydown', e => {
        if (!R.length) return;
        let at = R.findIndex(r => r.id === sel);
        const r = R[at];
        const go = i => { e.preventDefault(); select(R[Math.max(0, Math.min(R.length - 1, i))].id, true); };
        if (e.key === 'ArrowDown') go(at < 0 ? 0 : at + 1);
        else if (e.key === 'ArrowUp') go(at < 0 ? 0 : at - 1);
        else if (e.key === 'Home') go(0);
        else if (e.key === 'End') go(R.length - 1);
        else if (e.key === 'PageDown') go(at + Math.floor(tree.clientHeight / ROW_H));
        else if (e.key === 'PageUp') go(at - Math.floor(tree.clientHeight / ROW_H));
        else if (e.key === 'ArrowRight' && r) { e.preventDefault(); if (J.isBranch(r.value) && !r.open) toggle(r.id, true); else go(at + 1); }
        else if (e.key === 'ArrowLeft' && r) { e.preventDefault(); if (r.open) toggle(r.id, false); else if (r.parent) select(r.parent.id, true); }
        else if ((e.key === 'Enter' || e.key === ' ') && r) { e.preventDefault(); toggle(r.id); }
      });

      /* ---- loading ---- */
      function setText(t, fromTextarea) {
        M.text = t;
        if (!fromTextarea) { if (M.view === 'text') ta.value = t; else taStale = true; }
      }
      function load(text, { name = '', path = '' } = {}) {
        M.name = name; M.path = path; M.dirty = false;
        setText(text);
        parse(true);
        fileName.textContent = name || 'Pasted text';
        if (!M.ok) setView('text'); else setView('tree');
      }
      function parse(fresh) {
        clearTimeout(parseT);
        const t0 = performance.now();
        const r = J.parseJson(M.text);
        M.parseMs = Math.round(performance.now() - t0);
        M.bytes = new Blob([M.text]).size;
        M.ok = r.ok;
        if (r.ok) {
          M.value = r.value; M.err = null;
          if (fresh) { expanded = new Set(['']); sel = ''; hits = []; hitAt = -1; hitSet = new Set(); tree.scrollTop = 0; findCount.textContent = ''; }
          else { /* keep what was open where it still exists */ }
        } else { M.value = undefined; M.err = r.error; }
        errBar.hidden = r.ok;
        if (!r.ok) {
          errBar.replaceChildren(
            h('strong', { text: `Line ${r.error.line}, column ${r.error.col}: ` }),
            h('span', { text: r.error.message }),
            btn('Go to error', 'arrow-down', gotoError));
        }
        info.textContent = r.ok ? `${sizeText(M.bytes)} · read in ${M.parseMs} ms` : `${sizeText(M.bytes)} · not valid JSON`;
        refresh();
        updateBtns();
        if (r.ok) say.textContent = '';
      }
      function gotoError() {
        if (!M.err) return;
        setView('text');
        ta.focus();
        const p = Math.min(M.err.pos, ta.value.length);
        ta.setSelectionRange(p, Math.min(p + 1, ta.value.length));
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
        ta.scrollTop = Math.max(0, (M.err.line - 3) * lh);
      }

      /* ---- the text view ---- */
      const ta = h('textarea.dt__ta.dt__src.mono', { spellcheck: 'false', 'aria-label': 'JSON text', placeholder: 'Paste JSON here', hidden: true, wrap: 'off' });
      listen(ta, 'input', () => {
        setText(ta.value, true);
        M.dirty = true;
        clearTimeout(parseT);
        parseT = later(() => parse(true), ta.value.length > 500000 ? 600 : 250);
      });
      function setView(v) {
        M.view = v;
        if (v === 'text' && (taStale || ta.value !== M.text)) { ta.value = M.text; taStale = false; }
        ta.hidden = v !== 'text';
        viewBtns.tree.classList.toggle('is-on', v === 'tree');
        viewBtns.text.classList.toggle('is-on', v === 'text');
        viewBtns.tree.setAttribute('aria-selected', String(v === 'tree'));
        viewBtns.text.setAttribute('aria-selected', String(v === 'text'));
        refresh();
        updateBtns();
      }
      const viewBtns = {
        tree: h('button', { type: 'button', role: 'tab', onclick: () => setView('tree'), text: 'Tree' }),
        text: h('button', { type: 'button', role: 'tab', onclick: () => setView('text'), text: 'Text' }),
      };

      /* ---- search ---- */
      const findIn = h('input.dt__in', { type: 'search', 'aria-label': 'Search keys and values', placeholder: 'Search keys and values', spellcheck: 'false' });
      const findCount = h('span.dt__fcount', { role: 'status', 'aria-live': 'polite' });
      function search() {
        clearTimeout(searchT);
        if (!M.ok || !findIn.value) { hits = []; hitAt = -1; hitSet = new Set(); findCount.textContent = ''; refresh(); return; }
        const r = J.find(M.value, findIn.value, 500);
        hits = r.hits; hitSet = new Set(hits.map(x => J.idOf(x.keys)));
        findCount.textContent = hits.length ? `${hits.length}${r.capped ? '+' : ''} found` : 'Nothing found';
        hitAt = -1;
        if (hits.length) step(1); else refresh();
        if (M.view !== 'tree') setView('tree');
      }
      function step(dir) {
        if (!hits.length) return;
        hitAt = (hitAt + dir + hits.length) % hits.length;
        const keys = hits[hitAt].keys;
        expanded.add('');
        for (let k = 1; k < keys.length; k++) expanded.add(J.idOf(keys.slice(0, k)));
        R = J.rows(M.value, expanded);
        sel = J.idOf(keys);
        spacer.style.height = R.length * ROW_H + 'px';
        select(sel, true);
        findCount.textContent = `${hitAt + 1} of ${hits.length}${hits.length >= 500 ? '+' : ''}`;
      }
      listen(findIn, 'input', () => { clearTimeout(searchT); searchT = later(search, 200); });
      listen(findIn, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (hits.length && findIn.dataset.last === findIn.value) step(e.shiftKey ? -1 : 1); else { findIn.dataset.last = findIn.value; search(); } } });

      /* ---- actions ---- */
      async function copy(text, what) {
        try { await navigator.clipboard.writeText(text); say.textContent = `Copied the ${what}.`; } catch (err) { say.textContent = 'The browser blocked copying here.'; }
      }
      const indentArg = () => (indentSel.value === 'tab' ? '\t' : +indentSel.value);
      function format(indent) {
        if (!M.ok) { gotoError(); return; }
        setText(J.reformat(M.text, indent));
        M.dirty = true;
        parseSoon();
        say.textContent = indent === 0 ? 'Minified.' : 'Formatted.';
      }
      function parseSoon() { /* same data, new spacing: re-read so the size is right, keep what is open */ parse(false); }
      async function openPath(p) {
        const n = vfs.node(p);
        if (!n || n.type !== 'file') { say.textContent = 'That file is no longer there.'; return; }
        let text;
        if (media.isMedia(n)) {
          const blob = await media.blobOf(n).catch(() => null);
          if (!blob) { say.textContent = `${n.name} has no content in this browser, so it can't be opened.`; return; }
          text = await blob.text();
        } else text = String(n.content || '');
        if (dead) return;
        load(text, { name: n.name, path: vfs.norm(p) });
      }
      listen(fileIn, 'change', async () => {
        const f = fileIn.files && fileIn.files[0];
        if (!f) return;
        try { const text = await f.text(); if (!dead) load(text, { name: f.name }); } catch (err) { say.textContent = 'Could not read that file.'; }
        fileIn.value = '';
      });
      async function save() {
        if (!M.ok) { say.textContent = 'Fix the error first, so a broken file is not saved.'; gotoError(); return; }
        try {
          const text = M.text;
          let dest = M.path;
          const node = dest && vfs.node(dest);
          if (node && node.type === 'file') {
            if (media.isMedia(node) || text.length > TEXT_MAX) await media.replace(dest, new Blob([text], { type: 'application/json' }));
            else vfs.write(dest, text);
          } else {
            const dir = `${vfs.HOME}/Documents`;
            const name = (M.name || 'data.json').replace(/\.(json|geojson|jsonc|txt)$/i, '') + '.json';
            if (text.length > TEXT_MAX) dest = (await media.save(dir, name, new Blob([text], { type: 'application/json' }))).path;
            else {
              let nm = name, k = 1;
              while (vfs.node(`${dir}/${nm}`)) nm = name.replace(/\.json$/, '') + ` ${++k}.json`;
              dest = `${dir}/${nm}`; vfs.write(dest, text);
            }
            M.path = dest;
          }
          M.dirty = false;
          fileName.textContent = vfs.baseName(dest);
          updateBtns();
          say.textContent = `Saved to ${dest}.`;
        } catch (err) { say.textContent = 'Could not save: ' + (err.message || err); }
      }
      function download() {
        const u = URL.createObjectURL(new Blob([M.text], { type: 'application/json' }));
        const a = h('a', { href: u, download: (M.name || 'data.json').replace(/(\.json)?$/i, '.json') });
        document.body.appendChild(a); a.click(); a.remove();
        later(() => URL.revokeObjectURL(u), 4000);
      }
      function expandAll() {
        if (!M.ok) return;
        const ids = new Set(['']);
        let n = 0;
        const stack = [[M.value, '']];
        while (stack.length && n < 50000) {
          const [v, id] = stack.pop();
          if (!J.isBranch(v)) continue;
          ids.add(id); n++;
          if (Array.isArray(v)) v.forEach((c, i) => { if (J.isBranch(c)) stack.push([c, id + '/' + i]); });
          else for (const k of Object.keys(v)) if (J.isBranch(v[k])) stack.push([v[k], J.idOf([...idKeys(id), k])]);
        }
        expanded = ids;
        say.textContent = n >= 50000 ? 'Opened the first 50,000 containers; open the rest by hand.' : '';
        refresh();
      }
      const idKeys = id => id.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
      function collapseAll() { expanded = new Set(['']); sel = ''; tree.scrollTop = 0; refresh(); }

      const bFormat = btn('Format', 'list', () => format(indentArg()));
      const bMin = btn('Minify', 'minimize', () => format(0));
      const bCopy = btn('Copy text', 'copy', () => copy(M.text, 'text'));
      const bSave = btn('Save', 'save', save);
      const bDl = btn('Download', 'download', download);
      const bExp = btn('Expand all', 'chevron-down', expandAll);
      const bCol = btn('Collapse all', 'chevron-right', collapseAll);
      function updateBtns() {
        const have = !!M.text;
        for (const b of [bFormat, bMin]) b.disabled = !M.ok;
        bCopy.disabled = bSave.disabled = bDl.disabled = !have;
        bExp.disabled = bCol.disabled = !M.ok || M.view !== 'tree';
        findIn.disabled = !M.ok;
        fileName.classList.toggle('is-dirty', M.dirty);
        fileName.title = M.path || '';
      }

      const el = h('div.dt__panel.dt__panel--json',
        h('div.dt__bar',
          btn('Open file', 'folder-open', () => fileIn.click()), fileIn,
          h('div.dt__seg', { role: 'tablist', 'aria-label': 'View' }, viewBtns.tree, viewBtns.text),
          indentSel, bFormat, bMin, bCopy, bSave, bDl),
        h('div.dt__bar.dt__bar--sub', fileName, info, h('span.dt__grow'), bExp, bCol),
        errBar,
        h('div.dt__bar.dt__bar--sub', h('label.dt__findwrap', icon('search'), findIn),
          h('button.ibtn', { type: 'button', 'aria-label': 'Previous match', onclick: () => step(-1) }, icon('arrow-up')),
          h('button.ibtn', { type: 'button', 'aria-label': 'Next match', onclick: () => step(1) }, icon('arrow-down')),
          findCount, h('span.dt__grow'), say),
        h('div.dt__body', tree, empty, ta),
        detail);

      setView('tree');
      refresh(); updateBtns();
      cleanups.push(() => { clearTimeout(parseT); clearTimeout(searchT); M.value = undefined; M.text = ''; R = []; });
      return { el, load, openPath, M };
    })();

    /* ====================================================================
       PASSWORDS
       ==================================================================== */
    const pw = (() => {
      let secret = '';           /* the only copy, in this closure */
      let shown = true, words = null, bits = 0, gen = 0;
      const out = h('div.dt__pwtext.mono', { 'data-clip-ignore': '', tabindex: '0', role: 'textbox', 'aria-readonly': 'true', 'aria-label': 'Generated password', spellcheck: 'false' });
      const meta = h('div.dt__pwmeta', { role: 'status', 'aria-live': 'polite' });
      const note = h('div.dt__pwnote');
      const msg = h('div.dt__status', { role: 'status', 'aria-live': 'polite' });
      const o = S.pw;

      const check = (key, label, tip) => {
        const cb = h('input', { type: 'checkbox', checked: !!o[key], dataset: { k: key } });
        listen(cb, 'change', () => { o[key] = cb.checked; changed(); });
        return h('label.dt__chk' + (tip ? '.tip' : ''), { 'data-tip': tip || null }, cb, h('span', { text: label }));
      };
      const range = (key, min, max, label, fmtv) => {
        const r = h('input.dt__range', { type: 'range', min: String(min), max: String(max), value: String(o[key]), 'aria-label': label });
        const n = h('input.dt__num', { type: 'number', min: String(min), max: String(max), value: String(o[key]), 'aria-label': label + ' (number)' });
        const set = v => {
          const x = Math.max(min, Math.min(max, Math.round(+v) || min));
          o[key] = x; r.value = String(x); if (document.activeElement !== n) n.value = String(x);
          changed();
        };
        listen(r, 'input', () => set(r.value));
        listen(n, 'input', () => { if (n.value !== '') set(n.value); });
        listen(n, 'blur', () => { n.value = String(o[key]); });
        return h('div.dt__rangerow', h('label.dt__lab', { text: label }), r, n);
      };
      const sepSel = h('select.dt__sel', { 'aria-label': 'Separator between words' },
        ...Object.keys(P.SEPARATORS).map(k => h('option', { value: k, text: { hyphen: 'Hyphen -', space: 'Space', dot: 'Dot .', underscore: 'Underscore _', none: 'None' }[k], selected: o.separator === k })));
      listen(sepSel, 'change', () => { o.separator = sepSel.value; changed(); });

      const randomOpts = h('div.dt__opts',
        range('length', P.MIN_LEN, P.MAX_LEN, 'Length'),
        h('div.dt__checks', check('lower', 'Lowercase a-z'), check('upper', 'Uppercase A-Z'), check('digits', 'Digits 0-9'), check('symbols', 'Symbols !@#$'),
          check('noLookalikes', 'No look-alike characters', 'Leaves out I l 1 | O 0 o and the backtick, which are easy to misread')));
      const phraseOpts = h('div.dt__opts',
        range('words', P.MIN_WORDS, P.MAX_WORDS, 'Words'),
        h('div.dt__checks', h('label.dt__chk', h('span', { text: 'Separator' }), sepSel), check('capitalise', 'Capitalise each word'), check('number', 'Add a number at the end')));

      const modeBtns = {
        random: h('button', { type: 'button', role: 'tab', onclick: () => setMode('random'), text: 'Password' }),
        phrase: h('button', { type: 'button', role: 'tab', onclick: () => setMode('phrase'), text: 'Passphrase' }),
      };
      function setMode(m) { o.mode = m; changed(); }

      function show() {
        out.textContent = secret ? (shown ? secret : '•'.repeat(Math.min(secret.length, 64))) : '';
        out.classList.toggle('is-empty', !secret);
        eye.replaceChildren(icon(shown ? 'eye-off' : 'eye'), h('span', { text: shown ? 'Hide' : 'Show' }));
        eye.setAttribute('aria-pressed', String(!shown));
      }
      const eye = h('button.btn.btn--sm', { type: 'button', onclick: () => { shown = !shown; show(); } });
      const copyBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: copySecret }, icon('copy'), h('span', { text: 'Copy' }));
      const regenBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => regenerate() }, icon('refresh'), h('span', { text: 'Generate another' }));

      async function copySecret() {
        if (!secret) return;
        try {
          await writeUnrecorded(secret);
          msg.textContent = 'Copied to the system clipboard. Paste it where you need it, then copy something else to replace it.';
        } catch (err) { msg.textContent = 'The browser blocked copying. Select the text and copy it yourself.'; }
      }

      async function regenerate() {
        const mine = ++gen;
        msg.textContent = '';
        try {
          if (o.mode === 'phrase') {
            if (!words) words = (await import('./dev-tools-words.js')).EFF_LONG;
            if (dead || mine !== gen) return;
            secret = P.generatePassphrase(o, words);
            bits = P.passphraseEntropy(o, words.length);
            meta.textContent = `About ${bitsText(bits)} of entropy (an estimate), from ${o.words} words${o.number ? ' and a digit' : ''}. ${strong(bits)}`;
          } else {
            secret = P.generatePassword(o);
            bits = P.passwordEntropy(o);
            meta.textContent = `About ${bitsText(bits)} of entropy (an estimate), from ${o.length} characters. ${strong(bits)}`;
          }
        } catch (err) {
          secret = ''; bits = 0; meta.textContent = '';
          msg.textContent = err.message || String(err);
        }
        copyBtn.disabled = !secret;
        show();
      }
      const strong = b => `Strength: ${P.strengthWord(b)}.`;
      let rt = 0;
      function changed() {
        schedulePersist();
        modeBtns.random.classList.toggle('is-on', o.mode === 'random'); modeBtns.phrase.classList.toggle('is-on', o.mode === 'phrase');
        modeBtns.random.setAttribute('aria-selected', String(o.mode === 'random')); modeBtns.phrase.setAttribute('aria-selected', String(o.mode === 'phrase'));
        randomOpts.hidden = o.mode !== 'random'; phraseOpts.hidden = o.mode !== 'phrase';
        clearTimeout(rt); rt = later(regenerate, 0);
      }
      note.append(
        h('p', { text: 'Made here on this device with the browser’s secure random numbers (crypto.getRandomValues). Nothing is sent anywhere, and the result is not saved, logged or added to a notification: it exists only in this window and disappears when you close it.' }),
        h('p', { text: 'Entropy is an estimate of how many guesses a password would take if an attacker knows your settings (length, character kinds, the word list) but not the random choices. It is not a prediction of how long a break-in would take, and it says nothing about reusing a password or where you type it.' }),
        h('p', { text: 'Copy puts the text on your computer’s clipboard like any other copy. Static Clipboard does not record it, but other programs can read the clipboard until you copy something else.' }),
        h('p.dt__credit', { text: 'Passphrase words: EFF long word list, Electronic Frontier Foundation, CC BY.' }));

      cleanups.push(() => { clearTimeout(rt); gen++; secret = ''; words = null; out.textContent = ''; meta.textContent = ''; });

      const el = h('div.dt__panel',
        h('div.dt__seg', { role: 'tablist', 'aria-label': 'Kind' }, modeBtns.random, modeBtns.phrase),
        h('div.dt__pwbox', out, h('div.dt__pwbtns', copyBtn, eye, regenBtn)),
        meta, msg, randomOpts, phraseOpts, note);
      changed();
      return { el, regenerate };
    })();

    /* ====================================================================
       frame
       ==================================================================== */
    const panels = { regex: rx.el, json: js.el, pw: pw.el };
    const TABS = [['regex', 'Regex', 'search'], ['json', 'JSON', 'file-text'], ['pw', 'Passwords', 'lock']];
    const tabBtns = {};
    const tabBar = h('div.dt__tabs', { role: 'tablist', 'aria-label': 'Tools' });
    function showTab(id) {
      S.tab = id;
      for (const [k] of TABS) {
        panels[k].hidden = k !== id;
        tabBtns[k].classList.toggle('is-on', k === id);
        tabBtns[k].setAttribute('aria-selected', String(k === id));
        tabBtns[k].tabIndex = k === id ? 0 : -1;
      }
      schedulePersist();
    }
    for (const [id, label, ic] of TABS) {
      tabBtns[id] = h('button.dt__tab', { type: 'button', role: 'tab', id: 'dt-tab-' + id, onclick: () => showTab(id), dataset: { tab: id } }, icon(ic), h('span', { text: label }));
      tabBar.appendChild(tabBtns[id]);
    }
    listen(tabBar, 'keydown', e => {
      const ids = TABS.map(t => t[0]);
      const at = ids.indexOf(S.tab);
      const next = e.key === 'ArrowRight' ? ids[(at + 1) % ids.length] : e.key === 'ArrowLeft' ? ids[(at + ids.length - 1) % ids.length] : null;
      if (next) { e.preventDefault(); showTab(next); tabBtns[next].focus(); }
    });

    root.appendChild(h('div.app.app--col', h('div.dt', tabBar, h('div.dt__panels', panels.regex, panels.json, panels.pw))));

    const openWith = o => {
      if (o && o.path) { showTab('json'); js.openPath(o.path); }
    };
    win.onReopen?.(openWith);
    if (opts && opts.path) openWith(opts); else showTab(S.tab);
    rx.run();

    return () => {
      dead = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const f of cleanups) { try { f(); } catch (e) { /* already gone */ } }
      persist();
    };
  },
});
