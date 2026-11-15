/* ============================================================
   labkit.js — the small shared pieces of the Maths Lab and Logic
   Lab windows: one stylesheet (theme tokens only), a tab strip that
   mounts one tool at a time and tears the last one down, and a few
   form helpers. The tools themselves live in js/mathlab/ and
   js/logiclab/.
   ============================================================ */
import { h } from './dom.js';

export const LAB_CSS = `
.lab{flex:1;display:flex;flex-direction:column;min-height:0;height:100%;color:var(--ink-1);font-size:var(--fs-13)}
.lab *{box-sizing:border-box}
.lab__tabs{display:flex;flex-wrap:wrap;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.lab__tab,.lab__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-pill);border:1px solid var(--line-1);background:var(--fill-0);color:var(--ink-1);font:inherit;cursor:pointer}
.lab__tab:hover,.lab__btn:hover{background:var(--fill-2)}
.lab__tab[aria-selected=true],.lab__btn[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.lab__btn--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600;min-width:84px}
.lab__btn--sm{height:26px;padding:0 var(--sp-3);font-size:var(--fs-12)}
.lab__btn:disabled{opacity:.5;cursor:default}
.lab__body{flex:1;min-height:0;display:flex;flex-direction:column}
.lab__tool{flex:1;min-height:0;display:flex;gap:var(--sp-4);padding:var(--sp-4);overflow:auto}
.lab__main{flex:1 1 360px;min-width:240px;display:flex;flex-direction:column;gap:var(--sp-3);min-height:0}
.lab__side{flex:0 0 300px;display:flex;flex-direction:column;gap:var(--sp-4);min-width:0;overflow:auto}
@media (max-width:760px){.lab__side{flex-basis:100%}.lab__tool{flex-wrap:wrap}}
.lab__stage{flex:1 1 auto;min-height:240px;position:relative;border-radius:var(--r-lg);border:1px solid var(--line-1);background:var(--fill-0);overflow:hidden}
.lab__stage canvas,.lab__stage svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.lab__row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2)}
.lab__sp{flex:1}
.lab h3{margin:0;font-size:var(--fs-11);color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em}
.lab__note{margin:0;color:var(--ink-2);font-size:var(--fs-12);line-height:1.5}
.lab__note b{color:var(--ink-0)}
.lab select,.lab input[type=text],.lab input[type=number]{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0);font:inherit;padding:0 var(--sp-2);min-width:0}
.lab input[type=number]{width:84px}
.lab input[type=range]{accent-color:var(--accent);width:100%}
.lab__sl{display:grid;grid-template-columns:1fr auto;gap:2px var(--sp-3);align-items:center}
.lab__sl label{color:var(--ink-2)}
.lab__sl output{font-variant-numeric:tabular-nums;color:var(--ink-0);font-weight:600}
.lab__sl input{grid-column:1/3}
.lab__meas{display:grid;grid-template-columns:auto 1fr;gap:4px var(--sp-4);margin:0;font-variant-numeric:tabular-nums}
.lab__meas dt{color:var(--ink-3)}
.lab__meas dd{margin:0;color:var(--ink-0);overflow-wrap:anywhere}
.lab table{border-collapse:collapse;font-variant-numeric:tabular-nums}
.lab th,.lab td{padding:3px var(--sp-3);border-bottom:1px solid var(--line-1);text-align:center}
.lab th{color:var(--ink-3);font-weight:600;font-size:var(--fs-12)}
.lab__err{margin:0;color:#f2994a;font-weight:600}
.lab button:focus-visible,.lab select:focus-visible,.lab input:focus-visible,.lab [tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;

/** A labelled slider. Returns { el, set(v) }. */
export function slider(label, { min, max, step = 1, value, fmt = v => String(v), fk }, onInput) {
  const out = h('output', { text: fmt(value) });
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label, dataset: fk ? { fk } : undefined,
    oninput: e => { const v = Number(e.target.value); out.textContent = fmt(v); onInput(v); } });
  const el = h('div.lab__sl', h('label', { text: label }), out, input);
  return { el, input, set(v) { input.value = String(v); out.textContent = fmt(v); } };
}

/** The tab strip: defs are [id, label, mount(host, ctx) -> teardown]. */
export function mountTabs(root, defs, ctx, { first, fk, onTab } = {}) {
  let cur = null, teardown = null, dead = false;
  const body = h('div.lab__body', { role: 'tabpanel' });
  const bar = h('div.lab__tabs', { role: 'tablist', 'aria-label': 'Tools' });
  const btns = new Map();
  const pick = id => {
    if (dead || id === cur || !defs.some(d => d[0] === id)) return;
    if (teardown) { try { teardown(); } catch (e) { /* a tool that fails to stop must not stop the next */ } teardown = null; }
    body.textContent = '';
    cur = id;
    for (const [k, b] of btns) { b.setAttribute('aria-selected', String(k === id)); b.tabIndex = k === id ? 0 : -1; }
    const d = defs.find(x => x[0] === id);
    const host = h('div.lab__tool', { dataset: { tool: id } });
    body.append(host);
    teardown = d[2](host, ctx) || null;
    if (onTab) onTab(id, d[1]);
  };
  for (const [id, label] of defs) {
    btns.set(id, h('button.lab__tab', { type: 'button', role: 'tab', id: `${fk || 'lab'}-tab-${id}`, dataset: { fk: `${fk || 'lab'}-tab-${id}` }, onclick: () => pick(id),
      onkeydown: e => {
        const i = defs.findIndex(d => d[0] === id);
        const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
        if (j < 0 || j >= defs.length) return;
        e.preventDefault(); pick(defs[j][0]); btns.get(defs[j][0]).focus();
      } }, label));
    bar.append(btns.get(id));
  }
  root.append(h('div.lab', h('style', { text: LAB_CSS }), bar, body));
  pick(first && defs.some(d => d[0] === first) ? first : defs[0][0]);
  return {
    pick, current: () => cur,
    stop() { dead = true; if (teardown) { try { teardown(); } catch (e) { /* fine */ } teardown = null; } },
  };
}

/** Listeners that all come off together. */
export function listeners() {
  const offs = [];
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  return { on, off: () => offs.splice(0).forEach(f => f()) };
}

export const cssVar = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;
