/* ============================================================
   Notes — folders of notes, each one a formatted page.

   The editor is a contentEditable page with headings, bold and
   italic, bulleted and numbered lists, checklists you tick, and
   pictures. Markdown-style typing works too: "# " makes a heading,
   "- " a list, "1. " a numbered one, "[ ] " (or "- [ ] ") a checklist.
   A note is stored as a small line-based Markdown (js/core/notesfmt.js)
   — older plain-text notes are converted once, word for word.

   Pictures are real files: one dropped or pasted from outside is saved
   to ~/Pictures/Notes through js/core/media.js (the bytes go to
   IndexedDB), one dragged from Photos or Files is linked where it is.
   A note only ever holds the picture's path, never its bytes.

   Folders: store 'noteFolders'; a note's `folder` is a folder id.
   Export as PDF uses the browser's own print window (the note is the
   only thing on the page while it prints — css/feat-notes.css), so it
   is a PDF when the person picks "Save as PDF" there.

   View mode (Notes 2.0) still turns the note into something connected
   to the OS: links open, game:<id> · arcade:<id> · anime:<id> ·
   project:<id> · collection:<id> become chips, boxes tick.

   A vfs text file (.txt, .md…) opened from Files or Spotlight is
   edited as plain text and written back to the file.

   Write together… shares a note with a friend, live: notes-coop.js,
   which hears about every change through bodyChanged(). opts.coop fills
   a room code in (an invite link, #note=<CODE>) and joins nothing.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as NF from '../core/notesfmt.js';
import * as media from '../core/media.js';
import { fold } from '../core/textindex.js';
import * as NH from '../core/notehistory.js';
import { openHistory as openHistoryPanel } from '../core/notehistoryui.js';
import { createCoop } from './notes-coop.js';
import { countWords } from '../core/wordtools.js';
import { mountPlan } from './notesplan.js';

/* self-injected stylesheet, guarded so re-opening never double-adds it */
if (typeof document !== 'undefined' && !document.getElementById('feat-notes-css')) {
  const link = document.createElement('link');
  link.id = 'feat-notes-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-notes.css';
  document.head.appendChild(link);
}

let seq = 0;
const nid = () => `note-${Date.now().toString(36)}-${++seq}`;
const fid = () => `folder-${Date.now().toString(36)}-${++seq}`;

/* a picture dragged in from Photos or Files carries its vfs path(s), one per line */
const DRAG_PATH = 'application/x-staticos-path';
/* a note dragged onto a folder in the sidebar */
const DRAG_NOTE = 'application/x-staticos-note';

/* First run gets one real note that explains the app. (Earlier builds
   seeded a developer's punch list and a grocery list — placeholder
   content pretending to be someone's notes.) */
const SEED = kb => [{
  id: nid(), mtime: new Date().toISOString(), fmt: NF.FMT,
  title: 'Welcome to Notes',
  body: [
    'Everything you type here saves by itself, on this device.',
    '',
    '## Write it the way you think',
    '- [ ] Type # and a space for a heading, - for a list, [ ] for a checklist',
    `- [ ] Select some words and press ${kb('B')} for **bold**, ${kb('I')} for *italic*`,
    '- [ ] Drop or paste a picture in, or pick one from Pictures with the picture button',
    '',
    '## Keep it tidy',
    '- Folders are on the left: + makes one, drag a note onto a folder to move it',
    '- The printer button exports a note as a PDF through your browser’s print window',
    '- Text files from Files (.txt, .md) open here too, and save back to the file',
    '',
    'Delete this note whenever you like.',
  ].join('\n'),
}];

/* the placeholder notes older builds shipped — removed on load, but only
   while they are still exactly as shipped (an edited one is yours now) */
const OLD_SEED_TITLES = ["Static shell — punch list", "Compositor handshake", "Groceries + house"];
const OLD_SEED_STARTS = ['Shipping 3.0.1 this week.', 'Window manager keeps a flat z-stack.', '- coffee (the dark roast'];
const isOldSeed = n => n && OLD_SEED_TITLES.includes(n.title)
  && OLD_SEED_STARTS.some(t => String(n.body || '').startsWith(t))
  && String(n.body || '').length < 700;

/* what the DOM reader treats as a line of its own, and what it never reads */
const BLOCKISH = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'FIGURE', 'BLOCKQUOTE', 'PRE',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
  'DL', 'DT', 'DD', 'ADDRESS', 'HR', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'CAPTION']);
const IGNORE = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'svg', 'SVG',
  'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'VIDEO', 'AUDIO', 'META', 'LINK', 'TITLE', 'HEAD']);
const LISTY = t => t === 'ul' || t === 'ol' || t === 'check';
const same = (a, b) => !!a && !!b && a.i === b.i && a.o === b.o;

defineApp({
  id: 'notes',
  name: 'Notes',
  icon: 'sticky-note',
  g1: '#ffe08a', g2: '#c98a08',
  category: 'Productivity',
  keywords: ['note', 'memo', 'write', 'text', 'markdown', 'scratch', 'checklist', 'to-do', 'folder', 'pdf', 'write together', 'friend', 'co-op', 'collaborate'],
  desc: 'Jot things down and keep them',
  pinned: true, dock: true,
  handles: ['text'],          /* PDFs ('doc') open in Files' viewer */
  win: { w: 760, h: 460, minW: 440, minH: 300 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Mod+N', 'New note'],
    ['Mod+S', 'Save'],
    ['Mod+F', 'Search notes'],
    ['Mod+B', 'Bold'],
    ['Mod+I', 'Italic'],
    ['Mod+Alt+1 / Mod+Alt+2 / Mod+Alt+3', 'Heading 1 / 2 / 3'],
    ['Mod+Alt+0', 'Body text'],
    ['Mod+Shift+8', 'Bulleted list'],
    ['Mod+Shift+7', 'Numbered list'],
    ['Mod+Shift+9', 'Checklist'],
    ['Mod+Enter', 'Tick or untick a checklist item'],
    ['Mod+P', 'Export as PDF (print)'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, fmt, store } = api;
    const kb = k => (fmt.isMac ? `⌘${k}` : `Ctrl+${k}`);
    const kbAlt = k => (fmt.isMac ? `⌘⌥${k}` : `Ctrl+Alt+${k}`);
    const kbShift = k => (fmt.isMac ? `⌘⇧${k}` : `Ctrl+Shift+${k}`);
    const PICS = `${vfs.HOME}/Pictures/Notes`;
    let CO = null;          /* Write together (notes-coop.js), set up once the editor exists */

    /* ---------------- state ---------------- */
    const S = {
      notes: [], folders: [], sel: null, folder: 'all', filter: '', file: null, saving: false,
      mode: store.get('prefs.notesMode') === 'view' ? 'view' : 'edit',
      fig: null,            /* the picture selected in the editor (its block index) */
      renaming: null,       /* the folder whose name is being edited */
      drawn: { id: null, md: null },   /* what the editor shows right now */
    };

    let mine = store.get('notes');
    if (Array.isArray(mine) && mine.some(isOldSeed)) { mine = mine.filter(n => !isOldSeed(n)); store.set('notes', mine); }
    if (!Array.isArray(mine) || !mine.length) { mine = SEED(kb); store.set('notes', mine); }
    S.notes = adopt(mine);
    S.folders = foldersOf(store.get('noteFolders'));

    /** Notes written by something that doesn't know the format (the widget,
        Spotlight's New Note, an older build) are converted here, once. Their
        mtime is left alone: a format change is not an edit. */
    function adopt(list) {
      let out = list.filter(n => n && typeof n === 'object' && n.id);
      const old = out.some(n => n.fmt !== NF.FMT);
      if (old) out = out.map(NF.migrate);
      mine = old || out.length !== list.length ? out : list;
      if (mine !== list) store.set('notes', mine);
      return mine;
    }
    function foldersOf(v) {
      return Array.isArray(v) ? v.filter(f => f && typeof f.id === 'string' && typeof f.name === 'string').map(f => ({ ...f })) : [];
    }

    /* a vfs text file opened from Files/Spotlight rides along as a note */
    const fnode = opts?.path ? vfs.node(opts.path) : null;
    if (fnode && fnode.type === 'file') {
      const path = vfs.norm(opts.path);
      S.file = { id: 'vfs', path, title: vfs.baseName(path), body: vfs.read(path) || '', mtime: fnode.mtime };
      NH.baseline(`file:${path}`, { title: S.file.title, body: S.file.body, fmt: null });   /* what the file said before this edit */
    }
    /* opts.noteId opens a specific note (Spotlight, the widget…) */
    const wanted = opts?.noteId ? S.notes.find(n => n.id === opts.noteId) : null;

    const sorted = () => [...S.notes].sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    const all = () => (S.file ? [S.file, ...sorted()] : sorted());
    const current = () => all().find(n => n.id === S.sel) || null;
    const folderOf = id => S.folders.find(f => f.id === id) || null;
    const textOf = n => (n.path ? String(n.body || '') : NF.noteText(n));
    const inFolder = n => n === S.file || S.folder === 'all' || n.folder === S.folder;
    const visible = () => {
      const f = S.filter;
      if (!f) return all().filter(inFolder);
      return all().filter(n => fold(`${n.title || ''}\n${textOf(n)}`).includes(f));
    };
    S.sel = S.file ? S.file.id : wanted ? wanted.id : (visible()[0] ? visible()[0].id : null);

    /* ---------------- chrome --------------- */
    const search = h('input', {
      type: 'search', placeholder: 'Search notes…', spellcheck: 'false', 'aria-label': 'Search notes',
      oninput: e => { S.filter = fold(e.target.value.trim()); paintList(); },
      onkeydown: e => { if (e.key === 'Escape') { e.target.value = ''; S.filter = ''; paintList(); } },
    });

    const newBtn = () => h('button.ibtn.tip', {
      'data-tip': `New note  ${kb('N')}`, 'aria-label': 'New note', onclick: () => newNote(),
    }, icon('plus'));

    win.setTools(
      newBtn(),
      h('button.ibtn.tip', { 'data-tip': 'Write together…', 'aria-label': 'Write together', onclick: () => CO?.toggle() }, icon('users')),
      h('button.ibtn.tip', { 'data-tip': `Export as PDF  ${kb('P')}`, 'aria-label': 'Export as PDF', onclick: () => exportPdf() }, icon('printer')),
      h('button.ibtn.tip', { 'data-tip': 'History', 'aria-label': 'Note history', onclick: () => openHistory() }, icon('clock')),
      h('button.ibtn.tip', { 'data-tip': 'Duplicate', 'aria-label': 'Duplicate note', onclick: () => duplicate(current()) }, icon('copy')),
      h('button.ibtn.tip', { 'data-tip': 'Delete', 'aria-label': 'Delete note', onclick: () => destroy(current()) }, icon('trash')),
    );

    /* ---------------- layout --------------- */
    const foldersEl = h('div.notes__folders', { 'aria-label': 'Folders' });
    const listEl = h('div.list', { style: { flex: '1 1 auto', minHeight: '0', overflowY: 'auto' } });
    const listLabel = h('div.side__label', { style: { padding: '0' } });
    const countEl = h('div.side__label', { style: { padding: '0' } });
    const side = h('aside.app__side.app__side--wide.notes__side', { style: { overflow: 'hidden' } },
      h('div.field', { style: { height: '26px', flex: '0 0 auto' } }, icon('search'), search),
      h('div.row.notes__fhead',
        h('div.side__label', { text: 'Folders' }), h('div.grow'),
        h('button.ibtn.tip', { type: 'button', 'data-tip': 'New folder', 'aria-label': 'New folder', onclick: () => newFolder() }, icon('plus'))),
      foldersEl,
      h('div.row', { style: { flex: '0 0 auto' } }, listLabel, h('div.grow'), countEl, newBtn()),
      listEl);

    const where = h('button.notes__where', { type: 'button', 'aria-haspopup': 'menu', onclick: e => moveMenu(e.currentTarget) });
    const titleIn = h('input.notes__title', {
      placeholder: 'Title', spellcheck: 'false', 'aria-label': 'Note title',
      oninput: () => edit('title', titleIn.value),
      onkeydown: e => { if (e.key === 'Enter' && !S.file && S.mode === 'edit') { e.preventDefault(); rich.focus(); setSel({ i: 0, o: 0 }); } },
    });
    /* a text file is plain text: it stays a textarea */
    const ta = h('textarea', {
      placeholder: 'Start writing…', spellcheck: 'false', 'aria-label': 'Note body',
      oninput: () => edit('body', ta.value),
    });
    const rich = h('div.notes__rich.notes__doc', {
      contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note body',
      spellcheck: 'false', 'data-placeholder': 'Start writing…',
    });
    const view = h('div.notes__view.notes__doc', { role: 'document', 'aria-label': 'Note (view mode)' });
    const wrap = h('div.notes__wrap', ta, rich, view);
    /* outline, word goal and timer: js/apps/notesplan.js */
    const plan = mountPlan({
      api, note: () => { const n = current(); return n && !n.path ? n : null; },
      blocks: () => { flushEditor(); return NF.blocksOf(current()); },
      change: fn => apply(fn), undo: () => undo(), redo: () => redo(),
      jump: i => { if (S.mode !== 'edit') setMode('edit'); rich.focus(); setSel({ i, o: 0 }); },
    });
    wrap.append(plan.panel);

    const modeBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => setMode(S.mode === 'edit' ? 'view' : 'edit') });
    /* toolbar buttons never take focus away from the editor (or its selection) */
    const keep = e => e.preventDefault();
    const tool = (ic, label, fn) => h('button.ibtn.tip', { type: 'button', 'data-tip': label, 'aria-label': label.split('  ')[0], onmousedown: keep, onclick: fn }, icon(ic));
    const ftool = (text, cls, label, fn) => h(`button.ibtn.tip.notes__fmt${cls}`, { type: 'button', 'data-tip': label, 'aria-label': label.split('  ')[0], onmousedown: keep, onclick: fn }, text);
    const richOnly = [
      ftool('B', '.is-b', `Bold  ${kb('B')}`, () => inlineFmt('bold')),
      ftool('I', '.is-i', `Italic  ${kb('I')}`, () => inlineFmt('italic')),
      tool('type', 'Heading', e => headingMenu(e.currentTarget)),
      tool('list', `Bulleted list  ${kbShift('8')}`, () => setType('ul')),
      ftool('1.', '.is-num', `Numbered list  ${kbShift('7')}`, () => setType('ol')),
    ];
    const picBtn = tool('image', 'Insert a picture', e => pickPicture(e.currentTarget));
    const toolbar = h('div.notes__tools',
      modeBtn,
      h('span.notes__sep'),
      ...richOnly,
      tool('check-circle', `Checklist  ${kbShift('9')}`, () => setType('check')),
      picBtn,
      h('span.notes__sep'),
      tool('link', 'Link a game, Forge project or collection', e => linkMenu(e.currentTarget)),
      ...plan.buttons,
      h('div.grow'),
      h('button.btn.btn--sm', { type: 'button', onclick: () => toForge() }, icon('sparkles'), 'Open in Static Forge'));
    richOnly.push(picBtn);
    const editor = h('div.notes__editor', {
      style: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    }, where, titleIn, toolbar, plan.strip, wrap);
    const blank = h('div.grow', { style: { display: 'flex' } },
      h('div.empty', icon('sticky-note'), h('b', { text: 'No note selected' }),
        h('small', { text: `Pick one on the left, or press ${kb('N')} to start a new note.` })));

    /* both halves stay on one line: in a 440px window "Saved to <path>"
       otherwise wraps and the 30px footer grows into the editor */
    const footL = h('span.row.dim', { style: { flex: '0 0 auto', whiteSpace: 'nowrap' } });
    const footR = h('span.dim.trunc');
    const foot = h('div.app__bar.app__bar--foot', footL, h('div.grow'), footR);
    const main = h('div.app__main', editor, blank, foot);
    root.appendChild(h('div.app', side, main));

    /* ---------------- save ------------------ */
    let tSave = 0;
    function queueSave() {
      S.saving = true;
      clearTimeout(tSave);
      tSave = setTimeout(save, 400);
      paintFoot();
    }
    function save() {
      clearTimeout(tSave);
      S.saving = false;
      const n = current();
      if (n && n.path) {
        const changed = vfs.read(n.path) !== n.body;
        vfs.write(n.path, n.body);
        if (changed) api.bus.emit('file:saved', { path: n.path, app: 'notes' });
        const next = n.title.trim();
        if (next && next !== vfs.baseName(n.path)) {
          if (vfs.rename(n.path, next)) n.path = vfs.norm(`${vfs.parentPath(n.path)}/${next}`);
          else {
            /* the name is taken — put the real one back in the box, otherwise
               the title input keeps showing a file that does not exist */
            n.title = vfs.baseName(n.path);
            titleIn.value = n.title;
            win.setTitle(n.title);
            api.notify({ app: 'Notes', icon: 'alert', title: 'That name is taken',
              message: `“${next}” already exists in ${vfs.parentPath(n.path)}.` });
          }
        }
      }
      mine = S.notes.slice();
      store.set('notes', mine);
      paintList(); paintFoot();
    }

    function edit(key, value) {
      const n = current();
      if (!n) return;
      n[key] = value;
      if (key === 'body' && !n.path) n.fmt = NF.FMT;
      n.mtime = new Date().toISOString();
      if (key === 'title') { win.setTitle(n.title || 'Untitled note'); CO?.title(n, n.title); }
      queueSave();
    }

    /* ---------------- history (js/core/notehistory.js) --------------- */
    let closeHist = null;
    async function openHistory() {
      const n = current();
      if (!n) return;
      closeHist?.();
      flushEditor(); save();
      await NH.flush();                       /* what you just typed is a version too */
      if (current() !== n) return;
      main.style.position = 'relative';
      closeHist = openHistoryPanel({
        api, host: main, key: n.path ? `file:${n.path}` : n.id,
        /* the note object can be replaced under us (another window writes it): always ask for the live one */
        getNow: () => { const c = current() || n; return { title: c.title || '', body: c.body || '', fmt: c.path ? null : (c.fmt || NF.FMT) }; },
        apply: snap => {
          const c = current() || n;
          if (!c.path) { c.title = snap.title; c.fmt = NF.FMT; }
          c.body = snap.body;
          c.mtime = new Date().toISOString();
          if (c.path) ta.value = c.body;
          save();
          if (!c.path) drawNote(c);
          paintAll();
        },
        onClose: () => { closeHist = null; },
      });
    }

    /* ---------------- actions --------------- */
    function select(id) {
      if (S.sel === id) return;
      save();
      NH.flush();
      S.sel = id;
      S.fig = null;
      paintAll();
    }
    function newNote() {
      save();
      const n = { id: nid(), title: 'Untitled note', body: '', fmt: NF.FMT, mtime: new Date().toISOString() };
      if (folderOf(S.folder)) n.folder = S.folder;
      S.notes.push(n);
      S.sel = n.id;
      S.filter = ''; search.value = '';
      save();
      paintAll();
      titleIn.focus(); titleIn.select();
    }
    function duplicate(n) {
      if (!n) return;
      if (n.path) { api.notify({ app: 'Notes', icon: 'alert', title: 'That is a file', message: 'Duplicate it in Files instead.' }); return; }
      flushEditor();
      const copy = { id: nid(), title: `${n.title} copy`, body: n.body, fmt: n.fmt, mtime: new Date().toISOString() };
      if (n.folder) copy.folder = n.folder;
      S.notes.push(copy);
      S.sel = copy.id;
      save(); paintAll();
    }
    async function destroy(n) {
      if (!n) return;
      if (n.path) {
        api.notify({ app: 'Notes', icon: 'alert', title: 'That is a file', message: 'Delete it from Files instead.' });
        return;
      }
      if (CO?.owns(n)) {
        api.notify({ app: 'Notes', icon: 'users', title: 'You’re writing this note with a friend', message: 'Leave the room first, then delete your copy.' });
        return;
      }
      const ok = await api.confirm({
        title: `Delete “${n.title || 'Untitled note'}”?`,
        message: 'This note is removed for good — there is no Trash for notes. Pictures in it stay in Pictures.',
        ok: 'Delete',
      });
      if (!ok) return;
      S.notes = S.notes.filter(x => x.id !== n.id);
      plan.forget(n.id);
      if (S.sel === n.id) { const nx = visible()[0] || all()[0]; S.sel = nx ? nx.id : null; }
      save(); paintAll();
      api.notify({ app: 'Notes', icon: 'trash', title: 'Note deleted', message: n.title || 'Untitled note', timeout: 3000 });
    }
    function itemMenu(e, n) {
      e.preventDefault(); e.stopPropagation();
      api.menu([
        { label: 'Open', icon: 'external-link', onClick: () => select(n.id) },
        n.path && { label: 'Reveal in Files', icon: 'folder-open', onClick: () => api.openApp('files', { path: vfs.parentPath(n.path) }) },
        !n.path && { label: 'Move to', icon: 'folder', items: moveItems(n) },
        !n.path && { label: 'Write together…', icon: 'users', onClick: () => { select(n.id); CO?.toggle(true); } },
        '-',
        { label: 'Export as PDF', icon: 'printer', onClick: () => { select(n.id); exportPdf(); } },
        { label: 'Duplicate', icon: 'copy', disabled: !!n.path, onClick: () => duplicate(n) },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !!n.path, onClick: () => destroy(n) },
      ].filter(Boolean), e.clientX, e.clientY);
    }

    /* ---------------- folders ---------------- */
    function saveFolders() { store.set('noteFolders', S.folders.map(f => ({ id: f.id, name: f.name }))); }
    function uniqueFolder(base) {
      const taken = new Set(S.folders.map(f => f.name.toLowerCase()));
      if (!taken.has(base.toLowerCase())) return base;
      let k = 2;
      while (taken.has(`${base} ${k}`.toLowerCase())) k++;
      return `${base} ${k}`;
    }
    function newFolder(thenMove) {
      const f = { id: fid(), name: uniqueFolder('New folder') };
      S.folders.push(f);
      saveFolders();
      if (thenMove) moveNote(thenMove.id, f.id, { quiet: true });
      S.folder = f.id;
      S.renaming = f.id;
      S.filter = ''; search.value = '';
      paintAll();
      return f;
    }
    function renameFolder(id, name) {
      const f = folderOf(id);
      const next = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!f || !next || next === f.name) return;
      if (S.folders.some(x => x.id !== id && x.name.toLowerCase() === next.toLowerCase())) {
        api.notify({ app: 'Notes', icon: 'alert', title: 'There is already a folder with that name', message: next });
        return;
      }
      f.name = next;
      saveFolders();
    }
    async function deleteFolder(id) {
      const f = folderOf(id);
      if (!f) return;
      const inside = S.notes.filter(n => n.folder === id).length;
      const ok = await api.confirm({
        title: `Delete the folder “${f.name}”?`,
        message: inside ? `Its ${inside} note${inside === 1 ? '' : 's'} stay${inside === 1 ? 's' : ''} in All notes — only the folder goes.` : 'It is empty.',
        ok: 'Delete folder',
      });
      if (!ok) return;
      S.folders = S.folders.filter(x => x.id !== id);
      for (const n of S.notes) if (n.folder === id) delete n.folder;
      saveFolders();
      if (S.folder === id) S.folder = 'all';
      save(); paintAll();
    }
    function moveNote(id, folderId, { quiet = false } = {}) {
      const n = S.notes.find(x => x.id === id);
      if (!n) return;
      const to = folderOf(folderId);
      if ((n.folder || null) === (to ? to.id : null)) return;
      if (to) n.folder = to.id; else delete n.folder;
      save(); paintAll();
      if (!quiet) api.notify({ app: 'Notes', icon: 'folder', title: to ? `Moved to ${to.name}` : 'Moved out of its folder', message: n.title || 'Untitled note', timeout: 2500 });
    }
    function moveItems(n) {
      return [
        ...S.folders.map(f => ({ label: f.name, icon: n.folder === f.id ? 'check' : 'folder', disabled: n.folder === f.id, onClick: () => moveNote(n.id, f.id) })),
        S.folders.length ? '-' : null,
        { label: 'No folder', icon: n.folder ? 'x' : 'check', disabled: !n.folder, onClick: () => moveNote(n.id, null) },
        { label: 'New folder…', icon: 'plus', onClick: () => newFolder(n) },
      ].filter(Boolean);
    }
    function moveMenu(anchor) {
      const n = current();
      if (!n || n.path) return;
      const r = anchor.getBoundingClientRect();
      api.menu(moveItems(n), r.left, r.bottom + 4, { label: 'Move to folder' });
    }
    function folderMenu(e, id) {
      e.preventDefault(); e.stopPropagation();
      api.menu([
        { label: 'Rename', icon: 'edit-3', onClick: () => { S.renaming = id; paintFolders(); } },
        { label: 'New note here', icon: 'plus', onClick: () => { S.folder = id; newNote(); } },
        '-',
        { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => deleteFolder(id) },
      ], e.clientX, e.clientY);
    }
    function setFolder(id) {
      if (S.folder === id && !S.filter) return;
      S.folder = id;
      S.filter = ''; search.value = '';
      const list = visible();
      if (!list.some(n => n.id === S.sel) && list[0]) select(list[0].id);
      else paintAll();
    }

    /* ================= the editor ================= */

    /* ---- reading: DOM -> blocks. The live editor, and pasted HTML too
       (collapse: HTML whitespace is not text). Only words, bold/italic,
       the block kind and a picture's vfs path ever come out. */
    function readBlocks(rootEl, collapse = false) {
      const out = [];
      const textOf = s => {
        const t = String(s).replace(/ /g, ' ');
        return collapse ? t.replace(/\s+/g, ' ') : t;
      };
      function runs(nodes, b = false, i = false, acc = []) {
        for (const n of nodes) {
          if (n.nodeType === 3) { const t = textOf(n.data); if (t) acc.push({ text: t, b, i }); continue; }
          if (n.nodeType !== 1) continue;
          const tag = n.tagName;
          if (IGNORE.has(tag) || n.classList.contains('notes__box') || n.classList.contains('notes__figx')) continue;
          if (tag === 'BR') { acc.push({ text: '\n', b, i }); continue; }
          if (tag === 'IMG' || tag === 'FIGURE') continue;
          if (BLOCKISH.has(tag)) { acc.push({ soft: true }); runs(n.childNodes, b, i, acc); acc.push({ soft: true }); continue; }
          const st = n.style || {};
          const weight = Number(st.fontWeight);
          runs(n.childNodes,
            b || tag === 'B' || tag === 'STRONG' || st.fontWeight === 'bold' || weight >= 600,
            i || tag === 'I' || tag === 'EM' || st.fontStyle === 'italic', acc);
        }
        return acc;
      }
      function push(t, rs, extra = {}) {
        let cur = [];
        const lines = [cur];
        for (const r of rs) {
          if (r.soft) { if (NF.runsText(cur)) lines.push(cur = []); continue; }
          const parts = r.text.split('\n');
          parts.forEach((p, k) => {
            if (k) lines.push(cur = []);
            if (p) cur.push({ text: p, b: r.b, i: r.i });
          });
        }
        /* the trailing <br> an empty or ended line keeps is not a line of its own */
        if (lines.length > 1 && !NF.runsText(lines[lines.length - 1])) lines.pop();
        let kept = lines;
        if (collapse) {
          kept = lines.map(ln => {
            const m = NF.mergeRuns(ln);
            if (m.length) { m[0].text = m[0].text.replace(/^\s+/, ''); m[m.length - 1].text = m[m.length - 1].text.replace(/\s+$/, ''); }
            return m.filter(r => r.text);
          }).filter(ln => ln.length);
          if (!kept.length) return;
        }
        kept.forEach((ln, k) => {
          const bt = k && /^h/.test(t) ? 'p' : t;
          const blk = { t: bt, runs: NF.mergeRuns(ln) };
          if (bt === 'check') blk.done = k ? false : !!extra.done;
          out.push(blk);
        });
      }
      function pic(n) {
        const el = n.tagName === 'FIGURE' && !n.dataset.path ? n.querySelector('[data-path]') : n;
        const path = el && el.dataset ? el.dataset.path : null;
        if (path) out.push({ t: 'img', path, alt: (el.dataset.alt || '') || vfs.baseName(path), runs: [] });
      }
      function item(li, t) {
        const own = [], nested = [];
        for (const c of li.childNodes) (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL') ? nested : own).push(c);
        const box = li.querySelector(':scope > .notes__box input');
        /* a task list from somewhere else: <li><input type=checkbox> words */
        const ext = !box ? li.querySelector(':scope > input[type="checkbox"]') : null;
        const kind = ext ? 'check' : t;
        /* data-done is kept in step with the box, and survives a copy (a box's ticked state does not) */
        const dd = li.dataset.done;
        push(kind, runs(own), { done: dd === 'true' ? true : dd === 'false' ? false : box ? box.checked : ext ? ext.checked : false });
        for (const l of nested) list(l);
      }
      function list(el) {
        const t = el.tagName === 'OL' ? 'ol'
          : (el.classList.contains('notes__checks') || el.dataset.list === 'check') ? 'check' : 'ul';
        for (const c of [...el.childNodes]) {
          if (c.nodeType === 1 && c.tagName === 'LI') item(c, t);
          else if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) list(c);
          else if (c.nodeType === 1) walk(c, true);
          else if (c.nodeType === 3 && /\S/.test(c.data)) push('p', [{ text: textOf(c.data), b: false, i: false }]);
        }
      }
      function walk(el, self = false) {
        let inl = [];
        const flush = () => { if (inl.length) { push('p', runs(inl)); inl = []; } };
        const kids = self ? [el] : [...el.childNodes];
        for (const n of kids) {
          if (n.nodeType === 3) { if (inl.length || /\S/.test(n.data)) inl.push(n); continue; }
          if (n.nodeType !== 1) continue;
          const tag = n.tagName;
          if (IGNORE.has(tag) || n.classList.contains('notes__box')) continue;
          if (tag === 'UL' || tag === 'OL') { flush(); list(n); continue; }
          if (tag === 'FIGURE' || tag === 'IMG') { flush(); pic(n); continue; }
          if (/^H[1-6]$/.test(tag)) { flush(); push(`h${Math.min(3, Number(tag[1]))}`, runs(n.childNodes)); continue; }
          if (tag === 'LI') { flush(); item(n, 'ul'); continue; }
          if (tag === 'BR' && !inl.length) { push('p', []); continue; }
          if (BLOCKISH.has(tag)) {
            flush();
            if ([...n.children].some(c => BLOCKISH.has(c.tagName) || c.tagName === 'UL' || c.tagName === 'OL')) walk(n);
            else push('p', runs(n.childNodes));
            continue;
          }
          inl.push(n);
        }
        flush();
      }
      walk(rootEl);
      return out;
    }

    /* ---- drawing: blocks -> DOM, for the editor, View mode and print */
    const picUrl = new Map();
    /* fig.ready settles once the picture has drawn, or is known to be missing */
    function loadPic(fig, img, path) {
      fig.ready = new Promise(res => { fig.settle = res; });
      const show = u => { img.src = u; };
      img.addEventListener('load', () => fig.settle(), { once: true });
      let tried = false;
      img.addEventListener('error', () => {
        /* media.js recycles its oldest object URLs; ask for a fresh one once */
        picUrl.delete(path);
        if (tried) { missing(fig, path); return; }
        tried = true;
        media.urlOf(path).then(u => (u ? show(u) : missing(fig, path)), () => missing(fig, path));
      });
      const known = picUrl.get(path);
      if (known) { show(known); return; }
      media.urlOf(path).then(u => {
        if (!u) { missing(fig, path); return; }
        picUrl.set(path, u);
        show(u);
      }).catch(() => missing(fig, path));
    }
    function missing(fig, path) {
      fig.settle?.();
      if (fig.classList.contains('is-missing')) return;
      fig.classList.add('is-missing');
      fig.querySelector('img')?.remove();
      fig.prepend(h('span.notes__figmiss', icon('image'), h('span', { text: CO?.active() ? `${vfs.baseName(path)} isn’t on this device — pictures stay on the device they were added on` : `Can’t show ${vfs.baseName(path)} — it was moved or deleted` })));
    }
    function figEl(b, mode, reuse) {
      if (mode === 'edit' && reuse && reuse.get(b.path)?.length) return reuse.get(b.path).pop();
      const alt = b.alt || vfs.baseName(b.path);
      const img = h('img', { alt, draggable: 'false', decoding: 'async' });
      const fig = h('figure.notes__fig', { 'data-path': b.path, 'data-alt': alt, contenteditable: mode === 'edit' ? 'false' : null, title: mode === 'edit' ? `${alt} — double-click to open` : null }, img);
      if (mode === 'edit') fig.append(h('button.notes__figx', { type: 'button', tabindex: '-1', 'aria-label': `Remove picture ${alt}` }, icon('x')));
      loadPic(fig, img, b.path);
      return fig;
    }
    function fill(el, rs, mode) {
      const runs = NF.mergeRuns(rs);
      if (!runs.length) { if (mode === 'edit') el.append(h('br')); return el; }
      for (const r of runs) {
        let node = mode === 'view' ? inline(r.text) : [document.createTextNode(r.text)];
        if (r.i) node = [h('i', node)];
        if (r.b) node = [h('b', node)];
        el.append(...node);
      }
      return el;
    }
    function itemEl(b, idx, mode) {
      if (b.t !== 'check') return fill(h('li'), b.runs, mode);
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!b.done;
      if (mode === 'edit') {
        cb.tabIndex = -1;
        cb.setAttribute('aria-label', 'Done');
        return fill(h('li', { 'data-done': String(!!b.done) }, h('span.notes__box', { contenteditable: 'false' }, cb)), b.runs, mode);
      }
      if (mode === 'print') { cb.disabled = true; return fill(h('li', cb, h('span')), b.runs, mode); }
      cb.setAttribute('aria-label', NF.runsText(b.runs) || 'checklist item');
      const span = fill(h('span'), b.runs, mode);
      const label = h(`label.notes__check${b.done ? '.is-done' : ''}`, cb, span);
      cb.addEventListener('change', () => { label.classList.toggle('is-done', cb.checked); tickView(idx, cb.checked); });
      return h('li', label);
    }
    function renderBlocks(blocks, mode, reuse) {
      const frag = document.createDocumentFragment();
      let list = null, lt = null;
      blocks.forEach((b, idx) => {
        if (LISTY(b.t)) {
          if (lt !== b.t) {
            list = h(b.t === 'ol' ? 'ol' : 'ul', b.t === 'check' ? { class: 'notes__checks', 'data-list': 'check' } : null);
            frag.append(list);
            lt = b.t;
          }
          list.append(itemEl(b, idx, mode));
          return;
        }
        list = null; lt = null;
        if (b.t === 'img') { frag.append(figEl(b, mode, reuse)); return; }
        frag.append(fill(h(b.t === 'p' ? 'p' : b.t), b.runs, mode));
      });
      return frag;
    }

    /* ---- the editor's own blocks, and where the caret is among them */
    function blockEls() {
      const out = [];
      for (const el of rich.children) {
        if (el.tagName === 'UL' || el.tagName === 'OL') { for (const li of el.children) if (li.tagName === 'LI') out.push(li); }
        else out.push(el);
      }
      return out;
    }
    function posOf(node, off) {
      if (!node || !rich.contains(node)) return null;
      const els = blockEls();
      const set = new Set(els);
      const first = el => (el && (el.tagName === 'UL' || el.tagName === 'OL') ? el.firstElementChild : el);
      if (node === rich || node.tagName === 'UL' || node.tagName === 'OL') {
        const kid = first(node.childNodes[off]) || null;
        let i = kid ? els.indexOf(kid) : -1;
        if (i >= 0) return { i, o: 0 };
        const prev = node.childNodes[off - 1];
        i = prev ? els.indexOf(prev.tagName === 'UL' || prev.tagName === 'OL' ? prev.lastElementChild : prev) : -1;
        if (i < 0) i = els.length - 1;
        return i >= 0 ? { i, o: els[i].textContent.length } : null;
      }
      let b = node.nodeType === 1 ? node : node.parentNode;
      while (b && b !== rich && !set.has(b)) b = b.parentNode;
      if (!b || b === rich) return null;
      const r = document.createRange();
      r.selectNodeContents(b);
      try { r.setEnd(node, off); } catch (e) { return { i: els.indexOf(b), o: 0 }; }
      return { i: els.indexOf(b), o: r.toString().length };
    }
    function getCaret() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!rich.contains(r.startContainer)) return null;
      const s = posOf(r.startContainer, r.startOffset);
      const e = r.collapsed ? s : posOf(r.endContainer, r.endOffset);
      return s ? { s, e: e || s } : null;
    }
    function pointAt(i, o) {
      const els = blockEls();
      const b = els[Math.max(0, Math.min(i, els.length - 1))];
      if (!b) return null;
      if (b.tagName === 'FIGURE') {
        const k = [...rich.childNodes].indexOf(b);
        return { node: rich, off: k + 1 };
      }
      const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let n, left = Math.max(0, o || 0), last = null;
      while ((n = tw.nextNode())) {
        if (n.parentNode.closest('.notes__box')) continue;
        last = n;
        if (left <= n.data.length) return { node: n, off: left };
        left -= n.data.length;
      }
      if (last) return { node: last, off: last.data.length };
      const kids = [...b.childNodes];
      const br = kids.findIndex(c => c.nodeName === 'BR');
      const box = kids.findIndex(c => c.nodeType === 1 && c.classList.contains('notes__box'));
      return { node: b, off: br >= 0 ? br : box >= 0 ? box + 1 : kids.length };
    }
    function setSel(s, e) {
      const a = s && pointAt(s.i, s.o);
      if (!a) return;
      const z = e && !same(s, e) ? pointAt(e.i, e.o) : a;
      const r = document.createRange();
      r.setStart(a.node, a.off);
      r.setEnd(z.node, z.off);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      const el = (a.node.nodeType === 1 ? a.node : a.node.parentElement);
      if (el && el !== rich && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    function charCaret() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r0 = sel.getRangeAt(0);
      if (!rich.contains(r0.startContainer)) return null;
      const r = document.createRange();
      r.selectNodeContents(rich);
      try { r.setEnd(r0.startContainer, r0.startOffset); } catch (e) { return null; }
      return r.toString().length;
    }
    function setCharCaret(k) {
      const tw = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT);
      let n, left = k;
      while ((n = tw.nextNode())) {
        if (left <= n.data.length) { window.getSelection().collapse(n, left); return; }
        left -= n.data.length;
      }
      const els = blockEls();
      if (els.length) setSel({ i: els.length - 1, o: els[els.length - 1].textContent.length });
    }
    function splitRuns(rs, o) {
      const a = [], z = [];
      let left = o;
      for (const r of rs) {
        if (left >= r.text.length) { a.push({ ...r }); left -= r.text.length; continue; }
        if (left > 0) { a.push({ ...r, text: r.text.slice(0, left) }); z.push({ ...r, text: r.text.slice(left) }); left = 0; continue; }
        z.push({ ...r });
      }
      return [NF.mergeRuns(a), NF.mergeRuns(z)];
    }
    const lenOf = b => (b && b.t !== 'img' ? NF.runsText(b.runs).length : 0);
    /** Remove the text between two caret points (s before e) from the blocks. */
    function cut(blocks, s, e) {
      if (same(s, e)) return;
      const first = blocks[s.i], last = blocks[e.i];
      if (!first || !last) return;
      const head = first.t === 'img' ? [] : splitRuns(first.runs, s.o)[0];
      const tail = last.t === 'img' ? [] : splitRuns(last.runs, e.o)[1];
      if (first.t === 'img') { first.t = 'p'; delete first.path; delete first.alt; }
      first.runs = NF.mergeRuns([...head, ...tail]);
      if (e.i > s.i) blocks.splice(s.i + 1, e.i - s.i);
    }

    /* ---- drawing the editor, and the changes that redraw it */
    function figsNow() {
      const m = new Map();
      for (const f of rich.querySelectorAll('figure.notes__fig')) {
        const p = f.dataset.path;
        if (!m.has(p)) m.set(p, []);
        m.get(p).unshift(f);
      }
      return m;
    }
    function syncEmpty() {
      const empty = !rich.textContent && !rich.querySelector('figure,ul,ol,h1,h2,h3') && rich.querySelectorAll('p').length <= 1;
      rich.classList.toggle('is-empty', empty);
    }
    function draw(blocks, caret) {
      const bl = blocks.length ? blocks.slice() : [{ t: 'p', runs: [] }];
      /* always somewhere to type after a picture */
      if (bl[bl.length - 1].t === 'img') bl.push({ t: 'p', runs: [] });
      rich.replaceChildren(renderBlocks(bl, 'edit', figsNow()));
      S.fig = null;
      syncEmpty();
      if (caret) {
        const c = caret.s ? caret : { s: caret, e: caret };
        setSel(c.s, c.e);
      }
    }
    function drawNote(n) {
      if (CO?.live(n)) { CO.redraw(); return; }
      draw(NF.blocksOf(n));
      S.drawn = { id: n.id, md: n.body };
      resetHistory();
    }
    /** After any change in the editor: the note's body follows it. */
    function bodyChanged() {
      const n = current();
      if (!n || n.path) return;
      CO?.local(n);          /* a shared note: this change goes to the friend (and may redraw the editor) */
      const md = NF.serialize(readBlocks(rich));
      S.drawn = { id: n.id, md };
      H.cur = { md, caret: getCaret() };
      if (md !== n.body) edit('body', md);
      syncEmpty();
      paintFoot();
    }
    /** Every edit already reaches the note through its input event; this only
        catches a change that came without one. An editor showing an older
        version of the note (another Notes window wrote it since) never writes. */
    function flushEditor() {
      const n = current();
      if (!n || n.path || S.mode !== 'edit' || S.drawn.id !== n.id || S.drawn.md !== n.body || !rich.isConnected) return;
      if (NF.serialize(readBlocks(rich)) !== S.drawn.md) bodyChanged();
    }
    /** One undoable change, made on the blocks: fn(blocks, caret) -> new caret. */
    function apply(fn) {
      const n = current();
      if (!n || n.path) return;
      if (S.mode !== 'edit') setMode('edit');
      const c = getCaret();
      const blocks = readBlocks(rich);
      pushUndo();
      const next = fn(blocks, c);
      draw(blocks, next === undefined ? c : next);
      bodyChanged();
    }

    /* ---- undo: snapshots of the body (typing is grouped) */
    const H = { undo: [], redo: [], cur: null, typing: false, t: 0 };
    function resetHistory() {
      H.undo = []; H.redo = []; H.typing = false;
      const n = current();
      H.cur = { md: n ? n.body : '', caret: null };
    }
    function pushUndo() {
      if (H.cur) { H.undo.push(H.cur); if (H.undo.length > 200) H.undo.shift(); }
      H.redo = [];
      H.typing = false;
    }
    const snapNow = () => ({ md: NF.serialize(readBlocks(rich)), caret: getCaret() });
    function restoreSnap(st) {
      draw(NF.parse(st.md), st.caret);
      if (!st.caret) rich.focus();
      bodyChanged();
    }
    /* in a shared note a snapshot would wipe what the friend wrote since: undo is per person there */
    function undo() { if (CO?.live(current())) { CO.undo(); return; } if (!H.undo.length) return; H.redo.push(snapNow()); restoreSnap(H.undo.pop()); }
    function redo() { if (CO?.live(current())) { CO.redo(); return; } if (!H.redo.length) return; H.undo.push(snapNow()); restoreSnap(H.redo.pop()); }

    /* ---- commands ---- */
    function inlineFmt(cmd) {
      if (!current() || S.file) return;
      if (S.mode !== 'edit') setMode('edit');
      if (!rich.contains(document.activeElement)) rich.focus();
      document.execCommand(cmd, false);
    }
    /** Turn the lines under the caret into one kind of block — or back to
        text, when they all already are that kind. */
    function setType(t) {
      if (S.file) { if (t === 'check') insertLine('- [ ] '); return; }
      if (!current()) return;
      if (S.mode !== 'edit') setMode('edit');
      if (!rich.contains(document.activeElement)) rich.focus();
      apply((blocks, c) => {
        const s = c ? c.s.i : Math.max(0, blocks.length - 1), e = c ? c.e.i : s;
        const picked = blocks.slice(s, e + 1).filter(b => b.t !== 'img');
        const back = t !== 'p' && picked.length && picked.every(b => b.t === t);
        for (const b of picked) {
          const was = b.t;
          b.t = back ? 'p' : t;
          if (b.t === 'check') b.done = was === 'check' ? !!b.done : false; else delete b.done;
        }
        return c;
      });
    }
    function toggleChecks() {
      apply((blocks, c) => {
        if (!c) return c;
        const span = blocks.slice(c.s.i, c.e.i + 1);
        const items = span.filter(b => b.t === 'check');
        if (!items.length) { for (const b of span) if (b.t !== 'img') { b.t = 'check'; b.done = false; } return c; }
        const to = !items.every(b => b.done);
        for (const b of items) b.done = to;
        return c;
      });
    }
    /** Enter: split the line at the caret. */
    function splitLine() {
      apply((blocks, c) => {
        if (!c) return c;
        cut(blocks, c.s, c.e);
        const { i, o } = c.s;
        const b = blocks[i];
        if (!b) return c;
        if (b.t === 'img') { blocks.splice(i + 1, 0, { t: 'p', runs: [] }); return { i: i + 1, o: 0 }; }
        if (LISTY(b.t) && !NF.runsText(b.runs)) { b.t = 'p'; delete b.done; return { i, o: 0 }; }   /* Enter on an empty item leaves the list */
        const [a, z] = splitRuns(b.runs, o);
        const fresh = t => ({ t, runs: [], ...(t === 'check' ? { done: false } : {}) });
        if (o === 0 && z.length) {
          /* at the start of a line: a new empty one above, the caret stays with the words */
          blocks.splice(i, 0, fresh(/^h/.test(b.t) ? 'p' : b.t));
          return { i: i + 1, o: 0 };
        }
        b.runs = a;
        const nb = { t: /^h/.test(b.t) && !z.length ? 'p' : b.t, runs: z };
        if (nb.t === 'check') nb.done = false;
        blocks.splice(i + 1, 0, nb);
        return { i: i + 1, o: 0 };
      });
    }
    /** "# ", "- ", "1. ", "[ ] " at the start of a line become the real thing. */
    function autoFormat() {
      const c = getCaret();
      if (!c || !same(c.s, c.e)) return false;
      const blocks = readBlocks(rich);
      const b = blocks[c.s.i];
      if (!b || b.t === 'img' || blockEls().length !== blocks.length) return false;
      const before = NF.runsText(b.runs).slice(0, c.s.o);
      let to = null, done = false;
      if (b.t === 'p') {
        if (/^#{1,3}$/.test(before)) to = `h${before.length}`;
        else if (/^[-*+]$/.test(before)) to = 'ul';
        else if (/^\d{1,3}[.)]$/.test(before)) to = 'ol';
        else if (/^(?:[-*+] )?\[[ xX]?\]$/.test(before)) { to = 'check'; done = /x/i.test(before); }
      } else if (b.t === 'ul' && /^\[[ xX]?\]$/.test(before)) { to = 'check'; done = /x/i.test(before); }
      if (!to) return false;
      pushUndo();
      b.t = to;
      if (to === 'check') b.done = done; else delete b.done;
      b.runs = splitRuns(b.runs, c.s.o)[1];
      draw(blocks, { i: c.s.i, o: 0 });
      bodyChanged();
      return true;
    }
    /** Backspace at the start of a heading or list item makes it plain text
        first; next to a picture, the picture is selected rather than eaten. */
    function edgeDelete(e) {
      const c = getCaret();
      if (!c || !same(c.s, c.e)) return false;
      const blocks = readBlocks(rich);
      if (blocks.length !== blockEls().length) return false;
      const b = blocks[c.s.i];
      if (!b || b.t === 'img') return false;
      if (e.key === 'Backspace' && c.s.o === 0) {
        if (b.t !== 'p') {
          e.preventDefault();
          pushUndo();
          b.t = 'p'; delete b.done;
          draw(blocks, { i: c.s.i, o: 0 });
          bodyChanged();
          return true;
        }
        const prev = blocks[c.s.i - 1];
        if (prev && prev.t === 'img') {
          e.preventDefault();
          if (!lenOf(b) && c.s.i < blocks.length - 1) { pushUndo(); blocks.splice(c.s.i, 1); draw(blocks); bodyChanged(); }
          selectFig(c.s.i - 1);
          return true;
        }
      }
      if (e.key === 'Delete' && c.s.o === lenOf(b)) {
        const next = blocks[c.s.i + 1];
        if (next && next.t === 'img') { e.preventDefault(); selectFig(c.s.i + 1); return true; }
      }
      return false;
    }

    /* ---- pictures in the editor ---- */
    function selectFig(i) {
      clearFig();
      const el = blockEls()[i];
      if (!el || el.tagName !== 'FIGURE') return;
      S.fig = i;
      el.classList.add('is-sel');
      if (!rich.contains(document.activeElement)) rich.focus();
      window.getSelection()?.removeAllRanges();
    }
    function clearFig() {
      S.fig = null;
      for (const f of rich.querySelectorAll('figure.is-sel')) f.classList.remove('is-sel');
    }
    function removeFig(i) {
      apply(blocks => {
        if (!blocks[i] || blocks[i].t !== 'img') return null;
        blocks.splice(i, 1);
        const k = Math.max(0, Math.min(i, blocks.length) - 1);
        return blocks.length ? { i: i < blocks.length ? i : k, o: i < blocks.length ? 0 : lenOf(blocks[k]) } : null;
      });
    }
    function figKey(e) {
      const i = S.fig;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); removeFig(i); return true; }
      if (e.key === 'Enter') {
        e.preventDefault();
        apply(blocks => { blocks.splice(i + 1, 0, { t: 'p', runs: [] }); return { i: i + 1, o: 0 }; });
        return true;
      }
      if (e.key === 'Escape') { clearFig(); return true; }
      if (/^Arrow/.test(e.key) || (e.key.length === 1 && !mod)) {
        const up = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
        const els = blockEls();
        const j = up ? i - 1 : i + 1;
        clearFig();
        if (els[j] && els[j].tagName !== 'FIGURE') {
          if (/^Arrow/.test(e.key)) e.preventDefault();
          setSel({ i: j, o: up ? els[j].textContent.length : 0 });
        }
        return /^Arrow/.test(e.key);
      }
      return false;
    }
    /** Put pictures (vfs paths) into the note: at a caret point, else at the caret, else at the end. */
    function insertPictures(paths, at, { end = false } = {}) {
      if (!paths.length) return;
      const n = current();
      if (!n) return;
      if (n.path) {
        api.notify({ app: 'Notes', icon: 'image', title: 'Pictures go in notes', message: 'A text file can only hold text. Make a note to put this picture in.' });
        return;
      }
      if (S.mode !== 'edit') setMode('edit');
      apply((blocks, c) => {
        const pics = paths.map(p => ({ t: 'img', path: p, alt: vfs.baseName(p), runs: [] }));
        const lastI = blocks.length - 1;
        const pos = end ? { i: lastI, o: lenOf(blocks[lastI]) } : (at || (c && c.s) || { i: lastI, o: lenOf(blocks[lastI]) });
        const b = blocks[pos.i];
        if (!b) { blocks.push(...pics); return { i: blocks.length, o: 0 }; }
        const len = lenOf(b);
        if (b.t !== 'img' && !len) { blocks.splice(pos.i, 1, ...pics); return { i: pos.i + pics.length, o: 0 }; }
        if (b.t !== 'img' && pos.o > 0 && pos.o < len) {
          const [a, z] = splitRuns(b.runs, pos.o);
          b.runs = a;
          const rest = { t: /^h/.test(b.t) ? 'p' : b.t, runs: z };
          if (rest.t === 'check') rest.done = false;
          blocks.splice(pos.i + 1, 0, ...pics, rest);
          return { i: pos.i + 1 + pics.length, o: 0 };
        }
        const k = b.t !== 'img' && pos.o === 0 ? pos.i : pos.i + 1;
        blocks.splice(k, 0, ...pics);
        return { i: k + pics.length, o: 0 };
      });
    }
    const isImageFile = f => f && (media.kindOf(f.type) === 'image' || media.kindOf(f.name) === 'image');
    /** Keep pictures from outside (a drop from the computer, a paste) as real
        files in ~/Pictures/Notes, and return their paths. */
    async function savePictures(files) {
      const imgs = [...(files || [])].filter(isImageFile);
      const out = [];
      for (const f of imgs) {
        const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
        const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name : `Pasted picture ${stamp}.${media.extFor(f.type) || 'png'}`;
        try { out.push((await media.save(PICS, name, f)).path); }
        catch (err) { api.notify({ app: 'Notes', icon: 'alert', title: 'That picture could not be kept', message: String(err && err.message || err) }); }
      }
      if (out.length) {
        api.notify({ app: 'Notes', icon: 'image', timeout: 3500,
          title: `${out.length === 1 ? 'Picture' : `${out.length} pictures`} saved to Pictures › Notes`,
          message: out.map(p => vfs.baseName(p)).join(', ') });
      }
      return out;
    }

    /* ---- paste: pictures are kept as files; words keep their headings,
       lists, checklists, bold and italic — never any other markup */
    function insertBlocks(pasted) {
      apply((blocks, c) => {
        if (!c) { blocks.push(...pasted); const k = blocks.length - 1; return { i: k, o: lenOf(blocks[k]) }; }
        cut(blocks, c.s, c.e);
        const { i, o } = c.s;
        const b = blocks[i];
        if (!b || b.t === 'img') { blocks.splice(i + 1, 0, ...pasted); const k = i + pasted.length; return { i: k, o: lenOf(blocks[k]) }; }
        const [a, z] = splitRuns(b.runs, o);
        if (pasted.length === 1 && pasted[0].t !== 'img') {
          b.runs = NF.mergeRuns([...a, ...pasted[0].runs]);
          const at = lenOf(b);
          b.runs = NF.mergeRuns([...b.runs, ...z]);
          if (b.t === 'p' && pasted[0].t !== 'p' && !NF.runsText(a)) { b.t = pasted[0].t; if (b.t === 'check') b.done = !!pasted[0].done; }
          return { i, o: at };
        }
        const merge0 = pasted[0].t === 'p' || (b.t === 'p' && !NF.runsText(a));
        if (merge0) {
          if (pasted[0].t !== 'p') { b.t = pasted[0].t; if (b.t === 'check') b.done = !!pasted[0].done; else delete b.done; }
          b.runs = NF.mergeRuns([...a, ...pasted[0].runs]);
        } else b.runs = a;
        const rest = pasted.slice(merge0 ? 1 : 0).map(x => ({ ...x }));
        const tailKind = /^h/.test(b.t) ? 'p' : b.t;
        const lastR = rest[rest.length - 1];
        if (lastR && lastR.t !== 'img') {
          const at = lenOf(lastR);
          lastR.runs = NF.mergeRuns([...lastR.runs, ...z]);
          blocks.splice(i + 1, 0, ...rest);
          return { i: i + rest.length, o: at };
        }
        const tail = z.length ? [{ t: tailKind, runs: z, ...(tailKind === 'check' ? { done: false } : {}) }] : [];
        blocks.splice(i + 1, 0, ...rest, ...tail);
        return { i: i + rest.length + (tail.length ? 1 : 0), o: 0 };
      });
    }
    async function onPaste(e) {
      const dt = e.clipboardData;
      if (!dt || S.file) return;
      e.preventDefault();
      const files = [...(dt.files || [])].filter(isImageFile);
      if (files.length) {
        const at = getCaret()?.s || null;
        insertPictures(await savePictures(files), at);
        return;
      }
      const html = dt.getData('text/html');
      const text = dt.getData('text/plain');
      let blocks = null;
      if (html) {
        /* parsed inert (nothing in it loads or runs), then only read */
        const doc = new DOMParser().parseFromString(html, 'text/html');
        blocks = readBlocks(doc.body, true);
      }
      if (!blocks || !blocks.some(b => b.t === 'img' || NF.runsText(b.runs).trim())) {
        blocks = text ? NF.plainBlocks(text.replace(/\r\n?/g, '\n')) : null;
      }
      if (blocks && blocks.length) insertBlocks(blocks);
    }

    /* ---- drop: a picture from Photos/Files, or picture files from the computer */
    const dropKinds = e => [...((e.dataTransfer && e.dataTransfer.types) || [])];
    const wantsDrop = e => { const t = dropKinds(e); return t.includes(DRAG_PATH) || t.includes('Files'); };
    function onDragOver(e) {
      if (!wantsDrop(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      wrap.classList.add('is-drop');
    }
    function onDragLeave(e) { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('is-drop'); }
    async function onDrop(e) {
      wrap.classList.remove('is-drop');
      if (!wantsDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const n = current();
      if (!n) return;
      let at = null;
      const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (r && S.mode === 'edit' && rich.contains(r.startContainer)) at = posOf(r.startContainer, r.startOffset);
      const raw = e.dataTransfer.getData(DRAG_PATH);
      let paths;
      if (raw) {
        paths = raw.split('\n').map(s => s.trim()).filter(p => p && vfs.node(p) && media.kindOf(vfs.baseName(p)) === 'image');
        if (!paths.length) { api.notify({ app: 'Notes', icon: 'image', title: 'Only pictures can go in a note', timeout: 3000 }); return; }
      } else {
        const files = e.dataTransfer.files;
        if (![...files].some(isImageFile)) { api.notify({ app: 'Notes', icon: 'image', title: 'Only pictures can go in a note', message: 'Drop .png, .jpg, .gif or .webp files.', timeout: 3500 }); return; }
        paths = await savePictures(files);
      }
      insertPictures(paths, at, { end: !at });
    }

    /* ---- editor events ---- */
    rich.addEventListener('beforeinput', e => {
      if (e.isComposing) return;
      const t = e.inputType;
      if (t === 'historyUndo') { e.preventDefault(); undo(); return; }
      if (t === 'historyRedo') { e.preventDefault(); redo(); return; }
      if (t === 'insertParagraph' || t === 'insertLineBreak') { e.preventDefault(); splitLine(); return; }
      if (t === 'insertText' && e.data === ' ' && autoFormat()) { e.preventDefault(); return; }
      if (S.fig !== null) clearFig();
      if (/^format/.test(t)) { pushUndo(); return; }
      /* typing and deleting: one undo step per burst */
      if (!H.typing) { pushUndo(); H.typing = true; }
      clearTimeout(H.t);
      H.t = setTimeout(() => { H.typing = false; }, 900);
    });
    rich.addEventListener('input', e => {
      if (e.target !== rich || e.isComposing) return;
      /* a stray structure (a paste that slipped through, a merge of two
         kinds of line) is redrawn from what it says */
      const blocks = readBlocks(rich);
      const els = blockEls();
      const odd = blocks.length !== els.length || !rich.firstElementChild
        || [...rich.childNodes].some(c => (c.nodeType === 3 && c.data.trim()) || (c.nodeType === 1 && !/^(P|H1|H2|H3|UL|OL|FIGURE)$/.test(c.tagName)))
        || [...rich.querySelectorAll('ul.notes__checks > li')].some(li => li.firstChild !== li.querySelector(':scope > .notes__box'))
        || [...rich.querySelectorAll('.notes__box')].some(b => !b.parentElement.matches('ul.notes__checks > li'));
      if (odd) {
        /* the caret is kept as a count of characters: text typed straight into
           the page (after everything was deleted) has no line to count from */
        const k = charCaret();
        draw(blocks);
        if (k !== null) setCharCaret(k);
      }
      bodyChanged();
    });
    rich.addEventListener('compositionend', () => bodyChanged());
    rich.addEventListener('change', e => {
      const cb = e.target;
      if (!(cb instanceof HTMLInputElement) || !cb.closest('.notes__box')) return;
      const li = cb.closest('li');
      if (li) li.dataset.done = String(cb.checked);
      pushUndo();
      bodyChanged();
    });
    rich.addEventListener('mousedown', e => {
      const x = e.target.closest && e.target.closest('.notes__figx');
      const fig = e.target.closest && e.target.closest('figure.notes__fig');
      if (x || fig) e.preventDefault();
      if (fig && !x) selectFig(blockEls().indexOf(fig));
      else if (!fig && S.fig !== null) clearFig();
    });
    rich.addEventListener('click', e => {
      const x = e.target.closest && e.target.closest('.notes__figx');
      if (x) { const i = blockEls().indexOf(x.closest('figure')); if (i >= 0) removeFig(i); }
    });
    rich.addEventListener('dblclick', e => {
      const fig = e.target.closest && e.target.closest('figure.notes__fig');
      if (fig && fig.dataset.path && vfs.node(fig.dataset.path)) api.openFile(fig.dataset.path);
    });
    rich.addEventListener('keydown', e => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (S.fig !== null && figKey(e)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (mod && !e.altKey && !e.shiftKey && k === 'z') { e.preventDefault(); undo(); return; }
      if (mod && !e.altKey && ((e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y'))) { e.preventDefault(); redo(); return; }
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyB') { e.preventDefault(); inlineFmt('bold'); return; }
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyI') { e.preventDefault(); inlineFmt('italic'); return; }
      /* underline is not something a note keeps — don't draw what won't be saved */
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyU') { e.preventDefault(); return; }
      if (mod && !e.altKey && e.key === 'Enter') { e.preventDefault(); toggleChecks(); return; }
      if (mod && e.altKey && !e.shiftKey) {
        /* ⌘⌥1/2/3 (Ctrl+Alt+1/2/3) headings, 0 text. Off a Mac only a real digit
           counts: AltGr is Ctrl+Alt and types {, [, ], } on many layouts. */
        const d = fmt.isMac ? (e.code.match(/^Digit([0-3])$/) || [])[1] : (/^[0-3]$/.test(e.key) ? e.key : null);
        if (d) { e.preventDefault(); setType(d === '0' ? 'p' : `h${d}`); return; }
      }
      if (mod && e.shiftKey && !e.altKey) {
        const L = { Digit7: 'ol', Digit8: 'ul', Digit9: 'check' }[e.code];
        if (L) { e.preventDefault(); setType(L); return; }
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !mod && !e.altKey) edgeDelete(e);
    });
    rich.addEventListener('paste', onPaste);
    wrap.addEventListener('dragover', onDragOver);
    wrap.addEventListener('dragleave', onDragLeave);
    wrap.addEventListener('drop', onDrop);

    function headingMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      const at = getCaret();
      const go = t => () => { if (at) { rich.focus(); setSel(at.s, at.e); } setType(t); };
      api.menu([
        { label: 'Title', icon: 'type', hint: kbAlt('1'), onClick: go('h1') },
        { label: 'Heading', icon: 'type', hint: kbAlt('2'), onClick: go('h2') },
        { label: 'Subheading', icon: 'type', hint: kbAlt('3'), onClick: go('h3') },
        '-',
        { label: 'Body text', icon: 'edit-3', hint: kbAlt('0'), onClick: go('p') },
      ], r.left, r.bottom + 4, { label: 'Heading' });
    }

    /* ---------------- paint ----------------- */
    function preview(n) {
      const body = textOf(n).replace(/\s+/g, ' ').trim();
      return body || 'No additional text';
    }

    function paintFolders() {
      api.clear(foldersEl);
      const count = id => (id === 'all' ? S.notes.length : S.notes.filter(n => n.folder === id).length);
      const row = (id, name, ic) => {
        if (S.renaming === id) {
          let done = false;
          /* the draft outlives a repaint (a save elsewhere redraws the sidebar) */
          const inp = h('input.notes__fin', { value: S.renameDraft ?? name, 'aria-label': 'Folder name', spellcheck: 'false', maxlength: '60' });
          const finish = keepIt => {
            if (done) return;
            done = true;
            if (keepIt) renameFolder(id, inp.value);
            S.renaming = null;
            S.renameDraft = null;
            paintFolders(); paintList(); paintWhere();
          };
          inp.addEventListener('input', () => { S.renameDraft = inp.value; });
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
          });
          inp.addEventListener('blur', () => { if (inp.isConnected) finish(true); });
          return inp;
        }
        const on = !S.filter && S.folder === id;
        const b = h(`button.side__item.notes__folder${on ? '.is-on' : ''}`, {
          type: 'button', dataset: { folder: id }, 'aria-pressed': String(on),
          onclick: () => setFolder(id),
          ondblclick: id === 'all' ? null : () => { S.renaming = id; paintFolders(); },
          oncontextmenu: id === 'all' ? null : e => folderMenu(e, id),
          ondragover: e => { if (!dropKinds(e).includes(DRAG_NOTE)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; b.classList.add('is-drop'); },
          ondragleave: () => b.classList.remove('is-drop'),
          ondrop: e => {
            b.classList.remove('is-drop');
            const nidv = e.dataTransfer.getData(DRAG_NOTE);
            if (!nidv) return;
            e.preventDefault();
            moveNote(nidv, id === 'all' ? null : id);
          },
        }, icon(ic), h('span', { text: name }), h('small', { text: String(count(id)) }));
        return b;
      };
      foldersEl.append(row('all', 'All notes', 'notes'), ...S.folders.map(f => row(f.id, f.name, 'folder')));
      /* the name field takes the keyboard straight away, so typing a name
         right after pressing + never lands anywhere else */
      const fin = foldersEl.querySelector('input.notes__fin');
      if (fin && fin.isConnected) { fin.focus(); fin.select(); }
    }

    function paintList() {
      const list = visible();
      api.clear(listEl);
      const fo = folderOf(S.folder);
      listLabel.textContent = S.filter ? 'Search results' : S.file ? 'Open file' : fo ? fo.name : 'All notes';
      countEl.textContent = String(list.length);
      if (!list.length) {
        listEl.appendChild(S.filter
          ? h('div.empty', icon('search'), h('b', { text: 'No matches' }), h('small', { text: `No note has “${search.value.trim()}” in it.` }))
          : h('div.empty', icon('folder'), h('b', { text: 'Nothing in here yet' }),
            h('small', { text: fo ? 'Make a note here, or drag one onto this folder.' : `Press ${kb('N')} to start a note.` })));
        return;
      }
      for (const n of list) {
        const fn = S.filter && !n.path ? folderOf(n.folder) : null;
        const item = h('button.list__item.notes__item', {
          type: 'button',
          style: { alignItems: 'flex-start', padding: 'var(--sp-3) var(--sp-4)' },
          draggable: n.path ? null : 'true',
          ondragstart: n.path ? null : e => { e.dataTransfer.setData(DRAG_NOTE, n.id); e.dataTransfer.effectAllowed = 'move'; },
          onclick: () => select(n.id),
          oncontextmenu: e => itemMenu(e, n),
        },
          h('div.grow',
            h('b.trunc', { text: n.title || 'Untitled note' }),
            h('small', {
              text: preview(n),
              style: { display: '-webkit-box', webkitLineClamp: '2', webkitBoxOrient: 'vertical',
                       overflow: 'hidden', whiteSpace: 'normal', lineHeight: '1.45', marginTop: '2px' },
            }),
            fn ? h('small.notes__in', icon('folder'), h('span', { text: fn.name })) : null),
          n.path
            ? h('span.badge.badge--accent', { style: { flex: '0 0 auto' } }, icon('file-text', { size: 10 }), 'File')
            : h('small', { text: fmt.fmtAgo(n.mtime), style: { flex: '0 0 auto' } }));
        if (n.id === S.sel) item.classList.add('is-on');
        listEl.appendChild(item);
      }
    }

    function paintFoot() {
      const n = current();
      const body = n ? textOf(n) : '';
      const words = countWords(body);   /* the Words tab's rule */
      api.render(footL,
        h('span', { text: `${words} word${words === 1 ? '' : 's'}` }),
        h('span.dim', { text: '·' }),
        h('span', { text: `${body.length} character${body.length === 1 ? '' : 's'}` }));
      plan.changed();
      api.render(footR, n
        ? (S.saving ? h('span', { text: 'Saving…' })
          : h('span.row', icon('check', { size: 12 }), h('span', { text: n.path ? `Saved to ${n.path}` : `Edited ${fmt.fmtAgo(n.mtime)}` })))
        : h('span', { text: 'Nothing open' }));
    }

    function paintWhere() {
      const n = current();
      const f = n && !n.path ? folderOf(n.folder) : null;
      api.render(where, icon('folder'), h('span', { text: f ? f.name : 'No folder' }), icon('chevron-down'));
      where.setAttribute('aria-label', `Folder: ${f ? f.name : 'none'} — move this note`);
      where.hidden = !n || !!n.path;
    }

    function paintMain() {
      const n = current();
      const isFile = !!(n && n.path);
      editor.classList.toggle('hidden', !n);
      blank.classList.toggle('hidden', !!n);
      if (n) {
        if (document.activeElement !== titleIn && titleIn.value !== n.title) titleIn.value = n.title || '';
        if (isFile) { if (document.activeElement !== ta && ta.value !== n.body) ta.value = n.body || ''; }
        else if (S.drawn.id !== n.id || (S.drawn.md !== n.body && !rich.contains(document.activeElement))) drawNote(n);
      }
      ta.classList.toggle('hidden', S.mode === 'view' || !isFile);
      rich.classList.toggle('hidden', S.mode === 'view' || isFile || !n);
      view.classList.toggle('hidden', S.mode !== 'view');
      for (const b of richOnly) b.hidden = isFile;
      api.render(modeBtn, icon(S.mode === 'view' ? 'edit-3' : 'eye'), S.mode === 'view' ? 'Edit' : 'View');
      modeBtn.setAttribute('aria-pressed', String(S.mode === 'view'));
      if (S.mode === 'view' && n) renderView(n);
      paintWhere();
      win.setTitle(n ? (n.title || 'Untitled note') : 'Notes');
      win.setSubtitle(isFile ? '— read-through' : '');
      /* reopened later (js/core/reopen.js): this note, or this file */
      win.state.reopen = isFile ? { path: n.path, noteId: null, coop: null } : { noteId: S.sel, path: null, coop: null };
      paintFoot();
    }

    /* ---------------- Notes 2.0: view mode + OS links ---------------- */
    const LINK_RE = /(https:\/\/[^\s<>"']+)|\b(game|arcade|anime|project|collection):([A-Za-z0-9_-]{1,80})/g;
    const CHECK_RE = /^(\s*[-*]\s\[)( |x|X)(\]\s?)(.*)$/;

    function setMode(m) {
      flushEditor();
      S.mode = m;
      store.set('prefs.notesMode', m);
      paintMain();
      if (m === 'edit') {
        const n = current();
        if (n && n.path) ta.focus();
        else if (n) { rich.focus(); if (!getCaret()) setSel({ i: 0, o: 0 }); }
      }
    }

    /* a text file in the textarea keeps the old line tools */
    function insertLine(text) {
      if (S.mode !== 'edit') setMode('edit');
      const v = ta.value;
      const at = ta.selectionStart ?? v.length;
      const lineStart = v.lastIndexOf('\n', at - 1) + 1;
      const prefix = at === lineStart ? '' : '\n';
      ta.value = v.slice(0, at) + prefix + text + v.slice(at);
      const pos = at + prefix.length + text.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
      edit('body', ta.value);
    }
    let tokCaret = null;    /* where the caret was when a link picker opened */
    function insertToken(tok) {
      const n = current();
      if (!n) return;
      if (S.mode !== 'edit') setMode('edit');
      if (n.path) {
        const v = ta.value, at = ta.selectionStart ?? v.length;
        const pad = at > 0 && !/\s/.test(v[at - 1]) ? ' ' : '';
        ta.value = v.slice(0, at) + pad + tok + ' ' + v.slice(at);
        const pos = at + pad.length + tok.length + 1;
        ta.setSelectionRange(pos, pos); ta.focus();
        edit('body', ta.value);
        return;
      }
      rich.focus();
      if (tokCaret) setSel(tokCaret.s, tokCaret.e);
      else if (!getCaret()) { const els = blockEls(); setSel({ i: els.length - 1, o: (els[els.length - 1]?.textContent || '').length }); }
      const c = getCaret();
      const blocks = readBlocks(rich);
      const before = c ? NF.runsText(blocks[c.s.i]?.runs || []).slice(0, c.s.o) : '';
      const pad = before && !/\s$/.test(before) ? ' ' : '';
      document.execCommand('insertText', false, `${pad}${tok} `);
      tokCaret = null;
    }

    let closePick = null;
    async function pickGame(anchor) {
      const G = await import('../portal/games.data.js');
      await G.load().catch(() => {});
      const { ARCADE } = await import('../arcade/index.js');
      const r = anchor.getBoundingClientRect();
      const box = h('div.notes__pick', { role: 'dialog', 'aria-label': 'Link a game' });
      const inp = h('input.notes__pickin', { type: 'search', placeholder: 'Search games…', 'aria-label': 'Search games' });
      const res = h('div.notes__pickres');
      const close = () => { box.remove(); window.removeEventListener('pointerdown', away, true); closePick = null; };
      closePick?.();
      closePick = close;
      const away = e => { if (!box.contains(e.target)) close(); };
      const paint = () => {
        const q = inp.value.trim().toLowerCase();
        const arc = ARCADE.filter(g => !q || g.title.toLowerCase().includes(q)).slice(0, 4).map(g => ({ tok: `arcade:${g.id}`, title: g.title, sub: 'Static Arcade' }));
        const web = (q ? G.all().filter(g => g.title.toLowerCase().includes(q)) : G.all().filter(g => (g.cats || []).includes('featured'))).slice(0, 8)
          .map(g => ({ tok: `game:${g.id}`, title: g.title, sub: (g.cats || [])[0] || 'game' }));
        const rows = [...arc, ...web];
        api.render(res, rows.length ? rows.map(x => h('button.notes__pickrow', { type: 'button', onclick: () => { close(); insertToken(x.tok); } },
          h('b', { text: x.title }), h('small', { text: x.sub }))) : h('div.dim', { text: 'No games match.' }));
      };
      inp.addEventListener('input', paint);
      inp.addEventListener('keydown', e => { if (e.key === 'Escape') close(); if (e.key === 'Enter') res.querySelector('button')?.click(); });
      box.append(inp, res);
      box.style.left = `${Math.max(8, Math.min(innerWidth - 300, r.left))}px`;
      box.style.top = `${r.bottom + 6}px`;
      document.body.appendChild(box);
      paint(); inp.focus();
      setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    }
    async function pickProject(anchor) {
      const P = await import('../core/projects.js');
      const list = await P.list();
      const r = anchor.getBoundingClientRect();
      if (!list.length) { api.notify({ app: 'Notes', icon: 'sparkles', title: 'No Forge projects yet', message: 'Make a game in Static Forge and you can link it here.' }); return; }
      api.menu(list.slice(0, 15).map(p => ({ label: p.published?.title || p.name, icon: 'sparkles', onClick: () => insertToken(`project:${p.id}`) })), r.left, r.bottom + 4);
    }
    async function pickCollection(anchor) {
      const C = await import('../core/collections.js');
      const list = C.list();
      const r = anchor.getBoundingClientRect();
      if (!list.length) { api.notify({ app: 'Notes', icon: 'bookmark', title: 'No collections yet', message: 'Make one in Static Library and you can link it here.' }); return; }
      api.menu(list.map(c => ({ label: c.name, icon: 'bookmark', onClick: () => insertToken(`collection:${c.id}`) })), r.left, r.bottom + 4);
    }
    function linkMenu(anchor) {
      tokCaret = getCaret();
      const r = anchor.getBoundingClientRect();
      api.menu([
        { label: 'A game…', icon: 'gamepad', onClick: () => pickGame(anchor) },
        { label: 'A Forge project…', icon: 'sparkles', onClick: () => pickProject(anchor) },
        { label: 'A collection…', icon: 'bookmark', onClick: () => pickCollection(anchor) },
      ], r.left, r.bottom + 4, { label: 'Link' });
    }

    /** The picture picker: what is in ~/Pictures, newest first, or a file from the computer. */
    function pickPicture(anchor) {
      const n = current();
      if (!n || n.path) return;
      const at = getCaret()?.s || null;
      const r = anchor.getBoundingClientRect();
      const pics = [];
      vfs.walk(`${vfs.HOME}/Pictures`, (node, p) => {
        if (node.type === 'file' && media.kindOf(node.name) === 'image' && media.isMedia(node)) pics.push({ p, node });
      });
      pics.sort((a, b) => new Date(b.node.mtime) - new Date(a.node.mtime));
      const box = h('div.notes__pick.notes__picpick', { role: 'dialog', 'aria-label': 'Insert a picture' });
      const inp = h('input.notes__pickin', { type: 'search', placeholder: 'Search Pictures…', 'aria-label': 'Search Pictures' });
      const res = h('div.notes__pickres.notes__pics');
      const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
      const close = () => { box.remove(); window.removeEventListener('pointerdown', away, true); closePick = null; };
      closePick?.();
      closePick = close;
      const away = e => { if (!box.contains(e.target)) close(); };
      fileIn.addEventListener('change', async () => {
        const files = [...fileIn.files];
        close();
        insertPictures(await savePictures(files), at);
      });
      const paint = () => {
        const q = fold(inp.value.trim());
        const rows = pics.filter(x => !q || fold(x.node.name).includes(q)).slice(0, 60);
        api.render(res, rows.length ? rows.map(x => {
          const img = h('img', { alt: '', decoding: 'async', loading: 'lazy' });
          media.urlOf(x.p).then(u => { if (u) img.src = u; }).catch(() => {});
          return h('button.notes__pic', { type: 'button', title: x.p, onclick: () => { close(); insertPictures([x.p], at); } },
            img, h('small', { text: x.node.name }));
        }) : h('div.dim', { text: pics.length ? 'No pictures match.' : 'Pictures is empty — take one with Camera, or add one from this computer.' }));
      };
      inp.addEventListener('input', paint);
      inp.addEventListener('keydown', e => { if (e.key === 'Escape') close(); if (e.key === 'Enter') res.querySelector('button')?.click(); });
      box.append(inp, res, h('div.notes__pickfoot',
        h('button.btn.btn--sm', { type: 'button', onclick: () => fileIn.click() }, icon('upload'), 'From this computer…'),
        h('small', { text: 'Kept in Pictures › Notes' })), fileIn);
      box.style.left = `${Math.max(8, Math.min(innerWidth - 340, r.left))}px`;
      box.style.top = `${r.bottom + 6}px`;
      document.body.appendChild(box);
      paint(); inp.focus();
      setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    }

    function toForge() {
      const n = current();
      if (!n) return;
      flushEditor();
      const live = window.getSelection ? String(window.getSelection()) : '';
      const sel = S.mode === 'edit' && n.path && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
        : S.mode === 'edit' && !n.path && getCaret() ? live : '';
      const prompt = (sel || `${n.title && n.title !== 'Untitled note' ? n.title + '. ' : ''}${textOf(n).replace(LINK_RE, '')}`).replace(/\s+/g, ' ').trim().slice(0, 600);
      if (!prompt) { api.notify({ app: 'Notes', icon: 'sparkles', title: 'Nothing to make yet', message: 'Write your game idea in the note first.' }); return; }
      if (!api.getApp('forge')) { api.notify({ app: 'Notes', icon: 'alert', title: 'Static Forge isn’t installed' }); return; }
      api.openApp('forge', { prompt });
    }

    /* one resolver per kind: what a chip says and what it opens */
    const chipCache = new Map();
    async function resolveChip(kind, id) {
      const key = `${kind}:${id}`;
      if (chipCache.has(key)) return chipCache.get(key);
      let out = null;
      try {
        if (kind === 'game') { const G = await import('../portal/games.data.js'); await G.load().catch(() => {}); const g = G.byId(id); if (g) out = { title: g.title, ic: 'gamepad', open: () => api.openApp('aether-games', { url: `static://games/${g.id}` }) }; }
        else if (kind === 'arcade') { const A = await import('../arcade/index.js'); const g = A.arcadeById(id); if (g) out = { title: g.title, ic: 'gamepad', open: () => api.openApp('arcade', { game: g.id }) }; }
        else if (kind === 'project') { const P = await import('../core/projects.js'); const p = await P.get(id); if (p) out = { title: p.published?.title || p.name, ic: 'sparkles', open: () => api.openApp('forge', { project: p.id }) }; }
        else if (kind === 'collection') { const C = await import('../core/collections.js'); const c = C.get(id); if (c) out = { title: c.name, ic: 'bookmark', open: () => api.openApp('aether-library') }; }
        else if (kind === 'anime') {
          /* the anime catalogue is several MB — only name the chip if it is already loaded */
          const A = await import('../portal/anime.data.js');
          const a = (A.peek('anime') || []).find(x => String(x.id) === id);
          if (a || /^\d+$/.test(id)) out = { title: a ? a.title : `Anime #${id}`, ic: 'star', open: () => api.openApp('aether-anime', { url: `static://anime/${id}` }) };
        }
      } catch (e) { out = null; }
      chipCache.set(key, out);
      return out;
    }

    function inline(text) {
      const parts = [];
      let last = 0;
      for (const m of text.matchAll(LINK_RE)) {
        if (m.index > last) parts.push(document.createTextNode(text.slice(last, m.index)));
        if (m[1]) {
          const url = m[1].replace(/[).,;!?]+$/, '');
          parts.push(h('a.notes__link', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
          if (url.length < m[1].length) parts.push(document.createTextNode(m[1].slice(url.length)));
        } else {
          const kind = m[2], id = m[3];
          const chip = h('button.notes__chip', { type: 'button', title: `${kind}:${id}` }, icon('link'), h('span', { text: `${kind}:${id}` }));
          resolveChip(kind, id).then(r => {
            if (!chip.isConnected) return;
            if (!r) { chip.classList.add('is-missing'); chip.title = 'Not found on this device'; return; }
            api.render(chip, icon(r.ic), h('span', { text: r.title }));
            chip.onclick = r.open;
          });
          parts.push(chip);
        }
        last = m.index + m[0].length;
      }
      if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
      return parts;
    }

    const isMdFile = p => /\.(md|markdown)$/i.test(p || '');
    const viewBlocks = n => (n.path ? (isMdFile(n.path) ? NF.parse(n.body) : NF.plainBlocks(n.body)) : NF.blocksOf(n));
    function renderView(n) {
      if (!textOf(n).trim() && !NF.pictures(n.path ? '' : n.body).length) {
        api.render(view, h('div.empty', icon('sticky-note'), h('b', { text: 'This note is empty' }), h('small', { text: 'Switch to Edit to write something.' })));
        return;
      }
      api.render(view, renderBlocks(viewBlocks(n), 'view'));
    }
    /** A box ticked in View mode: the note (or that one line of a file) changes. */
    function tickView(idx, checked) {
      const n = current();
      if (!n) return;
      if (n.path) {
        const lines = String(n.body || '').split('\n');
        const mm = (lines[idx] || '').match(CHECK_RE);
        if (!mm) return;
        lines[idx] = `${mm[1]}${checked ? 'x' : ' '}${mm[3]}${mm[4]}`;
        ta.value = lines.join('\n');
        edit('body', ta.value);
        return;
      }
      const blocks = NF.blocksOf(n);
      if (!blocks[idx] || blocks[idx].t !== 'check') return;
      blocks[idx].done = checked;
      if (CO?.live(n)) { CO.fromBlocks(n, blocks); return; }
      edit('body', NF.serialize(blocks));
    }

    /** Select the first place a word appears (Spotlight opens a note "at" a match). */
    function findText(word, line) {
      const w = fold(String(word || '')).trim();
      const n = current();
      if (!w || !n) return false;
      if (n.path && S.mode === 'edit') {
        const v = ta.value, fv = fold(v);
        let from = 0;
        if (line > 1) { for (let k = 1, at = 0; k < line && at >= 0; k++) { at = v.indexOf('\n', at); if (at >= 0) from = ++at; } }
        let at = fv.indexOf(w, from);
        if (at < 0) at = fv.indexOf(w);
        if (at < 0) return false;
        ta.focus();
        ta.setSelectionRange(at, at + w.length);
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
        ta.scrollTop = Math.max(0, (v.slice(0, at).split('\n').length - 3) * lh);
        return true;
      }
      const host = S.mode === 'view' ? view : rich;
      const nodes = [];
      let all = '';
      const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let t; (t = tw.nextNode());) { nodes.push([t, all.length]); all += t.data; }
      const fa = fold(all);
      let at = fa.indexOf(w);
      while (at > 0 && /[\p{L}\p{N}]/u.test(fa[at - 1])) at = fa.indexOf(w, at + 1);
      if (at < 0) at = fa.indexOf(w);
      if (at < 0) return false;
      const spot = k => {
        for (let j = nodes.length - 1; j >= 0; j--) if (nodes[j][1] <= k) return { node: nodes[j][0], off: Math.min(nodes[j][0].data.length, k - nodes[j][1]) };
        return null;
      };
      const a = spot(at), z = spot(at + w.length);
      if (!a || !z) return false;
      if (host === rich) rich.focus();
      const r = document.createRange();
      r.setStart(a.node, a.off); r.setEnd(z.node, z.off);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      a.node.parentElement?.scrollIntoView({ block: 'center' });
      return true;
    }

    /* ---------------- Export as PDF ---------------- */
    let afterPrint = null;
    async function exportPdf() {
      const n = current();
      if (!n) { api.notify({ app: 'Notes', icon: 'printer', title: 'Pick a note to export first' }); return; }
      flushEditor();
      afterPrint?.();
      const when = new Date(n.mtime);
      const sheet = h('div.notes-print.notes__doc', { 'aria-hidden': 'true', dataset: { note: n.id || '' } },
        h('h1.notes-print__title', { text: n.title || 'Untitled note' }),
        h('div.notes-print__meta', { text: `${n.path || 'Notes'}${Number.isNaN(when.getTime()) ? '' : ` · ${when.toLocaleString()}`}` }),
        renderBlocks(viewBlocks(n), 'print'));
      document.body.appendChild(sheet);
      document.documentElement.classList.add('notes-printing');
      /* pictures are on the page before the print window takes its copy */
      await Promise.race([
        Promise.all([...sheet.querySelectorAll('figure.notes__fig')].map(f => f.ready)),
        new Promise(res => setTimeout(res, 4000)),
      ]);
      let t = 0;
      const done = () => {
        clearTimeout(t);
        sheet.remove();
        if (!document.querySelector('.notes-print')) document.documentElement.classList.remove('notes-printing');
        window.removeEventListener('afterprint', done);
        if (afterPrint === done) afterPrint = null;
      };
      afterPrint = done;
      window.addEventListener('afterprint', done);
      /* where a browser's print() returns before printing, the sheet waits a while */
      t = setTimeout(done, 120000);
      api.notify({ app: 'Notes', icon: 'printer', timeout: 9000,
        title: 'Export as PDF opens your browser’s print window',
        message: 'Choose “Save as PDF” as the printer (Destination) to get the PDF. Nothing is saved until you do.' });
      try { window.print(); } catch (err) {
        done();
        api.notify({ app: 'Notes', icon: 'alert', title: 'This browser would not print', message: String(err && err.message || err) });
      }
    }

    function paintAll() { paintFolders(); paintList(); paintMain(); CO?.paint(); }

    /* ---------------- Write together: what notes-coop.js needs from the editor ---------------- */
    const inEditor = n => !!n && current()?.id === n.id && S.mode === 'edit' && !n.path;
    /* a friend's edit touches only the lines it changed: the rest keep their nodes, so a
       selection, a loaded picture and the scroll position elsewhere are left alone */
    function patchEditor(blocks) {
      const bl = blocks.length ? blocks.slice() : [{ t: 'p', runs: [] }];
      if (bl[bl.length - 1].t === 'img') bl.push({ t: 'p', runs: [] });
      clearFig();
      const fresh = [...renderBlocks(bl, 'edit').childNodes], old = [...rich.childNodes];
      const alike = (a, b) => (a.nodeName === 'FIGURE' && b.nodeName === 'FIGURE' ? a.dataset.path === b.dataset.path : a.isEqualNode(b));
      let pre = 0, suf = 0;
      while (pre < old.length && pre < fresh.length && alike(old[pre], fresh[pre])) pre++;
      while (suf < old.length - pre && suf < fresh.length - pre && alike(old[old.length - 1 - suf], fresh[fresh.length - 1 - suf])) suf++;
      const next = old[old.length - suf] || null;
      for (let k = pre; k < old.length - suf; k++) old[k].remove();
      for (let k = pre; k < fresh.length - suf; k++) rich.insertBefore(fresh[k], next);
      syncEmpty();
    }
    CO = createCoop({
      h, icon, api, main, wrap, rich,
      current,
      note: id => S.notes.find(n => n.id === id) || null,
      inEditor,
      focused: () => rich.contains(document.activeElement),
      read: () => readBlocks(rich),
      parse: md => NF.parse(md),
      getCaret, pointAt, blockEls,
      focus: () => { rich.focus(); if (!getCaret()) setSel({ i: 0, o: 0 }); },
      open: id => { S.folder = 'all'; S.filter = ''; search.value = ''; select(id); paintAll(); },
      paint: () => paintAll(),
      /** The shared text changed: the note follows it, and the editor if it is showing. */
      show(n, blocks, title, sel) {
        const md = NF.serialize(blocks);
        const here = current()?.id === n.id;
        if (inEditor(n)) {
          patchEditor(blocks);
          S.drawn = { id: n.id, md };
          H.cur = { md, caret: null };
          if (sel && sel.s && sel.e) {
            const a = pointAt(sel.s.i, sel.s.o), z = pointAt(sel.e.i, sel.e.o);
            if (a && z) {
              if (sel.backward) window.getSelection().setBaseAndExtent(z.node, z.off, a.node, a.off);
              else window.getSelection().setBaseAndExtent(a.node, a.off, z.node, z.off);
              if (sel.scroll) (a.node.nodeType === 1 ? a.node : a.node.parentElement)?.scrollIntoView?.({ block: 'nearest' });
            }
          }
        }
        let changed = false;
        if (md !== n.body) { n.body = md; n.fmt = NF.FMT; changed = true; }
        if (title !== n.title) {
          n.title = title;
          changed = true;
          if (here) {
            if (document.activeElement !== titleIn) titleIn.value = title;
            win.setTitle(title || 'Untitled note');
          }
        }
        if (changed) { n.mtime = new Date().toISOString(); queueSave(); }
        if (here && S.mode === 'view') renderView(n);
        if (here) paintFoot();
      },
      /** A guest's own copy of the shared note. */
      addNote(title, blocks) {
        save();
        const n = { id: nid(), title, body: NF.serialize(blocks), fmt: NF.FMT, mtime: new Date().toISOString() };
        S.notes.push(n);
        S.folder = 'all';
        S.filter = ''; search.value = '';
        S.sel = n.id;
        S.mode = 'edit';
        save();
        return n;
      },
      /** The room is over: this is an ordinary note again. */
      ended() { const n = current(); if (n && !n.path) { flushEditor(); resetHistory(); } },
    });
    paintAll();
    CO.fromOpts(opts);
    if (opts?.find) requestAnimationFrame(() => findText(opts.find, opts.line));

    /* ---------------- wiring ---------------- */
    const offNotes = store.sub('notes', v => {
      if (!Array.isArray(v) || v === mine) return;
      S.notes = adopt(v);
      CO?.external();
      if (!current()) { const nx = visible()[0] || all()[0]; S.sel = nx ? nx.id : null; }
      paintAll();
    });
    const offFolders = store.sub('noteFolders', v => {
      const next = foldersOf(v);
      if (JSON.stringify(next) === JSON.stringify(S.folders)) return;
      S.folders = next;
      if (S.folder !== 'all' && !folderOf(S.folder)) S.folder = 'all';
      paintFolders(); paintList(); paintWhere();
    });

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && !e.shiftKey) { e.preventDefault(); newNote(); }
      else if (k === 's' && !e.shiftKey) { e.preventDefault(); flushEditor(); save(); }
      else if (k === 'f' && !e.shiftKey) { e.preventDefault(); search.focus(); search.select(); }
      else if (k === 'p' && !e.shiftKey) { e.preventDefault(); exportPdf(); }
    };
    window.addEventListener('keydown', onKey);
    /* "open this note / file" on a window that is already up */
    win.onReopen(o => {
      if (!o) return;
      CO?.fromOpts(o);
      if (o.path && S.file) {
        S.file.path = vfs.norm(o.path);
        S.file.body = vfs.read(o.path) || '';
        paintAll();
      } else if (o.noteId) {
        const hit = S.notes.find(n => n.id === o.noteId);
        if (hit) { S.folder = 'all'; select(hit.id); paintAll(); }
      }
      if (o.find) requestAnimationFrame(() => findText(o.find, o.line));
    });

    return () => {
      flushEditor();
      CO?.destroy();
      save();
      closeHist?.();
      NH.flush();                             /* the window closing keeps a version */
      closePick?.();
      plan.close();
      offNotes();
      offFolders();
      window.removeEventListener('keydown', onKey);
      clearTimeout(tSave);
      clearTimeout(H.t);
    };
  },
});
