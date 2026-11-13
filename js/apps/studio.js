/* ============================================================
   studio.js — Static Studio: a small game engine built into
   StaticOS. Forge generates; Studio is where you build.

   Everything works on the shared game projects (core/projects.js).
   A project is ONE standalone HTML document with a version history,
   so whatever Studio saves is immediately playable anywhere.

   · Scene mode (projects started in Studio). The scene lives as
     JSON inside the document, next to the engine (studio/runtime.js)
     and the maker's own <script id="game-code">. You click, drag and
     resize objects on a canvas, pick them from a list, set their
     properties, attach behaviours, write "when A touches B" events
     and tweak the game's settings and variables. Edits are a working
     copy with their own undo, autosaved as a draft on this device;
     Build writes scene + engine into the document and commits a
     version. Build keeps everything else in the document as it is.
   · Layers. The list on the left is the draw order, front at the top
     (an object's layer number first, then its place in the scene).
     Drag a row (or Alt+↑/↓, Ctrl+] / Ctrl+[ on the stage, or the
     Arrange buttons) to reorder; the eye hides an object, the lock
     keeps the stage from picking, moving, resizing or deleting it.
   · Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y, the toolbar
     arrows) step through every scene edit — add, move, resize, edit,
     reorder, lock, delete. History lists those unsaved edits above
     the saved versions, and any of them can be jumped back to.
   · Code mode (every project; the only mode for Forge games). A
     plain textarea with a line-number gutter, Tab indent, Ctrl/Cmd+S
     save and Ctrl/Cmd+F find that highlights and jumps. Scene data
     edited by hand is validated before it is saved.
   · Preview + Console. The game runs in core/sandbox.js (opaque
     origin, its own box). Console shows what it printed and every
     uncaught error, with times. In Code mode the running game sits
     in a corner card (or beside the code in a wide window), so a
     save shows its result without taking the editor away. The first
     run of a project per visit goes into core/plays.js as a
     'creation' play.
   · Assets. The project's images and sounds (Asset Lab adds them
     with projects.addAsset; Studio can import files too). Sprites in
     scene mode, copy-a-snippet in code mode.
   · History. Past the unsaved edits, undo / redo / restore are the
     project's own versions.
   · Export. One standalone .html file (engine, scene, sprites and
     sounds inside it) that plays when opened on its own, offline.
     With unsaved changes it asks which to export: what you see now,
     or the saved version.
   · Assistant. GPT-OSS 20B through portal/llm.js. It can explain,
     fix errors and make requested changes — but it only ever
     PROPOSES: Studio extracts the full document it sends back, shows
     a line diff, test-runs it in the sandbox, and nothing changes
     until you press Apply (commit by 'ai', note = your request).
     If no complete document came back, it says so and changes
     nothing. For scene games the engine, Studio's page style and
     embedded image/sound data are replaced by short placeholders
     and default-valued scene fields are left out before sending, so
     the model only reads and rewrites the parts that are yours; a
     scene change is also summed up in words ("Player: extra jumps
     in the air 0 → 1").

   Store: portal.studio = { autoRun, snap, grid, last } (prefs only)
   IndexedDB (db.js 'misc'): studio-draft:<projectId> — unsaved work.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as P from '../core/projects.js';
import * as SB from '../core/sandbox.js';
import { kv } from '../core/db.js';
import * as LLM from '../portal/llm.js';
import { render as md } from '../portal/mdlite.js';
import * as R from '../studio/runtime.js';
import { TEMPLATES, template as findTemplate } from '../studio/templates.js';
import { addToDesktop } from '../core/shortcuts.js';
import * as Plays from '../core/plays.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-studio-css')) {
  const l = document.createElement('link');
  l.id = 'feat-studio-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-studio.css';
  document.head.appendChild(l);
}

/* ---------- constants ------------------------------------------------ */
const PREF = 'portal.studio';
const DRAFTS = kv('misc');
const draftKey = id => `studio-draft:${id}`;
const MARK = '/*STUDIO_RUNTIME*/';
const STYLE_MARK = '/*STUDIO_STYLE*/';
const HELP_MARK = '/*STUDIO_HELP*/';
/* the free model stops every answer at about 1,500 tokens (its reasoning
   included), so a long document comes back in parts: Studio asks it to
   carry on where it stopped, up to this many answers in all */
const MAX_PARTS = 7;
/* every request gets its own seed: the service caches identical requests,
   and "Try again" should really try again */
const llmParams = () => ({ reasoning_effort: 'low', seed: Math.floor(Math.random() * 2147483647) });
const LH = 18;                     /* code editor line height, px — keep in step with the css */
const SNAP = 8;
const MAX_LOG = 400;
/* how many lines core/sandbox.js adds in front of a game (its console bridge) */
const PRELUDE_LINES = (() => { try { return SB.withPrelude('<head>').split('\n').length - 1; } catch (err) { return 0; } })();

const EXAMPLES = ['Make the player double jump', 'Make enemies chase the player', 'Add a health bar', 'Make the coins spin'];
const CODE_EXAMPLES = ['Add a pause screen', 'Make the player faster', 'Add a score counter', 'Explain the game loop'];

const API_NOTES = [
  'game-code API (window.game): game.on(event, fn) with events start, update (dt in seconds), draw (2D context, scene pixels), touch (a, b), win, lose, hurt, key.',
  'game.player, game.find(nameOrRef), game.findAll(ref), game.objects, game.vars.score / lives / time, game.keys.left/right/up/down/jump (held), game.pressed(key) (this frame),',
  'game.addScore(n), game.loseLife(), game.win(), game.lose(), game.restart(), game.say(text), game.play(soundName), game.image(name), game.spawn({name,group,x,y,w,h,color,shape,solid,behaviours}),',
  'game.destroy(obj), game.touching(a, b), game.behaviour(obj, type) returns the live settings object of that behaviour (e.g. game.behaviour(game.player, "platformer").airJumps = 1), game.width, game.height.',
  'Objects have x, y, w, h, vx, vy, color, visible, solid, onGround, face (1 or -1), group, name, data (free-form).',
].join(' ');

/* "platformer {speed:240, jump:560, airJumps:0}" — every setting with its default */
const BEHAVIOUR_NOTES = R.BEHAVIOURS.map(b => `${b.type} {${b.params.map(p => `${p.k}:${JSON.stringify(p.def)}${p.kind === 'select' ? ` (${p.options.map(o => JSON.stringify(o[0])).join('|')})` : p.kind === 'sound' ? ' (a sound asset id)' : ''}`).join(', ')}}`).join(' · ');

/** What to say when an answer stopped part-way. */
const continuePrompt = tail => [
  'Your answer was cut off by the length limit. Continue it from exactly where it stopped.',
  `The last characters you sent were:\n${tail}`,
  'Send only what comes after them: no repeating, no starting the document again, no explanation. End with </html> and close the ```html block.',
].join('\n\n');

function changeSystem(isScene) {
  const common = [
    'You are the coding assistant inside Static Studio, the small game engine in StaticOS. You change ONE self-contained HTML game document and send back the whole updated document.',
    'How to answer: first one or two plain sentences saying what you changed. Then the COMPLETE updated document in a single ```html code block.',
    'Never shorten the document, never write "..." or "rest unchanged": anything outside that one block is thrown away, and a partial document cannot be used.',
    'Keep every part you were not asked to change exactly as it is. Tokens like STUDIO_DATA_URL_2 stand for embedded images and sounds: copy them unchanged.',
    'No external scripts, libraries, fonts, images or network requests: the game must keep working as one offline file.',
  ];
  if (!isScene) return [...common, 'This game is a plain HTML document (made with Forge or by hand). Edit its HTML, CSS and JavaScript directly. Make the smallest change that does what was asked.'].join('\n');
  return [...common,
    'This game is a Static Studio scene:',
    `- The engine is <script id="studio-runtime"> and is shown to you only as ${MARK}. Keep that line exactly as it is. Never write, copy or change engine code. ${STYLE_MARK} in <style id="studio-style"> stands for Studio's page style, and ${HELP_MARK} at the top of the game-code script stands for Studio's comment about the game API: keep both lines as they are too.`,
    '- Change the game by editing the scene JSON in <script type="application/json" id="scene"> (keep it valid JSON with one object per line) and/or the JavaScript in <script id="game-code">.',
    '- Scene shape: {"settings":{width,height,background,gravity,lives,score,timer,timerEnds:"win"|"lose",winScore,hud}, "objects":[{id,name,group,x,y,w,h,color,shape:"rect"|"ellipse",sprite,text,solid,visible,layer,behaviours:[{type,...settings}]}], "events":[{id,a,b,actions:[{do,n,sound}]}]}',
    '- Object fields that are left out use their defaults: shape "rect", solid false, visible true, layer 0, no sprite, no text, no behaviours. New objects need a unique id (e.g. "o-new1"). "locked": true only matters in Studio\'s editor (the object cannot be dragged there); keep it as it is.',
    `- Behaviours, with the default of every setting (a setting that is left out has its default): ${BEHAVIOUR_NOTES}. airJumps = extra jumps in the air (1 = double jump). An object has each behaviour at most once, and never both platformer and topdown.`,
    '- Players are objects with platformer or topdown. patrol and chase enemies cost a player a life on touch; hazards too; collectibles add points; goal wins.',
    '- Events: a and b are "player", "any", "group:<group>" or "id:<object id>". Actions: score (n), destroyA, destroyB, loseLife, gainLife (n), win, lose, sound (sound = asset id).',
    `- ${API_NOTES}`,
    '- Prefer the simplest change: adjust a behaviour setting or the scene before writing new code. Put new code inside the game-code script only.',
  ].join('\n');
}

const EXPLAIN_SYSTEM = [
  'You are the coding assistant inside Static Studio, the small game engine in StaticOS.',
  'Explain code to someone learning to make games: what it does and how the parts connect, in plain words.',
  'Use short paragraphs or bullet points, **bold** the key ideas and put identifiers in `backticks`. Do not rewrite the code or repeat the whole file.',
  `If you see ${MARK}, that is Studio's built-in engine, left out on purpose — do not guess at its internals beyond what the scene and game code use.`,
  'The scene JSON describes objects (position, size, look, behaviours) and events; the game-code script is the maker\'s own code using the `game` API.',
].join(' ');

/* add-object presets for the scene editor */
const PRESETS = [
  { id: 'block', label: 'Block (solid ground)', icon: 'square', make: () => ({ name: 'Block', group: 'ground', w: 120, h: 18, color: '#5b6b94', solid: true }) },
  { id: 'platformer', label: 'Player — platformer', icon: 'gamepad', make: () => ({ name: 'Player', group: 'player', w: 26, h: 34, color: '#ff5c7c', layer: 1, behaviours: [beh('platformer')] }) },
  { id: 'topdown', label: 'Player — top-down', icon: 'compass', make: () => ({ name: 'Player', group: 'player', w: 24, h: 24, color: '#fde68a', layer: 1, behaviours: [beh('topdown')] }) },
  { id: 'coin', label: 'Coin (collectible)', icon: 'star', make: () => ({ name: 'Coin', group: 'coin', w: 18, h: 18, color: '#fcd34d', shape: 'ellipse', behaviours: [beh('collectible')] }) },
  { id: 'hazard', label: 'Spikes (hazard)', icon: 'alert', make: () => ({ name: 'Spikes', group: 'spikes', w: 38, h: 12, color: '#f87171', behaviours: [beh('hazard')] }) },
  { id: 'patrol', label: 'Enemy — patrols', icon: 'repeat', make: () => ({ name: 'Walker', group: 'walker', w: 28, h: 28, color: '#a78bfa', shape: 'ellipse', behaviours: [beh('patrol')] }) },
  { id: 'chase', label: 'Enemy — chases', icon: 'zap', make: () => ({ name: 'Chaser', group: 'chaser', w: 26, h: 26, color: '#fb923c', shape: 'ellipse', behaviours: [beh('chase')] }) },
  { id: 'goal', label: 'Goal flag', icon: 'check-circle', make: () => ({ name: 'Flag', group: 'goal', w: 24, h: 48, color: '#4ade80', behaviours: [beh('goal')] }) },
  { id: 'moving', label: 'Moving platform', icon: 'arrow-right', make: () => ({ name: 'Lift', group: 'platform', w: 90, h: 16, color: '#7dd3fc', solid: true, behaviours: [beh('moving')] }) },
  { id: 'faller', label: 'Falling rock', icon: 'arrow-down', make: () => ({ name: 'Rock', group: 'rock', w: 28, h: 28, color: '#a8a29e', shape: 'ellipse', behaviours: [beh('faller'), beh('hazard')] }) },
  { id: 'text', label: 'Text', icon: 'type', make: () => ({ name: 'Text', group: 'text', w: 220, h: 22, color: '#e2e8f0', text: 'Score: {score}' }) },
];
function beh(type) {
  const d = R.behaviourDef(type);
  return { type, ...Object.fromEntries(d.params.map(p => [p.k, p.def])) };
}

/* ---------- small helpers -------------------------------------------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
const pad2 = n => String(n).padStart(2, '0');
const hms = t => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function hex6(c) {
  const s = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase() : null;
}
const lum = c => {
  const x = hex6(c);
  if (!x) return 0;
  const n = parseInt(x.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const lineStarts = text => { const out = [0]; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(i + 1); return out; };
const lineOf = (text, pos) => { let n = 1; for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) n++; return n; };
const varName = name => {
  const base = String(name || 'asset').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+(.)?/gi, (m, c) => (c ? c.toUpperCase() : '')).replace(/^[^a-z_$]+/i, '');
  return (base.charAt(0).toLowerCase() + base.slice(1)) || 'asset';
};

/* ---------- line diff ---------------------------------------------------
   Common prefix/suffix are peeled off first (an edit usually touches a few
   lines), then a plain LCS table on what is left. Very large rewrites skip
   the table and show as "all removed, all added" — still honest. */
export function diffLines(a, b) {
  const A = String(a).split('\n'), B = String(b).split('\n');
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ t: ' ', a: i + 1, b: i + 1, text: A[i] });
  const n = a2.length, m = b2.length;
  if (n * m > 4e6) {
    a2.forEach((text, i) => ops.push({ t: '-', a: pre + i + 1, text }));
    b2.forEach((text, j) => ops.push({ t: '+', b: pre + j + 1, text }));
  } else {
    const w = m + 1;
    const L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = a2[i] === b2[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      /* on a tie the removal comes first, as in any diff: "- old, + new" */
      if (i < n && j < m && a2[i] === b2[j]) { ops.push({ t: ' ', a: pre + i + 1, b: pre + j + 1, text: a2[i] }); i++; j++; }
      else if (i < n && (j >= m || L[(i + 1) * w + j] >= L[i * w + j + 1])) { ops.push({ t: '-', a: pre + i + 1, text: a2[i] }); i++; }
      else { ops.push({ t: '+', b: pre + j + 1, text: b2[j] }); j++; }
    }
  }
  for (let k = 0; k < suf; k++) {
    const ia = A.length - suf + k, ib = B.length - suf + k;
    ops.push({ t: ' ', a: ia + 1, b: ib + 1, text: A[ia] });
  }
  const added = ops.filter(o => o.t === '+').length;
  const removed = ops.filter(o => o.t === '-').length;
  return { ops, added, removed, hunks: hunksOf(ops, 2) };
}
function hunksOf(ops, ctx) {
  const out = [];
  let cur = null, lastChange = -1e9;
  ops.forEach((op, i) => {
    if (op.t === ' ') return;
    const from = Math.max(0, i - ctx);
    if (!cur || from > lastChange + ctx + 1) {
      if (cur) out.push(cur);
      cur = { from, to: i };
    }
    cur.to = i;
    lastChange = i;
  });
  if (cur) out.push(cur);
  return out.map(hk => ops.slice(hk.from, Math.min(ops.length, hk.to + ctx + 1)));
}

/* ---------- what the assistant sees ---------------------------------- */
export function abridge(html, isScene) {
  let text = String(html || '');
  let engine = null, style = null, help = null;
  /* line n of the real document -> line in what the model reads (null = inside the engine) */
  let mapLine = n => n;
  if (isScene) {
    /* the scene as Studio writes it, minus fields that only repeat defaults:
       same lines, a third shorter */
    const sb = text.match(/(<script\b[^>]*\bid\s*=\s*["']scene["'][^>]*>)([\s\S]*?)(<\/script\s*>)/i);
    if (sb) {
      const d = R.readDoc(text);
      if (d.scene && sb[2].replace(/^\n|\n$/g, '') === R.formatScene(d.scene)) {
        const short = R.formatScene(d.scene, { compact: true });
        text = text.replace(sb[0], () => `${sb[1]}\n${short}\n${sb[3]}`);
      }
    }
    /* Studio's own stylesheet, when it is untouched, is left out the same way
       as the engine: less for the model to copy back, so a faster answer */
    const sm = text.match(/(<style\b[^>]*\bid\s*=\s*["']studio-style["'][^>]*>)([\s\S]*?)(<\/style\s*>)/i);
    if (sm && sm[2].trim() === R.RUNTIME_CSS.trim()) {
      style = sm[2];
      const from = lineOf(text, sm.index + sm[1].length);
      const nl = (sm[2].match(/\n/g) || []).length;
      const prev = mapLine;
      mapLine = n => { const k = prev(n); return k === null ? null : k <= from ? k : k >= from + nl ? k - (nl - 2) : null; };
      text = text.replace(sm[0], () => `${sm[1]}\n${STYLE_MARK}\n${sm[3]}`);
    }
    const m = text.match(/(<script\b[^>]*\bid\s*=\s*["']studio-runtime["'][^>]*>)([\s\S]*?)(<\/script\s*>)/i);
    if (m) {
      engine = m[2];
      const from = lineOf(text, m.index + m[1].length);
      const nl = (m[2].match(/\n/g) || []).length;
      const prev = mapLine;
      /* `from` is counted in the text with the style already folded, so fold first */
      mapLine = n => { const k = prev(n); return k === null ? null : k <= from ? k : k >= from + nl ? k - (nl - 2) : null; };
      text = text.replace(m[0], () => `${m[1]}\n${MARK}\n${m[3]}`);
    }
    /* Studio's comment about the game API, while it still opens the game
       code, is one line too: the model knows the API from its instructions */
    const gm = text.match(/(<script\b[^>]*\bid\s*=\s*["']game-code["'][^>]*>\n?)([\s\S]*?)(<\/script\s*>)/i);
    const HELP = R.DEFAULT_CODE.replace(/\n+$/, '');
    if (gm && gm[2].startsWith(HELP)) {
      help = HELP;
      const at = gm.index + gm[1].length;
      const from = lineOf(text, at);
      const nl = (HELP.match(/\n/g) || []).length;
      const prev = mapLine;
      mapLine = n => { const k = prev(n); return k === null ? null : k <= from ? k : k > from + nl ? k - nl : from; };
      text = text.slice(0, at) + HELP_MARK + text.slice(at + HELP.length);
    }
  }
  const map = new Map(), seen = new Map();
  let n = 0;
  text = text.replace(/data:[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*,[A-Za-z0-9+/=%._~-]{80,}/gi, url => {
    if (!seen.has(url)) { const tok = `STUDIO_DATA_URL_${++n}`; seen.set(url, tok); map.set(tok, url); }
    return seen.get(url);
  });
  return { text, map, engine, style, help, mapLine };
}
export function expand(text, ab) {
  const missing = [];
  let out = String(text).replace(/STUDIO_DATA_URL_\d+/g, tok => {
    if (ab.map.has(tok)) return ab.map.get(tok);
    missing.push(tok);
    return tok;
  });
  if (ab.engine !== null) {
    if (!out.includes(MARK)) return { error: 'engine' };
    out = out.replace(MARK, () => ab.engine.replace(/^\n/, '').replace(/\n$/, ''));
  }
  /* a dropped style marker only loses Studio's page style: put it back */
  if (ab.style) {
    if (out.includes(STYLE_MARK)) out = out.replace(STYLE_MARK, () => ab.style.replace(/^\n/, '').replace(/\n$/, ''));
    else if (!/id\s*=\s*["']studio-style["']/.test(out)) out = out.replace(/<\/head>/i, m => `<style id="studio-style">\n${R.RUNTIME_CSS}\n</style>\n${m}`);
  }
  /* the same for Studio's comment at the top of the game code */
  if (ab.help) {
    if (out.includes(HELP_MARK)) out = out.replace(HELP_MARK, () => ab.help);
    else out = out.replace(/(<script\b[^>]*\bid\s*=\s*["']game-code["'][^>]*>\n?)/i, m => `${m}${ab.help}\n`);
  }
  return { html: out, missing };
}

const CUT = 'The answer was cut off before the document ended, so there is no complete version to apply.';
/* the text up to and including the last </html> */
const toEnd = s => { const i = s.toLowerCase().lastIndexOf('</html'); const j = i < 0 ? -1 : s.indexOf('>', i); return j < 0 ? s : s.slice(0, j + 1); };

/**
 * The full document out of a model reply — or why there is none.
 * cut: true when it began a document and stopped before the end (the
 * free model's length limit does that), so asking for the rest may help.
 */
export function extractDoc(reply) {
  const text = String(reply || '');
  const blocks = [];
  /* a fenced block runs to its closing fence, or to the end of the text */
  const re = /```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)(\n[ \t]*```|$)/g;
  let m;
  while ((m = re.exec(text))) {
    blocks.push({ lang: m[1].toLowerCase(), body: m[2], start: m.index, closed: !!m[3] });
    if (!m[3]) break;
  }
  const looksDoc = s => /<html[\s>]|<!doctype html|<body[\s>]/i.test(s);
  const docs = blocks.filter(b => looksDoc(b.body));
  const summary = (docs.length ? text.slice(0, docs[0].start) : text.split('```')[0]).trim();
  /* whole: it reaches </html>, or its block was closed after </body> */
  const whole = docs.filter(b => /<\/html\s*>/i.test(b.body) || (b.closed && /<\/body\s*>/i.test(b.body)));
  if (whole.length) {
    const best = whole.reduce((x, y) => (y.body.length > x.body.length ? y : x));
    return { html: toEnd(best.body).replace(/\s+$/, '') + '\n', summary };
  }
  if (docs.some(b => !b.closed) || (!docs.length && /```[ \t]*html/i.test(text) && !blocks.some(b => b.closed))) return { error: CUT, summary, cut: true };
  if (docs.length) return { error: 'The document in the answer stops before its end (there is no </html>), so it cannot be used.', summary };
  /* no fence at all: a bare document */
  const bare = text.search(/<!doctype html|<html[\s>]/i);
  if (bare >= 0) {
    const rest = text.slice(bare);
    if (/<\/html\s*>/i.test(rest)) return { html: toEnd(rest).trim() + '\n', summary: text.slice(0, bare).trim() };
    return { error: CUT, summary: text.slice(0, bare).trim(), cut: true };
  }
  return { error: 'The answer did not include an updated document.', summary: text.trim() };
}

/** Did the answer begin a document and stop before its end? */
export const needsMore = reply => !!extractDoc(reply).cut;

/**
 * Join the next part of an answer onto what came before. The model often
 * opens a new ``` fence (sometimes after a few words), repeats the last
 * characters or restarts the unfinished last line; each is folded back
 * in. If it started the whole document again, the new start wins.
 */
export function stitchMore(prev, more) {
  const p = String(prev || '');
  let m = String(more || '');
  const fence = m.match(/^([^<`]{0,300}?)```[A-Za-z]*[ \t]*\r?\n/);
  if (fence) m = m.slice(fence[0].length);
  const again = m.search(/<!doctype html|<html[\s>]/i);
  if (again >= 0 && again < 200) {
    const was = p.search(/<!doctype html|<html[\s>]/i);
    return (was >= 0 ? p.slice(0, was) : p) + m.slice(again);
  }
  const base = p.replace(/[ \t]+$/, '');
  for (let k = Math.min(800, m.length, base.length); k >= 12; k--) {
    if (base.endsWith(m.slice(0, k))) return base + m.slice(k);
  }
  const nl = p.lastIndexOf('\n');
  const last = p.slice(nl + 1).trim();
  if (last.length >= 3 && m.trimStart().startsWith(last)) return p.slice(0, nl + 1) + m.replace(/^\n+/, '');
  return p + m;
}

/* ---------- files -------------------------------------------------------- */
const readAsDataUrl = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result || ''));
  r.onerror = () => rej(r.error || new Error('Could not read the file'));
  r.readAsDataURL(file);
});
/* images bigger than 512 px are scaled down: every saved version carries them */
async function imageDataUrl(file) {
  const url = await readAsDataUrl(file);
  if (/svg|gif/i.test(file.type) && file.size < 400000) return url;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be opened')); i.src = url; });
  const max = 512, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (k >= 1 && file.size < 400000) return url;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/* ---------- drawing a scene (editor stage and thumbnails) ----------- */
function paintScene(g, scene, { images, grid = 0, px = 1, paths = false, sel = null } = {}) {
  const st = scene.settings || R.SETTINGS;
  const W = st.width, H = st.height;
  g.fillStyle = st.background || '#141a2e';
  g.fillRect(0, 0, W, H);
  if (grid) {
    g.beginPath();
    for (let x = grid; x < W; x += grid) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = grid; y < H; y += grid) { g.moveTo(0, y); g.lineTo(W, y); }
    g.strokeStyle = lum(st.background) > 0.6 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.055)';
    g.lineWidth = px;
    g.stroke();
  }
  const objs = (scene.objects || []).map((o, i) => [o, i]).sort((a, b) => (a[0].layer || 0) - (b[0].layer || 0) || a[1] - b[1]);
  for (const [o] of objs) {
    g.save();
    if (o.visible === false) g.globalAlpha = 0.28;
    const im = o.sprite && images && images.get(o.sprite);
    if (o.text) {
      const t = String(o.text).replace(/\{score\}/g, String(st.score || 0)).replace(/\{lives\}/g, String(st.lives || 3))
        .replace(/\{time\}/g, st.timer ? `${Math.floor(st.timer / 60)}:${pad2(Math.ceil(st.timer % 60))}` : '0:00');
      let size = Math.max(6, o.h * 0.8);
      g.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const tw = g.measureText(t).width;
      if (tw > o.w && tw > 0) { size = Math.max(6, size * o.w / tw); g.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`; }
      g.fillStyle = o.color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, o.x + o.w / 2, o.y + o.h / 2);
    } else if (im && im.complete && im.naturalWidth) {
      g.drawImage(im, o.x, o.y, o.w, o.h);
    } else {
      g.fillStyle = o.color || '#8b93a7';
      if (o.shape === 'ellipse') { g.beginPath(); g.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(o.x, o.y, o.w, o.h);
    }
    g.restore();
  }
  if (!paths) return;
  /* where moving things will go: moving platforms and patrols */
  g.save();
  g.setLineDash([6 * px, 5 * px]);
  g.lineWidth = 1.5 * px;
  for (const o of scene.objects || []) {
    const mv = (o.behaviours || []).find(b => b.type === 'moving');
    const pt = (o.behaviours || []).find(b => b.type === 'patrol');
    const on = o.id === sel;
    g.strokeStyle = on ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.28)';
    if (mv && (mv.dx || mv.dy)) {
      g.strokeRect(o.x + mv.dx, o.y + mv.dy, o.w, o.h);
      g.beginPath(); g.moveTo(o.x + o.w / 2, o.y + o.h / 2); g.lineTo(o.x + o.w / 2 + mv.dx, o.y + o.h / 2 + mv.dy); g.stroke();
    }
    if (pt && pt.distance > 0) {
      g.beginPath();
      if (pt.axis === 'y') { g.moveTo(o.x + o.w / 2, o.y); g.lineTo(o.x + o.w / 2, o.y + o.h + pt.distance); }
      else { g.moveTo(o.x, o.y + o.h + 3 * px); g.lineTo(o.x + o.w + pt.distance, o.y + o.h + 3 * px); }
      g.stroke();
    }
    const ch = (o.behaviours || []).find(b => b.type === 'chase');
    if (ch && ch.range > 0 && on) {
      g.beginPath(); g.arc(o.x + o.w / 2, o.y + o.h / 2, ch.range, 0, Math.PI * 2); g.stroke();
    }
  }
  g.restore();
}

function roleIcon(o) {
  const b = (o.behaviours || [])[0];
  if (o.text) return 'type';
  return b ? (R.behaviourDef(b.type)?.icon || 'box') : (o.solid ? 'square' : 'box');
}

/* ==================================================================== */

defineApp({
  id: 'studio',
  name: 'Static Studio',
  icon: 'code',
  g1: '#7cc4ff', g2: '#4338ca',
  category: 'Create',
  keywords: ['game', 'engine', 'editor', 'scene', 'level', 'make a game', 'build', 'code', 'sprites', 'platformer', 'studio', 'ide', 'develop'],
  desc: 'Build games with a scene editor, code, and an assistant that only changes things when you say so',
  singleton: true,
  win: { w: 1180, h: 740, minW: 600, minH: 460 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Mod+S', 'Save'],
    ['Mod+Enter', 'Play the game'],
    ['Mod+Z', 'Undo (scene)'],
    ['Mod+Shift+Z / Mod+Y', 'Redo (scene)'],
    ['Left / Right / Up / Down', 'Move the selected object (with Shift, by 10)'],
    ['[ / ]', 'Select the previous / next object'],
    ['Mod+[ / Mod+]', 'Send backward / bring forward (with Shift, to the back / front)'],
    ['Mod+D', 'Duplicate'],
    ['Delete', 'Remove the selected object'],
    ['Mod+F', 'Find (code)'],
    ['Tab / Shift+Tab', 'Indent / outdent (code)'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus } = api;

    const prefs = () => store.get(PREF, null) || {};
    const setPref = (k, v) => store.set(PREF, { ...prefs(), [k]: v });

    const S = {
      dead: false,
      view: 'home',          /* 'home' | 'editor' */
      p: null,
      kind: 'scene',         /* what the project IS: 'scene' | 'code' */
      mode: 'scene',         /* which editor is showing */
      pane: 'scene',         /* centre pane: 'scene' | 'code' | 'game' */
      headHtml: '', headId: null,
      baseHtml: '', baseRuntime: 'ok',
      scene: null, sceneErr: null,
      dirty: false,
      undo: [], redo: [],
      sel: null,
      right: 'object',
      notices: [],
      logs: [], logOpen: true,
      run: { sb: null, on: false, dirtyRun: false },
      ai: { turns: [], busy: false, ac: null },
      images: new Map(),
      selfWrite: 0,
      narrow: false, tiny: false, leftOpen: false, rightOpen: false,
      busy: false,
    };

    /* every timeout, frame and object URL the app starts, so that teardown
       can stop them all (each also checks S.dead, belt and braces) */
    const timers = new Set(), frames = new Set(), urls = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!S.dead) fn(); }, ms); timers.add(id); return id; };
    const nextFrame = fn => { const id = requestAnimationFrame(() => { frames.delete(id); if (!S.dead) fn(); }); frames.add(id); return id; };

    /* ================================================================
       Shell
       ================================================================ */
    const app = h('div.app.app--col.stu', { dataset: { view: 'home' } });
    root.appendChild(app);

    /* ---------- toolbar ---------- */
    const homeBtn = h('button.stu-tb.stu-tb--icon', { type: 'button', title: 'All projects', 'aria-label': 'All projects', onclick: () => goHome() }, icon('grid'));
    const leftBtn = h('button.stu-tb.stu-tb--icon.stu-only-narrow', { type: 'button', title: 'Objects and assets', 'aria-label': 'Show objects and assets', onclick: () => toggleDrawer('left') }, icon('layers'));
    const nameIn = h('input.stu-name', {
      type: 'text', maxlength: '60', 'aria-label': 'Project name', spellcheck: 'false',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } else if (e.key === 'Escape') { e.target.value = S.p?.name || ''; e.target.blur(); } },
      onchange: e => renameProject(e.target.value),
    });
    const statusEl = h('span.stu-status', { 'aria-live': 'polite' });
    const undoBtn = h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Undo', onclick: () => undo() }, icon('rotate-ccw'));
    const redoBtn = h('button.stu-tb.stu-tb--icon.stu-flip', { type: 'button', 'aria-label': 'Redo', onclick: () => redo() }, icon('rotate-ccw'));
    const histBtn = h('button.stu-tb', { type: 'button', 'aria-label': 'History', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: e => toggleHistory(e.currentTarget) }, icon('clock'), h('span.stu-hide-tiny', { text: 'History' }));
    const saveBtn = h('button.btn.stu-save', { type: 'button', onclick: () => save() });
    const exportBtn = h('button.stu-tb', { type: 'button', title: 'Export the game as one .html file that plays in any browser', 'aria-label': 'Export as an HTML file', onclick: e => { if (S.p) exportProject(S.p, e.currentTarget); } }, icon('download'), h('span.stu-hide-tiny', { text: 'Export' }));
    const aiBtn = h('button.stu-tb', { type: 'button', 'aria-label': 'Assistant', title: 'Assistant', onclick: () => showRight('ai') }, icon('sparkles'), h('span.stu-hide-tiny', { text: 'Assistant' }));
    const rightBtn = h('button.stu-tb.stu-tb--icon.stu-only-tiny', { type: 'button', title: 'Inspector', 'aria-label': 'Show inspector', onclick: () => toggleDrawer('right') }, icon('sliders'));
    const moreBtn = h('button.stu-tb.stu-tb--icon', { type: 'button', title: 'More for this project', 'aria-label': 'More for this project', 'aria-haspopup': 'menu', onclick: e => { if (S.p) projectMenu(S.p, e.currentTarget); } }, icon('more-horizontal'));
    const topbar = h('header.stu-top',
      homeBtn, leftBtn,
      h('div.stu-top__name', nameIn, statusEl),
      h('div.stu-top__grow'),
      h('div.stu-top__grp', undoBtn, redoBtn, histBtn),
      h('div.stu-top__grp', exportBtn, saveBtn, aiBtn, moreBtn, rightBtn));

    const noticesEl = h('div.stu-notices');

    /* ---------- left: objects + assets ---------- */
    const hierList = h('div.stu-hier', { role: 'list', 'aria-label': 'Layers, front to back' });
    const addObjBtn = h('button.stu-mini', { type: 'button', 'aria-label': 'Add an object', title: 'Add an object', onclick: e => addMenu(e.currentTarget) }, icon('plus'), h('span', { text: 'Add' }));
    const hierSec = h('section.stu-sec.stu-sec--grow', { 'aria-label': 'Layers' },
      h('div.stu-sec__head', h('span.stu-sec__title', { text: 'Layers', title: 'Every object, front (top) to back. Drag to reorder.' }), h('span.stu-sec__count'), addObjBtn),
      hierList);
    const outlineEl = h('div.stu-outline');
    const outlineSec = h('section.stu-sec', { 'aria-label': 'Jump to' },
      h('div.stu-sec__head', h('span.stu-sec__title', { text: 'Jump to' })), outlineEl);
    const fileIn = h('input', { type: 'file', accept: 'image/*,audio/*', multiple: true, hidden: true, onchange: e => { importFiles([...e.target.files]); e.target.value = ''; } });
    const assetList = h('div.stu-assets');
    const assetSec = h('section.stu-sec.stu-sec--assets', { 'aria-label': 'Assets' },
      h('div.stu-sec__head', h('span.stu-sec__title', { text: 'Assets' }), h('span.stu-sec__count'),
        h('button.stu-mini', { type: 'button', title: 'Import an image or sound file', onclick: () => fileIn.click() }, icon('upload'), h('span', { text: 'Import' }))),
      assetList, fileIn);
    assetSec.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); assetSec.classList.add('is-drop'); } });
    assetSec.addEventListener('dragleave', e => { if (!assetSec.contains(e.relatedTarget)) assetSec.classList.remove('is-drop'); });
    assetSec.addEventListener('drop', e => { assetSec.classList.remove('is-drop'); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) { e.preventDefault(); importFiles(fs); } });
    const left = h('aside.stu-left', { 'aria-label': 'Objects and assets' }, hierSec, outlineSec, assetSec);

    /* ---------- centre: bar, panes, console ---------- */
    const segScene = h('button', { type: 'button', onclick: () => setMode('scene') }, icon('layers'), h('span', { text: 'Scene' }));
    const segCode = h('button', { type: 'button', onclick: () => setMode('code') }, icon('code'), h('span', { text: 'Code' }));
    const segGame = h('button', { type: 'button', onclick: () => showPane('game') }, icon('play'), h('span', { text: 'Game' }));
    const seg = h('div.seg.stu-seg', { role: 'group', 'aria-label': 'Editor' }, segScene, segCode, segGame);
    const runBtn = h('button.btn.btn--sm.stu-run', { type: 'button', onclick: () => (S.run.on ? stopGame() : runGame()) });
    const restartBtn = h('button.stu-tb.stu-tb--icon', { type: 'button', title: 'Restart the game', 'aria-label': 'Restart the game', onclick: () => runGame() }, icon('refresh'));
    const autoSw = h('button.switch', { type: 'button', role: 'switch', 'aria-label': 'Run after saving', onclick: () => { setPref('autoRun', prefs().autoRun === false); paintCenterBar(); } });
    const cbar = h('div.stu-cbar', seg, h('div.stu-top__grow'),
      h('div.stu-cbar__run', runBtn, restartBtn, h('label.stu-auto', { title: 'Run the game again every time you save or build' }, autoSw, h('span.stu-auto__l', { text: 'Run after saving' }), h('span.stu-auto__s', { text: 'Auto-run', 'aria-hidden': 'true' }))));

    /* scene stage */
    const cv = h('canvas.stu-cv', {
      tabindex: '0', role: 'application',
      'aria-label': 'Scene editor. Click an object to select it and drag to move it; drag a corner to resize. ] and [ step through objects, arrow keys nudge the selected one (Shift for 10 px), Delete removes it, Ctrl+D duplicates, Escape deselects.',
    });
    const stageInfo = h('div.stu-stage__info');
    const stageEmpty = h('div.stu-stage__empty', { hidden: true },
      icon('layers'), h('b', { text: 'This scene is empty' }),
      h('span', { text: 'Add an object, then give it a behaviour to bring it to life.' }),
      h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: e => addMenu(e.currentTarget) }, icon('plus'), h('span', { text: 'Add an object' })));
    const snapBtn = h('button.stu-chipbtn', { type: 'button', 'aria-pressed': 'true', onclick: () => { setPref('snap', prefs().snap === false); paintStageTools(); } }, h('span', { text: 'Snap' }));
    const gridBtn = h('button.stu-chipbtn', { type: 'button', 'aria-pressed': 'true', onclick: () => { setPref('grid', prefs().grid === false); paintStageTools(); drawStage(); } }, h('span', { text: 'Grid' }));
    const liveEl = h('div.stu-sr', { 'aria-live': 'polite' });
    const announce = text => { liveEl.textContent = ''; later(() => { liveEl.textContent = text; }, 30); };
    const stage = h('div.stu-stage', cv, h('div.stu-stage__tools', snapBtn, gridBtn), stageInfo, stageEmpty, liveEl);

    /* code editor */
    const gutPre = h('pre.stu-gut__n', { 'aria-hidden': 'true' });
    const gut = h('div.stu-gut', gutPre);
    const hlLayer = h('div.stu-hl', { 'aria-hidden': 'true' });
    const ta = h('textarea.stu-ta', {
      wrap: 'off', spellcheck: 'false', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
      'aria-label': 'Game document (HTML)',
    });
    const findIn = h('input.stu-find__in', { type: 'search', placeholder: 'Find', 'aria-label': 'Find in code' });
    const findCount = h('span.stu-find__count', { 'aria-live': 'polite' });
    const findBar = h('div.stu-find', { role: 'search', hidden: true },
      icon('search'), findIn, findCount,
      h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Previous match', title: 'Previous (Shift+Enter)', onclick: () => findStep(-1) }, icon('chevron-up')),
      h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Next match', title: 'Next (Enter)', onclick: () => findStep(1) }, icon('chevron-down')),
      h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Close find', title: 'Close (Esc)', onclick: () => closeFind(true) }, icon('x')));
    const codeErr = h('div.stu-codeerr', { hidden: true, role: 'alert' });
    const codeStatus = h('div.stu-codebar');
    const codeWrap = h('div.stu-code',
      findBar, codeErr,
      h('div.stu-ed', gut, h('div.stu-ed__main', hlLayer, ta)),
      codeStatus);

    /* game */
    const gameHost = h('div.stu-game__host');
    const gameIdle = h('div.stu-game__idle',
      icon('play'), h('b', { text: 'The game is not running' }),
      h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => runGame() }, icon('play'), h('span', { text: 'Run' })));
    /* in Code mode the running game sits in a small corner preview, so
       saving shows the result without taking the editor away */
    const miniFold = h('button.stu-game__minib', { type: 'button', onclick: () => { S.miniFolded = !S.miniFolded; paintCenter(); } });
    const gameMini = h('div.stu-game__mini',
      h('button.stu-game__minil', { type: 'button', title: 'Show or hide the preview', onclick: () => { S.miniFolded = !S.miniFolded; paintCenter(); } }, icon('play', { fill: true }), h('span', { text: 'Game' })),
      miniFold,
      h('button.stu-game__minib', { type: 'button', title: 'Show the game bigger', 'aria-label': 'Show the game bigger', onclick: () => showPane('game') }, icon('maximize-2')),
      h('button.stu-game__minib', { type: 'button', title: 'Stop the game', 'aria-label': 'Stop the game', onclick: () => stopGame() }, icon('square', { fill: true })));
    const gameWrap = h('div.stu-game', gameHost, gameIdle, gameMini);

    const panes = h('div.stu-panes', stage, codeWrap, gameWrap);

    /* console */
    const logList = h('div.stu-log__list', { role: 'log', 'aria-label': 'Console output' });
    const logCounts = h('span.stu-log__counts');
    const logToggle = h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Hide console', onclick: () => { S.logOpen = !S.logOpen; paintConsole(); } }, icon('chevron-down'));
    const consoleEl = h('section.stu-log', { 'aria-label': 'Console' },
      h('div.stu-log__head',
        icon('terminal'), h('span.stu-sec__title', { text: 'Console' }), logCounts, h('div.stu-top__grow'),
        h('button.stu-mini', { type: 'button', onclick: () => { S.logs = []; paintConsole(); paintAIActions(); } }, icon('trash'), h('span', { text: 'Clear' })),
        logToggle),
      logList);

    const center = h('main.stu-center', cbar, panes, consoleEl);

    /* ---------- right: inspector / game / assistant ---------- */
    const tabObject = h('button', { type: 'button', role: 'tab', onclick: () => showRight('object') }, h('span', { text: 'Object' }));
    const tabGame = h('button', { type: 'button', role: 'tab', onclick: () => showRight('game') }, h('span', { text: 'Game' }));
    const tabAI = h('button', { type: 'button', role: 'tab', onclick: () => showRight('ai') }, icon('sparkles'), h('span', { text: 'Assistant' }));
    const tabs = h('div.stu-tabs', { role: 'tablist', 'aria-label': 'Inspector' }, tabObject, tabGame, tabAI,
      h('button.stu-tb.stu-tb--icon.stu-only-tiny.stu-tabs__x', { type: 'button', 'aria-label': 'Close panel', onclick: () => toggleDrawer('right', false) }, icon('x')));
    const uid = Math.random().toString(36).slice(2, 7);
    const objPane = h('div.stu-pane.stu-insp', { role: 'tabpanel', id: `stu-p-obj-${uid}`, 'aria-label': 'Object properties' });
    const gamePane = h('div.stu-pane.stu-insp', { role: 'tabpanel', id: `stu-p-game-${uid}`, 'aria-label': 'Game settings' });
    const aiPane = h('div.stu-pane.stu-ai', { role: 'tabpanel', id: `stu-p-ai-${uid}`, 'aria-label': 'Assistant' });
    tabObject.setAttribute('aria-controls', objPane.id);
    tabGame.setAttribute('aria-controls', gamePane.id);
    tabAI.setAttribute('aria-controls', aiPane.id);
    const right = h('aside.stu-right', { 'aria-label': 'Inspector' }, tabs, objPane, gamePane, aiPane);

    const scrim = h('div.stu-scrim', { onclick: () => { S.leftOpen = false; S.rightOpen = false; paintLayout(); } });
    const main = h('div.stu-main', left, center, right, scrim);
    const home = h('div.stu-home');
    const editor = h('div.stu-editor', topbar, noticesEl, main);
    app.append(home, editor);

    /* ================================================================
       Layout
       ================================================================ */
    const ro = new ResizeObserver(() => {
      const w = app.clientWidth;
      const narrow = w < 940, tiny = w < 660;
      if (narrow !== S.narrow || tiny !== S.tiny) {
        S.narrow = narrow; S.tiny = tiny;
        if (!narrow) S.leftOpen = false;
        if (!tiny) S.rightOpen = false;
        paintLayout();
      }
      fitStage();
      paintCenter();
    });
    ro.observe(app);
    /* the stage also changes size when a notice bar comes or goes */
    const roStage = new ResizeObserver(() => { if (!stage.hidden) fitStage(); });
    roStage.observe(stage);

    function paintLayout() {
      app.classList.toggle('is-narrow', S.narrow);
      app.classList.toggle('is-tiny', S.tiny);
      main.classList.toggle('is-left', S.leftOpen);
      main.classList.toggle('is-right', S.rightOpen);
      leftBtn.setAttribute('aria-expanded', String(S.leftOpen));
      rightBtn.setAttribute('aria-expanded', String(S.rightOpen));
      /* a closed drawer is off screen: keep keyboard focus out of it */
      left.inert = S.narrow && !S.leftOpen;
      right.inert = S.tiny && !S.rightOpen;
    }
    function toggleDrawer(side, force) {
      if (side === 'left') { S.leftOpen = force ?? !S.leftOpen; if (S.leftOpen) S.rightOpen = false; }
      else { S.rightOpen = force ?? !S.rightOpen; if (S.rightOpen) S.leftOpen = false; }
      paintLayout();
    }

    /* ---------- notices (drafts, code-only, errors) ---------- */
    function notice(n) {
      S.notices = [...S.notices.filter(x => x.id !== n.id), n];
      paintNotices();
    }
    function dropNotice(id) { S.notices = S.notices.filter(x => x.id !== id); paintNotices(); }
    function paintNotices() {
      clear(noticesEl);
      for (const n of S.notices) {
        noticesEl.append(h(`div.stu-note.stu-note--${n.tone || 'info'}`, { role: n.tone === 'warn' ? 'alert' : 'status' },
          icon(n.icon || (n.tone === 'warn' ? 'alert' : 'info')),
          h('div.stu-note__text', h('b', { text: n.title || '' }), n.text ? h('span', { text: ' ' + n.text }) : null),
          (n.actions || []).map(a => h(`button.btn.btn--sm${a.primary ? '.btn--primary' : ''}`, { type: 'button', text: a.label, onclick: a.onClick })),
          n.close === false ? null : h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Dismiss', onclick: () => dropNotice(n.id) }, icon('x'))));
      }
    }
    const toast = (title, message, ic = 'code') => api.notify({ app: 'Static Studio', icon: ic, title, message, timeout: 4000 });

    /* ================================================================
       Home: templates + projects
       ================================================================ */
    let homeSeq = 0;
    async function paintHome() {
      const seq = ++homeSeq;
      const list = await P.list().catch(() => []);
      if (seq !== homeSeq || S.dead) return;
      clear(home);
      const tpls = h('div.stu-tpls', TEMPLATES.map(t => {
        const c = h('canvas.stu-tpl__cv', { width: 320, height: 180, 'aria-hidden': 'true' });
        try {
          const sc = t.scene();
          const g = c.getContext('2d');
          const k = Math.min(320 / sc.settings.width, 180 / sc.settings.height);
          g.fillStyle = '#0b0b10'; g.fillRect(0, 0, 320, 180);
          g.setTransform(k, 0, 0, k, (320 - sc.settings.width * k) / 2, (180 - sc.settings.height * k) / 2);
          paintScene(g, sc, { px: 1 / k });
          if (t.id === 'blank') {
            /* an empty stage waiting for its first object */
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.strokeStyle = 'rgba(255,255,255,.22)';
            g.setLineDash([5, 4]);
            g.lineWidth = 1.5;
            g.strokeRect(128, 58, 64, 50);
            g.setLineDash([]);
            g.strokeStyle = 'rgba(255,255,255,.55)';
            g.lineWidth = 2;
            g.beginPath(); g.moveTo(160, 74); g.lineTo(160, 92); g.moveTo(151, 83); g.lineTo(169, 83); g.stroke();
          }
        } catch (err) { /* a thumbnail is decoration */ }
        return h('button.stu-tpl', { type: 'button', onclick: () => newFromTemplate(t.id), 'aria-label': `New ${t.name} game` },
          c,
          h('div.stu-tpl__meta', h('span.stu-tpl__ic', icon(t.icon)), h('b', { text: t.name })),
          h('p', { text: t.desc }));
      }));
      const rows = list.map(p => projectRow(p));
      home.append(
        h('div.stu-home__in',
          h('div.stu-hero',
            h('div.stu-hero__glyph', icon('code')),
            h('div',
              h('h1', { text: 'Static Studio' }),
              h('p', { text: 'Build a game with a scene editor, write code when you want to, and ask the assistant for changes — it only changes things when you press Apply.' }))),
          h('h2.stu-h2', { text: 'Start from a template' }),
          tpls,
          h('h2.stu-h2', h('span', { text: 'Your projects' }), list.length ? h('small', { text: plural(list.length, 'project') }) : null),
          rows.length
            ? h('div.stu-plist', rows)
            : h('div.stu-empty', icon('folder-open'), h('b', { text: 'No projects yet' }),
              h('span', { text: 'Start from a template above. Games you make in Forge show up here too, and open in Code mode.' }))));
    }

    function projectRow(p) {
      const html = P.current(p);
      const d = R.readDoc(html);
      const isScene = d.isScene;
      let thumb;
      if (d.scene) {
        thumb = h('canvas.stu-prow__cv', { width: 128, height: 72, 'aria-hidden': 'true' });
        try {
          const g = thumb.getContext('2d');
          const st = d.scene.settings, k = Math.min(128 / st.width, 72 / st.height);
          g.fillStyle = '#0b0b10'; g.fillRect(0, 0, 128, 72);
          g.setTransform(k, 0, 0, k, (128 - st.width * k) / 2, (72 - st.height * k) / 2);
          paintScene(g, d.scene, { px: 1 / k });
        } catch (err) { /* decoration */ }
      } else if (p.published?.thumbnail) {
        thumb = h('img.stu-prow__cv', { src: p.published.thumbnail, alt: '' });
      } else thumb = h('div.stu-prow__cv.stu-prow__cv--code', icon('file-code'));
      const kind = isScene ? 'Scene' : p.source === 'forge' ? 'Code · made in Forge' : 'Code';
      return h('div.stu-prow',
        h('button.stu-prow__main', { type: 'button', onclick: () => openProject(p.id), 'aria-label': `Open ${p.name}` },
          thumb,
          h('div.stu-prow__meta',
            h('b', { text: p.name }),
            h('span', { text: `${kind} · ${plural(p.versions.length, 'version')} · edited ${ago(p.updatedAt)}` })),
          h('span.stu-prow__go', icon('chevron-right'))),
        h('button.stu-tb.stu-tb--icon.stu-prow__more', { type: 'button', 'aria-label': `More for ${p.name}`, 'aria-haspopup': 'menu', onclick: e => projectMenu(p, e.currentTarget) }, icon('more-horizontal')));
    }

    /* ---------- the project menu: other apps, desktop, copy, delete ---------- */
    function projectMenu(p, anchor) {
      const r = anchor.getBoundingClientRect();
      const here = S.view === 'editor' && S.p?.id === p.id;
      const items = [];
      if (!here) items.push({ label: 'Open', icon: 'code', onClick: () => openProject(p.id) });
      if (api.getApp('forge')) items.push({ label: 'Open in Static Forge', hint: 'play · publish', icon: 'sparkles', onClick: () => openInForge(p) });
      items.push({ label: 'Add to Desktop', icon: 'monitor', onClick: () => addToDesktop({ kind: 'creation', id: p.id, title: p.name }) });
      items.push({ label: 'Export .html', hint: 'plays in any browser', icon: 'download', onClick: () => exportProject(p, anchor) });
      if (api.getApp('assetlab')) items.push({ label: 'Make art or sounds in Asset Lab', icon: 'palette', onClick: () => api.openApp('assetlab', { project: p.id }) });
      items.push('-');
      items.push({ label: 'Duplicate', icon: 'copy', onClick: () => duplicateProject(p) });
      items.push({ label: 'Delete project…', icon: 'trash', danger: true, onClick: () => deleteProject(p) });
      api.menu(items, r.left, r.bottom + 4);
    }
    /* Export: one standalone file, the same format Forge exports, so either
       app (or any browser, offline) can open it. The engine, the scene and
       every sprite and sound are inside it. With unsaved changes in the
       open project, you pick: what you see now, or the saved version. */
    function exportProject(p, anchor) {
      const here = S.view === 'editor' && S.p?.id === p.id;
      if (!here || !isDirty()) { exportHtml(p); return; }
      const r = (anchor && anchor.isConnected ? anchor : exportBtn).getBoundingClientRect();
      api.menu([
        { header: true, label: 'Export as one .html file' },
        { label: 'What you see now', hint: 'with unsaved changes', icon: 'download', onClick: () => exportHtml(p, { working: true }) },
        { label: `The saved version (v${p.head + 1})`, hint: 'without them', icon: 'clock', onClick: () => exportHtml(p) },
      ], r.left, r.bottom + 4);
    }
    function exportHtml(p, { working = false } = {}) {
      const here = S.p?.id === p.id;
      const html = working && here ? workingHtml() : P.current(p);
      const n = p.head + 1;
      const safe = s => String(s || '').replace(/--+/g, '-').replace(/[<>]/g, '').slice(0, 80);
      const slug = String(p.name || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'game';
      const which = working && here ? `Version ${n} with unsaved changes` : `Version ${n}`;
      const stamp = `<!-- ${safe(p.name)} — made with Static Studio in StaticOS. ${which}, exported ${new Date().toISOString().slice(0, 10)}. Open this file in any browser to play. -->`;
      const out = /^\s*<!doctype[^>]*>/i.test(html) ? html.replace(/^\s*<!doctype[^>]*>/i, m => `${m}\n${stamp}`) : `${stamp}\n${html}`;
      const url = URL.createObjectURL(new Blob([out], { type: 'text/html' }));
      urls.add(url);
      const a = h('a', { href: url, download: `${slug}.html`, hidden: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      /* the download has its own copy once it starts */
      later(() => { URL.revokeObjectURL(url); urls.delete(url); }, 60000);
      announce(`Exported ${slug}.html`);
      const unsaved = here && isDirty();
      toast(`Exported ${slug}.html`, working && here
        ? `What you see now, as one file that plays in any browser. The changes are still unsaved here: ${S.mode === 'scene' ? 'Build' : 'Save'} to keep them as a version.`
        : unsaved
          ? `That is version ${n}, the saved one: your unsaved changes are not in it.`
          : `Version ${n} as one file that plays in any browser. Static Forge can import it too.`, 'download');
    }
    async function openInForge(p) {
      if (S.p?.id === p.id && isDirty()) {
        toast('Opened the saved version', `Static Forge shows version ${S.p.head + 1}. ${S.mode === 'scene' ? 'Build' : 'Save'} here to include your latest changes.`, 'sparkles');
      }
      api.openApp('forge', { project: p.id });
    }
    async function duplicateProject(p) {
      if (S.p?.id === p.id) await flushDraft();
      S.selfWrite++;
      let copy = null;
      try { copy = await P.duplicate(p.id); }
      catch (err) { toast('Could not duplicate it', err.message, 'alert'); }
      finally { S.selfWrite--; }
      if (!copy || S.dead) return;
      toast('Duplicated', `“${copy.name}” is a separate copy with its own history.`, 'copy');
      if (S.view === 'home') paintHome(); else openProject(copy.id);
    }
    async function deleteProject(p) {
      const ok = await api.confirm({
        title: `Delete “${p.name}”?`,
        message: `Its ${plural(p.versions.length, 'saved version')}${p.assets?.length ? ` and ${plural(p.assets.length, 'asset')}` : ''} are removed from this device. This cannot be undone.${p.published ? ' It is also taken out of your published games.' : ''}`,
        ok: 'Delete', danger: true,
      });
      if (!ok || S.dead) return;
      const open = S.p?.id === p.id;
      S.selfWrite++;
      try {
        await P.remove(p.id);
        await DRAFTS.del(draftKey(p.id)).catch(() => {});
      } catch (err) { toast('Could not delete it', err.message, 'alert'); return; }
      finally { S.selfWrite--; }
      toast('Project deleted', `“${p.name}” is gone.`, 'trash');
      if (open) { S.dirty = false; S.code.dirty = false; S.p = null; await goHomeForce(); }
      else if (S.view === 'home') paintHome();
    }

    async function goHome() {
      if (S.view === 'home') return;
      await flushDraft();
      stopGame(true);
      S.ai.ac?.abort();
      S.view = 'home';
      S.p = null;
      S.notices = [];
      app.dataset.view = 'home';
      win.setSubtitle?.('');
      closeHistory();
      paintHome();
    }

    async function newFromTemplate(id) {
      const t = findTemplate(id) || TEMPLATES[0];
      const scene = t.scene();
      try {
        S.selfWrite++;
        const p = await P.create({
          name: scene.title, prompt: '', html: R.buildDoc(scene), source: 'studio',
          note: `Started from the ${t.name} template`, by: 'you',
        });
        await openProject(p.id);
      } catch (err) {
        toast('Could not create the project', err.message, 'alert');
      } finally { S.selfWrite--; }
    }

    /* ================================================================
       Opening and reloading a project
       ================================================================ */
    async function openProject(id) {
      const p = await P.get(id).catch(() => null);
      if (S.dead) return;
      if (!p) { toast('That project is gone', 'It may have been deleted in another app.', 'alert'); goHome(); return; }
      if (S.p && S.p.id !== id) await flushDraft();
      stopGame(true);
      S.ai.ac?.abort();
      S.view = 'editor';
      app.dataset.view = 'editor';
      S.notices = [];
      paintNotices();
      closeHistory();
      S.played = false;
      S.logs = [];
      S.ai.turns = [];
      S.sel = null;
      closeFind(false);
      setPref('last', id);
      loadHead(p);
      S.mode = S.scene ? 'scene' : 'code';
      S.pane = S.mode;
      S.right = S.mode === 'scene' ? 'object' : 'ai';
      if (S.kind === 'code') {
        notice({ id: 'kind', icon: 'file-code', title: 'Code mode only.', text: 'This game is one HTML file without Studio scene data (for example, made in Forge), so it opens as code. Scene editing is for projects started in Studio.' });
      }
      paintAll();
      paintAIFeed();
      checkDraft(p.id);
      later(() => (S.mode === 'scene' ? cv : ta).focus({ preventScroll: true }), 60);
    }

    /** Take the project's head version as the working state. */
    function loadHead(p, { keepSel = false } = {}) {
      S.p = p;
      S.headHtml = P.current(p);
      S.headId = p.versions[p.head]?.id || null;
      const d = R.readDoc(S.headHtml);
      S.kind = d.isScene ? 'scene' : 'code';
      S.sceneErr = d.isScene && !d.scene ? d : null;
      S.scene = d.scene;
      S.baseHtml = S.headHtml;
      S.baseRuntime = d.runtime;
      S.dirty = false;
      S.undo = []; S.redo = [];
      S.draftLabels = [];
      if (!S.scene && S.mode === 'scene') { S.mode = 'code'; if (S.pane === 'scene') S.pane = 'code'; }
      if (!keepSel || !S.scene?.objects.some(o => o.id === S.sel)) S.sel = null;
      setCode(S.headHtml);
      refreshImages();
      win.setSubtitle?.(p.name);
      if (S.sceneErr) {
        notice({ id: 'scene-err', tone: 'warn', title: 'Scene mode is off until the scene data is fixed.', text: S.sceneErr.errors.slice(0, 2).join(' '),
          actions: S.sceneErr.errorLine ? [{ label: `Go to line ${S.sceneErr.errorLine}`, onClick: () => { setMode('code'); gotoLine(S.sceneErr.errorLine); } }] : [] });
      } else dropNotice('scene-err');
    }

    const isDirty = () => (S.mode === 'code' ? S.code.dirty : S.dirty);

    /** The document as it stands right now, saved or not. */
    function workingHtml() {
      if (S.mode === 'code') return ta.value;
      if (S.kind === 'scene' && S.scene) return compose(S.baseRuntime !== 'modified');
      return S.headHtml;
    }
    function compose(engine = true) {
      return R.writeScene(S.baseHtml, S.scene, { assets: S.p?.assets || [], engine });
    }

    function paintAll() {
      paintLayout();
      paintTop();
      paintLeft();
      paintCenter();
      paintRight();
      paintConsole();
      drawStage();
    }

    /* ================================================================
       Toolbar: name, status, undo/redo, save/build
       ================================================================ */
    async function renameProject(v) {
      const name = String(v || '').trim();
      if (!S.p || !name || name === S.p.name) { nameIn.value = S.p?.name || ''; return; }
      S.selfWrite++;
      try { const p = await P.rename(S.p.id, name); if (p) { S.p.name = p.name; win.setSubtitle?.(p.name); } }
      finally { S.selfWrite--; }
      paintTop();
    }

    function canLocalUndo() { return S.mode === 'scene' && S.undo.length > 0; }
    function canLocalRedo() { return S.mode === 'scene' && S.redo.length > 0; }

    function paintTop() {
      if (!S.p) return;
      if (document.activeElement !== nameIn) nameIn.value = S.p.name;
      clear(statusEl);
      const dirty = isDirty();
      if (dirty) statusEl.append(h('span.stu-dot'), h('span', { text: S.mode === 'scene' ? 'Unsaved — Build to save' : 'Unsaved changes' }));
      else statusEl.append(h('span', { text: `Version ${S.p.head + 1} of ${S.p.versions.length}` }));
      statusEl.classList.toggle('is-dirty', dirty);

      const lu = canLocalUndo(), lr = canLocalRedo();
      const prev = S.p.versions[S.p.head - 1], next = S.p.versions[S.p.head + 1];
      undoBtn.disabled = !lu && !prev;
      redoBtn.disabled = !lr && !next;
      undoBtn.title = lu ? `Undo “${S.undo[S.undo.length - 1].label}” (Ctrl+Z)` : prev ? `Back to version ${S.p.head} — “${prev.note}”` : 'Nothing to undo';
      redoBtn.title = lr ? `Redo “${S.redo[S.redo.length - 1].label}”` : next ? `Forward to version ${S.p.head + 2} — “${next.note}”` : 'Nothing to redo';
      undoBtn.setAttribute('aria-label', undoBtn.title);
      redoBtn.setAttribute('aria-label', redoBtn.title);

      clear(saveBtn);
      const build = S.mode === 'scene';
      saveBtn.append(icon(build ? 'package' : 'save'), h('span', { text: build ? 'Build' : 'Save' }));
      saveBtn.title = build ? 'Write the scene and engine into the game file and save a version (Ctrl+S)' : 'Save a version (Ctrl+S)';
      saveBtn.setAttribute('aria-label', `${build ? 'Build' : 'Save'}${dirty ? ' (unsaved changes)' : ''}`);
      saveBtn.classList.toggle('btn--primary', dirty);
      saveBtn.disabled = S.busy;
      histBtn.title = `${plural(S.p.versions.length, 'version')} — see and restore`;
    }

    /* ================================================================
       Local scene edits: snapshot undo, draft autosave
       ================================================================ */
    function snapshot(label, merge) {
      const top = S.undo[S.undo.length - 1];
      const now = Date.now();
      if (merge && top && top.merge === merge && now - top.at < 1500) { top.at = now; return; }
      S.undo.push({ snap: JSON.stringify(S.scene), sel: S.sel, label, merge: merge || null, at: now });
      if (S.undo.length > 150) S.undo.shift();
      S.redo = [];
    }
    function touched() {
      S.dirty = true;
      scheduleDraft();
      paintTop();
      markRunStale();
      refreshHistory();
    }
    function markRunStale() {
      if (!S.run.on || S.run.dirtyRun) return;
      S.run.dirtyRun = true;
      paintCenterBar();
    }
    /** Change the working scene. paint: which panels need a rebuild. */
    function edit(label, fn, { merge = null, hier = true, insp = true } = {}) {
      if (!S.scene) return;
      snapshot(label, merge);
      fn(S.scene);
      touched();
      drawStage();
      if (hier) paintHier();
      if (insp) paintRight();
    }
    /* paint: false when several steps are taken at once (History) */
    function localUndo({ paint = true } = {}) {
      const e = S.undo.pop();
      if (!e) return;
      S.redo.push({ snap: JSON.stringify(S.scene), sel: S.sel, label: e.label, at: Date.now(), was: e.at });
      S.scene = JSON.parse(e.snap);
      S.sel = S.scene.objects.some(o => o.id === e.sel) ? e.sel : null;
      if (!S.undo.length) S.draftLabels = [];
      S.dirty = S.undo.length > 0 || S.baseHtml !== S.headHtml;
      scheduleDraft();
      markRunStale();
      if (paint) { paintAll(); refreshHistory(); announce(`Undid “${e.label}”`); }
    }
    function localRedo({ paint = true } = {}) {
      const e = S.redo.pop();
      if (!e) return;
      S.undo.push({ snap: JSON.stringify(S.scene), sel: S.sel, label: e.label, at: e.was || Date.now() });
      S.scene = JSON.parse(e.snap);
      S.sel = S.scene.objects.some(o => o.id === e.sel) ? e.sel : null;
      S.dirty = true;
      scheduleDraft();
      markRunStale();
      if (paint) { paintAll(); refreshHistory(); announce(`Redid “${e.label}”`); }
    }

    let draftT = 0;
    function scheduleDraft() { clearTimeout(draftT); draftT = setTimeout(() => { flushDraft(); }, 900); }
    async function flushDraft() {
      clearTimeout(draftT);
      const p = S.p;
      if (!p) return;
      try {
        if (!isDirty()) { await DRAFTS.del(draftKey(p.id)); return; }
        const d = S.mode === 'code'
          ? { mode: 'code', text: ta.value }
          : { mode: 'scene', scene: S.scene, base: S.baseHtml !== S.headHtml ? S.baseHtml : null };
        await DRAFTS.set(draftKey(p.id), { ...d, headId: S.headId, at: Date.now(), labels: [...(S.draftLabels || []), ...S.undo.map(u => u.label)].slice(-30) });
      } catch (err) { /* drafts are a convenience */ }
    }
    const clearDraft = () => { clearTimeout(draftT); if (S.p) DRAFTS.del(draftKey(S.p.id)).catch(() => {}); dropNotice('draft'); };

    async function checkDraft(id) {
      const d = await DRAFTS.get(draftKey(id)).catch(() => null);
      if (!d || S.dead || S.p?.id !== id) return;
      if (d.mode === 'code' && d.text === S.headHtml) { clearDraft(); return; }
      notice({
        id: 'draft', icon: 'clock', title: 'Unsaved changes found.',
        text: `From ${ago(d.at)}${d.headId !== S.headId ? ', made on an earlier version' : ''}.`,
        actions: [
          { label: 'Restore', primary: true, onClick: () => restoreDraft(d) },
          { label: 'Discard', onClick: () => clearDraft() },
        ],
      });
    }
    function restoreDraft(d) {
      dropNotice('draft');
      if (d.mode === 'scene' && S.kind === 'scene' && d.scene) {
        const v = R.validateScene(d.scene);
        if (!v.scene) { toast('The draft could not be restored', v.errors[0], 'alert'); return; }
        if (S.mode !== 'scene') setMode('scene');
        snapshot('Restored unsaved changes');
        S.scene = v.scene;
        S.baseHtml = d.base || S.headHtml;
        S.baseRuntime = R.readDoc(S.baseHtml).runtime;
        S.draftLabels = (d.labels || []).filter(l => l && l !== 'Restored unsaved changes');
        S.dirty = true;
        if (S.sel && !S.scene.objects.some(o => o.id === S.sel)) S.sel = null;
        paintAll();
      } else if (d.mode === 'code' && typeof d.text === 'string') {
        if (S.mode !== 'code') { S.mode = 'code'; S.pane = 'code'; }
        setCode(d.text, true);
        paintAll();
      }
      toast('Unsaved changes restored', S.mode === 'scene' ? 'Build to save them as a version.' : 'Save to keep them as a version.', 'clock');
    }

    /* ================================================================
       Saving: Build (scene) and Save (code)
       ================================================================ */
    async function save() {
      if (!S.p || S.busy) return;
      if (S.mode === 'code') return saveCode();
      return build();
    }

    function buildNote() {
      const labels = [];
      for (const l of [...(S.draftLabels || []), ...S.undo.map(u => u.label)]) if (l && l !== 'Restored unsaved changes' && !labels.includes(l)) labels.push(l);
      if (!labels.length) return S.baseHtml !== S.headHtml ? 'Edited in Code mode' : 'Rebuilt';
      return labels.length > 3 ? `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more` : labels.join(', ');
    }

    async function build() {
      if (!S.scene) return;
      let engine = true;
      if (S.baseRuntime === 'modified') {
        const ok = await api.confirm({
          title: 'Use this Studio’s engine?',
          message: 'The engine code in this game is not the same as this Studio’s: it was edited by hand or by the assistant, or the game was built with an older Studio. Build writes the current engine in. Your scene and your game-code script are kept.',
          ok: 'Build',
        });
        if (!ok) return;
      }
      const html = compose(engine);
      if (html === S.headHtml) {
        S.dirty = false; S.undo = []; S.redo = []; clearDraft(); paintTop();
        toast('Already up to date', 'The game file already matches the scene.', 'check');
        return;
      }
      await commitHtml(html, buildNote(), 'you');
    }

    async function saveCode() {
      const text = ta.value;
      if (S.kind === 'scene') {
        const d = R.readDoc(text);
        if (!d.isScene) {
          const ok = await api.confirm({
            title: 'Save without scene data?',
            message: 'The <script id="scene"> block is gone, so from now on this game opens in Code mode only. You can undo this afterwards.',
            ok: 'Save anyway', danger: true,
          });
          if (!ok) return;
        } else if (d.errors.length) {
          showCodeErrors(d.errors, d.errorLine || d.sceneLine);
          return;
        }
      }
      hideCodeErrors();
      if (text === S.headHtml) { S.code.dirty = false; clearDraft(); paintTop(); toast('Nothing to save', 'The code matches the saved version.', 'check'); return; }
      const df = diffLines(S.headHtml, text);
      /* scene edits made before switching to Code keep their names in the note */
      const sceneEdits = S.kind === 'scene' && (S.undo.length || S.draftLabels?.length)
        && JSON.stringify(R.readDoc(text).scene) !== JSON.stringify(R.readDoc(S.headHtml).scene);
      await commitHtml(text, sceneEdits ? `${buildNote()} (+${df.added} −${df.removed} lines)` : `Edited code (+${df.added} −${df.removed} lines)`, 'you');
    }

    async function commitHtml(html, note, by) {
      if (!S.p) return null;
      S.busy = true;
      paintTop();
      S.selfWrite++;
      let p = null;
      try { p = await P.commit(S.p.id, html, note, by); }
      catch (err) { toast('Could not save', err.message, 'alert'); }
      finally { S.selfWrite--; S.busy = false; }
      if (!p || S.dead) { paintTop(); return null; }
      const mode = S.mode;
      loadHead(p, { keepSel: true });
      if (S.scene && mode === 'scene') S.mode = 'scene';
      clearDraft();
      paintAll();
      if (prefs().autoRun !== false) runGame();
      return p;
    }

    /* ================================================================
       History: undo / redo / restore (project versions)
       ================================================================ */
    async function confirmDiscard(what) {
      if (!isDirty()) return true;
      return api.confirm({
        title: 'Discard unsaved changes?',
        message: `${what} drops the changes you have not ${S.mode === 'scene' ? 'built' : 'saved'} yet.`,
        ok: 'Discard', danger: true,
      });
    }
    async function versionMove(fn, what) {
      if (!S.p) return;
      if (!(await confirmDiscard(what))) return;
      S.selfWrite++;
      let p = null;
      try { p = await fn(S.p.id); } finally { S.selfWrite--; }
      if (!p || S.dead) return;
      const mode = S.mode;
      loadHead(p, { keepSel: true });
      if (mode === 'scene' && S.scene) S.mode = 'scene';
      clearDraft();
      paintAll();
      /* a running game follows the version, but stays where it is on screen */
      if (S.run.on) runGame({ reveal: false });
    }
    function undo() {
      if (canLocalUndo()) return localUndo();
      if (S.p?.head > 0) return versionMove(P.undo, 'Going back a version');
    }
    function redo() {
      if (canLocalRedo()) return localRedo();
      if (S.p && S.p.head < S.p.versions.length - 1) return versionMove(P.redo, 'Going forward a version');
    }

    let histPop = null;
    function closeHistory() {
      if (!histPop) return;
      histPop.remove();
      histPop = null;
      histBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDocDown, true);
    }
    function onDocDown(e) { if (histPop && !histPop.contains(e.target) && !histBtn.contains(e.target)) closeHistory(); }
    /* the scene edits since the last Build, newest at the top: undone ones
       (redo-able) above, then the ones in effect. Any row is one click. */
    function editRows() {
      if (S.mode !== 'scene' || (!S.undo.length && !S.redo.length)) return null;
      const jump = (fn, n) => { for (let k = 0; k < n; k++) fn({ paint: false }); paintAll(); fillHistory(); histPop?.querySelector('button')?.focus(); };
      const rows = [
        ...S.redo.map((e, i) => h('div.stu-ver.stu-ver--edit.is-undone',
          h('span.stu-ver__n', icon('rotate-ccw')),
          h('div.stu-ver__meta', h('span.stu-ver__note', { text: e.label }), h('span.stu-ver__sub', { text: 'undone' })),
          h('button.btn.btn--sm', { type: 'button', title: `Redo up to “${e.label}”`, onclick: () => jump(localRedo, S.redo.length - i) }, h('span', { text: 'Redo' })))),
        ...S.undo.map((e, j) => ({ e, j })).reverse().map(({ e, j }) => h(`div.stu-ver.stu-ver--edit${j === S.undo.length - 1 ? '.is-cur' : ''}`,
          h('span.stu-ver__n', icon('edit-3')),
          h('div.stu-ver__meta', h('span.stu-ver__note', { text: e.label }), h('span.stu-ver__sub', { text: `${ago(e.at)}${j === S.undo.length - 1 ? ' · latest' : ''}` })),
          h('button.btn.btn--sm', { type: 'button', title: `Undo back to before “${e.label}”`, onclick: () => jump(localUndo, S.undo.length - j) }, h('span', { text: 'Undo' })))),
      ];
      return [
        h('div.stu-pop__head', h('b', { text: 'Unsaved edits' }), h('span', { text: `${plural(S.undo.length, 'edit')} since the last Build${S.redo.length ? `, ${S.redo.length} undone` : ''} · Ctrl+Z undoes, Ctrl+Shift+Z redoes.` })),
        h('div.stu-pop__list.stu-pop__list--edits', rows),
      ];
    }
    function fillHistory() {
      if (!histPop || !S.p) return;
      clear(histPop);
      const byLabel = { you: 'You', ai: 'Assistant', revert: 'Restore' };
      const rows = S.p.versions.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
        const cur = i === S.p.head, undone = i > S.p.head;
        return h(`div.stu-ver${cur ? '.is-cur' : ''}${undone ? '.is-undone' : ''}`,
          h('span.stu-ver__n', { text: `v${i + 1}` }),
          h('div.stu-ver__meta',
            h('span.stu-ver__note', { text: v.note || 'Edited' }),
            h('span.stu-ver__sub', h(`span.stu-by.stu-by--${v.by || 'you'}`, { text: byLabel[v.by] || v.by || 'You' }), h('span', { text: ` ${ago(v.at)}${undone ? ' · undone' : ''}` }))),
          cur ? h('span.stu-ver__cur', { text: 'Current' })
            : h('button.btn.btn--sm', { type: 'button', onclick: () => { closeHistory(); versionMove(id => P.restore(id, i), `Restoring version ${i + 1}`); } }, h('span', { text: 'Restore' })));
      });
      histPop.append(
        ...(editRows() || []),
        h('div.stu-pop__head', h('b', { text: 'Saved versions' }), h('span', { text: 'Restoring adds a new version, so nothing is lost.' })),
        h('div.stu-pop__list', rows));
    }
    function toggleHistory(anchor) {
      if (histPop) { closeHistory(); return; }
      if (!S.p) return;
      histPop = h('div.stu-pop', { role: 'dialog', 'aria-label': 'History' });
      fillHistory();
      app.appendChild(histPop);
      const r = anchor.getBoundingClientRect(), a = app.getBoundingClientRect();
      histPop.style.top = `${r.bottom - a.top + 6}px`;
      histPop.style.left = `${clamp(r.left - a.left - 120, 8, Math.max(8, a.width - 348))}px`;
      histBtn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onDocDown, true);
      histPop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeHistory(); histBtn.focus(); } });
      histPop.querySelector('button')?.focus();
    }
    /* an open History follows undo / redo made with the keys or buttons */
    const refreshHistory = () => { if (histPop) fillHistory(); };

    /* ================================================================
       Mode switching (Scene ⇄ Code) and centre panes
       ================================================================ */
    function setMode(mode) {
      if (!S.p) return;
      if (mode === S.mode) { showPane(mode); return; }
      if (mode === 'scene') {
        if (S.kind !== 'scene') { toast('No scene in this project', 'Scene editing works on projects started in Studio.', 'info'); return; }
        const text = ta.value;
        const d = R.readDoc(text);
        if (!d.isScene || !d.scene) {
          showCodeErrors(d.isScene ? d.errors : ['The scene block is missing from the document.'], d.errorLine || d.sceneLine);
          return;
        }
        hideCodeErrors();
        S.sceneErr = null;
        dropNotice('scene-err');
        const changedHere = text !== S.headHtml;
        if (changedHere && S.scene && JSON.stringify(d.scene) !== JSON.stringify(S.scene)) { S.mode = 'scene'; snapshot('Edited in Code mode'); }
        S.scene = d.scene;
        S.baseHtml = text;
        S.baseRuntime = d.runtime;
        S.dirty = changedHere;
        if (S.sel && !S.scene.objects.some(o => o.id === S.sel)) S.sel = null;
        S.mode = 'scene';
        if (S.right === 'ai' && !S.rightPinnedAI) S.right = 'object';
      } else {
        if (S.mode === 'scene' && S.dirty) setCode(compose(S.baseRuntime !== 'modified'), true);
        else if (S.mode === 'scene') setCode(S.headHtml);
        S.mode = 'code';
        if (S.right !== 'ai') S.right = 'ai';
      }
      S.pane = S.mode;
      closeFind(false);
      scheduleDraft();
      paintAll();
      (S.mode === 'scene' ? cv : ta).focus({ preventScroll: true });
    }

    function showPane(pane) {
      if (pane === 'game' && !S.run.on) runGame({ reveal: false });
      S.pane = pane === 'game' ? 'game' : S.mode;
      paintCenter();
      if (S.pane === 'game') S.run.sb?.focus();
    }

    const splitOK = () => S.mode === 'code' && panes.clientWidth >= 860;
    const miniOK = () => S.mode === 'code' && !splitOK() && panes.clientWidth >= 480 && panes.clientHeight >= 260;
    /* does the game need its own pane to be seen? (not when split or in the corner preview) */
    const gameNeedsPane = () => !splitOK() && !miniOK();
    function paintCenter() {
      if (!S.p) return;
      const split = S.run.on && splitOK();
      const pane = S.pane;
      const mini = S.run.on && !split && S.mode === 'code' && pane !== 'game' && miniOK();
      stage.hidden = !(S.mode === 'scene' && pane !== 'game');
      codeWrap.hidden = !(S.mode === 'code' && (pane !== 'game' || split));
      gameWrap.hidden = !(pane === 'game' || split || mini);
      panes.classList.toggle('is-split', split && !codeWrap.hidden && !gameWrap.hidden);
      panes.classList.toggle('is-mini', mini);
      gameWrap.classList.toggle('is-folded', mini && !!S.miniFolded);
      if (mini) {
        clear(miniFold);
        miniFold.append(icon(S.miniFolded ? 'chevron-up' : 'minus'));
        miniFold.title = S.miniFolded ? 'Show the preview' : 'Fold the preview away (the game keeps its place)';
        miniFold.setAttribute('aria-label', S.miniFolded ? 'Show the preview' : 'Fold the preview away');
        miniFold.setAttribute('aria-expanded', String(!S.miniFolded));
      }
      segScene.hidden = S.kind !== 'scene';
      segScene.setAttribute('aria-pressed', String(S.mode === 'scene' && pane !== 'game'));
      segCode.setAttribute('aria-pressed', String(S.mode === 'code' && pane !== 'game'));
      segScene.classList.toggle('is-on', S.mode === 'scene' && pane !== 'game');
      segCode.classList.toggle('is-on', S.mode === 'code' && (pane !== 'game' || split));
      segGame.classList.toggle('is-on', pane === 'game' || split);
      segGame.setAttribute('aria-pressed', String(pane === 'game'));
      segGame.hidden = !S.run.on || split;
      paintCenterBar();
      if (!stage.hidden) fitStage();
      if (!codeWrap.hidden) syncCode();
    }
    function paintCenterBar() {
      clear(runBtn);
      runBtn.append(icon(S.run.on ? 'square' : 'play', { fill: true }), h('span', { text: S.run.on ? 'Stop' : 'Run' }));
      runBtn.classList.toggle('btn--primary', !S.run.on);
      runBtn.title = S.run.on ? 'Stop the game' : 'Run the game (Ctrl+Enter)';
      restartBtn.hidden = !S.run.on;
      /* the running game is older than what you see in the editor */
      const stale = S.run.on && S.run.dirtyRun;
      restartBtn.classList.toggle('is-stale', stale);
      restartBtn.title = stale ? 'Restart with your latest changes' : 'Restart the game';
      restartBtn.setAttribute('aria-label', restartBtn.title);
      const auto = prefs().autoRun !== false;
      autoSw.classList.toggle('is-on', auto);
      autoSw.setAttribute('aria-checked', String(auto));
    }

    /* ================================================================
       Preview + console
       ================================================================ */
    function log(kind, text, fromGame = false) {
      let s = String(text);
      let line = 0;
      if (fromGame && (kind === 'error' || kind === 'uncaught')) {
        /* the sandbox puts its console bridge in front of the game, which
           pushes every line number down; report the game's own lines */
        s = s.replace(/\(line (\d+)\)/g, (m, n) => { line = Math.max(1, Number(n) - PRELUDE_LINES); return `(line ${line})`; });
      }
      S.logs.push({ t: Date.now(), kind, text: s, line });
      if (S.logs.length > MAX_LOG) S.logs.splice(0, S.logs.length - MAX_LOG);
      queueConsole();
    }
    let consoleQ = false;
    function queueConsole() {
      if (consoleQ) return;
      consoleQ = true;
      nextFrame(() => { consoleQ = false; paintConsole(); paintAIActions(); });
    }

    function runGame({ reveal = true } = {}) {
      if (!S.p) return;
      const html = workingHtml();
      const wasShown = S.run.on && S.pane === 'game';
      stopGame(true);
      const unsaved = isDirty();
      log('system', `Game started${unsaved ? ' (with unsaved changes)' : ` (version ${S.p.head + 1})`}`);
      S.run.on = true;
      S.run.dirtyRun = false;
      S.run.html = html;
      /* StaticOS's own Reduce motion setting reaches the game through a
         marker in the preview copy (on the <head> line, so no line moves) */
      const still = !!store.get('prefs.reduceMotion');
      const shown = still && /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => `${m}<meta name="studio-reduce-motion" content="reduce">`) : html;
      S.run.sb = SB.run(gameHost, shown, {
        title: `${S.p.name} — game preview`,
        onLog: (kind, text) => log(kind, text, true),
      });
      S.run.sb.frame.classList.add('stu-frame');
      if (wasShown || (reveal && gameNeedsPane())) S.pane = 'game';
      paintCenter();
      /* your own game, played: it goes in the shared play history once per visit */
      if (!S.played) {
        S.played = true;
        try { Plays.record({ kind: 'creation', id: S.p.id, title: S.p.name }); } catch (err) { /* history is a nicety */ }
      }
      if (reveal || wasShown) later(() => { if (S.run.on && S.pane === 'game') S.run.sb?.focus(); }, 80);
    }
    function stopGame(silent) {
      if (!S.run.sb) { S.run.on = false; return; }
      S.run.sb.stop();
      S.run.sb = null;
      S.run.on = false;
      if (!silent) log('system', 'Game stopped');
      if (S.pane === 'game') S.pane = S.mode;
      if (!silent) paintCenter();
    }

    function paintConsole() {
      consoleEl.classList.toggle('is-closed', !S.logOpen);
      logToggle.setAttribute('aria-label', S.logOpen ? 'Hide console' : 'Show console');
      logToggle.setAttribute('aria-expanded', String(S.logOpen));
      const errs = S.logs.filter(l => l.kind === 'error' || l.kind === 'uncaught').length;
      const warns = S.logs.filter(l => l.kind === 'warn').length;
      const msgs = S.logs.filter(l => l.kind !== 'system').length;
      clear(logCounts);
      if (errs) logCounts.append(h('span.stu-cnt.stu-cnt--err', { text: plural(errs, 'error') }));
      if (warns) logCounts.append(h('span.stu-cnt.stu-cnt--warn', { text: plural(warns, 'warning') }));
      if (!errs && !warns && msgs) logCounts.append(h('span.stu-cnt', { text: plural(msgs, 'message') }));
      if (!S.logOpen) return;
      const stick = logList.scrollHeight - logList.scrollTop - logList.clientHeight < 24;
      clear(logList);
      if (!S.logs.length) {
        logList.append(h('div.stu-log__empty', { text: 'Nothing yet. Run the game — anything it prints with console.log, and any error, shows up here.' }));
        return;
      }
      for (const l of S.logs) {
        const ic = l.kind === 'error' || l.kind === 'uncaught' ? 'x-circle' : l.kind === 'warn' ? 'alert' : l.kind === 'system' ? (/stopped/i.test(l.text) ? 'square' : 'play') : 'chevron-right';
        logList.append(h(`div.stu-log__row.stu-log__row--${l.kind === 'uncaught' ? 'error' : l.kind}`,
          h('time.stu-log__t', { text: hms(l.t), datetime: new Date(l.t).toISOString() }),
          icon(ic),
          h('span.stu-log__x', { text: l.kind === 'uncaught' ? `Uncaught: ${l.text}` : l.text }),
          l.line ? h('button.stu-log__go', { type: 'button', title: `Show line ${l.line} in the code`, 'aria-label': `Go to line ${l.line}`, onclick: () => goToErrorLine(l.line) }, h('span', { text: `Line ${l.line}` }), icon('arrow-right')) : null));
      }
      if (stick) logList.scrollTop = logList.scrollHeight;
    }
    function goToErrorLine(line) {
      if (S.mode !== 'code') setMode('code');
      if (S.mode !== 'code') return;
      if (S.pane === 'game') showPane('code');
      if (S.narrow) { S.leftOpen = false; S.rightOpen = false; paintLayout(); }
      gotoLine(line, true);
    }
    const errorsNow = () => {
      const lastRun = S.logs.map(l => l.kind === 'system' && /^Game started/.test(l.text)).lastIndexOf(true);
      const out = [];
      for (const l of S.logs.slice(Math.max(0, lastRun))) {
        if ((l.kind === 'error' || l.kind === 'uncaught') && !out.includes(l.text)) out.push(l.text);
      }
      return out.slice(0, 8);
    };

    /* ================================================================
       Left panel: hierarchy, outline, assets
       ================================================================ */
    function paintLeft() {
      hierSec.hidden = S.mode !== 'scene';
      outlineSec.hidden = !(S.mode === 'code' && S.kind === 'scene');
      paintHier();
      paintOutline();
      paintAssets();
    }

    /* ---------- layers: draw order, lock, hide, reorder ---------- */
    /** The objects in the order they are drawn, back to front: layer
        number first, then place in the scene (the engine sorts the same). */
    const drawOrder = () => (S.scene?.objects || []).map((o, i) => [o, i])
      .sort((a, b) => (a[0].layer || 0) - (b[0].layer || 0) || a[1] - b[1]).map(x => x[0]);
    /** Put `o` directly in front of / behind `ref` in the draw order. It
        takes ref's layer number and the place next to it in the scene, so
        nothing else moves. */
    function placeObject(sc, o, ref, where) {
      const arr = sc.objects;
      arr.splice(arr.indexOf(o), 1);
      const i = arr.indexOf(ref);
      arr.splice(where === 'front' ? i + 1 : i, 0, o);
      o.layer = ref.layer || 0;
    }
    /** to: 'forward' | 'backward' | 'front' | 'back' */
    function arrange(id, to) {
      const o = S.scene?.objects.find(x => x.id === id);
      if (!o) return false;
      const D = drawOrder();
      const k = D.indexOf(o);
      const ref = to === 'forward' ? D[k + 1] : to === 'backward' ? D[k - 1] : to === 'front' ? D[D.length - 1] : D[0];
      if (!ref || ref === o) { announce(`${o.name} is already at the ${to === 'forward' || to === 'front' ? 'front' : 'back'}`); return false; }
      const where = to === 'forward' || to === 'front' ? 'front' : 'behind';
      const words = { forward: 'Brought %s forward', backward: 'Sent %s backward', front: 'Brought %s to the front', back: 'Sent %s to the back' };
      edit(words[to].replace('%s', o.name), sc => placeObject(sc, o, ref, where));
      announce(words[to].replace('%s', o.name));
      return true;
    }
    function toggleLock(o) {
      const on = !o.locked;
      edit(on ? `Locked ${o.name}` : `Unlocked ${o.name}`, () => { if (on) o.locked = true; else delete o.locked; });
      announce(on ? `${o.name} locked: the stage will not move, resize or delete it` : `${o.name} unlocked`);
    }
    /* a locked object refuses stage edits; say so instead of doing nothing */
    function lockedNote(o, what) {
      announce(`${o.name} is locked`);
      stageInfo.textContent = `${o.name} is locked — unlock it in Layers to ${what} it`;
      later(() => drawStage(), 1800);
    }

    function paintHier() {
      if (S.mode !== 'scene' || !S.scene) return;
      const objs = drawOrder().reverse();
      hierSec.querySelector('.stu-sec__count').textContent = String(objs.length);
      clear(hierList);
      if (!objs.length) {
        hierList.append(h('div.stu-hier__empty', { text: 'No objects yet. Use Add to place one.' }));
        return;
      }
      for (const o of objs) {
        const on = o.id === S.sel;
        const img = o.sprite && S.p?.assets?.find(a => a.id === o.sprite);
        const sw = o.text ? h('span.stu-sw.stu-sw--text', { text: 'T', style: { color: o.color } })
          : img ? h('img.stu-sw', { src: img.dataUrl, alt: '' })
          : h(`span.stu-sw${o.shape === 'ellipse' ? '.stu-sw--round' : ''}`, { style: { background: o.color } });
        const hidden = o.visible === false, locked = !!o.locked;
        hierList.append(h(`div.stu-hrow${on ? '.is-on' : ''}${hidden ? '.is-hidden' : ''}${locked ? '.is-locked' : ''}`, { role: 'listitem', dataset: { id: o.id } },
          h('button.stu-hrow__main', {
            type: 'button', 'aria-pressed': String(on),
            title: 'Click to select · drag to reorder · Alt+↑/↓ moves it forward or back',
            onclick: () => { if (rowDrag.ate) { rowDrag.ate = false; return; } select(o.id, true); },
            ondblclick: () => { select(o.id, true); later(() => objPane.querySelector('input')?.focus(), 30); },
            onkeydown: e => hierKey(e, o.id),
            onpointerdown: e => rowDragStart(e, o.id),
          }, h('span.stu-hrow__grip', { 'aria-hidden': 'true' }), sw, h('span.stu-hrow__name', { text: o.name }), h('span.stu-hrow__role', icon(roleIcon(o))),
          o.layer ? h('span.stu-hrow__layer', { text: `L${o.layer}`, title: `Layer ${o.layer}` }) : null),
          h('button.stu-hrow__lock', {
            type: 'button', 'aria-pressed': String(locked),
            'aria-label': locked ? `Unlock ${o.name}` : `Lock ${o.name}`,
            title: locked ? 'Locked — click to unlock' : 'Lock (the stage will not move, resize or delete it)',
            onclick: () => toggleLock(o),
          }, icon(locked ? 'lock' : 'unlock')),
          h('button.stu-hrow__eye', {
            type: 'button', 'aria-pressed': String(hidden),
            'aria-label': hidden ? `Show ${o.name}` : `Hide ${o.name}`, title: hidden ? 'Hidden — click to show' : 'Hide',
            onclick: () => edit(hidden ? `Showed ${o.name}` : `Hid ${o.name}`, () => { o.visible = hidden; }),
          }, icon('eye'))));
      }
      const onRow = hierList.querySelector('.is-on');
      if (onRow) {
        const top = onRow.offsetTop, bottom = top + onRow.offsetHeight;
        if (top < hierList.scrollTop) hierList.scrollTop = top - 4;
        else if (bottom > hierList.scrollTop + hierList.clientHeight) hierList.scrollTop = bottom - hierList.clientHeight + 4;
      }
    }
    function hierKey(e, id) {
      const objs = drawOrder().reverse();
      const i = objs.findIndex(o => o.id === id);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) {
        e.preventDefault();
        /* up the list is toward the front */
        if (arrange(id, e.key === 'ArrowUp' ? 'forward' : 'backward')) hierList.querySelector(`[data-id="${CSS.escape(id)}"] .stu-hrow__main`)?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = objs[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, objs.length - 1)];
        select(n.id, true);
        hierList.querySelector('.is-on .stu-hrow__main')?.focus();
      } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (S.sel !== id) select(id, true); removeSelected(); }
    }

    /* drag a row up or down the list to change what is drawn in front */
    const rowDrag = { on: null, ate: false };
    function rowDragStart(e, id) {
      /* touch drags scroll the list; on touch, Arrange (or Alt+↑/↓) reorders */
      if (e.button !== 0 || !S.scene || e.pointerType === 'touch') return;
      const btn = e.currentTarget;
      const st = { id, y0: e.clientY, moving: false, slot: -1, line: null };
      rowDrag.on = st;
      rowDrag.ate = false;
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
      const rows = () => [...hierList.querySelectorAll('.stu-hrow')];
      const move = ev => {
        if (rowDrag.on !== st) return;
        if (!st.moving) {
          if (Math.abs(ev.clientY - st.y0) < 5) return;
          st.moving = true;
          btn.closest('.stu-hrow')?.classList.add('is-dragging');
          st.line = h('div.stu-hier__drop', { 'aria-hidden': 'true' });
          hierList.appendChild(st.line);
        }
        /* slot k = just above row k (k = rows.length: below the last one) */
        const rs = rows();
        let k = rs.length;
        for (let j = 0; j < rs.length; j++) {
          const r = rs[j].getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { k = j; break; }
        }
        st.slot = k;
        const ref = rs[Math.min(k, rs.length - 1)];
        st.line.style.top = `${k < rs.length ? ref.offsetTop - 1 : ref.offsetTop + ref.offsetHeight - 1}px`;
        /* keep the list scrolling while dragging near its edges */
        const lr = hierList.getBoundingClientRect();
        if (ev.clientY < lr.top + 18) hierList.scrollTop -= 8;
        else if (ev.clientY > lr.bottom - 18) hierList.scrollTop += 8;
      };
      const up = () => {
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
        if (rowDrag.on !== st) return;
        rowDrag.on = null;
        st.line?.remove();
        btn.closest('.stu-hrow')?.classList.remove('is-dragging');
        if (!st.moving) return;
        /* the click that follows a drag is not a select */
        rowDrag.ate = true;
        later(() => { rowDrag.ate = false; }, 0);
        dropRow(st.id, st.slot);
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    }
    /** Move object `id` to list slot `slot` (the front-first list, as shown). */
    function dropRow(id, slot) {
      const list = drawOrder().reverse();
      const o = list.find(x => x.id === id);
      const from = list.indexOf(o);
      if (!o || slot < 0 || slot === from || slot === from + 1) return;
      const rest = list.filter(x => x !== o);
      const at = slot > from ? slot - 1 : slot;
      const under = rest[at], over = rest[at - 1];
      /* in front of whatever ends up under it, or behind the one above at the very back */
      if (under) edit(`Moved ${o.name} in the layers`, sc => placeObject(sc, o, under, 'front'));
      else if (over) edit(`Moved ${o.name} in the layers`, sc => placeObject(sc, o, over, 'behind'));
      else return;
      select(o.id, false);
      announce(`Moved ${o.name} to position ${at + 1} of ${list.length}, counting from the front`);
    }

    function paintOutline() {
      if (outlineSec.hidden) return;
      clear(outlineEl);
      const d = R.readDoc(ta.value);
      const items = [
        ['Scene data', d.sceneLine, 'layers'],
        ['Your code', d.codeLine, 'code'],
        ['Engine (Studio)', d.runtimeLine, 'cpu'],
      ].filter(x => x[1]);
      for (const [label, line, ic] of items) {
        outlineEl.append(h('button.stu-oline', { type: 'button', onclick: () => gotoLine(line) }, icon(ic), h('span', { text: label }), h('small', { text: `line ${line}` })));
      }
      if (!items.length) outlineEl.append(h('div.stu-hier__empty', { text: 'No Studio blocks found in this document.' }));
    }

    function refreshImages() {
      const keep = new Set();
      for (const a of S.p?.assets || []) {
        if (a.kind !== 'image') continue;
        keep.add(a.id);
        const cur = S.images.get(a.id);
        if (cur && cur.src === a.dataUrl) continue;
        const im = new Image();
        im.onload = () => drawStage();
        im.src = a.dataUrl;
        S.images.set(a.id, im);
      }
      for (const id of [...S.images.keys()]) if (!keep.has(id)) S.images.delete(id);
    }

    let audioEl = null;
    function paintAssets() {
      const as = S.p?.assets || [];
      assetSec.querySelector('.stu-sec__count').textContent = as.length ? String(as.length) : '';
      clear(assetList);
      if (!as.length) {
        assetList.append(h('div.stu-assets__empty',
          h('span', { text: 'No images or sounds yet. Import a file (or drop it here)' + (api.getApp?.('assetlab') ? ', or make one in Asset Lab.' : '.') }),
          api.getApp?.('assetlab') ? h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('assetlab', { project: S.p?.id }) }, icon('palette'), h('span', { text: 'Open Asset Lab' })) : null));
        return;
      }
      const sel = selObj();
      for (const a of as) {
        const thumb = a.kind === 'image' ? h('img.stu-asset__th', { src: a.dataUrl, alt: '' }) : h('span.stu-asset__th.stu-asset__th--snd', icon('music'));
        let primary = null;
        if (S.mode === 'scene' && a.kind === 'image') {
          primary = h('button.stu-mini', {
            type: 'button', disabled: !sel || !!sel?.text,
            title: sel ? `Use as the sprite of ${sel.name}` : 'Select an object first',
            onclick: () => { const o = selObj(); if (o) edit(`Gave ${o.name} a sprite`, () => { o.sprite = a.id; }); },
          }, h('span', { text: 'Use' }));
        } else if (a.kind === 'audio') {
          primary = h('button.stu-mini', { type: 'button', 'aria-label': `Play ${a.name}`, title: 'Listen', onclick: () => { try { audioEl?.pause(); audioEl = new Audio(a.dataUrl); audioEl.play().catch(() => {}); } catch (err) { /* no audio */ } } }, icon('play'));
        }
        const more = h('button.stu-mini.stu-mini--icon', { type: 'button', 'aria-label': `More for ${a.name}`, onclick: e => assetMenu(a, e.currentTarget) }, icon('more-horizontal'));
        const insert = S.mode === 'code' ? h('button.stu-mini', { type: 'button', title: S.kind === 'scene' ? 'Add code that uses this asset to your game code' : 'Add code that uses this asset at the cursor', 'aria-label': `Insert code for ${a.name}`, onclick: () => insertSnippet(a) }, h('span', { text: 'Insert' })) : null;
        assetList.append(h('div.stu-asset', thumb,
          h('div.stu-asset__meta', h('span.stu-asset__name', { text: a.name, title: a.name }), h('small', { text: a.kind === 'image' ? 'Image' : 'Sound' })),
          insert, primary, more));
      }
    }
    function assetMenu(a, anchor) {
      const r = anchor.getBoundingClientRect();
      const sel = selObj();
      const items = [];
      if (S.mode === 'scene' && a.kind === 'image') {
        items.push({ label: sel ? `Use as sprite of ${sel.name}` : 'Use as sprite (select an object first)', icon: 'image', disabled: !sel || !!sel.text, onClick: () => { const o = selObj(); if (o) edit(`Gave ${o.name} a sprite`, () => { o.sprite = a.id; }); } });
        items.push({ label: 'New object with this sprite', icon: 'plus', onClick: () => addObject('sprite', a) });
      }
      if (S.mode === 'code') items.push({ label: 'Insert code into the game', icon: 'code', onClick: () => insertSnippet(a) });
      items.push({ label: 'Copy code snippet', icon: 'copy', onClick: () => copySnippet(a) });
      /* Asset Lab opens a copy to draw on; saving there adds it here as a new asset */
      if (a.kind === 'image' && api.getApp('assetlab')) items.push({ label: 'Edit a copy in Asset Lab', icon: 'palette', onClick: () => api.openApp('assetlab', { edit: { project: S.p.id, asset: a.id } }) });
      items.push('-');
      items.push({ label: 'Remove from project', icon: 'trash', danger: true, onClick: () => removeAsset(a) });
      api.menu(items, r.left, r.bottom + 4);
    }
    function snippet(a, inserted = false) {
      /* a name the code does not use yet, so inserting twice still runs */
      const base = varName(a.name);
      const taken = n => new RegExp(`\\b(?:const|let|var|function)\\s+${n}\\b`).test(ta.value);
      let v = base;
      for (let k = 2; taken(v) && k < 99; k++) v = `${base}${k}`;
      if (S.kind === 'scene') {
        const where = inserted ? '' : ' (in your game code; the asset is in the game file after Build or Insert)';
        return a.kind === 'image'
          ? `// draws "${a.name}" on top of the game${where}\nconst ${v} = game.image(${JSON.stringify(a.name)});\ngame.on('draw', ctx => { if (${v}) ctx.drawImage(${v}, 20, 60, 48, 48); });`
          : `// plays "${a.name}" when the game starts${where}\ngame.on('start', () => game.play(${JSON.stringify(a.name)}));`;
      }
      return a.kind === 'image'
        ? `const ${v} = new Image();\n${v}.src = "${a.dataUrl}";`
        : `const ${v} = new Audio("${a.dataUrl}");\n// ${v}.play();`;
    }
    async function copySnippet(a) {
      const text = snippet(a);
      try {
        await navigator.clipboard.writeText(text);
        toast('Snippet copied', `Paste it into your code to use “${a.name}”.`, 'copy');
      } catch (err) {
        if (S.mode === 'code') insertSnippet(a);
        else toast('Could not copy', 'The browser blocked the clipboard. Switch to Code and use Insert instead.', 'alert');
      }
    }
    /** Is `pos` inside the body of a JavaScript <script> block? */
    function inScriptAt(v, pos) {
      const open = v.lastIndexOf('<script', pos), close = v.lastIndexOf('</script', pos - 1);
      if (open < 0 || open < close) return false;
      const tagEnd = v.indexOf('>', open);
      if (tagEnd < 0 || tagEnd >= pos) return false;
      return !/type\s*=\s*["']?(application\/json|text\/template|text\/html)/i.test(v.slice(open, tagEnd));
    }
    /** Put code that uses an asset into the document: into the game-code
        script for scene games, at the cursor (wrapped in a script when the
        cursor is in markup) for everything else. */
    function insertSnippet(a) {
      if (S.mode !== 'code') { copySnippet(a); return; }
      if (S.pane === 'game') showPane('code');
      const code = snippet(a, true);
      let pos = ta.selectionStart, text;
      let extra = '';
      if (S.kind === 'scene') {
        /* the engine reads sprites and sounds from the studio-assets block:
           bring it up to date first, as a visible edit you can see and undo */
        const am = ta.value.match(/(<script\b[^>]*\bid\s*=\s*["']studio-assets["'][^>]*>)([\s\S]*?)(<\/script\s*>)/i);
        if (am && !am[2].includes(JSON.stringify(a.id))) {
          const bs = am.index + am[1].length;
          const keep = ta.selectionStart;
          ta.focus({ preventScroll: true });
          ta.setSelectionRange(bs, bs + am[2].length);
          const body = `\n${R.assetsJSON(S.p?.assets || [])}\n`;
          insertText(body);
          pos = keep > bs ? keep + body.length - am[2].length : keep;
          extra = ' The asset list in the file was updated too.';
        }
      }
      const v = ta.value;
      if (S.kind === 'scene') {
        const m = v.match(/(<script\b[^>]*\bid\s*=\s*["']game-code["'][^>]*>)([\s\S]*?)(<\/script\s*>)/i);
        if (!m) { toast('No game-code script', 'The <script id="game-code"> block is missing, so there is nowhere safe to put it.', 'alert'); return; }
        const start = m.index + m[1].length, end = start + m[2].length;
        if (pos < start || pos > end) pos = end;
        text = `${v[pos - 1] === '\n' ? '' : '\n'}${code}\n`;
      } else if (inScriptAt(v, pos)) {
        text = `\n${code}\n`;
      } else {
        text = `\n<script>\n${code}\n</script>\n`;
      }
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, pos);
      insertText(text);
      const line = lineOf(ta.value, pos + 1);
      gotoLine(line);
      ta.setSelectionRange(pos, pos + text.length);
      toast('Code inserted', `Line ${line} now uses “${a.name}”.${extra} Save to keep it.`, 'code');
    }
    async function removeAsset(a) {
      const used = S.scene?.objects.filter(o => o.sprite === a.id) || [];
      const ok = await api.confirm({
        title: `Remove “${a.name}”?`,
        message: used.length ? `${plural(used.length, 'object')} use it as a sprite and will show their colour instead.` : 'It is removed from this project. Earlier versions of the game keep their copy.',
        ok: 'Remove', danger: true,
      });
      if (!ok || !S.p) return;
      S.selfWrite++;
      try { await P.removeAsset(S.p.id, a.id); } finally { S.selfWrite--; }
      await reloadAssets();
      if (used.length) edit(`Removed ${a.name}`, () => { for (const o of S.scene.objects) if (o.sprite === a.id) o.sprite = null; });
      else if (S.kind === 'scene') { snapshot(`Removed ${a.name}`); touched(); }
    }
    async function reloadAssets() {
      const p = await P.get(S.p?.id).catch(() => null);
      if (!p || S.dead || p.id !== S.p?.id) return;
      S.p.assets = p.assets;
      S.p.updatedAt = p.updatedAt;
      refreshImages();
      paintAssets();
      paintRight();
      drawStage();
    }
    async function importFiles(files) {
      if (!S.p) return;
      let added = 0;
      for (const f of files) {
        const kind = /^image\//.test(f.type) ? 'image' : /^audio\//.test(f.type) ? 'audio' : null;
        if (!kind) { toast(`“${f.name}” was skipped`, 'Studio imports images and sounds.', 'alert'); continue; }
        if (kind === 'audio' && f.size > 3 * 1024 * 1024) { toast(`“${f.name}” is too big`, 'Sounds up to 3 MB fit in a game file. Try a shorter clip.', 'alert'); continue; }
        try {
          const dataUrl = kind === 'image' ? await imageDataUrl(f) : await readAsDataUrl(f);
          S.selfWrite++;
          try { await P.addAsset(S.p.id, { name: f.name, kind, dataUrl }); } finally { S.selfWrite--; }
          added++;
        } catch (err) { toast(`Could not import “${f.name}”`, err.message, 'alert'); }
      }
      if (!added) return;
      await reloadAssets();
      if (S.kind === 'scene' && S.mode === 'scene') { snapshot(`Imported ${plural(added, 'asset')}`); touched(); }
      toast(`Imported ${plural(added, 'file')}`, S.mode === 'scene' ? 'Select an object and press Use to make it a sprite.' : 'Press Insert to put code that uses it into your game.', 'upload');
    }

    /* ================================================================
       Scene stage: drawing, selection, drag, resize, keys
       ================================================================ */
    const SG = { g: cv.getContext('2d'), cw: 0, ch: 0, dpr: 1, s: 1, ox: 0, oy: 0, drag: null, hover: null, raf: 0 };
    const selObj = () => (S.scene && S.sel ? S.scene.objects.find(o => o.id === S.sel) || null : null);

    function fitStage() {
      if (stage.hidden || !S.scene) return;
      const r = stage.getBoundingClientRect();
      const cw = Math.max(50, Math.floor(r.width)), ch = Math.max(50, Math.floor(r.height));
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      if (cw !== SG.cw || ch !== SG.ch || dpr !== SG.dpr) {
        SG.cw = cw; SG.ch = ch; SG.dpr = dpr;
        cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
        cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
      }
      const st = S.scene.settings;
      const pad = S.tiny ? 14 : 34;
      SG.s = Math.max(0.05, Math.min((cw - pad * 2) / st.width, (ch - pad * 2 - 18) / st.height));
      SG.ox = Math.round((cw - st.width * SG.s) / 2);
      SG.oy = Math.round((ch - st.height * SG.s) / 2 - 4);
      drawStage();
    }
    function drawStage() {
      if (SG.raf || S.dead) return;
      SG.raf = requestAnimationFrame(() => { SG.raf = 0; paintStage(); });
    }
    function handlesOf(o) {
      const x = SG.ox + o.x * SG.s, y = SG.oy + o.y * SG.s, w = o.w * SG.s, hh = o.h * SG.s;
      const hs = [['nw', x, y], ['ne', x + w, y], ['sw', x, y + hh], ['se', x + w, y + hh]];
      if (w > 30) hs.push(['n', x + w / 2, y], ['s', x + w / 2, y + hh]);
      if (hh > 30) hs.push(['w', x, y + hh / 2], ['e', x + w, y + hh / 2]);
      return hs;
    }
    function paintStage() {
      if (stage.hidden || !S.scene) return;
      const g = SG.g, st = S.scene.settings;
      g.setTransform(SG.dpr, 0, 0, SG.dpr, 0, 0);
      g.clearRect(0, 0, SG.cw, SG.ch);
      g.setTransform(SG.dpr * SG.s, 0, 0, SG.dpr * SG.s, SG.dpr * SG.ox, SG.dpr * SG.oy);
      g.save();
      g.beginPath(); g.rect(0, 0, st.width, st.height); g.clip();
      paintScene(g, S.scene, { images: S.images, grid: prefs().grid === false ? 0 : 32, px: 1 / SG.s, paths: true, sel: S.sel });
      g.restore();
      /* objects that stick out of the game area, faintly */
      g.save();
      g.globalAlpha = 0.35;
      for (const o of S.scene.objects) {
        if (o.x >= 0 && o.y >= 0 && o.x + o.w <= st.width && o.y + o.h <= st.height) continue;
        g.fillStyle = o.color || '#888';
        g.fillRect(o.x, o.y, o.w, o.h);
      }
      g.restore();
      g.setTransform(SG.dpr, 0, 0, SG.dpr, 0, 0);
      /* game-area frame */
      g.strokeStyle = 'rgba(255,255,255,.16)';
      g.lineWidth = 1;
      g.strokeRect(SG.ox - 0.5, SG.oy - 0.5, st.width * SG.s + 1, st.height * SG.s + 1);
      const accent = getComputedStyle(app).getPropertyValue('--accent').trim() || '#ff456d';
      const hv = SG.hover && SG.hover !== S.sel && S.scene.objects.find(o => o.id === SG.hover);
      if (hv) {
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.setLineDash([4, 3]);
        g.strokeRect(SG.ox + hv.x * SG.s - 0.5, SG.oy + hv.y * SG.s - 0.5, hv.w * SG.s + 1, hv.h * SG.s + 1);
        g.setLineDash([]);
        label(g, hv.name, SG.ox + hv.x * SG.s, SG.oy + hv.y * SG.s, 'rgba(20,20,28,.85)', '#fff');
      }
      const o = selObj();
      if (o) {
        const x = SG.ox + o.x * SG.s, y = SG.oy + o.y * SG.s;
        g.strokeStyle = accent;
        g.lineWidth = 1.5;
        /* a locked object has no handles: a dashed frame says "look, don't touch" */
        if (o.locked) g.setLineDash([5, 3]);
        g.strokeRect(x - 1, y - 1, o.w * SG.s + 2, o.h * SG.s + 2);
        g.setLineDash([]);
        if (!o.locked) {
          for (const [, hx, hy] of handlesOf(o)) {
            g.fillStyle = '#fff';
            g.fillRect(hx - 4, hy - 4, 8, 8);
            g.strokeStyle = accent;
            g.strokeRect(hx - 4.5, hy - 4.5, 9, 9);
          }
        }
        label(g, `${o.locked ? 'Locked · ' : ''}${o.name}  ${Math.round(o.x)}, ${Math.round(o.y)}  ${Math.round(o.w)}×${Math.round(o.h)}`, x, y, accent, '#fff');
      }
      stageInfo.textContent = `${st.width} × ${st.height} · ${plural(S.scene.objects.length, 'object')} · ${Math.round(SG.s * 100)}%`;
      stageEmpty.hidden = S.scene.objects.length > 0;
    }
    function label(g, text, x, y, bg, fg) {
      g.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
      const w = g.measureText(text).width + 12;
      const ly = y - 22 < 2 ? y + 4 : y - 22;
      const lx = clamp(x - 1, 2, SG.cw - w - 2);
      g.fillStyle = bg;
      g.beginPath();
      if (g.roundRect) g.roundRect(lx, ly, w, 18, 5); else g.rect(lx, ly, w, 18);
      g.fill();
      g.fillStyle = fg;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillText(text, lx + 6, ly + 9.5);
    }
    function paintStageTools() {
      const snap = prefs().snap !== false, grid = prefs().grid !== false;
      snapBtn.setAttribute('aria-pressed', String(snap));
      snapBtn.classList.toggle('is-on', snap);
      snapBtn.title = snap ? `Snapping to ${SNAP} px (hold Alt to move freely)` : 'Snapping is off';
      gridBtn.setAttribute('aria-pressed', String(grid));
      gridBtn.classList.toggle('is-on', grid);
    }

    const toScene = e => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left - SG.ox) / SG.s, y: (e.clientY - r.top - SG.oy) / SG.s, sx: e.clientX - r.left, sy: e.clientY - r.top };
    };
    /* the front-most object under a point; locked ones are passed over, so a
       locked background never gets in the way of what sits on it */
    function objAt(x, y) {
      const list = S.scene.objects.map((o, i) => [o, i]).sort((a, b) => (b[0].layer || 0) - (a[0].layer || 0) || b[1] - a[1]);
      const tol = 3 / SG.s;
      for (const [o] of list) if (!o.locked && x >= o.x - tol && x <= o.x + o.w + tol && y >= o.y - tol && y <= o.y + o.h + tol) return o;
      return null;
    }
    function handleAt(sx, sy) {
      const o = selObj();
      if (!o || o.locked) return null;
      const x = SG.ox + o.x * SG.s, y = SG.oy + o.y * SG.s, w = o.w * SG.s, hh = o.h * SG.s;
      /* on a thin or small object the grab zones would cover all of it, so
         from inside it they only count right on the handle: the rest moves it */
      const inside = sx > x + 2 && sx < x + w - 2 && sy > y + 2 && sy < y + hh - 2;
      const small = w < 30 || hh < 30;
      for (const [dir, hx, hy] of handlesOf(o)) {
        const dx = Math.abs(sx - hx), dy = Math.abs(sy - hy);
        if (dx > 7 || dy > 7) continue;
        if (inside && small && (dx > 3 || dy > 3)) continue;
        return dir;
      }
      return null;
    }
    const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
    const snapV = (v, e) => (prefs().snap !== false && !e.altKey ? Math.round(v / SNAP) * SNAP : Math.round(v));

    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !S.scene) return;
      cv.focus({ preventScroll: true });
      const pt = toScene(e);
      const dir = handleAt(pt.sx, pt.sy);
      if (dir) {
        const o = selObj();
        SG.drag = { kind: 'resize', dir, id: o.id, start: { x: o.x, y: o.y, w: o.w, h: o.h }, px: pt.x, py: pt.y, moved: false };
      } else {
        const o = objAt(pt.x, pt.y);
        select(o ? o.id : null, false);
        if (o) SG.drag = { kind: 'move', id: o.id, start: { x: o.x, y: o.y }, px: pt.x, py: pt.y, moved: false };
      }
      if (SG.drag) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!S.scene) return;
      const pt = toScene(e);
      const d = SG.drag;
      if (!d) {
        const dir = handleAt(pt.sx, pt.sy);
        const o = dir ? null : objAt(pt.x, pt.y);
        cv.style.cursor = dir ? CURSOR[dir] : o ? 'move' : 'default';
        const hv = o ? o.id : null;
        if (hv !== SG.hover) { SG.hover = hv; drawStage(); }
        return;
      }
      const o = S.scene.objects.find(x => x.id === d.id);
      if (!o) { SG.drag = null; return; }
      const dx = pt.x - d.px, dy = pt.y - d.py;
      if (!d.moved) {
        if (Math.hypot(dx * SG.s, dy * SG.s) < 3) return;
        d.moved = true;
        snapshot(d.kind === 'move' ? `Moved ${o.name}` : `Resized ${o.name}`);
      }
      if (d.kind === 'move') {
        o.x = snapV(d.start.x + dx, e);
        o.y = snapV(d.start.y + dy, e);
      } else {
        const s = d.start;
        let x = s.x, y = s.y, w = s.w, hh = s.h;
        if (d.dir.includes('e')) w = snapV(s.x + s.w + dx, e) - s.x;
        if (d.dir.includes('s')) hh = snapV(s.y + s.h + dy, e) - s.y;
        if (d.dir.includes('w')) { x = snapV(s.x + dx, e); w = s.x + s.w - x; }
        if (d.dir.includes('n')) { y = snapV(s.y + dy, e); hh = s.y + s.h - y; }
        if (w < 4) { if (d.dir.includes('w')) x = s.x + s.w - 4; w = 4; }
        if (hh < 4) { if (d.dir.includes('n')) y = s.y + s.h - 4; hh = 4; }
        Object.assign(o, { x, y, w, h: hh });
      }
      drawStage();
      syncGeom(o);
    });
    const endDrag = () => {
      const d = SG.drag;
      SG.drag = null;
      if (d?.moved) { touched(); paintRight(); }
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('pointerleave', () => { if (!SG.drag && SG.hover) { SG.hover = null; drawStage(); } });
    cv.addEventListener('dblclick', e => {
      const pt = toScene(e);
      const o = objAt(pt.x, pt.y);
      if (o) { select(o.id, false); showRight('object'); later(() => objPane.querySelector('input')?.focus(), 30); }
    });
    cv.addEventListener('keydown', e => {
      const o = selObj();
      const mod = e.ctrlKey || e.metaKey;
      const bracket = e.code === 'BracketRight' ? ']' : e.code === 'BracketLeft' ? '[' : e.key === '}' ? ']' : e.key === '{' ? '[' : e.key;
      if (e.key.startsWith('Arrow') && o && o.locked) { e.preventDefault(); lockedNote(o, 'move'); }
      else if (e.key.startsWith('Arrow') && o) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        edit(`Moved ${o.name}`, () => { o.x += dx; o.y += dy; }, { merge: `nudge:${o.id}`, hier: false, insp: false });
        syncGeom(o);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && o) { e.preventDefault(); removeSelected(); }
      else if (mod && e.key.toLowerCase() === 'd' && o) { e.preventDefault(); duplicateSelected(); }
      else if (e.key === 'Escape' && o) { e.preventDefault(); select(null, false); }
      /* Ctrl+] / Ctrl+[ forward / backward, with Shift all the way */
      else if (mod && (bracket === ']' || bracket === '[') && o) {
        e.preventDefault();
        arrange(o.id, bracket === ']' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward'));
      }
      else if ((e.key === ']' || e.key === '[') && !mod && S.scene.objects.length) {
        /* step through objects without a mouse */
        e.preventDefault();
        const objs = S.scene.objects, i = objs.findIndex(x => x.id === S.sel);
        const n = e.key === ']' ? (i + 1) % objs.length : (i <= 0 ? objs.length - 1 : i - 1);
        select(objs[n].id, false);
        announce(`${objs[n].name} selected`);
      }
    });

    function select(id, fromList) {
      if (S.sel === id) { if (id && S.right === 'game') showRight('object'); return; }
      S.sel = id;
      if (id && S.right !== 'object' && S.right !== 'ai') S.right = 'object';
      paintHier();
      paintRight();
      paintAssets();
      drawStage();
      if (fromList && S.narrow) toggleDrawer('left', false);
    }

    const uniqueName = base => {
      const names = new Set((S.scene?.objects || []).map(o => o.name));
      if (!names.has(base)) return base;
      for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
    };
    function addMenu(anchor) {
      if (!S.scene) return;
      const r = anchor.getBoundingClientRect();
      const items = PRESETS.map(p => ({ label: p.label, icon: p.icon, onClick: () => addObject(p.id) }));
      const imgs = (S.p?.assets || []).filter(a => a.kind === 'image');
      if (imgs.length) {
        items.push('-');
        items.push({ label: 'Sprite from assets', icon: 'image', items: imgs.map(a => ({ label: a.name, icon: 'image', onClick: () => addObject('sprite', a) })) });
      }
      api.menu(items, r.left, r.bottom + 4);
    }
    function addObject(presetId, asset) {
      const st = S.scene.settings;
      let base;
      if (presetId === 'sprite' && asset) {
        const im = S.images.get(asset.id);
        const k = im && im.naturalWidth ? Math.min(1, 64 / Math.max(im.naturalWidth, im.naturalHeight)) : 1;
        base = { name: varName(asset.name).replace(/^./, c => c.toUpperCase()) || 'Sprite', group: R.groupOf(asset.name.replace(/\.[a-z0-9]+$/i, '')), w: im?.naturalWidth ? Math.round(im.naturalWidth * k) : 48, h: im?.naturalHeight ? Math.round(im.naturalHeight * k) : 48, color: '#8b93a7', sprite: asset.id };
      } else base = (PRESETS.find(p => p.id === presetId) || PRESETS[0]).make();
      const n = S.scene.objects.length;
      const o = {
        id: R.newId('o'), name: uniqueName(base.name), group: base.group || R.groupOf(base.name),
        x: Math.round((st.width - base.w) / 2 + (n % 6) * 16 - 40), y: Math.round((st.height - base.h) / 2 + (n % 6) * 12 - 30),
        w: base.w, h: base.h, color: base.color || '#8b93a7', shape: base.shape || 'rect', sprite: base.sprite || null,
        text: base.text || '', solid: !!base.solid, visible: true, layer: base.layer || 0, behaviours: base.behaviours || [],
      };
      o.x = snapV(o.x, {}); o.y = snapV(o.y, {});
      edit(`Added ${o.name}`, sc => { sc.objects.push(o); });
      select(o.id, false);
      showRight('object');
      cv.focus({ preventScroll: true });
    }
    function removeSelected() {
      const o = selObj();
      if (!o) return;
      if (o.locked) { lockedNote(o, 'delete'); return; }
      const refs = S.scene.events.filter(ev => ev.a === `id:${o.id}` || ev.b === `id:${o.id}`);
      edit(`Removed ${o.name}`, sc => {
        sc.objects = sc.objects.filter(x => x.id !== o.id);
        if (refs.length) sc.events = sc.events.filter(ev => !refs.includes(ev));
      });
      S.sel = null;
      paintHier(); paintRight(); drawStage();
      if (refs.length) toast(`Removed ${o.name}`, `${plural(refs.length, 'event')} that pointed at it went too. Undo brings both back.`, 'trash');
      cv.focus({ preventScroll: true });
    }
    function duplicateSelected() {
      const o = selObj();
      if (!o) return;
      const c = JSON.parse(JSON.stringify(o));
      c.id = R.newId('o');
      c.name = uniqueName(o.name.replace(/\s+\d+$/, ''));
      c.x += 16; c.y += 16;
      edit(`Duplicated ${o.name}`, sc => { sc.objects.splice(sc.objects.indexOf(o) + 1, 0, c); });
      select(c.id, false);
    }

    /* ================================================================
       Right panel: Object / Game / Assistant
       ================================================================ */
    function showRight(tab) {
      if (tab !== 'ai' && S.mode !== 'scene') tab = 'ai';
      S.right = tab;
      if (S.tiny) { S.rightOpen = true; S.leftOpen = false; paintLayout(); }
      paintRight();
      if (tab === 'ai') later(() => aiIn.focus({ preventScroll: true }), 40);
    }
    function paintRight() {
      if (!S.p) return;
      const scene = S.mode === 'scene';
      tabObject.hidden = !scene;
      tabGame.hidden = !scene;
      if (!scene) S.right = 'ai';
      for (const [t, id] of [[tabObject, 'object'], [tabGame, 'game'], [tabAI, 'ai']]) {
        t.setAttribute('aria-selected', String(S.right === id));
        t.classList.toggle('is-on', S.right === id);
        t.tabIndex = S.right === id ? 0 : -1;
      }
      objPane.hidden = S.right !== 'object';
      gamePane.hidden = S.right !== 'game';
      aiPane.hidden = S.right !== 'ai';
      aiBtn.classList.toggle('is-on', S.right === 'ai');
      if (S.right === 'object') paintObject();
      else if (S.right === 'game') paintGameSettings();
      else paintAIActions();
    }

    /* ---------- form bits ---------- */
    let fid = 0;
    const field = (labelText, control, hint) => {
      const id = `stu-f-${++fid}`;
      control.id = control.id || id;
      return h('div.stu-f', h('label.stu-f__l', { for: control.id, text: labelText }), control, hint ? h('div.stu-f__h', { text: hint }) : null);
    };
    const numIn = (value, onval, { min, max, step = 1, label: aria } = {}) => h('input.stu-in.stu-in--num', {
      type: 'number', value: String(Math.round(Number(value) * 100) / 100), min, max, step, 'aria-label': aria,
      oninput: e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onval(min !== undefined || max !== undefined ? clamp(v, min ?? -Infinity, max ?? Infinity) : v); },
    });
    const txtIn = (value, onval, attrs = {}) => h('input.stu-in', { type: 'text', value: value ?? '', spellcheck: 'false', ...attrs, oninput: e => onval(e.target.value) });
    const selIn = (value, options, onval, attrs = {}) => h('select.stu-in', { ...attrs, onchange: e => onval(e.target.value) },
      options.map(([v, l]) => h('option', { value: v, text: l, selected: String(v) === String(value) })));
    const sw = (on, onval, aria) => h(`button.switch${on ? '.is-on' : ''}`, {
      type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': aria,
      onclick: e => { const next = e.currentTarget.getAttribute('aria-checked') !== 'true'; onval(next); },
    });
    const swRow = (labelText, on, onval, hint) => h('div.stu-swrow', h('div', h('span.stu-f__l', { text: labelText }), hint ? h('div.stu-f__h', { text: hint }) : null), sw(on, onval, labelText));
    const colorIn = (value, onval, aria) => {
      const hx = hex6(value) || '#888888';
      const txt = h('input.stu-in.stu-in--hex', { type: 'text', value: value || '', spellcheck: 'false', 'aria-label': `${aria} (hex)`,
        onchange: e => { const v = e.target.value.trim(); if (v) { onval(v); const x = hex6(v); if (x) pick.value = x; } } });
      const pick = h('input.stu-color', { type: 'color', value: hx, 'aria-label': aria, oninput: e => { txt.value = e.target.value; onval(e.target.value); } });
      return h('div.stu-colorrow', pick, txt);
    };
    const sectionH = (title, extra) => h('div.stu-ih', h('span', { text: title }), extra || null);

    let geomRefs = null;
    function syncGeom(o) {
      if (!geomRefs || geomRefs.id !== o.id) return;
      for (const k of ['x', 'y', 'w', 'h']) {
        const el = geomRefs[k];
        if (el && document.activeElement !== el) el.value = String(Math.round(o[k] * 100) / 100);
      }
    }

    function paintObject() {
      clear(objPane);
      geomRefs = null;
      /* Element.append writes a skipped (null) part out as the text "null" */
      const add = (...kids) => objPane.append(...kids.filter(k => k !== null && k !== undefined && k !== false));
      const o = selObj();
      if (!o) {
        add(h('div.stu-insp__none',
          h('div.stu-insp__noneic', icon('mouse-pointer')),
          h('b', { text: 'Nothing selected' }),
          h('span', { text: 'Click an object in the scene or in the Layers list to change it. Or set up the whole game in the Game tab.' }),
          h('div.stu-insp__quick', PRESETS.slice(0, 6).map(p => h('button.stu-mini', { type: 'button', onclick: () => addObject(p.id) }, icon(p.icon), h('span', { text: p.label.replace(/\s*\(.*\)$/, '').replace('Player — ', 'Player: ').replace('Enemy — ', 'Enemy: ') }))))));
        return;
      }
      const set = (label, fn, opts = {}) => edit(label, () => fn(o), { merge: opts.merge, hier: !!opts.hier, insp: !!opts.insp });

      /* identity */
      const spriteAsset = o.sprite && !o.text ? (S.p?.assets || []).find(a => a.id === o.sprite && a.kind === 'image') : null;
      add(
        h('div.stu-ohead',
          o.text ? h('span.stu-sw.stu-sw--lg.stu-sw--text', { text: 'T', style: { color: o.color } })
            : spriteAsset ? h('img.stu-sw.stu-sw--lg.stu-sw--img', { src: spriteAsset.dataUrl, alt: '' })
            : h(`span.stu-sw.stu-sw--lg${o.shape === 'ellipse' ? '.stu-sw--round' : ''}`, { style: { background: o.color } }),
          h('div.stu-ohead__t', h('b', { text: o.name }), h('span', { text: (o.behaviours || []).map(b => R.behaviourDef(b.type)?.label).filter(Boolean).join(' · ') || (o.solid ? 'Solid object' : 'Decoration') })),
          h('button.stu-tb.stu-tb--icon', { type: 'button', title: 'Duplicate (Ctrl+D)', 'aria-label': `Duplicate ${o.name}`, onclick: duplicateSelected }, icon('copy')),
          h('button.stu-tb.stu-tb--icon.stu-danger', { type: 'button', title: o.locked ? 'Locked — unlock it to remove it' : 'Remove (Delete)', 'aria-label': `Remove ${o.name}`, disabled: !!o.locked, onclick: removeSelected }, icon('trash'))),
      );

      const groups = [...new Set(S.scene.objects.map(x => x.group).filter(Boolean))];
      const dl = h('datalist', { id: `stu-groups-${++fid}` }, groups.map(gr => h('option', { value: gr })));
      add(
        sectionH('Object'),
        field('Name', txtIn(o.name, v => set(`Renamed ${o.name}`, x => { x.name = v.slice(0, 60) || x.name; }, { merge: `name:${o.id}`, hier: true }), { maxlength: '60' })),
        field('Group', txtIn(o.group, v => set(`Changed ${o.name}'s group`, x => { x.group = v.toLowerCase().trim().slice(0, 32); }, { merge: `group:${o.id}` }), { list: dl.id, maxlength: '32' }),
          'Events can target every object in a group, like all coins.'),
        dl);

      const gx = numIn(o.x, v => set(`Moved ${o.name}`, x => { x.x = v; }, { merge: `pos:${o.id}` }), { label: 'X' });
      const gy = numIn(o.y, v => set(`Moved ${o.name}`, x => { x.y = v; }, { merge: `pos:${o.id}` }), { label: 'Y' });
      const gw = numIn(o.w, v => set(`Resized ${o.name}`, x => { x.w = Math.max(1, v); }, { merge: `size:${o.id}` }), { min: 1, max: 4000, label: 'Width' });
      const gh = numIn(o.h, v => set(`Resized ${o.name}`, x => { x.h = Math.max(1, v); }, { merge: `size:${o.id}` }), { min: 1, max: 4000, label: 'Height' });
      geomRefs = { id: o.id, x: gx, y: gy, w: gw, h: gh };
      if (o.locked) for (const el of [gx, gy, gw, gh]) el.disabled = true;
      add(
        sectionH('Position and size'),
        h('div.stu-grid4',
          h('label.stu-xy', h('span', { text: 'X' }), gx), h('label.stu-xy', h('span', { text: 'Y' }), gy),
          h('label.stu-xy', h('span', { text: 'W' }), gw), h('label.stu-xy', h('span', { text: 'H' }), gh)),
        o.locked ? h('div.stu-f__h.stu-pad', { text: 'Locked: unlock it under Layer to move or resize it.' }) : null);

      /* look */
      const imgs = (S.p?.assets || []).filter(a => a.kind === 'image');
      const spriteOpts = [['', 'None — use the colour'], ...imgs.map(a => [a.id, a.name])];
      if (o.sprite && !imgs.some(a => a.id === o.sprite)) spriteOpts.push([o.sprite, '(missing image)']);
      add(
        sectionH('Look'),
        field('Colour', colorIn(o.color, v => set(`Recoloured ${o.name}`, x => { x.color = v; }, { merge: `color:${o.id}`, hier: true }), 'Colour')),
        o.text ? null : h('div.stu-f', h('span.stu-f__l', { text: 'Shape' }),
          h('div.seg.stu-seg--full', { role: 'group', 'aria-label': 'Shape' },
            [['rect', 'Box'], ['ellipse', 'Round']].map(([v, l]) => h(`button${o.shape === v ? '.is-on' : ''}`, {
              type: 'button', 'aria-pressed': String(o.shape === v), text: l,
              onclick: () => set(`Made ${o.name} ${l.toLowerCase()}`, x => { x.shape = v; }, { hier: true, insp: true }),
            })))),
        o.text ? null : field('Sprite', selIn(o.sprite || '', spriteOpts, v => set(`Changed ${o.name}'s sprite`, x => { x.sprite = v || null; }, { hier: true, insp: true })),
          imgs.length ? 'A sprite is drawn stretched to the object’s size.' : 'Import an image in Assets to use it as a sprite.'),
        field('Text', txtIn(o.text, v => set(`Changed ${o.name}'s text`, x => { x.text = v.slice(0, 200); }, { merge: `text:${o.id}`, hier: true }), { maxlength: '200', placeholder: 'Empty — draws a shape' }),
          'Shows text instead of a shape. {score}, {lives} and {time} fill in live.'));

      add(
        sectionH('Physics'),
        swRow('Solid', o.solid, v => set(v ? `Made ${o.name} solid` : `Made ${o.name} pass-through`, x => { x.solid = v; }, { insp: true }), 'Players and enemies can’t move through it.'));

      /* layer: what is drawn in front, hide, lock */
      const D = drawOrder(), at = D.indexOf(o);
      const arrBtn = (to, ic, text, title, off) => h('button.stu-mini', { type: 'button', title, 'aria-label': title, disabled: off, onclick: () => arrange(o.id, to) }, icon(ic), h('span', { text }));
      add(
        sectionH('Layer'),
        swRow('Visible', o.visible !== false, v => set(v ? `Showed ${o.name}` : `Hid ${o.name}`, x => { x.visible = v; }, { hier: true, insp: true })),
        swRow('Locked', !!o.locked, v => { if (v !== !!o.locked) toggleLock(o); }, 'The stage will not pick, move, resize or delete it. Its settings here still work.'),
        h('div.stu-f', h('span.stu-f__l', { text: `Arrange · ${at + 1 === D.length ? 'in front of everything' : at === 0 ? 'behind everything' : `${D.length - at} of ${D.length} from the front`}` }),
          h('div.stu-arrange', { role: 'group', 'aria-label': 'Arrange' },
            arrBtn('backward', 'arrow-down', 'Backward', 'Send backward (Ctrl+[)', at === 0),
            arrBtn('forward', 'arrow-up', 'Forward', 'Bring forward (Ctrl+])', at === D.length - 1),
            arrBtn('back', 'chevron-down', 'To back', 'Send to back (Ctrl+Shift+[)', at === 0),
            arrBtn('front', 'chevron-up', 'To front', 'Bring to front (Ctrl+Shift+])', at === D.length - 1))),
        field('Layer number', numIn(o.layer || 0, v => set(`Changed ${o.name}'s layer`, x => { x.layer = Math.round(v); }, { merge: `layer:${o.id}`, hier: true }), { min: -99, max: 99, label: 'Layer number' }),
          'Higher numbers are drawn on top; Arrange sets this for you.'));

      /* behaviours */
      add(sectionH('Behaviours'));
      const bs = o.behaviours || [];
      if (!bs.length) add(h('div.stu-f__h.stu-pad', { text: 'No behaviours: it just sits there. Add one to make it a player, an enemy, a pickup…' }));
      const hasPlayer = bs.some(b => b.type === 'platformer' || b.type === 'topdown');
      for (const b of bs) {
        const def = R.behaviourDef(b.type);
        if (!def) continue;
        const warn = b.type === 'platformer' && !(S.scene.settings.gravity > 0) ? 'Gravity is 0 in the Game tab, so this player will float.' : null;
        add(h('div.stu-beh',
          h('div.stu-beh__head', h('span.stu-beh__ic', icon(def.icon)), h('b', { text: def.label }),
            h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': `Remove ${def.label}`, title: 'Remove behaviour',
              onclick: () => set(`Removed ${def.label} from ${o.name}`, x => { x.behaviours = x.behaviours.filter(y => y !== b); }, { hier: true, insp: true }) }, icon('x'))),
          h('p.stu-beh__desc', { text: def.desc }),
          warn ? h('p.stu-beh__warn', icon('alert'), h('span', { text: warn })) : null,
          h('div.stu-beh__params', def.params.map(pd => paramControl(o, b, pd, set)))));
      }
      const avail = R.BEHAVIOURS.filter(d => !bs.some(b => b.type === d.type) && !(hasPlayer && d.role === 'player'));
      if (avail.length) {
        add(h('div.stu-f', selIn('', [['', 'Add a behaviour…'], ...avail.map(d => [d.type, d.label])], v => {
          if (!v) return;
          const d = R.behaviourDef(v);
          set(`Gave ${o.name} ${d.label}`, x => { x.behaviours = [...(x.behaviours || []), beh(v)]; }, { hier: true, insp: true });
        }, { 'aria-label': 'Add a behaviour' })));
      }
      add(h('div.stu-foot', h('small', { text: `id: ${o.id}` })));
    }

    function paramControl(o, b, pd, set) {
      const name = R.behaviourDef(b.type).label;
      const lbl = `${pd.label}${pd.unit ? ` (${pd.unit})` : ''}`;
      if (pd.kind === 'num') {
        return field(lbl, numIn(b[pd.k], v => set(`Changed ${name} of ${o.name}`, () => { b[pd.k] = v; }, { merge: `beh:${o.id}:${b.type}:${pd.k}` }), { min: pd.min, max: pd.max, label: pd.label }));
      }
      if (pd.kind === 'bool') return swRow(pd.label, !!b[pd.k], v => set(`Changed ${name} of ${o.name}`, () => { b[pd.k] = v; }, { insp: true }));
      if (pd.kind === 'select') return field(lbl, selIn(b[pd.k], pd.options, v => set(`Changed ${name} of ${o.name}`, () => { b[pd.k] = v; })));
      const sounds = (S.p?.assets || []).filter(a => a.kind === 'audio');
      return field(lbl, selIn(b[pd.k] || '', [['', sounds.length ? 'No sound' : 'No sounds imported yet'], ...sounds.map(a => [a.id, a.name])],
        v => set(`Changed ${name} sound of ${o.name}`, () => { b[pd.k] = v; }), { disabled: !sounds.length && !b[pd.k] }));
    }

    /* ---------- game: settings, variables, events ---------- */
    function paintGameSettings() {
      clear(gamePane);
      const sc = S.scene;
      if (!sc) return;
      const st = sc.settings;
      const setS = (label, fn, opts = {}) => edit(label, () => fn(st), { merge: opts.merge, hier: false, insp: !!opts.insp });
      const SIZES = [['800x450', '800 × 450 (wide)'], ['960x540', '960 × 540 (wide, bigger)'], ['640x480', '640 × 480 (classic)'], ['480x640', '480 × 640 (tall)'], ['custom', 'Custom']];
      const cur = `${st.width}x${st.height}`;
      gamePane.append(
        sectionH('Game'),
        field('Title', txtIn(sc.title, v => edit('Renamed the game', () => { sc.title = v.slice(0, 80); }, { merge: 'title', hier: false, insp: false }), { maxlength: '80' })),
        field('Size', selIn(SIZES.some(s => s[0] === cur) ? cur : 'custom', SIZES, v => {
          if (v === 'custom') return;
          const [w, hh] = v.split('x').map(Number);
          setS('Changed the game size', s => { s.width = w; s.height = hh; }, { insp: true });
          fitStage();
        })),
        h('div.stu-grid2',
          h('label.stu-xy', h('span', { text: 'W' }), numIn(st.width, v => { setS('Changed the game size', s => { s.width = Math.round(v); }, { merge: 'size' }); fitStage(); }, { min: 120, max: 2400, label: 'Game width' })),
          h('label.stu-xy', h('span', { text: 'H' }), numIn(st.height, v => { setS('Changed the game size', s => { s.height = Math.round(v); }, { merge: 'size' }); fitStage(); }, { min: 120, max: 2400, label: 'Game height' }))),
        field('Background', colorIn(st.background, v => setS('Changed the background', s => { s.background = v; }, { merge: 'bg' }), 'Background colour')),
        field('Gravity', numIn(st.gravity, v => setS('Changed gravity', s => { s.gravity = v; }, { merge: 'gravity' }), { min: 0, max: 6000, step: 50, label: 'Gravity' }),
          'How hard platformer players fall (px/s²). 0 = none, for top-down games.'),
        swRow('Show score and lives', st.hud !== false, v => setS(v ? 'Showed the HUD' : 'Hid the HUD', s => { s.hud = v; }, { insp: true })));

      gamePane.append(
        sectionH('Variables'),
        h('div.stu-grid2',
          field('Score starts at', numIn(st.score, v => setS('Changed the starting score', s => { s.score = v; }, { merge: 'score' }), { label: 'Starting score' })),
          field('Lives', numIn(st.lives, v => setS('Changed lives', s => { s.lives = Math.round(v); }, { merge: 'lives' }), { min: 1, max: 99, label: 'Lives' }))),
        h('div.stu-grid2',
          field('Timer (seconds)', numIn(st.timer, v => setS('Changed the timer', s => { s.timer = v; }, { merge: 'timer', insp: false }), { min: 0, max: 86400, label: 'Timer seconds' })),
          field('When time runs out', selIn(st.timerEnds, [['lose', 'You lose'], ['win', 'You win']], v => setS('Changed the timer ending', s => { s.timerEnds = v; })))),
        h('div.stu-f__h.stu-pad', { text: 'Timer 0 means no timer.' }),
        field('Win at score', numIn(st.winScore, v => setS('Changed the winning score', s => { s.winScore = v; }, { merge: 'winScore' }), { min: 0, label: 'Winning score' }),
          '0 = off. Goals and events can also win the game.'));

      /* events */
      gamePane.append(sectionH('Events', h('button.stu-mini', { type: 'button', onclick: addEvent }, icon('plus'), h('span', { text: 'Add' }))));
      if (!sc.events.length) {
        gamePane.append(h('div.stu-f__h.stu-pad', { text: 'Events make things happen when two objects touch — like “when the player touches a key, remove the door”. Behaviours already handle coins, hazards, enemies and goals.' }));
      }
      const subjects = subjectOptions();
      sc.events.forEach((ev, i) => {
        const nameOf = ref => (subjects.find(s => s[0] === ref) || [ref, ref])[1];
        const actRows = (ev.actions || []).map((a, j) => {
          const def = R.actionDef(a.do);
          const opts = R.ACTIONS.map(x => [x.do, x.do === 'destroyA' ? `Remove ${nameOf(ev.a)}` : x.do === 'destroyB' ? `Remove ${nameOf(ev.b)}` : x.label]);
          const sounds = (S.p?.assets || []).filter(x => x.kind === 'audio');
          return h('div.stu-act',
            h('span.stu-act__arrow', { text: '→' }),
            selIn(a.do, opts, v => edit('Changed an event', () => {
              const d = R.actionDef(v);
              ev.actions[j] = { do: v, ...(d.n ? { n: d.def } : {}), ...(d.sound ? { sound: '' } : {}) };
            }, { hier: false, insp: true }), { 'aria-label': `Event ${i + 1} action ${j + 1}` }),
            def?.n ? numIn(a.n ?? def.def, v => edit('Changed an event', () => { a.n = v; }, { merge: `ev:${ev.id}:${j}`, hier: false, insp: false }), { label: 'Amount' }) : null,
            def?.sound ? selIn(a.sound || '', [['', sounds.length ? 'Pick a sound' : 'No sounds yet'], ...sounds.map(x => [x.id, x.name])], v => edit('Changed an event', () => { a.sound = v; }, { hier: false, insp: false }), { 'aria-label': 'Sound' }) : null,
            h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Remove this action', onclick: () => edit('Changed an event', () => { ev.actions.splice(j, 1); }, { hier: false, insp: true }) }, icon('x')));
        });
        gamePane.append(h('div.stu-ev',
          h('div.stu-ev__head',
            h('span.stu-ev__when', { text: 'When' }),
            selIn(ev.a, withRef(subjects, ev.a), v => edit('Changed an event', () => { ev.a = v; }, { hier: false, insp: true }), { 'aria-label': `Event ${i + 1}: first object` }),
            h('span.stu-ev__when', { text: 'touches' }),
            selIn(ev.b, withRef(subjects, ev.b), v => edit('Changed an event', () => { ev.b = v; }, { hier: false, insp: true }), { 'aria-label': `Event ${i + 1}: second object` }),
            h('button.stu-tb.stu-tb--icon.stu-danger', { type: 'button', 'aria-label': `Remove event ${i + 1}`, onclick: () => edit('Removed an event', () => { sc.events.splice(i, 1); }, { hier: false, insp: true }) }, icon('trash'))),
          actRows,
          h('button.stu-mini.stu-ev__add', { type: 'button', onclick: () => edit('Changed an event', () => { ev.actions.push({ do: 'score', n: 10 }); }, { hier: false, insp: true }) }, icon('plus'), h('span', { text: 'Add an action' }))));
      });
    }
    const withRef = (list, ref) => (list.some(x => x[0] === ref) ? list : [...list, [ref, String(ref || '(nothing)')]]);
    function subjectOptions() {
      const sc = S.scene;
      const groups = [...new Set(sc.objects.map(o => o.group).filter(Boolean))].sort();
      return [
        ['player', 'Any player'],
        ...groups.map(g => [`group:${g}`, `Any ${g}`]),
        ...sc.objects.map(o => [`id:${o.id}`, o.name]),
        ['any', 'Anything'],
      ];
    }
    function addEvent() {
      const sc = S.scene;
      const isPl = o => (o.behaviours || []).some(b => b.type === 'platformer' || b.type === 'topdown');
      const has = (o, t) => (o.behaviours || []).some(b => b.type === t);
      /* start from something sensible: the selected object, else a pickup, else anything that is not scenery */
      const sel = selObj();
      const target = (sel && !isPl(sel) && sel) || sc.objects.find(o => has(o, 'collectible'))
        || sc.objects.find(o => !isPl(o) && !o.text && !o.solid) || null;
      const b = target ? (sel && target === sel ? `id:${target.id}` : `group:${target.group}`) : 'any';
      const pickup = target && !target.solid;
      edit('Added an event', () => {
        sc.events.push({ id: R.newId('e'), a: 'player', b, actions: pickup ? [{ do: 'score', n: 10 }, { do: 'destroyB' }] : [{ do: 'score', n: 10 }] });
      }, { hier: false, insp: true });
    }

    /* ================================================================
       Code editor
       ================================================================ */
    S.code = { dirty: false, lines: 0, tabOut: false, errLine: 0 };
    const F = { open: false, q: '', hits: [], i: -1 };
    let charW = 7.2;

    function setCode(text, dirty = false) {
      if (ta.value !== text) {
        ta.value = text;
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0; ta.scrollLeft = 0;
      }
      S.code.dirty = dirty || text !== S.headHtml;
      S.code.lines = -1;
      hideCodeErrors();
      syncCode();
      if (F.open) findRun(false);
    }
    function syncCode() {
      const n = (ta.value.match(/\n/g) || []).length + 1;
      if (n !== S.code.lines) {
        S.code.lines = n;
        let s = '';
        for (let i = 1; i <= n; i++) s += i + '\n';
        gutPre.textContent = s;
      }
      onCodeScroll();
      paintCodeStatus();
    }
    function onCodeScroll() {
      gutPre.style.transform = `translateY(${-ta.scrollTop}px)`;
      hlLayer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    }
    ta.addEventListener('scroll', onCodeScroll);
    ta.addEventListener('input', () => {
      const was = S.code.dirty;
      S.code.dirty = ta.value !== S.headHtml;
      syncCode();
      if (was !== S.code.dirty) paintTop();
      scheduleDraft();
      if (F.open) { clearTimeout(F.t); F.t = setTimeout(() => findRun(false), 160); }
      markRunStale();
    });
    for (const ev of ['keyup', 'click', 'select']) ta.addEventListener(ev, () => paintCodeStatus());

    function paintCodeStatus() {
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const ln = (before.match(/\n/g) || []).length + 1;
      const col = pos - before.lastIndexOf('\n');
      const selLen = Math.abs(ta.selectionEnd - ta.selectionStart);
      clear(codeStatus);
      codeStatus.append(
        h('span', { text: `Ln ${ln}, Col ${col}${selLen ? ` · ${selLen} selected` : ''}` }),
        h('span', { text: `${S.code.lines} lines · HTML` }),
        h('span.stu-codebar__grow'),
        h('span.stu-hide-tiny', { text: 'Tab indents · Esc then Tab leaves the editor · Ctrl+F finds · Ctrl+S saves' }));
    }

    function insertText(str) {
      ta.focus();
      let ok = false;
      try { ok = document.execCommand('insertText', false, str); } catch (err) { ok = false; }
      if (!ok) {
        ta.setRangeText(str, ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      }
    }
    function indentLines(out) {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      if (s === e && !out) { insertText('  '); return; }
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
      if (le < 0) le = v.length;
      const block = v.slice(ls, le);
      const lines = block.split('\n');
      const nextLines = lines.map(l => (out ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l));
      const next = nextLines.join('\n');
      if (next === block) return;
      ta.setSelectionRange(ls, le);
      insertText(next);
      if (s === e) {
        /* no selection: the caret stays where it was, just moved with its line */
        const c = Math.max(ls, s - (lines[0].length - nextLines[0].length));
        ta.setSelectionRange(c, c);
      } else ta.setSelectionRange(ls, ls + next.length);
    }
    ta.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Tab' && !mod && !e.altKey) {
        if (S.code.tabOut) { S.code.tabOut = false; return; }
        e.preventDefault();
        indentLines(e.shiftKey);
        return;
      }
      S.code.tabOut = e.key === 'Escape';
      if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && ta.selectionStart === ta.selectionEnd) {
        const v = ta.value, s = ta.selectionStart;
        const line = v.slice(v.lastIndexOf('\n', s - 1) + 1, s);
        const ind = line.match(/^[ \t]*/)[0];
        const extra = /[{[(]\s*$/.test(line) ? '  ' : '';
        e.preventDefault();
        insertText('\n' + ind + extra);
      }
    });

    function gotoLine(n, select = false) {
      const starts = lineStarts(ta.value);
      const i = clamp(n, 1, starts.length) - 1;
      const pos = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] - 1 : ta.value.length;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, select ? end : pos);
      ta.scrollTop = Math.max(0, i * LH - ta.clientHeight / 3);
      ta.scrollLeft = 0;
      onCodeScroll();
      paintCodeStatus();
    }
    function showCodeErrors(errors, line) {
      if (S.mode !== 'code') { S.mode = 'code'; S.pane = 'code'; paintAll(); }
      S.code.errLine = line || 0;
      clear(codeErr);
      codeErr.hidden = false;
      codeErr.append(icon('alert'),
        h('div.stu-codeerr__t', h('b', { text: 'Not saved — the scene data needs fixing first.' }),
          h('ul', errors.slice(0, 4).map(er => h('li', { text: er })))),
        line ? h('button.btn.btn--sm', { type: 'button', onclick: () => gotoLine(line, true) }, h('span', { text: `Go to line ${line}` })) : null,
        h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Dismiss', onclick: hideCodeErrors }, icon('x')));
      paintHighlights();
      /* show the line that needs fixing */
      if (line) gotoLine(line);
    }
    function hideCodeErrors() { codeErr.hidden = true; S.code.errLine = 0; paintHighlights(); }

    /* ---------- find ---------- */
    function openFind() {
      if (S.mode !== 'code' || S.pane === 'game') { if (S.mode === 'code') showPane('code'); else return; }
      F.open = true;
      findBar.hidden = false;
      const s = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (s && !s.includes('\n') && s.length < 80) findIn.value = s;
      findIn.focus();
      findIn.select();
      F.q = findIn.value;
      findRun(true);
    }
    function closeFind(focusCode) {
      if (!F.open) return;
      F.open = false;
      findBar.hidden = true;
      F.hits = []; F.i = -1;
      paintHighlights();
      if (focusCode) ta.focus({ preventScroll: true });
    }
    function findRun(jump) {
      const q = F.q;
      F.hits = [];
      if (q) {
        const hay = ta.value.toLowerCase(), needle = q.toLowerCase();
        let i = 0;
        while ((i = hay.indexOf(needle, i)) !== -1 && F.hits.length < 5000) { F.hits.push(i); i += needle.length; }
      }
      if (!F.hits.length) F.i = -1;
      else if (jump || F.i < 0 || F.i >= F.hits.length) {
        const from = ta.selectionStart;
        const k = F.hits.findIndex(p => p >= from);
        F.i = k < 0 ? 0 : k;
      }
      findCount.textContent = q ? (F.hits.length ? `${F.i + 1} of ${F.hits.length}${F.hits.length >= 5000 ? '+' : ''}` : 'No matches') : '';
      findIn.classList.toggle('is-miss', !!q && !F.hits.length);
      paintHighlights();
      if (jump && F.i >= 0) reveal(F.hits[F.i], q.length);
    }
    function findStep(d) {
      if (!F.hits.length) return;
      F.i = (F.i + d + F.hits.length) % F.hits.length;
      findCount.textContent = `${F.i + 1} of ${F.hits.length}`;
      paintHighlights();
      reveal(F.hits[F.i], F.q.length);
    }
    function reveal(pos, len) {
      ta.setSelectionRange(pos, pos + len);
      const before = ta.value.slice(0, pos);
      const line = (before.match(/\n/g) || []).length;
      const col = pos - (before.lastIndexOf('\n') + 1);
      const top = line * LH, left = col * charW;
      if (top < ta.scrollTop + LH || top > ta.scrollTop + ta.clientHeight - LH * 2) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
      if (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - 80) ta.scrollLeft = Math.max(0, left - ta.clientWidth / 3);
      onCodeScroll();
      paintCodeStatus();
    }
    function paintHighlights() {
      clear(hlLayer);
      const v = ta.value;
      if (S.code.errLine) {
        hlLayer.append(h('div.stu-hl__err', { style: { top: `${(S.code.errLine - 1) * LH + 8}px` } }));
      }
      if (!F.open || !F.hits.length) return;
      const pre = h('div.stu-hl__text');
      let at = 0;
      F.hits.forEach((p, k) => {
        if (p > at) pre.append(document.createTextNode(v.slice(at, p)));
        pre.append(h(`mark${k === F.i ? '.is-cur' : ''}`, { text: v.slice(p, p + F.q.length) }));
        at = p + F.q.length;
      });
      pre.append(document.createTextNode(v.slice(at) + '\n'));
      hlLayer.append(pre);
    }
    findIn.addEventListener('input', () => { F.q = findIn.value; findRun(true); });
    findIn.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(true); }
    });

    /* measure one monospace character so find can scroll sideways */
    nextFrame(() => {
      const probe = h('span.stu-probe', { text: 'MMMMMMMMMM' });
      codeWrap.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 10;
      if (w > 3) charW = w;
      probe.remove();
    });

    /* ================================================================
       Assistant
       ================================================================ */
    const aiIn = h('textarea.stu-ai__in', {
      rows: '2', placeholder: 'Ask for a change, e.g. “make the player double jump”', 'aria-label': 'Ask the assistant for a change',
      onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); } },
      oninput: () => { aiIn.style.height = 'auto'; aiIn.style.height = Math.min(140, aiIn.scrollHeight) + 'px'; },
    });
    const aiSend = h('button.stu-ai__send', { type: 'button', 'aria-label': 'Send request', onclick: () => sendAI() }, icon('send'));
    const aiExplainLbl = h('span', { text: 'Explain this code' });
    const aiFixLbl = h('span', { text: 'Fix errors' });
    const aiExplain = h('button.stu-mini', { type: 'button', onclick: () => explainCode() }, icon('help-circle'), aiExplainLbl);
    const aiFix = h('button.stu-mini', { type: 'button', onclick: () => fixErrors() }, icon('bug'), aiFixLbl);
    const aiFeed = h('div.stu-ai__feed', { 'aria-live': 'polite' });
    aiPane.append(
      h('div.stu-ai__acts', aiExplain, aiFix),
      aiFeed,
      h('div.stu-ai__composer',
        h('div.stu-ai__bar', aiIn, aiSend),
        h('div.stu-ai__foot', { text: `${LLM.MODEL_LABEL}, free via ${LLM.HOST}. Your game’s code is sent to answer (images and sounds are not). It can be wrong — nothing changes until you press Apply.` })));

    function paintAIActions() {
      if (aiPane.hidden) return;
      const sel = S.mode === 'code' && ta.selectionEnd > ta.selectionStart;
      aiExplainLbl.textContent = sel ? 'Explain selection' : 'Explain this code';
      const errs = errorsNow();
      aiFix.disabled = !errs.length || S.ai.busy;
      aiFix.title = errs.length ? `Send ${plural(errs.length, 'error')} from the console and the code` : 'No errors in the console from the last run';
      aiFixLbl.textContent = errs.length ? `Fix ${plural(errs.length, 'error')}` : 'Fix errors';
      aiExplain.disabled = S.ai.busy;
      clear(aiSend);
      aiSend.append(icon(S.ai.busy ? 'square' : 'send', S.ai.busy ? { fill: true } : undefined));
      aiSend.classList.toggle('is-stop', S.ai.busy);
      aiSend.setAttribute('aria-label', S.ai.busy ? 'Stop the assistant' : 'Send request');
      aiSend.title = S.ai.busy ? 'Stop' : 'Send (Enter)';
    }

    function paintAIFeed() {
      clear(aiFeed);
      if (!S.ai.turns.length) {
        const ex = S.kind === 'scene' ? EXAMPLES : CODE_EXAMPLES;
        aiFeed.append(h('div.stu-ai__intro',
          h('div.stu-ai__introic', icon('sparkles')),
          h('b', { text: 'Ask for a change in plain words' }),
          h('p', { text: 'You’ll see exactly which lines would change, tested in a sandbox first. Your project is only touched when you press Apply.' }),
          h('div.stu-ai__chips', ex.map(t => h('button.stu-chip', { type: 'button', text: t, onclick: () => { if (/^Explain /.test(t)) explainAbout(t); else sendAI(t); } })))));
        paintAIActions();
        return;
      }
      for (const t of S.ai.turns) aiFeed.append(turnEl(t));
      paintAIActions();
      aiFeed.scrollTop = aiFeed.scrollHeight;
    }

    function turnEl(t) {
      const body = h('div.stu-turn__body');
      t.el = h(`div.stu-turn.stu-turn--${t.kind}`,
        h('div.stu-turn__q', icon(t.kind === 'explain' ? 'help-circle' : t.kind === 'fix' ? 'bug' : 'sparkles'), h('span', { text: t.label })),
        body);
      fillTurn(t);
      return t.el;
    }
    let turnQ = new Set();
    function paintTurn(t) {
      turnQ.add(t);
      if (turnQ.size > 1) return;
      nextFrame(() => { const q = turnQ; turnQ = new Set(); for (const x of q) fillTurn(x); });
    }
    const waiting = (text, slow) => h(`div.stu-wait${slow ? '.is-slow' : ''}`, h('i'), h('i'), h('i'), h('span', { text }));

    /* llm.js is waiting for its turn or for a busy service — say so plainly */
    /* while a request is out, its turn is repainted every second: the wait
       countdown and the time so far are real numbers, not an animation */
    let waitTimer = 0;
    function scheduleWaitTick(t) {
      clearInterval(waitTimer);
      waitTimer = setInterval(() => {
        if (S.dead || !S.ai.busy) { clearInterval(waitTimer); waitTimer = 0; return; }
        paintTurn(t);
      }, 1000);
    }
    const since = t => {
      const s = Math.round((Date.now() - (t.started || Date.now())) / 1000);
      return s >= 8 ? ` · ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${pad2(s % 60)} s`}` : '';
    };
    function waitLabel(t) {
      const w = t.wait;
      if (w.reason === 'queued') return 'Waiting for the model… another request from this tab goes first.';
      const left = Math.max(0, Math.ceil(((w.at || 0) + (w.ms || 0) - Date.now()) / 1000));
      return `Waiting for the model… the free service is busy. ${left ? `Trying again in ${left} s` : 'Trying again now'} (try ${Math.min(4, (w.attempt || 1) + 1)} of 4).`;
    }
    const pending = (t, fallback) => {
      if (t.wait) return waiting(waitLabel(t), true);
      const slow = Date.now() - (t.started || Date.now()) > 30000;
      return waiting(`${t.thinking ? 'Thinking' : fallback}${since(t)}${slow ? ' — the free model can take a minute or two' : ''}`);
    };
    const againBtn = t => (t.again && !S.ai.busy
      ? h('div.stu-turn__acts', h('button.btn.btn--sm', { type: 'button', onclick: () => t.again() }, icon('refresh'), h('span', { text: 'Try again' })))
      : '');   /* not null: Element.append would print it */

    function fillTurn(t) {
      if (!t.el || S.dead) return;
      /* the feed follows the newest turn while you are at the bottom of it */
      const newest = t === S.ai.turns[S.ai.turns.length - 1];
      const stick = newest && aiFeed.scrollHeight - aiFeed.scrollTop - aiFeed.clientHeight < 60;
      fillTurnBody(t, t.el.querySelector('.stu-turn__body'));
      if (stick) aiFeed.scrollTop = aiFeed.scrollHeight;
    }
    function fillTurnBody(t, body) {
      clear(body);
      if (t.kind === 'explain') {
        if (t.err) body.append(h('div.stu-err', icon('alert'), h('span', { text: t.err })), t.status === 'error' ? againBtn(t) : '');
        else if (t.text) body.append(h('div.stu-md', md(t.text)));
        else body.append(pending(t, 'Reading your code'));
        return;
      }
      const summary = t.summary || (t.text ? t.text.split('```')[0].trim() : '');
      if (summary && t.status !== 'failed') body.append(h('div.stu-md', md(summary)));
      switch (t.status) {
        case 'asking':
          body.append(pending(t, 'Reading your game'));
          break;
        case 'writing': {
          const n = t.text.includes('```') ? (t.text.split('```')[1] || '').split('\n').length : 0;
          const part = t.part > 1 ? ` · part ${t.part}` : '';
          body.append(t.wait ? waiting(waitLabel(t), true)
            : waiting(n ? `Writing the new version · ${plural(n, 'line')}${part}${since(t)}` : `Writing${part}${since(t)}`));
          if (t.part > 1) body.append(h('p.stu-turn__note', { text: 'The free model stops each answer at a set length, so Studio asks it to carry on from where it stopped.' }));
          break;
        }
        case 'testing':
          body.append(changesEl(t), diffCard(t), waiting('Testing it in a sandbox'));
          break;
        case 'ready': {
          const errs = t.proposal.test?.errors || [];
          body.append(changesEl(t), diffCard(t),
            errs.length
              ? h('div.stu-test.stu-test--bad', icon('x-circle'), h('div', h('b', { text: `The test run printed ${plural(errs.length, 'error')}` }), h('ul', errs.slice(0, 4).map(e => h('li', { text: e }))), h('span', { text: 'You can still apply it and fix things up, or discard it.' })))
              : h('div.stu-test.stu-test--ok', icon('check-circle'), h('span', { text: 'Test run: no errors in 2.5 seconds.' })),
            h('div.stu-turn__acts',
              h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => applyTurn(t) }, icon('check'), h('span', { text: 'Apply' })),
              h('button.btn.btn--sm', { type: 'button', onclick: () => discardTurn(t) }, icon('x'), h('span', { text: 'Discard' }))));
          break;
        }
        case 'applied':
          body.append(diffCard(t, true), h('div.stu-test.stu-test--ok', icon('check-circle'), h('span', { text: `Applied — saved as version ${t.version}. Undo takes it back.` })));
          break;
        case 'discarded':
          body.append(h('div.stu-test', icon('x'), h('span', { text: 'Discarded. Your project was not changed.' })));
          break;
        case 'failed':
          if (t.summary) body.append(h('div.stu-md', md(t.summary)));
          body.append(h('div.stu-err', icon('alert'), h('span', { text: `Nothing was changed. ${t.err}` })));
          if (t.proposal?.diff) body.append(diffCard(t, true));
          if (t.text) body.append(h('details.stu-raw', h('summary', { text: 'Show the full answer' }), h('pre', { text: t.text.slice(0, 20000) })));
          body.append(againBtn(t));
          break;
        case 'stopped':
          body.append(h('div.stu-test', icon('square'), h('span', { text: 'Stopped. Nothing was changed.' })));
          break;
        case 'applying':
          body.append(diffCard(t, true), waiting('Saving it as a new version'));
          break;
        default:
          body.append(h('div.stu-err', icon('alert'), h('span', { text: `Nothing was changed. ${t.err || 'Something went wrong.'}` })), againBtn(t));
      }
    }

    /* a line that was changed rather than added: its '-' and '+' rows are
       matched up so only the part that differs is marked */
    function pairUp(hk) {
      const out = new Map();
      for (let i = 0; i < hk.length;) {
        if (hk[i].t !== '-') { i++; continue; }
        let j = i;
        while (j < hk.length && hk[j].t === '-') j++;
        let k = j;
        while (k < hk.length && hk[k].t === '+') k++;
        const n = Math.min(j - i, k - j);
        for (let q = 0; q < n; q++) {
          const a = hk[i + q].text, b = hk[j + q].text;
          let pre = 0;
          while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
          let suf = 0;
          while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
          out.set(i + q, { pre, suf });
          out.set(j + q, { pre, suf });
        }
        i = k;
      }
      return out;
    }
    /* long lines (a whole scene object is one line) are shortened around the change */
    function lineParts(text, cut) {
      if (!cut) return [h('span', { text: text.length > 240 ? text.slice(0, 240) + '…' : text })];
      let pre = text.slice(0, cut.pre), mid = text.slice(cut.pre, text.length - cut.suf), post = text.slice(text.length - cut.suf);
      const lead = (pre.match(/^\s*/) || [''])[0];
      if (pre.length > 34) {
        /* a scene object on one line: keep its name in view, so eight changed
           coins read as eight different coins */
        const nm = pre.match(/"name":"((?:[^"\\]|\\.){1,40})"/);
        const tail = pre.slice(-16);
        pre = nm && pre.indexOf(nm[0]) + nm[0].length < pre.length - 16 ? `${lead}{…${nm[0]}…${tail}` : `${lead}…${pre.slice(-26)}`;
      }
      if (mid.length > 200) mid = mid.slice(0, 200) + '…';
      if (post.length > 34) post = post.slice(0, 26) + '…';
      return [h('span', { text: pre }), mid ? h('mark.stu-dl__m', { text: mid }) : null, h('span', { text: post })];
    }

    /** In words: what the assistant's version changes in a scene game. */
    function sceneChanges(before, after, codeA, codeB) {
      const out = [];
      if (!before || !after) return out;
      const fmt = v => (v === null || v === undefined || v === '' ? 'none' : typeof v === 'string' ? `“${v.length > 24 ? v.slice(0, 24) + '…' : v}”` : String(v));
      if (before.title !== after.title) out.push(`Title ${fmt(before.title)} → ${fmt(after.title)}`);
      const labels = { width: 'width', height: 'height', background: 'background', gravity: 'gravity', lives: 'lives', score: 'starting score', timer: 'timer', timerEnds: 'when time runs out', winScore: 'winning score', hud: 'score and lives display' };
      for (const k of Object.keys(labels)) if (JSON.stringify(before.settings[k]) !== JSON.stringify(after.settings[k])) out.push(`Game ${labels[k]}: ${fmt(before.settings[k])} → ${fmt(after.settings[k])}`);
      const old = new Map(before.objects.map(o => [o.id, o]));
      const PROPS = ['name', 'group', 'x', 'y', 'w', 'h', 'color', 'shape', 'sprite', 'text', 'solid', 'visible', 'layer', 'locked'];
      for (const o of after.objects) {
        const was = old.get(o.id);
        if (!was) { out.push(`Adds “${o.name}”${o.behaviours.length ? ` (${o.behaviours.map(b => R.behaviourDef(b.type)?.label || b.type).join(', ')})` : ''}`); continue; }
        old.delete(o.id);
        const ch = [];
        const NICE = { w: 'width', h: 'height', color: 'colour' };
        for (const k of PROPS) if (JSON.stringify(was[k]) !== JSON.stringify(o[k])) ch.push(`${NICE[k] || k} ${fmt(was[k])} → ${fmt(o[k])}`);
        const wb = new Map(was.behaviours.map(b => [b.type, b]));
        for (const b of o.behaviours) {
          const def = R.behaviourDef(b.type);
          const lab = def?.label || b.type;
          const pb = wb.get(b.type);
          wb.delete(b.type);
          if (!pb) { ch.push(`becomes ${lab}`); continue; }
          for (const k of Object.keys(b)) {
            if (k === 'type' || JSON.stringify(b[k]) === JSON.stringify(pb[k])) continue;
            const pl = def?.params.find(x => x.k === k)?.label || k;
            ch.push(`${pl.charAt(0).toLowerCase() + pl.slice(1)} ${fmt(pb[k])} → ${fmt(b[k])}`);
          }
        }
        for (const t of wb.keys()) ch.push(`no longer ${R.behaviourDef(t)?.label || t}`);
        if (ch.length) out.push(`${was.name}: ${ch.slice(0, 3).join(', ')}${ch.length > 3 ? ` and ${ch.length - 3} more` : ''}`);
      }
      for (const o of old.values()) out.push(`Removes “${o.name}”`);
      const evA = JSON.stringify(before.events), evB = JSON.stringify(after.events);
      if (evA !== evB) {
        const d = after.events.length - before.events.length;
        out.push(d > 0 ? `Adds ${plural(d, 'event')}` : d < 0 ? `Removes ${plural(-d, 'event')}` : 'Changes an event');
      }
      if ((codeA || '') !== (codeB || '')) {
        const df = diffLines(codeA || '', codeB || '');
        out.push(`Your game code: +${df.added} −${df.removed} lines`);
      }
      return out;
    }
    function changesEl(t) {
      const list = t.proposal?.changes;
      if (!list || !list.length) return null;
      return h('div.stu-changes',
        h('b', { text: 'What changes' }),
        h('ul', list.slice(0, 8).map(c => h('li', { text: c })), list.length > 8 ? h('li', { text: `and ${list.length - 8} more` }) : null));
    }

    function diffCard(t, collapsed) {
      const df = t.proposal?.diff;
      if (!df) return null;
      const rows = [];
      let shown = 0;
      for (const hk of df.hunks) {
        if (shown > 300) break;
        rows.push(h('div.stu-dl.stu-dl--gap', { text: `@@ line ${hk.find(o => o.a)?.a ?? hk.find(o => o.b)?.b ?? ''}` }));
        const pairs = pairUp(hk);
        hk.forEach((op, i) => {
          shown++;
          rows.push(h(`div.stu-dl${op.t === '+' ? '.stu-dl--add' : op.t === '-' ? '.stu-dl--del' : ''}`,
            h('span.stu-dl__n', { text: String(op.t === '+' ? op.b : op.a) }),
            h('span.stu-dl__s', { text: op.t === ' ' ? '' : op.t === '+' ? '+' : '−' }),
            h('span.stu-dl__t', lineParts(op.text, pairs.get(i)))));
        });
      }
      if (shown > 300) rows.push(h('div.stu-dl.stu-dl--gap', { text: '… more changes not shown' }));
      const places = df.hunks.length;
      const head = h('summary.stu-diff__head',
        h('span.stu-diff__add', { text: `+${df.added}` }), h('span.stu-diff__del', { text: `−${df.removed}` }),
        h('span', { text: `${plural(df.added + df.removed, 'line')} changed in ${plural(places, 'place')}` }));
      return h('details.stu-diff', { open: !collapsed && df.added + df.removed <= 60 }, head, h('div.stu-diff__body', rows));
    }

    function newTurn(kind, label) {
      const t = { id: R.newId('t'), kind, label, status: 'asking', text: '', summary: '', thinking: false, err: '', proposal: null, el: null };
      S.ai.turns.push(t);
      if (S.ai.turns.length > 20) S.ai.turns.shift();
      paintAIFeed();
      return t;
    }

    /**
     * One exchange with the model: its answer, streamed into the turn. For
     * a change, an answer that stops part-way through the document (the
     * free model's length limit) is continued with follow-up requests and
     * joined up, up to MAX_PARTS answers. Resolves to the whole text, or
     * null when it failed or was stopped (the turn then says why).
     */
    async function ask(t, messages, { more = false } = {}) {
      S.ai.ac?.abort();
      const ac = new AbortController();
      S.ai.ac = ac;
      S.ai.busy = true;
      t.started = Date.now();
      t.part = 1;
      scheduleWaitTick(t);
      paintAIActions();
      try {
        let reply = await askOnce(t, messages, ac, '');
        while (more && reply !== null && needsMore(reply) && t.part < MAX_PARTS && !S.dead) {
          t.part++;
          t.text = reply;
          t.thinking = false;
          paintTurn(t);
          const next = await askOnce(t, [...messages,
            { role: 'assistant', content: reply },
            { role: 'user', content: continuePrompt(reply.slice(-160)) }], ac, reply);
          if (next === null) return null;
          const joined = stitchMore(reply, next);
          /* nothing new came back: asking again would only repeat that */
          if (joined.length < reply.length + 8) { reply = joined; break; }
          reply = joined;
        }
        return reply;
      } finally {
        if (S.ai.ac === ac) S.ai.ac = null;
        S.ai.busy = false;
        if (!S.dead) { paintTurn(t); paintAIActions(); }
      }
    }
    async function askOnce(t, messages, ac, before) {
      try {
        return await LLM.stream(messages, {
          signal: ac.signal,
          params: llmParams(),
          onWait: info => { t.wait = { ...info, at: Date.now() }; paintTurn(t); },
          onThink: () => { if (!t.thinking || t.wait) { t.thinking = true; t.wait = null; paintTurn(t); } },
          /* while a later part streams in, the turn shows everything so far */
          onText: txt => { t.text = before ? before + txt : txt; t.wait = null; if (t.kind !== 'explain') t.status = 'writing'; paintTurn(t); },
        });
      } catch (err) {
        t.wait = null;
        t.status = err.name === 'AbortError' ? 'stopped' : 'error';
        t.err = err.name === 'AbortError' ? '' : (err.message || 'Something went wrong.');
        /* 502/503/504/524: the free service gave up waiting, usually because it is busy */
        const gw = String(err.message || '').match(/HTTP (502|503|504|524)\b/);
        if (gw) t.err = `The free model took too long to answer (HTTP ${gw[1]} from ${LLM.HOST}); it is probably busy. Try again in a minute.`;
        else if (/HTTP 402\b/.test(String(err.message || ''))) t.err = `The free model service turned the request down (HTTP 402 from ${LLM.HOST}); its free allowance for this network may be used up for now. Try again later.`;
        if (t.part > 1 && err.name !== 'AbortError') t.err = `It stopped answering part-way through the new version (part ${t.part}). ${t.err}`;
        t.code = err.code || '';
        if (t.kind === 'explain' && err.name === 'AbortError') t.err = 'Stopped. Nothing was changed.';
        return null;
      }
    }

    function explainCode() {
      if (!S.p || S.ai.busy) return;
      let code, what;
      if (S.mode === 'code' && ta.selectionEnd > ta.selectionStart) {
        const a = ta.selectionStart, b = ta.selectionEnd;
        code = ta.value.slice(a, b);
        const l1 = lineOf(ta.value, a), l2 = lineOf(ta.value, b);
        what = `lines ${l1}–${l2} of my game`;
      } else {
        code = abridge(workingHtml(), S.kind === 'scene').text;
        what = 'my whole game';
      }
      if (code.length > 60000) code = code.slice(0, 60000) + '\n…(the rest was cut to fit)';
      return runExplain(code, what);
    }
    /* "Explain the game loop": the whole game, with that question */
    function explainAbout(label) {
      if (!S.p || S.ai.busy) return;
      let code = abridge(workingHtml(), S.kind === 'scene').text;
      if (code.length > 60000) code = code.slice(0, 60000) + '\n…(the rest was cut to fit)';
      return runExplain(code, `${label.replace(/^Explain /, '')} in my game`, label);
    }
    async function runExplain(code, what, label) {
      if (!S.p || S.ai.busy) return;
      showRight('ai');
      const t = newTurn('explain', label || (what === 'my whole game' ? 'Explain this code' : `Explain ${what.replace(' of my game', '')}`));
      t.again = () => runExplain(code, what, label);
      const out = await ask(t, [
        { role: 'system', content: EXPLAIN_SYSTEM },
        { role: 'user', content: `Explain ${what}:\n\n\`\`\`html\n${code}\n\`\`\`` },
      ]);
      if (out) { t.status = 'done'; t.text = out; }
      paintTurn(t);
    }

    function fixErrors() {
      if (!S.p || S.ai.busy) return;
      const ab = abridge(workingHtml(), S.kind === 'scene');
      /* line numbers as they are in the copy the model reads */
      const errs = errorsNow().map(e => e.replace(/\(line (\d+)\)/g, (m, n) => {
        const k = ab.mapLine(Number(n));
        return k === null ? '(inside Studio’s engine)' : `(line ${k})`;
      }));
      if (!errs.length) return;
      requestChange(`Fix these errors. The game printed them in Studio's console:\n${errs.map(e => `- ${e}`).join('\n')}`, `Fix ${plural(errs.length, 'error')}`, 'fix');
    }
    function sendAI(text) {
      if (S.ai.busy) { S.ai.ac?.abort(); return; }
      const q = String(text ?? aiIn.value).trim();
      if (!q) { aiIn.focus(); return; }
      if (text === undefined) { aiIn.value = ''; aiIn.style.height = ''; }
      requestChange(q, q, 'change');
    }

    async function requestChange(request, label, kind) {
      if (!S.p || S.ai.busy) return;
      showRight('ai');
      const isScene = S.kind === 'scene';
      const baseFull = workingHtml();
      const ab = abridge(baseFull, isScene);
      const t = newTurn(kind, label);
      t.request = label.slice(0, 120);
      t.baseFull = baseFull;
      t.again = () => requestChange(request, label, kind);
      const reply = await ask(t, [
        { role: 'system', content: changeSystem(isScene) },
        { role: 'user', content: `Here is the whole current document:\n\n\`\`\`html\n${ab.text.replace(/\n$/, '')}\n\`\`\`\n\n${request}` },
      ], { more: true });
      if (reply === null || S.dead) return;
      t.text = reply;
      const fail = msg => { t.status = 'failed'; t.err = msg; paintTurn(t); };
      const ex = extractDoc(reply);
      t.summary = ex.summary || '';
      if (ex.cut && t.part > 1) return fail(`The model’s version was still unfinished after ${plural(t.part, 'part')}, so there is no complete document to apply.`);
      if (ex.error) return fail(ex.error);
      const back = expand(ex.html, ab);
      if (back.error === 'engine') return fail(`Its version left out the engine placeholder (${MARK}), so it cannot be rebuilt safely.`);
      if (back.missing.length) return fail(`Its version refers to image or sound data that does not exist (${back.missing.slice(0, 3).join(', ')}).`);
      let full = back.html, changes = null;
      /* refused, but what it tried is still shown (folded) */
      const refuse = msg => { t.proposal = { full: null, diff: diffLines(baseFull, back.html), test: null, changes: null }; return fail(msg); };
      if (isScene) {
        const d = R.readDoc(full);
        if (!d.isScene) return refuse('Its version removed the scene data.');
        if (d.errors.length) return refuse(`The scene data in its version has problems: ${d.errors.slice(0, 3).join(' ')}`);
        const was = R.readDoc(baseFull);
        const assetsBlock = x => /<script\b[^>]*\bid\s*=\s*["']studio-assets["']/i.test(x);
        if (assetsBlock(baseFull) && !assetsBlock(full) && (S.p?.assets || []).length) return refuse('Its version dropped the block that holds your images and sounds.');
        try { changes = sceneChanges(was.scene, d.scene, was.code, d.code); } catch (err) { changes = null; }
        /* saved the way Studio writes scenes, every field spelled out */
        const canon = R.setBlock(full, 'scene', R.formatScene(d.scene));
        if (canon) full = canon;
      }
      /* the diff is of the real documents: exactly what Apply saves, with
         the line numbers the Code editor shows */
      const diff = diffLines(baseFull, full);
      if (!diff.added && !diff.removed) return fail('It sent the document back without any changes.');
      t.proposal = { full, diff, test: null, changes };
      t.status = 'testing';
      paintTurn(t);
      const res = await SB.test(t.proposal.full, { ms: 2500 }).catch(err => ({ errors: [String(err.message || err)], logs: [] }));
      if (S.dead) return;
      t.proposal.test = res;
      t.status = 'ready';
      paintTurn(t);
    }

    async function applyTurn(t) {
      if (!t.proposal || !S.p || t.status !== 'ready') return;
      if (workingHtml() !== t.baseFull) {
        const ok = await api.confirm({
          title: 'The game changed since you asked',
          message: 'Applying this uses the version the assistant read, so edits you made after asking would be replaced.',
          ok: 'Apply anyway', danger: true,
        });
        if (!ok) return;
      }
      t.status = 'applying';
      paintTurn(t);
      const p = await commitHtml(t.proposal.full, t.request || 'Assistant change', 'ai');
      if (!p) { t.status = 'ready'; paintTurn(t); return; }
      t.status = 'applied';
      t.version = p.head + 1;
      if (S.kind === 'scene' && S.scene && S.mode === 'code') setCode(S.headHtml);
      paintTurn(t);
    }
    function discardTurn(t) {
      t.status = 'discarded';
      t.proposal = null;
      paintTurn(t);
    }

    /* ================================================================
       Keys, bus, reopen, teardown
       ================================================================ */
    root.addEventListener('keydown', e => {
      if (S.view !== 'editor') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (mod && k === 's') { e.preventDefault(); save(); }
      else if (mod && k === 'f' && S.mode === 'code') { e.preventDefault(); openFind(); }
      else if (mod && e.key === 'Enter') { e.preventDefault(); runGame(); }
      else if (mod && k === 'z' && !typing && S.mode === 'scene') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && k === 'y' && !typing && S.mode === 'scene') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape' && histPop) { closeHistory(); }
    });
    tabs.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const vis = [tabObject, tabGame, tabAI].filter(x => !x.hidden);
      const i = vis.findIndex(x => x.classList.contains('is-on'));
      const n = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length];
      n.click();
      n.focus();
    });

    const offBus = bus.on('projects:change', async ev => {
      if (S.dead || S.selfWrite > 0) return;
      if (S.view === 'home') { paintHome(); return; }
      if (!S.p || ev?.id !== S.p.id) return;
      if (ev.kind === 'remove') {
        stopGame(true);
        S.p = null;
        await goHomeForce();
        toast('Project deleted', 'It was removed in another app.', 'trash');
        return;
      }
      if (ev.kind === 'asset') {
        await reloadAssets();
        if (S.kind === 'scene' && S.mode === 'scene') { snapshot('Updated assets'); touched(); }
        toast('Assets updated', S.kind !== 'scene' ? 'Use Insert to put one in your code.'
          : S.mode === 'scene' ? 'Build to include them in the game file.' : 'Use Insert (or Build in Scene mode) to include them in the game file.', 'image');
        return;
      }
      const p = await P.get(ev.id).catch(() => null);
      if (!p || S.dead || p.id !== S.p?.id) return;
      if (ev.kind === 'rename') { S.p.name = p.name; win.setSubtitle?.(p.name); paintTop(); return; }
      const headId = p.versions[p.head]?.id;
      if (headId === S.headId) { S.p = p; paintTop(); return; }
      if (isDirty()) {
        S.p = p;
        S.headHtml = P.current(p);
        S.headId = headId;
        notice({ id: 'elsewhere', tone: 'warn', title: 'This game was changed in another app.', text: `Your unsaved work here is kept; ${S.mode === 'scene' ? 'Build' : 'Save'} adds it on top as a new version.` });
        paintTop();
      } else {
        const mode = S.mode;
        loadHead(p, { keepSel: true });
        if (mode === 'scene' && S.scene) S.mode = 'scene';
        paintAll();
        toast('Updated', `“${p.name}” was changed in another app — showing the new version.`, 'refresh');
      }
    });
    async function goHomeForce() { S.view = 'editor'; await goHome(); }

    win.onReopen?.(o => { if (o) handleOpts(o); });
    function handleOpts(o) {
      if (o.project) openProject(o.project);
      else if (o.template) newFromTemplate(o.template);
    }

    paintStageTools();
    paintCenterBar();
    if (opts && (opts.project || opts.template)) handleOpts(opts);
    else paintHome();

    return () => {
      if (S.dead) return;
      flushDraft();
      S.dead = true;
      S.ai.ac?.abort();
      stopGame(true);
      offBus();
      ro.disconnect();
      roStage.disconnect();
      clearTimeout(draftT);
      clearTimeout(F.t);
      clearInterval(waitTimer);
      for (const id of timers) clearTimeout(id);
      for (const id of frames) cancelAnimationFrame(id);
      for (const u of urls) URL.revokeObjectURL(u);
      timers.clear(); frames.clear(); urls.clear();
      if (SG.raf) cancelAnimationFrame(SG.raf);
      document.removeEventListener('pointerdown', onDocDown, true);
      histPop?.remove();
      try { if (audioEl) { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } } catch (err) { /* nothing playing */ }
      audioEl = null;
    };
  },
});
