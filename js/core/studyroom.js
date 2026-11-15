/* ============================================================
   studyroom.js — Study together: one focus timer, two people.

   A private pair.js room (kind 'study', see js/core/pair.js) between
   you and ONE friend. Friends sends the room's code as a notice with
   Join; nothing joins by itself.

   Each device keeps its own timer (js/core/focus.js, Clock › Focus),
   so it still counts correctly with this window closed and still
   writes your focus history. The room only keeps the two in step:
     go { w }  "Start together": the other side starts a focus session
               on the same name, unless one is already running
     pz        "Pause together": the other side pauses
     st { ph, s, l, w }  where my timer is (phase, status, ms left,
               what it is on), sent whenever it changes, so each side
               sees the other's timer
   Following is a switch (on while you are in the room): turn it off
   and you only watch. Leave the room and nothing is followed. The
   other side's numbers come from the other side's own timer; if its
   updates stop (the room goes quiet) the display says so rather than
   counting on.

     host() -> code · join(code) -> bool · leave()
     current() -> { code, role, phase, error, peerName, theirs, follow } | null
     startTogether(what) · pauseTogether() · setFollow(on)
     onChange(fn) -> off
   ============================================================ */
import { openPair } from './pair.js';
import * as focus from './focus.js';
import { bus } from './bus.js';
import { cleanText, isCode, normalizeCode } from './roomcode.js';

export const KIND = 'study';
const PHASES = ['focus', 'short', 'long'];
const STATUSES = ['ready', 'running', 'paused'];
const MAX_LEFT = 3 * 3600_000;
export const TYPES = {
  st: m => (PHASES.includes(m.ph) && STATUSES.includes(m.s) && Number.isFinite(m.l) && m.l >= 0 && m.l <= MAX_LEFT
    ? { ph: m.ph, s: m.s, l: Math.round(m.l), w: cleanText(m.w, 80) } : null),
  go: m => ({ w: cleanText(m.w, 80) }),
  pz: () => ({}),
};

let S = null;
const subs = new Set();
const emit = () => subs.forEach(fn => { try { fn(); } catch (e) { console.error('[studyroom]', e); } });
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }

function sendState(s) {
  if (s.ended || s.room.phase !== 'paired') return;
  const st = focus.state();
  s.room.send('st', { ph: st.phase, s: st.status, l: Math.round(st.left), w: st.what || '' });
}

function begin(role, code) {
  leave();
  const room = openPair({ kind: KIND, role, code, types: TYPES, rtc: false });
  const s = { room, role, theirs: null, follow: true, offs: [], ended: false };
  S = s;
  s.offs.push(
    bus.on('focus:change', () => sendState(s)),
    room.on((type, data) => {
      if (s.ended) return;
      if (type === 'phase' && data === 'paired') sendState(s);
      else if (type === 'peer') sendState(s);
      else if (type === 'left') s.theirs = null;
      else if (type === 'msg') onMsg(s, data.t, data.m);
      emit();
    }));
  emit();
  return room;
}

function onMsg(s, t, m) {
  if (t === 'st') { s.theirs = { phase: m.ph, status: m.s, left: m.l, what: m.w, at: Date.now() }; return; }
  if (!s.follow) return;
  const st = focus.state();
  if (t === 'go') { if (!(st.status === 'running' && st.phase === 'focus')) focus.startOn(m.w); }
  else if (t === 'pz') { if (st.status === 'running') focus.pause(); }
}

export function host() { return begin('host', null).code; }
export function join(input) {
  const code = normalizeCode(input);
  if (!isCode(code)) return false;
  begin('guest', code);
  return true;
}
export function leave() {
  const s = S;
  if (!s) return;
  S = null;
  s.ended = true;
  s.offs.forEach(off => { try { off(); } catch (e) { /* gone */ } });
  try { s.room.leave(); } catch (e) { /* gone */ }
  emit();
}

export function current() {
  if (!S) return null;
  const r = S.room;
  return { code: r.code, role: S.role, phase: r.phase, error: r.error, peerName: r.peer ? r.peer.name : null, theirs: S.theirs ? { ...S.theirs } : null, follow: S.follow };
}
export function startTogether(what = '') {
  focus.startOn(what);
  if (S && S.room.phase === 'paired') S.room.send('go', { w: cleanText(what, 80) });
}
export function pauseTogether() {
  focus.pause();
  if (S && S.room.phase === 'paired') S.room.send('pz', {});
}
export function setFollow(on) { if (S) { S.follow = !!on; emit(); } }

export default { host, join, leave, current, startTogether, pauseTogether, setFollow, onChange, TYPES, KIND };
