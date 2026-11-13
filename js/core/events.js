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

export const JAM_THEMES = ['One Button', 'Night Shift', 'Lost Signal', 'Arcade', 'Underwater', 'Future City', 'Broken World', 'Speed'];

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}
export const jamTheme = (d = new Date()) => JAM_THEMES[isoWeek(d).week % JAM_THEMES.length];

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

export default { init, jamTheme, isoWeek, JAM_THEMES };
