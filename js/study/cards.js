/* ============================================================
   study/cards.js — the Flashcards tab of Static Study.

   Decks in the sidebar; a deck page to add, edit, import and export
   cards; a study session (Space flips, 1–4 grade); a cram session
   that shuffles every card and leaves the schedule and the stats
   alone; and a stats page drawn only from the cards and the review
   log (js/core/flashcards.js says how scheduling works).
   ============================================================ */
import * as FC from '../core/flashcards.js';
import * as media from '../core/media.js';
import * as speech from '../core/speech.js';
import { vfs } from '../core/vfs.js';

const GRADE_LABEL = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function dueText(card, now = Date.now()) {
  if (card.due === null) return 'New';
  const d = FC.daysBetween(FC.today(now), card.due);
  if (d <= 0) return d === 0 ? 'Due today' : `Overdue ${plural(-d, 'day')}`;
  return d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
}

export function mountCards(host, ctx) {
  const { api, win, isActive } = ctx;
  const { h, icon, clear, confirm, menu } = api;
  const S = {
    data: FC.read(), deckId: '', view: 'deck',     /* 'deck' | 'study' | 'stats' | 'import' */
    session: null, add: { front: '', back: '', img: '' }, editing: null, picker: false, addNote: '',
    imp: { target: '', name: '', text: '', file: '' }, impNote: '', dead: false, spoke: false,
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

  /* ---------- deck actions ---------- */
  function newDeck(name) {
    const nm = String(name || '').trim();
    if (!nm) return;
    const id = mutate(data => { const d = FC.normDeck({ name: nm }); if (data.decks.length >= FC.MAX_DECKS) return ''; data.decks.push(d); return d.id; });
    if (id) { S.deckId = id; S.view = 'deck'; S.session = null; S.naming = false; }
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
    S.view = 'deck'; S.session = null;
    render();
  }
  function addCard() {
    const f = S.add.front.trim(), b = S.add.back.trim();
    if (!f && !S.add.img) { S.addNote = 'Write the front of the card (or pick a picture).'; render(); return; }
    if (!b) { S.addNote = 'Write the back of the card.'; render(); return; }
    const full = mutDeck(d => {
      if (d.cards.length >= FC.MAX_CARDS) return true;
      d.cards.push(FC.normCard({ front: f, back: b, img: S.add.img }));
      return false;
    });
    S.addNote = full ? `A deck holds up to ${FC.MAX_CARDS} cards.` : '';
    if (!full) S.add = { front: '', back: '', img: '' };
    S.picker = false;
    S.focusFront = true;
    render();
  }
  function saveEdit(id, f, b, img) {
    const front = String(f).trim(), back = String(b).trim();
    S.editing = null;
    if ((front || img) && back) mutDeck(d => { const c = d.cards.find(x => x.id === id); if (c) Object.assign(c, FC.normCard({ ...c, front, back, img })); });
    render();
  }
  function deleteCard(id) {
    mutDeck(d => { d.cards = d.cards.filter(c => c.id !== id); });
    render();
  }

  /* ---------- study ---------- */
  function startSession(kind) {
    const d = deck();
    if (!d) return;
    const queue = kind === 'cram' ? FC.shuffled(d.cards) : FC.queue(d.cards);
    S.session = { kind, deckId: d.id, queue, total: queue.length, flipped: false, reviews: 0, grades: { again: 0, hard: 0, good: 0, easy: 0 }, finished: !queue.length };
    S.view = 'study';
    speech.stop();
    render();
  }
  const current = () => {
    const s = S.session, d = s && S.data.decks.find(x => x.id === s.deckId);
    return s && d && !s.finished ? d.cards.find(c => c.id === s.queue[0]) || null : null;
  };
  function flip() {
    const s = S.session;
    if (!s || s.finished || s.flipped || !current()) return;
    s.flipped = true;
    render();
  }
  function grade(g) {
    const s = S.session, c = current();
    if (!s || !c || !s.flipped) return;
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
  }
  function endSession() { S.session = null; S.view = 'deck'; speech.stop(); render(); }
  function readAloud() {
    const c = current();
    if (!c) return;
    S.spoke = true;
    speech.speak(S.session.flipped ? c.back : c.front);
  }

  /* ---------- import / export ---------- */
  function previewImport() {
    const room = S.imp.target === '' || S.imp.target === 'new' ? FC.MAX_CARDS : FC.MAX_CARDS - ((S.data.decks.find(d => d.id === S.imp.target) || { cards: [] }).cards.length);
    return FC.parseImport(S.imp.text, room);
  }
  function doImport() {
    const p = previewImport();
    if (!p.cards.length) { S.impNote = 'No cards found. Each line needs a front and a back, separated by a comma or a tab.'; render(); return; }
    let id = S.imp.target;
    let made = false;
    mutate(data => {
      let d = data.decks.find(x => x.id === id);
      if (!d) {
        if (data.decks.length >= FC.MAX_DECKS) return;
        d = FC.normDeck({ name: S.imp.name.trim() || S.imp.file.replace(/\.[^.]+$/, '') || 'Imported deck' });
        data.decks.push(d); id = d.id; made = true;
      }
      for (const c of p.cards) d.cards.push(FC.normCard(c));
    });
    S.deckId = id; S.view = 'deck';
    S.imp = { target: '', name: '', text: '', file: '' };
    S.impNote = '';
    S.flash = `Imported ${plural(p.cards.length, 'card')}${made ? ' into a new deck' : ''}${p.skipped ? `; ${plural(p.skipped, 'line')} skipped (a side was empty or the deck was full)` : ''}.`;
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
    S.flash = `Exported ${plural(d.cards.length, 'card')} as CSV (text only: pictures and schedules aren’t part of the file).`;
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
      const on = S.view !== 'stats' && S.view !== 'import' && d.id === S.deckId;
      g.append(h('button.side__item', { type: 'button', class: on ? 'is-on' : '', 'aria-current': on ? 'true' : null, dataset: { deck: d.id },
        onclick: () => { S.deckId = d.id; S.view = 'deck'; S.session = null; S.editing = null; S.picker = false; render(); } },
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
      h('button.side__item', { type: 'button', class: S.view === 'import' ? 'is-on' : '', dataset: { fk: 'open-import' }, onclick: () => { S.view = 'import'; S.session = null; render(); } }, icon('upload'), h('span', { text: 'Import CSV…' })),
      h('button.side__item', { type: 'button', class: S.view === 'stats' ? 'is-on' : '', dataset: { fk: 'open-stats' }, onclick: () => { S.view = 'stats'; S.session = null; render(); } }, icon('bar-chart'), h('span', { text: 'Stats' }))));
    const all = S.data.decks.flatMap(d => d.cards);
    const c = FC.counts(all, now);
    side.append(h('div.st-side__foot', h('div.side__meter', h('b', { dataset: { fk: 'due-total' }, text: `${c.due} due today` }), h('small', { text: all.length ? `${plural(all.length, 'card')} in ${plural(S.data.decks.length, 'deck')}` : 'No cards yet' })),
      h('div.st-side__note', { text: 'Saved on this device only.' })));
  }

  const bar = (...kids) => h('div.app__bar', ...kids);
  const flashLine = () => (S.flash ? h('div.st-flash', { role: 'status', dataset: { fk: 'flash' } }, icon('check'), h('span', { text: S.flash })) : null);

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
    const queued = FC.queue(d.cards, now).length;
    const title = S.renaming
      ? h('input.st-in.st-rename', { type: 'text', value: d.name, maxlength: '60', 'aria-label': 'Deck name', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); renameDeck(e.target.value); } else if (e.key === 'Escape') { S.renaming = false; render(); } }, ref: el => { S.focusEl = el; } })
      : h('button.app__title.st-title', { type: 'button', title: 'Rename deck', onclick: () => { S.renaming = true; render(); } }, h('span', { text: d.name }));
    main.append(bar(title, h('span.st-spacer'),
      h('button.ibtn', { type: 'button', 'aria-label': 'Deck actions', 'aria-haspopup': 'menu', onclick: e => menu([
        { label: 'Rename deck', icon: 'edit-3', onClick: () => { S.renaming = true; render(); } },
        { label: 'Export as CSV', icon: 'download', disabled: !d.cards.length, onClick: exportDeck },
        '-', { label: 'Delete deck', icon: 'trash', danger: true, onClick: deleteDeck }], e.clientX, e.clientY) }, icon('more-horizontal'))));

    const content = h('div.app__content.st-scroll');
    content.append(flashLine());
    content.append(h('div.st-stats', { role: 'group', 'aria-label': 'This deck' },
      stat('Due today', c.due, 'due-n'), stat('New', c.fresh, 'new-n'), stat('Learned', c.learned, 'learned-n'), stat('Cards', c.total, 'total-n')));
    content.append(h('div.st-row.st-actions',
      h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'study' }, disabled: !queued, onclick: () => startSession('review') }, icon('play'),
        h('span', { text: queued ? `Study ${plural(queued, 'card')}` : 'Nothing to study' })),
      h('button.btn', { type: 'button', dataset: { fk: 'cram' }, disabled: !d.cards.length, title: 'Every card in random order. Changes nothing in your schedule or stats.', onclick: () => startSession('cram') }, icon('shuffle'), h('span', { text: 'Cram (shuffle)' })),
      h('button.btn', { type: 'button', dataset: { fk: 'export' }, disabled: !d.cards.length, onclick: exportDeck }, icon('download'), h('span', { text: 'Export CSV' })),
      h('button.btn', { type: 'button', dataset: { fk: 'import-here' }, onclick: () => { S.imp.target = d.id; S.view = 'import'; render(); } }, icon('upload'), h('span', { text: 'Import…' }))));
    if (d.cards.length && !queued) {
      const next = d.cards.filter(x => x.due !== null).map(x => x.due).sort()[0];
      content.append(h('p.st-note', { text: next ? `Nothing is due today. The next card is due ${next === FC.addDays(FC.today(now), 1) ? 'tomorrow' : next}.` : 'Nothing is due today.' }));
    }

    /* add a card */
    const front = h('textarea.st-ta', { rows: '2', maxlength: '1000', placeholder: 'Front (question or term)', 'aria-label': 'Front of the new card', dataset: { fk: 'add-front' }, value: S.add.front, oninput: e => { S.add.front = e.target.value; } });
    const back = h('textarea.st-ta', { rows: '2', maxlength: '1000', placeholder: 'Back (answer)', 'aria-label': 'Back of the new card', dataset: { fk: 'add-back' }, value: S.add.back, oninput: e => { S.add.back = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addCard(); } } });
    front.value = S.add.front; back.value = S.add.back;
    if (S.focusFront) { S.focusEl = front; S.focusFront = false; }
    content.append(h('section.st-add', { 'aria-label': 'Add a card' },
      h('div.st-add__cols', front, back),
      S.add.img ? h('div.st-imgrow', thumb(S.add.img, 'st-thumb'), h('small', { text: S.add.img.split('/').pop() }), h('button.ibtn', { type: 'button', 'aria-label': 'Remove picture', onclick: () => { S.add.img = ''; render(); } }, icon('x'))) : null,
      S.picker ? picker(p => { S.add.img = p; S.picker = false; render(); }) : null,
      S.addNote ? h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: S.addNote })) : null,
      h('div.st-row',
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'add-pic' }, 'aria-expanded': S.picker ? 'true' : 'false', onclick: () => { S.picker = !S.picker; render(); } }, icon('image'), h('span', { text: S.add.img ? 'Change picture' : 'Add picture' })),
        h('span.st-spacer'), h('small.dim', { text: 'Ctrl/⌘+Enter adds' }),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'add-card' }, onclick: addCard }, icon('plus'), h('span', { text: 'Add card' })))));

    /* the cards */
    if (!d.cards.length) {
      content.append(h('div.empty', icon('layers'), h('b', { text: 'No cards yet' }), h('small', { text: 'Add one above, or import a CSV/TSV file.' })));
    } else {
      const list = h('div.st-list', { role: 'list', 'aria-label': 'Cards' });
      for (const card of d.cards) list.append(S.editing === card.id ? editRow(card) : cardRow(card, now));
      content.append(list);
    }
    main.append(content);
  }
  const stat = (label, n, fk) => h('div.st-stat', h('b', { dataset: { fk }, text: String(n) }), h('small', { text: label }));

  function cardRow(card, now) {
    const when = dueText(card, now);
    return h('div.st-card', { role: 'listitem', dataset: { card: card.id } },
      card.img ? thumb(card.img, 'st-thumb') : null,
      h('div.st-card__t', h('b', { text: card.front || '(picture)' }), h('span', { text: card.back })),
      h('span.st-due', { class: card.due === null ? 'is-new' : card.due <= FC.today(now) ? 'is-due' : '', text: when }),
      h('button.ibtn', { type: 'button', 'aria-label': `Edit card: ${card.front}`, onclick: () => { S.editing = card.id; S.focusEdit = true; render(); } }, icon('edit-3')),
      h('button.ibtn', { type: 'button', 'aria-label': `Delete card: ${card.front}`, onclick: () => deleteCard(card.id) }, icon('trash')));
  }
  function editRow(card) {
    const f = h('textarea.st-ta', { rows: '2', maxlength: '1000', 'aria-label': 'Front', dataset: { fk: 'edit-front' } });
    const b = h('textarea.st-ta', { rows: '2', maxlength: '1000', 'aria-label': 'Back', dataset: { fk: 'edit-back' } });
    f.value = card.front; b.value = card.back;
    let img = card.img;
    const holder = h('div.st-imgrow');
    const paint = () => { clear(holder); if (img) holder.append(thumb(img, 'st-thumb'), h('button.btn.btn--sm', { type: 'button', onclick: () => { img = ''; paint(); } }, icon('x'), h('span', { text: 'Remove picture' }))); };
    paint();
    if (S.focusEdit) { S.focusEl = f; S.focusEdit = false; }
    return h('div.st-card.is-editing', { role: 'listitem', dataset: { card: card.id } },
      h('div.st-edit', h('div.st-add__cols', f, b), holder,
        h('div.st-row', h('span.st-spacer'),
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'edit-save' }, onclick: () => saveEdit(card.id, f.value, b.value, img) }, icon('check'), h('span', { text: 'Save' })),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.editing = null; render(); } }, h('span', { text: 'Cancel' })))));
  }

  /* ---- study ---- */
  function renderStudy() {
    const s = S.session;
    const d = S.data.decks.find(x => x.id === s.deckId);
    const cram = s.kind === 'cram';
    main.append(bar(h('button.ibtn', { type: 'button', 'aria-label': 'Back to the deck', dataset: { fk: 'exit' }, onclick: endSession }, icon('chevron-left')),
      h('div.app__title', { text: `${cram ? 'Cram' : 'Study'}: ${d ? d.name : ''}` }), h('span.st-spacer'),
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
    const canSpeak = speech.supported();
    const face = s.flipped ? c.back : c.front;
    content.append(h('div.st-study', { 'aria-live': 'polite' },
      h('div.st-face', { dataset: { fk: 'face' }, class: s.flipped ? 'is-back' : 'is-front' },
        h('small.st-face__side', { text: s.flipped ? 'Back' : 'Front' }),
        !s.flipped && c.img ? thumb(c.img, 'st-face__img') : null,
        h('div.st-face__text', { text: face || (c.img && !s.flipped ? '' : '') })),
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
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'speak' }, disabled: !canSpeak, title: canSpeak ? 'Read the visible side aloud' : speech.MISSING, onclick: readAloud }, icon('volume-2'), h('span', { text: 'Read aloud' })),
        canSpeak ? null : h('small.dim', { dataset: { fk: 'speak-missing' }, text: 'Read aloud isn’t available: this browser has no speech synthesis.' }),
        h('span.st-spacer'),
        h('small.dim', { text: cram ? 'Space flips · 1 again · 2 got it' : 'Space flips · 1–4 grade' }))));
    main.append(content);
  }

  /* ---- import ---- */
  function renderImport() {
    main.append(bar(h('div.app__title', { text: 'Import cards' })));
    const p = S.imp.text.trim() ? previewImport() : null;
    const sel = h('select.select.st-sel', { 'aria-label': 'Add the cards to', dataset: { fk: 'imp-target' }, onchange: e => { S.imp.target = e.target.value; render(); } },
      h('option', { value: '', text: 'A new deck', selected: S.imp.target === '' }), S.data.decks.map(d => h('option', { value: d.id, text: `${d.name} (${plural(d.cards.length, 'card')})`, selected: d.id === S.imp.target })));
    const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain', 'aria-label': 'Choose a CSV or TSV file', dataset: { fk: 'imp-file' },
      onchange: async e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 4 * 1024 * 1024) { S.impNote = 'That file is over 4 MB; a deck file is much smaller than that.'; render(); return; }
        S.imp.text = await f.text(); S.imp.file = f.name; S.impNote = '';
        if (!S.imp.name) S.imp.name = f.name.replace(/\.[^.]+$/, '');
        render();
      } });
    const ta = h('textarea.st-ta.st-ta--big', { rows: '8', placeholder: 'front,back\nbonjour,hello\n“la maison”,the house', 'aria-label': 'Or paste cards here', dataset: { fk: 'imp-text' }, oninput: e => { S.imp.text = e.target.value; refreshPreview(); } });
    ta.value = S.imp.text;
    const prev = h('div.st-preview', { role: 'status', dataset: { fk: 'imp-preview' } });
    const go = h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'imp-go' }, onclick: doImport }, icon('upload'), h('span', { text: 'Import' }));
    function refreshPreview() {
      const q = S.imp.text.trim() ? previewImport() : null;
      prev.textContent = q ? `${plural(q.cards.length, 'card')} found${q.skipped ? `, ${plural(q.skipped, 'line')} skipped` : ''} (${q.delimiter === '\t' ? 'tab' : 'comma'}-separated${q.header ? ', header row left out' : ''}).` : 'Choose a file or paste text to see how many cards it holds.';
      go.disabled = !q || !q.cards.length;
    }
    refreshPreview();
    main.append(h('div.app__content.st-scroll', h('div.st-import',
      h('p.st-note', { text: 'One card per line: the front, then the back, separated by a comma or a tab (a spreadsheet’s CSV or TSV export). A first line of “front,back” is treated as a header. Put text containing commas in "quotes".' }),
      h('label.st-f', h('span.st-f__l', { text: 'Add to' }), sel),
      S.imp.target === '' ? h('label.st-f', h('span.st-f__l', { text: 'New deck name' }), h('input.st-in', { type: 'text', maxlength: '60', placeholder: 'Imported deck', value: S.imp.name, 'aria-label': 'New deck name', dataset: { fk: 'imp-name' }, oninput: e => { S.imp.name = e.target.value; } })) : null,
      h('label.st-f', h('span.st-f__l', { text: 'File' }), file), ta, prev,
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
      h('p.st-note', { text: 'Learned means a card you have answered correctly at least once and not forgotten since. Everything here is counted from your cards and from the reviews you actually graded; cram rounds are not counted.' }),
      h('details.st-how', h('summary', { text: 'How cards are scheduled' }),
        h('p', { text: 'Again: the card comes back in this session, due today, and its ease drops 0.20. Hard, Good and Easy are passes: the first pass in a row is 1, 1 or 3 days; the second 3, 6 or 8 days; after that the last interval × 1.2 (Hard), × ease (Good) or × ease × 1.3 (Easy), always at least a day longer. Ease starts at 2.5 and moves −0.14 (Hard), 0 (Good), +0.10 (Easy), never below 1.3.' }))));
  }

  /* ---------- render ---------- */
  function render() {
    if (S.dead) return;
    S.focusEl = null;
    /* a message shows for one render after it was set, then goes */
    if (S.flash && S.flashSeen) { S.flash = ''; S.flashSeen = false; } else if (S.flash) S.flashSeen = true;
    clear(main);
    renderSide();
    if (S.view === 'study' && S.session) renderStudy();
    else if (S.view === 'stats') renderStats();
    else if (S.view === 'import') renderImport();
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
    if (e.key === ' ' || e.code === 'Space') {
      /* Space on a focused button would also click it: flipping here is the same thing, so don't do both */
      e.preventDefault();
      if (!s.flipped) flip();
      return;
    }
    if (s.kind === 'review' && /^[1-4]$/.test(e.key)) { if (s.flipped) { e.preventDefault(); grade(FC.GRADES[+e.key - 1]); } }
    else if (s.kind === 'cram' && (e.key === '1' || e.key === '2')) { if (s.flipped) { e.preventDefault(); grade(e.key === '1' ? 'again' : 'got'); } }
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
    /* the shell asks for these */
    open(o) { if (o && o.deck && S.data.decks.some(d => d.id === o.deck)) { S.deckId = o.deck; S.view = 'deck'; render(); } },
  };
}
