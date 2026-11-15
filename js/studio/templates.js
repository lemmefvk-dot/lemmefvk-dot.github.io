/* ============================================================
   studio/templates.js — scenes to start a Studio project from.

   Each template is a function so every new project gets fresh
   object ids. They are small on purpose: a handful of objects a
   beginner can click through and understand, each one showing off
   a few behaviours, and every one playable the moment it opens.

   TEMPLATES: [{ id, name, icon, desc, scene() }]
   template(id), sceneFor(id)
   ============================================================ */
import { newId, SETTINGS } from './runtime.js';

const obj = (name, group, x, y, w, h, color, extra = {}) => ({
  id: newId('o'), name, group, x, y, w, h, color,
  shape: 'rect', sprite: null, text: '', solid: false, visible: true, layer: 0, behaviours: [],
  ...extra,
});
const block = (name, x, y, w, h, color) => obj(name, 'ground', x, y, w, h, color, { solid: true });
const label = (text, x, y, w, h, color) => obj('Title text', 'text', x, y, w, h, color, { text, layer: -1 });

function blank() {
  return {
    v: 1,
    title: 'My game',
    settings: { ...SETTINGS, background: '#151a2b', gravity: 1500 },
    objects: [
      block('Ground', 0, 410, 800, 40, '#34405e'),
    ],
    events: [],
  };
}

function platformer() {
  const coin = (n, x, y) => obj(`Coin ${n}`, 'coin', x, y, 18, 18, '#fcd34d', {
    shape: 'ellipse', behaviours: [{ type: 'collectible', points: 10, sound: '' }],
  });
  const spikes = (n, x) => obj(`Spikes ${n}`, 'spikes', x, 398, 38, 12, '#f87171', {
    behaviours: [{ type: 'hazard', sound: '' }],
  });
  const walker = (n, x, y, distance) => obj(`Walker ${n}`, 'walker', x, y, 28, 28, '#a78bfa', {
    shape: 'ellipse',
    behaviours: [{ type: 'patrol', speed: 70, distance, axis: 'x', stomp: true, points: 5 }],
  });
  return {
    v: 1,
    title: 'Coin Run',
    settings: { ...SETTINGS, background: '#1b2142', gravity: 1500, lives: 3 },
    objects: [
      label('Grab every coin, then touch the flag', 200, 62, 400, 20, '#aab4e8'),
      block('Ground', 0, 410, 800, 40, '#3b4a6e'),
      block('Ledge 1', 110, 330, 150, 16, '#5b6b94'),
      block('Ledge 2', 320, 255, 130, 16, '#5b6b94'),
      obj('Lift', 'platform', 480, 255, 90, 16, '#7dd3fc', {
        solid: true, behaviours: [{ type: 'moving', dx: 110, dy: 0, speed: 55 }],
      }),
      block('Ledge 3', 640, 180, 150, 16, '#5b6b94'),
      coin(1, 60, 380), coin(2, 420, 380), coin(3, 176, 294),
      coin(4, 376, 218), coin(5, 560, 206), coin(6, 684, 146),
      spikes(1, 280), spikes(2, 560),
      walker(1, 600, 382, 150),
      walker(2, 150, 302, 80),
      obj('Flag', 'goal', 748, 132, 24, 48, '#4ade80', {
        behaviours: [{ type: 'goal', needAll: true }],
      }),
      obj('Player', 'player', 30, 370, 26, 34, '#ff5c7c', {
        layer: 1, behaviours: [{ type: 'platformer', speed: 240, jump: 560, airJumps: 0 }],
      }),
    ],
    events: [],
  };
}

function topdown() {
  const wall = (name, x, y, w, h) => obj(name, 'wall', x, y, w, h, '#2f5d3f', { solid: true });
  const gem = (n, x, y) => obj(`Gem ${n}`, 'gem', x, y, 16, 16, '#67e8f9', {
    shape: 'ellipse', behaviours: [{ type: 'collectible', points: 10, sound: '' }],
  });
  const chaser = (n, x, y) => obj(`Beetle ${n}`, 'beetle', x, y, 24, 24, '#fb923c', {
    shape: 'ellipse', behaviours: [{ type: 'chase', speed: 68, range: 230, axis: 'both', stomp: false, points: 0 }],
  });
  const heart = obj('Heart', 'heart', 392, 214, 16, 16, '#fb7185', { shape: 'ellipse' });
  return {
    v: 1,
    title: 'Gem Garden',
    settings: { ...SETTINGS, background: '#123022', gravity: 0, lives: 3, timer: 60, timerEnds: 'lose', winScore: 80 },
    objects: [
      wall('Wall top', 0, 0, 800, 16), wall('Wall bottom', 0, 434, 800, 16),
      wall('Wall left', 0, 0, 16, 450), wall('Wall right', 784, 0, 16, 450),
      wall('Hedge 1', 180, 110, 22, 170), wall('Hedge 2', 600, 170, 22, 170),
      wall('Hedge 3', 300, 330, 200, 22), wall('Hedge 4', 300, 96, 200, 22),
      label('Collect 8 gems before time runs out', 220, 58, 360, 18, '#a7f3d0'),
      gem(1, 80, 80), gem(2, 700, 70), gem(3, 90, 380), gem(4, 700, 390),
      gem(5, 250, 200), gem(6, 540, 250), gem(7, 400, 150), gem(8, 400, 380),
      heart,
      chaser(1, 690, 200), chaser(2, 110, 250),
      obj('Player', 'player', 380, 250, 24, 24, '#fde68a', {
        layer: 1, behaviours: [{ type: 'topdown', speed: 210, axis: 'both' }],
      }),
    ],
    events: [
      { id: newId('e'), a: 'player', b: 'group:heart', actions: [{ do: 'gainLife', n: 1 }, { do: 'destroyB' }] },
    ],
  };
}

function dodge() {
  const rock = (n, x, y, speed) => obj(`Meteor ${n}`, 'meteor', x, y, 30, 30, '#a8a29e', {
    shape: 'ellipse',
    behaviours: [{ type: 'faller', speed, speedUp: 5 }, { type: 'hazard', sound: '' }],
  });
  const star = (n, x, y) => obj(`Star ${n}`, 'star', x, y, 18, 18, '#fde047', {
    shape: 'ellipse',
    behaviours: [{ type: 'faller', speed: 130, speedUp: 2 }, { type: 'collectible', points: 5, sound: '' }],
  });
  return {
    v: 1,
    title: 'Meteor Dodge',
    settings: { ...SETTINGS, background: '#0e0b22', gravity: 0, lives: 3, timer: 30, timerEnds: 'win' },
    objects: [
      label('Survive 30 seconds! Stars are bonus points.', 200, 58, 400, 18, '#c4b5fd'),
      block('Ground', 0, 420, 800, 30, '#2a2350'),
      rock(1, 90, 90, 170), rock(2, 250, 20, 200), rock(3, 410, 130, 160),
      rock(4, 560, 40, 210), rock(5, 700, 110, 180), rock(6, 330, 190, 190),
      star(1, 150, 170), star(2, 620, 200),
      obj('Player', 'player', 386, 382, 28, 36, '#38bdf8', {
        layer: 1, behaviours: [{ type: 'topdown', speed: 320, axis: 'x' }],
      }),
    ],
    events: [],
  };
}

/* ---- v2 templates: they use the shooter, spawner, tilemap, key/door events and custom screens ---- */
const spawnTpl = (name, group, w, h, color, extra = {}) => obj(name, group, -200, -200, w, h, color, { spawnOnly: true, ...extra });

function shooter() {
  const invader = (n, x, y) => obj(`Invader ${n}`, 'invader', x, y, 34, 24, '#f472b6', {
    behaviours: [{ type: 'patrol', speed: 70, distance: 150, axis: 'x', stomp: false, points: 0 }],
  });
  return {
    v: 2,
    title: 'Star Blaster',
    settings: { ...SETTINGS, background: '#0b1026', gravity: 0, lives: 3, winScore: 150,
      winTitle: 'Sector clear!', winText: 'You scored {score}', loseTitle: 'Ship lost', loseText: 'Final score {score}' },
    objects: [
      label('← → move  ·  X to shoot. Reach 150 points.', 200, 410, 400, 18, '#8aa0e8'),
      invader(1, 90, 60), invader(2, 300, 100), invader(3, 520, 60),
      obj('Rock spawner', 'spawner', 392, -40, 16, 16, '#334155', { visible: false, behaviours: [{ type: 'spawner', what: '', every: 1.4, spread: 720, limit: 0 }] }),
      spawnTpl('Meteor', 'meteor', 28, 28, '#a8a29e', { shape: 'ellipse', behaviours: [{ type: 'faller', speed: 150, speedUp: 4, dir: 'down', loop: false, points: 0 }, { type: 'hazard', sound: '' }] }),
      obj('Ship', 'player', 380, 370, 36, 30, '#38bdf8', {
        layer: 1, behaviours: [{ type: 'topdown', speed: 320, axis: 'x' }, { type: 'shooter', dir: 'up', rate: 5, speed: 560, size: 8, points: 10, sound: '' }],
      }),
    ],
    events: [],
    __link: 'Rock spawner',
  };
}

function maze() {
  const rows = ['#########################', '#.#.............#.......#', '#.#####.#########.#####.#', '#...#...#.........#.....#', '###.#.###.#####.###.###.#',
    '#.#.#.....#...#.#...#.#.#', '#.#.#.#####.#.###.###.#.#', '#.#.#.#...#.#.....#...#.#', '#.#.#.#.#.#.#######.###.#', '#...#...#.#.#.....#.....#',
    '#.#######.#.#.###.#.#####', '#.#.....#.#.#.#.#.#...#.#', '#.###.#.###.#.#.#.###.#.#', '#.....#.....#...#.......#', '#########################'];
  const cx = (c, size) => c * 32 + (32 - size) / 2;
  const key = (n, c, r) => obj(`Key ${n}`, 'key', cx(c, 16), cx(r, 16), 16, 16, '#fde047', { shape: 'ellipse' });
  const door = (n, c, r) => obj(`Door ${n}`, 'door', c * 32, r * 32, 32, 32, '#b45309', { solid: true, layer: 1 });
  return {
    v: 2,
    title: 'Key Maze',
    settings: { ...SETTINGS, width: 800, height: 480, background: '#101c14', gravity: 0, lives: 3, hud: false, vars: { keys: 0 },
      winTitle: 'Out of the maze!', winText: 'You made it with {lives} lives left' },
    objects: [
      obj('Maze walls', 'wall', 0, 0, 800, 480, '#2f5d3f', { solid: true, tiles: { size: 32, rows } }),
      key(1, 4, 11), key(2, 1, 6),
      door(1, 7, 12), door(2, 19, 5),
      obj('Exit', 'goal', cx(23, 24), cx(13, 24), 24, 24, '#4ade80', { shape: 'ellipse', behaviours: [{ type: 'goal', needAll: false, then: 'win' }] }),
      obj('Keys label', 'text', 14, 4, 120, 22, '#fde68a', { text: 'Keys: {keys}', fixed: true, layer: 9 }),
      obj('Player', 'player', 38, 38, 20, 20, '#fde68a', { layer: 2, behaviours: [{ type: 'topdown', speed: 170, axis: 'both' }] }),
    ],
    events: [
      { id: newId('e'), a: 'player', b: 'group:key', actions: [{ do: 'addVar', name: 'keys', n: 1 }, { do: 'destroyB' }, { do: 'say', text: 'Got a key!' }] },
      { id: newId('e'), a: 'player', b: 'group:door', if: { v: 'keys', op: '>=', n: 1 }, actions: [{ do: 'addVar', name: 'keys', n: -1 }, { do: 'destroyB' }, { do: 'say', text: 'Unlocked!' }] },
      { id: newId('e'), a: 'player', b: 'group:door', if: { v: 'keys', op: '<', n: 1 }, actions: [{ do: 'say', text: 'Locked. Find a key.' }] },
    ],
  };
}

function runner() {
  return {
    v: 2,
    title: 'Rooftop Run',
    settings: { ...SETTINGS, background: '#2a1b3d', gravity: 1700, lives: 3, timer: 45, timerEnds: 'win',
      winTitle: 'You made it!', winText: 'Dodged for the whole run. Score {score}', loseTitle: 'Tripped!', loseText: 'Score {score}' },
    objects: [
      label('Space or ↑ to jump. Dodge the crates for 45 seconds.', 160, 62, 480, 20, '#d8b4fe'),
      block('Roof', 0, 400, 800, 50, '#4c3a6b'),
      obj('Crate spawner', 'spawner', 830, 360, 10, 40, '#000000', { visible: false, behaviours: [{ type: 'spawner', what: '', every: 1.5, spread: 0, limit: 0 }] }),
      spawnTpl('Crate', 'crate', 34, 36, '#fb923c', { behaviours: [{ type: 'faller', speed: 280, speedUp: 6, dir: 'left', loop: false, points: 1 }, { type: 'hazard', sound: '' }] }),
      obj('Coin spawner', 'spawner', 830, 290, 10, 10, '#000000', { visible: false, behaviours: [{ type: 'spawner', what: '', every: 2.6, spread: 60, limit: 0 }] }),
      spawnTpl('Coin', 'coin', 18, 18, '#fcd34d', { shape: 'ellipse', behaviours: [{ type: 'faller', speed: 240, speedUp: 0, dir: 'left', loop: false, points: 0 }, { type: 'collectible', points: 5, sound: '' }, { type: 'bobber', amount: 12, period: 1.2, axis: 'y' }] }),
      obj('Runner', 'player', 120, 360, 28, 40, '#f472b6', { layer: 1, behaviours: [{ type: 'platformer', speed: 120, jump: 700, airJumps: 0 }] }),
    ],
    events: [],
    __link: ['Crate spawner:Crate', 'Coin spawner:Coin'],
  };
}

function clicker() {
  return {
    v: 2,
    title: 'Coin Clicker',
    settings: { ...SETTINGS, background: '#10243a', gravity: 0, lives: 1, timer: 30, timerEnds: 'win', hud: true,
      winTitle: "Time's up!", winText: 'You clicked up {score} points', winColor: '#fde047' },
    objects: [
      label('Click the big coin. Catch the stars for a bonus!', 150, 58, 500, 20, '#93c5fd'),
      obj('Big coin', 'coin', 335, 160, 130, 130, '#fbbf24', { shape: 'ellipse', behaviours: [{ type: 'clickable', points: 1, pop: false, sound: '' }, { type: 'bobber', amount: 6, period: 1.6, axis: 'y' }] }),
      obj('Star spawner', 'spawner', 400, 430, 10, 10, '#000000', { visible: false, behaviours: [{ type: 'spawner', what: '', every: 2.2, spread: 700, limit: 3 }] }),
      spawnTpl('Star', 'star', 40, 40, '#fde047', { shape: 'ellipse', behaviours: [{ type: 'faller', speed: 110, speedUp: 0, dir: 'up', loop: false, points: 0 }, { type: 'clickable', points: 10, pop: true, sound: '' }, { type: 'spinner', speed: 180 }] }),
    ],
    events: [],
    __link: 'Star spawner:Star',
  };
}

/* a spawner copies an object by id, so hook each spawner up to its template once the ids exist */
function linked(make) {
  return () => {
    const sc = make();
    const links = [].concat(sc.__link || []);
    delete sc.__link;
    for (const l of links) {
      const [from, to] = l.includes(':') ? l.split(':') : [l, null];
      const sp = sc.objects.find(o => o.name === from);
      const tpl = to ? sc.objects.find(o => o.name === to) : sc.objects.find(o => o.spawnOnly);
      if (sp && tpl) sp.behaviours.find(b => b.type === 'spawner').what = tpl.id;
    }
    return sc;
  };
}

export const TEMPLATES = [
  { id: 'blank', name: 'Blank', icon: 'file', desc: 'An empty scene with a floor. Add objects and give them behaviours.', scene: blank },
  { id: 'platformer', name: 'Platformer', icon: 'gamepad', desc: 'Run and jump, grab every coin, stomp the walkers and reach the flag.', scene: platformer },
  { id: 'topdown', name: 'Top-down collector', icon: 'compass', desc: 'Gather gems in a garden maze before the timer ends. Beetles give chase.', scene: topdown },
  { id: 'dodge', name: 'Dodge', icon: 'zap', desc: 'Slide left and right to dodge falling meteors for 30 seconds.', scene: dodge },
  { id: 'shooter', name: 'Shooter', icon: 'zap', desc: 'Slide along the bottom and blast the invaders and meteors. Bullets remove whatever they hit.', scene: linked(shooter) },
  { id: 'maze', name: 'Maze with keys', icon: 'lock', desc: 'Find the keys, open the doors and reach the exit. The walls were painted with the tile painter.', scene: linked(maze) },
  { id: 'runner', name: 'Endless runner', icon: 'arrow-right', desc: 'Jump the crates that keep coming, grab coins, and last 45 seconds.', scene: linked(runner) },
  { id: 'clicker', name: 'Clicker', icon: 'mouse-pointer', desc: 'Click the coin as fast as you can for 30 seconds. Stars float up for a bonus.', scene: linked(clicker) },
];

export const template = id => TEMPLATES.find(t => t.id === id) || null;
export const sceneFor = id => (template(id) || TEMPLATES[0]).scene();

export default { TEMPLATES, template, sceneFor };
