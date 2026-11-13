/* ============================================================
   classics/ui.js — the Free Classics shelf and player, inside Static
   Arcade (js/apps/arcade.js owns the window; this owns these two views).

   The card always says who made the game, under what licence, and where
   its licence and source are. So does the player, for as long as the game
   is on screen. Nothing here is rated or counted: a card only shows what
   is true of this device (saved games, already downloaded).
   ============================================================ */
import { CLASSICS, classicById, CLASSIC_PREFIX } from './catalog.js';
import { startClassic, deviceState, removeFromDevice, downloadBytes, savesKept } from './runner.js';
import { people } from '../core/profiles.js';

export const mb = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const external = { target: '_blank', rel: 'noopener noreferrer' };
const GUEST_SAVES = 'You’re a guest: saved games last until you reload this tab or end the session.';
/* what Remove takes away, as it is for this person */
const removeText = () => (!savesKept()
  ? 'This deletes the saved games you made in this guest session. The downloaded files stay: they are shared with everyone on this computer.'
  : people().length > 1
    ? 'This deletes your saved games, which cannot come back, and the downloaded files, which everyone on this computer shares and which download again when someone presses Play. Other people’s saved games stay.'
    : 'This deletes its saved games and its downloaded files here. You can download it again by pressing Play, but saved games cannot come back.');

export function classicsUI({ api, h, icon, clear, plays, soundOn, onOpen, onBack, onToggleSound, onToggleFs, soundBtnPaint, fsBtnPaint }) {
  let alive = true;

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
    const state = h('span.arc-clc__state', { dataset: { state: '' } });
    const remove = h('button.arc-clc__remove', {
      type: 'button', hidden: true,
      onclick: async () => {
        const ok = await api.confirm({
          title: `Remove ${g.title} from this device?`,
          message: removeText(),
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

    const size = mb(downloadBytes(g));
    const sizeEl = h('span.arc-meta', { title: 'Downloaded the first time you play, then kept on this device' },
      icon('download'), h('span', { text: `${size} on first play` }));

    function paintState() {
      deviceState(g).then(s => {
        if (!alive) return;
        const bits = [];
        if (s.saves) bits.push(s.saves === 1 ? '1 saved file' : `${s.saves} saved files`);
        if (s.downloaded) bits.push('downloaded');
        state.textContent = bits.length ? `On this device: ${bits.join(', ')}` : '';
        state.dataset.state = s.saves ? 'saved' : s.downloaded ? 'downloaded' : '';
        remove.hidden = !(s.saves || (s.downloaded && savesKept()));
        sizeEl.hidden = s.downloaded;
      }).catch(() => {});
    }
    paintState();

    return h('article.arc-clc', { style: { '--h': g.hue }, dataset: { classic: g.id } },
      h('div.arc-clc__art', { 'aria-hidden': 'true' }, icon(g.icon), h('b', { text: String(g.year) })),
      h('div.arc-clc__body',
        h('h3.arc-clc__title', { text: g.title }),
        h('div.arc-clc__maker', { text: `${g.maker}, ${g.year}` }),
        h('p.arc-clc__blurb', { text: g.blurb }),
        h('div.arc-clc__meta',
          h('span.arc-meta', icon('gamepad'), h('span', { text: g.genre })),
          h('span.arc-meta', { text: g.input }),
          sizeEl),
        h('div.arc-clc__acts',
          h('button.arc-clc__play', {
            type: 'button', 'aria-label': `Play ${g.title}`, onclick: () => onOpen(g.id),
          }, icon('play', { fill: true }), h('span', { text: 'Play' })),
          state, remove),
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
        h('p.arc-cls__sub', { text: `Old games their makers or rights-holders released for free. StaticOS did not make them and does not own them. Each downloads once, when you first play, and ${savesKept() ? 'your saves stay on this device.' : 'stays on this device for everyone here.'}` }),
        savesKept() ? null : h('p.arc-cls__sub', { dataset: { guest: '' }, text: GUEST_SAVES })),
      h('div.arc-cls__grid', CLASSICS.map(card)));
  }

  /* ---------------------------- the player --------------------------- */
  const P = { inst: null, game: null };
  const titleEl = h('span.arc-hud__name');
  const dot = h('span.arc-hud__dot');
  const makerEl = h('span.arc-clp__maker');
  const soundBtn = h('button.arc-ib', { type: 'button', onclick: () => { onToggleSound(); paintSound(); P.inst?.setMuted(!soundOn()); P.inst?.focus(); } });
  const fsBtn = onToggleFs ? h('button.arc-ib', { type: 'button', onclick: () => onToggleFs(view) }) : null;
  const back = h('button.arc-ib.arc-ib--back', { type: 'button', 'aria-label': 'Back to the Arcade', title: 'Back to the Arcade', onclick: onBack },
    icon('chevron-left'), h('span', { text: 'Arcade' }));
  const hud = h('div.arc-hud',
    h('div.arc-hud__left', back, h('div.arc-hud__title', dot, titleEl), makerEl),
    h('div.arc-hud__tools', soundBtn, fsBtn));
  const host = h('div.arc-clp__host');
  const cover = h('div.arc-clp__cover');
  const stage = h('div.arc-clp__stage', host, cover);
  const foot = h('div.arc-clp__foot');
  const view = h('section.arc-clp', hud, stage, foot);

  function paintSound() { soundBtnPaint(soundBtn); }

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
      h('button.arc-clc__play', { type: 'button', onclick: () => open(g.id) }, icon('rotate-ccw'), h('span', { text: 'Try again' }))));
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

  function open(id) {
    const g = classicById(id);
    if (!g) return false;
    stop();
    P.game = g;
    titleEl.textContent = g.title;
    makerEl.textContent = g.maker;
    view.style.setProperty('--h', g.hue);
    paintSound();
    if (fsBtnPaint && fsBtn) fsBtnPaint(fsBtn, view);
    paintFoot(g, savesKept() ? null : GUEST_SAVES);
    showProgress(g, { done: 0, total: downloadBytes(g), phase: 'download' });
    P.inst = startClassic(id, host, {
      muted: !soundOn(),
      onProgress: p => showProgress(g, p),
      onRunning: () => {
        clear(cover);
        cover.hidden = true;
        plays.record({ kind: 'arcade', id: CLASSIC_PREFIX + g.id, title: g.title });
        P.inst?.focus();
      },
      onError: m => showError(g, m),
      onSaveProblem: m => paintFoot(g, m),
    });
    return true;
  }

  function stop() {
    if (P.inst) { P.inst.stop(); P.inst = null; }
    clear(host);
    P.game = null;
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
