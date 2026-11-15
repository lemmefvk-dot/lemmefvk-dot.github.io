/* ============================================================
   snippets.js — text snippets: type a short code, then a space (or
   . , ; : ! ? ) ), and the code becomes a longer text, in any text
   box or editable area in StaticOS.

   Settings › Keyboard › Text snippets keeps the list
   (prefs.snippets: [{ id, code, text }], so it is per person). It
   runs from start-up with no window open: init() watches typing.

   · A code has no spaces, 2–24 characters; a code that starts with ;
     or / will not fire inside an ordinary word. One that starts with a
     letter only fires after a space or at the start of a line.
   · The text may hold {date}, {time} and {day}, filled in when it
     expands. Anything else is typed as it is.
   · It goes in as typing, so Undo takes it back, and an app's own
     input handler sees it. Password fields are left alone, and so
     is anything marked data-snippets="off" (the editor's code box).
   · Only what StaticOS draws is covered: a page inside a frame
     (a game, the Browser) keeps its own keyboard.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const KEY = 'prefs.snippets';
export const MAX = 60;
export const CODE_MAX = 24;
export const TEXT_MAX = 2000;
const DELIMS = new Set([' ', '.', ',', ';', ':', '!', '?', ')']);

export const codeIssue = (code, list = [], selfId = null) => {
  const c = String(code || '');
  if (c.length < 2) return 'A code needs at least 2 characters.';
  if (c.length > CODE_MAX) return `A code is at most ${CODE_MAX} characters.`;
  if (/\s/.test(c)) return 'A code has no spaces.';
  if (list.some(s => s.code === c && s.id !== selfId)) return 'Another snippet already uses that code.';
  return null;
};

/** The saved snippets, cleaned. */
export function list() {
  const raw = store.get(KEY);
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!s || typeof s.code !== 'string' || typeof s.text !== 'string') continue;
    if (codeIssue(s.code, out, s.id)) continue;
    out.push({ id: String(s.id || `sn${out.length}`), code: s.code, text: s.text.slice(0, TEXT_MAX) });
    if (out.length >= MAX) break;
  }
  return out;
}
export const save = next => store.set(KEY, next.slice(0, MAX).map(s => ({ id: s.id, code: s.code, text: String(s.text).slice(0, TEXT_MAX) })));

/** Add one. -> { ok, snippet? , issue? } */
export function add(code, text) {
  const cur = list();
  const c = String(code || '').trim();
  const issue = codeIssue(c, cur) || (!String(text || '').length ? 'Write the text it should become.' : null)
    || (cur.length >= MAX ? `You can keep up to ${MAX} snippets.` : null);
  if (issue) return { ok: false, issue };
  const snippet = { id: `sn${Date.now().toString(36)}${cur.length}`, code: c, text: String(text).slice(0, TEXT_MAX) };
  save([...cur, snippet]);
  return { ok: true, snippet };
}
export function update(id, patch) {
  const cur = list();
  const s = cur.find(x => x.id === id);
  if (!s) return { ok: false, issue: 'That snippet is gone.' };
  const next = { ...s, ...patch };
  const issue = codeIssue(next.code, cur, id) || (!next.text.length ? 'Write the text it should become.' : null);
  if (issue) return { ok: false, issue };
  save(cur.map(x => (x.id === id ? next : x)));
  return { ok: true };
}
export const remove = id => save(list().filter(s => s.id !== id));

/** The text with {date}, {time} and {day} filled in. */
export function fill(text, now = new Date()) {
  const h24 = !!store.get('prefs.h24');
  return String(text)
    .replace(/\{date\}/gi, () => now.toLocaleDateString())
    .replace(/\{time\}/gi, () => now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !h24 }))
    .replace(/\{day\}/gi, () => now.toLocaleDateString([], { weekday: 'long' }));
}

/** Which snippet ends `before` (the text up to the delimiter)? Longest code wins. -> snippet | null */
export function match(before, snippets = list()) {
  let best = null;
  for (const s of snippets) {
    if (!before.endsWith(s.code)) continue;
    const prev = before.slice(0, before.length - s.code.length).slice(-1);
    if (prev && /\w/.test(s.code[0]) && !/\s/.test(prev)) continue;   /* a code that starts with a letter needs a space (or the start) before it */
    if (prev && !/\w/.test(s.code[0]) && /\w/.test(prev)) continue;   /* ";sig" does not fire inside "word;sig" */
    if (!best || s.code.length > best.code.length) best = s;
  }
  return best;
}

let busy = false;
const TEXTY = new Set(['text', 'search', 'url', 'email', 'tel', '']);

function onInput(e) {
  if (busy || e.isComposing || e.inputType !== 'insertText' || !DELIMS.has(e.data)) return;
  const t = e.target;
  if (!(t instanceof Element) || t.closest('[data-snippets="off"]')) return;
  const snippets = list();
  if (!snippets.length) return;

  if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXTY.has(t.type))) {
    const caret = t.selectionStart;
    if (caret === null || caret !== t.selectionEnd || caret < 1) return;
    const hit = match(t.value.slice(0, caret - 1), snippets);
    if (!hit) return;
    const start = caret - 1 - hit.code.length;
    const text = fill(hit.text) + e.data;
    swap(t, () => t.setSelectionRange(start, caret), text, () => t.setRangeText(text, start, caret, 'end'));
    return;
  }

  if (t.isContentEditable) {
    const sel = getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return;
    const node = sel.anchorNode, off = sel.anchorOffset;
    if (off < 1) return;
    const hit = match(node.data.slice(0, off - 1), snippets);
    if (!hit) return;
    const start = off - 1 - hit.code.length;
    swap(t, () => { const r = document.createRange(); r.setStart(node, start); r.setEnd(node, off); sel.removeAllRanges(); sel.addRange(r); },
      fill(hit.text) + e.data, null);
  }
}

/* select the code (and its delimiter), then type the text over it: as typing, so Undo works */
function swap(el, select, text, fallback) {
  busy = true;
  try {
    select();
    let done = false;
    try { done = document.execCommand('insertText', false, text); } catch (err) { done = false; }
    if (!done && fallback) {
      fallback();
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    }
    bus.emit('snippet:expanded', { length: text.length });
  } finally { busy = false; }
}

let on = false;
export function init() {
  if (on || typeof document === 'undefined') return;
  on = true;
  document.addEventListener('input', onInput, true);
}

export default { init, list, add, update, remove, save, match, fill, codeIssue, KEY, MAX };
