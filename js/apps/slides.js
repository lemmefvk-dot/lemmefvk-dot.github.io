/* ============================================================
   slides.js — Static Slides: presentations for school.

   A deck is a file, a .slides in Files (JSON text, kept in Documents), saved
   as you type. Slides have a title layout, a title-and-text layout (rows that
   start with "-" are bullets) and a title-and-picture layout (a picture from
   Files); six themes (Paper, Night, Ocean, Sunset, Forest, Mono); notes for
   each slide. Add, duplicate, delete (with Undo) and move slides.

   PRESENT (F5) shows the deck full screen: Right, Space, Page Down or Enter go
   on; Left, Page Up or Backspace go back; Home and End jump; B blanks the
   screen; Esc leaves. PRESENTER VIEW opens a second browser window (so it can
   be dragged to the laptop while the show is on the projector) with the slide,
   the next slide, your notes, a timer that starts when you press Start, and
   the same keys. It needs the browser to allow the pop-up, and says so when it
   doesn't. EXPORT PDF writes a new PDF to Files with a picture of each slide
   (the words in it can't be selected: it is pictures, not text).

   One routine draws every slide (core/slidesdraw.js): the preview, the
   thumbnails, the show, the presenter view and the PDF are the same picture.
   Everything from a file is set as text, never HTML. Saved through the files
   system; nothing else is kept, and nothing leaves the device.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import vfs from '../core/vfs.js';
import media from '../core/media.js';
import { makePdf } from '../core/pdfwrite.js';
import * as D from '../core/slidesdraw.js';

const DIR = `${vfs.HOME}/Documents`;
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

const CSS = `
.sl{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1);font-size:var(--fs-13);position:relative}
.sl *{box-sizing:border-box}
.sl button,.sl input,.sl select,.sl textarea{font:inherit;color:inherit}
.sl__top{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.sl__top h1{font-size:var(--fs-15);margin:0;color:var(--ink-0)}
.sl__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.sl__btn:disabled{opacity:.45;cursor:default}
.sl .sl__btn--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600}
/* the four accents whose white ink reads below 4.5:1 get the dark ink here, as Markets does */
:root:is([data-accent=aether],[data-accent=azure],[data-accent=violet],[data-accent=pink]):not([data-contrast=high]) .sl{--accent-ink:#14060a}
.sl .icon{display:inline-flex;width:16px;height:16px;flex:none}.sl .icon svg{width:100%;height:100%}
.sl button:focus-visible,.sl input:focus-visible,.sl select:focus-visible,.sl textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.sl__msg{padding:var(--sp-2) var(--sp-4);font-size:var(--fs-12);background:var(--fill-1);border-bottom:1px solid var(--line-1);display:flex;gap:var(--sp-3);align-items:center}
.sl__msg[hidden]{display:none}
.sl__msg[data-kind=error]{color:var(--danger,#ef5b5b)}
.sl__top input[type=text],.sl__field input[type=text],.sl__field textarea,.sl__field select,.sl__top select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 var(--sp-3);min-width:0}
.sl__top input[data-deck-title]{flex:1 1 160px;max-width:320px}
.sl__home{flex:1;min-height:0;overflow:auto;padding:var(--sp-4)}
.sl__home h2{font-size:var(--fs-13);margin:var(--sp-4) 0 var(--sp-3);color:var(--ink-0)}
.sl__rows{display:flex;flex-direction:column;border:1px solid var(--line-2);border-radius:var(--r-md,10px);overflow:hidden}
.sl__row{display:flex;align-items:center;gap:var(--sp-3);padding:6px var(--sp-3);border-top:1px solid var(--line-1)}
.sl__row:first-child{border-top:0}
.sl__row>span:not(.icon){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sl__row small{color:var(--ink-2)}
.sl__empty{padding:var(--sp-5);text-align:center;color:var(--ink-2)}
.sl__body{flex:1;display:flex;min-height:0}
.sl__side{width:200px;flex:none;border-right:1px solid var(--line-1);display:flex;flex-direction:column;min-height:0}
.sl__list{flex:1;overflow:auto;padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3)}
.sl__thumb{display:flex;gap:6px;align-items:flex-start;background:none;border:2px solid transparent;border-radius:6px;padding:3px;cursor:pointer;text-align:left}
.sl__thumb[aria-current=true]{border-color:var(--accent);background:var(--fill-2)}
.sl__thumb canvas{width:150px;height:84px;display:block;border-radius:3px;border:1px solid var(--line-2);flex:none}
.sl__thumb b{font-size:var(--fs-11,11px);color:var(--ink-2);font-weight:600;min-width:1.2em}
.sl__tools{display:flex;gap:4px;flex-wrap:wrap;padding:var(--sp-3);border-top:1px solid var(--line-1)}
.sl__tools .sl__btn{padding:0 8px}
.sl__main{flex:1;min-width:0;overflow:auto;padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4)}
.sl__stage{width:100%;max-width:760px;aspect-ratio:16/9;align-self:center;border:1px solid var(--line-2);border-radius:6px;overflow:hidden;background:#000;flex:none}
.sl__stage canvas{display:block;width:100%;height:100%}
.sl__field{display:flex;flex-direction:column;gap:4px;max-width:760px;width:100%;align-self:center}
.sl__field label{font-weight:600;color:var(--ink-0)}
.sl__field textarea{height:auto;padding:var(--sp-2) var(--sp-3);resize:vertical;line-height:1.4}
.sl__field small{color:var(--ink-2)}
.sl__show{position:absolute;inset:0;z-index:5;background:#000;display:flex;align-items:center;justify-content:center}
.sl__show[hidden]{display:none}
.sl__show canvas{display:block;max-width:100%;max-height:100%}
.sl__show[data-blank=true] canvas{visibility:hidden}
.sl__hint{position:absolute;left:0;right:0;bottom:8px;text-align:center;color:#fff;opacity:.55;font-size:var(--fs-12);pointer-events:none}
@media (max-width:640px){.sl__side{width:120px}.sl__thumb canvas{width:92px;height:52px}}
`;

const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const stemOf = n => n.replace(/\.[^.]+$/, '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'slides';
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

defineApp({
  id: 'slides',
  name: 'Static Slides',
  icon: 'present',
  g1: '#ff8a3d', g2: '#c2410c',
  category: 'Productivity',
  keywords: ['slides', 'presentation', 'powerpoint', 'keynote', 'deck', 'present', 'presenter', 'speaker notes', 'school', 'slideshow', 'pdf', 'theme'],
  desc: 'Make presentations: themes, speaker notes, a presenter view with a timer in a second window, full screen keys and PDF export',
  singleton: true,
  exts: ['slides'],
  win: { w: 1020, h: 700, minW: 520, minH: 440 },
  shortcuts: [['Mod+S', 'Save now (it also saves as you type)'], ['F5', 'Present full screen'], ['Shift+F5', 'Present with the presenter view'],
    ['Right / Space / Enter', 'Next slide while presenting'], ['Left / Backspace', 'Previous slide while presenting'], ['Home / End', 'First / last slide'],
    ['B', 'Blank the screen'], ['Esc', 'Leave the show'], ['Up / Down', 'Pick a slide in the list']],

  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const S = { path: null, deck: null, cur: 0, saved: true, undo: null, show: false, blank: false, popup: null, t0: 0, tPause: 0, running: false };

  const msg = h('div.sl__msg', { hidden: true, role: 'status' });
  const say = (text, kind, acts) => { msg.replaceChildren(h('span', { text: text || '' }), ...(acts || [])); msg.hidden = !text; msg.dataset.kind = kind || ''; };
  const top = h('div.sl__top');
  const content = h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
  const showEl = h('div.sl__show', { hidden: true, tabindex: '-1', 'aria-label': 'Slide show' });
  const shell = h('div.sl', h('style', { text: CSS }), top, msg, content, showEl);
  root.replaceChildren(shell);

  /* ---------------- pictures from Files ---------------- */
  const images = new Map();               /* path -> loaded image */
  const loading = new Set();
  function wantImage(path) {
    if (!path || images.has(path) || loading.has(path)) return;
    loading.add(path);
    media.urlOf(path).then(url => {
      if (!url) throw new Error('no bytes');
      const im = new Image();
      im.onload = () => { loading.delete(path); images.set(path, im); if (!dead) { paintAllCanvases(); } };
      im.onerror = () => { loading.delete(path); };
      im.src = url;
    }).catch(() => loading.delete(path));
  }
  const imagesInFiles = () => {
    const out = [];
    vfs.walk(vfs.HOME, (n, p) => {
      if (p.startsWith(`${vfs.HOME}/Trash`)) return;
      if (n.type === 'file' && IMG_EXT.has(extOf(n.name)) && media.isMedia(n)) out.push({ path: p, name: n.name });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  };

  /* ---------------- decks in Files ---------------- */
  const decksInFiles = () => {
    const out = [];
    vfs.walk(vfs.HOME, (n, p) => {
      if (p.startsWith(`${vfs.HOME}/Trash`)) return;
      if (n.type === 'file' && extOf(n.name) === 'slides') out.push({ path: p, name: n.name, size: n.size || 0, mtime: n.mtime });
    });
    return out.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
  };
  function uniquePath(dir, name) {
    let nm = name, i = 2;
    while (vfs.node(`${dir}/${nm}`)) nm = `${stemOf(name)} ${i++}.slides`;
    return `${dir}/${nm}`;
  }
  function newDeckFile() {
    if (!vfs.node(DIR)) vfs.mkdir(DIR);
    const deck = D.newDeck();
    const path = uniquePath(DIR, 'Untitled slides.slides');
    vfs.write(path, D.stringifyDeck(deck));
    api.bus.emit('file:saved', { path, app: 'slides' });
    openDeck(path);
  }
  function openDeck(path) {
    const n = vfs.node(path);
    if (!n || n.type !== 'file') { say('That deck is no longer in Files.', 'error'); return; }
    let deck;
    try { deck = D.parseDeck(vfs.read(path) || ''); } catch (err) { say(err.message, 'error'); return; }
    leaveShow();
    S.path = path; S.deck = deck; S.cur = 0; S.saved = true; S.undo = null;
    say('');
    for (const sl of deck.slides) wantImage(sl.img);
    paint();
  }

  let saveT = 0;
  function save(now) {
    if (!S.deck) return true;
    clearTimeout(saveT);
    if (!now) { saveT = later(() => save(true), 400); S.saved = false; paintStatus(); return true; }
    try {
      const text = D.stringifyDeck(S.deck);
      if (vfs.read(S.path) !== text) { vfs.write(S.path, text); api.bus.emit('file:saved', { path: S.path, app: 'slides' }); }
      S.saved = true;
      say('');
    } catch (err) {
      say('Couldn’t save the deck: this browser’s file storage is full. Export it as a PDF, or free some space in Files.', 'error');
      return false;
    }
    paintStatus();
    return true;
  }

  /* ============================================================
     HOME: pick or make a deck
     ============================================================ */
  function paintHome() {
    top.replaceChildren(h('h1', { text: 'Slides' }),
      h('button.sl__btn.sl__btn--go', { type: 'button', 'data-act': 'new-deck', onclick: newDeckFile }, icon('plus'), 'New presentation'));
    const decks = decksInFiles();
    const home = h('div.sl__home', h('p', { text: 'Make a presentation with themes and speaker notes, show it full screen, and export it as a PDF. Decks are .slides files in your Documents.' }),
      h('h2', { text: `Your presentations · ${decks.length}` }));
    if (!decks.length) home.append(h('div.sl__empty', { text: 'No presentations yet.' }));
    else {
      const rows = h('div.sl__rows');
      for (const d of decks) {
        rows.append(h('div.sl__row', { 'data-path': d.path }, icon('present'), h('span', { text: stemOf(d.name), title: d.path }),
          h('small', { text: new Date(d.mtime).toLocaleDateString() }),
          h('button.sl__btn', { type: 'button', 'data-act': 'open-deck', onclick: () => openDeck(d.path) }, 'Open')));
      }
      home.append(rows);
    }
    content.replaceChildren(home);
    win.setSubtitle && win.setSubtitle('');
  }

  /* ============================================================
     EDITOR
     ============================================================ */
  const slide = () => S.deck.slides[S.cur];
  let previewC = null, thumbs = [], listEl = null, fields = {}, statusEl = null;

  function drawTo(canvas, sl, i) {
    const ctx = canvas.getContext('2d');
    D.drawSlide(ctx, sl, S.deck, { w: canvas.width, h: canvas.height, n: i + 1, total: S.deck.slides.length, images });
  }
  function paintAllCanvases() {
    if (dead || !S.deck) return;
    if (previewC) drawTo(previewC, slide(), S.cur);
    thumbs.forEach((c, i) => { if (S.deck.slides[i]) drawTo(c, S.deck.slides[i], i); });
    if (S.show) drawShow();
    drawPresenter();
  }

  function paintStatus() {
    if (statusEl) statusEl.textContent = S.saved ? 'Saved' : 'Saving…';
  }

  function paint() {
    if (!S.deck) { paintHome(); return; }
    const deck = S.deck;
    statusEl = h('small', { 'data-status': '', 'aria-live': 'polite' });
    top.replaceChildren(
      h('button.sl__btn', { type: 'button', 'data-act': 'home', onclick: () => { save(true); leaveShow(); closePopup(); S.deck = null; S.path = null; paint(); } }, icon('arrow-left'), 'Decks'),
      h('input', { type: 'text', 'data-deck-title': '', value: deck.title, 'aria-label': 'Presentation title', maxlength: 200, oninput: e => { deck.title = e.target.value; save(); win.setTitle(deck.title || 'Static Slides'); } }),
      h('select', { 'aria-label': 'Theme', 'data-act': 'theme', onchange: e => { deck.theme = e.target.value; save(); paintAllCanvases(); } },
        D.THEMES.map(t => h('option', { value: t.id, text: t.name, selected: deck.theme === t.id }))),
      h('button.sl__btn.sl__btn--go', { type: 'button', 'data-act': 'present', title: 'Present (F5)', onclick: () => present(false) }, icon('play', { fill: true }), 'Present'),
      h('button.sl__btn', { type: 'button', 'data-act': 'presenter', title: 'Present with the presenter view (Shift+F5)', onclick: () => present(true) }, icon('window'), 'Presenter view'),
      h('button.sl__btn', { type: 'button', 'data-act': 'pdf', onclick: exportPdf }, icon('download'), 'Export PDF'),
      h('button.sl__btn', { type: 'button', 'data-act': 'save', title: 'Save now (Ctrl or Cmd+S)', onclick: () => save(true) }, icon('save'), 'Save'),
      statusEl);
    paintStatus();
    win.setTitle(deck.title || 'Static Slides');

    listEl = h('div.sl__list', { role: 'listbox', 'aria-label': 'Slides' });
    const tb = (label, ic, act, fn, dis) => h('button.sl__btn', { type: 'button', 'aria-label': label, title: label, 'data-act': act, disabled: dis || null, onclick: fn }, icon(ic));
    const side = h('div.sl__side', listEl, h('div.sl__tools',
      tb('Add a slide', 'plus', 'add', addSlide), tb('Duplicate this slide', 'copy', 'dup', dupSlide),
      tb('Move up', 'arrow-up', 'up', () => moveSlide(-1), S.cur === 0), tb('Move down', 'arrow-down', 'down', () => moveSlide(1), S.cur === deck.slides.length - 1),
      tb('Delete this slide', 'trash', 'del', delSlide, deck.slides.length < 2)));

    previewC = h('canvas', { width: 1280, height: 720, role: 'img', 'aria-label': 'Slide preview', 'data-preview': '' });
    const f = fields = {};
    f.layout = h('select', { 'data-f': 'layout', 'aria-label': 'Layout', onchange: e => { slide().layout = e.target.value; edited(); paintFields(); } },
      D.LAYOUTS.map(([id, nm]) => h('option', { value: id, text: nm })));
    f.title = h('input', { type: 'text', 'data-f': 'title', 'aria-label': 'Slide title', maxlength: 300, oninput: e => { slide().title = e.target.value; edited(); } });
    f.body = h('textarea', { 'data-f': 'body', 'aria-label': 'Slide text', rows: 6, maxlength: 6000, oninput: e => { slide().body = e.target.value; edited(); } });
    f.img = h('select', { 'data-f': 'img', 'aria-label': 'Picture', onchange: e => { slide().img = e.target.value; wantImage(slide().img); edited(); } });
    f.notes = h('textarea', { 'data-f': 'notes', 'aria-label': 'Speaker notes', rows: 5, maxlength: 6000, placeholder: 'What you will say. Only you see this, in the presenter view.', oninput: e => { slide().notes = e.target.value; edited(); drawPresenter(); } });
    const field = (label, el, hint) => h('div.sl__field', h('label', { text: label }), el, hint ? h('small', { text: hint }) : null);
    f.imgBox = field('Picture', f.img, 'Pictures come from Files (png, jpg, webp or gif).');
    const main = h('div.sl__main', h('div.sl__stage', previewC),
      field('Layout', f.layout), field('Title', f.title),
      field('Text', f.body, 'Start a line with - to make a bullet.'), f.imgBox, field('Speaker notes', f.notes));
    content.replaceChildren(h('div.sl__body', side, main));
    paintList();
    paintFields();
    paintAllCanvases();
  }

  function paintList() {
    listEl.replaceChildren();
    thumbs = [];
    S.deck.slides.forEach((sl, i) => {
      const c = h('canvas', { width: 300, height: 169, 'aria-hidden': 'true' });
      thumbs.push(c);
      const b = h('button.sl__thumb', { type: 'button', role: 'option', 'data-i': String(i), 'aria-current': String(i === S.cur), 'aria-selected': String(i === S.cur), 'aria-label': `Slide ${i + 1}: ${sl.title || 'untitled'}`,
        onclick: () => select(i), onkeydown: e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(S.cur + 1, S.deck.slides.length - 1), true); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(S.cur - 1, 0), true); }
          else if (e.key === 'Delete') { e.preventDefault(); delSlide(); }
        } }, h('b', { text: String(i + 1) }), c);
      listEl.append(b);
    });
  }
  function paintFields() {
    const sl = slide(), f = fields;
    f.layout.value = sl.layout;
    if (document.activeElement !== f.title) f.title.value = sl.title;
    if (document.activeElement !== f.body) f.body.value = sl.body;
    if (document.activeElement !== f.notes) f.notes.value = sl.notes;
    f.imgBox.hidden = sl.layout !== 'picture';
    const imgs = imagesInFiles();
    f.img.replaceChildren(h('option', { value: '', text: imgs.length ? 'No picture' : 'No pictures in Files yet' }),
      ...(sl.img && !imgs.some(i => i.path === sl.img) ? [h('option', { value: sl.img, text: `${vfs.baseName(sl.img)} (missing)` })] : []),
      ...imgs.map(i => h('option', { value: i.path, text: i.name })));
    f.img.value = sl.img || '';
    wantImage(sl.img);
  }
  function select(i, focus) {
    S.cur = clamp(i, 0, S.deck.slides.length - 1);
    for (const b of listEl.children) { const on = Number(b.dataset.i) === S.cur; b.setAttribute('aria-current', String(on)); b.setAttribute('aria-selected', String(on)); }
    if (focus) listEl.children[S.cur].focus();
    for (const b of shell.querySelectorAll('.sl__tools [data-act]')) {
      if (b.dataset.act === 'up') b.disabled = S.cur === 0;
      if (b.dataset.act === 'down') b.disabled = S.cur === S.deck.slides.length - 1;
    }
    paintFields();
    drawTo(previewC, slide(), S.cur);
  }
  /* an edit: redraw this slide's preview and thumbnail, and save soon */
  function edited() {
    drawTo(previewC, slide(), S.cur);
    if (thumbs[S.cur]) drawTo(thumbs[S.cur], slide(), S.cur);
    const b = listEl.children[S.cur];
    if (b) b.setAttribute('aria-label', `Slide ${S.cur + 1}: ${slide().title || 'untitled'}`);
    if (S.show) drawShow();
    save();
  }
  function structure() { save(); paint(); }
  function addSlide() {
    const after = slide();
    S.deck.slides.splice(S.cur + 1, 0, D.newSlide(after && after.layout === 'title' ? 'bullets' : (after ? after.layout : 'bullets')));
    S.cur++;
    structure();
    fields.title.focus();
  }
  function dupSlide() { S.deck.slides.splice(S.cur + 1, 0, { ...slide() }); S.cur++; structure(); }
  function moveSlide(d) {
    const j = S.cur + d;
    if (j < 0 || j >= S.deck.slides.length) return;
    const s = S.deck.slides;
    [s[S.cur], s[j]] = [s[j], s[S.cur]];
    S.cur = j;
    structure();
  }
  function delSlide() {
    if (S.deck.slides.length < 2) return;
    const [gone] = S.deck.slides.splice(S.cur, 1);
    const at = S.cur;
    S.undo = { gone, at };
    S.cur = Math.min(S.cur, S.deck.slides.length - 1);
    structure();
    say('Slide deleted.', '', [h('button.sl__btn', { type: 'button', 'data-act': 'undo-delete', onclick: undoDelete }, icon('undo'), 'Undo')]);
  }
  function undoDelete() {
    if (!S.undo) return;
    S.deck.slides.splice(S.undo.at, 0, S.undo.gone);
    S.cur = S.undo.at; S.undo = null;
    say('');
    structure();
  }

  /* ============================================================
     THE SHOW
     ============================================================ */
  let showC = null;
  function present(withPresenter) {
    if (!S.deck) return;
    save(true);
    for (const sl of S.deck.slides) wantImage(sl.img);
    S.show = true; S.blank = false;
    showEl.hidden = false;
    showEl.dataset.blank = 'false';
    showC = h('canvas', { 'aria-label': 'Slide', role: 'img' });
    showEl.replaceChildren(showC, h('div.sl__hint', { text: 'Right or Space: next · Left: back · B: blank · Esc: leave' }));
    later(() => { const hint = showEl.querySelector('.sl__hint'); if (hint) hint.remove(); }, 4000);
    if (showEl.requestFullscreen) showEl.requestFullscreen().catch(() => {});
    showEl.focus();
    drawShow();
    if (withPresenter) openPresenter();
  }
  function drawShow() {
    if (!S.show || !showC) return;
    const box = showEl.getBoundingClientRect();
    const k = Math.min(box.width / D.W0, box.height / D.H0) || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(160, Math.floor(D.W0 * k)), hh = Math.max(90, Math.floor(D.H0 * k));
    showC.width = Math.round(w * dpr); showC.height = Math.round(hh * dpr);
    showC.style.width = `${w}px`; showC.style.height = `${hh}px`;
    drawTo(showC, slide(), S.cur);
    showEl.dataset.slide = String(S.cur);
    showEl.dataset.blank = String(S.blank);
  }
  function leaveShow() {
    if (!S.show) return;
    S.show = false;
    showEl.hidden = true;
    showEl.replaceChildren();
    showC = null;
    if (document.fullscreenElement === showEl) document.exitFullscreen().catch(() => {});
    if (S.popup && !S.popup.closed) { /* the presenter view stays: it is the speaker's own window */ }
  }
  function go(i) {
    const n = clamp(i, 0, S.deck.slides.length - 1);
    if (n === S.cur) return;
    S.cur = n;
    if (listEl && listEl.isConnected) select(n); else paintFields();
    drawShow();
    drawPresenter();
  }
  function showKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'Enter' || k === 'n' || k === 'N') go(S.cur + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'Backspace' || k === 'PageUp' || k === 'p' || k === 'P') go(S.cur - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(S.deck.slides.length - 1);
    else if (k === 'b' || k === 'B' || k === '.') { S.blank = !S.blank; drawShow(); }
    else if (k === 'Escape') leaveShow();
    else return false;
    e.preventDefault();
    return true;
  }
  showEl.addEventListener('keydown', e => { if (S.show) { showKey(e); e.stopPropagation(); } });
  showEl.addEventListener('click', e => { if (S.show) go(S.cur + (e.clientX < showEl.getBoundingClientRect().left + showEl.clientWidth / 4 ? -1 : 1)); });
  const onFs = () => { if (S.show && !document.fullscreenElement && S.fsWas) leaveShow(); S.fsWas = document.fullscreenElement === showEl; };
  document.addEventListener('fullscreenchange', onFs);
  const onResize = () => { if (S.show) drawShow(); };
  window.addEventListener('resize', onResize);

  /* ---------------- the presenter view: a second window ---------------- */
  const P = { cur: null, next: null, notes: null, clock: null, count: null, startBtn: null, size: 20 };
  function openPresenter() {
    if (S.popup && !S.popup.closed) { S.popup.focus(); drawPresenter(); return; }
    let pop = null;
    try { pop = window.open('', 'staticos-slides-presenter', 'popup=yes,width=1180,height=760'); } catch (e) { pop = null; }
    if (!pop) {
      say('Your browser blocked the second window. Allow pop-ups for this site, then press Presenter view again.', 'error');
      return;
    }
    S.popup = pop;
    const d = pop.document;
    d.open(); d.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Presenter view</title></head><body></body></html>'); d.close();
    const style = d.createElement('style');
    style.textContent = `
      :root{color-scheme:dark}
      *{box-sizing:border-box}
      body{margin:0;background:#12141a;color:#e9ecf4;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;height:100vh;display:grid;grid-template-columns:1.6fr 1fr;grid-template-rows:1fr auto;gap:14px;padding:14px}
      canvas{display:block;width:100%;height:auto;border-radius:6px;background:#000}
      .col{display:flex;flex-direction:column;gap:12px;min-height:0}
      .lab{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#9aa3b8;margin-bottom:4px}
      #clock{font-size:44px;font-weight:700;font-variant-numeric:tabular-nums}
      #notes{flex:1;min-height:0;overflow:auto;background:#1b1f29;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:20px;line-height:1.45}
      #bar{grid-column:1/3;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      button{font:inherit;color:inherit;background:#2a3040;border:1px solid #3a4258;border-radius:6px;padding:6px 14px;cursor:pointer}
      button:hover{background:#343c52}
      button:focus-visible{outline:2px solid #7aa2ff;outline-offset:1px}
      button.go{background:#2f6fed;border-color:#2f6fed;color:#fff}
      #count{margin-left:auto;color:#9aa3b8}
    `;
    d.head.append(style);
    P.cur = h('canvas', { width: 960, height: 540, 'aria-label': 'Current slide', role: 'img', id: 'cur' });
    P.next = h('canvas', { width: 480, height: 270, 'aria-label': 'Next slide', role: 'img', id: 'next' });
    P.notes = h('div', { id: 'notes', tabindex: '0', 'aria-label': 'Speaker notes' });
    P.clock = h('div', { id: 'clock', 'aria-label': 'Time spent', text: '0:00' });
    P.count = h('div', { id: 'count', 'aria-live': 'polite' });
    P.startBtn = h('button.go', { type: 'button', id: 'start', onclick: () => { toggleClock(); } }, 'Start timer');
    const btn = (t, fn, id) => h('button', { type: 'button', id, onclick: fn }, t);
    const left = h('div', { class: 'col' }, h('div', h('div', { class: 'lab', text: 'Now' }), P.cur));
    const right = h('div', { class: 'col' },
      h('div', h('div', { class: 'lab', text: 'Time' }), P.clock, h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } }, P.startBtn, btn('Reset', resetClock, 'reset'))),
      h('div', h('div', { class: 'lab', text: 'Next' }), P.next),
      h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } }, h('div', { class: 'lab', text: 'Notes' }), P.notes));
    const bar = h('div', { id: 'bar' }, btn('Previous', () => go(S.cur - 1), 'prev'), btn('Next', () => go(S.cur + 1), 'nextbtn'),
      btn('Blank', () => { S.blank = !S.blank; drawShow(); }, 'blank'), btn('Notes bigger', () => { P.size = Math.min(48, P.size + 4); drawPresenter(); }, 'bigger'), btn('Notes smaller', () => { P.size = Math.max(12, P.size - 4); drawPresenter(); }, 'smaller'), P.count);
    d.body.append(left, right, bar);
    d.addEventListener('keydown', e => { if (e.target && e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return; if (S.deck) showKey(e); });
    pop.addEventListener('pagehide', () => { if (S.popup === pop) S.popup = null; });
    S.t0 = 0; S.tPause = 0; S.running = false;
    drawPresenter();
  }
  function closePopup() { if (S.popup && !S.popup.closed) { try { S.popup.close(); } catch (e) { /* gone */ } } S.popup = null; }
  const elapsed = () => (S.running ? (Date.now() - S.t0) : S.tPause) / 1000;
  function toggleClock() {
    if (S.running) { S.tPause = Date.now() - S.t0; S.running = false; }
    else { S.t0 = Date.now() - S.tPause; S.running = true; tick(); }
    drawPresenter();
  }
  function resetClock() { S.running = false; S.tPause = 0; S.t0 = 0; drawPresenter(); }
  function tick() { if (!S.running || dead) return; later(() => { drawPresenter(); tick(); }, 500); }
  function drawPresenter() {
    const pop = S.popup;
    if (!pop || pop.closed || !S.deck || !P.cur) return;
    const sl = S.deck.slides[S.cur], nx = S.deck.slides[S.cur + 1];
    drawTo(P.cur, sl, S.cur);
    const ctx = P.next.getContext('2d');
    if (nx) drawTo(P.next, nx, S.cur + 1);
    else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#1b1f29'; ctx.fillRect(0, 0, P.next.width, P.next.height); ctx.fillStyle = '#9aa3b8'; ctx.font = '28px system-ui'; ctx.textAlign = 'center'; ctx.fillText('End of the show', P.next.width / 2, P.next.height / 2); }
    P.notes.textContent = sl.notes || 'No notes for this slide.';
    P.notes.style.fontSize = `${P.size}px`;
    P.notes.style.opacity = sl.notes ? '1' : '.55';
    P.clock.textContent = mmss(elapsed());
    P.startBtn.textContent = S.running ? 'Pause timer' : (S.tPause ? 'Resume timer' : 'Start timer');
    P.count.textContent = `Slide ${S.cur + 1} of ${S.deck.slides.length}`;
    pop.document.title = `Presenter view — ${S.deck.title}`;
  }

  /* ---------------- PDF ---------------- */
  let exporting = false;
  async function exportPdf() {
    if (!S.deck || exporting) return;
    exporting = true;
    say('Making the PDF…');
    try {
      save(true);
      const slides = S.deck.slides;
      await Promise.all(slides.map(sl => new Promise(res => { if (!sl.img || images.has(sl.img)) return res(); wantImage(sl.img); const t0 = Date.now(); const iv = setInterval(() => { if (images.has(sl.img) || Date.now() - t0 > 4000) { clearInterval(iv); res(); } }, 50); })));
      const pages = [];
      for (let i = 0; i < slides.length; i++) {
        const c = document.createElement('canvas');
        c.width = 1600; c.height = 900;
        D.drawSlide(c.getContext('2d'), slides[i], S.deck, { w: 1600, h: 900, n: i + 1, total: slides.length, images });
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
        if (!blob) throw new Error('This browser couldn’t make a picture of a slide.');
        pages.push({ width: 1600, height: 900, jpeg: new Uint8Array(await blob.arrayBuffer()) });
      }
      const pdf = await makePdf(pages, { title: S.deck.title });
      const { path } = await media.save(vfs.parentPath(S.path), `${cleanName(S.deck.title)}.pdf`, pdf);
      say(`Saved ${vfs.baseName(path)}: ${plural(slides.length, 'slide')}, one picture each. Notes aren’t included.`, '',
        [h('button.sl__btn', { type: 'button', 'data-act': 'show-pdf', onclick: () => api.openApp('files', { path: vfs.parentPath(path) }) }, icon('folder-open'), 'Show in Files')]);
    } catch (err) { say(`Couldn’t make the PDF: ${err.message || 'unknown error'}`, 'error'); }
    exporting = false;
  }

  /* ---------------- keys ---------------- */
  const onKey = e => {
    if (dead || S.show) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(true); return; }
    if (e.key === 'F5' && S.deck) { e.preventDefault(); present(e.shiftKey); }
  };
  shell.addEventListener('keydown', onKey);

  win.onReopen && win.onReopen(o => { if (o && typeof o.path === 'string') openDeck(o.path); });
  const offFs = api.bus.on('fs:change', () => { if (!dead && !S.deck) later(() => { if (!S.deck && !dead) paintHome(); }, 250); });

  paint();
  if (opts && typeof opts.path === 'string') openDeck(opts.path);

  return () => {
    dead = true;
    for (const t of timers) clearTimeout(t);
    try { save(true); } catch (e) { /* nothing more to do */ }
    document.removeEventListener('fullscreenchange', onFs);
    window.removeEventListener('resize', onResize);
    if (typeof offFs === 'function') offFs();
    if (document.fullscreenElement === showEl) document.exitFullscreen().catch(() => {});
    closePopup();
    root.replaceChildren();
  };
}
