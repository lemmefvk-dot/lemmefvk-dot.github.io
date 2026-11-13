/* ============================================================
   arcade/puzzlekit.js — what the DOM-based puzzle games share
   (Sudoku, Nonograms, Word Search): the page chrome's CSS, a
   saved-data helper, time formatting, and a listener bag that
   makes a clean teardown one line. Gem Swap draws on a canvas and
   uses kit.js instead.

   Saved data lives under portal.arcadePuzzles.<game> (the same
   persisted store the Arcade's own best scores use), so it is per
   device and survives a reload.
   ============================================================ */
import { store } from '../core/store.js';

const KEY = 'portal.arcadePuzzles';
export const load = game => {
  try { const v = store.get(KEY)?.[game]; return v && typeof v === 'object' ? v : {}; } catch (err) { return {}; }
};
export const save = (game, patch) => {
  try { store.set(KEY, { ...(store.get(KEY) || {}), [game]: { ...load(game), ...patch } }); } catch (err) { /* storage is a convenience */ }
};

export const fmtTime = s => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const reducedMotion = ctx => !!ctx.reduced || document.body.classList.contains('reduce-motion')
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* listeners that all come off together */
export function bag() {
  const offs = [];
  return {
    on(t, type, fn, opts) { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); },
    add(off) { if (off) offs.push(off); },
    clear() { offs.splice(0).forEach(off => off()); },
  };
}

/* a running clock that stops while paused and ticks a callback a few times a second */
export function clock(onTick) {
  let banked = 0, since = 0, running = false, timer = 0;
  const now = () => performance.now();
  const api = {
    get secs() { return (banked + (running ? now() - since : 0)) / 1000; },
    set secs(v) { banked = v * 1000; if (running) since = now(); },
    get running() { return running; },
    start() { if (running) return; running = true; since = now(); timer = setInterval(() => onTick?.(api.secs), 250); onTick?.(api.secs); },
    stop() { if (!running) return; banked += now() - since; running = false; clearInterval(timer); timer = 0; onTick?.(api.secs); },
    dispose() { clearInterval(timer); timer = 0; running = false; },
  };
  return api;
}

export const CSS = `
.pz{position:relative;width:100%;height:100%;min-height:340px;display:flex;flex-direction:column;align-items:center;gap:var(--sp-3,8px);padding:var(--sp-4,12px);
  box-sizing:border-box;font-family:var(--font,system-ui);color:var(--ink-1,#eee);container-type:size;user-select:none;-webkit-user-select:none;overflow:hidden}
.pz *{box-sizing:border-box}
.pz__top,.pz__bar{width:min(100%,760px);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:var(--sp-2,6px);flex:0 0 auto}
.pz__seg{display:inline-flex;padding:3px;border-radius:var(--r-md,11px);background:var(--fill-1,rgba(255,255,255,.06));border:1px solid var(--line-0,rgba(255,255,255,.05))}
.pz__seg button{font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-2,#aaa);background:none;border:0;padding:7px 11px;border-radius:8px;cursor:pointer;white-space:nowrap}
.pz__seg button[aria-pressed="true"]{background:var(--fill-3,rgba(255,255,255,.15));color:var(--ink-0,#fff);box-shadow:0 1px 2px rgba(0,0,0,.3)}
.pz__seg button:focus-visible,.pz__btn:focus-visible{outline:2px solid var(--ga);outline-offset:2px}
.pz__btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:600 var(--fs-12,12px)/1 var(--font,system-ui);color:var(--ink-1,#ddd);background:var(--fill-1,rgba(255,255,255,.06));
  border:1px solid var(--line-1,rgba(255,255,255,.08));padding:7px 10px;border-radius:var(--r-md,11px);cursor:pointer;white-space:nowrap;min-height:30px}
.pz__btn svg,.pz__btn .icon{width:14px;height:14px}
@media (hover:hover){.pz__btn:hover{background:var(--fill-2,rgba(255,255,255,.1))}}
.pz__btn[aria-pressed="true"]{background:color-mix(in srgb,var(--ga) 22%,transparent);border-color:color-mix(in srgb,var(--ga) 60%,transparent);color:var(--ink-0,#fff)}
.pz__btn:disabled{opacity:.45;cursor:default}
.pz__read{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:var(--r-md,11px);background:var(--fill-0,rgba(255,255,255,.03));border:1px solid var(--line-0,rgba(255,255,255,.05));
  font-size:15px;font-weight:700;color:var(--ink-0,#fff);font-variant-numeric:tabular-nums;min-width:60px}
.pz__read .icon,.pz__read svg{width:14px;height:14px;color:var(--ink-3,#888)}
.pz__read small{font-size:11px;font-weight:600;color:var(--ink-3,#999)}
.pz__stage{position:relative;flex:1 1 auto;min-height:160px;width:100%;container-type:size;display:grid;place-items:center}
.pz__foot{width:min(100%,760px);min-height:30px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:var(--sp-3,8px);font-size:var(--fs-12,12px);color:var(--ink-3,#999);text-align:center}
.pz__foot kbd{font:600 11px/1 var(--mono,ui-monospace,monospace);padding:3px 6px;border-radius:5px;border:1px solid var(--line-2,rgba(255,255,255,.14));border-bottom-width:2px;background:var(--fill-1,rgba(255,255,255,.05));color:var(--ink-1,#ddd)}
.pz__cover{position:absolute;inset:0;display:grid;place-items:center;border-radius:var(--r-lg,15px);background:#120b10;font-size:clamp(20px,5cqmin,30px);font-weight:800;color:#fff;z-index:5}
.pz__live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.pz__note{font-size:var(--fs-12,12px);color:var(--ink-2,#bbb)}
@container (max-width:520px){.pz{padding:var(--sp-2,6px);gap:5px}.pz__long{display:none}}
@container (max-height:480px){.pz__hint{display:none}}
`;
