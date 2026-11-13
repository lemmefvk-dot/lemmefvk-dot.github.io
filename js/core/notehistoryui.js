/* ============================================================
   notehistoryui.js — the History panel in Notes (versions kept by
   core/notehistory.js). It lays a sheet over the editor: the saved
   versions on the left, newest first, and the one you pick on the
   right, as it was. Restore puts it back (the note as it is now is kept
   as a version first); Copy text puts its words on the clipboard.
   ============================================================ */
import * as NH from './notehistory.js';
import * as NF from './notesfmt.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-notehistory-css')) {
  const link = document.createElement('link');
  link.id = 'feat-notehistory-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-notehistory.css';
  document.head.appendChild(link);
}

const WHY = { Original: 'Before your first edit', Edited: 'Saved while you were writing', 'Before restore': 'Kept before a restore' };

/** open({ api, host, key, getNow, apply }) -> close(). host is the element the sheet covers. */
export function openHistory({ api, host, key, getNow, apply, onClose }) {
  const { h, icon, fmt } = api;
  let alive = true;
  let versions = [];
  let picked = 0;

  const list = h('div.nh__list', { role: 'listbox', 'aria-label': 'Saved versions' });
  const preview = h('div.nh__preview.notes__doc', { role: 'document', 'aria-label': 'Preview of the version' });
  const when = h('b.nh__when');
  const restoreBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', 'aria-label': 'Restore this version', onclick: () => restore() },
    icon('rotate-ccw'), h('span', { text: 'Restore' }));
  const copyBtn = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Copy text', onclick: () => copy() },
    icon('copy'), h('span', { text: 'Copy text' }));
  const closeBtn = h('button.ibtn', { type: 'button', 'aria-label': 'Close history', onclick: () => close() }, icon('x'));
  const head = h('div.nh__head', icon('clock'), h('b', { text: 'History' }), h('div.grow'), closeBtn);
  const tools = h('div.nh__tools', when, h('div.grow'), copyBtn, restoreBtn);
  const empty = h('div.empty.nh__empty', icon('clock'), h('b', { text: 'No earlier versions yet' }),
    h('small', { text: 'A version is kept 30 seconds after you stop typing, when you close Notes, and before a restore.' }));
  const body = h('div.nh__body', list, h('div.nh__pane', tools, preview));
  const sheet = h('div.nh', { role: 'dialog', 'aria-label': 'Note history', 'aria-modal': 'false', tabindex: '-1' }, head, body, empty);
  sheet.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  host.appendChild(sheet);

  const iso = t => new Date(t).toISOString();
  const full = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function drawBlocks(v) {
    api.clear(preview);
    const blocks = NF.blocksOf({ fmt: v.fmt, body: v.body });
    let n = 0;
    const runs = rs => (rs || []).map(r => (r.b || r.i ? h(r.b ? 'b' : 'i', { text: r.text }) : document.createTextNode(r.text)));
    preview.appendChild(h('div.nh__title', { text: v.title || 'Untitled note' }));
    for (const b of blocks) {
      n = b.t === 'ol' ? n + 1 : 0;
      if (b.t === 'img') { preview.appendChild(h('p.nh__img', { text: `[picture: ${b.alt || b.path || 'image'}]` })); continue; }
      const mark = b.t === 'ul' ? '• ' : b.t === 'ol' ? `${n}. ` : b.t === 'check' ? (b.done ? '☑ ' : '☐ ') : '';
      const el = h(b.t === 'h1' ? 'h2' : b.t === 'h2' ? 'h3' : b.t === 'h3' ? 'h4' : 'p', mark ? [mark, ...runs(b.runs)] : runs(b.runs));
      if (!b.runs.length && !mark) el.append(h('br'));
      preview.appendChild(el);
    }
  }

  function paint() {
    api.clear(list);
    const now = getNow();
    versions.forEach((v, i) => {
      const d = NH.describe(v);
      const isNow = v.body === now.body && (v.title || '') === (now.title || '');
      list.appendChild(h('button.nh__row' + (i === picked ? '.is-on' : ''), {
        type: 'button', role: 'option', 'aria-selected': String(i === picked), dataset: { version: String(v.t) },
        onclick: () => { picked = i; paint(); },
      },
        h('span.nh__t', { text: fmt.fmtAgo(iso(v.t)), title: full(v.t) }),
        isNow ? h('span.badge.badge--ok', { text: 'Current' }) : null,
        h('span.nh__s', { text: d.summary || '(empty)' }),
        h('small', { text: `${d.words} word${d.words === 1 ? '' : 's'} · ${WHY[v.why] || v.why}` })));
    });
    const v = versions[picked];
    sheet.classList.toggle('is-empty', !versions.length);
    if (!v) return;
    when.textContent = full(v.t);
    drawBlocks(v);
    const cur = getNow();
    restoreBtn.disabled = v.body === cur.body && (v.title || '') === (cur.title || '');
    restoreBtn.title = restoreBtn.disabled ? 'This is the version you have now' : 'Put the note back to this version';
  }

  async function load(keep) {
    versions = await NH.list(key);
    if (!alive) return;
    picked = Math.min(keep ?? 0, Math.max(0, versions.length - 1));
    paint();
  }

  async function restore() {
    const v = versions[picked];
    if (!v) return;
    /* what the note says right now is kept first, so a restore can be undone from here */
    await NH.record(key, getNow(), 'Before restore');
    apply({ title: v.title, body: v.body, fmt: v.fmt });
    if (!alive) return;
    api.notify({ app: 'Notes', icon: 'rotate-ccw', title: 'Version restored', message: `The note is back to how it was ${fmt.fmtAgo(iso(v.t))}.` });
    await load(0);
  }

  async function copy() {
    const v = versions[picked];
    if (!v) return;
    const text = NH.plainText(v);
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; } catch (e) { done = false; }
    if (!done) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      ta.remove();
    }
    api.notify({ app: 'Notes', icon: done ? 'copy' : 'alert', title: done ? 'Text copied' : 'Couldn’t copy',
      message: done ? 'The words of that version are on your clipboard.' : 'Your browser didn’t allow it.' });
  }

  const off = api.bus.on('notehistory:change', e => { if (e && e.key === key && alive) load(picked); });
  function close() {
    if (!alive) return;
    alive = false;
    if (typeof off === 'function') off();
    sheet.remove();
    onClose?.();
  }
  load(0).then(() => { if (alive) (list.querySelector('.nh__row') || closeBtn).focus({ preventScroll: true }); });
  return close;
}

export default { openHistory };
