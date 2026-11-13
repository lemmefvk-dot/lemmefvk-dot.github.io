/* ============================================================
   Static Terminal — staticsh, a real shell over the vfs.
   Every command runs against api.vfs / api.store for real;
   neofetch is the showpiece. Scrollback + a prompt row that is
   always the last line. All colour comes from .term__* in
   css/apps.css — nothing here hardcodes a hex.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as UC from '../core/usercmds.js';

const BOOT = Date.now();
const ACCENTS = ['aether', 'violet', 'azure', 'mint', 'amber'];

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
  '      a e t h e r',
];

const PROCS = [
  [1, 'root', 0.0, 0.1, '/sbin/aetherinit'],
  [412, 'root', 0.3, 0.4, 'aether-compositor --wayland'],
  [455, 'root', 0.1, 0.2, 'aetherd --system'],
  [781, 'aether', 2.4, 1.8, 'aether-shell'],
  [802, 'aether', 0.6, 0.9, 'aether-widgets'],
  [860, 'aether', 0.2, 0.3, 'aether-notifyd'],
  [913, 'aether', 0.4, 0.5, 'pipewire'],
  [988, 'aether', 0.1, 0.3, 'aether-indexer --idle'],
];

const GROUPS = [
  ['Filesystem', ['ls', 'cd', 'pwd', 'cat', 'tree', 'find', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'echo', 'open', 'stat', 'du']],
  ['Text', ['grep', 'head', 'tail', 'wc']],
  ['System', ['neofetch', 'uname', 'whoami', 'hostname', 'date', 'uptime', 'df', 'free', 'ps', 'top', 'metrics']],
  ['Network', ['curl', 'proxy', 'weather', 'define']],
  ['Tools', ['calc', 'hash', 'base64', 'rot13', 'reverse', 'count', 'color', 'uuid']],
  ['Fun', ['roll', 'flip', '8ball', 'matrix']],
  ['Library', ['games', 'anime', 'roblox']],
  ['Shell', ['help', 'history', 'clear', 'exit', 'apps', 'launch', 'close', 'settings', 'system', 'theme', 'wallpaper', 'music', 'volume', 'notify', 'which', 'man', 'aether', 'command']],
];

const ALIAS = { fetch: 'neofetch', cls: 'clear', quit: 'exit', '?': 'help' };

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
  keywords: ['shell', 'console', 'staticsh', 'cli', 'bash', 'neofetch'],
  desc: 'A working shell for StaticOS',
  /* Hidden: there is no Terminal window. The engine below is mounted into
     the Linux drive's wallpaper by shell/deskterm.js, and every
     open('terminal') is redirected there. Registered (not removed) so that
     mount stays reachable. */
  hidden: true,
  win: { w: 600, h: 330, minW: 380, minH: 200, class: 'win--terminal' },

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
    };

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
    function put(...nodes) {
      for (const n of nodes.flat()) if (n) out.insertBefore(n, inRow);
      out.scrollTop = out.scrollHeight;
    }
    const say = (t, cls) => put(L(T(t, cls)));
    const err = t => say(t, 'term__err');
    const ok = t => say(t, 'term__ok');
    const dim = t => say(t, 'term__dim');
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
    const upSecs = () => (store.get('system.uptimeBase', 0) + Math.floor((Date.now() - BOOT) / 1000));
    function upStr() {
      const s = upSecs(), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60);
      const parts = [];
      if (hh) parts.push(`${hh} hour${hh === 1 ? '' : 's'}`);
      parts.push(`${mm} min${mm === 1 ? '' : 's'}`);
      return parts.join(', ');
    }
    const clockStr = (d = new Date()) =>
      `${fmt.pad2(d.getHours())}:${fmt.pad2(d.getMinutes())}:${fmt.pad2(d.getSeconds())}`;
    const memTotal = () => store.get('system.ramTotal', 16) * 1e9 / 1024 ** 3;
    const memUsed = () => memTotal() * (api.live?.ram ?? 38) / 100;
    const loadAvg = () => {
      const c = (api.live?.cpu ?? 23) / 100;
      return [c * 2.2, c * 2.0 + 0.1, c * 1.7 + 0.16].map(v => v.toFixed(2)).join(', ');
    };
    const meter = (pct, w = 16) => {
      const n = fmt.clamp(Math.round(pct / 100 * w), 0, w);
      return `[${'#'.repeat(n)}${'-'.repeat(w - n)}]`;
    };
    const heat = pct => pct >= 80 ? 'term__err' : pct >= 55 ? 'term__key' : 'term__ok';

    /* ---------------- neofetch ------------- */
    function fetchBlock() {
      const sys = api.system, live = api.live || {}, u = store.get('user.handle', 'aether');
      const rows = [
        ['OS', `${sys.os} x86_64`],
        ['Host', 'Static Ridge 14 (rev 3.0)'],
        ['Kernel', sys.kernel],
        ['Uptime', upStr()],
        ['Packages', sys.packages],
        ['Shell', sys.shell],
        ['Resolution', `${sys.resolution} @ 165Hz`],
        ['DE', sys.de],
        ['WM', sys.wm],
        /* the live accent — a drive or a wallpaper theme may be tinting it */
        ['Theme', `${sys.theme} / accent ${getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || store.get('prefs.accent')}`],
        ['Icons', sys.icons],
        ['Terminal', sys.term],
        ['CPU', `${sys.cpu} (16) @ 5.1GHz [${live.cpu ?? 0}%]`],
        ['GPU', `${sys.gpu} [${live.gpu ?? 0}%]`],
        ['Memory', `${memUsed().toFixed(2)}GiB / ${memTotal().toFixed(2)}GiB`],
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
      : /\.(sh|aether)$/.test(n.name) ? '-rwxr-xr-x' : '-rw-r--r--';

    function lsLong(kids) {
      dim(`total ${kids.length}`);
      for (const n of kids) {
        const d = new Date(n.mtime);
        const when = `${fmt.monthName(d, 1)} ${String(d.getDate()).padStart(2)} ${fmt.pad2(d.getHours())}:${fmt.pad2(d.getMinutes())}`;
        put(L(
          T(permsOf(n) + '  ', 'term__dim'),
          T('aether  aether  ', 'term__dim'),
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

    function setAccent(v) {
      if (!ACCENTS.includes(v)) { err(`theme: unknown accent '${v}' — ${ACCENTS.join(', ')}`); return; }
      store.set('prefs.accent', v);
      document.documentElement.setAttribute('data-accent', v);
      api.bus.emit('theme:change', api.prefs);
      ok(`accent set to ${v}`);
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
      dim('Tab completes · ↑/↓ history · ⌃L clear · ⌃C cancel · ⌃D exit');
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

    cmd('grep', 'grep [-i] [-n] [-r] <pattern> <path…>', 'search file contents', (rest, flags) => {
      if (rest.length < 1) return usage('grep');
      const [pattern, ...paths] = rest;
      const targets = paths.length ? paths : ['.'];
      let re;
      try { re = new RegExp(pattern, flags.i ? 'i' : ''); }
      catch (e) { return err(`grep: invalid pattern: ${e.message}`); }

      let hits = 0;
      for (const t of targets) {
        const base = resolve(t);
        const node = vfs.node(base);
        if (!node) { err(`grep: ${t}: No such file or directory`); continue; }
        if (node.type === 'dir' && !flags.r) { err(`grep: ${t}: Is a directory (use -r)`); continue; }
        const files = node.type === 'dir' ? [...walkFiles(base)] : [[base, node]];
        for (const [path, file] of files) {
          const body = String(file.content || '');
          if (!body) continue;
          body.split('\n').forEach((line, i) => {
            if (!re.test(line)) return;
            hits++;
            const label = files.length > 1 ? `${path}:` : '';
            put(L(
              label ? T(label, 'term__key') : T(''),
              flags.n ? T(`${i + 1}:`, 'term__dim') : T(''),
              T(line.length > 400 ? `${line.slice(0, 400)}…` : line)));
          });
        }
      }
      if (!hits) dim('no matches');
    });

    cmd('head', 'head [-n N] <file…>', 'first lines of a file', (rest, flags) => {
      if (!rest.length) return usage('head');
      sliceFile(rest, flags, true);
    });

    cmd('tail', 'tail [-n N] <file…>', 'last lines of a file', (rest, flags) => {
      if (!rest.length) return usage('tail');
      sliceFile(rest, flags, false);
    });

    function sliceFile(rest, flags, fromTop) {
      const n = Math.max(1, Number(flags.n) || 10);
      const files = rest.filter(a => !/^\d+$/.test(a));
      for (const a of files) {
        const node = vfs.node(resolve(a));
        if (!node) { err(`${fromTop ? 'head' : 'tail'}: ${a}: No such file or directory`); continue; }
        if (node.type === 'dir') { err(`${fromTop ? 'head' : 'tail'}: ${a}: Is a directory`); continue; }
        const lines = String(node.content || '').split('\n');
        if (files.length > 1) put(L(T(`==> ${a} <==`, 'term__dim')));
        const take = fromTop ? lines.slice(0, n) : lines.slice(-n);
        for (const line of take) put(L(T(line)));
      }
    }

    cmd('wc', 'wc <file…>', 'count lines, words and bytes', rest => {
      if (!rest.length) return usage('wc');
      let tl = 0, tw = 0, tb = 0;
      for (const a of rest) {
        const node = vfs.node(resolve(a));
        if (!node) { err(`wc: ${a}: No such file or directory`); continue; }
        const body = String(node.content || '');
        const l = body ? body.split('\n').length : 0;
        const w = body.trim() ? body.trim().split(/\s+/).length : 0;
        const b = new Blob([body]).size;
        tl += l; tw += w; tb += b;
        put(L(T(String(l).padStart(7), 'term__key'), T(String(w).padStart(8)),
              T(String(b).padStart(9)), T('  ' + a, 'term__dim')));
      }
      if (rest.length > 1) {
        put(L(T(String(tl).padStart(7), 'term__key'), T(String(tw).padStart(8)),
              T(String(tb).padStart(9)), T('  total', 'term__dim')));
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

    cmd('man', 'man <command>', 'usage for a command', rest => {
      if (!rest.length) return usage('man');
      const name = ALIAS[rest[0]] || rest[0];
      const c = CMDS[name];
      if (!c) return err(`man: no manual entry for ${rest[0]}`);
      say(name.toUpperCase(), 'term__ok');
      gap();
      say('  SYNOPSIS', 'term__dim');
      put(L(T('    ' + c.u, 'term__key')));
      gap();
      say('  DESCRIPTION', 'term__dim');
      put(L(T('    ' + c.d)));
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
        flags.has('l') ? lsLong(kids) : lsShort(kids);
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

    cmd('cat', 'cat <file…>', 'print a file', rest => {
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

    cmd('uname', 'uname [-a]', 'print kernel info', (rest, flags) => {
      const sys = api.system;
      if (!flags.has('a')) return put(L(T('StaticOS')));
      put(L(T(`StaticOS ${sys.hostname} ${sys.kernel.replace('Linux ', '')} #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Static`)));
    });

    cmd('whoami', 'whoami', 'print the current user', () => put(L(T(store.get('user.handle', 'aether')))));
    cmd('hostname', 'hostname', 'print the hostname', () => put(L(T(api.system.hostname))));

    cmd('date', 'date', 'print the date and time', () => {
      const d = new Date();
      put(L(T(`${fmt.dayName(d, 1)} ${fmt.monthName(d, 1)} ${fmt.pad2(d.getDate())} ${clockStr(d)} ${d.getFullYear()}`)));
    });

    cmd('uptime', 'uptime', 'how long the session has been up', () => {
      put(L(T(`${clockStr()} up ${upStr()},  1 user,  load average: ${loadAvg()}`)));
    });

    cmd('df', 'df', 'report filesystem usage', () => {
      const total = store.get('system.diskTotal', 512), used = store.get('system.diskUsed', 282);
      const rowsOf = [
        ['/dev/aether0', `${total}G`, `${used}G`, `${total - used}G`, `${Math.round(used / total * 100)}%`, '/'],
        ['/dev/aether1', '1.0G', '128M', '896M', '13%', '/boot'],
        ['tmpfs', '7.4G', '312M', '7.1G', '5%', '/dev/shm'],
      ];
      const cells = (sz, us, av, pc) => sz.padStart(6) + us.padStart(7) + av.padStart(7) + pc.padStart(6) + '   ';
      say('Filesystem'.padEnd(14) + cells('Size', 'Used', 'Avail', 'Use%') + 'Mounted on', 'term__dim');
      for (const [fsn, sz, us, av, pc, mt] of rowsOf) {
        put(L(T(fsn.padEnd(14), 'term__key'),
          T(cells(sz, us, av, pc)),
          T(mt, 'term__path')));
      }
    });

    cmd('free', 'free', 'report memory usage', () => {
      const t = memTotal(), u = memUsed();
      /* ram can reach 92% in Game Mode — free must never go negative */
      const avail = Math.max(0, t - u), cache = Math.min(t * 0.14, avail), free = avail - cache;
      const g = v => `${v.toFixed(2)}Gi`.padStart(12);
      say('       ' + ['total', 'used', 'free', 'buff/cache', 'available'].map(s => s.padStart(12)).join(''), 'term__dim');
      put(L(T('Mem:   '), T(g(t) + g(u) + g(free) + g(cache) + g(avail), 'term__key')));
      put(L(T('Swap:  '), T(g(4) + g(0) + g(4), 'term__dim')));
    });

    cmd('ps', 'ps', 'list running processes', () => {
      say('  PID USER      %CPU  %MEM  COMMAND', 'term__dim');
      const rows = PROCS.map(p => [...p]);
      for (const w of api.wm.list()) {
        rows.push([1400 + w.id * 7, 'aether', fmt.round(0.4 + w.id * 0.37, 1), fmt.round(0.8 + w.id * 0.21, 1),
          `aether-app ${w.appId}`]);
      }
      for (const [pid, user, cpu, mem, command] of rows) {
        put(L(T(String(pid).padStart(5) + ' ', 'term__dim'),
          T(user.padEnd(9)),
          T(cpu.toFixed(1).padStart(5) + mem.toFixed(1).padStart(6) + '  ', 'term__key'),
          T(command)));
      }
      dim(`${rows.length} of 214 tasks shown`);
    });

    cmd('top', 'top', 'snapshot the live telemetry', () => {
      const live = api.live || {};
      put(L(T('aethertop', 'term__ok'), T(` - ${clockStr()} up ${upStr()},  1 user,  load average: ${loadAvg()}`)));
      say('Tasks: 214 total,   2 running, 212 sleeping,   0 stopped', 'term__dim');
      const mib = v => (v * 1024).toFixed(0).padStart(8);
      say(`MiB Mem :${mib(memTotal())} total,${mib(memUsed())} used,${mib(memTotal() - memUsed())} free`, 'term__dim');
      const bars = [['CPU', live.cpu ?? 0, '%'], ['GPU', live.gpu ?? 0, '%'], ['RAM', live.ram ?? 0, '%'],
        ['NET', live.net ?? 0, ' Mb/s'], ['TEMP', live.temp ?? 0, '°C']];
      for (const [label, v, unit] of bars) {
        put(L(T('  ' + label.padEnd(6), 'term__key'),
          T(meter(v, 18) + ' ', heat(v)),
          T(`${fmt.round(v, 1)}${unit}`)));
      }
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

    cmd('theme', 'theme <accent>', `set the accent (${ACCENTS.join('|')})`, rest => {
      if (!rest.length) return err(`usage: theme <${ACCENTS.join('|')}> — current: ${store.get('prefs.accent')}`);
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

    cmd('history', 'history [-c]', 'show the command history', (rest, flags) => {
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

    cmd('aether', 'aether <theme|dock|about> …', 'the StaticOS control command', rest => {
      const [sub, verb, val] = rest;
      if (sub === 'theme') {
        if (verb === 'list') {
          say('accents', 'term__dim');
          const cur = store.get('prefs.accent');
          for (const a of ACCENTS) {
            put(L(T('  '), swatch(a === cur ? 'var(--accent)' : 'var(--ink-4)'),
              T(' ' + a.padEnd(9), a === cur ? 'term__ok' : null),
              T(a === cur ? '(current)' : '', 'term__dim')));
          }
          return;
        }
        if (verb === 'set' && val) return setAccent(val.toLowerCase());
        return err('usage: aether theme list | aether theme set <accent>');
      }
      if (sub === 'dock') {
        if (verb !== 'reset') return err('usage: aether dock reset');
        store.set('dock', [...store.defaults.dock]);
        return ok('dock restored to defaults');
      }
      if (sub === 'about') {
        const sys = api.system;
        put(L(T('StaticOS', 'term__ok'), T(`  ${sys.os.replace('StaticOS ', '')}`, null)));
        for (const [k, v] of [['kernel', sys.kernel], ['shell', sys.shell], ['compositor', sys.wm],
          ['desktop', sys.de], ['accent', store.get('prefs.accent')], ['uptime', upStr()]]) {
          put(L(T('  ' + k.padEnd(12), 'term__key'), T(v)));
        }
        return dim('built for the aether theme · no telemetry, no network');
      }
      err('usage: aether theme list|set <accent> · aether dock reset · aether about');
    });

    /* ---------------- exec ----------------- */
    function exec(raw) {
      const str = raw.trim();
      echoCmd(str);
      if (!str) return;
      S.hist.push(str);
      const argv = tokenize(str);
      const name = argv[0].toLowerCase();
      const def = CMDS[name] || CMDS[ALIAS[name]];
      if (!def && UC.has(name)) return runUserCmd(name, argv.slice(1));
      if (!def) return err(`staticsh: command not found: ${argv[0]} — try 'help'`);
      const { flags, rest } = parseArgs(argv.slice(1));
      const argstr = str.slice(argv[0].length).trim();
      /* Some commands are async now (they reach for the catalogues or the
         proxy tunnel). A rejected promise would otherwise vanish as an
         unhandled rejection instead of printing an error line. */
      try {
        const out = def.run(rest, flags, argstr);
        if (out && typeof out.then === 'function') {
          out.catch(e => err(`staticsh: ${name}: ${e.message}`));
        }
      } catch (e) { err(`staticsh: ${name}: ${e.message}`); }
    }

    /* ---------------- completion ----------- */
    function complete() {
      const v = input.value;
      const parts = v.split(' ');
      const frag = parts.pop();
      let pool, quoted = false;
      if (!parts.length) {
        pool = [...Object.keys(CMDS), ...Object.keys(ALIAS), ...UC.list()].filter(k => k.startsWith(frag)).sort();
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
      h('button.ibtn.tip', { 'data-tip': 'New tab', 'aria-label': 'New tab',
        onclick: () => api.notify({ app: 'Static Terminal', icon: 'plus', title: 'Tabs are coming',
          message: 'staticsh 3.1 ships split panes and tabs.' }) }, icon('plus')),
      h('button.ibtn.tip', { 'data-tip': 'Copy scrollback', 'aria-label': 'Copy scrollback',
        onclick: copyAll }, icon('copy')),
      h('button.ibtn.tip', { 'data-tip': 'Clear', 'aria-label': 'Clear',
        onclick: () => { clearOut(); input.focus(); } }, icon('trash')),
    );

    /* ---------------- events --------------- */
    const offKey = api.on(input, 'keydown', e => {
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
    if (opts?.run) exec(opts.run);
    /* embedded, it mounts behind the boot menu — taking focus there would
       let boot-screen keystrokes land in the shell */
    if (!EMB) input.focus();

    return () => { S.running?.stop(); offTrack(); offKey(); offClick(); offDown(); offFs(); };
  },
});
