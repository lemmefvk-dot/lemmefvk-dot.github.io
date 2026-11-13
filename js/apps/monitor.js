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
   ============================================================ */

import { defineApp } from '../core/registry.js';
import * as M from '../core/metrics.js';

const TABS = [
  ['overview', 'Overview', 'activity'],
  ['memory', 'Memory', 'layers'],
  ['network', 'Network', 'wifi'],
  ['windows', 'Windows', 'maximize'],
  ['device', 'Device', 'cpu'],
];

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

    const S = { tab: api.store.get('portal.monitor.tab', 'overview'), dead: false };
    const R = {};

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
    const off = api.bus?.on?.('metrics:tick', snap => { if (!S.dead) live(snap); });
    /* and each window animation reports its own frames as it finishes */
    const offAnim = api.bus?.on?.('metrics:transition', () => { if (!S.dead) paintAnims(); });

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
      const hist = M.history();
      R.fpsRing = ring(0, 'FPS', '');
      R.fpsSpark = h('div.mon__sparkwrap', spark(hist.fps, { max: 70 }));
      R.heapSlot = h('div');
      R.winSlot = h('div');
      R.animSlot = h('div');

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
          card('Window animations', 'layers', R.animSlot,
            h('small.dim', { text: 'Every open, close, snap and desktop switch is timed frame by frame as it plays. '
              + 'A dropped frame is a screen refresh it missed.' })),
          card('Cannot be measured', 'shield',
            h('div.mon__cant', M.unavailable().map(([what, why]) =>
              h('div.mon__cantrow', h('b', { text: what }), h('small', { text: why })))))),
      );
      live(M.snapshot());
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
      R.winTable = h('div.mon__procs');
      body.append(card('Open windows', 'maximize',
        R.winTable,
        h('small.dim', { text: 'Static’s own windows — the only process table here that is real. '
          + 'A page cannot see anything running outside it.' })));
      paintWindows(M.windows());
    }

    function paintWindows(w) {
      if (!R.winTable) return;
      clear(R.winTable);
      if (!w || !w.count) {
        R.winTable.appendChild(h('div.empty', icon('maximize'),
          h('b', { text: 'No windows open' }),
          h('small', { text: 'Open an app and it will appear here.' })));
        return;
      }
      R.winTable.appendChild(h('div.mon__prochead',
        h('span', { text: 'App' }), h('span', { text: 'Title' }),
        h('span', { text: 'Size' }), h('span', { text: 'State' })));
      for (const a of w.apps) {
        R.winTable.appendChild(h('div.mon__proc',
          h('b', { text: a.app }),
          h('span', { text: a.title || '—' }),
          h('span', { text: `${a.w}×${a.h}` }),
          h('span', { text: a.minimised ? 'minimised' : a.focused ? 'focused' : 'open' })));
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
          b.timeToFull ? row('Until full', ms(b.timeToFull * 1000)) : null);
      });
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
        R.fpsSpark.appendChild(spark(M.history().fps, { max: 70 }));
      }
      if (R.heapSlot && body.contains(R.heapSlot) && snap.heap) {
        clear(R.heapSlot);
        R.heapSlot.append(
          ring(snap.heap.pct, 'used', `${M.formatBytes(snap.heap.used)} of ${M.formatBytes(snap.heap.limit)}`),
          h('div.mon__sparkwrap', spark(M.history().heap, { max: 100 })));
      }
      if (R.winSlot && body.contains(R.winSlot)) {
        clear(R.winSlot);
        const w = snap.windows;
        R.winSlot.append(
          h('div.mon__big', { text: String(w.count) }),
          h('div.mon__chips', w.apps.slice(0, 8).map(a =>
            h('span.chip', { text: a.app }))));
      }
      if (R.winTable && body.contains(R.winTable)) paintWindows(snap.windows);
    }

    /* Mounted last, deliberately: paint() reaches for card(), row() and the
       other const helpers below, and a const is in its temporal dead zone
       until the line that declares it runs. Calling paint() any earlier
       throws before a single pixel lands. */
    render(root, h('div.mon', tabs, body));
    paintTabs();
    paint();
    return teardown;
  },
});
