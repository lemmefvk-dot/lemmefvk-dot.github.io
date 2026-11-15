/* ============================================================
   studio/blocks.js — block coding for Static Studio.

   A block program is a list of scripts; each script is one "when …"
   block with the blocks that run under it. It is turned into the
   same JavaScript a person would type against Studio's `game` API
   (game.on, game.addScore, game.say, game.clone …), and that code
   goes into the game's own <script id="game-code"> between two marker
   lines, with the program itself kept in a comment so Studio can open
   it again as blocks. Nothing here runs in the editor: the blocks are
   only a way to write the code. Hand-written code outside the markers
   is never touched, and deleting the section turns the blocks back
   into plain code.

     SPEC · HATS · STATEMENTS · CONDS        what blocks exist
     newBlock(type) · newScript(type)
     validateProgram(raw) -> { v:1, scripts:[…] }
     toCode(program)                         -> JavaScript text
     writeBlocks(code, program) -> code      replace / insert / remove the section
     readBlocks(code) -> { program, text } | { error } | null
   ============================================================ */

export const START = '// ===== Blocks: made by Static Studio\'s block editor. Change them in the Blocks tab; this section is rewritten when you do. =====';
export const END = '// ===== end of blocks =====';

const KEYS = [['Space', 'space'], ['ArrowUp', 'up arrow'], ['ArrowDown', 'down arrow'], ['ArrowLeft', 'left arrow'], ['ArrowRight', 'right arrow'], ['Enter', 'enter'],
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map(c => [c, c]), ...'0123456789'.split('').map(c => [c, c])];
const OPS = [['>=', 'is at least'], ['>', 'is more than'], ['<=', 'is at most'], ['<', 'is less than'], ['==', 'is'], ['!=', 'is not']];
const HELD = [['left', 'left'], ['right', 'right'], ['up', 'up'], ['down', 'down'], ['jump', 'jump / space']];

/* arg kinds: num · text · ref (an object, group or "player") · var (a variable name) · key · sound · color · select */
const ref = (k, def) => ({ k, kind: 'ref', def });
const num = (k, def) => ({ k, kind: 'num', def });

export const SPEC = {
  /* ---- hats: what starts a script ---- */
  start: { cat: 'events', hat: true, parts: ['when the game starts'] },
  frame: { cat: 'events', hat: true, parts: ['every frame'] },
  timer: { cat: 'events', hat: true, parts: ['every', num('secs', 2), 'seconds'] },
  touch: { cat: 'events', hat: true, parts: ['when', ref('a', 'player'), 'touches', ref('b', 'any')], note: 'Inside, “first” and “second” mean the two that touched.' },
  key: { cat: 'events', hat: true, parts: ['when key', { k: 'key', kind: 'select', def: 'Space', opts: KEYS }, 'is pressed'] },
  click: { cat: 'events', hat: true, parts: ['when', ref('what', 'any'), 'is clicked'], note: 'Inside, “first” means the thing that was clicked.' },
  win: { cat: 'events', hat: true, parts: ['when the game is won'] },
  lose: { cat: 'events', hat: true, parts: ['when the game is lost'] },
  hurt: { cat: 'events', hat: true, parts: ['when the player loses a life'] },
  /* ---- the game ---- */
  score: { cat: 'game', parts: ['add', num('n', 10), 'to the score'] },
  say: { cat: 'game', parts: ['say', { k: 'text', kind: 'text', def: 'Hello!' }] },
  loseLife: { cat: 'game', parts: ['lose a life'] },
  winGame: { cat: 'game', parts: ['win the game'] },
  loseGame: { cat: 'game', parts: ['lose the game'] },
  nextLevel: { cat: 'game', parts: ['go to the next level'] },
  restart: { cat: 'game', parts: ['start the game again'] },
  play: { cat: 'game', parts: ['play sound', { k: 'sound', kind: 'sound', def: '' }] },
  setVar: { cat: 'game', parts: ['set', { k: 'name', kind: 'var', def: 'coins' }, 'to', num('n', 0)] },
  changeVar: { cat: 'game', parts: ['change', { k: 'name', kind: 'var', def: 'coins' }, 'by', num('n', 1)] },
  /* ---- objects ---- */
  spawn: { cat: 'objects', parts: ['make a copy of', ref('what', ''), 'at x', num('x', 100), 'y', num('y', 100)] },
  spawnAt: { cat: 'objects', parts: ['make a copy of', ref('what', ''), 'where', ref('where', 'player'), 'is'] },
  destroy: { cat: 'objects', parts: ['remove', ref('what', '@B')] },
  move: { cat: 'objects', parts: ['move', ref('what', 'player'), 'by x', num('dx', 20), 'y', num('dy', 0)] },
  place: { cat: 'objects', parts: ['put', ref('what', 'player'), 'at x', num('x', 100), 'y', num('y', 100)] },
  color: { cat: 'objects', parts: ['colour', ref('what', 'player'), { k: 'color', kind: 'color', def: '#ff5c7c' }] },
  show: { cat: 'objects', parts: [{ k: 'on', kind: 'select', def: 'true', opts: [['true', 'show'], ['false', 'hide']] }, ref('what', 'player')] },
  /* ---- control ---- */
  if: { cat: 'control', container: true, parts: ['if'], cond: true },
  repeat: { cat: 'control', container: true, parts: ['repeat', num('n', 3), 'times'] },
};
export const CATS = [['events', 'Events'], ['game', 'Game'], ['objects', 'Objects'], ['control', 'Control']];
export const HATS = Object.keys(SPEC).filter(t => SPEC[t].hat);
export const COND_TYPES = [['var', 'a variable'], ['held', 'a key is held'], ['touching', 'two things touch'], ['chance', 'luck']];
export { KEYS, OPS, HELD };

let seq = 0;
const bid = () => 'b' + Date.now().toString(36).slice(-3) + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);
const defArgs = type => Object.fromEntries((SPEC[type]?.parts || []).filter(p => typeof p === 'object').map(p => [p.k, p.def]));
export const defCond = (type = 'var') => (type === 'held' ? { type, key: 'left' } : type === 'touching' ? { type, a: 'player', b: 'any' } : type === 'chance' ? { type, pct: 50 } : { type: 'var', name: 'score', op: '>=', n: 10 });

export function newBlock(type) {
  const spec = SPEC[type];
  if (!spec) return null;
  const b = { id: bid(), type, args: defArgs(type) };
  if (spec.cond) b.cond = defCond();
  if (spec.container) { b.body = []; if (type === 'if') b.else = []; }
  if (spec.hat) { b.body = []; }
  return b;
}
export const newScript = type => newBlock(type);

/* ---------- reading a program from anywhere (a saved game, a hand edit) ---------- */
const MAX_SCRIPTS = 40, MAX_BLOCKS = 600, MAX_DEPTH = 6;
export function validateProgram(raw) {
  const out = { v: 1, scripts: [] };
  let count = 0;
  const clean = (list, depth, hat) => {
    const res = [];
    for (const b of Array.isArray(list) ? list : []) {
      if (!b || typeof b !== 'object' || !SPEC[b.type] || !!SPEC[b.type].hat !== hat || count >= MAX_BLOCKS) continue;
      if (!hat && SPEC[b.type].container && depth >= MAX_DEPTH) continue;
      count++;
      const spec = SPEC[b.type], nb = { id: typeof b.id === 'string' && b.id ? b.id.slice(0, 24) : bid(), type: b.type, args: {} };
      for (const p of spec.parts) {
        if (typeof p !== 'object') continue;
        let v = b.args && b.args[p.k] !== undefined ? b.args[p.k] : p.def;
        if (p.kind === 'num') { v = Number(v); if (!Number.isFinite(v)) v = p.def; v = Math.max(-1e6, Math.min(1e6, v)); }
        else v = String(v ?? '').slice(0, 200);
        nb.args[p.k] = v;
      }
      if (spec.cond) {
        const c = b.cond && typeof b.cond === 'object' ? b.cond : {};
        const d = defCond(COND_TYPES.some(t => t[0] === c.type) ? c.type : 'var');
        nb.cond = { ...d };
        for (const k of Object.keys(d)) if (c[k] !== undefined && k !== 'type') nb.cond[k] = typeof d[k] === 'number' ? (Number.isFinite(Number(c[k])) ? Number(c[k]) : d[k]) : String(c[k]).slice(0, 80);
        if (nb.cond.type === 'var' && !OPS.some(o => o[0] === nb.cond.op)) nb.cond.op = '>=';
      }
      if (spec.container || spec.hat) nb.body = clean(b.body, depth + 1, false);
      if (b.type === 'if') nb.else = clean(b.else, depth + 1, false);
      res.push(nb);
    }
    return res;
  };
  if (raw && typeof raw === 'object' && Array.isArray(raw.scripts)) out.scripts = clean(raw.scripts.slice(0, MAX_SCRIPTS), 0, true);
  return out;
}

/* ---------- blocks to JavaScript ---------- */
const str = v => JSON.stringify(String(v ?? '')).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');
const n = v => { const x = Number(v); return Number.isFinite(x) ? String(x) : '0'; };
const ID = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;

/* "player", an object's name or group, or the first / second thing of the script's "when" */
function listOf(refv, hat) {
  const r = String(refv ?? '');
  if (r === '@A') return ['touch', 'click', 'hurt'].includes(hat) ? '[A]' : '[]';
  if (r === '@B') return hat === 'touch' ? '[B]' : '[]';
  if (r === 'player') return '[game.player].filter(Boolean)';
  if (r === 'any') return 'game.objects';
  return `game.findAll(${str(r)})`;
}
function condCode(c, hat) {
  if (c.type === 'held') return `!!game.keys[${str(c.key)}]`;
  if (c.type === 'chance') return `Math.random() * 100 < ${n(c.pct)}`;
  if (c.type === 'touching') return `${listOf(c.a, hat)}.some(x => ${listOf(c.b, hat)}.some(y => x !== y && game.touching(x, y)))`;
  const op = OPS.some(o => o[0] === c.op) ? c.op : '>=';
  return `(Number(game.vars[${str(c.name)}]) || 0) ${op} ${n(c.n)}`;
}
function stmt(b, hat, ind, depth) {
  const a = b.args || {}, pad = '  '.repeat(ind);
  const list = (body, d = ind + 1) => (body || []).map(x => stmt(x, hat, d, depth + 1)).filter(Boolean).join('\n');
  switch (b.type) {
    case 'score': return `${pad}game.addScore(${n(a.n)});`;
    case 'say': return `${pad}game.say(${str(a.text)});`;
    case 'loseLife': return `${pad}game.loseLife();`;
    case 'winGame': return `${pad}game.win();`;
    case 'loseGame': return `${pad}game.lose();`;
    case 'nextLevel': return `${pad}game.nextLevel();`;
    case 'restart': return `${pad}game.restart();`;
    case 'play': return a.sound ? `${pad}game.play(${str(a.sound)});` : '';
    case 'setVar': return ID.test(a.name) ? `${pad}game.vars[${str(a.name)}] = ${n(a.n)};` : '';
    case 'changeVar': return ID.test(a.name) ? `${pad}game.vars[${str(a.name)}] = (Number(game.vars[${str(a.name)}]) || 0) + ${n(a.n)};` : '';
    case 'spawn': return a.what ? `${pad}game.clone(${str(a.what)}, ${n(a.x)}, ${n(a.y)});` : '';
    case 'spawnAt': return a.what ? `${pad}${listOf(a.where, hat)}.forEach(t => game.clone(${str(a.what)}, t.x + t.w / 2, t.y + t.h / 2));` : '';
    case 'destroy': return `${pad}${listOf(a.what, hat)}.forEach(o => game.destroy(o));`;
    case 'move': return `${pad}${listOf(a.what, hat)}.forEach(o => { o.x += ${n(a.dx)}; o.y += ${n(a.dy)}; });`;
    case 'place': return `${pad}${listOf(a.what, hat)}.forEach(o => { o.x = ${n(a.x)}; o.y = ${n(a.y)}; });`;
    case 'color': return `${pad}${listOf(a.what, hat)}.forEach(o => { o.color = ${str(a.color)}; });`;
    case 'show': return `${pad}${listOf(a.what, hat)}.forEach(o => { o.visible = ${a.on === 'false' ? 'false' : 'true'}; });`;
    case 'repeat': {
      const i = `__i${depth}`;
      return `${pad}for (let ${i} = 0; ${i} < ${Math.max(0, Math.min(1000, Math.round(Number(a.n) || 0)))}; ${i}++) {\n${list(b.body)}\n${pad}}`;
    }
    case 'if': {
      const els = b.else && b.else.length ? ` else {\n${list(b.else)}\n${pad}}` : '';
      return `${pad}if (${condCode(b.cond || defCond(), hat)}) {\n${list(b.body)}\n${pad}}${els}`;
    }
    default: return '';
  }
}

function script(s, k) {
  const body = (s.body || []).map(b => stmt(b, s.type, 2, 1)).filter(Boolean).join('\n');
  const a = s.args || {};
  switch (s.type) {
    case 'start': return `game.on('start', () => {\n${body}\n});`;
    case 'frame': return `game.on('update', dt => {\n${body}\n});`;
    case 'timer': {
      const t = `__timer${k}`, secs = Math.max(0.05, Number(a.secs) || 1);
      return `let ${t} = 0;\ngame.on('start', () => { ${t} = 0; });\ngame.on('update', dt => {\n  ${t} += dt;\n  if (${t} >= ${secs}) {\n    ${t} -= ${secs};\n${body}\n  }\n});`;
    }
    case 'touch':
      return `game.on('touch', (p, q) => {\n  for (const [A, B] of [[p, q], [q, p]]) {\n    if (__is(A, ${str(a.a)}) && __is(B, ${str(a.b)})) {\n${body}\n      break;\n    }\n  }\n});`;
    case 'key': return `game.on('key', (k, down) => {\n  if (down && String(k).toLowerCase() === ${str(String(a.key).toLowerCase())}) {\n${body}\n  }\n});`;
    case 'click': return `game.on('click', (A) => {\n  if (${a.what === 'any' || !a.what ? 'true' : `A && __is(A, ${str(a.what)})`}) {\n${body}\n  }\n});`;
    case 'win': return `game.on('win', () => {\n${body}\n});`;
    case 'lose': return `game.on('lose', () => {\n${body}\n});`;
    case 'hurt': return `game.on('hurt', (A) => {\n${body}\n});`;
    default: return '';
  }
}

export function toCode(program) {
  const p = validateProgram(program);
  const parts = p.scripts.map((s, i) => script(s, i + 1)).filter(Boolean);
  if (!parts.length) return '';
  return [
    'const __is = (o, r) => !!o && (r === \'any\' || (r === \'player\' ? !!(game.behaviour(o, \'platformer\') || game.behaviour(o, \'topdown\')) : o.name === r || o.group === r || o.id === r));',
    ...parts,
  ].join('\n');
}

/* ---------- the section inside game-code ---------- */
const packJson = p => JSON.stringify(p).replace(/\*\//g, '*\\u002f').replace(/</g, '\\u003c');
const SECTION = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n/\\*BLOCKS:1 ([\\s\\S]*?) \\*/\\n[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`);

/** Put the program's code into the game code (or take the section out when the program is empty). */
export function writeBlocks(code, program) {
  const base = String(code || '');
  const p = validateProgram(program);
  const body = toCode(p);
  let cut = base.replace(SECTION, '');
  /* a section that was edited by hand can't be read back: it goes, so the new one is the only one */
  if (cut.includes(START)) {
    const a = cut.indexOf(START), z = cut.indexOf(END, a);
    cut = cut.slice(0, a) + (z >= 0 ? cut.slice(z + END.length).replace(/^\n/, '') : '');
  }
  if (!p.scripts.length) return cut.replace(/\n+$/, '\n');
  const sect = `${START}\n/*BLOCKS:1 ${packJson(p)} */\n${body}\n${END}\n`;
  return `${cut.replace(/\n*$/, '\n')}\n${sect}`;
}

/** null = the code has no blocks; { error } = it has a section Studio can't read; else { program }. */
export function readBlocks(code) {
  const text = String(code || '');
  if (!text.includes(START)) return null;
  const m = text.match(SECTION);
  if (!m) return { error: 'The blocks section in the game code was changed by hand, so it cannot be opened as blocks.' };
  try { return { program: validateProgram(JSON.parse(m[1])) }; }
  catch (err) { return { error: 'The blocks section in the game code could not be read.' }; }
}

export default { SPEC, CATS, HATS, newBlock, newScript, validateProgram, toCode, writeBlocks, readBlocks, defCond, COND_TYPES, KEYS, OPS, HELD };
