/* ============================================================
   study/books.js — the Reading tab of Static Study (#212).

   Books you add by hand: title, author, how many pages or chapters,
   where you are, and a status (want to read, reading, finished) with
   a finish date and notes of your own. A book's picture is a colour
   tile made from its title; nothing is looked up online and nothing
   is shown that wasn't typed in or counted from what was typed (the
   tab headings count the list, a percentage is position ÷ total).

   Why Static Study: a reading list is school work (set books, wider
   reading), and the tab already holds the other things a student
   keeps — homework, flashcards, the Words tab. The rules and the
   saved list are in js/core/books.js.
   ============================================================ */
import * as BK from '../core/books.js';

const TABS = [['all', 'All'], ['want', 'Want to read'], ['reading', 'Reading'], ['finished', 'Finished']];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mountBooks(host, ctx) {
  const { api } = ctx;
  const { h, icon, clear, confirm } = api;
  const S = { books: BK.read(), tab: 'all', form: null, note: '', dead: false, focusEl: null };
  const root = h('div.st-bk');
  host.appendChild(root);

  const refresh = () => { S.books = BK.read(); };
  function save(next) { BK.write(next); refresh(); }
  const byId = id => S.books.find(b => b.id === id) || null;

  const blank = () => ({ id: '', title: '', author: '', unit: 'pages', total: '', pos: '', status: 'want', finished: '', notes: '', issues: [] });
  function edit(b) { S.form = { id: b.id, title: b.title, author: b.author, unit: b.unit, total: b.total ? String(b.total) : '', pos: b.pos ? String(b.pos) : '', status: b.status, finished: b.finished, notes: b.notes, issues: [] }; S.focusTitle = true; render(); }

  function submit() {
    const f = S.form;
    const probs = BK.issues(f, S.books);
    if (probs.length) { f.issues = probs; render(); return; }
    const old = byId(f.id);
    const draft = { ...f, added: old ? old.added : Date.now() };
    let said = '';
    /* a finished book has a finish date (today unless you picked one) and has been read to the end */
    if (draft.status === 'finished') {
      if (!draft.finished) draft.finished = BK.today();
      if (BK.norm(draft).total && !(old && old.status === 'finished')) { draft.pos = String(BK.norm(draft).total); said = ' Position set to the end.'; }
    }
    const rec = BK.norm({ ...draft, id: f.id || BK.uid() });
    save(f.id ? S.books.map(b => (b.id === f.id ? rec : b)) : [rec, ...S.books]);
    S.note = `${f.id ? 'Saved' : 'Added'} “${rec.title}”.${said}`;
    S.form = null;
    S.tab = S.tab === 'all' || S.tab === rec.status ? S.tab : rec.status;
    render();
  }
  /** Where you are now: the quick box on a reading book. */
  function setPos(b, raw) {
    const v = String(raw).trim();
    const probs = BK.issues({ ...b, pos: v, total: b.total || '' }, S.books);
    const bad = probs.find(p => p.at === 'pos' || p.at === 'total');
    if (bad || v === '') { S.note = bad ? bad.text : `Type the ${b.unit === 'chapters' ? 'chapter' : 'page'} you are on.`; S.noteBad = true; render(); return; }
    save(S.books.map(x => (x.id === b.id ? BK.norm({ ...x, pos: v, status: x.status === 'want' ? 'reading' : x.status }) : x)));
    S.note = `“${b.title}”: ${BK.progressText(byId(b.id)).toLowerCase()}.`;
    render();
  }
  function setStatus(b, status) {
    save(S.books.map(x => {
      if (x.id !== b.id) return x;
      const y = { ...x, status };
      if (status === 'finished') { y.finished = BK.today(); if (x.total) y.pos = x.total; } else y.finished = '';
      return BK.norm(y);
    }));
    S.note = status === 'finished' ? `Finished “${b.title}”, ${BK.today()}.` : `“${b.title}” is now “${BK.STATUS.find(s => s[0] === status)[1].toLowerCase()}”.`;
    if (S.tab !== 'all') S.tab = status;
    render();
  }
  async function remove(b) {
    const ok = await confirm({ title: `Remove “${b.title}”?`, message: 'The book and your notes on it are deleted. This can’t be undone.', ok: 'Remove', danger: true });
    if (!ok || S.dead) return;
    save(S.books.filter(x => x.id !== b.id));
    if (S.form && S.form.id === b.id) S.form = null;
    S.note = `Removed “${b.title}”.`;
    render();
  }

  function card(b) {
    const t = BK.tile(b.title);
    const p = BK.percent(b);
    const label = BK.STATUS.find(s => s[0] === b.status)[1];
    const pos = h('input.st-in', { type: 'number', min: '0', max: b.total ? String(b.total) : null, step: '1', 'aria-label': `${b.unit === 'chapters' ? 'Chapter' : 'Page'} you are on in ${b.title}`, dataset: { fk: 'bk-pos' }, style: { width: '84px' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); setPos(b, pos.value); } } });
    pos.value = b.pos ? String(b.pos) : '';
    return h('article.st-book', { class: `is-${b.status}${S.form && S.form.id === b.id ? ' is-open' : ''}`, dataset: { id: b.id, status: b.status }, 'aria-label': b.title },
      h('div.st-tile', { style: { background: t.bg }, 'aria-hidden': 'true', dataset: { hue: String(t.hue) }, text: t.initials }),
      h('div.st-book__main',
        h('div.st-book__t', { text: b.title }),
        h('div.st-book__m',
          b.author ? h('span', { dataset: { fk: 'bk-author' }, text: b.author }) : null,
          h('span.st-badge', { class: `is-${b.status}`, text: label }),
          h('span', { dataset: { fk: 'bk-progress' }, text: BK.progressText(b) }),
          b.status === 'finished' && b.finished ? h('span', { dataset: { fk: 'bk-finished' }, text: `on ${new Date(+b.finished.slice(0, 4), +b.finished.slice(5, 7) - 1, +b.finished.slice(8)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` }) : null),
        p !== null ? h('div.st-pbar', { role: 'progressbar', 'aria-label': `${b.title} progress`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p) }, h('i', { style: { width: `${p}%` } })) : null,
        b.notes ? h('div.st-as__n', { dataset: { fk: 'bk-notes' }, text: b.notes }) : null,
        b.status !== 'finished' ? h('div.st-row',
          h('label.st-row', h('span.st-f__l', { text: b.unit === 'chapters' ? 'Chapter now' : 'Page now' }), pos),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'bk-update' }, 'aria-label': `Update position in ${b.title}`, onclick: () => setPos(b, pos.value) }, 'Update')) : null),
      h('div.st-book__acts',
        b.status === 'want' ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'bk-start' }, onclick: () => setStatus(b, 'reading') }, icon('play'), h('span', { text: 'Start reading' })) : null,
        b.status === 'reading' ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'bk-finish' }, onclick: () => setStatus(b, 'finished') }, icon('check'), h('span', { text: 'Mark finished' })) : null,
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'bk-edit' }, 'aria-label': `Edit ${b.title}`, onclick: () => edit(b) }, icon('edit-3'), h('span', { text: 'Edit' })),
        h('button.ibtn', { type: 'button', dataset: { fk: 'bk-delete' }, 'aria-label': `Remove ${b.title}`, onclick: () => remove(b) }, icon('trash'))));
  }

  function form() {
    const f = S.form;
    const issue = k => (f.issues || []).filter(i => i.at === k);
    const fld = (label, el, wide) => h('label.st-f', { class: wide ? 'st-wide' : '' }, h('span.st-f__l', { text: label }), el);
    const title = h('input.st-in', { type: 'text', maxlength: '200', placeholder: 'Title', 'aria-label': 'Title', dataset: { fk: 'bf-title' }, oninput: e => { f.title = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } });
    title.value = f.title;
    if (S.focusTitle) { S.focusEl = title; S.focusTitle = false; }
    const author = h('input.st-in', { type: 'text', maxlength: '120', placeholder: 'Author (optional)', 'aria-label': 'Author', dataset: { fk: 'bf-author' }, oninput: e => { f.author = e.target.value; } });
    author.value = f.author;
    const unit = h('select.select.st-sel', { 'aria-label': 'Counted in', dataset: { fk: 'bf-unit' }, onchange: e => { f.unit = e.target.value; } }, BK.UNITS.map(([v, l]) => h('option', { value: v, text: l, selected: v === f.unit })));
    const total = h('input.st-in', { type: 'number', min: '0', step: '1', placeholder: 'Unknown', 'aria-label': 'Total pages or chapters', dataset: { fk: 'bf-total' }, oninput: e => { f.total = e.target.value; } });
    total.value = f.total;
    const pos = h('input.st-in', { type: 'number', min: '0', step: '1', placeholder: 'Not started', 'aria-label': 'Where you are now', dataset: { fk: 'bf-pos' }, oninput: e => { f.pos = e.target.value; } });
    pos.value = f.pos;
    const finished = h('input.st-in', { type: 'date', 'aria-label': 'Date finished', dataset: { fk: 'bf-finished' }, oninput: e => { f.finished = e.target.value; } });
    finished.value = f.finished;
    const finWrap = fld('Finished on', finished);
    finWrap.hidden = f.status !== 'finished';
    const status = h('select.select.st-sel', { 'aria-label': 'Status', dataset: { fk: 'bf-status' }, onchange: e => { f.status = e.target.value; finWrap.hidden = f.status !== 'finished'; } },
      BK.STATUS.map(([v, l]) => h('option', { value: v, text: l, selected: v === f.status })));
    const notes = h('textarea.st-ta', { rows: '3', maxlength: '4000', placeholder: 'Your notes on this book (optional)', 'aria-label': 'Notes', dataset: { fk: 'bf-notes' }, oninput: e => { f.notes = e.target.value; } });
    notes.value = f.notes;
    return h('section.st-form', { 'aria-label': f.id ? 'Edit book' : 'Add a book' },
      fld('Title', title, true), fld('Author', author), fld('Status', status),
      fld('Counted in', unit), fld('Total', total), fld('Where you are now', pos), finWrap,
      fld('Notes', notes, true),
      (f.issues || []).length ? h('div.st-wide', (f.issues).map(i => h('p.st-issue', { role: 'alert', dataset: { fk: 'bf-issue' } }, icon('alert'), h('span', { text: ` ${i.text}` })))) : null,
      h('div.st-row.st-wide', h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'bf-cancel' }, onclick: () => { S.form = null; render(); } }, 'Cancel'),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'bf-save' }, onclick: submit }, icon('check'), h('span', { text: f.id ? 'Save' : 'Add book' }))));
  }

  function render() {
    if (S.dead) return;
    S.focusEl = null;
    clear(root);
    const c = BK.counts(S.books);
    const tabs = h('div.tabs', { role: 'tablist', 'aria-label': 'Reading list views' }, TABS.map(([v, l]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === v ? 'true' : 'false', class: S.tab === v ? 'is-on' : '', dataset: { view: v }, onclick: () => { S.tab = v; render(); } },
        h('span', { text: `${l} ${c[v]}` }))));
    root.append(h('div.st-bk__tabs', tabs, h('span.st-spacer'),
      h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'bk-add' }, onclick: () => { S.form = blank(); S.focusTitle = true; render(); } }, icon('plus'), h('span', { text: 'Add a book' }))));
    const body = h('div.st-bk__scroll');
    if (S.note) { body.append(h('div.st-flash', { role: 'status', dataset: { fk: 'bk-note' } }, icon(S.noteBad ? 'alert' : 'check'), h('span', { text: S.note }))); S.note = ''; S.noteBad = false; }
    if (S.form) body.append(form());
    const list = BK.view(S.books, S.tab);
    if (!S.books.length) body.append(h('div.empty', icon('bookmark'), h('b', { text: 'Your reading list is empty' }), h('small', { text: 'Add a book you are reading or want to read. You type in the details; nothing is looked up online.' })));
    else if (!list.length) body.append(h('p.st-none', { text: `Nothing under “${TABS.find(t => t[0] === S.tab)[1]}” yet.` }));
    else {
      body.append(h('p.st-sum', { dataset: { fk: 'bk-sum' }, text: plural(list.length, 'book') }));
      for (const b of list) body.append(card(b));
    }
    root.append(body);
    const el = S.focusEl;
    if (el) requestAnimationFrame(() => { try { if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return; el.focus(); } catch (e) { /* fine */ } });
  }
  render();

  return { teardown() { S.dead = true; }, open() { /* nothing to jump to */ } };
}
