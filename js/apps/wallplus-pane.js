/* ============================================================
   wallplus-pane.js — the Settings rows for rotation, Day and
   Night, the weather overlay (Settings › Wallpaper) and the
   auto accent (Settings › Themes).

   The engines live in core and shell (core/wprotate.js,
   core/daycycle.js, core/wpweather.js, core/wpaccent.js,
   shell/wallplus.js); this only draws their switches and says
   what they are doing, in words, refreshed every second by
   Settings' own live tick.

     wallpaperRows(kit) -> { nodes, live }
     autoCard(kit)      -> { node, live }
   kit = Settings' own helpers: { api, caption, group, row, srow,
   note, btn, sw, select, tabs, setPref, pref, repaint }.
   ============================================================ */
import { store } from '../core/store.js';
import * as WP from '../portal/wallpapers.js';
import * as THEMES from '../core/themes.js';
import * as SEASON from '../core/season.js';
import * as ROTATE from '../core/wprotate.js';
import * as DAY from '../core/daycycle.js';
import * as WXW from '../core/wpweather.js';
import * as ACCENT from '../core/wpaccent.js';

/* the shell module (shell/wallplus.js) normally links it already */
import { t as tr, plural } from '../core/i18n.js';
function ensureCss() {
  if (document.getElementById('feat-wallplus-css')) return;
  document.head.appendChild(Object.assign(document.createElement('link'), { id: 'feat-wallplus-css', rel: 'stylesheet', href: 'css/feat-wallplus.css' }));
}

const time = d => (d ? new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !store.get('prefs.h24') }) : '');
const reducedMotion = () => document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* a wallpaper's look, small: for the set chips */
function thumb(w) {
  if (w.kind === 'css') return { background: w.css };
  if (w.kind === 'scene') return { background: 'radial-gradient(80% 60% at 50% 70%, rgba(var(--accent-rgb)/.35), transparent 62%), linear-gradient(175deg,#1e1224,#08050b)' };
  const u = w.poster || w.url;
  return u ? { backgroundImage: `url("${String(u).replace(/"/g, '%22')}")` } : null;
}

export function wallpaperRows(kit) {
  ensureCss();
  const { api, caption, group, row, srow, note, btn, sw, select, tabs, setPref, repaint } = kit;
  const { h, icon } = api;
  const cfg = ROTATE.config();

  /* ---------------- rotation ---------------- */
  const rotSay = h('small.wpx-row-sub', { dataset: { fk: 'wpx-rot-status' }, role: 'status' });
  const rotSkip = h('div.wpx-skip', { dataset: { fk: 'wpx-rot-skipped' } });
  const nextBtn = btn('skip-forward', tr('Next picture'), () => { ROTATE.next(); });
  nextBtn.dataset.fk = 'wpx-rot-next';

  const turnOn = v => {
    setPref('wpRotate', v);
    repaint();
  };

  let source;
  if (cfg.from === 'set') {
    const chosen = new Set(cfg.set);
    source = h('div.set-row',
      h('div.set-row__ico', icon('image')),
      h('div.set-row__t', h('b', { text: tr('Wallpapers to rotate') }), h('small', { text: tr('Tick two or more. Pictures that don’t load are skipped.') }),
        h('div.wpx-set', { role: 'group', 'aria-label': tr('Wallpapers to rotate'), style: { marginTop: 'var(--sp-2)' } },
          WP.list(store).map(w => h('button.wpx-set__b', {
            type: 'button', 'aria-pressed': String(chosen.has(w.id)), dataset: { id: w.id },
            onclick: e => {
              if (chosen.has(w.id)) chosen.delete(w.id); else chosen.add(w.id);
              e.currentTarget.setAttribute('aria-pressed', String(chosen.has(w.id)));
              setPref('wpRotateSet', WP.list(store).map(x => x.id).filter(id => chosen.has(id)));
            },
          }, h('i', { style: thumb(w) }), h('span', { text: w.name }))))));
  } else if (cfg.from === 'favs') {
    const n = WP.favs(store).length;
    source = row('heart', tr('My favourites'), n >= 2
      ? tr('{n} wallpapers are hearted. Heart or un-heart them in the picker above.', { n })
      : n === 1 ? tr('One wallpaper is hearted. Heart at least two in the picker above.') : tr('None hearted yet. Heart the wallpapers you like in the picker above.'));
  } else {
    const folders = [...new Set([ROTATE.defaultFolder(), cfg.folder, ...ROTATE.pictureFolders()])];
    source = row('folder-open', tr('Folder'), tr('Every picture in it, and in the folders inside it.'),
      select(tr('Rotation folder'), folders.map(p => [p, ROTATE.folderLabel(p)]), cfg.folder, v => setPref('wpRotateFolder', v)));
  }

  function rotLive() {
    const s = ROTATE.status();
    const where = s.from === 'set' ? tr('the wallpapers you picked') : s.from === 'favs' ? 'your favourites' : ROTATE.folderLabel(s.folder);
    let say;
    if (!s.on) say = tr('Off — your wallpaper stays as you chose it.');
    else if (!s.count) say = s.from === 'set' ? tr('Pick some wallpapers below to rotate through.') : s.from === 'favs' ? tr('Heart some wallpapers in the picker to rotate through your favourites.') : tr('There are no pictures in {where}. Add some in Files (or take one with Camera), or pick another folder.', { where });
    else if (s.none) say = tr('Nothing in {where} opens as a picture, so your own wallpaper stays up.', { where });
    else if (s.busy && !s.cur) say = tr('Opening the first picture…');
    else if (SEASON.spooky('wallpaper') && document.documentElement.dataset.spooky === 'on') say = tr('The haunted house is up for spooky season — rotation waits until it steps aside (Settings › Spooky Season).');
    else {
      const n = plural(s.count, '{n} picture in {where}', '{n} pictures in {where}', { where });
      const when = s.every === 'login' ? tr('the next one when StaticOS next starts') : s.due ? tr('the next at {time}', { time: time(s.due) }) : '';
      say = `Now: ${s.name || '…'} — ${n}${when ? `, ${when}` : ''}.`;
    }
    rotSay.textContent = say;
    nextBtn.disabled = !s.on || s.count < 2 || s.busy;
    const sk = s.skipped;
    const sig = sk.map(x => `${x.ref}:${x.why}`).join('|');
    if (rotSkip.dataset.sig !== sig) {
      rotSkip.dataset.sig = sig;
      rotSkip.replaceChildren(...(sk.length ? [
        h('small', { text: plural(sk.length, 'Skipped {n} file that wouldn’t open:', 'Skipped {n} files that wouldn’t open:') }),
        ...sk.slice(0, 5).map(x => h('small', { dataset: { ref: x.ref }, text: `${x.name} — ${x.why}.` })),
        sk.length > 5 ? h('small', { text: tr('and {n} more.', { n: sk.length - 5 }) }) : null,
      ].filter(Boolean) : []));
    }
  }

  const rotation = [
    caption(tr('Rotation')),
    group(
      srow('wpRotate', sw(SETLABEL.rotate, () => ROTATE.config().on, turnOn)),
      cfg.on ? [
        row('layers', tr('Pictures from'), null, tabs(tr('Pictures from'), [['folder', 'A folder'], ['set', tr('Wallpapers I pick')], ['favs', tr('My favourites')]], cfg.from, v => { setPref('wpRotateFrom', v); repaint(); })),
        source,
        row('clock', tr('How often'), cfg.every === 'mins' ? tr('Anywhere from 1 minute to 24 hours (1440 minutes).') : null,
          select(tr('How often'), Object.entries(ROTATE.EVERY_LABEL), cfg.every, v => { setPref('wpRotateEvery', v); repaint(); }),
          cfg.every === 'mins' ? h('div.field', { style: { width: '84px' } }, h('input', {
            type: 'number', min: String(ROTATE.MINS.min), max: String(ROTATE.MINS.max), value: String(cfg.mins), 'aria-label': tr('Minutes between wallpapers'), dataset: { fk: 'wpx-rot-mins' },
            onchange: e => { const n = Math.round(Number(e.target.value)); setPref('wpRotateMins', Math.max(ROTATE.MINS.min, Math.min(ROTATE.MINS.max, Number.isFinite(n) ? n : ROTATE.MINS.def))); setTimeout(repaint, 0); },
          })) : null),
        row('shuffle', tr('Order'), tr('Shuffle shows every picture once before any comes round again.'), tabs(tr('Order'), [['shuffle', tr('Shuffle')], ['order', tr('In order')]], cfg.order, v => setPref('wpRotateOrder', v))),
      ] : null,
      h('div.set-row',
        h('div.set-row__ico', icon('image')),
        h('div.set-row__t', h('b', { text: tr('Right now') }), rotSay, rotSkip),
        h('div.set-row__c', cfg.on ? nextBtn : null)),
    ),
  ];

  /* ---------------- Day and Night ---------------- */
  const dayOn = WP.active(store).id === 'daycycle';
  const sunSay = h('small.wpx-row-sub', { dataset: { fk: 'wpx-sun' } });
  function sunLive() {
    const st = DAY.state();
    const src = st.source;
    const times = tr('sunrise {rise}, sunset {set}', { rise: DAY.clock(st.rise), set: DAY.clock(st.set) });
    const now = tr('Now: {phase}. ', { phase: DAY.NAMES[st.phase] });
    sunSay.textContent = src.kind === 'place'
      ? tr('{now}Real {times} for {place} (from Weather), worked out on this computer.', { now, times, place: src.place })
      : src.why
        ? tr('{now}{why}, so fixed times are used: {times}.', { now, why: src.why, times })
        : tr('{now}Fixed times: {times}. Give Weather a place (a city, or your location) to follow the real sun there.', { now, times });
  }
  const daycycle = [
    caption(tr('Day and Night')),
    group(
      srow('wp.daycycle', dayOn
        ? h('span.chip.chip--accent', { text: tr('In use') })
        : btn('image', tr('Use it'), () => { WP.setActive(store, 'daycycle'); api.bus.emit('wallpaper:changed'); repaint(); })),
      h('div.set-row',
        h('div.set-row__ico', icon('sun')),
        h('div.set-row__t', h('b', { text: tr('Sunrise and sunset') }), sunSay),
        h('div.set-row__c', btn('cloud-sun', tr('Weather'), () => api.openApp('weather'), '.btn--ghost'))),
    ),
  ];

  /* ---------------- weather ---------------- */
  const wxSay = h('small.wpx-row-sub', { dataset: { fk: 'wpx-wx-status' }, role: 'status' });
  function wxLive() {
    const s = WXW.status();
    let say;
    if (!s.on) say = 'Off.';
    else if (!s.place) say = tr('Weather doesn’t have a place yet. Search for a city in Weather, or let it use your location — then the wallpaper can match it.');
    else if (s.reading) {
      say = tr('{label} in {place}, checked at {time}. ', { label: s.label, place: s.place.name, time: time(s.reading.at) })
        + (s.effect === 'none' ? tr('Nothing to draw for that.') : tr('Drawn as {effect}.', { effect: WXW.EFFECT_NAME[s.effect].toLowerCase() }));
      if (s.err) say += tr(' The last check failed ({reason}).', { reason: s.err.short.replace(/\.$/, '') });
      if (document.documentElement.dataset.gamemode === 'on') say += tr(' Paused for Game Mode.');
      else if (reducedMotion()) say += tr(' Drawn still, because Reduce motion is on.');
    } else if (s.err) say = tr('Weather unavailable — {reason} Nothing is drawn until Open-Meteo answers; it tries again after {time}.', { reason: s.err.short, time: time(s.next) });
    else if (s.unavailable) say = tr('Weather unavailable — the last reading for {name} is over an hour old.', { name: s.place.name });
    else say = tr('Asking Open-Meteo about {name}…', { name: s.place.name });
    wxSay.textContent = say;
    wxSay.dataset.state = !s.on ? 'off' : !s.place ? 'noplace' : s.reading ? s.effect : s.err || s.unavailable ? 'unavailable' : 'asking';
  }
  const weather = [
    caption(tr('Weather')),
    group(
      srow('wpWeather', sw(SETLABEL.weather, () => store.get('prefs.wpWeather') === true, v => { setPref('wpWeather', v); repaint(); })),
      h('div.set-row',
        h('div.set-row__ico', icon('cloud-sun')),
        h('div.set-row__t', h('b', { text: tr('Where you are') }), wxSay),
        h('div.set-row__c', btn('cloud-sun', tr('Weather'), () => api.openApp('weather'), '.btn--ghost'))),
    ),
    note(tr('Uses only the place Weather already has — a city you searched for, or your location if you allowed it there. It asks Open-Meteo at most every 30 minutes, and never shows weather it didn’t get. It pauses in Game Mode and in a hidden tab, and stays still with Reduce motion.'), 'cloud-rain'),
  ];

  const live = () => { rotLive(); sunLive(); wxLive(); };
  live();
  return { nodes: [...rotation, ...daycycle, ...weather], live };
}

export const SETLABEL = { rotate: tr('Change the wallpaper by itself'), weather: tr('Weather on the wallpaper') };

/* ---------------- Themes › Auto ---------------- */
export function autoCard(kit) {
  ensureCss();
  const { api, setPref, repaint } = kit;
  const { h, icon } = api;
  const on = ACCENT.isAuto();
  const swatch = h('i.st-auto__sw');
  const say = h('small', { dataset: { fk: 'accent-auto-status' } });
  function live() {
    const t = THEMES.autoTheme();
    swatch.style.background = `linear-gradient(140deg, ${t.soft} 0%, ${t.accent} 62%)`;
    const from = store.get(ACCENT.FROM, null);
    if (!on) say.textContent = tr('Picks the accent out of your wallpaper and follows it — rotation and Day and Night included. Made lighter or deeper if it needs to be, so text on it stays easy to read.');
    else if (from?.hex) say.textContent = tr('From {name}: {accent}', { name: from.name, accent: t.accent }) + (t.accent !== from.hex ? tr(' (found {hex}, adjusted so text on it reads)', { hex: from.hex }) : '') + '.';
    else if (from?.why) say.textContent = tr('{why} Keeping {accent} until the wallpaper changes.', { why: from.why, accent: t.accent });
    else say.textContent = tr('Looking at your wallpaper…');
  }
  live();
  const node = h('div.st-auto' + (on ? '.is-on' : ''), { dataset: { fk: 'accent-auto' } },
    swatch,
    h('div.st-auto__b', h('b', { text: 'Auto (from wallpaper)' }), say),
    on
      ? h('span.chip.chip--accent', icon('check'), h('span', { text: tr('In use') }))
      : h('button.btn.btn--sm.btn--primary', {
        type: 'button', dataset: { fk: 'accent-auto-use' },
        onclick: () => { setPref('accent', THEMES.AUTO); THEMES.apply(THEMES.AUTO); repaint(); },
      }, icon('palette'), h('span', { text: tr('Use Auto') })));
  return { node, live };
}

export default { wallpaperRows, autoCard, SETLABEL };
