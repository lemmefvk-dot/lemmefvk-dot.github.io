/* ============================================================
   colourbynumber.js — Colour by number, from your own photos.

   Pick a picture (from ~/Pictures or this computer), choose how many colours
   and how fine the detail, and Make puzzle turns it into numbered patches
   (js/core/paintbynumber.js — k-means colours from the photo itself, small
   patches folded into their neighbours). It all happens in this window: the
   picture is never uploaded.

   To play, choose a colour in the palette (click it, or press its number key:
   1–9, 0 is 10; [ and ] step through them) and click a patch with that number
   to paint it in. A patch with another number says so and stays blank. "Show
   where" tints the unpainted patches of the chosen colour. Without a pointer:
   N jumps to the next unpainted patch of the chosen colour and Enter or Space
   paints it. The count is real patches painted out of patches in the puzzle.
   Save picture writes what you have painted so far to ~/Pictures/Colour by
   number. The puzzle and your progress are kept (store key 'portal.cbn').
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { buildPuzzle, describe } from '../core/paintbynumber.js';
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, saveBlob } from '../photos/pt-common.js';
import { makerCss, blobOf, stemName } from '../core/makerkit.js';

makerCss();
const KEY = 'portal.cbn';
const DETAIL = { Easy: 48, Medium: 72, Fine: 104 };         /* the longest side of the grid, in cells */

const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const lum = hexv => { const n = parseInt(hexv.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };

defineApp({
  id: 'colourbynumber',
  name: 'Colour by number',
  icon: 'palette',
  g1: '#7be0ad', g2: '#3b82f6',
  category: 'Create',
  keywords: ['colour by number', 'color by number', 'paint by number', 'puzzle', 'photo', 'numbers', 'relax', 'colouring', 'coloring', 'art'],
  desc: 'Turn one of your photos into a numbered painting puzzle',
  singleton: true,
  win: { w: 960, h: 700, minW: 620, minH: 480 },
  shortcuts: [['1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 0', 'Choose that colour (0 is 10)'], ['[ / ]', 'Previous / next colour'], ['N', 'Next patch of this colour'], ['Enter / Space', 'Paint the marked patch'], ['H', 'Show where on / off']],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, store } = api;

    let P = null;                 /* { w, h, palette, cell, region, regions, filled:Set, name } */
    let colour = 0, mark = -1, showWhere = true, dead = false, msg = '';
    const cv = h('canvas.mk-cbn__cv', { tabindex: '0', role: 'application', 'aria-label': 'Puzzle. Click a patch to paint it, or press N to pick one and Enter to paint it.' });
    const note = h('small.mk-msg', { role: 'status', 'aria-live': 'polite' });
    const say = t => { msg = t; note.textContent = t; };
    const prog = h('output.mk-out.mk-prog');
    const pal = h('div.mk-pal', { role: 'listbox', 'aria-label': 'Colours' });

    /* ---------- drawing the puzzle ---------- */
    let scale = 8;
    function paint() {
      if (!P) return;
      const { w, h: ph, region, regions, palette } = P;
      scale = Math.max(3, Math.floor(Math.min(720 / w, 540 / ph)));
      cv.width = w * scale; cv.height = ph * scale;
      const g = cv.getContext('2d');
      const small = document.createElement('canvas'); small.width = w; small.height = ph;
      const sg = small.getContext('2d'), id = sg.createImageData(w, ph);
      const rgb = palette.map(p => [parseInt(p.slice(1, 3), 16), parseInt(p.slice(3, 5), 16), parseInt(p.slice(5, 7), 16)]);
      for (let i = 0; i < w * ph; i++) {
        const r = region[i], done = P.filled.has(r);
        let c;
        if (done) c = rgb[P.cell[i]];
        else if (showWhere && P.cell[i] === colour) { const t = rgb[colour]; c = [Math.round(t[0] * 0.35 + 255 * 0.65), Math.round(t[1] * 0.35 + 255 * 0.65), Math.round(t[2] * 0.35 + 255 * 0.65)]; }
        else c = [248, 248, 248];
        id.data[i * 4] = c[0]; id.data[i * 4 + 1] = c[1]; id.data[i * 4 + 2] = c[2]; id.data[i * 4 + 3] = 255;
      }
      sg.putImageData(id, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(small, 0, 0, w * scale, ph * scale);
      /* the lines between patches */
      g.fillStyle = 'rgba(40,40,50,.55)';
      for (let y = 0; y < ph; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x < w - 1 && region[i] !== region[i + 1]) g.fillRect((x + 1) * scale - 0.5, y * scale, 1, scale);
        if (y < ph - 1 && region[i] !== region[i + w]) g.fillRect(x * scale, (y + 1) * scale - 0.5, scale, 1);
      }
      /* the numbers, on patches still to paint */
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const r of regions) {
        if (P.filled.has(r.id)) continue;
        const fs = Math.max(8, Math.min(18, Math.sqrt(r.area) * scale * 0.36));
        g.font = `600 ${fs}px sans-serif`;
        g.fillStyle = '#333';
        g.fillText(String(r.colour + 1), (r.x + 0.5) * scale, (r.y + 0.5) * scale + 0.5);
      }
      if (mark >= 0 && !P.filled.has(mark)) {
        const r = regions[mark];
        g.strokeStyle = '#e5484d'; g.lineWidth = 3;
        g.beginPath(); g.arc((r.x + 0.5) * scale, (r.y + 0.5) * scale, Math.max(10, scale * 1.6), 0, 7); g.stroke();
      }
      paintPal();
    }
    function left(c) { return P.regions.filter(r => r.colour === c && !P.filled.has(r.id)).length; }
    function paintPal() {
      pal.replaceChildren(...P.palette.map((p, c) => {
        const n = left(c);
        return h('button.mk-pal__c', {
          type: 'button', role: 'option', 'aria-selected': String(c === colour), class: c === colour ? 'is-on' : (n ? null : 'is-done'),
          'aria-label': `Colour ${c + 1}, ${n ? n + ' patches left' : 'finished'}`, dataset: { c: String(c + 1) }, onclick: () => pick(c),
        }, h('i', { style: { background: p, color: lum(p) > 150 ? '#222' : '#fff' }, text: String(c + 1) }), h('small', { text: n ? `${n} left` : 'done' }));
      }));
      const total = P.regions.length, done = P.filled.size;
      prog.textContent = `${done} of ${total} patches painted`;
    }
    function pick(c) { colour = Math.max(0, Math.min(P.palette.length - 1, c)); mark = -1; paint(); }

    /* ---------- playing ---------- */
    function paintRegion(r) {
      const reg = P.regions[r];
      if (!reg || P.filled.has(r)) return;
      if (reg.colour !== colour) return say(`That patch is number ${reg.colour + 1}. You have ${colour + 1} chosen.`);
      P.filled.add(r); mark = -1; save(); paint();
      if (P.filled.size === P.regions.length) say('All painted. Save the picture, or make a new puzzle.');
      else say(left(colour) ? '' : `Colour ${colour + 1} is finished.`);
    }
    cv.addEventListener('pointerdown', e => {
      if (!P) return;
      const rc = cv.getBoundingClientRect();
      const x = Math.floor((e.clientX - rc.left) * P.w / rc.width), y = Math.floor((e.clientY - rc.top) * P.h / rc.height);
      if (x < 0 || y < 0 || x >= P.w || y >= P.h) return;
      const r = P.region[y * P.w + x];
      if (P.filled.has(r)) return say('Already painted.');
      paintRegion(r);
    });
    function nextMark() {
      const todo = P.regions.filter(r => r.colour === colour && !P.filled.has(r.id));
      if (!todo.length) { mark = -1; paint(); return say(`Colour ${colour + 1} is finished. Pick another.`); }
      const at = todo.findIndex(r => r.id === mark);
      mark = todo[(at + 1) % todo.length].id; paint();
      say(`Patch marked: ${todo.length} of colour ${colour + 1} left. Press Enter to paint it.`);
    }

    /* ---------- keeping and saving ---------- */
    function save() {
      if (!P) return;
      try { store.set(KEY, { v: 1, name: P.name, w: P.w, h: P.h, palette: P.palette, cell: b64(P.cell), filled: [...P.filled] }); } catch (e) { /* too big: the puzzle just isn't kept */ }
    }
    function load() {
      const d = store.get(KEY);
      if (!d || !Array.isArray(d.palette) || typeof d.cell !== 'string' || !(d.w > 0) || !(d.h > 0) || d.w * d.h > 40000) return false;
      try {
        const cell = unb64(d.cell);
        if (cell.length !== d.w * d.h || d.palette.length > 24 || d.palette.some(c => !/^#[0-9a-f]{6}$/i.test(c)) || [...cell].some(c => c >= d.palette.length)) return false;
        P = { ...describe(d.w, d.h, d.palette, cell), filled: new Set((d.filled || []).filter(n => Number.isInteger(n))), name: stemName(d.name, 'Puzzle') };
        P.filled = new Set([...P.filled].filter(n => n >= 0 && n < P.regions.length));
        return true;
      } catch (e) { return false; }
    }
    async function savePicture() {
      if (!P) return;
      try {
        const out = document.createElement('canvas'); out.width = P.w * 8; out.height = P.h * 8;
        const g = out.getContext('2d');
        g.imageSmoothingEnabled = false;
        for (let i = 0; i < P.w * P.h; i++) {
          g.fillStyle = P.filled.has(P.region[i]) ? P.palette[P.cell[i]] : '#f8f8f8';
          g.fillRect((i % P.w) * 8, ((i / P.w) | 0) * 8, 8, 8);
        }
        const blob = await blobOf(out);
        const path = await saveBlob(api, 'Colour by number', `${api.vfs.HOME}/Pictures/Colour by number`, `${P.name}.png`, blob, { title: 'Picture saved', icon: 'palette' });
        say(`Saved ${path.split('/').pop()}.`);
      } catch (err) { say('Couldn’t save the picture: ' + err.message); }
    }

    /* ---------- the start page ---------- */
    let chosen = null;
    const picker = pickerView(api, { multi: false, label: 'Pictures to turn into a puzzle', onChange: list => { chosen = list[0] || null; make.disabled = !chosen; } });
    const colsIn = h('input', { type: 'range', min: '4', max: '16', value: '9', 'aria-label': 'Number of colours', oninput: e => { colsOut.textContent = `${e.target.value} colours`; } });
    const colsOut = h('output.mk-out', { text: '9 colours' });
    const detail = h('select', { 'aria-label': 'Detail' }, ...Object.keys(DETAIL).map(k => h('option', { value: k, text: k, selected: k === 'Medium' })));
    const make = h('button.btn.btn--sm', { type: 'button', disabled: true, onclick: makePuzzle }, icon('sparkles'), h('span', { text: 'Make puzzle' }));
    async function makePuzzle() {
      if (!chosen) return;
      make.disabled = true; say('Making your puzzle…');
      try {
        const bmp = await bitmapOf(await blobOfSource(chosen));
        const { w: sw, h: sh } = sizeOfBitmap(bmp);
        const side = DETAIL[detail.value] || 72, k = side / Math.max(sw, sh);
        const w = Math.max(8, Math.round(sw * k)), ph = Math.max(8, Math.round(sh * k));
        const c = document.createElement('canvas'); c.width = w; c.height = ph;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, ph); g.drawImage(bmp, 0, 0, w, ph);
        await new Promise(r => setTimeout(r, 20));
        const built = buildPuzzle(g.getImageData(0, 0, w, ph), { colours: +colsIn.value });
        if (dead) return;
        P = { ...built, filled: new Set(), name: stemName(chosen.name.replace(/\.[^.]+$/, ''), 'Puzzle') };
        colour = 0; mark = -1; save(); show(); say(`${P.regions.length} patches in ${P.palette.length} colours. Pick a colour, then a patch with its number.`);
      } catch (err) { say('Couldn’t make a puzzle from that: ' + err.message); }
      make.disabled = !chosen;
    }
    const startView = h('div.mk-start',
      h('p.mk-hint', { text: 'Choose a picture and it becomes a painting by numbers. It is made right here; nothing is uploaded.' }),
      picker.el,
      h('div.mk-row', h('label.mk-lbl', 'Colours', colsIn, colsOut), h('label.mk-lbl', 'Detail', detail), make));
    const playView = h('div.mk-main',
      h('div.mk-stage', h('div.mk-paper', cv), prog),
      h('div.mk-side',
        h('div.mk-group', h('b.label', { text: 'Colours' }), pal,
          h('label.mk-lbl', 'Show where', h('input', { type: 'checkbox', checked: true, 'aria-label': 'Show where the chosen colour goes', onchange: e => { showWhere = e.target.checked; paint(); } }))),
        h('div.mk-group', h('div.mk-row',
          h('button.btn.btn--sm', { type: 'button', onclick: nextMark, title: 'Next patch of this colour (N)' }, icon('arrow-down'), h('span', { text: 'Next patch' })),
          h('button.btn.btn--sm', { type: 'button', onclick: savePicture }, icon('download'), h('span', { text: 'Save picture' })),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { P = null; store.set(KEY, null); show(); say(''); } }, icon('upload'), h('span', { text: 'New photo' })))),
        note));
    function show() { startView.hidden = !!P; playView.hidden = !P; if (P) paint(); }

    root.classList.add('mk');
    root.replaceChildren(startView, playView);
    if (!load()) P = null;
    else say('Your puzzle is back.');
    show();

    const onKey = e => {
      if (!win.el.classList.contains('is-active') || !P || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (/^[0-9]$/.test(e.key)) { const c = e.key === '0' ? 9 : +e.key - 1; if (c < P.palette.length) pick(c); }
      else if (e.key === '[') pick((colour + P.palette.length - 1) % P.palette.length);
      else if (e.key === ']') pick((colour + 1) % P.palette.length);
      else if (e.key.toLowerCase() === 'n') nextMark();
      else if (e.key.toLowerCase() === 'h') { showWhere = !showWhere; paint(); }
      else if ((e.key === 'Enter' || e.key === ' ') && mark >= 0 && tag !== 'BUTTON') paintRegion(mark);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    return () => { dead = true; window.removeEventListener('keydown', onKey); try { picker.destroy(); } catch (e) { /* gone */ } };
  },
});
