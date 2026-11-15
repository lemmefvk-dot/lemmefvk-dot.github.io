/* ============================================================
   aetherium.life.js — Staticum's everyday skills.

   Reminders, tasks, focus, Do Not Disturb, volume, Settings panes,
   weather, screen time, unit conversions and flashcard quizzes.
   Nothing here keeps a copy of what an app does: each skill calls
   that app's own core module (automations, tasks, focus, dndsched,
   screentime, answers, flashcards) through a verified action in
   aetherium.actions.js, then reads the result back, so Staticum only
   says "done" when it is.

   Weather answers from the forecast the Weather app already saved
   (IndexedDB, written by the app when it last reached Open-Meteo);
   this file never makes a request of its own.
   ============================================================ */
import { skill, answer, runAction, fromAction } from './aetherium.kit.js';
import * as QR from '../core/quickremind.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const chip = (label, send) => ({ label, send });
const trimEnd = s => String(s || '').replace(/[?.!\s]+$/, '').trim();

/* ---- reminders -------------------------------------------------- */
/* "remind me at 4pm to hand in the essay", "remind me in 20 min to stretch",
   "remind me to call mum tomorrow at 9", "timer 10 minutes" */
skill({
  id: 'remind',
  match: (q, ctx) => {
    const raw = q.replace(/^(?:please\s+|can you\s+|could you\s+)/, '');
    if (!/^(?:remind me|(?:set\s+(?:a\s+)?)?timer)\b/.test(raw)) return null;
    const rel = QR.parse(raw);
    if (rel) return { score: 11, params: { rel } };
    const at = QR.parseAt(raw);
    if (at) return { score: 11, params: { at } };
    return { score: 10, params: { bad: true } };
  },
  run: async ({ rel, at, bad }, ctx) => {
    if (bad) {
      return answer('I could not tell when. Try “remind me at 4pm to hand in the essay”, “remind me in 20 minutes to stretch” or “remind me tomorrow at 9am to call mum”.',
        { kind: 'unsure' });
    }
    const r = rel
      ? await runAction('set_reminder', { text: rel.text, seconds: rel.seconds, timer: rel.kind === 'timer' }, ctx)
      : await runAction('set_reminder', { text: at.text, at: at.at.getTime() }, ctx);
    const what = rel ? rel.text : at.text;
    return fromAction(r, res => (rel && rel.kind === 'timer'
      ? `Timer set: ${what}, ${res.detail}. It is in Automations → Reminders.`
      : `Okay, I will remind you ${res.detail}: ${what}. It is in Automations → Reminders.`));
  },
});

/* ---- tasks ------------------------------------------------------- */
const taskTail = text => {
  /* "buy milk due friday", "essay by tomorrow", "call mum, high priority" */
  let t = trimEnd(text), due = null, priority = null;
  const pr = t.match(/[,\s]+(?:(high|urgent|important)\s+priority|priority\s+high|!{2,})$/i);
  if (pr) { priority = 'high'; t = t.slice(0, pr.index).trim(); }
  const m = t.match(/\s+(?:due|by|for)\s+((?:next\s+|this\s+)?[a-z]+|\d{4}-\d{2}-\d{2})$/i);
  if (m) {
    const d = QR.parseDay(m[1]);
    if (d) { due = QR.ymdOf(d); t = t.slice(0, m.index).trim(); }
  }
  return { text: t.replace(/^["“]|["”]$/g, ''), due, priority };
};

skill({
  id: 'task-add',
  match: q => {
    let m = q.match(/^(?:please\s+)?(?:add|create|new|make)\s+(?:a\s+|another\s+)?(?:new\s+)?(?:task|to-?do|todo)\s*(?:to|for|called|named|:|-)?\s*(.*)$/);
    if (!m) {
      m = q.match(/^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on|onto)\s+(?:my\s+)?(?:tasks?|to-?do|todo)(?:\s+list)?$/);
    }
    return m ? { score: 11, params: { raw: m[1] } } : null;
  },
  run: async ({ raw }, ctx) => {
    const t = taskTail(raw);
    if (!t.text) return answer('What is the task? Try “add task finish the essay due friday”.', { chips: [chip('Never mind', 'nothing')] });
    const r = await runAction('add_task', { text: t.text, due: t.due, priority: t.priority }, ctx);
    return fromAction(r, res => `Added “${t.text}”. ${res.detail}`);
  },
});

skill({
  id: 'task-due',
  match: q => {
    if (/^(?:please\s+)?(?:add|create|new)\b/.test(q)) return null;
    const asks = /\b(?:what|what's|whats|show|list|anything|do i have|have i got|tell me)\b/.test(q);
    if (/\bwhat(?:'s| is|s)? (?:due|overdue)\b|\bwhat do i have (?:due|to do)\b|\b(?:anything|something) due\b|\boverdue\b|\bdue (?:today|tomorrow|this week)\b/.test(q)) {
      return { score: 10.5, params: { q } };
    }
    if (asks && /\b(?:my tasks?|to-?do list|todo list|task list)\b/.test(q)) return { score: 10.5, params: { q } };
    return null;
  },
  run: async ({ q }, ctx) => {
    const T = await import('../core/tasks.js');
    const HW = await import('../core/homework.js');
    const data = T.read();
    const when = /\btomorrow\b/.test(q) ? 'tomorrow' : /\boverdue\b/.test(q) ? 'overdue' : /\bthis week\b/.test(q) ? 'week' : 'today';
    const day = ms => T.dayOf(ms);
    const todayStr = day(Date.now());
    const tomorrowStr = day(Date.now() + 86400000);
    const weekEnd = day(Date.now() + 6 * 86400000);
    let tasks;
    if (when === 'today') tasks = T.smart(data, 'today');
    else if (when === 'overdue') tasks = T.smart(data, 'overdue');
    else if (when === 'tomorrow') tasks = T.smart(data, 'upcoming').filter(x => x.task.due === tomorrowStr);
    else tasks = [...T.smart(data, 'today'), ...T.smart(data, 'upcoming').filter(x => x.task.due <= weekEnd)];
    /* Study's homework is "due today" too */
    const hwAll = HW.read().assignments;
    const hwView = HW.viewToday(hwAll);
    let hw;
    if (when === 'today') hw = [...hwView.overdue, ...hwView.today];
    else if (when === 'overdue') hw = hwView.overdue;
    else hw = hwAll.filter(a => !a.done && (when === 'tomorrow' ? a.due === tomorrowStr : a.due >= todayStr && a.due <= weekEnd));
    const label = when === 'week' ? 'in the next week' : when === 'overdue' ? 'overdue' : `due ${when}`;
    const total = tasks.length + hw.length;
    const chips = [chip('Open Tasks', 'open tasks')];
    if (!total) {
      return answer(when === 'overdue' ? 'Nothing is overdue.' : `Nothing ${when === 'week' ? 'is due in the next week' : `is due ${when}`} in Tasks${hwAll.length ? ' or Study homework' : ''}.`,
        { chips: [chip('Add a task', 'add task '), ...chips] });
    }
    const cards = [];
    if (tasks.length) {
      cards.push({
        title: 'Tasks', icon: 'check-square',
        lines: tasks.slice(0, 8).map(x => `${x.task.text}${x.task.due && when !== 'today' ? ` — ${x.task.due}` : ''}${x.task.priority === 'high' ? ' (high priority)' : ''}`),
      });
    }
    if (hw.length) cards.push({ title: 'Homework (Study)', icon: 'book', lines: hw.slice(0, 8).map(a => `${a.title}${when !== 'today' ? ` — ${a.due}` : a.due < todayStr ? ' (overdue)' : ''}`) });
    return answer(`${plural(total, 'thing')} ${label}:`, { cards, chips });
  },
});

/* ---- focus, Do Not Disturb, volume -------------------------------- */
skill({
  id: 'focus',
  match: q => {
    if (!/\bfocus\b|\bpomodoro\b/.test(q)) return null;
    if (/\bfocus (?:on|my|the)\b|\bfocus mode\b.*\bsetting/.test(q) && !/\b(start|begin|pause|stop|reset|skip)\b/.test(q)) return null;
    if (/\b(pause|stop|end|cancel|quit)\b/.test(q)) return { score: 10.5, params: { do: /\b(stop|end|cancel|quit)\b/.test(q) ? 'reset' : 'pause' } };
    if (/\bskip\b/.test(q)) return { score: 10.5, params: { do: 'skip' } };
    if (/\b(start|begin|run|set up|go into|enter|resume|turn on)\b|\bfocus (?:session|timer)\b|\bpomodoro\b/.test(q)) return { score: 10.5, params: { do: 'start' } };
    if (/\b(status|left|how long|remaining)\b/.test(q)) return { score: 10.5, params: { do: 'status' } };
    return null;
  },
  run: async ({ do: op }, ctx) => {
    if (op === 'status') {
      const F = await import('../core/focus.js');
      const s = F.state();
      const t = F.today();
      if (s.status === 'ready') return answer(`The focus timer is idle. Today you finished ${plural(t.n, 'session')} (${t.min} min).`, { chips: [chip('Start focus', 'start focus')] });
      return answer(`${s.label}: ${Math.max(1, Math.round(s.left / 60000))} min left${s.status === 'paused' ? ' (paused)' : ''}. Today you finished ${plural(t.n, 'session')}.`);
    }
    const r = await runAction('focus', { do: op }, ctx);
    return fromAction(r, res => `${cap(res.did)}. ${res.detail}`.trim());
  },
});

skill({
  id: 'dnd',
  match: q => {
    if (!/\bdo not disturb\b|\bdon'?t disturb\b|\bdnd\b/.test(q)) return null;
    if (/\b(schedule|schedules|settings?)\b/.test(q) && !/\b(turn|switch|set)\b/.test(q)) return null;
    const off = /\b(off|disable|stop|end|cancel)\b/.test(q);
    const on = /\b(on|enable|start|begin|activate)\b/.test(q) || !off;
    const m = q.match(/\bfor\s+(.+?)\s*$/);
    const secs = m ? QR.parseDuration(m[1].replace(/^an?\s+/, '1 ')) : null;
    return { score: 10.5, params: { on: off ? false : on, minutes: secs && !off ? Math.max(1, Math.round(secs / 60)) : 0 } };
  },
  run: async ({ on, minutes }, ctx) => {
    const r = await runAction('set_dnd', { on, minutes }, ctx);
    return fromAction(r, res => `${cap(res.did)}.${res.detail ? ` ${res.detail}` : ''}`);
  },
});

skill({
  id: 'volume',
  match: q => {
    if (!/\bvolume\b|\bmute\b|\bunmute\b|\blouder\b|\bquieter\b|\bturn (?:it )?(?:up|down)\b/.test(q)) return null;
    if (/\b(settings?|pane)\b/.test(q)) return null;
    if (/\bunmute\b/.test(q)) return { score: 10.5, params: { mute: false } };
    if (/\bmute\b/.test(q)) return { score: 10.5, params: { mute: true } };
    const n = q.match(/\b(\d{1,3})\s*(?:%|percent)?/);
    if (n && /\b(set|make|put|change|to|at)\b/.test(q)) return { score: 10.5, params: { level: Math.min(100, +n[1]) } };
    if (/\b(up|louder|raise|increase|higher)\b/.test(q)) return { score: 10.5, params: { step: 10 } };
    if (/\b(down|quieter|lower|decrease|softer|reduce)\b/.test(q)) return { score: 10.5, params: { step: -10 } };
    if (/\bmax(?:imum)?\b|\bfull\b/.test(q)) return { score: 10.5, params: { level: 100 } };
    if (/\bwhat\b|\bhow (?:loud|high)\b/.test(q)) return { score: 10.5, params: { ask: true } };
    return null;
  },
  run: async ({ level, step, mute, ask }, ctx) => {
    const cur = Number(ctx.api.store.get('prefs.volume', 62)) || 0;
    if (ask) {
      return answer(`The volume is ${cur}%${ctx.api.store.get('prefs.muted') ? ' and it is muted' : ''}.`,
        { chips: [chip('Volume up', 'volume up'), chip('Volume down', 'volume down'), chip('Mute', 'mute')] });
    }
    const r = mute !== undefined
      ? await runAction('set_volume', { mute }, ctx)
      : await runAction('set_volume', { level: step ? cur + step : level }, ctx);
    return fromAction(r, res => `${cap(res.did)}.${res.detail ? ` ${res.detail}` : ''}`);
  },
});

/* ---- "open sound settings" -------------------------------------- */
let PANES = null;
const panes = async () => {
  if (!PANES) PANES = (await import('../apps/settings.js')).SECTIONS.filter(s => !s.season);
  return PANES;
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Which Settings pane a line names: its name or id first, then one of its search words. */
function paneFor(q, list) {
  const word = w => new RegExp(`(?:^|[^a-z])${esc(w)}(?:[^a-z]|$)`).test(q);
  let best = null;
  for (const s of list) {
    for (const n of [s.name.toLowerCase(), s.id, s.name.toLowerCase().replace(/s$/, '')]) {
      if (word(n) && (!best || n.length > best.len)) best = { s, len: n.length };
    }
  }
  if (best) return best.s;
  for (const s of list) {
    for (const k of s.keys || []) {
      if (k.length > 3 && word(k) && (!best || k.length > best.len)) best = { s, len: k.length };
    }
  }
  return best ? best.s : null;
}
const SETTINGS_WORDS = /\b(settings?|preferences|prefs|panes?|options)\b/g;
skill({
  id: 'settings-pane',
  /* async: the pane list comes from js/apps/settings.js the first time it is needed */
  match: async q => {
    if (!/\b(open|show|go to|take me to|jump to|launch|switch to|bring up)\b/.test(q)) return null;
    if (!SETTINGS_WORDS.test(q)) return null;
    SETTINGS_WORDS.lastIndex = 0;
    const sec = paneFor(q.replace(SETTINGS_WORDS, ' '), await panes());
    return sec ? { score: 10.6, params: { id: sec.id } } : null;
  },
  run: async ({ id }, ctx) => {
    const sec = (await panes()).find(s => s.id === id);
    const r = await runAction('open_settings_pane', { pane: id }, ctx);
    return fromAction(r, () => `Opened Settings on ${sec.name}.`, { sec: id });
  },
});

/* ---- weather: only what the Weather app already saved ---------------- */
const HOUR = 3600000;
const ago = ms => {
  const m = Math.round(ms / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
skill({
  id: 'weather',
  match: q => {
    if (!/\bweather\b|\bforecast\b|\bwill it (?:rain|snow)\b|\bis it (?:raining|snowing|cold|hot|warm)\b|\bhow (?:hot|cold|warm) is it\b|\btemperature (?:outside|now|today)\b/.test(q)) return null;
    if (/\b(open|launch|start)\b/.test(q) || /\b(wallpaper|widget|settings?)\b/.test(q)) return null;
    return { score: 10.4, params: { q } };
  },
  run: async ({ q }, ctx) => {
    const OM = await import('../core/openmeteo.js');
    const { kv } = await import('../core/db.js');
    const place = ctx.api.store.get('prefs.wxPlace');
    const open = chip('Open Weather', 'open weather');
    if (!OM.validPlace(place)) {
      return answer('I have no place saved yet. Open Weather, pick a place, and I can tell you what it last fetched.', { kind: 'unsure', chips: [open] });
    }
    let rec = null;
    try { rec = await kv('misc').get(`weather:${OM.keyOf(place)}`); } catch (e) { rec = null; }
    const fc = rec && rec.fc;
    if (!fc || !fc.current || !Number.isFinite(rec.at)) {
      return answer(`The Weather app has not saved a forecast for ${place.name} yet. I only read what it has fetched, so open Weather once while you are online.`, { kind: 'unsure', chips: [open] });
    }
    const unit = (fc.current_units && fc.current_units.temperature_2m) || `°${rec.unit || ''}`;
    const deg = v => (Number.isFinite(v) ? `${Math.round(v)}${unit}` : null);
    const age = Date.now() - rec.at;
    const c = fc.current;
    const sky = OM.cond(c.weather_code, c.is_day).label.toLowerCase();
    const lines = [];
    const D = fc.daily || {};
    const todayStr = QR.ymdOf(new Date());
    const i = (D.time || []).indexOf(todayStr);
    if (i >= 0) {
      const hi = deg(D.temperature_2m_max && D.temperature_2m_max[i]), lo = deg(D.temperature_2m_min && D.temperature_2m_min[i]);
      if (hi && lo) lines.push(`Today: high ${hi}, low ${lo}`);
      const p = D.precipitation_probability_max && D.precipitation_probability_max[i];
      if (Number.isFinite(p)) lines.push(`Chance of rain or snow today: ${Math.round(p)}%`);
    }
    if (Number.isFinite(c.apparent_temperature)) lines.push(`Feels like ${deg(c.apparent_temperature)}`);
    const stale = age > HOUR;
    const head = stale
      ? `The last reading for ${place.name}, from ${ago(age)}, was ${deg(c.temperature_2m)} and ${sky}. That is old, so it may have changed.`
      : `${place.name} is ${deg(c.temperature_2m)} and ${sky} (updated ${ago(age)}).`;
    if (/\brain|snow\b/.test(q) && i >= 0 && Number.isFinite(D.precipitation_probability_max && D.precipitation_probability_max[i])) {
      const p = Math.round(D.precipitation_probability_max[i]);
      return answer(`${p}% chance of rain or snow today in ${place.name}, from a forecast saved ${ago(age)}.`, { cards: [{ title: place.name, icon: 'cloud', lines }], chips: [open] });
    }
    return answer(head, { cards: [{ title: place.name, icon: 'cloud', lines }], chips: [open] });
  },
});

/* ---- screen time -------------------------------------------------- */
skill({
  id: 'screentime',
  match: q => {
    if (!/\bscreen ?time\b|\bhow long (?:have i|was i|did i)\b|\btime (?:spent|i(?:'ve| have) spent)\b|\busage (?:today|this week)\b|\bwhat have i (?:used|been using)\b/.test(q)) return null;
    if (/\b(settings?|pane|open)\b/.test(q)) return null;
    return { score: 10.4, params: { week: /\b(week|7 days|seven days)\b/.test(q) } };
  },
  run: async ({ week }, ctx) => {
    const ST = await import('../core/screentime.js');
    const name = id => { const a = ctx.api.getApp(id); return a ? a.name : id; };
    const open = chip('Open Screen Time', 'open screen time settings');
    if (week) {
      const w = ST.week();
      const total = w.reduce((n, d) => n + d.sec, 0);
      if (!total) return answer('Nothing has been counted this week yet.', { chips: [open] });
      const top = ST.range(7);
      return answer(`${ST.fmtDur(total)} on screen in the last 7 days.`, {
        cards: [{ title: 'Last 7 days', icon: 'bar-chart', lines: [
          ...w.map(d => `${d.date.toLocaleDateString(undefined, { weekday: 'short' })}: ${ST.fmtDur(d.sec)}`),
          ...top.apps.slice(0, 3).map(a => `${name(a.id)}: ${ST.fmtDur(a.sec)}`),
        ] }],
        chips: [open],
      });
    }
    const d = ST.day();
    if (!d.total) return answer('Nothing has been counted today yet. Screen Time only counts while StaticOS is in front and you are using it.', { chips: [open] });
    const lines = d.apps.slice(0, 5).map(a => `${name(a.id)}: ${ST.fmtDur(a.sec)}`);
    for (const g of d.games.slice(0, 2)) lines.push(`${g.title}: ${ST.fmtDur(g.sec)}`);
    return answer(`${ST.fmtDur(d.total)} on screen today. Most of it in ${name(d.apps[0].id)}.`, { cards: [{ title: 'Today', icon: 'bar-chart', lines }], chips: [open, chip('This week', 'screen time this week')] });
  },
});

/* ---- conversions: the same engine Spotlight and Static Convert use ---- */
/* "convert 5 km to miles", "100 f in c", "how many cm in a foot", and a sum
   for the number: "convert 2*7.5 kg to lb" (that part is core/mathexpr.js) */
async function conversionFor(q) {
  const AUC = await import('../core/answers.js');
  const plain = AUC.convert(q);
  if (plain) return plain;
  const m = q.match(/^(?:convert\s+|what(?:'s|\s+is)\s+)?([\d\s.+\-*/()^]*[+\-*/^][\d\s.+\-*/()^]*?)\s*([a-z°][a-z°/²³ ]*?)\s+(?:to|in|into)\s+(.+?)\s*\??$/);
  if (!m) return null;
  const ME = await import('../core/mathexpr.js');
  let v;
  try { v = ME.evaluate(m[1]); } catch (e) { return null; }
  if (!Number.isFinite(v)) return null;
  return AUC.convert(`${Number(v.toPrecision(12))} ${m[2]} to ${m[3]}`);
}
skill({
  id: 'convert',
  match: async q => {
    if (!/\d|^how many\b/.test(q) || q.length > 80) return null;
    const c = await conversionFor(q);
    return c ? { score: 10.3, params: { c } } : null;
  },
  run: ({ c }) => answer(`${c.detail}${c.note ? ` ${c.note}` : ''}`, {
    chips: [chip(`Swap: ${c.swap}`, `convert ${c.swap}`), chip('Open Convert', 'open convert')],
  }),
});

/* ---- "quiz me on my biology deck" -> a Study flashcard session --------- */
const SKIP_WORDS = new Set(['deck', 'decks', 'the', 'and', 'cards', 'card', 'flashcards', 'flashcard', 'quiz', 'test', 'study', 'with', 'about']);
const wordsOf = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !SKIP_WORDS.has(w));
skill({
  id: 'quiz',
  match: q => {
    if (/\b(?:quiz|test|drill|question|revise)\s+me\b/.test(q)) return { score: 10.4, params: { q } };
    if (/\b(?:study|review|revise|practi[cs]e|cram)\b.*\b(?:deck|flashcards?|cards)\b/.test(q)) return { score: 10.4, params: { q } };
    if (/\b(?:start|begin|do|run|open)\b.*\b(?:flashcards?|deck)\b/.test(q) && /\b(?:start|begin|do|run)\b/.test(q)) return { score: 10.4, params: { q } };
    return null;
  },
  run: async ({ q }, ctx) => {
    const FC = await import('../core/flashcards.js');
    const decks = FC.read().decks.filter(d => d.cards.length);
    if (!decks.length) {
      return answer('You have no flashcards yet. Make a deck in Study, or use Lens to turn an answer into cards.', { kind: 'unsure', chips: [chip('Open Study', 'open study')] });
    }
    const qWords = new Set(wordsOf(q));
    let best = null;
    for (const d of decks) {
      const hit = wordsOf(d.name).filter(w => qWords.has(w)).length + (q.includes(d.name.toLowerCase()) ? 3 : 0);
      if (hit && (!best || hit > best.hit)) best = { d, hit };
    }
    let deck = best && best.d;
    const named = !!deck;
    if (!deck && decks.length === 1) deck = decks[0];
    if (!deck) {
      const wanted = [...qWords].join(' ');
      return answer(wanted ? `I could not find a deck called “${wanted}”. Which one?` : 'Which deck?', {
        kind: 'unsure', chips: decks.slice(0, 6).map(d => chip(d.name, `quiz me on my ${d.name} deck`)),
      });
    }
    const due = FC.deckQueue(deck).length;
    const cram = !due;
    const r = await runAction('start_quiz', { deck: deck.id, cram }, ctx);
    return fromAction(r, () => cram
      ? `Nothing in ${deck.name} is due today, so I started a cram session with all ${plural(deck.cards.length, 'card')}. Cramming does not change your schedule.`
      : `Starting ${deck.name}: ${plural(due, 'card')} to go.${named ? '' : ' It is your only deck.'}`,
    { deck: deck.id });
  },
});

/* ---- suggestion chips that follow what Staticum just did ------------------ */
/** Follow-ups for an answer that came with none, from the skill that made it. */
export function suggestFor(id, res, ctx) {
  const st = (ctx && ctx.api && ctx.api.store) || null;
  const dndOn = st ? st.get('prefs.dnd') === true : false;
  const ok = res && res.kind === 'action';
  switch (id) {
    case 'remind':
      return ok ? [chip('Show my reminders', 'open automations'), chip('Add a task', 'add task '), chip('Start focus', 'start focus')] : [chip('Remind me in 10 minutes to stretch', 'remind me in 10 minutes to stretch')];
    case 'task-add':
      return ok ? [chip('What is due today?', "what's due today"), chip('Open Tasks', 'open tasks'), chip('Start focus', 'start focus')] : [];
    case 'task-due':
      return [chip('Start focus', 'start focus'), chip('Add a task', 'add task ')];
    case 'focus':
      if (!ok) return [chip('Start focus', 'start focus')];
      return res.did && /started/.test(res.did)
        ? [dndOn ? null : chip('Turn on Do Not Disturb', 'turn on do not disturb'), chip('Pause focus', 'pause focus'), chip('Focus status', 'focus status')].filter(Boolean)
        : [chip('Start focus', 'start focus'), chip('Screen time today', 'screen time today')];
    case 'dnd':
      return ok ? [dndOn ? chip('Turn it off', 'turn off do not disturb') : chip('Turn it on', 'turn on do not disturb'), chip('Start focus', 'start focus'), chip('Notification settings', 'open notifications settings')] : [];
    case 'volume':
      return [chip('Volume up', 'volume up'), chip('Volume down', 'volume down'), chip(st && st.get('prefs.muted') ? 'Unmute' : 'Mute', st && st.get('prefs.muted') ? 'unmute' : 'mute')];
    case 'settings-pane':
      return ok && res.sec ? neighbours(res.sec) : [];
    case 'weather':
      return [chip('Screen time today', 'screen time today'), chip("What's due today?", "what's due today")];
    case 'screentime':
      return [chip('Start focus', 'start focus'), chip("What's due today?", "what's due today")];
    case 'quiz':
      return [chip('Open Study', 'open study'), chip('Start focus', 'start focus')];
    case 'note':
      return ok ? [chip('Open Notes', 'open notes'), chip('Add a task', 'add task ')] : [];
    case 'theme':
    case 'wallpaper':
    case 'look':
      return [chip('Dark mode', 'dark mode'), chip('Open Settings', 'open settings')];
    case 'time':
      return [chip('Remind me in 30 minutes to ', 'remind me in 30 minutes to '), chip('Start focus', 'start focus')];
    default:
      return [];
  }
}

/** Panes in the same group as the one just opened, for "what next". */
function neighbours(id) {
  if (!PANES) return [];
  const me = PANES.find(s => s.id === id);
  if (!me) return [];
  return PANES.filter(s => s.group === me.group && s.id !== id).slice(0, 3)
    .map(s => chip(`${s.name} settings`, `open ${s.name.toLowerCase()} settings`));
}
