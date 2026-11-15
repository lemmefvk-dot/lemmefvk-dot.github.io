/* ============================================================
   study/gpa.js — the GPA tab of Static Study.

   Semesters of courses (name, credits, a letter or a percentage,
   regular / honors / AP), weighted or unweighted, a cumulative GPA,
   an editable grade scale, and a "what do I need on the final"
   helper. Every result prints the sum it came from; a course that
   can't be counted is listed with the reason instead of guessed at.
   The arithmetic is in js/core/gpa.js.

   What if: a scratch copy to try grades on. Every change in it stays
   in this window and is thrown away on leaving — nothing is saved,
   and the real GPA stays next to the what-if one. Grades can be read
   in from CSV, cells pasted from a spreadsheet, or a Static Sheets
   file (its values, worked out as Sheets would). The trend chart is
   each semester's GPA and the cumulative one; the transcript prints
   what was entered, and says it is not an official one.
   ============================================================ */
import * as GP from '../core/gpa.js';
import { vfs } from '../core/vfs.js';
import { printSheet, printedOn } from './print.js';

const TABS = [['gpa', 'GPA'], ['final', 'Final exam'], ['scale', 'Grade scale'], ['import', 'Import']];
const SVG = 'http://www.w3.org/2000/svg';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mountGpa(host, ctx) {
  const { api } = ctx;
  const { h, icon, clear, confirm } = api;
  const S = {
    data: GP.read(), tab: 'gpa', dead: false,
    fin: { current: '', weight: '', target: '' },
    scaleIssue: '', whatIf: false,
    imp: { text: '', file: '', sem: '', note: '' },
  };
  const root = h('div.st-gpa');
  host.appendChild(root);

  /* in What if, every change lands on the scratch copy and nothing is written */
  function mutate(fn) {
    if (S.whatIf) { fn(S.data); S.data = GP.normalize(S.data); return; }
    const d = GP.read(); fn(d); S.data = GP.write(d);
  }
  function setWhatIf(on) {
    S.whatIf = on;
    S.data = on ? GP.normalize(JSON.parse(JSON.stringify(GP.read()))) : GP.read();
    S.scaleRows = null;
    if (S.tab === 'import' && on) S.tab = 'gpa';
    render();
  }
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
    if (S.whatIf) {
      const real = GP.read();
      const rc = GP.cumulativeGpa(real).gpa, wc = cum.gpa;
      const diff = rc !== null && wc !== null ? Math.round((wc - rc) * 100) / 100 : null;
      resultsBox.append(h('div.st-whatif__cmp', { dataset: { fk: 'what-if-cmp' } },
        h('span', { text: `Your real cumulative GPA: ${GP.fmt(rc)}` }), h('b', { text: `What if: ${GP.fmt(wc)}` }),
        diff !== null ? h('small', { text: diff === 0 ? 'no change' : `${diff > 0 ? '+' : '−'}${GP.fmt(Math.abs(diff))}` }) : null));
    }
    resultsBox.append(
      resultCard(`${S.whatIf ? 'What if: ' : ''}${s.name} GPA`, r, 'sem', skipped.length ? h('ul.st-skipped', { dataset: { fk: 'skipped' } }, skipped.map(x => h('li', { text: `${x.course.name || 'Untitled course'}: not counted. ${x.why}.` }))) : null),
      resultCard(`${S.whatIf ? 'What if: c' : 'C'}umulative GPA${S.data.semesters.length > 1 ? ` (${S.data.semesters.length} semesters)` : ''}`, cum, 'cum'),
      h('p.st-note', { dataset: { fk: 'rule' }, text: `${S.data.weighted ? `Weighted: honors add +${S.data.bonus.honors} and AP/IB add +${S.data.bonus.ap} to a course’s points (not to an F). ` : 'Unweighted: honors and AP/IB courses count like any other. '}GPA = Σ(points × credits) ÷ Σ credits. The cumulative GPA is over every course at once, not an average of semester GPAs.` }));
    resultsBox.append(trendChart());      /* each change shows on the chart at once */
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

  /* ---------- the trend ---------- */
  function trendChart() {
    const t = GP.trend(S.data).filter(x => x.gpa !== null);
    if (!t.length) return h('div');
    const W = 480, H = 200, L = 34, R = 12, T = 14, B = 34;
    const top = Math.max(4, Math.ceil(Math.max(...t.flatMap(x => [x.gpa, x.cum].filter(v => v !== null))) * 2) / 2);
    const X = i => (t.length === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (t.length - 1));
    const Y = v => T + (H - T - B) * (1 - v / top);
    const el = (n, a, kids = []) => { const e = document.createElementNS(SVG, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v)); for (const k of kids) e.append(k); return e; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'st-trend__svg', role: 'img', 'aria-label': `GPA by semester: ${t.map(x => `${x.name} ${GP.fmt(x.gpa)} (cumulative ${GP.fmt(x.cum)})`).join(', ')}` });
    for (let v = 0; v <= top + 1e-9; v += 1) {
      svg.append(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'st-trend__grid' }));
      const lab = el('text', { x: L - 6, y: Y(v) + 3, class: 'st-trend__ax', 'text-anchor': 'end' }); lab.textContent = v.toFixed(1); svg.append(lab);
    }
    const line = (key, cls) => { if (t.length > 1) svg.append(el('polyline', { points: t.map((x, i) => `${X(i)},${Y(x[key])}`).join(' '), class: cls })); t.forEach((x, i) => svg.append(el('circle', { cx: X(i), cy: Y(x[key]), r: key === 'gpa' ? 4 : 3, class: `${cls} st-trend__pt`, 'data-sem': x.id, 'data-v': GP.fmt(x[key]) }))); };
    line('cum', 'st-trend__cum');
    line('gpa', 'st-trend__sem');
    t.forEach((x, i) => { const lab = el('text', { x: X(i), y: H - 12, class: 'st-trend__ax', 'text-anchor': t.length > 1 && i === 0 ? 'start' : t.length > 1 && i === t.length - 1 ? 'end' : 'middle' }); lab.textContent = x.name.length > 12 ? `${x.name.slice(0, 11)}…` : x.name; svg.append(lab); });
    return h('section.st-res.st-trend', { 'aria-label': 'GPA by semester', dataset: { fk: 'trend' } },
      h('div.st-res__top', h('small', { text: `${S.whatIf ? 'What if: ' : ''}GPA by semester` }),
        h('span.st-trend__key', h('i.st-trend__k1'), h('small', { text: 'Semester' }), h('i.st-trend__k2'), h('small', { text: 'Cumulative' }))),
      svg,
      h('small.dim', { dataset: { fk: 'trend-list' }, text: t.map(x => `${x.name}: ${GP.fmt(x.gpa)} (cumulative ${GP.fmt(x.cum)})`).join(' · ') }));
  }

  /* ---------- a transcript to print ---------- */
  function printTranscript() {
    const d = S.data;
    const who = (() => { const v = api.store.get('portal.identity'); return v && typeof v.name === 'string' ? v.name.trim().slice(0, 40) : ''; })();
    const lv = v => (GP.LEVELS.find(([k]) => k === v) || [0, ''])[1];
    const cum = GP.cumulativeGpa(d);
    printSheet(h, `Transcript${who ? `: ${who}` : ''}`, `${S.whatIf ? 'WHAT IF — not your saved grades. ' : ''}Grades as entered in Static Study, ${d.weighted ? 'weighted' : 'unweighted'}. Not an official transcript.`, [
      ...d.semesters.map(sm => {
        const r = GP.semesterGpa(sm, d);
        return [h('h2', { text: sm.name }),
          sm.courses.length ? h('table', h('tr', ['Course', 'Credits', 'Grade', 'Level', 'Points'].map(x => h('th', { text: x }))),
            r.rows.map(x => h('tr', h('td', { text: x.course.name || 'Untitled course' }), h('td', { text: x.course.credits }), h('td', { text: x.course.grade }), h('td', { text: lv(x.course.level) }),
              h('td', { text: x.counted ? x.points.toFixed(2) : `not counted: ${x.why.toLowerCase()}` })))) : h('p', { text: 'No courses.' }),
          h('p', { text: `Semester GPA: ${GP.fmt(r.gpa)} · ${Math.round(r.credits * 100) / 100} credits counted` })];
      }).flat(),
      h('h2', { text: `Cumulative GPA: ${GP.fmt(cum.gpa)}` }),
      h('p.st-print__fine', { text: `${Math.round(cum.credits * 100) / 100} credits counted. Scale: ${d.scale.map(r => `${r.letter} ${r.min}%+ = ${r.points}`).join(', ')}.${d.weighted ? ` Honors +${d.bonus.honors}, AP/IB +${d.bonus.ap}.` : ''}` }),
      h('p.st-print__fine', { text: printedOn() }),
    ]);
  }

  /* ---------- reading grades in ---------- */
  function sheetFiles() {
    const out = [];
    try { vfs.walk(vfs.HOME, (n, p) => { if (n.type === 'file' && /\.sheet$/i.test(n.name) && !p.startsWith(`${vfs.HOME}/Trash`) && out.length < 100) out.push({ path: p, name: n.name.replace(/\.sheet$/i, '') }); }, 6); } catch (e) { /* none */ }
    return out;
  }
  async function fromSheet(path) {
    const f = S.imp;
    try {
      const E = await import('../sheets/engine.js');
      const book = E.Book.fromJSON(JSON.parse(vfs.read(path) || ''));
      book.recalcAll();
      const sh = book.sheets[0];
      const ext = book.extentOf(sh.id);
      const rows = [];
      for (let r = 0; r <= ext.r && r < 400; r++) {
        const cells = [];
        for (let c = 0; c <= Math.min(ext.c, 12); c++) { const v = book.valueIn(sh.id, r, c); cells.push(v === null || v === undefined ? '' : String(E.toText(v)).replace(/[\t\n\r]+/g, ' ')); }
        rows.push(cells.join('\t'));
      }
      f.text = rows.join('\n'); f.file = vfs.baseName ? vfs.baseName(path) : path.split('/').pop(); f.note = `Read the first sheet (“${sh.name}”) of ${f.file}: its values, as Sheets works them out.`;
    } catch (err) {
      f.note = `That file couldn’t be read as a Static Sheets file (${err.message || err}).`;
    }
    if (!S.dead) render();
  }
  function doImport() {
    const f = S.imp;
    const p = GP.parseGrades(f.text);
    if (!p.rows.length) { f.note = 'No grades found: each row needs a course name and a grade.'; render(); return; }
    let added = 0, updated = 0, full = 0;
    const made = [];
    mutate(d => {
      for (const r of p.rows) {
        let sm = r.semester ? d.semesters.find(x => x.name.toLowerCase() === r.semester.toLowerCase()) : d.semesters.find(x => x.id === (f.sem || d.activeId));
        if (!sm) {
          if (d.semesters.length >= GP.MAX_SEMESTERS) { full++; continue; }
          sm = { id: GP.uid('s'), name: (r.semester || 'Imported').slice(0, 40), courses: [] };
          d.semesters.push(sm); made.push(sm.name);
        }
        const had = sm.courses.find(c => c.name.toLowerCase() === r.name.toLowerCase());
        if (had) { Object.assign(had, { grade: r.grade, credits: r.credits || had.credits, level: r.level }); updated++; continue; }
        if (sm.courses.length >= GP.MAX_COURSES) { full++; continue; }
        sm.courses.push(GP.normCourse(r)); added++;
        d.activeId = sm.id;
      }
    });
    S.imp = { text: '', file: '', sem: '', note: '' };
    S.tab = 'gpa';
    S.flash = `${S.whatIf ? 'What if: ' : ''}Imported ${plural(added, 'course')}${updated ? `, updated ${plural(updated, 'course')} that were already there` : ''}${made.length ? ` (new semester${made.length === 1 ? '' : 's'}: ${made.join(', ')})` : ''}${full ? `; ${full} didn’t fit` : ''}${p.skipped.length ? `; ${plural(p.skipped.length, 'row')} skipped (${p.skipped.slice(0, 3).map(x => x.why).join('; ')})` : ''}.`;
    render();
  }
  function importTab() {
    const f = S.imp;
    const p = f.text.trim() ? GP.parseGrades(f.text) : null;
    const ta = h('textarea.st-ta.st-ta--big', { rows: '7', placeholder: 'course,credits,grade,level,semester\nBiology,4,A-,honors,Fall 2025\nHistory,3,88,,Fall 2025', 'aria-label': 'Paste grades here', dataset: { fk: 'gimp-text' }, oninput: e => { f.text = e.target.value; paintPrev(); } });
    ta.value = f.text;
    const prev = h('div.st-preview', { role: 'status', dataset: { fk: 'gimp-preview' } });
    const go = h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'gimp-go' }, onclick: doImport }, icon('upload'), h('span', { text: 'Import' }));
    function paintPrev() {
      const q = f.text.trim() ? GP.parseGrades(f.text) : null;
      const sems = q ? [...new Set(q.rows.map(r => r.semester).filter(Boolean))] : [];
      prev.textContent = q ? `${plural(q.rows.length, 'course')} found${sems.length ? ` in ${plural(sems.length, 'semester')} (${sems.slice(0, 4).join(', ')})` : ''}${q.skipped.length ? `, ${plural(q.skipped.length, 'row')} skipped` : ''}${q.header ? ', header row read' : ''}.` : 'Choose a file or paste rows to see what is in them.';
      go.disabled = !q || !q.rows.length;
    }
    paintPrev();
    const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain', 'aria-label': 'Choose a CSV file', dataset: { fk: 'gimp-file' },
      onchange: async e => { const x = e.target.files && e.target.files[0]; if (!x) return; if (x.size > 2 * 1024 * 1024) { f.note = 'That file is over 2 MB; a list of grades is much smaller.'; render(); return; } f.text = await x.text(); f.file = x.name; f.note = ''; render(); } });
    const sheets = sheetFiles();
    const sheetSel = h('select.select.st-sel', { 'aria-label': 'Or a Static Sheets file', dataset: { fk: 'gimp-sheet' }, disabled: !sheets.length, onchange: e => { if (e.target.value) fromSheet(e.target.value); } },
      h('option', { value: '', text: sheets.length ? 'Pick a .sheet file…' : 'No .sheet files yet' }), sheets.map(x => h('option', { value: x.path, text: x.name })));
    const semSel = h('select.select.st-sel', { 'aria-label': 'Rows without a semester go into', dataset: { fk: 'gimp-sem' }, onchange: e => { f.sem = e.target.value; } },
      S.data.semesters.map(x => h('option', { value: x.id, text: x.name, selected: x.id === (f.sem || S.data.activeId) })), h('option', { value: 'new', text: 'A new semester called Imported', selected: f.sem === 'new' || !S.data.semesters.length }));
    return h('div.st-import',
      h('p.st-hint', { text: 'One course per row: course, credits, grade (a letter or a percentage), then level (regular, honors, AP or IB) if you like. A first row naming the columns — course, credits, grade, level, semester — can put them in any order, and a semester column sends each row to that semester (made if it isn’t there). Copy the cells in Static Sheets or Google Sheets and paste them here, or pick a file.' }),
      h('div.st-form__grid', h('label.st-f', h('span.st-f__l', { text: 'CSV file' }), file), h('label.st-f', h('span.st-f__l', { text: 'Or a Static Sheets file' }), sheetSel),
        h('label.st-f', h('span.st-f__l', { text: 'Rows without a semester go into' }), semSel)),
      f.file ? h('small.dim', { text: `From ${f.file}.` }) : null,
      ta, prev,
      f.note ? h('div.st-banner', { role: 'status', dataset: { fk: 'gimp-note' } }, icon('alert'), h('span', { text: f.note })) : null,
      h('div.st-row', go, h('small.dim', { text: 'A course already in that semester gets the new grade; nothing else is removed.' })));
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
        h('label.st-inline', h('span', { text: 'Start from' }),
          h('select.select.st-sel', { 'aria-label': 'Start from a common scale', dataset: { fk: 'sc-preset' }, onchange: e => { const pr = GP.PRESETS.find(x => x.id === e.target.value); if (!pr) return; S.scaleRows = null; S.scaleIssue = ''; mutate(d => { d.scale = pr.scale.map(r => ({ ...r })); }); render(); } },
            h('option', { value: '', text: GP.presetOf(S.data.scale) ? 'A common scale…' : 'Your own scale (pick one to replace it)', selected: true }),
            GP.PRESETS.map(pr => h('option', { value: pr.id, text: `${pr.name}${GP.presetOf(S.data.scale) === pr ? ' — in use' : ''}` }))))),
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
    root.append(h('div.app__bar', tabs, h('span.st-spacer'), S.tab === 'gpa' ? mode : null,
      S.tab === 'gpa' && S.data.semesters.length ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'transcript' }, onclick: printTranscript }, icon('printer'), h('span', { text: 'Transcript' })) : null,
      h('button.btn.btn--sm', { type: 'button', 'aria-pressed': S.whatIf ? 'true' : 'false', class: S.whatIf ? 'is-on' : '', dataset: { fk: 'what-if' }, title: 'Try other grades without changing your saved ones', onclick: () => setWhatIf(!S.whatIf) }, icon('sparkles'), h('span', { text: S.whatIf ? 'Leave What if' : 'What if…' }))));
    const flash = S.flash ? h('div.st-flash', { role: 'status', dataset: { fk: 'gpa-flash' } }, icon('check'), h('span', { text: S.flash })) : null;
    S.flash = '';
    root.append(h('div.app__content.st-scroll', { class: S.whatIf ? 'is-whatif' : '' },
      S.whatIf ? h('div.st-whatif', { role: 'status', dataset: { fk: 'what-if-banner' } }, icon('sparkles'), h('span', { text: 'What if: change any grade, credit, course or semester to see what it would do. Nothing here is saved; leave What if and your real grades are back exactly as they were.' }),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'what-if-leave' }, onclick: () => setWhatIf(false) }, h('span', { text: 'Leave' }))) : null,
      flash,
      S.tab === 'gpa' ? gpaTab() : S.tab === 'final' ? finalTab() : S.tab === 'import' ? importTab() : scaleTab()));
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

  return {
    teardown() { S.dead = true; },
    /* search opens a semester */
    open(o) { if (o && typeof o.semester === 'string' && S.data.semesters.some(x => x.id === o.semester)) { S.tab = 'gpa'; mutate(d => { d.activeId = o.semester; }); render(); } },
  };
}
