/* ============================================================
   partybar.js — the party pill beside the Dock.

   While you're in a Static Party (js/portal/party.js) a small pill
   sits bottom-left: the people in it as coloured initials, the
   live channel's state as a dot, the party code, how many people
   are in it and how many of them are ready. Clicking it brings the
   Party window up (or tucks it away again, like a Dock icon). It
   is hidden whenever you're not in a party, and it only ever shows
   what the party module has actually heard.

   Placement mirrors the account button on the right: at Dock
   height and on the Dock's layer, so it never covers a window
   (windows stop above the Dock) or the centred desktop clock. If
   the Dock is wide enough to reach it, the pill steps up to sit
   just above the Dock line instead (.is-raised). On a phone it
   sits above the bottom nav on the home grid and stays out of the
   way of full-screen app sheets (css/feat-party.css).

     mountPartyBar(host) -> teardown
   ============================================================ */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { getApp } from '../core/registry.js';
import * as wm from '../core/wm.js';
import * as party from '../portal/party.js';
import * as live from '../portal/live.js';

const FACES = 3;
const LIVE_WORD = { idle: 'Offline', connecting: 'Connecting…', offline: 'Offline' };

function ensureStyles() {
  if (document.getElementById('feat-party-css')) return;
  document.head.appendChild(h('link', { id: 'feat-party-css', rel: 'stylesheet', href: 'css/feat-party.css' }));
}

const initial = name => (String(name || '').trim().match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function mountPartyBar(host) {
  if (typeof document === 'undefined') return () => {};
  ensureStyles();

  const faces = h('span.ptb__faces', { 'aria-hidden': 'true' });
  const dot = h('i.ptb__dot', { 'aria-hidden': 'true' });
  const code = h('span.ptb__code');
  const people = h('span.ptb__n');
  const ready = h('span.ptb__n');
  const el = h('button.ptb', { type: 'button', hidden: true, onclick: openParty },
    faces, dot, code, h('i.ptb__sep', { 'aria-hidden': 'true' }), people, ready);
  (host || document.body).appendChild(el);

  let sig = null;
  let dockEl = null;
  let ro = null;

  async function openParty() {
    if (!getApp('party')) {
      /* the app registers itself on import, so the pill works even if
         the app list hasn't loaded it yet */
      try { await import('../apps/party.js'); } catch (e) { console.warn('[partybar] Static Party failed to load', e); return; }
    }
    if (typeof wm.toggleApp === 'function') wm.toggleApp('party');
    else wm.open('party');
  }

  function paint() {
    const cur = party.current();
    if (!cur) {
      el.hidden = true;
      sig = null;
      return;
    }
    const st = live.status();
    const nonHost = cur.members.filter(m => !m.isHost);
    const readyN = nonHost.filter(m => m.ready).length;
    const shown = cur.members.slice(0, FACES);
    const next = [cur.code, st, cur.members.length, readyN, nonHost.length,
      shown.map(m => `${m.id}:${m.name}:${m.color}`).join(',')].join('|');
    el.hidden = false;
    if (next === sig) return;
    sig = next;

    el.dataset.s = st;
    code.textContent = cur.code;

    clear(faces);
    for (const m of shown) {
      faces.append(h('span.pt-av', { style: { '--h': String(Number(m.color) || 0) } }, h('span.pt-av__i', { text: initial(m.name) })));
    }
    if (cur.members.length > FACES) faces.append(h('span.ptb__plus', { text: `+${cur.members.length - FACES}` }));

    clear(people);
    people.append(icon('users'), h('span', { text: String(cur.members.length) }));

    clear(ready);
    ready.className = 'ptb__n';
    if (st !== 'live') {
      ready.classList.add('is-off');
      ready.append(h('span', { text: LIVE_WORD[st] || 'Offline' }));
      ready.hidden = false;
    } else if (nonHost.length) {
      ready.classList.toggle('is-ready', readyN > 0);
      ready.append(icon('check'), h('span', { text: `${readyN} ready` }));
      ready.hidden = false;
    } else {
      ready.hidden = true;
    }

    const who = plural(cur.members.length, 'person', 'people');
    const readyTxt = nonHost.length ? `, ${readyN} of ${nonHost.length} ready` : ', just you so far';
    const chan = st === 'live' ? '' : st === 'connecting' ? ' Connecting to the live channel.' : ' The live channel is offline.';
    const label = `Static Party ${cur.code}: ${who}${readyTxt}.${chan} Open Static Party.`;
    el.setAttribute('aria-label', label);
    el.title = label;
    measure();
  }

  /* step up above the Dock line only when the Dock would reach the pill */
  function measure() {
    if (el.hidden) return;
    if (!dockEl || !dockEl.isConnected) watchDock();
    let raise = false;
    if (dockEl && !document.body.classList.contains('is-mobile')) {
      const d = dockEl.getBoundingClientRect();
      if (d.width > 0 && d.height > 0) {
        const r = el.getBoundingClientRect();
        raise = r.right + 12 > d.left && r.left < d.right;
      }
    }
    el.classList.toggle('is-raised', raise);
  }

  function watchDock() {
    ro?.disconnect();
    ro = null;
    dockEl = document.querySelector('.dock');
    if (dockEl && typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => measure());
      ro.observe(dockEl);
    }
  }

  const onResize = () => measure();
  window.addEventListener('resize', onResize);
  const offs = [party.onChange(paint), live.onStatus(paint)];
  watchDock();
  paint();

  return () => {
    offs.forEach(off => { try { off(); } catch (e) { /* already gone */ } });
    window.removeEventListener('resize', onResize);
    ro?.disconnect();
    ro = null;
    el.remove();
  };
}

export default mountPartyBar;
