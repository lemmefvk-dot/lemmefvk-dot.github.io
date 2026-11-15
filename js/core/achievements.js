/* ============================================================
   achievements.js — small rewards for exploring StaticOS.

   Deliberately few, and each one marks something real you did on
   this device. They are earned from bus events other parts of the
   OS already emit; nothing polls, nothing is faked, and nothing is
   granted for what happened before a counter existed — except where
   the history is genuinely on this device (see seedDays()).

   Events listened to:
     game:launch   { kind, id, title, cats? }        (plays.js)
     game:fav      { id }                             (Static Games)
     arcade:score  { game, score, best, newBest, hadBest, players, won? }
     projects:change { id, kind }                     (projects.js)
     collection:create                                (Library)
     egg:found     { id }                             (easter eggs)
     gamepad:connected                                (Controller Center)
     win:open      the window (wm.js) — counted only once the desktop is
                   up, so the windows StaticOS opens for you at start-up
                   (the restored session) are not "apps you opened"
     file:saved    { path, app? }   a file you saved: Notes (into a file),
                   Code, Board's export, Files' imports, anything saved
                   through media.js (Paint, Graph, Palette, Recorder…)
   Everyday badges (each from the event its own app emits when the thing
   really happens; counts such as flashcards graded live in
   portal.achievements.counts and start from the day the badge exists):
     arcade:score { won: true }            Winner;   every score: Arcade Marathon (25)
     flashcards:review                     Hit the Books, Card Shark (50)   (core/flashcards.js)
     homework:done / tasks:done            Turned It In / Ticked Off        (Study, Tasks)
     focus:done                            In the Zone: a focus phase that ran out (core/focus.js)
     sheets:formula                        Formula Whiz: a formula that is not an error
     soundboard:play / typing:lesson (passed) / drop:done
     pack:change (a pack id) · trash:emptied (count > 0) · desktops:change { kind: 'add' }
     deskwidgets:added · win:snap · power:lock   (only once the desktop is up)
     screensaver:shown { preview: false }  Daydreamer: it started by itself, not Preview
     sticker:placed { total }              Sticker Slinger; 10 at once: Sticker Bomb
   More everyday badges:
     arcade:score { online: true }         Played a Friend
     watch:friend                          Movie Night: a friend joined your Watch Together room
     daily:solved { streak }               Week of Stars (7) and Month of Stars (30), from Daily Stars
     clips:change { kind: 'save' }         Clip It
     arcade:score (the same game, over and over)  Game Master: 10 rounds of one game
     backup:done                           Backed Up: a data backup was downloaded
     tabs:join                             Tabbed: two windows made into tabs
     keymap:change                         Shortcut Shaper: you changed a shortcut
     the offline copy reporting complete   Offline Ready (asked of the service worker, not guessed)
   Arcade Marathon has tiers: 25, 100 and 500 rounds.
   Badges with a goal tell you when you pass halfway ("5 of 10 games"), once —
   after a game, an Arcade round, a flashcard or a Daily Stars solve; not for
   opening apps, which would pop up while you explore.
   Halloween (only while js/core/halloween.js says it is the season):
     pumpkin:carved                                   (Pumpkin Carver)
     halloween:trickortreat { kind, days }            (the dock pumpkin)
     arcade:score  with game 'haunted-maze' — unless it reports
                   won: false / survived: false
     ghosts:found  { n, total, all }                  (the ghost hunt, js/core/ghosts.js)

   API: init(), list(), summary(), unlock(id), isUnlocked(id)
   Store: portal.achievements = { unlocked: { id: at }, horror: {id: true},
          apps: { appId: true }, days: { 'YYYY-MM-DD': true } }
   Emits bus 'achievement:unlock' with the definition.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import { inSeason, dayKey } from './halloween.js';
import * as GHOSTS from './ghosts.js';

const KEY = 'portal.achievements';

export const DEFS = [
  { id: 'first-game',    name: 'First Game',        icon: 'gamepad',   desc: 'Launch any game.' },
  { id: 'explorer',      name: 'Explorer',          icon: 'compass',   desc: 'Play 10 different games.', goal: 10, stat: 'distinct', unit: 'games' },
  { id: 'hundred',       name: '100 Games Played',  icon: 'trending-up', desc: 'Launch games 100 times.', goal: 100, stat: 'total', unit: 'launches' },
  { id: 'week',          name: 'Seven Days',        icon: 'calendar',  desc: 'Play something on 7 different days.', goal: 7, stat: 'days', unit: 'days' },
  { id: 'first-fav',     name: 'First Favorite',    icon: 'heart',     desc: 'Favorite a game.' },
  { id: 'arcade',        name: 'Arcade Regular',    icon: 'zap',       desc: 'Play a Static Arcade game.' },
  { id: 'high-score',    name: 'Personal Best',     icon: 'star',      desc: 'Beat your own high score in an Arcade game.' },
  { id: 'couch',         name: 'Couch Co-op',       icon: 'users',     desc: 'Play a 2-player Arcade game on one device.' },
  { id: 'horror',        name: '10 Horror Games',   icon: 'moon',      desc: 'Play 10 different horror games.', goal: 10, stat: 'horror', unit: 'games' },
  { id: 'apps-10',       name: 'App Hopper',        icon: 'grid-9',    desc: 'Open 10 different apps.', goal: 10, stat: 'apps', unit: 'apps' },
  { id: 'first-save',    name: 'First Save',        icon: 'save',      desc: 'Save a file — from Code, Paint, Notes, Files and more.' },
  { id: 'first-creation', name: 'First Creation',   icon: 'sparkles',  desc: 'Make a game in Static Forge.' },
  { id: 'iterate',       name: 'Iterator',          icon: 'refresh',   desc: 'Change a creation by describing an edit.' },
  { id: 'published',     name: 'Published',         icon: 'upload',    desc: 'Publish a creation to your Workshop.' },
  { id: 'remix',         name: 'Remixer',           icon: 'git-branch', desc: 'Remix a creation into something new.' },
  { id: 'curator',       name: 'Curator',           icon: 'bookmark',  desc: 'Make a collection in your Library.' },
  { id: 'plugged-in',    name: 'Plugged In',        icon: 'gamepad',   desc: 'Connect a controller.' },
  { id: 'secret',        name: 'Found a Secret',    icon: 'eye',       desc: 'Find something hidden in StaticOS.', secret: true },
  /* Everyday badges: each one is something you did, heard from the bus event the
     app or shell part itself emits when it really happens (see init() below) */
  { id: 'winner',        name: 'Winner',            icon: 'star',      desc: 'Win a round of an Arcade game.' },
  { id: 'marathon',      name: 'Arcade Marathon',   icon: 'gamepad',   desc: 'Finish 25 Arcade rounds.', goal: 25, stat: 'rounds', unit: 'rounds' },
  { id: 'marathon-100',  name: 'Arcade Marathon II', icon: 'gamepad',  desc: 'Finish 100 Arcade rounds.', goal: 100, stat: 'rounds', unit: 'rounds' },
  { id: 'marathon-500',  name: 'Arcade Marathon III', icon: 'gamepad', desc: 'Finish 500 Arcade rounds.', goal: 500, stat: 'rounds', unit: 'rounds' },
  { id: 'played-friend', name: 'Played a Friend',   icon: 'users',     desc: 'Finish an online Arcade round against a friend.' },
  { id: 'friend-watch',  name: 'Movie Night',       icon: 'film',      desc: 'Let a friend watch with you: a friend joins your Watch Together room.' },
  { id: 'daily-7',       name: 'Week of Stars',     icon: 'star',      desc: 'Solve Daily Stars 7 days in a row.', goal: 7, stat: 'dstreak', unit: 'days in a row' },
  { id: 'daily-30',      name: 'Month of Stars',    icon: 'star',      desc: 'Solve Daily Stars 30 days in a row.', goal: 30, stat: 'dstreak', unit: 'days in a row' },
  { id: 'clip-it',       name: 'Clip It',           icon: 'film',      desc: 'Record a clip of an Arcade game.' },
  { id: 'game-master',   name: 'Game Master',       icon: 'star',    desc: 'Finish 10 rounds of the same Arcade game.', goal: 10, stat: 'mastery', unit: 'rounds of one game' },
  { id: 'backed-up',     name: 'Backed Up',         icon: 'download',  desc: 'Download a backup of your saved data.' },
  { id: 'tabbed',        name: 'Tabbed',            icon: 'layers',    desc: 'Drag one window onto another to make tabs.' },
  { id: 'shortcut-shaper', name: 'Shortcut Shaper', icon: 'keyboard',  desc: 'Change a keyboard shortcut in Settings.' },
  { id: 'offline-ready', name: 'Offline Ready',     icon: 'hard-drive', desc: 'Let StaticOS finish saving its offline copy, so it opens without a connection.' },
  { id: 'hit-books',     name: 'Hit the Books',     icon: 'bookmark',  desc: 'Grade a flashcard in Study.' },
  { id: 'card-shark',    name: 'Card Shark',        icon: 'zap',       desc: 'Grade 50 flashcards in Study.', goal: 50, stat: 'cards', unit: 'cards' },
  { id: 'turned-in',     name: 'Turned It In',      icon: 'check-circle', desc: 'Mark a homework assignment done in Study.' },
  { id: 'ticked-off',    name: 'Ticked Off',        icon: 'check',     desc: 'Tick off a task in Tasks.' },
  { id: 'in-the-zone',   name: 'In the Zone',       icon: 'flame',     desc: 'Run a Focus timer session all the way to the end.' },
  { id: 'formula-whiz',  name: 'Formula Whiz',      icon: 'table',     desc: 'Enter a formula in Sheets that works out to a value.' },
  { id: 'sound-check',   name: 'Sound Check',       icon: 'volume-2',  desc: 'Play a button on your Soundboard.' },
  { id: 'touch-typist',  name: 'Touch Typist',      icon: 'keyboard',  desc: 'Pass a lesson in Typing Lessons (90% accuracy).' },
  { id: 'dropped-in',    name: 'Dropped In',        icon: 'send',      desc: 'Finish a transfer in Static Drop.' },
  { id: 'pack-rat',      name: 'Pack Rat',          icon: 'palette',   desc: 'Put on a theme pack in Settings › Themes.' },
  { id: 'clean-sweep',   name: 'Clean Sweep',       icon: 'trash',     desc: 'Empty the Trash with something in it.' },
  { id: 'second-desk',   name: 'Elbow Room',        icon: 'layers',    desc: 'Add a second desktop.' },
  { id: 'widget-wizard', name: 'Widget Wizard',     icon: 'grid',      desc: 'Put a widget on the desktop.' },
  { id: 'snap-happy',    name: 'Snap Happy',        icon: 'maximize-2', desc: 'Snap a window to the side of the screen.' },
  { id: 'locked-up',     name: 'Locked Up',         icon: 'lock',      desc: 'Lock the screen yourself.' },
  { id: 'daydreamer',    name: 'Daydreamer',        icon: 'moon',      desc: 'Step away long enough for the screensaver to start by itself.' },
  { id: 'sticker-slinger', name: 'Sticker Slinger', icon: 'sparkles',  desc: 'Put a sticker on the desktop.' },
  { id: 'sticker-bomb',  name: 'Sticker Bomb',      icon: 'image',     desc: 'Have 10 stickers on the desktop at once.' },
  /* Halloween badges: shown (and earnable) only during the season, kept forever once earned */
  { id: 'pumpkin-carved', name: 'Carved a Pumpkin', icon: 'pumpkin',   desc: 'Carve a jack-o’-lantern in the Pumpkin Carver.', season: 'halloween' },
  { id: 'trick-or-treat', name: 'Trick-or-Treater', icon: 'candy',     desc: 'Trick-or-treat at the dock pumpkin on 5 different days.', goal: 5, stat: 'tot', unit: 'days', season: 'halloween' },
  { id: 'haunted-maze',  name: 'Survived the Haunted Maze', icon: 'ghost', desc: 'Make it out of the Haunted Maze in the Arcade.', season: 'halloween' },
  { id: 'ghost-hunter',  name: 'Ghost Hunter',      icon: 'ghost',     desc: `Find all ${GHOSTS.TOTAL} ghosts hiding around StaticOS.`, goal: GHOSTS.TOTAL, stat: 'ghosts', season: 'halloween' },
];
const byId = new Map(DEFS.map(d => [d.id, d]));

const obj = v => (v && typeof v === 'object' ? v : {});
const read = () => {
  const v = store.get(KEY, null);
  const base = v && typeof v === 'object' ? v : {};
  return { ...base, half: obj(base.half), unlocked: obj(base.unlocked), horror: obj(base.horror), apps: obj(base.apps), days: obj(base.days), counts: obj(base.counts) };
};
const write = v => store.set(KEY, { ...v });

const SEASONS = { halloween: () => inSeason() };
const seasonOpen = d => !d.season || !!SEASONS[d.season]?.();

export const isUnlocked = id => !!read().unlocked[id];

export function unlock(id) {
  const d = byId.get(id);
  if (!d || isUnlocked(id) || !seasonOpen(d)) return false;
  const cur = read();
  write({ ...cur, unlocked: { ...cur.unlocked, [id]: Date.now() } });
  bus.emit('noti:push', {
    app: 'Achievements', icon: d.icon || 'star', timeout: 6000, kind: 'achievement',
    title: `Achievement: ${d.name}`, message: d.desc,
    actions: [{ label: 'View', onClick: () => bus.emit('achievements:open') }],
  });
  bus.emit('achievement:unlock', d);
  return true;
}

let playsRef = null;
/* Daily Stars' own record (arcade/daily-state.js): the streak as it stands today */
function dailyStreak() {
  try {
    const s = store.get('portal.arcadeDaily', null)?.streak;
    if (!s || !Number.isInteger(s.cur)) return 0;
    const t = new Date(), y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return s.last === key(t) || s.last === key(y) ? s.cur : 0;
  } catch (e) { return 0; }
}
const trickDays = () => Object.keys(obj(store.get('portal.halloween', null)?.days)).length;

function count(d, cur, stats) {
  switch (d.stat) {
    case 'horror': return Object.keys(cur.horror).length;
    case 'apps': return Object.keys(cur.apps).length;
    case 'days': return Object.keys(cur.days).length;
    case 'tot': return trickDays();
    case 'ghosts': return GHOSTS.foundCount();
    case 'rounds': return Number(cur.counts.rounds) || 0;
    case 'cards': return Number(cur.counts.cards) || 0;
    case 'mastery': return Math.max(0, ...Object.values(obj(cur.counts.games)).map(Number).filter(Number.isFinite));
    case 'dstreak': return dailyStreak();
    default: return Number(stats[d.stat]) || 0;
  }
}

/** Every definition you can see now, with its state; progress where it is countable.
    Seasonal badges appear only in their season, or once you have earned them. */
export function list(stats = null) {
  const s = stats || (playsRef ? { distinct: playsRef.count(), total: playsRef.total() } : {});
  const cur = read();
  return DEFS.filter(d => seasonOpen(d) || cur.unlocked[d.id]).map(d => ({
    ...d,
    unlocked: !!cur.unlocked[d.id],
    at: cur.unlocked[d.id] || null,
    progress: d.goal ? Math.min(d.goal, count(d, cur, s)) : null,
  }));
}

/** For compact views: counts, the latest few earned, and the nearest few to earn. */
export function summary(stats = null, n = 3) {
  const all = list(stats);
  const got = all.filter(a => a.unlocked).sort((a, b) => b.at - a.at);
  const next = all.filter(a => !a.unlocked && !a.secret)
    .sort((a, b) => (b.goal ? b.progress / b.goal : 0) - (a.goal ? a.progress / a.goal : 0)
      || (b.season ? 1 : 0) - (a.season ? 1 : 0));
  /* `seasonal`: a season is open right now (earned badges of a past season don't count) */
  return { total: all.length, unlocked: got.length, recent: got.slice(0, n), next: next.slice(0, n), seasonal: DEFS.some(d => d.season && seasonOpen(d)) };
}

/* Play days are only ever recorded from here on — but plays.js keeps the
   real time of each game's latest launch, and those days really happened
   on this device, so they count. It can only under-count, never invent. */
function seedDays(plays) {
  try {
    const cur = read();
    const days = { ...cur.days };
    for (const r of plays.recent(80)) if (r && r.at) days[dayKey(new Date(r.at))] = true;
    if (Object.keys(days).length !== Object.keys(cur.days).length) write({ ...cur, days });
  } catch (e) { /* no history yet */ }
}

/** Rounds finished per Arcade game, most played first: [{ game, rounds }] (what Game Master counts). */
export function mastery() {
  return Object.entries(obj(read().counts.games)).map(([game, rounds]) => ({ game, rounds: Number(rounds) || 0 }))
    .filter(r => r.rounds > 0).sort((a, b) => b.rounds - a.rounds);
}

/** "5 of 10 games" — a badge's progress in words, or '' when it has no goal. */
export const progressText = a => (a && a.goal ? `${a.progress || 0} of ${a.goal} ${a.unit || ''}`.trim() : '');

/* A badge with a goal says so once when you pass halfway, not on every step:
   portal.achievements.half = { id: true } */
function checkHalfway() {
  const cur = read();
  const half = { ...obj(cur.half) };
  let changed = false;
  for (const a of list()) {
    if (!a.goal || a.unlocked || half[a.id] || a.goal < 4) continue;
    if (a.progress * 2 < a.goal) continue;
    half[a.id] = true; changed = true;
    bus.emit('noti:push', {
      app: 'Achievements', icon: a.icon || 'star', timeout: 5000, kind: 'achievement-progress',
      title: `${a.name}: halfway`, message: `${progressText(a)}. ${a.desc}`,
      actions: [{ label: 'View', onClick: () => bus.emit('achievements:open') }],
    });
  }
  if (changed) write({ ...read(), half });
}

const desktopUp = () => typeof document !== 'undefined' && document.body?.dataset.ready === '1';

/** Count one more of something you did; -> the new total. Counted only from the day it exists. */
function bump(key) {
  const cur = read();
  const n = (Number(cur.counts[key]) || 0) + 1;
  write({ ...cur, counts: { ...cur.counts, [key]: n } });
  return n;
}

/* Offline Ready: the service worker is asked whether its copy is complete (core/offline.js),
   now and then until it says yes — never assumed. */
function watchOffline() {
  if (isUnlocked('offline-ready')) return;
  let busy = false, ticks = 0, asked = 0;
  const off = bus.on('tick:5s', async () => {
    /* once a minute, 30 times at most: the answer only ever changes while the worker saves its copy */
    if (busy || !desktopUp() || ++ticks % 12 !== 1) return;
    if (isUnlocked('offline-ready') || ++asked > 30) { off(); return; }
    busy = true;
    try {
      const O = await import('./offline.js');
      const s = await O.status();
      if (s && s.supported && s.complete === true) { unlock('offline-ready'); off(); }
    } catch (e) { /* no service worker here */ } finally { busy = false; }
  });
}

let wired = false;
export function init({ plays } = {}) {
  if (wired) return;
  wired = true;
  playsRef = plays || null;
  if (plays) seedDays(plays);

  bus.on('game:launch', e => {
    setTimeout(checkHalfway, 0);
    unlock('first-game');
    if (e?.kind === 'arcade') unlock('arcade');
    if (plays) {
      if (plays.count() >= 10) unlock('explorer');
      if (plays.total() >= 100) unlock('hundred');
    }
    let cur = read();
    const day = dayKey();
    if (!cur.days[day]) { cur = { ...cur, days: { ...cur.days, [day]: true } }; write(cur); }
    if (Object.keys(cur.days).length >= 7) unlock('week');
    if (Array.isArray(e?.cats) && e.cats.includes('horror')) {
      const horror = { ...cur.horror, [e.id]: true };
      write({ ...cur, horror });
      if (Object.keys(horror).length >= 10) unlock('horror');
    }
  });
  bus.on('game:fav', () => unlock('first-fav'));
  bus.on('arcade:score', s => {
    if (s?.newBest && s?.hadBest) unlock('high-score');
    if (Number(s?.players) >= 2 && !s?.online) unlock('couch');   /* online rounds aren't on one device */
    const game = s?.game || s?.id || s?.gameId;
    if (game === 'haunted-maze' && s.won !== false && s.survived !== false) unlock('haunted-maze');
    if (s?.won === true) unlock('winner');
    if (s?.online === true && s.void !== true) unlock('played-friend');
    const n = bump('rounds');
    if (n >= 25) unlock('marathon');
    if (n >= 100) unlock('marathon-100');
    if (n >= 500) unlock('marathon-500');
    if (game) {
      const cur = read();
      const games = { ...obj(cur.counts.games), [game]: (Number(obj(cur.counts.games)[game]) || 0) + 1 };
      write({ ...cur, counts: { ...cur.counts, games } });
      if (games[game] >= 10) unlock('game-master');
    }
    checkHalfway();
  });
  bus.on('watch:friend', () => unlock('friend-watch'));
  bus.on('daily:solved', e => {
    if (Number(e?.streak) >= 7) unlock('daily-7');
    if (Number(e?.streak) >= 30) unlock('daily-30');
    checkHalfway();
  });
  bus.on('clips:change', e => { if (e?.kind === 'save') unlock('clip-it'); });
  bus.on('backup:done', () => unlock('backed-up'));
  bus.on('tabs:join', () => { if (desktopUp()) unlock('tabbed'); });
  bus.on('keymap:change', () => { if (desktopUp()) unlock('shortcut-shaper'); });
  watchOffline();
  bus.on('flashcards:review', () => { unlock('hit-books'); if (bump('cards') >= 50) unlock('card-shark'); checkHalfway(); });
  bus.on('homework:done', () => unlock('turned-in'));
  bus.on('tasks:done', () => unlock('ticked-off'));
  bus.on('focus:done', () => unlock('in-the-zone'));
  bus.on('sheets:formula', () => unlock('formula-whiz'));
  bus.on('soundboard:play', () => unlock('sound-check'));
  bus.on('typing:lesson', () => unlock('touch-typist'));
  bus.on('drop:done', () => unlock('dropped-in'));
  bus.on('pack:change', id => { if (id && desktopUp()) unlock('pack-rat'); });
  bus.on('trash:emptied', e => { if (Number(e?.count) > 0) unlock('clean-sweep'); });
  bus.on('desktops:change', e => { if (e?.kind === 'add' && desktopUp()) unlock('second-desk'); });
  bus.on('deskwidgets:added', () => unlock('widget-wizard'));
  bus.on('win:snap', () => { if (desktopUp()) unlock('snap-happy'); });
  bus.on('power:lock', () => { if (desktopUp()) unlock('locked-up'); });
  bus.on('screensaver:shown', e => { if (!e?.preview) unlock('daydreamer'); });
  bus.on('sticker:placed', e => { unlock('sticker-slinger'); if (Number(e?.total) >= 10) unlock('sticker-bomb'); });
  bus.on('projects:change', c => {
    if (c?.kind === 'create') unlock('first-creation');
    if (c?.kind === 'ai-edit') unlock('iterate');
    if (c?.kind === 'publish') unlock('published');
    if (c?.kind === 'remix') unlock('remix');
  });
  bus.on('collection:create', () => unlock('curator'));
  bus.on('egg:found', () => unlock('secret'));
  bus.on('gamepad:connected', () => unlock('plugged-in'));
  bus.on('win:open', w => {
    const id = w?.appId;
    if (!id || !desktopUp()) return;
    const cur = read();
    if (!cur.apps[id]) {
      const apps = { ...cur.apps, [id]: true };
      write({ ...cur, apps });
      if (Object.keys(apps).length >= 10) unlock('apps-10');
    }
  });
  bus.on('file:saved', () => unlock('first-save'));
  bus.on('pumpkin:carved', () => unlock('pumpkin-carved'));
  bus.on('halloween:trickortreat', r => { if (Number(r?.days) >= 5) unlock('trick-or-treat'); });
  bus.on('ghosts:found', r => { if (r?.all) unlock('ghost-hunter'); });
  /* every ghost caught before this module was listening (they show up with
     the shell, a moment earlier) still counts — the catches are on record */
  if (GHOSTS.foundCount() >= GHOSTS.TOTAL) unlock('ghost-hunter');
  if (typeof window !== 'undefined') window.addEventListener('gamepadconnected', () => bus.emit('gamepad:connected'));
}

export default { init, list, summary, unlock, isUnlocked, mastery, progressText, DEFS };
