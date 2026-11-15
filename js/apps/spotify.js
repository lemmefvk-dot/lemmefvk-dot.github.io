/* ============================================================
   Spotify — the real player, through Spotify's official embed.
   See js/portal/spotify.js for what the embed can and cannot do.

   Your library keeps links, not music: you can rename them, sort
   them into folders, paste or import many at once, export them as a
   text file, and send one to a friend (a link only; they press Add
   or Open, and nothing plays by itself). Study starts the Focus
   timer and opens the playlist you chose for it. Radio asks
   Spotify's player to pause (its official iFrame API allows that)
   and opens Static Radio; if the API can't load here it says so.
   The player follows the light or dark theme.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as SP from '../portal/spotify.js';
import { BRAND } from '../portal/brand.js';
import { paintMediaPanel } from '../portal/sendfriend.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-spotify-css')) {
  const l = document.createElement('link');
  l.id = 'feat-spotify-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-spotify.css';
  document.head.appendChild(l);
}

/* Spotify's official iFrame API: the one thing that can tell its player to pause.
   Loaded once; null when it can't be (blocked network, offline). */
let apiP = null;
function loadApi() {
  if (apiP) return apiP;
  apiP = new Promise(res => {
    if (typeof document === 'undefined') { res(null); return; }
    const done = v => { clearTimeout(t); res(v); };
    const t = setTimeout(() => { apiP = null; res(null); }, 3500);
    window.onSpotifyIframeApiReady = IFrameAPI => done(IFrameAPI);
    if (document.querySelector('script[data-spotify-api]')) return;
    const sc = document.createElement('script');
    sc.src = 'https://open.spotify.com/embed/iframe-api/v1';
    sc.async = true;
    sc.dataset.spotifyApi = '1';
    sc.onerror = () => { sc.remove(); apiP = null; done(null); };
    document.head.appendChild(sc);
  });
  return apiP;
}
const themeNow = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const KIND_NAME = { track: 'song', album: 'album', playlist: 'playlist', artist: 'artist', show: 'podcast', episode: 'episode' };

defineApp({
  id: 'spotify',
  name: 'Spotify',
  icon: 'brand-spotify',
  g1: '#86efac', g2: '#0f7a3a',
  category: 'Media',
  keywords: ['spotify', 'music', 'playlist', 'album', 'podcast', 'listen'],
  desc: 'Play real playlists through Spotify',
  pinned: true, dock: true, singleton: true,
  win: { w: 880, h: 620, minW: 520, minH: 380 },


  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, store } = api;

    const S = {
      current: null, alive: true,
      view: 'player',        // 'player' | 'search'
      q: '', kind: 'song',
      rows: [], busy: false, err: null, seq: 0,
      playing: null,         // the preview <audio> currently sounding
      ctl: null,             // Spotify's embed controller, when its iFrame API loaded
      playSeq: 0,
      closed: new Set(),     // library folders folded away (this window only)
      sheet: null,
    };

    const stage = h('div.sp__stage');
    const side = h('aside.sp__side');
    const link = h('input', {
      type: 'text', spellcheck: 'false',
      placeholder: 'Paste Spotify links — one or many',
      'aria-label': 'Spotify link',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); openTyped(); } },
      /* a single-line box swallows line breaks, so a pasted list is read straight off the clipboard */
      onpaste: e => {
        const text = e.clipboardData?.getData('text') || '';
        if (SP.parseMany(text).length > 1) { e.preventDefault(); takeMany(text); }
      },
    });

    const find = h('input', {
      type: 'search', spellcheck: 'false',
      placeholder: 'Search songs, albums, artists, podcasts',
      'aria-label': 'Search music',
      oninput: e => {
        S.q = e.target.value;
        clearTimeout(S.timer);
        S.timer = setTimeout(runSearch, 260);
      },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(S.timer); runSearch(); } },
    });

    const ibtn = (label, ic, onclick, extra = {}) => h('button.btn.btn--sm.btn--ghost.tip', {
      type: 'button', 'data-tip': label, 'aria-label': label, onclick, ...extra,
    }, icon(ic, { size: 13 }));

    const bar = h('div.sp__bar',
      h('div.field.sp__find', icon('search'), find),
      h('div.field', icon('link'), link),
      h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: openTyped },
        icon('play', { size: 13, fill: true }), 'Open'),
      h('button.btn.btn--sm.tip', {
        type: 'button', 'data-tip': 'Save to your library', 'aria-label': 'Save to your library',
        onclick: () => { if (S.current) { SP.save(store, S.current); paintSide(); } },
      }, icon('plus', { size: 13 })),
      ibtn('Copy Spotify link', 'copy', async () => {
        if (!S.current) return;
        try { await navigator.clipboard.writeText(SP.openUrl(S.current)); } catch (err) { /* optional */ }
      }),
      ibtn('Send to a friend', 'send', () => { if (S.current) sendSheet(S.current); }, { 'data-role': 'sp-send' }),
      h('button.btn.btn--sm.tip', {
        type: 'button', 'data-role': 'sp-study', 'data-tip': 'Start the Focus timer and open your study playlist',
        'aria-label': 'Study: start the Focus timer and open your study playlist', onclick: doStudy,
      }, icon('clock', { size: 13 }), 'Study'),
      h('button.btn.btn--sm.tip', {
        type: 'button', 'data-role': 'sp-radio', 'data-tip': 'Pause the Spotify player and open Static Radio',
        'aria-label': 'Switch to radio: pause the Spotify player and open Static Radio', onclick: doRadio,
      }, icon('cast', { size: 13 }), 'Radio'),
      ibtn('More', 'more-horizontal', e => moreMenu(e.currentTarget), { 'data-role': 'sp-more' }));

    const main = h('div.sp__main', bar, stage);
    const fileIn = h('input.sr', {
      type: 'file', accept: '.txt,.csv,.tsv,text/plain', tabindex: '-1', 'aria-hidden': 'true', 'data-role': 'sp-import',
      onchange: async e => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 512 * 1024) { say('That file is too big to be a list of links.', 'alert'); return; }
        const items = SP.parseMany(await f.text());
        if (!items.length) { say('No Spotify links found in that file.', 'alert'); return; }
        const r = SP.saveMany(store, items);
        paintSide();
        say(`Imported ${r.added} link${r.added === 1 ? '' : 's'}${r.had ? `; ${r.had} ${r.had === 1 ? 'was' : 'were'} already saved` : ''}.`, 'check');
      },
    });
    root.appendChild(h('div.sp', side, main, fileIn));

    const say = (message, ic = 'info', title = 'Spotify') => api.notify({ app: 'Spotify', icon: ic, title, message, timeout: 5000 });

    paintSide();
    const first = opts?.link ? SP.parseLink(opts.link) : null;
    play(first || SP.STARTERS[0]);

    /* ---------------- sheets: rename, folders, send, study ---------------- */
    function closeSheet() { S.sheet?.remove(); S.sheet = null; }
    function openSheet(title, ...kids) {
      closeSheet();
      S.sheet = h('div.sp-sheet', {
        role: 'dialog', 'aria-label': title,
        onkeydown: e => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } },
      },
      h('div.sp-sheet__h', h('b', { text: title }),
        h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('x'))),
      ...kids);
      main.appendChild(S.sheet);
      S.sheet.querySelector('input,button.btn')?.focus({ preventScroll: true });
      return S.sheet;
    }
    function nameOf(it) { return it.name || `${KIND_NAME[it.kind] || it.kind} · ${it.id.slice(0, 8)}`; }

    function renameSheet(it) {
      const input = h('input', { type: 'text', maxlength: String(SP.NAME_MAX), value: it.name || '', 'aria-label': 'Name', placeholder: 'A name you will recognise' });
      const go = () => { SP.rename(store, it, input.value); closeSheet(); paintSide(); };
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      openSheet('Rename',
        h('div.field', input),
        h('small.dim', { text: 'Only you see this name. Leave it empty to go back to the default.' }),
        h('div.sp-sheet__row',
          h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-role': 'sp-save-name', onclick: go }, 'Save'),
          h('button.btn.btn--sm', { type: 'button', onclick: closeSheet }, 'Cancel')));
      input.select();
    }

    function folderSheet(it) {
      const mine = SP.saved(store);
      const input = h('input', { type: 'text', maxlength: String(SP.FOLDER_MAX), value: mine.find(r => SP.same(r, it))?.folder || '', 'aria-label': 'Folder name', placeholder: 'Folder name, e.g. Study', list: 'sp-folders' });
      const go = v => { SP.moveTo(store, it, v); closeSheet(); paintSide(); };
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(input.value); } };
      openSheet('Move to a folder',
        h('div.field', input),
        h('datalist', { id: 'sp-folders' }, SP.folders(mine).map(f => h('option', { value: f }))),
        h('div.sp-sheet__row',
          h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-role': 'sp-save-folder', onclick: () => go(input.value) }, 'Save'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => go('') }, 'No folder'),
          h('button.btn.btn--sm', { type: 'button', onclick: closeSheet }, 'Cancel')));
    }

    function sendSheet(it) {
      const hold = h('div.sp-sheet__list', { 'data-role': 'sp-friends' });
      const label = nameOf(it);
      openSheet('Send to a friend', hold);
      paintMediaPanel(ctx, hold, {
        label,
        note: `This sends the link to ${label}, nothing more. They choose whether to add or open it, and it does not play by itself.`,
        noun: 'it',
        send: fp => import('../core/friends.js').then(F => F.sendMedia(fp, { kind: 'spotify', id: SP.wireId(it), title: it.name || label })),
      }, () => S.alive && !!S.sheet);
    }

    function studySheet() {
      const mine = SP.saved(store);
      const cur = SP.study(store);
      openSheet('Choose your study playlist',
        mine.length
          ? h('div.sp-sheet__list', mine.map(it => h('button.sp-item', {
              type: 'button', class: cur && SP.same(cur, it) ? 'is-on' : null, 'data-id': it.id,
              onclick: () => { SP.setStudy(store, it); closeSheet(); paintSide(); say(`${nameOf(it)} opens when you press Study.`, 'check'); },
            }, icon(it.kind === 'track' ? 'music' : it.kind === 'show' ? 'mic' : 'list-music'),
            h('span.sp-item__n', { text: nameOf(it) }))))
          : h('small.dim', { text: 'Save a playlist or album to your library first (paste a link and press +), then choose it here.' }),
        h('small.dim', { text: 'Study starts your Focus timer and opens this link. Spotify decides when sound starts: press play in the player.' }));
    }

    /* ---------------- Study and Radio ---------------- */
    async function doStudy() {
      const it = SP.study(store);
      if (!it) { studySheet(); return; }
      let note = '';
      try {
        const Focus = await import('../core/focus.js');
        let st = Focus.state();
        if (st.status === 'running') note = `Your Focus timer was already running (${Math.max(1, Math.round(st.left / 60000))} min left).`;
        else {
          if (st.phase !== 'focus') Focus.skip();
          st = Focus.start();
          note = `Focus timer started: ${Math.max(1, Math.round(st.left / 60000))} min.`;
        }
      } catch (err) { note = 'The Focus timer could not start.'; }
      if (!S.alive) return;
      play(it);
      say(`${note} ${nameOf(it)} is open: press play in the player.`, 'clock', 'Study time');
    }

    async function doRadio() {
      let msg;
      if (S.ctl) {
        try { S.ctl.pause(); msg = 'Asked Spotify’s player to pause.'; } catch (err) { msg = 'Spotify’s player did not take the pause request: pause it in the player.'; }
      } else {
        msg = 'Spotify’s player can’t be paused from here (its control script did not load), so pause it in the player yourself.';
      }
      try { api.openApp('radio', { station: 'groovesalad' }); } catch (err) { msg += ' Static Radio could not open.'; }
      say(msg, 'cast', 'Switching to radio');
    }

    function moreMenu(btn) {
      const r = btn.getBoundingClientRect();
      api.menu([
        { label: 'Choose study playlist…', icon: 'clock', onClick: studySheet },
        '-',
        { label: 'Export my links as a text file', icon: 'download', disabled: !SP.saved(store).length, onClick: exportLinks },
        { label: 'Import links from a text file…', icon: 'upload', onClick: () => fileIn.click() },
      ], r.left, r.bottom + 4);
    }
    function exportLinks() {
      const rows = SP.saved(store);
      if (!rows.length) return;
      const url = URL.createObjectURL(new Blob([SP.exportText(rows)], { type: 'text/plain' }));
      const a = h('a', { href: url, download: 'spotify-links.txt' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say(`Exported ${rows.length} link${rows.length === 1 ? '' : 's'} to spotify-links.txt.`, 'download');
    }

    /* ---------------- search ----------------
       Apple's catalogue, because Spotify's search needs a token that cannot
       live in a static site. Results carry Apple's own 30-second preview,
       which plays here; the full track hands off to Spotify. Every row says
       so, not just the footer. */
    async function runSearch() {
      const q = S.q.trim();
      const seq = ++S.seq;
      if (!q) { S.view = 'player'; S.rows = []; stopPreview(); play(S.current || SP.STARTERS[0]); return; }
      S.view = 'search'; S.busy = true; S.err = null;
      paintSearch();
      try {
        const rows = await SP.search(q, { kind: S.kind, limit: 24 });
        if (seq !== S.seq || !S.alive) return;
        S.rows = rows; S.busy = false;
      } catch (err) {
        if (seq !== S.seq || !S.alive) return;
        S.rows = []; S.busy = false; S.err = err.message || String(err);
      }
      paintSearch();
    }

    /* One preview at a time — two overlapping 30-second clips is nobody's
       idea of a music app. */
    function stopPreview() {
      if (!S.playing) return;
      try { S.playing.el.pause(); } catch (err) { /* already gone */ }
      S.playing = null;
    }

    function previewButton(row) {
      if (!row.preview) {
        return h('span.sp-res__nopre', { title: 'Apple does not publish a preview for this one',
          text: '—' });
      }
      const btn = h('button.sp-res__play', {
        type: 'button', 'aria-label': `Preview ${row.title}`,
        onclick: e => {
          e.stopPropagation();
          const same = S.playing && S.playing.id === row.id;
          stopPreview();
          [...stage.querySelectorAll('.sp-res__play.is-on')].forEach(b => b.classList.remove('is-on'));
          if (same) return;
          const el = new Audio(row.preview);
          el.volume = 0.8;
          el.addEventListener('ended', () => { btn.classList.remove('is-on'); S.playing = null; });
          el.play().catch(() => {
            btn.classList.remove('is-on');
            api.notify({ app: 'Spotify', icon: 'alert', title: 'Preview would not play',
              message: 'Apple declined to serve that clip.' });
          });
          S.playing = { id: row.id, el };
          btn.classList.add('is-on');
        },
      }, icon('play', { size: 12, fill: true }));
      return btn;
    }

    function paintSearch() {
      const tabs = h('div.sp-res__tabs', SP.KINDS.map(([id, label]) =>
        h(id === S.kind ? 'button.chip.is-on' : 'button.chip', {
          type: 'button', 'aria-pressed': String(id === S.kind),
          onclick: () => { S.kind = id; runSearch(); },
        }, h('span', { text: label }))));

      if (S.busy) {
        api.render(stage, tabs, h('div.sp-res__grid',
          ...Array.from({ length: 8 }, () => h('div.sp-res__skel'))));
        return;
      }
      if (S.err) {
        api.render(stage, tabs, h('div.empty', icon('alert'),
          h('b', { text: 'Search is not answering' }),
          h('small', { text: S.err }),
          h('button.btn', { type: 'button', onclick: runSearch }, icon('refresh', { size: 13 }), 'Try again')));
        return;
      }
      if (!S.rows.length) {
        api.render(stage, tabs, h('div.empty', icon('search'),
          h('b', { text: `Nothing matches “${S.q}”` }),
          h('small', { text: 'Try a different spelling, or another kind above.' })));
        return;
      }

      const grid = h('div.sp-res__grid');
      for (const row of S.rows) {
        const art = h('div.sp-res__art',
          row.art ? h('img', { src: row.art, alt: '', loading: 'lazy', decoding: 'async',
            referrerpolicy: 'no-referrer', onerror: e => e.target.remove() })
            : icon(row.kind === 'artist' ? 'user' : 'music', { size: 20 }));
        art.appendChild(h('span.sp-res__src', { title: 'This result is from Apple’s catalogue, not Spotify’s', text: 'From Apple' }));
        art.appendChild(h('div.sp-res__ctl', previewButton(row)));

        grid.appendChild(h('div.sp-res', {
          role: 'button', tabindex: '0',
          'aria-label': `${row.title}${row.artist ? ` by ${row.artist}` : ''}, from Apple’s catalogue. Opens a search for it on Spotify`,
          onclick: () => openOnSpotify(row),
          onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOnSpotify(row); } },
        }, art,
          h('div.sp-res__b',
            h('div.sp-res__t', { text: row.title }),
            h('div.sp-res__m', { text: [row.artist, row.year, SP.fmtDur(row.ms)].filter(Boolean).join(' · ') }))));
      }

      api.render(stage, tabs, grid,
        h('div.sp__note', {
          text: 'Results come from Apple’s catalogue: Spotify’s own search needs a secret key, and a '
              + 'key in a static site is readable by anyone. Previews are Apple’s 30-second clips and '
              + 'play here. Opening a result searches Spotify for it, through the proxy.',
        }));
    }

    /* Spotify refuses to be framed, so it goes through the proxy like
       everything else — never a new tab. */
    function openOnSpotify(row) {
      stopPreview();
      store.set('proxy.pending', row.spotify);
      api.openApp('aether-proxy', {});
      api.notify({ app: 'Spotify', icon: 'search',
        title: `Searching Spotify for ${row.title}`,
        message: 'Opened in the proxy — Spotify will not render in a plain frame.' });
    }

    /* ---------------- stage ---------------- */
    function noteText() {
      return 'This is Spotify’s own player. Signed in to Spotify in this browser you get full '
      + 'tracks; signed out, Spotify plays 30-second previews. Either way the frame is theirs, '
      + `so ${BRAND.name} cannot read what is playing — the desktop widget stays on the local player.`;
    }

    async function play(item) {
      if (!item || !S.alive) return;
      S.current = item;
      link.value = SP.openUrl(item);
      win.setSubtitle(item.name || item.kind);
      paintSide();
      const seq = ++S.playSeq;
      try { S.ctl?.destroy?.(); } catch (err) { /* already gone */ }
      S.ctl = null;
      const one = !SP.isCollection(item.kind);
      const theme = themeNow();
      const host = h('div.sp__frame-host');
      api.render(stage, host, h('div.sp__note', { text: noteText() }));
      const IFrameAPI = await loadApi();
      if (seq !== S.playSeq || !S.alive) return;
      if (IFrameAPI) {
        try {
          IFrameAPI.createController(host, {
            uri: `spotify:${item.kind}:${item.id}`, width: '100%', height: one ? '152' : '100%',
            theme,
          }, c => {
            if (seq === S.playSeq && S.alive) S.ctl = c; else try { c.destroy?.(); } catch (err) { /* gone */ }
            /* the frame Spotify's script made: a screen reader says what it is, as for the plain embed below */
            const f = stage.querySelector('iframe:not([title])');
            if (f) f.title = `Spotify ${item.kind}`;
          });
          return;
        } catch (err) { /* fall back to the plain embed below */ }
      }
      host.replaceWith(h('iframe', {
        class: one ? 'sp__frame sp__frame--one' : 'sp__frame',
        src: SP.embedUrl(item, { theme }),
        title: `Spotify ${item.kind}`,
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      }));
    }

    function openTyped() {
      const items = SP.parseMany(link.value);
      if (items.length > 1) { takeMany(link.value); return; }
      const item = items[0] || SP.parseLink(link.value);
      if (!item) {
        api.notify({ app: 'Spotify', icon: 'alert', title: 'That is not a Spotify link',
          message: 'Paste a playlist, album, track or podcast link from Spotify.' });
        return;
      }
      play(item);
    }

    /* several links at once: they all go to the library, and the first opens */
    function takeMany(text) {
      const items = SP.parseMany(text);
      if (!items.length) return;
      const r = SP.saveMany(store, items);
      paintSide();
      play(items[0]);
      say(`Added ${r.added} link${r.added === 1 ? '' : 's'} to your library${r.had ? `; ${r.had} ${r.had === 1 ? 'was' : 'were'} already there` : ''}.`, 'check');
    }

    /* the player follows the light or dark theme */
    let lastTheme = themeNow();
    const mo = typeof MutationObserver === 'function'
      ? new MutationObserver(() => { const t = themeNow(); if (t !== lastTheme) { lastTheme = t; if (S.view === 'player' && S.current) play(S.current); } })
      : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /* ---------------- sidebar -------------- */
    function paintSide() {
      const mine = SP.saved(store);
      const study = SP.study(store);
      const rowFor = (it, savedRow) => {
        const on = S.current && S.current.kind === it.kind && S.current.id === it.id;
        const isStudy = savedRow && study && SP.same(study, it);
        const row = h('div.sp-item', {
          role: 'button', tabindex: '0', class: on ? 'is-on' : null, 'data-id': it.id,
          onclick: () => play(it),
          onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(it); } },
        }, icon(it.kind === 'track' ? 'music' : it.kind === 'show' ? 'mic' : 'list-music'),
           h('span.sp-item__n', { text: nameOf(it) }),
           isStudy ? h('span.sp-item__tag', { title: 'Opens when you press Study', text: 'Study' }) : null);
        if (savedRow) {
          row.appendChild(h('button.ibtn.sp-item__x', {
            type: 'button', 'aria-label': `Options for ${nameOf(it)}`, 'data-role': 'sp-row-menu',
            onclick: e => { e.stopPropagation(); rowMenu(it, e.currentTarget); },
          }, icon('more-horizontal')));
        }
        return row;
      };

      const loose = mine.filter(r => !r.folder);
      const groups = SP.folders(mine);
      api.render(side,
        h('div.label', { text: 'Your library' }),
        mine.length
          ? h('div.col', { style: { gap: '1px' } },
              loose.map(it => rowFor(it, true)),
              groups.map(g => {
                const inside = mine.filter(r => r.folder === g);
                const shut = S.closed.has(g);
                return h('div.sp-folder', { 'data-folder': g },
                  h('button.sp-folder__h', {
                    type: 'button', 'aria-expanded': String(!shut),
                    onclick: () => { if (S.closed.has(g)) S.closed.delete(g); else S.closed.add(g); paintSide(); },
                  }, icon(shut ? 'chevron-right' : 'chevron-down', { size: 12 }), icon('folder', { size: 13 }),
                  h('span.sp-item__n', { text: g }), h('small', { text: String(inside.length) })),
                  shut ? null : inside.map(it => rowFor(it, true)));
              }))
          : h('small.dim', { style: { padding: '0 var(--sp-3)' },
              text: 'Paste a link and press + to keep it here.' }),
        h('div.label', { style: { marginTop: 'var(--sp-3)' }, text: 'Browse' }),
        h('div.col', { style: { gap: '1px' } }, SP.STARTERS.map(it => rowFor(it, false))));
    }

    function rowMenu(it, btn) {
      const r = btn.getBoundingClientRect();
      const study = SP.study(store);
      const isStudy = study && SP.same(study, it);
      api.menu([
        { label: 'Rename…', icon: 'edit-3', onClick: () => renameSheet(it) },
        { label: 'Move to a folder…', icon: 'folder', onClick: () => folderSheet(it) },
        { label: 'Send to a friend…', icon: 'send', onClick: () => sendSheet(it) },
        { label: isStudy ? 'Not my study playlist' : 'Use for Study', icon: 'clock',
          onClick: () => { SP.setStudy(store, isStudy ? null : it); paintSide(); } },
        '-',
        { label: 'Remove from library', icon: 'trash', danger: true, onClick: () => { SP.forget(store, it); paintSide(); } },
      ], r.left, r.bottom + 4);
    }

    /* a friend added something, or Settings restored a backup */
    const offSaved = api.bus.on('media:saved', d => { if (d?.app === 'spotify' && S.alive) paintSide(); });

    win.onReopen(o => { const it = o?.link && SP.parseLink(o.link); if (it) play(it); });
    return () => {
      S.alive = false; clearTimeout(S.timer); stopPreview(); mo?.disconnect(); offSaved?.();
      try { S.ctl?.destroy?.(); } catch (err) { /* gone */ }
    };
  },
});
