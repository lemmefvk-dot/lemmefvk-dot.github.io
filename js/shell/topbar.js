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
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import * as wm from '../core/wm.js';
import * as L from '../core/layers.js';
import { roving } from '../core/roving.js';
import * as DESK from '../core/desktops.js';
import * as FOCUS from '../core/focus.js';
import * as DNDSCHED from '../core/dndsched.js';
import { untilLabel } from '../core/dndrules.js';
import * as REOPEN from '../core/reopen.js';
import * as KM from '../core/keymap.js';

export function mountTopbar(host) {
  const { h, icon, fmt } = api;
  const K = fmt.modLabel;
  /* a StaticOS shortcut as this person has it (Settings › Shortcuts) */
  const kh = id => KM.hint(id) || undefined;

  /* ---------------- state ---------------- */
  const S = { pop: null, dragging: false, online: navigator.onLine !== false, batt: null };
  const conn = () => navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const netLabel = () => {
    if (!S.online) return 'Offline';
    const c = conn();
    return c && c.effectiveType ? `Online · ${c.effectiveType}` : 'Online';
  };
  const GAME_MSG = 'Blur, shadows, animations, the wallpaper video and widget updates are off, so games get the frames.';

  const pref = k => store.get('prefs.' + k);
  const setPref = (k, v) => store.set('prefs.' + k, v);

  /* ---------------- chrome --------------- */
  const brandBtn = h('button.topbar__brand', { 'aria-label': 'Static menu', onclick: e => aetherMenu(e) },
    h('div.topbar__logo', icon('diamond')),
    h('span.topbar__name', { text: 'StaticOS' }));
  /* a real menu bar: one Tab stop, ←/→ between menus, ↓/Enter opens one,
     and ←/→ inside an open menu walks to the neighbouring menu */
  const menuStrip = h('div.topbar__menu', { role: 'menubar', 'aria-label': 'App menu' });
  const clockBtn = h('button.topbar__clock.tip.tip--below', {
    'data-tip': 'Notification Centre', 'aria-label': 'Date and time',
    onclick: () => { closePop(); bus.emit('noti:toggle'); },
  });
  const tray = h('div.topbar__tray', { role: 'toolbar', 'aria-label': 'Status' });
  const barEl = h('header.topbar', { 'aria-label': 'Top bar' }, brandBtn, menuStrip, clockBtn, tray);
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
    api.menu(items.filter(Boolean), r.left, r.bottom + 6, { label: btn.textContent.trim() || btn.getAttribute('aria-label') || 'Menu', onEdge });
    /* the menu takes focus; flip the state back when it closes */
    const off = () => { btn.setAttribute('aria-expanded', 'false'); };
    setTimeout(() => document.addEventListener('pointerdown', off, { capture: true, once: true }), 0);
    btn.addEventListener('focus', off, { once: true });
  }

  function aetherMenu(e) {
    dropAt(e.currentTarget, [
      { label: 'About This Static', icon: 'info', onClick: () => api.openApp('about') },
      '-',
      { label: 'System Settings…', icon: 'settings', onClick: () => api.openApp('settings') },
      { label: 'Static Store…', icon: 'store', onClick: () => api.openApp('store') },
      '-',
      { label: 'Sleep', icon: 'moon', onClick: () => bus.emit('power:sleep') },
      { label: 'Restart…', icon: 'refresh', onClick: () => bus.emit('power:restart') },
      { label: 'Shut Down…', icon: 'power', onClick: () => bus.emit('power:restart') },
      '-',
      { label: 'Lock Screen', icon: 'lock', hint: kh('lock'), onClick: () => bus.emit('power:lock') },
      { label: 'Switch User…', icon: 'users', onClick: () => bus.emit('users:open') },
    ]);
  }

  /* ---------------- app menu strip ------- */
  function fullScreen() {
    if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); return; }
    const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => api.notify({ title: 'Full screen unavailable', message: 'The browser refused the request.', icon: 'expand' }));
  }

  function paintMenu() {
    const w = wm.getActive();
    const name = w ? w.app.name : 'StaticOS';
    const has = !!w;
    const strip = [
      ['app',    name,     () => [
        { label: `About ${name}`, icon: 'info', onClick: () => api.openApp('about') },
        '-',
        { label: 'Preferences…', icon: 'settings', hint: `${K},`, onClick: () => api.openApp('settings') },
        '-',
        { label: `Hide ${name}`, icon: 'eye', disabled: !has, onClick: () => wm.byApp(w.appId).forEach(x => wm.minimize(x)) },
        { label: `Quit ${name}`, icon: 'power', hint: `${K}Q`, disabled: !has, danger: true, onClick: () => wm.closeApp(w.appId) },
      ]],
      ['File',   'File',   () => [
        { label: 'New Window', icon: 'plus', hint: `${K}N`, disabled: !has, onClick: () => api.openApp(w.appId) },
        { label: 'Open…', icon: 'folder-open', hint: `${K}O`, onClick: () => api.openApp('files') },
        '-',
        { label: 'Save', icon: 'save', hint: `${K}S`, disabled: !has, onClick: () => api.notify({ app: name, icon: 'save', title: 'Saved', message: 'Nothing had changed.' }) },
        { label: 'Print…', icon: 'printer', hint: `${K}P`, onClick: () => api.notify({ app: name, icon: 'printer', title: 'No printers', message: 'Add a printer in System Settings.' }) },
        '-',
        { label: 'Close Window', icon: 'close', hint: `${K}W`, disabled: !has, onClick: () => w.close() },
      ]],
      ['Edit',   'Edit',   () => [
        { label: 'Undo', icon: 'rotate-ccw', hint: `${K}Z`, onClick: () => document.execCommand('undo') },
        { label: 'Redo', icon: 'repeat', hint: `⇧${K}Z`, onClick: () => document.execCommand('redo') },
        '-',
        { label: 'Cut', icon: 'x', hint: `${K}X`, onClick: () => document.execCommand('cut') },
        { label: 'Copy', icon: 'copy', hint: `${K}C`, onClick: () => document.execCommand('copy') },
        { label: 'Paste', icon: 'clipboard', hint: `${K}V`, onClick: () => document.execCommand('paste') },
        '-',
        { label: 'Select All', icon: 'check-circle', hint: `${K}A`, onClick: () => document.execCommand('selectAll') },
      ]],
      ['View',   'View',   () => [
        { label: document.fullscreenElement ? 'Exit Full Screen' : 'Enter Full Screen', icon: 'expand', hint: `⌃${K}F`, onClick: fullScreen },
        { label: pref('widgetsVisible') ? 'Hide Widgets' : 'Show Widgets', icon: 'sidebar', onClick: () => setPref('widgetsVisible', !pref('widgetsVisible')) },
        { label: 'Show Overview', icon: 'grid-9', hint: kh('overview'), onClick: () => api.overview() },
        '-',
        { label: 'Show Desktop Icons', icon: pref('desktopIcons') ? 'check' : 'desktop', onClick: () => setPref('desktopIcons', !pref('desktopIcons')) },
      ]],
      ['Window', 'Window', () => {
        const open = wm.list();
        const others = DESK.list().filter(d => !w || d.id !== w.desk);
        return [
          { label: 'Minimize', icon: 'minimize-2', hint: kh('win.min'), disabled: !has, onClick: () => w.minimize() },
          { label: 'Zoom', icon: 'maximize-2', disabled: !has, onClick: () => w.toggleMax() },
          { label: 'Close', icon: 'close', hint: kh('win.close'), disabled: !has, onClick: () => w.close() },
          /* js/core/reopen.js — the newest closed window, back where it was */
          { label: 'Reopen Closed Window', icon: 'window', hint: kh('reopen'), disabled: !REOPEN.count(), onClick: () => REOPEN.reopen() },
          REOPEN.count() > 1 ? { label: 'Recently Closed', icon: 'layers', items: REOPEN.list().map((c, i) => ({
            label: c.title && c.title !== c.name ? `${c.name} — ${c.title}` : c.name, onClick: () => REOPEN.reopen(i),
          })) } : null,
          '-',
          /* the same layouts as the picker on the green button (shell/snaplayouts.js) */
          { label: 'Tile Window', icon: 'grid', disabled: !has, items: has ? [
            { label: 'Left Half', hint: kh('snap.left'), onClick: () => wm.snap(w, 'left') },
            { label: 'Right Half', hint: kh('snap.right'), onClick: () => wm.snap(w, 'right') },
            { label: 'Top Half', hint: kh('snap.top'), onClick: () => wm.snap(w, 'up') },
            { label: 'Bottom Half', hint: kh('snap.bottom'), onClick: () => wm.snap(w, 'down') },
            '-',
            { label: 'Left Third', onClick: () => wm.snap(w, 'l3') },
            { label: 'Middle Third', onClick: () => wm.snap(w, 'c3') },
            { label: 'Right Third', onClick: () => wm.snap(w, 'r3') },
            { label: 'Left Two Thirds', onClick: () => wm.snap(w, 'l23') },
            { label: 'Right Two Thirds', onClick: () => wm.snap(w, 'r23') },
            '-',
            { label: 'Top Left Quarter', hint: kh('snap.tl'), onClick: () => wm.snap(w, 'tl') },
            { label: 'Top Right Quarter', hint: kh('snap.tr'), onClick: () => wm.snap(w, 'tr') },
            { label: 'Bottom Left Quarter', hint: kh('snap.bl'), onClick: () => wm.snap(w, 'bl') },
            { label: 'Bottom Right Quarter', hint: kh('snap.br'), onClick: () => wm.snap(w, 'br') },
          ] : null },
          { label: 'Move to Desktop', icon: 'layers', disabled: !has, items: has ? [
            ...others.map(d => ({ label: d.label, onClick: () => wm.moveToDesktop(w, d.id) })),
            others.length ? '-' : null,
            { label: 'New Desktop', icon: 'plus', disabled: DESK.count() >= DESK.MAX,
              onClick: () => { const d = wm.addDesktop(); if (d) wm.moveToDesktop(w, d.id); } },
          ].filter(Boolean) : null },
          '-',
          { label: 'Bring All to Front', icon: 'layers', disabled: !has, onClick: () => wm.byApp(w.appId).forEach(x => wm.focus(x)) },
          open.length ? '-' : null,
          ...open.slice(0, 8).map(x => ({
            label: x.app.name, icon: x === w ? 'check' : 'window',
            onClick: () => (x.min ? wm.restore(x) : wm.focus(x)),
          })),
        ].filter(Boolean);
      }],
      ['Help',   'Help',   () => [
        { label: 'Search', icon: 'search', hint: kh('search'), onClick: () => api.spotlight() },
        /* the sheet that holding ⌘ / Ctrl shows, kept up (js/shell/cheatsheet.js,
           listed from js/core/keymap.js) */
        { label: 'Keyboard Shortcuts', icon: 'keyboard', hint: `hold ${K}`, onClick: () => bus.emit('shortcuts:show') },
        { label: 'All Shortcuts…', icon: 'command', onClick: () => api.openApp('settings', { section: 'shortcuts' }) },
        '-',
        { label: 'Take the Tour', icon: 'compass', onClick: () => bus.emit('tour:start') },
        { label: 'StaticOS Help', icon: 'help-circle', onClick: () => api.openApp('about') },
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
    const sub = a.sleep ? (a.sleep.fading ? 'Fading out — sleep timer' : `Sleep timer · ${mins} min left`)
      : a.byFocus ? 'Ambient sounds · with your focus session' : 'Ambient sounds';
    const btn = (ic, label, tip, fn) => h('button.cc__mbtn.tip', { type: 'button', 'data-tip': tip, 'aria-label': label, onclick: fn }, icon(ic));
    return h('div.cc__now.cc__amb', { role: 'group', 'aria-label': 'Ambient sounds' },
      h('div.cc__now-g', icon('cloud-rain')),
      h('div.cc__now-b', h('b', { text: a.label }), h('small', { text: sub })),
      btn('sliders', 'Open the ambient mixer', 'Mixer', () => { closePop(); api.openApp('music', { view: 'ambient' }); }),
      btn('square', 'Stop ambient sounds', 'Stop', () => bus.emit('ambient:stop')));
  }

  /* ---------------- popover bodies ------- */
  function buildSound(el) {
    api.render(el,
      h('div.menu__label', { text: 'Sound' }),
      ccSlider(volIcon(pref('volume')), 'Volume', 'volume'),
      ambStrip(),
      h('div.menu__sep'),
      mItem('settings', 'Sound Settings…', null, () => api.openApp('settings')));
  }

  function buildNet(el) {
    const c = conn();
    const row = (ic, label, value) => h('button.menu__item.is-disabled', { disabled: true },
      icon(ic), h('span', { text: label }), h('small', { text: value, style: { marginLeft: 'auto' } }));
    api.render(el,
      h('div.menu__label', { text: 'Network' }),
      row(S.online ? 'wifi' : 'wifi-off', 'This tab', S.online ? 'Online' : 'Offline'),
      c && c.effectiveType ? row('gauge', 'Connection class', c.effectiveType) : null,
      c && c.downlink ? row('download', 'Downlink (browser estimate)', `${c.downlink} Mb/s`) : null,
      c && c.rtt ? row('activity', 'Round trip (browser estimate)', `${c.rtt} ms`) : null,
      c && c.saveData ? row('zap', 'Data Saver', 'On') : null,
      !c ? h('div.menu__label', { text: 'This browser doesn’t report the connection type.', style: { textTransform: 'none', letterSpacing: 0 } }) : null,
      h('div.menu__sep'),
      h('div.menu__label', { text: 'Web pages can’t see or switch Wi-Fi networks.', style: { textTransform: 'none', letterSpacing: 0 } }),
      mItem('settings', 'Network Settings…', null, () => api.openApp('settings', { section: 'network' })));
  }

  function buildBattery(el) {
    const b = S.batt;
    if (!b) { closePop(); return; }
    const pct = Math.round(b.level * 100);
    const mins = sec => (Number.isFinite(sec) && sec > 0 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : null);
    const est = b.charging ? mins(b.chargingTime) : mins(b.dischargingTime);
    api.render(el,
      h('div.menu__label', { text: 'Battery' }),
      h('button.menu__item.is-disabled', { disabled: true },
        icon(b.charging ? 'battery-charging' : 'battery'),
        h('span', { text: `${pct}% — ${b.charging ? 'Charging' : 'On battery'}` })),
      est ? h('button.menu__item.is-disabled', { disabled: true }, icon('clock'),
        h('span', { text: b.charging ? `${est} until full` : `${est} left (browser estimate)` })) : null,
      h('div.menu__sep'),
      mItem('gamepad', pref('gameMode') ? 'Turn Game Mode off' : 'Save power: Game Mode', null, () => {
        const next = !pref('gameMode');
        setPref('gameMode', next);
        api.notify({ app: 'Game Mode', icon: 'gamepad', title: next ? 'Game Mode on' : 'Game Mode off', message: next ? GAME_MSG : 'Effects are back on.' });
      }));
  }

  /* a low-graphics "Performance mode": one switch over everything that
     costs frames, mirroring Settings' Low graphics preset. */
  const LOW_GFX = { reduceMotion: true, uiBlur: false, uiShadows: false, wallpaperGrain: false };
  const perfOn = p => LOW_GFX.reduceMotion === !!p.reduceMotion && !p.uiBlur && !p.uiShadows && !p.wallpaperGrain;
  function togglePerf(p) {
    const on = perfOn(p);
    const next = { ...store.get('prefs') };
    if (on) { next.reduceMotion = false; next.uiBlur = true; next.uiShadows = true; next.wallpaperGrain = true; }
    else Object.assign(next, LOW_GFX);
    store.set('prefs', next);
  }

  /* now-playing strip — only when Music has really started something */
  function ccNowPlaying() {
    const t = S.track;
    if (!t || !t.title || t.title === 'Nothing playing' || t.source == null) return null;
    const btn = (ic, label, ev) => h('button.cc__mbtn.tip', { 'data-tip': label, 'aria-label': label, onclick: () => bus.emit(ev) }, icon(ic));
    return h('div.cc__now',
      h('div.cc__now-g', icon(t.live ? 'cast' : 'music')),
      h('div.cc__now-b',
        h('b', { text: t.title }),
        h('small', { text: [t.artist, t.album].filter(Boolean).join(' — ') || (t.live ? 'Live radio' : 'Static Music') })),
      t.live ? null : btn('back', 'Previous', 'media:prev'),
      btn(t.playing ? 'pause' : 'play', t.playing ? 'Pause' : 'Play', t.playing ? 'media:pause' : 'media:play'),
      t.live ? null : btn('forward', 'Next', 'media:next'));
  }

  function buildCC(el) {
    const p = store.get('prefs');
    const now = ccNowPlaying();
    api.render(el,
      h('div.menu__label', { text: 'Control Centre' }),
      now,
      ambStrip(),
      h('div.cc__grid',
        ccTile(S.online ? 'wifi' : 'wifi-off', 'Network', netLabel(), null, e => openPop('wifi', e.currentTarget.closest('.menu') || e.currentTarget, '', buildNet, 'right'), false, S.online),
        ccTile(p.dnd ? 'bell-off' : 'bell', 'Do Not Disturb', p.dnd ? 'On' : 'Off', p.dnd, () => setPref('dnd', !p.dnd)),
        ccTile('night-shift', 'Night Shift', p.nightShift ? 'On' : 'Off', p.nightShift, () => setPref('nightShift', !p.nightShift)),
        ccTile('gamepad', 'Game Mode', p.gameMode ? 'On' : 'Off', p.gameMode, () => setPref('gameMode', !p.gameMode)),
        ccTile('zap', 'Performance', perfOn(p) ? 'Low graphics' : 'Full', perfOn(p), () => togglePerf(p)),
        ccTile('sidebar', 'Widgets', p.widgetsVisible ? 'Shown' : 'Hidden', !!p.widgetsVisible, () => setPref('widgetsVisible', !p.widgetsVisible))),
      h('div', { style: { display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' } },
        ccSlider('sun', 'Brightness', 'brightness'),
        ccSlider('volume', 'Volume', 'volume')),
      h('div.cc__grid', { style: { marginTop: 'var(--sp-3)' } },
        ccTile(p.theme === 'light' ? 'sun' : 'moon', 'Theme', p.theme === 'light' ? 'Light' : 'Dark', p.theme === 'light',
          () => setPref('theme', p.theme === 'light' ? 'dark' : 'light')),
        ccTile('image', 'Wallpaper', 'Shuffle', null, shuffleWallpaper),
        ccTile('lock', 'Lock Screen', 'Lock now', null, () => { closePop(); bus.emit('power:lock'); })),
      h('button.cc__more', { onclick: () => { closePop(); api.openApp('settings'); } }, icon('settings'), h('span', { text: 'Settings' })));
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

  function paintTray() {
    const p = store.get('prefs');

    const game = trayBtn('gamepad', 'Game Mode', null, () => {
      const next = !pref('gameMode');
      setPref('gameMode', next);
      api.notify({ app: 'Game Mode', icon: 'gamepad', title: next ? 'Game Mode on' : 'Game Mode off',
        message: next ? GAME_MSG : 'Effects are back on.' });
    });
    if (p.gameMode) game.classList.add('is-on');

    const sound = trayBtn(volIcon(p.volume), 'Sound', 'sound',
      e => openPop('sound', e.currentTarget, '', buildSound));
    /* a dot while ambient sounds play — the Sound menu can stop them */
    if (S.amb?.playing) {
      sound.classList.add('has-amb');
      sound.dataset.tip = 'Sound · ambient sounds playing';
      sound.setAttribute('aria-label', sound.dataset.tip);
    }

    const net = trayBtn(S.online ? 'wifi' : 'wifi-off', `Network: ${netLabel()}`, 'wifi',
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
      battery = trayBtn(null, charging ? `Battery: ${pct}% charging` : `Battery: ${pct}%`, 'battery',
        e => openPop('battery', e.currentTarget, '', buildBattery, 'right'),
        h('span.tray-btn__val', { text: `${pct}%` }), batt);
    }

    const cc = trayBtn('sliders', 'Control Centre', 'cc',
      e => openPop('cc', e.currentTarget, '.cc', buildCC, 'right'));

    const bell = trayBtn(p.dnd ? 'bell-off' : 'bell', p.dnd ? 'Do Not Disturb' : 'Notifications', null,
      () => { closePop(); bus.emit('noti:toggle'); });
    if (p.dnd) bell.classList.add('is-on');

    /* which desktop you are on, once there is more than one; click for the overview */
    let desk = null;
    if (DESK.count() > 1) {
      const cur = DESK.current();
      const label = `${DESK.label(cur)} (${DESK.indexOf(cur) + 1} of ${DESK.count()})`;
      desk = trayBtn('layers', label, 'desk', () => { closePop(); api.overview(); },
        h('span.tray-btn__val', { text: String(DESK.indexOf(cur) + 1) }));
      desk.classList.add('tray-btn--desk');
    }

    api.render(tray, desk, game, focusChip(), dndChip(), sound, net, battery, cc, bell);
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
    focusBtn = trayBtn(f.phase === 'focus' ? 'flame' : 'wind', 'Focus', null,
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
    const tip = `${f.label}: ${left} left${f.status === 'paused' ? ', paused' : ''}. Open Focus`;
    focusBtn.querySelector('.tray-btn__val').textContent = left;
    focusBtn.classList.toggle('is-on', f.status === 'running' && f.phase === 'focus');
    focusBtn.dataset.tip = tip;
    focusBtn.setAttribute('aria-label', tip);
  }

  /* ---------------- Do Not Disturb schedule ----------
     While a schedule from Settings › Notifications holds Do Not
     Disturb, the tray says which one and until when. */
  function dndChip() {
    const i = DNDSCHED.info();
    if (!i) return null;
    const until = untilLabel(i.until, !!pref('h24'));
    const tip = `Do Not Disturb: ${i.name}, until ${until}. Open schedules`;
    const b = trayBtn('moon', tip, null,
      () => { closePop(); api.openApp('settings', { section: 'notifications' }); },
      h('span.tray-btn__val', { text: `Until ${until}` }));
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
    bus.on('dndsched:change', paintTray),
    bus.on('win:focus', paintMenu),
    bus.on('desktop:switch', paintTray),
    bus.on('desktops:change', paintTray),
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
