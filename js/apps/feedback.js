/* ============================================================
   feedback.js — Feedback: send an idea, a bug or a note straight
   to the developer's Discord channel.

   One incoming webhook, one POST, one embed. The developer reads
   it in Discord and reacts ✅ to approve or ❌ to deny. A webhook
   can only post — it cannot see reactions or reply — so this app
   never claims to know what happened next. It only says "sent"
   after Discord itself answers 2xx.

   Everything the sender types is treated as hostile before it
   leaves: control and bidi-override characters are stripped,
   @everyone / @here / <@id> / <@&role> are defused with a
   zero-width joiner (on top of allowed_mentions: none), masked
   links "[text](url)" are broken so a note cannot dress a link up
   as something else, and every piece is clipped to Discord's
   embed limits.

   The limits below (1 a minute, 8 a day) live in this browser's
   storage. They stop accidents and casual spam — anyone with
   DevTools can clear them, so they are not a defence and the copy
   never calls them one.

   Store: portal.feedback = { last, day, count, sent: [...10], anon }
   (merged with what other tabs saved — see readLog)
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as profiles from '../core/profiles.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-feedback-css')) {
  const l = document.createElement('link');
  l.id = 'feat-feedback-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-feedback.css';
  document.head.appendChild(l);
}

/* ---------- the webhook ----------------------------------------------
   OBFUSCATION AGAINST SCRAPERS, NOT SECURITY. StaticOS is a public
   static site, so this URL cannot be a secret: anyone can open DevTools
   and rebuild it, and whoever has it can post to the channel (or edit
   and delete the webhook itself). It is stored as reversed, base64'd
   11-character pieces only so bots that grep public JavaScript for
   Discord webhook URLs do not harvest it.

   If it is ever abused: delete the webhook in Discord (channel settings
   → Integrations → Webhooks), make a new one, and re-encode it here by
   pasting this into the browser console with the new URL in U:
     U.match(/.{1,11}/g).map(p => btoa([...p].reverse().join('')))        */
const HOOK = [
  'c2lkLy86c3B0dGg=', 'cGEvbW9jLmRyb2M=', 'L3Nrb29oYmV3L2k=', 'NTg1NDk5MDQ1NTE=',
  'ejEvODA4MjY3Nzg=', 'alRpVW9MckM4dVM=', 'TFRSR29pQjJkQXk=', 'eXRiU0tCaC01Q0I=',
  'czBEVkVmRkxzaXc=', 'YUJQQUtkbFIzUWU=', 'UjZBZkdtWHpYclI=',
];
/* pinned to API v10, where a 429's retry_after is documented float seconds */
const hookUrl = () => HOOK.map(s => [...atob(s)].reverse().join('')).join('').replace('/api/webhooks/', '/api/v10/webhooks/');
/* the Developer Room's broadcast requests go to the same channel, where the
   bot adds ✅ ❌ and publishes only on the owner's ✅ */
export const feedbackHookUrl = hookUrl;

/* ---------- constants ------------------------------------------------- */
const TYPES = [
  { id: 'idea', label: 'Idea', icon: 'sparkles', emoji: '💡', color: 0xfbbf24,
    title: 'e.g. Add a timer to the Calculator', details: 'What should it do, and how would it help you?' },
  { id: 'bug', label: 'Bug', icon: 'bug', emoji: '🐞', color: 0xef4444,
    title: 'e.g. Music stops when I minimise it', details: 'What did you do, what happened, and what did you expect? Which app?' },
  { id: 'other', label: 'Other', icon: 'message-circle', emoji: '💬', color: 0x60a5fa,
    title: 'What is it about?', details: 'Anything else you want the developer to know.' },
];
const typeOf = id => TYPES.find(t => t.id === id) || TYPES[0];

const L = {
  title: 100, detailsMin: 10, details: 1500, name: 40,
  gapMs: 60_000, perDay: 8, history: 10, timeoutMs: 15_000,
};
/* Discord's own ceilings for one embed */
const D = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, total: 6000 };
const KEY = 'portal.feedback';
const FOOTER = 'React ✅ to approve · ❌ to deny';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad2 = n => String(n).padStart(2, '0');
const dayOf = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const secs = ms => {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.ceil(s / 60)} min`;
};

/* ---------- making text safe to post ----------------------------------- */
/* C0/C1 controls (keeping tab and newline), BOM, and the direction marks
   and overrides that can make text read differently than it is */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
/* invisible fillers that could sneak past the blank-line squeeze or pad a
   title (zero-width space, word joiners, Hangul fillers, tag characters…);
   ZWJ/ZWNJ stay, emoji and some scripts need them */
const FILLER = /[\u115F\u1160\u180E\u200B\u2060-\u2064\u3164\uFFA0\uFFF9-\uFFFB]|[\u{E0000}-\u{E007F}]/gu;
const clean = s => String(s ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(FILLER, '');
const oneLine = s => clean(s).replace(/\s+/g, ' ').trim();
const block = s => clean(s).replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();

/* allowed_mentions already stops the pings; this also stops the text from
   LOOKING like one (@everyone, @here, <@id>, <@!id>, <@&role>), and breaks
   "[text](url)" so a link cannot be disguised as other text */
export const defuse = s => s
  .replace(/@(?=everyone|here|[!&]?\d)/gi, '@\u200D')
  .replace(/<(?=[#/])/g, '<\u200D')          /* <#channel> and </command:id> pills */
  .replace(/\]\(/g, ']\u200B(');

/* cut to n UTF-16 units without splitting a surrogate pair */
function clip(s, n) {
  if (s.length <= n) return s;
  let out = s.slice(0, Math.max(0, n - 1));
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out + '…';
}
const fieldText = s => clip(defuse(oneLine(s)), D.fieldValue);
const embedSize = e => e.title.length + e.description.length + e.footer.text.length
  + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

/** The exact webhook body. Pure, so it can be checked on its own. */
export function buildPayload({ type, title, details, name, drive, build, now = new Date() }) {
  const t = typeOf(type);
  const fields = [
    { name: 'Type', value: t.label, inline: true },
    { name: 'From', value: fieldText(name) || 'anonymous', inline: true },
    { name: 'Drive', value: fieldText(drive) || 'plain', inline: true },
  ];
  const b = fieldText(build);
  if (b) fields.push({ name: 'Build', value: b, inline: true });
  const embed = {
    title: clip(`${t.emoji} ${defuse(oneLine(title))}`, D.title),
    description: clip(defuse(block(details)), D.description),
    color: t.color,
    fields,
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
  const over = embedSize(embed) - D.total;
  if (over > 0) embed.description = clip(embed.description, Math.max(1, embed.description.length - over));
  return { username: 'StaticOS Feedback', allowed_mentions: { parse: [] }, embeds: [embed] };
}

/* ---------- this browser's limits -------------------------------------- */
/* Every tab keeps its own copy of the store and saves it whole, so the
   limits and history are merged with what is on disk each time: another
   tab's send counts here too, and nobody's history is overwritten. */
const STATE = profiles.key('staticos.state.v3');   /* this person's (core/profiles.js) */
const asLog = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
function diskLog() {
  try { return asLog(JSON.parse(profiles.local.getItem(STATE) || 'null')?.portal?.feedback); }
  catch (err) { return {}; }
}
export function mergeLogs(a, b) {
  const last = Math.max(Number(a.last) || 0, Number(b.last) || 0);
  const day = [a.day, b.day].filter(Boolean).sort().pop() || '';
  const cnt = x => (x.day === day ? Number(x.count) || 0 : 0);
  const seen = new Set();
  const sent = [...(Array.isArray(a.sent) ? a.sent : []), ...(Array.isArray(b.sent) ? b.sent : [])]
    .filter(e => { const k = `${e?.at}|${e?.id || ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => String(y?.at).localeCompare(String(x?.at)))
    .slice(0, L.history);
  return { last, day, count: Math.max(cnt(a), cnt(b)), sent, anon: !!(b.anon ?? a.anon) };
}
const readLog = store => mergeLogs(diskLog(), asLog(store.get(KEY)));
/* a confirmed send is written to disk now — the store saves 220 ms later,
   and a reload in between must not lose it */
function saveNow(log) {
  try {
    const st = JSON.parse(profiles.local.getItem(STATE) || '{}') || {};
    st.portal = { ...(st.portal || {}), feedback: log };
    profiles.local.setItem(STATE, JSON.stringify(st));
  } catch (err) { /* private mode / quota: the store's own save still runs */ }
}

/** { ok } or { ok:false, why:'day'|'wait', wait } — from the stored log alone */
export function gate(log, now = Date.now()) {
  const last = Number(log.last) || 0;
  /* a clock set backwards must not reset today's count or the gap */
  const sameDay = log.day === dayOf(now) || last > now;
  const count = sameDay ? (Number(log.count) || 0) : 0;
  if (count >= L.perDay) return { ok: false, why: 'day', count };
  let wait = last + L.gapMs - now;
  if (wait > L.gapMs) wait = L.gapMs;                /* clamp, don't zero */
  if (wait > 0) return { ok: false, why: 'wait', wait, count };
  return { ok: true, count };
}

/* always a NEW object — store.set skips a reference it already holds */
function record(log, entry, now) {
  const day = dayOf(now);
  const count = (log.day === day ? (Number(log.count) || 0) : 0) + 1;
  const sent = [entry, ...(Array.isArray(log.sent) ? log.sent : [])].slice(0, L.history);
  return { last: now, day, count, sent, anon: !!log.anon };
}

/* build.json is stamped at deploy time; fetched once, and a send never
   waits on it for long — without it the Build field is simply left out */
let buildP = null;
function buildInfo() {
  if (!buildP) {
    buildP = fetch('build.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(b => (b && b.build ? [b.version && `v${b.version}`, b.build].filter(Boolean).join(' · ') : ''))
      .catch(() => '');
  }
  return buildP;
}

/* survives closing the window (not a reload), so a closed window never
   costs anyone their text */
const draft = { type: 'idea', title: '', details: '', name: '', nameTyped: false };
/* A send outlives its window. These keep a reopened window honest: it
   cannot start a second send, it hears how the first one ended, and it
   still respects a retry-after that Discord asked for. */
let sending = false;
let retryUntil = 0;
let retryRate = false;      /* was the wait Discord's own 429? */
let live = null;

/* ---------- what went wrong, in words ---------------------------------- */
async function explain(res) {
  const body = await res.clone().json().catch(() => null);
  const status = res.status;
  if (status === 429) {
    /* v10: retry_after is float seconds; the Retry-After header is always
       whole seconds (a Cloudflare ban can ask for half an hour — honour it) */
    let ra = Number(body?.retry_after);
    if (!Number.isFinite(ra) || ra <= 0) ra = Number(res.headers.get('retry-after'));
    if (!Number.isFinite(ra) || ra <= 0) ra = 5;
    return { kind: 'rate', retryMs: Math.ceil(ra * 1000), ra,
      title: 'Discord asked StaticOS to slow down',
      message: `Discord is rate-limiting this feedback channel (retry after ${+ra.toFixed(2)} s). Your note is still here — try again in ${secs(ra * 1000)}.` };
  }
  if (status === 400 && body?.code === 50035) {
    return { kind: 'http', title: 'Discord did not accept this note',
      message: `It said the message was malformed (HTTP 400). Try removing unusual characters or shortening it. Your note is still here.` };
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return { kind: 'hook', title: 'The feedback channel is not working',
      message: `Discord rejected the link StaticOS posts to (HTTP ${status}${body?.message ? ` — ${String(body.message).slice(0, 80)}` : ''}). It was probably deleted or reset, so the developer needs to update it. Your note is still here.` };
  }
  /* The proxy's service worker (sw.js) answers a failed fetch with its own
     502 — that is the network, not Discord */
  if (status === 502 && !body) {
    const text = await res.clone().text().catch(() => '');
    if (/could not reach/i.test(text)) return networkError();
  }
  return { kind: 'http', title: `Discord answered with an error (HTTP ${status})`,
    message: 'That is on Discord\'s side. Your note is still here — try again in a minute.' };
}
const networkError = () => ({ kind: 'net', title: 'Could not reach Discord',
  message: 'This network may block discord.com (school and work networks often do), or you went offline. Your note is still here — try again later or on another network.' });

/* ==================================================================== */

defineApp({
  id: 'feedback',
  name: 'Feedback',
  icon: 'message-circle',
  g1: '#5eead4', g2: '#0f766e',
  category: 'Utilities',
  keywords: ['feedback', 'idea', 'suggest', 'suggestion', 'bug', 'report', 'request', 'feature', 'discord', 'developer'],
  desc: 'Send an idea, a bug or a note to the StaticOS developer',
  pinned: true, singleton: true,
  win: { w: 460, h: 600, minW: 360, minH: 440 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, clear, store, fmt } = api;
    const uid = fmt?.uid || (p => `${p}-${Math.random().toString(36).slice(2, 8)}`);
    const modLabel = fmt?.modLabel || 'Ctrl';
    const ago = fmt?.fmtAgo || (iso => new Date(iso).toLocaleString());

    const S = { busy: false, dead: false, gate: { ok: true }, painted: false };
    const id = { title: uid('fbt'), details: uid('fbd'), name: uid('fbn'), type: uid('fbk'),
      form: uid('fbf'), tc: uid('fbtc'), dc: uid('fbdc'), te: uid('fbte'), de: uid('fbde'), note: uid('fbno') };

    const who = () => {
      const u = store.get('session.user', null);
      return u ? String(u.name || u.username || '') : '';
    };
    /* prefilled from the signed-in account until the person types their own —
       unless they chose to stay anonymous, which is remembered */
    if (!draft.nameTyped) draft.name = readLog(store).anon ? '' : who();

    buildInfo();

    /* ------------------------------ fields ------------------------------ */
    const typeBtns = TYPES.map(t => h('button.fb__type', {
      type: 'button', role: 'radio', dataset: { type: t.id },
      onclick: () => setType(t.id, true),
      onkeydown: e => {
        const i = TYPES.indexOf(typeOf(draft.type));
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        setType(TYPES[(i + step + TYPES.length) % TYPES.length].id, true);
      },
    }, icon(t.icon), h('span', { text: t.label })));
    const typeGroup = h('div.fb__types', { role: 'radiogroup', 'aria-labelledby': id.type }, typeBtns);

    const titleIn = h('input.fb__in', {
      id: id.title, type: 'text', maxlength: String(L.title), autocomplete: 'off', spellcheck: 'true',
      'aria-required': 'true', 'aria-describedby': `${id.tc} ${id.te}`,
      oninput: () => { draft.title = titleIn.value; count(); fieldErr(titleIn, titleErr, ''); },
      onkeydown: e => {
        /* plain Enter moves on; a title alone is not a note */
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); detailsIn.focus(); }
      },
    });
    const detailsIn = h('textarea.fb__in.fb__area', {
      id: id.details, rows: '6', maxlength: String(L.details), spellcheck: 'true',
      'aria-required': 'true', 'aria-describedby': `${id.dc} ${id.de}`,
      oninput: () => { draft.details = detailsIn.value; count(); fieldErr(detailsIn, detailsErr, ''); },
    });
    const nameIn = h('input.fb__in', {
      id: id.name, type: 'text', maxlength: String(L.name), autocomplete: 'nickname', spellcheck: 'false',
      placeholder: 'anonymous',
      oninput: () => {
        draft.name = nameIn.value;
        draft.nameTyped = true;
        const anon = !nameIn.value.trim();
        const log = readLog(store);
        if (log.anon !== anon) store.set(KEY, { ...log, anon });
      },
      onkeydown: e => {
        /* plain Enter here must not send the note by surprise */
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); sendBtn.focus(); }
      },
    });
    titleIn.value = draft.title;
    detailsIn.value = draft.details;
    nameIn.value = draft.name || '';

    const titleCount = h('span.fb__count', { id: id.tc, 'aria-hidden': 'true' });
    const detailsCount = h('span.fb__count', { id: id.dc, 'aria-hidden': 'true' });
    const titleErr = h('div.fb__ferr', { id: id.te });
    const detailsErr = h('div.fb__ferr', { id: id.de });

    const label = (forId, text, extra) => h('div.fb__lrow',
      h('label.fb__label', { for: forId, text }), extra || null);

    /* ------------------------------ sending ------------------------------ */
    const spin = h('span.fb__spin', { 'aria-hidden': 'true' });
    const sendLabel = h('span', { text: 'Send to developer' });
    const sendBtn = h('button.btn.btn--primary.fb__send', { type: 'submit' }, spin, icon('send'), sendLabel);
    const limitEl = h('div.fb__limit');
    const statusEl = h('div.fb__sr', { role: 'status', 'aria-live': 'polite' });
    const errEl = h('div.fb__err', { role: 'alert' });

    const form = h('form.fb__form', {
      id: id.form, novalidate: true,
      onsubmit: e => { e.preventDefault(); send(); },
      onkeydown: e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      },
    },
      h('div.fb__group',
        h('div.fb__label', { id: id.type, text: 'What is it?' }),
        typeGroup),
      h('div.fb__group',
        label(id.title, 'Title', titleCount),
        titleIn, titleErr),
      h('div.fb__group',
        label(id.details, 'Details', detailsCount),
        detailsIn, detailsErr),
      h('div.fb__group',
        label(id.name, 'Name', h('span.fb__opt', { text: 'optional' })),
        nameIn),
      h('div.fb__note', { id: id.note },
        icon('info'),
        h('span', { text: 'This goes to the StaticOS developer\'s Discord channel with the name above (clear it to stay anonymous — that is remembered), your StaticOS version and which drive you booted. Your browser sends it straight to Discord, which sees your IP address like any website. Don\'t include personal info like passwords, phone numbers or addresses.' })));
    /* the button and any error live in a footer outside the scroller, so
       neither is ever out of sight; `form=` keeps the button the form's own */
    const foot = h('div.fb__foot',
      errEl,
      h('div.fb__actions',
        sendBtn,
        h('span.fb__kbd', { text: `${modLabel} + Enter` })),
      limitEl);
    sendBtn.setAttribute('form', id.form);
    sendBtn.setAttribute('aria-describedby', id.note);

    /* ------------------------------ sent ------------------------------ */
    const doneEl = h('div.fb__done', { hidden: true, tabindex: '-1' });

    /* ------------------------------ history ------------------------------ */
    const histList = h('ul.fb__hist');
    const histEl = h('section.fb__histwrap', { 'aria-label': 'Sent from this browser' },
      h('div.fb__cap', h('span', { text: 'Sent from this browser' }), h('small', { text: `last ${L.history}` })),
      histList);

    root.appendChild(h('div.app.app--col.fb', { dataset: { type: draft.type } },
      h('div.fb__scroll',
        h('header.fb__hero',
          h('div.fb__glyph', icon('message-circle')),
          h('div',
            h('div.fb__h1', { text: 'Send feedback' }),
            h('div.fb__sub', { text: 'Ideas, bugs, anything — it goes straight to the developer.' }))),
        form, doneEl, statusEl, histEl),
      foot));
    const shell = root.querySelector('.fb');

    /* ------------------------------ painting ------------------------------ */
    function setType(tid, focus) {
      const t = typeOf(tid);
      draft.type = t.id;
      shell.dataset.type = t.id;
      typeBtns.forEach(b => {
        const on = b.dataset.type === t.id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      titleIn.placeholder = t.title;
      detailsIn.placeholder = t.details;
    }

    function count() {
      const tl = titleIn.value.length, dl = detailsIn.value.length;
      titleCount.textContent = `${tl}/${L.title}`;
      titleCount.classList.toggle('is-near', tl >= L.title - 10);
      const short = detailsIn.value.trim().length;
      detailsCount.textContent = short > 0 && short < L.detailsMin
        ? `${L.detailsMin - short} more needed · ${dl}/${L.details}`
        : `${dl}/${L.details}`;
      detailsCount.classList.toggle('is-near', dl >= L.details - 100);
    }

    function fieldErr(input, el, msg) {
      el.textContent = msg;
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    function showError(e) {
      clear(errEl);
      if (!e) return;
      errEl.append(h('div.fb__errbox', { dataset: { kind: e.kind } },
        icon(e.kind === 'net' ? 'wifi-off' : e.kind === 'rate' ? 'clock' : 'alert'),
        h('div', h('b', { text: e.title }), h('p', { text: e.message }))));
    }

    function currentGate() {
      const now = Date.now();
      const g = gate(readLog(store), now);
      if (!g.ok) return g;
      if (retryUntil > now) return { ok: false, why: 'retry', wait: retryUntil - now };
      return g;
    }

    function paintSend() {
      const g = currentGate();
      const busy = S.busy || sending;
      S.gate = g;
      S.painted = busy;
      sendBtn.disabled = busy || !g.ok;
      sendBtn.setAttribute('aria-busy', String(busy));
      shell.classList.toggle('is-busy', busy);
      [titleIn, detailsIn, nameIn].forEach(el => { el.readOnly = busy; });
      sendLabel.textContent = busy ? 'Sending…'
        : g.ok ? 'Send to developer'
          : g.why === 'day' ? 'Daily limit reached'
            : `Wait ${secs(g.wait)}`;
      const left = Math.max(0, L.perDay - (g.count || 0));
      limitEl.textContent = g.why === 'day'
        ? `This browser has sent ${L.perDay} notes today, the most it can. Your text stays here — send it tomorrow.`
        : g.why === 'wait'
          ? `One note a minute from each browser. You can send again in ${secs(g.wait)}.`
          : g.why === 'retry'
            ? retryRate ? `Discord asked to wait — you can try again in ${secs(g.wait)}.`
              : `You can try again in ${secs(g.wait)}.`
            : navigator.onLine === false
              ? 'You are offline. You can write now and send when you are back online.'
              : `${left} of ${L.perDay} left today from this browser · one a minute.`;
      limitEl.classList.toggle('is-blocked', !g.ok);
    }

    function paintHistory() {
      const log = readLog(store);
      const sent = Array.isArray(log.sent) ? log.sent : [];
      clear(histList);
      if (!sent.length) {
        histList.append(h('li.fb__hempty', { text: 'Nothing sent from this browser yet.' }));
        return;
      }
      for (const e of sent.slice(0, L.history)) {
        const t = typeOf(e?.type);
        const at = String(e?.at || '');
        histList.append(h('li.fb__hrow',
          h('span.fb__hic', { dataset: { type: t.id }, title: t.label }, icon(t.icon)),
          h('span.fb__sr', { text: `${t.label}: ` }),
          h('span.fb__htitle', { text: String(e?.title || '(untitled)') }),
          h('time.fb__hwhen', { datetime: at, text: ago(at), title: at ? new Date(at).toLocaleString() : '' })));
      }
    }

    function showDone(entry) {
      clear(doneEl);
      const t = typeOf(entry.type);
      doneEl.append(
        h('div.fb__doneic', icon('check')),
        h('div.fb__doneh', { text: 'Sent to the developer' }),
        h('div.fb__donet', h('span.fb__hic', { dataset: { type: t.id } }, icon(t.icon)), h('span', { text: entry.title })),
        h('p.fb__donep', { text: 'Discord confirmed it arrived. The developer reacts ✅ to approve or ❌ to deny — there is no way for that answer to come back here, so you will not see it in StaticOS.' }),
        h('button.btn', { type: 'button', onclick: another }, icon('plus'), h('span', { text: 'Send another' })));
      form.hidden = foot.hidden = true;
      doneEl.hidden = false;
      doneEl.focus();
    }

    function another() {
      doneEl.hidden = true;
      form.hidden = foot.hidden = false;
      titleIn.value = detailsIn.value = '';
      count();
      paintSend();
      titleIn.focus();
    }

    function validate() {
      /* judged on what would actually be sent, not on stray control characters */
      const t = oneLine(titleIn.value), d = block(detailsIn.value);
      /* maxlength stops typing and pasting; this catches anything that got round it */
      const tBad = !t ? 'Give it a short title.'
        : t.length > L.title ? `Keep the title to ${L.title} characters.` : '';
      const dBad = !d ? 'Say a bit about it.'
        : d.length < L.detailsMin ? `A little more, please — at least ${L.detailsMin} characters.`
          : d.length > L.details ? `Keep the details to ${L.details} characters.` : '';
      fieldErr(titleIn, titleErr, tBad);
      fieldErr(detailsIn, detailsErr, dBad);
      if (tBad) { titleIn.focus(); return false; }
      if (dBad) { detailsIn.focus(); return false; }
      return true;
    }

    /* ------------------------------ send ------------------------------ */
    async function send() {
      if (S.busy || sending) return;
      if (!validate()) return;
      const g = currentGate();
      paintSend();
      if (!g.ok) { statusEl.textContent = limitEl.textContent; return; }
      if (navigator.onLine === false) {
        showError({ kind: 'net', title: 'You are offline', message: 'Your note is still here — send it when you are back online.' });
        return;
      }

      showError(null);
      S.busy = sending = true;
      paintSend();
      statusEl.textContent = 'Sending…';

      const typed = { type: draft.type, title: titleIn.value, details: detailsIn.value, name: nameIn.value };
      const build = await Promise.race([buildInfo(), sleep(1200).then(() => '')]);
      const payload = buildPayload({ ...typed, drive: document.body.dataset.os || 'plain', build });

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), L.timeoutMs);
      let res = null, fail = null;
      try {
        res = await fetch(`${hookUrl()}?wait=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ac.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        });
      } catch (err) {
        fail = ac.signal.aborted
          ? { kind: 'net', title: 'Discord did not answer', timeout: true,
            message: `No reply in ${L.timeoutMs / 1000} seconds — the network may be slow or blocking discord.com. It may or may not have arrived, and there is no way to tell from here; if you send it again the developer might get it twice. Your note is still here.` }
          : networkError();
      } finally {
        clearTimeout(timer);
      }

      if (res && res.ok) {
        const msg = await res.json().catch(() => null);
        const entry = { type: typed.type, title: clip(oneLine(typed.title), L.title), at: new Date().toISOString(), ...(msg?.id ? { id: String(msg.id) } : {}) };
        const next = record(readLog(store), entry, Date.now());
        saveNow(next);
        store.set(KEY, next);
        draft.title = draft.details = '';
        S.busy = sending = false;
        const to = S.dead ? live : view;
        if (to) to.sent(entry);
        else api.notify({ app: 'Feedback', icon: 'check', title: 'Feedback sent', message: entry.title, timeout: 4000 });
        return;
      }

      if (res) fail = await explain(res);
      /* every failed attempt costs a short wait (a timed-out one the full gap:
         it may well have arrived), so nobody hammers Discord by accident */
      retryRate = fail.kind === 'rate';
      if (retryRate) retryUntil = Date.now() + fail.retryMs;
      else retryUntil = Date.now() + (fail.timeout ? L.gapMs : 10_000);
      S.busy = sending = false;
      const to = S.dead ? live : view;
      if (to) to.failed(fail);
      else api.notify({ app: 'Feedback', icon: 'alert', title: 'Feedback not sent', message: 'Open Feedback again — your note is still there.', timeout: 8000 });
    }

    /* how a send ends, shown in whichever window is open by then */
    const view = {
      sent(entry) {
        titleIn.value = detailsIn.value = '';
        statusEl.textContent = 'Sent. Discord confirmed it arrived.';
        count();
        paintSend();
        paintHistory();
        showDone(entry);
      },
      failed(fail) {
        statusEl.textContent = '';
        showError(fail);
        paintSend();
      },
    };
    live = view;

    /* ------------------------------ lifecycle ------------------------------ */
    setType(draft.type, false);
    count();
    paintSend();
    paintHistory();

    let ticks = 0;
    const tick = setInterval(() => {
      if (S.dead) return;
      const was = S.gate;
      const now = currentGate();
      if (!was.ok || !now.ok || S.painted !== (S.busy || sending)) paintSend();
      if (++ticks % 30 === 0) paintHistory();
    }, 1000);

    const onNet = () => paintSend();
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    /* another tab sent something: its limits and history apply here too */
    const onStorage = e => { if (!S.dead && (e.key === STATE || e.key === null)) { paintSend(); paintHistory(); } };
    window.addEventListener('storage', onStorage);
    const offs = [
      store.sub(KEY, () => { if (!S.dead) { paintSend(); paintHistory(); } }),
      /* follow sign-in / sign-out until the person types a name themselves */
      store.sub('session.user', () => {
        if (S.dead || draft.nameTyped || readLog(store).anon) return;
        draft.name = who();
        nameIn.value = draft.name;
      }),
    ];

    /* not on touch screens, where focusing throws the keyboard over the form */
    const coarse = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
    /* only if the person has not already clicked into the form — on a busy
       page this timer can fire late, and must not yank focus back */
    if (!coarse) setTimeout(() => {
      if (!S.dead && !root.contains(document.activeElement)) (draft.title ? detailsIn : titleIn).focus();
    }, 60);

    root.cherriTeardown = () => {
      if (S.dead) return;
      S.dead = true;
      if (live === view) live = null;
      clearInterval(tick);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      window.removeEventListener('storage', onStorage);
      offs.forEach(f => f?.());
      /* an in-flight send is left to finish: aborting could not un-send it,
         and finishing lets it count and land in history */
    };
    return root.cherriTeardown;
  },
});
