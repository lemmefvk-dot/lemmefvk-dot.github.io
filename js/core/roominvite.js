/* ============================================================
   roominvite.js — open a Static Arcade room and learn its code.

   Static Party (a room for the whole party) and Static Multiplayer
   ("Invite to this game") both need the same two steps: open the
   Arcade on an online game as the host, then wait for the room's
   code, which the Arcade announces on bus 'arcade:room' once the room
   exists (apps/arcade.js makeRoom). Sending the code to anyone is up
   to the caller: friends.sendRoomInvite for a friend, the party's own
   channel for a party. Nothing joins by itself on the other end.
   ============================================================ */
import * as wm from './wm.js';
import { bus } from './bus.js';
import { arcadeById } from '../arcade/index.js';
import { isCode } from './roomcode.js';

/** -> the six-character room code, or null (no such online game, or the Arcade didn't answer in time). */
export function openRoomCode(gameId, waitMs = 20_000) {
  const a = typeof gameId === 'string' ? arcadeById(gameId) : null;
  if (!a || !a.online) return Promise.resolve(null);
  return new Promise(res => {
    let off = null;
    const t = setTimeout(() => { off?.(); res(null); }, waitMs);
    off = bus.on('arcade:room', e => { if (e && e.game === a.id && isCode(e.code)) { clearTimeout(t); off?.(); res(e.code); } });
    try { wm.open('arcade', { game: a.id, online: true, host: true }); } catch (e) { clearTimeout(t); off?.(); res(null); }
  });
}
