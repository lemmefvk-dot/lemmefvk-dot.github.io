/* ============================================================
   Staticum — the assistant surface.

   The thinking lives in js/portal/aetherium.js; this file is
   only its face: a log of turns, a composer, and a sheet for
   pointing the engine at a real model. Nothing here touches the
   network — the engine does, and only once you hand it a key.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { BRAND } from '../portal/brand.js';
import { ask, config, skills } from '../portal/aetherium.js';

/* store.js persists everything under `portal.*`, so the sheet lands here */
const SETTINGS = 'portal.aetherium';
/* the engine marks "send this to the browser, not to me" with this prefix */
const SEARCH_PREFIX = '__search__';
const MAX_BOX = 132;      /* matches .ch__box textarea's max-height */
const MAX_HISTORY = 60;

/* sidebar prompts: [label, what it actually sends, icon] */
const STARTERS = [
  ['System status',      'system status',      'activity'],
  ['Top rated anime',    'top rated anime',    'star'],
  ['Find a racing game', 'find a racing game', 'gamepad'],
  ['Open Lens',          'open lens',          'scan'],
  ['Dark mode',          'dark mode',          'moon'],
  ['What can you do?',   'what can you do',    'help-circle'],
];

/* the four on the empty state */
const HERO_PROMPTS = [
  ['System status',      'system status'],
  ['Top rated anime',    'top rated anime'],
  ['Find a racing game', 'find a racing game'],
  ['What can you do?',   'what can you do'],
];

/* providers drags in the 7.9 MB catalogue, so it is pulled on the first
   question instead of at open — the window paints instantly either way. */
let PROVIDERS = null;
let provPending = null;
function loadProviders() {
  if (PROVIDERS) return Promise.resolve(PROVIDERS);
  if (!provPending) {
    provPending = import('../portal/providers.js')
      .then(m => (PROVIDERS = m.providers || m.default || m))
      .catch(err => { provPending = null; throw err; });
  }
  return provPending;
}

defineApp({
  id: 'aetherium',
  name: 'Staticum',
  icon: 'sparkles',
  g1: '#ffb0d0', g2: '#8a1050',
  category: 'System',
  keywords: ['assistant', 'ai', 'ask', 'agent', 'chat', 'skills'],
  desc: 'Ask for things and have them done',
  pinned: true, dock: true, singleton: true,
  win: { w: 860, h: 640, minW: 520, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, store, hasIcon } = api;

    /* ---------------- state ---------------- */
    const S = {
      turns: 0,        // exchanges rendered, so the hero knows when to go
      busy: false,     // one question in flight at a time
      history: [],     // what was sent, for ArrowUp
      hIdx: -1,        // where ArrowUp has walked back to
      sheet: false,    // model sheet shown instead of the log
      gen: 0,          // bumped on reset; a stale answer checks it before landing
      alive: true,     // false after teardown; async work checks it
    };

    /* saved settings -> engine config, before anything is painted */
    const saved = store.get(SETTINGS) || {};
    if (saved.mode === 'api' || saved.mode === 'local') config.mode = saved.mode;
    if (typeof saved.endpoint === 'string') config.endpoint = saved.endpoint || null;
    if (typeof saved.model === 'string') config.model = saved.model || null;
    if (typeof saved.apiKey === 'string') config.apiKey = saved.apiKey || null;

    const modeLabel = () => (config.mode === 'api' ? (config.model || 'api') : 'local');
    const engineCtx = () => ({ brand: BRAND.name, api, providers: PROVIDERS });

    /* ---------------- layout --------------- */
    const side = h('aside.ae__side');
    const log = h('div.ae__log', {
      role: 'log', 'aria-live': 'polite', 'aria-label': `${config.name} conversation`,
    });
    const sheet = h('div.app__content.hidden');

    const ta = h('textarea', {
      rows: '1',
      placeholder: `Ask ${config.name}…`,
      'aria-label': `Ask ${config.name}`,
      spellcheck: 'false',
      oninput: () => { S.hIdx = -1; grow(); syncSend(); },
      onkeydown: onComposerKey,
    });
    const sendBtn = h('button.ch__send', {
      type: 'button', 'aria-label': 'Send', disabled: true, onclick: () => submit(),
    }, icon('arrow-right'));
    const composer = h('div.ch__composer', h('div.ch__box', ta, sendBtn));

    const main = h('div.ae__main', log, sheet, composer);
    root.appendChild(h('div.app.ae', side, main));

    /* ---------------- title bar ------------ */
    const toolNew = h('button.ibtn.tip', {
      'data-tip': 'New conversation', 'aria-label': 'New conversation', onclick: () => newConversation(),
    }, icon('plus'));
    const toolSheet = h('button.ibtn.tip', {
      'data-tip': 'Model', 'aria-label': 'Model settings',
      onclick: () => (S.sheet ? closeSheet() : openSheet()),
    }, icon('sliders'));
    win.setTools(toolNew, toolSheet);

    const syncSubtitle = () => win.setSubtitle(modeLabel());
    function syncTools() {
      toolSheet.classList.toggle('is-on', S.sheet);
      toolNew.disabled = S.sheet;
    }

    /* ---------------- composer ------------- */
    function grow() {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, MAX_BOX)}px`;
    }
    function syncSend() { sendBtn.disabled = S.busy || !ta.value.trim(); }

    function setComposer(v) {
      ta.value = v;
      grow(); syncSend();
      try { ta.setSelectionRange(v.length, v.length); } catch (err) { /* detached */ }
    }

    /** Enter sends, Shift+Enter newlines, ArrowUp walks back through history. */
    function onComposerKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
      if (e.key === 'Escape' && ta.value) { e.preventDefault(); S.hIdx = -1; setComposer(''); return; }
      const recalled = S.hIdx >= 0 && ta.value === S.history[S.hIdx];
      if (e.key === 'ArrowUp' && S.history.length && (!ta.value || recalled)) {
        e.preventDefault();
        S.hIdx = S.hIdx < 0 ? S.history.length - 1 : Math.max(0, S.hIdx - 1);
        setComposer(S.history[S.hIdx]);
        return;
      }
      if (e.key === 'ArrowDown' && recalled) {
        e.preventDefault();
        S.hIdx += 1;
        if (S.hIdx >= S.history.length) { S.hIdx = -1; setComposer(''); }
        else setComposer(S.history[S.hIdx]);
      }
    }

    function submit() {
      const text = ta.value.trim();
      if (!text || S.busy) return;
      S.hIdx = -1;
      setComposer('');
      send(text);
    }

    /* ---------------- the log -------------- */
    const scrollDown = () => api.raf(`ae-log:${win.id}`, () => {
      if (S.alive) log.scrollTop = log.scrollHeight;   // the frame can land after close
    });

    function pushTurn(node) {
      if (!S.turns) api.clear(log);      // the hero goes on the first turn
      S.turns += 1;
      log.appendChild(node);
      scrollDown();
    }

    function chipBtn(label, text) {
      return h('button.ae-chip', { type: 'button', text: label, onclick: () => runChip(text) });
    }

    /** A chip either asks the engine or — when it is flagged — opens a search. */
    function runChip(text) {
      const t = String(text || '');
      if (t.startsWith(SEARCH_PREFIX)) {
        const query = t.slice(SEARCH_PREFIX.length).trim();
        api.openApp('browser', { url: `static://search?q=${encodeURIComponent(query)}` });
        return;
      }
      send(t);
    }

    function hero() {
      return h('div.ae__hero',
        h('div.ae__orb', icon('sparkles')),
        h('h2', { text: config.name }),
        h('p', { text: `A skill engine, not a chatbot. It runs entirely on this machine and does real things inside ${BRAND.name} — opens apps, searches the catalogues, changes the look, reads the system — and says so plainly when something is out of reach.` }),
        h('div.ae-chips', HERO_PROMPTS.map(([label, text]) => chipBtn(label, text))));
    }

    function addMe(text) {
      pushTurn(h('div.ae-turn.ae-turn--me',
        h('div.ae-turn__ico', icon('user')),
        h('div.ae-turn__b',
          h('div.ae-turn__who', { text: 'You' }),
          h('div.ae-turn__t', { text }))));
    }

    function cardEl(card) {
      const name = card.icon && hasIcon(card.icon) ? card.icon : 'sparkles';
      const title = card.title || 'Untitled';
      const kids = [
        h('div.ae-card__h', icon(name), h('b', { text: title })),
        (card.lines || []).map(line => h('div.ae-card__l', { text: String(line) })),
      ];
      if (!card.open && !card.file && typeof card.onOpen !== 'function') return h('div.ae-card', kids);
      const label = card.onOpen ? `Play ${title}` : card.open ? `Open ${title} in the browser` : `Open ${title}`;
      return h('button.ae-card', {
        type: 'button', 'aria-label': label, title: label,
        style: { display: 'block', width: '100%', textAlign: 'left' },
        onclick: () => {
          if (typeof card.onOpen === 'function') card.onOpen();
          else if (card.open) api.openApp('browser', { url: card.open });
          else api.openFile(card.file);
        },
      }, kids);
    }

    function addAnswer(res) {
      const who = h('div.ae-turn__who', { text: config.name });
      const head = res.kind === 'unsure'
        ? h('div.row', who, h('span.badge.badge--warn', { text: 'no skill for this' }))
        : who;

      const body = h('div.ae-turn__b', head, h('div.ae-turn__t', { text: res.say || '' }));
      if (res.did) body.appendChild(h('div.ae-turn__did', icon('check'), h('span', { text: res.did })));
      for (const card of res.cards || []) body.appendChild(cardEl(card));
      const chips = (res.chips || []).filter(c => c && c.label);
      if (chips.length) body.appendChild(h('div.ae-chips', chips.map(c => chipBtn(c.label, c.send))));

      pushTurn(h('div.ae-turn.ae-turn--ae', h('div.ae-turn__ico', icon('sparkles')), body));
    }

    async function send(text) {
      const q = String(text || '').trim();
      if (!q || S.busy) return;
      if (S.sheet) closeSheet();

      S.busy = true; syncSend();
      const gen = S.gen;
      if (S.history[S.history.length - 1] !== q) S.history.push(q);
      if (S.history.length > MAX_HISTORY) S.history.shift();
      addMe(q);

      const think = h('div.ae__think', h('div.spinner'), h('span', { text: 'thinking…' }));
      log.appendChild(think);
      scrollDown();

      let res = null, failed = null;
      try {
        await loadProviders();
        res = await ask(q, engineCtx());
      } catch (err) {
        failed = err;
      }
      if (!S.alive) return;
      think.remove();
      /* the log was cleared under us — let the stale answer go */
      if (gen !== S.gen) return;
      S.busy = false;

      if (failed) {
        addAnswer({ say: `I could not run that: ${failed.message}`, kind: 'unsure' });
      } else if (!res) {
        addAnswer({ say: 'There was nothing in that to answer.', kind: 'unsure' });
      } else {
        addAnswer(res);
      }
      syncSend();
      if (win.el.classList.contains('is-active') && !S.sheet) ta.focus();
    }

    function newConversation() {
      closeSheet();
      api.clear(log);
      S.turns = 0;
      S.hIdx = -1;
      S.gen += 1;            // anything still in flight belongs to the old log
      S.busy = false;
      log.appendChild(hero());
      setComposer('');
      ta.focus();
    }

    /* ---------------- sidebar -------------- */
    function paintSide() {
      api.clear(side);
      const ids = skills();
      const local = config.mode !== 'api';

      side.append(
        h('button.btn.btn--primary.btn--block', { type: 'button', onclick: () => newConversation() },
          icon('plus'), h('span', { text: 'New conversation' })),

        h('div.col', { style: { gap: 'var(--sp-3)' } },
          h('div.label', { text: 'Try asking' }),
          h('div.col', { style: { gap: '2px' } },
            STARTERS.map(([label, text, ic]) => h('button.side__item', {
              type: 'button', title: label, onclick: () => send(text),
            }, icon(ic), h('span', { text: label }))))),

        h('div.col', { style: { gap: 'var(--sp-3)' } },
          h('div.row', h('div.label.grow', { text: 'Skills' }), h('small.dim', { text: String(ids.length) })),
          h('div.ae-chips', ids.map(id => h('span.chip', { text: id })))),

        h('div.card', { style: { marginTop: 'auto', padding: 'var(--sp-4)' } },
          h('div.card__head', { style: { marginBottom: 'var(--sp-3)' } },
            icon('shield'),
            h('div.card__t.grow', { text: 'Runs locally' }),
            h(local ? 'span.badge' : 'span.badge.badge--accent', { text: modeLabel() })),
          h('div.ae-card__l', {
            text: local
              ? `Answers are worked out on this machine — no network, no key, nothing leaves ${BRAND.name}.`
              : `Skills still run here; only what they do not claim goes to ${config.model || 'your endpoint'}.`,
          }),
          h('button.btn.btn--sm.btn--ghost', {
            type: 'button', style: { marginTop: 'var(--sp-4)' }, onclick: () => openSheet(),
          }, icon('sliders'), h('span', { text: 'Connect a model' }))),
      );
    }

    /* ---------------- model sheet ---------- */
    function openSheet() {
      S.sheet = true;
      paintSheet();
      log.classList.add('hidden');
      composer.classList.add('hidden');
      sheet.classList.remove('hidden');
      syncTools();
      sheet.querySelector('button')?.focus();
    }

    function closeSheet() {
      if (!S.sheet) return;
      S.sheet = false;
      sheet.classList.add('hidden');
      log.classList.remove('hidden');
      composer.classList.remove('hidden');
      api.clear(sheet);
      syncTools();
    }

    function paintSheet() {
      api.clear(sheet);
      const draft = {
        mode: config.mode === 'api' ? 'api' : 'local',
        endpoint: config.endpoint || '',
        model: config.model || '',
        apiKey: config.apiKey || '',
      };

      const row = (ic, title, desc, ...ctrl) => h('div.set-row',
        h('div.set-row__ico', icon(ic)),
        h('div.set-row__t', h('b', { text: title }), desc ? h('small', { text: desc }) : null),
        h('div.set-row__c', ctrl.filter(Boolean)));

      const modeTabs = h('div.tabs', { role: 'group', 'aria-label': 'Mode' });
      const syncTabs = () => [...modeTabs.children]
        .forEach(b => b.classList.toggle('is-on', b.dataset.v === draft.mode));
      modeTabs.append(...[['local', 'Local'], ['api', 'API']].map(([v, label]) => h('button', {
        type: 'button', text: label, dataset: { v },
        onclick: () => { draft.mode = v; syncTabs(); syncMode(); },
      })));
      syncTabs();

      const inputs = [];
      const textRow = (ic, title, desc, key, type, placeholder) => {
        const input = h('input', {
          type, value: draft[key], placeholder, spellcheck: 'false',
          autocomplete: 'off', autocapitalize: 'off', 'aria-label': title,
          oninput: e => { draft[key] = e.target.value; },
        });
        const el = row(ic, title, desc, h('div.field', { style: { width: '236px' } }, input));
        inputs.push(input);
        return el;
      };

      const rowEndpoint = textRow('globe', 'Endpoint', 'The messages URL each request is POSTed to.',
        'endpoint', 'text', 'https://api.anthropic.com/v1/messages');
      const rowModel = textRow('cpu', 'Model', 'Model id sent with every request.',
        'model', 'text', 'claude-sonnet-4-5');
      const rowKey = textRow('lock', 'API key', 'Sent as the x-api-key header, nowhere else.',
        'apiKey', 'password', 'sk-…');

      /* API fields stay visible in Local mode, just plainly inert */
      function syncMode() {
        const off = draft.mode !== 'api';
        for (const el of [rowEndpoint, rowModel, rowKey]) el.style.opacity = off ? '.5' : '1';
        for (const input of inputs) input.disabled = off;
      }

      const status = h('div.row', { style: { flexWrap: 'wrap', gap: 'var(--sp-3)' } });
      function setStatus(tone, text) {
        api.render(status,
          tone === 'busy' ? h('div.spinner') : null,
          tone === 'ok' ? h('span.badge.badge--ok', { text: 'ok' }) : null,
          tone === 'bad' ? h('span.badge.badge--bad', { text: 'failed' }) : null,
          tone === 'warn' ? h('span.badge.badge--warn', { text: 'incomplete' }) : null,
          h('small.dim', { text, style: { lineHeight: '1.5' } }));
      }
      setStatus(null, 'Not tested yet.');

      const testBtn = h('button.btn', { type: 'button', onclick: () => runTest() }, icon('zap'), h('span', { text: 'Test API' }));
      const saveBtn = h('button.btn.btn--primary', { type: 'button', onclick: () => save() }, icon('check'), h('span', { text: 'Save' }));

      function save() {
        const next = {
          mode: draft.mode === 'api' ? 'api' : 'local',
          endpoint: draft.endpoint.trim(),
          model: draft.model.trim(),
          apiKey: draft.apiKey.trim(),
        };
        config.mode = next.mode;
        config.endpoint = next.endpoint || null;
        config.model = next.model || null;
        config.apiKey = next.apiKey || null;
        store.set(SETTINGS, next);          // the sub below repaints the rest
        /* saved either way, but a half-filled API mode is not a green light */
        const half = next.mode === 'api' && !(next.endpoint && next.apiKey);
        setStatus(half ? 'warn' : 'ok', next.mode === 'local'
          ? 'Saved. Everything is answered on this machine.'
          : next.endpoint && next.apiKey
            ? `Saved. Anything the skills do not claim goes to ${next.model || 'the endpoint'}.`
            : 'Saved, but API mode needs both an endpoint and a key — until then only skills answer.');
      }

      async function runTest() {
        testBtn.disabled = true;
        setStatus('busy', 'Asking “hello”…');
        try {
          await loadProviders();
          const res = await ask('hello', engineCtx());
          if (!S.alive) return;
          const note = draft.mode === 'api'
            ? ' (“hello” is claimed by a local skill, so this proves the engine, not your endpoint.)'
            : '';
          setStatus('ok', `${res.kind} — ${res.say}${note}`);
        } catch (err) {
          if (!S.alive) return;
          setStatus('bad', err.message);
        } finally {
          if (S.alive) testBtn.disabled = false;
        }
      }

      sheet.append(
        h('div.row', { style: { marginBottom: 'var(--sp-5)' } },
          h('button.ibtn.tip', {
            type: 'button', 'data-tip': 'Back', 'aria-label': 'Back to the conversation',
            onclick: () => { closeSheet(); ta.focus(); },
          }, icon('chevron-left')),
          h('div.h-sec', { text: 'Connect a model' })),

        h('div.set-group',
          row('sliders', 'Mode', 'Local answers here. API forwards only what no skill claims.', modeTabs),
          rowEndpoint, rowModel, rowKey,
          h('div.set-row',
            h('div.set-row__ico', icon('info')),
            h('div.set-row__t', h('small', {
            text: `The key is kept in this browser only — stored with your other settings and sent to nothing but the endpoint above. Local mode needs nothing at all: no key, no endpoint, no network.`,
            }))),
          h('div.set-row',
            h('div.set-row__t', status),
            h('div.set-row__c', testBtn, saveBtn))),
      );

      syncMode();
    }

    /* ---------------- keyboard ------------- */
    const onKey = e => {
      if (!S.alive || !win.el.classList.contains('is-active')) return;
      if (e.key === 'Escape' && S.sheet) { e.preventDefault(); closeSheet(); ta.focus(); return; }
      const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
      if (e.key === '/' && !S.sheet && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); ta.focus(); }
    };
    window.addEventListener('keydown', onKey);

    /* settings can also change from outside (a reset, another window) */
    const offSettings = store.sub(SETTINGS, () => {
      if (!S.alive) return;
      syncSubtitle();
      paintSide();
    });

    win.onReopen(o => {
      if (o && o.ask) send(String(o.ask));
      else if (!S.sheet) ta.focus();     // the composer is hidden behind the sheet
    });

    /* ---------------- first paint ---------- */
    syncSubtitle();
    syncTools();
    paintSide();
    log.appendChild(hero());
    grow();
    syncSend();
    if (opts && opts.ask) send(String(opts.ask));
    else ta.focus();

    return () => {
      S.alive = false;
      window.removeEventListener('keydown', onKey);
      offSettings();
    };
  },
});
