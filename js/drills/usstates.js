/* ============================================================
   drills/usstates.js — the 50 US states, their capitals and Census
   regions, for the Geography tab's "US states" quizzes. Pure data and
   question building: no DOM, no storage.

   Written by hand for StaticOS and checked against two public-domain
   US government sources (works of the US government are not under
   copyright):
     · capitals: the US Geological Survey's National Atlas "Cities and
       Towns of the United States" (citiesx020), the 51 places whose
       FEATURE is "State Capital" / "National Capital", as published in
       USGS Open-File Report 2006-1251
       (https://pubs.usgs.gov/of/2006/1251/Baselayers/cities.dbf).
       Every capital below matches that file's NAME; checked 2026-11-07.
     · regions: the US Census Bureau's four Census regions
       ("Census Regions and Divisions of the United States",
       https://www.census.gov/programs-surveys/economic-census/guidance-geographies/levels.html),
       checked 2026-11-07. Washington, D.C. is in the Census's South
       region but is not a state, so it is not asked about.
   ============================================================ */
import { factWeight, pickWeighted } from './sched.js';

export const SOURCE = 'Capitals: US Geological Survey, National Atlas “Cities and Towns of the United States” (public domain). Regions: US Census Bureau, Census Regions (public domain).';
export const US_REGIONS = ['Northeast', 'Midwest', 'South', 'West'];

/* [postal code, state, capital, Census region] */
export const STATES = [
  ['AL', 'Alabama', 'Montgomery', 'South'], ['AK', 'Alaska', 'Juneau', 'West'], ['AZ', 'Arizona', 'Phoenix', 'West'],
  ['AR', 'Arkansas', 'Little Rock', 'South'], ['CA', 'California', 'Sacramento', 'West'], ['CO', 'Colorado', 'Denver', 'West'],
  ['CT', 'Connecticut', 'Hartford', 'Northeast'], ['DE', 'Delaware', 'Dover', 'South'], ['FL', 'Florida', 'Tallahassee', 'South'],
  ['GA', 'Georgia', 'Atlanta', 'South'], ['HI', 'Hawaii', 'Honolulu', 'West'], ['ID', 'Idaho', 'Boise', 'West'],
  ['IL', 'Illinois', 'Springfield', 'Midwest'], ['IN', 'Indiana', 'Indianapolis', 'Midwest'], ['IA', 'Iowa', 'Des Moines', 'Midwest'],
  ['KS', 'Kansas', 'Topeka', 'Midwest'], ['KY', 'Kentucky', 'Frankfort', 'South'], ['LA', 'Louisiana', 'Baton Rouge', 'South'],
  ['ME', 'Maine', 'Augusta', 'Northeast'], ['MD', 'Maryland', 'Annapolis', 'South'], ['MA', 'Massachusetts', 'Boston', 'Northeast'],
  ['MI', 'Michigan', 'Lansing', 'Midwest'], ['MN', 'Minnesota', 'Saint Paul', 'Midwest'], ['MS', 'Mississippi', 'Jackson', 'South'],
  ['MO', 'Missouri', 'Jefferson City', 'Midwest'], ['MT', 'Montana', 'Helena', 'West'], ['NE', 'Nebraska', 'Lincoln', 'Midwest'],
  ['NV', 'Nevada', 'Carson City', 'West'], ['NH', 'New Hampshire', 'Concord', 'Northeast'], ['NJ', 'New Jersey', 'Trenton', 'Northeast'],
  ['NM', 'New Mexico', 'Santa Fe', 'West'], ['NY', 'New York', 'Albany', 'Northeast'], ['NC', 'North Carolina', 'Raleigh', 'South'],
  ['ND', 'North Dakota', 'Bismarck', 'Midwest'], ['OH', 'Ohio', 'Columbus', 'Midwest'], ['OK', 'Oklahoma', 'Oklahoma City', 'South'],
  ['OR', 'Oregon', 'Salem', 'West'], ['PA', 'Pennsylvania', 'Harrisburg', 'Northeast'], ['RI', 'Rhode Island', 'Providence', 'Northeast'],
  ['SC', 'South Carolina', 'Columbia', 'South'], ['SD', 'South Dakota', 'Pierre', 'Midwest'], ['TN', 'Tennessee', 'Nashville', 'South'],
  ['TX', 'Texas', 'Austin', 'South'], ['UT', 'Utah', 'Salt Lake City', 'West'], ['VT', 'Vermont', 'Montpelier', 'Northeast'],
  ['VA', 'Virginia', 'Richmond', 'South'], ['WA', 'Washington', 'Olympia', 'West'], ['WV', 'West Virginia', 'Charleston', 'South'],
  ['WI', 'Wisconsin', 'Madison', 'Midwest'], ['WY', 'Wyoming', 'Cheyenne', 'West'],
].map(([code, name, capital, region]) => ({ code, name, capital, region }));

/* the two quizzes; their keys never change: 'usc:CA' (state to capital), 'usr:CA' (capital to state) */
export const US_MODES = [['usc', 'State to capital', 'What is the capital of'], ['usr', 'Capital to state', 'Which state has the capital']];
export const isUsMode = m => US_MODES.some(x => x[0] === m);
const OPTIONS = 4;

function shuffle(a, rng) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export const eligibleStates = regions => STATES.filter(s => regions.includes(s.region));

/** One question, in the same shape the country quizzes use: { mode, iso, options: [{ iso, label }], answer }. */
export function makeUsQuestion({ mode, regions, stats = {}, rng = Math.random, avoidCode }) {
  const pool = eligibleStates(regions);
  if (pool.length < 1) return null;
  const target = pickWeighted(pool, s => factWeight(stats[`${mode}:${s.code}`]), rng, avoidCode ? pool.find(s => s.code === avoidCode) : undefined);
  /* distractors from the same region first (they are the ones people mix up), then anywhere */
  const same = shuffle(STATES.filter(s => s !== target && s.region === target.region), rng);
  const other = shuffle(STATES.filter(s => s !== target && s.region !== target.region), rng);
  const picks = [...same, ...other].slice(0, OPTIONS - 1);
  const label = s => (mode === 'usc' ? s.capital : s.name);
  return { mode, iso: target.code, options: shuffle([target, ...picks], rng).map(s => ({ iso: s.code, label: label(s) })), answer: label(target) };
}

export function explainUs(q, chosenCode) {
  const t = STATES.find(s => s.code === q.iso), x = STATES.find(s => s.code === chosenCode);
  const right = chosenCode === q.iso;
  const lines = [];
  if (q.mode === 'usc') {
    lines.push(right ? `Yes, ${t.capital} is the capital of ${t.name}.` : `The capital of ${t.name} is ${t.capital}.`);
    if (!right && x) lines.push(`${x.capital} is the capital of ${x.name}.`);
  } else {
    lines.push(right ? `Yes, ${t.capital} is the capital of ${t.name}.` : `${t.capital} is the capital of ${t.name}, not ${x ? x.name : 'that state'}.`);
    if (!right && x) lines.push(`The capital of ${x.name} is ${x.capital}.`);
  }
  return { right, lines };
}
