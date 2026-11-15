/* ============================================================
   studio/runtime.js — the tiny engine that runs Static Studio
   scenes, and the one place that knows the scene file format.

   A Studio game is ONE self-contained HTML document (the same
   format Forge makes), so current(project) is always playable on
   its own, in the sandbox, in Play, anywhere:

     <script type="application/json" id="scene">       the scene
     <script type="application/json" id="studio-assets"> sprites + sounds
     <script id="studio-runtime">                       this engine
     <script id="game-code">                            the maker's own code

   The engine is written below as an ordinary function so this file
   parses and checks like every other module, and it is shipped into
   each game as SOURCE TEXT (Function#toString) with its behaviour
   defaults passed in. It must not touch anything outside itself.

   What it runs: a requestAnimationFrame loop, axis-by-axis AABB
   collision against solid objects, gravity, the behaviours in
   BEHAVIOURS, touch events (when A starts touching B → actions),
   score / lives / timer, a HUD, pause, win and lose screens, R to
   restart, keyboard (arrows / WASD / Space) and on-screen touch
   buttons. Game code gets a small `game` API (see DEFAULT_CODE).

   Version 2 adds, all optional so that every older scene loads and plays
   as before: a world bigger than the screen (settings.worldWidth /
   worldHeight, a camera that follows the player), more levels
   (scene.levels = levels 2 and up; scene.objects / events stay level 1),
   tilemap objects (`tiles`), animated sprites (`anim`), objects that stay
   on screen (`fixed`) or only appear when spawned (`spawnOnly`), the
   shooter / spinner / bobber / spawner / clickable behaviours, the
   say / setVar / addVar / spawn / teleport / nextLevel actions, an optional
   `if` on an event, custom win and game-over screens and game music.

   Exports for Studio: BEHAVIOURS, ACTIONS, SETTINGS, RUNTIME_JS,
   buildDoc, readDoc, writeScene, formatScene, validateScene,
   newId, groupOf.
   ============================================================ */

export const RUNTIME_VERSION = 2;

/* ---------- behaviours: what Studio shows, and the engine's defaults -- */
/* param kinds: num {min,max,step,unit} · select {options:[[value,label]]}
   · bool · sound (an audio asset id or '') */
export const BEHAVIOURS = [
  {
    type: 'platformer', label: 'Platformer player', icon: 'gamepad', role: 'player',
    desc: 'Runs with ← → or A D, jumps with ↑, W or Space. Falls with gravity and stands on solid things.',
    params: [
      { k: 'speed', label: 'Run speed', kind: 'num', def: 240, min: 20, max: 900, unit: 'px/s' },
      { k: 'jump', label: 'Jump strength', kind: 'num', def: 560, min: 100, max: 1600 },
      { k: 'airJumps', label: 'Extra jumps in the air', kind: 'num', def: 0, min: 0, max: 5 },
    ],
  },
  {
    type: 'topdown', label: 'Top-down player', icon: 'compass', role: 'player',
    desc: 'Moves in any direction with the arrow keys or WASD. Solid things block it.',
    params: [
      { k: 'speed', label: 'Speed', kind: 'num', def: 220, min: 20, max: 900, unit: 'px/s' },
      { k: 'axis', label: 'Can move', kind: 'select', def: 'both', options: [['both', 'Any direction'], ['x', 'Left and right only'], ['y', 'Up and down only']] },
    ],
  },
  {
    type: 'patrol', label: 'Enemy: patrol', icon: 'repeat', role: 'enemy',
    desc: 'Walks back and forth from where it starts. A player who touches it loses a life.',
    params: [
      { k: 'speed', label: 'Speed', kind: 'num', def: 90, min: 5, max: 800, unit: 'px/s' },
      { k: 'distance', label: 'Distance', kind: 'num', def: 160, min: 0, max: 4000, unit: 'px' },
      { k: 'axis', label: 'Direction', kind: 'select', def: 'x', options: [['x', 'Left and right'], ['y', 'Up and down']] },
      { k: 'stomp', label: 'Platformer players can stomp it', kind: 'bool', def: true },
      { k: 'points', label: 'Points for a stomp', kind: 'num', def: 5, min: -1000, max: 1000 },
    ],
  },
  {
    type: 'chase', label: 'Enemy: chase player', icon: 'zap', role: 'enemy',
    desc: 'Moves toward the nearest player. A player who touches it loses a life.',
    params: [
      { k: 'speed', label: 'Speed', kind: 'num', def: 80, min: 5, max: 800, unit: 'px/s' },
      { k: 'range', label: 'Notices players within', kind: 'num', def: 0, min: 0, max: 4000, unit: 'px (0 = anywhere)' },
      { k: 'axis', label: 'Moves', kind: 'select', def: 'both', options: [['both', 'Any direction'], ['x', 'Left and right only']] },
      { k: 'stomp', label: 'Platformer players can stomp it', kind: 'bool', def: false },
      { k: 'points', label: 'Points for a stomp', kind: 'num', def: 5, min: -1000, max: 1000 },
    ],
  },
  {
    type: 'collectible', label: 'Collectible', icon: 'star', role: 'pickup',
    desc: 'A player who touches it scores points and it disappears.',
    params: [
      { k: 'points', label: 'Points', kind: 'num', def: 10, min: -1000, max: 1000 },
      { k: 'sound', label: 'Sound', kind: 'sound', def: '' },
    ],
  },
  {
    type: 'hazard', label: 'Hazard', icon: 'alert', role: 'hazard',
    desc: 'A player who touches it loses a life and starts again from where they began.',
    params: [
      { k: 'sound', label: 'Sound', kind: 'sound', def: '' },
    ],
  },
  {
    type: 'goal', label: 'Goal', icon: 'check-circle', role: 'goal',
    desc: 'A player who touches it wins the game.',
    params: [
      { k: 'needAll', label: 'Only after every collectible is taken', kind: 'bool', def: false },
      { k: 'then', label: 'Then', kind: 'select', def: 'auto', options: [['auto', 'Go to the next level (win on the last one)'], ['win', 'Win the game right away']] },
    ],
  },
  {
    type: 'moving', label: 'Moving platform', icon: 'arrow-right', role: 'platform',
    desc: 'Glides back and forth. Platformer players standing on it ride along. Make it solid to stand on it.',
    params: [
      { k: 'dx', label: 'Move across', kind: 'num', def: 160, min: -4000, max: 4000, unit: 'px' },
      { k: 'dy', label: 'Move down', kind: 'num', def: 0, min: -4000, max: 4000, unit: 'px' },
      { k: 'speed', label: 'Speed', kind: 'num', def: 60, min: 1, max: 800, unit: 'px/s' },
    ],
  },
  {
    type: 'faller', label: 'Falling', icon: 'arrow-down', role: 'faller',
    desc: 'Falls down the screen and comes back at the top in a random place. Good for dodge games.',
    params: [
      { k: 'speed', label: 'Fall speed', kind: 'num', def: 180, min: 5, max: 1500, unit: 'px/s' },
      { k: 'speedUp', label: 'Gets faster by', kind: 'num', def: 4, min: 0, max: 200, unit: 'px/s each second' },
      { k: 'dir', label: 'Flies', kind: 'select', def: 'down', options: [['down', 'Down'], ['up', 'Up'], ['left', 'Left (in from the right)'], ['right', 'Right (in from the left)']] },
      { k: 'loop', label: 'Comes back round when it leaves', kind: 'bool', def: true },
      { k: 'points', label: 'Points when it gets past', kind: 'num', def: 0, min: -1000, max: 1000 },
    ],
  },
  {
    type: 'shooter', label: 'Shooter', icon: 'zap', role: 'weapon',
    desc: 'Fires bullets with X, F or the fire button. A bullet removes an enemy it hits (a patrolling or chasing enemy, or a falling hazard) and stops at solid things. Give it to a player.',
    params: [
      { k: 'dir', label: 'Shoots', kind: 'select', def: 'facing', options: [['facing', 'The way it faces'], ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']] },
      { k: 'rate', label: 'Shots a second', kind: 'num', def: 4, min: 0.5, max: 20 },
      { k: 'speed', label: 'Bullet speed', kind: 'num', def: 520, min: 60, max: 2000, unit: 'px/s' },
      { k: 'size', label: 'Bullet size', kind: 'num', def: 8, min: 3, max: 40, unit: 'px' },
      { k: 'points', label: 'Points for each enemy hit', kind: 'num', def: 5, min: -1000, max: 1000 },
      { k: 'sound', label: 'Sound', kind: 'sound', def: '' },
    ],
  },
  {
    type: 'spinner', label: 'Spinner', icon: 'refresh', role: 'motion',
    desc: 'Turns round and round. Only the picture spins; what it touches stays the same box.',
    params: [
      { k: 'speed', label: 'Turns', kind: 'num', def: 120, min: -1440, max: 1440, unit: 'degrees/s' },
    ],
  },
  {
    type: 'bobber', label: 'Bobber', icon: 'arrow-up', role: 'motion',
    desc: 'Floats gently up and down (or side to side) around where you put it. Nice for coins and signs.',
    params: [
      { k: 'amount', label: 'How far', kind: 'num', def: 10, min: 0, max: 1000, unit: 'px' },
      { k: 'period', label: 'One trip takes', kind: 'num', def: 2, min: 0.2, max: 60, unit: 'seconds' },
      { k: 'axis', label: 'Direction', kind: 'select', def: 'y', options: [['y', 'Up and down'], ['x', 'Left and right']] },
    ],
  },
  {
    type: 'spawner', label: 'Timer spawner', icon: 'clock', role: 'spawner',
    desc: 'Every few seconds, makes a new copy of another object where this one is. Pick the object to copy; tick “Only appears when spawned” on it so it is not there from the start.',
    params: [
      { k: 'what', label: 'Copies', kind: 'object', def: '' },
      { k: 'every', label: 'Every', kind: 'num', def: 2, min: 0.1, max: 600, unit: 'seconds' },
      { k: 'spread', label: 'Random spread', kind: 'num', def: 0, min: 0, max: 4000, unit: 'px across' },
      { k: 'limit', label: 'At most this many at once', kind: 'num', def: 0, min: 0, max: 500, unit: '(0 = no limit)' },
    ],
  },
  {
    type: 'clickable', label: 'Clickable', icon: 'mouse-pointer', role: 'pickup',
    desc: 'Click or tap it to score points. Good for clicker games.',
    params: [
      { k: 'points', label: 'Points per click', kind: 'num', def: 1, min: -1000, max: 1000 },
      { k: 'pop', label: 'Disappears when clicked', kind: 'bool', def: false },
      { k: 'sound', label: 'Sound', kind: 'sound', def: '' },
    ],
  },
];
export const behaviourDef = type => BEHAVIOURS.find(b => b.type === type) || null;

const DEFAULTS = Object.fromEntries(BEHAVIOURS.map(b => [b.type, Object.fromEntries(b.params.map(p => [p.k, p.def]))]));

/* touch-event actions */
export const ACTIONS = [
  { do: 'score', label: 'Add to score', n: true, def: 10 },
  { do: 'destroyB', label: 'Remove B' },
  { do: 'destroyA', label: 'Remove A' },
  { do: 'loseLife', label: 'Lose a life' },
  { do: 'gainLife', label: 'Gain a life', n: true, def: 1 },
  { do: 'win', label: 'Win the game' },
  { do: 'lose', label: 'Lose the game' },
  { do: 'sound', label: 'Play a sound', sound: true },
  { do: 'say', label: 'Show a message', text: true },
  { do: 'setVar', label: 'Set a variable', varName: true, n: true, def: 0 },
  { do: 'addVar', label: 'Change a variable by', varName: true, n: true, def: 1 },
  { do: 'spawn', label: 'Spawn a copy of an object', obj: true, at: true },
  { do: 'teleport', label: 'Move the player to an object', obj: true },
  { do: 'nextLevel', label: 'Go to the next level' },
];
export const IF_OPS = [['>=', 'is at least'], ['>', 'is more than'], ['<=', 'is at most'], ['<', 'is less than'], ['=', 'is'], ['!=', 'is not']];
export const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
export const BAD_VARS = ['__proto__', 'constructor', 'prototype', 'hasOwnProperty'];
export const actionDef = d => ACTIONS.find(a => a.do === d) || null;

export const SETTINGS = {
  width: 800, height: 450, background: '#141a2e', gravity: 1500,
  lives: 3, score: 0, timer: 0, timerEnds: 'lose', winScore: 0, hud: true,
};

/* ====================================================================
   THE ENGINE — shipped as text into every Studio game.
   ==================================================================== */
function studioEngine(DEF) {
  'use strict';
  const $ = id => document.getElementById(id);
  const num = (v, d, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(hi === undefined ? 1e9 : hi, Math.max(lo === undefined ? -1e9 : lo, n));
  };
  const readData = id => {
    const el = $(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent || 'null'); }
    catch (err) { console.error('Could not read the "' + id + '" data: ' + err.message); return null; }
  };
  /* where in the document an error came from, when the browser says */
  const where = err => {
    const m = String((err && err.stack) || '').match(/(?:srcdoc|<anonymous>|\.html?):(\d+):\d+/);
    return m ? ' (line ' + m[1] + ')' : '';
  };

  /* ---------- scene + settings ---------- */
  const raw = readData('scene');
  const scene = raw && typeof raw === 'object' ? raw : { objects: [] };
  const rs = scene.settings && typeof scene.settings === 'object' ? scene.settings : {};
  const S = {
    width: Math.round(num(rs.width, 800, 120, 2400)),
    height: Math.round(num(rs.height, 450, 120, 2400)),
    background: typeof rs.background === 'string' && rs.background ? rs.background : '#141a2e',
    gravity: num(rs.gravity, 1500, -6000, 6000),
    lives: Math.round(num(rs.lives, 3, 1, 99)),
    score: num(rs.score, 0),
    timer: num(rs.timer, 0, 0, 86400),
    timerEnds: rs.timerEnds === 'win' ? 'win' : 'lose',
    winScore: num(rs.winScore, 0, 0),
    hud: rs.hud !== false,
    worldWidth: Math.round(num(rs.worldWidth, 0, 0, 20000)),
    worldHeight: Math.round(num(rs.worldHeight, 0, 0, 20000)),
    music: typeof rs.music === 'string' ? rs.music : '',
    musicVolume: num(rs.musicVolume, 0.5, 0, 1),
    winTitle: typeof rs.winTitle === 'string' ? rs.winTitle.slice(0, 80) : '',
    winText: typeof rs.winText === 'string' ? rs.winText.slice(0, 200) : '',
    winColor: typeof rs.winColor === 'string' && rs.winColor ? rs.winColor : '#86efac',
    winImage: typeof rs.winImage === 'string' ? rs.winImage : '',
    loseTitle: typeof rs.loseTitle === 'string' ? rs.loseTitle.slice(0, 80) : '',
    loseText: typeof rs.loseText === 'string' ? rs.loseText.slice(0, 200) : '',
    loseColor: typeof rs.loseColor === 'string' && rs.loseColor ? rs.loseColor : '#fca5a5',
    loseImage: typeof rs.loseImage === 'string' ? rs.loseImage : '',
    vars: {},
  };
  if (rs.vars && typeof rs.vars === 'object' && !Array.isArray(rs.vars)) {
    for (const k of Object.keys(rs.vars).slice(0, 16)) {
      if (/^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(k) && ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'score', 'lives', 'time'].indexOf(k) < 0) S.vars[k] = num(rs.vars[k], 0);
    }
  }
  const W = S.width, H = S.height;
  /* the world can be bigger than the screen; the camera follows the player */
  const WW = Math.max(W, S.worldWidth || W), WH = Math.max(H, S.worldHeight || H);
  const cam = { x: 0, y: 0 };
  /* level 1 is scene.objects / scene.events; later levels are scene.levels */
  const LV = [{ objects: scene.objects, events: scene.events }]
    .concat((Array.isArray(scene.levels) ? scene.levels : []).filter(l => l && typeof l === 'object').slice(0, 30));
  let level = 0;
  if (typeof scene.title === 'string' && scene.title && !document.title) document.title = scene.title;

  /* ---------- canvas, sized to the frame and crisp at any scale ---------- */
  let canvas = $('game');
  if (!canvas || !canvas.getContext) {
    canvas = document.createElement('canvas');
    canvas.id = 'game';
    document.body.appendChild(canvas);
  }
  canvas.tabIndex = 0;
  const ctx = canvas.getContext('2d');
  let scale = 1, dpr = 1;
  function fit() {
    const vw = window.innerWidth || W, vh = window.innerHeight || H;
    scale = Math.max(0.05, Math.min(vw / W, vh / H));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    canvas.width = Math.max(1, Math.round(W * scale * dpr));
    canvas.height = Math.max(1, Math.round(H * scale * dpr));
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- assets: sprites and sounds, looked up by id or name ---------- */
  const assetData = readData('studio-assets') || {};
  const IMG = {}, SND = {}, NAMES = {}, SHEET = {};
  for (const id of Object.keys(assetData)) {
    const a = assetData[id];
    if (!a || typeof a.src !== 'string' || !a.src) continue;
    const name = String(a.name || id).toLowerCase();
    NAMES[name] = id;
    NAMES[name.replace(/\.[a-z0-9]+$/, '')] = id;
    if (a.kind === 'audio') SND[id] = a.src;
    else { const im = new Image(); im.src = a.src; IMG[id] = im; }
    if (a.sheet && typeof a.sheet === 'object') SHEET[id] = a.sheet;
  }
  const assetId = ref => {
    if (ref === null || ref === undefined || ref === '') return null;
    if (IMG[ref] || SND[ref]) return ref;
    return NAMES[String(ref).toLowerCase()] || null;
  };
  function play(ref) {
    const id = assetId(ref);
    if (!id || !SND[id]) return;
    try { const a = new Audio(SND[id]); a.volume = 0.8; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no audio here */ }
  }

  /* ---------- input ---------- */
  const KEYS = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'jump',
    KeyX: 'fire', KeyF: 'fire',
  };
  const held = { left: false, right: false, up: false, down: false, jump: false, fire: false };
  let hit = {};
  function press(k, down) {
    if (down && !held[k]) hit[k] = true;
    held[k] = down;
  }
  window.addEventListener('keydown', e => {
    const k = KEYS[e.code];
    if (k) { e.preventDefault(); press(k, true); }
    if (!e.repeat) {
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) restart();
      else if (e.code === 'Enter' && state !== 'play') restart();
      else if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'play') paused = !paused; }
    }
    musicOn();
    emit('key', e.key, true);
  });
  window.addEventListener('keyup', e => {
    const k = KEYS[e.code];
    if (k) press(k, false);
    emit('key', e.key, false);
  });
  window.addEventListener('blur', () => { for (const k in held) held[k] = false; });
  canvas.addEventListener('pointerdown', e => {
    try { window.focus(); canvas.focus({ preventScroll: true }); } catch (err) { /* fine */ }
    musicOn();
    if (state !== 'play') { restart(); return; }
    if (paused) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / (r.width || 1) * W, y = (e.clientY - r.top) / (r.height || 1) * H;
    clickAt(x, y);
  });

  /* ---------- game code hooks ---------- */
  const handlers = { start: [], update: [], draw: [], touch: [], win: [], lose: [], hurt: [], key: [], click: [], level: [] };
  function emit(name) {
    const list = handlers[name];
    if (!list || !list.length) return;
    const args = Array.prototype.slice.call(arguments, 1);
    for (const h of list) {
      if (h.off) continue;
      try { h.fn.apply(null, args); }
      catch (err) {
        h.off = true;
        console.error('Your "' + name + '" code stopped: ' + ((err && err.message) || err) + where(err) + ' — it stays off until the game restarts.');
      }
    }
  }

  /* ---------- objects ---------- */
  let objs = [], vars = {}, state = 'play', paused = false, clock = 0, hintT = 0, seq = 0;
  let prevTouch = new Set(), prevPairs = new Set(), flash = null, solids = [], doomed = [];

  const isPlayer = o => !!(o._b.platformer || o._b.topdown);
  const enemyOf = o => o._b.patrol || o._b.chase || null;
  const overlap = (a, b, pad) => {
    pad = pad || 0;
    return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  };

  function makeObj(src) {
    const o = {
      uid: ++seq,
      id: String(src.id || 'obj' + seq),
      name: String(src.name || 'Object'),
      group: String(src.group || '').toLowerCase(),
      x: num(src.x, 0), y: num(src.y, 0), w: num(src.w, 32, 1), h: num(src.h, 32, 1),
      color: typeof src.color === 'string' && src.color ? src.color : '#8b93a7',
      shape: src.shape === 'ellipse' ? 'ellipse' : 'rect',
      sprite: src.sprite || null,
      text: typeof src.text === 'string' ? src.text : '',
      solid: !!src.solid, visible: src.visible !== false, layer: num(src.layer, 0),
      vx: 0, vy: 0, alive: true, onGround: false, ground: null, face: 1, inv: 0,
      fixed: src.fixed === true, spawnOnly: src.spawnOnly === true,
      anim: src.anim && typeof src.anim === 'object' ? src.anim : null, at: 0, clip: '', rot: 0,
      data: src.data && typeof src.data === 'object' ? JSON.parse(JSON.stringify(src.data)) : {},
      behaviours: [], _b: {},
    };
    for (const b of Array.isArray(src.behaviours) ? src.behaviours : []) {
      if (!b || !DEF[b.type] || o._b[b.type]) continue;
      const d = DEF[b.type];
      const inst = Object.assign({}, d, b);
      for (const k of Object.keys(d)) {
        if (typeof d[k] === 'number') inst[k] = num(inst[k], d[k]);
        else if (typeof d[k] === 'boolean') inst[k] = inst[k] === true || inst[k] === 'true';
      }
      o.behaviours.push(inst);
      o._b[b.type] = inst;
    }
    o.sx = o.x; o.sy = o.y; o.lx = o.x; o.ly = o.y;
    return o;
  }

  /* a tilemap object is a grid of ground; the engine turns it into a few solid boxes */
  function expandTiles(src) {
    const t = src.tiles, rows = t && Array.isArray(t.rows) ? t.rows.slice(0, 400) : [];
    const size = num(t && t.size, 32, 4, 256);
    const out = [];
    let open = {};
    const flush = (key, until) => {
      const r = open[key];
      if (!r) return;
      delete open[key];
      out.push({ id: src.id + '#' + out.length, name: src.name, group: src.group || 'ground', x: num(src.x, 0) + r.x0 * size, y: num(src.y, 0) + r.r0 * size,
        w: (r.x1 - r.x0) * size, h: (until - r.r0) * size, color: src.color, solid: src.solid !== false, layer: src.layer, visible: src.visible, tile: true });
    };
    for (let r = 0; r <= rows.length; r++) {
      const row = r < rows.length ? String(rows[r]).slice(0, 400) : '';
      const now = {};
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '#') continue;
        let e = x;
        while (e < row.length && row[e] === '#') e++;
        now[x + ':' + e] = { x0: x, x1: e, r0: r };
        x = e - 1;
      }
      for (const key of Object.keys(open)) if (!now[key]) flush(key, r);
      for (const key of Object.keys(now)) if (!open[key]) open[key] = now[key];
    }
    return out;
  }
  let templates = {};
  function loadObjects() {
    const src = (Array.isArray(LV[level].objects) ? LV[level].objects : []).filter(o => o && typeof o === 'object').slice(0, 3000);
    templates = {};
    for (const o of src) if (o.id) templates[String(o.id)] = o;
    const list = [];
    for (const o of src) {
      if (o.spawnOnly === true) continue;
      if (o.tiles && typeof o.tiles === 'object') for (const t of expandTiles(o)) list.push(t);
      else list.push(o);
    }
    seq = 0;
    objs = list.slice(0, 3000).map(makeObj);
    objs.forEach((o, i) => { o.order = i; });
    prevTouch = new Set(); prevPairs = new Set(); doomed = [];
    snapCamera();
  }
  function reset() {
    level = 0;
    loadObjects();
    vars = Object.assign({}, S.vars, { score: S.score, lives: S.lives, time: S.timer });
    state = 'play'; paused = false; clock = 0; flash = null;
    hintT = 4.5;
    for (const k in handlers) for (const h of handlers[k]) h.off = false;
    emit('start', game);
  }
  function restart() { reset(); }
  /* on to the next level, keeping score and lives; after the last one the game is won */
  function nextLevel() {
    if (state !== 'play') return;
    if (level + 1 >= LV.length) { win(); return; }
    level++;
    loadObjects();
    vars.time = S.timer;
    clock = 0;
    say('Level ' + (level + 1), 2);
    emit('level', level + 1, game);
  }

  function pick(ref) {
    ref = String(ref === undefined || ref === null ? '' : ref);
    const live = objs.filter(o => o.alive);
    if (ref === 'player') return live.filter(isPlayer);
    if (ref === 'any') return live;
    if (ref.indexOf('id:') === 0) { const id = ref.slice(3); return live.filter(o => o.id === id); }
    if (ref.indexOf('group:') === 0) { const g = ref.slice(6).toLowerCase(); return live.filter(o => o.group === g); }
    const byName = live.filter(o => o.name === ref || o.id === ref);
    return byName.length ? byName : live.filter(o => o.group === ref.toLowerCase());
  }
  const firstPlayer = () => objs.find(o => o.alive && isPlayer(o)) || null;

  /* ---------- movement against solid things ---------- */
  function moveBy(o, dx, dy) {
    let hx = null, hy = null;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
    const sx = dx / n, sy = dy / n;
    for (let i = 0; i < n; i++) {
      if (sx && !hx) {
        o.x += sx;
        for (const s of solids) if (s !== o && s.alive && overlap(o, s)) { o.x = sx > 0 ? s.x - o.w : s.x + s.w; hx = s; }
      }
      if (sy && !hy) {
        o.y += sy;
        for (const s of solids) if (s !== o && s.alive && overlap(o, s)) { o.y = sy > 0 ? s.y - o.h : s.y + s.h; hy = s; }
      }
    }
    return { hx, hy };
  }
  /* pushed into a wall by something else (a moving platform): step out the short way */
  function unstick(o) {
    for (const s of solids) {
      if (s === o || !s.alive || !overlap(o, s)) continue;
      const l = o.x + o.w - s.x, r = s.x + s.w - o.x, u = o.y + o.h - s.y, d = s.y + s.h - o.y;
      const m = Math.min(l, r, u, d);
      if (m === u) { o.y -= u; if (o.vy > 0) o.vy = 0; o.onGround = true; o.ground = s; }
      else if (m === d) { o.y += d; if (o.vy < 0) o.vy = 0; }
      else if (m === l) o.x -= l;
      else o.x += r;
    }
  }
  const keepIn = (o, bottom) => {
    if (o.x < 0) { o.x = 0; o.vx = 0; }
    if (o.x + o.w > WW) { o.x = WW - o.w; o.vx = 0; }
    if (bottom) {
      if (o.y < 0) { o.y = 0; o.vy = 0; }
      if (o.y + o.h > WH) { o.y = WH - o.h; o.vy = 0; }
    }
  };

  /* ---------- behaviours ---------- */
  function platformer(o, dt) {
    const b = o._b.platformer;
    if (o.onGround && o.ground && o.ground.alive && o.ground._dx !== undefined) {
      o.x += o.ground._dx; o.y += o.ground._dy;
    }
    o.prevBottom = o.y + o.h;
    const dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    if (dir) o.face = dir;
    const acc = (o.onGround ? 10 : 6) * b.speed * dt;
    o.vx += Math.max(-acc, Math.min(acc, dir * b.speed - o.vx));
    o.coyote = o.onGround ? 0.1 : (o.coyote || 0) - dt;
    o.jbuf = hit.jump || hit.up ? 0.14 : (o.jbuf || 0) - dt;
    if (o.onGround) o.air = b.airJumps;
    if (o.jbuf > 0) {
      if (o.coyote > 0) { o.vy = -b.jump; o.coyote = 0; o.jbuf = 0; o.onGround = false; }
      else if (o.air > 0) { o.vy = -b.jump * 0.92; o.air -= 1; o.jbuf = 0; }
    }
    /* let go of jump early for a shorter hop */
    o.vy += S.gravity * dt * (o.vy < 0 && !(held.jump || held.up) ? 2.2 : 1);
    o.vy = Math.max(-2600, Math.min(1200, o.vy));
    o.onGround = false; o.ground = null;
    const r = moveBy(o, o.vx * dt, o.vy * dt);
    if (r.hx) o.vx = 0;
    if (r.hy) {
      if (o.vy >= 0) { o.onGround = true; o.ground = r.hy; }
      o.vy = 0;
    }
    keepIn(o, false);
    if (o.y > WH + 80) hurt(o, '', true);
  }

  function topdown(o, dt) {
    const b = o._b.topdown;
    let dx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    let dy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
    if (b.axis === 'x') dy = 0;
    if (b.axis === 'y') dx = 0;
    const len = Math.hypot(dx, dy) || 1;
    o.vx = dx / len * b.speed; o.vy = dy / len * b.speed;
    if (dx) o.face = dx;
    moveBy(o, o.vx * dt, o.vy * dt);
    keepIn(o, true);
  }

  function patrol(o, dt) {
    const b = o._b.patrol;
    if (!o.dir) o.dir = 1;
    const ax = b.axis === 'y' ? 'y' : 'x';
    const d = o.dir * b.speed * dt;
    const r = ax === 'x' ? moveBy(o, d, 0) : moveBy(o, 0, d);
    const off = ax === 'x' ? o.x - o.sx : o.y - o.sy;
    const max = ax === 'x' ? WW - o.w : WH - o.h;
    const pos = ax === 'x' ? o.x : o.y;
    if (r.hx || r.hy || (o.dir > 0 && (off >= b.distance || pos >= max)) || (o.dir < 0 && (off <= 0 || pos <= 0))) o.dir *= -1;
    if (ax === 'x') { o.x = Math.max(0, Math.min(max, o.x)); o.face = o.dir; }
    else o.y = Math.max(0, Math.min(max, o.y));
  }

  function chase(o, dt) {
    const b = o._b.chase;
    let best = null, bd = Infinity;
    for (const p of objs) {
      if (!p.alive || !isPlayer(p)) continue;
      const d = Math.hypot(p.x + p.w / 2 - o.x - o.w / 2, p.y + p.h / 2 - o.y - o.h / 2);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || (b.range > 0 && bd > b.range)) return;
    const dx = best.x + best.w / 2 - o.x - o.w / 2;
    const dy = b.axis === 'x' ? 0 : best.y + best.h / 2 - o.y - o.h / 2;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    moveBy(o, dx / len * b.speed * dt, dy / len * b.speed * dt);
    if (Math.abs(dx) > 1) o.face = Math.sign(dx);
    keepIn(o, true);
  }

  function recycle(o) {
    const d = o._b.faller ? o._b.faller.dir : 'down';
    if (d === 'left' || d === 'right') {
      o.x = d === 'left' ? WW + Math.random() * W * 0.5 : -o.w - Math.random() * W * 0.5;
      o.y = Math.random() * Math.max(0, WH - o.h);
    } else if (d === 'up') {
      o.y = WH + Math.random() * H * 0.5;
      o.x = Math.random() * Math.max(0, WW - o.w);
    } else {
      o.y = -o.h - Math.random() * H * 0.5;
      o.x = Math.random() * Math.max(0, WW - o.w);
    }
  }
  /* a falling thing that is used up either comes back round or is gone for good */
  function reuse(o) {
    if (o._b.faller && o._b.faller.loop === false) destroy(o);
    else { recycle(o); o.fv = 0; }
  }
  function faller(o, dt) {
    const b = o._b.faller;
    o.fv = (o.fv || b.speed) + b.speedUp * dt;
    const d = b.dir;
    if (d === 'left') o.x -= o.fv * dt;
    else if (d === 'right') o.x += o.fv * dt;
    else if (d === 'up') o.y -= o.fv * dt;
    else o.y += o.fv * dt;
    const gone = d === 'left' ? o.x + o.w < 0 : d === 'right' ? o.x > WW : d === 'up' ? o.y + o.h < 0 : o.y > WH;
    if (!gone) return;
    if (b.loop === false) { vars.score += b.points; destroy(o); }
    else recycle(o);
  }

  /* ---------- spinner, bobber, timer spawner ---------- */
  function bobber(o) {
    const b = o._b.bobber;
    const v = Math.sin(clock * Math.PI * 2 / Math.max(0.2, b.period)) * b.amount;
    if (b.axis === 'x') o.x = o.sx + v; else o.y = o.sy + v;
  }
  function spawner(o, dt) {
    const b = o._b.spawner;
    o.sp = (o.sp === undefined ? Math.min(b.every, 0.5) : o.sp) - dt;
    if (o.sp > 0) return;
    o.sp = b.every;
    if (b.limit > 0 && objs.reduce((n, x) => n + (x.alive && x.parent === o.uid ? 1 : 0), 0) >= b.limit) return;
    const c = spawnCopy(b.what, o.x + o.w / 2, o.y + o.h / 2, b.spread);
    if (c) c.parent = o.uid;
  }
  /* a copy of an object (by id or name), centred on a point */
  function spawnCopy(ref, cx, cy, spread) {
    ref = String(ref || '');
    let src = templates[ref];
    if (!src) for (const k of Object.keys(templates)) if (templates[k].name === ref) { src = templates[k]; break; }
    if (!src || objs.length > 3000) return null;
    const copy = JSON.parse(JSON.stringify(src));
    delete copy.spawnOnly; delete copy.tiles;
    copy.id = 'spawn' + (seq + 1);
    copy.x = cx - num(copy.w, 32, 1) / 2 + (spread ? (Math.random() - 0.5) * spread : 0);
    copy.y = cy - num(copy.h, 32, 1) / 2;
    const o = makeObj(copy);
    o.order = objs.length ? objs[objs.length - 1].order + 1 : 0;
    o.spawned = true;
    objs.push(o);
    return o;
  }

  /* ---------- shooting ---------- */
  function shooter(o, dt) {
    const b = o._b.shooter;
    o.cool = Math.max(0, (o.cool || 0) - dt);
    if (!held.fire || o.cool > 0 || state !== 'play') return;
    o.cool = 1 / b.rate;
    let dx = 0, dy = 0;
    if (b.dir === 'facing') dx = o.face >= 0 ? 1 : -1;
    else if (b.dir === 'up') dy = -1;
    else if (b.dir === 'down') dy = 1;
    else if (b.dir === 'left') dx = -1;
    else dx = 1;
    const sz = b.size;
    const bu = makeObj({ id: 'bullet' + (seq + 1), name: 'Bullet', group: 'bullet', w: sz, h: sz, color: '#fde68a', shape: 'ellipse', layer: 5,
      x: o.x + o.w / 2 - sz / 2 + dx * (o.w / 2 + sz / 2), y: o.y + o.h / 2 - sz / 2 + dy * (o.h / 2 + sz / 2) });
    bu.order = objs.length ? objs[objs.length - 1].order + 1 : 0;
    bu.bullet = { vx: dx * b.speed, vy: dy * b.speed, points: b.points };
    objs.push(bu);
    play(b.sound);
  }
  const killable = t => !!(t._b.patrol || t._b.chase || (t._b.faller && t._b.hazard));
  function bullet(o, dt) {
    const k = o.bullet;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(k.vx), Math.abs(k.vy)) * dt / 6));
    for (let i = 0; i < n && o.alive; i++) {
      o.x += k.vx * dt / n; o.y += k.vy * dt / n;
      if (o.x + o.w < -20 || o.x > WW + 20 || o.y + o.h < -20 || o.y > WH + 20) { destroy(o); break; }
      if (solids.some(s => s.alive && overlap(o, s))) { destroy(o); break; }
      const t = objs.find(x => x.alive && !x.bullet && killable(x) && overlap(o, x));
      if (t) {
        destroy(o);
        vars.score += k.points;
        if (t._b.faller) reuse(t); else destroy(t);
        break;
      }
    }
  }

  /* ---------- clicking ---------- */
  function clickAt(sx, sy) {
    const list = objs.filter(o => o.alive && o.visible).sort((a, b) => b.layer - a.layer || b.order - a.order);
    let hitObj = null;
    for (const o of list) {
      const x = o.fixed ? sx : sx + cam.x, y = o.fixed ? sy : sy + cam.y;
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) { if (o._b.clickable) { hitObj = o; break; } }
    }
    if (hitObj) {
      const c = hitObj._b.clickable;
      vars.score += c.points;
      play(c.sound);
      hitObj.pulse = 0.18;
      if (c.pop) destroy(hitObj);
    }
    emit('click', hitObj, sx + cam.x, sy + cam.y, game);
  }

  /* ---------- the camera ---------- */
  function camTarget(p) {
    return {
      x: Math.max(0, Math.min(WW - W, p.x + p.w / 2 - W / 2)),
      y: Math.max(0, Math.min(WH - H, p.y + p.h / 2 - H / 2)),
    };
  }
  function snapCamera() {
    const p = objs.find(o => o.alive && isPlayer(o));
    const t = p ? camTarget(p) : { x: 0, y: 0 };
    cam.x = WW > W ? t.x : 0; cam.y = WH > H ? t.y : 0;
  }
  function followCamera(dt) {
    if (WW <= W && WH <= H) return;
    const p = firstPlayer();
    if (!p) return;
    const t = camTarget(p), k = Math.min(1, dt * 9);
    if (WW > W) cam.x += (t.x - cam.x) * k;
    if (WH > H) cam.y += (t.y - cam.y) * k;
  }

  /* ---------- music ---------- */
  let song = null, songTried = false;
  function musicOn() {
    if (songTried) return;
    const id = assetId(S.music);
    if (!id || !SND[id]) return;
    songTried = true;
    try { song = new Audio(SND[id]); song.loop = true; song.volume = S.musicVolume; musicSync(); } catch (e) { song = null; }
  }
  let singing = false;
  function musicSync() {
    if (!song) return;
    const want = state === 'play' && !paused;
    if (want === singing) return;
    singing = want;
    try {
      if (want) { const p = song.play(); if (p && p.catch) p.catch(() => {}); }
      else song.pause();
    } catch (e) { /* no audio here */ }
  }

  function mover(o) {
    const b = o._b.moving;
    const px = o.x, py = o.y;
    const dist = Math.hypot(b.dx, b.dy);
    if (dist >= 1 && b.speed > 0) {
      const one = dist / b.speed;
      const ph = (clock % (2 * one)) / one;
      const t = ph <= 1 ? ph : 2 - ph;
      const e = t * t * (3 - 2 * t);
      o.x = o.sx + b.dx * e;
      o.y = o.sy + b.dy * e;
    }
    o._dx = o.x - px; o._dy = o.y - py;
  }

  /* ---------- outcomes ---------- */
  function say(text, secs) { flash = { text: String(text), t: secs || 1.6 }; }
  function destroy(o) { if (o) o.alive = false; }
  function hurt(p, sound, force) {
    if (state !== 'play') return;
    if (p && p.inv > 0 && !force) return;
    vars.lives -= 1;
    play(sound);
    emit('hurt', p, game);
    if (vars.lives <= 0) { vars.lives = 0; lose(); return; }
    if (p) { p.x = p.sx; p.y = p.sy; p.vx = 0; p.vy = 0; p.inv = 1.6; p.onGround = false; p.ground = null; p.fv = 0; }
  }
  function win() {
    if (state !== 'play') return;
    state = 'won';
    console.log('You win! Score: ' + vars.score);
    emit('win', game);
  }
  function lose() {
    if (state !== 'play') return;
    state = 'lost';
    console.log('Game over. Score: ' + vars.score);
    emit('lose', game);
  }

  function contacts() {
    for (const p of objs) {
      if (!p.alive || !isPlayer(p) || state !== 'play') continue;
      for (const o of objs) {
        if (o === p || !o.alive || !overlap(p, o, 0.5)) continue;
        if (o._b.collectible) {
          vars.score += o._b.collectible.points;
          play(o._b.collectible.sound);
          if (o._b.faller) reuse(o); else destroy(o);
          continue;
        }
        if (o._b.goal) {
          const left = objs.some(c => c.alive && c._b.collectible && !c._b.faller);
          if (!o._b.goal.needAll || !left) { if (o._b.goal.then === 'win') win(); else nextLevel(); }
          else if (!flash) say('Collect everything first!');
        }
        if (o._b.hazard && p.inv <= 0) {
          hurt(p, o._b.hazard.sound);
          if (o._b.faller) reuse(o);
          continue;
        }
        const e = enemyOf(o);
        if (e) {
          if (e.stomp && p._b.platformer && p.vy >= 0 && p.prevBottom <= o.y + 8) {
            destroy(o);
            vars.score += e.points;
            p.vy = -p._b.platformer.jump * 0.55;
          } else hurt(p);
        }
      }
    }
  }

  const VAR_OK = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/, BAD_VARS = ['__proto__', 'constructor', 'prototype', 'hasOwnProperty'];
  function runActions(actions, a, b) {
    for (const x of Array.isArray(actions) ? actions : []) {
      if (!x || state !== 'play') continue;
      switch (x.do) {
        case 'score': vars.score += num(x.n, 10); break;
        /* removed at the end of the frame, so every event and behaviour
           that saw this touch still gets to act on it */
        case 'destroyA': doomed.push(a); break;
        case 'destroyB': doomed.push(b); break;
        case 'loseLife': hurt(isPlayer(a) ? a : isPlayer(b) ? b : firstPlayer(), x.sound, true); break;
        case 'gainLife': vars.lives += Math.max(1, Math.round(num(x.n, 1))); break;
        case 'win': win(); break;
        case 'lose': lose(); break;
        case 'sound': play(x.sound); break;
        case 'say': say(fillText(x.text || ''), 2.2); break;
        case 'setVar': case 'addVar': {
          const k = String(x.name || '');
          if (!VAR_OK.test(k) || BAD_VARS.indexOf(k) >= 0) break;
          const n = num(x.n, 0);
          vars[k] = x.do === 'setVar' ? n : num(vars[k], 0) + n;
          break;
        }
        case 'spawn': {
          const at = x.at === 'a' ? a : x.at === 'spot' ? null : b;
          const t = at || templates[x.obj] || b || a;
          if (t) spawnCopy(x.obj, t.x + t.w / 2, t.y + t.h / 2, 0);
          break;
        }
        case 'teleport': {
          const who = isPlayer(a) ? a : isPlayer(b) ? b : a;
          const to = objs.find(t => t.alive && (t.id === x.obj || t.name === x.obj)) || templates[x.obj];
          if (who && to) { who.x = to.x + to.w / 2 - who.w / 2; who.y = to.y + to.h / 2 - who.h / 2; who.vx = 0; who.vy = 0; who.sx = who.x; who.sy = who.y; }
          break;
        }
        case 'nextLevel': nextLevel(); break;
        default: break;
      }
    }
  }

  /* an event can have a condition: only when a variable is (at least, …) a number */
  function passes(c) {
    if (!c || typeof c !== 'object' || !c.v) return true;
    const have = c.v === 'time' ? vars.time || 0 : num(vars[c.v], 0), want = num(c.n, 0);
    switch (c.op) {
      case '>': return have > want;
      case '<': return have < want;
      case '<=': return have <= want;
      case '=': return have === want;
      case '!=': return have !== want;
      default: return have >= want;
    }
  }
  function events() {
    const evs = Array.isArray(LV[level].events) ? LV[level].events : [];
    const now = new Set();
    evs.forEach((ev, i) => {
      if (!ev) return;
      const A = pick(ev.a), B = pick(ev.b);
      for (const a of A) for (const b of B) {
        if (a === b || !a.alive || !b.alive || !overlap(a, b, 0.5)) continue;
        const key = i + ':' + a.uid + ':' + b.uid;
        now.add(key);
        if (!prevTouch.has(key) && passes(ev.if)) runActions(ev.actions, a, b);
      }
    });
    prevTouch = now;
    if (!handlers.touch.length) return;
    const pairs = new Set(), live = objs.filter(o => o.alive);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (!overlap(a, b, 0.5)) continue;
      const key = a.uid + ':' + b.uid;
      pairs.add(key);
      if (!prevPairs.has(key)) emit('touch', a, b, game);
    }
    prevPairs = pairs;
  }

  function step(dt) {
    clock += dt;
    if (hintT > 0) hintT -= dt;
    if (flash && (flash.t -= dt) <= 0) flash = null;
    solids = objs.filter(o => o.alive && o.solid);
    for (const o of objs) if (o.alive && o._b.moving) mover(o);
    for (const o of objs) {
      if (!o.alive) continue;
      if (o.inv > 0) o.inv = Math.max(0, o.inv - dt);
      if (o._b.platformer) platformer(o, dt);
      else if (o._b.topdown) topdown(o, dt);
      if (o._b.shooter) shooter(o, dt);
    }
    for (const o of objs) {
      if (!o.alive) continue;
      if (o.bullet) { bullet(o, dt); continue; }
      if (o._b.spinner) o.rot += o._b.spinner.speed * dt;
      if (o._b.bobber) bobber(o);
      if (o._b.spawner) spawner(o, dt);
      if (o.pulse > 0) o.pulse = Math.max(0, o.pulse - dt);
      if (o._b.patrol) patrol(o, dt);
      else if (o._b.chase) chase(o, dt);
      if (o._b.faller) faller(o, dt);
    }
    for (const o of objs) if (o.alive && isPlayer(o)) unstick(o);
    /* events first: "when the player touches a coin" must still fire for the
       coin that the collectible behaviour removes a moment later */
    events();
    contacts();
    if (doomed.length) { for (const o of doomed) destroy(o); doomed = []; }
    if (state === 'play' && S.timer > 0) {
      vars.time = Math.max(0, vars.time - dt);
      if (vars.time <= 0) { if (S.timerEnds === 'win') win(); else lose(); }
    }
    if (state === 'play' && S.winScore > 0 && vars.score >= S.winScore) win();
    for (const o of objs) {
      if (!o.alive || !o.anim) continue;
      o.moving = Math.hypot(o.x - o.lx, o.y - o.ly) > 8 * dt;
      o.lx = o.x; o.ly = o.y;
      o.at += dt;
    }
    followCamera(dt);
    emit('update', dt, game);
    if (objs.some(o => !o.alive)) objs = objs.filter(o => o.alive);
  }

  /* ---------- drawing ---------- */
  const lum = c => {
    const m = String(c).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return 0;
    let hx = m[1];
    if (hx.length === 3) hx = hx.split('').map(ch => ch + ch).join('');
    const n = parseInt(hx, 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  const light = lum(S.background) > 0.6;
  /* reduced motion: the browser's setting, or StaticOS's own (Studio marks its preview) */
  let still = !!document.querySelector('meta[name="studio-reduce-motion"]');
  try { still = still || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old engine */ }
  const INK = light ? '#101018' : '#ffffff';
  const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const fmtTime = s => { s = Math.ceil(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fillText = t => String(t)
    .replace(/\{score\}/g, String(Math.round(vars.score)))
    .replace(/\{lives\}/g, String(vars.lives))
    .replace(/\{time\}/g, fmtTime(vars.time || 0))
    .replace(/\{level\}/g, String(level + 1))
    .replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) && BAD_VARS.indexOf(k) < 0 ? String(Math.round(num(vars[k], 0) * 100) / 100) : m));

  /* the frames of a sprite sheet: from Asset Lab's sheet data, or a grid of frame-sized cells */
  function framesOf(o, id, im) {
    const sh = SHEET[id], an = o.anim || {};
    if (sh && Array.isArray(sh.frames) && sh.frames.length) return sh.frames;
    const fw = num(an.fw || (sh && sh.fw), 0, 0), fh = num(an.fh || (sh && sh.fh), 0, 0);
    if (!fw || !fh || !im.naturalWidth) return null;
    const cols = Math.max(1, Math.floor(im.naturalWidth / fw)), rows = Math.max(1, Math.floor(im.naturalHeight / fh));
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c * fw, r * fh, fw, fh]);
    return out;
  }
  function clipOf(o, n) {
    const an = o.anim || {};
    const pick = (o.moving ? an.walk : an.idle) || an.idle;
    return pick && pick.length === 2 ? [Math.max(0, Math.min(n - 1, Math.round(pick[0]))), Math.max(0, Math.min(n - 1, Math.round(pick[1])))] : [0, n - 1];
  }
  function frameOf(o, id, im) {
    const fr = framesOf(o, id, im);
    if (!fr || !fr.length) return null;
    const an = o.anim || {}, sh = SHEET[id] || {};
    const c = clipOf(o, fr.length), key = c[0] + '-' + c[1];
    if (o.clip !== key) { o.clip = key; o.at = 0; }
    const fps = num(an.fps || sh.fps, 8, 0.5, 60);
    const len = Math.max(1, c[1] - c[0] + 1);
    const i = still ? 0 : Math.floor(o.at * fps) % len;
    return fr[Math.min(fr.length - 1, c[0] + i)];
  }

  function drawObj(o) {
    ctx.save();
    if (o.fixed) ctx.translate(cam.x, cam.y);
    if (o.pulse > 0 && !still) {
      const k = 1 + o.pulse * 0.5;
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2); ctx.scale(k, k); ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2));
    }
    if (o.rot) {
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2); ctx.rotate(o.rot * Math.PI / 180); ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2));
    }
    /* a hurt player blinks for a moment, or just fades when motion is reduced */
    if (o.inv > 0 && (still || Math.floor(o.inv * 10) % 2)) ctx.globalAlpha = still ? 0.5 : 0.35;
    const imId = o.sprite && assetId(o.sprite), im = imId && IMG[imId];
    if (o.text) {
      const t = fillText(o.text);
      let size = Math.max(6, o.h * 0.8);
      ctx.font = '600 ' + size + 'px ' + FONT;
      const tw = ctx.measureText(t).width;
      if (tw > o.w && tw > 0) { size = Math.max(6, size * o.w / tw); ctx.font = '600 ' + size + 'px ' + FONT; }
      ctx.fillStyle = o.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, o.x + o.w / 2, o.y + o.h / 2);
    } else if (im && im.complete && im.naturalWidth) {
      const fr = o.anim ? frameOf(o, imId, im) : null;
      if (o.face < 0 && (isPlayer(o) || enemyOf(o))) {
        ctx.translate(o.x + o.w, o.y);
        ctx.scale(-1, 1);
        if (fr) ctx.drawImage(im, fr[0], fr[1], fr[2], fr[3], 0, 0, o.w, o.h); else ctx.drawImage(im, 0, 0, o.w, o.h);
      } else if (fr) ctx.drawImage(im, fr[0], fr[1], fr[2], fr[3], o.x, o.y, o.w, o.h);
      else ctx.drawImage(im, o.x, o.y, o.w, o.h);
    } else {
      ctx.fillStyle = o.color;
      if (o.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(o.x, o.y, o.w, o.h);
    }
    ctx.restore();
  }

  function pill(text, x, y, align) {
    ctx.font = '600 14px ' + FONT;
    const w = ctx.measureText(text).width + 22;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.fillStyle = light ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.42)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, y, w, 28, 14); else ctx.rect(left, y, w, 28);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + w / 2, y + 14.5);
  }

  function hud() {
    if (!S.hud) return;
    pill('Score ' + Math.round(vars.score), 12, 10, 'left');
    const lives = vars.lives > 6 ? '♥ × ' + vars.lives : new Array(Math.max(0, vars.lives) + 1).join('♥ ').trim();
    if (lives) {
      ctx.font = '600 14px ' + FONT;
      pill(lives, W - 12, 10, 'right');
    }
    if (S.timer > 0) pill(fmtTime(vars.time), W / 2, 10, 'center');
    if (LV.length > 1) { ctx.font = '600 14px ' + FONT; pill('Level ' + (level + 1) + ' of ' + LV.length, 12, 44, 'left'); }
  }

  let touchOn = false;
  function controlsHint() {
    const ps = objs.filter(o => o.alive && isPlayer(o));
    if (!ps.length) return '';
    /* on a touch screen the keys are not there: talk about the buttons */
    if (touchOn) return ps.some(o => o._b.platformer) ? 'Hold ◀ ▶ to move  ·  ⬆ to jump' : 'Hold the arrow buttons to move';
    const shoot = objs.some(o => o.alive && o._b.shooter) ? '  ·  X shoot' : '';
    if (ps.some(o => o._b.platformer)) return '← → move  ·  ↑ or Space jump' + shoot + '  ·  P pause  ·  R restart';
    const ax = ps[0]._b.topdown.axis;
    if (ax === 'x') return '← → move' + shoot + '  ·  P pause  ·  R restart';
    if (ax === 'y') return '↑ ↓ move' + shoot + '  ·  P pause  ·  R restart';
    return 'Arrow keys or WASD move' + shoot + '  ·  P pause  ·  R restart';
  }

  function banner(title, sub, tint, img) {
    ctx.fillStyle = 'rgba(6,6,12,.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
        const im = img && IMG[assetId(img)];
    if (im && im.complete && im.naturalWidth) {
      const k = Math.min(1, (H * 0.34) / im.naturalHeight, (W * 0.6) / im.naturalWidth);
      const iw = im.naturalWidth * k, ih = im.naturalHeight * k;
      ctx.drawImage(im, W / 2 - iw / 2, H / 2 - 22 - 40 - ih, iw, ih);
    }
    ctx.fillStyle = tint;
    ctx.font = '800 ' + Math.round(Math.min(56, W / Math.max(9, String(title).length * 0.9))) + 'px ' + FONT;
    ctx.fillText(title, W / 2, H / 2 - 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 16px ' + FONT;
    ctx.fillText(sub, W / 2, H / 2 + 22);
  }

  function draw() {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.fillStyle = S.background;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(-Math.round(cam.x * scale * dpr) / (scale * dpr), -Math.round(cam.y * scale * dpr) / (scale * dpr));
    const list = objs.filter(o => o.alive && o.visible).sort((a, b) => a.layer - b.layer || a.order - b.order);
    for (const o of list) drawObj(o);
    emit('draw', ctx, game);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    hud();
    if (flash) pill(flash.text, W / 2, 48, 'center');
    if (state === 'play' && hintT > 0 && !paused) {
      const t = controlsHint();
      if (t) { ctx.globalAlpha = Math.min(1, hintT); pill(t, W / 2, H - 42, 'center'); ctx.globalAlpha = 1; }
    }
    if (paused && state === 'play') banner('Paused', 'Press P to carry on', '#ffffff');
    const again = touchOn ? 'tap to play again' : 'press R or tap to play again';
    const more = (t, d) => (t ? fillText(t) + '  ·  ' + again : d + '  ·  ' + again);
    if (state === 'won') banner(S.winTitle ? fillText(S.winTitle) : 'You win!', more(S.winText, 'Score ' + Math.round(vars.score)), S.winColor, S.winImage);
    if (state === 'lost') banner(S.loseTitle ? fillText(S.loseTitle) : 'Game over', more(S.loseText, 'Score ' + Math.round(vars.score)), S.loseColor, S.loseImage);
  }

  /* ---------- on-screen buttons for touch screens ---------- */
  function touchPad() {
    const hasPlat = objs.some(o => o._b.platformer);
    const top = objs.find(o => o._b.topdown);
    const vert = !!top && top._b.topdown.axis !== 'x';
    const horiz = hasPlat || !top || top._b.topdown.axis !== 'y';
    const pad = document.createElement('div');
    pad.id = 'studio-touch';
    const btn = (key, label, aria) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      const down = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {} press(key, true); b.classList.add('on'); };
      const up = () => { press(key, false); b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      return b;
    };
    const left = document.createElement('div');
    left.className = 'pad';
    if (horiz) { left.appendChild(btn('left', '◀', 'Left')); left.appendChild(btn('right', '▶', 'Right')); }
    const right = document.createElement('div');
    right.className = 'pad';
    if (vert) { right.appendChild(btn('up', '▲', 'Up')); right.appendChild(btn('down', '▼', 'Down')); }
    if (objs.some(o => o._b.shooter)) right.appendChild(btn('fire', '●', 'Fire'));
    if (hasPlat) right.appendChild(btn('jump', '⬆', 'Jump'));
    pad.appendChild(left);
    pad.appendChild(right);
    document.body.appendChild(pad);
    const show = () => { pad.classList.add('on'); touchOn = true; };
    let coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* old engine */ }
    if (coarse || navigator.maxTouchPoints > 0) show();
    window.addEventListener('touchstart', show, { once: true, passive: true });
  }

  /* ---------- the public API for game code ---------- */
  const game = {
    get width() { return W; },
    get height() { return H; },
    get world() { return { width: WW, height: WH }; },
    get camera() { return cam; },
    get level() { return level + 1; },
    get levels() { return LV.length; },
    nextLevel,
    settings: S,
    scene: scene,
    get vars() { return vars; },
    keys: held,
    pressed: k => !!hit[k],
    get objects() { return objs.filter(o => o.alive); },
    get player() { return firstPlayer(); },
    get state() { return state; },
    get time() { return clock; },
    find: ref => pick(ref)[0] || null,
    findAll: ref => pick(ref),
    spawn(props) {
      const o = makeObj(Object.assign({ id: 'spawn' + (seq + 1) }, props || {}));
      o.order = objs.length ? objs[objs.length - 1].order + 1 : 0;
      objs.push(o);
      return o;
    },
    destroy,
    clone(ref, x, y) { return spawnCopy(ref, num(x, 0), num(y, 0), 0); },
    touching: (a, b) => !!(a && b && a.alive && b.alive && overlap(a, b, 0.5)),
    behaviour: (o, type) => (o && o._b && o._b[type]) || null,
    addScore(n) { vars.score += num(n, 0); },
    loseLife(p) { hurt(p || firstPlayer(), '', true); },
    win, lose, restart, play, say,
    image(ref) { const id = assetId(ref); return (id && IMG[id]) || null; },
    on(evt, fn) {
      if (!handlers[evt]) throw new Error('game.on: there is no "' + evt + '" event. Use one of: ' + Object.keys(handlers).join(', '));
      if (typeof fn !== 'function') throw new Error('game.on("' + evt + '", …) needs a function');
      handlers[evt].push({ fn, off: false });
      return game;
    },
  };
  window.game = game;

  /* ---------- the loop ---------- */
  let last = 0, musicKey = '';
  function frame(now) {
    const dt = last ? Math.min(0.034, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    try {
      if (state === 'play' && !paused) step(dt);
      draw();
      const mk = state + paused;
      if (mk !== musicKey) { musicKey = mk; musicSync(); }
    } catch (err) {
      if (!frame.failed) console.error('The game stopped: ' + ((err && err.message) || err) + where(err));
      frame.failed = true;
      return;
    }
    hit = {};
    requestAnimationFrame(frame);
  }
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    reset();
    touchPad();
    try { window.focus(); } catch (e) { /* fine */ }
    requestAnimationFrame(frame);
  }
  /* game code comes after this script, so start once the page is parsed */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
}

/* the engine as it goes into a game file */
export const RUNTIME_JS = `/* Static Studio engine v${RUNTIME_VERSION}. Studio writes this block when you Build —
   put your own code in the "game-code" script below instead of here. */
(${studioEngine.toString()})(${JSON.stringify(DEFAULTS)});`;

export const RUNTIME_CSS = [
  'html,body{margin:0;height:100%;background:#07080c;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}',
  'body{display:flex;align-items:center;justify-content:center}',
  '#game{display:block;outline:none}',
  '#studio-touch{position:fixed;left:0;right:0;bottom:0;display:none;justify-content:space-between;align-items:flex-end;padding:14px;pointer-events:none}',
  '#studio-touch.on{display:flex}',
  '#studio-touch .pad{display:flex;gap:10px;pointer-events:auto}',
  '#studio-touch button{width:60px;height:60px;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:rgba(18,18,26,.5);color:#fff;font:600 20px system-ui,sans-serif;touch-action:none}',
  '#studio-touch button.on{background:rgba(255,255,255,.34)}',
].join('\n');

export const DEFAULT_CODE = `// Your code. It runs with the game, and Studio keeps it when you Build.
// The scene hands you \`game\`:
//   game.on('start', () => { ... })          when the game (re)starts
//   game.on('update', dt => { ... })          every frame (dt = seconds)
//   game.on('touch', (a, b) => { ... })       when two objects start touching
//   game.on('draw', ctx => { ... })           draw extra things on top
//   game.find('Player')  game.findAll('group:coin')  game.player
//   game.vars.score  game.vars.lives  game.vars.time
//   game.keys.left / right / up / down / jump   game.pressed('jump')
//   game.addScore(5)  game.loseLife()  game.win()  game.lose()
//   game.play('sound name')  game.say('Hello!')  game.spawn({ x, y, w, h, color })
// console.log() shows up in Studio's Console.
`;

/* ====================================================================
   The scene file format
   ==================================================================== */
export const newId = (p = 'o') => `${p}-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;

/* "Coin 3" → "coin" — the group a new object joins by default */
export const groupOf = name => String(name || '').toLowerCase().replace(/\s*\d+$/, '').trim().replace(/[^a-z0-9 _-]/g, '').slice(0, 32) || 'object';

const json = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const OBJ_ORDER = ['id', 'name', 'group', 'x', 'y', 'w', 'h', 'color', 'shape', 'sprite', 'anim', 'text', 'solid', 'visible', 'layer', 'locked', 'fixed', 'spawnOnly', 'tiles', 'behaviours'];
const ordered = (o, keys) => {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in out)) out[k] = o[k];
  return out;
};

/* what an object is when a field is left out (validateScene fills these in) */
const OBJ_DEFAULTS = { shape: 'rect', sprite: null, text: '', solid: false, visible: true, layer: 0, locked: false };
/* a behaviour setting that only repeats its default is left out too */
const compactBeh = b => {
  const d = b && DEFAULTS[b.type];
  if (!d) return b;
  const out = {};
  for (const k of Object.keys(b)) if (k === 'type' || !(k in d) || b[k] !== d[k]) out[k] = b[k];
  return out;
};
const compactObj = o => {
  const out = {};
  for (const k of Object.keys(o)) {
    if (k in OBJ_DEFAULTS && o[k] === OBJ_DEFAULTS[k]) continue;
    if (k === 'behaviours' && Array.isArray(o[k])) { if (o[k].length) out[k] = o[k].map(compactBeh); continue; }
    out[k] = o[k];
  }
  return out;
};

/**
 * Pretty, diff-friendly JSON: one line per object and per event.
 * compact: leave out fields that only repeat the defaults (same line
 * layout, less to read — used for what the assistant is sent).
 */
export function formatScene(scene, { compact = false } = {}) {
  const s = scene || {};
  const lines = ['{'];
  const top = [];
  top.push(`  "v": ${json(s.v || RUNTIME_VERSION)}`);
  top.push(`  "title": ${json(String(s.title || 'Untitled game'))}`);
  top.push(`  "settings": ${json(ordered(s.settings || {}, Object.keys(SETTINGS)))}`);
  const objs = Array.isArray(s.objects) ? s.objects : [];
  top.push(objs.length
    ? `  "objects": [\n${objs.map(o => '    ' + json(ordered(compact ? compactObj(o) : o, OBJ_ORDER))).join(',\n')}\n  ]`
    : '  "objects": []');
  const evs = Array.isArray(s.events) ? s.events : [];
  top.push(evs.length
    ? `  "events": [\n${evs.map(e => '    ' + json(e)).join(',\n')}\n  ]`
    : '  "events": []');
  const lvs = Array.isArray(s.levels) ? s.levels : [];
  if (lvs.length) {
    top.push(`  "levels": [\n${lvs.map(l => '    {' + `"id": ${json(l.id || "")}, "name": ${json(l.name || "")},\n     "objects": [\n${(l.objects || []).map(o => '      ' + json(ordered(compact ? compactObj(o) : o, OBJ_ORDER))).join(',\n')}\n     ],\n     "events": [${(l.events || []).map(e => '\n      ' + json(e)).join(',')}${(l.events || []).length ? '\n     ' : ''}]}`).join(',\n')}\n  ]`);
  }
  for (const k of Object.keys(s)) {
    if (['v', 'title', 'settings', 'objects', 'events', 'levels'].includes(k)) continue;
    top.push(`  ${json(k)}: ${json(s[k])}`);
  }
  lines.push(top.join(',\n'));
  lines.push('}');
  return lines.join('\n');
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Check a scene (from the editor, a hand edit or the assistant) and return a
 * clean copy. errors = it cannot be used; warnings = it was repaired.
 */
export function validateScene(raw) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { scene: null, errors: ['The scene must be a JSON object ({ … }).'], warnings };
  }
  const s = { ...raw };
  s.v = RUNTIME_VERSION;
  s.title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.slice(0, 80) : 'Untitled game';

  const st = { ...SETTINGS, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) };
  const setNum = (k, lo, hi, int) => {
    let v = Number(st[k]);
    if (!Number.isFinite(v)) { errors.push(`settings.${k} must be a number.`); v = SETTINGS[k]; }
    if (v < lo || v > hi) { warnings.push(`settings.${k} was ${v}; kept between ${lo} and ${hi}.`); v = Math.min(hi, Math.max(lo, v)); }
    st[k] = int ? Math.round(v) : v;
  };
  setNum('width', 120, 2400, true);
  setNum('height', 120, 2400, true);
  setNum('gravity', -6000, 6000);
  setNum('lives', 1, 99, true);
  setNum('score', -1e6, 1e6);
  setNum('timer', 0, 86400);
  setNum('winScore', 0, 1e9);
  /* settings added in v2 are only checked (and kept) when they are there */
  for (const [k, lo, hi] of [['worldWidth', 120, 20000], ['worldHeight', 120, 20000]]) {
    if (st[k] === undefined || st[k] === null || st[k] === '' || st[k] === 0) { delete st[k]; continue; }
    const v = Number(st[k]);
    if (!Number.isFinite(v)) { errors.push(`settings.${k} must be a number.`); delete st[k]; continue; }
    st[k] = Math.round(Math.min(hi, Math.max(lo, v)));
    if (k === 'worldWidth' && st[k] <= st.width) delete st[k];
    if (k === 'worldHeight' && st[k] <= st.height) delete st[k];
  }
  for (const k of ['music', 'winImage', 'loseImage']) { if (typeof st[k] === 'string' && st[k]) st[k] = st[k].slice(0, 80); else delete st[k]; }
  if (st.musicVolume !== undefined) { const v = Number(st.musicVolume); if (Number.isFinite(v)) st.musicVolume = Math.min(1, Math.max(0, v)); else delete st.musicVolume; }
  if (st.vars !== undefined) {
    const v = st.vars, out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v).slice(0, 16)) {
        if (!VAR_RE.test(k) || BAD_VARS.includes(k) || ['score', 'lives', 'time'].includes(k)) { warnings.push(`Variable "${k}" is not a usable name; left out.`); continue; }
        const n = Number(v[k]);
        out[k] = Number.isFinite(n) ? n : 0;
      }
    }
    if (Object.keys(out).length) st.vars = out; else delete st.vars;
  }
  for (const k of ['winTitle', 'loseTitle']) { if (typeof st[k] === 'string' && st[k]) st[k] = st[k].slice(0, 80); else delete st[k]; }
  for (const k of ['winText', 'loseText']) { if (typeof st[k] === 'string' && st[k]) st[k] = st[k].slice(0, 200); else delete st[k]; }
  for (const k of ['winColor', 'loseColor']) { if (typeof st[k] === 'string' && st[k]) st[k] = st[k].slice(0, 32); else delete st[k]; }
  if (typeof st.background !== 'string' || !st.background.trim()) { warnings.push('settings.background was missing; set to the default.'); st.background = SETTINGS.background; }
  st.timerEnds = st.timerEnds === 'win' ? 'win' : 'lose';
  st.hud = st.hud !== false;
  s.settings = st;

  function cleanLevel(rawObjects, rawEvents, tag) {
  if (rawObjects !== undefined && !Array.isArray(rawObjects)) errors.push(`${tag}"objects" must be a list ([ … ]).`);
  const seen = new Set();
  const objects = (Array.isArray(rawObjects) ? rawObjects : []).map((o, i) => {
    const label = o && typeof o.name === 'string' && o.name ? `"${o.name}"` : `#${i + 1}`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) { errors.push(`Object ${label} is not an object.`); return null; }
    const out = { ...o };
    if (typeof out.id !== 'string' || !out.id) { out.id = newId('o'); warnings.push(`Object ${label} had no id; gave it one.`); }
    if (seen.has(out.id)) { errors.push(`Two objects share the id "${out.id}". Ids must be unique.`); }
    seen.add(out.id);
    out.name = typeof out.name === 'string' && out.name.trim() ? out.name.slice(0, 60) : `Object ${i + 1}`;
    out.group = typeof out.group === 'string' && out.group.trim() ? out.group.toLowerCase().slice(0, 32) : groupOf(out.name);
    for (const k of ['x', 'y', 'w', 'h']) {
      const v = Number(out[k]);
      if (!Number.isFinite(v)) errors.push(`Object ${label}: "${k}" must be a number.`);
      else out[k] = Math.round(v * 100) / 100;
    }
    if (isNum(out.w) && out.w < 1) errors.push(`Object ${label}: "w" must be at least 1.`);
    if (isNum(out.h) && out.h < 1) errors.push(`Object ${label}: "h" must be at least 1.`);
    if (typeof out.color !== 'string' || !out.color) out.color = '#8b93a7';
    out.shape = out.shape === 'ellipse' ? 'ellipse' : 'rect';
    out.sprite = typeof out.sprite === 'string' && out.sprite ? out.sprite : null;
    out.text = typeof out.text === 'string' ? out.text.slice(0, 200) : '';
    out.solid = !!out.solid;
    out.visible = out.visible !== false;
    out.layer = Number.isFinite(Number(out.layer)) ? Math.round(Number(out.layer)) : 0;
    /* locked is Studio's alone (the stage will not pick, move, resize or
       delete it); the engine never reads it. Only true is written down. */
    if (out.locked === true || out.locked === 'true') out.locked = true; else delete out.locked;
    /* v2 fields: only written when they are on */
    for (const k of ['fixed', 'spawnOnly']) { if (out[k] === true || out[k] === 'true') out[k] = true; else delete out[k]; }
    if (out.tiles !== undefined) {
      const t = out.tiles;
      if (!t || typeof t !== 'object' || !Array.isArray(t.rows)) { errors.push(`Object ${label}: "tiles" needs a list of rows.`); delete out.tiles; }
      else out.tiles = { size: Math.min(256, Math.max(4, Math.round(Number(t.size)) || 32)), rows: t.rows.slice(0, 400).map(r => String(r).slice(0, 400).replace(/[^#.]/g, '.')) };
    }
    if (out.anim !== undefined) {
      const an = out.anim, c = {};
      if (an && typeof an === 'object' && !Array.isArray(an)) {
        for (const k of ['fw', 'fh']) { const v = Math.round(Number(an[k])); if (v >= 1 && v <= 4096) c[k] = v; }
        const fps = Number(an.fps); if (Number.isFinite(fps) && fps > 0) c.fps = Math.min(60, Math.max(0.5, fps));
        for (const k of ['idle', 'walk']) {
          if (Array.isArray(an[k]) && an[k].length === 2) { const a0 = Math.round(Number(an[k][0])), a1 = Math.round(Number(an[k][1])); if (a0 >= 0 && a1 >= a0 && a1 < 4096) c[k] = [a0, a1]; }
        }
      }
      if (Object.keys(c).length) out.anim = c; else delete out.anim;
    }
    if (out.behaviours !== undefined && !Array.isArray(out.behaviours)) errors.push(`Object ${label}: "behaviours" must be a list.`);
    const types = new Set();
    out.behaviours = (Array.isArray(out.behaviours) ? out.behaviours : []).map(b => {
      const def = b && behaviourDef(b.type);
      if (!def) {
        errors.push(`Object ${label} has an unknown behaviour "${b && b.type}". Known: ${BEHAVIOURS.map(x => x.type).join(', ')}.`);
        return null;
      }
      if (types.has(b.type)) { warnings.push(`Object ${label} had "${b.type}" twice; kept one.`); return null; }
      types.add(b.type);
      const inst = { type: b.type };
      for (const p of def.params) {
        let v = b[p.k] === undefined ? p.def : b[p.k];
        if (p.kind === 'num') {
          v = Number(v);
          if (!Number.isFinite(v)) { errors.push(`Object ${label}: ${b.type}.${p.k} must be a number.`); v = p.def; }
          v = Math.min(p.max, Math.max(p.min, v));
        } else if (p.kind === 'bool') v = v === true || v === 'true';
        else if (p.kind === 'select') v = p.options.some(([val]) => val === v) ? v : p.def;
        else v = typeof v === 'string' ? v : '';
        inst[p.k] = v;
      }
      return inst;
    }).filter(Boolean);
    if (types.has('platformer') && types.has('topdown')) errors.push(`Object ${label} cannot be a platformer and a top-down player at once.`);
    return out;
  }).filter(Boolean);

  const ids = new Set(objects.map(o => o.id));
  if (rawEvents !== undefined && !Array.isArray(rawEvents)) errors.push(`${tag}"events" must be a list ([ … ]).`);
  const events = (Array.isArray(rawEvents) ? rawEvents : []).map((e, i) => {
    if (!e || typeof e !== 'object') { errors.push(`Event #${i + 1} is not an object.`); return null; }
    const out = { ...e, id: typeof e.id === 'string' && e.id ? e.id : newId('e') };
    for (const side of ['a', 'b']) {
      const ref = String(e[side] || '');
      if (ref === 'player' || ref === 'any' || /^group:.+/.test(ref)) continue;
      if (/^id:/.test(ref)) {
        if (!ids.has(ref.slice(3))) errors.push(`Event #${i + 1}: "${side}" points at an object that is not in the scene (${ref}).`);
        continue;
      }
      errors.push(`Event #${i + 1}: "${side}" must be "player", "any", "group:<name>" or "id:<object id>".`);
    }
    if (e.if !== undefined) {
      const c = e.if;
      if (c && typeof c === 'object' && typeof c.v === 'string' && c.v.trim()) {
        out.if = { v: c.v.trim().slice(0, 24), op: IF_OPS.some(o => o[0] === c.op) ? c.op : '>=', n: Number.isFinite(Number(c.n)) ? Number(c.n) : 0 };
      } else delete out.if;
    }
    if (!Array.isArray(e.actions)) { errors.push(`Event #${i + 1}: "actions" must be a list.`); out.actions = []; }
    else out.actions = e.actions.map(a => {
      const def = a && actionDef(a.do);
      if (!def) { errors.push(`Event #${i + 1} has an unknown action "${a && a.do}". Known: ${ACTIONS.map(x => x.do).join(', ')}.`); return null; }
      const x = { do: a.do };
      if (def.n) x.n = Number.isFinite(Number(a.n)) ? Number(a.n) : def.def;
      if (def.sound || a.sound) x.sound = typeof a.sound === 'string' ? a.sound : '';
      if (def.text) x.text = typeof a.text === 'string' ? a.text.slice(0, 200) : '';
      if (def.varName) {
        x.name = typeof a.name === 'string' ? a.name.trim().slice(0, 24) : '';
        if (x.name && (!VAR_RE.test(x.name) || BAD_VARS.includes(x.name))) { warnings.push(`Event #${i + 1}: "${x.name}" is not a usable variable name; cleared.`); x.name = ''; }
      }
      if (def.obj) x.obj = typeof a.obj === 'string' ? a.obj : '';
      if (def.at) x.at = ['a', 'b', 'spot'].includes(a.at) ? a.at : 'b';
      return x;
    }).filter(Boolean);
    return out;
  }).filter(Boolean);
  return { objects, events };
  }

  const lvl1 = cleanLevel(raw.objects, raw.events, '');
  s.objects = lvl1.objects;
  s.events = lvl1.events;
  delete s._at;
  if (raw.levels !== undefined && !Array.isArray(raw.levels)) { errors.push('"levels" must be a list ([ … ]).'); delete s.levels; }
  else if (Array.isArray(raw.levels) && raw.levels.length) {
    s.levels = raw.levels.slice(0, 30).map((l, i) => {
      if (!l || typeof l !== 'object' || Array.isArray(l)) { errors.push(`Level ${i + 2} is not an object.`); return null; }
      const c = cleanLevel(l.objects, l.events, `Level ${i + 2}: `);
      return { id: typeof l.id === 'string' && l.id ? l.id : newId('l'), name: typeof l.name === 'string' ? l.name.slice(0, 40) : '', objects: c.objects, events: c.events };
    }).filter(Boolean);
  } else delete s.levels;

  return { scene: errors.length ? null : s, errors, warnings };
}

/* ---------- the HTML document ---------- */
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const blockRe = id => new RegExp(`(<script\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>)([\\s\\S]*?)(<\\/script\\s*>)`, 'i');
const safeCode = code => String(code).replace(/<\/script/gi, '<\\/script');

/** assets: the project's [{id,name,kind,dataUrl}] → the embedded map */
export function assetsJSON(assets) {
  const map = {};
  for (const a of Array.isArray(assets) ? assets : []) {
    if (a && a.id && a.dataUrl) {
      map[a.id] = { name: a.name || a.id, kind: a.kind === 'audio' ? 'audio' : 'image', src: a.dataUrl };
      if (a.kind !== 'audio' && a.sheet && typeof a.sheet === 'object') map[a.id].sheet = a.sheet;
    }
  }
  const keys = Object.keys(map);
  if (!keys.length) return '{}';
  return '{\n' + keys.map(k => `  ${json(k)}: ${json(map[k])}`).join(',\n') + '\n}';
}

/** A whole new standalone game document. */
export function buildDoc(scene, { assets = [], code = DEFAULT_CODE } = {}) {
  const title = escHtml(scene?.title || 'Untitled game');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="generator" content="Static Studio ${RUNTIME_VERSION}">
<title>${title}</title>
<style id="studio-style">
${RUNTIME_CSS}
</style>
</head>
<body>
<canvas id="game" aria-label="${title}"></canvas>
<script type="application/json" id="scene">
${formatScene(scene)}
</script>
<script type="application/json" id="studio-assets">
${assetsJSON(assets)}
</script>
<script id="studio-runtime">
${RUNTIME_JS}
</script>
<script id="game-code">
${safeCode(String(code || '').replace(/\n+$/, ''))}
</script>
</body>
</html>
`;
}

/**
 * Where JSON text first goes wrong, as a character offset (-1 when it is
 * fine). A plain recursive-descent reader: JSON.parse knows, but not every
 * browser says where.
 */
export function jsonErrorAt(text) {
  const s = String(text);
  const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let i = 0;
  const ws = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t')) i++; };
  const fail = () => { throw { at: i }; };
  function str() {
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') { i++; return; }
      if (c === '\\') { i += 2; continue; }
      if (c < ' ') fail();
      i++;
    }
    fail();
  }
  function value(depth) {
    if (depth > 200) fail();
    ws();
    const c = s[i];
    if (c === '{') {
      i++; ws();
      if (s[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail();
        str(); ws();
        if (s[i] !== ':') fail();
        i++;
        value(depth + 1); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return; }
        fail();
      }
    }
    if (c === '[') {
      i++; ws();
      if (s[i] === ']') { i++; return; }
      for (;;) {
        value(depth + 1); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return; }
        fail();
      }
    }
    if (c === '"') { str(); return; }
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (m && m[0].length && m[0] !== '-') { i += m[0].length; return; }
    for (const w of ['true', 'false', 'null']) if (s.startsWith(w, i)) { i += w.length; return; }
    fail();
  }
  try { value(0); ws(); if (i < s.length) fail(); return -1; }
  catch (e) { return e && typeof e.at === 'number' ? Math.min(e.at, s.length) : 0; }
}

/** Where a character offset falls, as a 1-based line number. */
export const lineAt = (text, offset) => {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};

/**
 * Read a document. Works on any HTML: a Forge game simply has no scene.
 * -> { isScene, scene (validated) | null, errors[], warnings[], code, runtime: 'ok'|'modified'|'missing', sceneLine }
 */
export function readDoc(html) {
  const src = String(html || '');
  const out = { isScene: false, scene: null, raw: null, errors: [], warnings: [], code: null, runtime: 'missing', sceneLine: 0, codeLine: 0, runtimeLine: 0 };
  const m = src.match(blockRe('scene'));
  if (!m) return out;
  out.isScene = true;
  const start = m.index + m[1].length;
  out.sceneLine = lineAt(src, start);
  const c = src.match(blockRe('game-code'));
  if (c) { out.code = c[2].replace(/^\n/, '').replace(/\n$/, ''); out.codeLine = lineAt(src, c.index + c[1].length); }
  const r = src.match(blockRe('studio-runtime'));
  if (r) {
    /* 'older': the untouched engine of an earlier Studio (known by its fingerprint).
       Build swaps it for this one without asking; anything else that differs was edited by hand. */
    const text = r[2].trim();
    out.runtime = text === RUNTIME_JS.trim() ? 'ok' : OLD_ENGINES.includes(fingerprint(text)) ? 'older' : 'modified';
    out.runtimeLine = lineAt(src, r.index + r[1].length);
  }
  let raw = null;
  try { raw = JSON.parse(m[2]); }
  catch (err) {
    /* browsers word (and place) JSON errors differently, so find the spot ourselves */
    const pos = jsonErrorAt(m[2]);
    const line = lineAt(src, start + Math.max(0, pos));
    const ch = pos >= 0 && pos < m[2].length ? m[2][pos] : '';
    const NAMES = { '"': 'quote mark', ',': 'comma', ':': 'colon', "'": 'single quote (JSON needs double quotes)' };
    const what = !ch ? 'it ends too early' : `unexpected ${/\s/.test(ch) ? 'space' : NAMES[ch] || `“${ch}”`}`;
    out.errors.push(`The scene data is not valid JSON: ${what} on line ${line}. Look for a missing quote, comma or bracket just before it.`);
    out.errorLine = line;
    return out;
  }
  out.raw = raw;
  const v = validateScene(raw);
  out.scene = v.scene;
  out.errors.push(...v.errors);
  out.warnings.push(...v.warnings);
  return out;
}

const fingerprint = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
/* fingerprints of the engines earlier versions of Studio wrote (v1) */
const OLD_ENGINES = ['46397f5b'];

/** Replace the body of one <script id=…> block. Returns null when it is not there. */
export function setBlock(html, id, body) {
  const re = blockRe(id);
  if (!re.test(html)) return null;
  return html.replace(re, (all, open, _old, close) => `${open}\n${body}\n${close}`);
}

/**
 * Write a scene into an existing document, keeping everything else the maker
 * wrote (their game code, extra markup). A document without the Studio
 * blocks is rebuilt from scratch. `engine: false` keeps a hand-edited engine.
 */
export function writeScene(html, scene, { assets = [], engine = true } = {}) {
  const read = readDoc(html);
  const code = read.code ?? DEFAULT_CODE;
  let out = String(html || '');
  const parts = ['scene', 'studio-assets', 'studio-runtime', 'game-code'];
  if (!read.isScene || parts.some(p => !blockRe(p).test(out))) return buildDoc(scene, { assets, code });
  out = setBlock(out, 'scene', formatScene(scene));
  out = setBlock(out, 'studio-assets', assetsJSON(assets));
  if (engine) out = setBlock(out, 'studio-runtime', RUNTIME_JS);
  const title = escHtml(scene.title || 'Untitled game');
  out = out.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`);
  out = out.replace(/(<canvas\b[^>]*\bid=["']game["'][^>]*\baria-label=")[^"]*(")/i, (all, a, b) => `${a}${title}${b}`);
  return out;
}

export default {
  RUNTIME_VERSION, BEHAVIOURS, ACTIONS, SETTINGS, RUNTIME_JS, RUNTIME_CSS, DEFAULT_CODE,
  behaviourDef, actionDef, newId, groupOf, formatScene, validateScene, assetsJSON,
  buildDoc, readDoc, setBlock, writeScene, lineAt, jsonErrorAt,
};
