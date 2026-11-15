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
     controls   'mouse' | 'keyboard' | 'both': the card's controls hint,
                and the reason Controller Center gives (none of these can
                take a controller: the key bridge cannot reach a sealed frame)
     run.type   'wasm': an Emscripten build, handed its files through
                postMessage. 'page': one self-contained HTML document.
     run.mount  { file, to } a gzipped file written to that path,
                { file, unzip } every member of a zip into that folder,
                skip: [names] members of that zip left out,
                free: true  the free game data, not fetched when the
                player brings their own copy instead (`own` below)
     run.watch  folders whose files are saved games; copied out whenever
                the game closes a file it wrote
     run.cwd    the folder the game starts in (Doom keeps its settings
                and saves in the folder it starts in)
     run.sandbox  the iframe's sandbox flags. Never allow-same-origin:
                that flag is what keeps a game away from StaticOS's data.
     run.aspect a canvas that keeps this shape, letterboxed in the frame
     run.minWidth, run.minHeight  the game's own minimum; a smaller stage
                lays the frame out at this size, scaled down to fit
     own        "play your own old copy": the player picks game files on
                their device, read in this browser and never uploaded.
                { pick: 'folder' | 'file', what, accept, to, args(names),
                  check(name, firstBytes) -> a reason it is not usable, or '' }
                with `only: true` the card has nothing to play without them.
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
    controls: 'mouse',
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
    controls: 'both',
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
    controls: 'keyboard',
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
  /* The next three share one ScummVM build, classics/scummvm/scummvm-free.*: the queen,
     lure and drascula engines only. Each game's zip is the official freeware download,
     byte for byte; its licence asks for the readme to stay with it, which the zip does. */
  {
    id: 'queen',
    title: 'Flight of the Amazon Queen',
    year: 1995,
    genre: 'Adventure',
    icon: 'compass',
    hue: 140,
    maker: 'John Passfield and Steve Stamatiadis',
    credit: 'Released as freeware by its authors, John Passfield and Steve Stamatiadis. Runs on ScummVM.',
    blurb: 'A 1940s jungle adventure. Pilot Joe King crash-lands in the Amazon with a film star on board, and stumbles on a princess to rescue and a very odd company’s secret plan.',
    how: 'Mouse: pick a verb at the bottom, then click a thing. Right-click walks, or uses a thing the usual way. The Journal in your inventory saves and loads. Esc skips a scene.',
    input: 'Mouse',
    controls: 'mouse',
    licence: 'Game: its authors’ freeware licence. Engine: GNU GPL 3 or later.',
    notice: 'Game content © John Passfield and Steven Stamatiadis. Engine © The ScummVM Team. The game’s files are unmodified.',
    keywords: ['amazon queen', 'fotaq', 'joe king', 'adventure', 'point and click', 'scummvm', 'jungle', 'pilot'],
    links: {
      licence: 'classics/queen/readme.txt',
      source: 'classics/queen/index.html#source',
      about: 'classics/queen/index.html',
    },
    run: {
      type: 'wasm',
      glue: 'classics/scummvm/scummvm-free.js.gz',
      wasm: 'classics/scummvm/scummvm-free.wasm.gz',
      mount: [
        { file: 'classics/queen/FOTAQ_Floppy.zip', unzip: '/game' },
        { file: 'classics/scummvm/data/queen.tbl.gz', to: '/game/FOTAQ_Floppy/queen.tbl' },
      ],
      args: ['--path=/game/FOTAQ_Floppy', '--savepath=/saves', '--config=/saves/scummvm.ini', 'queen'],
      watch: ['/saves'],
      aspect: 4 / 3,
      sandbox: 'allow-scripts',
    },
  },
  {
    id: 'lure',
    title: 'Lure of the Temptress',
    year: 1992,
    genre: 'Adventure',
    icon: 'sun',
    hue: 28,
    maker: 'Revolution Software',
    credit: 'Released as freeware by Revolution Software. Runs on ScummVM.',
    blurb: 'Diermot, a peasant caught up in a war, wakes in a cell in Turnvale. The sorceress Selena rules the town now, and its people have their own lives and errands to follow.',
    how: 'Mouse: click where Diermot should go. Right-click a person or a thing for what you can do with it. Move the pointer to the top of the screen for the menu, to save and load.',
    input: 'Mouse',
    controls: 'mouse',
    licence: 'Game: Revolution’s freeware licence. Engine: GNU GPL 3 or later.',
    notice: 'Game content © Revolution Software Ltd. Engine © The ScummVM Team. The game’s files are unmodified.',
    keywords: ['lure', 'temptress', 'diermot', 'adventure', 'point and click', 'scummvm', 'revolution', 'fantasy', 'medieval'],
    links: {
      licence: 'classics/lure/LICENSE.txt',
      source: 'classics/lure/index.html#source',
      about: 'classics/lure/index.html',
    },
    run: {
      type: 'wasm',
      glue: 'classics/scummvm/scummvm-free.js.gz',
      wasm: 'classics/scummvm/scummvm-free.wasm.gz',
      mount: [
        /* the zip holds the EGA version too, and two PDFs: the VGA version is the one played,
           and leaving the rest out keeps ScummVM from having two versions to choose from */
        { file: 'classics/lure/lure-1.1.zip', unzip: '/game', skip: [/\.ega$/i, /\.pdf$/i] },
        { file: 'classics/scummvm/data/lure.dat.gz', to: '/game/lure/lure.dat' },
      ],
      args: ['--path=/game/lure', '--savepath=/saves', '--config=/saves/scummvm.ini', 'lure'],
      watch: ['/saves'],
      aspect: 4 / 3,
      sandbox: 'allow-scripts',
    },
  },
  {
    id: 'drascula',
    title: 'Drascula: The Vampire Strikes Back',
    year: 1996,
    genre: 'Adventure',
    icon: 'moon',
    hue: 268,
    maker: 'Alcachofa Soft',
    credit: 'Released as freeware by Alcachofa Soft. Runs on ScummVM. The game’s music is a separate download that this copy leaves out.',
    blurb: 'A comedy horror adventure. John Hacker, an estate agent, travels to Transylvania to close a land deal, and runs into Count Drascula and his plans.',
    how: 'First a note says the CD music is missing: press OK. Mouse: move the pointer to the top for the verbs, then click a thing. Right-click opens your inventory. Esc skips a scene.',
    input: 'Mouse',
    controls: 'mouse',
    licence: 'Game: Alcachofa Soft’s freeware licence. Engine: GNU GPL 3 or later.',
    notice: 'Game content © Alcachofa Soft S.L. Engine © The ScummVM Team. The game’s files are unmodified.',
    keywords: ['drascula', 'vampire', 'john hacker', 'transylvania', 'adventure', 'point and click', 'scummvm', 'comedy', 'horror'],
    links: {
      licence: 'classics/drascula/readme.txt',
      source: 'classics/drascula/index.html#source',
      about: 'classics/drascula/index.html',
    },
    run: {
      type: 'wasm',
      glue: 'classics/scummvm/scummvm-free.js.gz',
      wasm: 'classics/scummvm/scummvm-free.wasm.gz',
      mount: [
        { file: 'classics/drascula/drascula-1.0.zip', unzip: '/game', skip: [/\.doc$/i] },
        { file: 'classics/scummvm/data/drascula.dat.gz', to: '/game/drascula.dat' },
      ],
      args: ['--path=/game', '--savepath=/saves', '--config=/saves/scummvm.ini', 'drascula'],
      watch: ['/saves'],
      aspect: 4 / 3,
      sandbox: 'allow-scripts',
    },
  },
  {
    /* Freedoom's data is the free game; a player's own DOOM.WAD or DOOM2.WAD can take its
       place (`own`). Each WAD keeps its own settings and saves: the game starts in
       /saves/<the wad's name>, and Doom keeps both in the folder it starts in. */
    id: 'freedoom',
    title: 'Freedoom: Phase 1',
    year: 2024,
    genre: 'Action',
    icon: 'zap',
    hue: 4,
    maker: 'The Freedoom project · engine from id Software’s Doom',
    credit: 'Freedoom is free game data made by its contributors for the Doom engine, under a BSD licence. The engine is id Software’s Doom code, released under the GNU GPL. A shooter: monsters, and blood.',
    blurb: 'Four episodes of first-person shooting through bases, labs and stranger places, all made new by volunteers. You can also play your own DOOM.WAD or DOOM2.WAD here.',
    how: 'Keyboard: arrows move and turn, Ctrl fires, Space opens doors, Shift runs, Alt and an arrow sidestep, 1 to 7 pick a weapon, Tab shows the map, Esc opens the menu.',
    input: 'Keyboard',
    controls: 'keyboard',
    licence: 'Game data: BSD 3-clause licence. Engine: GNU GPL 2.',
    notice: 'Freedoom © 2001–2024 contributors to the Freedoom project. Engine © 1993–1996 id Software, © 2005–2014 Simon Howard and contributors, doomgeneric © ozkl. Unmodified.',
    keywords: ['freedoom', 'doom', 'doom engine', 'chocolate doom', 'doomgeneric', 'shooter', 'fps', 'first person', 'wad', 'action', 'retro'],
    links: {
      licence: 'classics/freedoom/freedoom-COPYING.txt',
      source: 'classics/freedoom/index.html#source',
      about: 'classics/freedoom/index.html',
    },
    run: {
      type: 'wasm',
      glue: 'classics/freedoom/doom.js.gz',
      wasm: 'classics/freedoom/doom.wasm.gz',
      mount: [{ file: 'classics/freedoom/freedoom1.wad.gz', to: '/game/freedoom1.wad', free: true }],
      args: ['-iwad', '/game/freedoom1.wad'],
      watch: ['/saves'],
      cwd: '/saves/freedoom1.wad',
      /* 320 by 200, drawn for a 4:3 screen as in 1993 */
      aspect: 4 / 3,
      sandbox: 'allow-scripts',
    },
    own: {
      pick: 'file',
      what: 'your own DOOM.WAD or DOOM2.WAD',
      accept: '.wad,.WAD',
      to: '/game',
      args: names => ['-iwad', `/game/${names[0]}`],
      cwd: names => `/saves/${names[0]}`,
      /* an IWAD is a whole game; a PWAD is a mod that needs one */
      check: (name, head) => (!/\.wad$/i.test(name) ? 'That is not a WAD file. Pick DOOM.WAD or DOOM2.WAD from your copy of Doom.'
        : head === 'PWAD' ? 'That WAD is a mod, not a whole game. Pick DOOM.WAD or DOOM2.WAD from your copy of Doom.'
          : head !== 'IWAD' ? 'That file is not a Doom game file.' : ''),
    },
  },
  {
    /* Nothing to play until the player brings a game: the engine and its data files only.
       Built with the adventure engines a player's own old games need (classics/scummvm/). */
    id: 'scummvm',
    title: 'Your own ScummVM games',
    year: null,
    genre: 'Adventure',
    icon: 'folder-open',
    hue: 210,
    maker: 'The ScummVM Team · your own copy of the game',
    credit: 'ScummVM is free software by The ScummVM Team. The game is your own copy: StaticOS does not supply it.',
    blurb: 'Play an old adventure you own, such as Monkey Island, Day of the Tentacle, Sam & Max, King’s Quest, Space Quest, Broken Sword, Simon the Sorcerer or Discworld. Pick its folder; the files stay in this browser and are never uploaded.',
    how: 'Mouse, as the game was. Save and load the way your game itself does. Esc skips a scene.',
    input: 'Mouse',
    controls: 'mouse',
    licence: 'Engine: GNU GPL 3 or later. The game: whatever licence your copy came with.',
    notice: 'Engine © The ScummVM Team. Your game files are read in this browser and are never uploaded.',
    keywords: ['scummvm', 'own copy', 'old copy', 'my games', 'monkey island', 'day of the tentacle', 'sam and max', 'full throttle', 'kings quest', 'space quest', 'broken sword', 'simon the sorcerer', 'discworld', 'kyrandia', 'lucasarts', 'sierra', 'adventure', 'point and click'],
    links: {
      licence: 'classics/scummvm/COPYING.txt',
      source: 'classics/scummvm/index.html#source',
      about: 'classics/scummvm/index.html',
    },
    run: {
      type: 'wasm',
      glue: 'classics/scummvm/scummvm-own.js.gz',
      wasm: 'classics/scummvm/scummvm-own.wasm.gz',
      /* the engines' own data files, which the original games never shipped */
      mount: ['queen.tbl', 'lure.dat', 'drascula.dat', 'sky.cpt', 'kyra.dat', 'toon.dat']
        .map(f => ({ file: `classics/scummvm/data/${f}.gz`, to: `/data/${f}` })),
      /* --auto-detect: ScummVM looks in the picked folder and starts the game it finds. (Its own
         list of games, the launcher, aborts in this build, so it is not offered.) */
      args: ['--path=/game', '--extrapath=/data', '--savepath=/saves', '--config=/saves/scummvm.ini', '--auto-detect'],
      watch: ['/saves'],
      aspect: 4 / 3,
      sandbox: 'allow-scripts',
    },
    own: {
      only: true,
      pick: 'folder',
      what: 'your game’s folder',
      to: '/game',
      check: () => '',
    },
  },
];

/** "Mouse only" — the controls hint on a card, and Controller Center's reason. */
export const CONTROLS = {
  mouse: { label: 'Mouse only', icon: 'mouse-pointer' },
  keyboard: { label: 'Keyboard only', icon: 'keyboard' },
  both: { label: 'Mouse and keyboard', icon: 'keyboard' },
};
export const controlsOf = g => CONTROLS[g?.controls] || CONTROLS.both;

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
