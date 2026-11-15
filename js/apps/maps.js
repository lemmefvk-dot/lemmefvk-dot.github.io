/* ============================================================
   maps.js — Static Maps: a street map from OpenStreetMap, saved
   places, and straight-line distances.

   THE RULES THIS APP KEEPS (checked against the OpenStreetMap
   Foundation's Tile Usage Policy and Nominatim Usage Policy before
   it was built; read them again before changing anything here):
     Tiles     tile.openstreetmap.org over HTTPS, as ordinary <img>
               requests, so the browser sends its own User-Agent and a
               valid Referer (the site sets no Referrer-Policy; do not
               add a restrictive one, and never put referrerpolicy on
               these images). Only the tiles in the visible map are
               requested, after the map has settled for a moment: no
               prefetching, no neighbouring zoom levels, no "keep this
               area offline". The browser's own HTTP cache applies the
               server's caching headers; nothing here asks for no-cache.
               Tiles that just left the screen are kept for a moment in
               the page, so panning back asks for nothing.
     Credit    "© OpenStreetMap contributors" is always drawn over the
               map's corner, linked to the copyright page, and cannot be
               hidden. Search results carry the same credit.
     Search    Nominatim, only when the person presses Search or Enter
               (never as they type), at most one request a second, the
               same words answered from a cache the second time, and a
               typed latitude and longitude is placed with no request at
               all. A person's coordinates or words go to OSM only for
               that search; saved places never leave the device.
     Switch    MAPS below turns the tiles or the search off at once if
               OSM asks for that.
   Honest limit: Nominatim's one-a-second cap applies to the whole
   site, not to each visitor. This app keeps each visitor to it; it
   cannot see other visitors. If the site grows, put a caching proxy
   in front of the search and ask OSM.

   Distances are great-circle (haversine, mean Earth radius): the
   straight line over the surface, never a road distance. The maths
   is js/core/mapmath.js. Saved places, the unit and the last view are
   kept on this device through the store (portal.maps).

   Keys: arrows pan, + and − zoom, P drops a pin at the centre, Esc
   removes it. Click the map for a pin (or a ruler point in Ruler mode).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import * as M from '../core/mapmath.js';

/* the operator's switches */
export const MAPS = { tiles: true, search: true };
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const SEARCH_URL = q => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
const MIN_Z = 2, MAX_Z = 19, SETTLE_MS = 150, SPARE_TILES = 80, SEARCH_GAP_MS = 1100, MAX_PLACES = 200, KEY = 'portal.maps';
const HOME = { lat: 20, lon: 0, z: 2 };

const CSS = `
.mp{flex:1;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--ink-1);font-size:var(--fs-13)}
.mp *{box-sizing:border-box}
.mp__bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.mp__search{display:flex;gap:var(--sp-2);flex:1 1 260px;min-width:200px}
.mp input[type=text]{flex:1;min-width:0;height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;padding:0 var(--sp-3)}
.mp select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;min-width:0;max-width:100%}
.mp__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;cursor:pointer}
.mp__btn:hover{background:var(--fill-2)}
.mp__btn:disabled{opacity:.5;cursor:default}
.mp__btn[aria-pressed=true],.mp__btn--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.mp__btn--sm{height:24px;padding:0 var(--sp-3);font-size:var(--fs-12)}
.mp__main{flex:1;min-height:0;display:flex;gap:var(--sp-4);padding:var(--sp-4);overflow:auto}
.mp__map{flex:1 1 420px;min-width:260px;min-height:300px;position:relative;border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-1);overflow:hidden;touch-action:none;cursor:grab;outline-offset:2px}
.mp__map:active{cursor:grabbing}
.mp__map:focus-visible,.mp button:focus-visible,.mp input:focus-visible,.mp select:focus-visible{outline:2px solid var(--accent)}
.mp__tiles,.mp__over{position:absolute;inset:0;overflow:hidden}
.mp__tiles img{position:absolute;width:256px;height:256px;max-width:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
.mp__over svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.mp__mark{position:absolute;transform:translate(-50%,-100%);border:0;padding:0;background:none;cursor:pointer;color:#e5484d;font-size:calc(26px * var(--fs-k,1));line-height:1;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.mp__mark--saved{color:#2f7de1}
.mp__mark--pin{color:#e5484d;pointer-events:none}
.mp__mark span{position:absolute;left:50%;top:100%;transform:translateX(-50%);font-size:calc(11px * var(--fs-k,1));white-space:nowrap;background:rgba(255,255,255,.88);color:#111;border-radius:3px;padding:0 4px;font-weight:600}
.mp__zoom{position:absolute;left:8px;top:8px;display:flex;flex-direction:column;gap:4px}
.mp__zoom button{width:30px;height:30px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-0);color:var(--ink-0);font-size:calc(18px * var(--fs-k,1));line-height:1;cursor:pointer}
.mp__cross{position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;pointer-events:none;opacity:.55}
.mp__cross::before,.mp__cross::after{content:"";position:absolute;background:#111;box-shadow:0 0 0 1px rgba(255,255,255,.7)}
.mp__cross::before{left:6px;top:0;width:2px;height:14px}.mp__cross::after{top:6px;left:0;height:2px;width:14px}
.mp__credit{position:absolute;right:0;bottom:0;background:rgba(255,255,255,.88);color:#222;font-size:calc(11px * var(--fs-k,1));padding:2px 6px;border-top-left-radius:6px;z-index:5}
.mp__credit a{color:#0b5fbf;text-decoration:underline}
.mp__msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:80%;text-align:center;background:var(--fill-0);border:1px solid var(--line-1);border-radius:var(--r-md);padding:var(--sp-3) var(--sp-4);color:var(--ink-1);z-index:4}
.mp__side{flex:0 0 310px;display:flex;flex-direction:column;gap:var(--sp-3);min-width:0;overflow:auto}
@media (max-width:760px){.mp__side{flex-basis:100%}.mp__main{flex-wrap:wrap}}
.mp h3{margin:0;font-size:var(--fs-11);color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em}
.mp__note{margin:0;color:var(--ink-2);font-size:var(--fs-12);line-height:1.5}
.mp__err{margin:0;color:#f2994a;font-weight:600}
.mp__row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2)}
.mp__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--sp-2)}
.mp__item{display:flex;align-items:center;gap:var(--sp-2);border:1px solid var(--line-1);border-radius:var(--r-md);padding:var(--sp-2) var(--sp-3);background:var(--fill-0)}
.mp__item b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-0);font-weight:600}
.mp__item span{color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.mp__result{display:block;width:100%;text-align:left;border:1px solid var(--line-1);border-radius:var(--r-md);padding:var(--sp-2) var(--sp-3);background:var(--fill-0);color:var(--ink-1);font:inherit;cursor:pointer}
.mp__result:hover{background:var(--fill-2)}
.mp__legs{margin:0;padding-left:var(--sp-5);font-variant-numeric:tabular-nums;color:var(--ink-1)}
`;

const load = api => { const v = api.store.get(KEY, null); return v && typeof v === 'object' ? v : {}; };

defineApp({
  id: 'maps',
  name: 'Maps',
  icon: 'map-pin',
  g1: '#3fcf72', g2: '#097a3a',
  category: 'Utilities',
  keywords: ['map', 'maps', 'openstreetmap', 'osm', 'street', 'places', 'saved places', 'distance', 'ruler', 'search', 'location', 'geography', 'atlas', 'great circle', 'how far', 'coordinates', 'latitude', 'longitude'],
  desc: 'An OpenStreetMap street map with search, saved places and straight-line distances between them',
  singleton: true,
  win: { w: 1040, h: 700, minW: 560, minH: 480 },
  shortcuts: [['Left / Right / Up / Down', 'Pan the map'], ['Plus / -', 'Zoom'], ['P', 'Drop a pin at the centre'], ['Esc', 'Remove the pin']],
  mount({ root, win, api }) { return build(root, win, api); },
});

function build(root, win, api) {
  let dead = false;
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const saved = load(api);
  const S = {
    lat: Number.isFinite(saved.view?.lat) ? saved.view.lat : HOME.lat, lon: Number.isFinite(saved.view?.lon) ? saved.view.lon : HOME.lon, z: Number.isInteger(saved.view?.z) ? Math.max(MIN_Z, Math.min(MAX_Z, saved.view.z)) : HOME.z,
    places: Array.isArray(saved.places) ? saved.places.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.name === 'string').slice(0, MAX_PLACES) : [],
    unit: saved.unit === 'mi' ? 'mi' : 'km', pin: null, ruler: false, pts: [], ref: 'centre', results: [], lastSearch: 0, searching: false, cache: new Map(), tiles: new Map(), spare: new Map(), settle: 0, tileErrors: 0, tileLoads: 0, requested: [],
  };
  const persist = () => api.store.set(KEY, { places: S.places, unit: S.unit, view: { lat: S.lat, lon: S.lon, z: S.z } });

  /* ---------- the DOM ---------- */
  const tilesEl = h('div.mp__tiles', { dataset: { fk: 'maps-tiles' } });
  const overEl = h('div.mp__over');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overEl.append(svg);
  const marks = h('div', { style: { position: 'absolute', inset: '0' } });
  overEl.append(marks);
  const msg = h('div.mp__msg', { role: 'status', hidden: true, dataset: { fk: 'maps-msg' } });
  const credit = h('div.mp__credit', { dataset: { fk: 'maps-credit' } }, '© ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }), ' contributors');
  const zoomIn = h('button', { type: 'button', 'aria-label': 'Zoom in', dataset: { fk: 'maps-zin' }, onclick: () => zoomBy(1) }, '+');
  const zoomOut = h('button', { type: 'button', 'aria-label': 'Zoom out', dataset: { fk: 'maps-zout' }, onclick: () => zoomBy(-1) }, '−');
  const mapEl = h('div.mp__map', { tabindex: '0', role: 'application', 'aria-label': 'Map. Arrow keys pan, plus and minus zoom, P drops a pin at the centre.', dataset: { fk: 'maps-map' } },
    tilesEl, overEl, h('div.mp__cross'), h('div.mp__zoom', zoomIn, zoomOut), msg, credit);

  const q = h('input', { type: 'text', 'aria-label': 'Search for a place, or type latitude and longitude', placeholder: 'Search a place, or 51.5, -0.12', autocomplete: 'off', spellcheck: 'false', dataset: { fk: 'maps-q' } });
  const goBtn = h('button.mp__btn.mp__btn--go', { type: 'submit', dataset: { fk: 'maps-go' } }, 'Search');
  const form = h('form.mp__search', { role: 'search', onsubmit: e => { e.preventDefault(); doSearch(); } }, q, goBtn);
  const unitBtn = h('button.mp__btn', { type: 'button', dataset: { fk: 'maps-unit' }, onclick: () => { S.unit = S.unit === 'km' ? 'mi' : 'km'; persist(); paintSide(); } });
  const rulerBtn = h('button.mp__btn', { type: 'button', dataset: { fk: 'maps-ruler' }, onclick: () => { S.ruler = !S.ruler; if (!S.ruler) S.pts = []; paintSide(); drawOver(); } }, 'Ruler');
  const searchMsg = h('p.mp__note', { role: 'status', dataset: { fk: 'maps-search-msg' } });
  const resultsEl = h('div.mp__list', { dataset: { fk: 'maps-results' } });
  const pinBox = h('div', { dataset: { fk: 'maps-pinbox' } });
  const rulerBox = h('div', { dataset: { fk: 'maps-rulerbox' } });
  const refSel = h('select', { 'aria-label': 'Measure distances from', dataset: { fk: 'maps-ref' }, onchange: e => { S.ref = e.target.value; paintSide(); } });
  const placesEl = h('ul.mp__list', { dataset: { fk: 'maps-places' } });

  const el = h('div.mp', h('style', { text: CSS }),
    h('div.mp__bar', form, rulerBtn, unitBtn),
    h('div.mp__main', mapEl,
      h('div.mp__side', pinBox, rulerBox, h('h3', { text: 'Saved places' }), h('div.mp__row', h('label', { text: 'Distances from ' }, refSel)), placesEl,
        h('h3', { text: 'Search results' }), searchMsg, resultsEl,
        h('p.mp__note', { text: 'Distances are straight lines over the Earth\'s surface (great-circle), not roads. Map pictures come from tile.openstreetmap.org and searches from nominatim.openstreetmap.org, when you use them; saved places stay on this device.' }))));
  root.append(el);

  /* ---------- the view ---------- */
  const size = () => { const r = mapEl.getBoundingClientRect(); return { w: Math.max(100, r.width), h: Math.max(100, r.height) }; };
  const worldN = () => M.TILE * 2 ** S.z;
  const centrePx = () => M.project(S.lat, S.lon, S.z);
  /* screen position of a point, taking the nearer copy of the world across the date line */
  function toScreen(lat, lon) {
    const { w, h: hh } = size(), c = centrePx(), p = M.project(lat, lon, S.z), n = worldN();
    let dx = p.x - c.x; dx -= Math.round(dx / n) * n;
    return { x: w / 2 + dx, y: hh / 2 + (p.y - c.y) };
  }
  function fromScreen(x, y) {
    const { w, h: hh } = size(), c = centrePx();
    return M.unproject(c.x + (x - w / 2), Math.max(0, Math.min(worldN(), c.y + (y - hh / 2))), S.z);
  }
  const clampView = () => { S.lat = Math.max(-M.MAX_LAT + 1, Math.min(M.MAX_LAT - 1, S.lat)); S.lon = M.wrapLon(S.lon); };

  function layoutTiles() {
    const { w, h: hh } = size(), c = centrePx(), n = 2 ** S.z;
    for (const [key, t] of S.tiles) t.el.style.transform = `translate(${Math.round(t.x * M.TILE - c.x + w / 2)}px,${Math.round(t.y * M.TILE - c.y + hh / 2)}px)`;
    void n;
  }
  /* create the <img> for each tile in view, once the map has stopped moving */
  function ensureTiles() {
    if (dead) return;
    if (!MAPS.tiles) { showMsg('The map pictures are switched off for now.'); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { showMsg('Maps needs an internet connection to draw the map. Your saved places are still below.'); return; }
    const { w, h: hh } = size(), c = centrePx(), n = 2 ** S.z;
    const x0 = Math.floor((c.x - w / 2) / M.TILE), x1 = Math.floor((c.x + w / 2) / M.TILE);
    const y0 = Math.max(0, Math.floor((c.y - hh / 2) / M.TILE)), y1 = Math.min(n - 1, Math.floor((c.y + hh / 2) / M.TILE));
    const want = new Set();
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const wx = ((tx % n) + n) % n, key = `${S.z}/${tx}/${ty}`;
      want.add(key);
      if (S.tiles.has(key)) continue;
      const kept = S.spare.get(key);                         /* seen a moment ago: no second request */
      if (kept) { S.spare.delete(key); tilesEl.append(kept.el); S.tiles.set(key, kept); continue; }
      const url = TILE_URL(S.z, wx, ty);
      /* a plain <img>: the browser adds the Referer, and its HTTP cache honours the server's headers */
      const img = h('img', { alt: '', draggable: 'false', width: 256, height: 256 });
      img.onload = () => { S.tileLoads++; msg.hidden = true; };
      img.onerror = () => { S.tileErrors++; if (S.tileErrors >= 3 && !S.tileLoads) showMsg('The map pictures did not load. Check your connection and try again.'); };
      S.requested.push(url);
      img.src = url;
      tilesEl.append(img);
      S.tiles.set(key, { el: img, x: tx, y: ty });
    }
    for (const [key, t] of [...S.tiles]) if (!want.has(key)) { retire(key, t); S.tiles.delete(key); }
    layoutTiles();
  }
  /* a tile that left the screen is kept (not shown) for a little, so panning back does not ask the server again */
  function retire(key, t) {
    t.el.remove(); S.spare.set(key, t);
    while (S.spare.size > SPARE_TILES) { const [k, old] = S.spare.entries().next().value; old.el.onload = null; old.el.onerror = null; old.el.removeAttribute('src'); S.spare.delete(k); }
  }
  function showMsg(t) { msg.textContent = t; msg.hidden = false; }
  const settle = () => { clearTimeout(S.settle); S.settle = setTimeout(ensureTiles, SETTLE_MS); };

  function render(quick) {
    clampView();
    layoutTiles();
    drawOver();
    paintSide(true);
    if (!quick) { ensureTiles(); }
    else settle();
  }
  const view = () => { render(true); persistSoon(); };
  let ptimer = 0;
  const persistSoon = () => { clearTimeout(ptimer); ptimer = setTimeout(persist, 400); };

  function setView(lat, lon, z) {
    if (z !== undefined && z !== S.z) {
      S.z = Math.max(MIN_Z, Math.min(MAX_Z, z));
      for (const [k, t] of S.tiles) retire(k, t);      /* a different zoom is a different set of pictures */
      S.tiles.clear(); msg.hidden = true; S.tileErrors = 0; S.tileLoads = 0;
    }
    S.lat = lat; S.lon = lon;
    view();
  }
  function zoomBy(d, px, py) {
    const z = Math.max(MIN_Z, Math.min(MAX_Z, S.z + d));
    if (z === S.z) return;
    const { w, h: hh } = size();
    const sx = px ?? w / 2, sy = py ?? hh / 2;
    const at = fromScreen(sx, sy);
    S.z = z;
    for (const [k, t] of S.tiles) retire(k, t);
    S.tiles.clear(); msg.hidden = true; S.tileErrors = 0; S.tileLoads = 0;
    const p = M.project(at.lat, at.lon, z), c = M.unproject(p.x - (sx - w / 2), p.y - (sy - hh / 2), z);
    S.lat = c.lat; S.lon = c.lon;
    view();
  }
  const pan = (dx, dy) => { const c = centrePx(), n = M.unproject(c.x + dx, c.y + dy, S.z); S.lat = n.lat; S.lon = n.lon; view(); };

  /* ---------- pointer and keyboard ---------- */
  let drag = null, lastWheel = 0;
  on(mapEl, 'pointerdown', e => {
    if (e.button || e.target.closest('.mp__zoom, .mp__credit, .mp__mark--saved')) return;
    mapEl.focus();
    drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    try { mapEl.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
  });
  on(mapEl, 'pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
    pan(-dx, -dy);
  });
  on(mapEl, 'pointerup', e => {
    const d = drag; drag = null;
    if (!d || d.moved) return;
    const r = mapEl.getBoundingClientRect(), p = fromScreen(e.clientX - r.left, e.clientY - r.top);
    clickAt(p.lat, p.lon);
  });
  on(mapEl, 'pointercancel', () => { drag = null; });
  on(mapEl, 'wheel', e => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 180) return;                    /* one zoom step per gesture, never a burst of levels */
    lastWheel = now;
    const r = mapEl.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  on(mapEl, 'keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = 80;
    if (e.key === 'ArrowLeft') pan(-step, 0); else if (e.key === 'ArrowRight') pan(step, 0);
    else if (e.key === 'ArrowUp') pan(0, -step); else if (e.key === 'ArrowDown') pan(0, step);
    else if (e.key === '+' || e.key === '=') zoomBy(1); else if (e.key === '-' || e.key === '_') zoomBy(-1);
    else if (e.key === 'p' || e.key === 'P') clickAt(S.lat, S.lon);
    else if (e.key === 'Escape') { S.pin = null; paintSide(); drawOver(); } else return;
    e.preventDefault();
  });
  function clickAt(lat, lon) {
    if (S.ruler) { if (S.pts.length < 25) S.pts.push({ lat, lon }); }
    else S.pin = { lat, lon, name: '' };
    paintSide(); drawOver();
  }

  /* ---------- search ---------- */
  /* the button is never disabled: Enter in a form whose button is disabled does nothing, silently */
  function setBusy(b) { S.searching = b; goBtn.setAttribute('aria-busy', String(b)); }
  async function doSearch() {
    const text = q.value.trim();
    searchMsg.className = 'mp__note';
    if (!text) return;
    const ll = M.parseLatLon(text);
    if (ll) { S.results = []; resultsEl.replaceChildren(); searchMsg.textContent = ''; S.pin = { ...ll, name: '' }; setView(ll.lat, ll.lon, Math.max(S.z, 12)); return; }
    if (!MAPS.search) { searchMsg.textContent = 'Place search is switched off for now. You can still type a latitude and longitude.'; return; }
    if (text.length < 3) { searchMsg.textContent = 'Type at least three letters, then press Search.'; return; }
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (S.cache.has(key)) { showResults(S.cache.get(key), text); return; }
    if (S.searching) { searchMsg.textContent = 'Still searching…'; return; }
    const wait = S.lastSearch + SEARCH_GAP_MS - Date.now();
    if (wait > 0) {
      searchMsg.textContent = 'One search a second, please. Try again in a moment.';
      return;
    }
    S.lastSearch = Date.now(); setBusy(true);
    searchMsg.textContent = 'Searching…';
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(SEARCH_URL(text), { signal: ctl.signal });
      if (!res.ok) throw new Error(res.status === 429 ? 'The search service asked us to slow down. Wait a minute and try again.' : `The search service answered ${res.status}.`);
      const data = await res.json();
      const list = (Array.isArray(data) ? data : []).map(r => ({ name: String(r.display_name || r.name || '').slice(0, 200), lat: Number(r.lat), lon: Number(r.lon), bbox: Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null }))
        .filter(r => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon));
      S.cache.set(key, list);
      if (!dead) showResults(list, text);
    } catch (err) {
      if (!dead) { searchMsg.className = 'mp__err'; searchMsg.textContent = ctl.signal.aborted ? 'The search took too long. Try again.' : String(err.message || 'The search could not be reached. Check your connection.'); }
    } finally { clearTimeout(to); if (!dead) setBusy(false); }
  }
  function showResults(list, text) {
    S.results = list;
    searchMsg.className = 'mp__note';
    searchMsg.textContent = list.length ? `Results for “${text}”. Search by Nominatim, data © OpenStreetMap contributors.` : `Nothing found for “${text}”.`;
    resultsEl.replaceChildren(...list.map((r, i) => h('li', { style: { listStyle: 'none' } }, h('button.mp__result', { type: 'button', dataset: { fk: `maps-result-${i}` }, onclick: () => pickResult(r) }, r.name))));
    if (list.length === 1) pickResult(list[0]);
  }
  function pickResult(r) {
    S.pin = { lat: r.lat, lon: r.lon, name: r.name.split(',')[0] };
    let z = 13;
    if (r.bbox && r.bbox.length === 4 && r.bbox.every(Number.isFinite)) {
      const { w, h: hh } = size();
      /* the zoom at which the place's box takes up about 80% of the map */
      const fit = (deg, px) => Math.log2(0.8 * px * 360 / (M.TILE * Math.max(deg, 1e-6)));
      z = Math.max(4, Math.min(16, Math.floor(Math.min(fit(Math.abs(r.bbox[3] - r.bbox[2]), w), fit(Math.abs(r.bbox[1] - r.bbox[0]), hh)))));
    }
    setView(r.lat, r.lon, z);
  }

  /* ---------- the overlay: pins, saved places, the ruler ---------- */
  function drawOver() {
    if (dead) return;
    const { w, h: hh } = size();
    svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
    svg.replaceChildren();
    marks.replaceChildren();
    const NS = 'http://www.w3.org/2000/svg';
    if (S.pts.length) {
      const pts = S.pts.map(p => toScreen(p.lat, p.lon));
      const line = document.createElementNS(NS, 'polyline');
      line.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#e5484d'); line.setAttribute('stroke-width', '3'); line.setAttribute('stroke-dasharray', '8 5');
      svg.append(line);
      pts.forEach(p => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 5); c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#e5484d'); c.setAttribute('stroke-width', '2.5'); svg.append(c); });
    }
    for (const p of S.places) {
      const s = toScreen(p.lat, p.lon);
      if (s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > hh + 40) continue;
      marks.append(h('button.mp__mark.mp__mark--saved', { type: 'button', style: { left: `${s.x}px`, top: `${s.y}px` }, 'aria-label': `Saved place ${p.name}`, dataset: { place: p.id, fk: `maps-mark-${p.id}` }, onclick: () => setView(p.lat, p.lon, Math.max(S.z, 12)) }, '●', h('span', { text: p.name })));
    }
    if (S.pin) { const s = toScreen(S.pin.lat, S.pin.lon); marks.append(h('div.mp__mark.mp__mark--pin', { style: { left: `${s.x}px`, top: `${s.y}px` }, dataset: { role: 'pin' } }, '▼')); }
  }

  /* ---------- the side panel ---------- */
  const fmt = km => M.fmtDistance(km, S.unit);
  const refPoint = () => {
    if (S.ref === 'pin' && S.pin) return { lat: S.pin.lat, lon: S.pin.lon, label: 'the pin' };
    const p = S.places.find(x => x.id === S.ref);
    if (p) return { lat: p.lat, lon: p.lon, label: p.name };
    return { lat: S.lat, lon: S.lon, label: 'the map centre' };
  };
  let nameField = null, lastPin = null;
  function paintSide(light) {
    if (dead) return;
    unitBtn.textContent = S.unit === 'km' ? 'Kilometres' : 'Miles';
    unitBtn.setAttribute('aria-label', `Units: ${S.unit === 'km' ? 'kilometres' : 'miles'}. Press to switch.`);
    rulerBtn.setAttribute('aria-pressed', String(S.ruler));
    win.setSubtitle(`— ${M.fmtLatLon(S.lat, S.lon)}, zoom ${S.z}`);
    /* the pin */
    if (!light || !pinBox.firstChild || lastPin !== S.pin) {
      lastPin = S.pin;
      const typed = nameField ? nameField.value : null;
      if (S.pin) {
        nameField = h('input', { type: 'text', maxlength: 60, value: typed ?? S.pin.name ?? '', placeholder: 'Name this place', 'aria-label': 'Name for the place', dataset: { fk: 'maps-name' }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); savePin(); } } });
        pinBox.replaceChildren(h('h3', { text: 'Pin' }), h('p.mp__note', { dataset: { role: 'pin-coords' }, text: M.fmtLatLon(S.pin.lat, S.pin.lon) }),
          h('div.mp__row', nameField, h('button.mp__btn.mp__btn--sm.mp__btn--go', { type: 'button', dataset: { fk: 'maps-save' }, onclick: () => savePin() }, 'Save place'), h('button.mp__btn.mp__btn--sm', { type: 'button', dataset: { fk: 'maps-unpin' }, onclick: () => { S.pin = null; nameField = null; paintSide(); drawOver(); } }, 'Remove pin')),
          h('p.mp__note', { dataset: { role: 'pin-dist' }, text: `${fmt(M.haversine({ lat: S.lat, lon: S.lon }, S.pin))} from the map centre` }));
      } else { nameField = null; pinBox.replaceChildren(h('h3', { text: 'Pin' }), h('p.mp__note', { text: 'Click the map, or press P, to drop a pin. Then save it as a place.' })); }
    } else if (S.pin) { const d = pinBox.querySelector('[data-role=pin-dist]'); if (d) d.textContent = `${fmt(M.haversine({ lat: S.lat, lon: S.lon }, S.pin))} from the map centre`; }
    /* the ruler */
    if (S.ruler) {
      const legs = S.pts.slice(1).map((p, i) => M.haversine(S.pts[i], p));
      rulerBox.replaceChildren(h('h3', { text: 'Ruler' }),
        S.pts.length < 2 ? h('p.mp__note', { text: S.pts.length ? 'Click the next point.' : 'Click points on the map to measure along them.' })
          : h('div', h('ol.mp__legs', { dataset: { fk: 'maps-legs' } }, ...legs.map(k => h('li', { text: fmt(k) }))), h('p', { dataset: { role: 'total' }, style: { margin: '6px 0 0', color: 'var(--ink-0)', fontWeight: '600' }, text: `Total ${fmt(M.pathKm(S.pts))} in a straight line along these legs` })),
        h('div.mp__row', h('button.mp__btn.mp__btn--sm', { type: 'button', dataset: { fk: 'maps-undo' }, onclick: () => { S.pts.pop(); paintSide(); drawOver(); } }, 'Undo point'), h('button.mp__btn.mp__btn--sm', { type: 'button', dataset: { fk: 'maps-clearpts' }, onclick: () => { S.pts = []; paintSide(); drawOver(); } }, 'Clear')));
    } else rulerBox.replaceChildren();
    /* the places */
    const before = refSel.value;
    refSel.replaceChildren(h('option', { value: 'centre', text: 'the map centre' }), S.pin ? h('option', { value: 'pin', text: 'the pin' }) : null, ...S.places.map(p => h('option', { value: p.id, text: p.name })));
    if (S.ref !== 'centre' && S.ref !== 'pin' && !S.places.some(p => p.id === S.ref)) S.ref = 'centre';
    if (S.ref === 'pin' && !S.pin) S.ref = 'centre';
    refSel.value = S.ref; void before;
    const ref = refPoint();
    const ordered = S.places.map(p => ({ p, km: M.haversine(ref, p) }));
    placesEl.replaceChildren(...(ordered.length ? ordered.map(({ p, km }) => h('li.mp__item', { dataset: { place: p.id } },
      h('b', { text: p.name, title: `${M.fmtLatLon(p.lat, p.lon)}` }), h('span', { text: S.ref === p.id ? 'here' : fmt(km), dataset: { role: 'dist' } }),
      h('button.mp__btn.mp__btn--sm', { type: 'button', 'aria-label': `Show ${p.name} on the map`, dataset: { fk: `maps-show-${p.id}` }, onclick: () => setView(p.lat, p.lon, Math.max(S.z, 12)) }, 'Show'),
      h('button.mp__btn.mp__btn--sm', { type: 'button', 'aria-label': `Delete ${p.name}`, dataset: { fk: `maps-del-${p.id}` }, onclick: () => { S.places = S.places.filter(x => x.id !== p.id); persist(); paintSide(); drawOver(); } }, 'Delete')))
      : [h('li', h('p.mp__note', { text: 'No saved places yet. Drop a pin and save it.' }))]));
    if (ordered.length) placesEl.append(h('li', h('p.mp__note', { dataset: { role: 'ref-note' }, text: `Straight-line distance from ${ref.label}.` })));
  }
  function savePin() {
    if (!S.pin) return;
    if (S.places.length >= MAX_PLACES) { searchMsg.textContent = `That is as many saved places as fit (${MAX_PLACES}).`; return; }
    const name = (nameField && nameField.value.trim()) || S.pin.name || `Place ${S.places.length + 1}`;
    S.places.push({ id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, name: name.slice(0, 60), lat: S.pin.lat, lon: S.pin.lon });
    S.pin = null; nameField = null;
    persist(); paintSide(); drawOver();
  }

  /* ---------- go ---------- */
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (!dead) { layoutTiles(); drawOver(); settle(); } }); ro.observe(mapEl); }
  requestAnimationFrame(() => { if (!dead) render(false); });
  paintSide();
  root.mapsPeek = () => ({ lat: S.lat, lon: S.lon, z: S.z, pin: S.pin && { ...S.pin }, places: S.places.map(p => ({ ...p })), unit: S.unit, ruler: S.ruler, pts: S.pts.map(p => ({ ...p })), requested: [...S.requested], tiles: [...S.tiles.keys()], spare: S.spare.size, results: S.results.length, searching: S.searching, lastSearch: S.lastSearch });

  return () => {
    dead = true;
    clearTimeout(S.settle); clearTimeout(ptimer);
    persist();
    if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
    for (const t of [...S.tiles.values(), ...S.spare.values()]) { t.el.onload = null; t.el.onerror = null; t.el.removeAttribute('src'); }
    offs.splice(0).forEach(f => f());
  };
}
