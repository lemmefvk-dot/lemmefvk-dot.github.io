/* ============================================================
   school/ptquiz.js — the Quiz tab of the Periodic Table app.

   Rounds of ten questions on the elements you choose (1 to 20, 1 to
   36, 1 to 54 or all 118), from data/elements.json only:
     · Name from symbol   (four names to choose from)
     · Symbol from name   (four symbols)
     · Find it on the table: a blank table, click where it goes
   The score counts only questions really answered: a skipped one is
   not right and not wrong, and the result says how many were skipped.
   The elements missed can go into Static Study as flashcards, on a
   click. Nothing is saved here; Study keeps the cards.
   ============================================================ */
import { h } from '../core/dom.js';

export const QUIZ_MODES = [['name', 'Name from symbol'], ['sym', 'Symbol from name'], ['find', 'Find it on the table']];
export const QUIZ_RANGES = [[20, '1 to 20'], [36, '1 to 36'], [54, '1 to 54'], [118, 'All 118']];
export const QUIZ_LEN = 10;

const CSS = `
.ptq{flex:1;min-height:0;overflow:auto;padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4);color:var(--ink-1);font-size:var(--fs-13)}
.ptq__row{display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center}
.ptq__chip{height:28px;padding:0 var(--sp-4);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;font-size:var(--fs-12)}
.ptq__chip[aria-pressed=true]{background:var(--fill-3);border-color:var(--ink-2);color:var(--ink-0)}
.ptq__q{font-size:var(--fs-18);font-weight:650;color:var(--ink-0)}
.ptq__q b{font-size:32px;margin:0 6px}
.ptq__opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--sp-3);max-width:760px}
.ptq__opt{display:flex;align-items:center;gap:var(--sp-3);min-height:40px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-1);background:var(--fill-1);color:var(--ink-0);font:inherit;text-align:left}
.ptq__opt:hover:not(:disabled){background:var(--fill-2)}
.ptq__opt kbd{font:600 10px var(--mono);padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);color:var(--ink-2)}
.ptq__opt.is-right,.ptq__cell.is-right{background:rgba(60,200,120,.2);border-color:#3fb97a}
.ptq__opt.is-wrong,.ptq__cell.is-wrong{background:rgba(255,80,100,.18);border-color:#ff5a6e}
.ptq__grid{display:grid;grid-template-columns:repeat(18,minmax(0,1fr));grid-template-rows:repeat(7,auto) .4fr repeat(2,auto);gap:2px;max-width:760px}
.ptq__cell{aspect-ratio:1/1.05;min-width:0;padding:0;border-radius:4px;border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:700 10px var(--font)}
.ptq__cell:hover:not(:disabled){background:var(--fill-3)}
.ptq__cell:disabled{opacity:.25}
.ptq__cell.is-right,.ptq__cell.is-wrong{opacity:1}
.ptq__fb{margin:0;line-height:1.5;color:var(--ink-1)}
.ptq__fb.is-ok{color:#3fb97a}.ptq__fb.is-bad{color:#ff5a6e}
.ptq__btn{height:32px;padding:0 14px;border-radius:var(--r-sm);background:var(--fill-2);color:var(--ink-0);font:inherit;font-weight:600;border:1px solid var(--line-1)}
.ptq__btn--go{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.ptq__sum{padding:var(--sp-4);border-radius:var(--r-md);border:1px solid var(--line-2);background:var(--fill-0);display:flex;flex-direction:column;gap:var(--sp-2)}
.ptq__sum p{margin:0}
`;

function shuffle(a, rng = Math.random) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function mountQuiz(host, { elements, place, isActive, onAddCards }) {
  const S = { mode: 'name', upTo: 20, run: null, last: null };
  const box = h('div');
  const el = h('div.ptq', h('style', { text: CSS }), box);
  host.appendChild(el);
  const chip = (fk, label, on, fn) => h('button.ptq__chip', { type: 'button', dataset: { fk }, 'aria-pressed': String(on), onclick: fn }, label);

  function home() {
    S.run = null;
    const kids = [];
    if (S.last) kids.push(S.last);
    kids.push(h('div.ptq__row', { role: 'group', 'aria-label': 'Quiz type' }, ...QUIZ_MODES.map(([id, name]) => chip(`ptq-mode-${id}`, name, S.mode === id, () => { S.mode = id; home(); }))),
      h('div.ptq__row', { role: 'group', 'aria-label': 'Which elements' }, h('span', { text: 'Elements' }), ...QUIZ_RANGES.map(([n, name]) => chip(`ptq-range-${n}`, name, S.upTo === n, () => { S.upTo = n; home(); }))),
      h('div.ptq__row', h('button.ptq__btn.ptq__btn--go', { type: 'button', dataset: { fk: 'ptq-start' }, onclick: start }, `Start (${QUIZ_LEN} questions)`),
        h('small', { text: 'Only questions you answer count. A skipped one is neither right nor wrong.' })));
    box.replaceChildren(...kids);
  }

  function start() {
    const pool = elements.filter(e => e.n <= S.upTo);
    S.last = null;
    S.run = { pool, order: shuffle(pool).slice(0, QUIZ_LEN), i: 0, right: 0, wrong: 0, skipped: 0, missed: [], answered: false, mode: S.mode };
    ask();
  }
  function ask() {
    const R = S.run;
    if (R.i >= R.order.length) return finish();
    R.answered = false;
    const t = R.order[R.i];
    R.target = t;
    if (R.mode !== 'find') {
      const near = shuffle(R.pool.filter(e => e !== t && Math.abs(e.n - t.n) <= 8)).slice(0, 2);
      const rest = shuffle(R.pool.filter(e => e !== t && !near.includes(e))).slice(0, 3 - near.length);
      R.options = shuffle([t, ...near, ...rest]);
    }
    paint();
  }
  function answer(e, cell) {
    const R = S.run;
    if (!R || R.answered) return;
    R.answered = true;
    const ok = e.n === R.target.n;
    if (ok) R.right++; else { R.wrong++; R.missed.push(R.target); }
    paint(e, ok);
  }
  function skip() { const R = S.run; if (!R || R.answered) return; R.skipped++; R.i++; ask(); }
  function next() { S.run.i++; ask(); }
  function finish() {
    const R = S.run;
    const n = R.right + R.wrong;
    const missed = [...R.missed];
    const add = missed.length && onAddCards ? h('button.ptq__btn', { type: 'button', dataset: { fk: 'ptq-cards' }, onclick: () => onAddCards(missed) }, `Add the ${missed.length === 1 ? 'one' : missed.length} I missed to flashcards`) : null;
    S.last = h('div.ptq__sum', { role: 'status', dataset: { fk: 'ptq-summary', right: String(R.right), answered: String(n), skipped: String(R.skipped) } },
      h('b', { text: 'Round finished' }),
      h('p', { text: n ? `${R.right} of ${n} answered right (${Math.round((100 * R.right) / n)}%).` : 'Nothing was answered, so there is no score.' }),
      R.skipped ? h('p', { text: `${R.skipped} skipped, not counted.` }) : null,
      missed.length ? h('p', { dataset: { fk: 'ptq-missed' }, text: `Missed: ${missed.map(e => `${e.name} (${e.s})`).join(', ')}.` }) : null,
      add ? h('div.ptq__row', add) : null);
    home();
  }

  function paint(chosen, ok) {
    const R = S.run, t = R.target;
    const q = R.mode === 'name' ? h('div.ptq__q', { dataset: { fk: 'ptq-q', n: String(t.n) } }, 'Which element has the symbol', h('b', { text: t.s }), '?')
      : R.mode === 'sym' ? h('div.ptq__q', { dataset: { fk: 'ptq-q', n: String(t.n) } }, `What is the symbol for ${t.name}?`)
        : h('div.ptq__q', { dataset: { fk: 'ptq-q', n: String(t.n) } }, `Where is ${t.name} on the table?`);
    let body;
    if (R.mode === 'find') {
      body = h('div.ptq__grid', { role: 'group', 'aria-label': 'A blank periodic table' }, ...elements.map(e => {
        const [r, c] = place(e.n);
        const inRange = e.n <= S.upTo;
        const cls = chosen ? (e.n === t.n ? 'is-right' : chosen && e.n === chosen.n ? 'is-wrong' : '') : '';
        return h('button.ptq__cell', { type: 'button', class: cls, disabled: !inRange || !!chosen, style: { gridRow: r, gridColumn: c }, dataset: { n: String(e.n) },
          'aria-label': chosen && (e.n === t.n || e.n === chosen.n) ? `${e.name}, ${e.s}` : `Row ${r <= 7 ? r : r === 9 ? '6, lanthanides' : '7, actinides'}, column ${c}`,
          onclick: () => answer(e) }, chosen && (e.n === t.n || e.n === chosen.n) ? e.s : '');
      }));
    } else {
      body = h('div.ptq__opts', { role: 'group', 'aria-label': 'Answers' }, ...R.options.map((e, i) => {
        const cls = chosen ? (e.n === t.n ? 'is-right' : e.n === chosen.n ? 'is-wrong' : '') : '';
        return h('button.ptq__opt', { type: 'button', class: cls, disabled: !!chosen, dataset: { fk: `ptq-opt-${i + 1}`, n: String(e.n) }, onclick: () => answer(e) },
          h('kbd', { text: String(i + 1) }), h('span', { text: R.mode === 'name' ? e.name : e.s }));
      }));
    }
    const fb = chosen ? h('p.ptq__fb', { class: ok ? 'is-ok' : 'is-bad', role: 'status', dataset: { fk: 'ptq-fb', right: ok ? '1' : '0' } },
      ok ? `Yes: ${t.name} is ${t.s}, number ${t.n}.` : `${t.name} is ${t.s}, number ${t.n}${R.mode === 'find' ? ' (shown in green)' : ''}. You chose ${chosen.name} (${chosen.s}, number ${chosen.n}).`) : null;
    const last = R.i >= R.order.length - 1;
    box.replaceChildren(...[
      h('div.ptq__row', h('span', { dataset: { fk: 'ptq-count' }, text: `Question ${R.i + 1} of ${R.order.length}` }), h('b', { text: ` · ${R.right} right, ${R.wrong} wrong${R.skipped ? `, ${R.skipped} skipped` : ''}` })),
      q, body, fb,
      h('div.ptq__row', chosen ? h('button.ptq__btn.ptq__btn--go', { type: 'button', dataset: { fk: 'ptq-next' }, onclick: next }, last ? 'See the result' : 'Next question')
        : h('button.ptq__btn', { type: 'button', dataset: { fk: 'ptq-skip' }, onclick: skip }, 'Skip'),
        h('button.ptq__btn', { type: 'button', dataset: { fk: 'ptq-stop' }, onclick: () => finish() }, 'Finish now'))].filter(Boolean));
    if (chosen) box.querySelector('[data-fk="ptq-next"]')?.focus({ preventScroll: true });
  }

  const onKey = e => {
    if (!S.run || S.run.answered || S.run.mode === 'find' || e.ctrlKey || e.metaKey || e.altKey || !el.isConnected || el.closest('[hidden]') || (isActive && !isActive())) return;
    if (/^[1-4]$/.test(e.key) && S.run.options[Number(e.key) - 1]) { e.preventDefault(); answer(S.run.options[Number(e.key) - 1]); }
  };
  document.addEventListener('keydown', onKey);
  home();
  return {
    teardown() { document.removeEventListener('keydown', onKey); },
    focus: () => box.querySelector('button')?.focus({ preventScroll: true }),
  };
}
