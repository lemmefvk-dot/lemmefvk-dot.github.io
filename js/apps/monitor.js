/* ============================================================
   monitor.js — System Monitor.

   This app used to invent sixteen CPU cores, a process table and
   a set of disk volumes and animate them with Math.random(). It
   looked convincing and reported nothing.

   A web page genuinely cannot see host CPU load, GPU load, a
   process list or disk I/O. No browser exposes any of it. So the
   rewrite draws a hard line: every number on screen is read from
   a real API through js/core/metrics.js, and the things that
   cannot be measured are named explicitly on their own panel
   rather than being faked.

   That turns out to be more interesting, not less — frame rate,
   heap pressure, what the page has actually downloaded and what
   came from cache are the numbers that tell you whether StaticOS
   is struggling on a given machine, which is the question the
   fake dials were pretending to answer.

   Added on the same rule (a number is shown only if it was measured):
   · Record 60 s writes the frame rate, JS heap, request count and long
     tasks, once a second, to a CSV. A column the browser does not report
     is left empty, never filled in.
   · "Slow right now" appears after three frames-per-second readings in
     a row under 30, and points at Game Mode.
   · Long tasks counts the 50 ms+ stalls the browser reports (Chromium).
   · The Windows table sorts, and minimises, restores and closes windows.
   · Low-battery tips appear only where the browser reports a battery.
   · Pause holds the live gauges so a figure can be read; recording and
     the slow hint's counting carry on underneath.
   ============================================================ */

import { defineApp } from '../core/registry.js';
import * as M from '../core/metrics.js';
import * as SI from '../core/sysinfo.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-monitor-css')) {
  const l = document.createElement('link');
  l.id = 'feat-monitor-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-monitor.css';
  document.head.appendChild(l);
}

const TABS = [
  ['overview', 'Overview', 'activity'],
  ['memory', 'Memory', 'layers'],
  ['network', 'Network', 'wifi'],
  ['windows', 'Windows', 'maximize'],
  ['device', 'Device', 'cpu'],
];

const REC_SECONDS = 60;
const SLOW_FPS = 30;          /* under this, three readings in a row, is "slow right now" */
const LOW_BATTERY = 30;       /* % — tips appear at or under this, on battery */
const CSV_COLS = ['second', 'fps', 'heap_used_bytes', 'heap_percent', 'requests_total', 'requests_new', 'transferred_bytes', 'long_tasks_total', 'windows_open'];
const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const pct = v => `${Math.max(0, Math.min(100, Math.round(v)))}%`;
const ms = v => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);

defineApp({
  id: 'monitor',
  name: 'System Monitor',
  icon: 'activity',
  g1: '#86efac', g2: '#15803d',
  category: 'Utilities',
  keywords: ['cpu', 'ram', 'memory', 'fps', 'performance', 'network', 'storage', 'task manager'],
  desc: 'Real browser performance — and what cannot be measured',
  pinned: true, dock: true, singleton: true,
  win: { w: 820, h: 560, minW: 520, minH: 380 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, render, clear } = api;

    const S = { tab: api.store.get('portal.monitor.tab', 'overview'), dead: false, paused: false, frozen: null, frozenHist: null,
      slow: 0, fine: 0, sort: { key: 'app', dir: 1 } };
    const R = {};
    /* the 60-second recording: lives here, not in a tab, so it carries on while another tab is showing */
    const REC = { state: 'idle', rows: [], t0: 0, prevReq: null, file: '' };
    const hist = () => (S.paused && S.frozenHist ? S.frozenHist : M.history());
    const snapNow = () => (S.paused && S.frozen ? S.frozen : M.snapshot());

    M.start('monitor');

    const body = h('div.mon__body');
    const tabs = h('div.mon__tabs', { role: 'tablist', 'aria-label': 'System Monitor sections' });

    function paintTabs() {
      clear(tabs);
      for (const [id, label, ic] of TABS) {
        const on = id === S.tab;
        tabs.appendChild(h(on ? 'button.mon__tab.is-on' : 'button.mon__tab', {
          type: 'button', role: 'tab', 'aria-selected': String(on),
          onclick: () => { S.tab = id; api.store.set('portal.monitor.tab', id); paintTabs(); paint(); },
        }, icon(ic, { size: 13 }), h('span', { text: label })));
      }
    }

    /* One subscription drives every live figure. The metrics module
       samples once a second off its own frame counter, so nothing here
       needs a timer of its own. */
    const off = api.bus?.on?.('metrics:tick', snap => {
      if (S.dead) return;
      recTick(snap);
      watchSlow(snap);
      if (!S.paused) live(snap);
    });
    /* and each window animation reports its own frames as it finishes */
    const offAnim = api.bus?.on?.('metrics:transition', () => { if (!S.dead && !S.paused) paintAnims(); });
    /* the Windows table follows the window manager, not just the second tick */
    const offWins = ['win:list', 'win:minimize', 'win:restore', 'win:focus', 'win:close']
      .map(e => api.bus?.on?.(e, () => { if (!S.dead && S.tab === 'windows') paintWindows(false); }));

    /* The window manager only honours the function mount() RETURNS
       (wm.js: `if (typeof teardown === 'function') w.hooks.close.push(...)`).
       This used to hang the cleanup on root.cherriTeardown — a convention
       the portal sub-views use, which nothing calls for an app window — so
       closing System Monitor left its metrics claim and its bus
       subscription behind, and the frame sampler ran forever. */
    const teardown = () => {
      S.dead = true;
      try { off?.(); } catch (err) { /* already gone */ }
      try { offAnim?.(); } catch (err) { /* already gone */ }
      offWins.forEach(f => { try { f?.(); } catch (err) { /* already gone */ } });
      M.stop('monitor');
    };

    /* ---------- shared pieces ---------- */

    /* A sparkline drawn as an SVG path — no canvas, so it scales with the
       window and costs nothing when the tab is not visible. */
    function spark(values, { height = 38, max = null } = {}) {
      const vals = values.length ? values : [0];
      const top = max ?? Math.max(1, ...vals);
      const step = 100 / Math.max(1, vals.length - 1);
      const d = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)} ${(100 - (v / top) * 100).toFixed(2)}`).join(' ');
      const area = `${d} L100 100 L0 100 Z`;
      return h('svg.mon__spark', {
        viewBox: '0 0 100 100', preserveAspectRatio: 'none',
        style: { height: `${height}px` }, 'aria-hidden': 'true',
      },
        h('path.mon__sparkfill', { d: area }),
        h('path.mon__sparkline', { d }));
    }

    function ring(value, label, sub) {
      const v = Math.max(0, Math.min(100, value || 0));
      const C = 2 * Math.PI * 26;
      return h('div.mon__ring',
        h('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' },
          h('circle.mon__ringbg', { cx: 32, cy: 32, r: 26 }),
          h('circle.mon__ringfg', {
            cx: 32, cy: 32, r: 26,
            style: { strokeDasharray: `${C}`, strokeDashoffset: `${C * (1 - v / 100)}` },
          })),
        h('div.mon__ringin', h('b', { text: pct(v) }), h('small', { text: label })),
        sub ? h('div.mon__ringsub', { text: sub }) : null);
    }

    const card = (title, ic, ...kids) => h('div.mon__card',
      h('div.mon__cardh', icon(ic, { size: 13 }), h('b', { text: title })),
      ...kids);

    const row = (k, v) => h('div.mon__row', h('span', { text: k }), h('b', { text: v }));

    /* Shown wherever the browser simply will not answer. Saying so plainly
       is the whole point of the rewrite. */
    function missing(what, why) {
      return h('div.mon__missing', icon('alert', { size: 12 }),
        h('div', h('b', { text: what }), h('small', { text: why })));
    }

    /* ---------- painting ---------- */

    function paint() {
      clear(body);
      if (S.tab === 'overview') return overview();
      if (S.tab === 'memory') return memory();
      if (S.tab === 'network') return network();
      if (S.tab === 'windows') return windows();
      return device();
    }

    function overview() {
      R.fpsRing = ring(0, 'FPS', '');
      R.fpsSpark = h('div.mon__sparkwrap', spark(hist().fps, { max: 70 }));
      R.heapSlot = h('div');
      R.winSlot = h('div');
      R.animSlot = h('div');
      R.ltSlot = h('div');
      R.recSlot = h('div');

      const heapCard = M.heap()
        ? card('JS heap', 'layers', R.heapSlot)
        : card('JS heap', 'layers', missing('Not reported here',
            'Only Chromium-based browsers expose performance.memory.'));

      body.append(
        h('div.mon__grid',
          card('Frame rate', 'activity',
            h('div.mon__fps', R.fpsRing, R.fpsSpark),
            h('small.dim', { text: 'Counted from real animation frames — the one live performance '
              + 'figure a page can honestly report.' })),
          heapCard,
          card('Open windows', 'maximize', R.winSlot),
          card('Long tasks', 'clock', R.ltSlot,
            h('small.dim', { text: 'Stretches of 50 ms or more when the page could not respond, as the browser '
              + 'reports them since the page loaded.' })),
          card('Record 60 seconds', 'download', R.recSlot),
          card('Window animations', 'layers', R.animSlot,
            h('small.dim', { text: 'Every open, close, snap and desktop switch is timed frame by frame as it plays. '
              + 'A dropped frame is a screen refresh it missed.' })),
          card('Cannot be measured', 'shield',
            h('div.mon__cant', M.unavailable().map(([what, why]) =>
              h('div.mon__cantrow', h('b', { text: what }), h('small', { text: why })))))),
      );
      live(snapNow());
      paintLongTasks();
      paintRec();
      paintAnims();
    }

    const ANIM_NAMES = {
      'win:open': 'Window opened', 'win:close': 'Window closed', 'win:minimize': 'Minimised', 'win:restore': 'Restored',
      'win:maximize': 'Maximised', 'win:unmaximize': 'Un-maximised', 'win:snap': 'Snapped', 'win:focus': 'Brought forward',
      'win:to-desktop': 'Moved to a desktop', 'desktop:switch': 'Desktop switch', 'desktop:spring-back': 'Swipe let go',
    };
    function paintAnims() {
      if (!R.animSlot || !body.contains(R.animSlot)) return;
      const last = M.transitions().slice(-6).reverse();
      clear(R.animSlot);
      if (!last.length) {
        R.animSlot.append(h('small.dim', { text: 'Nothing has animated yet — open, snap or switch something.' }));
        return;
      }
      R.animSlot.append(...last.map(r => row(ANIM_NAMES[r.label] || r.label,
        r.frames ? `${r.dropped} dropped of ${r.frames + r.dropped}` : 'no frames drawn')));
    }

    function memory() {
      const heap = M.heap();
      const slot = h('div.mon__grid');
      body.append(slot);

      slot.appendChild(heap
        ? card('JavaScript heap', 'layers',
            ring(heap.pct, 'used', `${M.formatBytes(heap.used)} of ${M.formatBytes(heap.limit)}`),
            row('Allocated', M.formatBytes(heap.total)),
            row('Limit', M.formatBytes(heap.limit)),
            h('small.dim', { text: 'This is Static’s own JavaScript memory, not the machine’s RAM. '
              + 'A page is never told how much system memory is in use.' }))
        : card('JavaScript heap', 'layers', missing('Not reported here',
            'performance.memory is Chromium-only.')));

      const store = card('Storage', 'hard-drive', h('div.mon__wait', h('div.spinner')));
      slot.appendChild(store);
      M.storage().then(s => {
        if (S.dead) return;
        clear(store);
        store.appendChild(h('div.mon__cardh', icon('hard-drive', { size: 13 }), h('b', { text: 'Storage' })));
        if (!s) {
          store.appendChild(missing('Not reported here', 'navigator.storage.estimate is unavailable.'));
          return;
        }
        store.append(
          ring(s.pct, 'used', `${M.formatBytes(s.used)} of ${M.formatBytes(s.quota)}`),
          row('Persisted', s.persisted ? 'yes — the browser will not evict it' : 'no — may be evicted under pressure'),
          ...(s.detail ? Object.entries(s.detail).map(([k, v]) => row(k, M.formatBytes(v))) : []),
          h('small.dim', { text: 'What this origin is using, and the ceiling the browser has set for it.' }));
      });
    }

    function network() {
      const n = M.network();
      const t = M.timing();
      const c = M.connection();
      const grid = h('div.mon__grid');
      body.append(grid);

      grid.appendChild(n
        ? card('Transferred', 'download',
            h('div.mon__big', { text: M.formatBytes(n.transferred) }),
            row('Requests', String(n.requests)),
            row('Decoded', M.formatBytes(n.decoded)),
            row('Served from cache', `${n.cached} request${n.cached === 1 ? '' : 's'}`),
            row('Saved by compression', M.formatBytes(n.saved)),
            h('div.mon__bars', n.byType.slice(0, 6).map(([k, v]) => {
              const w = n.transferred ? (v / n.transferred) * 100 : 0;
              return h('div.mon__bar',
                h('span', { text: k }),
                h('i', h('u', { style: { width: `${w.toFixed(1)}%` } })),
                h('b', { text: M.formatBytes(v) }));
            })),
            h('small.dim', { text: 'Everything this page has downloaded, from the browser’s own '
              + 'Resource Timing buffer.' }))
        : card('Transferred', 'download', missing('Not reported here', 'Resource Timing is unavailable.')));

      grid.appendChild(t
        ? card('This page loaded in', 'clock',
            h('div.mon__big', { text: ms(t.total) }),
            row('DNS', ms(t.dns)), row('Connect', ms(t.connect)),
            row('Time to first byte', ms(t.ttfb)), row('Download', ms(t.download)),
            row('DOM ready', ms(t.dom)),
            h('small.dim', { text: `Navigation type: ${t.type}.` }))
        : card('This page loaded in', 'clock', missing('Not reported here', 'Navigation Timing is unavailable.')));

      grid.appendChild(c
        ? card('Connection', 'wifi',
            row('Class', c.type || 'unknown'),
            row('Downlink estimate', c.downlink ? `${c.downlink} Mb/s` : 'unknown'),
            row('Round trip estimate', c.rtt ? `${c.rtt} ms` : 'unknown'),
            row('Data saver', c.saveData ? 'on' : 'off'),
            h('small.dim', { text: 'The browser’s own coarse estimate. It is deliberately rounded '
              + 'and is not a speed test.' }))
        : card('Connection', 'wifi', missing('Not reported here',
            'navigator.connection is not exposed by this browser.')));
    }

    function windows() {
      R.winTable = h('div.mon__procs.mon__procs--act');
      body.append(card('Open windows', 'maximize',
        R.winTable,
        h('small.dim', { text: 'Static’s own windows — the only process table here that is real. '
          + 'A page cannot see anything running outside it.' })));
      paintWindows();
    }

    const stateOf = w => (w.min ? 'minimised' : w === api.wm.getActive() ? 'focused' : 'open');
    const STATE_RANK = { focused: 0, open: 1, minimised: 2 };
    const winRows = () => api.wm.list().map(w => ({
      w, id: w.id, app: w.app?.name || w.appId, appId: w.appId,
      title: w.el?.getAttribute('aria-label') || '', width: w.w, height: w.h, state: stateOf(w),
    }));
    const SORTS = {
      app: (a, b) => a.app.localeCompare(b.app),
      title: (a, b) => a.title.localeCompare(b.title),
      size: (a, b) => a.width * a.height - b.width * b.height,
      state: (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state],
    };

    function paintWindows(force = true) {
      if (!R.winTable || !body.contains(R.winTable)) return;
      const rows = winRows();
      /* the table is only rebuilt when something in it changed: a row's buttons
         must not be swapped out from under a click every second */
      const sig = `${S.sort.key}${S.sort.dir}|${rows.map(r => `${r.id}:${r.app}:${r.title}:${r.width}x${r.height}:${r.state}`).join('|')}`;
      if (!force && sig === R.winSig) return;
      R.winSig = sig;
      clear(R.winTable);
      if (!rows.length) {
        R.winTable.appendChild(h('div.empty', icon('maximize'),
          h('b', { text: 'No windows open' }),
          h('small', { text: 'Open an app and it will appear here.' })));
        return;
      }
      const head = (key, label) => {
        const on = S.sort.key === key;
        return h('span', { role: 'columnheader', 'aria-sort': on ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
          h('button.mon__sort', {
            type: 'button', class: on ? 'is-on' : '', dataset: { sort: key },
            onclick: () => { S.sort = { key, dir: on ? -S.sort.dir : 1 }; paintWindows(); },
          }, label, on ? h('i', { text: S.sort.dir > 0 ? '▲' : '▼', 'aria-hidden': 'true' }) : null));
      };
      R.winTable.appendChild(h('div.mon__prochead', { role: 'row' },
        head('app', 'App'), head('title', 'Title'), head('size', 'Size'), head('state', 'State'),
        h('span', { text: '' })));
      rows.sort((a, b) => S.sort.dir * (SORTS[S.sort.key](a, b) || a.id - b.id));
      for (const r of rows) {
        const self = r.w === ctx.win;
        R.winTable.appendChild(h('div.mon__proc', { role: 'row', dataset: { win: String(r.id) } },
          h('b', { text: r.app }),
          h('span', { text: r.title || '—' }),
          h('span', { text: `${r.width}×${r.height}` }),
          h('span', { text: r.state }),
          h('span.mon__acts',
            h('button.btn.btn--sm.btn--ghost.mon__min', {
              type: 'button', disabled: self && !r.w.min,
              title: r.w.min ? 'Bring it back' : 'Minimise it',
              'aria-label': `${r.w.min ? 'Restore' : 'Minimise'} ${r.app}`,
              onclick: () => { if (r.w.min) api.wm.restore(r.w); else api.wm.minimize(r.w); paintWindows(); },
            }, r.w.min ? 'Restore' : 'Minimise'),
            h('button.btn.btn--sm.btn--ghost.mon__close', {
              type: 'button', disabled: self, title: self ? 'This is System Monitor' : 'Close it',
              'aria-label': `Close ${r.app}`,
              onclick: () => { api.wm.close(r.id); setTimeout(paintWindows, 60); },
            }, 'Close'))));
      }
    }

    function device() {
      const hw = M.hardware();
      const grid = h('div.mon__grid');
      body.append(grid);

      grid.appendChild(card('This machine', 'cpu',
        row('Logical cores', hw.cores ? String(hw.cores) : 'not reported'),
        row('Device memory', hw.memoryGB ? `${hw.memoryGB} GB (rounded by the browser)` : 'not reported'),
        row('Platform', hw.platform),
        row('Browser', hw.browser),
        row('Form factor', hw.mobile ? 'mobile' : 'desktop'),
        h('small.dim', { text: 'Browsers round these on purpose, to make fingerprinting harder. '
          + 'They are the real values, just coarse ones.' })));

      grid.appendChild(card('Display', 'monitor',
        row('Screen', hw.screen),
        row('Static window', hw.viewport),
        row('Pixel ratio', String(hw.dpr)),
        row('Colour scheme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
        row('Reduced motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'requested' : 'not requested')));

      const batt = card('Battery', 'battery', h('div.mon__wait', h('div.spinner')));
      grid.appendChild(batt);
      M.battery().then(b => {
        if (S.dead) return;
        clear(batt);
        batt.appendChild(h('div.mon__cardh', icon('battery', { size: 13 }), h('b', { text: 'Battery' })));
        if (!b) {
          batt.appendChild(missing('Not reported here',
            'Most browsers no longer expose battery state to pages, for privacy.'));
          return;
        }
        batt.append(
          ring(b.level, 'charge', b.charging ? 'charging' : 'on battery'),
          b.timeToEmpty ? row('Time remaining', ms(b.timeToEmpty * 1000)) : null,
          b.timeToFull ? row('Until full', ms(b.timeToFull * 1000)) : null,
          batteryTips(b));
      });
    }

    /* Tips only where the browser reports a battery, and only when it is low and
       not charging. Every button does what it says; brightness is a thing a page
       cannot change, so that tip is only words. */
    function batteryTips(b) {
      if (!b || b.charging || b.level > LOW_BATTERY) return null;
      const prefs = api.store.get('prefs', {}) || {};
      const winN = api.wm.list().length;
      const tip = (text, label, run) => h('li.mon__tip', h('span', { text }),
        label ? h('button.btn.btn--sm', { type: 'button', onclick: () => { run(); if (S.tab === 'device') paint(); } }, label) : null);
      const list = h('ul.mon__tips', { 'aria-label': 'Ways to save battery' },
        prefs.gameMode ? null : tip('Game Mode stops blur, shadows and shell animations, so the processor does less work.', 'Turn on Game Mode', () => api.store.set('prefs.gameMode', true)),
        prefs.reduceMotion ? null : tip('Reduce motion stops the animations that are left.', 'Reduce motion', () => api.store.set('prefs.reduceMotion', true)),
        winN > 3 ? tip(`${winN} windows are open. Closing the ones you are not using saves power.`, 'See windows', () => { S.tab = 'windows'; paintTabs(); }) : null,
        tip('Turn down your screen brightness. A web page cannot change it for you.'));
      return h('div.mon__tipswrap', h('b', { text: `Battery is at ${b.level}% — a few ways to make it last` }), list);
    }

    /* ---------- slow right now ---------- */
    /* Three readings in a row under SLOW_FPS shows the hint; three in a row at
       or over it clears it. 0 is a tab that was in the background, not a slow
       desktop, so it counts for neither. */
    function watchSlow(snap) {
      if (S.paused || !snap || !snap.fps) return;
      if (snap.fps < SLOW_FPS) { S.slow++; S.fine = 0; } else { S.fine++; S.slow = 0; }
      if (S.slow >= 3) paintSlow(snap.fps);
      else if (S.fine >= 3) paintSlow(null);
    }
    function paintSlow(fps) {
      if (!R.slow) return;
      if (fps === null) { R.slow.hidden = true; clear(R.slow); return; }
      const on = !!api.store.get('prefs.gameMode', false);
      const was = R.slow.hidden;
      R.slow.hidden = false;
      if (!was && R.slow.dataset.on === String(on)) {
        R.slow.querySelector('.mon__slowfps').textContent = `${fps} fps`;
        return;
      }
      R.slow.dataset.on = String(on);
      clear(R.slow);
      R.slow.append(icon('alert', { size: 14 }),
        h('div.mon__slowt',
          h('b', { text: 'Slow right now' }),
          h('small', {}, 'Frames are arriving at ', h('b.mon__slowfps', { text: `${fps} fps` }), '. ',
            on ? 'Game Mode is already on, so the shell is not spending frames on decoration.'
              : 'Game Mode stops blur, shadows and shell animations so the frames go to what you are doing.')),
        on ? null : h('button.btn.btn--sm.btn--primary.mon__gm', { type: 'button',
          onclick: () => { api.store.set('prefs.gameMode', true); paintSlow(fps); } }, 'Turn on Game Mode'),
        h('button.btn.btn--sm.mon__gmset', { type: 'button', onclick: () => api.openApp('settings', { section: 'performance' }) }, 'Game Mode settings'));
    }

    /* ---------- long tasks ---------- */
    function paintLongTasks() {
      if (!R.ltSlot || !body.contains(R.ltSlot)) return;
      const lt = M.longTasks();
      clear(R.ltSlot);
      if (!lt) {
        R.ltSlot.append(missing('Not reported here', 'Only Chromium-based browsers report long tasks to a page.'));
        return;
      }
      R.ltSlot.append(h('div.mon__big', { text: String(lt.count) }),
        row('In the last minute', String(lt.lastMinute)),
        row('Longest', ms(lt.worstMs)),
        row('Time blocked in all', ms(lt.totalMs)));
    }

    /* ---------- record 60 seconds ---------- */
    function recStart() {
      REC.state = 'run'; REC.rows = []; REC.t0 = 0; REC.lastAt = 0; REC.prevReq = null; REC.file = '';
      paintRec();
    }
    function recTick(snap) {
      if (REC.state !== 'run' || !snap) return;
      if (!REC.t0) REC.t0 = snap.at;
      else if (snap.at <= REC.lastAt) return;             /* the same reading twice: one row */
      REC.lastAt = snap.at;
      /* the time each reading was really taken, to a tenth: a busy page reads
         late now and then, and whole seconds would give two rows the same one */
      const second = Math.round((snap.at - REC.t0) / 100) / 10;
      const net = snap.network;
      const lt = M.longTasks();
      REC.rows.push([
        second,
        snap.fps,
        snap.heap ? snap.heap.used : '',
        snap.heap ? snap.heap.pct : '',
        net ? net.requests : '',
        net && REC.prevReq !== null ? Math.max(0, net.requests - REC.prevReq) : '',
        net ? net.transferred : '',
        lt ? lt.count : '',
        snap.windows ? snap.windows.count : '',
      ]);
      if (net) REC.prevReq = net.requests;
      if (second >= REC_SECONDS - 1) recStop();
      else paintRec();
    }
    function recStop() {
      if (REC.state !== 'run') return;
      REC.state = REC.rows.length ? 'done' : 'idle';
      paintRec();
    }
    const recCsv = () => `${CSV_COLS.join(',')}\n${REC.rows.map(r => r.join(',')).join('\n')}\n`;
    function recSave() {
      const path = `/home/static/Documents/StaticOS-monitor-${stamp()}.csv`;
      try { api.vfs.write(path, recCsv()); REC.file = path; }
      catch (err) { api.notify({ app: 'System Monitor', icon: 'alert', title: 'Could not save', message: String(err?.message || err) }); return; }
      api.notify({ app: 'System Monitor', icon: 'check', title: 'Recording saved', message: path.replace('/home/static/', '~/'),
        actions: [{ label: 'Show in Files', onClick: () => api.openApp('files', { path: '/home/static/Documents' }) }] });
      paintRec();
    }
    function recDownload() { SI.downloadText(`StaticOS-monitor-${stamp()}.csv`, recCsv(), 'text/csv'); }
    function paintRec() {
      if (!R.recSlot || !body.contains(R.recSlot)) return;
      clear(R.recSlot);
      if (REC.state === 'idle') {
        R.recSlot.append(h('button.btn.btn--sm.mon__rec', { type: 'button', onclick: recStart }, icon('play', { size: 12 }), 'Record'),
          h('small.dim', { text: 'Writes the frame rate, JS heap, requests and long tasks, once a second for a minute, to a CSV. '
            + 'Anything the browser does not report is left empty.' }));
      } else if (REC.state === 'run') {
        const sec = REC.rows.length ? REC.rows[REC.rows.length - 1][0] + 1 : 0;
        R.recSlot.append(h('div.mon__big', { text: `${sec} / ${REC_SECONDS} s` }),
          h('div.mon__recbar', h('i', { style: { width: `${(sec / REC_SECONDS) * 100}%` } })),
          h('button.btn.btn--sm.mon__recstop', { type: 'button', onclick: recStop }, 'Stop and keep what there is'));
      } else {
        R.recSlot.append(h('div.mon__big', { text: `${REC.rows.length} reading${REC.rows.length === 1 ? '' : 's'}` }),
          REC.file ? h('small.dim', { text: `Saved to ${REC.file.replace('/home/static/', '~/')}` }) : null,
          h('div.mon__recacts',
            h('button.btn.btn--sm.btn--primary.mon__recsave', { type: 'button', onclick: recSave }, 'Save to Files'),
            h('button.btn.btn--sm.mon__recdl', { type: 'button', onclick: recDownload }, 'Download'),
            h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { REC.state = 'idle'; REC.rows = []; paintRec(); } }, 'Discard')));
      }
    }

    /* ---------- the live pass ---------- */

    function live(snap) {
      if (!snap) return;
      if (R.fpsRing && body.contains(R.fpsRing)) {
        const v = Math.min(100, (snap.fps / 60) * 100);
        const C = 2 * Math.PI * 26;
        const fg = R.fpsRing.querySelector('.mon__ringfg');
        if (fg) fg.style.strokeDashoffset = String(C * (1 - v / 100));
        const b = R.fpsRing.querySelector('b');
        if (b) b.textContent = String(snap.fps);
        const sub = R.fpsRing.querySelector('.mon__ringsub');
        if (sub) sub.textContent = snap.fps >= 55 ? 'smooth' : snap.fps >= 30 ? 'usable' : 'struggling';
      }
      if (R.fpsSpark && body.contains(R.fpsSpark)) {
        clear(R.fpsSpark);
        R.fpsSpark.appendChild(spark(hist().fps, { max: 70 }));
      }
      if (R.heapSlot && body.contains(R.heapSlot) && snap.heap) {
        clear(R.heapSlot);
        R.heapSlot.append(
          ring(snap.heap.pct, 'used', `${M.formatBytes(snap.heap.used)} of ${M.formatBytes(snap.heap.limit)}`),
          h('div.mon__sparkwrap', spark(hist().heap, { max: 100 })));
      }
      if (R.winSlot && body.contains(R.winSlot)) {
        clear(R.winSlot);
        const w = snap.windows;
        R.winSlot.append(
          h('div.mon__big', { text: String(w.count) }),
          h('div.mon__chips', w.apps.slice(0, 8).map(a =>
            h('span.chip', { text: a.app }))));
      }
      paintLongTasks();
      if (R.winTable && body.contains(R.winTable)) paintWindows(false);
    }

    /* Mounted last, deliberately: paint() reaches for card(), row() and the
       other const helpers below, and a const is in its temporal dead zone
       until the line that declares it runs. Calling paint() any earlier
       throws before a single pixel lands. */
    /* Pause holds the live gauges so a figure can be read. It freezes what the
       Overview shows (and its sparklines); the table of windows still follows
       what you do to it, and a recording carries on underneath. */
    const pauseLabel = h('span', { text: 'Pause' });
    const pauseIc = h('span.mon__pauseic', icon('pause', { size: 12 }));
    const pauseBtn = h('button.btn.btn--sm.mon__pause', {
      type: 'button', 'aria-pressed': 'false', title: 'Hold the live figures still',
      onclick: () => {
        S.paused = !S.paused;
        pauseBtn.setAttribute('aria-pressed', String(S.paused));
        pauseBtn.classList.toggle('is-on', S.paused);
        pauseLabel.textContent = S.paused ? 'Resume' : 'Pause';
        clear(pauseIc); pauseIc.append(icon(S.paused ? 'play' : 'pause', { size: 12 }));
        S.frozen = S.paused ? M.snapshot() : null;
        S.frozenHist = S.paused ? M.history() : null;
        heldNote.hidden = !S.paused;
        if (!S.paused) { S.slow = 0; S.fine = 0; paint(); }
      },
    }, pauseIc, pauseLabel);
    const heldNote = h('span.mon__held', { role: 'status', hidden: true, text: 'Paused — the figures are held' });
    R.slow = h('div.mon__slow', { role: 'status', hidden: true });

    render(root, h('div.mon',
      h('div.mon__head', tabs, h('div.mon__ctl', heldNote, pauseBtn)),
      R.slow, body));
    paintTabs();
    paint();
    return teardown;
  },
});
