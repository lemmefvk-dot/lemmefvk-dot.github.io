/* ============================================================
   eggs.js — the hidden half of the shell.

   Four things, none of which are findable by accident:

     · the Konami sequence, which unlocks a wallpaper that is not
       in the picker until it is redeemed
     · four secret shell words, typed at the Static Terminal
       prompt: they are not in `help`, not in tab-completion, and
       nothing else in the OS mentions them
     · Phosphor, an accent that is not in the theme list
     · a colophon — the message that is not on the About page

   Rules they all obey: no key is ever preventDefault()ed unless
   it is one of the secrets, so normal typing and every arrow-key
   shortcut behave exactly as before; nothing fires on a partial
   match; and every overlay is dismissible with Escape and
   reachable from the keyboard.
   ============================================================ */
import { covered } from '../core/cover.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import * as WP from '../portal/wallpapers.js';
import * as M from '../core/metrics.js';

const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown',
  'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

/* The accent that is not in themes.js. Applied over the top of whatever
   the theme engine painted, and abandoned the moment a real accent is
   chosen, so it can never trap anyone in a colour they cannot leave. */
const PHOSPHOR = { id: 'phosphor', accent: '#5bffa8', soft: '#b6ffd8', rgb: '91 255 168', ink: '#04130b' };

const EGG_WP = {
  id: 'event-horizon',
  name: 'Event Horizon',
  code: 'EVENT-HORIZON',
};

/* A wallpaper with no file behind it: an SVG data URL, so it costs one
   string and works offline. */
function eggWallpaperUrl() {
  const stars = [
    [120, 90, 1.4], [300, 160, 1], [460, 60, 1.7], [640, 210, 1.1], [820, 120, 1.3],
    [980, 70, 1], [1120, 190, 1.5], [1290, 110, 1.1], [1440, 230, 1.2], [200, 320, 1],
    [520, 380, 1.3], [900, 340, 1], [1230, 400, 1.4], [70, 250, 1], [1540, 90, 1.2],
  ].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">'
    + '<defs><radialGradient id="h" cx="50%" cy="112%" r="72%">'
    + '<stop offset="0" stop-color="#4a0b1c"/><stop offset=".42" stop-color="#14060c"/>'
    + '<stop offset="1" stop-color="#050203"/></radialGradient>'
    + '<radialGradient id="d" cx="50%" cy="112%" r="26%">'
    + '<stop offset=".72" stop-color="#050203"/><stop offset=".76" stop-color="#ffb3c6"/>'
    + '<stop offset=".8" stop-color="#050203"/></radialGradient></defs>'
    + '<rect width="1600" height="900" fill="url(#h)"/>'
    + `<g fill="#ffffff" opacity=".55">${stars}</g>`
    + '<rect width="1600" height="900" fill="url(#d)" opacity=".9"/>'
    + '</svg>';
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function mountEggs(host) {
  const { h, icon, store, bus, on, clear } = api;
  const offs = [];
  let overlay = null;

  const typing = () => {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };

  /* ================ the hidden wallpaper ================ */
  function registerWallpaper() {
    try {
      if (WP.custom(store).some(w => w.id === EGG_WP.id)) return;
      WP.add(store, { name: EGG_WP.name, url: eggWallpaperUrl(), kind: 'image', code: EGG_WP.code });
    } catch (e) { /* the picker simply will not have it */ }
  }

  function unlockWallpaper() {
    registerWallpaper();
    const already = WP.list(store).some(w => w.id === EGG_WP.id);
    const hit = WP.redeem(store, EGG_WP.code);
    return { hit, already };
  }

  /* ================ the hidden accent ================ */
  function paintPhosphor() {
    if (store.get('prefs.accent') !== PHOSPHOR.id) return;
    const root = document.documentElement;
    root.style.setProperty('--accent', PHOSPHOR.accent);
    root.style.setProperty('--accent-soft', PHOSPHOR.soft);
    root.style.setProperty('--accent-rgb', PHOSPHOR.rgb);
    root.style.setProperty('--accent-ink', PHOSPHOR.ink);
  }

  function togglePhosphor() {
    const on = store.get('prefs.accent') === PHOSPHOR.id;
    if (on) {
      store.set('prefs.accent', store.get('prefs.accentBefore') || 'aether');
      return false;
    }
    store.set('prefs.accentBefore', store.get('prefs.accent'));
    store.set('prefs.accent', PHOSPHOR.id);
    paintPhosphor();
    return true;
  }

  /* ================ overlays ================ */
  function closeOverlay() {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 240);
  }

  function openOverlay(node, label) {
    closeOverlay();
    overlay = h('div.egg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' }, node);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
    host.appendChild(overlay);
    overlay.focus({ preventScroll: true });
    return overlay;
  }

  /** The message that is not on the About page. */
  function colophon() {
    const hw = M.hardware();
    const row = (k, v) => h('div.egg__kv', h('span', { text: k }), h('b', { text: v }));
    const card = h('div.egg__card',
      h('div.egg__mark', icon('diamond')),
      h('div.egg__h', { text: 'You found the quiet part' }),
      h('p.egg__p', { text: 'StaticOS is a desktop drawn by a single tab: no frameworks, no build step, '
        + 'one accent token, and not one number on screen that the browser did not hand over.' }),
      h('div.egg__rows',
        row('Shell', String(store.get('system.os') || 'StaticOS')),
        row('Browser', hw.browser),
        row('Platform', hw.platform),
        row('Screen', `${hw.screen} · ${hw.dpr}×`),
        hw.cores ? row('Logical cores', String(hw.cores)) : null,
        row('Type', 'Inter · JetBrains Mono'),
        row('Proxy', 'Ultraviolet · Epoxy · Bare-Mux')),
      h('p.egg__sig', { text: 'Thanks for reading the source. — the Static shell' }),
      h('button.btn.btn--sm', { text: 'Close', onclick: closeOverlay }));
    openOverlay(card, 'Colophon');
  }

  /** A cold boot that never actually happened. */
  function coldBoot() {
    const LINES = [
      'aether boot rom v3.0.1 — 1600x900 text mode',
      'cpu: unavailable to a web page  ·  mem: reported by the browser',
      'probing display .......... ok',
      'probing input ............ ok',
      'mounting aetherfs ........ ok (in memory)',
      'starting compositor ...... ok',
      'starting aether shell .... ok',
      '',
      'nothing here is real except the frame rate.',
      'press any key',
    ];
    const pre = h('div.egg__boot');
    const card = h('div.egg__bootwrap', pre);
    const el = openOverlay(card, 'Cold boot');
    const reduced = document.body.classList.contains('reduce-motion')
      || matchMedia('(prefers-reduced-motion: reduce)').matches;

    let i = 0, timer = 0;
    const step = () => {
      pre.appendChild(h('div', { text: LINES[i] || ' ' }));
      if (++i < LINES.length) timer = setTimeout(step, 150);
    };
    if (reduced) LINES.forEach(l => pre.appendChild(h('div', { text: l || ' ' })));
    else step();

    /* "press any key" is one listener that removes itself — leaving it bound
       would make every later keystroke close whatever is open */
    const stop = on(window, 'keydown', () => { clearTimeout(timer); stop(); closeOverlay(); });
    el.addEventListener('click', () => { clearTimeout(timer); stop(); closeOverlay(); });
  }

  /* ================ secret shell words ================ */
  const term = {
    line(out, row, kids) {
      const span = h('span.term__line', kids);
      out.insertBefore(span, row);
      out.scrollTop = out.scrollHeight;
    },
    say(out, row, text, cls) {
      term.line(out, row, h(cls ? `span.${cls}` : 'span', { text }));
    },
    echo(out, row, cmd) {
      const path = row.querySelector('.term__path')?.textContent || '~';
      const who = row.querySelector('.term__ps1')?.textContent || 'static@staticos';
      term.line(out, row, [
        h('span.term__ps1', { text: who }), ' ',
        h('span.term__path', { text: path }),
        h('span.term__dim', { text: ']$ ' }),
        h('span', { text: cmd }),
      ]);
    },
  };

  const SECRETS = {
    xyzzy(out, row) {
      const n = (Number(store.get('prefs.eggXyzzy')) || 0) + 1;
      store.set('prefs.eggXyzzy', n);
      term.say(out, row, 'Nothing happens.', 'term__dim');
      if (n === 3) {
        term.say(out, row, 'Well — almost nothing. Try `phosphor`.', 'term__ok');
      }
    },
    'sudo make me a sandwich'(out, row) {
      term.say(out, row, 'staticsh: what? make it yourself.', 'term__err');
    },
    colophon(out, row) {
      term.say(out, row, 'staticos — colophon', 'term__ok');
      term.say(out, row, 'no frameworks, no build step, one accent token.', 'term__dim');
      colophon();
    },
    phosphor(out, row) {
      const on2 = togglePhosphor();
      term.say(out, row, on2 ? 'accent set to phosphor (not in the theme list)' : 'accent restored', 'term__ok');
    },
    devroom(out, row) {
      term.say(out, row, 'opening the door you were not supposed to find…', 'term__dim');
      api.openApp('devroom');
    },
    coldboot(out, row) {
      term.say(out, row, 'rebooting into text mode…', 'term__dim');
      coldBoot();
    },
    'the answer'(out, row) {
      term.say(out, row, '42', 'term__ok');
      term.say(out, row, '— to Life, the Universe, and Everything.', 'term__dim');
    },
    hello(out, row) {
      term.say(out, row, 'hi. you found a hidden greeting. there are a few of these.', 'term__ok');
    },
  };

  /* A capture-phase listener so the terminal's own Enter handler never sees
     these words. It bails out unless the value matches a secret exactly, so
     every real command reaches the shell untouched. */
  function onKey(e) {
    if (e.key !== 'Enter' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const input = e.target;
    if (!input || input.tagName !== 'INPUT') return;
    const row = input.closest?.('.term__in');
    const out = row?.closest?.('.term__out');
    if (!row || !out) return;
    const raw = String(input.value || '').trim();
    const run = SECRETS[raw.toLowerCase()];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    input.value = '';
    term.echo(out, row, raw);
    try { run(out, row); bus.emit('egg:found', { id: raw.toLowerCase() }); } catch (err) { term.say(out, row, `staticsh: ${err.message}`, 'term__err'); }
  }

  /* ================ konami ================ */
  let seq = [];
  function onKonami(e) {
    if (typing()) { seq = []; return; }
    const k = String(e.key || '').toLowerCase();
    seq.push(k);
    /* keep only the tail that is still a prefix of the sequence, compared
       key by key — a joined-string prefix test matches 'a' against 'arrowup' */
    while (seq.length && !seq.every((v, i) => KONAMI[i] === v)) seq.shift();
    if (seq.length !== KONAMI.length) return;
    seq = [];
    const { hit, already } = unlockWallpaper();
    if (hit) bus.emit('egg:found', { id: 'konami' });
    if (hit && !already) {
      api.notify({
        app: 'StaticOS', icon: 'wallpaper', title: 'Event Horizon unlocked',
        message: 'A wallpaper that was not in the picker. Appearance → Wallpaper.',
        actions: [
          { label: 'Use it', onClick: () => WP.setActive(store, EGG_WP.id) },
          { label: 'Later' },
        ],
      });
    } else {
      colophon();
    }
  }

  /* ================ wiring ================ */
  registerWallpaper();
  paintPhosphor();

  offs.push(
    on(window, 'keydown', onKey, true),
    on(window, 'keydown', e => { if (!covered()) onKonami(e); }),
    on(window, 'keydown', e => { if (e.key === 'Escape' && overlay) closeOverlay(); }),
    /* subscribing to 'prefs' (not 'prefs.accent') puts this after main.js's
       applyPrefs, whose inline accent values would otherwise win */
    store.sub('prefs', paintPhosphor),
    bus.on('eggs:colophon', colophon),
    bus.on('eggs:coldboot', coldBoot),
  );

  return () => {
    offs.splice(0).forEach(off => { try { off(); } catch (e) {} });
    closeOverlay();
  };
}

export default mountEggs;
