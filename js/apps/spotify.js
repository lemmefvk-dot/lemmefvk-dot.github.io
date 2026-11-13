/* ============================================================
   Spotify — the real player, through Spotify's official embed.
   See js/portal/spotify.js for what the embed can and cannot do.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as SP from '../portal/spotify.js';
import { BRAND } from '../portal/brand.js';

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
    };

    const stage = h('div.sp__stage');
    const side = h('aside.sp__side');
    const link = h('input', {
      type: 'text', spellcheck: 'false',
      placeholder: 'Paste a Spotify link — playlist, album, track or podcast',
      'aria-label': 'Spotify link',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); openTyped(); } },
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

    const bar = h('div.sp__bar',
      h('div.field.sp__find', icon('search'), find),
      h('div.field', icon('link'), link),
      h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: openTyped },
        icon('play', { size: 13, fill: true }), 'Open'),
      h('button.btn.btn--sm.tip', {
        type: 'button', 'data-tip': 'Save to your library', 'aria-label': 'Save to your library',
        onclick: () => { if (S.current) { SP.save(store, S.current); paintSide(); } },
      }, icon('plus', { size: 13 })),
      h('button.btn.btn--sm.btn--ghost.tip', {
        type: 'button', 'data-tip': 'Copy Spotify link', 'aria-label': 'Copy Spotify link',
        onclick: async () => {
          if (!S.current) return;
          try { await navigator.clipboard.writeText(SP.openUrl(S.current)); } catch (err) { /* optional */ }
        },
      }, icon('copy', { size: 13 })));

    root.appendChild(h('div.sp', side, h('div.sp__main', bar, stage)));

    paintSide();
    const first = opts?.link ? SP.parseLink(opts.link) : null;
    play(first || SP.STARTERS[0]);

    /* ---------------- search ----------------
       Apple's catalogue, because Spotify's search needs a token that cannot
       live in a static site. Results carry Apple's own 30-second preview,
       which plays here; the full track hands off to Spotify. */
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
        art.appendChild(h('div.sp-res__ctl', previewButton(row)));

        grid.appendChild(h('div.sp-res', {
          role: 'button', tabindex: '0',
          'aria-label': `${row.title}${row.artist ? ` by ${row.artist}` : ''} — open in Spotify`,
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
    function play(item) {
      if (!item || !S.alive) return;
      S.current = item;
      link.value = SP.openUrl(item);
      const one = !SP.isCollection(item.kind);
      api.render(stage,
        h('iframe', {
          class: one ? 'sp__frame sp__frame--one' : 'sp__frame',
          src: SP.embedUrl(item),
          title: `Spotify ${item.kind}`,
          allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
        }),
        h('div.sp__note', {
          text: 'This is Spotify’s own player. Signed in to Spotify in this browser you get full '
              + 'tracks; signed out, Spotify plays 30-second previews. Either way the frame is theirs, '
              + `so ${BRAND.name} cannot read what is playing — the desktop widget stays on the local player.`,
        }));
      win.setSubtitle(item.name || item.kind);
      paintSide();
    }

    function openTyped() {
      const item = SP.parseLink(link.value);
      if (!item) {
        api.notify({ app: 'Spotify', icon: 'alert', title: 'That is not a Spotify link',
          message: 'Paste a playlist, album, track or podcast link from Spotify.' });
        return;
      }
      play(item);
    }

    /* ---------------- sidebar -------------- */
    function paintSide() {
      const mine = SP.saved(store);
      const rowFor = (it, savedRow) => {
        const on = S.current && S.current.kind === it.kind && S.current.id === it.id;
        const row = h('button.sp-item', {
          type: 'button', class: on ? 'is-on' : null,
          onclick: () => play(it),
        }, icon(it.kind === 'track' ? 'music' : it.kind === 'show' ? 'mic' : 'list-music'),
           h('span.sp-item__n', { text: it.name || `${it.kind} · ${it.id.slice(0, 8)}` }));
        if (savedRow) {
          row.appendChild(h('span.ibtn.sp-item__x', {
            role: 'button', tabindex: '0', 'aria-label': 'Remove',
            onclick: e => { e.stopPropagation(); SP.forget(store, it); paintSide(); },
          }, icon('x')));
        }
        return row;
      };

      api.render(side,
        h('div.label', { text: 'Your library' }),
        mine.length
          ? h('div.col', { style: { gap: '1px' } }, mine.map(it => rowFor(it, true)))
          : h('small.dim', { style: { padding: '0 var(--sp-3)' },
              text: 'Paste a link and press + to keep it here.' }),
        h('div.label', { style: { marginTop: 'var(--sp-3)' }, text: 'Browse' }),
        h('div.col', { style: { gap: '1px' } }, SP.STARTERS.map(it => rowFor(it, false))));
    }

    win.onReopen(o => { const it = o?.link && SP.parseLink(o.link); if (it) play(it); });
    return () => { S.alive = false; clearTimeout(S.timer); stopPreview(); };
  },
});
