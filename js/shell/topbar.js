/* ============================================================
   topbar.js — the global menu bar
   brand + Static menu · active-app menu strip · centre clock
   · status tray (game mode, sound, network, battery, control
   centre, notifications)
   The tray shows only what a web page can really know: the tab's
   online state and the connection the browser reports, the battery
   when the browser shares it (the indicator is simply absent when it
   doesn't), and switches that change real StaticOS settings. It used
   to list invented Wi-Fi networks, a Bluetooth toggle, AirDrop, a
   screen-mirroring search and a fixed 100% battery — none of which a
   page can see or control.
   Popovers that need live controls (sliders, tiles) are built
   here as plain .menu elements; plain item lists go through
   api.menu so the shell's one menu layer owns them.
   ============================================================ */
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import * as LG from '../core/lowgfx.js';
import { LOW_GFX } from '../core/lowgfx.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import { roving } from '../core/roving.js';
import * as DESK from '../core/desktops.js';
import * as FOCUS from '../core/focus.js';
import * as DNDSCHED from '../core/dndsched.js';
import { untilLabel, leftLabel } from '../core/dndrules.js';
import * as HELD from '../core/dndheld.js';
import * as REOPEN from '../core/reopen.js';
import * as WL from '../core/winlayouts.js';
import * as KM from '../core/keymap.js';
import * as AQ from '../core/a11yquick.js';
import * as PROFILES from '../core/profiles.js';
import { t, plural } from '../core/i18n.js';

export function mountTopbar(host) {
  const { h, icon, fmt } = api;
  const K = fmt.modLabel;
  /* a StaticOS shortcut as this person has it (Settings › Shortcuts) */
  const kh = id => KM.hint(id) || undefined;

  /* ---------------- state ---------------- */
  const S = { pop: null, dragging: false, online: navigator.onLine !== false, batt: null, friends: { on: false, online: 0 } };
  const conn = () => navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const netLabel = () => {
    if (!S.online) return t('Offline');
    const c = conn();
    return c && c.effectiveType ? t('Online · {type}', { type: c.effectiveType }) : t('Online');
  };
  const GAME_MSG = t('Blur, shadows, animations, the wallpaper video and widget updates are off, so games get the frames.');

  const pref = k => store.get('prefs.' + k);
  const setPref = (k, v) => store.set('prefs.' + k, v);

  /* ---------------- chrome --------------- */
  const brandBtn = h('button.topbar__brand', { 'aria-label': t('Static menu'), onclick: e => aetherMenu(e) },
    h('div.topbar__logo', icon('diamond')),
    h('span.topbar__name', { text: 'StaticOS' }));
  /* a real menu bar: one Tab stop, ←/→ between menus, ↓/Enter opens one,
     and ←/→ inside an open menu walks to the neighbouring menu */
  const menuStrip = h('div.topbar__menu', { role: 'menubar', 'aria-label': t('App menu') });
  const clockBtn = h('button.topbar__clock.tip.tip--below', {
    'data-tip': t('Notification Centre'), 'aria-label': t('Date and time'),
    onclick: () => { closePop(); bus.emit('noti:toggle'); },
  });
  const tray = h('div.topbar__tray', { role: 'toolbar', 'aria-label': t('Status') });
  const barEl = h('header.topbar', { 'aria-label': t('Top bar') }, brandBtn, menuStrip, clockBtn, tray);
  host.appendChild(barEl);
  const offRove = [
    roving(menuStrip, { items: 'button', orientation: 'horizontal' }),
    roving(tray, { items: 'button', orientation: 'horizontal' }),
  ];
  menuStrip.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    b.click();
  });

  /* ---------------- popovers ------------- */
  function closePop() {
    if (!S.pop) return;
    const p = S.pop;
    p.el.remove();
    S.pop = null;
    p.release?.();
    document.removeEventListener('pointerdown', outside, true);
  }

  function outside(e) {
    if (!S.pop) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && S.pop.el.contains(t)) return;
    const btn = t && t.closest('[data-pop]');
    if (btn && btn.dataset.pop === S.pop.kind) return; // its own click toggles
    closePop();
  }

  function openPop(kind, anchor, cls, build, align) {
    const same = S.pop && S.pop.kind === kind;
    closePop();
    if (same) return;
    const el = h('div.menu' + (cls || ''), { role: 'dialog', 'aria-label': anchor.getAttribute('aria-label') || kind });
    S.pop = { kind, el, build, anchor, align: align || 'left' };
    host.appendChild(el);
    S.pop.release = L.push({ name: 'popover:' + kind, el, close: closePop });
    paintPop();
    const a = anchor.getBoundingClientRect();
    /* offsetWidth, not getBoundingClientRect: .menu animates in from
       scale(.96), so a measured rect lands a right-aligned popover short. */
    const w = el.offsetWidth;
    api.placeInView(el, S.pop.align === 'right' ? a.right - w : a.left, a.bottom + 6);
    /* focus moves in, so a keyboard user lands on the controls they asked for */
    L.focusables(el)[0]?.focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  /* Popovers and the phone shade are rebuilt on every preference change.
     A rebuild replaces the focused control, which threw a keyboard user
     out after a single arrow press on the volume slider — so note what had
     focus (by its data-cc key or its accessible name) and put it back. */
  function keepFocus(el, build) {
    const a = document.activeElement;
    const inside = a && el.contains(a);
    const k = inside ? (a.closest('[data-cc]')?.dataset.cc || null) : null;
    const name = inside ? a.getAttribute('aria-label') || a.textContent.trim() : null;
    build(el);
    if (!inside || el.contains(document.activeElement)) return;
    const back = (k && el.querySelector(`[data-cc="${k}"]`))
      || [...el.querySelectorAll('button,input')].find(x => (x.getAttribute('aria-label') || x.textContent.trim()) === name);
    back?.focus({ preventScroll: true });
  }
  function paintPop() { if (S.pop) keepFocus(S.pop.el, S.pop.build); }

  /* ---------------- menu bits ------------ */
  const mItem = (ic, label, hint, onClick, tail) => h('button.menu__item', {
    onclick: () => { closePop(); onClick && onClick(); },
  }, icon(ic), h('span', { text: label }), hint ? h('small', { text: hint }) : null, tail || null);

  /** Light the button while its api.menu is up. */
  function flag(btn) {
    btn.classList.add('is-on');
    setTimeout(() => document.addEventListener('pointerdown',
      () => btn.classList.remove('is-on'), { capture: true, once: true }), 0);
  }

  function dropAt(btn, items) {
    closePop();
    flag(btn);
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    /* ←/→ on an open menu-bar menu opens the next one along (WAI-ARIA menubar) */
    const bar = btn.closest('[role="menubar"]');
    const onEdge = bar ? dir => {
      const all = [...bar.querySelectorAll('button')];
      const next = all[(all.indexOf(btn) + dir + all.length) % all.length];
      if (next) { next.focus(); next.click(); }
    } : null;
    api.menu(items.filter(Boolean), r.left, r.bottom + 6, { label: btn.textContent.trim() || btn.getAttribute('aria-label') || t('Menu'), onEdge });
    /* the menu takes focus; flip the state back when it closes */
    const off = () => { btn.setAttribute('aria-expanded', 'false'); };
    setTimeout(() => document.addEventListener('pointerdown', off, { capture: true, once: true }), 0);
    btn.addEventListener('focus', off, { once: true });
  }

  function aetherMenu(e) {
    dropAt(e.currentTarget, [
      { label: t('About This Static'), icon: 'info', onClick: () => api.openApp('about') },
      '-',
      { label: t('System Settings…'), icon: 'settings', onClick: () => api.openApp('settings') },
      { label: t('Static Store…'), icon: 'store', onClick: () => api.openApp('store') },
      '-',
      { label: t('Sleep'), icon: 'moon', onClick: () => bus.emit('power:sleep') },
      { label: t('Restart…'), icon: 'refresh', onClick: () => bus.emit('power:restart') },
      { label: t('Shut Down…'), icon: 'power', onClick: () => bus.emit('power:shutdown') },
      '-',
      { label: t('Lock Screen'), icon: 'lock', hint: kh('lock'), onClick: () => bus.emit('power:lock') },
      { label: t('Switch User…'), icon: 'users', onClick: () => bus.emit('users:open') },
    ]);
  }

  /* ---------------- app menu strip ------- */
  function fullScreen() {
    if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); return; }
    const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => api.notify({ title: t('Full screen unavailable'), message: t('The browser refused the request.'), icon: 'expand' }));
  }

  function paintMenu() {
    const w = wm.getActive();
    const name = w ? w.app.name : 'StaticOS';
    const has = !!w;
    const strip = [
      ['app',    name,     () => [
        { label: t('About {name}', { name }), icon: 'info', onClick: () => api.openApp('about') },
        '-',
        { label: t('Preferences…'), icon: 'settings', hint: `${K},`, onClick: () => api.openApp('settings') },
        '-',
        { label: t('Hide {name}', { name }), icon: 'eye', disabled: !has, onClick: () => wm.byApp(w.appId).forEach(x => wm.minimize(x)) },
        { label: t('Quit {name}', { name }), icon: 'power', hint: `${K}Q`, disabled: !has, danger: true, onClick: () => wm.closeApp(w.appId) },
      ]],
      ['File',   t('File'),   () => [
        { label: t('New Window'), icon: 'plus', hint: `${K}N`, disabled: !has, onClick: () => api.openApp(w.appId) },
        { label: t('Open…'), icon: 'folder-open', hint: `${K}O`, onClick: () => api.openApp('files') },
        '-',
        /* An app that can save or print says so by setting win.state.save / win.state.print;
           for any other the item is greyed out rather than pretending. */
        { label: t('Save'), icon: 'save', hint: `${K}S`, disabled: !(has && typeof w.state?.save === 'function'), onClick: () => w.state.save() },
        { label: t('Print…'), icon: 'printer', hint: `${K}P`, disabled: !(has && typeof w.state?.print === 'function'), onClick: () => w.state.print() },
        '-',
        { label: t('Close Window'), icon: 'close', hint: `${K}W`, disabled: !has, onClick: () => w.close() },
      ]],
      ['Edit',   t('Edit'),   () => [
        { label: t('Undo'), icon: 'rotate-ccw', hint: `${K}Z`, onClick: () => document.execCommand('undo') },
        { label: t('Redo'), icon: 'repeat', hint: `⇧${K}Z`, onClick: () => document.execCommand('redo') },
        '-',
        { label: t('Cut'), icon: 'x', hint: `${K}X`, onClick: () => document.execCommand('cut') },
        { label: t('Copy'), icon: 'copy', hint: `${K}C`, onClick: () => document.execCommand('copy') },
        { label: t('Paste'), icon: 'clipboard', hint: `${K}V`, onClick: () => document.execCommand('paste') },
        '-',
        { label: t('Select All'), icon: 'check-circle', hint: `${K}A`, onClick: () => document.execCommand('selectAll') },
      ]],
      ['View',   t('View'),   () => [
        { label: document.fullscreenElement ? t('Exit Full Screen') : t('Enter Full Screen'), icon: 'expand', hint: `⌃${K}F`, onClick: fullScreen },
        { label: pref('widgetsVisible') ? t('Hide Widgets') : t('Show Widgets'), icon: 'sidebar', onClick: () => setPref('widgetsVisible', !pref('widgetsVisible')) },
        { label: t('Show Overview'), icon: 'grid-9', hint: kh('overview'), onClick: () => api.overview() },
        '-',
        { label: t('Show Desktop Icons'), icon: pref('desktopIcons') ? 'check' : 'desktop', onClick: () => setPref('desktopIcons', !pref('desktopIcons')) },
      ]],
      ['Window', t('Window'), () => {
        const open = wm.list();
        const others = DESK.list().filter(d => !w || d.id !== w.desk);
        return [
          { label: t('Minimize'), icon: 'minimize-2', hint: kh('win.min'), disabled: !has, onClick: () => w.minimize() },
          { label: t('Zoom'), icon: 'maximize-2', disabled: !has, onClick: () => w.toggleMax() },
          { label: t('Close'), icon: 'close', hint: kh('win.close'), disabled: !has, onClick: () => w.close() },
          /* js/core/reopen.js — the newest closed window, back where it was */
          { label: t('Reopen Closed Window'), icon: 'window', hint: kh('reopen'), disabled: !REOPEN.count(), onClick: () => REOPEN.reopen() },
          REOPEN.count() > 1 ? { label: t('Recently Closed'), icon: 'layers', items: REOPEN.list().map((c, i) => ({
            label: c.title && c.title !== c.name ? `${c.name} — ${c.title}` : c.name, onClick: () => REOPEN.reopen(i),
          })) } : null,
          '-',
          /* the same layouts as the picker on the green button (shell/snaplayouts.js) */
          { label: t('Tile Window'), icon: 'grid', disabled: !has, items: has ? [
            { label: t('Left Half'), hint: kh('snap.left'), onClick: () => wm.snap(w, 'left') },
            { label: t('Right Half'), hint: kh('snap.right'), onClick: () => wm.snap(w, 'right') },
            { label: t('Top Half'), hint: kh('snap.top'), onClick: () => wm.snap(w, 'up') },
            { label: t('Bottom Half'), hint: kh('snap.bottom'), onClick: () => wm.snap(w, 'down') },
            '-',
            { label: t('Left Third'), onClick: () => wm.snap(w, 'l3') },
            { label: t('Middle Third'), onClick: () => wm.snap(w, 'c3') },
            { label: t('Right Third'), onClick: () => wm.snap(w, 'r3') },
            { label: t('Left Two Thirds'), onClick: () => wm.snap(w, 'l23') },
            { label: t('Right Two Thirds'), onClick: () => wm.snap(w, 'r23') },
            '-',
            { label: t('Top Left Quarter'), hint: kh('snap.tl'), onClick: () => wm.snap(w, 'tl') },
            { label: t('Top Right Quarter'), hint: kh('snap.tr'), onClick: () => wm.snap(w, 'tr') },
            { label: t('Bottom Left Quarter'), hint: kh('snap.bl'), onClick: () => wm.snap(w, 'bl') },
            { label: t('Bottom Right Quarter'), hint: kh('snap.br'), onClick: () => wm.snap(w, 'br') },
          ] : null },
          { label: t('Move to Desktop'), icon: 'layers', disabled: !has, items: has ? [
            ...others.map(d => ({ label: d.label, onClick: () => wm.moveToDesktop(w, d.id) })),
            others.length ? '-' : null,
            { label: t('New Desktop'), icon: 'plus', disabled: DESK.count() >= DESK.MAX,
              onClick: () => { const d = wm.addDesktop(); if (d) wm.moveToDesktop(w, d.id); } },
          ].filter(Boolean) : null },
          '-',
          { label: t('Bring All to Front'), icon: 'layers', disabled: !has, onClick: () => wm.byApp(w.appId).forEach(x => wm.focus(x)) },
          '-',
          /* js/core/winlayouts.js: Show Desktop, Hide Others, Tile All Windows, saved layouts */
          ...WL.menuItems(w),
          open.length ? '-' : null,
          ...open.slice(0, 8).map(x => ({
            label: x.app.name, icon: x === w ? 'check' : 'window',
            onClick: () => (x.min ? wm.restore(x) : wm.focus(x)),
          })),
        ].filter(Boolean);
      }],
      ['Help',   t('Help'),   () => [
        { label: t('Search'), icon: 'search', hint: kh('search'), onClick: () => api.spotlight() },
        /* the sheet that holding ⌘ / Ctrl shows, kept up (js/shell/cheatsheet.js,
           listed from js/core/keymap.js) */
        { label: t('Keyboard Shortcuts'), icon: 'keyboard', hint: t('hold {key}', { key: K }), onClick: () => bus.emit('shortcuts:show') },
        { label: t('All Shortcuts…'), icon: 'command', onClick: () => api.openApp('settings', { section: 'shortcuts' }) },
        '-',
        { label: t('Take the Tour'), icon: 'compass', onClick: () => bus.emit('tour:start') },
        { label: t('StaticOS Help'), icon: 'help-circle', onClick: () => api.openApp('about') },
      ]],
    ];

    api.render(menuStrip, strip.map(([id, label, items]) => h('button', {
      role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', dataset: { key: id },
      style: id === 'app' ? { fontWeight: '620', color: 'var(--ink-0)' } : null,
      onclick: e => dropAt(e.currentTarget, items()),
    }, h('span', { text: label }))));
  }

  /* ---------------- clock ---------------- */
  function paintClock(d) {
    const now = d instanceof Date ? d : new Date();
    const h24 = pref('h24');
    const c = fmt.fmtClock(now, h24);
    api.render(clockBtn,
      h('span', { text: `${fmt.dayName(now, 1)} ${fmt.monthName(now, 1)} ${now.getDate()}` }),
      h('span', { text: h24 ? c.time : `${c.time} ${c.ap}` }));
  }

  /* ---------------- shared controls ------ */
  function ccSlider(ic, label, key, unit) {
    const val = Math.round(store.get('prefs.' + key));
    const out = h('small', { text: `${val}${unit || '%'}`, style: { width: '30px', textAlign: 'right', color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' } });
    const input = h('input.slider', {
      type: 'range', min: '0', max: '100', value: String(val), 'aria-label': label,
      onpointerdown: () => { S.dragging = true; },
      oninput: e => { out.textContent = `${e.target.value}${unit || '%'}`; setPref(key, Number(e.target.value)); },
    });
    return h('div.cc__slider', icon(ic), input, out);
  }

  /* isOn: true/false is a switch (announced as pressed / not pressed);
     null is a plain action or a status tile. `lit` keeps the old look of
     a status tile that is highlighted without being a switch (Network). */
  function ccTile(ic, label, sub, isOn, onClick, wide, lit) {
    const b = h('button.cc__tile' + (wide ? '.cc__tile--wide' : ''), {
      onclick: onClick, dataset: { cc: label.toLowerCase().replace(/\s+/g, '-') },
      'aria-pressed': isOn == null ? null : String(!!isOn),
    }, icon(ic), h('div', h('b', { text: label }), h('small', { text: sub })));
    if (isOn || lit) b.classList.add('is-on');
    return b;
  }

  const volIcon = v => (v <= 0 ? 'volume-x' : v < 50 ? 'volume-1' : 'volume');

  /* Ambient sounds (js/core/ambient.js, Music › Ambient sounds) play with
     every window closed, so while they do, Control Centre and the Sound
     menu carry a strip to stop them or open the mixer. Their state comes
     over bus 'ambient:change'; the module is never loaded from here. */
  function ambStrip() {
    const a = S.amb;
    if (!a || !a.playing) return null;
    const mins = a.sleep ? Math.max(1, Math.ceil((a.sleep.endsAt - Date.now()) / 60000)) : 0;
    const sub = a.sleep ? (a.sleep.fading ? t('Fading out — sleep timer') : t('Sleep timer · {mins} min left', { mins }))
      : a.byFocus ? t('Ambient sounds · with your focus session') : t('Ambient sounds');
    const btn = (ic, label, tip, fn) => h('button.cc__mbtn.tip', { type: 'button', 'data-tip': tip, 'aria-label': label, onclick: fn }, icon(ic));
    return h('div.cc__now.cc__amb', { role: 'group', 'aria-label': t('Ambient sounds') },
      h('div.cc__now-g', icon('cloud-rain')),
      h('div.cc__now-b', h('b', { text: a.label }), h('small', { text: sub })),
      btn('sliders', t('Open the ambient mixer'), t('Mixer'), () => { closePop(); api.openApp('music', { view: 'ambient' }); }),
      btn('square', t('Stop ambient sounds'), t('Stop'), () => bus.emit('ambient:stop')));
  }

  /* ---------------- popover bodies ------- */
  function buildSound(el) {
    api.render(el,
      h('div.menu__label', { text: t('Sound') }),
      ccSlider(volIcon(pref('volume')), t('Volume'), 'volume'),
      ambStrip(),
      h('div.menu__sep'),
      mItem('settings', t('Sound Settings…'), null, () => api.openApp('settings')));
  }

  function buildNet(el) {
    const c = conn();
    const row = (ic, label, value) => h('button.menu__item.is-disabled', { disabled: true },
      icon(ic), h('span', { text: label }), h('small', { text: value, style: { marginLeft: 'auto' } }));
    api.render(el,
      h('div.menu__label', { text: t('Network') }),
      row(S.online ? 'wifi' : 'wifi-off', t('This tab'), S.online ? t('Online') : t('Offline')),
      c && c.effectiveType ? row('gauge', t('Connection class'), c.effectiveType) : null,
      c && c.downlink ? row('download', t('Downlink (browser estimate)'), `${c.downlink} Mb/s`) : null,
      c && c.rtt ? row('activity', t('Round trip (browser estimate)'), `${c.rtt} ms`) : null,
      c && c.saveData ? row('zap', t('Data Saver'), 'On') : null,
      !c ? h('div.menu__label', { text: t('This browser doesn’t report the connection type.'), style: { textTransform: 'none', letterSpacing: 0 } }) : null,
      h('div.menu__sep'),
      h('div.menu__label', { text: t('Web pages can’t see or switch Wi-Fi networks.'), style: { textTransform: 'none', letterSpacing: 0 } }),
      mItem('settings', t('Network Settings…'), null, () => api.openApp('settings', { section: 'network' })));
  }

  function buildBattery(el) {
    const b = S.batt;
    if (!b) { closePop(); return; }
    const pct = Math.round(b.level * 100);
    const mins = sec => (Number.isFinite(sec) && sec > 0 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : null);
    const est = b.charging ? mins(b.chargingTime) : mins(b.dischargingTime);
    api.render(el,
      h('div.menu__label', { text: t('Battery') }),
      h('button.menu__item.is-disabled', { disabled: true },
        icon(b.charging ? 'battery-charging' : 'battery'),
        h('span', { text: `${pct}% — ${b.charging ? 'Charging' : 'On battery'}` })),
      est ? h('button.menu__item.is-disabled', { disabled: true }, icon('clock'),
        h('span', { text: b.charging ? t('{est} until full', { est }) : t('{est} left (browser estimate)', { est }) })) : null,
      h('div.menu__sep'),
      mItem('gamepad', pref('gameMode') ? t('Turn Game Mode off') : t('Save power: Game Mode'), null, () => {
        const next = !pref('gameMode');
        setPref('gameMode', next);
        api.notify({ app: t('Game Mode'), icon: 'gamepad', title: next ? t('Game Mode on') : t('Game Mode off'), message: next ? GAME_MSG : t('Effects are back on.') });
      }));
  }

  /* a low-graphics "Performance mode": one switch over everything that
     costs frames, mirroring Settings' Low graphics preset. */
  const perfOn = p => LOW_GFX.reduceMotion === !!p.reduceMotion && !p.uiBlur && !p.uiShadows && !p.wallpaperGrain;
  function togglePerf(p) { LG.set(!perfOn(p)); }

  /* now-playing strip — only when Music has really started something */
  function ccNowPlaying() {
    const trk = S.track;
    if (!trk || !trk.title || trk.title === 'Nothing playing' || trk.source == null) return null;
    const btn = (ic, label, ev) => h('button.cc__mbtn.tip', { 'data-tip': label, 'aria-label': label, onclick: () => bus.emit(ev) }, icon(ic));
    return h('div.cc__now',
      h('div.cc__now-g', icon(t.live ? 'cast' : 'music')),
      h('div.cc__now-b',
        h('b', { text: t.title }),
        h('small', { text: [t.artist, t.album].filter(Boolean).join(' — ') || (t.live ? 'Live radio' : 'Static Music') })),
      t.live ? null : btn('back', t('Previous'), 'media:prev'),
      btn(t.playing ? 'pause' : 'play', t.playing ? t('Pause') : t('Play'), t.playing ? 'media:pause' : 'media:play'),
      t.live ? null : btn('forward', t('Next'), 'media:next'));
  }

  function buildCC(el) {
    const p = store.get('prefs');
    const now = ccNowPlaying();
    api.render(el,
      h('div.menu__label', { text: t('Control Centre') }),
      now,
      ambStrip(),
      h('div.cc__grid',
        ccTile(S.online ? 'wifi' : 'wifi-off', t('Network'), netLabel(), null, e => openPop('wifi', e.currentTarget.closest('.menu') || e.currentTarget, '', buildNet, 'right'), false, S.online),
        ccTile(p.dnd ? 'bell-off' : 'bell', t('Do Not Disturb'), p.dnd ? t('On') : t('Off'), p.dnd, () => setPref('dnd', !p.dnd)),
        ccTile('night-shift', t('Night Shift'), p.nightShift ? t('On') : t('Off'), p.nightShift, () => setPref('nightShift', !p.nightShift)),
        ccTile('gamepad', t('Game Mode'), p.gameMode ? t('On') : t('Off'), p.gameMode, () => setPref('gameMode', !p.gameMode)),
        ccTile('zap', t('Performance'), perfOn(p) ? t('Low graphics') : t('Full'), perfOn(p), () => togglePerf(p)),
        ccTile('sidebar', t('Widgets'), p.widgetsVisible ? t('Shown') : t('Hidden'), !!p.widgetsVisible, () => setPref('widgetsVisible', !p.widgetsVisible))),
      h('div', { style: { display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' } },
        ccSlider('sun', t('Brightness'), 'brightness'),
        ccSlider('volume', t('Volume'), 'volume')),
      h('div.cc__grid', { style: { marginTop: 'var(--sp-3)' } },
        ccTile(p.theme === 'light' ? 'sun' : 'moon', t('Theme'), p.theme === 'light' ? t('Light') : t('Dark'), p.theme === 'light',
          () => setPref('theme', p.theme === 'light' ? 'dark' : 'light')),
        ccTile('image', t('Wallpaper'), t('Shuffle'), null, shuffleWallpaper),
        ccTile('lock', t('Lock Screen'), t('Lock now'), null, () => { closePop(); bus.emit('power:lock'); })),
      h('button.cc__more', { onclick: () => { closePop(); api.openApp('settings'); } }, icon('settings'), h('span', { text: t('Settings') })));
  }

  /* switch to another unlocked built-in wallpaper at random */
  async function shuffleWallpaper() {
    try {
      const W = await import('../portal/wallpapers.js');
      const active = store.get(W.ACTIVE_KEY);
      const activeId = typeof active === 'string' ? active : (active && active.id);
      const options = W.list(store).filter(w => w.id !== activeId && w.kind !== undefined);
      if (!options.length) return;
      const pick = options[Math.floor(Math.random() * options.length)];
      W.setActive(store, pick.id);
      if (S.pop && S.pop.kind === 'cc') paintPop();
    } catch (e) { /* wallpapers module missing — no-op */ }
  }

  /* ---------------- tray ----------------- */
  function trayBtn(ic, tip, kind, onClick, ...extra) {
    const b = h('button.tray-btn.tip.tip--below', {
      'data-tip': tip, 'aria-label': tip, dataset: kind ? { pop: kind } : null, onclick: onClick,
    }, ic ? icon(ic) : null, extra);
    return b;
  }

  /* the accessibility button: the few settings people reach for in the middle
     of something — text size, magnifier, colour filters, contrast, motion, the
     keyboard — as an ordinary menu, so the keyboard and screen readers get it
     for free. The rest is one click away in Settings. */
  function a11yMenu(btn) {
    const set = (k, v) => store.set('prefs.' + k, v);
    const get = k => store.get('prefs.' + k);
    const text = get('textScale') || 'normal';
    const filter = get('colorFilter') || 'none';
    dropAt(btn, [
      { header: true, label: t('Accessibility') },
      { label: t('Text size'), icon: 'type', items: AQ.TEXT_SIZES.map(([v, l]) => ({ label: l, checked: text === v, onClick: () => set('textScale', v) })) },
      { label: t('Magnifier'), icon: 'zoom-in', checked: !!get('magnifier'), onClick: () => set('magnifier', !get('magnifier')) },
      { label: t('Colour filter'), icon: 'droplet', items: AQ.COLOUR_FILTERS.map(([v, l]) => ({ label: l, checked: filter === v, onClick: () => set('colorFilter', v) })) },
      { label: t('High contrast'), icon: 'eye', checked: get('contrast') === 'max', onClick: () => set('contrast', get('contrast') === 'max' ? 'normal' : 'max') },
      { label: t('Reduce motion'), icon: 'activity', checked: !!get('reduceMotion'), onClick: () => set('reduceMotion', !get('reduceMotion')) },
      { label: t('Large pointer'), icon: 'mouse-pointer', checked: !!get('largePointer'), onClick: () => set('largePointer', !get('largePointer')) },
      { label: t('On-screen keyboard'), icon: 'keyboard', checked: !!get('osk'), onClick: () => set('osk', !get('osk')) },
      '-',
      { label: t('Accessibility settings…'), icon: 'settings', onClick: () => api.openApp('settings', { section: 'accessibility' }) },
    ]);
  }

  /* the bell's words: Do Not Disturb, how long is left of a quick one, and what it held back */
  function bellTip() {
    const on = !!store.get('prefs.dnd');
    const until = DNDSCHED.quickUntil();
    const missed = HELD.count();
    const parts = [on ? t('Do Not Disturb') : t('Notifications')];
    if (on && until) parts.push(t('{left}, until {until}', { left: leftLabel(until), until: untilLabel(until, !!pref('h24')) }));
    if (missed) parts.push(t('Missed while Do Not Disturb was on: {missed}', { missed }));
    return parts.join(' · ');
  }

  function paintTray() {
    const p = store.get('prefs');

    const game = trayBtn('gamepad', t('Game Mode'), null, () => {
      const next = !pref('gameMode');
      setPref('gameMode', next);
      api.notify({ app: t('Game Mode'), icon: 'gamepad', title: next ? t('Game Mode on') : t('Game Mode off'),
        message: next ? GAME_MSG : t('Effects are back on.') });
    });
    if (p.gameMode) game.classList.add('is-on');

    const sound = trayBtn(volIcon(p.volume), t('Sound'), 'sound',
      e => openPop('sound', e.currentTarget, '', buildSound));
    /* a dot while ambient sounds play — the Sound menu can stop them */
    if (S.amb?.playing) {
      sound.classList.add('has-amb');
      sound.dataset.tip = t('Sound · ambient sounds playing');
      sound.setAttribute('aria-label', sound.dataset.tip);
    }

    const net = trayBtn(S.online ? 'wifi' : 'wifi-off', t('Network: {state}', { state: netLabel() }), 'wifi',
      e => openPop('wifi', e.currentTarget, '', buildNet));
    if (!S.online) net.classList.add('is-off');

    /* the battery only appears when the browser really reports one */
    let battery = null;
    if (S.batt) {
      const pct = fmt.clamp(Math.round(S.batt.level * 100), 0, 100);
      const charging = S.batt.charging;
      const batt = h('div.batt', h('i', { style: { width: pct + '%' } }));
      if (pct < 20) batt.classList.add('is-low');
      if (charging) batt.classList.add('is-charging');
      battery = trayBtn(null, charging ? t('Battery: {pct}% charging', { pct }) : t('Battery: {pct}%', { pct }), 'battery',
        e => openPop('battery', e.currentTarget, '', buildBattery, 'right'),
        h('span.tray-btn__val', { text: `${pct}%` }), batt);
    }

    const cc = trayBtn('sliders', t('Control Centre'), 'cc',
      e => openPop('cc', e.currentTarget, '.cc', buildCC, 'right'));

    const bell = trayBtn(p.dnd ? 'bell-off' : 'bell', bellTip(), null,
      () => { closePop(); bus.emit('noti:toggle'); });
    if (p.dnd) bell.classList.add('is-on');
    /* the time left in a quick Do Not Disturb moves on while the pointer is away */
    const retip = () => { const t = bellTip(); bell.dataset.tip = t; bell.setAttribute('aria-label', t); };
    bell.addEventListener('pointerenter', retip);
    bell.addEventListener('focus', retip);

    /* which desktop you are on, once there is more than one; click for the overview */
    let desk = null;
    if (DESK.count() > 1) {
      const cur = DESK.current();
      const label = `${DESK.label(cur)} (${DESK.indexOf(cur) + 1} of ${DESK.count()})`;
      desk = trayBtn('layers', label, 'desk', () => { closePop(); api.overview(); },
        h('span.tray-btn__val', { text: String(DESK.indexOf(cur) + 1) }));
      desk.classList.add('tray-btn--desk');
    }

    /* Settings › Accessibility › "Show the accessibility menu in the status bar" */
    let a11y = null;
    if (p.a11yMenu) {
      a11y = trayBtn('accessibility', t('Accessibility'), null, e => a11yMenu(e.currentTarget));
      a11y.setAttribute('aria-haspopup', 'menu');
      a11y.classList.add('tray-btn--a11y');
    }

    /* several people use this computer: whose desktop this is (click for Users) */
    const me = (PROFILES.MODE === 'profile' || PROFILES.MODE === 'single') && PROFILES.list().length > 1 ? PROFILES.current() : null;
    const who = me ? trayBtn('user', t('Signed in as {name}', { name: me.name }), null, () => { closePop(); bus.emit('users:open'); },
      h('span.tray-btn__val.tray-btn__who', { text: me.name })) : null;
    if (who) who.classList.add('tray-btn--who');

    api.render(tray, who, desk, game, focusChip(), dndChip(), friendsChip(), sound, net, battery, a11y, cc, bell);
  }

  /* ---------------- focus timer ----------
     While a Clock › Focus session runs (or is paused) the tray shows
     what is left; a click opens the Focus tab. The time is read from
     js/core/focus.js on every tick, never counted here. */
  let focusBtn = null;
  const mmss = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  function focusChip() {
    const f = FOCUS.state();
    if (!f.active) { focusBtn = null; return null; }
    focusBtn = trayBtn(f.phase === 'focus' ? 'flame' : 'wind', t('Focus'), null,
      () => { closePop(); api.openApp('clock', { tab: 'focus' }); },
      h('span.tray-btn__val', { text: mmss(f.left) }));
    focusBtn.classList.add('tray-btn--focus');
    paintFocus();
    return focusBtn;
  }
  function paintFocus() {
    if (!focusBtn) return;
    const f = FOCUS.state();
    if (!f.active) { paintTray(); return; }
    const left = mmss(f.left);
    const tip = t('{what}: {left} left{paused}. Open Focus', {
      what: f.what ? t('{label} on {what}', { label: f.label, what: f.what }) : f.label, left, paused: f.status === 'paused' ? t(', paused') : '' });
    focusBtn.querySelector('.tray-btn__val').textContent = left;
    focusBtn.classList.toggle('is-on', f.status === 'running' && f.phase === 'focus');
    focusBtn.dataset.tip = tip;
    focusBtn.setAttribute('aria-label', tip);
  }

  /* ---------------- friends online ----------
     How many of your Static Social friends are online, from the live count
     js/core/friends.js announces (bus 'friends:count'); it is not there at
     all until Friends is in use, has friends, and the count is switched on
     (Social › Friends › You). Nothing is shown for a count that is not known. */
  function friendsChip() {
    const f = S.friends;
    if (!f.on) return null;
    const tip = plural(f.online, '{n} friend online. Open Friends', '{n} friends online. Open Friends');
    const b = trayBtn('users', tip, null, () => { closePop(); api.openApp('social', { friends: true }); },
      h('span.tray-btn__val', { text: String(f.online) }));
    b.classList.add('tray-btn--friends');
    b.classList.toggle('is-on', f.online > 0);
    return b;
  }

  /* ---------------- Do Not Disturb schedule ----------
     While a schedule from Settings › Notifications holds Do Not
     Disturb, the tray says which one and until when. */
  function dndChip() {
    const i = DNDSCHED.info();
    if (!i) return null;
    const until = untilLabel(i.until, !!pref('h24'));
    const tip = t('Do Not Disturb: {name}, until {until}. Open schedules', { name: i.name, until });
    const b = trayBtn('moon', tip, null,
      () => { closePop(); api.openApp('settings', { section: 'notifications' }); },
      h('span.tray-btn__val', { text: t('Until {until}', { until }) }));
    b.classList.add('tray-btn--dndsched', 'is-on');
    return b;
  }

  /* ---------------- other hosts ---------
     The phone's pull-down shade (js/shell/mobile.js) shows this same
     Control Centre rather than a second copy of it: it hands an element
     over on bus 'cc:render', and we keep it painted while it is in the
     page. */
  const ccHosts = new Set();
  function paintHosts() {
    for (const el of ccHosts) {
      if (!el.isConnected) { ccHosts.delete(el); continue; }
      keepFocus(el, buildCC);
    }
  }

  /* ---------------- wire up -------------- */
  /* <html> data-theme + the night-shift filter belong to main.js applyPrefs;
     writing them from here too made two owners of one style property. */
  paintMenu();
  paintClock();
  paintTray();

  let lastTheme = pref('theme');
  const offs = [
    store.sub('prefs', () => {
      paintClock();
      paintTray();
      if (!S.dragging) { paintPop(); paintHosts(); }
      if (pref('theme') !== lastTheme) { lastTheme = pref('theme'); bus.emit('theme:change', store.get('prefs')); }
    }),
    api.on(window, 'online', () => { S.online = true; paintTray(); if (S.pop && S.pop.kind === 'wifi') paintPop(); }),
    api.on(window, 'offline', () => { S.online = false; paintTray(); if (S.pop && S.pop.kind === 'wifi') paintPop(); }),
    bus.on('tick:1s', d => { paintClock(d); paintFocus(); }),
    bus.on('focus:change', paintTray),
    bus.on('friends:count', c => { const n = { on: !!(c && c.on), online: Math.max(0, (c && c.online) | 0) }; if (n.on !== S.friends.on || n.online !== S.friends.online) { S.friends = n; paintTray(); } }),
    bus.on('dndsched:change', paintTray),
    bus.on('dndheld:change', paintTray),
    bus.on('win:focus', paintMenu),
    bus.on('desktop:switch', paintTray),
    bus.on('desktops:change', paintTray),
    bus.on('users:changed', paintTray),
    bus.on('win:list', paintMenu),
    bus.on('noti:open', closePop),   /* the drawer opened — fold our popovers */
    bus.on('media:track', t => { S.track = t && typeof t === 'object' ? t : null; if (S.pop && S.pop.kind === 'cc') paintPop(); paintHosts(); }),
    bus.on('cc:render', el => { if (el) { ccHosts.add(el); buildCC(el); } }),
    bus.on('ambient:change', a => {
      const was = !!S.amb?.playing;
      S.amb = a && typeof a === 'object' ? a : null;
      if (was !== !!S.amb?.playing) paintTray();
      if (S.pop && (S.pop.kind === 'cc' || S.pop.kind === 'sound')) paintPop();
      paintHosts();
    }),
    api.on(document, 'pointerup', () => { if (S.dragging) { S.dragging = false; paintPop(); paintHosts(); } }),
    api.on(window, 'resize', closePop),
  ];

  const c0 = conn();
  if (c0 && c0.addEventListener) {
    const onConn = () => { paintTray(); if (S.pop && S.pop.kind === 'wifi') paintPop(); };
    c0.addEventListener('change', onConn);
    offs.push(() => c0.removeEventListener('change', onConn));
  }
  if (navigator.getBattery) {
    navigator.getBattery().then(b => {
      S.batt = b;
      const onBatt = () => { paintTray(); if (S.pop && S.pop.kind === 'battery') paintPop(); };
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach(ev => b.addEventListener(ev, onBatt));
      offs.push(() => ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach(ev => b.removeEventListener(ev, onBatt)));
      paintTray();
    }).catch(() => {});
  }

  /* nothing unmounts the shell today; the handles are all here if it ever does */
  return () => { offs.forEach(off => off()); offRove.forEach(off => off()); closePop(); barEl.remove(); };
}

export default mountTopbar;
