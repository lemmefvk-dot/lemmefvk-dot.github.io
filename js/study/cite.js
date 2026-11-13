/* ============================================================
   study/cite.js — the Cite tab of Static Study.

   Type the fields of a website, book, journal article or video and get
   the reference in MLA 9, APA 7 or Chicago 17, with the italics the style
   asks for. Nothing is looked up: the formatter (js/core/citations.js)
   only arranges what is typed. Copy puts text/html (italics kept) and a
   plain-text version on the clipboard. Saved sources are kept in
   store('portal.citations') as fields, so changing the style re-sorts
   and re-formats the whole list.
   ============================================================ */
import * as C from '../core/citations.js';

const KEY = 'portal.citations';
const MAX = 300;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* [field, label, wide, only types, only styles] */
const FIELDS = [
  ['title', 'Title', true, null],
  ['journal', 'Journal name', true, ['article']],
  ['site', 'Website name', false, ['website']],
  ['site', 'Video site', false, ['video']],
  ['uploader', 'Channel or uploader', false, ['video']],
  ['edition', 'Edition (e.g. 2nd)', false, ['book']],
  ['publisher', 'Publisher', false, ['book', 'website']],
  ['city', 'City (Chicago only)', false, ['book'], ['chicago']],
  ['volume', 'Volume', false, ['article']],
  ['issue', 'Issue', false, ['article']],
  ['pages', 'Pages (e.g. 127-53)', false, ['article']],
  ['length', 'Length (Chicago, e.g. 6:00)', false, ['video'], ['chicago']],
  ['url', 'URL', true, ['website', 'article', 'video']],
  ['doi', 'DOI', false, ['article']],
];
const blank = type => ({ type, authors: [{ first: '', last: '' }], title: '', site: type === 'video' ? 'YouTube' : '', publisher: '', city: '', edition: '', journal: '', volume: '', issue: '', pages: '', year: '', month: '', day: '', accessed: '', url: '', doi: '', uploader: '', length: '' });

async function copyRich(html, text) {
  try {
    if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem === 'function') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      return 'rich';
    }
  } catch (e) { /* fall back to plain text */ }
  try { await navigator.clipboard.writeText(text); return 'plain'; } catch (e) { /* last resort below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok ? 'plain' : 'failed';
  } catch (e) { return 'failed'; }
}

export function mountCite(host, ctx) {
  const { api } = ctx;
  const { h, icon, store, clear, confirm } = api;
  const saved = store.get(KEY) || {};
  const S = {
    style: C.STYLES.some(s => s[0] === saved.style) ? saved.style : 'mla',
    list: Array.isArray(saved.sources) ? saved.sources : [],
    src: blank('website'), editing: null, dead: false,
  };
  const persist = () => { try { store.set(KEY, { style: S.style, sources: S.list }); } catch (e) { /* fine */ } };

  const runsNode = (runs, tag = 'span') => h(tag, ...runs.map(r => (r.i ? h('i', { text: r.t }) : r.t)));
  const say = (el, msg) => { el.textContent = msg; };

  /* ---------- style and type ---------- */
  const styleBar = h('div.tabs.st-c__styles', { role: 'radiogroup', 'aria-label': 'Citation style' });
  const typeSel = h('select.select.st-sel', { dataset: { fk: 'cite-type' }, 'aria-label': 'Source type', onchange: e => { S.src.type = e.target.value; if (S.src.type === 'video' && !S.src.site) S.src.site = 'YouTube'; paintForm(); paintPreview(); } },
    C.TYPES.map(([v, l]) => h('option', { value: v, text: l })));
  function paintStyles() {
    clear(styleBar);
    for (const [v, l] of C.STYLES) {
      styleBar.append(h('button', { type: 'button', role: 'radio', 'aria-checked': S.style === v ? 'true' : 'false', class: S.style === v ? 'is-on' : '', dataset: { fk: `style-${v}` },
        onclick: () => { S.style = v; persist(); paintStyles(); paintForm(); paintPreview(); paintList(); } }, h('span', { text: l })));
    }
  }

  /* ---------- the form ---------- */
  const form = h('div.st-c__form');
  const authorsBox = h('div.st-c__authors');
  function paintAuthors() {
    clear(authorsBox);
    S.src.authors.forEach((a, k) => {
      const f = h('input.st-in', { type: 'text', value: a.first, placeholder: 'First name', 'aria-label': `Author ${k + 1} first name`, dataset: { fk: `a-first-${k}` }, oninput: e => { a.first = e.target.value; paintPreview(); } });
      const l = h('input.st-in', { type: 'text', value: a.last, placeholder: 'Last name (or organisation)', 'aria-label': `Author ${k + 1} last name or organisation`, dataset: { fk: `a-last-${k}` }, oninput: e => { a.last = e.target.value; paintPreview(); } });
      authorsBox.append(h('div.st-crow', f, l, S.src.authors.length > 1 ? h('button.ibtn', { type: 'button', 'aria-label': `Remove author ${k + 1}`, dataset: { fk: `a-del-${k}` }, onclick: () => { S.src.authors.splice(k, 1); paintAuthors(); paintPreview(); } }, icon('trash')) : null));
    });
  }
  function paintForm() {
    const s = S.src;
    typeSel.value = s.type;
    clear(form);
    paintAuthors();
    form.append(
      h('div.st-f', h('span.st-f__l', { text: s.type === 'video' ? 'Creators (optional)' : 'Authors' }), authorsBox,
        h('div.st-row', h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'add-author' }, onclick: () => { s.authors.push({ first: '', last: '' }); paintAuthors(); const ins = authorsBox.querySelectorAll('input'); if (ins.length > 1) ins[ins.length - 2].focus(); } }, icon('plus'), h('span', { text: 'Add author' })))));
    const grid = h('div.st-form__grid');
    for (const [key, label, wide, types, styles] of FIELDS) {
      if (types && !types.includes(s.type)) continue;
      if (styles && !styles.includes(S.style)) continue;
      const id = `cite-${key}`;
      grid.append(h('label.st-f', { style: wide ? 'grid-column: 1 / -1' : '' }, h('span.st-f__l', { text: label }),
        h('input.st-in', { type: 'text', value: s[key] || '', dataset: { fk: `f-${key}` }, id, oninput: e => { s[key] = e.target.value; paintPreview(); } })));
    }
    const month = h('select.select.st-sel', { dataset: { fk: 'f-month' }, 'aria-label': 'Month', onchange: e => { s.month = e.target.value; paintPreview(); } },
      h('option', { value: '', text: 'Month' }), MONTHS.map((m, k) => h('option', { value: String(k + 1), text: m })));
    month.value = s.month ? String(s.month) : '';
    form.append(grid,
      h('div.st-f', h('span.st-f__l', { text: 'Published' }),
        h('div.st-row',
          h('input.st-in', { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'Year', value: s.year, 'aria-label': 'Year', style: 'width:80px', dataset: { fk: 'f-year' }, oninput: e => { s.year = e.target.value; paintPreview(); } }),
          month,
          h('input.st-in', { type: 'text', inputmode: 'numeric', maxlength: '2', placeholder: 'Day', value: s.day, 'aria-label': 'Day', style: 'width:60px', dataset: { fk: 'f-day' }, oninput: e => { s.day = e.target.value; paintPreview(); } }))),
      s.type === 'website' ? h('label.st-f', h('span.st-f__l', { text: 'Date you visited it (optional)' }),
        h('input.st-in', { type: 'date', value: s.accessed, dataset: { fk: 'f-accessed' }, style: 'max-width:180px', onchange: e => { s.accessed = e.target.value; paintPreview(); }, oninput: e => { s.accessed = e.target.value; paintPreview(); } })) : null);
  }

  /* ---------- preview, copy, save ---------- */
  const preview = h('div.st-c__prev', { dataset: { fk: 'cite-preview' }, 'aria-live': 'polite' });
  const msg = h('small.dim', { role: 'status', dataset: { fk: 'cite-msg' } });
  const saveBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'cite-save' }, onclick: () => saveSource() });
  const cancelBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'cite-cancel' }, onclick: () => { S.editing = null; S.src = blank(S.src.type); paintForm(); paintPreview(); } }, h('span', { text: 'Cancel edit' }));
  function paintPreview() {
    const f = C.format(S.src, S.style);
    clear(preview);
    if (f.empty) preview.append(h('small.dim', { text: 'Fill in the title to see the citation.' }));
    else preview.append(runsNode(f.runs));
    preview.classList.toggle('is-empty', f.empty);
    clear(saveBtn); saveBtn.append(icon(S.editing ? 'check' : 'plus'), h('span', { text: S.editing ? 'Update in list' : 'Add to list' }));
    cancelBtn.hidden = !S.editing;
  }
  async function copyOne(runs, target) {
    const how = await copyRich(`<p>${C.toHtml(runs)}</p>`, C.toText(runs));
    say(target, how === 'rich' ? 'Copied, with italics.' : how === 'plain' ? 'Copied as plain text (this browser would not copy italics).' : 'The browser would not let this copy. Select the citation and press Ctrl+C.');
  }
  function saveSource() {
    const f = C.format(S.src, S.style);
    if (f.empty) { say(msg, 'Add a title first.'); return; }
    if (S.editing) {
      const i = S.list.findIndex(x => x.id === S.editing);
      if (i >= 0) S.list[i] = { ...JSON.parse(JSON.stringify(S.src)), id: S.editing };
    } else {
      if (S.list.length >= MAX) { say(msg, `The list holds ${MAX} sources. Delete one to add another.`); return; }
      S.list.push({ ...JSON.parse(JSON.stringify(S.src)), id: uid() });
    }
    persist();
    say(msg, S.editing ? 'Updated.' : 'Added to the list.');
    S.editing = null;
    S.src = blank(S.src.type);
    paintForm(); paintPreview(); paintList();
  }

  /* ---------- the saved list ---------- */
  const listBox = h('div.st-c__list', { dataset: { fk: 'cite-list' } });
  const listMsg = h('small.dim', { role: 'status', dataset: { fk: 'list-msg' } });
  function paintList() {
    clear(listBox);
    const b = C.bibliography(S.list, S.style);
    listBox.append(h('div.st-row', h('h3.st-h', { dataset: { fk: 'list-heading' }, text: b.heading }), h('span.st-spacer'),
      b.items.length ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'list-copy-all' }, onclick: async () => {
        const how = await copyRich(C.listHtml(b.items), C.listText(b.items));
        say(listMsg, how === 'rich' ? `Copied ${b.items.length} entries, with italics.` : how === 'plain' ? 'Copied as plain text.' : 'The browser would not let this copy.');
      } }, icon('copy'), h('span', { text: 'Copy list' })) : null, listMsg));
    if (!b.items.length) { listBox.append(h('p.st-none', { text: `Nothing saved yet. Build a citation above and choose Add to list; the list is kept in ${C.HEADINGS[S.style].toLowerCase()} order for the style you pick.` })); return; }
    const ol = h('div.st-c__items', { role: 'list' });
    for (const it of b.items) {
      ol.append(h('div.st-c__item', { role: 'listitem', dataset: { id: it.id } },
        runsNode(it.runs, 'p.st-c__txt'),
        h('div.st-row',
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'list-copy' }, onclick: () => copyOne(it.runs, listMsg) }, icon('copy'), h('span', { text: 'Copy' })),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'list-edit' }, onclick: () => {
            const s = S.list.find(x => x.id === it.id);
            if (!s) return;
            S.src = JSON.parse(JSON.stringify(s)); S.editing = s.id; paintForm(); paintPreview();
            form.scrollIntoView && form.scrollIntoView({ block: 'nearest' });
          } }, icon('edit-3'), h('span', { text: 'Edit' })),
          h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'list-del' }, onclick: async () => {
            const ok = await confirm({ title: 'Remove this source?', message: 'It is removed from your saved list.', ok: 'Remove', danger: true });
            if (!ok || S.dead) return;
            S.list = S.list.filter(x => x.id !== it.id);
            if (S.editing === it.id) { S.editing = null; S.src = blank(S.src.type); paintForm(); paintPreview(); }
            persist(); paintList();
          } }, icon('trash'), h('span', { text: 'Remove' })))));
    }
    listBox.append(ol);
  }

  const copyBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'cite-copy' }, onclick: () => {
    const f = C.format(S.src, S.style);
    if (f.empty) { say(msg, 'Add a title first.'); return; }
    copyOne(f.runs, msg);
  } }, icon('copy'), h('span', { text: 'Copy citation' }));

  const root = h('div.st-c.st-scroll', { dataset: { fk: 'cite' } },
    h('p.st-note', { text: 'Type the details of your source; nothing is looked up. Words you put between *asterisks* in a title are italicised. Check the result against your teacher’s guide: MLA 9, APA 7 and Chicago 17 (notes-bibliography) are applied as written, but a title’s proper nouns are only kept if you type them capitalised.' }),
    h('div.st-row', styleBar, h('label.st-inline', h('span.st-f__l', { text: 'Source' }), typeSel)),
    h('div.st-c__cols', form, h('div.st-c__side',
      h('span.st-f__l', { text: 'Citation' }), preview,
      h('div.st-row', copyBtn, saveBtn, cancelBtn), msg)),
    listBox);
  host.appendChild(root);
  paintStyles(); paintForm(); paintPreview(); paintList();

  return { open() {}, teardown() { S.dead = true; } };
}
