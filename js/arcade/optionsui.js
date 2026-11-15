/* ============================================================
   arcade/optionsui.js — the Arcade's Options card (the sliders
   button in the HUD). Two parts:

   · Every game: colour-blind colours, larger text, fewer flashes,
     bigger HUD text and one game volume. Each says which games use
     it (from the flags in js/arcade/index.js) — never a promise for a
     game that ignores it.
   · This game: its own settings (js/arcade/modes.js: grid lines, a
     theme, mouse sensitivity…), game speed, one-button mode, on-screen
     buttons, the controller cursor and remapped keys — shown only when
     this game can use them.

   Everything is saved at once (js/arcade/options.js). Speed, one-
   button mode and fewer flashes are read when a round starts, so the
   card says so and offers "Restart with these".

   optionsCard({ h, icon, game, ARCADE, onRestart, onClose, onChange })
     -> { el, destroy() }
   ============================================================ */
import * as OPT from './options.js';
import { settingsOf, fmtSetting } from './modes.js';
import { codeLabel } from '../core/padmap.js';
import { t as tr } from '../core/i18n.js';

const listOf = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')}${tr(' and ')}${names[names.length - 1]}`);
const pct = v => `${Math.round(v * 100)}%`;

export function optionsCard({ h, icon, game: g, ARCADE, onRestart, onClose, onChange }) {
  const offs = [];
  const changed = what => { try { onChange?.(what); } catch (e) { console.error(e); } };
  const names = flag => listOf(ARCADE.filter(x => x[flag]).map(x => x.title));

  /* a labelled on/off switch */
  const toggle = ({ id, label, note, get, set, here = true }) => {
    const sw = h('button.arc-opt__sw', { type: 'button', role: 'switch', dataset: { opt: id }, 'aria-describedby': note ? `arc-opt-${id}-n` : null });
    const paint = () => { const on = !!get(); sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('is-on', on); };
    sw.addEventListener('click', () => { set(!get()); paint(); changed(id); });
    paint();
    return h('div.arc-opt', { class: here ? '' : 'is-elsewhere' },
      h('div.arc-opt__txt', h('label.arc-opt__lab', { text: label, onclick: () => sw.click() }),
        note ? h('div.arc-opt__note', { id: `arc-opt-${id}-n`, text: note }) : null),
      sw);
  };
  const slider = ({ id, label, note, min, max, step, get, set, fmt }) => {
    const out = h('output.arc-opt__val', { text: fmt(get()) });
    const input = h('input.arc-opt__range', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), dataset: { opt: id }, 'aria-label': label, 'aria-describedby': note ? `arc-opt-${id}-n` : null });
    input.addEventListener('input', () => { const v = Number(input.value); set(v); out.textContent = fmt(v); input.setAttribute('aria-valuetext', fmt(v)); changed(id); });
    input.setAttribute('aria-valuetext', fmt(get()));
    return h('div.arc-opt.arc-opt--range',
      h('div.arc-opt__txt', h('div.arc-opt__lab', { text: label }), note ? h('div.arc-opt__note', { id: `arc-opt-${id}-n`, text: note }) : null),
      h('div.arc-opt__rangebox', input, out));
  };

  const P = OPT.prefs, GP = () => OPT.gamePrefs(g.id);
  const all = [
    toggle({ id: 'palette', label: tr('Colour-blind colours'), note: tr('Colours that stay apart with any common colour-vision difference, with a shape or mark on each. In {games}.', { games: names('palette') }),
      get: () => P().palette === 'cb', set: v => OPT.setPref('palette', v ? 'cb' : 'standard'), here: !!g.palette }),
    toggle({ id: 'bigText', label: tr('Larger text'), note: tr('Bigger letters and words in {games}.', { games: names('bigText') }),
      get: () => P().bigText, set: v => OPT.setPref('bigText', v), here: !!g.bigText }),
    toggle({ id: 'calm', label: tr('Fewer flashes'), note: tr('Games leave out flashes, screen shakes and bursts, the same as Reduce motion. Starts with the next round.'),
      get: () => P().calm, set: v => OPT.setPref('calm', v) }),
    toggle({ id: 'hudBig', label: tr('Bigger HUD text'), note: tr('Larger score, best and buttons above the game.'),
      get: () => P().hudBig, set: v => OPT.setPref('hudBig', v) }),
    slider({ id: 'volume', label: tr('Game volume'), note: tr('One level for every game’s sound, on top of the system volume.'), min: 0, max: 100, step: 5,
      get: () => P().volume, set: v => OPT.setPref('volume', v), fmt: v => `${Math.round(v)}%` }),
  ];

  const mine = [];
  /* the game's own settings: how it looks or feels, never how hard it is (./modes.js) */
  const SET = () => settingsOf(g, GP().set);
  for (const st of Array.isArray(g.settings) ? g.settings : []) {
    const id = `set-${st.id}`;
    if (st.type === 'switch') mine.push(toggle({ id, label: st.label, note: st.note, get: () => SET()[st.id], set: v => OPT.setSetting(g.id, st.id, v) }));
    else if (st.type === 'range') mine.push(slider({ id, label: st.label, note: st.note, min: st.min, max: st.max, step: st.step, get: () => SET()[st.id], set: v => OPT.setSetting(g.id, st.id, v), fmt: v => fmtSetting(st, v) }));
    else if (st.type === 'choice') {
      const sel = h('select.arc-opt__sel', { dataset: { opt: id }, 'aria-label': st.label, 'aria-describedby': st.note ? `arc-opt-${id}-n` : null,
        onchange: () => { OPT.setSetting(g.id, st.id, sel.value); changed(id); } },
      st.options.map(o => h('option', { value: o.id, text: o.label })));
      sel.value = SET()[st.id];
      mine.push(h('div.arc-opt', h('div.arc-opt__txt', h('div.arc-opt__lab', { text: st.label }), st.note ? h('div.arc-opt__note', { id: `arc-opt-${id}-n`, text: st.note }) : null), sel));
    }
  }
  if (g.speed) {
    mine.push(slider({ id: 'speed', label: tr('Game speed'), note: tr('Slows the whole game down. Slowed rounds still count in your stats but never change your best. Starts with the next round.'),
      min: 0.5, max: 1, step: 0.05, get: () => GP().speed, set: v => OPT.setGamePref(g.id, 'speed', Math.round(v * 100) / 100), fmt: pct }));
  }
  if (g.oneButton) {
    const how = { flap: tr('Any key, a click or a tap flaps.'), runner: tr('Press to jump, hold for a high jump, keep holding after you land to duck.'), echo: tr('A ring moves round the pads; press Space, Enter or click to pick the lit one.') }[g.id] || tr('Space, a click or a tap is the only button.');
    mine.push(toggle({ id: 'oneButton', label: tr('One-button mode'), note: tr('{how} Starts with the next round.', { how }), get: () => GP().oneButton, set: v => OPT.setGamePref(g.id, 'oneButton', v) }));
  }
  if (g.touchKeys) {
    const auto = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    mine.push(toggle({ id: 'touch', label: tr('On-screen buttons'), note: auto ? tr('Big buttons over the game: {keys}. On by default on a touch screen.', { keys: listOf(g.touchKeys.map(k => k.label)) }) : tr('Big buttons over the game: {keys}.', { keys: listOf(g.touchKeys.map(k => k.label)) }),
      get: () => (GP().touch ?? auto), set: v => OPT.setGamePref(g.id, 'touch', v) }));
  }
  const pointer = g.input.includes('mouse') || g.input.includes('touch');
  if (pointer) {
    const auto = !g.input.includes('keyboard');
    mine.push(toggle({ id: 'cursor', label: tr('Controller cursor'), note: auto ? tr('With "Play keyboard games with a controller" on, the left stick moves a pointer, A clicks and B right-clicks. On by default here, because this game is played with the mouse.') : tr('With "Play keyboard games with a controller" on, the left stick moves a pointer, A clicks and B right-clicks. Instead of the controller pressing keys.'),
      get: () => (GP().cursor ?? auto), set: v => OPT.setGamePref(g.id, 'cursor', v) }));
  }

  /* ---- remapped keys ---- */
  let keysBox = null, listen = null;
  if (g.input.includes('keyboard')) {
    const list = h('ul.arc-keys__list');
    const status = h('div.arc-keys__status', { role: 'status', 'aria-live': 'polite' });
    const addBtn = h('button.btn.btn--sm', { type: 'button', dataset: { act: 'addkey' } }, icon('plus'), h('span', { text: tr('Use another key…') }));
    const paintKeys = () => {
      list.replaceChildren();
      const m = GP().keys;
      const ks = Object.keys(m);
      if (!ks.length) list.append(h('li.arc-keys__none', { text: tr('No keys changed: the game’s own keys work as usual.') }));
      for (const from of ks) {
        list.append(h('li.arc-keys__row', { dataset: { from, to: m[from] } },
          h('kbd', { text: codeLabel(from) }), h('span.arc-keys__arrow', { text: tr('acts as') }), h('kbd', { text: codeLabel(m[from]) }),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', 'aria-label': tr('Stop using {from} as {to}', { from: codeLabel(from), to: codeLabel(m[from]) }), onclick: () => { OPT.setKey(g.id, from, null); paintKeys(); changed('keys'); } }, icon('x'))));
      }
    };
    const stopListen = () => { if (listen) { window.removeEventListener('keydown', listen, true); listen = null; } addBtn.disabled = false; };
    addBtn.addEventListener('click', () => {
      stopListen();
      let from = null;
      addBtn.disabled = true;
      status.textContent = tr('Press the key you want to use…');
      listen = e => {
        if (!e.isTrusted || e.repeat) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape' && !from) { status.textContent = 'Nothing changed.'; stopListen(); return; }
        if (!from) { from = e.code; status.textContent = tr('Now press the game’s key that {key} should act as…', { key: codeLabel(from) }); return; }
        if (e.code === from) { status.textContent = tr('{key} already is that key. Nothing changed.', { key: codeLabel(from) }); stopListen(); return; }
        OPT.setKey(g.id, from, e.code);
        status.textContent = tr('{from} now acts as {to} in {title}.', { from: codeLabel(from), to: codeLabel(e.code), title: g.title });
        stopListen();
        paintKeys();
        changed('keys');
        addBtn.focus({ preventScroll: true });
      };
      window.addEventListener('keydown', listen, true);
    });
    offs.push(stopListen);
    paintKeys();
    keysBox = h('div.arc-keys',
      h('div.arc-opt__lab', { text: tr('Keys') }),
      h('div.arc-opt__note', { text: tr('Use a different key for one of {title}’s keys. The game’s own key keeps working too.', { title: g.title }) }),
      list, h('div.arc-keys__row2', addBtn), status);
  }

  const restart = h('button.btn.btn--primary', { type: 'button', dataset: { act: 'restart' }, onclick: () => onRestart?.() }, icon('rotate-ccw'), h('span', { text: tr('Restart with these') }));
  const done = h('button.btn', { type: 'button', dataset: { act: 'done' }, onclick: () => onClose?.() }, icon('check'), h('span', { text: tr('Done') }));
  const el = h('div.arc-card.arc-opts', { role: 'dialog', 'aria-label': tr('Options for {title}', { title: g.title }), tabindex: '-1',
    onkeydown: e => { if (e.key === 'Escape' && !listen) { e.preventDefault(); e.stopPropagation(); onClose?.(); } } },
    h('div.arc-card__kicker', { text: g.title }),
    h('div.arc-card__title', { text: tr('Options') }),
    h('div.arc-opts__body',
      mine.length || keysBox ? h('section.arc-opts__sec', h('h3.arc-opts__h', { text: tr('This game') }), ...mine, keysBox) : null,
      h('section.arc-opts__sec', h('h3.arc-opts__h', { text: tr('Every game') }), ...all)),
    h('div.arc-card__row', restart, done),
    h('div.arc-card__hint', { text: tr('Saved as you go · Esc closes') }));
  return { el, destroy() { offs.forEach(f => { try { f(); } catch (e) { /* gone */ } }); } };
}

export default { optionsCard };
