/* ============================================================
   gamemode.js — Game Mode that actually does something.

   On: the shell stops spending frames on decoration so a game gets
   them instead — backdrop blur, big shadows, shell animations and
   transitions, the wallpaper video, pointer parallax, the big desktop
   clock and the widgets' per-second updates all stand down
   (html[data-gamemode="on"], css/feat-gamemode.css). Nothing here
   pretends to touch hardware: a web page cannot change CPU clocks or
   fans, so it doesn't claim to.

   prefs.gameMode      on/off by hand
   prefs.gameModeAuto  also turn it on while a game window is in front
                       (Static Games, Arcade, Play, Forge, Studio,
                       Cloud, Roblox), and off again when it isn't
   Emits bus 'gamemode:change' { on, auto }.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const GAME_APPS = new Set(['aether-games', 'arcade', 'play', 'forge', 'studio', 'aether-cloud', 'aether-roblox']);

let autoOn = false;
let last = null;

export const isOn = () => document.documentElement.dataset.gamemode === 'on';

function apply() {
  const on = !!store.get('prefs.gameMode') || autoOn;
  if (on === last) return;
  last = on;
  document.documentElement.dataset.gamemode = on ? 'on' : 'off';
  /* the wallpaper video is the single most expensive decoration */
  for (const v of document.querySelectorAll('.wp__video')) {
    try { on ? v.pause() : v.play()?.catch?.(() => {}); } catch (e) {}
  }
  bus.emit('gamemode:change', { on, auto: autoOn && !store.get('prefs.gameMode') });
}

export function init() {
  if (typeof document === 'undefined') return;
  store.sub('prefs.gameMode', apply);
  store.sub('prefs', apply);
  bus.on('win:focus', w => {
    const want = !!store.get('prefs.gameModeAuto') && !!w && GAME_APPS.has(w.appId);
    if (want !== autoOn) { autoOn = want; apply(); }
  });
  /* a wallpaper repainted while on must come up paused */
  bus.on('wallpaper:changed', () => requestAnimationFrame(() => { last = null; apply(); }));
  apply();
}

export default { init, isOn };
