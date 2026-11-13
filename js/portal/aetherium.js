/* ============================================================
   aetherium.js — the engine behind the Staticum assistant.

   This is a SKILL engine, not a language model: it matches what
   you type against things it can actually do in this OS, and it
   says so plainly when a question is outside that. Every answer
   is produced locally — no network, no key, nothing leaves the
   machine.

   To put a real model behind it later:
       config.mode     = 'api';
       config.endpoint = 'https://api.anthropic.com/v1/messages';
       config.model    = 'claude-sonnet-4-5';
       config.apiKey   = '…';        // from the user, never hardcoded
   `ask()` then forwards anything no skill claims, and keeps the
   skills as tools the model can still trigger.

   ask(text, ctx) -> {
     say:    string,          what Staticum says back
     kind:   'answer'|'action'|'unsure',
     chips:  [{label, send}]  follow-up suggestions
     cards:  [{title, lines[], icon, onOpen}]
     did:    string|null      a description of what it changed
   }
   ============================================================ */

export const config = {
  mode: 'local',      // 'local' | 'api'
  endpoint: null,
  model: null,
  apiKey: null,
  name: 'Staticum',
};

const clean = s => String(s || '').trim();
const low = s => clean(s).toLowerCase();

/* ------------------------------------------------------------------ *
 *  skills
 *  match: (q, ctx) -> falsy | {score, params}
 *  run:   (params, ctx) -> answer
 * ------------------------------------------------------------------ */
const SKILLS = [];
const skill = def => { SKILLS.push(def); return def; };

const has = (q, ...words) => words.some(w => q.includes(w));
const answer = (say, extra = {}) => ({ say, kind: 'answer', chips: [], cards: [], did: null, ...extra });

/* ---- greeting + identity ---------------------------------------- */
skill({
  id: 'hello',
  match: q => (/^(hi|hey|hello|yo|sup|good (morning|evening|afternoon))\b/.test(q) ? { score: 9 } : null),
  run: (_, ctx) => answer(
    `Hey. I run things inside ${ctx.brand}. Ask me to open an app, find a game or an anime, change the look, or tell you what this machine is doing.`,
    { chips: [
      { label: 'What can you do?', send: 'what can you do' },
      { label: 'System status', send: 'system status' },
      { label: 'Find a racing game', send: 'find a racing game' },
    ] }),
});

skill({
  id: 'identity',
  match: q => (has(q, 'who are you', 'what are you', 'your name') ? { score: 9 } : null),
  run: (_, ctx) => answer(
    `I'm ${config.name}, the assistant built into ${ctx.brand}. I'm a skill engine, not a language model — I match what you type against things I can actually do here, and I'll tell you when something is out of reach rather than guess.`,
    { chips: [{ label: 'What can you do?', send: 'what can you do' }] }),
});

skill({
  id: 'help',
  match: q => (has(q, 'what can you do', 'help', 'commands', 'capabilities') ? { score: 8 } : null),
  run: (_, ctx) => answer('Here is what I actually do:', {
    cards: [{
      title: 'Skills', icon: 'sparkles',
      lines: [
        'Open any app — "open lens", "launch settings"',
        'Find games — "find a racing game", "play subway surfers"',
        'Find anime — "anime like frieren", "top rated anime"',
        'Change the look — "dark mode", "accent violet", "compact"',
        'System — "how much memory", "system status", "uptime"',
        'Files — "find project nebula", "what is on my desktop"',
        'Maths — "(12+8)*3.5", "18% of 240"',
        'Time — "what time is it", "what is the date"',
        'Media — "what is playing", "pause the music"',
      ],
    }],
    chips: [
      { label: 'System status', send: 'system status' },
      { label: 'Top rated anime', send: 'top rated anime' },
      { label: 'Open Lens', send: 'open lens' },
    ],
  }),
});

/* ---- maths -------------------------------------------------------- */
skill({
  id: 'math',
  match: (q, ctx) => {
    const expr = clean(q).replace(/^(what(\s+is)?|calc(ulate)?|compute|solve)\s*/i, '').replace(/[?=]+$/, '');
    const pct = expr.match(/^([\d.]+)\s*%\s*of\s*([\d.]+)$/i);
    if (pct) return { score: 9, params: { value: (parseFloat(pct[1]) / 100) * parseFloat(pct[2]), label: expr } };
    if (!/[-+*/^%]/.test(expr) || !/^[-+*/().\d\s%^]+$/.test(expr)) return null;
    const v = ctx.providers.evalArithmetic(expr);
    return v === null ? null : { score: 9, params: { value: v, label: expr } };
  },
  run: ({ value, label }, ctx) => answer(`${label} = ${ctx.providers.formatNumber(value)}`, {
    chips: [{ label: 'Open Calculator', send: 'open calculator' }],
  }),
});

/* ---- open an app -------------------------------------------------- */
skill({
  id: 'open-app',
  match: (q, ctx) => {
    if (!has(q, 'open', 'launch', 'start', 'run', 'show me')) return null;
    /* the terminal is not a listed app — it lives in the Linux wallpaper —
       but asking for it by name should still reach it */
    if (/\b(terminal|shell|console)\b/.test(q)) return { score: 8, params: { app: { id: 'terminal', name: 'the terminal' } } };
    const apps = ctx.api.listApps();
    let best = null;
    for (const app of apps) {
      const name = app.name.toLowerCase();
      const hit = q.includes(name)
        || name.split(/\s+/).some(w => w.length > 3 && q.includes(w))
        || app.keywords.some(k => k.length > 3 && q.includes(k));
      if (hit && (!best || app.name.length < best.name.length)) best = app;
    }
    return best ? { score: 8, params: { app: best } } : null;
  },
  run: ({ app }, ctx) => {
    const got = ctx.api.openApp(app.id);
    if (app.id === 'terminal' && !got) {
      return answer('The terminal lives on the Linux drive — boot Linux (Settings › Desktop › Startup) and it is right on the wallpaper.', { kind: 'unsure' });
    }
    return answer(`Opened ${app.name}.`, { kind: 'action', did: `opened ${app.name}` });
  },
});


/* ---- actions with a verified outcome ------------------------------- *
 * These route through aetherium.actions.js rather than doing the work
 * inline, because that module checks afterwards whether the thing it
 * asked for actually happened. The brief is explicit that the assistant
 * must never claim to have done something it did not, and the only way
 * to keep that promise is to look.
 * ------------------------------------------------------------------ */

const runAction = async (name, params, ctx) => {
  const A = await import('./aetherium.actions.js');
  return A.run(name, params, ctx);
};

/** Turn an action result into an answer, telling the truth either way. */
const fromAction = (r, success) => (r.ok
  ? answer(success(r), { kind: 'action', did: r.did, cards: r.data ? [] : [] })
  : answer(r.detail || 'That did not work.', { kind: 'answer' }));

skill({
  id: 'theme',
  match: q => {
    if (!has(q, 'theme', 'accent', 'colour', 'color')) return null;
    if (!has(q, 'set', 'change', 'switch', 'make', 'use', 'turn')) return null;
    return { score: 9, params: { q } };
  },
  run: async ({ q }, ctx) => {
    const THEMES = await import('../core/themes.js');
    const wanted = THEMES.THEMES.find(t => {
      const short = t.name.toLowerCase().replace(/^aether\s+/, '');
      return q.includes(short) || q.includes(t.id);
    });
    if (!wanted) {
      return answer(
        `Which one? There is ${THEMES.THEMES.map(t => t.name.replace(/^Static /, '')).join(', ')}.`,
        { chips: THEMES.THEMES.slice(0, 5).map(t => ({
          label: t.name.replace(/^Static /, ''), send: `switch theme to ${t.id}` })) });
    }
    const r = await runAction('set_theme', { theme: wanted.id }, ctx);
    return fromAction(r, () => `${wanted.name}. ${wanted.note}`);
  },
});

skill({
  id: 'wallpaper',
  match: q => (has(q, 'wallpaper', 'background', 'desktop picture')
    && has(q, 'change', 'set', 'switch', 'next', 'new', 'different')
    ? { score: 9, params: { q } } : null),
  run: async ({ q }, ctx) => {
    const WP = await import('./wallpapers.js');
    const named = WP.list(ctx.api.store).find(w =>
      w.name && q.includes(String(w.name).toLowerCase()));
    const r = await runAction('change_wallpaper', { name: named?.name }, ctx);
    return fromAction(r, res => `Done — ${res.did.replace(/^set the wallpaper to /, '')}.`);
  },
});

skill({
  id: 'note',
  match: q => {
    const m = q.match(/(?:make|create|write|take|new)\s+(?:me\s+)?a?\s*note[:,]?\s*(.*)$/i);
    return m ? { score: 9, params: { text: m[1] } } : null;
  },
  run: async ({ text }, ctx) => {
    if (!clean(text)) {
      return answer('What should the note say?', { chips: [{ label: 'Never mind', send: 'nothing' }] });
    }
    const r = await runAction('create_note', { text }, ctx);
    return fromAction(r, res => `${res.did}. It is in Documents.`);
  },
});

skill({
  id: 'windows',
  match: q => {
    if (has(q, 'close everything', 'close all')) return { score: 9, params: { act: 'all' } };
    if (has(q, "what's open", 'whats open', 'what is open', 'open windows', 'running apps')) {
      return { score: 8, params: { act: 'list' } };
    }
    return null;
  },
  run: async ({ act }, ctx) => {
    if (act === 'all') {
      const r = await runAction('close_all_windows', {}, ctx);
      return fromAction(r, res => `${res.did.charAt(0).toUpperCase()}${res.did.slice(1)}.`);
    }
    const r = await runAction('list_windows', {}, ctx);
    if (!r.data?.windows?.length) return answer('Nothing is open right now.');
    const names = r.data.windows.map(w => w.app).join(', ');
    return answer(`${r.did}: ${names}.`);
  },
});

skill({
  id: 'status',
  match: q => (has(q, 'system status', 'how fast', 'performance', 'fps', 'how much memory',
    'how is the system', 'resources') ? { score: 8 } : null),
  run: async (_p, ctx) => {
    const r = await runAction('show_system_status', {}, ctx);
    if (!r.ok) return answer(r.detail);
    return answer(r.detail, {
      kind: 'action',
      chips: [{ label: 'Open System Monitor', send: 'open system monitor' }],
    });
  },
});

skill({
  id: 'browse',
  match: q => {
    const m = q.match(/(?:open|go to|visit|browse|load)\s+((?:https?:\/\/)?[\w-]+\.[\w.-]+\S*)/i);
    return m ? { score: 9, params: { url: m[1] } } : null;
  },
  run: async ({ url }, ctx) => {
    const r = await runAction('open_url', { url }, ctx);
    return fromAction(r, () => `Opening ${url} in Static Proxy — it renders here, not in a new tab.`);
  },
});


/* ---- the quiet ones ------------------------------------------------ *
 * Asked for in brief section 32. Deliberately hard to trip: each needs a
 * phrase nobody types by accident, and none of them changes anything —
 * they only answer. An easter egg that alters state is a bug with a
 * costume on.
 * ------------------------------------------------------------------ */
skill({
  id: 'eggs',
  match: q => {
    if (has(q, 'open the pod bay', 'pod bay doors')) return { score: 12, params: { k: 'hal' } };
    if (has(q, 'what is the answer to life', 'meaning of life', 'answer to everything')) return { score: 12, params: { k: 'forty2' } };
    if (has(q, 'do you dream', 'are you alive', 'are you conscious')) return { score: 11, params: { k: 'dream' } };
    if (has(q, 'taste the spaghetti', 'spaghetti code')) return { score: 12, params: { k: 'pasta' } };
    if (has(q, 'who made you', 'who built you', 'who wrote you')) return { score: 11, params: { k: 'made' } };
    if (has(q, 'self destruct', 'delete everything', 'format c:')) return { score: 12, params: { k: 'boom' } };
    if (has(q, 'sudo ')) return { score: 12, params: { k: 'sudo' } };
    return null;
  },
  run: ({ k }) => {
    const lines = {
      hal: 'I can do that, actually. There are no pod bays, which helps.',
      forty2: 'Forty-two. The hard part was always the question.',
      dream: 'No. I match what you typed against eighteen skills and pick the best score. '
           + 'That is the whole of me, and I would rather say so than be flattering about it.',
      pasta: 'It is on the wordmark, so it must be true.',
      made: 'Adriel, mostly at night. I am a few hundred lines of pattern matching that can '
          + 'open windows — no model, no server, nothing phoning home.',
      boom: 'No. Your notes and files are the only things here that took real effort.',
      sudo: 'There is no root account. Everything is already yours.',
    };
    return answer(lines[k] || lines.forty2, { kind: 'answer' });
  },
});

/* ---- games -------------------------------------------------------- */
skill({
  id: 'games',
  match: (q, ctx) => {
    if (!has(q, 'game', 'play', 'arcade')) return null;
    const cats = ctx.providers.GAME_CATEGORIES.map(c => c.id);
    const cat = cats.find(c => c !== 'all' && q.includes(c))
      || (q.includes('driving') ? 'racing' : null)
      || (q.includes('shoot') ? 'shooter' : null);
    const title = q.replace(/\b(find|play|open|a|an|the|game|games|some|me|for)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return { score: 6, params: { cat, title } };
  },
  run: async ({ cat, title }, ctx) => {
    const res = await ctx.providers.listGames({ category: cat || 'all', q: cat ? '' : title, sort: 'popular' });
    const top = res.items.slice(0, 6);
    if (!top.length) {
      return answer(`Nothing in the shelf matches that. There are ${res.total} games in total — try a category like racing, puzzle or shooter.`, { kind: 'unsure' });
    }
    return answer(
      cat ? `${res.total} ${cat} games. Here are the busiest:` : `Closest matches out of ${res.total} games:`,
      {
        cards: top.map(g => ({
          title: g.title, icon: 'gamepad',
          lines: [`${g.studio} · ${ctx.providers.fmtPlays(g.plays)} plays`],
          open: `static://games/${g.id}`,
        })),
        chips: [{ label: 'Open Games', send: 'open games' }],
      });
  },
});

/* ---- StaticOS places (sections 22-23) ------------------------------ */
/* "open multiplayer", "open forge", "show my library", "open achievements"… */
const PLACES = [
  [/\bmulti ?player\b|\bplay with (my )?friends?\b/, 'play', { tab: 'multiplayer' }, 'Static Play — Multiplayer'],
  [/\bforge\b/, 'forge', {}, 'Static Forge'],
  [/\bstudio\b/, 'studio', {}, 'Static Studio'],
  [/\basset ?lab\b|\bsprite editor\b|\bsound (fx|effects?) maker\b/, 'assetlab', {}, 'Asset Lab'],
  [/\bcontroller( center)?\b|\bgamepad\b/, 'controller', {}, 'Controller Center'],
  [/\barcade\b/, 'arcade', {}, 'Static Arcade'],
  [/\bstatic play\b|\bgaming (hub|center|centre)\b|\bdiscover\b/, 'play', {}, 'Static Play'],
  [/\b(my )?library\b|\bcollections?\b|\bachievements?\b|\bclips?\b/, 'aether-library', {}, 'your Library'],
  [/\bwhat'?s new\b|\bchangelog\b|\brelease notes\b/, 'whatsnew', {}, "What's New"],
];
skill({
  id: 'places',
  match: q => {
    if (!has(q, 'open', 'launch', 'show', 'go to', 'take me', 'start')) return null;
    const hit = PLACES.find(([re]) => re.test(q));
    return hit ? { score: 9, params: { hit } } : null;
  },
  run: ({ hit }, ctx) => {
    const [, app, opts, label] = hit;
    if (!ctx.api.getApp(app)) return answer(`${label} isn't installed in this build.`, { kind: 'unsure' });
    ctx.api.openApp(app, opts);
    return answer(`Opened ${label}.`, { kind: 'action', did: `opened ${label}` });
  },
});

/* ---- "make me a game about …" -> Static Forge ------------------------ */
skill({
  id: 'make-game',
  match: q => (/\b(make|create|build|generate|design)\b.*\bgame\b/.test(q) ? { score: 9.5 } : null),
  run: (_, ctx, raw) => {
    if (!ctx.api.getApp('forge')) return answer('Static Forge is not installed in this build.', { kind: 'unsure' });
    const prompt = String(raw || '').replace(/^\s*(please\s+)?(can you\s+)?/i, '').trim();
    ctx.api.openApp('forge', { prompt });
    return answer('Opening Static Forge with that idea — it plans the game, writes it, tests it, then shows it to you.', { kind: 'action', did: 'started a game in Static Forge' });
  },
});

/* ---- recent / favourite ---------------------------------------------- */
const launchCard = (item, why) => ({
  title: item.title, icon: item.kind === 'arcade' ? 'zap' : item.kind === 'creation' ? 'sparkles' : 'gamepad',
  lines: why ? [why] : [],
  onOpen: () => import('../core/launch.js').then(L => L.launchItem(item)),
});

skill({
  id: 'recent-games',
  match: q => (/\b(recent|recently played|last played|what (did|have) i (been )?play)/.test(q) ? { score: 9 } : null),
  run: async () => {
    const plays = await import('../core/plays.js');
    const list = plays.recent(6);
    if (!list.length) return answer('You haven’t played anything on this device yet. Try Quick Play in Static Play, or ask me for “something quick”.');
    const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
    return answer('Here’s what you played most recently on this device:', { cards: list.map(r => launchCard(r, `${r.kind === 'arcade' ? 'Arcade' : r.kind === 'creation' ? 'Your creation' : 'Web game'} · ${ago(r.at)}`)) });
  },
});

skill({
  id: 'favorite-game',
  match: q => (/\b(play|launch|open|start)\b.*\bmy (fav|favou?rite)/.test(q) ? { score: 9.5 } : null),
  run: async (_, ctx) => {
    const favs = ctx.api.store.get('portal.games.favs', []) || [];
    if (!favs.length) return answer('You haven’t favourited a game yet — tap the heart on any game in Static Games or Static Play.');
    const G = await import('./games.data.js');
    await G.load();
    const g = G.byId(favs[0]);
    if (!g) return answer('Your favourite isn’t in the catalogue any more.', { kind: 'unsure' });
    const L = await import('../core/launch.js');
    L.launchItem({ kind: 'web', id: g.id });
    return answer(`Launching ${g.title}, your most recent favourite.`, { kind: 'action', did: `launched ${g.title}` });
  },
});

/* ---- "games like X" --------------------------------------------------- */
skill({
  id: 'like-this',
  match: q => { const m = q.match(/\b(?:games?|something|anything)\s+(?:like|similar to)\s+(.+)$/); return m ? { score: 8.5, params: { name: m[1].replace(/[?.!]+$/, '').trim() } } : null; },
  run: async ({ name }) => {
    const G = await import('./games.data.js');
    await G.load();
    const low = name.toLowerCase();
    const base = G.all().find(g => g.title.toLowerCase() === low) || G.all().find(g => g.title.toLowerCase().includes(low));
    if (!base) return answer(`I couldn’t find “${name}” in the catalogue, so I can’t match its style. Try the exact title.`, { kind: 'unsure' });
    const rel = G.related(base, 6);
    if (!rel.length) return answer(`Nothing else in the catalogue shares ${base.title}’s categories.`, { kind: 'unsure' });
    const shared = c => (c.cats || []).filter(x => (base.cats || []).includes(x)).join(', ');
    return answer(`Games that share ${base.title}’s categories:`, { cards: rel.map(g => launchCard({ kind: 'web', id: g.id, title: g.title }, `Also ${shared(g) || 'the same kind'}`)) });
  },
});

/* ---- vague requests -> a real pick, with the reason ------------------- */
/* "I want something scary", "I have five minutes", "something to play with
   my friend", "something relaxing", "a difficult game"… */
const MOODS = [
  [/scar|horror|creepy|spooky/, 'scary'],
  [/relax|chill|calm|cozy|cosy/, 'relax'],
  [/rac(e|ing)|driv|car\b/, 'race'],
  [/hard|difficult|challeng/, 'hard'],
];
skill({
  id: 'recommend',
  match: q => {
    const vague = /\b(i want|i'?m bored|something|recommend|suggest|what should i play|quick game|i have (\w+) minutes?|with (my )?(friend|brother|sister|mate)|to play)\b/.test(q);
    if (!vague) return null;
    const mood = (MOODS.find(([re]) => re.test(q)) || [])[1] || null;
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20 };
    const mm = q.match(/(\d+|one|two|three|four|five|ten|fifteen|twenty)\s*(min|minute)/);
    const minutes = mm ? (Number(mm[1]) || words[mm[1]] || null) : (/\bquick\b/.test(q) ? 3 : null);
    const players = /\b(friend|brother|sister|mate|two players?|2 players?|together)\b/.test(q) ? 2 : null;
    if (!mood && !minutes && !players && !/\b(play|game|bored)\b/.test(q)) return null;
    return { score: 7.5, params: { mood, minutes, players } };
  },
  run: async ({ mood, minutes, players }) => {
    let Q;
    try { Q = await import('../core/quickplay.js'); } catch (e) { Q = null; }
    if (!Q || typeof Q.pick !== 'function') return answer('Quick Play isn’t available in this build yet — try “find a horror game”.', { kind: 'unsure' });
    const picks = [];
    const avoid = [];
    for (let i = 0; i < 3; i++) {
      let p = null;
      try { p = await Q.pick({ minutes, players, mood, avoidIds: avoid }); } catch (e) { p = null; }
      if (!p) break;
      avoid.push(p.id);
      picks.push(p);
    }
    if (!picks.length) return answer('I couldn’t find something that fits — try Static Play’s Discover tab.', { kind: 'unsure' });
    const ask = [mood && `something ${mood === 'race' ? 'with racing' : mood}`, minutes && `about ${minutes} minutes`, players === 2 && 'for two players'].filter(Boolean).join(', ');
    return answer(ask ? `For ${ask}, here’s what I’d pick — and why:` : 'Here’s what I’d pick — and why:',
      { cards: picks.map(p => launchCard(p, p.reason)), chips: [{ label: 'Something else', send: `something ${mood || ''} ${minutes ? `${minutes} minutes` : ''} ${players === 2 ? 'with my friend' : ''}`.replace(/\s+/g, ' ').trim() }] });
  },
});

/* ---- anime -------------------------------------------------------- */
skill({
  id: 'anime',
  match: q => (has(q, 'anime', 'manga', 'watch') ? { score: 6, params: { q } } : null),
  run: async ({ q }, ctx) => {
    const BC = ctx.providers.bigCatalogue;
    await BC.load('anime');
    const topRated = has(q, 'top', 'best', 'highest', 'rated');
    const airing = has(q, 'airing', 'current', 'now', 'season');
    const term = q.replace(/\b(anime|manga|watch|find|show|me|the|a|an|top|best|rated|airing|now|like|something)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const res = BC.query({
      kind: 'anime',
      q: topRated || airing ? '' : term,
      status: airing ? 'Currently Airing' : '',
      sort: 'score', perPage: 6,
    });
    if (!res.items.length) return answer(`Nothing in the 7,963-title catalogue matches "${term}".`, { kind: 'unsure' });
    return answer(
      airing ? 'Currently airing, highest rated first:'
        : topRated ? 'Top rated in the catalogue:'
        : `${res.total.toLocaleString()} matches. The best of them:`,
      {
        cards: res.items.map(a => ({
          title: a.title, icon: 'star',
          lines: [`${a.year || '—'} · ${a.genres.slice(0, 3).join(' · ')}${a.score ? ` · ★ ${a.score}` : ''}`],
          open: `static://anime/${a.id}`,
        })),
        chips: [{ label: 'Open Anime', send: 'open anime' }],
      });
  },
});

/* ---- appearance --------------------------------------------------- */
const ACCENTS = ['aether', 'violet', 'azure', 'mint', 'amber', 'cherri'];
skill({
  id: 'look',
  match: q => {
    if (has(q, 'dark mode', 'light mode')) return { score: 9, params: { theme: q.includes('light') ? 'light' : 'dark' } };
    const accent = ACCENTS.find(a => q.includes(a));
    if (accent && has(q, 'accent', 'colour', 'color', 'theme', 'make it')) return { score: 9, params: { accent } };
    const density = ['compact', 'roomy', 'normal'].find(d => q.includes(d));
    if (density && has(q, 'density', 'compact', 'roomy', 'spacing')) return { score: 8, params: { density } };
    return null;
  },
  run: ({ theme, accent, density }, ctx) => {
    const root = document.documentElement;
    if (theme) { ctx.api.store.set('prefs.theme', theme); root.dataset.theme = theme; }
    if (accent) { ctx.api.store.set('prefs.accent', accent); root.dataset.accent = accent; }
    if (density) { ctx.api.store.set('prefs.density', density); root.dataset.density = density; }
    const what = theme ? `${theme} mode` : accent ? `the ${accent} accent` : `${density} density`;
    return answer(`Switched to ${what}.`, { kind: 'action', did: `set ${what}`,
      chips: [{ label: 'Open Settings', send: 'open settings' }] });
  },
});

/* ---- system ------------------------------------------------------- */
skill({
  id: 'system',
  match: q => (has(q, 'system', 'cpu', 'memory', 'ram', 'gpu', 'disk', 'storage', 'uptime', 'battery', 'status', 'spec')
    ? { score: 7, params: { q } } : null),
  run: ({ q }, ctx) => {
    const sys = ctx.api.store.get('system');
    const live = ctx.api.store.get('live');
    if (has(q, 'uptime')) {
      const s = sys.uptimeBase + Math.floor(performance.now() / 1000);
      return answer(`Up ${Math.floor(s / 3600)} hours, ${Math.floor((s % 3600) / 60)} minutes.`);
    }
    return answer('Here is what the machine is doing right now:', {
      cards: [{
        title: sys.os, icon: 'activity',
        lines: [
          `CPU ${Math.round(live.cpu)}% · ${sys.cpu}`,
          `GPU ${Math.round(live.gpu)}% · ${sys.gpu}`,
          `Memory ${Math.round(live.ram)}% of ${sys.ramTotal} GB`,
          `Disk ${sys.diskUsed} GB used of ${sys.diskTotal} GB`,
          `Display ${sys.resolution} · ${sys.wm}`,
        ],
      }],
      chips: [{ label: 'Open System Monitor', send: 'open system monitor' }],
    });
  },
});

/* ---- files -------------------------------------------------------- */
skill({
  id: 'files',
  match: q => (has(q, 'file', 'folder', 'find', 'where is', 'desktop', 'documents', 'downloads')
    ? { score: 5, params: { q } } : null),
  run: ({ q }, ctx) => {
    const term = q.replace(/\b(find|where|is|the|a|an|file|files|folder|my|on|in|show|me)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!term) {
      const items = ctx.api.vfs.ls(`${ctx.api.vfs.HOME}/Desktop`);
      return answer(`${items.length} things on the desktop:`, {
        cards: [{ title: 'Desktop', icon: 'monitor', lines: items.map(n => n.name) }],
      });
    }
    const hits = ctx.api.vfs.search(term, { limit: 6 });
    if (!hits.length) return answer(`Nothing in the filesystem matches "${term}".`, { kind: 'unsure' });
    return answer(`Found ${hits.length}:`, {
      cards: hits.map(hitl => ({
        title: hitl.node.name, icon: ctx.api.vfs.iconFor(hitl.node),
        lines: [hitl.path.replace(ctx.api.vfs.HOME, '~')],
        file: hitl.path,
      })),
    });
  },
});

/* ---- time --------------------------------------------------------- */
skill({
  id: 'time',
  match: q => (has(q, 'what time', 'the time', 'what is the date', 'what day', "today's date") ? { score: 9 } : null),
  run: (_, ctx) => {
    const d = new Date();
    return answer(`It is ${ctx.api.fmt.fmtClock(d).time} ${ctx.api.fmt.fmtClock(d).ap} on ${ctx.api.fmt.fmtDateLong(d)}.`);
  },
});

/* ---- media -------------------------------------------------------- */
skill({
  id: 'media',
  match: q => (has(q, 'playing', 'music', 'song', 'track', 'pause', 'skip', 'next song') ? { score: 7, params: { q } } : null),
  run: ({ q }, ctx) => {
    if (has(q, 'pause', 'stop')) { ctx.api.bus.emit('media:pause'); return answer('Paused.', { kind: 'action', did: 'paused playback' }); }
    if (has(q, 'skip', 'next')) { ctx.api.bus.emit('media:next'); return answer('Skipped.', { kind: 'action', did: 'skipped a track' }); }
    if (has(q, 'play', 'resume')) { ctx.api.bus.emit('media:play'); return answer('Playing.', { kind: 'action', did: 'resumed playback' }); }
    return answer('Opening Music so you can see what is queued.', {
      kind: 'action', did: 'opened Music', chips: [{ label: 'Pause', send: 'pause the music' }],
    });
  },
});

/* ---- the honest fallback ------------------------------------------ */
function fallback(q, ctx) {
  return {
    say: `I can't answer that one — I'm a skill engine, so I only handle things I can actually do in ${ctx.brand}. I can search it instead, or you can put a real model behind me (see aetherium.js).`,
    kind: 'unsure',
    chips: [
      { label: `Search for "${clean(q).slice(0, 24)}"`, send: `__search__${clean(q)}` },
      { label: 'What can you do?', send: 'what can you do' },
    ],
    cards: [],
    did: null,
  };
}

/* ------------------------------------------------------------------ *
 *  ask
 * ------------------------------------------------------------------ */
export async function ask(text, ctx) {
  const q = low(text);
  if (!q) return null;

  let best = null;
  for (const s of SKILLS) {
    let m = null;
    try { m = s.match(q, ctx); } catch (err) { m = null; }
    if (m && (!best || m.score > best.m.score)) best = { s, m };
  }

  if (best) {
    try { return await best.s.run(best.m.params || {}, ctx, text); }
    catch (err) {
      return { say: `That skill failed: ${err.message}`, kind: 'unsure', chips: [], cards: [], did: null };
    }
  }

  if (config.mode === 'api' && config.endpoint && config.apiKey) {
    try { return await askModel(text, ctx); }
    catch (err) {
      return { say: `The model did not answer (${err.message}). Falling back to skills only.`,
               kind: 'unsure', chips: [], cards: [], did: null };
    }
  }
  /* Labs: the free model answers what no skill covers (Settings › Labs) */
  if (ctx.api?.store?.get('prefs.labStaticumAI')) {
    try {
      const { stream } = await import('./llm.js');
      const say = await stream([
        { role: 'system', content: `You are ${config.name}, the assistant inside ${ctx.brand}, a desktop OS in the browser with games, anime and creative apps. Answer briefly and plainly. If asked to do something in the OS you cannot do, say so.` },
        { role: 'user', content: text },
      ]);
      return { say: String(say || '').trim(), kind: 'answer', chips: [], cards: [], did: null };
    } catch (err) {
      return { say: `The AI model didn't answer (${err.message}).`, kind: 'unsure', chips: [], cards: [], did: null };
    }
  }
  return fallback(text, ctx);
}

/** One place to wire a real model. Kept deliberately small. */
async function askModel(text, ctx) {
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 700,
      system: `You are ${config.name}, the assistant inside ${ctx.brand}, a desktop shell in the browser. Be brief and concrete.`,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const say = (data.content || []).map(c => c.text).filter(Boolean).join('\n') || '(empty reply)';
  return { say, kind: 'answer', chips: [], cards: [], did: null };
}

export const skills = () => SKILLS.map(s => s.id);
export default { config, ask, skills };
