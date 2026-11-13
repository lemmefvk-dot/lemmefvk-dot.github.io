/* ============================================================
   Picture Tools — small things to do with a picture, in one app.

     Meme       top and bottom text, impact style, and boxes you can drag
     Collage    2–6 pictures in a grid or mosaic, exported as PNG or JPEG
     Convert    resize and change PNG / JPG / WebP, one picture or a batch
     ASCII      a picture or some words as text art
     GIF        an animated GIF from pictures or a video clip
     Slideshow  pictures into a video, with transitions and music
     Sticker    cut a shape out of a picture; a desktop sticker or a PNG
     Comic      panels, speech bubbles and stickers on a page
     Scan       photograph a page, straighten and clean it, save a PDF

   One app instead of four because they share the same first step —
   choose pictures from ~/Pictures (or from this computer) — and the same
   last one, a copy saved beside the original or in ~/Pictures; Photos and
   Files open it with a picture already chosen. Each tool's code is in
   js/photos/pt-*.js and loads the first time its tab is opened.

   Opened with { tool: 'meme'|'collage'|'convert'|'ascii'|'gif'|'slideshow'|'sticker'|'comic'|'scan', path? }.
   ============================================================ */
import { defineApp } from '../core/registry.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-pictools-css')) {
  const l = document.createElement('link');
  l.id = 'feat-pictools-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-pictools.css';
  document.head.appendChild(l);
}

const TOOLS = [
  { id: 'meme', label: 'Meme', icon: 'type', load: () => import('../photos/pt-meme.js').then(m => m.mountMeme) },
  { id: 'collage', label: 'Collage', icon: 'grid', load: () => import('../photos/pt-collage.js').then(m => m.mountCollage) },
  { id: 'convert', label: 'Convert', icon: 'refresh', load: () => import('../photos/pt-convert.js').then(m => m.mountConvert) },
  { id: 'ascii', label: 'ASCII art', icon: 'file-text', load: () => import('../photos/pt-ascii.js').then(m => m.mountAscii) },
  { id: 'gif', label: 'GIF', icon: 'film', load: () => import('../photos/pt-gif.js').then(m => m.mountGif) },
  { id: 'slideshow', label: 'Slideshow', icon: 'play', load: () => import('../photos/pt-slideshow.js').then(m => m.mountSlideshow) },
  { id: 'sticker', label: 'Sticker', icon: 'star', load: () => import('../photos/pt-sticker.js').then(m => m.mountSticker) },
  { id: 'comic', label: 'Comic', icon: 'message-circle', load: () => import('../photos/pt-comic.js').then(m => m.mountComic) },
  { id: 'scan', label: 'Scan', icon: 'scan', load: () => import('../photos/pt-scan.js').then(m => m.mountScan) },
];
const PREF = 'portal.picturetools';

defineApp({
  id: 'picturetools',
  name: 'Picture Tools',
  icon: 'sparkles',
  g1: '#7fd8ff', g2: '#6a4bff',
  category: 'Media',
  keywords: ['meme', 'meme maker', 'caption', 'collage', 'photo collage', 'grid', 'convert', 'converter', 'resize', 'png', 'jpg', 'jpeg', 'webp', 'ascii', 'ascii art', 'text art', 'banner', 'gif', 'animated gif', 'gif maker', 'slideshow', 'photo video', 'ken burns', 'sticker', 'sticker maker', 'cut out', 'cutout', 'lasso', 'magic wand', 'comic', 'comic maker', 'speech bubble', 'panels', 'scan', 'scanner', 'document scanner', 'scan a page', 'pdf', 'photograph a page', 'homework scan'],
  desc: 'Make memes, collages, GIFs, slideshows, stickers and comics, scan pages to PDF, or resize and convert pictures',
  win: { w: 1040, h: 700, minW: 520, minH: 420 },
  shortcuts: [['1', 'Meme'], ['2', 'Collage'], ['3', 'Convert'], ['4', 'ASCII art'], ['5', 'GIF'], ['6', 'Slideshow'], ['7', 'Sticker'], ['8', 'Comic'], ['9', 'Scan']],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, store } = api;
    const saved = store.get(PREF);
    const S = { tool: null, alive: true, down: null, seq: 0 };
    const want = TOOLS.find(t => t.id === opts?.tool)?.id || TOOLS.find(t => t.id === saved?.tool)?.id || 'meme';

    const body = h('div.pt__body');
    const tabs = TOOLS.map((t, i) => h('button.pt__tab', {
      type: 'button', role: 'tab', id: `pt-tab-${t.id}`, 'aria-selected': 'false', 'aria-controls': 'pt-panel', tabindex: '-1', dataset: { tool: t.id },
      onclick: () => show(t.id),
      onkeydown: e => {
        const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        const n = TOOLS[(i + k + TOOLS.length) % TOOLS.length].id;
        show(n);
        tabs.find(b => b.dataset.tool === n).focus();
      },
    }, icon(t.icon), h('span', { text: t.label })));
    const bar = h('div.pt__tabs', { role: 'tablist', 'aria-label': 'Picture tools' }, tabs);
    body.setAttribute('role', 'tabpanel');
    body.id = 'pt-panel';
    const app = h('div.app.pt', bar, body);
    root.appendChild(app);

    function show(id, extra = {}) {
      const tool = TOOLS.find(t => t.id === id);
      if (!tool || (S.tool === id && !extra.path)) return;
      const seq = ++S.seq;
      if (S.down) { try { S.down(); } catch (e) { console.error(e); } S.down = null; }
      body.replaceChildren();
      S.tool = id;
      for (const b of tabs) { const on = b.dataset.tool === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
      body.setAttribute('aria-labelledby', `pt-tab-${id}`);
      store.set(PREF, { tool: id });
      win.setTitle(`${tool.label} — Picture Tools`);
      const wait = h('div.pt__empty', h('span.spinner'), h('small', { text: `Opening ${tool.label}…` }));
      body.appendChild(wait);
      tool.load().then(mountTool => {
        if (!S.alive || seq !== S.seq) return;
        wait.remove();
        const host = h('div.pt__tool', { dataset: { tool: id } });
        body.appendChild(host);
        const down = mountTool({ api, root: host, opts: { path: extra.path } });
        S.down = typeof down === 'function' ? down : null;
      }).catch(err => {
        if (!S.alive || seq !== S.seq) return;
        wait.replaceChildren(icon('alert'), h('b', { text: `${tool.label} couldn’t load` }), h('small', { text: String(err?.message || err) }));
      });
    }
    /* 1–6 switch tools, unless a field has the keyboard */
    const onKey = e => {
      if (!S.alive || !win.el.classList.contains('is-active') || e.metaKey || e.ctrlKey || e.altKey) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && !win.el.contains(ae)) return;
      if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
      const t = TOOLS[Number(e.key) - 1];
      if (t && e.key.length === 1) { e.preventDefault(); show(t.id); }
    };
    window.addEventListener('keydown', onKey);
    show(want, { path: opts?.path });

    return () => {
      S.alive = false;
      window.removeEventListener('keydown', onKey);
      if (S.down) { try { S.down(); } catch (e) { console.error(e); } S.down = null; }
    };
  },
});
