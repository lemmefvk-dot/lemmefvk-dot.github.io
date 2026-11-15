/* ============================================================
   pollcard.js — how a poll looks inside a Static Social room, and
   the form that makes one. Rules and counting: js/core/polls.js.
   Everything shown is set with textContent; nothing from another
   person's message ever reaches innerHTML.
   ============================================================ */
import { LIMITS, TEMPLATES, isOpen, tally, resultsText } from '../core/polls.js';

export const ANON_NOTE = 'Hidden on screen, not from the room. This only changes what is displayed: votes travel on the same shared public channel as everything else, so anyone in the room could still see who voted.';
const DURS = [['Until I end it', 0], ['5 minutes', 5 * 60e3], ['1 hour', 3600e3], ['1 day', 86400e3]];

function left(ms) {
  const m = Math.ceil(ms / 60000);
  return m >= 1440 ? `${Math.round(m / 1440)} d` : m >= 60 ? `${Math.round(m / 60)} h` : `${Math.max(1, m)} min`;
}

/* the results as columns: the height is the count, the label is the option */
function chart({ h }, P, t) {
  const top = Math.max(1, ...t.counts);
  return h('div.so-poll__chart', { role: 'img', 'aria-label': `Bar chart. ${P.opts.map((o, i) => `${o}: ${t.counts[i]}`).join('. ')}` },
    ...P.opts.map((o, i) => h('div.so-poll__col', { 'data-col': String(i) },
      h('span.so-poll__cn', { text: String(t.counts[i]) }),
      h('i.so-poll__colbar', { style: { height: `${Math.round((t.counts[i] / top) * 100)}%` }, 'aria-hidden': 'true' }),
      h('span.so-poll__cl', { text: o }))));
}

function copyOut(text) {
  try { return Promise.resolve(navigator.clipboard.writeText(text)).then(() => true, () => false); } catch (e) { return Promise.resolve(false); }
}

/** The card for one poll. ctx: { myId, vote(P, choices), close(P), copy?(text) }. `el.repaint()` redraws it. */
export function pollCard({ h, icon }, P, ctx) {
  const el = h('div.so-poll', { dataset: { poll: P.pid } });
  el.poll = P;
  let charted = false, copied = '';
  el.repaint = () => {
    const open = isOpen(P);
    const t = tally(P);
    const mine = P.votes.get(ctx.myId);
    const mineSet = new Set(mine ? mine.ch : []);
    el.replaceChildren();
    el.classList.toggle('is-closed', !open);
    el.appendChild(h('div.so-poll__q', icon('bar-chart'), h('b', { text: P.q })));
    el.appendChild(h('div.so-poll__meta', { text: [
      P.multi ? 'Pick any' : 'Pick one',
      P.anon ? 'names hidden' : 'names shown',
      open ? (P.endsAt ? `ends in ${left(P.endsAt - Date.now())}` : 'open until the author ends it') : 'closed',
    ].join(' · ') }));
    const list = h('div.so-poll__opts', { role: P.multi ? 'group' : 'radiogroup', 'aria-label': 'Options' });
    P.opts.forEach((label, i) => {
      const on = mineSet.has(i);
      const b = h('button.so-poll__opt', {
        type: 'button', disabled: !open, 'data-opt': String(i),
        role: P.multi ? 'checkbox' : 'radio', 'aria-checked': on ? 'true' : 'false',
        onclick: () => ctx.vote(P, P.multi ? (on ? [...mineSet].filter(x => x !== i) : [...mineSet, i]) : [i]),
      },
      h('i.so-poll__bar', { style: { width: `${t.pct[i]}%` }, 'aria-hidden': 'true' }),
      h('span.so-poll__lbl', { text: label }),
      h('span.so-poll__n', { text: `${t.counts[i]} · ${t.pct[i]}%` }));
      list.appendChild(h('div.so-poll__row', b,
        !P.anon && t.who[i].length ? h('small.so-poll__who', { text: t.who[i].join(', ') }) : null));
    });
    el.appendChild(list);
    if (charted) el.appendChild(chart({ h }, P, t));
    el.appendChild(h('div.so-poll__tools',
      h('button.btn.btn--sm', { type: 'button', 'data-act': 'poll-chart', 'aria-pressed': charted ? 'true' : 'false',
        onclick: () => { charted = !charted; el.repaint(); } }, icon('bar-chart'), h('span', { text: charted ? 'Hide chart' : 'Show chart' })),
      h('button.btn.btn--sm', { type: 'button', 'data-act': 'poll-copy', onclick: async () => {
        const text = resultsText(P);
        const done = ctx.copy ? (ctx.copy(text), true) : await copyOut(text);
        copied = done ? 'Results copied.' : 'Copying was blocked.';
        el.repaint();
        setTimeout(() => { copied = ''; if (el.isConnected) el.repaint(); }, 2500);
      } }, icon('copy'), h('span', { text: 'Copy results' })),
      copied ? h('span.so-poll__tot', { role: 'status', text: copied }) : null));
    el.appendChild(h('div.so-poll__foot',
      h('span.so-poll__tot', { text: `${t.voters} ${t.voters === 1 ? 'person' : 'people'} voted (counted from votes this device received)` }),
      open && P.from === ctx.myId ? h('button.btn.btn--sm', { type: 'button', 'data-act': 'end-poll', text: 'End poll', onclick: () => ctx.close(P) }) : null));
    if (P.anon) el.appendChild(h('small.so-poll__note', { text: ANON_NOTE }));
  };
  el.repaint();
  return el;
}

/** The "new poll" form. -> element; submit gets { q, opts, multi, anon, dur } or a returned error string.
    `start` ({ q, opts }) fills it in. */
export function pollForm({ h, icon }, submit, start = null) {
  const q = h('input', { type: 'text', maxlength: String(LIMITS.Q), placeholder: 'Ask a question', 'aria-label': 'Poll question', 'data-f': 'q' });
  const optsBox = h('div.so-pf__opts');
  const inputs = [];
  const status = h('span.so-form__hint', { role: 'status' });
  const add = h('button.btn.btn--sm', { type: 'button', 'data-act': 'add-opt', onclick: () => addOpt() }, icon('plus'), h('span', { text: 'Add option' }));
  function addOpt() {
    if (inputs.length >= LIMITS.MAX) return;
    const i = h('input', { type: 'text', maxlength: String(LIMITS.OPT), placeholder: `Option ${inputs.length + 1}`, 'aria-label': `Option ${inputs.length + 1}`, 'data-f': 'opt' });
    inputs.push(i);
    optsBox.appendChild(i);
    add.hidden = inputs.length >= LIMITS.MAX;
  }
  addOpt(); addOpt();
  /* a template (or a /poll line) fills the question and as many options as it has */
  function fill(tpl) {
    q.value = tpl.q;
    while (inputs.length < Math.min(tpl.opts.length, LIMITS.MAX)) addOpt();
    inputs.forEach((i, n) => { i.value = tpl.opts[n] || ''; });
  }
  if (start) fill(start);
  const tpls = h('div.so-pf__tpls', { role: 'group', 'aria-label': 'Poll templates' },
    ...TEMPLATES.map(t => h('button.chip', { type: 'button', 'data-tpl': t.name, onclick: () => fill(t) }, t.name)));
  const multi = h('input', { type: 'checkbox', 'data-f': 'multi' });
  const anon = h('input', { type: 'checkbox', 'data-f': 'anon' });
  const dur = h('select.select', { 'aria-label': 'Poll length', 'data-f': 'dur' }, DURS.map(([l, v]) => h('option', { value: String(v), text: l })));
  const go = () => {
    const opts = inputs.map(i => i.value.trim()).filter(Boolean);
    if (!q.value.trim()) { status.textContent = 'Write a question first.'; return; }
    if (opts.length < LIMITS.MIN) { status.textContent = 'Give at least two options.'; return; }
    const err = submit({ q: q.value, opts, multi: multi.checked, anon: anon.checked, dur: Number(dur.value) });
    status.textContent = typeof err === 'string' ? err : '';
  };
  return h('div.so-pop.so-pf', { role: 'group', 'aria-label': 'New poll' },
    tpls, q, optsBox, add,
    h('label.so-form__attach', multi, h('span', { text: 'Allow more than one choice' })),
    h('label.so-form__attach', anon, h('span', { text: 'Hidden on screen, not from the room' })),
    h('small.dim', { text: ANON_NOTE }),
    h('div.so-form__row', h('label.so-form__l', { text: 'Ends' }), dur),
    h('div.so-form__foot', status, h('div.grow'), h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-act': 'make-poll', onclick: go }, icon('send'), h('span', { text: 'Post poll' }))));
}
