/* ============================================================
   study/gpa.js — the GPA tab of Static Study.

   Semesters of courses (name, credits, a letter or a percentage,
   regular / honors / AP), weighted or unweighted, a cumulative GPA,
   an editable grade scale, and a "what do I need on the final"
   helper. Every result prints the sum it came from; a course that
   can't be counted is listed with the reason instead of guessed at.
   The arithmetic is in js/core/gpa.js.
   ============================================================ */
import * as GP from '../core/gpa.js';

const TABS = [['gpa', 'GPA'], ['final', 'Final exam'], ['scale', 'Grade scale']];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mountGpa(host, ctx) {
  const { api } = ctx;
  const { h, icon, clear, confirm } = api;
  const S = {
    data: GP.read(), tab: 'gpa', dead: false,
    fin: { current: '', weight: '', target: '' },
    scaleIssue: '',
  };
  const root = h('div.st-gpa');
  host.appendChild(root);

  function mutate(fn) { const d = GP.read(); fn(d); S.data = GP.write(d); }
  const sem = () => S.data.semesters.find(s => s.id === S.data.activeId) || null;

  /* ---------- actions ---------- */
  function addSemester(name) {
    const nm = String(name || '').trim();
    if (!nm) return;
    if (S.data.semesters.length >= GP.MAX_SEMESTERS) return;
    const id = GP.uid('s');
    mutate(d => { d.semesters.push({ id, name: nm, courses: [] }); d.activeId = id; });
    S.addingSem = false;
    S.focusCourse = true;
    render();
  }
  async function deleteSemester() {
    const s = sem();
    if (!s) return;
    const ok = await confirm({ title: 'Delete this semester?', message: `“${s.name}” and its ${plural(s.courses.length, 'course')} are removed, and the cumulative GPA changes. This can’t be undone.`, ok: 'Delete', danger: true });
    if (!ok || S.dead) return;
    mutate(d => { d.semesters = d.semesters.filter(x => x.id !== s.id); d.activeId = d.semesters[0] ? d.semesters[0].id : ''; });
    render();
  }
  function addCourse() {
    if (!sem() || sem().courses.length >= GP.MAX_COURSES) return;
    mutate(d => d.semesters.find(x => x.id === d.activeId).courses.push(GP.normCourse({})));
    S.focusCourse = true;
    render();
  }
  function setCourse(id, patch) {
    mutate(d => { const c = d.semesters.find(x => x.id === d.activeId).courses.find(x => x.id === id); if (c) Object.assign(c, patch); });
    paintResults();
  }
  function deleteCourse(id) {
    mutate(d => { const s = d.semesters.find(x => x.id === d.activeId); s.courses = s.courses.filter(c => c.id !== id); });
    render();
  }
  function setWeighted(on) { mutate(d => { d.weighted = on; }); render(); }

  /* ---------- results ---------- */
  const resultsBox = h('div.st-results', { 'aria-live': 'polite' });
  function resultCard(label, r, fk, extra) {
    return h('section.st-res', { 'aria-label': label, dataset: { fk } },
      h('div.st-res__top', h('small', { text: label }), h('b.st-res__n', { dataset: { fk: `${fk}-gpa` }, text: GP.fmt(r.gpa) }), h('small', { dataset: { fk: `${fk}-credits` }, text: r.used ? `${plural(r.used, 'course')} counted · ${Math.round(r.credits * 100) / 100} credits` : 'No courses counted yet' })),
      r.formula ? h('code.st-formula', { dataset: { fk: `${fk}-formula` }, text: r.formula }) : h('small.dim', { text: 'Add a course with credits and a grade to see the working.' }),
      extra || null);
  }
  function paintResults() {
    clear(resultsBox);
    const s = sem();
    if (!s) return;
    const r = GP.semesterGpa(s, S.data);
    const cum = GP.cumulativeGpa(S.data);
    const skipped = r.rows.filter(x => !x.counted && (x.course.name || x.course.grade || x.course.credits));
    resultsBox.append(
      resultCard(`${s.name} GPA`, r, 'sem', skipped.length ? h('ul.st-skipped', { dataset: { fk: 'skipped' } }, skipped.map(x => h('li', { text: `${x.course.name || 'Untitled course'}: not counted. ${x.why}.` }))) : null),
      resultCard(`Cumulative GPA${S.data.semesters.length > 1 ? ` (${S.data.semesters.length} semesters)` : ''}`, cum, 'cum'),
      h('p.st-note', { dataset: { fk: 'rule' }, text: `${S.data.weighted ? `Weighted: honors add +${S.data.bonus.honors} and AP/IB add +${S.data.bonus.ap} to a course’s points (not to an F). ` : 'Unweighted: honors and AP/IB courses count like any other. '}GPA = Σ(points × credits) ÷ Σ credits. The cumulative GPA is over every course at once, not an average of semester GPAs.` }));
  }

  /* ---------- the GPA tab ---------- */
  function gpaTab() {
    const wrap = h('div');
    const chips = h('div.tabs.st-sems', { role: 'tablist', 'aria-label': 'Semesters' }, S.data.semesters.map(s =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': s.id === S.data.activeId ? 'true' : 'false', class: s.id === S.data.activeId ? 'is-on' : '', dataset: { sem: s.id },
        onclick: () => { mutate(d => { d.activeId = s.id; }); render(); } }, h('span', { text: s.name }))));
    const semIn = h('input.st-in', { type: 'text', maxlength: '40', placeholder: 'e.g. Fall 2026', 'aria-label': 'New semester name', dataset: { fk: 'sem-name' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addSemester(e.target.value); } else if (e.key === 'Escape') { S.addingSem = false; render(); } } });
    if (S.addingSem) S.focusEl = semIn;
    wrap.append(h('div.st-row.st-semrow', chips,
      S.addingSem ? h('span.st-inline', semIn, h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'sem-add' }, onclick: () => addSemester(semIn.value) }, icon('check'), h('span', { text: 'Add' })))
        : h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'new-sem' }, onclick: () => { S.addingSem = true; render(); } }, icon('plus'), h('span', { text: 'New semester' })),
      sem() ? h('button.ibtn', { type: 'button', 'aria-label': `Delete semester ${sem().name}`, onclick: deleteSemester }, icon('trash')) : null));
    const s = sem();
    if (!s) {
      wrap.append(h('div.empty', icon('calculator'), h('b', { text: 'Start with a semester' }), h('small', { text: 'Add a semester, then its courses with credits and grades. The GPA is worked out from exactly what you enter.' }),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'first-sem' }, onclick: () => { S.addingSem = true; render(); } }, icon('plus'), h('span', { text: 'New semester' }))));
      return wrap;
    }
    const table = h('div.st-courses', { role: 'table', 'aria-label': `Courses in ${s.name}` },
      h('div.st-courses__h', { role: 'row' }, ['Course', 'Credits', 'Grade (letter or %)', 'Level', ''].map((t, i) => h('span', { role: 'columnheader', class: i === 4 ? 'sr' : null, text: i === 4 ? 'Remove' : t }))));
    s.courses.forEach((c, i) => {
      const name = h('input.st-in', { type: 'text', value: c.name, maxlength: '60', placeholder: 'Course', 'aria-label': `Course ${i + 1} name`, dataset: { fk: 'c-name' }, oninput: e => setCourse(c.id, { name: e.target.value }) });
      const cr = h('input.st-in', { type: 'text', inputmode: 'decimal', value: c.credits, maxlength: '6', placeholder: '3', 'aria-label': `Course ${i + 1} credits`, dataset: { fk: 'c-credits' }, oninput: e => setCourse(c.id, { credits: e.target.value }) });
      const gr = h('input.st-in', { type: 'text', value: c.grade, maxlength: '8', placeholder: 'A- or 91', 'aria-label': `Course ${i + 1} grade`, dataset: { fk: 'c-grade' }, oninput: e => setCourse(c.id, { grade: e.target.value }) });
      const lv = h('select.select.st-sel', { 'aria-label': `Course ${i + 1} level`, dataset: { fk: 'c-level' }, title: S.data.weighted ? '' : 'Level only matters in weighted mode', onchange: e => setCourse(c.id, { level: e.target.value }) },
        GP.LEVELS.map(([v, l]) => h('option', { value: v, text: l, selected: v === c.level })));
      if (S.focusCourse && i === s.courses.length - 1) { S.focusEl = name; S.focusCourse = false; }
      table.append(h('div.st-courses__r', { role: 'row', dataset: { course: c.id } }, name, cr, gr, lv,
        h('button.ibtn', { type: 'button', 'aria-label': `Remove course ${c.name || i + 1}`, onclick: () => deleteCourse(c.id) }, icon('trash'))));
    });
    wrap.append(table,
      s.courses.length ? null : h('p.st-none', { text: 'No courses in this semester yet.' }),
      h('div.st-row', h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'add-course' }, onclick: addCourse }, icon('plus'), h('span', { text: 'Add course' }))));
    wrap.append(resultsBox);
    paintResults();
    return wrap;
  }

  /* ---------- the final-exam helper ---------- */
  function finalTab() {
    const f = S.fin;
    const out = h('div.st-res', { 'aria-live': 'polite', dataset: { fk: 'fin-out' } });
    const paint = () => {
      clear(out);
      const filled = f.current !== '' && f.weight !== '' && f.target !== '';
      const r = filled ? GP.neededOnFinal(f.current, f.weight, f.target) : null;
      if (!filled) { out.append(h('small.dim', { text: 'Fill in all three to see what you need.' })); return; }
      if (!r) { out.append(h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: 'Use percentages: your grade and your target at 0 or above, and a final worth more than 0% and at most 100%.' }))); return; }
      const msg = r.status === 'secured' ? `You already have it: even a 0% on the final keeps you at or above ${f.target}%.`
        : r.status === 'out-of-reach' ? `You would need ${GP.fmt(r.needed, 1)}% on the final: more than 100%, so ${f.target}% isn’t reachable without extra credit.`
          : `You need ${GP.fmt(r.needed, 1)}% on the final.`;
      out.append(h('div.st-res__top', h('small', { text: 'Needed on the final' }), h('b.st-res__n', { dataset: { fk: 'fin-needed' }, text: r.status === 'secured' ? '0%' : `${GP.fmt(r.needed, 1)}%` })),
        h('p', { dataset: { fk: 'fin-msg' }, class: `st-fin is-${r.status}`, text: msg }),
        h('code.st-formula', { dataset: { fk: 'fin-formula' }, text: r.formula }),
        h('small.dim', { text: 'needed = (target − current × (100 − final weight) ÷ 100) ÷ (final weight ÷ 100). “Current” is your grade on everything except the final.' }));
    };
    const fld = (label, key, ph, fk) => h('label.st-f', h('span.st-f__l', { text: label }),
      h('input.st-in', { type: 'text', inputmode: 'decimal', value: f[key], placeholder: ph, 'aria-label': label, dataset: { fk }, oninput: e => { f[key] = e.target.value.replace('%', '').trim(); paint(); } }));
    const letters = h('select.select.st-sel', { 'aria-label': 'Or pick a target letter', dataset: { fk: 'fin-letter' }, onchange: e => { if (e.target.value) { f.target = e.target.value; render(); } } },
      h('option', { value: '', text: 'Or pick a letter…' }), S.data.scale.map(r => h('option', { value: String(r.min), text: `${r.letter} (${r.min}%+)` })));
    paint();
    return h('div.st-final',
      h('p.st-note', { text: 'Enter your current grade, how much of the course the final is worth, and the grade you want. Percentages only.' }),
      h('div.st-form__grid', fld('Current grade (%)', 'current', '85', 'fin-current'), fld('Final is worth (% of grade)', 'weight', '20', 'fin-weight'), fld('Target grade (%)', 'target', '90', 'fin-target'), h('label.st-f', h('span.st-f__l', { text: 'Target from the scale' }), letters)),
      out);
  }

  /* ---------- the scale ---------- */
  function scaleTab() {
    const rows = S.scaleRows || (S.scaleRows = S.data.scale.map(r => ({ ...r })));
    function commit() {
      const letters = rows.map(r => String(r.letter).trim().toLowerCase());
      if (rows.some(r => !String(r.letter).trim() || !Number.isFinite(Number(r.min)) || r.min === '' || !Number.isFinite(Number(r.points)) || r.points === '')) { S.scaleIssue = 'Every row needs a letter, a minimum % and points.'; return false; }
      if (new Set(letters).size !== letters.length) { S.scaleIssue = 'Two rows have the same letter.'; return false; }
      if (!rows.some(r => Number(r.min) === 0)) S.scaleIssue = 'No row starts at 0%, so a percentage below the lowest minimum can’t be counted.';
      else S.scaleIssue = '';
      mutate(d => { d.scale = rows.map(r => ({ letter: String(r.letter).trim(), min: Number(r.min), points: Number(r.points) })); });
      return true;
    }
    const issue = h('div.st-issue', { role: 'alert', hidden: !S.scaleIssue, dataset: { fk: 'scale-issue' } }, icon('alert'), h('span', { text: S.scaleIssue }));
    const field = (r, key, label, i, extra) => h('input.st-in', { type: 'text', inputmode: key === 'letter' ? 'text' : 'decimal', value: String(r[key]), maxlength: key === 'letter' ? '4' : '6', 'aria-label': `${label}, row ${i + 1}`, dataset: { fk: `sc-${key}` }, ...extra,
      onchange: e => {
        r[key] = e.target.value;
        const ok = commit();
        if (ok) { rows.sort((a, b) => Number(b.min) - Number(a.min)); render(); }
        else { issue.hidden = false; issue.lastChild.textContent = S.scaleIssue; }
      } });
    const tbl = h('div.st-scale', { role: 'table', 'aria-label': 'Grade scale' },
      h('div.st-scale__h', { role: 'row' }, ['Letter', 'Minimum %', 'Points', ''].map((t, i) => h('span', { role: 'columnheader', class: i === 3 ? 'sr' : null, text: i === 3 ? 'Remove' : t }))),
      rows.map((r, i) => h('div.st-scale__r', { role: 'row', dataset: { row: String(i) } }, field(r, 'letter', 'Letter', i), field(r, 'min', 'Minimum percent', i), field(r, 'points', 'Points', i),
        h('button.ibtn', { type: 'button', 'aria-label': `Remove ${r.letter}`, disabled: rows.length <= 1, onclick: () => { rows.splice(i, 1); commit(); render(); } }, icon('trash')))));
    const bonus = (key, label) => h('label.st-f', h('span.st-f__l', { text: label }), h('input.st-in', { type: 'text', inputmode: 'decimal', value: String(S.data.bonus[key]), 'aria-label': label, dataset: { fk: `bonus-${key}` },
      onchange: e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 2 && e.target.value.trim() !== '') mutate(d => { d.bonus[key] = v; }); else e.target.value = String(S.data.bonus[key]); } }));
    return h('div.st-scalewrap',
      h('p.st-note', { text: 'A letter grade is looked up here. A percentage takes the highest row whose minimum it reaches. Change any number and every GPA updates.' }),
      tbl, issue,
      h('div.st-row',
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'sc-add' }, onclick: () => { rows.push({ letter: '', min: '', points: '' }); S.scaleIssue = ''; S.focusScale = true; render(); } }, icon('plus'), h('span', { text: 'Add row' })),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'sc-reset' }, onclick: () => { S.scaleRows = null; S.scaleIssue = ''; mutate(d => { d.scale = GP.DEFAULT_SCALE.map(r => ({ ...r })); }); render(); } }, icon('rotate-ccw'), h('span', { text: 'Reset to the standard 4.0 scale' }))),
      h('div.st-form__grid', bonus('honors', 'Honors bonus (points)'), bonus('ap', 'AP / IB bonus (points)')),
      h('small.dim', { text: 'Bonuses only apply in weighted mode, and not to a course that earned 0 points.' }));
  }

  /* ---------- render ---------- */
  function render() {
    if (S.dead) return;
    S.focusEl = null;
    clear(root);
    const tabs = h('div.tabs.st-tabs', { role: 'tablist', 'aria-label': 'GPA tools' }, TABS.map(([v, l]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === v ? 'true' : 'false', class: S.tab === v ? 'is-on' : '', dataset: { gtab: v }, onclick: () => { S.tab = v; if (v === 'scale') S.scaleRows = null; render(); } }, h('span', { text: l }))));
    const mode = h('div.tabs.st-mode', { role: 'radiogroup', 'aria-label': 'GPA type' }, [[false, 'Unweighted'], [true, 'Weighted']].map(([on, l]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': S.data.weighted === on ? 'true' : 'false', class: S.data.weighted === on ? 'is-on' : '', dataset: { fk: on ? 'weighted' : 'unweighted' }, onclick: () => setWeighted(on) }, h('span', { text: l }))));
    root.append(h('div.app__bar', tabs, h('span.st-spacer'), S.tab === 'gpa' ? mode : null));
    root.append(h('div.app__content.st-scroll', S.tab === 'gpa' ? gpaTab() : S.tab === 'final' ? finalTab() : scaleTab()));
    if (S.tab === 'scale' && S.focusScale) {
      S.focusScale = false;
      const last = root.querySelector('.st-scale__r:last-child [data-fk="sc-letter"]');
      if (last) S.focusEl = last;
    }
    const el = S.focusEl;
    if (el) requestAnimationFrame(() => { try { if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return; /* never take the keyboard from a field already being typed in */ el.focus(); } catch (e) { /* fine */ } });
    ctx.changed && ctx.changed();
  }
  render();

  return { teardown() { S.dead = true; }, open() {} };
}
