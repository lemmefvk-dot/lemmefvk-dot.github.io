/* ============================================================
   classics/catalog.js — the Free Classics shelf in Static Arcade.

   Old games whose makers or rights-holders released them for free,
   each with its licence and maker on its card. docs/free-classics.md
   is the research behind this list: only games with a permission we
   can point at belong here. Nothing here may be fetched from anywhere
   but classics/ on this site, and only js/classics/files.js says what
   is in that folder. No ratings, no player counts.

   These are not ARCADE games (js/arcade/index.js): those are built in,
   start instantly and report scores. These download once, run in a
   sandboxed frame (./frame.js, ./runner.js) and keep their own saves.

   Wording here is not free: see the "Naming" comments below.

   Fields
     links.licence / links.source  shown on the card; must keep working
     run.type   'wasm': an Emscripten build, handed its files through
                postMessage. 'page': one self-contained HTML document.
     run.mount  { file, to } a gzipped file written to that path,
                { file, unzip } every member of a zip into that folder
     run.watch  folders whose files are saved games; copied out whenever
                the game closes a file it wrote
     run.sandbox  the iframe's sandbox flags. Never allow-same-origin:
                that flag is what keeps a game away from StaticOS's data.
     run.aspect a canvas that keeps this shape, letterboxed in the frame
     run.minWidth, run.minHeight  the game's own minimum; a smaller stage
                lays the frame out at this size, scaled down to fit
   ============================================================ */

export const CLASSIC_PREFIX = 'classic-';

export const CLASSICS = [
  {
    id: 'sky',
    title: 'Beneath a Steel Sky',
    year: 1994,
    genre: 'Adventure',
    icon: 'eye',
    hue: 192,
    maker: 'Revolution Software',
    credit: 'Released as freeware by Revolution Software. Runs on ScummVM.',
    blurb: 'A point-and-click thriller. Robert Foster and his robot friend Joey are stranded in a vast city where the rich live safe underground and everyone else works in the towers.',
    how: 'Mouse: click where you want Foster to go, and try both buttons on things. F5 opens save and load. Esc skips the intro.',
    input: 'Mouse',
    licence: 'Game: Revolution’s freeware licence. Engine: GNU GPL 3 or later.',
    notice: 'Game content © Revolution Software Ltd. Engine © The ScummVM Team. The game’s files are unmodified.',
    keywords: ['steel sky', 'bass', 'adventure', 'point and click', 'scummvm', 'revolution', 'foster', 'joey', 'cyberpunk', 'sci-fi'],
    links: {
      licence: 'classics/sky/readme.txt',
      source: 'classics/sky/index.html#source',
      about: 'classics/sky/index.html',
    },
    run: {
      type: 'wasm',
      glue: 'classics/sky/scummvm.js.gz',
      wasm: 'classics/sky/scummvm.wasm.gz',
      mount: [
        { file: 'classics/sky/BASS-Floppy-1.3.zip', unzip: '/game' },
        { file: 'classics/sky/sky.cpt.gz', to: '/game/sky.cpt' },
      ],
      args: ['--path=/game', '--savepath=/saves', '--config=/saves/scummvm.ini', 'sky'],
      watch: ['/saves'],
      /* ScummVM's canvas stays 640 by 480 */
      aspect: 4 / 3,
      sandbox: 'allow-scripts',
    },
  },
  {
    /* Naming. "Micropolis" is a trademark of Micropolis GmbH, licensed to us under
       the Micropolis Public Name License: credit it wherever it is used, and do not
       use it on marketing or more prominently than our own name. So this card carries
       the courtesy line (`trademark`) and the name stays out of What's New and promos.
       EA's GPL section 7 terms: never use "SimCity" anywhere for this game (keywords
       included), never claim any tie to EA, and say that this copy is modified. */
    id: 'micropolis',
    title: 'Micropolis',
    year: 1989,
    genre: 'City builder',
    icon: 'home',
    hue: 96,
    maker: 'Electronic Arts · JavaScript port by Graeme McCutcheon',
    credit: 'Released by Electronic Arts under the GNU GPL. A modified copy of micropolisJS, not the original program, and not affiliated with Electronic Arts.',
    blurb: 'Zone land, lay roads and power lines, set the budget, and keep your citizens happy through fires, floods and monsters.',
    how: 'Mouse: pick a tool on the right, then click the map. Arrow keys or WASD move the map. Save is in the left panel.',
    input: 'Mouse and keyboard',
    licence: 'Game and graphics: GNU GPL 3 with Electronic Arts’ additional terms.',
    notice: 'Copyright © 1989–2007 Electronic Arts Inc. Port © 2013 Graeme McCutcheon. Modified for StaticOS on 2026-10-31.',
    trademark: 'Micropolis is a registered trademark of Micropolis Corporation (Micropolis GmbH) and is licensed here as a courtesy of the owner under the Micropolis Public Name License.',
    trademarkLinks: [
      { label: 'micropolis.com', href: 'https://www.micropolis.com' },
      { label: 'The name licence', href: 'classics/micropolis/name_license.html' },
    ],
    keywords: ['micropolis', 'micropolisjs', 'city', 'city builder', 'city simulator', 'simulation', 'strategy', 'zoning', 'mayor', 'town'],
    links: {
      licence: 'classics/micropolis/LICENSE.txt',
      source: 'classics/micropolis/index.html#source',
      about: 'classics/micropolis/index.html',
    },
    run: {
      type: 'page',
      page: 'classics/micropolis/micropolis.html.gz',
      localStorage: true,
      /* its dialogs are forms; without this flag "submit" never fires, so "Play!" does nothing */
      sandbox: 'allow-scripts allow-forms',
      /* its stylesheet says "too small" at 590 px wide or 582 px tall, or less */
      minWidth: 600,
      minHeight: 590,
    },
  },
  {
    id: 'sopwith',
    title: 'Sopwith',
    year: 1984,
    genre: 'Action',
    icon: 'send',
    hue: 34,
    maker: 'David L. Clark, BMB Compuscience · SDL port by Simon Howard',
    credit: 'Released by its original author, David L. Clark, under the GNU GPL. A slightly modified copy of SDL Sopwith.',
    blurb: 'Fly a biplane over enemy lines. Bomb the targets, shoot down the other planes, and land to refuel.',
    how: 'S then N starts a game. X faster, Z slower, comma pull up, slash pull down, period flip, space fire, B bomb, H head home.',
    input: 'Keyboard',
    licence: 'Game: GNU GPL 2 or later. Its graphics are part of the source.',
    notice: 'Copyright © 1984–2000 David L. Clark, © 2001–2005 Simon Howard and contributors. Modified for StaticOS on 2026-10-31.',
    keywords: ['sopwith', 'sdl sopwith', 'biplane', 'plane', 'flying', 'dogfight', 'shooter', 'action', 'retro', 'ww1'],
    links: {
      licence: 'classics/sopwith/COPYING.txt',
      source: 'classics/sopwith/index.html#source',
      about: 'classics/sopwith/index.html',
    },
    run: {
      type: 'wasm',
      glue: 'classics/sopwith/sopwith.js.gz',
      wasm: 'classics/sopwith/sopwith.wasm.gz',
      mount: [],
      args: [],
      /* SDL_GetPrefPath: the settings file and the high-score table */
      watch: ['/libsdl'],
      sandbox: 'allow-scripts',
    },
  },
];

export const classicById = id => CLASSICS.find(c => c.id === id) || null;

/** 'classic-sky' → the game, for anything that opens games by id (Library, Desktop). */
export function classicFromGameId(id) {
  if (typeof id !== 'string' || !id.startsWith(CLASSIC_PREFIX)) return null;
  return classicById(id.slice(CLASSIC_PREFIX.length));
}

const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** For search: every typed word must start a word of the game's title, maker, genre or keywords. */
export function searchClassics(term) {
  const words = fold(term).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return CLASSICS.filter(c => {
    const hay = fold([c.title, c.maker, c.genre, 'free classics', ...c.keywords].join(' '));
    return words.every(w => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, '\\$&')}`).test(hay));
  });
}
