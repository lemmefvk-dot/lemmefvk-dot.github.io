/* ============================================================
   about.js — About This Static.

   This page used to list a Wayland compositor, a blur library
   and 12,400 beta testers. None of it existed. Since the brief
   is explicit that invented statistics have to go, every fact
   here is now read from somewhere real: build.json for the
   version, js/core/metrics.js for the machine, the registry for
   the app count, and the icon set for its own size.

   The credits are the genuine third-party dependencies, with
   their actual licences, because a browser OS that vendors a
   proxy stack and leans on two public APIs ought to say so.
   ============================================================ */

import { defineApp } from '../core/registry.js';
import * as M from '../core/metrics.js';
import { listApps } from '../core/registry.js';
import { iconNames } from '../core/icons.js';
import { THEMES } from '../core/themes.js';
import { BRAND } from '../portal/brand.js';
import * as SI from '../core/sysinfo.js';
import { t as tr } from '../core/i18n.js';

/* Real dependencies, with the licence each is actually under. */
const CREDITS = [
  ['Vendored — the proxy', [
    ['Ultraviolet 3.2.10', 'Titanium Network · AGPL-3.0 · the request rewriter'],
    ['bare-mux 2.1.6', 'Mercury Workshop · MIT · request multiplexer'],
    ['epoxy-transport 3.0.1', 'Mercury Workshop · MIT · the encrypted tunnel'],
  ]],
  ['Vendored — Python in Code', [
    ['Pyodide 314.0.7', 'The Pyodide contributors · MPL-2.0 (vendor/pyodide/LICENSE-MPL-2.0.txt) · CPython 3.14 compiled to WebAssembly, fetched only when a Python file is first run'],
    ['CPython 3.14', 'Python Software Foundation · PSF License · the interpreter and standard library inside Pyodide'],
    ['Emscripten', 'The Emscripten authors · MIT · the toolchain Pyodide’s WebAssembly was built with'],
  ]],
  ['Vendored — Static Code’s Format and SQL playground', [
    ['js-beautify 1.15.4', 'Einar Lielmanis, Liam Newman and contributors · MIT (vendor/jsbeautify/LICENSE) · Format for HTML, CSS and JavaScript, fetched only when Format is first pressed'],
    ['sql.js 1.13.0', 'The sql.js authors · MIT (vendor/sqljs/LICENSE) · SQLite in WebAssembly for the SQL playground, fetched only when a .sql file is first run'],
    ['SQLite', 'D. Richard Hipp and the SQLite developers · public domain · the database engine inside sql.js'],
  ]],
  ['Vendored — PDF tools and Static Slides’ PDF checks', [
    ['pdf.js 4.10.38', 'Mozilla and contributors · Apache-2.0 (vendor/pdfjs/LICENSE; checksums in its README) · draws the pages of a PDF in PDF tools, fetched only when a PDF is first opened'],
    ['pdf-lib 1.17.1', 'Andrew Dillon and contributors · MIT (vendor/pdflib/LICENSE.md) · writes marks into a copy of a PDF, merges and splits, fetched only when a PDF is first saved'],
  ]],
  ['Vendored — the QR scanner', [
    ['jsQR 1.4.0', 'Cosmo Wolfe · Apache-2.0 · reads QR codes when the browser has no BarcodeDetector (js/vendor/jsqr; checksums in its README)'],
  ]],
  ['Public services Static leans on', [
    ['wisp relays', 'Mercury Workshop, Terbium, Anura — free, and not ours'],
    ['roproxy.com', 'a CORS mirror of the Roblox API'],
    ['archive.org', 'the in-browser emulator and its search API, and the audiobook files in Music’s Audiobooks page'],
    ['LibriVox', 'volunteers who record public-domain books; every recording in Music’s Audiobooks page is theirs, read by the reader named on its page, and played from archive.org (LibriVox’s own API sends no CORS header, so it isn’t used)'],
    ['CrazyGames · GameDistribution', 'the embeddable game catalogues'],
    ['TradingView', 'the free chart, technical analysis and screener widgets in Static Markets, in sandboxed frames with TradingView’s own logo and link; charts by TradingView, not ours'],
    ['Twelve Data', 'the stock, ETF and crypto prices behind Static Markets’ own charts and practice trading (with your own free key)'],
    ['Open-Meteo · PokéAPI · GitHub API · JSONPlaceholder', 'the examples in Static Code’s Try web APIs: public APIs that allow browser requests; nothing is sent to them until you press Send'],
  ]],
  ['Free Classics: old games, not made by StaticOS', [
    ['Beneath a Steel Sky', 'Revolution Software Ltd · freeware licence (classics/sky/readme.txt) · files unmodified'],
    ['ScummVM', 'The ScummVM Team · GPL-3.0-or-later · runs Beneath a Steel Sky · source at classics/sky/index.html'],
    ['Micropolis', 'Electronic Arts Inc. · GPL-3.0 with EA’s additional terms · a modified copy, not affiliated with Electronic Arts'],
    ['micropolisJS', 'Graeme McCutcheon · GPL-3.0 with the same terms · source at classics/micropolis/index.html'],
    ['Micropolis, the name', 'Micropolis is a registered trademark of Micropolis Corporation (Micropolis GmbH) and is licensed here as a courtesy of the owner under the Micropolis Public Name License.'],
    ['jQuery', 'OpenJS Foundation and contributors · MIT · part of micropolisJS'],
    ['Chunk typeface', 'Meredith Mandel · SIL Open Font License · part of micropolisJS'],
    ['SDL Sopwith', 'David L. Clark, BMB Compuscience; port by Simon Howard and contributors · GPL-2.0-or-later · source at classics/sopwith/index.html'],
    ['Flight of the Amazon Queen', 'John Passfield and Steve Stamatiadis · freeware licence (classics/queen/readme.txt) · files unmodified'],
    ['Lure of the Temptress', 'Revolution Software Ltd · freeware licence (classics/lure/LICENSE.txt) · files unmodified'],
    ['Drascula: The Vampire Strikes Back', 'Alcachofa Soft S.L. · freeware licence (classics/drascula/readme.txt) · files unmodified'],
    ['ScummVM, again', 'The ScummVM Team · GPL-3.0-or-later · runs those three, and your own old adventures · source at classics/scummvm/index.html'],
    ['Freedoom', 'Contributors to the Freedoom project · BSD-3-Clause (classics/freedoom/freedoom-COPYING.txt)'],
    ['doomgeneric and Chocolate Doom', 'id Software, Simon Howard and the Chocolate Doom contributors, ozkl and the doomgeneric contributors · GPL-2.0 · runs Freedoom and your own DOOM.WAD · source at classics/freedoom/index.html'],
    ['SDL and Emscripten', 'Sam Lantinga and the SDL contributors · zlib; the Emscripten contributors · MIT · both built into the games above'],
    ['zlib, libogg and libvorbis', 'Jean-loup Gailly and Mark Adler · zlib; Xiph.Org Foundation · BSD · built into the own-copy ScummVM'],
  ]],
  ['Free comics in Static Manga (comics/, sources and licence quotes in docs/free-comics.md)', [
    ['Pepper&Carrot', 'Art & scenario: David Revoy, www.peppercarrot.com · CC BY 4.0 (creativecommons.org/licenses/by/4.0) · all 39 published episodes, English, pages downscaled to 720 px wide'],
    ['Mini Fantasy Theater', 'David Revoy, www.peppercarrot.com · CC BY-SA 4.0 · pages downscaled'],
    ['Max und Moritz', 'Wilhelm Busch, 1865 · public domain (author died 1908) · page scans from Wikimedia Commons'],
    ['All-Negro Comics no. 1', 'Orrin C. Evans, 1947 · public domain in the US (copyright not renewed) · scan from Wikimedia Commons'],
  ]],
  ['Data', [
    ['PubChem periodic table', 'NCBI, US National Library of Medicine · public domain · every element fact in the Periodic Table app'],
    ['EFF long word list', 'Electronic Frontier Foundation · Creative Commons Attribution (CC BY) · the 7,776 words behind Dev Tools’ passphrases, unchanged (eff.org/dice)'],
    ['SCOWL word lists 2020.12.07', 'Kevin Atkinson (Spell Checker Oriented Word Lists), built on public-domain lists by Grady Ward, Alan Beale and others · free to use and redistribute with its notice (data/words/SCOWL-COPYRIGHT.txt) · the words in Letter Grid and Unscramble, minus anything offensive'],
    ['Wikidata', 'Wikimedia Foundation · CC0 · the countries and capitals in the Geography quiz (Static Drills); not required to credit, credited anyway'],
    ['country-flags', 'hampusborgos/country-flags, from Wikimedia Commons · public domain (stated in its README) · the SVG flags in the Geography quiz'],
  ]],
  ['The StaticOS videos', [
    ['ElevenLabs', 'sound effects in the bubbles and Halloween videos · Will’s voice narrates the Halloween one'],
  ]],
  ['Typefaces', [
    ['Inter', 'Rasmus Andersson · SIL Open Font License'],
    ['JetBrains Mono', 'JetBrains · SIL Open Font License'],
    ['Anton', 'The Anton Project Authors · SIL Open Font License · the meme maker’s impact-style text (Impact, if you have it, is the fallback)'],
    ['Bangers', 'Vernon Adams and the Bangers Project Authors · SIL Open Font License (css/fonts/Bangers-OFL.txt) · the comic maker’s lettering'],
    ['OpenDyslexic', 'Abbie Gonzalez · SIL Open Font License · the reading font for dyslexia (Settings › Accessibility); licence in css/fonts'],
    ['Atkinson Hyperlegible', 'Braille Institute of America · SIL Open Font License · the low-vision reading font; licence in css/fonts'],
  ]],
  ['Written here, from nothing', [
    ['The window manager', 'drag, resize, snap, minimise — no library'],
    ['The icon set', 'every glyph hand-drawn as inline SVG'],
    ['The wallpaper', 'planet, ridgeline, lake and grid, drawn in CSS'],
    ['The filesystem', 'one tree, shared by Files and the Terminal'],
  ]],
];

const PHILOSOPHY = [
  tr('One address, and everything behind it.'),
  tr('Nothing opens in a new tab — on a locked-down network a tab is a dead end.'),
  tr('No number on screen was invented. What cannot be measured is named as unmeasurable.'),
  tr('No build step, no framework, no dependencies. It is the files you can read.'),
];

/* how long this tab has been running StaticOS: counted from when the page
   started loading, not from when this window was first opened */
const upStr = sec => SI.durationText(sec);

defineApp({
  id: 'about',
  name: `About This ${BRAND.name}`,
  icon: 'info',
  g1: '#c2cada', g2: '#525a6d',
  category: 'System',
  keywords: ['about', 'system', 'version', 'build', 'specs', 'credits', 'licences'],
  desc: tr('Version, real machine facts and credits'),
  hidden: true, singleton: true,
  win: { w: 470, h: 580, minW: 400, minH: 460 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, render, clear } = api;

    const S = { view: 'about', taps: 0, dead: false };
    const R = {};

    const body = h('div.ab');

    const tick = setInterval(() => {
      if (S.dead || !R.up || !body.contains(R.up)) return;
      R.up.textContent = upStr(SI.sessionSeconds());
    }, 1000);

    const teardown = () => { S.dead = true; clearInterval(tick); };

    function paint() {
      clear(body);
      if (S.view === 'credits') return credits();
      if (S.view === 'philosophy') return philosophy();
      about();
    }

    const row = (k, v, title) => h('div.ab__row', { title: title || null },
      h('span', { text: k }), h('b', { text: v }));

    function about() {
      R.up = h('b', { text: upStr(SI.sessionSeconds()) });

      /* The mark is the easter egg: seven taps switches theme. It is
         deliberately undiscoverable by accident — nobody clicks a logo
         seven times unless they are poking at it. */
      const mark = h('button.ab__mark', {
        type: 'button', 'aria-label': tr('{name} mark', { name: BRAND.name }),
        onclick: () => {
          S.taps++;
          if (S.taps < 7) return;
          S.taps = 0;
          const list = THEMES;
          const now = document.documentElement.dataset.accent;
          const next = list[(list.findIndex(t => t.id === now) + 1) % list.length];
          const prefs = { ...api.store.get('prefs', {}), accent: next.id };
          api.store.set('prefs', prefs);
          api.notify({ app: 'About', icon: 'sparkles', title: next.name, message: next.note });
        },
      }, icon(BRAND.icon, { size: 30 }));

      const info = h('div.ab__list');
      body.append(
        h('div.ab__head', mark,
          h('div',
            R.name = h('div.ab__name', { text: 'StaticOS' }),
            h('div.ab__tag', { text: BRAND.tagline }))),
        info,
        h('div.ab__btns',
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.view = 'credits'; paint(); } },
            icon('users', { size: 13 }), tr('Credits')),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.view = 'philosophy'; paint(); } },
            icon('info', { size: 13 }), tr('What it is for'))),
        /* The Updates row and the Install button live in Settings › About; this
           links to them rather than drawing a second copy. */
        h('div.ab__btns.ab__btns--wrap',
          R.copy = h('button.btn.btn--sm', { type: 'button', onclick: copyInfo },
            icon('copy', { size: 13 }), tr('Copy system info')),
          h('button.btn.btn--sm', { type: 'button', title: tr('Updates and installing are in Settings › About'),
            onclick: () => api.openApp('settings', { section: 'about' }) },
            icon('download', { size: 13 }), tr('Check for updates')),
          api.getApp('whatsnew') ? h('button.btn.btn--sm', { type: 'button', title: tr('The release notes for this version'),
            onclick: () => api.openApp('whatsnew') }, icon('sparkles', { size: 13 }), tr('Release notes')) : null,
          api.getApp('feedback') ? h('button.btn.btn--sm', { type: 'button',
            title: tr('Opens Feedback with your system info filled in. You read it and press Send yourself.'),
            onclick: reportProblem }, icon('bug', { size: 13 }), tr('Report a problem')) : null));

      /* Everything below is read, not declared. */
      const hw = M.hardware();
      const boot = SI.bootText();
      info.append(
        h('div.ab__sec', { text: tr('This build') }),
        R.build = row(tr('Build'), tr('reading…')),
        row(tr('Apps'), String(listApps().length)),   /* what you can actually open — same as Settings */
        row(tr('Icons'), String(iconNames().length)),
        row(tr('Themes'), String(THEMES.length)),
        row(tr('Session up'), ''),
        row(tr('Desktop up after'), boot.alive, tr('Measured from when the page started loading to when the desktop appeared.')),
        row(tr('Ready after'), boot.ready, tr('Until the session was restored. A boot menu or first-run setup that waited for you counts too.')),
        h('div.ab__sec', { text: tr('This machine') }),
        row(tr('Browser'), hw.browser),
        row(tr('Platform'), hw.platform),
        row(tr('Logical cores'), hw.cores ? String(hw.cores) : tr('not reported')),
        row(tr('Device memory'), hw.memoryGB ? `${hw.memoryGB} GB` : tr('not reported'),
          tr('Browsers round this deliberately, to make fingerprinting harder.')),
        row(tr('Screen'), `${hw.screen} @ ${hw.dpr}×`),
        h('div.ab__sec', { text: tr('Storage') }),
        R.store = row(tr('Used'), tr('reading…')));

      /* put the live uptime into its row */
      const upRow = [...info.querySelectorAll('.ab__row')].find(r => r.firstChild.textContent === tr('Session up'));
      if (upRow) { clear(upRow.lastChild); upRow.replaceChild(R.up, upRow.lastChild); }

      fetch('build.json', { cache: 'no-store' })
        .then(r => r.json())
        .then(b => {
          if (S.dead || !R.build) return;
          R.build.lastChild.textContent = tr('{build} · {files} files · {mb} MB', { build: b.build, files: b.files, mb: (b.bytes / 1e6).toFixed(1) });
          /* the version is build.json's (tools/bump.mjs takes it from data/changelog.json) */
          if (R.name && b.version) R.name.textContent = `StaticOS ${b.version}`;
          R.build.title = tr('Stamped {date}', { date: String(b.stamped).slice(0, 10) });
        })
        .catch(() => { if (R.build) R.build.lastChild.textContent = tr('unavailable'); });

      M.storage().then(s => {
        if (S.dead || !R.store) return;
        R.store.lastChild.textContent = s
          ? tr('{used} of {quota}', { used: M.formatBytes(s.used), quota: M.formatBytes(s.quota) })
          : tr('not reported by this browser');
      });
    }

    async function copyInfo() {
      const text = `${await SI.versionLine()}\n${await SI.infoText()}`;
      const ok = await SI.copyText(text);
      api.notify({ app: 'About', icon: ok ? 'copy' : 'alert', title: ok ? tr('System info copied') : tr('Could not copy'),
        message: ok ? tr('No name, files or settings are in it.') : tr('The browser refused clipboard access.'), timeout: 3000 });
    }

    /* Feedback opens with a bug, this window's facts ticked in and shown, and
       nothing sent: the person reads them and presses Send. */
    function reportProblem() {
      api.openApp('feedback', { type: 'bug', diag: true });
    }

    function credits() {
      body.append(backBar('Credits'));
      const list = h('div.ab__list');
      for (const [group, rows] of CREDITS) {
        list.appendChild(h('div.ab__sec', { text: group }));
        for (const [name, note] of rows) {
          list.appendChild(h('div.ab__credit',
            h('b', { text: name }),
            h('small', { text: note })));
        }
      }
      list.appendChild(h('div.ab__sec', { text: tr('On the public services') }));
      list.appendChild(h('div.ab__note', {
        text: tr('The wisp relays, roproxy and archive.org are run by other people, for free, and can disappear at any time. Static fails over between them and says so when they are down rather than pretending the feature is broken.'),
      }));
      body.appendChild(list);
    }

    function philosophy() {
      body.append(backBar(tr('What it is for')));
      const list = h('div.ab__list');
      for (const line of PHILOSOPHY) {
        list.appendChild(h('div.ab__phil', icon('diamond', { size: 11 }), h('span', { text: line })));
      }
      list.appendChild(h('div.ab__note', {
        text: tr('StaticOS is one website that behaves like a desktop, so that everything lives behind a single address instead of a folder of links that get blocked one at a time.'),
      }));
      body.appendChild(list);
    }

    function backBar(title) {
      return h('div.ab__back',
        h('button.ibtn', { type: 'button', 'aria-label': tr('Back'),
          onclick: () => { S.view = 'about'; paint(); } }, icon('chevron-left')),
        h('b', { text: title }));
    }

    /* Mounted last: paint() reaches for row(), which is a const and is in
       its temporal dead zone until its own line runs. Calling paint()
       earlier throws halfway through building the panel, and because the
       head and the list are appended first the window still looks fine —
       just permanently empty. That failure mode is why this is at the end. */
    render(root, body);
    paint();
    return teardown;
  },
});
