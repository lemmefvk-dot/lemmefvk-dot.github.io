/* ============================================================
   mediasleep.js — one sleep timer for the OS player: songs (Music)
   and stations (Music's Radio tab and Static Radio) alike.

   When it runs out the sound fades over the last seconds and then
   everything stops with media:pause, the same event the media keys
   send. It lives in memory and counts wall-clock time, so a timer can't
   be stretched by a busy tab; it does not survive closing StaticOS (an
   alarm can't wake a closed tab, and neither can a timer). Ambient
   sounds have their own timer (core/ambient.js).

     set(minutes)         start (or restart) — any minutes > 0
     setAfterSong()       "stop when this song ends" (songs only)
     clear()
     state() -> null | { minutes, endsAt, left, fading, afterSong }
     fade()  -> 1…0   what the players multiply their volume by
     takeAfterSong() -> true once, when a song just ended with
                        "after this song" waiting: the player stops
   bus: 'mediasleep:change' (started, changed, cleared, fired),
        'mediasleep:fade'   (the level moved; players re-apply volume)
   ============================================================ */
import { bus } from './bus.js';

export const CHOICES = [15, 30, 45, 60, 90];
const FADE_MAX = 20;                     /* seconds of fade at most */
let T = null;                            /* { minutes, endsAt, total, afterSong } */
let level = 1;
let iv = 0;

const set1 = v => { if (v !== level) { level = v; bus.emit('mediasleep:fade', v); } };
export const fade = () => level;

function tick() {
  if (!T) return;
  if (T.afterSong) return;
  const left = T.endsAt - Date.now();
  if (left <= 0) { fire(); return; }
  const f = Math.min(FADE_MAX * 1000, T.total * 0.25);
  set1(left < f ? Math.max(0, left / f) : 1);
}
function stopTick() { if (iv) { clearInterval(iv); iv = 0; } }
function start() { stopTick(); iv = setInterval(tick, 250); }

function fire() {
  stopTick();
  T = null;
  bus.emit('media:pause');
  bus.emit('mediasleep:change', 'fired');
  /* back to full level a moment later, so the next thing played isn't silent */
  setTimeout(() => set1(1), 600);
}

export function set(minutes) {
  const m = Number(minutes);
  if (!(m > 0)) { clear(); return; }
  const total = m * 60000;
  T = { minutes: m, endsAt: Date.now() + total, total, afterSong: false };
  set1(1);
  start();
  bus.emit('mediasleep:change', 'set');
}
export function setAfterSong() {
  T = { minutes: 0, endsAt: 0, total: 0, afterSong: true };
  set1(1);
  stopTick();
  bus.emit('mediasleep:change', 'set');
}
export function clear() {
  const had = !!T;
  T = null;
  stopTick();
  set1(1);
  if (had) bus.emit('mediasleep:change', 'cleared');
}
export function state() {
  if (!T) return null;
  const left = T.afterSong ? 0 : Math.max(0, T.endsAt - Date.now());
  return { minutes: T.minutes, endsAt: T.endsAt, left, fading: !T.afterSong && level < 1, afterSong: T.afterSong };
}
export function takeAfterSong() {
  if (!T || !T.afterSong) return false;
  T = null;
  bus.emit('mediasleep:change', 'fired');
  return true;
}

export default { set, setAfterSong, clear, state, fade, takeAfterSong, CHOICES };
