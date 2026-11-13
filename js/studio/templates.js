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

export const TEMPLATES = [
  { id: 'blank', name: 'Blank', icon: 'file', desc: 'An empty scene with a floor. Add objects and give them behaviours.', scene: blank },
  { id: 'platformer', name: 'Platformer', icon: 'gamepad', desc: 'Run and jump, grab every coin, stomp the walkers and reach the flag.', scene: platformer },
  { id: 'topdown', name: 'Top-down collector', icon: 'compass', desc: 'Gather gems in a garden maze before the timer ends. Beetles give chase.', scene: topdown },
  { id: 'dodge', name: 'Dodge', icon: 'zap', desc: 'Slide left and right to dodge falling meteors for 30 seconds.', scene: dodge },
];

export const template = id => TEMPLATES.find(t => t.id === id) || null;
export const sceneFor = id => (template(id) || TEMPLATES[0]).scene();

export default { TEMPLATES, template, sceneFor };
