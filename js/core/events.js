/* ============================================================
   events.js — Static Events and the occasional surprise.

   Weekly jam (section 28): once per ISO week, a notification with
   this week's Static Jam theme and a button that starts a game for it
   in Static Forge. The theme is picked locally from the week number —
   it is a prompt for you, not a hosted contest with other entrants,
   and the notice says so. (Forge's jam card uses the same list.)

   Rare messages (section 34): about one boot in 120 shows one of a
   few odd "system messages". Harmless, and it counts as a secret.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { getApp } from './registry.js';
import { open } from './wm.js';

/* The theme list is long on purpose: the week picks its theme by counting weeks
   from a fixed Monday (weekNumber), not by the ISO week of the year, so a list
   of N themes shows each one once in N weeks, and the same on every device.
   Every theme here is original. */
export const JAM_THEMES = [
  'One Button', 'Night Shift', 'Lost Signal', 'Arcade', 'Underwater', 'Future City', 'Broken World', 'Speed',
  'Tiny World', 'Gravity Flip', 'Last Battery', 'Hide and Seek', 'Ghost Train', 'Paper Town', 'Clockwork', 'Reflections',
  'Out of Time', 'Borrowed Light', 'Mirror Maze', 'Low Tide', 'Moving Day', 'Sleepwalker', 'Lighthouse', 'The Long Way',
  'Snowed In', 'Rooftops', 'Static Dreams', 'Overgrown', 'Echoes', 'Small Hands', 'Rewind', 'Carnival',
  'Deep Space', 'Treasure Map', 'Shrinking Room', 'Wrong Way', 'Border Crossing', 'Pocket Dimension', 'Domino', 'Heatwave',
  'Backstage', 'Orchard', 'Signal Fire', 'Fog', 'Escape Pod', 'Tide Pool', 'Switchboard', 'Marble Run',
  'Fragile', 'Glass Bridge', 'Spare Parts', 'Desert Rail', 'Kite Day', 'Cave Light', 'Tidy Up', 'Lost and Found',
  'Rush Hour', 'Crossroads', 'Home Stretch', 'Stormy Night', 'Tiny Kingdom', 'Upside Down', 'Copycat', 'Slow Motion',
];

/* one line for each theme: what it could mean (Static Jam and Forge show it) */
export const JAM_LINES = {
  'One Button': 'The whole game is played with a single key or a single tap.',
  'Night Shift': 'Darkness, late hours, a job that starts when everyone else is asleep.',
  'Lost Signal': 'Static, radio silence, finding your way with almost nothing to go on.',
  'Arcade': 'Short rounds, a high score, and just one more try.',
  'Underwater': 'Currents, bubbles, pressure — and whatever lives down there.',
  'Future City': 'Neon streets, traffic in the sky, machines everywhere.',
  'Broken World': 'Something has fallen apart. Patch it, survive it, or break it further.',
  'Speed': 'Faster and faster until something gives.',
  'Tiny World': 'Everything is small: a planet you can walk round in ten steps.',
  'Gravity Flip': 'Up and down swap places, again and again.',
  'Last Battery': 'Everything you do costs power, and there is not much left.',
  'Hide and Seek': 'Someone is looking for you, or you are looking for someone.',
  'Ghost Train': 'A ride that never stops, and passengers who should not be there.',
  'Paper Town': 'Folded, cut, taped and torn: a world made of paper.',
  'Clockwork': 'Gears, springs and timing. Everything ticks.',
  'Reflections': 'What you see in the mirror, the water or the glass is not quite the same.',
  'Out of Time': 'The clock is the enemy, or the clock is the puzzle.',
  'Borrowed Light': 'Light is something you carry, share or run out of.',
  'Mirror Maze': 'Find the way out when every wall shows you yourself.',
  'Low Tide': 'The sea pulls back and uncovers what was hidden. It will return.',
  'Moving Day': 'Boxes, stairs, a van that is too small.',
  'Sleepwalker': 'Someone is walking in their sleep. Keep them safe, or wake them.',
  'Lighthouse': 'A beam sweeping across the dark, and a reason to keep it lit.',
  'The Long Way': 'The short route is closed. Take the scenic one.',
  'Snowed In': 'Cold, quiet, and the door will not open.',
  'Rooftops': 'Run, jump and hide across the tops of the buildings.',
  'Static Dreams': 'Half-remembered places that change when you look away.',
  'Overgrown': 'Nature is taking the place back, one vine at a time.',
  'Echoes': 'What you do comes back a moment later.',
  'Small Hands': 'Be careful: everything is fragile, and you are very small.',
  'Rewind': 'Take a step back in time. Use it to fix a mistake or to cause one.',
  'Carnival': 'Stalls, prizes, music and a game that is not quite fair.',
  'Deep Space': 'Far from anything, with a ship and not enough of something.',
  'Treasure Map': 'Follow clues to a spot marked with an X.',
  'Shrinking Room': 'The walls move closer every few seconds.',
  'Wrong Way': 'Go against the flow: against the crowd, the river, the arrows.',
  'Border Crossing': 'Get across, and there is a rule about what you can carry.',
  'Pocket Dimension': 'A big world that fits inside a very small space.',
  'Domino': 'One push sets off a chain. Plan where each piece falls.',
  'Heatwave': 'Too hot to move fast. Find shade, find water.',
  'Backstage': 'The show is on, and the real action is behind the curtain.',
  'Orchard': 'Grow, pick and protect what grows on the trees.',
  'Signal Fire': 'Light a fire so someone far away can see it.',
  'Fog': 'You can only see a few steps ahead.',
  'Escape Pod': 'One small capsule, and a clock running down.',
  'Tide Pool': 'A tiny world of creatures between the rocks.',
  'Switchboard': 'Plug, unplug and connect the right wires before the line goes dead.',
  'Marble Run': 'Build the track, then let the marble go.',
  'Fragile': 'Handle with care: something breaks if you rush.',
  'Glass Bridge': 'Some of the panels will hold. Some will not.',
  'Spare Parts': 'Build something from what you find lying around.',
  'Desert Rail': 'A train, a long track, and nothing but sand for miles.',
  'Kite Day': 'Wind, string and a sky full of colour.',
  'Cave Light': 'A small light, a big cave, and a way out somewhere.',
  'Tidy Up': 'Put everything back where it belongs, before someone notices.',
  'Lost and Found': 'Something is missing. Someone is looking for it.',
  'Rush Hour': 'Everyone wants to go somewhere, all at once.',
  'Crossroads': 'Four ways to go, and each one changes the game.',
  'Home Stretch': 'You are nearly there. This is the part where it gets hard.',
  'Stormy Night': 'Rain, thunder and a long walk home.',
  'Tiny Kingdom': 'A ruler, a few subjects and a very small border.',
  'Upside Down': 'The world is the wrong way up. Get used to it.',
  'Copycat': 'Do what they do, or make them do what you do.',
  'Slow Motion': 'Everything happens slowly, which makes it a different game.',
};

/* Optional extra rules for the week ("constraints"), chosen the same way: from the week
   number, so every device shows the same two. They are a dare, not a requirement. */
export const JAM_CONSTRAINTS = [
  'No text on screen', 'Only two colours', 'One screen, no scrolling', 'A round lasts under 60 seconds',
  'Only the arrow keys', 'No enemies', 'The player cannot jump', 'Everything is a circle',
  'Sound effects, but no music', 'One life only', 'It gets harder every ten seconds', 'No game over screen: it just loops',
  'Mouse or touch only', 'Nothing on screen stands still', 'A score, but no timer', 'Nothing red anywhere',
  'Only one shape of sprite', 'Start from an empty screen', 'The ending depends on your score', 'Playable with one hand',
  'The goal and the player swap halfway', 'Gravity changes while you play', 'No walls', 'Three buttons at most',
];

/** Whole weeks since a fixed Monday (1969-12-29): the same number on every device for the same calendar week. */
export function weekNumber(d = new Date()) {
  const days = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return Math.floor((days + 3) / 7);
}

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}
export const jamTheme = (d = new Date()) => JAM_THEMES[weekNumber(d) % JAM_THEMES.length];
/** Two different constraints for the week of d. */
export function jamConstraints(d = new Date()) {
  const n = weekNumber(d), m = JAM_CONSTRAINTS.length;
  const a = n % m;
  const b = (a + 1 + (Math.floor(n / m) % (m - 1))) % m;
  return [JAM_CONSTRAINTS[a], JAM_CONSTRAINTS[b]];
}

const ODD = [
  ['StaticOS', 'The static is listening.'],
  ['StaticOS', 'A window you never opened closed itself. Probably nothing.'],
  ['Arcade', 'Someone set a high score at 3:14 AM. It was you, from the future.'],
  ['Files', 'Found 1 file named "do_not_open.txt". It was empty. It is gone now.'],
];

export function init() {
  const cur = store.get('portal.events', {}) || {};
  const { year, week } = isoWeek();
  const key = `${year}-W${week}`;
  if (cur.jamWeek !== key && getApp('forge')) {
    store.set('portal.events', { ...cur, jamWeek: key });
    const theme = jamTheme();
    setTimeout(() => bus.emit('noti:push', {
      app: 'Static Jam', icon: 'sparkles', timeout: 12000,
      title: `This week's jam theme: ${theme}`,
      message: 'A local prompt to build something in Static Forge — not a hosted contest.',
      actions: [
        { label: 'Make a game', onClick: () => open('forge', { prompt: `A small game for the jam theme "${theme}"` }) },
        { label: 'Later' },
      ],
    }), 9000);
  } else if (Math.random() < 1 / 120) {
    const [app, message] = ODD[Math.floor(Math.random() * ODD.length)];
    setTimeout(() => {
      bus.emit('noti:push', { app, icon: 'eye', timeout: 7000, title: 'System message', message });
      bus.emit('egg:found', { id: 'odd-message' });
    }, 14000);
  }
}

export default { init, jamTheme, jamConstraints, weekNumber, isoWeek, JAM_THEMES, JAM_LINES, JAM_CONSTRAINTS };
