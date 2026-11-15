/* ============================================================
   music-books.js — the Audiobooks page of Music.

   Search LibriVox's public-domain recordings (core/librivox.js, through
   archive.org), open one to see its chapters, its readers and its credit,
   and play it: the book plays in Music's one player, so the queue, the
   widget rail, media keys, speed (the sound row) and the sleep timer all
   work on it. Where you stopped is kept for each book and Resume goes
   straight back to it.

   createAudiobooks({ h, icon, host }) -> { el, sync(), dispose() }
     host.state()               -> { id, ch, playing } of the book now loaded, or null
     host.play(book, ch, at)    start a chapter (at, in seconds)
     host.toggle()              play / pause
   Everything that came from archive.org is set as text, never HTML.
   ============================================================ */
import * as LV from '../core/librivox.js';
import { t } from '../core/i18n.js';

const CSS = `
.ab{display:flex;flex-direction:column;gap:var(--sp-4);padding:var(--sp-3) 0;color:var(--ink-1);font-size:var(--fs-13)}
.ab *{box-sizing:border-box}
.ab h2{font-size:var(--fs-13);margin:var(--sp-3) 0 var(--sp-2);color:var(--ink-0)}
.ab__form{display:flex;gap:var(--sp-3);flex-wrap:wrap}
.ab__form input{flex:1 1 200px;min-width:0;height:30px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 var(--sp-3);color:inherit;font:inherit}
.ab button:focus-visible,.ab input:focus-visible,.ab a:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ab__list{display:flex;flex-direction:column;border:1px solid var(--line-2);border-radius:var(--r-md,10px);overflow:hidden}
.ab__row{display:flex;align-items:center;gap:var(--sp-3);padding:8px var(--sp-3);border-top:1px solid var(--line-1);background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;color:inherit;font:inherit;cursor:pointer;width:100%}
.ab__row:first-child{border-top:0}
.ab__row:hover{background:var(--fill-2)}
.ab__row.is-on{background:var(--fill-2);box-shadow:inset 3px 0 0 var(--accent)}
.ab__row>span{flex:1;min-width:0}
.ab__row b{display:block;font-weight:600;color:var(--ink-0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab__row small,.ab small{color:var(--ink-2)}
.ab__row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab__head{display:flex;gap:var(--sp-4);align-items:flex-start}
.ab__cover{width:96px;aspect-ratio:1;flex:none;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-2);object-fit:cover;display:grid;place-items:center;color:var(--ink-2);overflow:hidden}
.ab__head h1{margin:0 0 2px;font-size:var(--fs-15);color:var(--ink-0)}
.ab__head>div{min-width:0;flex:1}
.ab__credit{border-left:3px solid var(--accent);background:var(--fill-2);padding:var(--sp-2) var(--sp-3);font-size:var(--fs-12)}
.ab__credit a{color:var(--accent)}
.ab__acts{display:flex;gap:var(--sp-3);flex-wrap:wrap;margin-top:var(--sp-3)}
.ab__msg{padding:var(--sp-3);color:var(--ink-2)}
.ab__msg[data-kind=error]{color:var(--danger,#ef5b5b)}
.ab__about{white-space:pre-wrap;color:var(--ink-1);max-height:9em;overflow:auto}
.ab .icon{display:inline-flex;width:16px;height:16px;flex:none}.ab .icon svg{width:100%;height:100%}
.ab__row .ab__len{flex:none;color:var(--ink-2);font-variant-numeric:tabular-nums}
`;

const fmtLen = s => {
  if (!(s > 0)) return '';
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(Math.floor(s % 60)).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export function createAudiobooks({ h, icon, host }) {
  let dead = false;
  let ctl = null;                       /* the request in flight */
  const S = { mode: 'home', book: null, results: null, query: '', status: '', popular: null, busy: false };
  const el = h('div.ab', { dataset: { role: 'audiobooks' } });
  const style = h('style', { text: CSS });

  const abort = () => { if (ctl) ctl.abort(); ctl = new AbortController(); return ctl.signal; };
  const failText = err => (err instanceof LV.LibriVoxError ? err.message : 'Something went wrong reaching archive.org.');

  async function doSearch(text) {
    S.query = text.trim();
    S.mode = 'home';
    S.busy = true; S.status = S.query ? `Searching LibriVox for “${S.query}”…` : 'Asking archive.org for the most listened-to recordings…';
    paint();
    try {
      const r = await LV.search(S.query, { signal: abort() });
      if (dead) return;
      S.results = r; S.status = '';
      if (!S.query) S.popular = r;
    } catch (err) {
      if (dead || (err && err.name === 'AbortError')) return;
      S.results = null; S.status = failText(err); S.err = true;
    }
    S.busy = false;
    paint();
  }

  async function openBook(id) {
    S.busy = true; S.status = 'Opening the recording…'; S.err = false;
    paint();
    try {
      const book = await LV.loadBook(id, { signal: abort() });
      if (dead) return;
      S.book = book; S.mode = 'book'; S.status = '';
    } catch (err) {
      if (dead || (err && err.name === 'AbortError')) return;
      S.status = failText(err); S.err = true;
    }
    S.busy = false;
    paint();
  }

  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

  function paint() {
    if (dead) return;
    el.replaceChildren(style);
    if (S.mode === 'book' && S.book) { paintBook(); return; }
    const input = h('input', { type: 'search', placeholder: t('Search LibriVox: a title or an author'), 'aria-label': t('Search audiobooks'), value: S.query, 'data-ab-search': '' });
    const form = h('form.ab__form', { onsubmit: e => { e.preventDefault(); doSearch(input.value); } }, input,
      h('button.btn.btn--primary', { type: 'submit', 'data-act': 'ab-search' }, icon('search'), t('Search')));
    el.append(h('p', { text: t('Free audiobooks read by volunteers: LibriVox recordings of books whose copyright has ended, played from archive.org.') }), form);
    const mine = LV.shelf();
    if (mine.length && !S.query) {
      el.append(h('h2', { text: t('Continue listening') }));
      const list = h('div.ab__list', { 'data-shelf': '' });
      for (const b of mine.slice(0, 8)) {
        list.append(h('button.ab__row', { type: 'button', 'data-id': b.id, onclick: () => openBook(b.id) }, icon('play'),
          h('span', h('b', { text: b.title }), h('small', { text: `${b.author || 'LibriVox'} · ${b.done ? 'finished' : `chapter ${(b.ch || 0) + 1} of ${b.chapters || '?'}`}` }))));
      }
      el.append(list);
    }
    if (S.status) el.append(h('div.ab__msg', { role: 'status', 'data-kind': S.err ? 'error' : '', text: S.status }),
      S.err ? h('button.btn.btn--sm', { type: 'button', onclick: () => doSearch(S.query) }, icon('refresh'), t('Try again')) : null);
    const res = S.results;
    if (res && !S.busy) {
      el.append(h('h2', { text: S.query ? `${res.total.toLocaleString()} recording${res.total === 1 ? '' : 's'} for “${S.query}”` : t('Most listened to on LibriVox') }));
      if (!res.books.length) el.append(h('div.ab__msg', { text: t('Nothing matched. Try a shorter title, or an author’s surname.') }));
      else {
        const list = h('div.ab__list', { 'data-results': '' });
        for (const b of res.books) {
          list.append(h('button.ab__row', { type: 'button', 'data-id': b.id, onclick: () => openBook(b.id) }, icon('list-music'),
            h('span', h('b', { text: b.title }), h('small', { text: [b.author, b.runtime].filter(Boolean).join(' · ') }))));
        }
        el.append(list);
      }
    }
    el.append(h('p.ab__credit', { text: t('Recordings by LibriVox volunteers, in the public domain. Hosted by the Internet Archive (archive.org).') }));
    if (!S.results && !S.busy && !S.status) doSearch('');
  }

  function paintBook() {
    const b = S.book;
    const here = LV.placeOf(b.id);
    const st = host.state();
    const playingThis = st && st.id === b.id;
    const back = h('button.btn.btn--sm', { type: 'button', 'data-act': 'ab-back', onclick: () => { S.mode = 'home'; S.book = null; paint(); } }, icon('arrow-left'), t('Audiobooks'));
    const cover = h('img.ab__cover', { src: b.cover, alt: '', loading: 'lazy', onerror: e => { e.target.replaceWith(h('div.ab__cover', icon('list-music'))); } });
    const resumeAt = here && !here.done && b.chapters[here.ch] ? here : null;
    const acts = h('div.ab__acts',
      h('button.btn.btn--primary', { type: 'button', 'data-act': 'ab-play', onclick: () => (playingThis ? host.toggle() : host.play(b, resumeAt ? resumeAt.ch : 0, resumeAt ? resumeAt.t : 0)) },
        icon(playingThis && st.playing ? 'pause' : 'play', { fill: true }),
        playingThis && st.playing ? t('Pause') : playingThis ? t('Play') : resumeAt ? `Resume chapter ${resumeAt.ch + 1}` : t('Listen from the start')),
      here ? h('button.btn.btn--sm', { type: 'button', 'data-act': 'ab-forget', onclick: () => { LV.forget(b.id); paint(); } }, icon('trash'), t('Forget my place')) : null);
    el.append(back,
      h('div.ab__head', cover, h('div', h('h1', { text: b.title }), h('div', { text: b.author ? t('by {author}', { author: b.author }) : '' }),
        h('small', { text: [b.runtime, `${b.chapters.length} chapter${b.chapters.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') }), acts)),
      h('div.ab__credit', { 'data-credit': '' },
        h('div', { text: `Read by ${b.readers || 'LibriVox volunteers'}. A LibriVox recording, in the public domain.` }),
        h('div', t('Find the book and its readers at '), b.librivoxUrl ? link(b.librivoxUrl, 'its LibriVox page') : link('https://librivox.org/', 'librivox.org'), t(', or '), link(b.archiveUrl, 'archive.org'), '.')),
      b.about ? h('div.ab__about', { text: b.about }) : null,
      h('h2', { text: t('Chapters') }));
    const list = h('div.ab__list', { 'data-chapters': '' });
    b.chapters.forEach((c, i) => {
      const on = playingThis && st.ch === i;
      const seen = here && (i < here.ch || (here.done));
      list.append(h('button.ab__row', { type: 'button', class: on ? 'is-on' : null, 'data-ch': String(i), 'aria-current': on ? 'true' : null,
        onclick: () => (on ? host.toggle() : host.play(b, i, here && here.ch === i && !here.done ? here.t : 0)) },
        icon(on && st.playing ? 'pause' : 'play', { fill: true }),
        h('span', h('b', { text: c.title }), h('small', { text: on ? (st.playing ? 'Playing' : 'Paused') : seen ? t('Listened') : here && here.ch === i ? `Stopped at ${fmtLen(here.t)}` : '' })),
        h('span.ab__len', { text: fmtLen(c.len) })));
    });
    el.append(list);
  }

  /** the player changed: repaint the book page so the playing chapter shows */
  function sync() {
    if (dead || S.mode !== 'book' || !S.book) return;
    const st = host.state();
    const sig = st ? `${st.id}|${st.ch}|${st.playing}` : '';
    if (sig === S.sig) return;
    S.sig = sig;
    const top = el.parentElement ? el.parentElement.scrollTop : 0;
    paint();
    if (el.parentElement) el.parentElement.scrollTop = top;
  }

  paint();
  return { el, sync, dispose() { dead = true; if (ctl) ctl.abort(); } };
}
