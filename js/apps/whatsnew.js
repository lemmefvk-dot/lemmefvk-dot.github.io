/* ============================================================
   whatsnew.js — What's New: StaticOS's release notes.

   Reads data/changelog.json (the same file tools/bump.mjs takes the
   version number from, so the number on screen and the notes can
   never disagree). The newest release is open; older ones fold.

   A release is { version, name, date, summary, highlights, notes }.
     highlight  a line of text, or { icon, title, text, app, opts, kind }
                — one with an `app` gets an "Open …" button here and in
                the sheet. A highlight is "New" unless it says otherwise.
     note       a line of text, or { kind, text }. `kind` is 'new',
                'improved' or 'fixed'; a plain line is judged from its
                wording (see kindOf), so older releases need no edits.

   Search looks through every release's words; the New / Improved /
   Fixed buttons keep only that kind of line. Expand all and Collapse
   all open and fold every release.

   Opening this window records that the newest release was looked at
   (js/core/wnbadge.js), which clears the "New" mark on its icon.

   After an update, js/shell/whatsnew-sheet.js shows the releases this
   person hasn't seen yet, once, with a button that opens this window.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as WNB from '../core/wnbadge.js';
import { t as tr, plural as plu } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-whatsnew-css')) {
  const l = document.createElement('link');
  l.id = 'feat-whatsnew-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-whatsnew.css';
  document.head.appendChild(l);
}

const fmtDate = iso => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

export const KINDS = [['new', 'New'], ['improved', 'Improved'], ['fixed', 'Fixed']];

/* What a plain line of a note is about, from its words. Only used where the
   changelog does not say (`kind`): it errs towards "improved". */
const FIXED = /\b(fix(ed|es)?|no longer|used to|stuck|broken|wrong|crash(ed|es)?|could not|couldn.t|stopped)\b|\bnow (reads?|shows?|loads?|opens?) (properly|correctly)\b/i;
const NEW = /^(new\b|added\b|adds\b|introduc)/i;
export function kindOf(item, fallback = 'improved') {
  if (item && typeof item === 'object' && KINDS.some(k => k[0] === item.kind)) return item.kind;
  const text = typeof item === 'string' ? item : String(item?.text || '');
  if (FIXED.test(text)) return 'fixed';
  if (NEW.test(text)) return 'new';
  return fallback;
}

/** Every line of a release as { kind, title, text, icon, app, opts }. */
export function itemsOf(r) {
  const out = [];
  for (const x of r.highlights || []) {
    if (typeof x === 'string') out.push({ kind: 'new', title: '', text: x, icon: 'check', hl: true });
    else out.push({ kind: KINDS.some(k => k[0] === x.kind) ? x.kind : 'new', title: x.title || '', text: x.text || '', icon: x.icon || 'check', app: x.app, opts: x.opts, hl: true });
  }
  for (const x of r.notes || []) {
    out.push({ kind: kindOf(x), title: '', text: typeof x === 'string' ? x : String(x?.text || ''), icon: null, hl: false });
  }
  return out;
}

defineApp({
  id: 'whatsnew',
  name: "What's New",
  icon: 'sparkles',
  g1: '#ffd36e', g2: '#ff7a59',
  category: 'System',
  keywords: ['whats new', 'changelog', 'release notes', 'update', 'version', 'news'],
  desc: tr('Release notes for every StaticOS version'),
  singleton: true,
  win: { w: 620, h: 640, minW: 380, minH: 420 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, clear } = api;
    let dead = false;
    let releases = [];
    const S = { q: '', kind: 'all' };

    const body = h('div.wn__body', { 'aria-live': 'polite' },
      h('div.wn__loading', { text: tr('Loading release notes…') }));

    /* ---- the bar: search, kind buttons, expand / collapse ---- */
    const find = h('input', { type: 'search', placeholder: tr('Search the release notes'), 'aria-label': tr('Search the release notes'), spellcheck: 'false', autocomplete: 'off',
      oninput: () => { S.q = find.value.trim(); paint(); } });
    const kindBtns = [['all', 'All'], ...KINDS].map(([k, label]) => h('button.wn__kind', {
      type: 'button', dataset: { kind: k }, 'aria-pressed': String(k === S.kind),
      onclick: () => { S.kind = k; kindBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === k))); paint(); },
    }, tr(label)));
    const setAll = open => body.querySelectorAll('details.wn__rel').forEach(d => { d.open = open; });
    const bar = h('div.wn__bar',
      h('label.field.wn__find', icon('search'), find),
      h('div.wn__kinds', { role: 'group', 'aria-label': tr('Show only') }, kindBtns),
      h('div.wn__fold',
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => setAll(true) }, tr('Expand all')),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => setAll(false) }, tr('Collapse all'))));
    bar.hidden = true;

    root.appendChild(h('div.app.app--col.wn', bar, body));

    /* ---- one line of a release ---- */
    const kindLabel = k => tr(KINDS.find(x => x[0] === k)?.[1] || k);
    const lineEl = it => {
      const app = it.app && api.getApp(it.app);
      const chip = h(`span.wn__tag.wn__tag--${it.kind}`, { text: kindLabel(it.kind) });
      if (!it.hl) return h('li.wn__note', chip, h('span', { text: it.text }));
      return h('li', icon(it.icon || 'check'),
        h('span', chip, ' ', it.title ? h('b', { text: it.title }) : null, it.title && it.text ? ` — ${it.text}` : it.text,
          app ? h('button.wn__open', { type: 'button', onclick: () => api.openApp(app.id, it.opts || undefined) },
            h('span', { text: it.app === 'settings' ? tr('Open Settings') : tr('Open {name}', { name: app.name }) }), icon('arrow-right', { size: 12 })) : null));
    };

    const match = (it, q) => `${it.title} ${it.text}`.toLowerCase().includes(q);

    function release(r, open, items, showSummary) {
      const head = h('div.wn__rhead',
        h('span.wn__ver', { text: r.version }),
        h('div.wn__rt',
          h('b', { text: r.name ? tr('StaticOS {version} — {name}', { version: r.version, name: r.name }) : tr('StaticOS {version}', { version: r.version }) }),
          h('small', { text: fmtDate(r.date) })));
      const hl = items.filter(i => i.hl), notes = items.filter(i => !i.hl);
      const inner = h('div.wn__rbody',
        showSummary && r.summary ? h('p.wn__sum', { text: r.summary }) : null,
        hl.length ? h('ul.wn__hl', hl.map(lineEl)) : null,
        notes.length ? h('ul.wn__notes', notes.map(lineEl)) : null);
      return h('details.wn__rel', { open, dataset: { version: r.version } }, h('summary', head), inner);
    }

    /* ---- draw what the search and the kind buttons leave ---- */
    function paint() {
      if (dead) return;
      clear(body);
      const top = releases[0];
      const q = S.q.toLowerCase();
      const filtering = !!q || S.kind !== 'all';
      if (top && !filtering) {
        body.append(h('header.wn__hero',
          h('div.wn__badge', icon('sparkles')),
          h('div',
            h('div.wn__kicker', { text: tr('You are running') }),
            h('div.wn__h1', { text: top.name ? tr('StaticOS {version} · {name}', { version: top.version, name: top.name }) : tr('StaticOS {version}', { version: top.version }) }),
            h('div.wn__sub', { text: top.summary || '' }))));
      }
      let shown = 0;
      releases.forEach((r, i) => {
        const all = itemsOf(r);
        const head = `${r.version} ${r.name || ''} ${r.summary || ''}`.toLowerCase();
        /* a release whose own name or summary matches shows all its lines */
        const headHit = !!q && head.includes(q);
        const items = all.filter(it => (S.kind === 'all' || it.kind === S.kind) && (!q || headHit || match(it, q)));
        if (filtering && !items.length) return;
        shown++;
        body.append(release(r, filtering ? true : i === 0, items, !filtering || headHit));
      });
      if (!releases.length) body.append(h('div.wn__loading', { text: tr('No release notes yet.') }));
      else if (filtering && !shown) {
        body.append(h('div.empty', icon('search'), h('b', { text: tr('Nothing matches') }),
          h('small', { text: q ? (S.kind !== 'all' ? tr('No release notes mention “{q}” among the {kind} lines.', { q: S.q, kind: kindLabel(S.kind).toLowerCase() }) : tr('No release notes mention “{q}”.', { q: S.q })) : tr('No {kind} lines yet.', { kind: kindLabel(S.kind).toLowerCase() }) })));
      } else if (filtering) {
        body.prepend(h('div.wn__count', { role: 'status', text: plu(shown, '{n} release match', '{n} releases match') }));
      }
    }

    fetch('data/changelog.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(list => {
        if (dead) return;
        releases = Array.isArray(list) ? list.filter(r => r && r.version) : [];
        bar.hidden = !releases.length;
        paint();
        /* the newest release has now been looked at: the "New" mark on the icon goes */
        if (releases[0]) WNB.markLooked(releases[0].version);
      })
      .catch(err => {
        if (dead) return;
        clear(body);
        body.append(h('div.wn__loading', { text: tr('Could not load the release notes ({message}).', { message: err.message }) }));
      });

    return () => { dead = true; };
  },
});
