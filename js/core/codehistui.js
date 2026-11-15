/* ============================================================
   codehistui.js — Static Code's Version history panel.

   historyPanel({ h, icon, clear, render, dir, title, now(), restoreFile(path, text),
                  restoreAll(files), save(name), onClose }) -> { el, refresh(), dispose() }

   The versions core/codehist.js keeps for one project, newest first.
   Pick one to see its files and how each differs from the file now
   (a line-by-line comparison: − lines are only in that version, +
   lines only in the file now). From there one file, or the whole
   project, can be put back the way it was; Code keeps a version of
   how things are first, so a restore can be undone the same way.
   Every line is added as text, never as HTML.
   ============================================================ */
import * as Hist from './codehist.js';

/** Lines of a and b lined up: [{ t: ' ' | '-' | '+', text }], or null when the files are too big to compare. */
export function lineDiff(a, b, maxCells = 2_000_000) {
  const A0 = String(a).split('\n'), B0 = String(b).split('\n');
  let s = 0;
  while (s < A0.length && s < B0.length && A0[s] === B0[s]) s++;
  let ea = A0.length, eb = B0.length;
  while (ea > s && eb > s && A0[ea - 1] === B0[eb - 1]) { ea--; eb--; }
  const A = A0.slice(s, ea), B = B0.slice(s, eb);
  const n = A.length, m = B.length;
  if (n * m > maxCells || n > 65000 || m > 65000) return null;
  const L = [];
  for (let i = 0; i <= n; i++) L.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = A0.slice(0, s).map(text => ({ t: ' ', text }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: ' ', text: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', text: A[i++] });
    else out.push({ t: '+', text: B[j++] });
  }
  while (i < n) out.push({ t: '-', text: A[i++] });
  while (j < m) out.push({ t: '+', text: B[j++] });
  for (const text of A0.slice(ea)) out.push({ t: ' ', text });
  return out;
}

const when = t => {
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
};
const what = v => v.name || (v.reason === 'first' ? 'Before your first save'
  : v.reason === 'restore' ? 'Before a restore'
  : v.reason === 'manual' ? 'Saved by hand'
  : v.file ? `Saved ${v.file}` : 'Saved');

export function historyPanel({ h, icon, clear, render, dir, title, now, restoreFile, restoreAll, save, onClose }) {
  const list = h('div.chs__list', { role: 'listbox', 'aria-label': 'Versions, newest first' });
  const files = h('div.chs__files', { role: 'list', 'aria-label': 'Files in this version' });
  const view = h('div.chs__view');
  const S = { versions: [], sel: null, files: null, file: null, dead: false, seq: 0 };

  const el = h('section.csh.chs', { role: 'region', 'aria-label': 'Version history' },
    h('header.chs__head', icon('clock'), h('div.chs__titles', h('b', { text: 'Version history' }), h('small.dim', { text: title })), h('div.grow'),
      h('button.btn.btn--sm', { type: 'button', 'data-act': 'hist-save', onclick: () => save().then(() => refresh()) }, icon('save'), h('span', { text: 'Save a version now' })),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'hist-close', onclick: () => onClose() }, icon('x'), h('span', { text: 'Close' }))),
    h('div.chs__main', h('aside.chs__side', h('div.side__label', { text: 'Versions' }), list), h('aside.chs__side.chs__side--files', h('div.side__label', { text: 'Files' }), files), view));

  async function refresh() {
    const my = ++S.seq;
    S.versions = await Hist.list(dir);
    if (S.dead || my !== S.seq) return;
    clear(list);
    if (!S.versions.length) {
      list.append(h('div.chs__none', { text: 'No versions yet. Code keeps one each time you save a file of this project, or when you press Save a version now.' }));
      clear(files); render(view, h('div.chs__idle', icon('clock'), h('small', { text: 'Nothing to show yet.' })));
      return;
    }
    for (const v of S.versions) {
      const b = h('button.chs__ver', { type: 'button', role: 'option', 'aria-selected': String(v.id === S.sel), 'data-ver': v.id, onclick: () => pick(v.id) },
        h('b', { text: when(v.t) }), h('span', { text: what(v) }), h('small.dim', { text: `${v.count} file${v.count === 1 ? '' : 's'}` }));
      list.append(b);
    }
    if (!S.sel || !S.versions.some(v => v.id === S.sel)) pick(S.versions[0].id);
    else pick(S.sel, S.file);
  }

  async function pick(id, file = null) {
    S.sel = id;
    for (const b of list.querySelectorAll('.chs__ver')) { b.setAttribute('aria-selected', String(b.dataset.ver === id)); b.classList.toggle('is-on', b.dataset.ver === id); }
    const my = ++S.seq;
    const fs = await Hist.files(dir, id);
    if (S.dead || my !== S.seq || !fs) return;
    S.files = fs;
    const cur = new Map(now().map(f => [f.path, f.text]));
    clear(files);
    const v = S.versions.find(x => x.id === id);
    const rows = fs.map(f => {
      const n = cur.get(f.path);
      const state = n === undefined ? 'gone' : n === f.text ? 'same' : 'changed';
      return { path: f.path, text: f.text, state };
    });
    for (const p of cur.keys()) if (!fs.some(f => f.path === p)) rows.push({ path: p, text: null, state: 'new' });
    const label = { same: 'same as now', changed: 'changed since', gone: 'not there now', new: 'made since' };
    for (const r of rows) {
      files.append(h('button.chs__file', { type: 'button', role: 'listitem', class: `is-${r.state}`, 'data-file': r.path, onclick: () => show(r.path) },
        h('span.trunc', { text: r.path }), h('small', { text: label[r.state] })));
    }
    files.append(h('div.chs__acts', h('button.btn.btn--sm', {
      type: 'button', 'data-act': 'hist-restore-all',
      onclick: () => restoreAll(fs, v).then(done => { if (done) refresh(); }),
    }, icon('undo'), h('span', { text: 'Restore the whole project' }))));
    show(file && rows.some(r => r.path === file) ? file : (rows.find(r => r.state === 'changed') || rows[0])?.path);
  }

  function show(path) {
    S.file = path;
    for (const b of files.querySelectorAll('.chs__file')) b.classList.toggle('is-on', b.dataset.file === path);
    const old = S.files?.find(f => f.path === path);
    const n = now().find(f => f.path === path);
    if (!old) {
      render(view, h('div.chs__idle', icon('file'), h('b', { text: path }), h('small', { text: 'This file was made after this version, so there is nothing of it to restore. Restoring the whole project moves it to the Trash.' })));
      return;
    }
    const head = h('div.chs__vhead', h('b.mono', { text: path }), h('div.grow'),
      h('button.btn.btn--sm', { type: 'button', 'data-act': 'hist-restore-file', disabled: n && n.text === old.text,
        onclick: () => restoreFile(path, old.text).then(done => { if (done) { S.file = path; refresh(); } }) }, icon('undo'), h('span', { text: n ? 'Restore this file' : 'Bring this file back' })));
    if (n && n.text === old.text) { render(view, head, h('div.chs__idle', icon('check'), h('small', { text: 'This file is the same now as in this version.' }))); return; }
    const d = lineDiff(old.text, n ? n.text : '');
    const body = h('div.chs__diff', { tabindex: '0', 'aria-label': `How ${path} differs: minus lines are only in this version, plus lines only in the file now` });
    if (!d) body.append(h('div.chs__note', { text: 'These versions are too long to compare line by line. Restoring still works.' }));
    else {
      let run = [];
      const flush = () => {
        if (run.length > 8) {
          run.slice(0, 3).forEach(r => body.append(line(r)));
          body.append(h('div.chs__skip', { text: `… ${run.length - 6} unchanged lines …` }));
          run.slice(-3).forEach(r => body.append(line(r)));
        } else run.forEach(r => body.append(line(r)));
        run = [];
      };
      for (const r of d) { if (r.t === ' ') run.push(r); else { flush(); body.append(line(r)); } }
      flush();
    }
    const adds = d ? d.filter(r => r.t === '+').length : 0, dels = d ? d.filter(r => r.t === '-').length : 0;
    render(view, head, h('div.chs__legend', { text: d ? `− ${dels} line${dels === 1 ? '' : 's'} only in this version · + ${adds} only in the file now` : '' }), body);
  }
  const line = r => h(`div.chs__ln${r.t === '+' ? '.is-add' : r.t === '-' ? '.is-del' : ''}`, h('i', { text: r.t === ' ' ? '' : r.t === '-' ? '−' : '+' }), h('span', { text: r.text || ' ' }));

  refresh();
  return { el, refresh, dispose() { S.dead = true; } };
}

export default { historyPanel, lineDiff };
