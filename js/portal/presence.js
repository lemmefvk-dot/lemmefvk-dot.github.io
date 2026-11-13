/* ============================================================
   presence.js — who else is on StaticOS right now.

   Off until you turn it on (opening Social, Party or the Message
   Hub asks presence to start). While on, this device says "I'm
   here" on the live channel every 20 seconds, with its display
   name, status and — if you allow it (prefs.sharePlaying, default
   on) — the title of the game you most recently launched. Other
   devices doing the same appear in online(); anyone silent for a
   minute drops off. Nothing is stored anywhere but in memory.

   Everything here is real in the sense that each entry is a device
   that actually said hello in the last minute. It is NOT verified:
   names are whatever people typed.

     start()  ·  stop()  ·  running()
     online() -> [{ id, name, color, status, playing, seen }]
     onChange(fn) -> unsubscribe
   ============================================================ */
import * as live from './live.js';
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import { me, clean } from '../core/identity.js';

const TOPIC = 'presence';
const HEARTBEAT_MS = 20_000;
const EXPIRY_MS = 60_000;

const peers = new Map();
const subs = new Set();
let on = false;
let beatT = 0;
let pruneT = 0;
let unsub = null;
let offLaunch = null;
let playing = null;
let offClose = null;

/* the windows that actually play something */
const GAME_APPS = ['aether-games', 'arcade', 'forge', 'studio', 'play', 'aether-roblox', 'aether-cloud'];
const openAppIds = () => {
  try { return (wmRef ? wmRef.list() : []).map(w => w.appId); } catch (e) { return []; }
};
let wmRef = null;
import('../core/wm.js').then(m => { wmRef = m; }).catch(() => {});
let replyT = 0;

const emit = () => subs.forEach(fn => { try { fn(online()); } catch (e) {} });
const sharePlaying = () => store.get('prefs.sharePlaying') !== false;

function beat() {
  if (!on) return;
  const m = me();
  if (m.status === 'invisible') return;              /* invisible = say nothing */
  live.publish(TOPIC, JSON.stringify({
    id: m.id, name: m.name, color: m.color, status: m.status,
    playing: sharePlaying() ? playing : null, at: Date.now(),
  }));
}

function onMsg(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return; }
  const p = clean(raw);
  if (!p || p.id === me().id) return;
  if (raw.bye) { if (peers.delete(p.id)) emit(); return; }
  /* someone just arrived and asked who's here: answer soon (a little
     jitter so a busy channel doesn't reply all at once) */
  if (raw.q) { clearTimeout(replyT); replyT = setTimeout(beat, 150 + Math.random() * 600); }
  peers.set(p.id, { ...p, seen: Date.now() });
  emit();
}

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [id, p] of peers) if (now - p.seen > EXPIRY_MS) { peers.delete(id); changed = true; }
  if (changed) emit();
}

export function start() {
  if (on) return;
  on = true;
  unsub = live.subscribe(TOPIC, onMsg);
  /* announce and ask who's here, so the list fills in now instead of
     after everyone's next 20-second heartbeat */
  const hello = () => { const m = me(); if (m.status !== 'invisible') live.publish(TOPIC, JSON.stringify({ id: m.id, name: m.name, color: m.color, status: m.status, playing: sharePlaying() ? playing : null, q: 1, at: Date.now() })); };
  hello();
  /* the channel may still be connecting; ask again once it's live */
  const offS = live.onStatus(st => { if (st === 'live' && on) hello(); });
  setTimeout(offS, 15000);
  beatT = setInterval(beat, HEARTBEAT_MS);
  pruneT = setInterval(prune, 10_000);
  /* What you're playing comes from the launches StaticOS already records.
     It is cleared again when the window that was playing it closes —
     otherwise "playing" would really mean "launched at some point this
     session", and every app showing it would be overstating what this
     device actually knows. */
  offLaunch = bus.on('game:launch', e => {
    playing = e && e.title ? String(e.title).slice(0, 60) : null;
    beat();
  });
  offClose = bus.on('win:close', () => {
    if (!playing) return;
    /* still a game window open? then it is still being played */
    if (GAME_APPS.some(id => openAppIds().includes(id))) return;
    playing = null;
    beat();
  });
  window.addEventListener('pagehide', stop);
}

export function stop() {
  if (!on) return;
  const m = me();
  live.publish(TOPIC, JSON.stringify({ id: m.id, name: m.name, bye: true }));
  on = false;
  clearInterval(beatT); clearInterval(pruneT);
  unsub?.(); unsub = null;
  offLaunch?.(); offLaunch = null;
  offClose?.(); offClose = null;
  playing = null;
  peers.clear();
  emit();
}

export const running = () => on;
export const online = () => [...peers.values()].sort((a, b) => a.name.localeCompare(b.name));
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
export function nudge() { beat(); }

export default { start, stop, running, online, onChange, nudge };
