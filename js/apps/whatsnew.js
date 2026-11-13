/* ============================================================
   whatsnew.js — What's New: StaticOS's release notes.

   Reads data/changelog.json (the same file tools/bump.mjs takes the
   version number from, so the number on screen and the notes can
   never disagree). The newest release is open; older ones fold.

   After an update, js/shell/whatsnew-sheet.js shows the releases this
   person hasn't seen yet, once, with a button that opens this window.
   ============================================================ */
import { defineApp } from '../core/registry.js';

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

defineApp({
  id: 'whatsnew',
  name: "What's New",
  icon: 'sparkles',
  g1: '#ffd36e', g2: '#ff7a59',
  category: 'System',
  keywords: ['whats new', 'changelog', 'release notes', 'update', 'version', 'news'],
  desc: 'Release notes for every StaticOS version',
  singleton: true,
  win: { w: 620, h: 640, minW: 380, minH: 420 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, clear } = api;
    let dead = false;

    const body = h('div.wn__body', { 'aria-live': 'polite' },
      h('div.wn__loading', { text: 'Loading release notes…' }));
    root.appendChild(h('div.app.app--col.wn', body));

    const release = (r, open) => {
      const head = h('div.wn__rhead',
        h('span.wn__ver', { text: r.version }),
        h('div.wn__rt',
          h('b', { text: r.name ? `StaticOS ${r.version} — ${r.name}` : `StaticOS ${r.version}` }),
          h('small', { text: fmtDate(r.date) })));
      const inner = h('div.wn__rbody',
        r.summary ? h('p.wn__sum', { text: r.summary }) : null,
        /* a highlight is a line of text, or { icon, title, text, app } (the
           sheet shown after an update uses the icon and the app too) */
        (r.highlights || []).length ? h('ul.wn__hl', r.highlights.map(x => (typeof x === 'string'
          ? h('li', icon('check'), h('span', { text: x }))
          : h('li', icon(x.icon || 'check'), h('span', h('b', { text: x.title || '' }), x.text ? ` — ${x.text}` : ''))))) : null,
        (r.notes || []).length ? h('ul.wn__notes', r.notes.map(x => h('li', { text: x }))) : null);
      const d = h('details.wn__rel', { open }, h('summary', head), inner);
      return d;
    };

    fetch('data/changelog.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(list => {
        if (dead) return;
        clear(body);
        const rel = Array.isArray(list) ? list : [];
        const top = rel[0];
        if (top) {
          body.append(h('header.wn__hero',
            h('div.wn__badge', icon('sparkles')),
            h('div',
              h('div.wn__kicker', { text: 'You are running' }),
              h('div.wn__h1', { text: `StaticOS ${top.version}${top.name ? ` · ${top.name}` : ''}` }),
              h('div.wn__sub', { text: top.summary || '' }))));
        }
        rel.forEach((r, i) => body.append(release(r, i === 0)));
        if (!rel.length) body.append(h('div.wn__loading', { text: 'No release notes yet.' }));
      })
      .catch(err => {
        if (dead) return;
        clear(body);
        body.append(h('div.wn__loading', { text: `Could not load the release notes (${err.message}).` }));
      });

    return () => { dead = true; };
  },
});
