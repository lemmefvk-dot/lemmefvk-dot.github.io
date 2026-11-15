/* ============================================================
   shortcutlist.js — the shortcut list as a note or a PDF.

   Settings › Shortcuts and the shortcut sheet (Help › Keyboard
   Shortcuts) both offer "Save as note" and "Save as PDF". The list is
   the live one from js/core/keymap.js — your own keys, not the defaults
   — with the shortcuts of the app in front when there is one.

     sections(mac, app)   [{ title, rows: [{ keys, label }] }], keys as text
     asMarkdown(secs)     the body of a note (Notes' own format)
     saveAsNote(secs)     adds a note and opens it in Notes; returns the note
     printList(secs)      a clean white sheet to the browser's print window,
                          where "Save as PDF" is the printer; resolves when
                          it has been handed over (nothing is saved here)
   ============================================================ */
import { store } from './store.js';
import { open as openApp } from './wm.js';
import * as KM from './keymap.js';
import { isMac } from './util.js';

export function sections(mac = isMac, app = null) {
  const out = [];
  const own = KM.appRows(app);
  if (own.length) out.push({ title: app.name, rows: own.map(r => ({ keys: KM.keysText(r.keys, mac), label: r.label })) });
  const rows = KM.globalRows(mac);
  for (const g of KM.GROUPS) {
    const list = rows.filter(r => r.group === g);
    if (list.length) out.push({ title: g, rows: list.map(r => ({ keys: KM.keysText(r.keys, mac), label: r.label })) });
  }
  return out;
}

const esc = t => String(t).replace(/[\\*]/g, m => `\\${m}`);

export function asMarkdown(secs) {
  const lines = ['# Keyboard shortcuts'];
  for (const s of secs) {
    lines.push('', `## ${esc(s.title)}`);
    for (const r of s.rows) lines.push(`- ${esc(r.keys)} — ${esc(r.label)}`);
  }
  return lines.join('\n');
}

export function saveAsNote(secs) {
  const list = store.get('notes');
  const arr = Array.isArray(list) ? list : [];
  const note = {
    id: `note-${Date.now().toString(36)}-${arr.length}`,
    title: 'Keyboard shortcuts', fmt: 2, body: asMarkdown(secs), mtime: new Date().toISOString(),
  };
  store.set('notes', [note, ...arr]);
  openApp('notes', { noteId: note.id });
  return note;
}

let done = null;
export function printList(secs) {
  done?.();
  const el = document.createElement('div');
  el.className = 'sc-print';
  el.setAttribute('aria-hidden', 'true');
  const h1 = document.createElement('h1');
  h1.textContent = 'Keyboard shortcuts';
  el.appendChild(h1);
  for (const s of secs) {
    const h2 = document.createElement('h2');
    h2.textContent = s.title;
    const ul = document.createElement('ul');
    for (const r of s.rows) {
      const li = document.createElement('li');
      const k = document.createElement('b');
      k.textContent = r.keys;
      li.append(k, ' ', document.createTextNode(r.label));
      ul.appendChild(li);
    }
    el.append(h2, ul);
  }
  document.body.appendChild(el);
  document.documentElement.classList.add('sc-printing');
  let t = 0;
  const finish = () => {
    clearTimeout(t);
    el.remove();
    document.documentElement.classList.remove('sc-printing');
    window.removeEventListener('afterprint', finish);
    if (done === finish) done = null;
  };
  done = finish;
  window.addEventListener('afterprint', finish);
  t = setTimeout(finish, 120000);
  try { window.print(); return true; } catch (e) { finish(); return false; }
}

export default { sections, asMarkdown, saveAsNote, printList };
