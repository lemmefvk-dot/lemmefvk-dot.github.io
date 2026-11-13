/* ============================================================
   devroom.js — the Developer Room (section 34, "developer room").

   A hidden app: not in the launcher, the Dock or search. The
   developer account's menu opens it, and so does one unlisted word
   at the Linux terminal. Everything in it is this machine's real
   state, read live:

     Overview   version, build, what failed to load, the apps
     Storage    what StaticOS keeps in this browser, key by key
     Events     the OS event bus as it happens
     Flags      every on/off preference, as a switch
     Apps       every registered app, hidden ones included
     Service    the service worker and caches, with a repair button

   It only ever reads, except where a button says otherwise.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as BC from '../core/broadcast-schema.js';
import * as profiles from '../core/profiles.js';
import { appTile } from '../core/appart.js';
import { earlyAccessCard } from '../core/earlyaccess.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-devroom-css')) {
  const l = document.createElement('link');
  l.id = 'feat-devroom-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-devroom.css';
  document.head.appendChild(l);
}

const TABS = [
  ['overview', 'Overview', 'info'],
  ['storage', 'Storage', 'database'],
  ['events', 'Events', 'activity'],
  ['flags', 'Flags', 'sliders'],
  ['apps', 'Apps', 'grid-9'],
  ['service', 'Service', 'shield'],
  ['admin', 'Admin abuse', 'zap'],     /* developer account only */
];
const isDev = store => !!store.get('session.user', null)?.dev;
const tabsFor = store => TABS.filter(t => t[0] !== 'admin' || isDev(store));

const bytes = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
/* localStorage holds UTF-16, so a string's footprint is ~2 bytes a char */
const sizeOf = v => { try { return (JSON.stringify(v) || '').length * 2; } catch (e) { return 0; } };
const short = v => {
  let s;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { s = String(v); }
  s = String(s ?? '');
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
};

defineApp({
  id: 'devroom',
  name: 'Developer Room',
  icon: 'terminal',
  g1: '#5bffa8', g2: '#064e3b',
  category: 'System',
  keywords: [],
  desc: 'What StaticOS is doing, from the inside',
  hidden: true,
  singleton: true,
  win: { w: 860, h: 580, minW: 520, minH: 380 },

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, clear, store, bus } = api;
    let dead = false;
    let tab = tabsFor(api.store).some(t => t[0] === opts?.tab) ? opts.tab : 'overview';

    const side = h('aside.app__side.dr-side');
    const title = h('div.app__title');
    const sub = h('span.dim');
    const tools = h('div.row', { style: { gap: '6px' } });
    const body = h('div.app__content.dr');
    root.appendChild(h('div.app.dr-app', side, h('div.app__main', h('div.app__bar', title, sub, h('div.grow'), tools), body)));
    win.setSubtitle('staticos://dev');

    /* finding the room is itself a secret */
    bus.emit('egg:found', { id: 'devroom' });

    const kv = (k, v, mono = true) => h('div.dr-kv', h('span', { text: k }), h(mono ? 'code' : 'b', { text: v }));
    const card = (label, ...kids) => h('section.dr-card', h('div.dr-card__h', { text: label }), ...kids);
    const btn = (label, ic, run, danger) => h(`button.btn.btn--sm${danger ? '.dr-danger' : ''}`, {
      type: 'button', onclick: async () => { try { await run(); } catch (e) { api.notify({ app: 'Developer Room', icon: 'alert', title: 'Failed', message: String(e?.message || e) }); } if (!dead) paint(); },
    }, ic ? icon(ic) : null, label);

    /* ---------------- overview ---------------- */
    let meta = null;
    async function loadMeta() {
      const get = u => fetch(u, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const [c, b] = await Promise.all([get('data/changelog.json'), get('build.json')]);
      meta = { top: Array.isArray(c) ? c[0] : null, build: b || {} };
      if (!dead && tab === 'overview') paint();
    }
    function overview() {
      if (!meta) loadMeta();
      const B = window.__staticBoot || {};
      const fails = Array.isArray(B.failures) ? B.failures : [];
      const all = api.listApps({ includeHidden: true });
      const u = store.get('session.user', null);
      /* the beta site is early access itself; only the stable site links across */
      const early = u?.dev && document.documentElement.dataset.channel !== 'beta'
        ? card('Early access', earlyAccessCard(h, icon)) : null;
      body.append(
        h('div.dr-grid',
          early,
          card('System',
            kv('Version', meta?.top ? `${meta.top.version}${meta.top.name ? ` · ${meta.top.name}` : ''}` : '…'),
            kv('Build', meta?.build?.build ? String(meta.build.build) : meta ? 'unknown' : '…'),
            kv('Boot', B.ok ? 'ok' : B.alive ? 'shell up, boot not finished' : 'watchdog only'),
            kv('Uptime', `${Math.round(performance.now() / 1000)} s`),
            kv('Drive', document.body.dataset.drive || document.body.dataset.os || 'plain'),
            kv('Signed in', u ? `${u.username}${u.dev ? ' (developer)' : ''}` : 'no')),
          card('Modules',
            kv('Apps registered', String(all.length)),
            kv('Hidden apps', String(all.filter(a => a.hidden).length)),
            kv('Windows open', String(api.wm?.list?.().length ?? '—')),
            fails.length
              ? h('div.dr-fails', fails.map(f => h('div', icon('alert'), h('code', { text: f }))))
              : h('div.dr-ok', icon('check-circle'), h('span', { text: 'Every module loaded.' }))),
          card('Browser',
            kv('User agent', navigator.userAgent.replace(/^Mozilla\/5\.0 /, '')),
            kv('Screen', `${screen.width}×${screen.height} @${devicePixelRatio}×`),
            kv('Cores', String(navigator.hardwareConcurrency || 'not reported')),
            kv('Online', navigator.onLine ? 'yes' : 'no'),
            kv('Service worker', navigator.serviceWorker?.controller ? 'controlling' : 'not controlling'))));
    }

    /* ---------------- storage ---------------- */
    let estimate = null;
    function storage() {
      if (!estimate && navigator.storage?.estimate) {
        estimate = 'loading';
        navigator.storage.estimate().then(e => { estimate = e; if (!dead && tab === 'storage') paint(); }).catch(() => { estimate = 'n/a'; });
      }
      const rows = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        let v = '';
        try { v = localStorage.getItem(k) || ''; } catch (e) {}
        rows.push({ k, n: v.length * 2 });
      }
      rows.sort((a, b) => b.n - a.n);
      const total = rows.reduce((a, r) => a + r.n, 0);

      /* the state blob, broken down by top-level root and portal.* child */
      let state = {};
      try { state = JSON.parse(profiles.local.getItem(profiles.key('staticos.state.v3')) || '{}'); } catch (e) {}
      const roots = Object.entries(state).map(([k, v]) => ({ k, n: sizeOf(v) }));
      if (state.portal && typeof state.portal === 'object') {
        for (const [k, v] of Object.entries(state.portal)) roots.push({ k: `portal.${k}`, n: sizeOf(v) });
      }
      roots.sort((a, b) => b.n - a.n);
      const max = Math.max(1, ...roots.map(r => r.n));
      const bar = r => h('div.dr-bar', h('span', { text: r.k }), h('i', h('b', { style: { width: `${Math.max(1, r.n / max * 100)}%` } })), h('code', { text: bytes(r.n) }));

      const inspect = h('pre.dr-pre', { text: 'Pick a root to see its JSON.' });
      const pick = h('select.dr-select', { 'aria-label': 'State root', onchange: e => {
        const path = e.target.value;
        inspect.textContent = path ? JSON.stringify(store.get(path), null, 2)?.slice(0, 20000) ?? 'undefined' : 'Pick a root to see its JSON.';
      } }, h('option', { value: '', text: 'Inspect…' }), roots.map(r => h('option', { value: r.k, text: r.k })));

      body.append(h('div.dr-grid',
        card('This browser',
          kv('localStorage', `${bytes(total)} in ${rows.length} key${rows.length === 1 ? '' : 's'}`),
          kv('Quota', estimate && estimate !== 'loading' && estimate !== 'n/a' ? `${bytes(estimate.usage || 0)} used of ${bytes(estimate.quota || 0)}` : estimate === 'n/a' ? 'not reported' : '…'),
          rows.map(r => kv(r.k, bytes(r.n)))),
        card('State by root', roots.length ? roots.map(bar) : h('div.dim', { text: 'Empty.' })),
        card('Inspector', pick, inspect)));
    }

    /* ---------------- events ---------------- */
    const log = [];
    let paused = false;
    let showTicks = false;
    let logEl = null;
    const offAny = bus.on('*', (evt, ...args) => {
      if (paused || (!showTicks && /^tick:/.test(evt))) return;
      log.push({ t: new Date(), evt, args: args.length ? short(args.length === 1 ? args[0] : args) : '' });
      if (log.length > 200) log.shift();
      if (logEl && tab === 'events') appendRow(log[log.length - 1]);
    });
    const rowOf = e => h('div.dr-ev', h('time', { text: e.t.toLocaleTimeString([], { hour12: false }) }), h('b', { text: e.evt }), h('code', { text: e.args }));
    function appendRow(e) {
      if (!logEl) return;
      const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
      logEl.appendChild(rowOf(e));
      while (logEl.children.length > 200) logEl.firstChild.remove();
      if (stick) logEl.scrollTop = logEl.scrollHeight;
    }
    function events() {
      logEl = h('div.dr-log', { role: 'log', 'aria-live': 'off' }, log.map(rowOf));
      tools.append(
        btn(paused ? 'Resume' : 'Pause', paused ? 'play' : 'pause', () => { paused = !paused; }),
        btn(showTicks ? 'Hide ticks' : 'Show ticks', 'clock', () => { showTicks = !showTicks; }),
        btn('Clear', 'trash', () => { log.length = 0; }));
      body.append(logEl.children.length ? logEl : h('div', logEl, h('div.dr-hint', { text: 'Waiting for events… open a window or change a setting.' })));
      requestAnimationFrame(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; });
    }

    /* ---------------- flags ---------------- */
    function flags() {
      const p = store.get('prefs', {}) || {};
      const keys = Object.keys(p).filter(k => typeof p[k] === 'boolean').sort();
      body.append(h('div.dr-hint', { text: 'Every on/off preference StaticOS has stored. Switching one here is the same as switching it in Settings.' }),
        h('div.dr-flags', keys.map(k => h('label.dr-flag',
          h('code', { text: k }),
          h('input', { type: 'checkbox', checked: !!p[k], onchange: e => store.set('prefs', { ...(store.get('prefs', {}) || {}), [k]: e.target.checked }) })))));
    }

    /* ---------------- apps ---------------- */
    function apps() {
      const all = api.listApps({ includeHidden: true }).sort((a, b) => a.id.localeCompare(b.id));
      body.append(h('div.dr-apps', all.map(a => h('div.dr-appr',
        appTile(a, { gs: '28px' }),
        h('div.grow', h('b', { text: a.name }), h('code', { text: a.id })),
        a.hidden ? h('span.dr-tag', { text: 'hidden' }) : null,
        h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp(a.id) }, 'Open')))));
    }

    /* ---------------- service worker ---------------- */
    let sw = null;
    async function loadSw() {
      const regs = navigator.serviceWorker?.getRegistrations ? await navigator.serviceWorker.getRegistrations().catch(() => []) : [];
      const keys = typeof caches !== 'undefined' ? await caches.keys().catch(() => []) : [];
      sw = { regs: regs.map(r => ({ scope: r.scope, state: r.active?.state || r.installing?.state || r.waiting?.state || '—' })), caches: keys };
      if (!dead && tab === 'service') paint();
    }
    function service() {
      if (!sw) { loadSw(); body.append(h('div.dr-hint', { text: 'Reading…' })); return; }
      body.append(h('div.dr-grid',
        card('Service workers', sw.regs.length ? sw.regs.map(r => kv(r.scope.replace(location.origin, '') || '/', r.state)) : h('div.dim', { text: 'None registered.' })),
        card('Caches', sw.caches.length ? sw.caches.map(k => kv(k, 'cache')) : h('div.dim', { text: 'None.' })),
        card('Repair',
          h('p.dr-hint', { text: 'Unregisters every service worker and deletes every cache, then reloads — the same fix the boot watchdog offers when the site will not start. Your files and settings are kept.' }),
          btn('Repair and reload', 'refresh', async () => {
            const ok = await api.confirm({ title: 'Repair and reload?', message: 'Service workers and caches are cleared, then the page reloads.', ok: 'Repair' });
            if (!ok) return;
            for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister();
            if (typeof caches !== 'undefined') for (const k of await caches.keys()) await caches.delete(k);
            location.reload();
          }, true))));
      tools.append(btn('Refresh', 'refresh', () => { sw = null; }));
    }

    /* ---------------- admin: broadcast to everyone ----------------
       The dev sign-in is checked in this browser, so it can't be trusted
       to change anyone else's screen. A broadcast therefore goes to the
       developer's Discord as a request, and their bot (on their own
       computer, listening only to their account) publishes it on ✅. */
    const draft = {
      on: true, title: '', message: '', style: 'info', btn: 'none', label: '', url: '', app: 'arcade', opt: '',
      effect: 'none', accent: '', hours: 1,
      promoOn: false, pTitle: '', pMessage: '', pUrl: '', pImage: '', pLabel: 'Visit',
      ai: '',
    };
    let bcLive = undefined;       /* undefined = not fetched yet */
    let adminNote = '';
    let aiBusy = false;

    function draftBroadcast() {
      const now = Date.now();
      const out = { id: `bc-${now.toString(36)}`, at: now, until: now + draft.hours * 3600e3, announcement: null, event: null };
      if (draft.on) {
        let button = null;
        if (draft.btn === 'link') button = { label: draft.label || 'Open', url: draft.url };
        else if (draft.btn === 'app') {
          const key = (BC.BUTTON_APPS[draft.app] || [])[0];
          button = { label: draft.label || 'Open', app: draft.app, opts: key && draft.opt ? { [key]: draft.opt } : {} };
        }
        out.announcement = { title: draft.title, message: draft.message, style: draft.style, button };
      }
      if (draft.effect !== 'none' || draft.accent) out.event = { effect: draft.effect, accent: draft.accent || null };
      if (draft.promoOn) out.promo = { title: draft.pTitle, message: draft.pMessage, url: draft.pUrl, image: draft.pImage || null, label: draft.pLabel };
      return out;
    }

    const BC_KEY = 'portal.bcKey';        /* the developer's private signing key (this device only) */
    const hasKey = () => { const v = store.get(BC_KEY, null); return v && typeof v === 'object' && v.d; };

    async function publishLive(raw, label) {
      const c = BC.cleanBroadcast(raw);
      if (!c.ok) { adminNote = c.errors.join(' '); paint(); return; }
      const priv = store.get(BC_KEY, null);
      if (!priv || !priv.d) { adminNote = 'Set your publishing key first (below), then publish.'; paint(); return; }
      adminNote = 'Signing and sending over the live channel…'; paint();
      try {
        const [SIGN, live] = await Promise.all([import('../core/bcsign.js'), import('../portal/live.js')]);
        const payload = JSON.stringify(c.value);
        const sig = await SIGN.signBroadcast(payload, priv);
        const sent = live.publish('broadcast', JSON.stringify({ p: payload, sig, at: Date.now() }));
        /* stop any local preview and show the real thing on this screen now */
        (await import('../core/broadcast.js')).stopPreview();
        window.dispatchEvent(new CustomEvent('staticos:bc-self', { detail: { p: payload, sig } }));
        bcLive = c.value.clear ? false : c.value;
        adminNote = sent
          ? `Published live${c.value.clear ? ' (cleared)' : ''}. Everyone online with StaticOS sees it now; people who open it later, while it lasts, see it too.`
          : 'Signed, but the live channel isn’t connected yet (a locked-down network may block it). It will send when it connects — or try again.';
      } catch (e) {
        adminNote = 'Could not sign it: ' + (e && e.message || e);
      }
      paint();
    }

    async function setupKey(jwkText) {
      let jwk;
      try { jwk = JSON.parse(jwkText); } catch (e) { adminNote = 'That is not a valid key (expected the JSON I gave you).'; paint(); return; }
      const SIGN = await import('../core/bcsign.js');
      const okKey = await SIGN.keyMatches(jwk).catch(() => false);
      if (!okKey) { adminNote = 'That key does not match this StaticOS build’s public key, so broadcasts signed with it would be ignored. Paste the private key that matches.'; paint(); return; }
      store.set(BC_KEY, jwk);
      adminNote = 'Publishing key saved on this device. You can publish now.';
      paint();
    }

    /* pull the first {...} out of the model's reply, tolerantly */
    function extractJson(text) {
      const t = String(text || '');
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a < 0 || b <= a) return null;
      try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
    }

    /* copy a validated broadcast back into the form fields */
    function applyToDraft(v) {
      draft.on = !!v.announcement;
      if (v.announcement) {
        draft.title = v.announcement.title || '';
        draft.message = v.announcement.message || '';
        draft.style = v.announcement.style || 'info';
        const b = v.announcement.button;
        if (b && b.url) { draft.btn = 'link'; draft.label = b.label || 'Open'; draft.url = b.url; }
        else if (b && b.app) { draft.btn = 'app'; draft.app = b.app; draft.label = b.label || 'Open'; draft.opt = Object.values(b.opts || {})[0] || ''; }
        else draft.btn = 'none';
      }
      draft.effect = v.event?.effect || 'none';
      draft.accent = v.event?.accent || '';
      draft.promoOn = !!v.promo;
      if (v.promo) { draft.pTitle = v.promo.title || ''; draft.pMessage = v.promo.message || ''; draft.pUrl = v.promo.url || ''; draft.pLabel = v.promo.label || 'Visit'; draft.pImage = v.promo.image || ''; }
      const hrs = (v.until - v.at) / 3600e3;
      draft.hours = [0.25, 1, 6, 24, 72, 168].reduce((a, c) => (Math.abs(c - hrs) < Math.abs(a - hrs) ? c : a), 1);
    }

    /* Describe-it: the free model writes a broadcast as JSON, which the SAME
       validator (broadcast-schema.js) then checks. The model can only ever
       fill in the fixed, safe pieces — an announcement, a known effect, an
       accent, a button to an allowed app or an https link, a promo card. It
       cannot run code or produce anything outside that; whatever it returns
       still has to survive cleanBroadcast(), and you still Preview + approve. */
    async function aiGenerate() {
      const want = draft.ai.trim();
      if (!want) { adminNote = 'Type what you want first.'; paint(); return; }
      if (aiBusy) return;
      aiBusy = true; adminNote = 'Asking the model…'; paint();
      const sys = [
        'You turn a StaticOS admin\'s request into a "broadcast" — something shown to everyone using StaticOS. Reply with JSON only: no prose, no code fences, no comments.',
        'A broadcast can ONLY be built from these pieces. Anything else is impossible; never invent fields or capabilities.',
        'announcement (a banner) or null: { "title": string, "message": string, "style": "info" | "event" | "warning", "button": null | { "label": string, "url": "https://..." } | { "label": string, "app": <one app id below>, "opts": {} } }',
        'event or null: { "effect": "none" | "confetti" | "snow" | "disco", "accent": null | one of: ' + BC.ACCENTS.join(', ') + ' }',
        'promo (a small card advertising another website) or null: { "title": string, "message": string, "url": "https://...", "label": string, "image": null | "https://...an image..." }',
        'button app ids: ' + Object.keys(BC.BUTTON_APPS).join(', ') + '.',
        'Output EXACTLY this object: { "announcement": <object|null>, "event": <object|null>, "promo": <object|null>, "hours": <number 0.25 to 168, how long it lasts> }.',
        'Fill in only what the request asks for; use null for the rest. Every link must be https. If the request asks for something a broadcast cannot do — run code, force a redirect, change a person\'s settings, show fake numbers — leave that part out.',
      ].join('\n');
      try {
        const LLM = await import('../portal/llm.js');
        let raw = '';
        await LLM.stream(
          [{ role: 'system', content: sys }, { role: 'user', content: want.slice(0, 600) }],
          { onText: t => { raw = t; }, onWait: info => { adminNote = info.reason === 'busy' ? 'The model is busy — waiting…' : 'Waiting for the model…'; paint(); } },
        );
        const json = extractJson(raw);
        if (!json || typeof json !== 'object') { adminNote = 'The model didn’t return usable JSON. Try wording it more simply.'; return; }
        const now = Date.now();
        const hrs = Number(json.hours) > 0 ? Math.min(168, Number(json.hours)) : 1;
        const c = BC.cleanBroadcast({ id: `bc-${now.toString(36)}`, at: now, until: now + hrs * 3600e3,
          announcement: json.announcement || null, event: json.event || null, promo: json.promo || null }, now);
        if (!c.ok) { adminNote = 'That didn’t pass the safety check: ' + c.errors.join(' ') + ' — edit it below or try again.'; return; }
        applyToDraft(c.value);
        adminNote = 'Filled in below — check it, Preview, then Publish.';
      } catch (e) {
        adminNote = e && e.code === 'offline' ? 'Couldn’t reach the model (this network may block it).'
          : e && e.code === 'busy' ? 'The model is busy right now — try again in a few seconds.'
            : 'The model didn’t answer (' + (e?.message || e) + ').';
      } finally {
        aiBusy = false; paint();
      }
    }

    function keyCard() {
      if (hasKey()) {
        return h('section.dr-card',
          h('div.dr-card__h', { text: 'Publishing key' }),
          h('div.dr-ok', icon('check-circle'), h('span', { text: 'Set on this device — you can publish. Only a broadcast signed with your key is shown to anyone.' })),
          h('div.row', { style: { marginTop: 'var(--sp-3)' } },
            btn('Forget this key', 'trash', () => { store.set('portal.bcKey', null); adminNote = 'Key removed from this device.'; }, true)));
      }
      const keyIn = h('textarea.dr-in', { rows: '2', spellcheck: 'false', 'aria-label': 'Publishing key',
        placeholder: '{"kty":"EC","crv":"P-256","x":"…","y":"…","d":"…"}  — the private key you were given' });
      return h('section.dr-card.dr-ai',
        h('div.dr-card__h', { text: 'Set your publishing key (once)' }),
        h('p.dr-hint', { style: { margin: '0 0 var(--sp-2)' }, text: 'Broadcasts are signed so only you can send them. Paste the private key you were given (it stays on this device, never uploaded). Without it you can Preview but not Publish.' }),
        keyIn,
        h('div.row', { style: { marginTop: '6px' } }, btn('Save key', 'check', () => setupKey(keyIn.value))));
    }

    function admin() {
      if (!isDev(store)) { tab = 'overview'; paint(); return; }
      if (bcLive === undefined) {
        bcLive = null;
        fetch('data/broadcast.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => {
          const c = j ? BC.cleanBroadcast(j) : null;
          bcLive = c && c.ok && !c.value.clear ? c.value : false;
          if (!dead && tab === 'admin') paint();
        });
      }
      const field = (label, el) => h('label.dr-field', h('span', { text: label }), el);
      const input = (key, attrs = {}) => {
        const el = h(attrs.rows ? 'textarea.dr-in' : 'input.dr-in', { ...attrs, 'aria-label': attrs['aria-label'] || key });
        el.value = draft[key];
        el.addEventListener('input', () => { draft[key] = el.value; });
        return el;
      };
      const select = (key, items, onChange) => {
        const el = h('select.dr-select', { onchange: e => { draft[key] = key === 'hours' ? Number(e.target.value) : e.target.value; onChange?.(); } },
          items.map(([v, l]) => h('option', { value: String(v), text: l, selected: String(draft[key]) === String(v) })));
        return el;
      };
      const optKey = (BC.BUTTON_APPS[draft.app] || [])[0];
      const OPT_HINT = { game: 'Arcade game id, e.g. snake', tab: 'home, discover, multiplayer, arcade or creations', prompt: 'A game idea to start with', url: 'static://games/<id>', section: 'e.g. Themes' };

      const aiIn = h('textarea.dr-in', { rows: '2', 'aria-label': 'Describe your broadcast',
        placeholder: 'e.g. Announce the game jam starts at 5, add a Play button, and make it snow' });
      aiIn.value = draft.ai;
      aiIn.addEventListener('input', () => { draft.ai = aiIn.value; });
      aiIn.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); aiGenerate(); } });

      body.append(
        h('section.dr-card.dr-ai',
          h('div.dr-card__h', { text: 'Describe it' }),
          h('p.dr-hint', { style: { margin: '0 0 var(--sp-2)' }, text: 'Type what you want and the free model fills the fields below from the available pieces — an announcement, an effect, an accent, a button or a promo card. It can’t run code or do anything outside those, and you still Preview and approve.' }),
          aiIn,
          h('div.row', { style: { gap: '6px', marginTop: '6px' } },
            h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: aiBusy, onclick: aiGenerate },
              aiBusy ? h('div.spinner') : icon('sparkles'), aiBusy ? 'Working…' : 'Generate'),
            h('small.dim', { text: '⌘/Ctrl+Enter' }))),
        h('div.dr-hint', { text: 'Or fill it in yourself, then Publish. It goes out live over StaticOS’s shared channel, signed with your key so only you can push to everyone — no Discord, no server. People online see it now; the live channel may be blocked on some locked-down networks.' }),
        keyCard(),
        h('div.dr-grid',
          card('Live now',
            bcLive === null ? h('div.dim', { text: 'Checking…' })
              : bcLive ? h('pre.dr-pre', { text: BC.describeBroadcast(bcLive) }) : h('div.dim', { text: 'Nothing is being broadcast.' }),
            bcLive ? btn('Clear it for everyone', 'x', () => publishLive({ clear: true, at: Date.now() }), true) : null),
          card('Announcement',
            h('label.dr-flag', h('code', { text: 'Show an announcement banner' }),
              h('input', { type: 'checkbox', checked: draft.on, onchange: e => { draft.on = e.target.checked; paint(); } })),
            draft.on ? h('div.dr-form',
              field('Title', input('title', { maxlength: String(BC.LIMITS.title), placeholder: 'New arcade game!' })),
              field('Message', input('message', { rows: '3', maxlength: String(BC.LIMITS.message), placeholder: 'What everyone should know' })),
              field('Style', select('style', [['info', 'Info'], ['event', 'Event'], ['warning', 'Warning']])),
              field('Button', select('btn', [['none', 'No button'], ['link', 'Open a link (https)'], ['app', 'Open a StaticOS app']], paint)),
              draft.btn !== 'none' ? field('Button label', input('label', { maxlength: String(BC.LIMITS.label), placeholder: 'Play now' })) : null,
              draft.btn === 'link' ? field('Link', input('url', { placeholder: 'https://…', maxlength: String(BC.LIMITS.url) })) : null,
              draft.btn === 'app' ? field('App', select('app', Object.keys(BC.BUTTON_APPS).map(a => [a, a]), () => { draft.opt = ''; paint(); })) : null,
              draft.btn === 'app' && optKey ? field(optKey, input('opt', { placeholder: OPT_HINT[optKey] || '' })) : null) : null),
          card('Event',
            field('Effect', select('effect', [['none', 'None'], ['confetti', 'Confetti'], ['snow', 'Snow'], ['disco', 'Disco colours']])),
            field('Everyone’s accent', select('accent', [['', 'Leave everyone’s own'], ...BC.ACCENTS.map(a => [a, a])])),
            h('div.dr-hint', { text: 'Visitors can turn events off in Settings › Desktop, reduced motion keeps them still, and nobody’s own settings are changed.' })),
          card('Promote a site',
            h('label.dr-flag', h('code', { text: 'Show a card in the corner' }),
              h('input', { type: 'checkbox', checked: draft.promoOn, onchange: e => { draft.promoOn = e.target.checked; paint(); } })),
            draft.promoOn ? h('div.dr-form',
              field('Site name', input('pTitle', { maxlength: String(BC.LIMITS.title), placeholder: 'My other site' })),
              field('Why visit', input('pMessage', { rows: '2', maxlength: String(BC.LIMITS.message), placeholder: 'One line about it' })),
              field('Link', input('pUrl', { placeholder: 'https://…', maxlength: String(BC.LIMITS.url) })),
              field('Picture (optional)', input('pImage', { placeholder: 'https://…/banner.png', maxlength: String(BC.LIMITS.url) })),
              field('Button', input('pLabel', { maxlength: String(BC.LIMITS.label), placeholder: 'Visit' }))) : null,
            h('div.dr-hint', { text: 'A card in the bottom-left corner. The site opens only when someone clicks Visit — nobody is sent anywhere by itself.' })),
          card('Send',
            field('Lasts', select('hours', [[0.25, '15 minutes'], [1, '1 hour'], [6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week']])),
            h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } },
              btn('Preview here', 'eye', async () => {
                const B = await import('../core/broadcast.js');
                const c = B.startPreview(draftBroadcast());
                adminNote = c.ok ? 'Previewing on this device only. Nothing was sent.' : c.errors.join(' ');
              }),
              btn('Stop preview', 'x', async () => { (await import('../core/broadcast.js')).stopPreview(); adminNote = ''; }),
              h('button.btn.btn--sm.btn--primary', { type: 'button', disabled: !hasKey(),
                title: hasKey() ? '' : 'Set your publishing key first',
                onclick: () => publishLive(draftBroadcast()) }, icon('send'), 'Publish now')),
            adminNote ? h('div.dr-note', { role: 'status', text: adminNote }) : null)));
    }

    /* ---------------- chrome ---------------- */
    function paintSide() {
      clear(side);
      side.appendChild(h('div.side__group', h('div.side__label', { text: 'Developer Room' }),
        tabsFor(store).map(([id, label, ic]) => h(`button.side__item${id === tab ? '.is-on' : ''}`, {
          type: 'button', 'aria-current': id === tab ? 'page' : null, onclick: () => { tab = id; paint(); },
        }, icon(ic), h('span', { text: label })))));
      side.appendChild(h('div.dr-sig', { text: 'you are not supposed to be here' }));
    }

    function paint() {
      if (dead) return;
      paintSide();
      clear(body); clear(tools);
      logEl = null;
      if (!tabsFor(store).some(x => x[0] === tab)) tab = 'overview';
      const t = TABS.find(x => x[0] === tab);
      title.textContent = t[1];
      sub.textContent = '';
      ({ overview, storage, events, flags, apps, service, admin })[tab]();
    }
    paint();
    win.onReopen?.(o => { if (o?.tab && tabsFor(store).some(t => t[0] === o.tab)) { tab = o.tab; paint(); } });

    return () => { dead = true; offAny(); };
  },
});
