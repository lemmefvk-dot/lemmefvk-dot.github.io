/* ============================================================
   bootpicker.js — the boot manager.

   A GRUB-style text screen: a boxed menu of three entries, arrow
   keys, a countdown, and a `c` command line where `boot linux` does
   what it says. Choosing an entry types its boot command out and
   hands straight over to that drive's own start-up:

     Linux    — a full tty boot: kernel log, systemd units, a login
                typed at the prompt, then `startx`
     Windows  — the four-pane mark and the ring of dots
     StaticOS — the plain default, the normal splash (boot.js)

   The choice tints the shell with the drive's accent (live only —
   prefs.accent stays the person's own) and sets body[data-os] so the
   default wallpaper wears that drive's skin: a glass bloom for
   Windows, a dark desk for Linux — with the real terminal on it
   (deskterm.js), whatever the wallpaper. A wallpaper the person picked
   always wins over a skin.

   Runs on every load and auto-boots the last choice, unless
   prefs.bootSkip says to go straight to it. A restart from the
   updater skips the menu entirely and just re-applies the drive.
   ============================================================ */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as THEMES from '../core/themes.js';
import { setDrive as deskTerminal } from './deskterm.js';
import { cover } from '../core/cover.js';
import { bus } from '../core/bus.js';
import * as sfx from '../core/sfx.js';

const reduced = () => !!store.get('prefs.reduceMotion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* Each drive: the menu entry, the command that boots it, and the accent it
   tints the OS with. The device paths are flavour, like GRUB's own. */
const DRIVES = [
  { id: 'linux',   name: 'Linux',    entry: 'StaticOS GNU/Linux  (4.0.0-static on /dev/sda1)', cmd: 'boot linux',   accent: '#e8622c' },
  { id: 'windows', name: 'Windows',  entry: 'Windows Boot Manager  (on /dev/sda2)',            cmd: 'boot windows', accent: '#2f81f7' },
  { id: 'plain',   name: 'StaticOS', entry: 'StaticOS  (default)',                             cmd: 'boot static',  accent: '#ff456d' },
];
const byId = id => DRIVES.find(d => d.id === id) || DRIVES[2];
const ALIASES = { linux: 'linux', windows: 'windows', win: 'windows', static: 'plain', staticos: 'plain', plain: 'plain', default: 'plain' };

/* ---------- applying a drive's skin ---------------------------------- */

/* A drive dresses the DEFAULT wallpaper only. Once the person has picked a
   wallpaper of their own it — and any theme it brings — wins on every drive;
   the drive still plays its own boot animation. */
const onDefaultWallpaper = () => store.get('wallpaper', 'canopy') === 'canopy';

export function applyOS(id) {
  const d = byId(id);
  /* A drive tints the shell live but never writes prefs.accent — that stays
     the person's own colour (Settings, or a wallpaper's paired theme), and
     the plain drive simply puts it back. */
  const skinned = id !== 'plain' && onDefaultWallpaper();
  THEMES.apply(skinned ? d.accent : store.get('prefs.accent', 'aether'),
    document.documentElement);
  /* the wallpaper skin is a CSS layer keyed off data-os (and data-wp, which
     desktop.js keeps current), so the wallpaper itself is never overwritten */
  const was = document.body.dataset.drive;
  if (id === 'plain') delete document.body.dataset.os;
  else document.body.dataset.os = id;
  document.body.dataset.drive = id;
  paintSkin(id);
  /* the desktop skips the wallpaper video while a skin covers it */
  if (was !== id) bus.emit('wallpaper:changed');
  /* the Linux drive's terminal lives in the wallpaper (shell/deskterm.js) */
  deskTerminal(id);
  store.set('session.bootOS', id);
  watchWallpaper();
}

/* re-dress when the wallpaper changes mid-session */
let watching = false;
function watchWallpaper() {
  if (watching || typeof store.sub !== 'function') return;
  watching = true;
  store.sub('wallpaper', () => applyOS(store.get('session.bootOS', 'plain')));
}

/* One overlay element on the desktop, just above the wallpaper and below
   the icons/windows. CSS decides whether it shows at all (default
   wallpaper only). Windows gets the bloom; Linux gets a dark desk, and the
   real terminal (deskterm.js) sits on top of it. */
let skinFor = null;
function paintSkin(id) {
  const desk = document.querySelector('.desktop');
  if (!desk) return;
  let skin = desk.querySelector('.os-skin');
  if (!skin) {
    skin = h('div.os-skin', { 'aria-hidden': 'true' });
    const wp = desk.querySelector('.wp');
    if (wp && wp.nextSibling) desk.insertBefore(skin, wp.nextSibling);
    else desk.appendChild(skin);
  }
  if (skinFor === id) return;
  skinFor = id;
  skin.replaceChildren();
  if (id === 'windows') skin.appendChild(h('div.os-skin__win'));
}

/* ---------- a text screen shared by the menu and the Linux boot ------- */

/* Every tty screen fast-forwards on any key (or a tap — never the mouse:
   this is a keyboard screen), from the moment it appears. Skipping during
   the typed boot command carries on into the Linux boot, which shares it. */
function tty(host) {
  const out = h('div.tty__out');
  const el = h('div.bootos.bootos--tty', out, h('div.tty__skip', { text: 'press any key to skip' }));
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  let skip = false;
  const onSkip = e => {
    if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.type === 'pointerdown' && e.pointerType === 'mouse') return;
    sfx.unlock();
    skip = true;
  };
  window.addEventListener('keydown', onSkip, true);
  el.addEventListener('pointerdown', onSkip);
  const api = {
    el,
    get skipped() { return skip; },
    skip() { skip = true; },
    wait: ms => (skip ? Promise.resolve() : new Promise(r => setTimeout(r, ms))),
    line(...parts) {
      const row = h('div.tty__line', ...parts.map(p => (typeof p === 'string' ? h('span', { text: p }) : p)));
      out.appendChild(row);
      /* keep only what fits — a real tty scrolls */
      while (out.childElementCount > 60) out.firstElementChild.remove();
      el.scrollTop = el.scrollHeight;
      return row;
    },
    /* type into the last line, one character at a time */
    async type(row, text, speed = 55) {
      const span = h('span');
      row.appendChild(span);
      for (const ch of text) {
        span.textContent += ch;
        if (!skip && ch !== ' ') sfx.boot('key');
        await api.wait(speed + Math.random() * speed * 0.6);
      }
    },
    clear() { out.replaceChildren(); },
    async close() {
      window.removeEventListener('keydown', onSkip, true);
      el.classList.add('is-out');
      await new Promise(r => setTimeout(r, 420));
      el.remove();
    },
  };
  return api;
}
const ok = () => h('span.tty__ok', { text: '[  OK  ]' });
const dim = t => h('span.tty__dim', { text: t });

/* ---------- the boot animations -------------------------------------- */

async function bootAnimWindows(host) {
  const overlay = h('div.bootos.bootos--win',
    h('div.bootos__win',
      h('div.bootos__winlogo', h('i'), h('i'), h('i'), h('i')),
      h('div.bootos__spinner', ...Array.from({ length: 5 }, () => h('span'))),
      h('div.bootos__cap', { text: 'Starting StaticOS' })));
  host.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-in'));
  setTimeout(() => sfx.boot('winchime'), 250);
  await new Promise(r => setTimeout(r, reduced() ? 250 : 3200));
  overlay.classList.add('is-out');
  await new Promise(r => setTimeout(r, 420));
  overlay.remove();
}

/* Kernel log → systemd → a login typed at the prompt → startx. About nine
   seconds; any key or a click fast-forwards. The lines are the familiar
   shape of a Linux boot, not telemetry from this machine. */
const KERNEL = [
  'Linux version 4.0.0-static (build@static) (gcc 14.2.0) #1 SMP PREEMPT_DYNAMIC',
  'Command line: BOOT_IMAGE=/vmlinuz-4.0.0-static root=/dev/sda1 ro quiet splash',
  'BIOS-provided physical RAM map:',
  'ACPI: Early table checksum verification disabled',
  'Memory: 16254312K/16777216K available (18432K kernel code)',
  'smpboot: CPU0: Static Virtual CPU @ 3.40GHz (family: 0x19)',
  'Mount-cache hash table entries: 32768 (order: 6, 262144 bytes)',
  'PCI: Using configuration type 1 for base access',
  'clocksource: Switched to clocksource tsc',
  'NET: Registered PF_INET protocol family',
  'usb 1-1: new high-speed USB device number 2 using xhci_hcd',
  'input: Static Keyboard as /devices/virtual/input/input3',
  'EXT4-fs (sda1): mounted filesystem with ordered data mode',
  'random: crng init done',
  'systemd[1]: systemd 256 running in system mode (+PAM +AUDIT +SELINUX)',
  'systemd[1]: Detected architecture x86-64.',
  'systemd[1]: Hostname set to <staticos>.',
];
const UNITS = [
  'Created slice Slice /system/getty',
  'Started Journal Service',
  'Mounted /home',
  'Reached target Local File Systems',
  'Started Load Kernel Modules',
  'Started Network Manager',
  'Reached target Network',
  'Started D-Bus System Message Bus',
  'Started Static Compositor',
  'Started Login Service',
  'Started Audio Service (pipewire)',
  'Reached target Multi-User System',
  'Reached target Graphical Interface',
];

async function bootAnimLinux(host, t = tty(host)) {
  const fast = reduced();

  /* the drive spins up under the kernel log; stops with the screen */
  const stopHum = fast || t.skipped ? () => {} : sfx.hum();
  if (!fast) {
    let clock = 0;
    for (const text of KERNEL) {
      clock += 0.02 + Math.random() * 0.09;
      t.line(dim(`[${clock.toFixed(6).padStart(12)}] `), text);
      if (!t.skipped && Math.random() < 0.45) sfx.boot('seek');
      await t.wait(55 + Math.random() * 70);
    }
    await t.wait(300);
    t.line('');
    t.line('Welcome to ', h('span.tty__brand', { text: 'StaticOS 4.0' }), '!');
    t.line('');
    await t.wait(350);
    for (const u of UNITS) {
      t.line(ok(), ' ' + u + '.');
      if (!t.skipped) sfx.boot('ok');
      await t.wait(110 + Math.random() * 130);
    }
    await t.wait(500);

    t.clear();
    t.line('StaticOS 4.0 staticos tty1');
    t.line('');
    await t.wait(400);
    const login = t.line('staticos login: ');
    await t.type(login, 'static', 90);
    await t.wait(250);
    const pw = t.line('Password: ');
    await t.wait(700);
    pw.appendChild(dim('(hidden)'));
    t.line(`Last login: ${new Date().toDateString()} on tty1`);
    await t.wait(350);
    const prompt = t.line(h('span.tty__user', { text: 'static@staticos' }), ':', h('span.tty__path', { text: '~' }), '$ ');
    await t.wait(400);
    await t.type(prompt, 'startx', 110);
    await t.wait(300);
    t.line('Starting graphical session...');
    stopHum();
    if (!t.skipped) sfx.boot('startx');
    await t.wait(900);
  } else {
    UNITS.slice(-4).forEach(u => t.line(ok(), ' ' + u + '.'));
    await new Promise(r => setTimeout(r, 300));
  }

  stopHum();
  await t.close();
}

/* the drive's own start-up; plain is the normal splash in boot.js */
async function playDrive(host, os, t = null) {
  if (os === 'linux') {
    await bootAnimLinux(host, t || undefined);
  } else {
    if (t) await t.close();
    if (os === 'windows') await bootAnimWindows(host);
    else {
      const m = await import('./boot.js');
      await m.runBoot(host);
      return;
    }
  }
  store.set('session.bootedOnce', true);
}

/* ---------- the menu -------------------------------------------------- */

const HELP = [
  'boot <linux|windows|static>   start that drive',
  'ls                            list the drives',
  'skip on|off                   skip this menu next time',
  'clear                         clear the screen',
  'reboot                        start over',
  'menu  (or Esc)                back to the menu',
  '',
  '…and a few that are not listed.',
];

export function runBootPicker(host) {
  /* the live desktop underneath must not take focus or shortcuts */
  cover('boot', true);
  return pick(host).finally(() => cover('boot', false));
}

function pick(host) {
  /* an updater restart re-applies the drive silently and does the quick
     splash via boot.js — no menu */
  let restarting = false;
  try {
    restarting = sessionStorage.getItem('aether.restarting') === '1';
  } catch (err) { /* private mode */ }
  if (restarting) {
    applyOS(store.get('session.bootOS', store.get('prefs.bootOS', 'plain')));
    return import('./boot.js').then(m => m.runBoot(host)).then(() => 'restart');
  }

  const remembered = store.get('prefs.bootOS', 'plain');
  applyOS(remembered);

  /* "skip this menu": boot the remembered drive straight away. Settings >
     Desktop > Startup turns the menu back on. */
  if (store.get('prefs.bootSkip')) return playDrive(host, remembered).then(() => remembered);

  return new Promise(resolve => {
    let idx = Math.max(0, DRIVES.findIndex(d => d.id === remembered));
    let mode = 'menu';
    let booting = false;
    const AUTO = reduced() ? 2 : 6;
    let left = AUTO;
    let counting = true;

    const setSkip = on => store.set('prefs', { ...store.get('prefs', {}), bootSkip: !!on });

    /* Keyboard only, like a real boot manager: the mouse does nothing on
       this screen (no hover, no click) and its pointer is hidden. A touch
       screen has no arrow keys, so a tap still works there. */
    const tapped = fn => e => { if (e.pointerType && e.pointerType !== 'mouse') { sfx.unlock(); fn(); } };
    const rows = DRIVES.map((d, i) => h('div.bpt__row', {
      role: 'option', dataset: { os: d.id },
      onpointerup: tapped(() => { idx = i; sync(); boot(d.id); }),
    }, h('span.bpt__mark'), h('span', { text: d.entry })));

    const count = h('div.bpt__count');
    const skipBox = h('span.bpt__check');
    const menu = h('div.bpt__menu',
      h('div.bpt__box', { role: 'listbox', 'aria-label': 'Boot entries' }, rows),
      h('div.bpt__help',
        h('div', { text: 'Use the ↑ and ↓ keys to select which entry is highlighted.' }),
        h('div', { text: "Press enter to boot the selected OS, or 'c' for a command-line." }),
        h('div.bpt__skip', { onpointerup: tapped(() => { setSkip(!store.get('prefs.bootSkip')); syncSkip(); }) },
          skipBox, h('span', { text: " Skip this menu next time  ('s')" }))),
      count);

    const cliOut = h('div.bpt__cliout');
    const input = h('input.bpt__input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Boot command',
    });
    const cli = h('div.bpt__cli',
      h('div.bpt__dim', { text: "Minimal BASH-like line editing is supported. Type 'help' for commands, Esc for the menu." }),
      cliOut,
      h('label.bpt__prompt', h('span', { text: 'boot> ' }), input));
    cli.hidden = true;

    const el = h('div.bp.bp--term',
      h('div.bpt__title', { text: 'StaticOS Boot Manager  version 3.0' }),
      menu, cli);
    /* a mouse press must not move focus out of the command line or start a
       text selection — the screen belongs to the keyboard */
    el.addEventListener('mousedown', e => e.preventDefault());
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));

    function sync() {
      rows.forEach((r, i) => {
        r.setAttribute('aria-selected', String(i === idx));
        r.firstChild.textContent = i === idx ? '*' : ' ';
      });
    }
    function syncSkip() { skipBox.textContent = store.get('prefs.bootSkip') ? '[x]' : '[ ]'; }
    function tick() {
      count.textContent = counting
        ? `The highlighted entry will be executed automatically in ${left}s.`
        : '';
    }
    function stopCount() { if (counting) { counting = false; tick(); } }
    sync(); syncSkip(); tick();

    const timer = setInterval(() => {
      if (booting || !counting || mode !== 'menu') return;
      left -= 1;
      tick();
      if (left <= 0) boot(DRIVES[idx].id);
    }, 1000);

    function cliPrint(...lines) {
      for (const l of lines) cliOut.appendChild(h('div', { text: l }));
    }
    function openCli() {
      mode = 'cli';
      stopCount();
      menu.hidden = true;
      cli.hidden = false;
      input.focus();
    }
    function openMenu() {
      mode = 'menu';
      cli.hidden = true;
      menu.hidden = false;
    }
    function run(line) {
      const [cmd, ...args] = line.trim().split(/\s+/);
      cliPrint('boot> ' + line);
      if (!cmd) return;
      switch (cmd.toLowerCase()) {
        case 'help': cliPrint(...HELP); break;
        case 'ls': DRIVES.forEach((d, i) => cliPrint(`(hd0,${i + 1})  ${d.name.padEnd(9)} ${d.entry}`)); break;
        case 'clear': cliOut.replaceChildren(); break;
        case 'menu': case 'exit': openMenu(); break;
        case 'reboot': location.reload(); break;
        case 'skip': {
          const on = !/^(off|no|false|0)$/i.test(args[0] || 'on');
          setSkip(on); syncSkip();
          cliPrint(on ? 'menu will be skipped next boot' : 'menu will show next boot');
          break;
        }
        /* not in `help` (section 34): the unlisted ones */
        case 'memtest': memtest(args[0]); break;
        case 'beep': sfx.boot('post'); cliPrint('*beep*'); break;
        case 'signal': case 'tune': signal(); break;
        case 'boot': {
          const os = ALIASES[(args[0] || DRIVES[idx].id).toLowerCase()];
          if (!os) { cliPrint(`error: no such drive '${args[0]}'. Try 'ls'.`); break; }
          boot(os, true);
          break;
        }
        default: {
          const os = ALIASES[cmd.toLowerCase()];
          if (os) { boot(os, true); break; }
          cliPrint(`error: can't find command '${cmd}'. Try 'help'.`);
        }
      }
    }
    input.addEventListener('keydown', e => {
      /* typing here must not reach the shell's shortcuts underneath */
      e.stopPropagation();
      sfx.unlock();
      if (e.key.length === 1 || e.key === 'Backspace') sfx.boot('key');
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; run(v); }
      else if (e.key === 'Escape') { e.preventDefault(); openMenu(); }
    });

    /* the menu owns the keyboard while it is up — nothing reaches the
       launcher or window shortcuts underneath */
    const onKey = e => {
      if (booting) return;
      /* in the command line, keys go to the input (which stops them itself);
         stopping them here, in the capture phase, would starve the input */
      if (mode === 'cli') {
        if (e.target !== input) input.focus();
        return;
      }
      const k = e.key;
      sfx.unlock();          /* a real keypress: audio may start from here */
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        idx = (idx + (k === 'ArrowDown' ? 1 : -1) + DRIVES.length) % DRIVES.length;
        stopCount(); sync();
        sfx.boot('menu');
      } else if (k === 'Enter') { e.preventDefault(); boot(DRIVES[idx].id); }
      else if (k === 'c' || k === 'C') { e.preventDefault(); sfx.boot('menu'); openCli(); }
      else if (k === 's' || k === 'S') { e.preventDefault(); sfx.boot('menu'); setSkip(!store.get('prefs.bootSkip')); syncSkip(); }
      else return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);

    /* A real memory test, as far as a tab can run one: allocate a block,
       write four bit patterns across it, read every word back. The speed
       is this browser's own loop throughput, measured, not a spec sheet. */
    function memtest(arg) {
      const mb = Math.min(256, Math.max(8, parseInt(arg, 10) || 64));
      cliPrint(`memtest: ${mb} MiB, 4 patterns, in this tab's memory`);
      try {
        const words = mb * 262144;
        const a = new Uint32Array(words);
        const t0 = performance.now();
        let bad = 0;
        for (const pat of [0x00000000, 0xffffffff, 0xaaaaaaaa, 0x55555555]) {
          a.fill(pat);
          for (let i = 0; i < words; i++) if (a[i] !== (pat >>> 0)) bad++;
        }
        const ms = Math.max(1, performance.now() - t0);
        const rate = Math.round((mb * 4 * 2) / (ms / 1000));
        cliPrint(`  pass 1 of 1 · ${bad ? `${bad} errors` : 'no errors'} · ${Math.round(ms)} ms · ~${rate} MiB/s`);
      } catch (err) {
        cliPrint(`  could not allocate ${mb} MiB here (${err.message})`);
      }
    }

    /* The secret boot: an untuned television that finds the channel. Boots
       whichever drive is highlighted, and counts as a found secret. */
    async function signal() {
      if (booting) return;
      booting = true;
      clearInterval(timer);
      window.removeEventListener('keydown', onKey, true);
      const os = DRIVES[idx].id;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      el.classList.add('is-out');
      await wait(reduced() ? 40 : 220);
      el.remove();

      const cv = h('canvas.bpn__cv', { width: '192', height: '108', 'aria-hidden': 'true' });
      const ch = h('div.bpn__ch', { text: 'CH 03' });
      const msg = h('div.bpn__msg', { text: 'NO SIGNAL' });
      const wrap = h('div.bpn', { role: 'img', 'aria-label': 'Television static' }, cv, ch, msg);
      host.appendChild(wrap);
      sfx.boot('static');

      let skip = false;
      const onSkip = () => { skip = true; };
      window.addEventListener('keydown', onSkip, true);
      window.addEventListener('pointerdown', onSkip, true);
      const c2 = cv.getContext('2d');
      const img = c2 ? c2.createImageData(192, 108) : null;
      const t0 = performance.now();
      let raf = 0;
      const draw = now => {
        const k = Math.min(1, (now - t0) / 2400);          /* 0 → 1 as it tunes in */
        for (let i = 0; i < img.data.length; i += 4) {
          const n = Math.random() * 255 * (1 - k * 0.8);
          img.data[i] = n; img.data[i + 1] = n; img.data[i + 2] = n + k * 40; img.data[i + 3] = 255;
        }
        c2.putImageData(img, 0, 0);
        raf = requestAnimationFrame(draw);
      };
      if (img && !reduced()) raf = requestAnimationFrame(draw);
      const beat = async ms => { for (let t = 0; t < ms && !skip; t += 50) await wait(50); };
      await beat(1100);
      ch.textContent = 'CH 04'; msg.textContent = 'TUNING…';
      await beat(1000);
      wrap.classList.add('is-tuned'); msg.textContent = 'STATICOS';
      await beat(700);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onSkip, true);
      window.removeEventListener('pointerdown', onSkip, true);
      wrap.remove();

      applyOS(os);
      await playDrive(host, os, null);
      resolve(os);
      /* the achievement waits for the desktop, so its notice isn't lost under the boot */
      setTimeout(() => {
        bus.emit('egg:found', { id: 'signal' });
        import('../core/achievements.js').then(A => A.unlock('secret')).catch(() => {});
      }, 1500);
    }

    async function boot(os, typed = false) {
      if (booting) return;
      booting = true;
      clearInterval(timer);
      window.removeEventListener('keydown', onKey, true);
      const d = byId(os);
      sfx.boot('select');
      store.set('prefs', { ...store.get('prefs', {}), bootOS: os });
      applyOS(os);

      /* hand over to a plain tty that types the entry's command, GRUB style */
      el.classList.add('is-out');
      await new Promise(r => setTimeout(r, reduced() ? 40 : 220));
      el.remove();
      const t = tty(host);
      setTimeout(() => sfx.boot('post'), 180);
      const row = t.line(h('span.tty__dim', { text: 'boot> ' }));
      if (typed || reduced()) row.appendChild(h('span', { text: d.cmd }));
      else await t.type(row, d.cmd, 45);
      await t.wait(260);
      t.line(`Booting \`${d.entry.split('  ')[0]}'`);
      t.line('');
      await t.wait(240);
      if (os === 'linux') {
        t.line('Loading Linux 4.0.0-static ...');
        await t.wait(420);
        t.line('Loading initial ramdisk ...');
        await t.wait(600);
        t.clear();
      } else if (os === 'windows') {
        t.line('Starting Windows Boot Manager ...');
        await t.wait(700);
      } else {
        t.line('Starting StaticOS ...');
        await t.wait(450);
      }
      await playDrive(host, os, t);
      resolve(os);
    }
  });
}

export default runBootPicker;
