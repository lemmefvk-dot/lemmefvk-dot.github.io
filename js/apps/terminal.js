/* ============================================================
   Static Terminal — staticsh, a real shell over the vfs.
   Every command runs against api.vfs / api.store for real;
   neofetch is the showpiece. Scrollback + a prompt row that is
   always the last line. All colour comes from .term__* in
   css/apps.css — nothing here hardcodes a hex.

   It opens as a normal window anywhere; on the Linux drive the
   wallpaper terminal (shell/deskterm.js) mounts this same engine.

   Pipes: `a | b | c`. Each stage's output is collected (put() fills
   `cap` instead of the screen) and handed to the next command as its
   stdin, the fourth argument of run(). Messages meant for the person
   (ok, dim, err) always go to the screen. `> file` and `>> file` on a
   stage write its output to a file.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as UC from '../core/usercmds.js';
import * as M from '../core/metrics.js';

const BOOT = Date.now();
const ACCENTS = ['aether', 'violet', 'azure', 'mint', 'amber'];
/* the first accent is stored as 'aether' but called "static" to the person */
const accentName = id => (id === 'aether' ? 'static' : id);
const accentId = name => (name === 'static' ? 'aether' : name);
const NA = 'not available to a web page';

/* palette swatches for neofetch — tokens, not literals */
const PAL = ['--bg-2', '--aether-900', '--aether-700', '--aether-500',
             '--aether-300', '--aether-100', '--ink-3', '--ink-0'];

/* pure-ASCII Static mark: a faceted diamond.
   Column-aligned and mirrored about column 13 — keep it that way. */
const ART = [
  '           /\\',
  '          /  \\',
  '         /\\  /\\',
  '        /  \\/  \\',
  '       /\\  /\\  /\\',
  '      /  \\/  \\/  \\',
  '     /____\\/____\\/__\\',
  '     \\    /\\    /\\  /',
  '      \\  /  \\  /  \\/',
  '       \\/____\\/____/',
  '        \\    /\\   /',
  '         \\  /  \\ /',
  '          \\/____\\/',
  '',
  '      s t a t i c',
];

const GROUPS = [
  ['Filesystem', ['ls', 'cd', 'pwd', 'cat', 'tree', 'find', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'echo', 'open', 'stat', 'du', 'zip', 'unzip']],
  ['Text', ['grep', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'diff']],
  ['System', ['neofetch', 'uname', 'whoami', 'hostname', 'date', 'uptime', 'df', 'free', 'ps', 'top', 'metrics']],
  ['Network', ['curl', 'proxy', 'weather', 'define']],
  ['Tools', ['calc', 'hash', 'base64', 'rot13', 'reverse', 'count', 'color', 'uuid']],
  ['Fun', ['roll', 'flip', '8ball', 'matrix']],
  ['Library', ['games', 'anime', 'roblox']],
  ['Productivity', ['todo', 'note', 'timer']],
  ['Shell', ['help', 'history', 'clear', 'exit', 'apps', 'launch', 'close', 'settings', 'system', 'theme', 'wallpaper', 'music', 'volume', 'notify', 'which', 'man', 'alias', 'unalias', 'static', 'command']],
];

const ALIAS = { fetch: 'neofetch', cls: 'clear', quit: 'exit', '?': 'help', aether: 'static' };

/* ---------------- manual pages ------------------------------------------
   `man <command>` prints NAME, SYNOPSIS (from the command), DESCRIPTION,
   OPTIONS, EXAMPLES and SEE ALSO. Every command has an entry here; the
   terminal suite checks that none is missing. e: [what you type, what it does]. */
const MAN = {
  ls: { d: 'Lists what is in a folder. With several paths it labels each one.', o: [['-a', 'include hidden names (starting with a dot)'], ['-l', 'one line each: permissions, size, date, name']], e: [['ls', 'the current folder'], ['ls -l ~/Documents', 'details for Documents'], ['ls | grep png', 'only the names containing png']], s: ['tree', 'find', 'cd'] },
  cd: { d: 'Changes the current folder. With no path it goes home; "-" goes back to the previous folder.', o: [], e: [['cd Documents', 'into Documents'], ['cd ..', 'up one'], ['cd -', 'back where you were']], s: ['pwd', 'ls'] },
  pwd: { d: 'Prints the full path of the current folder.', o: [], e: [['pwd', 'where am I']], s: ['cd'] },
  cat: { d: 'Prints files. With several it labels each. In a pipe, with no file, it passes its input through.', o: [], e: [['cat notes.txt', 'show a file'], ['cat a.txt b.txt', 'both, labelled'], ['cat notes.txt | wc -l', 'count its lines']], s: ['head', 'tail', 'grep'] },
  tree: { d: 'Draws a folder and what is inside it, two levels deep unless told otherwise (at most 5).', o: [['-L N', 'how many levels']], e: [['tree', 'this folder'], ['tree -L 3 ~/Documents', 'three levels']], s: ['ls', 'find'] },
  find: { d: 'Searches every file and folder name in StaticOS for some text.', o: [], e: [['find report', 'names containing "report"']], s: ['grep', 'ls'] },
  mkdir: { d: 'Makes folders. The parent has to exist.', o: [], e: [['mkdir Notes', 'one folder'], ['mkdir a b c', 'three']], s: ['touch', 'rm'] },
  touch: { d: 'Makes an empty file, or marks an existing one as just changed.', o: [], e: [['touch todo.txt', 'new empty file']], s: ['mkdir', 'echo'] },
  rm: { d: 'Removes files or folders by moving them to the Trash. Inside the Trash it deletes for good.', o: [['-r', 'needed for a folder']], e: [['rm old.txt', 'to the Trash'], ['rm -r Old', 'a folder and what is in it']], s: ['mv', 'ls'] },
  mv: { d: 'Moves a file or folder into another folder, or renames it.', o: [], e: [['mv a.txt Documents', 'move into Documents'], ['mv a.txt b.txt', 'rename']], s: ['cp', 'rm'] },
  cp: { d: 'Copies a file, or a whole folder with -r.', o: [['-r', 'copy a folder and what is in it']], e: [['cp a.txt b.txt', 'a copy'], ['cp -r Photos Backup', 'a folder']], s: ['mv', 'zip'] },
  echo: { d: 'Prints its words. "> file" writes them to a file instead, ">> file" adds to the end.', o: [], e: [['echo hello', 'print hello'], ['echo buy milk >> todo.txt', 'add a line to a file'], ['echo b a b | wc -w', 'in a pipe']], s: ['cat', 'touch'] },
  open: { d: 'Opens a file in the app that handles it.', o: [], e: [['open photo.png', 'in Photos'], ['open notes.txt', 'in Notes']], s: ['launch'] },
  stat: { d: 'Shows a file\'s type and size, and its line count or the number of items.', o: [], e: [['stat notes.txt', 'details']], s: ['du', 'ls'] },
  du: { d: 'Adds up how much space a folder takes and how many files are in it.', o: [], e: [['du', 'this folder'], ['du ~/Pictures', 'Pictures']], s: ['stat', 'df'] },
  zip: { d: 'Packs files and folders into a real .zip beside them. They must all be in one folder. A name already taken gets " 2", " 3"…, nothing is overwritten.', o: [], e: [['zip Documents', 'makes Documents.zip'], ['zip homework.zip a.txt b.txt', 'a named archive'], ['unzip -l homework.zip', 'look inside']], s: ['unzip', 'cp'] },
  unzip: { d: 'Unpacks a .zip into a new folder named after it.', o: [['-l', 'only list what is inside'], ['-h', 'unpack here, in the archive\'s own folder']], e: [['unzip homework.zip', 'into a folder'], ['unzip -l homework.zip', 'the contents']], s: ['zip'] },
  grep: { d: 'Prints the lines that match a pattern (a regular expression), from files or from a pipe.', o: [['-i', 'ignore case'], ['-n', 'show line numbers'], ['-v', 'lines that do not match'], ['-c', 'only count the matching lines'], ['-r', 'search inside a folder']], e: [['grep -i hello notes.txt', 'in one file'], ['grep -rn TODO ~/Code', 'through a folder'], ['ls | grep png', 'in a pipe']], s: ['find', 'sort', 'wc'] },
  head: { d: 'Prints the first lines of a file or of piped text (10 unless told).', o: [['-n N', 'how many lines (head -3 works too)']], e: [['head -n 5 notes.txt', 'first five'], ['ls | head -3', 'first three names']], s: ['tail', 'cat'] },
  tail: { d: 'Prints the last lines of a file or of piped text (10 unless told).', o: [['-n N', 'how many lines (tail -3 works too)']], e: [['tail log.txt', 'the last ten'], ['history | tail -5', 'your last five commands']], s: ['head', 'cat'] },
  wc: { d: 'Counts lines, words and bytes in files or piped text.', o: [['-l', 'lines only'], ['-w', 'words only'], ['-c', 'bytes only']], e: [['wc notes.txt', 'all three'], ['cat notes.txt | wc -l', 'just the lines']], s: ['grep', 'count'] },
  sort: { d: 'Sorts lines alphabetically, from files or a pipe.', o: [['-r', 'reverse'], ['-n', 'by the number each line starts with'], ['-u', 'drop repeated lines']], e: [['sort names.txt', 'A to Z'], ['ls | sort -r', 'Z to A']], s: ['uniq', 'cut'] },
  uniq: { d: 'Collapses lines that repeat right after each other. Sort first to catch every repeat.', o: [['-c', 'put the number of repeats in front'], ['-d', 'only lines that repeat']], e: [['sort words.txt | uniq -c', 'how often each word appears']], s: ['sort', 'wc'] },
  cut: { d: 'Takes part of each line: some fields split by a character, or some characters.', o: [['-d C', 'the character that splits fields (tab if left out)'], ['-f LIST', 'which fields: 1, 1,3 or 2-4'], ['-c LIST', 'which characters, same kind of list']], e: [['cut -d , -f 2 data.csv', 'the second column of a CSV'], ['cut -c 1-3 names.txt', 'the first three letters']], s: ['sort', 'grep'] },
  diff: { d: 'Shows how two text files differ: lines starting with - are only in the first, + only in the second, with two lines of context around each change.', o: [], e: [['diff old.txt new.txt', 'what changed']], s: ['cat', 'grep'] },
  neofetch: { d: 'Prints a card about this StaticOS: only what the browser can really tell, with "not available" where it cannot.', o: [], e: [['neofetch', 'the card']], s: ['system', 'uname'] },
  uname: { d: 'Prints the system name; -a adds the host, platform and browser. A web page has no kernel, so there is no version.', o: [['-a', 'everything it knows']], e: [['uname -a', 'the full line']], s: ['neofetch'] },
  whoami: { d: 'Prints your handle.', o: [], e: [['whoami', 'who am I']], s: ['hostname'] },
  hostname: { d: 'Prints this computer\'s name inside StaticOS.', o: [], e: [['hostname', 'its name']], s: ['whoami'] },
  date: { d: 'Prints today\'s date and the time.', o: [], e: [['date', 'right now']], s: ['uptime', 'timer'] },
  uptime: { d: 'How long this page has been open. The browser does not know when the computer started.', o: [], e: [['uptime', 'session time']], s: ['top'] },
  df: { d: 'Shows this site\'s storage quota as the browser reports it. Disks and other mounts are not visible to a web page.', o: [], e: [['df', 'used and free']], s: ['du', 'free'] },
  free: { d: 'Shows the JavaScript heap where the browser reports it (Chromium). Total and free RAM are not visible to a web page.', o: [], e: [['free', 'memory']], s: ['top', 'df'] },
  ps: { d: 'Lists the windows open in this session. Other processes cannot be seen from a web page.', o: [], e: [['ps', 'open windows']], s: ['top', 'close'] },
  top: { d: 'A snapshot of what the browser can measure: open windows, JS heap and storage.', o: [], e: [['top', 'a snapshot']], s: ['metrics', 'ps'] },
  metrics: { d: 'Real readings: frame rate, heap, storage, transfer, page load, cores and windows, then a list of what a browser cannot measure.', o: [], e: [['metrics', 'everything measurable']], s: ['top'] },
  apps: { d: 'Lists every installed app with its id and category.', o: [], e: [['apps', 'the list'], ['apps | grep -i games', 'search it']], s: ['launch'] },
  launch: { d: 'Opens an app by its id (see apps).', o: [], e: [['launch calculator', 'open Calculator']], s: ['apps', 'close'] },
  close: { d: 'Closes an app\'s windows, or all of them with "all". The terminal itself stays.', o: [], e: [['close notes', 'close Notes'], ['close all', 'close every window']], s: ['launch', 'ps'] },
  settings: { d: 'Opens Settings, optionally at one section.', o: [], e: [['settings', 'open it'], ['settings keyboard', 'at Keyboard']], s: ['theme', 'wallpaper'] },
  system: { d: 'A snapshot of this StaticOS: version, drive, windows, apps, connection and storage.', o: [], e: [['system', 'the snapshot']], s: ['neofetch'] },
  theme: { d: 'Sets the accent colour: static, violet, azure, mint or amber.', o: [], e: [['theme mint', 'switch to mint']], s: ['static', 'wallpaper'] },
  wallpaper: { d: 'Lists wallpapers (the current one has a star) or sets one by id.', o: [], e: [['wallpaper', 'list them'], ['wallpaper <id>', 'set one']], s: ['theme', 'settings'] },
  music: { d: 'Controls the Music app: play, pause, next, prev, open, or status for what is playing.', o: [], e: [['music play', 'play'], ['music status', 'what is on']], s: ['volume'] },
  volume: { d: 'Sets the output volume from 0 to 100.', o: [], e: [['volume 40', 'forty percent']], s: ['music'] },
  notify: { d: 'Raises a desktop notification with your words.', o: [], e: [['notify build finished', 'a toast']], s: ['timer'] },
  which: { d: 'Says whether a command exists in this shell and what an alias stands for.', o: [], e: [['which ls', 'is it there'], ['which fetch', 'an alias for neofetch']], s: ['man', 'alias'] },
  man: { d: 'Shows the manual page for a command, including your own aliases and commands.', o: [], e: [['man grep', 'how grep works'], ['help', 'every command, one line each']], s: ['help', 'which'] },
  help: { d: 'Lists every command in groups, then your own commands.', o: [], e: [['help', 'the list'], ['help | grep -i zip', 'find one']], s: ['man'] },
  history: { d: 'Prints the commands you typed in this terminal. Press Ctrl+R to search them as you type.', o: [['-c', 'forget them all']], e: [['history', 'the list'], ['history | grep git', 'search it'], ['history -c', 'clear it']], s: ['alias'] },
  clear: { d: 'Wipes the scrollback. Ctrl+L does the same.', o: [], e: [['clear', 'start fresh']], s: ['history'] },
  exit: { d: 'Closes this terminal window. On the Linux desktop it logs out and starts a fresh session.', o: [], e: [['exit', 'bye']], s: ['close'] },
  alias: { d: 'Gives a command a short name. Aliases are saved as lines in ~/.staticrc, which runs each time a terminal starts. With no arguments it lists them. Edit ~/.staticrc in Notes or Code to add any commands you want at start.', o: [], e: [['alias gs=games', 'gs now runs games'], ['alias ll="ls -l"', 'with options'], ['alias', 'list them']], s: ['unalias', 'which'] },
  unalias: { d: 'Removes an alias, and its line in ~/.staticrc.', o: [], e: [['unalias gs', 'forget gs']], s: ['alias'] },
  todo: { d: 'Your Static Tasks list, from the terminal. It reads and writes the same lists as the Tasks app and the To-dos widget. Numbers stay the same between listings.', o: [['add TEXT --due DAY', 'a new task; DAY is today, tomorrow or YYYY-MM-DD'], ['done N / undo N', 'tick or untick task N'], ['rm N', 'delete task N'], ['-a', 'with the list: show finished ones too']], e: [['todo add read chapter 4 --due tomorrow', 'a task due tomorrow'], ['todo', 'the open ones'], ['todo done 2', 'tick the second']], s: ['note', 'timer'] },
  note: { d: 'Your Notes, from the terminal: the same notes the Notes app shows. Close the Notes window first when adding, or it would overwrite the new note.', o: [['add TEXT', 'a new note'], ['show N', 'print note N'], ['open [N]', 'open Notes, at note N']], e: [['note add call dentist friday', 'a quick note'], ['note', 'the list'], ['note show 1', 'read it']], s: ['todo', 'timer'] },
  timer: { d: 'Starts a timer that goes off with a notification, using the same reminders as the rest of StaticOS (they show in Reminders). From 1 second to 24 hours.', o: [['list', 'running timers'], ['rm N', 'cancel timer N']], e: [['timer 10m', 'ten minutes'], ['timer 1h30m tea', 'a labelled one'], ['timer list', 'what is running']], s: ['todo', 'notify'] },
  static: { d: 'Controls StaticOS itself: accents, the dock, and a short about card.', o: [], e: [['static theme list', 'the accents'], ['static theme set violet', 'change it'], ['static dock reset', 'default dock'], ['static about', 'a short card']], s: ['theme', 'system'] },
  command: { d: 'Makes your own commands out of small JavaScript files. They run in a sandbox: they cannot see your files, settings or accounts, and stop after 20 seconds or Ctrl+C.', o: [], e: [['command new hello', 'start from a template'], ['command list', 'yours'], ['command remove hello', 'to the Trash']], s: ['help'] },
  games: { d: 'Searches the Static Games catalogue by name.', o: [], e: [['games mario', 'matches'], ['launch aether-games', 'open the app']], s: ['anime', 'roblox'] },
  roblox: { d: 'Searches Roblox experiences in the catalogue, with how many are playing.', o: [], e: [['roblox obby', 'matches']], s: ['games'] },
  anime: { d: 'Searches the anime library by title.', o: [], e: [['anime naruto', 'matches']], s: ['games'] },
  curl: { d: 'Fetches a URL through the Static proxy and prints the readable text.', o: [], e: [['curl example.com', 'a page as text']], s: ['proxy'] },
  proxy: { d: 'Opens Static Proxy, optionally at a site.', o: [], e: [['proxy example.com', 'open there']], s: ['curl'] },
  weather: { d: 'The current weather for a city, from Open-Meteo (needs internet).', o: [], e: [['weather Paris', 'now in Paris']], s: ['define'] },
  define: { d: 'Looks a word up in dictionaryapi.dev (needs internet).', o: [], e: [['define serendipity', 'its meanings']], s: ['weather'] },
  calc: { d: 'A calculator for + - * / % ^ and ( ), with sqrt, sin, cos, tan, abs, log, ln, round, floor, ceil, pi and e.', o: [], e: [['calc 2 * (3 + 4)', '14'], ['calc sqrt(144)', '12']], s: ['count'] },
  hash: { d: 'The SHA-256 of some text, as 64 hex characters.', o: [], e: [['hash hello', 'its SHA-256']], s: ['base64', 'uuid'] },
  base64: { d: 'Encodes text as base64, or decodes it with -d.', o: [['-d', 'decode']], e: [['base64 hello', 'aGVsbG8='], ['base64 -d aGVsbG8=', 'hello']], s: ['hash', 'rot13'] },
  rot13: { d: 'Rotates every letter 13 places; do it twice to undo it.', o: [], e: [['rot13 hello', 'uryyb']], s: ['base64'] },
  reverse: { d: 'Prints text backwards.', o: [], e: [['reverse stressed', 'desserts']], s: ['rot13'] },
  count: { d: 'Counts the characters, words and lines of the text you type after it.', o: [], e: [['count the quick brown fox', 'counts']], s: ['wc'] },
  color: { d: 'Shows a colour with its rgb and hsl values.', o: [], e: [['color #ff456d', 'a swatch'], ['color 0af', 'short hex works']], s: ['theme'] },
  uuid: { d: 'Makes a random UUID.', o: [], e: [['uuid', 'a fresh one']], s: ['hash'] },
  roll: { d: 'Rolls dice written like 2d6 (two six-sided dice). The default is one d6.', o: [], e: [['roll 2d6', 'two dice'], ['roll d20', 'one twenty-sided']], s: ['flip', '8ball'] },
  flip: { d: 'Flips a coin.', o: [], e: [['flip', 'heads or tails']], s: ['roll'] },
  '8ball': { d: 'Ask a yes/no question and get an answer.', o: [], e: [['8ball will it rain', 'it shakes']], s: ['flip'] },
  matrix: { d: 'Digital rain for a few seconds. Press any key to stop it.', o: [], e: [['matrix', 'rain']], s: ['cmatrix'] },
  cmatrix: { d: 'The same as matrix.', o: [], e: [['cmatrix', 'rain']], s: ['matrix'] },
  fortune: { d: 'A fortune.', o: [], e: [['fortune', 'one fortune']], s: ['cowsay'] },
  cowsay: { d: 'A cow says your words.', o: [], e: [['cowsay moo', 'a cow']], s: ['fortune'] },
  sl: { d: 'What happens when you mistype ls.', o: [], e: [['sl', 'choo choo']], s: ['ls'] },
  sudo: { d: 'Not in the sudoers file. This incident will be reported (nowhere).', o: [], e: [['sudo rm -rf /', 'no']], s: ['whoami'] },
};

const tokenize = s => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(t => t.replace(/^["']|["']$/g, ''));

function parseArgs(args) {
  const flags = new Set(), rest = [];
  for (const a of args) {
    if (a.length > 1 && a[0] === '-' && a !== '--' && !/^-\d/.test(a)) for (const c of a.slice(1)) flags.add(c);
    else rest.push(a);
  }
  return { flags, rest };
}

const commonPrefix = list => {
  let p = list[0] || '';
  for (const s of list) { while (s.slice(0, p.length) !== p) p = p.slice(0, -1); }
  return p;
};

defineApp({
  id: 'terminal',
  name: 'Static Terminal',
  icon: 'terminal',
  g1: '#6f7a91', g2: '#1b1f2b',
  category: 'System',
  keywords: ['terminal', 'shell', 'console', 'staticsh', 'cli', 'command line', 'bash', 'neofetch'],
  desc: 'A working shell for StaticOS',
  /* A normal window. On the Linux drive the same engine is also mounted
     into the wallpaper by shell/deskterm.js, which answers open('terminal')
     there unless a window is asked for ({ window: true }). */
  win: { w: 680, h: 420, minW: 380, minH: 200, class: 'win--terminal' },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, fmt, store } = api;

    /* ---------------- state ---------------- */
    /** A caller-supplied cwd is only usable if it is a live directory. */
    const dirArg = p => {
      if (!p) return null;
      const n = vfs.node(p);
      return n && n.type === 'dir' ? vfs.norm(p) : null;
    };

    /* An embedder (the Linux wallpaper terminal, shell/bootpicker.js) can
       re-dress the same engine: its own neofetch art and user@host. */
    const EMB = !!opts?.embedded;
    /* neofetch's colour blocks: the embedder may pass real colours (the
       Linux terminal uses the eight ANSI ones); default is the token ramp */
    const PALETTE = Array.isArray(opts?.palette) ? opts.palette : PAL.map(tok => `var(${tok})`);
    const ART_LINES = Array.isArray(opts?.art) ? opts.art : ART;
    const WHO = typeof opts?.who === 'string' && opts.who ? opts.who : 'static@staticos';

    const S = {
      cwd: dirArg(opts?.cwd) || vfs.HOME,
      hist: [], hi: -1, draft: '',
      old: vfs.HOME, back: [], fwd: [],
      running: null,          /* a custom command in flight: { name, stop } */
      alias: new Map(),       /* alias name -> what it stands for (saved in ~/.staticrc) */
      rc: false,              /* ~/.staticrc is running: stay quiet, don't rewrite it */
    };
    const RC_FILE = () => `${vfs.HOME}/.staticrc`;
    /* a pipeline stage's output: put() fills this instead of the screen */
    let cap = null;

    /* ---------------- dom ------------------ */
    const input = h('input', {
      type: 'text', spellcheck: 'false', autocomplete: 'off',
      autocapitalize: 'off', 'aria-label': EMB ? 'Shell input — Esc leaves the terminal' : 'Shell input',
    });
    const ps1Path = h('span.term__path');
    const ps1User = h('span.term__ps1', { text: WHO });
    const inRow = h('div.term__in',
      ps1User,
      ps1Path,
      h('span.term__dim', { text: ']$' }),
      input);
    /* a log region, so each command's output is announced to screen readers */
    const out = h('div.term__out', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Terminal output' }, inRow);
    root.appendChild(h('div.app.app--col', h('div.term' + (EMB ? '.term--embedded' : ''), out)));

    /* ---------------- writing -------------- */
    const L = (...kids) => h('span.term__line', ...kids);
    const T = (t, cls) => h(cls ? `span.${cls}` : 'span', { text: String(t) });
    function show(...nodes) {
      for (const n of nodes.flat()) if (n) out.insertBefore(n, inRow);
      out.scrollTop = out.scrollHeight;
    }
    /* command output: collected when it feeds a pipe, else printed */
    function put(...nodes) {
      if (cap) { for (const n of nodes.flat()) if (n) cap.push(n.textContent); return; }
      show(...nodes);
    }
    const say = (t, cls) => put(L(T(t, cls)));
    /* messages to the person always reach the screen, never a pipe */
    const msg = (t, cls) => show(L(T(t, cls)));
    const err = t => msg(t, 'term__err');
    const ok = t => msg(t, 'term__ok');
    const dim = t => msg(t, 'term__dim');
    const gap = () => put(L(T(' ')));
    /* inline chip — the kit has no inline swatch, so this is a one-off style */
    const swatch = bg => h('i', { style: {
      display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', background: bg,
    } });
    const usage = n => err(`usage: ${CMDS[n].u}`);

    const sp = p => p === vfs.HOME ? '~'
      : p.startsWith(vfs.HOME + '/') ? '~' + p.slice(vfs.HOME.length) : p;
    const spDir = p => p === '/' ? '/' : sp(p) + '/';

    function resolve(a) {
      if (!a || a === '.') return S.cwd;
      if (a === '~') return vfs.HOME;
      if (a.startsWith('~/')) return vfs.norm(vfs.HOME + a.slice(1));
      if (a.startsWith('/')) return vfs.norm(a);
      return vfs.norm(`${S.cwd === '/' ? '' : S.cwd}/${a}`);
    }

    function echoCmd(cmd) {
      put(L(h('span.term__ps1', { text: WHO }), ' ',
        h('span.term__path', { text: sp(S.cwd) }),
        h('span.term__dim', { text: ']$ ' }),
        T(cmd)));
    }

    function clearOut() {
      for (const n of [...out.childNodes]) if (n !== inRow) out.removeChild(n);
    }

    /* Measure the real glyph width off the prompt (WHO.length mono chars)
       instead of guessing it — a guessed-too-narrow char wraps every ls row. */
    function termCols() {
      const w = ps1User.getBoundingClientRect?.().width || 0;
      const cw = w > 0 ? w / WHO.length : 6.6;
      return Math.max(20, Math.floor((out.clientWidth - 40) / cw));
    }

    /* ---------------- cwd ------------------ */
    function paintPs1() {
      ps1Path.textContent = sp(S.cwd);
      win.setSubtitle(sp(S.cwd));
      btnBack.disabled = !S.back.length;
      btnFwd.disabled = !S.fwd.length;
    }
    function setCwd(p, record = true) {
      if (record && p !== S.cwd) { S.back.push(S.cwd); S.fwd.length = 0; }
      S.old = S.cwd;
      S.cwd = p;
      paintPs1();
    }
    function hop(dir) {
      const from = dir < 0 ? S.back : S.fwd, to = dir < 0 ? S.fwd : S.back;
      /* skip entries whose directory has since been deleted */
      let next = null;
      while (from.length && next === null) next = dirArg(from.pop());
      if (next === null) { paintPs1(); input.focus(); return; }
      to.push(S.cwd);
      S.old = S.cwd;
      S.cwd = next;
      echoCmd(`cd ${sp(S.cwd)}`);
      paintPs1();
      input.focus();
    }

    /* ---------------- system bits ---------- */
    /* Session uptime: how long this page has been open. The browser knows
       nothing about when the computer started. */
    const upSecs = () => Math.floor(performance.now() / 1000);
    function upStr() {
      const s = upSecs(), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60);
      const parts = [];
      if (hh) parts.push(`${hh} hour${hh === 1 ? '' : 's'}`);
      parts.push(`${mm} min${mm === 1 ? '' : 's'}`);
      return parts.join(', ');
    }
    const clockStr = (d = new Date()) =>
      `${fmt.pad2(d.getHours())}:${fmt.pad2(d.getMinutes())}:${fmt.pad2(d.getSeconds())}`;
    /* navigator.deviceMemory is rounded and capped by the browser (never above 8) */
    const memHint = () => (navigator.deviceMemory ? `${navigator.deviceMemory} GB or more (rounded by the browser)` : NA);
    const meter = (pct, w = 16) => {
      const n = fmt.clamp(Math.round(pct / 100 * w), 0, w);
      return `[${'#'.repeat(n)}${'-'.repeat(w - n)}]`;
    };
    const heat = pct => pct >= 80 ? 'term__err' : pct >= 55 ? 'term__key' : 'term__ok';

    /* ---------------- neofetch ------------- */
    function fetchBlock() {
      const sys = api.system, hw = M.hardware(), u = store.get('user.handle', 'static');
      const rows = [
        ['OS', sys.os],
        ['Host', `${hw.browser} on ${hw.platform}`],
        ['Uptime', `${upStr()} (this session)`],
        ['Shell', sys.shell],
        ['Display', `${hw.screen} @ ${hw.dpr}x`],
        ['DE', sys.de],
        ['WM', sys.wm],
        /* the live accent — a drive or a wallpaper theme may be tinting it */
        ['Theme', `${sys.theme} / accent ${getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || accentName(store.get('prefs.accent'))}`],
        ['Icons', sys.icons],
        ['Terminal', sys.term],
        ['CPU', hw.cores ? `${hw.cores} logical cores (model ${NA})` : NA],
        ['GPU', NA],
        ['Memory', memHint()],
      ];
      const head = opts?.who ? WHO : `${u}@${sys.hostname}`;
      const kv = h('dl.term__kv',
        h('dt.term__kv-head', { style: { gridColumn: '1 / -1' }, text: head }),
        h('dt.term__kv-rule', { style: { gridColumn: '1 / -1' }, text: '-'.repeat(head.length) }),
        rows.map(([k, v]) => [h('dt', { text: k + ':' }), h('dd', { text: v })]));
      const pal = h('div.term__pal',
        PALETTE.map(bg => h('i', { style: { background: bg } })));
      return h('div.term__fetch',
        h('div.term__art', { text: ART_LINES.join('\n'), 'aria-hidden': 'true' }),
        h('div', kv, pal));
    }

    /* ---------------- listings ------------- */
    const permsOf = n => n.type === 'dir' ? 'drwxr-xr-x'
      : /\.(sh|static|aether)$/.test(n.name) ? '-rwxr-xr-x' : '-rw-r--r--';

    function lsLong(kids) {
      dim(`total ${kids.length}`);
      for (const n of kids) {
        const d = new Date(n.mtime);
        const when = `${fmt.monthName(d, 1)} ${String(d.getDate()).padStart(2)} ${fmt.pad2(d.getHours())}:${fmt.pad2(d.getMinutes())}`;
        put(L(
          T(permsOf(n) + '  ', 'term__dim'),
          T('static  static  ', 'term__dim'),
          T(String(n.type === 'dir' ? '-' : fmt.fmtBytes(n.size)).padStart(8) + '  ', 'term__key'),
          T(when + '  ', 'term__dim'),
          T(n.name, n.type === 'dir' ? 'term__path' : null)));
      }
    }

    function lsShort(kids) {
      const wide = Math.min(30, Math.max(...kids.map(n => n.name.length)) + 2);
      const per = Math.max(1, Math.floor(termCols() / wide));
      for (let i = 0; i < kids.length; i += per) {
        const row = L();
        for (const n of kids.slice(i, i + per)) {
          row.appendChild(T(n.name.padEnd(wide), n.type === 'dir' ? 'term__path'
            : n.kind === 'code' ? 'term__key' : null));
        }
        put(row);
      }
    }

    function treeOf(path, depth) {
      let dirs = 0, files = 0, printed = 0;
      put(L(T(sp(path), 'term__path')));
      const walkDir = (p, prefix, lvl) => {
        const kids = vfs.ls(p);
        kids.forEach((n, i) => {
          if (printed > 400) return;
          const last = i === kids.length - 1;
          printed++;
          n.type === 'dir' ? dirs++ : files++;
          put(L(T(prefix + (last ? '└── ' : '├── '), 'term__dim'),
            T(n.name, n.type === 'dir' ? 'term__path' : null)));
          if (n.type === 'dir' && lvl < depth) walkDir(`${p}/${n.name}`, prefix + (last ? '    ' : '│   '), lvl + 1);
        });
      };
      walkDir(path, '', 1);
      if (!dirs && !files) dim('  (empty)');
      dim(`${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`);
    }

    function copyInto(n, destDir, name) {
      if (n.type === 'file') vfs.write(`${destDir}/${name}`, n.content || '');
      else {
        vfs.mkdir(`${destDir}/${name}`);
        /* snapshot: mkdir/write mutate the array we are walking */
        for (const c of [...n.children]) copyInto(c, `${destDir}/${name}`, c.name);
      }
    }

    /** true when `dest` is `src` itself or lives underneath it */
    const inside = (dest, src) => dest === src || dest.startsWith(src + '/');

    function setAccent(name) {
      const v = accentId(name);
      if (!ACCENTS.includes(v)) { err(`theme: unknown accent '${name}' — ${ACCENTS.map(accentName).join(', ')}`); return; }
      store.set('prefs.accent', v);
      document.documentElement.setAttribute('data-accent', v);
      api.bus.emit('theme:change', api.prefs);
      ok(`accent set to ${accentName(v)}`);
    }

    /* ---------------- commands ------------- */
    const CMDS = {};
    const cmd = (name, u, d, run) => { CMDS[name] = { u, d, run }; };

    cmd('help', 'help', 'list every command', () => {
      put(L(T('staticsh 3.0.1', 'term__ok'), T('  —  StaticOS shell', 'term__dim')));
      for (const [label, names] of GROUPS) {
        gap();
        say(label.toUpperCase(), 'term__dim');
        for (const n of names) put(L(T('  ' + n.padEnd(11), 'term__key'), T(CMDS[n].d, null)));
      }
      const mine = UC.list();
      gap();
      say('YOUR COMMANDS', 'term__dim');
      if (mine.length) for (const n of mine) put(L(T('  ' + n.padEnd(11), 'term__key'), T('your command (~/.commands)', null)));
      else dim("  none yet — 'command new <name>' or 'command import <name>'");
      gap();
      dim('Tab completes · ↑/↓ history · ⌃R search history · ⌃L clear · ⌃C cancel · ⌃D exit');
    });

    /* ---------------- your own commands (core/usercmds.js) ---------- */
    const builtin = n => !!(CMDS[n] || ALIAS[n]);
    const nameOk = n => {
      if (!n) { err('command: give it a name — e.g. command new hello'); return false; }
      if (!UC.NAME_RE.test(n)) { err('command: names are lowercase letters, digits, - and _, starting with a letter'); return false; }
      if (builtin(n)) { err(`command: '${n}' is a built-in command — pick another name`); return false; }
      return true;
    };
    function saveCmd(n, code, from) {
      try {
        const p = UC.save(n, code);
        ok(`saved '${n}' from ${from} → ${p.replace(vfs.HOME, '~')}`);
        dim(`run it: ${n} [words]   ·   edit it: command edit ${n}`);
      } catch (e) { err(`command: ${e.message}`); }
    }
    function importFromComputer(n) {
      const pick = h('input', { type: 'file', accept: '.js,.mjs,.txt,text/javascript,text/plain', style: { display: 'none' } });
      pick.addEventListener('change', async () => {
        const f = pick.files && pick.files[0];
        pick.remove();
        if (!f) return;
        if (f.size > UC.MAX_BYTES) { err(`command: ${f.name} is too big (limit ${UC.MAX_BYTES / 1000} KB)`); return; }
        saveCmd(n, await f.text(), f.name);
      });
      pick.addEventListener('cancel', () => { pick.remove(); dim('import cancelled'); });
      document.body.appendChild(pick);
      pick.click();          /* Enter is the user gesture the file picker needs */
      dim('choose a .js file…');
    }
    async function importFromUrl(n, url) {
      dim(`fetching ${url} …`);
      let res;
      try { res = await fetch(url, { cache: 'no-store', credentials: 'omit' }); }
      catch (e) { err('command: that site did not allow the download (no CORS) or is unreachable. Raw GitHub and gist links work.'); return; }
      if (!res.ok) { err(`command: ${url} answered HTTP ${res.status}`); return; }
      const text = await res.text();
      if (/^\s*<(!doctype|html)/i.test(text)) { err('command: that link is a web page, not code — use the raw file link'); return; }
      saveCmd(n, text, new URL(url).host);
    }

    cmd('command', 'command new|import|edit|show|list|remove', 'make your own commands', (rest, flags, argstr) => {
      const [sub = 'list', n0, ...more] = rest;
      const n = (n0 || '').toLowerCase();
      if (sub === 'list') {
        const mine = UC.list();
        if (!mine.length) { dim("no commands yet — try 'command new hello'"); return; }
        for (const c of mine) put(L(T('  ' + c.padEnd(14), 'term__key'), T((UC.read(c) || '').split('\n').find(x => x.trim()) || '', 'term__dim')));
        return;
      }
      if (sub === 'new') {
        if (!nameOk(n)) return;
        if (UC.has(n)) { err(`command: '${n}' already exists — command edit ${n}`); return; }
        saveCmd(n, UC.TEMPLATE(n), 'the starter template');
        api.openApp('code', { path: UC.fileOf(n) });
        return;
      }
      if (sub === 'import') {
        if (!nameOk(n)) return;
        const src = more.join(' ').trim();
        if (!src) { importFromComputer(n); return; }
        if (/^https:\/\//i.test(src)) return importFromUrl(n, src);
        if (/^http:\/\//i.test(src)) { err('command: use an https:// link'); return; }
        const p = resolve(src);
        const node = vfs.node(p);
        if (!node || node.type !== 'file') { err(`command: no file at ${src}`); return; }
        saveCmd(n, vfs.read(p) || '', src);
        return;
      }
      if (sub === 'edit') {
        if (!UC.has(n)) { err(`command: no command called '${n}'`); return; }
        api.openApp('code', { path: UC.fileOf(n) });
        dim(`opened ${UC.fileOf(n).replace(vfs.HOME, '~')} in Code — save it there, then run ${n}`);
        return;
      }
      if (sub === 'show') {
        const code = UC.read(n);
        if (code == null) { err(`command: no command called '${n}'`); return; }
        for (const line of code.split('\n')) say(line || ' ');
        return;
      }
      if (sub === 'remove' || sub === 'rm') {
        if (!UC.has(n)) { err(`command: no command called '${n}'`); return; }
        UC.remove(n);
        ok(`removed '${n}' (it is in the Trash if you change your mind)`);
        return;
      }
      if (sub === 'help' || sub === '--help') {
        say('command — make your own terminal commands', 'term__ok');
        dim('  command new <name>                 start one from a template, opens in Code');
        dim('  command import <name>              pick a .js file from your computer');
        dim('  command import <name> <file|url>   from a StaticOS file or an https:// link (raw GitHub works)');
        dim('  command edit|show|remove <name>    ·   command list');
        gap();
        dim('Your code gets: args (the words), print(), sleep(ms), env, fetch. Returned values print.');
        dim('It runs in a sandbox: it can’t see your files, settings or accounts. Stops after 20 s or ⌃C.');
        return;
      }
      err("usage: command new|import|edit|show|list|remove <name> — 'command help' for more");
    });

    function runUserCmd(name, rest) {
      if (S.running) { err(`staticsh: '${S.running.name}' is still running — ⌃C to stop it`); return; }
      const u = store.get('session.user', null);
      const env = { user: u ? u.username : 'static', cwd: S.cwd, os: 'StaticOS', version: String(store.get('session.seenVersion') || '4.0') };
      const printLines = (t, cls) => String(t).split('\n').forEach(l => say(l || ' ', cls));
      let r;
      try { r = UC.run(name, rest, { env, onOut: t => printLines(t), onErr: t => printLines(t, 'term__err') }); }
      catch (e) { err(`staticsh: ${e.message}`); return; }
      S.running = { name, stop: r.stop };
      r.done.then(res => {
        S.running = null;
        if (res.code === 130) dim('^C');
        else if (res.code !== 0 && res.reason !== 'timeout' && res.reason !== 'output') dim(`${name}: exited with an error`);
      });
    }

    cmd('neofetch', 'neofetch', 'print the system card', () => put(fetchBlock()));

    /* ---------------- text tools -------------------------------------
       The brief asks for grep-style searching. Doing it properly means
       the usual companions too — a shell where you can find a line but
       not count or slice the file is half a shell. */

    /** Walk a directory tree, yielding file nodes. Shared by grep and du. */
    function* walkFiles(path, depth = 0) {
      const node = vfs.node(path);
      if (!node) return;
      if (node.type !== 'dir') { yield [path, node]; return; }
      if (depth > 8) return;                     /* a cycle would hang the shell */
      for (const kid of vfs.ls(path, { hidden: true })) {
        yield* walkFiles(`${path.replace(/\/$/, '')}/${kid.name}`, depth + 1);
      }
    }

    /** The text a filter reads: the files named, or what was piped in.
        -> [[label, text]…], or null when there is neither. */
    function sources(name, files, stdin) {
      if (!files.length) return stdin != null ? [['', stdin]] : null;
      const got = [];
      for (const a of files) {
        const node = vfs.node(resolve(a));
        if (!node) { err(`${name}: ${a}: No such file or directory`); continue; }
        if (node.type === 'dir') { err(`${name}: ${a}: Is a directory`); continue; }
        got.push([a, String(node.content || '')]);
      }
      return got;
    }
    /* a file's lines: "a\nb\n" is two lines, not three */
    const linesOf = body => { const l = String(body).split('\n'); if (l.length && l[l.length - 1] === '') l.pop(); return l; };

    cmd('grep', 'grep [-i] [-n] [-v] [-c] [-r] <pattern> [path…]', 'search file contents', (rest, flags, argstr, stdin) => {
      if (rest.length < 1) return usage('grep');
      const [pattern, ...paths] = rest;
      let re;
      try { re = new RegExp(pattern, flags.has('i') ? 'i' : ''); }
      catch (e) { return err(`grep: invalid pattern: ${e.message}`); }
      const want = line => re.test(line) !== flags.has('v');

      let hits = 0;
      const scan = (label, body) => {
        let n = 0;
        linesOf(body).forEach((line, i) => {
          if (!want(line)) return;
          n++; hits++;
          if (flags.has('c')) return;
          put(L(
            label ? T(label, 'term__key') : T(''),
            flags.has('n') ? T(`${i + 1}:`, 'term__dim') : T(''),
            T(line.length > 400 ? `${line.slice(0, 400)}…` : line)));
        });
        if (flags.has('c')) put(L(label ? T(label, 'term__key') : T(''), T(String(n))));
      };
      if (!paths.length && stdin != null) { scan('', stdin); if (!hits && !flags.has('c')) dim('no matches'); return; }
      for (const t of paths.length ? paths : ['.']) {
        const base = resolve(t);
        const node = vfs.node(base);
        if (!node) { err(`grep: ${t}: No such file or directory`); continue; }
        if (node.type === 'dir' && !flags.has('r')) { err(`grep: ${t}: Is a directory (use -r)`); continue; }
        const files = node.type === 'dir' ? [...walkFiles(base)] : [[base, node]];
        for (const [path, file] of files) {
          const body = String(file.content || '');
          if (body) scan(files.length > 1 ? `${path}:` : '', body);
        }
      }
      if (!hits && !flags.has('c')) dim('no matches');
    });

    /* `head -n 3 f`, `head -3 f`, `head f`: the count may come as a flag or as -N */
    function countArg(rest, flags) {
      let n = 10, took = false;
      const files = [];
      for (const a of rest) {
        if (/^-\d+$/.test(a)) n = +a.slice(1);
        else if (flags.has('n') && !took && /^\d+$/.test(a)) { n = +a; took = true; }
        else files.push(a);
      }
      return { n: Math.max(1, n), files };
    }
    cmd('head', 'head [-n N] [file…]', 'first lines of a file', (rest, flags, argstr, stdin) => sliceFile('head', rest, flags, stdin, true));
    cmd('tail', 'tail [-n N] [file…]', 'last lines of a file', (rest, flags, argstr, stdin) => sliceFile('tail', rest, flags, stdin, false));
    function sliceFile(name, rest, flags, stdin, fromTop) {
      const { n, files } = countArg(rest, flags);
      const src = sources(name, files, stdin);
      if (!src) return usage(name);
      for (const [label, body] of src) {
        const lines = linesOf(body);
        if (files.length > 1) put(L(T(`==> ${label} <==`, 'term__dim')));
        for (const line of fromTop ? lines.slice(0, n) : lines.slice(-n)) put(L(T(line)));
      }
    }

    cmd('wc', 'wc [-l] [-w] [-c] [file…]', 'count lines, words and bytes', (rest, flags, argstr, stdin) => {
      const src = sources('wc', rest, stdin);
      if (!src) return usage('wc');
      const any = flags.has('l') || flags.has('w') || flags.has('c');
      const row = (l, w, b, label) => put(L(
        ...(!any || flags.has('l') ? [T(String(l).padStart(7), 'term__key')] : []),
        ...(!any || flags.has('w') ? [T(String(w).padStart(8))] : []),
        ...(!any || flags.has('c') ? [T(String(b).padStart(9))] : []),
        T(label ? '  ' + label : '', 'term__dim')));
      let tl = 0, tw = 0, tb = 0;
      for (const [label, body] of src) {
        const l = linesOf(body).length;
        const w = body.trim() ? body.trim().split(/\s+/).length : 0;
        const b = new Blob([body]).size;
        tl += l; tw += w; tb += b;
        row(l, w, b, label);
      }
      if (src.length > 1) row(tl, tw, tb, 'total');
    });

    cmd('sort', 'sort [-r] [-n] [-u] [file…]', 'sort lines', (rest, flags, argstr, stdin) => {
      const src = sources('sort', rest, stdin);
      if (!src) return usage('sort');
      const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
      let lines = src.flatMap(([, body]) => linesOf(body));
      if (flags.has('n')) {
        const num = x => { const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(x); return m ? parseFloat(m[1]) : 0; };
        lines.sort((a, b) => num(a) - num(b) || cmp(a, b));
      } else lines.sort(cmp);
      if (flags.has('u')) lines = lines.filter((l, i) => !i || l !== lines[i - 1]);
      if (flags.has('r')) lines.reverse();
      for (const l of lines) put(L(T(l)));
    });

    cmd('uniq', 'uniq [-c] [-d] [file]', 'collapse repeated neighbouring lines', (rest, flags, argstr, stdin) => {
      const src = sources('uniq', rest.slice(0, 1), stdin);
      if (!src) return usage('uniq');
      const runs = [];
      for (const [, body] of src) {
        for (const l of linesOf(body)) {
          const last = runs[runs.length - 1];
          if (last && last.l === l) last.n++; else runs.push({ l, n: 1 });
        }
      }
      for (const r of runs) {
        if (flags.has('d') && r.n < 2) continue;
        put(L(flags.has('c') ? T(String(r.n).padStart(7) + ' ', 'term__dim') : T(''), T(r.l)));
      }
    });

    /* cut -d <char> -f <fields>   or   cut -c <columns>;  lists like 1,3 and ranges like 2-4 */
    cmd('cut', 'cut -d <char> -f <list>  |  cut -c <list>  [file…]', 'pick fields or characters from each line', (rest, flags, argstr, stdin) => {
      const toks = tokenize(argstr);
      let delim = '\t', fields = null, chars = null;
      const files = [];
      for (let i = 0; i < toks.length; i++) {
        const m = /^-([dfc])(.*)$/.exec(toks[i]);
        if (!m) { files.push(toks[i]); continue; }
        const v = m[2] !== '' ? m[2] : (toks[++i] ?? '');
        if (m[1] === 'd') delim = v; else if (m[1] === 'f') fields = v; else chars = v;
      }
      const spec = fields ?? chars;
      if (spec == null) return usage('cut');
      const parts = [];
      for (const piece of String(spec).split(',')) {
        const m = /^(\d*)(-?)(\d*)$/.exec(piece);
        if (!m || (!m[1] && !m[3])) return err(`cut: invalid list '${spec}'`);
        parts.push([m[1] ? +m[1] : 1, m[2] ? (m[3] ? +m[3] : Infinity) : +m[1]]);
      }
      const inList = k => parts.some(([a, b]) => k >= a && k <= b);
      if (fields != null && [...delim].length !== 1) return err('cut: the delimiter must be a single character');
      const src = sources('cut', files, stdin);
      if (!src) return usage('cut');
      for (const [, body] of src) {
        for (const line of linesOf(body)) {
          if (fields != null) {
            if (!line.includes(delim)) put(L(T(line)));
            else put(L(T(line.split(delim).filter((_, k) => inList(k + 1)).join(delim))));
          } else put(L(T([...line].filter((_, k) => inList(k + 1)).join(''))));
        }
      }
    });

    cmd('diff', 'diff <file1> <file2>', 'show how two files differ', rest => {
      if (rest.length !== 2) return usage('diff');
      const read = a => {
        const node = vfs.node(resolve(a));
        if (!node) { err(`diff: ${a}: No such file or directory`); return null; }
        if (node.type === 'dir') { err(`diff: ${a}: Is a directory`); return null; }
        return linesOf(node.content || '');
      };
      const A = read(rest[0]), B = read(rest[1]);
      if (!A || !B) return;
      if (A.length > 2000 || B.length > 2000) return err('diff: files over 2,000 lines are too long to compare here');
      /* longest common subsequence, then walk it into -/+ lines */
      const n = A.length, m = B.length;
      const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
      }
      const ops = [];
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && A[i] === B[j]) { ops.push([' ', A[i], i + 1, j + 1]); i++; j++; }
        else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { ops.push(['+', B[j], i + 1, j + 1]); j++; }
        else { ops.push(['-', A[i], i + 1, j + 1]); i++; }
      }
      const changed = ops.map((o, k) => (o[0] !== ' ' ? k : -1)).filter(k => k >= 0);
      if (!changed.length) return dim('the files are identical');
      /* hunks: each change with 2 lines of context either side, merged when they touch */
      const hunks = [];
      for (const k of changed) {
        const lo = Math.max(0, k - 2), hi = Math.min(ops.length - 1, k + 2);
        const last = hunks[hunks.length - 1];
        if (last && lo <= last[1] + 1) last[1] = hi; else hunks.push([lo, hi]);
      }
      put(L(T(`--- ${rest[0]}`, 'term__dim')), L(T(`+++ ${rest[1]}`, 'term__dim')));
      for (const [lo, hi] of hunks) {
        const seg = ops.slice(lo, hi + 1);
        const na = seg.filter(o => o[0] !== '+').length, nb = seg.filter(o => o[0] !== '-').length;
        put(L(T(`@@ -${seg[0][2]},${na} +${seg[0][3]},${nb} @@`, 'term__key')));
        for (const [t, line] of seg) put(L(T(t + line, t === '-' ? 'term__err' : t === '+' ? 'term__ok' : null)));
      }
    });

    cmd('stat', 'stat <path…>', 'show file metadata', rest => {
      if (!rest.length) return usage('stat');
      for (const a of rest) {
        const p = resolve(a), node = vfs.node(p);
        if (!node) { err(`stat: ${a}: No such file or directory`); continue; }
        say(p, 'term__key');
        const body = String(node.content || '');
        put(L(T('  type  ', 'term__dim'), T(node.type === 'dir' ? 'directory' : (node.kind || 'file'))));
        put(L(T('  size  ', 'term__dim'), T(fmt.fmtBytes(node.size || new Blob([body]).size))));
        if (node.type === 'dir') {
          put(L(T('  items ', 'term__dim'), T(String(vfs.ls(p, { hidden: true }).length))));
        } else if (body) {
          put(L(T('  lines ', 'term__dim'), T(String(body.split('\n').length))));
        }
      }
    });

    cmd('du', 'du [path]', 'disk usage of a tree', rest => {
      const base = resolve(rest[0] || '.');
      const node = vfs.node(base);
      if (!node) return err(`du: ${rest[0] || '.'}: No such file or directory`);
      let total = 0, count = 0;
      for (const [, file] of walkFiles(base)) {
        total += file.size || new Blob([String(file.content || '')]).size;
        count++;
      }
      put(L(T(fmt.fmtBytes(total).padStart(10), 'term__key'),
            T(`  ${count} file${count === 1 ? '' : 's'}`, 'term__dim'),
            T(`  ${base}`)));
    });

    cmd('which', 'which <command…>', 'locate a command', rest => {
      if (!rest.length) return usage('which');
      for (const a of rest) {
        const name = ALIAS[a] || a;
        if (CMDS[name]) {
          put(L(T(`/usr/bin/${name}`, 'term__ok'),
                T(name !== a ? `  (${a} → ${name})` : '', 'term__dim')));
        } else err(`which: no ${a} in staticsh`);
      }
    });

    cmd('man', 'man <command>', 'the manual page for a command', rest => {
      if (!rest.length) return usage('man');
      const asked = rest[0];
      const name = ALIAS[asked] || asked;
      const c = CMDS[name], page = MAN[name];
      const mineAlias = S.alias.get(asked);
      if (!c && mineAlias != null) {
        say(asked.toUpperCase(), 'term__ok'); gap();
        say('  ALIAS', 'term__dim');
        put(L(T(`    ${asked} stands for: `), T(mineAlias, 'term__key')));
        return dim('    saved in ~/.staticrc — "unalias ' + asked + '" removes it');
      }
      if (!c && UC.has(asked)) {
        say(asked.toUpperCase(), 'term__ok'); gap();
        say('  YOUR COMMAND', 'term__dim');
        put(L(T(`    ${UC.fileOf(asked).replace(vfs.HOME, '~')}`)));
        return dim(`    command show ${asked} prints it · command edit ${asked} changes it`);
      }
      if (!c) return err(`man: no manual entry for ${asked}`);
      say(name.toUpperCase(), 'term__ok');
      gap();
      say('  NAME', 'term__dim');
      put(L(T(`    ${name} - ${c.d}`)));
      gap();
      say('  SYNOPSIS', 'term__dim');
      put(L(T('    ' + c.u, 'term__key')));
      if (page) {
        gap();
        say('  DESCRIPTION', 'term__dim');
        put(L(T('    ' + page.d)));
        if (page.o.length) {
          gap();
          say('  OPTIONS', 'term__dim');
          for (const [f, t] of page.o) put(L(T('    ' + f.padEnd(20), 'term__key'), T(t)));
        }
        gap();
        say('  EXAMPLES', 'term__dim');
        for (const [x, t] of page.e) put(L(T('    $ ' + x.padEnd(32), 'term__key'), T(t, 'term__dim')));
        if (page.s?.length) {
          gap();
          say('  SEE ALSO', 'term__dim');
          put(L(T('    ' + page.s.join(', '))));
        }
      }
      if (ALIAS[asked]) { gap(); dim(`    (${asked} is another name for ${name})`); }
    });

    /* ---------------- zip, unzip (core/archive.js, the Files app's own) ---- */
    const zipLine = r => `${r.files} file${r.files === 1 ? '' : 's'}${r.folders ? `, ${r.folders} folder${r.folders === 1 ? '' : 's'}` : ''}`;
    cmd('zip', 'zip [name.zip] <file|folder…>', 'pack files into a .zip', async rest => {
      let out = null, items = rest.slice();
      if (items.length > 1 && /\.zip$/i.test(items[0]) && !vfs.node(resolve(items[0]))) out = items.shift();
      if (!items.length) return usage('zip');
      const dirs = new Set(), names = [];
      for (const a of items) {
        const p = resolve(a);
        if (!vfs.node(p)) return err(`zip: ${a}: No such file or directory`);
        dirs.add(vfs.parentPath(p)); names.push(vfs.baseName(p));
      }
      if (dirs.size > 1) return err('zip: everything has to be in the same folder — cd there first');
      const dir = [...dirs][0];
      const A = await import('../core/archive.js');
      let r;
      try { r = await A.compress(dir, names); } catch (e) { return err(`zip: ${e.message}`); }
      let final = r.name;
      if (out) {
        const want = /\.zip$/i.test(out) ? out : `${out}.zip`;
        if (vfs.baseName(want) !== want || want === '..') { /* a path: keep the generated name */ dim(`(kept the name ${r.name}: a zip's name can't be a path)`); }
        else if (vfs.node(`${dir}/${want}`)) dim(`(${want} already exists, so it is ${r.name})`);
        else if (vfs.rename(r.path, want)) final = want;
      }
      ok(`${final}: ${zipLine(r)}, ${fmt.fmtBytes(r.size)}`);
      for (const s of r.skipped) dim(`  left out: ${s.name} — ${s.why}`);
    });

    cmd('unzip', 'unzip [-l] [-h] <file.zip>', 'unpack a .zip', async (rest, flags) => {
      if (!rest.length) return usage('unzip');
      const p = resolve(rest[0]);
      const n = vfs.node(p);
      if (!n || n.type !== 'file') return err(`unzip: ${rest[0]}: No such file`);
      const A = await import('../core/archive.js');
      if (flags.has('l')) {
        let l;
        try { l = await A.listing(p); } catch (e) { return err(`unzip: ${e.message}`); }
        say('      Size  Name', 'term__dim');
        for (const e of l.entries) put(L(T((e.dir ? '-' : fmt.fmtBytes(e.size)).padStart(10) + '  ', 'term__key'), T(e.name, e.dir ? 'term__path' : null)));
        return dim(`${l.entries.length} entr${l.entries.length === 1 ? 'y' : 'ies'}, ${fmt.fmtBytes(l.size)} zipped`);
      }
      let r;
      try { r = await A.extract(p, { here: flags.has('h') }); } catch (e) { return err(`unzip: ${e.message}`); }
      ok(`unpacked ${zipLine(r)}${r.folder ? ` into ${sp(r.folder)}/` : ' here'}`);
      for (const s of r.skipped) dim(`  skipped: ${s.name} — ${s.why}`);
    });

    /* ---------------- alias, ~/.staticrc ---------------------------------- */
    const unq = v => v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
    const rcLines = () => { const t = vfs.read(RC_FILE()); return t == null ? [] : String(t).split('\n'); };
    const rcSave = lines => { while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); vfs.write(RC_FILE(), lines.length ? lines.join('\n') + '\n' : ''); };
    const aliasLine = name => new RegExp(`^\\s*alias\\s+${name.replace(/[.\-]/g, '\\$&')}\\s*=`);
    cmd('alias', 'alias [name=command]', 'give a command another name (saved in ~/.staticrc)', (rest, flags, argstr) => {
      if (!argstr) {
        if (!S.alias.size) return dim("no aliases — try: alias ll='ls -l'");
        for (const [k, v] of [...S.alias].sort()) put(L(T(`alias ${k}=`, 'term__key'), T(`'${v}'`)));
        return;
      }
      const m = /^([\w.-]+)\s*=\s*([\s\S]*)$/.exec(argstr);
      if (!m) {
        const v = S.alias.get(argstr.trim());
        return v == null ? err(`alias: ${argstr.trim()}: not found`) : put(L(T(`alias ${argstr.trim()}=`, 'term__key'), T(`'${v}'`)));
      }
      const [, name] = m, value = unq(m[2]);
      if (name === 'alias' || name === 'unalias') return err(`alias: '${name}' can't be an alias`);
      if (!value) return err('alias: what should it stand for? — alias ll="ls -l"');
      if (value.includes("'") && value.includes('"')) return err('alias: use either \' or " inside, not both');
      S.alias.set(name, value);
      if (S.rc) return;
      const q = value.includes("'") ? '"' : "'";
      const lines = rcLines().filter(l => !aliasLine(name).test(l));
      lines.push(`alias ${name}=${q}${value}${q}`);
      rcSave(lines);
      ok(`alias ${name}='${value}'`);
      dim('saved in ~/.staticrc, which runs when a terminal starts');
    });
    cmd('unalias', 'unalias <name>', 'remove an alias', rest => {
      if (!rest.length) return usage('unalias');
      for (const name of rest) {
        const had = S.alias.delete(name);
        const lines = rcLines(), kept = lines.filter(l => !aliasLine(name).test(l));
        if (kept.length !== lines.length) rcSave(kept);
        if (had || kept.length !== lines.length) ok(`removed alias ${name}`); else err(`unalias: ${name}: not found`);
      }
    });
    /** Run ~/.staticrc: one command a line, # for comments. Quiet apart from one line. */
    function runRc() {
      const text = vfs.read(RC_FILE());
      if (text == null) return;
      const lines = String(text).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).slice(0, 200);
      if (!lines.length) return;
      S.rc = true;
      try { for (const l of lines) runLine(l, false); }
      finally { S.rc = false; }
      dim(`ran ~/.staticrc (${lines.length} line${lines.length === 1 ? '' : 's'})`);
    }

    /* ---------------- todo, note, timer: the apps' own data ------------------
       todo reads and writes core/tasks.js (so reminders stay in sync), note the
       Notes store through core/notesfmt.js, timer core/automations.js. */
    const when = ms => { const d = new Date(ms); return `${fmt.monthName(d, 1)} ${d.getDate()}`; };
    cmd('todo', 'todo [add <text> [--due day]|done N|undo N|rm N|-a]', 'your Static Tasks list', async (rest, flags, argstr) => {
      const T2 = await import('../core/tasks.js');
      const data = T2.read();
      const rows = [];
      for (const l of data.lists) for (const t of l.tasks) rows.push({ l, t });
      const sub = (rest[0] || '').toLowerCase();
      const pick = () => {
        const i = Number(rest[1]);
        if (!Number.isInteger(i) || i < 1 || i > rows.length) { err(`todo: no task ${rest[1] ?? ''} — 'todo -a' shows the numbers`); return null; }
        return rows[i - 1];
      };
      if (sub === 'add') {
        let text = argstr.replace(/^add\s+/i, '');
        let due = null;
        const dm = /\s--due(?:=|\s+)(\S+)\s*$/.exec(text) || /^--due(?:=|\s+)(\S+)\s+/.exec(text);
        if (dm) {
          text = text.replace(dm[0], ' ').trim();
          const w = dm[1].toLowerCase();
          due = w === 'today' ? T2.dayOf() : w === 'tomorrow' ? T2.dayOf(Date.now() + 864e5) : T2.validDay(w) ? w : null;
          if (!due) return err('todo: --due takes today, tomorrow or a day like 2026-12-31');
        }
        text = unq(text).trim();
        if (!text) return usage('todo');
        let list = data.lists.find(l => l.id === data.activeId) || data.lists[0];
        if (!list) { list = T2.normList({ name: 'My Tasks' }); data.lists.push(list); data.activeId = list.id; }
        list.tasks.push(T2.normTask({ id: T2.uid('t'), text, due, created: Date.now() }));
        T2.write(data);
        return ok(`added to ${list.name}: ${text.slice(0, T2.TEXT_MAX)}${due ? `  (due ${due})` : ''}`);
      }
      if (sub === 'done' || sub === 'undo') {
        const r = pick(); if (!r) return;
        /* a repeating task moves on to its next due day, as it does in Static Tasks */
        const rolled = sub === 'done' && !r.t.done && T2.nextDue(r.t) ? T2.completeTask(r.t) : null;
        if (!rolled) T2.setDone(r.t, sub === 'done');
        T2.write(data);
        return ok(rolled ? `done: ${r.t.text} — it repeats, next due ${rolled.next}` : `${sub === 'done' ? 'done' : 'not done'}: ${r.t.text}`);
      }
      if (sub === 'rm') {
        const r = pick(); if (!r) return;
        r.l.tasks.splice(r.l.tasks.indexOf(r.t), 1);
        T2.write(data);
        return ok(`removed: ${r.t.text}`);
      }
      if (sub === 'open') { api.openApp('tasks', {}); return ok('opening Static Tasks'); }
      if (sub && sub !== 'list' && !flags.has('a')) return err('usage: todo [add <text> [--due day] | done N | undo N | rm N | open | -a]');
      const shown = rows.map((r, i) => ({ ...r, n: i + 1 })).filter(r => flags.has('a') || !r.t.done);
      if (!shown.length) return dim(rows.length ? "everything is done — 'todo -a' shows the finished ones" : "no tasks — todo add buy milk --due tomorrow");
      const lists = data.lists.length > 1;
      for (const r of shown) {
        put(L(T(String(r.n).padStart(3) + '  ', 'term__dim'), T(r.t.done ? '[x] ' : '[ ] ', r.t.done ? 'term__ok' : 'term__key'), T(r.t.text),
          T(r.t.due ? `  due ${r.t.due}` : '', 'term__dim'), T(lists ? `  · ${r.l.name}` : '', 'term__dim')));
      }
    });

    cmd('note', 'note [add <text>|show N|open [N]]', 'your Notes', async (rest, flags, argstr) => {
      const NF = await import('../core/notesfmt.js');
      const list = Array.isArray(store.get('notes')) ? store.get('notes').filter(n => n && n.id) : [];
      const sub = (rest[0] || '').toLowerCase();
      const pick = () => {
        const n = list[Number(rest[1]) - 1];
        if (!n) err(`note: no note ${rest[1] ?? ''} — 'note' lists them`);
        return n;
      };
      if (sub === 'add') {
        const text = unq(argstr.replace(/^add\s+/i, '')).trim();
        if (!text) return usage('note');
        /* Notes keeps its list in memory and saves all of it: an open window would overwrite this one */
        if (api.wm.list().some(w => w.appId === 'notes')) return err('note: close the Notes window first — it would overwrite the new note');
        const title = text.split('\n')[0].slice(0, 40);
        const mine = { id: `note-${Date.now().toString(36)}-t${list.length}`, title, body: NF.fromPlain(text), fmt: NF.FMT, mtime: new Date().toISOString() };
        store.set('notes', [mine, ...list]);
        return ok(`note saved: ${title}`);
      }
      if (sub === 'show') {
        const n = pick(); if (!n) return;
        say(n.title || 'Untitled note', 'term__ok');
        return put(L(T(NF.noteText(n))));
      }
      if (sub === 'open') {
        const n = rest[1] ? pick() : null;
        if (rest[1] && !n) return;
        api.openApp('notes', n ? { noteId: n.id } : {});
        return ok(n ? `opening ${n.title || 'Untitled note'}` : 'opening Notes');
      }
      if (sub && sub !== 'list') return err('usage: note [add <text> | show N | open [N]]');
      if (!list.length) return dim('no notes yet — note add call dentist friday');
      list.forEach((n, i) => put(L(T(String(i + 1).padStart(3) + '  ', 'term__dim'), T((n.title || 'Untitled note').slice(0, 40).padEnd(42), 'term__key'),
        T(n.mtime ? when(Date.parse(n.mtime)) : '', 'term__dim'))));
    });

    cmd('timer', 'timer <10m|1h30m> [label]  |  timer list  |  timer rm N', 'a timer that notifies you', async (rest, flags, argstr) => {
      const AM = await import('../core/automations.js');
      const QR = await import('../core/quickremind.js');
      const running = () => AM.reminders().filter(r => r.timer && ['scheduled', 'snoozed'].includes(AM.reminderState(r).state));
      const sub = (rest[0] || '').toLowerCase();
      if (!sub || sub === 'list') {
        const list = running();
        if (!list.length) return dim('no timers running — timer 10m');
        list.forEach((r, i) => {
          const at = r.snooze || AM.nextDue(r);
          put(L(T(String(i + 1).padStart(3) + '  ', 'term__dim'), T(QR.say(r.timer).padEnd(12), 'term__key'), T(r.text.padEnd(20)),
            T(`rings ${AM.untilText(at)}`, 'term__dim')));
        });
        return;
      }
      if (sub === 'rm' || sub === 'cancel') {
        const r = running()[Number(rest[1]) - 1];
        if (!r) return err(`timer: no timer ${rest[1] ?? ''} — 'timer list' shows the numbers`);
        AM.removeReminder(r.id);
        return ok(`cancelled: ${r.text}`);
      }
      const secs = QR.parseDuration(rest[0]);
      if (!secs) return err('timer: how long? — timer 10m, timer 1h30m, timer 90s (1 second to 24 hours)');
      const label = unq(argstr.replace(/^\S+\s*/, '')).trim();
      const res = AM.addTimer({ seconds: secs, text: label || `${QR.say(secs)} timer`, timer: true });
      if (!res.ok) return err(`timer: ${res.issues?.[0]?.text || 'it could not be set'}`);
      ok(`timer set for ${QR.say(secs)}${label ? ` — ${label}` : ''}`);
      dim(`it rings at ${clockStr(new Date(res.at))} with a notification; Automations lists it under Reminders`);
    });

    /* ---------------- the rest of the OS ------------------------------
       These make the shell a real way into Static rather than a toy that
       only knows about its own filesystem. */

    cmd('games', 'games [query]', 'search the game catalogue', async rest => {
      const q = rest.join(' ');
      dim('reading the catalogue…');
      const G = await import('../portal/games.data.js');
      await G.load();
      const res = G.query({ q, perPage: 12 });
      if (!res.total) return err(`games: nothing matches "${q}"`);
      say(`${res.total.toLocaleString()} match${res.total === 1 ? '' : 'es'}`, 'term__ok');
      for (const g of res.items) {
        put(L(T('  ' + g.title.slice(0, 40).padEnd(42), 'term__key'),
              T(g.studio.slice(0, 22), 'term__dim')));
      }
      dim(`open one with:  launch aether-games`);
    });

    cmd('roblox', 'roblox [query]', 'search Roblox experiences', async rest => {
      const q = rest.join(' ');
      dim('reading the catalogue…');
      const RB = await import('../portal/roblox.data.js');
      await RB.load();
      const res = RB.query({ q, perPage: 12 });
      if (!res.total) return err(`roblox: nothing matches "${q}"`);
      say(`${res.total.toLocaleString()} match${res.total === 1 ? '' : 'es'}`, 'term__ok');
      for (const r of res.items) {
        put(L(T('  ' + r.name.slice(0, 38).padEnd(40), 'term__key'),
              T(String(r.playing).padStart(9), null),
              T('  playing', 'term__dim')));
      }
    });

    cmd('anime', 'anime [query]', 'search the anime library', async rest => {
      const q = rest.join(' ');
      dim('reading the library…');
      const A = await import('../portal/anime.data.js');
      await A.load();
      const all = (A.all ? A.all() : []).filter(x =>
        !q || String(x.title || '').toLowerCase().includes(q.toLowerCase()));
      if (!all.length) return err(`anime: nothing matches "${q}"`);
      say(`${all.length.toLocaleString()} match${all.length === 1 ? '' : 'es'}`, 'term__ok');
      for (const a of all.slice(0, 12)) {
        put(L(T('  ' + String(a.title).slice(0, 44), 'term__key')));
      }
    });

    cmd('curl', 'curl <url>', 'fetch a URL through the Static proxy', async rest => {
      if (!rest.length) return usage('curl');
      const UV = await import('../portal/uv.js');
      const url = UV.normalise(rest[0]);
      dim(`* connecting to ${UV.hostOf(url)} through the tunnel…`);
      const ready = await UV.boot();
      if (!ready) return err(`curl: the tunnel is not available (${UV.status().error?.message || UV.status().phase})`);
      try {
        const res = await fetch(UV.encode(url));
        const body = await res.text();
        say(`< HTTP ${res.status}  ${body.length.toLocaleString()} bytes`, res.ok ? 'term__ok' : 'term__err');
        const text = body.replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ').trim();
        put(L(T(text.slice(0, 1200) || '(no readable text)')));
        if (text.length > 1200) dim(`… ${(text.length - 1200).toLocaleString()} more characters`);
      } catch (e) {
        err(`curl: ${e.message}`);
      }
    });

    /* ---------------- tools & fun (self-contained) ---------------- */
    /* a safe arithmetic evaluator — numbers, + - * / % ^, parentheses,
       and a few functions. No eval(): a tiny recursive-descent parser. */
    function calc(expr) {
      let i = 0; const src = String(expr);
      const ws = () => { while (/\s/.test(src[i])) i++; };
      const FN = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, log: Math.log, ln: Math.log, round: Math.round, floor: Math.floor, ceil: Math.ceil };
      function num() {
        ws();
        if (src[i] === '(') { i++; const v = expr2(); ws(); if (src[i] !== ')') throw new Error('missing )'); i++; return v; }
        if (src[i] === '-') { i++; return -num(); }
        if (src[i] === '+') { i++; return num(); }
        const name = (src.slice(i).match(/^[a-z]+/i) || [])[0];
        if (name && FN[name.toLowerCase()]) { i += name.length; return FN[name.toLowerCase()](num()); }
        if (name === 'pi') { i += 2; return Math.PI; }
        if (name === 'e') { i += 1; return Math.E; }
        const m = src.slice(i).match(/^\d+(\.\d+)?([eE][+-]?\d+)?/);
        if (!m) throw new Error(`unexpected "${src[i] || 'end'}"`);
        i += m[0].length; return parseFloat(m[0]);
      }
      function pow() { let v = num(); ws(); while (src[i] === '^') { i++; v = v ** num(); ws(); } return v; }
      function term() { let v = pow(); ws(); while (src[i] === '*' || src[i] === '/' || src[i] === '%') { const o = src[i++]; const r = pow(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; ws(); } return v; }
      function expr2() { let v = term(); ws(); while (src[i] === '+' || src[i] === '-') { const o = src[i++]; const r = term(); v = o === '+' ? v + r : v - r; ws(); } return v; }
      const v = expr2(); ws();
      if (i < src.length) throw new Error(`unexpected "${src[i]}"`);
      return v;
    }
    cmd('calc', 'calc <expression>', 'a calculator (no eval)', (rest, flags, argstr) => {
      if (!argstr) return usage('calc');
      try { const v = calc(argstr); say(`${argstr} = `, 'term__dim'); say(String(Number.isFinite(v) ? +v.toPrecision(12) : v), 'term__ok'); }
      catch (e) { err(`calc: ${e.message}`); }
    });

    const rng = (n) => Math.floor(Math.random() * n);
    cmd('roll', 'roll [NdM]', 'roll dice, e.g. roll 2d6', rest => {
      const m = String(rest[0] || '1d6').match(/^(\d*)d(\d+)$/i);
      if (!m) return err('roll: try  roll 2d6  or  roll d20');
      const n = Math.min(100, +(m[1] || 1)), sides = Math.min(1000, +m[2] || 6);
      if (!sides) return err('roll: a die needs sides');
      const rolls = Array.from({ length: n }, () => 1 + rng(sides));
      say(rolls.join(' + ') + (n > 1 ? ` = ${rolls.reduce((a, b) => a + b, 0)}` : ''), 'term__ok');
    });
    cmd('flip', 'flip', 'flip a coin', () => say(rng(2) ? 'heads' : 'tails', 'term__ok'));
    const EIGHT = ['It is certain', 'Without a doubt', 'Yes, definitely', 'You may rely on it', 'Most likely', 'Outlook good', 'Signs point to yes', 'Reply hazy, try again', 'Ask again later', 'Cannot predict now', "Don't count on it", 'My reply is no', 'Very doubtful', 'Outlook not so good'];
    cmd('8ball', '8ball <question>', 'ask the magic 8-ball', (rest, flags, argstr) => {
      if (!argstr) return err('8ball: ask a yes/no question');
      dim('* shakes the ball *'); say(EIGHT[rng(EIGHT.length)], 'term__ok');
    });
    cmd('reverse', 'reverse <text>', 'reverse text', (rest, flags, argstr) => argstr ? say([...argstr].reverse().join('')) : usage('reverse'));
    cmd('rot13', 'rot13 <text>', 'ROT13 a string', (rest, flags, argstr) => argstr
      ? say(argstr.replace(/[a-z]/gi, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26))) : usage('rot13'));
    cmd('base64', 'base64 [-d] <text>', 'encode or decode base64', (rest, flags, argstr) => {
      const dec = flags.has('d');
      const text = argstr.replace(/^-d\s+/, '');
      if (!text) return usage('base64');
      try { say(dec ? decodeURIComponent(escape(atob(text))) : btoa(unescape(encodeURIComponent(text))), 'term__ok'); }
      catch (e) { err('base64: that is not valid base64'); }
    });
    cmd('hash', 'hash <text>', 'SHA-256 of some text', async (rest, flags, argstr) => {
      if (!argstr) return usage('hash');
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(argstr));
      say([...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''), 'term__ok');
    });
    cmd('uuid', 'uuid', 'generate a random UUID', () => say((crypto.randomUUID ? crypto.randomUUID() : 'unavailable'), 'term__ok'));
    cmd('count', 'count <text>', 'count characters, words and lines', (rest, flags, argstr) => {
      if (!argstr) return usage('count');
      const words = argstr.trim().split(/\s+/).filter(Boolean).length;
      say(`${argstr.length} chars · ${words} word${words === 1 ? '' : 's'} · ${argstr.split('\n').length} line(s)`, 'term__ok');
    });
    cmd('color', 'color <#hex>', 'preview a colour with rgb/hsl', (rest) => {
      let hx = String(rest[0] || '').replace('#', '');
      if (hx.length === 3) hx = [...hx].map(c => c + c).join('');
      if (!/^[0-9a-f]{6}$/i.test(hx)) return err('color: give a hex like #ff456d');
      const [r, g, b] = [0, 2, 4].map(i => parseInt(hx.slice(i, i + 2), 16));
      const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
      let h2 = 0; if (d) { const rr = r / 255, gg = g / 255, bb = b / 255; h2 = mx === rr ? ((gg - bb) / d) % 6 : mx === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4; h2 = Math.round(h2 * 60); if (h2 < 0) h2 += 360; }
      const sat = d ? Math.round(d / (1 - Math.abs(2 * l - 1)) * 100) : 0;
      put(L(h('span', { style: { display: 'inline-block', width: '10ch', color: `#${hx}` }, text: '████████' }), T(`  #${hx}`, 'term__ok')));
      dim(`rgb(${r}, ${g}, ${b})  ·  hsl(${h2}, ${sat}%, ${Math.round(l * 100)}%)`);
    });
    cmd('define', 'define <word>', 'look up a word (dictionaryapi.dev)', async rest => {
      const w = (rest[0] || '').toLowerCase();
      if (!w) return usage('define');
      dim(`* looking up "${w}"…`);
      let data;
      try { const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`); if (!r.ok) return err(`define: no definition for "${w}"`); data = await r.json(); }
      catch (e) { return err('define: could not reach the dictionary (this network may block it)'); }
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry) return err(`define: no definition for "${w}"`);
      say(entry.word + (entry.phonetic ? `  ${entry.phonetic}` : ''), 'term__ok');
      let n = 0;
      for (const meaning of entry.meanings || []) {
        for (const def of meaning.definitions || []) {
          if (n++ >= 4) break;
          put(L(T(`  (${meaning.partOfSpeech}) `, 'term__dim'), T(def.definition)));
        }
      }
    });
    const WMO2 = { 0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'showers', 81: 'showers', 82: 'violent showers', 95: 'thunderstorm', 96: 'thunderstorm + hail' };
    cmd('weather', 'weather <city>', 'the current weather (Open-Meteo)', async (rest, flags, argstr) => {
      if (!argstr) return usage('weather');
      dim(`* finding ${argstr}…`);
      try {
        const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(argstr)}&count=1`)).json();
        const place = g.results && g.results[0];
        if (!place) return err(`weather: couldn't find "${argstr}"`);
        const wx = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=fahrenheit`)).json();
        const c = wx.current;
        say(`${place.name}, ${place.country_code || ''}`.trim(), 'term__ok');
        put(L(T(`  ${Math.round(c.temperature_2m)}°F`, 'term__ok'), T(`  ${WMO2[c.weather_code] || 'weather'} · humidity ${c.relative_humidity_2m}% · wind ${Math.round(c.wind_speed_10m)} mph`, 'term__dim')));
      } catch (e) { err('weather: could not reach Open-Meteo (this network may block it)'); }
    });
    cmd('matrix', 'matrix', 'digital rain (any key stops)', () => {
      const cols = 46, rows = 16, chars = 'アイウエオカキクabcdef0123456789<>=/*';
      const drops = Array.from({ length: cols }, () => rng(rows));
      const rowsEl = Array.from({ length: rows }, () => { const el = L(); put(el); return el; });
      let n = 0; const iv = setInterval(() => {
        const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
        for (let c = 0; c < cols; c++) { drops[c] = (drops[c] + 1) % (rows + 6); if (drops[c] < rows) grid[drops[c]][c] = chars[rng(chars.length)]; if (drops[c] - 1 >= 0 && drops[c] - 1 < rows) grid[drops[c] - 1][c] = chars[rng(chars.length)]; }
        rowsEl.forEach((el, r) => { api.clear(el); el.appendChild(T(grid[r].join(''), 'term__ok')); });
        if (++n > 60) stop();
      }, 90);
      const stop = () => { clearInterval(iv); window.removeEventListener('keydown', stop, true); dim('— matrix off —'); };
      window.addEventListener('keydown', stop, true);
    });
    cmd('cmatrix', 'cmatrix', 'digital rain', () => CMDS.matrix.run([], {}, ''));
    cmd('sudo', 'sudo <command>', '', (rest, flags, argstr) => {
      found?.('sudo');
      err(`staticsh: ${WHO.split('@')[0] || 'user'} is not in the sudoers file. This incident will be reported.`);
    });

    cmd('proxy', 'proxy [url]', 'open the proxy, optionally at a site', rest => {
      /* The hand-off has to be in place BEFORE the app mounts — it reads
         proxy.pending once on open and clears it. */
      if (rest.length) api.store.set('proxy.pending', String(rest[0]));
      api.openApp('aether-proxy', {});
      ok(rest.length ? `opening ${rest[0]} in Static Proxy` : 'opening Static Proxy');
    });

    cmd('metrics', 'metrics', 'real browser performance readings', async () => {
      const M = await import('../core/metrics.js');
      const f = await M.full();
      say('measured', 'term__ok');
      if (f.fps != null) put(L(T('  frame rate   ', 'term__dim'), T(`${f.fps} fps`)));
      if (f.heap) put(L(T('  js heap      ', 'term__dim'),
        T(`${M.formatBytes(f.heap.used)} / ${M.formatBytes(f.heap.limit)}  (${f.heap.pct}%)`)));
      if (f.storage) put(L(T('  storage      ', 'term__dim'),
        T(`${M.formatBytes(f.storage.used)} / ${M.formatBytes(f.storage.quota)}`)));
      if (f.network) put(L(T('  transferred  ', 'term__dim'),
        T(`${M.formatBytes(f.network.transferred)} over ${f.network.requests} requests`)));
      if (f.timing) put(L(T('  page load    ', 'term__dim'), T(`${f.timing.total} ms`)));
      put(L(T('  cores        ', 'term__dim'), T(String(f.hardware.cores || 'not reported'))));
      put(L(T('  windows      ', 'term__dim'), T(String(f.windows.count))));
      gap();
      say('not measurable from a browser', 'term__dim');
      for (const [what, why] of M.unavailable()) {
        put(L(T('  ' + what.padEnd(14), 'term__key'), T(why, 'term__dim')));
      }
    });


    cmd('ls', 'ls [-a] [-l] [path…]', 'list directory contents', (rest, flags) => {
      const targets = rest.length ? rest : ['.'];
      targets.forEach((t, i) => {
        const p = resolve(t), n = vfs.node(p);
        if (!n) return err(`ls: cannot access '${t}': No such file or directory`);
        if (targets.length > 1) { if (i) gap(); put(L(T(sp(p) + ':', 'term__path'))); }
        if (n.type === 'file') return put(L(T(n.name)));
        const kids = vfs.ls(p, { hidden: flags.has('a') });
        if (!kids.length) return dim('  (empty directory)');
        if (flags.has('l')) lsLong(kids);
        else if (cap) for (const k of kids) put(L(T(k.name)));      /* one a line, so a pipe can read it */
        else lsShort(kids);
      });
    });

    cmd('cd', 'cd [path|-|~]', 'change directory', rest => {
      const arg = rest[0];
      const p = !arg ? vfs.HOME : arg === '-' ? S.old : resolve(arg);
      const n = vfs.node(p);
      if (!n) return err(`cd: no such file or directory: ${arg}`);
      if (n.type !== 'dir') return err(`cd: not a directory: ${arg}`);
      setCwd(p);
      if (arg === '-') put(L(T(sp(p), 'term__path')));
    });

    cmd('pwd', 'pwd', 'print working directory', () => put(L(T(S.cwd, 'term__path'))));

    cmd('cat', 'cat [file…]', 'print a file', (rest, flags, argstr, stdin) => {
      if (!rest.length && stdin != null) return put(L(T(stdin)));
      if (!rest.length) return usage('cat');
      for (const a of rest) {
        const p = resolve(a), n = vfs.node(p);
        if (!n) { err(`cat: ${a}: No such file or directory`); continue; }
        if (n.type === 'dir') { err(`cat: ${a}: Is a directory`); continue; }
        if (rest.length > 1) put(L(T(`==> ${a} <==`, 'term__dim')));
        const body = String(n.content || '');
        if (!body.trim()) dim(`(${a} is ${n.size ? fmt.fmtBytes(n.size) + ' of binary data' : 'empty'})`);
        else put(L(T(body.replace(/\n+$/, ''))));
      }
    });

    cmd('tree', 'tree [-L depth] [path]', 'draw the tree, depth-limited', (rest, flags) => {
      let depth = 2;
      if (flags.has('L')) {
        const i = rest.findIndex(r => /^\d+$/.test(r));
        if (i >= 0) depth = fmt.clamp(+rest.splice(i, 1)[0], 1, 5);
      }
      const p = resolve(rest[0] || '.'), n = vfs.node(p);
      if (!n) return err(`tree: ${rest[0]}: No such file or directory`);
      if (n.type !== 'dir') return err(`tree: ${rest[0]}: Not a directory`);
      treeOf(p, depth);
    });

    cmd('find', 'find <term>', 'search the whole filesystem', rest => {
      if (!rest.length) return usage('find');
      const term = rest.join(' ');
      const hits = vfs.search(term, { limit: 30, start: '/' });
      if (!hits.length) return dim(`find: nothing matches '${term}'`);
      for (const hit of hits) {
        put(L(T(sp(hit.path), 'term__path'),
          T('  ' + (hit.node.type === 'dir' ? 'dir' : fmt.fmtBytes(hit.node.size)), 'term__dim')));
      }
      dim(`${hits.length} result${hits.length === 1 ? '' : 's'}`);
    });

    cmd('mkdir', 'mkdir <dir…>', 'create directories', rest => {
      if (!rest.length) return usage('mkdir');
      for (const a of rest) {
        const p = resolve(a);
        if (vfs.node(p)) { err(`mkdir: cannot create '${a}': File exists`); continue; }
        vfs.mkdir(p) ? ok(`created ${spDir(p)}`) : err(`mkdir: cannot create '${a}': No such parent`);
      }
    });

    cmd('touch', 'touch <file…>', 'create or stamp files', rest => {
      if (!rest.length) return usage('touch');
      for (const a of rest) {
        const p = resolve(a);
        if (vfs.node(p)) { vfs.write(p, vfs.read(p) || ''); dim(`touched ${sp(p)}`); continue; }
        vfs.touch(p, '') ? ok(`created ${sp(p)}`) : err(`touch: cannot touch '${a}': No such parent`);
      }
    });

    cmd('rm', 'rm [-r] <path…>', 'remove files (to Trash)', (rest, flags) => {
      if (!rest.length) return usage('rm');
      for (const a of rest) {
        const p = resolve(a), n = vfs.node(p);
        if (!n) { err(`rm: cannot remove '${a}': No such file or directory`); continue; }
        if (n.type === 'dir' && !flags.has('r')) { err(`rm: cannot remove '${a}': Is a directory — use -r`); continue; }
        const trash = `${vfs.HOME}/Trash`;
        if (p === vfs.HOME || p === '/' || p === trash) { err(`rm: refusing to remove '${a}'`); continue; }
        if (!vfs.rm(p)) { err(`rm: cannot remove '${a}'`); continue; }
        /* the vfs deletes outright once you are already inside the Trash */
        dim(p.startsWith(`${trash}/`) ? `deleted '${a}'` : `removed '${a}' → Trash`);
      }
    });

    cmd('mv', 'mv <src> <dest>', 'move or rename', rest => {
      if (rest.length < 2) return usage('mv');
      const src = resolve(rest[0]), n = vfs.node(src);
      if (!n) return err(`mv: cannot stat '${rest[0]}': No such file or directory`);
      const dest = resolve(rest[1]), dn = vfs.node(dest);
      /* moving a tree inside itself detaches it from the root — it would vanish */
      if (n.type === 'dir' && inside(dest, src)) {
        return err(`mv: cannot move '${rest[0]}' inside itself`);
      }
      if (dn && dn.type === 'dir') {
        return vfs.mv(src, dest)
          ? ok(`${vfs.baseName(src)} → ${spDir(dest)}`)
          : err(`mv: cannot move '${rest[0]}' to '${rest[1]}'`);
      }
      if (dn) return err(`mv: cannot move '${rest[0]}': '${rest[1]}' already exists`);
      const pdir = vfs.parentPath(dest), pn = vfs.node(pdir);
      if (!pn || pn.type !== 'dir') return err(`mv: target '${rest[1]}' is not a directory`);
      if (pdir !== vfs.parentPath(src) && !vfs.mv(src, pdir)) {
        return err(`mv: cannot move '${rest[0]}' to '${rest[1]}'`);
      }
      vfs.rename(`${pdir}/${vfs.baseName(src)}`, vfs.baseName(dest))
        ? ok(`${vfs.baseName(src)} → ${sp(dest)}`)
        : err(`mv: cannot rename to '${vfs.baseName(dest)}'`);
    });

    cmd('cp', 'cp [-r] <src> <dest>', 'copy files or trees', (rest, flags) => {
      if (rest.length < 2) return usage('cp');
      const src = resolve(rest[0]), n = vfs.node(src);
      if (!n) return err(`cp: cannot stat '${rest[0]}': No such file or directory`);
      if (n.type === 'dir' && !flags.has('r')) return err(`cp: -r not specified; omitting directory '${rest[0]}'`);
      const dest = resolve(rest[1]), dn = vfs.node(dest);
      const destDir = dn && dn.type === 'dir' ? dest : vfs.parentPath(dest);
      const name = dn && dn.type === 'dir' ? n.name : vfs.baseName(dest);
      if (!vfs.node(destDir)) return err(`cp: cannot create '${rest[1]}': No such directory`);
      /* copying a tree into itself recurses forever — the vfs has no inode check */
      if (n.type === 'dir' && inside(vfs.norm(`${destDir}/${name}`), src)) {
        return err(`cp: cannot copy '${rest[0]}' into itself`);
      }
      copyInto(n, destDir, name);
      ok(`${n.name} → ${spDir(destDir)}${name}`);
    });

    cmd('echo', 'echo <text> [> file]', 'print text, or write it to a file', (rest, flags, argstr) => {
      const clean = s => s.replace(/^["']|["']$/g, '');
      /* blank out quoted runs (same length) so a '>' inside quotes is not a redirect */
      const masked = argstr.replace(/"[^"]*"|'[^']*'/g, s => '\u0001'.repeat(s.length));
      const m = /\s*(>>?)\s*(\S+)\s*$/.exec(masked);
      if (!m) return put(L(T(clean(argstr))));
      const opEnd = m.index + m[0].indexOf(m[1]) + m[1].length;
      const target = argstr.slice(opEnd).trim();
      const p = resolve(clean(target));
      const par = vfs.node(vfs.parentPath(p));
      if (!par || par.type !== 'dir') return err(`echo: ${target}: No such directory`);
      if (vfs.node(p)?.type === 'dir') return err(`echo: ${target}: Is a directory`);
      const prev = m[1] === '>>' ? (vfs.read(p) || '') : '';
      vfs.write(p, prev + clean(argstr.slice(0, m.index).trim()) + '\n');
      dim(`wrote ${fmt.fmtBytes(vfs.node(p).size)} to ${sp(p)}`);
    });

    cmd('open', 'open <path>', 'open a path in its app', rest => {
      if (!rest.length) return usage('open');
      const p = resolve(rest[0]), n = vfs.node(p);
      if (!n) return err(`open: ${rest[0]}: No such file or directory`);
      api.openFile(p) ? ok(`opening ${sp(p)}`) : err(`open: no app handles ${rest[0]}`);
    });

    cmd('uname', 'uname [-a]', 'print system info', (rest, flags) => {
      const sys = api.system, hw = M.hardware();
      if (!flags.has('a')) return put(L(T('StaticOS')));
      put(L(T(`StaticOS ${sys.hostname} ${hw.platform} ${hw.browser} (a web page: no kernel version to report)`)));
    });

    cmd('whoami', 'whoami', 'print the current user', () => put(L(T(store.get('user.handle', 'static')))));
    cmd('hostname', 'hostname', 'print the hostname', () => put(L(T(api.system.hostname))));

    cmd('date', 'date', 'print the date and time', () => {
      const d = new Date();
      put(L(T(`${fmt.dayName(d, 1)} ${fmt.monthName(d, 1)} ${fmt.pad2(d.getDate())} ${clockStr(d)} ${d.getFullYear()}`)));
    });

    cmd('uptime', 'uptime', 'how long this session has been up', () => {
      put(L(T(`${clockStr()} up ${upStr()} (since this page opened),  load average: ${NA}`)));
    });

    cmd('df', 'df', 'report storage usage', async () => {
      const st = await M.storage();
      if (!st) return err(`df: ${NA} (this browser does not report storage)`);
      const cells = (sz, us, av, pc) => sz.padStart(10) + us.padStart(10) + av.padStart(10) + pc.padStart(6) + '   ';
      say('Filesystem'.padEnd(18) + cells('Size', 'Used', 'Avail', 'Use%') + 'Mounted on', 'term__dim');
      put(L(T('browser storage'.padEnd(18), 'term__key'),
        T(cells(M.formatBytes(st.quota), M.formatBytes(st.used), M.formatBytes(Math.max(0, st.quota - st.used)), `${st.pct}%`)),
        T('/', 'term__path')));
      dim(`this site's quota, as the browser reports it; disks and other mounts: ${NA}`);
    });

    cmd('free', 'free', 'report memory usage', () => {
      const heap = M.heap();
      say('Mem:   total ' + memHint(), 'term__dim');
      put(L(T('       used and free: ', 'term__dim'), T(NA)));
      if (heap) {
        put(L(T('JS heap  ', 'term__key'),
          T(`${M.formatBytes(heap.used)} used of ${M.formatBytes(heap.limit)} limit (${heap.pct}%), ${M.formatBytes(heap.total)} allocated`)));
      } else {
        put(L(T('JS heap  ', 'term__key'), T(`${NA} (only Chromium reports it)`)));
      }
      dim('a page is never told how much of the machine\'s RAM is in use; swap: ' + NA);
    });

    cmd('ps', 'ps', 'list this session\'s open windows', () => {
      say('  WIN  APP                  STATE', 'term__dim');
      const wins = api.wm.list();
      for (const w of wins) {
        const state = w.minimized || w.min ? 'minimised' : 'open';
        put(L(T(String(w.id).padStart(5) + '  ', 'term__dim'),
          T(String(w.appId).padEnd(20), 'term__key'),
          T(state)));
      }
      dim(`${wins.length} window${wins.length === 1 ? '' : 's'} open; other processes: ${NA}`);
    });

    cmd('top', 'top', 'snapshot what the browser can measure', async () => {
      put(L(T('statictop', 'term__ok'), T(` - ${clockStr()} up ${upStr()} (this session)`)));
      say(`Windows: ${api.wm.list().length} open`, 'term__dim');
      say(`CPU, GPU, load average, temperature: ${NA}`, 'term__dim');
      const heap = M.heap(), st = await M.storage();
      if (heap) {
        put(L(T('  ' + 'JS HEAP'.padEnd(9), 'term__key'), T(meter(heap.pct, 18) + ' ', heat(heap.pct)),
          T(`${M.formatBytes(heap.used)} of ${M.formatBytes(heap.limit)}`)));
      } else say(`JS heap: ${NA} (only Chromium reports it)`, 'term__dim');
      if (st) {
        put(L(T('  ' + 'STORAGE'.padEnd(9), 'term__key'), T(meter(st.pct, 18) + ' ', heat(st.pct)),
          T(`${M.formatBytes(st.used)} of ${M.formatBytes(st.quota)}`)));
      } else say(`Storage: ${NA}`, 'term__dim');
      say(`Memory: ${memHint()}`, 'term__dim');
    });

    cmd('apps', 'apps', 'list installed apps', () => {
      say('ID            NAME                 CATEGORY', 'term__dim');
      for (const a of api.listApps()) {
        put(L(T(a.id.padEnd(14), 'term__key'), T(a.name.padEnd(21)), T(a.category, 'term__dim')));
      }
      dim(`${api.listApps().length} apps installed`);
    });

    cmd('launch', 'launch <appId>', 'open an app', rest => {
      if (!rest.length) return usage('launch');
      if (!api.getApp(rest[0])) return err(`launch: unknown app: ${rest[0]} — try 'apps'`);
      api.openApp(rest[0], {});
      ok(`launched ${rest[0]}`);
    });

    /* ---- Terminal 2.0: commands that drive the OS itself ---- */
    const appByWord = w => {
      const q = String(w || '').toLowerCase();
      return api.listApps({ includeHidden: false }).find(a => a.id === q || a.name.toLowerCase() === q || a.name.toLowerCase().replace(/^static\s+/, '') === q) || null;
    };
    cmd('close', 'close <app|all>', 'close an app’s windows (or all)', async rest => {
      if (!rest.length) return usage('close');
      const wmMod = await import('../core/wm.js');
      const list = wmMod.list();
      if (rest[0] === 'all') {
        const others = list.filter(w => w.appId !== 'terminal');
        others.forEach(w => wmMod.close(w.id));
        return ok(`closed ${others.length} window${others.length === 1 ? '' : 's'}`);
      }
      const app = appByWord(rest.join(' '));
      if (!app) return err(`close: no app called '${rest.join(' ')}' — try 'apps'`);
      const mine = list.filter(w => w.appId === app.id);
      if (!mine.length) return dim(`${app.name} isn’t open`);
      mine.forEach(w => wmMod.close(w.id));
      ok(`closed ${app.name}`);
    });
    cmd('wallpaper', 'wallpaper [list|<id>]', 'list or set the wallpaper', async rest => {
      const WP = await import('../portal/wallpapers.js');
      const all = WP.list(store);
      if (!rest.length || rest[0] === 'list') {
        const cur = WP.active(store)?.id;
        for (const w of all) put(L(T((w.id === cur ? '* ' : '  ') + w.id.padEnd(16), w.id === cur ? 'term__ok' : 'term__key'), T(w.name, 'term__dim')));
        return dim('set one with: wallpaper <id>');
      }
      const w = WP.setActive(store, rest[0]);
      if (!w) return err(`wallpaper: no wallpaper '${rest[0]}' — try 'wallpaper list'`);
      ok(`wallpaper set to ${w.name}`);
    });
    let lastTrack = null;
    const offTrack = api.bus.on('media:track', t => { lastTrack = t; });
    cmd('music', 'music [play|pause|next|prev|open|status]', 'control the music player', rest => {
      const sub = (rest[0] || 'status').toLowerCase();
      if (['play', 'pause', 'next', 'prev'].includes(sub)) { api.bus.emit(`media:${sub}`); return ok(`music: ${sub}`); }
      if (sub === 'open') { api.openApp('music', {}); return ok('opening Music'); }
      if (lastTrack && (lastTrack.title || lastTrack.name)) {
        put(L(T('♪ ', 'term__ok'), T(lastTrack.title || lastTrack.name), T(lastTrack.artist ? `  —  ${lastTrack.artist}` : '', 'term__dim')));
      } else dim('nothing has played this session — music play, or music open');
    });
    const SECTIONS = ['appearance', 'wallpaper', 'themes', 'dock', 'desktop', 'windows', 'notifications', 'keyboard', 'shortcuts', 'accessibility', 'proxy', 'network', 'privacy', 'sound', 'display', 'performance', 'storage', 'applications', 'labs', 'about'];
    cmd('settings', 'settings [section]', 'open Settings (optionally at a section)', rest => {
      const sec = (rest[0] || '').toLowerCase();
      if (sec && !SECTIONS.includes(sec)) return err(`settings: sections are ${SECTIONS.join(', ')}`);
      api.openApp('settings', sec ? { section: sec } : {});
      ok(`opening Settings${sec ? ` › ${sec}` : ''}`);
    });
    cmd('system', 'system', 'a real snapshot of this StaticOS', async () => {
      const wmMod = await import('../core/wm.js');
      let build = null;
      try { build = await (await fetch('build.json', { cache: 'no-store' })).json(); } catch (e) {}
      let est = null;
      try { est = await navigator.storage?.estimate?.(); } catch (e) {}
      const row = (k, v) => put(L(T('  ' + k.padEnd(14), 'term__key'), T(v)));
      say('StaticOS', 'term__ok');
      row('version', build ? `${build.version} (build ${build.build})` : 'unknown');
      row('drive', document.body.dataset.drive || document.body.dataset.os || 'plain');
      row('windows', String(wmMod.list().length));
      row('apps', String(api.listApps().length));
      row('online', navigator.onLine === false ? 'no' : 'yes');
      row('storage', est && est.quota ? `${fmt.fmtBytes(est.usage || 0)} of ${fmt.fmtBytes(est.quota)}` : 'not reported');
      row('uptime', `${Math.round(performance.now() / 1000)} s this session`);
      try { const L2 = await import('../portal/live.js'); row('live channel', L2.status()); } catch (e) {}
    });

    cmd('theme', 'theme <accent>', `set the accent (${ACCENTS.map(accentName).join('|')})`, rest => {
      if (!rest.length) return err(`usage: theme <${ACCENTS.map(accentName).join('|')}> — current: ${accentName(store.get('prefs.accent'))}`);
      setAccent(rest[0].toLowerCase());
    });

    cmd('volume', 'volume <0-100>', 'set the output volume', rest => {
      if (!rest.length || !/^\d+$/.test(rest[0])) return err(`usage: volume <0-100> — current: ${store.get('prefs.volume')}%`);
      const v = fmt.clamp(+rest[0], 0, 100);
      store.set('prefs.volume', v);
      put(L(T('volume ', 'term__key'), T(meter(v, 20) + ' ', 'term__ok'), T(`${v}%`)));
    });

    cmd('notify', 'notify <message>', 'raise a desktop notification', (rest, flags, argstr) => {
      if (!argstr.trim()) return usage('notify');
      api.notify({ app: 'Static Terminal', icon: 'terminal', title: 'staticsh', message: argstr });
      ok('notification sent');
    });

    cmd('history', 'history [-c]', 'show the command history (⌃R searches it)', (rest, flags) => {
      if (flags.has('c')) { S.hist.length = 0; return dim('history cleared'); }
      if (!S.hist.length) return dim('no history yet');
      S.hist.forEach((c, i) => put(L(T(String(i + 1).padStart(4) + '  ', 'term__dim'), T(c))));
    });

    cmd('clear', 'clear', 'wipe the scrollback', () => clearOut());

    /* ---------------- hidden --------------------------------------------
       Not in `help` on purpose (section 34): found, not listed. Each one
       counts toward the "Found a Secret" achievement. */
    const found = id => api.bus.emit('egg:found', { id });
    const FORTUNES = [
      'You will find a game you did not search for.',
      'The high score you seek is behind one more round.',
      'A clean desktop is a sign of a busy Trash.',
      'Every bug is a feature that has not met its release notes.',
      'The static is not noise. It is everything at once.',
      'Somewhere, a controller is waiting for you to press any button.',
    ];
    cmd('fortune', 'fortune', 'a fortune', () => { found('fortune'); say(FORTUNES[Math.floor(Math.random() * FORTUNES.length)], 'term__ok'); });
    cmd('cowsay', 'cowsay <words>', 'a talking cow', (rest, flags, argstr) => {
      found('cowsay');
      const text = (argstr || 'moo').slice(0, 60);
      const bar = '-'.repeat(text.length + 2);
      [` ${'_'.repeat(text.length + 2)}`, `< ${text} >`, ` ${bar}`, '        \\   ^__^', '         \\  (oo)\\_______',
        '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'].forEach(l => say(l));
    });
    cmd('sl', 'sl', 'you meant ls', async () => {
      found('sl');
      const train = ['      ====        ________                ___________', '  _D _|  |_______/        \\__I_I_____===__|_________|',
        '   |(_)---  |   H\\________/ |   |        =|___ ___|', '   /     |  |   H  |  |     |   |         ||_| |_||',
        '  |      |  |   H  |__--------------------| [___] |', '  | ________|___H__/__|_____/[][]~\\_______|       |',
        '  |/ |   |-----------I_____I [][] []  D   |=======|_', '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__',
        ' |/-=|___|=    ||    ||    ||    |_____/~\\___/', '  \\_/      \\O=====O=====O=====O_/      \\_/'];
      const row = L();
      put(row);
      const cols = Math.max(20, termCols());
      for (let x = cols; x > -60; x -= 3) {
        row.replaceChildren(...train.map(t => { const line = h('span.term__line'); line.textContent = (x > 0 ? ' '.repeat(x) + t : t.slice(-x)).slice(0, cols); return line; }));
        await new Promise(r => setTimeout(r, 40));
        if (!row.isConnected) return;
      }
      row.remove();
      dim('(you typed sl — try ls)');
    });
    cmd('exit', 'exit', EMB ? 'log out — a fresh session starts' : 'close the terminal',
      () => { dim('logout'); win.close(); });

    cmd('static', 'static <theme|dock|about> …', 'the StaticOS control command', rest => {
      const [sub, verb, val] = rest;
      if (sub === 'theme') {
        if (verb === 'list') {
          say('accents', 'term__dim');
          const cur = store.get('prefs.accent');
          for (const a of ACCENTS) {
            put(L(T('  '), swatch(a === cur ? 'var(--accent)' : 'var(--ink-4)'),
              T(' ' + accentName(a).padEnd(9), a === cur ? 'term__ok' : null),
              T(a === cur ? '(current)' : '', 'term__dim')));
          }
          return;
        }
        if (verb === 'set' && val) return setAccent(val.toLowerCase());
        return err('usage: static theme list | static theme set <accent>');
      }
      if (sub === 'dock') {
        if (verb !== 'reset') return err('usage: static dock reset');
        store.set('dock', [...store.defaults.dock]);
        return ok('dock restored to defaults');
      }
      if (sub === 'about') {
        const sys = api.system;
        put(L(T('StaticOS', 'term__ok'), T(`  ${sys.os.replace('StaticOS ', '')}`, null)));
        for (const [k, v] of [['shell', sys.shell], ['window manager', sys.wm],
          ['desktop', sys.de], ['accent', accentName(store.get('prefs.accent'))], ['uptime', upStr()]]) {
          put(L(T('  ' + k.padEnd(12), 'term__key'), T(v)));
        }
        return dim('no telemetry, no network');
      }
      err('usage: static theme list|set <accent> · static dock reset · static about');
    });

    /* ---------------- exec ----------------- */
    /** Split on `ch` wherever it is not inside quotes. */
    function splitOut(str, ch) {
      const parts = [];
      let q = null, curr = '';
      for (const c of str) {
        if (q) { curr += c; if (c === q) q = null; }
        else if (c === '"' || c === "'") { q = c; curr += c; }
        else if (c === ch) { parts.push(curr); curr = ''; }
        else curr += c;
      }
      parts.push(curr);
      return parts;
    }
    /** A trailing `> file` / `>> file` on a stage -> { text, append, target }, or null. */
    function redirectOf(stage) {
      const masked = stage.replace(/"[^"]*"|'[^']*'/g, s => '\u0001'.repeat(s.length));
      const m = /\s*(>>?)\s*(\S+)\s*$/.exec(masked);
      if (!m) return null;
      return { text: stage.slice(0, m.index), append: m[1] === '>>', target: unq(stage.slice(stage.length - m[2].length)) };
    }
    /** An alias stands in for the first word, once. */
    function expandAlias(stage) {
      const m = /^\s*([\w.-]+)/.exec(stage);
      return m && S.alias.has(m[1]) ? S.alias.get(m[1]) + stage.slice(m[0].length) : stage;
    }

    /** Run one stage. -> its collected output ('' when printed), or undefined when it failed. */
    async function runStage(text, stdin, collect) {
      const argv = tokenize(text);
      if (!argv.length) return '';
      const name = argv[0].toLowerCase();
      const def = CMDS[name] || CMDS[ALIAS[name]];
      if (!def && UC.has(name)) {
        if (collect) { err(`staticsh: ${argv[0]} is your own command, and those can't be piped`); return undefined; }
        runUserCmd(name, argv.slice(1));
        return '';
      }
      if (!def) { err(`staticsh: command not found: ${argv[0]} — try 'help'`); return undefined; }
      const { flags, rest } = parseArgs(argv.slice(1));
      const argstr = text.trim().slice(argv[0].length).trim();
      const prev = cap;
      let got = null;
      cap = collect ? [] : null;
      /* Some commands are async (the catalogues, the proxy tunnel). The sync
         ones have printed by the time this reaches its first await. */
      try {
        const r = def.run(rest, flags, argstr, stdin);
        if (r && typeof r.then === 'function') await r;
      } catch (e) { err(`staticsh: ${name}: ${e.message}`); got = []; return undefined; }
      finally { if (!got) got = cap; cap = prev; }
      return collect ? got.join('\n') : '';
    }

    function writeRedirect(r, data) {
      const p = resolve(r.target);
      const par = vfs.node(vfs.parentPath(p));
      if (!par || par.type !== 'dir') return err(`staticsh: ${r.target}: No such directory`);
      if (vfs.node(p)?.type === 'dir') return err(`staticsh: ${r.target}: Is a directory`);
      vfs.write(p, (r.append ? (vfs.read(p) || '') : '') + data + '\n');
      dim(`wrote ${fmt.fmtBytes(vfs.node(p).size)} to ${sp(p)}`);
    }

    async function runPipeline(stages) {
      let data = null;
      for (let i = 0; i < stages.length; i++) {
        let text = stages[i];
        const first = (tokenize(text)[0] || '').toLowerCase();
        /* echo understands > itself; every other stage gets the generic one */
        const redir = first === 'echo' ? null : redirectOf(text);
        if (redir) text = redir.text;
        const got = await runStage(text, data, i < stages.length - 1 || !!redir);
        if (got === undefined) return;
        data = got;
        if (redir) writeRedirect(redir, data);
      }
    }

    /** One line of input: aliases, then `|` stages. */
    function runLine(line) {
      const stages = splitOut(line, '|').flatMap(s => splitOut(expandAlias(s), '|')).map(s => s.trim());
      if (stages.length > 1 && stages.some(s => !s)) { err("staticsh: syntax error near '|'"); return; }
      return runPipeline(stages).catch(e => err(`staticsh: ${e.message}`));
    }

    function exec(raw) {
      const str = raw.trim();
      echoCmd(str);
      if (!str) return;
      S.hist.push(str);
      return runLine(str);
    }

    /* ---------------- completion ----------- */
    function complete() {
      const v = input.value;
      const parts = v.split(' ');
      const frag = parts.pop();
      let pool, quoted = false;
      if (!parts.length || parts[parts.length - 1] === '|') {
        pool = [...Object.keys(CMDS), ...Object.keys(ALIAS), ...S.alias.keys(), ...UC.list()].filter(k => k.startsWith(frag)).sort();
      } else {
        const cut = frag.lastIndexOf('/');
        const dir = cut >= 0 ? resolve(frag.slice(0, cut) || '/') : S.cwd;
        const base = cut >= 0 ? frag.slice(cut + 1) : frag;
        const head = cut >= 0 ? frag.slice(0, cut + 1) : '';
        pool = vfs.ls(dir, { hidden: base.startsWith('.') })
          .filter(n => n.name.toLowerCase().startsWith(base.toLowerCase()))
          .map(n => head + n.name + (n.type === 'dir' ? '/' : ''));
        quoted = true;
      }
      if (!pool.length) return;
      let next = pool.length === 1 ? pool[0] : commonPrefix(pool);
      if (next.length <= frag.length) {
        if (pool.length > 1) { echoCmd(v); put(L(T(pool.join('   '), 'term__dim'))); }
        return;
      }
      if (quoted && pool.length === 1 && next.includes(' ')) next = `"${next}"`;
      input.value = [...parts, next].join(' ') + (pool.length === 1 && !next.endsWith('/') ? ' ' : '');
      input.setSelectionRange(input.value.length, input.value.length);
    }

    function histStep(dir) {
      if (!S.hist.length) return;
      if (S.hi < 0) { S.draft = input.value; S.hi = S.hist.length; }
      S.hi = fmt.clamp(S.hi + dir, 0, S.hist.length);
      input.value = S.hi === S.hist.length ? S.draft : S.hist[S.hi];
      input.setSelectionRange(input.value.length, input.value.length);
    }

    /* ---------------- Ctrl+R: search the history as you type ------------ */
    const RS = { on: false, q: '', n: 0, draft: '', row: null, hit: null };
    function rsMatches() {
      const seen = new Set(), list = [];
      const q = RS.q.toLowerCase();
      for (let i = S.hist.length - 1; i >= 0; i--) {
        const c = S.hist[i];
        if (!seen.has(c) && c.toLowerCase().includes(q)) { seen.add(c); list.push(c); }
      }
      return list;
    }
    function rsPaint() {
      const list = rsMatches();
      RS.hit = list.length ? list[RS.n % list.length] : null;
      api.clear(RS.row);
      RS.row.append(
        T(RS.hit || !RS.q ? '(reverse-i-search)' : '(failed reverse-i-search)', 'term__dim'),
        T(`\`${RS.q}': `, 'term__dim'),
        T(RS.hit || '', 'term__key'),
        T('   Enter uses it · Ctrl+R next · Esc cancels', 'term__dim'));
      out.scrollTop = out.scrollHeight;
    }
    function rsStart() {
      if (!S.hist.length) return dim('no history yet');
      RS.on = true; RS.draft = input.value; RS.q = ''; RS.n = 0;
      input.value = '';
      RS.row = L();
      show(RS.row);
      rsPaint();
    }
    function rsEnd(accept) {
      RS.on = false;
      RS.row?.remove();
      input.value = accept && RS.hit ? RS.hit : RS.draft;
      input.setSelectionRange(input.value.length, input.value.length);
    }

    /* ---------------- chrome --------------- */
    const btnBack = h('button.ibtn.tip', { 'data-tip': 'Previous directory', 'aria-label': 'Previous directory',
      onclick: () => hop(-1) }, icon('chevron-left'));
    const btnFwd = h('button.ibtn.tip', { 'data-tip': 'Next directory', 'aria-label': 'Next directory',
      onclick: () => hop(1) }, icon('chevron-right'));
    win.setLead(btnBack, btnFwd);

    function copyAll() {
      const text = [...out.childNodes].filter(n => n !== inRow)
        .map(n => n.innerText ?? n.textContent).join('\n');
      if (!navigator.clipboard?.writeText) return err('copy: clipboard unavailable');
      navigator.clipboard.writeText(text).then(
        () => api.notify({ app: 'Static Terminal', icon: 'copy', title: 'Copied', message: `${text.split('\n').length} lines of scrollback` }),
        () => err('copy: clipboard refused'));
    }

    win.setTools(
      h('button.ibtn.tip', { 'data-tip': 'New terminal window', 'aria-label': 'New terminal window',
        onclick: () => api.openApp('terminal', { window: true }) }, icon('plus')),
      h('button.ibtn.tip', { 'data-tip': 'Copy scrollback', 'aria-label': 'Copy scrollback',
        onclick: copyAll }, icon('copy')),
      h('button.ibtn.tip', { 'data-tip': 'Clear', 'aria-label': 'Clear',
        onclick: () => { clearOut(); input.focus(); } }, icon('trash')),
    );

    /* ---------------- events --------------- */
    const offKey = api.on(input, 'keydown', e => {
      if (RS.on) {
        if (e.key === 'Enter') { e.preventDefault(); rsEnd(true); }
        else if (e.key === 'Escape' || (e.ctrlKey && (e.key === 'g' || e.key === 'c'))) { e.preventDefault(); e.stopPropagation(); rsEnd(false); }
        else if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); RS.n++; rsPaint(); }
        else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key)) { e.preventDefault(); rsEnd(true); }
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); rsStart(); return; }
      if (e.key === 'Enter') {
        const v = input.value;
        input.value = ''; S.hi = -1; S.draft = '';
        exec(v);
      } else if (e.key === 'ArrowUp') { e.preventDefault(); histStep(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); histStep(1); }
      else if (e.key === 'Tab') { e.preventDefault(); complete(); }
      else if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearOut(); }
      else if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        if (S.running) { S.running.stop(); return; }
        echoCmd(input.value + '^C'); input.value = ''; S.hi = -1;
      }
      else if (e.ctrlKey && e.key === 'u') { e.preventDefault(); input.value = ''; }
      else if (e.ctrlKey && e.key === 'd') { e.preventDefault(); if (!input.value) { dim('logout'); win.close(); } }
    });

    const offIn = api.on(input, 'input', () => { if (RS.on) { RS.q = input.value; RS.n = 0; rsPaint(); } });

    /* clicking the scrollback focuses the prompt — unless text was selected */
    const offClick = api.on(out, 'click', () => {
      if (String(window.getSelection() || '').length) return;
      input.focus();
    });
    /* focusing the window focuses the prompt, but never mid-selection */
    let fromOut = false;
    const offDown = api.on(document, 'pointerdown', e => { fromOut = out.contains(e.target); }, true);
    win.onFocus(() => { if (!fromOut) input.focus(); });

    /* vfs reports the PARENT of the changed path, so never compare it to the
       cwd — just re-check that the cwd is still there. */
    const offFs = api.bus.on('fs:change', () => {
      if (dirArg(S.cwd)) return;
      setCwd(vfs.HOME, false);
      dim(`cwd no longer exists — back to ${sp(vfs.HOME)}`);
    });

    win.onReopen(o => {
      const p = dirArg(o?.cwd);
      if (p) { setCwd(p); echoCmd(`cd ${sp(S.cwd)}`); }
      if (o?.run) exec(o.run);
      input.focus();
    });

    /* ---------------- first paint ---------- */
    paintPs1();
    echoCmd('neofetch');
    put(fetchBlock());
    dim("type 'help' for the command list");
    gap();
    runRc();
    if (opts?.run) exec(opts.run);
    /* embedded, it mounts behind the boot menu — taking focus there would
       let boot-screen keystrokes land in the shell */
    if (!EMB) input.focus();

    return () => { S.running?.stop(); offTrack(); offKey(); offIn(); offClick(); offDown(); offFs(); };
  },
});
