/* ============================================================
   forge/templates.js — complete games Forge can start from with
   no AI model and no key.

   Each template is ONE standalone HTML document, built here from
   two pieces of real source: the shared game kit (forge/kit.js)
   and the game's own function (forge/games/<id>.js), both copied
   in as text. Every template is our own code; all art is drawn
   with canvas shapes and every sound is a tone made in code.

   A template's settings live in the document itself, as JSON:
     <script type="application/json" id="forge-params">
     {"forge":1,"template":"<id>","params":[{"k","label","type",
      "value", min/max/step for ranges}, …]}
   The game reads its values when it starts. Remix (in Forge) edits
   them — readParams() / writeParams() — so a remix of a remix, an
   exported file opened again, or a file edited by hand all keep
   working. Types: range (number), color (#rrggbb), text, toggle.

   TEMPLATES: [{ id, name, icon, genre, desc, controls, season,
                 colors, params, art(g, w, h), game }]
   template(id), buildDoc(t, values?), readParams(html),
   writeParams(html, values), paramValues(info), cleanValue(p, v),
   halloweenSeason(date), winterSeason(date), artUrl(t)
   ============================================================ */
import { buildDoc, readParams, writeParams, paramValues, cleanValue } from './doc.js';
import neonBreaker from './games/neon-breaker.js';
import caveGlider from './games/cave-glider.js';
import rockSplitter from './games/rock-splitter.js';
import runawaySnake from './games/runaway-snake.js';
import fruitCatcher from './games/fruit-catcher.js';
import towerStack from './games/tower-stack.js';
import hauntedHouse from './games/haunted-house.js';
import zombieSurvival from './games/zombie-survival.js';
import candyCollector from './games/candy-collector.js';
import coastDash from './games/coast-dash.js';
import gemHopper from './games/gem-hopper.js';
import starLane from './games/star-lane.js';
import glowGrid from './games/glow-grid.js';
import beatLanes from './games/beat-lanes.js';
import sledRun from './games/sled-run.js';
import snowmanWorks from './games/snowman-works.js';
import { isSpookySeason, seasonOn } from '../core/season.js';

/* Halloween first: during the season Forge shows these three on top; the two winter games
   get their own strip from Dec 1 to Jan 1 and stay in the list all year */
export const TEMPLATES = [
  hauntedHouse, zombieSurvival, candyCollector,
  neonBreaker, caveGlider, rockSplitter, runawaySnake, fruitCatcher, towerStack,
  coastDash, gemHopper, starLane, glowGrid, beatLanes,
  sledRun, snowmanWorks,
];

export { buildDoc, readParams, writeParams, paramValues, cleanValue };

export const template = id => TEMPLATES.find(t => t.id === id) || null;

/** Oct 24 – Nov 1 on this device's own calendar (core/season.js decides). */
export const halloweenSeason = (date = new Date()) => isSpookySeason(date);

/** December 1 – January 1, and only while the person has not switched Winter
    off in Settings (core/season.js seasonOn: also true while Winter is on trial). */
export const winterSeason = (date = new Date()) => seasonOn('winter', date);

/* card art, drawn once per session in StaticOS's own page (decoration only:
   no game code runs outside the sandbox) */
const ART = new Map();
export function artUrl(t, w = 320, h = 180) {
  const key = `${t.id}:${w}x${h}`;
  if (ART.has(key)) return ART.get(key);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    t.art(g, w, h);
    url = c.toDataURL('image/png');
  } catch (err) { url = ''; }
  ART.set(key, url);
  return url;
}

export default { TEMPLATES, template, buildDoc, readParams, writeParams, paramValues, cleanValue, halloweenSeason, winterSeason, artUrl };
