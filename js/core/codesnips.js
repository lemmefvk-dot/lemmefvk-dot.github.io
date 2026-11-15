/* ============================================================
   codesnips.js — Static Code's snippet library.

   Small pieces of code to drop in at the caret: a set that comes
   with Code for each language (written for StaticOS), and your own,
   saved from a selection. In a snippet, $0 marks where the caret
   goes; without one it goes to the end. When a snippet goes in, its
   second and later lines take the indent of the line it lands on.

   Your snippets are a preference (store 'portal.code.snippets', so
   each person has their own and a guest keeps none): at most MAX,
   each at most BODY_MAX characters.

     forLang(lang)  -> [{ id, name, lang, body, mine }]   built-in + yours
     add({ name, lang, body }) -> { ok, error?, snip }
     remove(id)
     place(body, indent) -> { text, caret }
   ============================================================ */
import { store } from './store.js';

export const KEY = 'portal.code.snippets';
export const MAX = 100;
export const BODY_MAX = 4000;
export const NAME_MAX = 40;

const B = (lang, name, body) => ({ id: `b:${lang}:${name}`, lang, name, body, mine: false });

export const BUILTIN = [
  B('html', 'Page skeleton', '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>$0</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n\n  <script src="script.js"></script>\n</body>\n</html>\n'),
  B('html', 'Button', '<button type="button" id="$0">Click me</button>'),
  B('html', 'Link', '<a href="$0">link text</a>'),
  B('html', 'Image', '<img src="$0" alt="">'),
  B('html', 'List', '<ul>\n  <li>$0</li>\n  <li></li>\n</ul>'),
  B('html', 'Text box with a label', '<label for="name">Name</label>\n<input id="name" type="text" placeholder="$0">'),
  B('html', 'Canvas', '<canvas id="game" width="480" height="320"></canvas>$0'),
  B('html', 'Table', '<table>\n  <thead>\n    <tr><th>$0</th><th></th></tr>\n  </thead>\n  <tbody>\n    <tr><td></td><td></td></tr>\n  </tbody>\n</table>'),
  B('css', 'Centre with flexbox', 'display: flex;\njustify-content: center;\nalign-items: center;$0'),
  B('css', 'Grid of cards', 'display: grid;\ngrid-template-columns: repeat(auto-fill, minmax(160px, 1fr));\ngap: 1rem;$0'),
  B('css', 'Small screens', '@media (max-width: 600px) {\n  $0\n}'),
  B('css', 'Keyframe animation', '@keyframes spin {\n  from { transform: rotate(0deg); }\n  to { transform: rotate(360deg); }\n}\n$0'),
  B('css', 'Dark mode', '@media (prefers-color-scheme: dark) {\n  body {\n    background: #111;\n    color: #eee;\n  }\n}$0'),
  B('css', 'Button style', 'button {\n  font: inherit;\n  padding: 0.5rem 1rem;\n  border: 0;\n  border-radius: 8px;\n  cursor: pointer;\n}$0'),
  B('js', 'On click', "document.getElementById('$0').addEventListener('click', () => {\n  \n});"),
  B('js', 'For loop', 'for (let i = 0; i < $0; i++) {\n  \n}'),
  B('js', 'For each item', 'for (const item of $0) {\n  console.log(item);\n}'),
  B('js', 'Function', 'function $0() {\n  \n}'),
  B('js', 'Fetch JSON', "const res = await fetch('$0');\nconst data = await res.json();\nconsole.log(data);"),
  B('js', 'Animation loop', 'function loop(time) {\n  $0\n  requestAnimationFrame(loop);\n}\nrequestAnimationFrame(loop);'),
  B('js', 'Key presses', "document.addEventListener('keydown', e => {\n  if (e.key === 'ArrowLeft') {\n    $0\n  }\n});"),
  B('js', 'Random whole number', 'Math.floor(Math.random() * $0)'),
  B('js', 'Wait a moment', 'setTimeout(() => {\n  $0\n}, 1000);'),
  B('py', 'For loop', 'for i in range($0):\n    print(i)'),
  B('py', 'Function', 'def $0():\n    pass'),
  B('py', 'If, elif, else', 'if $0:\n    pass\nelif False:\n    pass\nelse:\n    pass'),
  B('py', 'While loop', 'while $0:\n    pass'),
  B('py', 'Ask a question', 'answer = input("$0? ")\nprint("You said", answer)'),
  B('py', 'Read a file', 'with open("$0", encoding="utf-8") as f:\n    text = f.read()\nprint(text)'),
  B('py', 'Class', 'class $0:\n    def __init__(self):\n        pass'),
  B('py', 'Draw a picture', 'from draw import *\n\ncanvas(400, 300, "white")\ncircle(200, 150, 60, fill="gold")\n$0'),
  B('py', 'Random choice', 'import random\nprint(random.choice([$0]))'),
  B('sql', 'Select rows', 'SELECT *\nFROM $0\nLIMIT 10;'),
  B('sql', 'Count by group', 'SELECT $0, COUNT(*) AS n\nFROM table_name\nGROUP BY 1\nORDER BY n DESC;'),
  B('sql', 'Join two tables', 'SELECT a.*, b.*\nFROM $0 AS a\nJOIN other_table AS b ON b.id = a.other_id;'),
  B('sql', 'Make a table', 'CREATE TABLE $0 (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);'),
  B('glsl', 'Circle', 'float d = length(uv - vec2(0.5));\nfloat circle = smoothstep(0.25, 0.24, d);$0'),
  B('glsl', 'Colour by time', 'vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0.0, 2.0, 4.0));$0'),
];

/* which snippets suit a language: TypeScript, C and the rest of Code's 'js' family share JavaScript's */
const fam = lang => (lang === 'md' ? 'html' : lang);

function mine() {
  const v = store.get(KEY, []);
  return Array.isArray(v) ? v.filter(s => s && typeof s.id === 'string' && typeof s.body === 'string' && typeof s.name === 'string') : [];
}

export function forLang(lang) {
  const l = fam(lang);
  return [...mine().filter(s => !s.lang || s.lang === l).map(s => ({ ...s, mine: true })), ...BUILTIN.filter(s => s.lang === l)];
}

export function add({ name, lang, body }) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const b = String(body || '');
  if (!n) return { ok: false, error: 'Give the snippet a name.' };
  if (n.length > NAME_MAX) return { ok: false, error: `A name is at most ${NAME_MAX} characters.` };
  if (!b.trim()) return { ok: false, error: 'Select some code first: that is what the snippet keeps.' };
  if (b.length > BODY_MAX) return { ok: false, error: `A snippet is at most ${BODY_MAX.toLocaleString()} characters.` };
  const list = mine();
  if (list.length >= MAX) return { ok: false, error: `You have ${MAX} snippets, the most Code keeps. Delete one first.` };
  const snip = { id: `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n, lang: fam(lang) || '', body: b };
  store.set(KEY, [snip, ...list]);
  return { ok: true, snip };
}

export function remove(id) {
  const list = mine();
  const next = list.filter(s => s.id !== id);
  if (next.length !== list.length) store.set(KEY, next);
  return next.length !== list.length;
}

/** The snippet's text as it goes in at a line indented by `indent`, and where the caret lands. */
export function place(body, indent = '') {
  const at = body.indexOf('$0');
  const raw = at >= 0 ? body.slice(0, at) + body.slice(at + 2) : body;
  const want = at >= 0 ? at : raw.length;
  let text = '', caret = -1, pos = 0;
  raw.split('\n').forEach((l, i) => {
    const pre = i ? `\n${l ? indent : ''}` : '';
    if (caret < 0 && want <= pos + l.length) caret = text.length + pre.length + (want - pos);
    text += pre + l;
    pos += l.length + 1;
  });
  return { text, caret: caret < 0 ? text.length : caret };
}

export default { KEY, MAX, BUILTIN, forLang, add, remove, place };
