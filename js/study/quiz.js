/* ============================================================
   study/quiz.js — the Quiz tab of Static Study.

   Write a multiple-choice quiz, practise it alone, or host it live for
   friends with a code. Quizzes are files: ~/Documents/Quizzes/<title>
   .quiz.json (js/core/quiz.js says what is in one), exported and
   imported as the same JSON (an export carries each picture, shrunk,
   so the quiz works on another device).

   A tab of Static Study, not an app of its own: the host screen, the
   player screen and the editor all fit this window, and a quiz is
   school work like the cards and homework beside it. A live quiz uses
   js/core/quizroom.js (host-authoritative, sealed, capped) over the
   free public live server, and says so on screen.
   ============================================================ */
import * as Q from '../core/quiz.js';
import * as media from '../core/media.js';
import { vfs } from '../core/vfs.js';
import { me } from '../core/identity.js';
import { openQuizHost, openQuizPlayer, MAX_PLAYERS } from '../core/quizroom.js';
import { normalizeCode, isCode } from '../core/roomcode.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const DIR = () => `${vfs.HOME}/Documents/${Q.DIR_NAME}`;
const NOTICE = 'A live quiz runs over a free public server. The code is sealed, but anyone who has it can join — share it only with the people who are playing.';
const inviteLink = code => { try { return `${location.origin}${location.pathname}#quiz=${code}`; } catch (e) { return ''; } };
const hueColor = hue => `hsl(${hue} 70% 60%)`;
const fmtTime = ms => `${Math.max(0, Math.ceil(ms / 1000))}s`;

/* a picture, shrunk to a small JPEG data URL no longer than maxChars (null if it can't be) */
async function shrink(path, maxChars) {
  const url = await media.urlOf(path);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { return null; }
  const w0 = img.naturalWidth || 1, h0 = img.naturalHeight || 1;
  for (const dim of [420, 320, 240, 180, 130, 90]) {
    for (const quality of [0.72, 0.5, 0.35]) {
      const k = Math.min(1, dim / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL('image/jpeg', quality);
      if (d.length <= maxChars) return d;
    }
  }
  return null;
}
const dataToBlob = d => { const [, b64] = d.split(','); const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'image/jpeg' }); };

export function mountQuiz(host, ctx) {
  const { api } = ctx;
  const { h, icon, clear, confirm } = api;
  const S = { view: 'home', dead: false, note: '', noteErr: false, joinCode: '', joinName: '', edit: null, pr: null, host: null, play: null, picker: -1, offs: [], tick: 0 };
  const urls = new Map();
  const root = h('div.st-quiz');
  host.appendChild(root);

  const btn = (label, ic, onclick, cls = '', k = '', extra = {}) => h(`button.btn${cls}`, { type: 'button', onclick, ...(k ? { dataset: { fk: k } } : {}), ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
  const note = () => (S.note ? h('div', { class: S.noteErr ? 'st-issue' : 'st-flash', role: S.noteErr ? 'alert' : 'status', dataset: { fk: 'quiz-note' } }, icon(S.noteErr ? 'alert' : 'check'), h('span', { text: S.note })) : null);
  const say = (msg, err = false) => { S.note = msg; S.noteErr = err; };
  function thumb(path, cls) {
    const img = h('img', { class: cls, alt: '', draggable: 'false' });
    if (urls.get(path)) img.src = urls.get(path);
    else media.urlOf(path).then(u => { if (u) { urls.set(path, u); if (!S.dead) img.src = u; } }).catch(() => {});
    return img;
  }

  /* ---------- files ---------- */
  function listQuizzes() {
    const out = [];
    for (const n of vfs.ls(DIR())) {
      if (n.type !== 'file' || !/\.quiz\.json$/i.test(n.name)) continue;
      const path = `${DIR()}/${n.name}`;
      const r = Q.cleanQuiz(vfs.read(path) || '');
      out.push({ path, name: n.name, quiz: r.quiz || null, error: r.error || null });
    }
    return out;
  }
  function uniquePath(title) {
    const base = Q.fileNameFor(title).replace(/\.quiz\.json$/, '');
    let name = `${base}.quiz.json`, i = 2;
    while (vfs.node(`${DIR()}/${name}`)) name = `${base} ${i++}.quiz.json`;
    return `${DIR()}/${name}`;
  }
  function saveQuiz(E) {
    const quiz = { title: E.quiz.title.trim(), questions: E.quiz.questions };
    if (!vfs.node(DIR())) vfs.mkdir(DIR());
    const path = E.path || uniquePath(quiz.title);
    vfs.write(path, Q.serialize(quiz));
    E.path = path;
    E.dirty = false;
    return path;
  }
  const clone = quiz => JSON.parse(JSON.stringify(quiz));

  /* ---------- screens ---------- */
  function go(view) { S.view = view; render(); }
  function render() {
    if (S.dead) return;
    clear(root);
    clearInterval(S.tick);
    S.tick = 0;
    const v = { home: renderHome, edit: renderEdit, practice: renderPractice, host: renderHost, play: renderPlay }[S.view];
    root.setAttribute('data-view', S.view);
    v();
  }
  const scroll = (...kids) => h('div.app__content.st-scroll.st-quiz__pane', ...kids);
  const head = (title, ...right) => h('div.st-quiz__head', h('div.app__title', { text: title }), h('span.st-spacer'), ...right);

  /* ---- home ---- */
  function renderHome() {
    const list = listQuizzes();
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: '', 'aria-label': 'Choose a quiz file', dataset: { fk: 'quiz-import-file' },
      onchange: async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) await importFile(f); } });
    const rows = list.length ? list.map(it => h('div.st-qrow', { dataset: { fk: 'quiz-row', path: it.path, title: it.quiz ? it.quiz.title : it.name } },
      h('div.st-card__t', h('b', { text: it.quiz ? it.quiz.title : it.name }),
        h('span', { text: it.quiz ? `${plural(it.quiz.questions.length, 'question')}${it.quiz.questions.some(q => q.time) ? ', some timed' : ''}` : `Can’t be used: ${it.error}` })),
      it.quiz ? btn('Practice', 'play', () => startPractice(it.quiz), '.btn--primary', 'quiz-play') : null,
      it.quiz ? btn('Host live', 'users', () => startHost(it.quiz), '', 'quiz-host') : null,
      it.quiz ? btn('Edit', 'edit-3', () => openEdit(it), '', 'quiz-edit') : null,
      it.quiz ? btn('Export', 'download', () => exportQuiz(it.quiz), '', 'quiz-export') : null,
      btn('Delete', 'trash', () => deleteQuiz(it), '', 'quiz-delete')))
      : [h('div.empty', { dataset: { fk: 'quiz-empty' } }, icon('layers'), h('b', { text: 'No quizzes yet' }), h('span', { text: 'Write one, or import a quiz file a friend sent you.' }))];
    const name = h('input.st-in', { type: 'text', maxlength: '24', 'aria-label': 'Your name', placeholder: 'Your name', value: S.joinName || me().name, dataset: { fk: 'join-name' }, oninput: e => { S.joinName = e.target.value; } });
    const code = h('input.st-in.st-quiz__code', { type: 'text', maxlength: '60', 'aria-label': 'Quiz code', placeholder: 'Code', autocomplete: 'off', spellcheck: 'false', value: S.joinCode, dataset: { fk: 'join-code' }, oninput: e => { S.joinCode = e.target.value; } });
    const join = () => {
      const c = normalizeCode(S.joinCode);
      if (!isCode(c)) { say('That doesn’t look like a quiz code: it is six letters and numbers.', true); render(); return; }
      startPlay(c, (S.joinName || '').trim() || me().name);
    };
    root.append(scroll(head('Quizzes', btn('New quiz', 'plus', newQuiz, '.btn--primary', 'quiz-new'), btn('Import', 'upload', () => file.click(), '', 'quiz-import'), file),
      note(),
      h('div.st-list', { dataset: { fk: 'quiz-list' } }, rows),
      h('section.st-qjoin', { 'aria-label': 'Join a live quiz' },
        h('div.side__label', { text: 'Join a live quiz' }),
        h('form.st-row', { onsubmit: e => { e.preventDefault(); join(); } }, code, name, h('button.btn.btn--primary', { type: 'submit', dataset: { fk: 'join-go' } }, icon('users'), h('span', { text: 'Join' }))),
        h('small.dim', { text: 'Opening an invite link fills in the code; nothing happens until you press Join.' })),
      h('p.st-note.st-quiz__notice', { dataset: { fk: 'quiz-notice' } }, NOTICE)));
  }
  async function deleteQuiz(it) {
    const ok = await confirm({ title: 'Delete this quiz?', message: `“${it.quiz ? it.quiz.title : it.name}” is moved to the Trash.`, ok: 'Delete', danger: true });
    if (!ok || S.dead) return;
    vfs.rm(it.path);
    say('Quiz moved to the Trash.');
    render();
  }

  /* ---- import / export ---- */
  async function exportQuiz(quiz) {
    const pics = {};
    let lost = 0;
    for (const [i, q] of quiz.questions.entries()) {
      if (!q.img) continue;
      const d = await shrink(q.img, 150000).catch(() => null);
      if (d) pics[i] = d; else lost++;
    }
    const a = h('a', { href: URL.createObjectURL(new Blob([Q.serialize(quiz, pics)], { type: 'application/json' })), download: Q.fileNameFor(quiz.title) });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    if (S.dead) return;
    say(`Exported “${quiz.title}”${Object.keys(pics).length ? ` with ${plural(Object.keys(pics).length, 'picture')}` : ''}${lost ? ` (${plural(lost, 'picture')} could not be included)` : ''}.`);
    render();
  }
  async function importFile(f) {
    if (f.size > Q.LIMITS.bytes) { say('That file is too big to be a quiz.', true); render(); return; }
    const r = Q.cleanQuiz(await f.text());
    if (!r.quiz) { say(r.error, true); render(); return; }
    const quiz = r.quiz;
    let kept = 0, dropped = 0;
    for (const q of quiz.questions) {
      if (q.imgData) {
        try { const s = await media.save(`${vfs.HOME}/Pictures/Quiz pictures`, `${quiz.title.slice(0, 30)}.jpg`, dataToBlob(q.imgData)); q.img = s.path; kept++; } catch (e) { q.img = ''; dropped++; }
        delete q.imgData;
      } else if (q.img && !(vfs.node(q.img) && media.isMedia(q.img))) { q.img = ''; dropped++; }
    }
    const path = uniquePath(quiz.title);
    if (!vfs.node(DIR())) vfs.mkdir(DIR());
    vfs.write(path, Q.serialize(quiz));
    if (S.dead) return;
    say(`Imported “${quiz.title}” (${plural(quiz.questions.length, 'question')}${kept ? `, ${plural(kept, 'picture')}` : ''}${dropped ? `; ${plural(dropped, 'picture')} not on this device was left out` : ''}).`);
    render();
  }

  /* ---- editor ---- */
  function newQuiz() { S.edit = { path: null, quiz: Q.blankQuiz(), dirty: false, errors: [] }; S.picker = -1; go('edit'); }
  function openEdit(it) { S.edit = { path: it.path, quiz: clone(it.quiz), dirty: false, errors: [] }; S.picker = -1; go('edit'); }
  function renderEdit() {
    const E = S.edit, quiz = E.quiz;
    const touch = () => { E.dirty = true; };
    const redo = () => { const y = root.querySelector('.st-quiz__pane'); const top = y ? y.scrollTop : 0; render(); const n = root.querySelector('.st-quiz__pane'); if (n) n.scrollTop = top; };
    const qcard = (q, i) => {
      const multi = q.choices.filter(c => c.ok).length > 1;
      return h('section.st-qcard', { dataset: { fk: 'q-card', i }, 'aria-label': `Question ${i + 1}` },
        h('div.st-row', h('b.st-qcard__n', { text: `Question ${i + 1}` }), h('span.st-spacer'),
          btn('', 'chevron-up', () => { if (i > 0) { [quiz.questions[i - 1], quiz.questions[i]] = [quiz.questions[i], quiz.questions[i - 1]]; touch(); redo(); } }, '.btn--icon', `q-up-${i}`, { 'aria-label': `Move question ${i + 1} up`, disabled: i === 0 }),
          btn('', 'chevron-down', () => { if (i < quiz.questions.length - 1) { [quiz.questions[i + 1], quiz.questions[i]] = [quiz.questions[i], quiz.questions[i + 1]]; touch(); redo(); } }, '.btn--icon', `q-down-${i}`, { 'aria-label': `Move question ${i + 1} down`, disabled: i === quiz.questions.length - 1 }),
          btn('', 'trash', () => { if (quiz.questions.length > 1) { quiz.questions.splice(i, 1); touch(); redo(); } }, '.btn--icon', `q-del-${i}`, { 'aria-label': `Delete question ${i + 1}`, disabled: quiz.questions.length < 2 })),
        h('textarea.st-ta', { rows: '2', maxlength: String(Q.LIMITS.text), placeholder: 'Write the question', 'aria-label': `Question ${i + 1} text`, ref: el => { el.value = q.text; }, dataset: { fk: `q-text-${i}` }, oninput: e => { q.text = e.target.value; touch(); } }),
        h('div.st-qchoices', { role: 'group', 'aria-label': `Choices for question ${i + 1}` }, q.choices.map((c, j) => h('div.st-qchoice', { class: c.ok ? 'is-ok' : '' },
          h('input', { type: 'checkbox', checked: c.ok, 'aria-label': `Choice ${j + 1} is right`, title: 'Mark as a right answer', dataset: { fk: `q-ok-${i}-${j}` }, onchange: e => { c.ok = e.target.checked; touch(); redo(); } }),
          h('input.st-in', { type: 'text', maxlength: String(Q.LIMITS.choice), placeholder: `Choice ${j + 1}`, 'aria-label': `Question ${i + 1} choice ${j + 1}`, value: c.text, dataset: { fk: `q-choice-${i}-${j}` }, oninput: e => { c.text = e.target.value; touch(); } }),
          btn('', 'x', () => { if (q.choices.length > Q.LIMITS.minChoices) { q.choices.splice(j, 1); touch(); redo(); } }, '.btn--icon', `q-rm-${i}-${j}`, { 'aria-label': `Remove choice ${j + 1}`, disabled: q.choices.length <= Q.LIMITS.minChoices })))),
        h('div.st-row', btn('Add a choice', 'plus', () => { if (q.choices.length < Q.LIMITS.choices) { q.choices.push({ text: '', ok: false }); touch(); redo(); } }, '', `q-add-choice-${i}`, { disabled: q.choices.length >= Q.LIMITS.choices }),
          h('small.dim', { text: multi ? 'More than one right answer: players must pick exactly those.' : 'Tick the box beside every right choice.' })),
        h('div.st-row.st-qopts',
          h('label.st-f', h('span.st-f__l', { text: 'Time limit' }),
            h('select.select.st-sel', { 'aria-label': `Question ${i + 1} time limit`, dataset: { fk: `q-time-${i}` }, onchange: e => { q.time = Number(e.target.value); touch(); } },
              [[0, 'No limit'], [10, '10 seconds'], [15, '15 seconds'], [20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '1 minute'], [120, '2 minutes']].map(([v, t]) => h('option', { value: String(v), text: t, selected: q.time === v })))),
          h('div.st-f', h('span.st-f__l', { text: 'Picture (optional)' }),
            h('div.st-imgrow', q.img ? thumb(q.img, 'st-thumb') : null,
              btn(q.img ? 'Change' : 'Choose from Pictures', 'image', () => { S.picker = S.picker === i ? -1 : i; redo(); }, '', `q-pic-${i}`),
              q.img ? btn('Remove', 'x', () => { q.img = ''; touch(); redo(); }, '', `q-pic-rm-${i}`) : null))),
        S.picker === i ? pickerEl(path => { q.img = path; S.picker = -1; touch(); redo(); }) : null,
        E.errors[i] && E.errors[i].length ? h('div.st-issue', { role: 'alert', dataset: { fk: `q-issue-${i}` } }, icon('alert'), h('span', { text: E.errors[i].join(' ') })) : null);
    };
    const doSave = () => {
      E.errors = quiz.questions.map(q => Q.questionIssues(q));
      const top = [];
      if (!quiz.title.trim()) top.push('Give the quiz a title.');
      if (top.length || E.errors.some(e => e.length)) { say(top.length ? top.join(' ') : 'Some questions need attention before the quiz can be saved.', true); redo(); return false; }
      const path = saveQuiz(E);
      say(`Saved “${quiz.title.trim()}” in Documents/${Q.DIR_NAME}.`);
      E.errors = [];
      redo();
      return path;
    };
    root.append(scroll(
      head(E.path ? 'Edit quiz' : 'New quiz',
        h('small.dim', { dataset: { fk: 'quiz-dirty' }, text: E.dirty ? 'Unsaved changes' : (E.path ? 'Saved' : '') }),
        btn('Save', 'save', doSave, '.btn--primary', 'quiz-save'),
        btn('Back', 'arrow-left', async () => { if (E.dirty && !(await confirm({ title: 'Leave without saving?', message: 'Your changes to this quiz are not saved.', ok: 'Leave', danger: true }))) return; if (!S.dead) { S.note = ''; go('home'); } }, '', 'quiz-back')),
      note(),
      h('label.st-f', h('span.st-f__l', { text: 'Title' }), h('input.st-in', { type: 'text', maxlength: String(Q.LIMITS.title), placeholder: 'Quiz title', 'aria-label': 'Quiz title', value: quiz.title, dataset: { fk: 'quiz-title' }, oninput: e => { quiz.title = e.target.value; touch(); } })),
      h('div.st-qlist', quiz.questions.map(qcard)),
      h('div.st-row', btn('Add a question', 'plus', () => { if (quiz.questions.length < Q.LIMITS.questions) { quiz.questions.push(Q.blankQuestion()); touch(); redo(); setTimeout(() => { const s = root.querySelectorAll('.st-qcard'); if (s.length) s[s.length - 1].scrollIntoView({ block: 'nearest' }); }, 0); } }, '', 'quiz-add-q', { disabled: quiz.questions.length >= Q.LIMITS.questions }),
        h('small.dim', { text: `${plural(quiz.questions.length, 'question')} of up to ${Q.LIMITS.questions}` }))));
  }
  function pickerEl(onPick) {
    const pics = [];
    try { vfs.walk(`${vfs.HOME}/Pictures`, (n, p) => { if (n.type === 'file' && media.kindOf(n.name) === 'image' && media.isMedia(n)) pics.push({ n, p }); }); } catch (e) { /* none */ }
    pics.sort((a, b) => Date.parse(b.n.mtime) - Date.parse(a.n.mtime));
    return h('div.st-pick', { role: 'group', 'aria-label': 'Pictures', dataset: { fk: 'q-picker' } },
      pics.length ? pics.slice(0, 36).map(({ n, p }) => h('button.st-pick__i', { type: 'button', title: n.name, 'aria-label': `Use picture ${n.name}`, dataset: { path: p }, onclick: () => onPick(p) }, thumb(p, 'st-pick__img')))
        : h('small.dim', { text: 'There are no pictures in ~/Pictures yet. Take a screenshot or import one in Photos.' }));
  }

  /* ---- practice ---- */
  function startPractice(quiz) {
    S.pr = { quiz: clone(quiz), i: 0, picks: new Set(), answers: [], phase: 'ask', startedAt: performance.now(), left: 0 };
    go('practice');
  }
  function renderPractice() {
    const P = S.pr, quiz = P.quiz;
    if (P.phase === 'done') return renderPracticeDone();
    const q = quiz.questions[P.i];
    const multi = q.choices.filter(c => c.ok).length > 1;
    const asking = P.phase === 'ask';
    const submit = (auto = false) => {
      if (P.phase !== 'ask') return;
      if (!P.picks.size && !auto) return;
      const picks = [...P.picks].sort((a, b) => a - b);
      const el = performance.now() - P.startedAt;
      const right = picks.length > 0 && Q.isRight(q, picks);
      P.answers.push({ picks, right, pts: Q.pointsFor(right, el, q.time), el });
      P.phase = 'feedback';
      render();
    };
    const choiceBtn = (c, j) => {
      const on = P.picks.has(j);
      const cls = !asking ? (c.ok ? ' is-right' : on ? ' is-wrong' : '') : (on ? ' is-on' : '');
      return h('button.st-opt', { class: cls.trim(), type: 'button', role: multi ? 'checkbox' : 'radio', 'aria-checked': on ? 'true' : 'false', dataset: { fk: `pr-choice-${j}` }, disabled: !asking,
        onclick: () => { if (multi) { on ? P.picks.delete(j) : P.picks.add(j); } else { P.picks = new Set([j]); } render(); } },
        h('i.st-opt__k', { text: String.fromCharCode(65 + j) }), h('span', { text: c.text }), !asking && c.ok ? icon('check') : null);
    };
    const fb = P.answers[P.i];
    const timeEl = q.time ? h('div.st-qtimer', { dataset: { fk: 'pr-time' }, role: 'timer', text: asking ? fmtTime(q.time * 1000 - (performance.now() - P.startedAt)) : '' }) : null;
    root.append(scroll(
      head(quiz.title, h('small.st-prog', { dataset: { fk: 'pr-progress' }, text: `Question ${P.i + 1} of ${quiz.questions.length}` }),
        btn('Quit', 'x', () => go('home'), '', 'pr-quit')),
      h('div.st-qplay', h('p.st-qplay__q', { dataset: { fk: 'pr-question' }, text: q.text }),
        q.img ? thumb(q.img, 'st-qplay__img') : null, timeEl,
        h('div.st-opts', { role: multi ? 'group' : 'radiogroup', 'aria-label': 'Choices' }, q.choices.map(choiceBtn)),
        multi && asking ? h('small.dim', { text: 'Pick every right answer, then press Check.' }) : null,
        asking ? btn('Check', 'check', () => submit(false), '.btn--primary', 'pr-submit', { disabled: !P.picks.size })
          : h('div.st-qfb', { dataset: { fk: 'pr-feedback' }, class: fb.right ? 'is-right' : 'is-wrong', role: 'status' },
            h('b', { text: fb.right ? `Right! +${fb.pts} points` : (fb.picks.length ? 'Not quite.' : 'Time’s up.') }),
            btn(P.i + 1 < quiz.questions.length ? 'Next question' : 'See my score', 'arrow-right', () => { if (P.i + 1 < quiz.questions.length) { P.i++; P.picks = new Set(); P.phase = 'ask'; P.startedAt = performance.now(); } else P.phase = 'done'; render(); }, '.btn--primary', 'pr-next'))
      )));
    if (q.time && asking) {
      S.tick = setInterval(() => {
        const left = q.time * 1000 - (performance.now() - P.startedAt);
        const el = root.querySelector('[data-fk="pr-time"]');
        if (el) el.textContent = fmtTime(left);
        if (left <= 0) { clearInterval(S.tick); submit(true); }
      }, 250);
    }
  }
  function renderPracticeDone() {
    const P = S.pr, quiz = P.quiz;
    const right = P.answers.filter(a => a.right).length;
    const pts = P.answers.reduce((s, a) => s + a.pts, 0);
    const lines = quiz.questions.map((q, i) => {
      const a = P.answers[i];
      const names = idx => idx.map(j => q.choices[j].text).join(', ') || 'no answer';
      return h('li.st-rev', { class: a.right ? 'is-right' : 'is-wrong', dataset: { fk: 'pr-review-row', i } },
        icon(a.right ? 'check' : 'x'),
        h('div', h('b', { text: `${i + 1}. ${q.text}` }),
          h('span', { text: `You: ${names(a.picks)}` }),
          a.right ? null : h('span', { text: `Right answer: ${names(q.choices.map((c, j) => (c.ok ? j : -1)).filter(j => j >= 0))}` })),
        h('small', { text: a.right ? `+${a.pts}` : '0' }));
    });
    root.append(scroll(head(quiz.title, btn('Back to quizzes', 'arrow-left', () => go('home'), '', 'pr-home')),
      h('div.st-qdone', h('b.st-qdone__score', { dataset: { fk: 'pr-score' }, text: `${right} of ${quiz.questions.length} right` }),
        h('span', { dataset: { fk: 'pr-points' }, text: `${pts.toLocaleString()} points (right answers earn 500, plus up to 500 for speed)` }),
        h('div.st-row', btn('Play again', 'refresh', () => startPractice(quiz), '.btn--primary', 'pr-again'))),
      h('div.side__label', { text: 'Review' }),
      h('ol.st-revlist', { dataset: { fk: 'pr-review' } }, lines)));
  }

  /* ---- live: host ---- */
  function startHost(quiz) {
    if (S.host) S.host.room.leave();
    const q2 = clone(quiz);
    const room = openQuizHost({ quiz: q2, pictures: i => (q2.questions[i].img ? shrink(q2.questions[i].img, 13000) : Promise.resolve(null)) });
    S.host = { room, quiz: q2, off: room.on(() => { if (!S.dead && S.view === 'host') render(); }) };
    go('host');
  }
  function leaveHost() {
    if (!S.host) return;
    S.host.off(); S.host.room.leave(); S.host = null;
  }
  function boardList(rows, fkName, mine = null) {
    return h('ol.st-board', { dataset: { fk: fkName }, 'aria-label': 'Leaderboard' }, rows.slice(0, MAX_PLAYERS).map((r, k) => h('li', { class: mine === r.idx ? 'is-me' : '', dataset: { name: r.name, score: String(r.score), rank: String(k + 1) } },
      h('b.st-board__rank', { text: String(k + 1) }), h('i.st-board__dot', { style: `background:${hueColor(r.hue)}` }),
      h('span.st-board__name', { text: r.name }), h('span.st-board__gain', { text: r.gain ? `+${r.gain}` : (r.right === 2 || r.right === undefined ? '' : '0') }), h('b.st-board__score', { text: r.score.toLocaleString() }))));
  }
  function renderHost() {
    const Hs = S.host;
    if (!Hs) return go('home');
    const st = Hs.room.state();
    const code = Hs.room.code;
    const players = st.players;
    const away = players.filter(p => p.gone).length;
    const top = [head(`Hosting: ${Hs.quiz.title}`, btn(st.phase === 'end' ? 'Done' : 'End quiz', st.phase === 'end' ? 'check' : 'x', async () => {
      if (st.phase !== 'end' && st.phase !== 'lobby' && !(await confirm({ title: 'End the quiz?', message: 'Everyone is disconnected from this room.', ok: 'End quiz', danger: true }))) return;
      if (S.dead) return;
      leaveHost(); S.note = ''; go('home');
    }, '', 'host-end')), note()];
    const sorted = [...players].sort((a, b) => b.score - a.score || a.idx - b.idx);
    const notice = h('p.st-note.st-quiz__notice', { dataset: { fk: 'quiz-notice' } }, NOTICE);
    if (st.error === 'insecure') { root.append(scroll(...top, h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: 'Live quizzes need a secure connection (https or localhost); this page doesn’t have one.' })))); return; }
    if (st.phase === 'connecting') { root.append(scroll(...top, h('p', { dataset: { fk: 'host-connecting' }, role: 'status', text: 'Connecting to the live server…' }), notice)); return; }
    if (st.phase === 'lobby') {
      const link = inviteLink(code);
      root.append(scroll(...top,
        h('div.st-hostcode', h('small', { text: 'Join code' }), h('b.st-hostcode__c', { dataset: { fk: 'host-code', code }, 'aria-label': `Join code ${code.split('').join(' ')}`, text: code }),
          h('div.st-row', btn('Copy code', 'copy', () => copyText(code, 'Code copied.'), '', 'host-copy-code'), btn('Copy invite link', 'link', () => copyText(link, 'Invite link copied.'), '', 'host-copy-link')),
          h('small.dim', { dataset: { fk: 'host-link' }, text: link })),
        notice,
        h('div.side__label', { text: `Players (${players.length} of ${MAX_PLAYERS})` }),
        h('ul.st-players', { dataset: { fk: 'host-players' } }, players.length ? players.map(p => h('li', { dataset: { name: p.name } }, h('i.st-board__dot', { style: `background:${hueColor(p.hue)}` }), h('span', { text: p.name }))) : [h('li.dim', { text: 'Waiting for players. Give them the code or the link.' })]),
        h('div.st-row', btn('Start the quiz', 'play', () => Hs.room.start(), '.btn--primary', 'host-start', { disabled: !players.length }), h('small.dim', { text: players.length ? `${plural(Hs.quiz.questions.length, 'question')}` : 'You need at least one player.' }))));
      return;
    }
    if (st.phase === 'question') {
      const cur = st.question;
      const lim = cur.time * 1000;
      root.append(scroll(...top,
        h('div.st-row', h('b', { dataset: { fk: 'host-progress' }, text: `Question ${st.qi + 1} of ${st.total}` }), h('span.st-spacer'),
          cur.time ? h('span.st-qtimer', { dataset: { fk: 'host-time' }, role: 'timer', text: fmtTime(lim - (performance.now() - st.openedAt)) }) : null),
        h('p.st-qplay__q', { dataset: { fk: 'host-question' }, text: cur.text }),
        Hs.quiz.questions[st.qi].img ? thumb(Hs.quiz.questions[st.qi].img, 'st-qplay__img') : null,
        h('ul.st-hostch', cur.choices.map((c, j) => h('li', { text: `${String.fromCharCode(65 + j)}. ${c.text}` }))),
        h('p', { dataset: { fk: 'host-answered' }, role: 'status', text: `${st.answered} of ${plural(players.filter(p => !p.gone).length, 'player')} answered${away ? ` (${away} away)` : ''}` }),
        h('p.dim', { text: 'The right answers are not sent to anyone until you close the question.' }),
        btn('Show the answers', 'check', () => Hs.room.closeQuestion(), '.btn--primary', 'host-close')));
      if (cur.time) S.tick = setInterval(() => { const el = root.querySelector('[data-fk="host-time"]'); if (el) el.textContent = fmtTime(lim - (performance.now() - st.openedAt)); }, 250);
      return;
    }
    if (st.phase === 'reveal') {
      const cur = st.question;
      const rev = st.rev;
      const last = st.qi + 1 >= st.total;
      root.append(scroll(...top,
        h('b', { text: `Question ${st.qi + 1} of ${st.total}: ${cur.text}` }),
        h('ul.st-hostch', { dataset: { fk: 'host-results' } }, cur.choices.map((c, j) => h('li', { class: c.ok ? 'is-right' : '', dataset: { ok: c.ok ? '1' : '0' }, text: `${String.fromCharCode(65 + j)}. ${c.text}  ·  ${rev.dist[j]} ${rev.dist[j] === 1 ? 'player' : 'players'}${c.ok ? '  ✓ right' : ''}` }))),
        h('div.side__label', { text: 'Leaderboard' }),
        boardList(rev.bd.map(r => ({ idx: r[0], name: r[1], hue: r[2], score: r[3], gain: r[4], right: r[5] })), 'host-board'),
        btn(last ? 'Show final results' : 'Next question', 'arrow-right', () => Hs.room.next(), '.btn--primary', 'host-next')));
      return;
    }
    root.append(scroll(...top,
      h('div.st-qdone', h('b.st-qdone__score', { dataset: { fk: 'host-final' }, text: sorted.length ? `${sorted[0].name} wins with ${sorted[0].score.toLocaleString()} points` : 'The quiz is over' })),
      h('div.side__label', { text: 'Final leaderboard' }),
      boardList(sorted.map(p => ({ idx: p.idx, name: p.name, hue: p.hue, score: p.score, gain: 0, right: 2 })), 'host-board')));
  }
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); say(msg); } catch (e) { say('Couldn’t copy: select the text and copy it yourself.', true); }
    if (!S.dead && S.view === 'host') render();
  }

  /* ---- live: player ---- */
  function startPlay(code, name) {
    if (S.play) S.play.room.leave();
    const room = openQuizPlayer({ code, name });
    S.play = { room, off: room.on(() => { if (!S.dead && S.view === 'play') render(); }), picks: new Set() };
    go('play');
  }
  function leavePlay() { if (!S.play) return; S.play.off(); S.play.room.leave(); S.play = null; }
  const WHY = { full: 'That room is full.', nobody: 'Nobody answered that code. Check it, and that the host has opened the quiz.', invalid: 'That isn’t a quiz code.', insecure: 'Live quizzes need a secure connection (https or localhost).', lost: 'The connection to the host was lost.', 'host-left': 'The host ended the quiz.' };
  function renderPlay() {
    const Pl = S.play;
    if (!Pl) return go('home');
    const st = Pl.room.state();
    const out = [head('Live quiz', btn('Leave', 'x', () => { leavePlay(); go('home'); }, '', 'pl-leave')), note()];
    const status = t => h('p', { dataset: { fk: 'pl-status' }, role: 'status', text: t });
    if (st.phase === 'closed') { root.append(scroll(...out, h('div.st-issue', { role: 'alert', dataset: { fk: 'pl-error' } }, icon('alert'), h('span', { text: WHY[st.error] || 'The quiz has ended.' })), btn('Back', 'arrow-left', () => { leavePlay(); go('home'); }, '', 'pl-home'))); return; }
    if (st.phase === 'connecting' || st.phase === 'joining') { root.append(scroll(...out, status(st.phase === 'connecting' ? 'Connecting to the live server…' : `Joining ${Pl.room.code}…`))); return; }
    if (st.phase === 'lobby') {
      root.append(scroll(...out, status(st.title ? `You’re in: “${st.title}” (${plural(st.total, 'question')}). Waiting for the host to start…` : 'You’re in. Waiting for the host to start…'),
        h('ul.st-players', { dataset: { fk: 'pl-players' } }, st.lobby.map(p => h('li', { class: p.idx === st.idx ? 'is-me' : '', dataset: { name: p.name } }, h('i.st-board__dot', { style: `background:${hueColor(p.hue)}` }), h('span', { text: p.name })))),
        h('p.st-note.st-quiz__notice', { text: NOTICE })));
      return;
    }
    const mine = st.board.find(r => r.idx === st.idx);
    if (st.phase === 'question') {
      const q = st.question;
      if (Pl.qid !== q.qid) { Pl.qid = q.qid; Pl.picks = new Set(); }
      const choose = j => {
        if (q.answered) return;
        if (q.multi) { Pl.picks.has(j) ? Pl.picks.delete(j) : Pl.picks.add(j); render(); }
        else { Pl.room.answer([j]); }
      };
      const left = () => (q.deadline ? q.deadline - performance.now() : null);
      root.append(scroll(...out,
        h('div.st-row', h('b', { dataset: { fk: 'pl-progress' }, text: `Question ${q.i + 1} of ${st.total || '?'}` }), h('span.st-spacer'),
          q.limit ? h('span.st-qtimer', { dataset: { fk: 'pl-time' }, role: 'timer', text: fmtTime(left()) }) : null),
        h('p.st-qplay__q', { dataset: { fk: 'pl-question' }, text: q.text }),
        q.img ? h('img.st-qplay__img', { src: q.img, alt: '' }) : null,
        h('div.st-opts', { role: q.multi ? 'group' : 'radiogroup', 'aria-label': 'Choices' }, q.choices.map((c, j) => {
          const on = q.answered ? (q.picks || []).includes(j) : Pl.picks.has(j);
          return h('button.st-opt', { class: on ? 'is-on' : '', type: 'button', role: q.multi ? 'checkbox' : 'radio', 'aria-checked': on ? 'true' : 'false', disabled: q.answered, dataset: { fk: `pl-choice-${j}` }, onclick: () => choose(j) },
            h('i.st-opt__k', { text: String.fromCharCode(65 + j) }), h('span', { text: c }));
        })),
        q.multi && !q.answered ? h('div.st-row', h('small.dim', { text: 'More than one answer is right: pick them all.' }), btn('Lock in', 'check', () => Pl.room.answer([...Pl.picks]), '.btn--primary', 'pl-submit', { disabled: !Pl.picks.size })) : null,
        h('p', { dataset: { fk: 'pl-status' }, role: 'status', text: q.answered ? 'Answer locked in. Waiting for the others…' : (q.multi ? 'Choose, then lock in.' : 'Tap your answer.') })));
      if (q.limit) S.tick = setInterval(() => { const el = root.querySelector('[data-fk="pl-time"]'); if (el) el.textContent = fmtTime(left()); }, 250);
      return;
    }
    if (st.phase === 'reveal') {
      const q = st.question, rev = st.rev;
      const got = (q.picks || []);
      const rightMine = mine ? mine.right : 2;
      root.append(scroll(...out,
        h('p.st-qplay__q', { text: q.text }),
        h('div.st-opts', { dataset: { fk: 'pl-results' } }, q.choices.map((c, j) => h('div.st-opt', { class: rev.ok.includes(j) ? 'is-right' : (got.includes(j) ? 'is-wrong' : ''), dataset: { ok: rev.ok.includes(j) ? '1' : '0' } },
          h('i.st-opt__k', { text: String.fromCharCode(65 + j) }), h('span', { text: c }), h('small', { text: `${rev.dist[j]}` })))),
        h('p.st-qfb', { class: rightMine === 1 ? 'is-right' : 'is-wrong', dataset: { fk: 'pl-result' }, role: 'status', text: rightMine === 1 ? `Right! +${mine.gain} points` : (rightMine === 0 ? 'Not this time.' : 'You didn’t answer in time.') }),
        h('div.side__label', { text: 'Leaderboard' }),
        boardList(st.board, 'pl-board', st.idx),
        h('small.dim', { text: 'Waiting for the host to go on…' })));
      return;
    }
    root.append(scroll(...out,
      h('div.st-qdone', h('b.st-qdone__score', { dataset: { fk: 'pl-final' }, text: mine ? `You finished with ${mine.score.toLocaleString()} points` : 'The quiz is over' }),
        mine ? h('span', { text: `Place ${st.board.findIndex(r => r.idx === st.idx) + 1} of ${st.board.length}` }) : null),
      h('div.side__label', { text: 'Final leaderboard' }),
      boardList(st.board, 'pl-board', st.idx),
      btn('Back', 'arrow-left', () => { leavePlay(); go('home'); }, '', 'pl-home')));
  }

  /* ---------- opening ---------- */
  function open(o) {
    if (o && o.quizJoin) {
      const c = normalizeCode(o.quizJoin);
      if (isCode(c) && (S.view === 'home' || S.view === 'play' && !S.play)) { S.joinCode = c; S.view = 'home'; render(); setTimeout(() => root.querySelector('[data-fk="join-name"]')?.focus({ preventScroll: true }), 40); }
    }
  }
  render();
  host.quizPeek = () => ({ view: S.view, hostCode: S.host ? S.host.room.code : null, hostState: S.host ? S.host.room.state() : null, playState: S.play ? S.play.room.state() : null, playStats: S.play ? S.play.room.stats() : null, hostStats: S.host ? S.host.room.stats() : null, hostTopic: S.host ? S.host.room._debug.topic() : null });

  return {
    open,
    teardown() {
      S.dead = true;
      clearInterval(S.tick);
      leaveHost(); leavePlay();
    },
  };
}
