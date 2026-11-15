/* ============================================================
   board.js — Static Board: a visual board for ideas.

   Game ideas, school work, projects, plans. Boards live in the
   sidebar; a board is a row of columns (a new one starts with
   Ideas, Doing and Done — add, rename, delete and reorder them)
   and each column holds cards. Cards are dragged between and
   within columns with real HTML5 drag and drop, and the same
   moves are on every card's menu (Move left / right / up / down)
   and on Alt+arrow keys, so a keyboard or a touch screen can do
   everything a mouse can. Columns drag by their header too, or
   move from the column menu.

   A card is a title, notes, a colour label, an optional checklist
   and optional links to things that really exist in StaticOS:
     · a catalogue game  portal/games.data.js — loaded only when
                         the picker opens. If the full catalogue
                         can't load, the picker says it is searching
                         the built-in shelf instead.
     · an Arcade game    arcade/index.js ARCADE
     · a Forge project   core/projects.js list()
     · a web link        https only; opened in a new tab, and only
                         when it is clicked
   Cards reach back into the OS: Play a linked game, Open a linked
   project in Forge or in Studio, and "Make this a game" hands the
   card's title + notes to Static Forge as its prompt. Forge saves
   what it builds as a project whose prompt is exactly that text,
   so when such a project appears (now, or the next time Board
   opens) it is linked to the card. Nothing is linked on a guess:
   no exact prompt match, no link — and after three days the card
   stops waiting.

   Cards can also be:
     · pinned     "Pin to top" keeps a card at the top of its column,
                  above every unpinned card (moves keep the two groups
                  apart; the newest pin goes first).
     · reacted to 👍 ❤️ 🔥 😂 🎉 💡 👀 — your own marks, on or off. Board
                  is yours alone on this device, so there is no count.
     · pictures   a card can carry one picture (Add a picture, paste,
                  or drop a file on the card panel), and a picture
                  file dropped on a column — or the column's picture
                  button — makes a new picture card. Pictures are
                  saved with the board (store, so localStorage) after
                  being shrunk to fit MAX.imageChars; all of them
                  together are capped at MAX.imageTotal, and nothing
                  is added that would push localStorage past
                  LS_CEILING — a full localStorage would stop every
                  other setting from saving. Each limit, when hit,
                  says which one and what to do.

   A card can also have a due date (shown on the card, "Due soon" in the
   filters, and on Calendar as the Board layer, js/core/callayers.js), and
   be archived (out of the board, kept under Archived… to restore). A column
   can have a work-in-progress limit, be marked as a Done column (its cards
   aren't "due" any more), be sorted, or be archived with its cards.
   Search and filters show only matching cards; moves still work on the
   whole column. Templates start a board (js/core/boards.js TEMPLATES);
   a board saves as Markdown or JSON, imports from either or from a Static
   Tasks list, copies a card to another board, and prints. Links can also
   point at a note (Static Notes) or a mind map (a .mindmap file).

   SHARE LIVE: a board can be shared with a friend over a private pair.js
   room (js/core/boardshare.js): card text, checklists, colours, due dates,
   pins and columns travel; pictures, links and reactions stay on each
   device. Both can edit; edits merge field by field.

   Other apps can hand Board an idea:
     openApp('board', { add: { title, notes?, link? } })   new card
     openApp('board', { board: id } | { card: id })        show it

   Everything is saved in store('portal.board') on this device.
   Design notes:
   · store.set() no-ops on the same reference, so every write ships
     a fresh deep copy. Typing is debounced and flushed on close.
   · The saved value is the only input and is read as untrusted: a
     null, a number or a string in the list of boards, columns or
     cards is dropped rather than turned into an "Untitled" row, and
     every date is clamped to a date a Date can hold.
   · Nothing opens on a guess. A linked catalogue game is looked up
     in the catalogue, a linked project is read back out of
     IndexedDB, and an Arcade game must be in this build — if it
     isn't there the card says so instead of opening something dead.
   · A question (delete this column, delete this card) finds its
     target again by id when it is answered: the board can have been
     rewritten by another window while the sheet was up.
   · A re-render keeps each column's scroll position and puts focus
     back on the same control (data-fk keys), so a keyboard move or
     a checklist tick never throws focus to the top of the window.
     A commit that comes from a blur waits for the pointer to lift,
     so the click that caused the blur still lands.
   · Nothing on screen is invented: counts are measured, dates are
     the card's own, empty states say what is actually true.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as Projects from '../core/projects.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import * as BD from '../core/boards.js';
import { validDay, dayOf, read as readTasks } from '../core/tasks.js';

/* self-injected stylesheet, guarded so re-opening never double-adds it */
if (typeof document !== 'undefined' && !document.getElementById('feat-board-css')) {
  const link = document.createElement('link');
  link.id = 'feat-board-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-board.css';
  document.head.appendChild(link);
}

const STORE_KEY = 'portal.board';
const DEFAULT_COLS = ['Ideas', 'Doing', 'Done'];
const SUGGESTED = [
  { name: 'Game ideas', icon: 'gamepad' },
  { name: 'School work', icon: 'file-text' },
  { name: 'Plans', icon: 'calendar' },
];
const LABELS = [
  { id: 'none', name: 'No colour' },
  { id: 'red', name: 'Red' },
  { id: 'orange', name: 'Orange' },
  { id: 'yellow', name: 'Yellow' },
  { id: 'green', name: 'Green' },
  { id: 'blue', name: 'Blue' },
  { id: 'purple', name: 'Purple' },
  { id: 'pink', name: 'Pink' },
];
const LABEL_IDS = LABELS.map(l => l.id);
const LINK_KINDS = ['game', 'arcade', 'project', 'url', 'note', 'mindmap'];
const PICK_TITLE = { game: 'Link a catalogue game', arcade: 'Link an Arcade game', project: 'Link a Forge project', url: 'Link a web page', note: 'Link a note', mindmap: 'Link a mind map' };
const MAX = {
  boards: 60, cols: 16, cards: 400, check: 80, links: 12, archive: 300, archivedCols: 30,
  title: 200, notes: 4000, colName: 40, boardName: 60, item: 200, linkTitle: 120, url: 2000,
  alt: 200,
  imageChars: 160000,         /* one card's picture, as saved (a data URL) — about 120 KB */
  imageTotal: 1200000,        /* every picture on every board together — about 0.9 MB */
};
/* Reactions are your own marks on a card (Board is yours alone on this
   device), so a reaction is on or off — there is no count to show. */
const REACTIONS = ['👍', '❤️', '🔥', '😂', '🎉', '💡', '👀'];
const REACTION_NAMES = { '👍': 'thumbs up', '❤️': 'heart', '🔥': 'fire', '😂': 'laughing', '🎉': 'party', '💡': 'idea', '👀': 'eyes' };
/* Pictures are saved with the board, in this device's localStorage, which
   holds only a few MB for all of StaticOS — and when it is full, nothing
   else saves either. So a picture is shrunk before it is kept, every
   picture is capped, all of them together are capped, and nothing is
   added that would take localStorage past LS_CEILING. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_FILE = 20 * 1024 * 1024;
const IMAGE_SIDES = [720, 560, 420, 320];
const LS_CEILING = 4500000;               /* characters, of the ~5 million browsers allow */
const DATA_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const kbOf = n => `${Math.max(1, Math.round(n / 1024)).toLocaleString()} KB`;
const PENDING_MS = 3 * 24 * 3600 * 1000;   /* how long a card waits for Forge */
const SOON_DAYS = 7;                       /* "Due soon": overdue, or due within this many days */
const IMAGE_WARN = 0.8;                    /* say so when pictures pass this share of either limit */
const LIMITS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20];
const SORTS = [['title', 'Title (A to Z)'], ['due', 'Due date (soonest first)'], ['new', 'Newest first'], ['old', 'Oldest first'], ['color', 'Colour label']];
const NARROW = 600;                        /* below this app width: one pane at a time */
const DOCK_MIN = 740;                      /* below this main width the card panel floats */

const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = v => (isObj(v) ? v : {});
const arr = v => (Array.isArray(v) ? v : []);
/* only real entries become boards, columns and cards: a null or a stray number in
   the saved list is junk, and inventing an "Untitled" row for it would be a lie */
const objs = v => arr(v).filter(isObj);
/* A Date can only hold ±8.64e15 ms; a hand-edited (or garbled) value outside that
   makes new Date(x).toISOString() throw, which used to take the card panel down. */
const MAX_TIME = 8.64e15;
const stamp = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n !== 0 && Math.abs(n) <= MAX_TIME ? n : fb; };
/* one line of text: whitespace collapsed, trimmed, capped. This is also exactly
   what Static Forge does to a prompt, which is what makes the prompt match exact. */
const line = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const labelName = id => (LABELS.find(l => l.id === id) || LABELS[0]).name;
const esc = s => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

/** https URLs only. "example.com" is read as https://example.com. -> href | null */
function httpsUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
  return u.href.length <= MAX.url ? u.href : null;
}
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

/* ---- shape guards: the store is the only input, but treat it as untrusted ---- */
function normLink(l) {
  const o = obj(l);
  if (!LINK_KINDS.includes(o.kind)) return null;
  const ref = o.kind === 'url' ? httpsUrl(o.ref)
    : o.kind === 'mindmap' ? (/^\/[^\u0000]*\.mindmap$/i.test(String(o.ref || '')) ? String(o.ref).slice(0, 400) : '')
      : String(o.ref ?? '').trim().slice(0, 200);
  if (!ref) return null;
  return { id: String(o.id || uid('ln')), kind: o.kind, ref, title: line(o.title, MAX.linkTitle) };
}
function normItem(i) {
  const o = obj(i);
  const text = line(o.text, MAX.item);
  return text ? { id: String(o.id || uid('ci')), text, done: !!o.done } : null;
}
function normPending(f) {
  const o = obj(f);
  const prompt = line(o.prompt, 600);
  const at = stamp(o.at, 0);
  return prompt && at && Date.now() - at < PENDING_MS ? { prompt, at } : null;
}
/** A card's picture: a small image data URL, checked, or null. */
function normImage(v) {
  const o = obj(v);
  const src = typeof o.src === 'string' ? o.src : '';
  if (!src || src.length > MAX.imageChars || !DATA_IMG.test(src)) return null;
  const dim = n => clamp(Math.round(Number(n) || 0), 0, 4096);
  return { src, w: dim(o.w), h: dim(o.h), alt: line(o.alt, MAX.alt) };
}
function normCard(c) {
  const o = obj(c);
  const now = Date.now();
  const created = stamp(o.created, now);
  return {
    id: String(o.id || uid('c')),
    title: line(o.title, MAX.title) || 'Untitled card',
    notes: String(o.notes ?? '').slice(0, MAX.notes),
    color: LABEL_IDS.includes(o.color) ? o.color : 'none',
    checklist: objs(o.checklist).map(normItem).filter(Boolean).slice(0, MAX.check),
    links: objs(o.links).map(normLink).filter(Boolean).slice(0, MAX.links),
    forge: normPending(o.forge),
    pinned: o.pinned === true,
    reactions: REACTIONS.filter(e => arr(o.reactions).includes(e)),
    image: normImage(o.image),
    due: validDay(o.due) ? o.due : null,
    created,
    updated: stamp(o.updated, created),
  };
}
/* pinned cards sit together at the top of their column, in their own order */
const pinFirst = cards => [...cards.filter(c => c.pinned), ...cards.filter(c => !c.pinned)];
const pinCount = col => col.cards.reduce((n, c) => n + (c.pinned ? 1 : 0), 0);
function normCol(c) {
  const o = obj(c);
  const name = line(o.name, MAX.colName) || 'Untitled';
  const limit = Number(o.limit);
  return {
    id: String(o.id || uid('col')), name, cards: pinFirst(objs(o.cards).map(normCard).slice(0, MAX.cards)),
    /* 0 = no limit. done: its cards are finished, so not "due" (a column called Done, until said otherwise) */
    limit: Number.isInteger(limit) && limit >= 1 && limit <= MAX.cards ? limit : 0,
    done: BD.colDone({ name, done: o.done }),
  };
}
/** An archived card: the card, the column it came from (to go back to), when. */
function normArchived(a) {
  const o = obj(a);
  if (!isObj(o.card)) return null;
  return { card: normCard(o.card), col: String(o.col || ''), colName: line(o.colName, MAX.colName), at: stamp(o.at, Date.now()) };
}
function normArchivedCol(a) {
  const o = obj(a);
  if (!isObj(o.col)) return null;
  return { col: normCol(o.col), at: stamp(o.at, Date.now()), idx: clamp(Math.round(Number(o.idx) || 0), 0, MAX.cols) };
}
/** Every card on a board, archived ones too. */
const allCards = b => [...b.cols.flatMap(col => col.cards), ...b.archive.map(a => a.card), ...b.archivedCols.flatMap(a => a.col.cards)];
/** Characters of picture data on every board (archived cards keep theirs). */
const imageChars = data => data.boards.reduce((n, b) => n + allCards(b).reduce((k, c) => k + (c.image ? c.image.src.length : 0), 0), 0);
/** Characters in this site's localStorage (keys + values), or null if it can't be read. */
function storageChars() {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += k.length + (localStorage.getItem(k) || '').length;
    }
    return n;
  } catch (e) { return null; }
}
/* decode a picture file: an ImageBitmap where there is one, else an <img> */
function decodeImage(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
    im.src = url;
  });
}
/**
 * A picture file, made small enough to keep with a board:
 * -> { src, w, h } or throws an Error whose message says what to do.
 */
async function shrinkImage(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) throw new Error('Only PNG, JPEG, WebP or GIF pictures can go on a card.');
  if (file.size > MAX_IMAGE_FILE) throw new Error(`That picture is ${(file.size / 1048576).toFixed(1)} MB. Pictures up to ${MAX_IMAGE_FILE / 1048576} MB can be added (they are made smaller first).`);
  let img;
  try { img = await decodeImage(file); } catch (e) { throw new Error('This browser couldn’t read that picture.'); }
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
  if (!iw || !ih) throw new Error('That picture has no size.');
  try {
    for (const side of IMAGE_SIDES) {
      const s = Math.min(1, side / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      for (const q of [0.82, 0.7, 0.58]) {
        let src = cv.toDataURL('image/webp', q);
        if (!src.startsWith('data:image/webp')) {          /* no WebP encoder: JPEG, on a backing */
          g.globalCompositeOperation = 'destination-over';
          g.fillStyle = '#1a1220';
          g.fillRect(0, 0, w, h);
          g.globalCompositeOperation = 'source-over';
          src = cv.toDataURL('image/jpeg', q);
        }
        if (src.length <= MAX.imageChars) return { src, w, h };
      }
    }
  } finally { if (typeof img.close === 'function') img.close(); }
  throw new Error('That picture is too detailed to keep on a card, even made smaller. Try a simpler or smaller one.');
}
function normBoard(b) {
  const o = obj(b);
  const now = Date.now();
  const created = stamp(o.created, now);
  return {
    id: String(o.id || uid('b')),
    name: line(o.name, MAX.boardName) || 'Untitled board',
    created,
    updated: stamp(o.updated, created),
    cols: objs(o.cols).map(normCol).slice(0, MAX.cols),
    archive: objs(o.archive).map(normArchived).filter(Boolean).slice(0, MAX.archive),
    archivedCols: objs(o.archivedCols).map(normArchivedCol).filter(Boolean).slice(0, MAX.archivedCols),
  };
}
function normalize(raw) {
  const d = obj(raw);
  const boards = objs(d.boards).map(normBoard).slice(0, MAX.boards);
  /* moves, focus and links all address things by id — re-key any repeats */
  const seen = new Set();
  const fresh = (id, p) => { let v = id; while (seen.has(v)) v = uid(p); seen.add(v); return v; };
  for (const b of boards) {
    b.id = fresh(b.id, 'b');
    for (const col of [...b.cols, ...b.archivedCols.map(a => a.col)]) col.id = fresh(col.id, 'col');
    for (const c of allCards(b)) {
      c.id = fresh(c.id, 'c');
      for (const it of c.checklist) it.id = fresh(it.id, 'ci');
      for (const l of c.links) l.id = fresh(l.id, 'ln');
    }
  }
  let activeId = String(d.activeId || '');
  if (!boards.some(b => b.id === activeId)) activeId = boards[0] ? boards[0].id : '';
  return { v: 1, boards, activeId };
}
/* plain JSON all the way down, so this is a true deep copy */
const cloneData = d => JSON.parse(JSON.stringify(d));
const countCards = b => b.cols.reduce((n, c) => n + c.cards.length, 0);

/** Title + notes, the way Forge will read it (Forge clips to 600 the same way). */
function forgePrompt(c) {
  const t = line(c.title, MAX.title);
  const n = line(c.notes, 600);
  return line(n ? `${t}${/[.!?:;]$/.test(t) ? '' : '.'} ${n}` : t, 600);
}

/** The board as Markdown, for Save as Markdown (Documents). */
function boardMarkdown(b, info) {
  const out = [`# ${b.name}`, ''];
  for (const col of b.cols) {
    out.push(`## ${col.name}`, '');
    if (!col.cards.length) out.push('_No cards_', '');
    for (const c of col.cards) {
      out.push(`- ${c.pinned ? '📌 ' : ''}**${c.title}**${c.color !== 'none' ? ` (${labelName(c.color).toLowerCase()})` : ''}${c.reactions.length ? ` ${c.reactions.join('')}` : ''}${c.due ? ` — due ${c.due}` : ''}`);
      if (c.image) out.push(`  [Picture${c.image.alt ? `: ${c.image.alt}` : ''} — kept in Static Board on this device]`);
      for (const ln of c.notes.trim() ? c.notes.trim().split('\n') : []) out.push(`  ${ln.trimEnd()}`);
      for (const it of c.checklist) out.push(`  - [${it.done ? 'x' : ' '}] ${it.text}`);
      for (const l of c.links) {
        const i = info(l);
        out.push(`  - ${i.sub}: ${l.kind === 'url' ? l.ref : i.title}`);
      }
    }
    if (col.cards.length) out.push('');
  }
  return out.join('\n');
}

defineApp({
  id: 'board',
  name: 'Static Board',
  icon: 'clipboard',
  g1: '#2ac2b2', g2: '#06676c',
  category: 'Productivity',
  keywords: ['board', 'boards', 'kanban', 'cards', 'columns', 'ideas', 'idea', 'game ideas', 'brainstorm', 'planning', 'plan', 'planner', 'project', 'projects', 'school', 'schoolwork', 'homework', 'todo', 'organise', 'organize', 'due date', 'template', 'share board', 'archive', 'wip limit'],
  desc: 'Boards of cards for game ideas, school work, projects and plans',
  singleton: true,
  win: { w: 1000, h: 620, minW: 420, minH: 380 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus, confirm, menu, notify, fmt } = api;
    const IID = uid('bd');                       /* unique DOM ids for this window */
    const ALT = fmt && fmt.isMac ? '⌥' : 'Alt+';
    /* keyboard hints in menus mean nothing on a touch-only screen */
    const hint = k => (typeof matchMedia === 'function' && matchMedia('(hover: none)').matches ? null : k);

    const S = {
      data: normalize(store.get(STORE_KEY)),
      openId: null,          /* card shown in the card panel */
      picker: null,          /* { kind, q, url, label, err, listEl, statusEl } */
      addingBoard: false,
      renamingBoard: false,
      addingCol: false,
      renamingCol: null,
      narrow: false,
      pane: 'board',         /* on a narrow window: 'boards' | 'board' */
      drag: null,            /* { type: 'card'|'col', id } */
      drop: null,
      dirty: false,          /* a render was asked for mid-drag */
      focus: null,           /* data-fk (or '@selector') to focus after the next render */
      reveal: false,         /* scroll that focus target into view */
      drafts: {},            /* unsent text in inputs that a re-render rebuilds */
      rendering: false,
      again: false,
      shownBoard: null,
      projects: null,        /* [{ id, name, prompt, createdAt, updatedAt, source, published }] */
      projectsErr: null,
      cat: { state: 'idle' },
      ptrDown: false,
      renderOnUp: false,
      imgBusy: false,        /* a picture is being made smaller */
      imgErr: '',            /* why the last picture wasn't added */
      picWarned: 0,          /* how loudly picture space has been said to be filling (#36) */
      filter: { q: '', labels: [], soon: false, over: false, dated: false, pinned: false, check: false, pic: false },
      archiveOpen: false,    /* the card panel shows this board's archive */
      sharePanel: null,      /* the card panel shows Share live: { role, code, err } */
      share: null,           /* a live share of the active board (js/core/boardshare.js) */
      dead: false,
    };

    /* ---------------- timers / frames we own ---------------- */
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); if (!S.dead) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };
    const frames = new Set();
    const frame = fn => {
      const id = requestAnimationFrame(() => { frames.delete(id); if (!S.dead) fn(); });
      frames.add(id);
      return id;
    };

    /* ---------------- persistence ---------------- */
    let lastSaved = null;
    let saveT = 0;
    function persist() {
      cancel(saveT); saveT = 0;
      lastSaved = cloneData(S.data);
      store.set(STORE_KEY, lastSaved);
      shareLocal();
    }
    function persistSoon() { cancel(saveT); saveT = later(() => { saveT = 0; persist(); }, 300); }
    function flushPersist() { if (saveT) persist(); }
    function commit() { persist(); render(); }

    /* ---------------- lookups ---------------- */
    const activeBoard = () => S.data.boards.find(b => b.id === S.data.activeId) || null;
    function locateIn(b, cardId) {
      for (let ci = 0; ci < b.cols.length; ci++) {
        const i = b.cols[ci].cards.findIndex(c => c.id === cardId);
        if (i >= 0) return { board: b, col: b.cols[ci], ci, i, card: b.cols[ci].cards[i] };
      }
      return null;
    }
    const locate = cardId => { const b = activeBoard(); return b ? locateIn(b, cardId) : null; };
    function findAnywhere(cardId) {
      for (const b of S.data.boards) { const r = locateIn(b, cardId); if (r) return r; }
      return null;
    }
    const touchBoard = b => { if (b) b.updated = Date.now(); };
    const hasProjectRefs = () => S.data.boards.some(b => b.cols.some(col => col.cards.some(c => c.forge || c.links.some(l => l.kind === 'project'))));
    const forgeThumbs = () => obj(store.get('portal.forge.thumbs', {}));

    /* screen-reader announcements for things that change out of sight */
    let sayT = 0;
    function say(text) {
      cancel(sayT);
      live.textContent = '';
      sayT = later(() => { live.textContent = text; }, 60);
    }
    const tell = (title, message, ic = 'clipboard') => notify({ app: 'Static Board', icon: ic, title, message, timeout: 4500 });
    /** "2d ago" from a ms stamp — never throws, whatever is in the store */
    const ago = ms => {
      const n = Number(ms);
      return Number.isFinite(n) && Math.abs(n) <= MAX_TIME ? fmt.fmtAgo(new Date(n).toISOString()) : '—';
    };

    /* confirm() that gives focus back to where it was if the answer is no */
    async function ask(o) {
      const back = captureFocus();
      const ok = await confirm(o);
      if (S.dead) return false;
      if (!ok) restoreFocus(back);
      return ok;
    }

    /* ==================================================================== */
    /*  boards                                                              */
    /* ==================================================================== */
    function createBoard(name, tpl = null) {
      const nm = line(name, MAX.boardName);
      if (!nm) return null;
      if (S.data.boards.length >= MAX.boards) { tell('Too many boards', `A device holds up to ${MAX.boards} boards. Delete one to make room.`, 'alert'); return null; }
      const b = normBoard({ name: nm, cols: tpl ? tpl.cols.map(c => ({ ...c })) : DEFAULT_COLS.map(n => ({ name: n })) });
      S.archiveOpen = false;
      S.data.boards.push(b);
      S.data.activeId = b.id;
      S.addingBoard = false;
      S.renamingBoard = false;
      S.openId = null;
      S.picker = null;
      S.pane = 'board';
      S.focus = `add:${b.cols[0].id}`;
      commit();
      say(`Made the board ${nm}`);
      return b;
    }
    function selectBoard(id) {
      if (S.data.activeId !== id) {
        flushPersist();
        S.data.activeId = id;
        S.openId = null;
        S.picker = null;
        S.renamingBoard = false;
        S.addingCol = false;
        S.renamingCol = null;
        S.archiveOpen = false;
        persist();
      }
      S.pane = 'board';
      render();
    }
    function startRenameBoard() {
      const b = activeBoard();
      if (!b) return;
      S.renamingBoard = true;
      S.drafts.boardName = b.name;
      S.focus = 'board-rename';
      if (S.narrow) S.pane = 'board';
      render();
    }
    async function deleteBoard(id) {
      const b = S.data.boards.find(x => x.id === id);
      if (!b) return;
      const n = countCards(b);
      const ok = await ask({
        title: 'Delete this board?',
        message: `“${b.name}”${n ? ` and its ${plural(n, 'card')}` : ''} will be removed from this device. This can’t be undone.`,
        ok: 'Delete', danger: true,
      });
      if (!ok) return;
      const i = S.data.boards.findIndex(x => x.id === id);
      if (i < 0) return;
      if (S.share && S.share.boardId === id) stopShare('deleted');
      S.data.boards.splice(i, 1);
      if (S.data.activeId === id) {
        const next = S.data.boards[i] || S.data.boards[i - 1] || null;
        S.data.activeId = next ? next.id : '';
        S.openId = null;
        S.picker = null;
      }
      S.focus = S.data.activeId ? `board:${S.data.activeId}` : 'empty-new';
      commit();
      say(`Deleted the board ${b.name}`);
    }
    function moveBoard(id, dir) {
      const i = S.data.boards.findIndex(b => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= S.data.boards.length) return;
      const list = S.data.boards;
      [list[i], list[j]] = [list[j], list[i]];
      S.focus = `board:${id}`;
      commit();
    }

    /* ==================================================================== */
    /*  columns                                                             */
    /* ==================================================================== */
    function startAddCol() {
      const b = activeBoard();
      if (!b) return;
      if (b.cols.length >= MAX.cols) { tell('That’s a lot of columns', `A board holds up to ${MAX.cols} columns.`, 'alert'); return; }
      S.addingCol = true;
      S.drafts.newCol = '';
      S.focus = 'addcol';
      render();
      colsEl.scrollLeft = colsEl.scrollWidth;
    }
    function addCol(name, keepOpen) {
      const b = activeBoard();
      const nm = line(name, MAX.colName);
      if (!b || !nm) return;
      if (b.cols.length >= MAX.cols) { S.addingCol = false; render(); return; }
      const col = normCol({ name: nm });
      b.cols.push(col);
      touchBoard(b);
      S.addingCol = keepOpen && b.cols.length < MAX.cols;
      S.drafts.newCol = '';
      if (keepOpen) S.focus = S.addingCol ? 'addcol' : `add:${col.id}`;
      persist();
      if (keepOpen) { render(); colsEl.scrollLeft = colsEl.scrollWidth; } else renderSoon();
      say(`Added the column ${nm}`);
    }
    function startRenameCol(id) {
      const b = activeBoard();
      const col = b && b.cols.find(c => c.id === id);
      if (!col) return;
      S.renamingCol = id;
      S.drafts.colName = col.name;
      S.focus = `colname:${id}`;
      render();
    }
    function renameCol(id, name, viaBlur) {
      const b = activeBoard();
      const col = b && b.cols.find(c => c.id === id);
      S.renamingCol = null;
      const nm = line(name, MAX.colName);
      if (col && nm && nm !== col.name) { col.name = nm; touchBoard(b); persist(); }
      if (viaBlur) renderSoon(); else { S.focus = `colmore:${id}`; render(); }
    }
    function moveCol(id, dir) {
      const b = activeBoard();
      if (!b) return;
      const i = b.cols.findIndex(c => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= b.cols.length) return;
      [b.cols[i], b.cols[j]] = [b.cols[j], b.cols[i]];
      touchBoard(b);
      S.focus = `colmore:${id}`;
      S.reveal = true;
      commit();
      say(`Moved the column ${b.cols[j].name} to position ${j + 1} of ${b.cols.length}`);
    }
    async function deleteCol(id) {
      const b0 = activeBoard();
      const col0 = b0 && b0.cols.find(c => c.id === id);
      if (!col0) return;
      if (col0.cards.length) {
        const ok = await ask({
          title: 'Delete this column?',
          message: `“${col0.name}” and its ${plural(col0.cards.length, 'card')} will be removed from “${b0.name}”. This can’t be undone.`,
          ok: 'Delete', danger: true,
        });
        if (!ok) return;
      }
      /* the board can be rewritten while the question is up (another window,
         another tab), so find the column again by id and work on what is there now */
      const b = activeBoard();
      const i = b ? b.cols.findIndex(c => c.id === id) : -1;
      if (i < 0) { tell('That column is gone', `“${col0.name}” was already removed.`, 'alert'); render(); return; }
      const col = b.cols[i];
      if (S.openId && col.cards.some(c => c.id === S.openId)) { S.openId = null; S.picker = null; }
      b.cols.splice(i, 1);
      touchBoard(b);
      const next = b.cols[i] || b.cols[i - 1];
      S.focus = next ? `colmore:${next.id}` : 'addcol-btn';
      commit();
      say(`Deleted the column ${col.name}`);
    }

    /* ==================================================================== */
    /*  cards                                                               */
    /* ==================================================================== */
    function addCard(colId, text) {
      const b = activeBoard();
      const col = b && b.cols.find(c => c.id === colId);
      const title = line(text, MAX.title);
      if (!col || !title) return;
      if (col.cards.length >= MAX.cards) { tell('This column is full', `A column holds up to ${MAX.cards} cards.`, 'alert'); return; }
      col.cards.splice(pinCount(col), 0, normCard({ title }));   /* top of the column, under any pinned cards */
      touchBoard(b);
      S.drafts[colId] = '';
      S.focus = `add:${colId}`;
      commit();
      say(`Added ${title} to ${col.name}`);
      overLimit(col);
    }
    /** Change a card's content. soft = from typing (debounced save, board only). */
    function editCard(id, fn, o = {}) {
      const loc = locate(id);
      if (!loc) return;
      fn(loc.card);
      loc.card.updated = Date.now();
      touchBoard(loc.board);
      /* typing changes one card and nothing else, so swap that one card in place:
         rebuilding every column on every keystroke is slow on a full board */
      if (o.soft) { persistSoon(); if (!S.drag && !repaintCard(loc.card)) paint(() => renderCols(loc.board)); return; }
      persist();
      if (o.later) renderSoon(); else render();
    }
    function moveCardTo(id, colId, idx) {
      const loc = locate(id);
      const dest = loc && loc.board.cols.find(c => c.id === colId);
      if (!loc || !dest) return false;
      if (dest !== loc.col && dest.cards.length >= MAX.cards) { tell('That column is full', `A column holds up to ${MAX.cards} cards.`, 'alert'); return false; }
      loc.col.cards.splice(loc.i, 1);
      /* a pinned card stays among the pinned ones, an unpinned card below them */
      const pins = pinCount(dest);
      const at = loc.card.pinned ? clamp(idx, 0, pins) : clamp(idx, pins, dest.cards.length);
      dest.cards.splice(at, 0, loc.card);
      touchBoard(loc.board);
      if (dest !== loc.col) later(() => overLimit(dest), 0);
      return true;
    }
    /** Where a card can go with Move up / Move down: [lowest, highest] index. */
    function moveRange(col, card) {
      const pins = pinCount(col);
      return card.pinned ? [0, pins - 1] : [pins, col.cards.length - 1];
    }
    function announceSpot(id) {
      const now = locate(id);
      if (now) say(`Moved to ${now.col.name}, ${now.i + 1} of ${now.col.cards.length}`);
    }
    function moveCard(id, dir) {
      const loc = locate(id);
      if (!loc) return;
      const { board: b, col, ci, i } = loc;
      let to = col;
      let idx;
      const [lo, hi] = moveRange(col, loc.card);
      /* up and down go past the next card that is shown (a filter can hide some) */
      if (dir === 'up') { const j = neighbour(col, i, -1); if (j < 0 || j < lo) return; idx = j; }
      else if (dir === 'down') { const j = neighbour(col, i, 1); if (j < 0 || j > hi) return; idx = j; }
      else {
        to = b.cols[ci + (dir === 'left' ? -1 : 1)];
        if (!to) return;
        idx = Math.min(i, to.cards.length);
      }
      if (!moveCardTo(id, to.id, idx)) return;
      S.reveal = true;
      commit();
      announceSpot(id);
    }
    function moveCardToCol(id, colId) {
      if (!moveCardTo(id, colId, 0)) { render(); return; }
      commit();
      announceSpot(id);
    }
    function duplicateCard(id) {
      const loc = locate(id);
      if (!loc) return;
      if (loc.col.cards.length >= MAX.cards) { tell('This column is full', `A column holds up to ${MAX.cards} cards.`, 'alert'); return; }
      const src = loc.card;
      /* the copy takes the picture only if there is room for a second one */
      const pic = src.image && !imageRoomError(src.image.src.length, 0) ? { ...src.image } : null;
      const copy = normCard({
        title: src.title, notes: src.notes, color: src.color, due: src.due,
        checklist: src.checklist.map(it => ({ text: it.text, done: it.done })),
        links: src.links.map(l => ({ kind: l.kind, ref: l.ref, title: l.title })),
        image: pic,
      });
      loc.col.cards.splice(Math.max(loc.i + 1, pinCount(loc.col)), 0, copy);
      touchBoard(loc.board);
      S.focus = `card:${copy.id}`;
      S.reveal = true;
      commit();
      say(`Duplicated ${src.title}`);
      if (src.image && !pic) tell('Copied without the picture', imageRoomError(src.image.src.length, 0), 'alert');
    }

    /* ---- pins and reactions ---- */
    function togglePin(id) {
      const loc = locate(id);
      if (!loc) return;
      const { col, card } = loc;
      col.cards.splice(loc.i, 1);
      card.pinned = !card.pinned;
      /* pinning puts it at the very top; unpinning, at the top of the rest */
      col.cards.splice(card.pinned ? 0 : pinCount(col), 0, card);
      card.updated = Date.now();
      touchBoard(loc.board);
      S.reveal = true;
      commit();
      say(card.pinned ? `Pinned ${card.title} to the top of ${col.name}` : `Unpinned ${card.title}`);
    }
    function toggleReaction(id, emoji) {
      if (!REACTIONS.includes(emoji)) return;
      let on = false;
      editCard(id, c => {
        on = !c.reactions.includes(emoji);
        c.reactions = REACTIONS.filter(e => (e === emoji ? on : c.reactions.includes(e)));
      });
      say(`${on ? 'Reacted' : 'Removed the reaction'} ${REACTION_NAMES[emoji] || emoji}`);
    }

    /* ---- pictures ---- */
    /** Why a picture of `chars` (replacing one of `freed`) can't be kept — or '' if it can. */
    function imageRoomError(chars, freed) {
      const total = imageChars(S.data) - freed + chars;
      if (total > MAX.imageTotal) {
        return `Board pictures are full: they can use ${kbOf(MAX.imageTotal)} on this device, and this one would take them to ${kbOf(total)}. Remove the picture from another card to make room.`;
      }
      const used = storageChars();
      if (used != null && used - freed + chars > LS_CEILING) {
        return 'This device’s storage for StaticOS is nearly full, so the picture wasn’t added — saving it could stop your other settings from saving. Remove some pictures or notes first.';
      }
      return '';
    }
    let filePick = null;                         /* what the hidden file input is choosing for */
    const fileIn = h('input.sr', {
      type: 'file', accept: IMAGE_TYPES.join(','), tabindex: '-1', 'aria-hidden': 'true',
      onchange: e => { const f = e.target.files && e.target.files[0]; const fn = filePick; filePick = null; e.target.value = ''; if (f && fn) fn(f); },
    });
    function pickImage(fn) { filePick = fn; fileIn.click(); }
    /** Shrink a file and check there is room. -> { src, w, h } or null (and says why). */
    async function prepareImage(file, freed) {
      S.imgBusy = true;
      S.imgErr = '';
      renderSoon();
      let pic = null;
      try { pic = await shrinkImage(file); } catch (err) { S.imgErr = String(err && err.message || err); }
      if (S.dead) return null;
      S.imgBusy = false;
      if (pic) {
        const why = imageRoomError(pic.src.length, freed);
        if (why) { S.imgErr = why; pic = null; }
      }
      if (!pic) { tell('Picture not added', S.imgErr, 'alert'); renderSoon(); }
      return pic;
    }
    async function setImage(cardId, file) {
      const loc = locate(cardId);
      if (!loc) return;
      const pic = await prepareImage(file, loc.card.image ? loc.card.image.src.length : 0);
      if (!pic || !locate(cardId)) return;
      const alt = line(file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '), MAX.alt);
      S.focus = 'img-alt';
      editCard(cardId, c => { c.image = { ...pic, alt: c.image && c.image.alt ? c.image.alt : alt }; });
      say('Picture added');
      warnPictures(pic.src.length);
    }
    function removeImage(cardId) {
      S.focus = 'img-add';
      S.imgErr = '';
      editCard(cardId, c => { c.image = null; });
      say('Picture removed');
    }
    /** A new card that is a picture: the file's name is its title. */
    async function addImageCard(colId, file) {
      const b0 = activeBoard();
      const col0 = b0 && b0.cols.find(c => c.id === colId);
      if (!col0) return;
      if (col0.cards.length >= MAX.cards) { tell('This column is full', `A column holds up to ${MAX.cards} cards.`, 'alert'); return; }
      const pic = await prepareImage(file, 0);
      const b = activeBoard();
      const col = b && b.cols.find(c => c.id === colId);
      if (!pic || !col) return;
      const title = line(file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '), MAX.title) || 'Picture';
      const card = normCard({ title, image: { ...pic, alt: line(title, MAX.alt) } });
      col.cards.splice(pinCount(col), 0, card);
      touchBoard(b);
      S.focus = `card:${card.id}`;
      S.reveal = true;
      commit();
      say(`Added a picture card to ${col.name}`);
      warnPictures(pic.src.length);
      overLimit(col);
    }
    async function deleteCard(id) {
      const loc = locate(id);
      if (!loc) return;
      const { card, col } = loc;
      const extra = card.notes.trim() || card.checklist.length || card.links.length;
      const ok = await ask({
        title: 'Delete this card?',
        message: `“${card.title}”${extra ? ' and everything on it' : ''} will be removed from “${col.name}”. This can’t be undone.`,
        ok: 'Delete', danger: true,
      });
      if (!ok) return;
      const now = locate(id);
      if (!now) return;
      const next = now.col.cards[now.i + 1] || now.col.cards[now.i - 1] || null;
      now.col.cards.splice(now.i, 1);
      touchBoard(now.board);
      if (S.openId === id) { S.openId = null; S.picker = null; }
      S.focus = next ? `card:${next.id}` : `add:${now.col.id}`;
      commit();
      say(`Deleted ${card.title}`);
    }
    function openCard(id, how) {
      if (!locate(id)) return;
      if (S.openId !== id) { S.picker = null; S.drafts.clAdd = ''; S.imgErr = ''; }
      flushPersist();
      S.archiveOpen = false;
      S.sharePanel = null;
      S.openId = id;
      S.focus = how === 'key' ? 'insp-title' : 'insp-panel';
      if (S.narrow) S.pane = 'board';
      render();
    }
    function closeInsp(returnFocus) {
      const id = S.openId;
      if (!id) return;
      flushPersist();
      S.openId = null;
      S.picker = null;
      if (returnFocus) { S.focus = `card:${id}`; S.reveal = true; }
      render();
    }

    /* ---- checklist ---- */
    function addItem(cardId, text) {
      const t = line(text, MAX.item);
      if (!t) return;
      const loc = locate(cardId);
      if (!loc) return;
      if (loc.card.checklist.length >= MAX.check) { tell('Checklist is full', `A checklist holds up to ${MAX.check} items.`, 'alert'); return; }
      S.drafts.clAdd = '';
      S.focus = 'cl-add';
      editCard(cardId, c => { c.checklist.push({ id: uid('ci'), text: t, done: false }); });
    }
    function toggleItem(cardId, itemId, done) {
      editCard(cardId, c => { const it = c.checklist.find(x => x.id === itemId); if (it) it.done = !!done; });
    }
    function removeItem(cardId, itemId, viaBlur) {
      const loc = locate(cardId);
      if (!loc) return;
      const list = loc.card.checklist;
      const i = list.findIndex(x => x.id === itemId);
      if (i < 0) return;
      const next = list[i + 1] || list[i - 1];
      if (!viaBlur) S.focus = next ? `cl-text:${next.id}` : 'cl-add';
      editCard(cardId, c => { c.checklist = c.checklist.filter(x => x.id !== itemId); }, { later: viaBlur });
    }

    /* ---- links ---- */
    function addLink(cardId, raw) {
      const l = normLink({ ...raw, id: uid('ln') });
      const loc = locate(cardId);
      if (!l || !loc) return;
      if (loc.card.links.some(x => x.kind === l.kind && x.ref === l.ref)) { say('Already linked'); return; }
      if (loc.card.links.length >= MAX.links) { tell('Too many links', `A card holds up to ${MAX.links} links.`, 'alert'); return; }
      S.picker = null;
      S.focus = 'link-add';
      editCard(cardId, c => { c.links.push(l); });
      say(`Linked ${linkInfo(l).title}`);
    }
    function removeLink(cardId, linkId) {
      S.focus = 'link-add';
      editCard(cardId, c => { c.links = c.links.filter(l => l.id !== linkId); });
      say('Link removed');
    }
    function linkInfo(l) {
      if (l.kind === 'arcade') {
        const g = arcadeById(l.ref);
        return { icon: g ? g.icon : 'gamepad', title: g ? g.title : (l.title || l.ref), sub: 'Static Arcade', missing: !g, hue: g ? g.hue : null };
      }
      if (l.kind === 'game') {
        /* the catalogue is only read once a picker has opened it: until then
           nothing is claimed about this link either way */
        const g = S.cat.state === 'ready' ? S.cat.G.byId(l.ref) : null;
        const gone = S.cat.state === 'ready' && !S.cat.fallback && !g;
        return { icon: 'gamepad', title: g ? g.title : (l.title || l.ref), sub: gone ? 'Static Games · not in the catalogue' : 'Static Games', missing: gone };
      }
      if (l.kind === 'project') {
        const p = Array.isArray(S.projects) ? S.projects.find(x => x.id === l.ref) : null;
        const missing = Array.isArray(S.projects) && !S.projectsErr && !p;
        const thumb = forgeThumbs()[l.ref];
        return {
          icon: 'sparkles', title: p ? p.name : (l.title || 'Forge project'),
          sub: missing ? 'Forge project · no longer on this device' : 'Forge project', missing,
          thumb: typeof thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(thumb) ? thumb : null,
        };
      }
      if (l.kind === 'note') {
        const n = allNotes().find(x => x.id === l.ref);
        return { icon: 'note', title: n ? (line(n.title, MAX.linkTitle) || 'Untitled note') : (l.title || 'Note'), sub: n ? 'Static Notes' : 'Note · no longer in Notes', missing: !n };
      }
      if (l.kind === 'mindmap') {
        const n = api.vfs.node(l.ref);
        const gone = !n || n.type !== 'file';
        return { icon: 'network', title: gone ? (l.title || api.vfs.baseName(l.ref).replace(/\.mindmap$/i, '')) : api.vfs.baseName(l.ref).replace(/\.mindmap$/i, ''), sub: gone ? 'Mind map · moved or deleted' : `Mind map · ${api.vfs.parentPath(l.ref).replace(api.vfs.HOME, '~')}`, missing: gone };
      }
      const host = hostOf(l.ref);
      return { icon: 'globe', title: l.title || host || l.ref, sub: host ? `Web · ${host}` : 'Web link' };
    }
    function unavailable(name) { tell(`${name} isn’t available`, `${name} isn’t installed on this device.`, 'alert'); }
    /** Is this catalogue id a real game? { checked, game } — checked is false
        when only the built-in shelf is here, because that can't prove absence. */
    async function catalogueGame(id) {
      await ensureCatalog();
      if (S.dead || S.cat.state !== 'ready') return { checked: false, game: null };
      const game = S.cat.G.byId(id) || null;
      return { checked: !S.cat.fallback || !!game, game };
    }
    /** Nothing is opened on a guess: a linked game has to be there first. */
    async function playLink(l) {
      if (l.kind === 'game') {
        if (!api.getApp('aether-games')) { unavailable('Static Games'); return; }
        const { checked, game } = await catalogueGame(l.ref);
        if (S.dead) return;
        if (checked && !game) {
          tell('That game isn’t in the catalogue', `“${l.title || l.ref}” isn’t one of the games on this device any more, so there is nothing to play.`, 'alert');
          softRefresh();
          return;
        }
        api.openApp('aether-games', { url: `static://games/${l.ref}` });
      } else if (l.kind === 'arcade') {
        if (!api.getApp('arcade')) { unavailable('Static Arcade'); return; }
        if (!arcadeById(l.ref)) { tell('That Arcade game isn’t here', `“${l.title || l.ref}” isn’t one of the Arcade games in this build.`, 'alert'); return; }
        api.openApp('arcade', { game: l.ref });
      }
    }
    async function openProject(l, appId) {
      if (!api.getApp(appId)) { unavailable(appId === 'studio' ? 'Static Studio' : 'Static Forge'); return; }
      let p = null, failed = false;
      try { p = await Projects.get(l.ref); } catch (err) { failed = true; }
      if (S.dead) return;
      if (!failed && !p) {                        /* the read worked and found nothing */
        tell('That project is gone', `“${l.title || 'the linked project'}” isn’t on this device any more.`, 'alert');
        loadProjects();
        return;
      }
      api.openApp(appId, { project: l.ref });
    }
    function openUrl(l) {
      const u = httpsUrl(l.ref);
      if (u) window.open(u, '_blank', 'noopener,noreferrer');
    }

    /* ---- Forge ---- */
    function makeGame(id) {
      const loc = locate(id);
      if (!loc) return;
      if (!api.getApp('forge')) { unavailable('Static Forge'); return; }
      const prompt = forgePrompt(loc.card);
      if (!prompt) return;
      loc.card.forge = { prompt, at: Date.now() };
      persist();
      render();
      say('Sent to Static Forge');
      api.openApp('forge', { prompt });
    }
    /** Link each waiting card to the project Forge saved from its exact prompt. */
    function claimForge() {
      if (!Array.isArray(S.projects)) return false;
      let changed = false;
      for (const b of S.data.boards) for (const col of b.cols) for (const c of col.cards) {
        const f = c.forge;
        if (!f) continue;
        const match = S.projects
          .filter(p => p.prompt === f.prompt && p.createdAt >= f.at - 2000)
          .sort((a, z) => a.createdAt - z.createdAt)[0];
        if (match) {
          if (!c.links.some(l => l.kind === 'project' && l.ref === match.id) && c.links.length < MAX.links) {
            c.links.push({ id: uid('ln'), kind: 'project', ref: match.id, title: line(match.name, MAX.linkTitle) });
          }
          c.forge = null;
          c.updated = Date.now();
          changed = true;
        } else if (Date.now() - f.at >= PENDING_MS) {
          c.forge = null;
          changed = true;
        }
      }
      return changed;
    }
    let projSeq = 0;
    async function loadProjects() {
      const seq = ++projSeq;
      try {
        const list = await Projects.list();
        if (S.dead || seq !== projSeq) return;
        S.projects = list.map(p => ({
          id: String(p.id),
          name: line((p.published && p.published.title) || p.name, 80) || 'Untitled game',
          prompt: String(p.prompt || ''),
          createdAt: Number(p.createdAt) || 0,
          updatedAt: Number(p.updatedAt) || 0,
          published: !!p.published,
        }));
        S.projectsErr = null;
      } catch (err) {
        if (S.dead || seq !== projSeq) return;
        S.projectsErr = String((err && err.message) || err || 'unknown error');
      }
      if (claimForge()) persist();
      softRefresh();
    }
    let projT = 0;
    function projectsChanged() {
      if (S.dead) return;
      if (!(S.projects || hasProjectRefs() || (S.picker && S.picker.kind === 'project'))) return;
      cancel(projT);
      projT = later(loadProjects, 400);
    }

    /* ---- Save as Markdown (a real file in Documents) ---- */
    function exportBoard(id) {
      const b = S.data.boards.find(x => x.id === id);
      if (!b) return;
      const vfs = api.vfs;
      try {
        const dir = `${vfs.HOME}/Documents`;
        if (!vfs.node(dir) && !vfs.mkdir(dir)) throw new Error('There is no Documents folder to save into.');
        const base = (b.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Board').slice(0, 60);
        let name = `${base}.md`;
        for (let n = 2; vfs.node(`${dir}/${name}`); n++) name = `${base} ${n}.md`;
        const path = `${dir}/${name}`;
        if (!vfs.write(path, boardMarkdown(b, linkInfo))) throw new Error('The file could not be written.');
        api.bus.emit('file:saved', { path, app: 'board' });
        notify({
          app: 'Static Board', icon: 'clipboard', title: 'Saved to Documents', message: name, timeout: 7000,
          actions: [{ label: 'Open', onClick: () => api.openFile(path) }, { label: 'Show in Files', onClick: () => api.openFile(dir) }],
        });
        say(`Saved ${name} to Documents`);
      } catch (err) {
        tell('Couldn’t save the board', String((err && err.message) || err), 'alert');
      }
    }

    /* ==================================================================== */
    /*  search and filters (what is shown; nothing is saved or changed)     */
    /* ==================================================================== */
    const fold = v => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const FILTERS = [['soon', 'Due soon (or overdue)'], ['over', 'Overdue'], ['dated', 'Has a due date'], ['pinned', 'Pinned'], ['check', 'Has a checklist'], ['pic', 'Has a picture']];
    const filtering = () => { const f = S.filter; return !!(f.q.trim() || f.labels.length || FILTERS.some(([k]) => f[k])); };
    /* whole days from today to a due day, on this computer's calendar */
    const daysTo = due => Math.round((new Date(`${due}T12:00:00`) - new Date(`${dayOf()}T12:00:00`)) / 86400000);
    function matches(c, col) {
      const f = S.filter;
      if (f.labels.length && !f.labels.includes(c.color)) return false;
      if (f.pinned && !c.pinned) return false;
      if (f.check && !c.checklist.length) return false;
      if (f.pic && !c.image) return false;
      if (f.dated && !c.due) return false;
      if (f.soon && !(c.due && !col.done && daysTo(c.due) <= SOON_DAYS)) return false;
      if (f.over && !(c.due && !col.done && daysTo(c.due) < 0)) return false;
      const q = fold(f.q).trim();
      if (q) {
        const hay = fold([c.title, c.notes, ...c.checklist.map(i => i.text), ...c.links.map(l => linkInfo(l).title)].join('\n'));
        if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
      }
      return true;
    }
    const shownCards = col => (filtering() ? col.cards.filter(c => matches(c, col)) : col.cards);
    /** the next card shown above (-1) or below (1) index i, as an index in the whole column */
    function neighbour(col, i, d) {
      for (let k = i + d; k >= 0 && k < col.cards.length; k += d) if (!filtering() || matches(col.cards[k], col)) return k;
      return -1;
    }
    function setFilter(patch) {
      Object.assign(S.filter, patch);
      render();
      const b = activeBoard();
      if (b && filtering()) {
        const n = b.cols.reduce((k, col) => k + shownCards(col).length, 0);
        say(`Showing ${plural(n, 'card')} of ${countCards(b)}`);
      }
    }
    function clearFilter() { S.filter = { q: '', labels: [], ...Object.fromEntries(FILTERS.map(([k]) => [k, false])) }; S.drafts.q = ''; render(); say('Showing every card'); }
    function filterMenu(e) {
      const f = S.filter;
      popMenu([
        ...FILTERS.map(([k, label]) => ({ label, checked: !!f[k], onClick: () => setFilter({ [k]: !f[k] }) })),
        '-',
        ...LABELS.filter(L => L.id !== 'none').map(L => ({ label: `${L.name} label`, checked: f.labels.includes(L.id), onClick: () => setFilter({ labels: f.labels.includes(L.id) ? f.labels.filter(x => x !== L.id) : [...f.labels, L.id] }) })),
        '-',
        { label: 'Show every card', icon: 'x', disabled: !filtering(), onClick: clearFilter },
      ], e);
    }

    /* ==================================================================== */
    /*  due dates                                                           */
    /* ==================================================================== */
    function dueText(c, col) {
      const n = daysTo(c.due);
      const d = new Date(`${c.due}T12:00:00`);
      const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
      if (col && col.done) return { text: date, cls: 'is-done', long: `was due ${date}` };
      if (n < 0) return { text: n === -1 ? 'Overdue · yesterday' : `Overdue · ${-n} days`, cls: 'is-over', long: `overdue, was due ${date}` };
      if (n === 0) return { text: 'Due today', cls: 'is-soon', long: 'due today' };
      if (n === 1) return { text: 'Due tomorrow', cls: 'is-soon', long: 'due tomorrow' };
      return { text: `Due ${date}`, cls: n <= SOON_DAYS ? 'is-soon' : '', long: `due ${date}` };
    }
    function setDue(id, day) {
      const v = day && validDay(day) ? day : null;
      S.focus = 'due-in';
      editCard(id, c => { c.due = v; });
      const loc = locate(id);
      say(v && loc ? `Due ${dueText(loc.card, loc.col).long.replace(/^due /, '')}` : 'No due date');
    }

    /* ==================================================================== */
    /*  archive                                                             */
    /* ==================================================================== */
    function archiveCard(id) {
      const loc = locate(id);
      if (!loc) return;
      const { board: b, col, card, i } = loc;
      if (b.archive.length >= MAX.archive) { tell('The archive is full', `A board keeps up to ${MAX.archive} archived cards. Delete some under Archived… first.`, 'alert'); return; }
      const next = col.cards[i + 1] || col.cards[i - 1] || null;
      col.cards.splice(i, 1);
      b.archive.unshift({ card, col: col.id, colName: col.name, at: Date.now() });
      if (S.openId === id) { S.openId = null; S.picker = null; }
      touchBoard(b);
      S.focus = next ? `card:${next.id}` : `add:${col.id}`;
      commit();
      say(`Archived ${card.title}`);
      notify({ app: 'Static Board', icon: 'box', title: 'Card archived', message: `“${card.title}” is under Archived… in the board menu.`, timeout: 6000,
        actions: [{ label: 'Undo', onClick: () => { if (!S.dead) restoreCard(id); } }] });
    }
    function restoreCard(id) {
      const b = activeBoard();
      const k = b ? b.archive.findIndex(a => a.card.id === id) : -1;
      if (k < 0) return;
      const a = b.archive[k];
      const col = b.cols.find(c => c.id === a.col) || b.cols.find(c => c.name === a.colName) || b.cols[0];
      if (!col) { tell('There’s no column to put it in', 'Add a column to this board first.', 'alert'); return; }
      if (col.cards.length >= MAX.cards) { tell('That column is full', `A column holds up to ${MAX.cards} cards.`, 'alert'); return; }
      b.archive.splice(k, 1);
      col.cards.splice(a.card.pinned ? 0 : pinCount(col), 0, a.card);
      touchBoard(b);
      S.focus = S.archiveOpen ? '@.board-arch__item button, .board-arch__close' : `card:${id}`;
      commit();
      say(`Put ${a.card.title} back in ${col.name}`);
    }
    async function deleteArchived(id) {
      const b0 = activeBoard();
      const a0 = b0 && b0.archive.find(a => a.card.id === id);
      if (!a0) return;
      const ok = await ask({ title: 'Delete this card?', message: `“${a0.card.title}” will be removed from the archive for good. This can’t be undone.`, ok: 'Delete', danger: true });
      if (!ok) return;
      const b = activeBoard();
      const k = b ? b.archive.findIndex(a => a.card.id === id) : -1;
      if (k < 0) return;
      b.archive.splice(k, 1);
      touchBoard(b);
      S.focus = '@.board-arch__close';
      commit();
      say(`Deleted ${a0.card.title}`);
    }
    function archiveCol(id) {
      const b = activeBoard();
      const i = b ? b.cols.findIndex(c => c.id === id) : -1;
      if (i < 0) return;
      if (b.archivedCols.length >= MAX.archivedCols) { tell('The archive is full', `A board keeps up to ${MAX.archivedCols} archived columns.`, 'alert'); return; }
      const [col] = b.cols.splice(i, 1);
      if (S.openId && col.cards.some(c => c.id === S.openId)) { S.openId = null; S.picker = null; }
      b.archivedCols.unshift({ col, at: Date.now(), idx: i });
      touchBoard(b);
      const next = b.cols[i] || b.cols[i - 1];
      S.focus = next ? `colmore:${next.id}` : 'addcol-btn';
      commit();
      say(`Archived the column ${col.name}`);
      notify({ app: 'Static Board', icon: 'box', title: 'Column archived', message: `“${col.name}” and its ${plural(col.cards.length, 'card')} are under Archived… in the board menu.`, timeout: 6000,
        actions: [{ label: 'Undo', onClick: () => { if (!S.dead) restoreCol(id); } }] });
    }
    function restoreCol(id) {
      const b = activeBoard();
      const k = b ? b.archivedCols.findIndex(a => a.col.id === id) : -1;
      if (k < 0) return;
      if (b.cols.length >= MAX.cols) { tell('That’s a lot of columns', `A board holds up to ${MAX.cols} columns. Archive or delete one first.`, 'alert'); return; }
      const [a] = b.archivedCols.splice(k, 1);
      b.cols.splice(clamp(a.idx, 0, b.cols.length), 0, a.col);
      touchBoard(b);
      S.focus = S.archiveOpen ? '@.board-arch__close' : `colmore:${id}`;
      commit();
      say(`Put the column ${a.col.name} back`);
    }
    async function deleteArchivedCol(id) {
      const b0 = activeBoard();
      const a0 = b0 && b0.archivedCols.find(a => a.col.id === id);
      if (!a0) return;
      const ok = await ask({ title: 'Delete this column?', message: `“${a0.col.name}”${a0.col.cards.length ? ` and its ${plural(a0.col.cards.length, 'card')}` : ''} will be removed for good. This can’t be undone.`, ok: 'Delete', danger: true });
      if (!ok) return;
      const b = activeBoard();
      const k = b ? b.archivedCols.findIndex(a => a.col.id === id) : -1;
      if (k < 0) return;
      b.archivedCols.splice(k, 1);
      touchBoard(b);
      S.focus = '@.board-arch__close';
      commit();
    }
    function openArchive() { S.archiveOpen = true; S.sharePanel = null; S.openId = null; S.picker = null; S.focus = '@.board-arch__close'; render(); }
    function closeArchive() { S.archiveOpen = false; S.focus = 'board-menu'; render(); }
    function renderArchive(b) {
      const sec = (label, rows, none) => h('section.board-insp__sec', h('div.board-insp__h', h('span', { text: label })),
        rows.length ? h('ul.board-arch__list', rows) : h('p.board-insp__hint', { text: none }));
      const cards = b.archive.map(a => h('li.board-arch__item',
        h('div.board-arch__t', h('b', { text: a.card.title }), h('small', { text: `From ${a.colName || 'a column'} · archived ${ago(a.at)}` })),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': `Restore ${a.card.title}`, onclick: () => restoreCard(a.card.id) }, icon('corner-up-left'), h('span', { text: 'Restore' })),
        h('button.ibtn', { type: 'button', 'aria-label': `Delete ${a.card.title} for good`, title: 'Delete for good', onclick: () => deleteArchived(a.card.id) }, icon('trash'))));
      const cols = b.archivedCols.map(a => h('li.board-arch__item',
        h('div.board-arch__t', h('b', { text: a.col.name }), h('small', { text: `${plural(a.col.cards.length, 'card')} · archived ${ago(a.at)}` })),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': `Restore the column ${a.col.name}`, onclick: () => restoreCol(a.col.id) }, icon('corner-up-left'), h('span', { text: 'Restore' })),
        h('button.ibtn', { type: 'button', 'aria-label': `Delete the column ${a.col.name} for good`, title: 'Delete for good', onclick: () => deleteArchivedCol(a.col.id) }, icon('trash'))));
      inspEl.append(
        h('div.board-insp__head', h('b.board-arch__title', { text: `Archived on “${b.name}”` }), h('span.grow'),
          h('button.ibtn.board-arch__close', { type: 'button', 'aria-label': 'Close the archive', title: 'Close (Esc)', onclick: closeArchive }, icon('x'))),
        h('div.board-insp__scroll',
          sec(`Cards (${b.archive.length})`, cards, 'No archived cards. Archive one from its menu to keep it out of the way.'),
          sec(`Columns (${b.archivedCols.length})`, cols, 'No archived columns.'),
          h('p.board-insp__meta', { text: 'Archived cards stay on this device and aren’t shown on the board, in its counts, or on Calendar.' })));
    }

    /* ==================================================================== */
    /*  work-in-progress limits, done columns, sorting                      */
    /* ==================================================================== */
    function setLimit(colId, n) {
      const b = activeBoard();
      const col = b && b.cols.find(c => c.id === colId);
      if (!col) return;
      col.limit = n;
      touchBoard(b);
      S.focus = `colmore:${colId}`;
      commit();
      say(n ? `${col.name} has a limit of ${n} cards${col.cards.length > n ? `; it has ${col.cards.length}, over the limit` : ''}` : `${col.name} has no limit`);
    }
    /* adding to a column with a limit: say so when it goes over */
    function overLimit(col) {
      if (col && col.limit && col.cards.length === col.limit + 1) tell(`${col.name} is over its limit`, `It has ${col.cards.length} cards and a limit of ${col.limit}. Finish one before starting another.`, 'alert');
    }
    function toggleDone(colId) {
      const b = activeBoard();
      const col = b && b.cols.find(c => c.id === colId);
      if (!col) return;
      col.done = !col.done;
      touchBoard(b);
      S.focus = `colmore:${colId}`;
      commit();
      say(col.done ? `Cards in ${col.name} count as done: their due dates aren’t shown as due` : `Cards in ${col.name} aren’t done`);
    }
    const SORT_CMP = {
      title: (a, z) => a.title.localeCompare(z.title, undefined, { sensitivity: 'base', numeric: true }),
      due: (a, z) => (a.due || '9999-99-99').localeCompare(z.due || '9999-99-99'),
      new: (a, z) => z.created - a.created,
      old: (a, z) => a.created - z.created,
      color: (a, z) => (a.color === 'none' ? 99 : LABEL_IDS.indexOf(a.color)) - (z.color === 'none' ? 99 : LABEL_IDS.indexOf(z.color)),
    };
    function sortCol(colId, how) {
      const b = activeBoard();
      const col = b && b.cols.find(c => c.id === colId);
      if (!col || !SORT_CMP[how]) return;
      const before = col.cards.map(c => c.id);
      const pins = col.cards.filter(c => c.pinned), rest = col.cards.filter(c => !c.pinned);
      col.cards = [...pins.sort(SORT_CMP[how]), ...rest.sort(SORT_CMP[how])];            /* pinned cards stay on top */
      const name = SORTS.find(x => x[0] === how)[1].toLowerCase();
      if (col.cards.every((c, k) => c.id === before[k])) { say(`${col.name} is already in order by ${name}`); return; }
      touchBoard(b);
      S.focus = `colmore:${colId}`;
      commit();
      say(`Sorted ${col.name} by ${name}`);
      notify({ app: 'Static Board', icon: 'clipboard', title: `Sorted ${col.name}`, message: `By ${name}. Pinned cards stay on top.`, timeout: 6000,
        actions: [{ label: 'Undo', onClick: () => {
          const bb = activeBoard(), cc = bb && bb.cols.find(c => c.id === colId);
          if (S.dead || !cc) return;
          const at = new Map(before.map((id, k) => [id, k]));
          cc.cards.sort((x, y) => (at.has(x.id) ? at.get(x.id) : -1) - (at.has(y.id) ? at.get(y.id) : -1));
          touchBoard(bb); commit(); say(`${cc.name} is back in its old order`);
        } }] });
    }

    /* ==================================================================== */
    /*  copy a card to another board                                        */
    /* ==================================================================== */
    function copyToBoard(id, boardId) {
      const loc = locate(id);
      const dest = S.data.boards.find(b => b.id === boardId);
      if (!loc || !dest) return;
      const col = dest.cols[0];
      if (!col) { tell('That board has no columns', `Add a column to “${dest.name}” first.`, 'alert'); return; }
      if (col.cards.length >= MAX.cards) { tell('That column is full', `A column holds up to ${MAX.cards} cards.`, 'alert'); return; }
      const src = loc.card;
      const pic = src.image && !imageRoomError(src.image.src.length, 0) ? { ...src.image } : null;
      const copy = normCard({
        title: src.title, notes: src.notes, color: src.color, due: src.due,
        checklist: src.checklist.map(it => ({ text: it.text, done: it.done })),
        links: src.links.map(l => ({ kind: l.kind, ref: l.ref, title: l.title })), image: pic,
      });
      col.cards.splice(pinCount(col), 0, copy);
      touchBoard(dest);
      persist();
      render();
      say(`Copied ${src.title} to ${dest.name}, ${col.name}`);
      notify({ app: 'Static Board', icon: 'copy', title: `Copied to ${dest.name}`, message: `“${src.title}” is at the top of ${col.name}${src.image && !pic ? ', without its picture (there was no room for a second copy)' : ''}.`, timeout: 6000,
        actions: [{ label: 'Show', onClick: () => { if (S.dead) return; selectBoard(dest.id); openCard(copy.id, 'key'); } }] });
      overLimit(col);
    }

    /* ==================================================================== */
    /*  JSON, import, print                                                 */
    /* ==================================================================== */
    function docsDir() {
      const vfs = api.vfs, dir = `${vfs.HOME}/Documents`;
      if (!vfs.node(dir) && !vfs.mkdir(dir)) throw new Error('There is no Documents folder to save into.');
      return dir;
    }
    function freeName(dir, b, ext) {
      const base = (b.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Board').slice(0, 60);
      let name = `${base}.${ext}`;
      for (let n = 2; api.vfs.node(`${dir}/${name}`); n++) name = `${base} ${n}.${ext}`;
      return name;
    }
    function exportJSON(id) {
      const b = S.data.boards.find(x => x.id === id);
      if (!b) return;
      try {
        const dir = docsDir(), name = freeName(dir, b, 'json'), path = `${dir}/${name}`;
        const file = BD.toFile(b);
        if (!api.vfs.write(path, JSON.stringify(file, null, 1))) throw new Error('The file could not be written.');
        api.bus.emit('file:saved', { path, app: 'board' });
        notify({ app: 'Static Board', icon: 'clipboard', title: 'Saved to Documents', timeout: 7000,
          message: `${name}${file.picturesLeftOut ? ` — ${plural(file.picturesLeftOut, 'picture')} stayed in Board (pictures don’t go in the file)` : ''}`,
          actions: [{ label: 'Show in Files', onClick: () => api.openFile(dir) }] });
        say(`Saved ${name} to Documents`);
      } catch (err) { tell('Couldn’t save the board', String((err && err.message) || err), 'alert'); }
    }
    /** a new board from imported data ({ name, cols, archive? }) */
    function createBoardFrom(o, source) {
      if (S.data.boards.length >= MAX.boards) { tell('Too many boards', `A device holds up to ${MAX.boards} boards. Delete one to make room.`, 'alert'); return null; }
      const strip = c => { const x = { ...obj(c) }; delete x.id; delete x.image; return x; };    /* fresh ids; no pictures travel in files */
      const b = normBoard({
        name: o.name,
        cols: objs(o.cols).slice(0, MAX.cols).map(col => ({ name: col.name, limit: col.limit, done: col.done, cards: objs(col.cards).map(strip) })),
        archive: objs(o.archive).map(a => ({ card: strip(a.card), colName: typeof a.col === 'string' ? a.col : a.colName, at: a.at })),
      });
      S.data.boards.push(b);
      S.data.activeId = b.id;
      S.openId = null; S.picker = null; S.archiveOpen = false; S.pane = 'board';
      S.focus = b.cols[0] ? `add:${b.cols[0].id}` : 'addcol-btn';
      commit();
      const n = countCards(b);
      say(`Imported ${plural(n, 'card')} into ${b.name}`);
      notify({ app: 'Static Board', icon: 'clipboard', title: `Imported “${b.name}”`, message: `${plural(b.cols.length, 'column')} and ${plural(n, 'card')}, from ${source}.`, timeout: 6000 });
      return b;
    }
    function importText(text, name) {
      const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]?.toLowerCase() || '';
      let data;
      try {
        if (ext === 'json') data = BD.fromFile(JSON.parse(text));
        else if (['md', 'markdown', 'txt'].includes(ext)) data = BD.fromMarkdown(text);
        else { try { data = BD.fromFile(JSON.parse(text)); } catch (e) { data = BD.fromMarkdown(text); } }
      } catch (err) {
        tell(`Couldn’t import ${name || 'that'}`, err instanceof SyntaxError ? 'That file isn’t valid JSON.' : String((err && err.message) || err), 'alert');
        return null;
      }
      return createBoardFrom(data, name || 'a file');
    }
    const boardFileIn = h('input.sr', {
      type: 'file', accept: '.json,.md,.markdown,.txt,application/json,text/markdown,text/plain', tabindex: '-1', 'aria-hidden': 'true',
      onchange: async e => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { tell('That file is too big', 'A board file can be up to 2 MB.', 'alert'); return; }
        const t = await f.text().catch(() => null);
        if (S.dead) return;
        if (t == null) { tell(`Couldn’t read ${f.name}`, 'The browser couldn’t read that file.', 'alert'); return; }
        importText(t, f.name);
      },
    });
    /* board files in Documents, Desktop and Downloads */
    function boardFiles() {
      const vfs = api.vfs, out = [];
      for (const d of ['Documents', 'Desktop', 'Downloads']) {
        for (const n of vfs.ls(`${vfs.HOME}/${d}`)) {
          if (n.type === 'file' && /\.(json|md|markdown|txt)$/i.test(n.name)) out.push({ path: `${vfs.HOME}/${d}/${n.name}`, name: n.name, where: d });
          if (out.length >= 30) return out;
        }
      }
      return out;
    }
    function importMenu(e) {
      const files = boardFiles();
      const lists = (() => { try { return readTasks().lists; } catch (err) { return []; } })();
      popMenu([
        files.length
          ? { label: 'A file from Documents', icon: 'folder', items: files.map(f => ({ label: f.name, hint: f.where === 'Documents' ? null : f.where, onClick: () => { const t = api.vfs.read(f.path); if (t != null) importText(t, f.name); } })) }
          : { label: 'No .json or .md files in Documents', icon: 'folder', disabled: true },
        { label: 'A file from this computer…', icon: 'upload', onClick: () => boardFileIn.click() },
        lists.length
          ? { label: 'A Static Tasks list', icon: 'check-circle', items: lists.map(l => ({ label: `${l.name} (${plural(l.tasks.length, 'task')})`, onClick: () => createBoardFrom(BD.fromTaskList(l), `the Tasks list “${l.name}”`) })) }
          : { label: 'No Static Tasks lists yet', icon: 'check-circle', disabled: true },
      ], e);
    }
    let printEl = null;
    function printBoard(id) {
      const b = S.data.boards.find(x => x.id === id);
      if (!b) return;
      printEl?.remove();
      const card = (c, col) => h('div.board-print__card',
        h('b', { text: `${c.pinned ? '📌 ' : ''}${c.title}` }),
        c.due || c.color !== 'none' ? h('small', { text: [c.due ? dueText(c, col).text : '', c.color !== 'none' ? `${labelName(c.color)} label` : ''].filter(Boolean).join(' · ') }) : null,
        c.notes.trim() ? h('p', { text: c.notes.trim().slice(0, 600) }) : null,
        c.checklist.length ? h('ul', c.checklist.map(i => h('li', { text: `${i.done ? '☑' : '☐'} ${i.text}` }))) : null);
      printEl = h('div.board-print', { 'aria-hidden': 'true' },
        h('h1', { text: b.name }),
        h('p', { text: `${plural(countCards(b), 'card')} in ${plural(b.cols.length, 'column')} · printed ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}` }),
        h('div.board-print__cols', { style: { '--n': String(Math.max(1, Math.min(b.cols.length, 5))) } }, b.cols.map(col => h('section',
          h('h2', { text: `${col.name} (${col.cards.length}${col.limit ? ` of ${col.limit}` : ''})` }),
          col.cards.length ? col.cards.map(c => card(c, col)) : h('p', { text: 'No cards' })))));
      document.body.appendChild(printEl);
      document.documentElement.classList.add('board-printing');
      const done = () => { document.documentElement.classList.remove('board-printing'); printEl?.remove(); printEl = null; window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      later(done, 120000);
      try { window.print(); } catch (err) { done(); }
    }

    /* ==================================================================== */
    /*  links to notes and mind maps                                        */
    /* ==================================================================== */
    const allNotes = () => { const v = store.get('notes'); return Array.isArray(v) ? v.filter(n => n && typeof n === 'object' && n.id && !n.trashed) : []; };
    function mindMaps() {
      const vfs = api.vfs, out = [];
      vfs.walk(vfs.HOME, (n, p) => { if (n.type === 'file' && /\.mindmap$/i.test(n.name) && !p.startsWith(`${vfs.HOME}/Trash`) && out.length < 200) out.push({ path: p, name: n.name.replace(/\.mindmap$/i, ''), mtime: n.mtime }); }, 6);
      return out.sort((a, z) => String(z.mtime || '').localeCompare(String(a.mtime || '')));
    }
    function openNote(l) {
      if (!api.getApp('notes')) { unavailable('Static Notes'); return; }
      if (!allNotes().some(n => n.id === l.ref)) { tell('That note is gone', `“${l.title || 'The linked note'}” isn’t in Notes any more.`, 'alert'); softRefresh(); return; }
      api.openApp('notes', { noteId: l.ref });
    }
    function openMindmap(l) {
      const n = api.vfs.node(l.ref);
      if (!n || n.type !== 'file') { tell('That mind map isn’t there', `“${l.title || api.vfs.baseName(l.ref)}” was moved or deleted.`, 'alert'); softRefresh(); return; }
      api.openFile(l.ref);
    }

    /* ==================================================================== */
    /*  pictures: say so before the space runs out (#36)                    */
    /* ==================================================================== */
    /** how full picture space is: { used, share (0-1 of the tighter limit), room (chars left) } */
    function picSpace() {
      const used = imageChars(S.data);
      const ls = storageChars();
      const roomPics = MAX.imageTotal - used, roomLs = ls == null ? Infinity : LS_CEILING - ls;
      const share = Math.max(used / MAX.imageTotal, ls == null ? 0 : ls / LS_CEILING);
      return { used, ls, share, room: Math.max(0, Math.min(roomPics, roomLs)), tight: roomLs < roomPics ? 'device' : 'pictures' };
    }
    function warnPictures(last) {
      const sp = picSpace();
      if (sp.share < IMAGE_WARN) { S.picWarned = 0; return; }
      const step = sp.share >= 0.95 ? 2 : 1;
      if (S.picWarned >= step) return;
      S.picWarned = step;
      const more = last ? Math.floor(sp.room / Math.max(1, last)) : 0;
      tell(sp.tight === 'device' ? 'This device’s storage is nearly full' : 'Board pictures are nearly full',
        `${sp.tight === 'device' ? `StaticOS has used ${Math.round(sp.share * 100)}% of what this browser lets it keep.` : `Pictures use ${kbOf(sp.used)} of the ${kbOf(MAX.imageTotal)} they can have.`} ${more ? `About ${plural(more, 'more picture')} like that one will fit.` : 'There may not be room for another.'} Remove pictures you don’t need to make room.`, 'alert');
    }

    /* ==================================================================== */
    /*  share live with a friend (js/core/boardshare.js, a pair.js room)     */
    /* ==================================================================== */
    const SHARE_ERR = {
      invalid: 'That isn’t a room code — codes are 6 letters and numbers, like K7QM2X.',
      nobody: 'Nobody answered that code. Check it, and that your friend still has the board shared.',
      full: 'That board already has two people on it.',
      insecure: 'Sharing live needs a secure (https) page for its encryption.',
    };
    const inviteLink = code => { try { return `${location.origin}${location.pathname}#board=${code}`; } catch (e) { return ''; } };
    const spacedCode = c => String(c || '').split('').join(' ');
    let BSmod = null;
    function openShare(role, code = '') {
      S.sharePanel = { role: S.share ? S.share.role : role, code: String(code || (S.sharePanel && S.sharePanel.code) || '').toUpperCase().slice(0, 12), err: '' };
      S.archiveOpen = false;
      S.openId = null;
      S.picker = null;
      if (S.narrow) S.pane = 'board';
      S.focus = '@.board-share [data-fk="share-go"], .board-share [data-fk="share-code"], .board-share__close';
      render();
    }
    function closeSharePanel() { S.sharePanel = null; S.focus = 'board-menu'; render(); }
    async function startShare(role, code = null) {
      if (S.share) return;
      const b = activeBoard();
      if (role === 'host' && !b) return;
      if (role === 'guest' && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code || '')) { S.sharePanel.err = SHARE_ERR.invalid; render(); return; }
      BSmod = BSmod || await import('../core/boardshare.js');
      if (S.dead || S.share) return;
      const st = { role, boardId: role === 'host' ? b.id : null, sess: null, off: null, phase: 'connecting', peer: '' };
      S.share = st;
      if (S.sharePanel) S.sharePanel.err = '';
      st.sess = BSmod.shareBoard({
        role, code,
        read: () => S.data.boards.find(x => x.id === st.boardId) || null,
        write: view => applyShared(st, view),
      });
      st.off = st.sess.on((type, data) => {
        if (S.dead || S.share !== st) return;
        if (type === 'phase') st.phase = data;
        else if (type === 'peer') {
          st.phase = 'paired';
          st.peer = st.sess.peerName || 'Your friend';
          say(role === 'host' ? `${st.peer} joined your board` : `Joined ${st.peer}’s board`);
        } else if (type === 'ended') { endShare(st, data); return; }
        renderSoon();
      });
      render();
    }
    /* the merged board, into this device's copy: pictures, links and reactions stay as they are here */
    function applyShared(st, view) {
      let b = S.data.boards.find(x => x.id === st.boardId);
      if (!b) {
        if (S.data.boards.length >= MAX.boards) { tell('Too many boards', `A device holds up to ${MAX.boards} boards. Delete one to join a shared board.`, 'alert'); later(() => stopShare('full here'), 0); return; }
        b = normBoard({ name: view.name || 'Shared board', cols: [] });
        S.data.boards.push(b);
        st.boardId = b.id;
        S.data.activeId = b.id;
      }
      const prev = new Map(allCards(b).map(c => [c.id, c]));
      const prevArch = new Map(b.archive.map(a => [a.card.id, a.at]));
      const mk = x => {
        const old = prev.get(x.id);
        const items = x.checklist.map((it, k) => ({ id: old && old.checklist[k] && old.checklist[k].text === it.text ? old.checklist[k].id : undefined, text: it.text, done: it.done }));
        const same = old && old.title === x.title && old.notes === x.notes && old.color === x.color && old.due === x.due && old.pinned === x.pinned && JSON.stringify(old.checklist.map(i => [i.text, i.done])) === JSON.stringify(x.checklist.map(i => [i.text, i.done]));
        return normCard({
          id: x.id, title: x.title, notes: x.notes, color: x.color, due: x.due, pinned: x.pinned, checklist: items,
          links: old ? old.links : [], reactions: old ? old.reactions : [], image: old ? old.image : null, forge: old ? old.forge : null,
          created: old ? old.created : Date.now(), updated: same ? old.updated : Date.now(),
        });
      };
      const colOf = c => { const col = normCol({ id: c.id, name: c.name, limit: c.limit, done: c.done }); col.cards = c.cards.map(mk); return col; };
      b.name = line(view.name, MAX.boardName) || b.name;
      b.cols = view.cols.filter(c => !c.archived).slice(0, MAX.cols).map(colOf);
      b.archivedCols = view.cols.filter(c => c.archived).slice(0, MAX.archivedCols).map(c => ({ col: colOf(c), at: Date.now(), idx: b.cols.length }));
      b.archive = view.archived.slice(0, MAX.archive).map(a => ({ card: mk(a.card), col: a.col, colName: a.colName, at: prevArch.get(a.card.id) || Date.now() }));
      touchBoard(b);
      if (S.openId && !locate(S.openId)) { S.openId = null; S.picker = null; }
      persist();
      softRefresh();
    }
    /* this device changed the shared board (here, or in another window): send what differs */
    function shareLocal() {
      const st = S.share;
      if (!st || !st.sess || st.sess.applying) return;
      const b = S.data.boards.find(x => x.id === st.boardId);
      if (b) st.sess.local(b);
    }
    function stopShare(reason) { const st = S.share; if (st && st.sess) st.sess.leave(); else if (st) endShare(st, reason); }
    function endShare(st, reason) {
      if (S.share !== st) return;
      try { st.off && st.off(); } catch (e) { /* gone */ }
      S.share = null;
      if (S.dead) return;
      const who = st.peer || 'your friend';
      if (SHARE_ERR[reason]) { S.sharePanel = { role: st.role, code: S.sharePanel ? S.sharePanel.code : '', err: SHARE_ERR[reason] }; }
      else if (reason === 'left' || reason === 'lost touch') tell(reason === 'left' ? `${who} left` : `Lost touch with ${who}`, `The board isn’t shared any more. ${st.boardId ? 'Your copy stays on this device as it is now.' : ''}`.trim(), 'users');
      else if (reason === 'you left' && st.phase === 'paired') say('Stopped sharing. Your copy stays on this device.');
      render();
    }
    function shareChip() {
      const st = S.share;
      const text = st.phase === 'paired' ? `Live with ${st.peer}` : st.role === 'host' ? 'Waiting for your friend' : 'Joining…';
      return h('button.board-bar__live', { type: 'button', class: st.phase === 'paired' ? 'is-on' : '', dataset: { fk: 'share-chip' }, 'aria-label': `${text} — sharing settings`, onclick: () => openShare(st.role) },
        h('i', { 'aria-hidden': 'true' }), h('span', { text }));
    }
    async function copyInvite(code) {
      const link = inviteLink(code);
      try {
        await navigator.clipboard.writeText(`Work on my board with me in Static Board — room code ${code}${link ? ` · ${link}` : ''}`);
        tell('Invite copied', `Room code ${code}.`, 'copy');
      } catch (e) { tell(`Room code ${code}`, 'Copying was blocked here — read the code out instead.', 'info'); }
    }
    function renderSharePanel() {
      const p = S.sharePanel, st = S.share, b = activeBoard();
      const kids = [];
      const shared = st && S.data.boards.find(x => x.id === st.boardId);
      if (!st && p.role === 'host') {
        kids.push(
          h('p', { text: b ? `Share “${b.name}” with a friend, live: you both add, move and change cards, and see each other’s changes as they happen.` : 'Open a board to share it.' }),
          h('p.board-share__what', { text: 'What travels: card titles, notes, checklists, colour labels, due dates and pins, and the columns. Pictures, links and reactions stay on each device.' }),
          h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'share-go' }, disabled: b ? null : true, onclick: () => startShare('host') }, icon('users'), h('span', { text: 'Start sharing' })),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'share-swap' }, onclick: () => { p.role = 'guest'; S.focus = 'share-code'; render(); } }, h('span', { text: 'Or join a friend’s board' })));
      } else if (!st) {
        const input = h('input.board-share__in', { type: 'text', maxlength: '12', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
          placeholder: 'Friend’s code', 'aria-label': 'Room code from your friend', value: p.code || null, dataset: { fk: 'share-code' },
          oninput: e => { p.code = e.target.value; } });
        kids.push(
          h('p', { text: 'Type the room code your friend shared, then Join.' }),
          h('form.board-share__join', { onsubmit: e => { e.preventDefault(); const c = input.value.replace(/[\s-]+/g, '').toUpperCase(); p.code = c; startShare('guest', c); } },
            input, h('button.btn.btn--primary', { type: 'submit', dataset: { fk: 'share-go' } }, h('span', { text: 'Join' }))),
          h('p.board-share__what', { text: 'Joining adds a new board of your own, kept up to date while you are both there, and yours when either of you leaves.' }));
      } else if (st.phase === 'paired') {
        kids.push(h('p.board-share__with', h('i', { 'aria-hidden': 'true' }), h('span', { text: st.role === 'host' ? `Sharing “${shared ? shared.name : 'this board'}” with ${st.peer}` : `On ${st.peer}’s board, “${shared ? shared.name : '…'}”` })),
          shared && shared.id !== S.data.activeId ? h('button.btn.btn--sm', { type: 'button', onclick: () => selectBoard(shared.id) }, h('span', { text: 'Show the shared board' })) : null);
      } else if (st.role === 'host') {
        const code = st.sess.code;
        kids.push(h('p', { text: 'Your room code' }),
          h('div.board-share__code', { role: 'group', 'aria-label': `Room code ${spacedCode(code)}`, dataset: { code } }, [...code].map(ch => h('span', { text: ch, 'aria-hidden': 'true' }))),
          h('input.board-share__link', { type: 'text', readonly: true, value: inviteLink(code), 'aria-label': 'Invite link', onfocus: e => e.target.select() }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => copyInvite(code) }, icon('copy'), h('span', { text: 'Copy invite' })),
          h('p.board-share__wait', h('i.board-share__spin', { 'aria-hidden': 'true' }), h('span', { text: st.phase === 'waiting' ? 'Waiting for your friend — keep working, they’ll get all of it.' : 'Opening the room…' })));
      } else {
        kids.push(h('p.board-share__wait', h('i.board-share__spin', { 'aria-hidden': 'true' }), h('span', { text: `Joining ${st.sess.code}…` })));
      }
      if (p.err) kids.push(h('p.board-share__err', { role: 'alert', text: p.err }));
      if (st) kids.push(h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'share-stop' }, onclick: () => { stopShare('you left'); S.focus = 'share-go'; } }, h('span', { text: st.phase === 'paired' ? (st.role === 'host' ? 'Stop sharing' : 'Leave') : 'Cancel' })));
      kids.push(h('p.board-insp__meta', { text: 'This runs over StaticOS’s live connection, a free public relay. The board is encrypted with the room code before it leaves this device, so anyone watching the relay sees sealed bytes, not your cards — but the code is short and anyone who has it could join first, so treat it like a password. Names aren’t checked. Sharing stops when either of you leaves or closes Static Board.' }));
      inspEl.append(
        h('div.board-insp__head', icon('users'), h('b.board-arch__title', { text: 'Share live' }), h('span.grow'),
          h('button.ibtn.board-share__close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onclick: closeSharePanel }, icon('x'))),
        h('div.board-insp__scroll.board-share', ...kids.filter(Boolean)));
    }

    /* ==================================================================== */
    /*  menus                                                               */
    /* ==================================================================== */
    function popMenu(items, e, anchor) {
      if (S.dead) return;
      let x = e && e.clientX;
      let y = e && e.clientY;
      const el = anchor || (e && (e.currentTarget || e.target));
      if ((!x && !y) || (e && e.type === 'click' && e.detail === 0)) {
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (r) { x = r.left; y = r.bottom + 4; }
      }
      const guard = it => (it && typeof it === 'object' && it.onClick
        ? { ...it, onClick: (...a) => { if (!S.dead) it.onClick(...a); } }
        : it);
      /* no leading, trailing or doubled separators */
      const out = [];
      for (const it of items.filter(Boolean)) {
        if (it === '-' && (!out.length || out[out.length - 1] === '-')) continue;
        out.push(guard(it));
      }
      while (out[out.length - 1] === '-') out.pop();
      menu(out, x || 0, y || 0);
    }
    function linkMenuItems(card) {
      const items = [];
      for (const l of card.links) {
        const i = linkInfo(l);
        if (i.missing) continue;
        if (l.kind === 'game' || l.kind === 'arcade') items.push({ label: `Play ${i.title}`, icon: 'play', onClick: () => playLink(l) });
        else if (l.kind === 'project') {
          items.push({ label: `Open ${i.title} in Forge`, icon: 'sparkles', onClick: () => openProject(l, 'forge') });
          items.push({ label: `Open ${i.title} in Studio`, icon: 'code', onClick: () => openProject(l, 'studio') });
        } else if (l.kind === 'note') items.push({ label: `Open the note ${i.title}`, icon: 'note', onClick: () => openNote(l) });
        else if (l.kind === 'mindmap') items.push({ label: `Open the mind map ${i.title}`, icon: 'network', onClick: () => openMindmap(l) });
        else items.push({ label: `Open ${i.title}`, icon: 'external-link', onClick: () => openUrl(l) });
        if (items.length >= 6) break;
      }
      return items;
    }
    function cardMenu(id, e, anchor) {
      const loc = locate(id);
      if (!loc) return;
      const { board: b, col, ci, i, card } = loc;
      const [lo, hi] = moveRange(col, card);
      const up = neighbour(col, i, -1), down = neighbour(col, i, 1);
      const others = S.data.boards.filter(x => x.id !== b.id);
      popMenu([
        { label: 'Open card', icon: 'maximize-2', hint: hint('↵'), onClick: () => openCard(id, 'key') },
        { label: card.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', onClick: () => togglePin(id) },
        { label: 'React…', icon: 'heart', onClick: () => reactMenu(id, e, anchor) },
        '-',
        { label: 'Move left', icon: 'arrow-left', hint: hint(`${ALT}←`), disabled: ci === 0, onClick: () => moveCard(id, 'left') },
        { label: 'Move right', icon: 'arrow-right', hint: hint(`${ALT}→`), disabled: ci === b.cols.length - 1, onClick: () => moveCard(id, 'right') },
        { label: 'Move up', icon: 'arrow-up', hint: hint(`${ALT}↑`), disabled: up < 0 || up < lo, onClick: () => moveCard(id, 'up') },
        { label: 'Move down', icon: 'arrow-down', hint: hint(`${ALT}↓`), disabled: down < 0 || down > hi, onClick: () => moveCard(id, 'down') },
        '-',
        ...linkMenuItems(card),
        { label: 'Make this a game', icon: 'sparkles', disabled: !api.getApp('forge'), onClick: () => makeGame(id) },
        '-',
        { label: 'Duplicate', icon: 'copy', onClick: () => duplicateCard(id) },
        others.length
          ? { label: 'Copy to board', icon: 'copy', items: others.map(x => ({ label: x.name, hint: x.cols[0] ? x.cols[0].name : 'no columns', disabled: !x.cols.length, onClick: () => copyToBoard(id, x.id) })) }
          : { label: 'Copy to board', icon: 'copy', disabled: true, hint: 'no other boards' },
        { label: 'Archive', icon: 'box', onClick: () => archiveCard(id) },
        { label: 'Delete card', icon: 'trash', danger: true, onClick: () => deleteCard(id) },
      ], e, anchor);
    }
    function reactMenu(id, e, anchor) {
      const loc = locate(id);
      if (!loc) return;
      const have = loc.card.reactions;
      const cap = s => s[0].toUpperCase() + s.slice(1);
      popMenu(REACTIONS.map(x => ({
        label: `${x}  ${cap(REACTION_NAMES[x])}`,
        checked: have.includes(x),
        hint: have.includes(x) ? 'On' : null,
        onClick: () => toggleReaction(id, x),
      })), e, anchor);
    }
    function colMenu(id, e, anchor) {
      const b = activeBoard();
      const ci = b ? b.cols.findIndex(c => c.id === id) : -1;
      if (ci < 0) return;
      const col = b.cols[ci];
      popMenu([
        { label: 'Rename column', icon: 'edit-3', onClick: () => startRenameCol(id) },
        { label: 'Move left', icon: 'arrow-left', disabled: ci === 0, onClick: () => moveCol(id, -1) },
        { label: 'Move right', icon: 'arrow-right', disabled: ci === b.cols.length - 1, onClick: () => moveCol(id, 1) },
        '-',
        { label: 'Sort cards', icon: 'list', disabled: col.cards.length < 2, items: SORTS.map(([k, label]) => ({ label, onClick: () => sortCol(id, k) })) },
        { label: col.limit ? `Limit: ${col.limit} cards` : 'Set a limit', icon: 'sliders', items: [
          { label: 'No limit', checked: !col.limit, onClick: () => setLimit(id, 0) },
          ...LIMITS.map(n => ({ label: `${n} card${n === 1 ? '' : 's'}`, checked: col.limit === n, onClick: () => setLimit(id, n) })),
        ] },
        { label: 'Cards here are done', icon: 'check-circle', checked: col.done, onClick: () => toggleDone(id) },
        '-',
        { label: 'Archive column', icon: 'box', onClick: () => archiveCol(id) },
        { label: 'Delete column', icon: 'trash', danger: true, onClick: () => deleteCol(id) },
      ], e, anchor);
    }
    function boardMenu(id, e, fromSide) {
      const i = S.data.boards.findIndex(b => b.id === id);
      if (i < 0) return;
      const run = fn => () => { if (S.data.activeId !== id) selectBoard(id); fn(); };
      popMenu([
        { label: 'Rename board', icon: 'edit-3', onClick: run(startRenameBoard) },
        { label: 'Add column', icon: 'plus', onClick: run(startAddCol) },
        { label: 'Save as Markdown', icon: 'download', onClick: () => exportBoard(id) },
        { label: 'Save as JSON', icon: 'file-code', onClick: () => exportJSON(id) },
        { label: 'Print board', icon: 'printer', onClick: () => printBoard(id) },
        { label: `Archived…${(() => { const b = S.data.boards[i]; const n = b.archive.length + b.archivedCols.length; return n ? ` (${n})` : ''; })()}`, icon: 'box', onClick: run(openArchive) },
        '-',
        { label: S.share && S.share.boardId === id ? 'Sharing live…' : 'Share live with a friend…', icon: 'users', onClick: run(() => openShare('host')) },
        fromSide ? '-' : null,
        fromSide ? { label: 'Move up', icon: 'arrow-up', disabled: i === 0, onClick: () => moveBoard(id, -1) } : null,
        fromSide ? { label: 'Move down', icon: 'arrow-down', disabled: i === S.data.boards.length - 1, onClick: () => moveBoard(id, 1) } : null,
        '-',
        { label: 'Delete board', icon: 'trash', danger: true, onClick: () => deleteBoard(id) },
      ], e);
    }
    function addLinkMenu(cardId, e) {
      popMenu([
        { label: 'Note…', icon: 'note', onClick: () => openPicker('note') },
        { label: 'Mind map…', icon: 'network', onClick: () => openPicker('mindmap') },
        { label: 'Catalogue game…', icon: 'gamepad', onClick: () => openPicker('game') },
        { label: 'Arcade game…', icon: 'zap', onClick: () => openPicker('arcade') },
        { label: 'Forge project…', icon: 'sparkles', onClick: () => openPicker('project') },
        { label: 'Web link…', icon: 'globe', onClick: () => openPicker('url') },
      ], e);
    }

    /* ==================================================================== */
    /*  view skeleton                                                       */
    /* ==================================================================== */
    const sideEl = h('aside.app__side.board__side', { 'aria-label': 'Boards' });
    const barEl = h('div.app__bar.board-bar');
    const emptyEl = h('div.board-emptywrap', { hidden: true });
    const colsEl = h('div.board-cols');
    const scrimEl = h('div.board-scrim', { 'aria-hidden': 'true', onclick: () => closeInsp(true) });
    const inspEl = h('aside.board-insp', { 'aria-label': 'Card details', tabindex: '-1', hidden: true, dataset: { fk: 'insp-panel' } });
    const bodyEl = h('div.board-body', emptyEl, colsEl, scrimEl, inspEl);
    const mainEl = h('div.app__main.board__main', barEl, bodyEl);
    const hintEl = h('span.sr', { id: `${IID}-hint`, text: 'Enter opens the card. Alt with an arrow key moves it.' });
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    const appEl = h('div.app.board', sideEl, mainEl, hintEl, live, fileIn, boardFileIn);
    root.appendChild(appEl);

    /* ---------------- focus keeping ---------------- */
    function captureFocus() {
      const a = document.activeElement;
      if (!a || !appEl.contains(a)) return null;
      const n = a.closest('[data-fk]');
      if (!n) return null;
      let sel = null;
      try { if (n === a && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch (e) { /* not a text field */ }
      return { fk: n.dataset.fk, sel };
    }
    function restoreFocus(cap) {
      const want = S.focus || (cap && cap.fk);
      const reveal = S.reveal;
      S.focus = null;
      S.reveal = false;
      if (!want) return;
      const el = want[0] === '@' ? appEl.querySelector(want.slice(1)) : appEl.querySelector(`[data-fk="${esc(want)}"]`);
      if (!el || el.disabled) return;
      if (document.activeElement !== el) {
        try { el.focus({ preventScroll: true }); } catch (e) { /* detached */ }
        if (cap && cap.sel && cap.fk === want && typeof el.setSelectionRange === 'function') {
          try { el.setSelectionRange(cap.sel[0], cap.sel[1]); } catch (e) { /* not a text field */ }
        }
      }
      if (reveal) revealEl(el);
    }
    function withFocus(fn) { const cap = captureFocus(); fn(); restoreFocus(cap); }
    /* bring an element into view inside its column and the board — by hand,
       because focus()/scrollIntoView would also scroll the window body */
    function revealEl(el) {
      if (!el || !el.isConnected) return;
      const list = el.closest('.board-col__list');
      if (list) {
        const r = el.getBoundingClientRect();
        const lr = list.getBoundingClientRect();
        if (r.top < lr.top) list.scrollTop -= lr.top - r.top + 8;
        else if (r.bottom > lr.bottom) list.scrollTop += r.bottom - lr.bottom + 8;
      }
      const col = el.closest('.board-col, .board-addcol');
      if (col && colsEl.contains(col)) {
        const r = col.getBoundingClientRect();
        const cr = colsEl.getBoundingClientRect();
        if (r.left < cr.left) colsEl.scrollLeft -= cr.left - r.left + 16;
        else if (r.right > cr.right) colsEl.scrollLeft += r.right - cr.right + 16;
      }
    }

    /* ==================================================================== */
    /*  sidebar                                                             */
    /* ==================================================================== */
    function renderSide() {
      clear(sideEl);
      const group = h('div.side__group.board-side__group',
        h('div.side__label', { id: `${IID}-boards`, text: 'Boards' }));
      const list = h('div.board-side__list', { role: 'list', 'aria-labelledby': `${IID}-boards` });
      for (const b of S.data.boards) {
        const on = b.id === S.data.activeId;
        const n = countCards(b);
        list.append(h('div', { role: 'listitem' }, h('button.side__item.board-side__item', {
          type: 'button', class: on ? 'is-on' : '', 'aria-current': on ? 'true' : null,
          'aria-label': `${b.name}, ${plural(n, 'card')}`, title: b.name,
          dataset: { fk: `board:${b.id}` },
          onclick: () => selectBoard(b.id),
          oncontextmenu: e => { e.preventDefault(); boardMenu(b.id, e, true); },
        }, icon('clipboard'), h('span', { text: b.name }), n ? h('small', { text: String(n) }) : null)));
      }
      if (S.data.boards.length) group.append(list);

      if (S.addingBoard) {
        let done = false;
        const input = h('input.board-side__new', {
          type: 'text', maxlength: String(MAX.boardName), placeholder: 'Board name', 'aria-label': 'New board name',
          value: S.drafts.newBoard || null, dataset: { fk: 'board-new' },
          oninput: e => { S.drafts.newBoard = e.target.value; },
        });
        const finish = (save, viaBlur) => {
          if (done) return;
          done = true;
          const v = input.value;
          S.drafts.newBoard = '';
          if (save && line(v, MAX.boardName)) { createBoard(v); return; }
          S.addingBoard = false;
          if (viaBlur) renderSoon(); else { S.focus = 'board-add'; render(); }
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        /* leaving an empty field closes it; leaving a named one keeps it open.
           A blur caused by our own re-render is not the person leaving. */
        input.addEventListener('blur', () => { if (!S.rendering && !line(input.value, MAX.boardName)) finish(false, true); });
        group.append(h('div.board-side__newrow', input,
          h('button.ibtn', { type: 'button', 'aria-label': 'Create board', onmousedown: e => e.preventDefault(), onclick: () => finish(true) }, icon('check'))));
        /* or start from a template: its name unless one was typed */
        group.append(h('div.board-side__tpls', { role: 'group', 'aria-label': 'Start from a template' },
          h('small', { text: 'Or start from a template' }),
          BD.TEMPLATES.map(t => h('button.board-side__tpl', {
            type: 'button', title: t.blurb, dataset: { fk: `tpl:${t.id}` }, onmousedown: e => e.preventDefault(),
            onclick: () => { done = true; const v = line(input.value, MAX.boardName); S.drafts.newBoard = ''; createBoard(v || t.name, t); },
          }, icon(t.icon), h('span', { text: t.name })))));
      } else {
        group.append(h('button.side__item.board-side__add', {
          type: 'button', dataset: { fk: 'board-add' },
          disabled: S.data.boards.length >= MAX.boards ? true : null,
          onclick: () => { S.addingBoard = true; S.focus = 'board-new'; render(); },
        }, icon('plus'), h('span', { text: 'New board' })));
      }
      group.append(
        h('button.side__item.board-side__add', { type: 'button', 'aria-haspopup': 'menu', dataset: { fk: 'board-import' }, disabled: S.data.boards.length >= MAX.boards ? true : null, onclick: e => importMenu(e) }, icon('upload'), h('span', { text: 'Import…' })),
        h('button.side__item.board-side__add', { type: 'button', dataset: { fk: 'board-join' }, onclick: () => openShare('guest') }, icon('users'), h('span', { text: 'Join a shared board…' })));
      sideEl.append(group);

      /* an honest footprint of what is on this device */
      const total = S.data.boards.reduce((n, b) => n + countCards(b), 0);
      sideEl.append(h('div.board-side__foot',
        h('div.side__meter',
          h('b', { text: plural(S.data.boards.length, 'board') }),
          h('small', { text: total ? plural(total, 'card') : 'No cards yet' })),
        h('div.board-side__note', { text: 'Saved on this device only.' })));
    }

    /* ==================================================================== */
    /*  bar                                                                 */
    /* ==================================================================== */
    function renderBar() {
      clear(barEl);
      const b = activeBoard();
      if (S.narrow && S.data.boards.length) {
        barEl.append(h('button.ibtn', {
          type: 'button', 'aria-label': 'All boards', title: 'All boards', dataset: { fk: 'to-boards' },
          onclick: () => { flushPersist(); S.pane = 'boards'; S.openId = null; S.picker = null; S.focus = S.data.activeId ? `board:${S.data.activeId}` : 'board-add'; render(); },
        }, icon('chevron-left')));
      }
      if (!b) { barEl.append(h('div.app__title', { text: 'Static Board' })); return; }

      if (S.renamingBoard) {
        let done = false;
        const input = h('input.board-rename', {
          type: 'text', value: S.drafts.boardName ?? b.name, maxlength: String(MAX.boardName), 'aria-label': 'Board name',
          dataset: { fk: 'board-rename' },
          oninput: e => { S.drafts.boardName = e.target.value; },
        });
        const finish = (save, viaBlur) => {
          if (done) return;
          done = true;
          S.renamingBoard = false;
          S.drafts.boardName = null;
          const nm = line(input.value, MAX.boardName);
          if (save && nm && nm !== b.name) { b.name = nm; touchBoard(b); persist(); say(`Renamed the board ${nm}`); }
          if (viaBlur) renderSoon(); else { S.focus = 'board-title'; render(); }
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', () => { if (!S.rendering) finish(true, true); });
        barEl.append(h('div.board-bar__rename', input));
      } else {
        barEl.append(h('button.app__title.board-bar__title', {
          type: 'button', title: 'Rename board', 'aria-label': `${b.name}, rename board`, dataset: { fk: 'board-title' },
          onclick: startRenameBoard,
        }, h('span', { text: b.name })));
        barEl.append(h('span.board-bar__count', { text: plural(countCards(b), 'card') }));
      }
      if (S.share && S.share.boardId === b.id) barEl.append(shareChip());
      barEl.append(h('span.grow'));
      const q = h('input.board-bar__q', {
        type: 'search', placeholder: 'Search cards', 'aria-label': 'Search the cards on this board', autocomplete: 'off', spellcheck: 'false',
        value: S.filter.q || null, dataset: { fk: 'board-q' },
        oninput: e => { cancel(qT); const v = e.target.value; qT = later(() => setFilter({ q: v }), 120); },
        onkeydown: e => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; setFilter({ q: '' }); } },
      });
      const on = filtering();
      barEl.append(h('div.field.board-bar__search', icon('search'), q));
      barEl.append(h('button.ibtn.board-bar__filter', {
        type: 'button', 'aria-label': on ? 'Filters (some on)' : 'Filters', 'aria-haspopup': 'menu', title: 'Filter the cards', class: S.filter.labels.length || FILTERS.some(([k]) => S.filter[k]) ? 'is-on' : '',
        dataset: { fk: 'board-filter' }, onclick: e => filterMenu(e),
      }, icon('filter')));
      if (on) {
        const n = b.cols.reduce((k, col) => k + shownCards(col).length, 0);
        barEl.append(h('span.board-bar__shown', { role: 'status' }, h('span', { text: `${n} of ${countCards(b)}` }),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'filter-clear' }, onclick: () => { clearFilter(); S.focus = 'board-q'; } }, h('span', { text: 'Show all' }))));
      }
      barEl.append(h('button.btn.btn--sm.board-bar__addcol', {
        type: 'button', 'aria-label': 'Add column', title: 'Add column', dataset: { fk: 'bar-addcol' },
        disabled: b.cols.length >= MAX.cols ? true : null, onclick: startAddCol,
      }, icon('plus'), h('span.board-bar__lbl', { text: 'Column' })));
      barEl.append(h('button.ibtn', {
        type: 'button', 'aria-label': 'Board actions', 'aria-haspopup': 'menu', title: 'Board actions', dataset: { fk: 'board-menu' },
        onclick: e => boardMenu(b.id, e, false),
      }, icon('more-horizontal')));
    }

    /* ==================================================================== */
    /*  board: empty state + columns                                        */
    /* ==================================================================== */
    function renderEmpty() {
      clear(emptyEl);
      emptyEl.append(h('div.empty.board-empty',
        icon('clipboard'),
        h('b', { text: 'No boards yet' }),
        h('small', { text: 'A board keeps ideas as cards in columns — Ideas, Doing and Done. Start one for a game you want to make, your school work, or anything you’re planning.' }),
        h('div.board-empty__picks', { role: 'group', 'aria-label': 'Start a board' },
          SUGGESTED.map(s => h('button.btn.btn--sm', { type: 'button', dataset: { fk: `sugg:${s.name}` }, onclick: () => createBoard(s.name) },
            icon(s.icon), h('span', { text: s.name })))),
        h('div.board-empty__tpls', { role: 'group', 'aria-label': 'Templates' },
          BD.TEMPLATES.map(t => h('button.board-tpl', { type: 'button', dataset: { fk: `etpl:${t.id}` }, onclick: () => createBoard(t.name, t) },
            icon(t.icon), h('b', { text: t.name }), h('small', { text: t.blurb })))),
        h('button.btn.btn--sm.btn--primary', {
          type: 'button', dataset: { fk: 'empty-new' },
          onclick: () => { S.addingBoard = true; S.pane = 'boards'; S.focus = 'board-new'; render(); },
        }, icon('plus'), h('span', { text: 'New board…' })),
        h('div.board-empty__row',
          h('button.btn.btn--sm', { type: 'button', 'aria-haspopup': 'menu', dataset: { fk: 'empty-import' }, onclick: e => importMenu(e) }, icon('upload'), h('span', { text: 'Import…' })),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'empty-join' }, onclick: () => openShare('guest') }, icon('users'), h('span', { text: 'Join a shared board…' }))),
        h('span.board-empty__note', { text: 'Boards are saved on this device only.' })));
    }

    function renderCols(b) {
      if (!b) return;
      const same = S.shownBoard === b.id;
      const left = same ? colsEl.scrollLeft : 0;
      const tops = new Map();
      if (same) colsEl.querySelectorAll('.board-col__list').forEach(l => tops.set(l.dataset.col, l.scrollTop));
      S.shownBoard = b.id;
      mark = null;
      clear(colsEl);
      const boardEmpty = !countCards(b);
      b.cols.forEach((col, ci) => colsEl.append(colView(b, col, ci, boardEmpty)));
      colsEl.append(addColView(b));
      colsEl.scrollLeft = left;
      colsEl.querySelectorAll('.board-col__list').forEach(l => { const t = tops.get(l.dataset.col); if (t) l.scrollTop = t; });
    }

    function colView(b, col, ci, boardEmpty) {
      const renaming = S.renamingCol === col.id;
      let nameEl;
      if (renaming) {
        let done = false;
        const input = h('input.board-col__rename', {
          type: 'text', value: S.drafts.colName ?? col.name, maxlength: String(MAX.colName), 'aria-label': 'Column name',
          dataset: { fk: `colname:${col.id}` },
          oninput: e => { S.drafts.colName = e.target.value; },
        });
        const finish = (save, viaBlur) => {
          if (done) return;
          done = true;
          S.drafts.colName = null;
          if (save) renameCol(col.id, input.value, viaBlur);
          else { S.renamingCol = null; S.focus = `colmore:${col.id}`; render(); }
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', () => { if (!S.rendering) finish(true, true); });
        nameEl = input;
      } else {
        nameEl = h('h3.board-col__name', { text: col.name, title: `${col.name} — double-click to rename`, ondblclick: () => startRenameCol(col.id) });
      }
      const over = col.limit && col.cards.length > col.limit;
      const head = h('header.board-col__head', { draggable: renaming ? 'false' : 'true', class: over ? 'is-over' : '' },
        nameEl,
        col.done ? h('span.board-col__done', { title: 'Cards here are done', 'aria-hidden': 'true' }, icon('check-circle')) : null,
        h('span.board-col__count', { text: col.limit ? `${col.cards.length} / ${col.limit}` : String(col.cards.length), 'aria-hidden': 'true', title: col.limit ? `Limit: ${col.limit} cards${over ? ' — over it' : ''}` : null }),
        h('button.ibtn.board-col__more', {
          type: 'button', 'aria-label': `Column actions: ${col.name}`, 'aria-haspopup': 'menu', title: 'Column actions',
          dataset: { fk: `colmore:${col.id}` }, onclick: e => colMenu(col.id, e),
        }, icon('more-horizontal')));

      const addIn = h('input.board-col__addin', {
        type: 'text', maxlength: String(MAX.title), placeholder: 'Add a card', 'aria-label': `Add a card to ${col.name}`,
        enterkeyhint: 'enter', autocomplete: 'off', value: S.drafts[col.id] || null,
        dataset: { fk: `add:${col.id}` },
        oninput: e => { S.drafts[col.id] = e.target.value; },
        onkeydown: e => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            const v = e.target.value;
            e.target.value = '';
            S.drafts[col.id] = '';
            if (line(v, MAX.title)) addCard(col.id, v);
          } else if (e.key === 'Escape') {
            if (e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; S.drafts[col.id] = ''; }
          } else if (e.key === 'ArrowDown' && !e.altKey && !e.shiftKey) {
            const first = list.querySelector('.board-card__open');
            if (first) { e.preventDefault(); first.focus({ preventScroll: true }); revealEl(first); }
          }
        },
      });
      const add = h('div.board-col__addrow',
        h('label.board-col__add', icon('plus'), addIn),
        h('button.ibtn.board-col__img', {
          type: 'button', 'aria-label': `Add a picture card to ${col.name}`, title: 'Add a picture card',
          dataset: { fk: `addimg:${col.id}` }, disabled: S.imgBusy ? true : null,
          onclick: () => pickImage(f => addImageCard(col.id, f)),
        }, icon('image')));

      const shown = shownCards(col);
      const list = h('div.board-col__list', {
        role: shown.length ? 'list' : null,
        'aria-label': `${col.name}, ${filtering() ? `${shown.length} of ${col.cards.length} cards shown` : plural(col.cards.length, 'card')}${col.limit ? `, limit ${col.limit}${over ? ', over the limit' : ''}` : ''}${col.done ? ', done column' : ''}`,
        dataset: { col: col.id },
      });
      if (!shown.length) {
        list.append(h('div.board-col__empty', { text: col.cards.length ? 'No cards here match' : boardEmpty && ci === 0 ? 'Type an idea above and press Enter.' : 'No cards yet' }));
      } else {
        for (const c of shown) list.append(cardView(c, col));
      }
      return h('section.board-col', { role: 'group', 'aria-label': col.name, class: over ? 'is-over' : '', dataset: { col: col.id } }, head, add, list);
    }

    function cardLabel(c, col) {
      const parts = [c.title];
      if (c.pinned) parts.push('pinned');
      if (c.due) parts.push(dueText(c, col).long);
      if (c.image) parts.push(c.image.alt ? `picture: ${c.image.alt}` : 'has a picture');
      if (c.reactions.length) parts.push(`reactions ${c.reactions.map(e => REACTION_NAMES[e] || e).join(', ')}`);
      if (c.color !== 'none') parts.push(`${labelName(c.color)} label`);
      if (c.notes.trim()) parts.push('has notes');
      const t = c.checklist.length;
      if (t) parts.push(`checklist ${c.checklist.filter(i => i.done).length} of ${t} done`);
      if (c.links.length) parts.push(`linked to ${c.links.map(l => linkInfo(l).title).join(', ')}`);
      if (c.forge) parts.push('sent to Static Forge');
      return parts.join(', ');
    }

    /** Redraw one card where it stands. -> false if it isn't on screen. */
    function repaintCard(c) {
      const el = colsEl.querySelector(`.board-card[data-card="${esc(c.id)}"]`);
      if (!el) return false;
      const loc = locate(c.id);
      paint(() => el.replaceWith(cardView(c, loc && loc.col)));
      return true;
    }
    function cardView(c, col) {
      const total = c.checklist.length;
      const done = c.checklist.filter(i => i.done).length;
      const notes = line(c.notes, 180);
      const meta = [];
      if (c.due) { const d = dueText(c, col); meta.push(h('span.board-card__m.board-card__due', { class: d.cls }, icon('calendar'), h('span', { text: d.text }))); }
      if (total) meta.push(h('span.board-card__m', { class: done === total ? 'is-done' : '' }, icon('check-circle'), h('span', { text: `${done}/${total}` })));
      for (const l of c.links.slice(0, 2)) {
        const i = linkInfo(l);
        meta.push(h('span.board-card__m.board-card__link', { class: i.missing ? 'is-missing' : '' }, icon(i.icon), h('span', { text: i.title })));
      }
      if (c.links.length > 2) meta.push(h('span.board-card__m', { text: `+${c.links.length - 2}` }));
      if (c.forge) meta.push(h('span.board-card__m.is-forge', icon('sparkles'), h('span', { text: 'Sent to Forge' })));

      /* a focusable div, not a <button>: Firefox won't start a drag from a button,
         and the whole card is the drag handle. Enter/Space are handled in cardKeys. */
      const open = h('div.board-card__open', {
        role: 'button', tabindex: '0', 'aria-label': cardLabel(c, col), 'aria-describedby': `${IID}-hint`,
        dataset: { fk: `card:${c.id}`, card: c.id },
        onclick: () => openCard(c.id, 'pointer'),
      },
        c.image ? h('img.board-card__img', {
          src: c.image.src, alt: '', draggable: 'false', loading: 'lazy',
          style: c.image.w && c.image.h ? { aspectRatio: `${c.image.w} / ${c.image.h}` } : null,
        }) : null,
        h('span.board-card__title', c.pinned ? h('span.board-card__pin', { title: 'Pinned' }, icon('pin')) : null, h('span', { text: c.title })),
        notes ? h('span.board-card__notes', { text: notes }) : null,
        c.reactions.length ? h('span.board-card__reacts', { 'aria-hidden': 'true' }, c.reactions.map(e => h('span.board-card__react', { text: e }))) : null,
        meta.length ? h('span.board-card__meta', meta) : null);
      const more = h('button.ibtn.board-card__more', {
        type: 'button', 'aria-label': `Card actions: ${c.title}`, 'aria-haspopup': 'menu', title: 'Card actions',
        dataset: { fk: `more:${c.id}` },
        onclick: e => { e.stopPropagation(); cardMenu(c.id, e); },
      }, icon('more-horizontal'));
      const lbl = c.color !== 'none' ? c.color : null;
      return h('div.board-card', {
        role: 'listitem', draggable: 'true',
        class: [lbl ? 'has-lbl' : '', S.openId === c.id ? 'is-open' : '', c.pinned ? 'is-pinned' : '', c.image ? 'has-img' : ''].filter(Boolean).join(' '),
        style: lbl ? { '--lbl': `var(--lbl-${lbl})` } : null,
        dataset: { card: c.id },
      }, open, more);
    }

    function addColView(b) {
      if (S.addingCol) {
        let done = false;
        const input = h('input.board-addcol__in', {
          type: 'text', maxlength: String(MAX.colName), placeholder: 'Column name', 'aria-label': 'New column name',
          value: S.drafts.newCol || null, dataset: { fk: 'addcol' },
          oninput: e => { S.drafts.newCol = e.target.value; },
        });
        const finish = (save, viaBlur) => {
          if (done) return;
          done = true;
          if (save && line(input.value, MAX.colName)) { addCol(input.value, !viaBlur); return; }
          S.addingCol = false;
          S.drafts.newCol = '';
          if (viaBlur) renderSoon(); else { S.focus = 'addcol-btn'; render(); }
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', () => { if (!S.rendering) finish(true, true); });
        const keep = e => e.preventDefault();   /* keep focus in the field so blur doesn't fire first */
        return h('div.board-addcol.is-on',
          h('div.field', input),
          h('div.board-addcol__row',
            h('button.btn.btn--sm.btn--primary', { type: 'button', onmousedown: keep, onclick: () => finish(true) }, h('span', { text: 'Add column' })),
            h('button.btn.btn--sm.btn--ghost', { type: 'button', onmousedown: keep, onclick: () => finish(false) }, h('span', { text: 'Cancel' }))));
      }
      const full = b.cols.length >= MAX.cols;
      return h('div.board-addcol',
        h('button.board-addcol__btn', { type: 'button', dataset: { fk: 'addcol-btn' }, disabled: full ? true : null, onclick: startAddCol },
          icon('plus'), h('span', { text: full ? `${MAX.cols} columns is the most a board holds` : 'Add column' })),
        !b.cols.length ? h('p.board-addcol__hint', { text: 'This board has no columns. Add one to start putting cards on it.' }) : null);
    }

    /* ==================================================================== */
    /*  card panel                                                          */
    /* ==================================================================== */
    /* grow a textarea to its text. Measuring means a moment at height:auto,
       which can clamp the panel's scroll — so put that back too. */
    function autosize(ta, max) {
      if (!ta.isConnected) return;
      const box = ta.closest('.board-insp__scroll');
      const top = box ? box.scrollTop : 0;
      ta.style.height = 'auto';
      const want = ta.scrollHeight + 2;
      ta.style.height = `${max ? Math.min(want, max) : want}px`;
      if (box && box.scrollTop !== top) box.scrollTop = top;
    }

    function renderInsp() {
      if (S.sharePanel) {
        S.openId = null;
        S.picker = null;
        S.archiveOpen = false;
        clear(inspEl);
        inspEl.hidden = false;
        inspEl.dataset.card = '@share';
        appEl.classList.add('has-insp');
        renderSharePanel();
        return;
      }
      const ab = S.archiveOpen ? activeBoard() : null;
      if (ab) {
        S.openId = null;
        S.picker = null;
        clear(inspEl);
        inspEl.hidden = false;
        inspEl.dataset.card = '@archive';
        appEl.classList.add('has-insp');
        renderArchive(ab);
        return;
      }
      S.archiveOpen = false;
      const loc = S.openId ? locate(S.openId) : null;
      if (!loc) {
        S.openId = null;
        S.picker = null;
        clear(inspEl);
        inspEl.hidden = true;
        delete inspEl.dataset.card;
        appEl.classList.remove('has-insp');
        return;
      }
      const { board: b, col, card: c } = loc;
      const fresh = inspEl.hidden || inspEl.dataset.card !== c.id;
      /* same card, rebuilt (a tick, a new link): stay where the reader was */
      const oldScroll = inspEl.querySelector('.board-insp__scroll');
      const keepTop = !fresh && oldScroll ? oldScroll.scrollTop : 0;
      clear(inspEl);
      inspEl.hidden = false;
      inspEl.dataset.card = c.id;
      appEl.classList.add('has-insp');
      inspEl.classList.toggle('is-fresh', fresh);

      /* head: which column it is in (a real move), actions, close */
      const colSel = h('select.select.board-insp__col', {
        'aria-label': 'Column', dataset: { fk: 'insp-col' },
        onchange: e => moveCardToCol(c.id, e.target.value),
      }, b.cols.map(k => h('option', { value: k.id, selected: k.id === col.id ? true : null, text: k.name })));
      const head = h('div.board-insp__head',
        h('span.board-insp__in', { text: 'In' }), colSel,
        h('span.grow'),
        h('button.ibtn.board-insp__pin', {
          type: 'button', class: c.pinned ? 'is-on' : '', 'aria-pressed': c.pinned ? 'true' : 'false',
          'aria-label': 'Pin to the top of the column', title: c.pinned ? 'Unpin' : 'Pin to top', dataset: { fk: 'insp-pin' },
          onclick: () => { S.focus = 'insp-pin'; togglePin(c.id); },
        }, icon('pin')),
        h('button.ibtn', { type: 'button', 'aria-label': 'Card actions', 'aria-haspopup': 'menu', title: 'Card actions', dataset: { fk: 'insp-more' }, onclick: e => cardMenu(c.id, e) }, icon('more-horizontal')),
        h('button.ibtn', { type: 'button', 'aria-label': 'Close card', title: 'Close (Esc)', dataset: { fk: 'insp-close' }, onclick: () => closeInsp(true) }, icon('x')));

      /* title — saved as you type; can't be left empty */
      const title = h('textarea.board-insp__title', { rows: '1', maxlength: String(MAX.title), 'aria-label': 'Card title', spellcheck: 'true', dataset: { fk: 'insp-title' } });
      title.value = c.title;
      title.addEventListener('input', () => {
        autosize(title);
        const v = line(title.value, MAX.title);
        if (v) editCard(c.id, card => { card.title = v; }, { soft: true });
      });
      title.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); notes.focus(); } });
      title.addEventListener('blur', () => {
        const cur = locate(c.id);
        if (!S.rendering && cur && !line(title.value, MAX.title)) { title.value = cur.card.title; autosize(title); }
      });

      /* colour label — a native radio group, so arrow keys just work */
      const group = `${IID}-lbl`;
      const swatches = h('div.board-sw', { role: 'radiogroup', 'aria-label': 'Colour label' },
        LABELS.map(L => h('label.board-sw__opt', { title: L.name },
          h('input.sr', {
            type: 'radio', name: group, value: L.id, checked: c.color === L.id ? true : null, 'aria-label': L.name,
            dataset: { fk: `lbl:${L.id}` },
            onchange: () => editCard(c.id, card => { card.color = L.id; }),
          }),
          h('span.board-sw__dot', { class: `is-${L.id}`, style: L.id !== 'none' ? { '--lbl': `var(--lbl-${L.id})` } : null }))));

      /* notes */
      const notes = h('textarea.board-insp__notes', {
        rows: '4', maxlength: String(MAX.notes), placeholder: 'Notes — details, steps, anything worth keeping',
        'aria-label': 'Notes', dataset: { fk: 'insp-notes' },
      });
      notes.value = c.notes;
      notes.addEventListener('input', () => {
        autosize(notes, 320);
        editCard(c.id, card => { card.notes = notes.value.slice(0, MAX.notes); }, { soft: true });
      });

      const sec = (id, label, extra, ...kids) => h('section.board-insp__sec', { 'aria-labelledby': `${IID}-${id}` },
        h('div.board-insp__h', h('span', { id: `${IID}-${id}`, text: label }), extra), ...kids);

      /* actions that reach into the OS */
      const hasForge = !!api.getApp('forge');
      const doRow = h('div.board-insp__do',
        h('button.btn.btn--sm.btn--primary', {
          type: 'button', dataset: { fk: 'insp-make' }, disabled: hasForge ? null : true,
          title: hasForge ? 'Open Static Forge with this card’s title and notes as the prompt' : 'Static Forge isn’t installed',
          onclick: () => makeGame(c.id),
        }, icon('sparkles'), h('span', { text: 'Make this a game' })),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'insp-archive' }, onclick: () => archiveCard(c.id) }, icon('box'), h('span', { text: 'Archive' })),
        h('button.btn.btn--sm.btn--ghost.board-insp__del', { type: 'button', dataset: { fk: 'insp-del' }, onclick: () => deleteCard(c.id) }, icon('trash'), h('span', { text: 'Delete' })));

      const created = ago(c.created);
      const edited = c.updated > c.created + 1000 ? ago(c.updated) : null;

      /* due date: a real date input, and what it means today */
      const dueIn = h('input.board-due__in', {
        type: 'date', 'aria-label': 'Due date', value: c.due || null, dataset: { fk: 'due-in' },
        onchange: e => setDue(c.id, e.target.value),
      });
      const dueNote = c.due ? dueText(c, col) : null;
      const dueSec = sec('due', 'Due', null,
        h('div.board-due', dueIn,
          c.due ? h('span.board-due__say', { class: dueNote.cls, text: col.done ? `${col.name} is a done column` : dueNote.text }) : h('span.board-due__say', { text: 'No due date. One shows on the card and on Calendar.' }),
          c.due ? h('button.ibtn', { type: 'button', 'aria-label': 'Clear the due date', title: 'Clear', dataset: { fk: 'due-clear' }, onclick: () => setDue(c.id, null) }, icon('x')) : null));
      const scroll = h('div.board-insp__scroll',
        h('div.board-insp__top', title, swatches),
        dueSec,
        sec('notes', 'Notes', null, notes),
        reactSec(c, sec),
        pictureSec(c, sec),
        checklistSec(c, sec),
        linksSec(c, sec),
        doRow,
        h('p.board-insp__meta', { text: `Added ${created}${edited ? ` · Edited ${edited}` : ''}` }));
      inspEl.append(head, scroll);

      /* size the text boxes now (the panel is in the document), then put the
         scroll back — sizing after would shift it */
      autosize(title);
      autosize(notes, 320);
      if (keepTop) scroll.scrollTop = keepTop;
      frame(() => { autosize(title); autosize(notes, 320); });
    }

    function reactSec(c, sec) {
      return sec('re', 'Reactions', null,
        h('div.board-reacts', { role: 'group', 'aria-label': 'Reactions' },
          REACTIONS.map(e => h('button.board-react', {
            type: 'button', 'aria-pressed': c.reactions.includes(e) ? 'true' : 'false',
            'aria-label': REACTION_NAMES[e], title: REACTION_NAMES[e], dataset: { fk: `react:${e}` },
            onclick: () => { S.focus = `react:${e}`; toggleReaction(c.id, e); },
          }, h('span', { text: e, 'aria-hidden': 'true' })))));
    }

    function pictureSec(c, sec) {
      const kids = [];
      if (S.imgBusy) kids.push(h('div.board-pic__busy', h('div.spinner'), h('span', { text: 'Making the picture smaller…' })));
      const pick = () => pickImage(f => setImage(c.id, f));
      if (c.image) {
        const alt = h('input.board-pic__alt', {
          type: 'text', maxlength: String(MAX.alt), placeholder: 'Describe the picture', 'aria-label': 'Picture description (read out by screen readers)',
          dataset: { fk: 'img-alt' },
        });
        alt.value = c.image.alt;
        alt.addEventListener('input', () => editCard(c.id, card => { if (card.image) card.image.alt = line(alt.value, MAX.alt); }, { soft: true }));
        kids.push(h('div.board-pic',
          h('img.board-pic__img', { src: c.image.src, alt: c.image.alt || 'The card’s picture' }),
          alt,
          h('div.board-pic__row',
            h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'img-replace' }, disabled: S.imgBusy ? true : null, onclick: pick }, icon('image'), h('span', { text: 'Replace' })),
            h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'img-remove' }, onclick: () => removeImage(c.id) }, icon('trash'), h('span', { text: 'Remove' })),
            h('span.board-pic__small', { text: `${c.image.w}×${c.image.h} · ${kbOf(c.image.src.length)}` }))));
      } else {
        kids.push(h('div.board-pic__drop',
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'img-add' }, disabled: S.imgBusy ? true : null, onclick: pick }, icon('image'), h('span', { text: 'Add a picture' })),
          h('span.board-pic__small', { text: 'Or paste or drop one here. It’s made smaller and saved with this board, on this device.' })));
      }
      kids.push(h('div.board-pic__err', { role: 'alert', text: S.imgErr || '' }));
      /* nearly full: said here before anything is refused (#36) */
      const sp = picSpace();
      const near = sp.share >= IMAGE_WARN;
      if (near) {
        kids.unshift(h('div.board-pic__warn', { dataset: { fk: 'pic-warn' } }, icon('alert'), h('span', {
          text: sp.tight === 'device'
            ? `This device’s storage for StaticOS is ${Math.round(sp.share * 100)}% full, so a big picture may not fit. Remove pictures you don’t need first.`
            : `Board pictures are ${Math.round(sp.share * 100)}% full (${kbOf(sp.used)} of ${kbOf(MAX.imageTotal)}). Remove pictures you don’t need to make room.`,
        })));
      }
      return sec('pic', 'Picture', sp.used ? h('small', { class: near ? 'is-warn' : '', text: `Board pictures: ${kbOf(sp.used)} of ${kbOf(MAX.imageTotal)}` }) : null, ...kids);
    }

    function checklistSec(c, sec) {
      const total = c.checklist.length;
      const done = c.checklist.filter(i => i.done).length;
      const ul = h('ul.board-cl');
      for (const it of c.checklist) {
        let settled = false;
        const text = h('input.board-cl__text', { type: 'text', value: it.text, maxlength: String(MAX.item), 'aria-label': `Checklist item: ${it.text}`, dataset: { fk: `cl-text:${it.id}` } });
        /* typing saves as you go; an emptied item goes when you leave it */
        text.addEventListener('input', () => {
          const v = line(text.value, MAX.item);
          if (v) editCard(c.id, card => { const x = card.checklist.find(y => y.id === it.id); if (x) x.text = v; }, { soft: true });
        });
        const settle = (viaBlur, next) => {
          if (settled) return;
          if (line(text.value, MAX.item)) { if (next) { S.focus = next; render(); } return; }
          settled = true;
          removeItem(c.id, it.id, viaBlur);
        };
        text.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); settle(false, 'cl-add'); }
        });
        text.addEventListener('blur', () => { if (!S.rendering) settle(true); });
        ul.append(h('li.board-cl__item', { class: it.done ? 'is-done' : '' },
          h('input.board-cl__check', {
            type: 'checkbox', checked: it.done ? true : null, 'aria-label': `Done: ${it.text}`,
            dataset: { fk: `cl-check:${it.id}` }, onchange: e => toggleItem(c.id, it.id, e.target.checked),
          }),
          text,
          h('button.ibtn.board-cl__del', { type: 'button', 'aria-label': `Remove ${it.text}`, title: 'Remove item', dataset: { fk: `cl-del:${it.id}` }, onclick: () => removeItem(c.id, it.id) }, icon('x'))));
      }
      const addIn = h('input.board-cl__addin', {
        type: 'text', maxlength: String(MAX.item), placeholder: total ? 'Add an item' : 'Add a checklist item', 'aria-label': 'Add a checklist item',
        value: S.drafts.clAdd || null, dataset: { fk: 'cl-add' }, disabled: total >= MAX.check ? true : null,
        oninput: e => { S.drafts.clAdd = e.target.value; },
        onkeydown: e => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const v = e.target.value; e.target.value = ''; S.drafts.clAdd = ''; if (line(v, MAX.item)) addItem(c.id, v); }
          else if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; S.drafts.clAdd = ''; }
        },
      });
      return sec('cl', 'Checklist', total ? h('small', { text: `${done} of ${total} done` }) : null,
        total ? h('div.bar.board-cl__bar', { 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.round(done / total * 100)}%` } })) : null,
        total ? ul : null,
        h('label.board-cl__add', icon('plus'), addIn));
    }

    function linksSec(c, sec) {
      const addBtn = h('button.btn.btn--sm.btn--ghost.board-insp__addlink', {
        type: 'button', 'aria-haspopup': 'menu', dataset: { fk: 'link-add' },
        disabled: c.links.length >= MAX.links ? true : null,
        onclick: e => addLinkMenu(c.id, e),
      }, icon('plus'), h('span', { text: 'Link' }));
      const ul = h('ul.board-links');
      for (const l of c.links) ul.append(linkRow(c, l));
      if (c.forge) {
        ul.append(h('li.board-link.is-pending',
          h('span.board-link__ic', icon('sparkles')),
          h('div.board-link__t',
            h('b', { text: 'Sent to Static Forge' }),
            h('small', { text: `${ago(c.forge.at)} · the game is linked here when Forge saves it` })),
          h('button.ibtn.board-link__rm', {
            type: 'button', 'aria-label': 'Stop waiting for Forge', title: 'Stop waiting',
            onclick: () => { S.focus = 'link-add'; editCard(c.id, card => { card.forge = null; }); },
          }, icon('x'))));
      }
      const kids = [];
      if (ul.childNodes.length) kids.push(ul);
      else if (!S.picker) kids.push(h('p.board-insp__hint', { text: 'Link a note, a mind map, a catalogue game, an Arcade game, a Forge project or a web page.' }));
      if (S.picker) kids.push(pickerView(c));
      return sec('ln', 'Linked', addBtn, ...kids);
    }

    function linkRow(c, l) {
      const i = linkInfo(l);
      const ic = h('span.board-link__ic', { class: i.hue != null ? 'is-hue' : '', style: i.hue != null ? { '--hue': String(i.hue) } : null },
        i.thumb ? h('img', { src: i.thumb, alt: '' }) : icon(i.icon));
      const acts = [];
      if (!i.missing) {
        if (l.kind === 'game' || l.kind === 'arcade') {
          const appId = l.kind === 'game' ? 'aether-games' : 'arcade';
          acts.push(h('button.btn.btn--sm', { type: 'button', 'aria-label': `Play ${i.title}`, disabled: api.getApp(appId) ? null : true, onclick: () => playLink(l) }, icon('play'), h('span', { text: 'Play' })));
        } else if (l.kind === 'project') {
          acts.push(h('button.btn.btn--sm', { type: 'button', 'aria-label': `Open ${i.title} in Forge`, disabled: api.getApp('forge') ? null : true, onclick: () => openProject(l, 'forge') }, icon('sparkles'), h('span', { text: 'Open in Forge' })));
          acts.push(h('button.btn.btn--sm', { type: 'button', 'aria-label': `Open ${i.title} in Studio`, disabled: api.getApp('studio') ? null : true, onclick: () => openProject(l, 'studio') }, icon('code'), h('span', { text: 'Open in Studio' })));
        } else if (l.kind === 'note') {
          acts.push(h('button.btn.btn--sm', { type: 'button', 'aria-label': `Open the note ${i.title}`, disabled: api.getApp('notes') ? null : true, onclick: () => openNote(l) }, icon('note'), h('span', { text: 'Open' })));
        } else if (l.kind === 'mindmap') {
          acts.push(h('button.btn.btn--sm', { type: 'button', 'aria-label': `Open the mind map ${i.title}`, onclick: () => openMindmap(l) }, icon('network'), h('span', { text: 'Open' })));
        } else {
          acts.push(h('a.btn.btn--sm', { href: l.ref, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${i.title} in a new tab` }, icon('external-link'), h('span', { text: 'Open' })));
        }
      }
      return h('li.board-link', { class: i.missing ? 'is-missing' : '' },
        ic,
        h('div.board-link__t', h('b', { text: i.title, title: l.kind === 'url' ? l.ref : i.title }), h('small', { text: i.sub })),
        h('button.ibtn.board-link__rm', { type: 'button', 'aria-label': `Remove link to ${i.title}`, title: 'Remove link', onclick: () => removeLink(c.id, l.id) }, icon('x')),
        acts.length ? h('div.board-link__act', acts) : null);
    }

    /* ---------------- link pickers ---------------- */
    function openPicker(kind) {
      if (!S.openId) return;
      S.picker = { kind, q: '', url: '', label: '', err: '' };
      S.focus = kind === 'game' || kind === 'note' || kind === 'mindmap' ? 'pick-q' : kind === 'url' ? 'pick-url' : '@.board-pick__item:not([disabled])';
      if (kind === 'project') {
        if (!S.projects && !S.projectsErr) S.focus = 'pick-close';
        loadProjects();
      }
      if (kind === 'game') ensureCatalog();
      render();
      revealInPanel(inspEl.querySelector('.board-pick'));
    }
    function revealInPanel(el) {
      const box = inspEl.querySelector('.board-insp__scroll');
      if (!box || !el) return;
      const r = el.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      if (r.bottom > br.bottom) box.scrollTop += Math.min(r.bottom - br.bottom + 12, r.top - br.top - 12);
    }
    function closePicker() {
      S.picker = null;
      S.focus = 'link-add';
      render();
    }
    function pickerKeys(e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...inspEl.querySelectorAll('.board-pick__item:not([disabled])')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (i < 0 && e.key === 'ArrowUp') return;
      e.preventDefault();
      const next = i < 0 ? items[0] : items[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1)];
      next.focus({ preventScroll: false });
    }

    function pickerView(c) {
      const p = S.picker;
      const wrap = h('div.board-pick', { role: 'group', 'aria-label': PICK_TITLE[p.kind], onkeydown: pickerKeys },
        h('div.board-pick__head', h('b', { text: PICK_TITLE[p.kind] }), h('span.grow'),
          h('button.ibtn', { type: 'button', 'aria-label': 'Close picker', title: 'Close', dataset: { fk: 'pick-close' }, onclick: closePicker }, icon('x'))));
      const linked = kind => new Set(c.links.filter(l => l.kind === kind).map(l => l.ref));

      if (p.kind === 'game') {
        const input = h('input', {
          type: 'search', placeholder: 'Search games', 'aria-label': 'Search the games catalogue', autocomplete: 'off', spellcheck: 'false',
          value: p.q || null, dataset: { fk: 'pick-q' },
          oninput: e => { p.q = e.target.value; cancel(searchT); searchT = later(refreshGameResults, 140); },
        });
        p.statusEl = h('div.board-pick__status', { role: 'status', 'aria-live': 'polite' });
        p.listEl = h('div.board-pick__list');
        p.linked = linked('game');
        wrap.append(h('div.field.board-pick__search', icon('search'), input), p.statusEl, p.listEl);
        renderGameResults();
      } else if (p.kind === 'arcade') {
        const have = linked('arcade');
        wrap.append(h('div.board-pick__list', ARCADE.map(g => pickItem({
          id: g.id, title: g.title, sub: g.blurb, ic: icon(g.icon), hue: g.hue, linked: have.has(g.id),
          onPick: () => addLink(c.id, { kind: 'arcade', ref: g.id, title: g.title }),
        }))));
      } else if (p.kind === 'project') {
        const list = h('div.board-pick__list');
        if (S.projectsErr) {
          list.append(h('p.board-pick__note', { text: `Forge projects couldn’t be read on this device (${S.projectsErr}).` }));
        } else if (!Array.isArray(S.projects)) {
          list.append(h('div.board-pick__wait', h('div.spinner'), h('span', { text: 'Reading Forge projects…' })));
        } else if (!S.projects.length) {
          list.append(h('p.board-pick__note', { text: 'No Forge projects on this device yet. Make a game in Static Forge and it can be linked here.' }));
          if (api.getApp('forge')) list.append(h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('forge') }, icon('sparkles'), h('span', { text: 'Open Static Forge' })));
        } else {
          const have = linked('project');
          for (const pr of S.projects) {
            list.append(pickItem({
              id: pr.id, title: pr.name, sub: `Edited ${ago(pr.updatedAt || Date.now())}${pr.published ? ' · Published' : ''}`,
              ic: icon('sparkles'), thumb: linkInfo({ kind: 'project', ref: pr.id }).thumb, linked: have.has(pr.id),
              onPick: () => addLink(c.id, { kind: 'project', ref: pr.id, title: pr.name }),
            }));
          }
        }
        wrap.append(list);
      } else if (p.kind === 'note' || p.kind === 'mindmap') {
        /* notes from Static Notes; mind maps are .mindmap files anywhere in your folders */
        const isNote = p.kind === 'note';
        const have = linked(p.kind);
        const all = isNote
          ? allNotes().sort((a, z) => String(z.mtime || '').localeCompare(String(a.mtime || ''))).map(n => ({ id: n.id, title: line(n.title, MAX.linkTitle) || 'Untitled note', sub: n.mtime ? `Edited ${fmt.fmtAgo(n.mtime)}` : '' }))
          : mindMaps().map(m => ({ id: m.path, title: m.name, sub: api.vfs.parentPath(m.path).replace(api.vfs.HOME, '~') }));
        const listEl = h('div.board-pick__list');
        const paintList = () => {
          clear(listEl);
          const q = fold(p.q).trim();
          const hits = all.filter(x => !q || fold(x.title).includes(q)).slice(0, 40);
          if (!all.length) listEl.append(h('p.board-pick__note', { text: isNote ? 'No notes yet. Write one in Static Notes and it can be linked here.' : 'No mind maps in your folders yet. Make one in Mind Maps and save it.' }));
          else if (!hits.length) listEl.append(h('p.board-pick__note', { text: `Nothing matches “${p.q}”.` }));
          for (const x of hits) listEl.append(pickItem({ id: x.id, title: x.title, sub: x.sub, ic: icon(isNote ? 'note' : 'network'), linked: have.has(x.id), onPick: () => addLink(c.id, { kind: p.kind, ref: x.id, title: x.title }) }));
        };
        const input = h('input', {
          type: 'search', placeholder: isNote ? 'Search notes' : 'Search mind maps', 'aria-label': isNote ? 'Search your notes' : 'Search your mind maps', autocomplete: 'off', spellcheck: 'false',
          value: p.q || null, dataset: { fk: 'pick-q' }, oninput: e => { p.q = e.target.value; paintList(); },
        });
        wrap.append(h('div.field.board-pick__search', icon('search'), input), listEl);
        paintList();
      } else if (p.kind === 'url') {
        const err = h('div.board-pick__err', { role: 'alert', text: p.err || '' });
        const url = h('input', {
          type: 'url', inputmode: 'url', placeholder: 'https://…', 'aria-label': 'Web address (https)', autocomplete: 'off', spellcheck: 'false',
          value: p.url || null, dataset: { fk: 'pick-url' },
          oninput: e => { p.url = e.target.value; if (p.err) { p.err = ''; err.textContent = ''; } },
        });
        const label = h('input', {
          type: 'text', placeholder: 'Label (optional)', 'aria-label': 'Link label', maxlength: String(MAX.linkTitle),
          value: p.label || null, dataset: { fk: 'pick-label' },
          oninput: e => { p.label = e.target.value; },
        });
        const submit = () => {
          const u = httpsUrl(url.value);
          if (!u) {
            p.err = /^\s*http:/i.test(url.value) ? 'Only secure https:// links can be added.' : 'That doesn’t look like a web address.';
            err.textContent = p.err;
            url.focus();
            return;
          }
          addLink(c.id, { kind: 'url', ref: u, title: line(label.value, MAX.linkTitle) });
        };
        const onEnter = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } };
        url.addEventListener('keydown', onEnter);
        label.addEventListener('keydown', onEnter);
        wrap.append(
          h('div.field', icon('globe'), url),
          h('div.field', icon('tag'), label),
          err,
          h('div.board-pick__row',
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: submit }, icon('link'), h('span', { text: 'Add link' })),
            h('span.board-pick__small', { text: 'Opens in a new tab, only when clicked.' })));
      }
      return wrap;
    }

    function pickItem({ id, title, sub, ic, hue, thumb, linked, onPick }) {
      return h('button.board-pick__item', {
        type: 'button', disabled: linked ? true : null, dataset: { fk: `pick:${id}` },
        'aria-label': linked ? `${title}, already linked` : `Link ${title}`,
        onclick: onPick,
      },
        h('span.board-pick__ic', { class: hue != null ? 'is-hue' : '', style: hue != null ? { '--hue': String(hue) } : null }, thumb ? h('img', { src: thumb, alt: '' }) : ic),
        h('span.board-pick__t', h('b', { text: title }), sub ? h('small', { text: sub }) : null),
        linked ? h('span.board-pick__tag', { text: 'Linked' }) : null);
    }

    let searchT = 0, qT = 0;
    let catP = null;
    /** Load the catalogue once; awaiting it twice waits on the same load. */
    function ensureCatalog() {
      if (S.cat.state === 'ready') return Promise.resolve();
      return catP || (catP = loadCatalog());
    }
    async function loadCatalog() {
      S.cat = { state: 'loading' };
      try {
        const G = await import('../portal/games.data.js');
        await G.load();            /* never rejects: falls back to the built-in shelf */
        if (S.dead) return;
        S.cat = { state: 'ready', G, fallback: !!G.loadError(), total: G.all().length };
      } catch (err) {
        if (S.dead) return;
        S.cat = { state: 'error', err: String((err && err.message) || err) };
        catP = null;               /* a later open may try again */
      }
      refreshGameResults();
    }
    /* from a search keystroke or the catalogue arriving: repaint just the results */
    function refreshGameResults() {
      const p = S.picker;
      if (!p || p.kind !== 'game' || !p.listEl || !p.listEl.isConnected) return;
      paint(renderGameResults);
    }
    /* builds into p.listEl whether or not it is in the document yet (pickerView
       calls this while the panel is still being put together) */
    function renderGameResults() {
      const p = S.picker;
      if (!p || p.kind !== 'game' || !p.listEl) return;
      clear(p.listEl);
      if (S.cat.state === 'error') {
        p.statusEl.textContent = `The games catalogue couldn’t be loaded (${S.cat.err}).`;
        return;
      }
      if (S.cat.state !== 'ready') {
        p.statusEl.textContent = '';
        p.listEl.append(h('div.board-pick__wait', h('div.spinner'), h('span', { text: 'Loading the games catalogue…' })));
        return;
      }
      const G = S.cat.G;
      const q = String(p.q || '').trim();
      const res = q ? G.query({ q, perPage: 30 }) : G.query({ category: 'featured', perPage: 12 });
      const n = S.cat.total.toLocaleString();
      const shelf = S.cat.fallback ? 'The full catalogue couldn’t load, so this searches the built-in shelf only. ' : '';
      p.statusEl.textContent = q
        ? `${shelf}${res.total ? `${res.total.toLocaleString()} ${res.total === 1 ? 'match' : 'matches'}${res.total > res.items.length ? `, showing ${res.items.length}` : ''}` : `No games match “${q}”.`}`
        : `${shelf}Featured games — search all ${n}.`;
      for (const g of res.items) {
        const cat = Array.isArray(g.cats) ? g.cats.find(x => x !== 'featured') : '';
        p.listEl.append(pickItem({
          id: g.id, title: g.title, sub: [g.studio, cat].filter(Boolean).join(' · '), ic: icon('gamepad'), linked: p.linked && p.linked.has(g.id),
          onPick: () => addLink(S.openId, { kind: 'game', ref: g.id, title: g.title }),
        }));
      }
    }

    /* ==================================================================== */
    /*  drag and drop (mouse) — keyboard/touch use the card menu            */
    /* ==================================================================== */
    let mark = null;
    function setMark(el, cls) {
      if (mark && mark.el === el && mark.cls === cls) return;
      if (mark) mark.el.classList.remove(mark.cls);
      mark = el ? { el, cls } : null;
      if (el) el.classList.add(cls);
    }
    function onDragStart(e) {
      if (S.dead) return;
      const t = e.target;
      const card = t && t.closest ? t.closest('.board-card') : null;
      if (card && colsEl.contains(card)) {
        const loc = locate(card.dataset.card);
        if (!loc) return;
        S.drag = { type: 'card', id: loc.card.id };
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', loc.card.title); } catch (err) { /* old browsers */ }
        frame(() => { if (S.drag && S.drag.id === loc.card.id) card.classList.add('is-dragging'); });
        appEl.classList.add('is-dragging-card');
        return;
      }
      const head = t && t.closest ? t.closest('.board-col__head') : null;
      if (head && !S.renamingCol) {
        const colNode = head.closest('.board-col');
        const b = activeBoard();
        const col = b && b.cols.find(c => c.id === colNode.dataset.col);
        if (!col) return;
        S.drag = { type: 'col', id: col.id };
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', col.name); e.dataTransfer.setDragImage(colNode, 24, 16); } catch (err) { /* old browsers */ }
        frame(() => { if (S.drag && S.drag.id === col.id) colNode.classList.add('is-dragging'); });
      }
    }
    /* picture files dragged in from the computer: onto a column makes a picture card */
    const hasFiles = e => { try { return [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files'); } catch (err) { return false; } };
    const droppedImage = e => [...(e.dataTransfer && e.dataTransfer.files || [])].find(f => IMAGE_TYPES.includes(f.type)) || null;
    function fileOver(e) {
      const colNode = e.target && e.target.closest ? e.target.closest('.board-col') : null;
      if (!colNode) { setMark(null); return; }
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* read-only in some browsers */ }
      setMark(colNode, 'is-filedrop');
    }
    function fileDrop(e) {
      const colNode = e.target && e.target.closest ? e.target.closest('.board-col') : null;
      setMark(null);
      if (!colNode) return;
      e.preventDefault();
      const f = droppedImage(e);
      if (!f) { tell('That isn’t a picture', 'Only PNG, JPEG, WebP or GIF pictures can be dropped on a column.', 'alert'); return; }
      addImageCard(colNode.dataset.col, f);
    }
    function onDragOver(e) {
      if (S.dead) return;
      if (!S.drag) { if (hasFiles(e)) fileOver(e); return; }
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* read-only in some browsers */ }
      if (S.drag.type === 'card') cardOver(e); else colOver(e);
    }
    function cardOver(e) {
      const colNode = e.target && e.target.closest ? e.target.closest('.board-col') : null;
      if (!colNode) { S.drop = null; setMark(null); return; }
      const list = colNode.querySelector('.board-col__list');
      const cards = [...list.querySelectorAll(':scope > .board-card')].filter(n => n.dataset.card !== S.drag.id);
      let idx = cards.length;
      for (let k = 0; k < cards.length; k++) {
        const r = cards[k].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { idx = k; break; }
      }
      const colId = colNode.dataset.col;
      const loc = locate(S.drag.id);
      const dest = loc && loc.board.cols.find(c => c.id === colId);
      if (!dest) { S.drop = null; setMark(null); return; }
      /* where that is in the whole column (a filter can hide cards between the ones shown) */
      const ids = dest.cards.map(c => c.id).filter(x => x !== S.drag.id);
      const at = idx < cards.length ? ids.indexOf(cards[idx].dataset.card) : cards.length ? ids.indexOf(cards[cards.length - 1].dataset.card) + 1 : ids.length;
      if (loc.col.id === colId && loc.i === at) { S.drop = null; setMark(null); return; }   /* would land where it is */
      S.drop = { col: colId, idx: at };
      if (!cards.length) setMark(list, 'is-dropin');
      else if (idx < cards.length) setMark(cards[idx], 'is-dropbefore');
      else setMark(cards[cards.length - 1], 'is-dropafter');
    }
    function colOver(e) {
      const b = activeBoard();
      if (!b) return;
      const others = [...colsEl.querySelectorAll(':scope > .board-col')].filter(n => n.dataset.col !== S.drag.id);
      let idx = others.length;
      for (let k = 0; k < others.length; k++) {
        const r = others[k].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) { idx = k; break; }
      }
      if (b.cols.findIndex(c => c.id === S.drag.id) === idx || !others.length) { S.drop = null; setMark(null); return; }
      S.drop = { idx };
      if (idx < others.length) setMark(others[idx], 'is-colbefore');
      else setMark(others[others.length - 1], 'is-colafter');
    }
    function onDragLeave(e) {
      if (!S.drag) { if (!e.relatedTarget || !colsEl.contains(e.relatedTarget)) setMark(null); return; }
      if (!e.relatedTarget || !colsEl.contains(e.relatedTarget)) { S.drop = null; setMark(null); }
    }
    function endDrag() {
      setMark(null);
      colsEl.querySelectorAll('.is-dragging').forEach(n => n.classList.remove('is-dragging'));
      appEl.classList.remove('is-dragging-card');
      S.drag = null;
      S.drop = null;
      if (S.dirty) { S.dirty = false; render(); }
    }
    function onDrop(e) {
      if (!S.drag) { if (hasFiles(e)) fileDrop(e); return; }
      e.preventDefault();
      const drag = S.drag;
      const drop = S.drop;
      endDrag();
      if (!drop) return;
      if (drag.type === 'card') {
        if (!moveCardTo(drag.id, drop.col, drop.idx)) return;
        commit();
        announceSpot(drag.id);
      } else {
        const b = activeBoard();
        const from = b ? b.cols.findIndex(c => c.id === drag.id) : -1;
        if (from < 0) return;
        const [col] = b.cols.splice(from, 1);
        const to = clamp(drop.idx, 0, b.cols.length);
        b.cols.splice(to, 0, col);
        touchBoard(b);
        commit();
        say(`Moved the column ${col.name} to position ${to + 1} of ${b.cols.length}`);
      }
    }
    function onContextMenu(e) {
      const t = e.target;
      if (!t || !t.closest || t.closest('input, textarea')) return;
      const card = t.closest('.board-card');
      if (card) { e.preventDefault(); cardMenu(card.dataset.card, e, card); return; }
      const col = t.closest('.board-col');
      if (col && t.closest('.board-col__head')) { e.preventDefault(); colMenu(col.dataset.col, e, t.closest('.board-col__head')); }
    }

    /* ==================================================================== */
    /*  keyboard                                                            */
    /* ==================================================================== */
    const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    function focusFrom(btn, dir) {
      const list = btn.closest('.board-col__list');
      const cards = [...list.querySelectorAll('.board-card__open')];
      const i = cards.indexOf(btn);
      let el = null;
      if (dir === 'up') el = i > 0 ? cards[i - 1] : list.closest('.board-col').querySelector('.board-col__addin');
      else if (dir === 'down') el = cards[i + 1] || null;
      else {
        const cols = [...colsEl.querySelectorAll(':scope > .board-col')];
        const target = cols[cols.indexOf(btn.closest('.board-col')) + (dir === 'left' ? -1 : 1)];
        if (target) {
          const tc = [...target.querySelectorAll('.board-card__open')];
          el = tc[Math.min(i, tc.length - 1)] || target.querySelector('.board-col__addin');
        }
      }
      if (el) { el.focus({ preventScroll: true }); revealEl(el); }
    }
    function cardKeys(e, btn) {
      const id = btn.dataset.card;
      const dir = DIRS[e.key];
      const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      if ((e.key === 'Enter' || e.key === ' ') && plain) { e.preventDefault(); if (!e.repeat) openCard(id, 'key'); return; }
      if (dir && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); moveCard(id, dir); return; }
      if (dir && plain) { e.preventDefault(); focusFrom(btn, dir); return; }
      if ((e.key === 'Home' || e.key === 'End') && plain) {
        const all = btn.closest('.board-col__list').querySelectorAll('.board-card__open');
        const el = e.key === 'Home' ? all[0] : all[all.length - 1];
        if (el) { e.preventDefault(); el.focus({ preventScroll: true }); revealEl(el); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && plain) { e.preventDefault(); deleteCard(id); return; }
      if (e.key === 'F2' && plain) { e.preventDefault(); openCard(id, 'key'); return; }
      if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); cardMenu(id, null, btn.closest('.board-card')); }
    }
    function onKey(e) {
      if (S.dead || e.defaultPrevented) return;
      const t = e.target;
      if (e.key === 'Escape') {
        if (S.sharePanel && (inspEl.contains(t) || colsEl.contains(t))) { e.preventDefault(); closeSharePanel(); return; }
        if (S.archiveOpen && (inspEl.contains(t) || colsEl.contains(t))) { e.preventDefault(); closeArchive(); return; }
        if (S.picker && inspEl.contains(t)) { e.preventDefault(); closePicker(); return; }
        if (S.openId && (inspEl.contains(t) || (colsEl.contains(t) && !t.closest('input')))) { e.preventDefault(); closeInsp(true); }
        return;
      }
      const btn = t && t.closest ? t.closest('.board-card__open') : null;
      if (btn && colsEl.contains(btn)) cardKeys(e, btn);
    }

    /* ==================================================================== */
    /*  render                                                              */
    /* ==================================================================== */
    /* Rebuild part of the UI with focus kept. While it runs, blurs caused by our
       own DOM swaps are ignored (S.rendering), and a render asked for from inside
       a render is run once afterwards instead of nesting. */
    function paint(fn) {
      if (S.rendering) { fn(); return; }
      S.rendering = true;
      try { withFocus(fn); } finally { S.rendering = false; }
    }
    function render() {
      if (S.dead) return;
      if (S.drag) { S.dirty = true; return; }       /* never pull the DOM out from under a drag */
      if (S.rendering) { S.again = true; return; }
      paint(() => {
        const b = activeBoard();
        if (!S.data.boards.length && !S.addingBoard) S.pane = 'board';
        appEl.classList.toggle('is-narrow', S.narrow);
        appEl.classList.toggle('show-boards', S.narrow && S.pane === 'boards');
        appEl.classList.toggle('has-board', !!b);
        renderSide();
        renderBar();
        if (!b) {
          S.openId = null;
          S.picker = null;
          S.shownBoard = null;
          clear(colsEl);
          colsEl.hidden = true;
          emptyEl.hidden = false;
          renderEmpty();
        } else {
          emptyEl.hidden = true;
          colsEl.hidden = false;
          renderCols(b);
        }
        renderInsp();
      });
      if (S.again) { S.again = false; render(); }
    }
    /* after the pointer lifts, so a click that caused a blur-commit still lands */
    function renderSoon() {
      if (S.ptrDown) {
        S.renderOnUp = true;
        /* a release outside the page never reaches us — don't wait forever */
        later(() => { if (S.renderOnUp) { S.renderOnUp = false; S.ptrDown = false; render(); } }, 1500);
        return;
      }
      render();
    }
    /* data changed underneath (projects loaded): repaint without yanking a text
       field, and not in the middle of someone's click */
    function softRefresh() {
      if (S.dead) return;
      const a = document.activeElement;
      const typing = a && inspEl.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'radio'));
      if (!typing) { renderSoon(); return; }
      const b = activeBoard();
      if (b && !S.drag && !S.ptrDown) paint(() => renderCols(b));
    }

    /* ---------------- events we own ---------------- */
    const offs = [];
    const listen = (el, type, fn, o) => { el.addEventListener(type, fn, o); offs.push(() => el.removeEventListener(type, fn, o)); };
    listen(root, 'keydown', onKey);
    listen(colsEl, 'dragstart', onDragStart);
    listen(colsEl, 'dragover', onDragOver);
    listen(colsEl, 'dragleave', onDragLeave);
    listen(colsEl, 'drop', onDrop);
    listen(colsEl, 'dragend', endDrag);
    listen(colsEl, 'contextmenu', onContextMenu);
    /* the open card takes a pasted or dropped picture */
    listen(inspEl, 'paste', e => {
      if (!S.openId || S.imgBusy) return;
      const f = [...(e.clipboardData && e.clipboardData.files || [])].find(x => IMAGE_TYPES.includes(x.type));
      if (!f) return;
      e.preventDefault();
      setImage(S.openId, f);
    });
    listen(inspEl, 'dragover', e => {
      if (S.drag || !S.openId || !hasFiles(e)) return;
      e.preventDefault();
      inspEl.classList.add('is-filedrop');
    });
    listen(inspEl, 'dragleave', e => { if (!e.relatedTarget || !inspEl.contains(e.relatedTarget)) inspEl.classList.remove('is-filedrop'); });
    listen(inspEl, 'drop', e => {
      inspEl.classList.remove('is-filedrop');
      if (S.drag || !S.openId || !hasFiles(e)) return;
      e.preventDefault();
      const f = droppedImage(e);
      if (!f) { tell('That isn’t a picture', 'Only PNG, JPEG, WebP or GIF pictures can go on a card.', 'alert'); return; }
      if (!S.imgBusy) setImage(S.openId, f);
    });
    listen(root, 'pointerdown', () => { S.ptrDown = true; }, true);
    const onUp = () => {
      S.ptrDown = false;
      if (S.renderOnUp) { S.renderOnUp = false; later(render, 0); }
    };
    listen(window, 'pointerup', onUp, true);
    listen(window, 'pointercancel', onUp, true);

    offs.push(bus.on('projects:change', projectsChanged));
    offs.push(store.sub(STORE_KEY, v => {
      if (S.dead || v === lastSaved) return;       /* our own write coming back */
      cancel(saveT); saveT = 0;
      S.data = normalize(v);
      if (S.openId && !locate(S.openId)) { S.openId = null; S.picker = null; }
      if (S.share && !S.data.boards.some(b => b.id === S.share.boardId) && S.share.boardId) stopShare('deleted');
      else shareLocal();
      renderSoon();
    }));

    /* ---------------- responsive: the real painted width ---------------- */
    let ro = null;
    function measure() {
      const aw = appEl.clientWidth;
      if (!aw) return;
      const narrow = aw < NARROW;
      const overlay = narrow || (mainEl.clientWidth || aw) < DOCK_MIN;
      appEl.classList.toggle('insp-overlay', overlay);
      if (narrow !== S.narrow) { S.narrow = narrow; render(); }
    }
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => { if (!S.dead) measure(); });
      ro.observe(appEl);
      ro.observe(mainEl);
    } else {
      S.narrow = (win && win.w ? win.w : 1000) < NARROW;
      appEl.classList.toggle('insp-overlay', true);
    }

    /* ---------------- opening with something to do ---------------- */
    function addFromOutside(a) {
      const title = line(a.title, MAX.title);
      if (!title) return;
      let b = activeBoard();
      if (!b) {
        if (S.data.boards.length >= MAX.boards) return;
        b = normBoard({ name: 'My board', cols: DEFAULT_COLS.map(n => ({ name: n })) });
        S.data.boards.push(b);
        S.data.activeId = b.id;
      }
      if (!b.cols.length) b.cols.push(normCol({ name: DEFAULT_COLS[0] }));
      const col = b.cols[0];
      if (col.cards.length >= MAX.cards) { tell('This column is full', `A column holds up to ${MAX.cards} cards.`, 'alert'); return; }
      const card = normCard({ title, notes: typeof a.notes === 'string' ? a.notes : '', links: a.link ? [a.link] : [] });
      col.cards.splice(pinCount(col), 0, card);
      touchBoard(b);
      S.openId = card.id;
      S.picker = null;
      S.pane = 'board';
      S.focus = 'insp-panel';
      commit();
      say(`Added ${title} to ${col.name}`);
    }
    function handleOpts(o) {
      if (!o || typeof o !== 'object' || S.dead) return;
      flushPersist();
      if (typeof o.boardJoin === 'string') { if (!S.share) openShare('guest', o.boardJoin); else openShare(S.share.role); return; }
      if (typeof o.board === 'string' && S.data.boards.some(b => b.id === o.board)) {
        S.data.activeId = o.board;
        S.openId = null;
        S.picker = null;
        S.pane = 'board';
        persist();
      }
      if (o.add && typeof o.add === 'object') { addFromOutside(o.add); return; }
      if (typeof o.card === 'string') {
        const where = findAnywhere(o.card);
        if (where) {
          S.data.activeId = where.board.id;
          S.openId = o.card;
          S.picker = null;
          S.pane = 'board';
          persist();
        }
      }
      render();
    }
    if (win && typeof win.onReopen === 'function') win.onReopen(handleOpts);

    /* first paint, then anything we were opened with */
    measure();
    render();
    if (opts && (opts.add || opts.board || opts.card || opts.boardJoin)) handleOpts(opts);
    if (hasProjectRefs()) loadProjects();   /* names, deleted projects, and cards waiting on Forge */

    /* ---------------- teardown ---------------- */
    return () => {
      if (S.dead) return;
      flushPersist();
      S.dead = true;
      if (ro) { try { ro.disconnect(); } catch (e) { /* already gone */ } ro = null; }
      offs.splice(0).forEach(off => { try { off(); } catch (e) { /* already gone */ } });
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const f of frames) cancelAnimationFrame(f);
      frames.clear();
      S.drag = null;
      S.picker = null;
      if (printEl) { printEl.remove(); document.documentElement.classList.remove('board-printing'); }
      stopShare('closed');
    };
  },
});
