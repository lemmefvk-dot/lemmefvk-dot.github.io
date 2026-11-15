/* ============================================================
   study/cards.js — the Flashcards tab of Static Study.

   Decks in the sidebar; a deck page to add, edit, import and export
   cards; a study session (Space flips, 1–4 grade, E edits the card,
   R reads it aloud); a cram session that shuffles every card and
   leaves the schedule and the stats alone; and a stats page drawn
   only from the cards and the review log (js/core/flashcards.js says
   how scheduling works, and how cloze and reverse cards are made).

   A card can be plain (front -> back), go both ways (a reverse card
   is made too, scheduled on its own) or be a cloze text: "The
   {{mitochondria}} makes ATP" makes one card per gap. Cards carry
   tags; a deck can be studied by tag, and the cards you keep getting
   wrong are listed so you can practise just those. A deck brings in
   at most its "new cards a day" (20 unless changed).

   Sharing a deck: the cards (text and tags, no pictures, no
   schedules) are packed into a link (core/sharelink.js packLink,
   #deck=). Opening one shows what is in it; nothing is added until
   the person presses Add, and then as new cards in a new deck.
   ============================================================ */
import * as FC from '../core/flashcards.js';
import * as media from '../core/media.js';
import * as speech from '../core/speech.js';
import * as VOC from '../core/vocab.js';
import { store } from '../core/store.js';
import { vfs } from '../core/vfs.js';

const GRADE_LABEL = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const PREFS_KEY = 'portal.cardPrefs';           /* { autoRead } — this person's, like every store key */
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const prefs = () => { const p = store.get(PREFS_KEY); return { autoRead: !!(p && p.autoRead) }; };

export function dueText(card, now = Date.now()) {
  if (card.due === null) return 'New';
  const d = FC.daysBetween(FC.today(now), card.due);
  if (d <= 0) return d === 0 ? 'Due today' : `Overdue ${plural(-d, 'day')}`;
  return d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
}

/** Cards from a note: "term :: definition" lines, two-column table rows, and lines with {{gaps}}. -> TSV text */
export function noteToText(blocks, NF) {
  const lines = [];
  const HEAD = /^(front|question|term|word)$/i;
  let prevRow = false;
  for (const b of blocks || []) {
    if (b.t === 'row') {
      const cells = NF.cellsOf(b).map(c => NF.runsText(c).replace(/\s+/g, ' ').trim());
      const first = !prevRow;
      prevRow = true;
      if (first && HEAD.test(cells[0] || '')) continue;              /* a table's header row */
      if (cells[0] && cells[1]) lines.push(`${cells[0]}\t${cells[1]}`);
      continue;
    }
    prevRow = false;
    if (!['p', 'ul', 'ol', 'check', 'quote', 'h1', 'h2', 'h3'].includes(b.t)) continue;
    const t = NF.runsText(b.runs).replace(/\s+/g, ' ').trim();
    const m = /^(.+?)\s*::\s*(.+)$/.exec(t);
    if (m) lines.push(`${m[1].trim()}\t${m[2].trim()}`);
    else if (FC.hasCloze(t)) lines.push(`${t}\t`);
  }
  return lines.join('\n');
}
/** A table copied from a document or a web page, as tab-separated rows (its first two columns), or '' when there is none. */
export function tableToText(html) {
  if (typeof DOMParser !== 'function' || !/<table/i.test(html || '')) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('td,th')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
    if (cells.length >= 2 && (cells[0] || cells[1])) rows.push(`${cells[0]}\t${cells[1]}`);
  }
  return rows.join('\n');
}

export function mountCards(host, ctx) {
  const { api, win, isActive } = ctx;
  const { h, icon, clear, confirm, menu } = api;
  const S = {
    data: FC.read(), deckId: '', view: 'deck',     /* 'deck' | 'study' | 'stats' | 'import' | 'shared' */
    session: null, add: { front: '', back: '', img: '', tags: '', reverse: false }, editing: null, picker: false, addNote: '',
    imp: { target: '', name: '', text: '', file: '', sep: 'auto', from: '' }, impNote: '', dead: false, spoke: false,
    tag: '', shared: null, voices: false, hit: '',
  };
  const urls = new Map();

  const deck = () => S.data.decks.find(d => d.id === S.deckId) || null;
  if (!S.deckId && S.data.decks[0]) S.deckId = S.data.decks[0].id;

  function mutate(fn) {
    const data = FC.read();
    const r = fn(data);
    S.data = FC.write(data);
    return r;
  }
  const mutDeck = fn => mutate(data => { const d = data.decks.find(x => x.id === S.deckId); return d ? fn(d, data) : null; });
  const freeName = (base, decks) => { let n = base; for (let k = 2; decks.some(d => d.name === n) && k < 99; k++) n = `${base} ${k}`.slice(0, 60); return n; };

  /* ---------- deck actions ---------- */
  function newDeck(name) {
    const nm = String(name || '').trim();
    if (!nm) return;
    const id = mutate(data => { const d = FC.normDeck({ name: nm }); if (data.decks.length >= FC.MAX_DECKS) return ''; data.decks.push(d); return d.id; });
    if (id) { S.deckId = id; S.view = 'deck'; S.session = null; S.naming = false; S.tag = ''; }
    render();
  }
  function renameDeck(name) {
    const nm = String(name || '').trim();
    S.renaming = false;
    if (nm) mutDeck(d => { d.name = nm.slice(0, 60); });
    render();
  }
  async function deleteDeck() {
    const d = deck();
    if (!d) return;
    const ok = await confirm({ title: 'Delete this deck?', message: `“${d.name}” and its ${plural(d.cards.length, 'card')}, with their schedules, are removed from this device. Your review history stays. This can’t be undone.`, ok: 'Delete', danger: true });
    if (!ok || S.dead) return;
    mutate(data => { data.decks = data.decks.filter(x => x.id !== d.id); });
    S.deckId = S.data.decks[0] ? S.data.decks[0].id : '';
    S.view = 'deck'; S.session = null; S.tag = '';
    render();
  }
  function setNewPerDay(input) {
    const d = deck();
    const n = Math.floor(Number(input.value));
    if (!d) return;
    if (!Number.isFinite(n) || n < 0 || String(input.value).trim() === '') { input.value = String(d.newPerDay); return; }
    /* the redraw takes the field away, which can send its change once more: only a real change redraws */
    if (Math.min(FC.MAX_NEW_PER_DAY, n) === d.newPerDay) return;
    mutDeck(x => { x.newPerDay = Math.min(FC.MAX_NEW_PER_DAY, n); });
    render();
  }
  function addCard() {
    const f = S.add.front.trim(), b = S.add.back.trim();
    const cz = FC.hasCloze(f);
    if (!f && !S.add.img) { S.addNote = 'Write the front of the card (or pick a picture).'; render(); return; }
    if (!b && !cz) { S.addNote = 'Write the back of the card.'; render(); return; }
    const made = FC.makeCards({ front: f, back: b, img: S.add.img, tags: S.add.tags, reverse: S.add.reverse && !cz });
    const full = mutDeck(d => {
      if (d.cards.length + made.length > FC.MAX_CARDS) return true;
      d.cards.push(...made);
      return false;
    });
    S.addNote = full ? `A deck holds up to ${FC.MAX_CARDS} cards.` : '';
    if (!full) {
      S.add = { front: '', back: '', img: '', tags: S.add.tags, reverse: S.add.reverse };
      if (made.length > 1) S.flash = cz ? `Added ${plural(made.length, 'cloze card')}, one for each gap.` : 'Added a card and its reverse.';
    }
    S.picker = false;
    S.focusFront = true;
    render();
  }
  function saveEdit(id, f, b, img, tags, reverse) {
    const front = String(f).trim(), back = String(b).trim();
    const card = (deck() || { cards: [] }).cards.find(c => c.id === id);
    if (!card) { S.editing = null; render(); return true; }
    if (!(front || img) || (!back && !FC.hasCloze(front))) { S.editNote = !back ? 'Write the back of the card.' : 'Write the front of the card.'; render(); return false; }
    const r = mutDeck(d => FC.editCard(d, id, { front, back, img, tags, reverse }));
    if (r && !r.ok) { S.editNote = r.error; render(); return false; }
    S.editing = null; S.editNote = '';
    if (r && (r.added || r.removed)) S.flash = [r.added && `${plural(r.added, 'card')} added`, r.removed && `${plural(r.removed, 'card')} removed`].filter(Boolean).join(', ') + '; the others keep their schedules.';
    render();
    return true;
  }
  function deleteCard(id) {
    mutDeck(d => { d.cards = d.cards.filter(c => c.id !== id); });
    render();
  }
  /* "{{ }}": wrap what is selected in the front in a gap */
  function makeGap(ta) {
    const a = ta.selectionStart, z = ta.selectionEnd, v = ta.value;
    const word = v.slice(a, z);
    ta.value = `${v.slice(0, a)}{{${word || '…'}}}${v.slice(z)}`;
    S.add.front = ta.value;
    ta.focus();
    const at = a + 2;
    ta.setSelectionRange(at, at + (word || '…').length);
    paintAddHints();
  }

  /* ---------- sharing ---------- */
  async function shareDeck() {
    const d = deck();
    if (!d || !d.cards.length) return;
    const L = await import('../core/sharelink.js');
    const r = await L.packLink('deck', FC.packDeck(d));
    if (S.dead) return;
    if (!r.ok) { S.flash = `No link was made: ${r.error}`; render(); return; }
    const field = h('input.st-in.st-linkin', { type: 'text', readonly: true, value: r.link, 'aria-label': 'Link to a copy of the deck', dataset: { fk: 'deck-link' }, onfocus: e => e.target.select() });
    const n = FC.entries(d).length;
    const ok = await confirm({
      title: `Send a copy of “${d.name}”`,
      message: `${plural(n, 'card')} travel inside this link, with their tags: no server keeps them. Pictures and your schedule stay here. Whoever opens it in StaticOS sees the cards first and adds them only if they choose.`,
      body: h('div.field', field), ok: 'Copy link', cancel: 'Close',
    });
    if (!ok || S.dead) return;
    let copied = false;
    try { await navigator.clipboard.writeText(r.link); copied = true; } catch (e) { copied = false; }
    S.flash = copied ? `Link copied. Send it to a classmate: it holds ${plural(n, 'card')}.` : 'Select the link and copy it yourself: the clipboard isn’t available here.';
    render();
  }
  async function openShared(frag) {
    const L = await import('../core/sharelink.js');
    const r = await L.unpackLink('deck', frag);
    const got = r.ok ? FC.unpackDeck(r.data) : null;
    if (S.dead) return;
    S.session = null;
    S.shared = got ? got : { error: r.ok ? 'This link doesn’t hold cards Static Study can read.' : r.error };
    S.view = 'shared';
    render();
  }
  function addShared() {
    const got = S.shared;
    if (!got || got.error) return;
    let id = '';
    const made = mutate(data => {
      if (data.decks.length >= FC.MAX_DECKS) return 0;
      const d = FC.normDeck({ name: freeName(got.name, data.decks) });
      for (const e of got.entries) { const cs = FC.makeCards(e); if (d.cards.length + cs.length > FC.MAX_CARDS) break; d.cards.push(...cs); }
      data.decks.push(d); id = d.id;
      return d.cards.length;
    });
    if (!id) { S.flash = `Static Study holds up to ${FC.MAX_DECKS} decks. Delete one first.`; render(); return; }
    S.deckId = id; S.view = 'deck'; S.shared = null; S.tag = '';
    S.flash = `Added “${deck().name}”: ${plural(made, 'new card')}. They are yours now; changes on either side don’t follow.`;
    render();
  }

  /* ---------- study ---------- */
  function startSession(kind, o = {}) {
    const d = deck();
    if (!d) return;
    const only = o.only || null;
    const queue = o.ids ? FC.shuffled(d.cards.filter(c => o.ids.includes(c.id))) : kind === 'cram' ? FC.shuffled(only ? d.cards.filter(only) : d.cards) : FC.deckQueue(d, Date.now(), only);
    S.session = { kind, deckId: d.id, queue, total: queue.length, flipped: false, reviews: 0, grades: { again: 0, hard: 0, good: 0, easy: 0 }, finished: !queue.length, label: o.label || '', editing: false };
    S.view = 'study';
    speech.stop();
    render();
    autoRead();
  }
  const current = () => {
    const s = S.session, d = s && S.data.decks.find(x => x.id === s.deckId);
    return s && d && !s.finished ? d.cards.find(c => c.id === s.queue[0]) || null : null;
  };
  function flip() {
    const s = S.session;
    if (!s || s.finished || s.flipped || s.editing || !current()) return;
    s.flipped = true;
    render();
    autoRead();
  }
  function grade(g) {
    const s = S.session, c = current();
    if (!s || !c || !s.flipped || s.editing) return;
    if (s.kind === 'review') {
      if (!FC.GRADES.includes(g)) return;
      FC.review(s.deckId, c.id, g);
      S.data = FC.read();
      s.reviews++; s.grades[g]++;
      s.queue.shift();
      if (g === 'again') s.queue.push(c.id);
    } else {
      /* cram: nothing is written */
      s.queue.shift();
      if (g === 'again') s.queue.push(c.id);
      else s.reviews++;
    }
    s.flipped = false;
    if (!s.queue.length) s.finished = true;
    speech.stop();
    render();
    autoRead();
  }
  function endSession() { S.session = null; S.view = 'deck'; speech.stop(); render(); }
  /* the voices chosen for this deck (Vocab or here), else the Settings voice */
  function voiceOpts(side) {
    const v = S.session && VOC.getVoices(S.session.deckId);
    const uri = v && v[side];
    return uri ? { voice: uri } : undefined;
  }
  function readAloud() {
    const c = current();
    if (!c || !speech.supported()) return;
    S.spoke = true;
    const f = FC.faces(c);
    const flipped = S.session.flipped;
    /* the side shown: a reverse card asks with its back */
    const side = (c.kind === 'rev') !== flipped ? 'meaning' : 'term';
    speech.speak(flipped ? [f.aText, f.extra].filter(Boolean).join('. ') : f.qText, voiceOpts(c.kind === 'cloze' ? 'term' : side));
  }
  function autoRead() { if (prefs().autoRead && S.session && !S.session.finished && !S.session.editing) readAloud(); }
  function editInSession() {
    const s = S.session;
    if (!s || s.finished || !current()) return;
    s.editing = true;
    S.focusSessionEdit = true;
    speech.stop();
    render();
  }
  function saveSessionEdit(f, b, tags) {
    const s = S.session, c = current();
    if (!s || !c) return;
    const front = String(f).trim(), back = String(b).trim();
    if (!front || (!back && !FC.hasCloze(front))) { S.editNote = !front ? 'Write the front of the card.' : 'Write the back of the card.'; render(); return; }
    const r = mutDeck(d => FC.editCard(d, c.id, { front, back, tags }));
    if (r && !r.ok) { S.editNote = r.error; render(); return; }
    S.editNote = '';
    s.editing = false;
    /* a gap taken out took its card: it leaves the session too */
    const d = deck();
    s.queue = s.queue.filter(id => d && d.cards.some(x => x.id === id));
    if (!s.queue.length) s.finished = true;
    render();
  }

  /* ---------- import / export ---------- */
  function previewImport() {
    const room = S.imp.target === '' || S.imp.target === 'new' ? FC.MAX_CARDS : FC.MAX_CARDS - ((S.data.decks.find(d => d.id === S.imp.target) || { cards: [] }).cards.length);
    return FC.parseImport(S.imp.text, room, S.imp.sep);
  }
  function doImport() {
    const p = previewImport();
    if (!p.cards.length) { S.impNote = 'No cards found. Each line needs a front and a back, separated by a comma, a tab, “::” or a dash.'; render(); return; }
    let id = S.imp.target;
    let made = false, n = 0, skipped = p.skipped;
    mutate(data => {
      let d = data.decks.find(x => x.id === id);
      if (!d) {
        if (data.decks.length >= FC.MAX_DECKS) return;
        d = FC.normDeck({ name: S.imp.name.trim() || S.imp.file.replace(/\.[^.]+$/, '') || S.imp.from || 'Imported deck' });
        data.decks.push(d); id = d.id; made = true;
      }
      for (const c of p.cards) {
        const cs = FC.makeCards(c);
        if (d.cards.length + cs.length > FC.MAX_CARDS) { skipped++; continue; }
        d.cards.push(...cs); n++;
      }
    });
    S.deckId = id; S.view = 'deck'; S.tag = '';
    S.imp = { target: '', name: '', text: '', file: '', sep: 'auto', from: '' };
    S.impNote = '';
    S.flash = `Imported ${plural(n, 'card')}${made ? ' into a new deck' : ''}${skipped ? `; ${plural(skipped, 'line')} skipped (a side was empty or the deck was full)` : ''}.`;
    render();
  }
  function exportDeck() {
    const d = deck();
    if (!d) return;
    const text = FC.toCSV(d);
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: `${d.name.replace(/[^\w .-]+/g, '_') || 'deck'}.csv` });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    S.flash = `Exported ${plural(FC.entries(d).length, 'card')} as CSV (text only: pictures and schedules aren’t part of the file).`;
    render();
  }
  const liveNotes = () => { const v = store.get('notes'); return (Array.isArray(v) ? v : []).filter(n => n && typeof n === 'object' && n.id && !n.trashed).sort((a, z) => String(z.mtime || '').localeCompare(String(a.mtime || ''))); };
  async function fromNote(id) {
    const n = liveNotes().find(x => x.id === id);
    if (!n) return;
    const NF = await import('../core/notesfmt.js');
    if (S.dead) return;
    const text = noteToText(NF.blocksOf(n), NF);
    S.imp.from = String(n.title || '').trim().slice(0, 60) || 'Note';
    if (!text) { S.impNote = `“${S.imp.from}” has no “term :: definition” lines, two-column tables or {{gaps}} to make cards from.`; render(); return; }
    S.impNote = '';
    S.imp.text = text; S.imp.sep = '\t';
    if (!S.imp.name && S.imp.target === '') S.imp.name = S.imp.from;
    render();
  }

  /* ---------- pictures ---------- */
  function picsList() {
    const pics = [];
    try { vfs.walk(`${vfs.HOME}/Pictures`, (n, p) => { if (n.type === 'file' && media.kindOf(n.name) === 'image' && media.isMedia(n)) pics.push({ n, p }); }); } catch (e) { /* none */ }
    return pics.sort((a, b) => Date.parse(b.n.mtime) - Date.parse(a.n.mtime)).slice(0, 36);
  }
  function thumb(path, cls) {
    const img = h('img', { class: cls, alt: '', draggable: 'false' });
    const hit = urls.get(path);
    if (hit) img.src = hit;
    else media.urlOf(path).then(u => { if (u) { urls.set(path, u); if (!S.dead) img.src = u; } }).catch(() => {});
    return img;
  }
  function picker(onPick) {
    const pics = picsList();
    return h('div.st-pick', { role: 'group', 'aria-label': 'Pictures' },
      pics.length ? pics.map(({ n, p }) => h('button.st-pick__i', { type: 'button', title: n.name, 'aria-label': `Use picture ${n.name}`, onclick: () => onPick(p) }, thumb(p, 'st-pick__img')))
        : h('small.dim', { text: 'There are no pictures in ~/Pictures yet. Take a screenshot or import one in Photos.' }));
  }

  /* ---------- views ---------- */
  const side = h('aside.app__side.st-side', { 'aria-label': 'Decks' });
  const main = h('div.app__main.st-main');
  host.appendChild(h('div.app.st-cards', side, main));

  function renderSide() {
    clear(side);
    const now = Date.now();
    const g = h('div.side__group.st-side__group', h('div.side__label', { text: 'Decks' }));
    for (const d of S.data.decks) {
      const c = FC.counts(d.cards, now);
      const on = !['stats', 'import', 'shared'].includes(S.view) && d.id === S.deckId;
      g.append(h('button.side__item', { type: 'button', class: on ? 'is-on' : '', 'aria-current': on ? 'true' : null, dataset: { deck: d.id },
        onclick: () => { S.deckId = d.id; S.view = 'deck'; S.session = null; S.editing = null; S.picker = false; S.tag = ''; S.voices = false; render(); } },
      icon('layers'), h('span', { text: d.name }), c.due ? h('small', { title: `${plural(c.due, 'card')} due today`, 'aria-label': `${c.due} due`, text: String(c.due) }) : null));
    }
    if (S.naming) {
      const input = h('input.st-in', { type: 'text', maxlength: '60', placeholder: 'Deck name', 'aria-label': 'New deck name', dataset: { fk: 'deck-name' },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); newDeck(e.target.value); } else if (e.key === 'Escape') { S.naming = false; render(); } } });
      S.focusEl = input;
      g.append(h('div.st-side__new', input, h('button.ibtn', { type: 'button', 'aria-label': 'Create deck', onclick: () => newDeck(input.value) }, icon('check'))));
    } else {
      g.append(h('button.side__item.st-side__add', { type: 'button', dataset: { fk: 'new-deck' }, onclick: () => { S.naming = true; render(); } }, icon('plus'), h('span', { text: 'New deck' })));
    }
    side.append(g);
    side.append(h('div.side__group',
      h('button.side__item', { type: 'button', class: S.view === 'import' ? 'is-on' : '', dataset: { fk: 'open-import' }, onclick: () => { S.view = 'import'; S.session = null; render(); } }, icon('upload'), h('span', { text: 'Import cards…' })),
      h('button.side__item', { type: 'button', class: S.view === 'stats' ? 'is-on' : '', dataset: { fk: 'open-stats' }, onclick: () => { S.view = 'stats'; S.session = null; render(); } }, icon('bar-chart'), h('span', { text: 'Stats' }))));
    const all = S.data.decks.flatMap(d => d.cards);
    const c = FC.counts(all, now);
    side.append(h('div.st-side__foot', h('div.side__meter', h('b', { dataset: { fk: 'due-total' }, text: `${c.due} due today` }), h('small', { text: all.length ? `${plural(all.length, 'card')} in ${plural(S.data.decks.length, 'deck')}` : 'No cards yet' })),
      h('div.st-side__note', { text: 'Saved on this device only.' })));
  }

  const bar = (...kids) => h('div.app__bar', ...kids);
  const flashLine = () => (S.flash ? h('div.st-flash', { role: 'status', dataset: { fk: 'flash' } }, icon('check'), h('span', { text: S.flash })) : null);
  /* a side of a card, with a cloze gap marked */
  const segs = list => list.map(x => (x.gap ? h('mark.st-gap', { text: x.t }) : document.createTextNode(x.t)));
  const tagChips = tags => (tags.length ? h('span.st-tags', tags.map(t => h('span.st-tag', { text: `#${t}` }))) : null);

  let addHints = null;
  function paintAddHints() {
    if (!addHints) return;
    const cz = FC.hasCloze(S.add.front);
    clear(addHints.note);
    if (cz) addHints.note.append(h('small.dim', { dataset: { fk: 'add-cloze' }, text: `Cloze: ${plural(FC.clozeNums(S.add.front).length, 'card')}, one for each gap. The back is optional extra text.` }));
    addHints.back.placeholder = cz ? 'Extra (optional): shown with the answer' : 'Back (answer)';
    addHints.rev.disabled = cz;
    addHints.revWrap.classList.toggle('is-off', cz);
  }

  function renderDeck() {
    const d = deck();
    if (!d) {
      main.append(bar(h('div.app__title', { text: 'Flashcards' })),
        h('div.app__content', flashLine(), h('div.empty', icon('layers'), h('b', { text: 'No decks yet' }),
          h('small', { text: 'Make a deck and add cards, or import a CSV or TSV file (front, back). Cards come back on a spaced-repetition schedule.' }),
          h('div.st-row', h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'empty-new' }, onclick: () => { S.naming = true; render(); } }, icon('plus'), h('span', { text: 'New deck' })),
            h('button.btn.btn--sm', { type: 'button', onclick: () => { S.view = 'import'; render(); } }, icon('upload'), h('span', { text: 'Import CSV' }))))));
      return;
    }
    const now = Date.now();
    const c = FC.counts(d.cards, now);
    const queued = FC.deckQueue(d, now).length;
    const title = S.renaming
      ? h('input.st-in.st-rename', { type: 'text', value: d.name, maxlength: '60', 'aria-label': 'Deck name', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); renameDeck(e.target.value); } else if (e.key === 'Escape') { S.renaming = false; render(); } }, ref: el => { S.focusEl = el; } })
      : h('button.app__title.st-title', { type: 'button', title: 'Rename deck', onclick: () => { S.renaming = true; render(); } }, h('span', { text: d.name }));
    main.append(bar(title, h('span.st-spacer'),
      h('button.ibtn', { type: 'button', 'aria-label': 'Deck actions', 'aria-haspopup': 'menu', dataset: { fk: 'deck-menu' }, onclick: e => menu([
        { label: 'Rename deck', icon: 'edit-3', onClick: () => { S.renaming = true; render(); } },
        { label: 'Share by link…', icon: 'link', disabled: !d.cards.length, onClick: shareDeck },
        { label: 'Export as CSV', icon: 'download', disabled: !d.cards.length, onClick: exportDeck },
        { label: 'Voices for read aloud…', icon: 'volume-2', disabled: !speech.supported(), onClick: () => { S.voices = true; render(); } },
        '-', { label: 'Delete deck', icon: 'trash', danger: true, onClick: deleteDeck }], e.clientX, e.clientY) }, icon('more-horizontal'))));

    const content = h('div.app__content.st-scroll');
    const fl = flashLine();
    if (fl) content.append(fl);      /* append(null) would write the word "null" */
    content.append(h('div.st-stats', { role: 'group', 'aria-label': 'This deck' },
      stat('Due today', c.due, 'due-n'), stat('New', c.fresh, 'new-n'), stat('Learned', c.learned, 'learned-n'), stat('Cards', c.total, 'total-n')));
    content.append(h('div.st-row.st-actions',
      h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'study' }, disabled: !queued, onclick: () => startSession('review') }, icon('play'),
        h('span', { text: queued ? `Study ${plural(queued, 'card')}` : 'Nothing to study' })),
      h('button.btn', { type: 'button', dataset: { fk: 'cram' }, disabled: !d.cards.length, title: 'Every card in random order. Changes nothing in your schedule or stats.', onclick: () => startSession('cram') }, icon('shuffle'), h('span', { text: 'Cram (shuffle)' })),
      h('button.btn', { type: 'button', dataset: { fk: 'export' }, disabled: !d.cards.length, onclick: exportDeck }, icon('download'), h('span', { text: 'Export CSV' })),
      h('button.btn', { type: 'button', dataset: { fk: 'import-here' }, onclick: () => { S.imp.target = d.id; S.view = 'import'; render(); } }, icon('upload'), h('span', { text: 'Import…' })),
      h('button.btn', { type: 'button', dataset: { fk: 'share' }, disabled: !d.cards.length, onclick: shareDeck }, icon('link'), h('span', { text: 'Share' }))));
    if (d.cards.length && !queued) {
      const next = d.cards.filter(x => x.due !== null).map(x => x.due).sort()[0];
      const held = c.fresh && !FC.newLeft(d, now);
      content.append(h('p.st-note', { text: `${next ? `Nothing is due today. The next card is due ${next === FC.addDays(FC.today(now), 1) ? 'tomorrow' : next}.` : 'Nothing is due today.'}${held ? ` ${plural(c.fresh, 'new card')} wait${c.fresh === 1 ? 's' : ''} for tomorrow: today’s ${d.newPerDay} new ${d.newPerDay === 1 ? 'card is' : 'cards are'} done.` : ''}` }));
    }
    /* new cards a day */
    const started = FC.newToday(d.cards, now);
    content.append(h('div.st-row.st-newday',
      h('label.st-inline', h('span', { text: 'New cards a day' }),
        h('input.st-in.st-num', { type: 'number', min: '0', max: String(FC.MAX_NEW_PER_DAY), value: String(d.newPerDay), 'aria-label': 'New cards a day', dataset: { fk: 'new-per-day' }, onchange: e => setNewPerDay(e.target) })),
      h('small.dim', { dataset: { fk: 'new-today' }, text: `${started} started today${c.fresh ? ` · ${Math.min(c.fresh, FC.newLeft(d, now))} more today` : ''}` })));

    if (S.voices) content.append(voicesPanel(d));

    /* tags: filter the list, study one tag */
    const tags = [...new Set(d.cards.flatMap(x => x.tags))].sort();
    if (S.tag && !tags.includes(S.tag)) S.tag = '';
    if (tags.length) {
      const tagged = t => d.cards.filter(x => x.tags.includes(t));
      const only = S.tag ? x => x.tags.includes(S.tag) : null;
      const tq = S.tag ? FC.deckQueue(d, now, only).length : 0;
      content.append(h('div.st-row.st-tagrow', { role: 'group', 'aria-label': 'Tags' },
        h('button.st-chip', { type: 'button', 'aria-pressed': S.tag ? 'false' : 'true', class: S.tag ? '' : 'is-on', onclick: () => { S.tag = ''; render(); } }, h('span', { text: 'All' })),
        tags.map(t => h('button.st-chip', { type: 'button', 'aria-pressed': S.tag === t ? 'true' : 'false', class: S.tag === t ? 'is-on' : '', dataset: { fk: 'tag', tag: t }, onclick: () => { S.tag = S.tag === t ? '' : t; render(); } }, h('span', { text: `#${t} (${tagged(t).length})` }))),
        S.tag ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'study-tag' }, disabled: !tq, onclick: () => startSession('review', { only, label: `#${S.tag}` }) }, icon('play'), h('span', { text: tq ? `Study ${plural(tq, 'card')} tagged #${S.tag}` : `Nothing tagged #${S.tag} to study` })) : null,
        S.tag ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'cram-tag' }, onclick: () => startSession('cram', { only, label: `#${S.tag}` }) }, icon('shuffle'), h('span', { text: 'Cram' })) : null));
    }

    /* the cards you keep missing */
    const miss = FC.missed([d]);
    if (miss.length) {
      content.append(h('section.st-miss', { 'aria-label': 'Cards you keep missing', dataset: { fk: 'missed' } },
        h('div.side__label', h('span', { text: 'Cards you keep missing' }), h('small', { text: String(miss.length) })),
        h('div.st-misslist', miss.slice(0, 8).map(({ card }) => h('div.st-missrow', { dataset: { miss: card.id } }, h('span', { text: FC.faces(card).qText }), h('small', { text: `missed ${card.lapses} times` })))),
        h('div.st-row', h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'practise-missed' }, onclick: () => startSession('cram', { ids: miss.map(x => x.card.id), label: 'cards you keep missing' }) }, icon('shuffle'), h('span', { text: `Practise ${miss.length === 1 ? 'it' : `these ${miss.length}`}` })),
          h('small.dim', { text: 'Practice is a cram round: your schedule stays as it is. “Missed” counts every “Again”.' }))));
    }

    /* add a card */
    const front = h('textarea.st-ta', { rows: '2', maxlength: '1000', placeholder: 'Front (question or term), or a sentence with {{gaps}}', 'aria-label': 'Front of the new card', dataset: { fk: 'add-front' }, value: S.add.front, oninput: e => { S.add.front = e.target.value; paintAddHints(); } });
    const back = h('textarea.st-ta', { rows: '2', maxlength: '1000', placeholder: 'Back (answer)', 'aria-label': 'Back of the new card', dataset: { fk: 'add-back' }, value: S.add.back, oninput: e => { S.add.back = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addCard(); } } });
    front.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addCard(); } });
    front.value = S.add.front; back.value = S.add.back;
    const tagsIn = h('input.st-in', { type: 'text', maxlength: '200', placeholder: 'Tags (optional): chapter-4 verbs', 'aria-label': 'Tags for the new card', dataset: { fk: 'add-tags' }, value: S.add.tags, oninput: e => { S.add.tags = e.target.value; } });
    const rev = h('input', { type: 'checkbox', checked: S.add.reverse, dataset: { fk: 'add-reverse' }, onchange: e => { S.add.reverse = e.target.checked; } });
    const revWrap = h('label.st-check-l', rev, h('span', { text: 'Also make a reverse card (back → front)' }));
    addHints = { note: h('div.st-hintline'), back, rev, revWrap };
    if (S.focusFront) { S.focusEl = front; S.focusFront = false; }
    content.append(h('section.st-add', { 'aria-label': 'Add a card' },
      h('div.st-add__cols', front, back),
      addHints.note,
      h('div.st-row', tagsIn, revWrap),
      S.add.img ? h('div.st-imgrow', thumb(S.add.img, 'st-thumb'), h('small', { text: S.add.img.split('/').pop() }), h('button.ibtn', { type: 'button', 'aria-label': 'Remove picture', onclick: () => { S.add.img = ''; render(); } }, icon('x'))) : null,
      S.picker ? picker(p => { S.add.img = p; S.picker = false; render(); }) : null,
      S.addNote ? h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: S.addNote })) : null,
      h('div.st-row',
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'add-pic' }, 'aria-expanded': S.picker ? 'true' : 'false', onclick: () => { S.picker = !S.picker; render(); } }, icon('image'), h('span', { text: S.add.img ? 'Change picture' : 'Add picture' })),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'add-gap' }, title: 'Put the selected words in a gap: a cloze card', onmousedown: e => e.preventDefault(), onclick: () => makeGap(front) }, h('span', { text: '{{ }} Make a gap' })),
        h('span.st-spacer'), h('small.dim', { text: 'Ctrl/⌘+Enter adds' }),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'add-card' }, onclick: addCard }, icon('plus'), h('span', { text: 'Add card' })))));
    paintAddHints();

    /* the cards */
    const shown = S.tag ? d.cards.filter(x => x.tags.includes(S.tag)) : d.cards;
    if (!d.cards.length) {
      content.append(h('div.empty', icon('layers'), h('b', { text: 'No cards yet' }), h('small', { text: 'Add one above, or import a CSV/TSV file.' })));
    } else {
      const list = h('div.st-list', { role: 'list', 'aria-label': S.tag ? `Cards tagged ${S.tag}` : 'Cards' });
      for (const card of shown) list.append(S.editing === card.id ? editRow(card, d) : cardRow(card, now));
      content.append(list);
      if (S.hit) {
        const el = list.querySelector(`[data-card="${CSS.escape(S.hit)}"]`);
        S.hit = '';
        if (el) { el.classList.add('is-hit'); requestAnimationFrame(() => { try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* fine */ } }); }
      }
    }
    main.append(content);
  }
  const stat = (label, n, fk) => h('div.st-stat', h('b', { dataset: { fk }, text: String(n) }), h('small', { text: label }));

  function voicesPanel(d) {
    const list = speech.voices();
    const cur = VOC.getVoices(d.id) || { term: '', meaning: '' };
    const sel = (key, label) => h('label.st-f', h('span.st-f__l', { text: label }),
      h('select.select.st-sel', { 'aria-label': label, dataset: { fk: `voice-${key}` }, onchange: e => { VOC.setVoices(d.id, { ...cur, [key]: e.target.value }); cur[key] = e.target.value; } },
        h('option', { value: '', text: 'The Settings voice', selected: !cur[key] }),
        VOC.languages(list).map(l => h('optgroup', { label: l.name }, l.voices.map(v => h('option', { value: v.voiceURI, text: VOC.describeVoice(v), selected: cur[key] === v.voiceURI }))))));
    return h('section.st-panel', { 'aria-label': 'Voices for read aloud', dataset: { fk: 'voices' } },
      list.length ? h('div.st-form__grid', sel('term', 'Voice for the front'), sel('meaning', 'Voice for the back')) : h('small.dim', { text: speech.supported() ? speech.NO_VOICES : speech.MISSING }),
      h('div.st-row', h('small.dim', { text: 'The same voices are used in the Vocab tab for this deck.' }), h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', onclick: () => { S.voices = false; render(); } }, h('span', { text: 'Done' }))));
  }

  function cardRow(card, now) {
    const when = dueText(card, now);
    const f = FC.faces(card);
    const kind = card.kind === 'rev' ? h('span.st-kind', { title: 'A reverse card: it shows the back and asks for the front', text: '⇄ reverse' })
      : card.kind === 'cloze' ? h('span.st-kind', { text: `cloze ${card.cloze}` }) : null;
    return h('div.st-card', { role: 'listitem', dataset: { card: card.id, kind: card.kind } },
      card.img ? thumb(card.img, 'st-thumb') : null,
      h('div.st-card__t', h('b', card.kind === 'cloze' ? segs(f.a) : [document.createTextNode(f.qText || '(picture)')]),
        h('span', { text: card.kind === 'cloze' ? (card.back || '') : f.aText }), h('span.st-card__m', kind, tagChips(card.tags))),
      h('span.st-due', { class: card.due === null ? 'is-new' : card.due <= FC.today(now) ? 'is-due' : '', text: when }),
      h('button.ibtn', { type: 'button', 'aria-label': `Edit card: ${f.qText}`, onclick: () => { S.editing = card.id; S.editNote = ''; S.focusEdit = true; render(); } }, icon('edit-3')),
      h('button.ibtn', { type: 'button', 'aria-label': `Delete card: ${f.qText}`, onclick: () => deleteCard(card.id) }, icon('trash')));
  }
  function editRow(card, d) {
    const f = h('textarea.st-ta', { rows: '2', maxlength: '1000', 'aria-label': 'Front', dataset: { fk: 'edit-front' } });
    const b = h('textarea.st-ta', { rows: '2', maxlength: '1000', 'aria-label': card.kind === 'cloze' ? 'Extra' : 'Back', dataset: { fk: 'edit-back' } });
    const t = h('input.st-in', { type: 'text', maxlength: '200', 'aria-label': 'Tags', placeholder: 'Tags', dataset: { fk: 'edit-tags' } });
    f.value = card.front; b.value = card.back; t.value = card.tags.join(' ');
    const both = card.kind === 'basic' ? h('input', { type: 'checkbox', checked: FC.hasReverse(d, card), dataset: { fk: 'edit-reverse' } }) : null;
    let img = card.img;
    const holder = h('div.st-imgrow');
    const paint = () => { clear(holder); if (img) holder.append(thumb(img, 'st-thumb'), h('button.btn.btn--sm', { type: 'button', onclick: () => { img = ''; paint(); } }, icon('x'), h('span', { text: 'Remove picture' }))); };
    paint();
    if (S.focusEdit) { S.focusEl = f; S.focusEdit = false; }
    const sib = FC.siblings(d, card).length;
    return h('div.st-card.is-editing', { role: 'listitem', dataset: { card: card.id } },
      h('div.st-edit', h('div.st-add__cols', f, b), holder,
        h('div.st-row', t, both ? h('label.st-check-l', both, h('span', { text: 'Also a reverse card' })) : null),
        sib > 1 ? h('small.dim', { text: card.kind === 'cloze' ? `This text makes ${plural(sib, 'card')}: they all change, each keeping its own schedule.` : 'The reverse card changes too, and keeps its own schedule.' }) : null,
        S.editNote ? h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: S.editNote })) : null,
        h('div.st-row', h('span.st-spacer'),
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'edit-save' }, onclick: () => saveEdit(card.id, f.value, b.value, img, t.value, both ? both.checked : undefined) }, icon('check'), h('span', { text: 'Save' })),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.editing = null; S.editNote = ''; render(); } }, h('span', { text: 'Cancel' })))));
  }

  /* ---- study ---- */
  function renderStudy() {
    const s = S.session;
    const d = S.data.decks.find(x => x.id === s.deckId);
    const cram = s.kind === 'cram';
    main.append(bar(h('button.ibtn', { type: 'button', 'aria-label': 'Back to the deck', dataset: { fk: 'exit' }, onclick: endSession }, icon('chevron-left')),
      h('div.app__title', { text: `${cram ? 'Cram' : 'Study'}: ${d ? d.name : ''}${s.label ? ` · ${s.label}` : ''}` }), h('span.st-spacer'),
      h('small.st-prog', { dataset: { fk: 'progress' }, text: s.finished ? 'Finished' : `${plural(s.queue.length, 'card')} left` })));
    const content = h('div.app__content.st-scroll');
    if (cram) content.append(h('div.st-banner', { role: 'note' }, icon('shuffle'), h('span', { text: 'Cram mode: cards are shuffled and nothing here changes your schedule or your stats.' })));
    if (s.finished) {
      const next = d ? d.cards.filter(c => c.due !== null && c.due > FC.today()).map(c => c.due).sort()[0] : null;
      content.append(h('div.empty.st-done', { dataset: { fk: 'done' } }, icon('check-circle'),
        h('b', { text: s.total ? (cram ? 'Cram round finished' : 'Session finished') : 'Nothing to study right now' }),
        h('small', { text: s.total
          ? (cram ? `You went through ${plural(s.total, 'card')}.` : `${plural(s.reviews, 'review')}: ${FC.GRADES.map(g => `${s.grades[g]} ${GRADE_LABEL[g].toLowerCase()}`).join(', ')}.${next ? ` Next card due ${next}.` : ''}`)
          : 'No cards are due and there are no new ones. Come back when one is due.' }),
        h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: endSession }, h('span', { text: 'Back to the deck' }))));
      main.append(content);
      return;
    }
    const c = current();
    if (!c) { endSession(); return; }
    if (s.editing) {
      const f = h('textarea.st-ta', { rows: '3', maxlength: '1000', 'aria-label': 'Front', dataset: { fk: 'sedit-front' } });
      const b = h('textarea.st-ta', { rows: '3', maxlength: '1000', 'aria-label': c.kind === 'cloze' ? 'Extra' : 'Back', dataset: { fk: 'sedit-back' } });
      const t = h('input.st-in', { type: 'text', maxlength: '200', 'aria-label': 'Tags', placeholder: 'Tags', dataset: { fk: 'sedit-tags' } });
      f.value = c.front; b.value = c.back; t.value = c.tags.join(' ');
      const keys = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); s.editing = false; S.editNote = ''; render(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveSessionEdit(f.value, b.value, t.value); } };
      for (const x of [f, b, t]) x.addEventListener('keydown', keys);
      if (S.focusSessionEdit) { S.focusEl = f; S.focusSessionEdit = false; }
      content.append(h('section.st-panel.st-sedit', { 'aria-label': 'Edit this card', dataset: { fk: 'session-edit' } },
        h('div.side__label', { text: c.kind === 'rev' ? 'Edit the card (this is its reverse: it asks with the back)' : 'Edit the card' }),
        h('div.st-add__cols', f, b), t,
        S.editNote ? h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: S.editNote })) : null,
        h('div.st-row', h('small.dim', { text: 'Your schedule for it stays. Esc cancels, Ctrl/⌘+Enter saves.' }), h('span.st-spacer'),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'sedit-cancel' }, onclick: () => { s.editing = false; S.editNote = ''; render(); } }, h('span', { text: 'Cancel' })),
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'sedit-save' }, onclick: () => saveSessionEdit(f.value, b.value, t.value) }, icon('check'), h('span', { text: 'Save' })))));
      main.append(content);
      return;
    }
    const canSpeak = speech.supported();
    const fc = FC.faces(c);
    const img = s.flipped ? fc.aImg || fc.qImg : fc.qImg;
    content.append(h('div.st-study', { 'aria-live': 'polite' },
      h('div.st-face', { dataset: { fk: 'face', kind: c.kind }, class: s.flipped ? 'is-back' : 'is-front' },
        h('small.st-face__side', { text: s.flipped ? 'Back' : c.kind === 'rev' ? 'Front · reverse' : c.kind === 'cloze' ? 'Front · fill the gap' : 'Front' }),
        img ? thumb(img, 'st-face__img') : null,
        h('div.st-face__text', segs(s.flipped ? fc.a : fc.q)),
        s.flipped && fc.extra ? h('div.st-face__extra', { text: fc.extra }) : null),
      !s.flipped
        ? h('button.btn.btn--primary.st-flip', { type: 'button', dataset: { fk: 'flip' }, onclick: flip }, h('span', { text: 'Show answer' }), h('kbd', { text: 'Space' }))
        : h('div.st-grades', { role: 'group', 'aria-label': cram ? 'Did you know it?' : 'How well did you know it?' },
          cram ? [['again', 'Again: see it later', '1'], ['got', 'Got it', '2']].map(([g, label, k]) => h('button.btn.st-g', { type: 'button', class: `st-g--${g}`, dataset: { fk: `grade-${g}` }, onclick: () => grade(g) }, h('b', { text: label }), h('kbd', { text: k })))
            : FC.GRADES.map((g, i) => {
              const next = FC.schedule(c, g);
              return h('button.btn.st-g', { type: 'button', class: `st-g--${g}`, dataset: { fk: `grade-${g}` }, onclick: () => grade(g) },
                h('b', { text: GRADE_LABEL[g] }), h('small', { dataset: { fk: `when-${g}` }, text: g === 'again' ? 'again today' : FC.intervalText(next.interval) }), h('kbd', { text: String(i + 1) }));
            })),
      h('div.st-row.st-study__tools',
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'speak' }, disabled: !canSpeak, title: canSpeak ? 'Read the visible side aloud (R)' : speech.MISSING, onclick: readAloud }, icon('volume-2'), h('span', { text: 'Read aloud' })),
        canSpeak ? h('label.st-check-l', h('input', { type: 'checkbox', checked: prefs().autoRead, dataset: { fk: 'auto-read' }, onchange: e => { store.set(PREFS_KEY, { ...prefs(), autoRead: e.target.checked }); if (e.target.checked) readAloud(); } }), h('span', { text: 'Read each side aloud' })) : null,
        canSpeak ? null : h('small.dim', { dataset: { fk: 'speak-missing' }, text: 'Read aloud isn’t available: this browser has no speech synthesis.' }),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'session-edit-btn' }, title: 'Edit this card (E)', onclick: editInSession }, icon('edit-3'), h('span', { text: 'Edit' })),
        h('span.st-spacer'),
        h('small.dim', { text: cram ? 'Space flips · 1 again · 2 got it · E edit' : 'Space flips · 1–4 grade · E edit · R read' }))));
    main.append(content);
  }

  /* ---- a deck someone sent ---- */
  function renderShared() {
    const got = S.shared;
    main.append(bar(h('div.app__title', { text: 'A deck someone sent you' })));
    const content = h('div.app__content.st-scroll');
    if (!got || got.error) {
      content.append(h('div.st-issue', { role: 'alert', dataset: { fk: 'shared-error' } }, icon('alert'), h('span', { text: got ? got.error : 'This link is empty.' })),
        h('div.st-row', h('button.btn.btn--sm', { type: 'button', onclick: () => { S.shared = null; S.view = 'deck'; render(); } }, h('span', { text: 'Back to your decks' }))));
      main.append(content);
      return;
    }
    const tags = [...new Set(got.entries.flatMap(e => e.tags))];
    content.append(h('section.st-panel', { 'aria-label': `Shared deck ${got.name}`, dataset: { fk: 'shared' } },
      h('b.st-shared__t', { dataset: { fk: 'shared-name' }, text: got.name }),
      h('p.st-hint', { dataset: { fk: 'shared-count' }, text: `${got.cards === got.entries.length ? plural(got.cards, 'card') : `${plural(got.entries.length, 'line')} making ${plural(got.cards, 'card')} (a reverse card and each cloze gap is a card of its own)`}${tags.length ? ` · tags ${tags.map(t => `#${t}`).join(' ')}` : ''}. Nothing is added unless you press Add: then they become a new deck of new cards, yours to change. Changes on either side don’t follow.` }),
      h('div.st-list', { role: 'list', 'aria-label': 'Cards in the link' }, got.entries.slice(0, 60).map(e => h('div.st-card', { role: 'listitem', dataset: { fk: 'shared-card' } },
        h('div.st-card__t', h('b', FC.hasCloze(e.front) ? segs(FC.clozeParts(e.front).map(p => (p.answer === undefined ? { t: p.text, gap: false } : { t: p.answer, gap: true }))) : [document.createTextNode(e.front)]), h('span', { text: e.back }),
          h('span.st-card__m', e.reverse ? h('span.st-kind', { text: '⇄ both ways' }) : null, FC.hasCloze(e.front) ? h('span.st-kind', { text: `cloze × ${FC.clozeNums(e.front).length}` }) : null, tagChips(e.tags)))))),
      got.entries.length > 60 ? h('small.dim', { text: `…and ${got.entries.length - 60} more.` }) : null,
      h('div.st-row', h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'shared-cancel' }, onclick: () => { S.shared = null; S.view = 'deck'; render(); } }, h('span', { text: 'Don’t add' })),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'shared-add' }, onclick: addShared }, icon('plus'), h('span', { text: 'Add as a new deck' })))));
    main.append(content);
  }

  /* ---- import ---- */
  function renderImport() {
    main.append(bar(h('div.app__title', { text: 'Import cards' })));
    const sel = h('select.select.st-sel', { 'aria-label': 'Add the cards to', dataset: { fk: 'imp-target' }, onchange: e => { S.imp.target = e.target.value; render(); } },
      h('option', { value: '', text: 'A new deck', selected: S.imp.target === '' }), S.data.decks.map(d => h('option', { value: d.id, text: `${d.name} (${plural(d.cards.length, 'card')})`, selected: d.id === S.imp.target })));
    const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain', 'aria-label': 'Choose a CSV or TSV file', dataset: { fk: 'imp-file' },
      onchange: async e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 4 * 1024 * 1024) { S.impNote = 'That file is over 4 MB; a deck file is much smaller than that.'; render(); return; }
        S.imp.text = await f.text(); S.imp.file = f.name; S.impNote = ''; S.imp.from = '';
        if (!S.imp.name) S.imp.name = f.name.replace(/\.[^.]+$/, '');
        render();
      } });
    const notes = liveNotes();
    const noteSel = h('select.select.st-sel', { 'aria-label': 'Make cards from a note', dataset: { fk: 'imp-note' }, disabled: !notes.length, onchange: e => { if (e.target.value) fromNote(e.target.value); } },
      h('option', { value: '', text: notes.length ? 'Pick a note…' : 'No notes yet' }), notes.slice(0, 200).map(n => h('option', { value: n.id, text: String(n.title || '').trim().slice(0, 60) || 'Untitled note' })));
    const sepSel = h('select.select.st-sel', { 'aria-label': 'Split each line at', dataset: { fk: 'imp-sep' }, onchange: e => { S.imp.sep = e.target.value; refreshPreview(); } },
      FC.SEPARATORS.map(([v, l]) => h('option', { value: v, text: l, selected: v === S.imp.sep })));
    const ta = h('textarea.st-ta.st-ta--big', { rows: '8', placeholder: 'front,back\nbonjour,hello\n“la maison”,the house\nperro - dog\nThe {{mitochondria}} makes ATP', 'aria-label': 'Or paste cards here', dataset: { fk: 'imp-text' },
      oninput: e => { S.imp.text = e.target.value; refreshPreview(); },
      /* a table copied from a document or a page comes in as two columns */
      onpaste: e => {
        const html = e.clipboardData && e.clipboardData.getData('text/html');
        const tsv = html ? tableToText(html) : '';
        if (!tsv) return;
        e.preventDefault();
        const a = ta.selectionStart, z = ta.selectionEnd;
        ta.value = `${ta.value.slice(0, a)}${tsv}${ta.value.slice(z)}`;
        S.imp.text = ta.value;
        if (S.imp.sep !== 'auto' && S.imp.sep !== '\t') { S.imp.sep = '\t'; sepSel.value = '\t'; }
        refreshPreview();
      } });
    ta.value = S.imp.text;
    const prev = h('div.st-preview', { role: 'status', dataset: { fk: 'imp-preview' } });
    const go = h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'imp-go' }, onclick: doImport }, icon('upload'), h('span', { text: 'Import' }));
    const sepText = d => (d === '\t' ? 'tab-separated' : d === ',' ? 'comma-separated' : d === ';' ? 'semicolon-separated' : d === '::' ? 'split at “::”' : 'split at the dash');
    function refreshPreview() {
      const q = S.imp.text.trim() ? previewImport() : null;
      const cz = q ? q.cards.filter(c => FC.hasCloze(c.front)).length : 0;
      prev.textContent = q ? `${plural(q.cards.length, 'card')} found${cz ? ` (${cz} cloze)` : ''}${q.skipped ? `, ${plural(q.skipped, 'line')} skipped` : ''} (${sepText(q.delimiter)}${q.header ? ', header row left out' : ''}).` : 'Choose a file, pick a note or paste text to see how many cards it holds.';
      go.disabled = !q || !q.cards.length;
    }
    refreshPreview();
    main.append(h('div.app__content.st-scroll', h('div.st-import',
      h('p.st-hint', { text: 'One card per line: the front, then the back, separated by a comma or a tab (a spreadsheet’s CSV or TSV export), “::” or a spaced dash. A first line of “front,back” is treated as a header. Put text containing commas in "quotes". A table pasted from a document comes in as two columns.' }),
      h('label.st-f', h('span.st-f__l', { text: 'Add to' }), sel),
      S.imp.target === '' ? h('label.st-f', h('span.st-f__l', { text: 'New deck name' }), h('input.st-in', { type: 'text', maxlength: '60', placeholder: 'Imported deck', value: S.imp.name, 'aria-label': 'New deck name', dataset: { fk: 'imp-name' }, oninput: e => { S.imp.name = e.target.value; } })) : null,
      h('div.st-form__grid', h('label.st-f', h('span.st-f__l', { text: 'File' }), file), h('label.st-f', h('span.st-f__l', { text: 'From a note (term :: definition lines, two-column tables, {{gaps}})' }), noteSel)),
      S.imp.from ? h('small.dim', { dataset: { fk: 'imp-from' }, text: `From the note “${S.imp.from}”.` }) : null,
      h('label.st-f', h('span.st-f__l', { text: 'Split each line at' }), sepSel), ta, prev,
      S.impNote ? h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: S.impNote })) : null,
      h('div.st-row', go, h('button.btn', { type: 'button', onclick: () => { S.view = 'deck'; S.impNote = ''; render(); } }, h('span', { text: 'Cancel' }))))));
  }

  /* ---- stats ---- */
  function renderStats() {
    const now = Date.now();
    const all = S.data.decks.flatMap(d => d.cards);
    const c = FC.counts(all, now);
    const days = FC.perDay(14, now, S.data.log);
    const todayN = days[days.length - 1].n;
    const week = days.slice(-7).reduce((s, x) => s + x.n, 0);
    const logDays = Object.keys(S.data.log).filter(k => k >= FC.addDays(FC.today(now), -29));
    const tot = logDays.reduce((s, k) => s + S.data.log[k].n, 0);
    const right = logDays.reduce((s, k) => s + S.data.log[k].n - S.data.log[k].again, 0);
    const max = Math.max(1, ...days.map(x => x.n));
    /* 12 weeks, Monday at the top; the shade is in quarters of the busiest day */
    const grid = FC.weekGrid(12, now, S.data.log);
    const cells = grid.flat().filter(x => !x.future);
    const top = Math.max(1, ...cells.map(x => x.n));
    const total12 = cells.reduce((s, x) => s + x.n, 0), daysOn = cells.filter(x => x.n).length;
    const level = n => (!n ? 0 : Math.min(4, Math.ceil(n / top * 4)));
    const miss = FC.missed(S.data.decks);
    main.append(bar(h('div.app__title', { text: 'Stats' })));
    main.append(h('div.app__content.st-scroll',
      h('div.st-stats', { role: 'group', 'aria-label': 'Your cards' },
        stat('Cards', c.total, 's-total'), stat('New', c.fresh, 's-new'), stat('Learned', c.learned, 's-learned'), stat('Mature (21+ days)', c.mature, 's-mature'), stat('Due today', c.due, 's-due')),
      h('div.st-stats', { role: 'group', 'aria-label': 'Your reviews' },
        stat('Reviews today', todayN, 's-today'), stat('Reviews, last 7 days', week, 's-week'),
        h('div.st-stat', h('b', { dataset: { fk: 's-correct' }, text: tot ? `${right} of ${tot}` : '—' }), h('small', { text: 'Not “Again”, last 30 days' }))),
      h('section.st-chart', { 'aria-label': 'Reviews per day, last 14 days' }, h('div.side__label', { text: 'Reviews per day' }),
        h('div.st-bars', { role: 'img', 'aria-label': `Reviews per day for the last 14 days: ${days.map(x => `${x.day} ${x.n}`).join(', ')}` },
          days.map(x => h('div.st-bar', { title: `${x.day}: ${plural(x.n, 'review')}`, dataset: { day: x.day, n: String(x.n) } }, h('i', { style: { height: `${x.n ? Math.max(4, Math.round(x.n / max * 100)) : 0}%` } }), h('small', { text: x.day.slice(8) }))))),
      h('section.st-chart', { 'aria-label': 'Reviews, last 12 weeks' }, h('div.side__label', { text: 'Last 12 weeks' }),
        h('div.st-heat', { role: 'img', dataset: { fk: 'heatmap' }, 'aria-label': `Reviews in the last 12 weeks: ${total12} on ${plural(daysOn, 'day')}. The busiest day had ${top === 1 && !total12 ? 0 : top}.` },
          h('div.st-heat__days', { 'aria-hidden': 'true' }, ['M', '', 'W', '', 'F', '', 'S'].map(x => h('small', { text: x }))),
          grid.map(w => h('div.st-heat__w', w.map(x => h('i.st-heat__c', { class: x.future ? 'is-future' : `l${level(x.n)}`, title: x.future ? '' : `${x.day}: ${plural(x.n, 'review')}`, dataset: { day: x.day, n: String(x.n) } }))))),
        h('small.dim', { dataset: { fk: 'heat-sum' }, text: total12 ? `${plural(total12, 'review')} on ${plural(daysOn, 'day')}. Darker is more, up to your busiest day (${top}).` : 'No reviews in the last 12 weeks yet.' })),
      miss.length ? h('section.st-miss', { 'aria-label': 'Cards you keep missing', dataset: { fk: 'missed-all' } }, h('div.side__label', { text: 'Cards you keep missing' }),
        h('div.st-misslist', miss.slice(0, 20).map(({ deck: dk, card }) => h('button.st-missrow', { type: 'button', onclick: () => { S.deckId = dk.id; S.view = 'deck'; S.hit = card.id; render(); } },
          h('span', { text: FC.faces(card).qText }), h('small', { text: `${dk.name} · missed ${card.lapses} times` }))))) : null,
      h('p.st-note', { text: 'Learned means a card you have answered correctly at least once and not forgotten since. Everything here is counted from your cards and from the reviews you actually graded; cram rounds are not counted.' }),
      h('details.st-how', h('summary', { text: 'How cards are scheduled' }),
        h('p', { text: 'Again: the card comes back in this session, due today, and its ease drops 0.20. Hard, Good and Easy are passes: the first pass in a row is 1, 1 or 3 days; the second 3, 6 or 8 days; after that the last interval × 1.2 (Hard), × ease (Good) or × ease × 1.3 (Easy), always at least a day longer. Ease starts at 2.5 and moves −0.14 (Hard), 0 (Good), +0.10 (Easy), never below 1.3.' }),
        h('p', { text: 'A reverse card and each gap of a cloze text are cards of their own, each with its own schedule. A deck brings in up to its “new cards a day”; a new card counts on the day you first grade it.' }))));
  }

  /* ---------- render ---------- */
  function render() {
    if (S.dead) return;
    S.focusEl = null;
    addHints = null;
    /* a message shows for one render after it was set, then goes */
    if (S.flash && S.flashSeen) { S.flash = ''; S.flashSeen = false; } else if (S.flash) S.flashSeen = true;
    clear(main);
    renderSide();
    if (S.view === 'study' && S.session) renderStudy();
    else if (S.view === 'stats') renderStats();
    else if (S.view === 'import') renderImport();
    else if (S.view === 'shared') renderShared();
    else renderDeck();
    const el = S.focusEl;
    if (el) requestAnimationFrame(() => { try { if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return; /* never take the keyboard from a field already being typed in */ el.focus(); if (el.select && el.tagName === 'INPUT') el.select(); } catch (e) { /* fine */ } });
    ctx.changed && ctx.changed();
  }

  /* ---------- keys ---------- */
  const onKey = e => {
    if (S.dead || !isActive() || S.view !== 'study' || !S.session || e.metaKey || e.ctrlKey || e.altKey) return;
    const act = document.activeElement;
    const tag = act && act.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const s = S.session;
    if (s.editing) { if (e.key === 'Escape') { e.preventDefault(); s.editing = false; render(); } return; }
    if (e.key === ' ' || e.code === 'Space') {
      /* Space on a focused button would also click it: flipping here is the same thing, so don't do both */
      e.preventDefault();
      if (!s.flipped) flip();
      return;
    }
    if (s.kind === 'review' && /^[1-4]$/.test(e.key)) { if (s.flipped) { e.preventDefault(); grade(FC.GRADES[+e.key - 1]); } }
    else if (s.kind === 'cram' && (e.key === '1' || e.key === '2')) { if (s.flipped) { e.preventDefault(); grade(e.key === '1' ? 'again' : 'got'); } }
    else if (e.key === 'e' || e.key === 'E') { if (!s.finished) { e.preventDefault(); editInSession(); } }
    else if (e.key === 'r' || e.key === 'R') { if (!s.finished) { e.preventDefault(); readAloud(); } }
    else if (e.key === 'Escape') endSession();
  };
  window.addEventListener('keydown', onKey);
  /* a new day makes cards due: bring the counts up to date (not in the middle of a session) */
  let lastDay = FC.today();
  const off = api.bus.on('tick:5s', () => {
    const t = FC.today();
    if (t === lastDay) return;
    lastDay = t;
    if (S.view !== 'study' && !S.editing) { S.data = FC.read(); render(); }
  });
  render();

  return {
    teardown() { S.dead = true; off(); window.removeEventListener('keydown', onKey); speech.stop(); },
    /* the shell asks for these: { deck, start } from Notes, Staticum, Lens and Today;
       { deck, card } from search; { shared } from a #deck= link */
    open(o) {
      if (!o) return;
      if (typeof o.shared === 'string' && o.shared) { openShared(o.shared); return; }
      if (!o.deck) return;
      S.data = FC.read();           /* a deck made a moment ago (Lens, Staticum) is not in the copy we hold */
      if (!S.data.decks.some(d => d.id === o.deck)) return;
      S.deckId = o.deck; S.view = 'deck'; S.session = null; S.tag = ''; S.hit = typeof o.card === 'string' ? o.card : '';
      /* Exams' "Write them myself": the topic's tag is filled in, ready to type */
      if (typeof o.tags === 'string') { S.add = { front: '', back: '', img: '', tags: o.tags.slice(0, 200), reverse: false }; S.focusFront = true; }
      render();
      /* Staticum's "quiz me on my biology deck": straight into a session */
      if (o.start === 'study' || o.start === 'cram') startSession(o.start === 'study' ? 'review' : 'cram');
    },
  };
}
