/* ============================================================
   classics/ui.js — the Free Classics shelf and player, inside Static
   Arcade (js/apps/arcade.js owns the window; this owns these two views).

   The card always says who made the game, under what licence, and where
   its licence and source are. So does the player, for as long as the game
   is on screen. Nothing here is rated or counted: a card only shows what
   is true of this device (saved games and when the last one was written,
   already downloaded, your own files kept).

   "Play your own old copy" (a game with `own` in ./catalog.js): the
   player picks the game's folder or file on their device. The files are
   read here, handed to the game's sealed frame, and never uploaded; they
   are kept on this device only if the person ticks "Keep", and only for
   them (./runner.js). A guest's are forgotten when the game closes.

   Scale (the player's bar): fit, sharp pixels or stretch, kept per game
   in the OS store at portal.classics.scale.
   ============================================================ */
import { CLASSICS, classicById, CLASSIC_PREFIX, controlsOf } from './catalog.js';
import {
  startClassic, deviceState, removeFromDevice, resetSaves, downloadBytes, savesKept,
  ownKept, keptInfo, keptFiles, keepFiles, ownPath, MAX_OWN, MAX_OWN_FILES,
} from './runner.js';
import { people } from '../core/profiles.js';

export const mb = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const external = { target: '_blank', rel: 'noopener noreferrer' };
const GUEST_SAVES = 'You’re a guest: saved games last until you reload this tab or end the session.';
const STAYS = 'Your files are read in this browser and go only into the game’s sealed frame. They are never uploaded.';
/* what Remove takes away, as it is for this person */
const removeText = () => (!savesKept()
  ? 'This deletes the saved games you made in this guest session. The downloaded files stay: they are shared with everyone on this computer.'
  : people().length > 1
    ? 'This deletes your saved games, which cannot come back, and the downloaded files, which everyone on this computer shares and which download again when someone presses Play. Other people’s saved games stay.'
    : 'This deletes its saved games and its downloaded files here. You can download it again by pressing Play, but saved games cannot come back.');

const SCALES = [
  { id: 'fit', label: 'Fit', tip: 'as large as fits, in the game’s own shape' },
  { id: 'sharp', label: 'Sharp', tip: 'whole multiples of the game’s pixels, so each pixel is the same size' },
  { id: 'stretch', label: 'Stretch', tip: 'the whole area, whatever the shape' },
];
const PREFS = 'portal.classics';

/* "8 Nov 2026, 22:41": a save is a moment, so the time is part of it */
const when = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function classicsUI({ api, h, icon, clear, plays, soundOn, onOpen, onBack, onToggleSound, onToggleFs, soundBtnPaint, fsBtnPaint }) {
  let alive = true;
  const store = api.store;
  const scaleOf = id => { const m = store?.get(PREFS)?.scale?.[id]; return SCALES.some(s => s.id === m) ? m : 'fit'; };
  const setScaleOf = (id, mode) => {
    const cur = store?.get(PREFS) || {};
    store?.set(PREFS, { ...cur, scale: { ...(cur.scale || {}), [id]: mode } });
  };

  /* ---------------------------- the shelf ---------------------------- */
  function link(label, href, ic) {
    return h('a.arc-clc__link', { href, ...external }, ic ? icon(ic) : null, h('span', { text: label }));
  }

  function licenceLinks(g) {
    return [
      link('Licence', g.links.licence, 'file-text'),
      link('Source code', g.links.source, 'code'),
    ];
  }

  function card(g) {
    const ownOnly = !!g.own?.only;
    const ctl = controlsOf(g);
    const state = h('span.arc-clc__state', { dataset: { state: '' } });
    const saved = h('p.arc-clc__saved', { hidden: true });
    const reset = h('button.arc-clc__reset', {
      type: 'button', hidden: true,
      onclick: async () => {
        const ok = await api.confirm({
          title: `Reset ${g.title}’s saved games?`,
          message: `This deletes the saved games and settings ${g.title} keeps ${savesKept() ? 'on this device' : 'in this guest session'}. The game stays downloaded. Saved games cannot come back.`,
          ok: 'Reset', danger: true,
        });
        if (!ok) return;
        try {
          await resetSaves(g);
          api.notify({ app: 'Static Arcade', icon: 'rotate-ccw', title: `${g.title}: saved games reset`, message: 'The game is still downloaded. It starts fresh next time.' });
        } catch (err) {
          api.notify({ app: 'Static Arcade', icon: 'alert', title: 'Could not reset them', message: err?.message || String(err) });
        }
        paintState();
      },
    }, icon('rotate-ccw'), h('span', { text: 'Reset saved games' }));
    const remove = h('button.arc-clc__remove', {
      type: 'button', hidden: true,
      onclick: async () => {
        const ok = await api.confirm({
          title: `Remove ${g.title} from this device?`,
          message: removeText() + (g.own && ownKept() ? ' Your own game files kept here go too.' : ''),
          ok: 'Remove', danger: true,
        });
        if (!ok) return;
        try {
          await removeFromDevice(g);
          api.notify({ app: 'Static Arcade', icon: 'trash', title: `${g.title} removed`, message: savesKept() ? 'Its saves and downloaded files are gone from this device.' : 'Your saves from this session are gone.' });
        } catch (err) {
          api.notify({ app: 'Static Arcade', icon: 'alert', title: 'Could not remove it', message: err?.message || String(err) });
        }
        paintState();
      },
    }, icon('trash'), h('span', { text: 'Remove from this device' }));

    const size = mb(downloadBytes(g, ownOnly));
    const sizeEl = h('span.arc-meta', { title: 'Downloaded the first time you play, then kept on this device' },
      icon('download'), h('span', { text: ownOnly ? `${size} engine on first play` : `${size} on first play` }));
    /* the controls hint: what the game is played with, and only that */
    const controls = h('span.arc-meta.arc-clc__controls', { dataset: { controls: g.controls || 'both' }, title: g.how },
      icon(ctl.icon), h('span', { text: ctl.label }));

    function paintState() {
      deviceState(g).then(s => {
        if (!alive) return;
        const bits = [];
        if (s.saves) bits.push(s.saves === 1 ? '1 saved file' : `${s.saves} saved files`);
        if (s.downloaded) bits.push('downloaded');
        if (s.kept) bits.push(`your files kept (${mb(s.kept.bytes)})`);
        state.textContent = bits.length ? `On this device: ${bits.join(', ')}` : '';
        state.dataset.state = s.saves ? 'saved' : s.downloaded ? 'downloaded' : s.kept ? 'kept' : '';
        saved.hidden = !s.lastSaved;
        clear(saved);
        if (s.lastSaved) {
          saved.append(icon('clock'), h('span', { text: 'Last saved ' }),
            h('time', { dateTime: new Date(s.lastSaved).toISOString(), text: when(s.lastSaved) }));
        }
        reset.hidden = !s.saves;
        remove.hidden = !(s.saves || (s.downloaded && savesKept()) || s.kept);
        sizeEl.hidden = s.downloaded;
      }).catch(() => {});
    }
    paintState();

    const year = g.year ? String(g.year) : 'Yours';
    return h('article.arc-clc', { style: { '--h': g.hue }, dataset: { classic: g.id } },
      h('div.arc-clc__art', { 'aria-hidden': 'true' }, icon(g.icon), h('b', { text: year })),
      h('div.arc-clc__body',
        h('h3.arc-clc__title', { text: g.title }),
        h('div.arc-clc__maker', { text: g.year ? `${g.maker}, ${g.year}` : g.maker }),
        h('p.arc-clc__blurb', { text: g.blurb }),
        h('div.arc-clc__meta',
          h('span.arc-meta', icon('gamepad'), h('span', { text: g.genre })),
          controls,
          sizeEl),
        h('div.arc-clc__acts',
          h('button.arc-clc__play', {
            type: 'button', 'aria-label': ownOnly ? `${g.title}: choose your game` : `Play ${g.title}`, onclick: () => onOpen(g.id),
          }, icon(ownOnly ? 'folder-open' : 'play', ownOnly ? {} : { fill: true }), h('span', { text: ownOnly ? 'Choose your game' : 'Play' })),
          g.own && !ownOnly ? h('button.arc-clc__own', {
            type: 'button', title: `Play ${g.own.what} instead`, 'aria-label': `Play ${g.own.what} instead of ${g.title}`,
            onclick: () => onOpen(g.id, { own: true }),
          }, icon('folder-open'), h('span', { text: 'Play your own copy' })) : null,
          state, reset, remove),
        saved,
        h('p.arc-clc__licence', { text: g.licence }),
        h('p.arc-clc__credit', { text: g.credit }),
        g.trademark ? h('p.arc-clc__tm', h('span', { text: `${g.trademark} ` }),
          ...g.trademarkLinks.flatMap((l, i) => [i ? ' · ' : '', h('a', { href: l.href, ...external, text: l.label })])) : null,
        h('div.arc-clc__links', licenceLinks(g), link('More about this game', g.links.about, 'info'))));
  }

  function shelf() {
    return h('section.arc-cls', { 'aria-labelledby': 'arc-cls-title' },
      h('div.arc-cls__head',
        h('h2#arc-cls-title.arc-cls__title', { text: 'Free Classics' }),
        h('p.arc-cls__sub', { text: `Old games their makers or rights-holders released for free. StaticOS did not make them and does not own them. Each downloads once, when you first play, and ${savesKept() ? 'your saves stay on this device.' : 'stays on this device for everyone here.'} The last cards play your own copy of an old game: its files stay in this browser.` }),
        savesKept() ? null : h('p.arc-cls__sub', { dataset: { guest: '' }, text: GUEST_SAVES })),
      h('div.arc-cls__grid', CLASSICS.map(card)));
  }

  /* ---------------------------- the player --------------------------- */
  const P = { inst: null, game: null, own: null, picked: null };
  const titleEl = h('span.arc-hud__name');
  const dot = h('span.arc-hud__dot');
  const makerEl = h('span.arc-clp__maker');
  const soundBtn = h('button.arc-ib', { type: 'button', onclick: () => { onToggleSound(); paintSound(); P.inst?.setMuted(!soundOn()); P.inst?.focus(); } });
  const scaleBtn = h('button.arc-ib.arc-clp__scale', { type: 'button', onclick: () => cycleScale() });
  const fsBtn = onToggleFs ? h('button.arc-ib', { type: 'button', onclick: () => onToggleFs(view) }) : null;
  const back = h('button.arc-ib.arc-ib--back', { type: 'button', 'aria-label': 'Back to the Arcade', title: 'Back to the Arcade', onclick: onBack },
    icon('chevron-left'), h('span', { text: 'Arcade' }));
  const hud = h('div.arc-hud',
    h('div.arc-hud__left', back, h('div.arc-hud__title', dot, titleEl), makerEl),
    h('div.arc-hud__tools', soundBtn, scaleBtn, fsBtn));
  const host = h('div.arc-clp__host');
  const cover = h('div.arc-clp__cover');
  const stage = h('div.arc-clp__stage', host, cover);
  const foot = h('div.arc-clp__foot');
  const view = h('section.arc-clp', hud, stage, foot);

  function paintSound() { soundBtnPaint(soundBtn); }
  function paintScale() {
    const g = P.game;
    scaleBtn.hidden = !g || g.run.type !== 'wasm';
    if (!g) return;
    const s = SCALES.find(x => x.id === scaleOf(g.id));
    clear(scaleBtn);
    scaleBtn.append(icon('maximize'), h('span', { text: s.label }));
    scaleBtn.dataset.scale = s.id;
    scaleBtn.title = `Scale: ${s.label}, ${s.tip}. Press to change.`;
    scaleBtn.setAttribute('aria-label', `Scale: ${s.label}, ${s.tip}. Press for the next one.`);
  }
  function cycleScale() {
    const g = P.game;
    if (!g) return;
    const i = SCALES.findIndex(x => x.id === scaleOf(g.id));
    const next = SCALES[(i + 1) % SCALES.length].id;
    setScaleOf(g.id, next);
    paintScale();
    P.inst?.setScale(next);
    P.inst?.focus();
  }

  function showProgress(g, p) {
    clear(cover);
    cover.hidden = false;
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    const starting = p.phase === 'starting';
    const label = starting ? `Starting ${g.title}…` : `Downloading ${g.title}: ${mb(p.done)} of ${mb(p.total)}`;
    cover.append(h('div.arc-clp__load',
      h('div.arc-clp__loadtext', { text: label }),
      h('div.arc-clp__bar', {
        role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct),
        dataset: { phase: p.phase, done: String(p.done), total: String(p.total) },
      }, h('i', { style: { width: `${pct}%` } })),
      h('small', { text: starting ? 'This one is on your device now.' : 'Only this first time. It stays on this device afterwards.' })));
  }

  function showError(g, message) {
    clear(cover);
    cover.hidden = false;
    cover.append(h('div.arc-clp__load.is-error', { role: 'alert' },
      icon('alert'),
      h('b', { text: `${g.title} could not start` }),
      h('small', { text: message }),
      h('button.arc-clc__play', { type: 'button', onclick: () => open(g.id, P.own ? { own: true } : {}) }, icon('rotate-ccw'), h('span', { text: 'Try again' }))));
  }

  /* one line while playing: the screen is the game's. The long notices are on the card and the game's page. */
  function paintFoot(g, saveProblem) {
    clear(foot);
    foot.append(...[
      h('p.arc-clp__how', { text: g.how }),
      saveProblem ? h('p.arc-clp__warn', { role: 'status' }, icon('alert'), h('span', { text: saveProblem })) : null,
      h('span.arc-clp__links', licenceLinks(g), link('About', g.links.about, 'info')),
    ].filter(Boolean));
  }

  /* A game with a minimum size keeps it: below that, its frame is laid out at that size
     and scaled to the stage. The browser still routes clicks to the right place. */
  function fitFrame() {
    const f = host.firstElementChild;
    if (!f) return;
    const box = stage.getBoundingClientRect();
    const { minWidth = 0, minHeight = 0 } = P.game?.run || {};
    const scale = box.width > 0 && box.height > 0 ? Math.min(1, box.width / (minWidth || box.width), box.height / (minHeight || box.height)) : 1;
    f.style.transformOrigin = '0 0';
    f.style.transform = scale < 1 ? `scale(${scale})` : '';
    f.style.width = scale < 1 ? `${box.width / scale}px` : '';
    f.style.height = scale < 1 ? `${box.height / scale}px` : '';
  }
  const fitObserver = new ResizeObserver(fitFrame);
  fitObserver.observe(stage);
  const frameObserver = new MutationObserver(fitFrame);
  frameObserver.observe(host, { childList: true });

  /* ---- your own copy: the picker ---- */
  async function readPicked(g, list, strip) {
    const files = [];
    let bytes = 0;
    for (const f of list) {
      const path = ownPath(strip ? (f.webkitRelativePath || f.name) : f.name, strip);
      if (!path) continue;
      bytes += f.size;
      if (files.length >= MAX_OWN_FILES) throw new Error(`That is more than ${MAX_OWN_FILES} files. Pick only the game’s own folder.`);
      if (bytes > MAX_OWN) throw new Error(`That is more than ${mb(MAX_OWN)}, more than a browser tab can hold. Pick only the game’s own folder.`);
      /* one name, one file: a file picked twice keeps the last */
      const i = files.findIndex(x => x.path === path);
      const entry = { path: g.own.pick === 'file' ? path.toLowerCase() : path, data: await f.arrayBuffer() };
      if (i >= 0) files[i] = entry; else files.push(entry);
    }
    return files;
  }
  const pickedLabel = (list, strip) => {
    const first = list[0];
    if (!first) return '';
    if (strip && first.webkitRelativePath) return first.webkitRelativePath.split('/')[0] || first.name;
    return list.length === 1 ? first.name : `${list.length} files`;
  };

  function showPicker(g, { problem = '' } = {}) {
    stopGame();
    clear(cover);
    cover.hidden = false;
    const o = g.own;
    const folder = o.pick === 'folder';
    const status = h('p.arc-clp__pickstatus', { role: 'status', 'aria-live': 'polite', text: problem });
    status.classList.toggle('is-problem', !!problem);
    const keep = ownKept() ? h('input.arc-clp__keep', { type: 'checkbox' }) : null;
    const start = h('button.arc-clc__play.arc-clp__start', { type: 'button', disabled: true, onclick: () => go() },
      icon('play', { fill: true }), h('span', { text: 'Start' }));
    let chosen = null;      /* { list: File[], strip, label } */

    async function choose(input, strip) {
      const list = [...(input.files || [])];
      input.value = '';
      if (!list.length) return;
      chosen = null;
      start.disabled = true;
      status.classList.remove('is-problem');
      let why = '';
      if (o.pick === 'file') {
        if (list.length !== 1) why = `Pick one file: ${o.what}.`;
        else {
          const head = new TextDecoder('latin1').decode(await list[0].slice(0, 4).arrayBuffer());
          why = o.check(list[0].name, head);
        }
      }
      const bytes = list.reduce((n, f) => n + f.size, 0);
      if (!why && bytes > MAX_OWN) why = `That is ${mb(bytes)}: more than a browser tab can hold (${mb(MAX_OWN)}).`;
      if (!why && list.length > MAX_OWN_FILES) why = `That is ${list.length} files: pick only the game’s own folder.`;
      if (why) { status.textContent = why; status.classList.add('is-problem'); return; }
      chosen = { list, strip, label: pickedLabel(list, strip) };
      status.textContent = `${chosen.label}: ${list.length === 1 ? '1 file' : `${list.length} files`}, ${mb(bytes)}. Ready.`;
      start.disabled = false;
      start.focus();
    }
    const fileInput = (attrs, strip) => {
      const input = h('input.arc-clp__file', { type: 'file', ...attrs, onchange: () => choose(input, strip).catch(err => { status.textContent = err?.message || String(err); status.classList.add('is-problem'); }) });
      return input;
    };
    const folderInput = folder ? fileInput({ multiple: true, webkitdirectory: true, dataset: { pick: 'folder' } }, true) : null;
    const filesInput = fileInput({ multiple: folder, accept: o.accept || null, dataset: { pick: 'files' } }, false);

    async function go() {
      if (!chosen) return;
      start.disabled = true;
      status.textContent = 'Reading your files…';
      try {
        const files = await readPicked(g, chosen.list, chosen.strip);
        if (!files.length) throw new Error('Those files have no names a game can use.');
        const names = files.map(f => f.path);
        if (keep?.checked) {
          status.textContent = 'Keeping a copy on this device…';
          await keepFiles(g, chosen.label, files, names);
        }
        P.picked = chosen;
        run(g, { own: { files, names, label: chosen.label } });
      } catch (err) {
        status.textContent = err?.message || String(err);
        status.classList.add('is-problem');
        start.disabled = false;
      }
    }

    const keptSlot = h('div.arc-clp__kept', { hidden: true });
    keptInfo(g).then(k => {
      if (!k || !alive || P.game !== g) return;
      keptSlot.hidden = false;
      keptSlot.append(
        h('span', { text: `Kept on this device: ${k.label}, ${k.count === 1 ? '1 file' : `${k.count} files`}, ${mb(k.bytes)}.` }),
        h('button.arc-clc__play.arc-clp__playkept', {
          type: 'button', onclick: async () => {
            status.textContent = 'Reading your kept files…';
            try { run(g, { own: { files: await keptFiles(g), names: k.names, label: k.label } }); } catch (err) { status.textContent = err?.message || String(err); status.classList.add('is-problem'); }
          },
        }, icon('play', { fill: true }), h('span', { text: `Play ${k.label}` })));
    }).catch(() => {});

    cover.append(h('div.arc-clp__load.arc-clp__pick', { dataset: { own: g.id } },
      icon('folder-open'),
      h('b.arc-clp__loadtext', { text: `Play ${o.what}` }),
      h('small', { text: folder
        ? 'Pick the folder your copy of the game is in, as it came on its disk or from the shop. ScummVM finds the game in it.'
        : 'Pick it from your own copy of the game.' }),
      h('small', { text: STAYS }),
      keptSlot,
      h('div.arc-clp__pickacts',
        folder ? h('label.arc-clc__play.arc-clp__pickbtn', icon('folder-open'), h('span', { text: 'Choose a folder' }), folderInput) : null,
        h('label.arc-clc__own.arc-clp__pickbtn', icon('file'), h('span', { text: folder ? 'Or choose its files' : 'Choose the file' }), filesInput)),
      status,
      keep ? h('label.arc-clp__keeprow', keep, h('span', { text: 'Keep these files on this device, so you can play without picking them again. Only you can see them.' }))
        : h('small', { text: 'You’re a guest: the files are forgotten when this game closes.' }),
      h('div.arc-clp__pickacts', start,
        o.only ? null : h('button.arc-clc__own', { type: 'button', onclick: () => open(g.id) }, icon('play'), h('span', { text: `Play ${g.title} instead` })))));
  }

  /* ScummVM found nothing it knows in those files */
  function showNoGame(g) {
    stopGame();
    clear(cover);
    cover.hidden = false;
    cover.append(h('div.arc-clp__load.is-error', { role: 'alert', dataset: { nogame: '' } },
      icon('alert'),
      h('b', { text: 'ScummVM did not find a game it knows in those files' }),
      h('small', { text: 'Pick the folder the game itself is in: for a CD game, the one with its data files, such as MONKEY.000 or RESOURCE.MAP. This copy of ScummVM knows the adventure games listed on its About page.' }),
      h('div.arc-clp__pickacts',
        h('button.arc-clc__play', { type: 'button', onclick: () => showPicker(g) }, icon('folder-open'), h('span', { text: 'Pick other files' })),
        h('a.arc-clc__own', { href: g.links.about, target: '_blank', rel: 'noopener noreferrer' }, icon('info'), h('span', { text: 'Which games it knows' })))));
  }

  function run(g, { own = null } = {}) {
    stopGame();
    P.own = own;
    paintFoot(g, savesKept() ? null : GUEST_SAVES);
    showProgress(g, { done: 0, total: downloadBytes(g, !!own), phase: 'download' });
    P.inst = startClassic(g.id, host, {
      muted: !soundOn(),
      own,
      scale: scaleOf(g.id),
      onProgress: p => showProgress(g, p),
      onRunning: () => {
        clear(cover);
        cover.hidden = true;
        plays.record({ kind: 'arcade', id: CLASSIC_PREFIX + g.id, title: g.title });
        P.inst?.focus();
      },
      onError: m => showError(g, m),
      onNoGame: () => showNoGame(g),
      onSaveProblem: m => paintFoot(g, m),
    });
  }

  function open(id, opts = {}) {
    const g = classicById(id);
    if (!g) return false;
    stop();
    P.game = g;
    titleEl.textContent = g.title;
    makerEl.textContent = g.maker;
    view.style.setProperty('--h', g.hue);
    paintSound();
    paintScale();
    if (fsBtnPaint && fsBtn) fsBtnPaint(fsBtn, view);
    paintFoot(g, savesKept() ? null : GUEST_SAVES);
    if (g.own && (g.own.only || opts.own)) showPicker(g);
    else run(g);
    return true;
  }

  function stopGame() {
    if (P.inst) { P.inst.stop(); P.inst = null; }
    clear(host);
  }
  function stop() {
    stopGame();
    P.game = null;
    P.own = null;
    P.picked = null;
  }

  return {
    shelf,
    view,
    open,
    stop,
    current: () => P.game,
    focus: () => P.inst?.focus(),
    paintFs: () => { if (fsBtnPaint && fsBtn) fsBtnPaint(fsBtn, view); },
    setMuted: on => { paintSound(); P.inst?.setMuted(on); },
    destroy() { alive = false; stop(); fitObserver.disconnect(); frameObserver.disconnect(); },
  };
}
