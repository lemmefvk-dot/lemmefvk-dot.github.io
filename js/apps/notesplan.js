/* ============================================================
   notesplan.js — planning tools inside Notes: an outline of the
   current note (#210) and a word goal with a writing timer (#211).

   Why here: both are about the note you have open, so they sit in
   its window (a pane beside the page, a strip under the toolbar)
   rather than in another app. Notes hands this module a few hooks
   and keeps no logic of its own for it; the rules are in core
   modules that work without a window:
     js/core/outline.js     sections, reordering, promote/demote
     js/core/writegoals.js  what a word is, goals, the timer

   The outline reorders the note's real blocks through Notes' own
   undoable edit, so Ctrl/⌘+Z in the note (or in the outline) puts
   it back. Nothing here writes a note itself. H1 · H2 · H3 in its head
   folds it down to that level of heading.

   The strip also holds a goal for every day, with the streak of days
   it was met, and a 15-minute writing sprint (writegoals.js says what
   is counted). A note you are writing with a friend isn't counted
   towards the day: their words would be in it too.

   Everything the person typed is drawn as text, never as markup.
   ============================================================ */
import * as OL from '../core/outline.js';
import * as NF from '../core/notesfmt.js';
import * as WG from '../core/writegoals.js';
import { t as tr } from '../core/i18n.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-planning-css')) {
  const link = document.createElement('link');
  link.id = 'feat-planning-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-planning.css';
  document.head.appendChild(link);
}

const PREF = 'prefs.notesPlan';
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';

/**
 * hooks: { api, note(): the open note or null (never a file), byId(id): any note,
 *          counts(note): its words count towards the day (false while shared),
 *          blocks(): the note's blocks as they are now,
 *          change(fn): one undoable edit — fn(blocks) edits the array in place,
 *          jump(i): put the caret on block i, undo(), redo() }
 * -> { buttons, strip, panel, changed(), forget(id), close() }
 */
export function mountPlan(hooks) {
  const { api } = hooks;
  const { h, icon, store } = api;
  const saved = store.get(PREF) || {};
  const S = {
    outline: !!saved.outline, goal: !!saved.goal,
    collapsed: new Set(), cur: null, msg: '', noteId: null, tRepaint: 0, tTick: 0, tSave: 0, dead: false, drag: null, words: 0,
  };
  const keep = e => e.preventDefault();
  const savePref = () => { try { store.set(PREF, { outline: S.outline, goal: S.goal }); } catch (e) { /* fine */ } };

  /* ---------------- toolbar buttons ---------------- */
  const outlineBtn = h('button.ibtn.tip.np-toggle', { type: 'button', 'data-tip': tr('Outline'), 'aria-label': tr('Outline'), 'aria-pressed': String(S.outline), dataset: { fk: 'np-outline-btn' }, onmousedown: keep, onclick: () => { S.outline = !S.outline; savePref(); show(); if (S.outline) paintOutline(); } }, icon('align-left'));
  const goalBtn = h('button.ibtn.tip.np-toggle', { type: 'button', 'data-tip': tr('Word goal and timer'), 'aria-label': tr('Word goal and timer'), 'aria-pressed': String(S.goal), dataset: { fk: 'np-goal-btn' }, onmousedown: keep, onclick: () => { S.goal = !S.goal; savePref(); show(); if (S.goal) paintStrip(); } }, icon('clock'));
  const buttons = [outlineBtn, goalBtn];

  /* ---------------- the goal strip ---------------- */
  const target = h('input.np-in', { type: 'number', min: '1', max: String(WG.MAX_TARGET), step: '1', inputmode: 'numeric', 'aria-label': tr('Word goal'), placeholder: 'e.g. 500', dataset: { fk: 'np-target' },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); commitTarget(); } },
    onchange: () => commitTarget() });
  const modeTotal = h('button.np-seg__b', { type: 'button', dataset: { fk: 'np-mode-total' }, onclick: () => setMode('total') }, tr('Whole note'));
  const modeSession = h('button.np-seg__b', { type: 'button', dataset: { fk: 'np-mode-session' }, onclick: () => setMode('session') }, tr('This session'));
  const seg = h('div.np-seg', { role: 'group', 'aria-label': tr('What the goal counts') }, modeTotal, modeSession);
  const newSession = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'np-new-session' }, onclick: () => { const n = hooks.note(); if (n) { WG.set(n.id, { base: WG.wordsOf(n) }); paintStrip(); say('New session: counting from here.'); } } }, tr('New session'));
  const clearGoal = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'np-clear' }, onclick: () => { const n = hooks.note(); if (n) { WG.clearGoal(n.id); target.value = ''; paintStrip(); say('Goal removed.'); } } }, tr('Remove goal'));
  const bar = h('div.np-bar', { role: 'progressbar', 'aria-label': tr('Word goal progress'), 'aria-valuemin': '0', dataset: { fk: 'np-bar' } }, h('i'));
  const prog = h('span.np-prog', { dataset: { fk: 'np-progress' } });
  const timeEl = h('span.np-time', { role: 'timer', 'aria-live': 'off', 'aria-label': tr('Writing time'), dataset: { fk: 'np-time' }, text: '0:00' });
  const timerBtn = h('button.btn.btn--sm.np-tbtn', { type: 'button', dataset: { fk: 'np-timer-toggle' }, onclick: () => toggleTimer() });
  const resetBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'np-timer-reset' }, 'aria-label': tr('Reset writing time to zero'), onclick: () => { const n = hooks.note(); if (n) { WG.resetTimer(n.id); paintStrip(); say('Writing time reset.'); } } }, icon('rotate-ccw'));
  const note = h('small.np-note', { text: tr('A word is anything between spaces with a letter or number in it (the same rule as the Words tab). Headings’ # marks, bullets, tick boxes and picture names are not words. The timer counts only while it runs. “Every day” counts the words you add to your notes in Notes today; pasting counts too.') });
  const msg = h('small.np-msg', { role: 'status', dataset: { fk: 'np-msg' } });
  /* every day, and the streak */
  const dayIn = h('input.np-in', { type: 'number', min: '1', max: String(WG.MAX_TARGET), step: '1', inputmode: 'numeric', 'aria-label': tr('Words to write every day'), placeholder: 'e.g. 300', dataset: { fk: 'np-day-target' },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); commitDay(); } },
    onchange: () => commitDay() });
  const dayProg = h('span.np-prog', { dataset: { fk: 'np-day' } });
  const streakEl = h('span.np-streak', { dataset: { fk: 'np-streak' } });
  /* the sprint */
  const sprintBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'np-sprint' }, onclick: () => toggleSprint() });
  const sprintEl = h('span.np-sprintst', { role: 'timer', 'aria-live': 'off', dataset: { fk: 'np-sprint-state' } });
  const strip = h('div.np-strip', { role: 'group', 'aria-label': tr('Word goal and writing timer'), hidden: true },
    h('div.np-strip__row',
      h('label.np-lab', { text: tr('Goal') }, target, h('span', { text: 'words' })),
      seg, newSession, clearGoal),
    h('div.np-strip__row', prog, bar),
    h('div.np-strip__row', h('span.np-lab', icon('clock'), tr('Writing time')), timeEl, timerBtn, resetBtn, msg),
    h('div.np-strip__row', h('label.np-lab', { text: tr('Every day') }, dayIn, h('span', { text: 'words' })), dayProg, streakEl),
    h('div.np-strip__row', h('span.np-lab', icon('zap'), tr('Sprint')), sprintBtn, sprintEl),
    note);

  function say(t) { S.msg = t; msg.textContent = t; }
  function commitTarget() {
    const n = hooks.note();
    if (!n) return;
    const raw = target.value.trim();
    if (!raw) { WG.clearGoal(n.id); paintStrip(); say('Goal removed.'); return; }
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 1 || v > WG.MAX_TARGET) { say(`Enter a whole number of words from 1 to ${WG.MAX_TARGET.toLocaleString()}.`); return; }
    const g = WG.get(n.id);
    WG.set(n.id, { target: v, mode: g.target ? g.mode : 'total', base: g.mode === 'session' && g.target ? g.base : 0 });
    paintStrip();
    say(`Goal set: ${v.toLocaleString()} words.`);
  }
  function commitDay() {
    const raw = dayIn.value.trim();
    if (!raw) { WG.setDayGoal(0); paintDay(); say('Daily goal removed.'); return; }
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 1 || v > WG.MAX_TARGET) { say(`Enter a whole number of words from 1 to ${WG.MAX_TARGET.toLocaleString()}.`); return; }
    WG.setDayGoal(v);
    paintDay();
    say(`Every day: ${v.toLocaleString()} words.`);
  }
  function paintDay() {
    const g = WG.dayGoal();
    if (document.activeElement !== dayIn) dayIn.value = g.target ? String(g.target) : '';
    dayProg.textContent = g.target
      ? `Today: ${g.today.toLocaleString()} of ${g.target.toLocaleString()}${g.met ? ' · met' : ''}`
      : `Today: ${g.today.toLocaleString()} word${g.today === 1 ? '' : 's'} added`;
    api.render(streakEl, g.target ? [icon('flame'), h('span', { text: g.streak ? tr('{streak}-day streak', { streak: g.streak }) : tr('no streak yet') })] : []);
    streakEl.classList.toggle('is-on', g.streak > 0);
  }
  /* ---------------- the 15-minute sprint ---------------- */
  const SP = { id: null, start: 0, end: 0, base: 0, t: 0 };
  const sprintWords = () => { const n = SP.id ? hooks.byId?.(SP.id) : null; return n ? WG.wordsOf(n) - SP.base : null; };
  function toggleSprint() {
    if (SP.id) { endSprint(true); return; }
    const n = hooks.note();
    if (!n) return;
    SP.id = n.id; SP.start = Date.now(); SP.end = SP.start + WG.SPRINT_MS; SP.base = WG.wordsOf(n);
    SP.t = setInterval(() => { if (Date.now() >= SP.end) endSprint(false); else paintSprint(); }, 1000);
    say('Sprint: 15 minutes, starting now.');
    paintSprint();
  }
  function endSprint(early, quiet = false) {
    if (!SP.id) return;
    clearInterval(SP.t);
    SP.t = 0;
    const words = sprintWords() ?? 0;
    const ms = Math.min(WG.SPRINT_MS, Math.max(0, Date.now() - SP.start));
    WG.logSprint({ at: SP.start, ms, words, id: SP.id });
    SP.id = null;
    const w = `${words < 0 ? '−' : ''}${Math.abs(words).toLocaleString()} word${Math.abs(words) === 1 ? '' : 's'}`;
    const t = early ? `Sprint stopped: ${w} in ${WG.clock(ms)}` : `Sprint over: ${w} in 15 minutes`;
    if (!quiet) { say(t); api.notify({ app: 'Notes', icon: 'zap', title: t, message: early ? '' : tr('Take a short break, then go again if you like.'), timeout: 8000 }); }
    paintSprint();
  }
  function paintSprint() {
    if (SP.id) {
      const w = sprintWords();
      api.render(sprintBtn, icon('square'), 'Stop');
      sprintEl.textContent = `${WG.clock(SP.end - Date.now())} left${w === null ? '' : ` · ${w > 0 ? '+' : w < 0 ? '−' : ''}${Math.abs(w).toLocaleString()} words`}`;
      sprintBtn.setAttribute('aria-pressed', 'true');
      return;
    }
    api.render(sprintBtn, icon('play'), 'Start a 15-minute sprint');
    sprintBtn.setAttribute('aria-pressed', 'false');
    const last = WG.sprints().slice(-1)[0];
    sprintEl.textContent = last ? `Last sprint: ${last.words.toLocaleString()} word${Math.abs(last.words) === 1 ? '' : 's'} in ${WG.clock(last.ms)}` : '';
  }
  function setMode(m) {
    const n = hooks.note();
    if (!n) return;
    const g = WG.get(n.id);
    if (!g.target) { say('Set a word goal first.'); return; }
    WG.set(n.id, { mode: m, base: m === 'session' ? WG.wordsOf(n) : 0 });
    paintStrip();
    say(m === 'session' ? 'Counting words added from now on.' : 'Counting the whole note.');
  }
  function toggleTimer() {
    const n = hooks.note();
    if (!n) return;
    if (WG.running() === n.id) { WG.pause(); say('Timer paused.'); } else { WG.start(n.id); say('Timer running.'); }
    ticking();
    paintStrip();
  }
  /* one tick a second while a timer runs, and a save every 30 s — never when nothing runs */
  let sinceSave = 0;
  function ticking() {
    const live = WG.running() !== null;
    if (live && !S.tTick) { sinceSave = 0; S.tTick = setInterval(() => { if (++sinceSave >= 30) { sinceSave = 0; WG.checkpoint(); } paintTime(); }, 1000); }
    if (!live && S.tTick) { clearInterval(S.tTick); S.tTick = 0; }
    goalBtn.classList.toggle('is-live', live);
  }
  function paintTime() {
    const n = hooks.note();
    if (!n || !S.goal) return;
    const t = WG.clock(WG.elapsed(n.id));
    if (timeEl.textContent !== t) timeEl.textContent = t;
  }
  function paintStrip() {
    const n = hooks.note();
    if (!n) return;
    const g = WG.get(n.id);
    S.words = WG.wordsOf(n);
    if (document.activeElement !== target) target.value = g.target ? String(g.target) : '';
    for (const [b, m] of [[modeTotal, 'total'], [modeSession, 'session']]) { b.setAttribute('aria-pressed', String(g.mode === m)); b.classList.toggle('is-on', g.mode === m); b.disabled = !g.target; }
    newSession.hidden = !(g.target && g.mode === 'session');
    clearGoal.hidden = !g.target;
    bar.hidden = !g.target;
    if (!g.target) prog.textContent = `${S.words.toLocaleString()} word${S.words === 1 ? '' : 's'} in this note · no goal set`;
    else {
      const p = WG.progress(g, S.words);
      const num = p.n < 0 ? `−${Math.abs(p.n).toLocaleString()}` : p.n.toLocaleString();
      prog.textContent = `${g.mode === 'session' ? (p.n > 0 ? '+' : '') : ''}${num} of ${g.target.toLocaleString()} words${g.mode === 'session' ? ' this session' : ''} · ${p.pct}%${p.met ? ' · goal reached' : ''}`;
      bar.setAttribute('aria-valuemax', String(g.target));
      bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(g.target, p.n))));
      bar.firstChild.style.width = `${p.pct}%`;
      bar.classList.toggle('is-met', p.met);
    }
    const run = WG.running() === n.id;
    api.render(timerBtn, icon(run ? 'pause' : 'play'), run ? 'Pause' : (WG.elapsed(n.id) ? 'Resume' : 'Start'));
    timerBtn.setAttribute('aria-pressed', String(run));
    paintTime();
    paintDay();
    paintSprint();
  }

  /* ---------------- the outline ---------------- */
  const tree = h('div.np-tree', { role: 'tree', 'aria-label': tr('Outline of this note'), dataset: { fk: 'np-tree' } });
  const lvBtns = [1, 2, 3].map(lv => h('button.np-seg__b.np-lv', {
    type: 'button', dataset: { fk: `np-level-${lv}` }, 'aria-pressed': 'false',
    'aria-label': lv === 3 ? tr('Show every heading') : tr('Show headings down to level {lv}', { lv }), title: lv === 3 ? tr('Every heading') : tr('Down to H{lv}', { lv }),
    onclick: () => setLevel(lv),
  }, `H${lv}`));
  /** Fold the outline so headings down to level lv show (H3: everything). */
  function setLevel(lv) {
    S.level = lv;
    S.collapsed.clear();
    for (const n of build().flat) if (n.children.length && n.level >= lv) S.collapsed.add(n.key);
    paintOutline();
  }
  const status = h('small.np-status', { role: 'status', dataset: { fk: 'np-status' } });
  const panel = h('aside.np-panel', { 'aria-label': tr('Outline'), hidden: true, dataset: { fk: 'np-panel' } },
    h('div.np-panel__head',
      h('b', { text: tr('Outline') }),
      h('span.np-grow'),
      h('div.np-seg.np-levels', { role: 'group', 'aria-label': tr('Fold the outline to a heading level') }, ...lvBtns),
      h('button.ibtn.tip', { type: 'button', 'data-tip': tr('Expand all'), 'aria-label': tr('Expand all'), dataset: { fk: 'np-expand' }, onclick: () => { S.level = null; S.collapsed.clear(); paintOutline(); } }, icon('chevron-down')),
      h('button.ibtn.tip', { type: 'button', 'data-tip': tr('Collapse all'), 'aria-label': tr('Collapse all'), dataset: { fk: 'np-collapse' }, onclick: () => { S.level = null; for (const n of build().flat) if (n.children.length) S.collapsed.add(n.key); paintOutline(); } }, icon('chevron-right')),
      h('button.ibtn.tip', { type: 'button', 'data-tip': tr('Close outline'), 'aria-label': tr('Close outline'), onclick: () => { S.outline = false; savePref(); show(); } }, icon('x'))),
    tree,
    status,
    h('small.np-hint', { text: tr('Drag a row, or use Alt+↑ ↓ to move it, Alt+← → to promote or demote. A section moves with everything under it. Undo with {MOD}Z.', { MOD }) }));

  /* a heading's identity across redraws: level, text and which of its twins it is */
  const keys = flat => { const seen = new Map(); return flat.map(n => { const k = `${n.level}|${n.title}`; const c = (seen.get(k) || 0) + 1; seen.set(k, c); return `${k}|${c}`; }); };
  let model = null;

  function build() {
    const blocks = hooks.blocks();
    const o = OL.outline(blocks);
    const ks = keys(o.flat);
    o.flat.forEach((n, k) => { n._k = k; n.key = ks[k]; });
    return o;
  }
  function visibleRows(o) {
    const out = [];
    const walk = (n, depth) => { out.push({ n, depth }); if (!S.collapsed.has(n.key)) n.children.forEach(c => walk(c, depth + 1)); };
    o.nodes.forEach(n => walk(n, 0));
    return out;
  }
  const maxLevel = n => Math.max(n.level, ...n.children.map(maxLevel));

  function row(r, o, siblings) {
    const { n, depth } = r;
    const open = !S.collapsed.has(n.key);
    const k = siblings.findIndex(s => s.i === n.i);
    const title = n.title.trim() || '(empty heading)';
    const canUp = k > 0, canDown = k >= 0 && k < siblings.length - 1;
    const canPro = n.level > 1, canDem = maxLevel(n) < 3;
    const act = (ic, label, tip, on, enabled) => h('button.np-act', { type: 'button', tabindex: '-1', disabled: !enabled, 'aria-label': `${label}: ${title}`, 'data-tip': tip, title: tip, onclick: e => { e.stopPropagation(); on(); } }, icon(ic, { size: 12 }));
    const el = h('div.np-row', {
      role: 'treeitem', tabindex: S.cur === n.i ? '0' : '-1', draggable: 'true',
      'aria-level': String(depth + 1), 'aria-selected': 'false', 'aria-expanded': n.children.length ? String(open) : null,
      'aria-label': `${title}, heading level ${n.level}, ${OL.describe(n.stats)}`,
      class: `is-h${n.level}`, dataset: { i: String(n.i), level: String(n.level), key: n.key, fk: 'np-row' }, style: { paddingLeft: `${6 + depth * 14}px` },
      onclick: e => { if (e.target.closest('.np-act,.np-tog')) return; S.cur = n.i; hooks.jump(n.i); },
      ondragstart: e => {
        if (e.target !== el) return;
        S.drag = n.i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-staticos-outline', String(n.i));
        e.dataTransfer.setData('text/plain', title);
        el.classList.add('is-drag');
      },
      ondragend: () => { S.drag = null; clearDrop(); el.classList.remove('is-drag'); if (S.late) paintOutline(); },
      ondragover: e => {
        if (S.drag === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const after = isAfter(e, el);
        clearDrop();
        el.classList.add(after ? 'is-after' : 'is-before');
      },
      ondragleave: e => { if (!el.contains(e.relatedTarget)) el.classList.remove('is-before', 'is-after'); },
      ondrop: e => {
        if (S.drag === null) return;
        e.preventDefault();
        const from = S.drag, after = isAfter(e, el);
        S.drag = null; clearDrop();
        /* below an open parent means "first child of it" */
        if (after && n.children.length && open) drop(from, n.children[0].i, 'before');
        else drop(from, n.i, after ? 'after' : 'before');
      },
    },
    n.children.length
      ? h('button.np-tog', { type: 'button', tabindex: '-1', 'aria-label': `${open ? 'Collapse' : 'Expand'} ${title}`, onclick: e => { e.stopPropagation(); toggle(n.key); } }, icon(open ? 'chevron-down' : 'chevron-right', { size: 12 }))
      : h('span.np-tog.is-none'),
    h('span.np-tag', { text: `H${n.level}`, 'aria-hidden': 'true' }),
    h('span.np-body', h('span.np-t', { text: title }), h('small.np-meta', { text: OL.describe(n.stats) })),
    h('span.np-acts',
      act('arrow-up', 'Move up', `Move up (Alt+↑)`, () => run(b => OL.step(b, n.i, -1), n, 'up'), canUp),
      act('arrow-down', 'Move down', `Move down (Alt+↓)`, () => run(b => OL.step(b, n.i, 1), n, 'down'), canDown),
      act('arrow-left', 'Promote', `Promote (Alt+←)`, () => run(b => OL.shift(b, n.i, -1), n, 'promoted'), canPro),
      act('arrow-right', 'Demote', `Demote (Alt+→)`, () => run(b => OL.shift(b, n.i, 1), n, 'demoted'), canDem)));
    return el;
  }
  const isAfter = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  const clearDrop = () => tree.querySelectorAll('.is-before,.is-after').forEach(x => x.classList.remove('is-before', 'is-after'));

  function paintOutline() {
    if (!S.outline || !hooks.note()) return;
    lvBtns.forEach((b, k) => { const on = S.level === k + 1; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-on', on); });
    /* redrawing the rows mid-drag would delete the row being dragged, and the browser then drops nothing:
       wait until the drag is over (dropped, cancelled or ended), then draw */
    if (S.drag !== null && S.drag !== undefined) { S.late = true; return; }
    S.late = false;
    const o = build();
    model = o;
    const rows = visibleRows(o);
    if (S.cur === null || !o.flat.some(n => n.i === S.cur)) S.cur = o.flat.length ? o.flat[0].i : null;
    /* a redraw that would change nothing is skipped: the rows under the pointer stay the same elements, so a click or a drag that
       is just starting is not cut off by the delayed redraw that follows every edit */
    const sibsOf = n => (n.parent ? n.parent.children : o.nodes);
    const sig = JSON.stringify([o.lead.end > 0 ? OL.describe(o.lead.stats) : '', S.cur, rows.map(r => [r.n.i, r.n.key, r.depth, r.n.level, OL.describe(r.n.stats),
      !S.collapsed.has(r.n.key), sibsOf(r.n).findIndex(x => x.i === r.n.i), sibsOf(r.n).length, maxLevel(r.n)])]);
    if (sig === S.sig && S.focusAt === undefined && tree.childElementCount) { status.textContent = S.msg && S.outline ? S.msg : ''; return; }
    S.sig = sig;
    const inTree = tree.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement : null;
    const focusedKey = inTree ? inTree.dataset.key : null;
    const focusedI = inTree ? inTree.dataset.i : null;
    const out = [];
    const lead = o.lead.stats;
    if (o.lead.end > 0 && (lead.words || lead.items || lead.pictures)) {
      out.push(h('div.np-lead', { dataset: { fk: 'np-lead' }, role: 'note' }, h('span.np-t', { text: tr('Before the first heading') }), h('small.np-meta', { text: OL.describe(lead) })));
    }
    if (!o.flat.length) {
      out.push(h('p.np-empty', { dataset: { fk: 'np-empty' }, text: tr('No headings yet. Turn a line into a heading (the Heading button, or # at the start of a line) and it will appear here.') }));
    }
    for (const r of rows) {
      const sibs = r.n.parent ? r.n.parent.children : o.nodes;
      out.push(row(r, o, sibs));
    }
    tree.replaceChildren(...out);
    /* keyboard focus stays on the same heading, even if an edit elsewhere moved it */
    const want = S.focusAt !== undefined ? String(S.focusAt) : (focusedKey && (o.flat.find(n => n.key === focusedKey) || {}).i !== undefined ? String(o.flat.find(n => n.key === focusedKey).i) : focusedI);
    S.focusAt = undefined;
    if (want !== null && want !== undefined) {
      const el = tree.querySelector(`.np-row[data-i="${want}"]`);
      if (el) { S.cur = Number(want); tree.querySelectorAll('.np-row').forEach(x => x.setAttribute('tabindex', x === el ? '0' : '-1')); el.focus(); }
    }
    status.textContent = S.msg && S.outline ? S.msg : '';
  }
  function toggle(key) { S.level = null; if (S.collapsed.has(key)) S.collapsed.delete(key); else S.collapsed.add(key); paintOutline(); }

  /** Run one outline edit as a single undoable change of the note. */
  function run(compute, n, verb, other) {
    const title = n.title.trim() || 'heading';
    const cur = hooks.blocks();
    const same = x => !!cur[x.i] && OL.levelOf(cur[x.i]) === x.level && NF.runsText(cur[x.i].runs) === x.title;
    /* the rows are from a moment ago: if the note has changed under them, refresh instead of editing the wrong heading */
    if (!same(n) || (other && !same(other))) {
      paintOutline();
      const m = 'The note changed, so the outline was refreshed. Try that again.';
      say(m); status.textContent = m;
      return;
    }
    const r = compute(cur);
    if (r.error) { say(r.error); status.textContent = r.error; return; }
    hooks.change(bl => {
      const again = compute(bl);
      if (again.error) return;
      bl.splice(0, bl.length, ...again.blocks);
    });
    S.cur = r.at;
    S.focusAt = r.at;
    const m = `${verb === 'up' || verb === 'down' ? `Moved “${title}” ${verb}` : verb === 'moved' ? `Moved “${title}”` : `${verb[0].toUpperCase()}${verb.slice(1)} “${title}”`}. Undo with ${MOD}Z.`;
    say(m);
    paintOutline();
    status.textContent = m;
  }
  function drop(from, to, where) {
    const o = model || build();
    const a = o.flat.find(x => x.i === from), t = o.flat.find(x => x.i === to);
    if (!a || !t) return;
    run(b => OL.move(b, from, to, where), a, 'moved', t);
  }

  tree.addEventListener('keydown', e => {
    const el = e.target.closest && e.target.closest('.np-row');
    if (!el || !model) return;
    const i = Number(el.dataset.i);
    const n = model.flat.find(x => x.i === i);
    if (!n) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) hooks.redo(); else hooks.undo();
      S.focusAt = undefined;
      paintOutline();
      return;
    }
    if (e.altKey && !mod) {
      const acts = { ArrowUp: () => run(b => OL.step(b, i, -1), n, 'up'), ArrowDown: () => run(b => OL.step(b, i, 1), n, 'down'),
        ArrowLeft: () => run(b => OL.shift(b, i, -1), n, 'promoted'), ArrowRight: () => run(b => OL.shift(b, i, 1), n, 'demoted') };
      if (acts[e.key]) { e.preventDefault(); acts[e.key](); }
      return;
    }
    if (mod || e.shiftKey) return;
    const rows = [...tree.querySelectorAll('.np-row')];
    const at = rows.indexOf(el);
    const go = k => { const t = rows[Math.max(0, Math.min(rows.length - 1, k))]; if (t) { S.cur = Number(t.dataset.i); rows.forEach(x => x.setAttribute('tabindex', x === t ? '0' : '-1')); t.focus(); } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(rows.length - 1); }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (n.children.length && S.collapsed.has(n.key)) toggle(n.key);
      else if (n.children.length) go(at + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (n.children.length && !S.collapsed.has(n.key)) { S.focusAt = i; toggle(n.key); }
      else if (n.parent) go(rows.findIndex(x => Number(x.dataset.i) === n.parent.i));
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hooks.jump(i); }
  });

  /* ---------------- showing and updating ---------------- */
  function show() {
    const has = !!hooks.note();
    panel.hidden = !(S.outline && has);
    strip.hidden = !(S.goal && has);
    outlineBtn.setAttribute('aria-pressed', String(S.outline));
    goalBtn.setAttribute('aria-pressed', String(S.goal));
    outlineBtn.hidden = goalBtn.hidden = !has;
  }
  function changed() {
    if (S.dead) return;
    const n = hooks.note();
    const id = n ? n.id : null;
    if (id !== S.noteId) {
      /* a timer belongs to the note it was started on: leaving it pauses it */
      if (WG.running() !== null && WG.running() !== id) { WG.pause(); ticking(); }
      /* the note left a moment after its last key: those words count too */
      if (S.noteId) { clearTimeout(S.tRepaint); count(hooks.byId?.(S.noteId)); }
      S.noteId = id; S.msg = ''; msg.textContent = ''; S.cur = null; S.collapsed.clear(); S.level = null;
      count(n);
      show();
      paintStrip(); paintOutline();
      return;
    }
    clearTimeout(S.tRepaint);
    S.tRepaint = setTimeout(() => {
      if (S.dead) return;
      count(hooks.note());
      show();
      if (S.goal && hooks.note()) paintStrip();
      if (S.outline) paintOutline();
    }, 120);
  }
  /* the open note's words, towards today's count */
  function count(n) { if (n && (!hooks.counts || hooks.counts(n))) WG.track(n.id, WG.wordsOf(n)); }
  function forget(id) { if (WG.running() === id) { WG.pause(); ticking(); } if (SP.id === id) endSprint(true, true); WG.forget(id); }
  function close() {
    if (!S.dead && S.noteId) count(hooks.byId?.(S.noteId));
    S.dead = true;
    clearTimeout(S.tRepaint);
    if (S.tTick) { clearInterval(S.tTick); S.tTick = 0; }
    WG.pause();
    /* closing the window ends a sprint: what it had is kept */
    endSprint(true, true);
  }

  return { buttons, strip, panel, changed, forget, close, refresh: () => { show(); paintStrip(); paintOutline(); } };
}
