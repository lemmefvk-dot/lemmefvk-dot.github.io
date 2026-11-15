/* ============================================================
   studio/blocksui.js — the Blocks editor: a palette, a workspace of
   scripts, and the JavaScript they make. Drawn here with plain DOM
   (no block library). Blocks are added by clicking the palette or
   dragging from it; they move by dragging their grip or with the
   arrow buttons, so everything also works from the keyboard.

     const ed = createBlocksEditor({ h, icon, clear, lookups, onChange })
     ed.el                the whole pane
     ed.load(program, error?)   show a program (or the "can't read it" notice)
     ed.paint()           redraw (the objects or sounds changed)
     ed.program()         the current program
   onChange(program, label) is called after every edit; `lookups()` gives
   { refs:[[value,label]], sounds:[[id,name]], vars:[name] }.
   ============================================================ */
import * as B from './blocks.js';

export function createBlocksEditor({ h, icon, clear, lookups, onChange }) {
  let prog = { v: 1, scripts: [] };
  let active = null;               /* { id, which } — where the next palette click goes */
  let undoStack = [], redoStack = [];
  let showCode = false;
  let loadError = '';
  let uid = 0;

  const snap = () => JSON.stringify(prog);
  /* repaint = false for a value typed into a block: the field already shows it, and
     rebuilding the blocks would take the keyboard focus away from the next field */
  function commit(label, fn, repaint = true) {
    undoStack.push(snap());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    fn();
    onChange(prog, label);
    if (repaint) paint();
    else { undoB.disabled = false; redoB.disabled = true; if (showCode) codeBox.textContent = B.toCode(prog) || '// No blocks yet.'; }
  }
  function undo() { const s = undoStack.pop(); if (!s) return; redoStack.push(snap()); prog = JSON.parse(s); onChange(prog, 'Undid a blocks edit'); paint(); }
  function redo() { const s = redoStack.pop(); if (!s) return; undoStack.push(snap()); prog = JSON.parse(s); onChange(prog, 'Redid a blocks edit'); paint(); }

  /* ---- finding things in the program ---- */
  function find(id, list = prog.scripts, parent = null) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.id === id) return { b, list, i, parent };
      for (const w of ['body', 'else']) {
        if (b[w]) { const r = find(id, b[w], b); if (r) return r; }
      }
    }
    return null;
  }
  const listOf = (id, which) => { const r = find(id); return r && r.b[which || 'body'] ? r.b[which || 'body'] : null; };
  const inside = (b, id) => !!(b && (b.id === id || ['body', 'else'].some(w => (b[w] || []).some(c => inside(c, id)))));

  /* ---- adding ---- */
  function addBlock(type) {
    const spec = B.SPEC[type];
    if (!spec) return;
    commit(`Added a “${type}” block`, () => {
      if (spec.hat) {
        const s = B.newScript(type);
        prog.scripts.push(s);
        active = { id: s.id, which: 'body' };
        return;
      }
      let list = active ? listOf(active.id, active.which) : null;
      if (!list) {
        let s = prog.scripts[prog.scripts.length - 1];
        if (!s) { s = B.newScript('start'); prog.scripts.push(s); }
        list = s.body;
        active = { id: s.id, which: 'body' };
      }
      const nb = B.newBlock(type);
      list.push(nb);
      if (nb.body) active = { id: nb.id, which: 'body' };
    });
  }
  function drop(data, list, index, ownerId) {
    if (!data) return;
    if (data.from === 'palette') {
      const spec = B.SPEC[data.type];
      if (!spec || spec.hat) return;
      commit(`Added a “${data.type}” block`, () => { list.splice(index, 0, B.newBlock(data.type)); });
      return;
    }
    const r = find(data.id);
    if (!r || B.SPEC[r.b.type].hat) return;
    if (ownerId && inside(r.b, ownerId)) return;       /* not into itself */
    commit('Moved a block', () => {
      r.list.splice(r.i, 1);
      /* the index may have shifted if it was removed from the same list above the target */
      const at = r.list === list && r.i < index ? index - 1 : index;
      list.splice(at, 0, r.b);
    });
  }

  /* ---- argument controls ---- */
  function control(b, p) {
    const get = () => (b.args || {})[p.k];
    const set = (v, label) => commit(label || 'Changed a block', () => { b.args[p.k] = v; }, false);
    const lk = lookups();
    const aria = `${b.type} ${p.k}`;
    if (p.kind === 'num') return h('input.stu-bi.stu-bi--num', { type: 'number', value: String(get()), 'aria-label': aria, onchange: e => { const v = parseFloat(e.target.value); set(Number.isFinite(v) ? v : p.def); } });
    if (p.kind === 'text') return h('input.stu-bi.stu-bi--text', { type: 'text', value: get() ?? '', 'aria-label': aria, maxlength: '200', onchange: e => set(e.target.value) });
    if (p.kind === 'color') return h('input.stu-bi.stu-bi--color', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(get()) ? get() : '#ff5c7c', 'aria-label': aria, onchange: e => set(e.target.value) });
    if (p.kind === 'var') {
      const id = `stu-bv-${++uid}`;
      return h('span.stu-bi__wrap', h('input.stu-bi.stu-bi--text', { type: 'text', value: get() ?? '', list: id, 'aria-label': aria, maxlength: '24', onchange: e => { const v = e.target.value.trim(); set(/^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(v) ? v : p.def); } }),
        h('datalist', { id }, ['score', 'lives', 'time', ...lk.vars].map(v => h('option', { value: v }))));
    }
    let opts;
    if (p.kind === 'select') opts = p.opts;
    else if (p.kind === 'sound') opts = [['', lk.sounds.length ? 'pick a sound' : 'no sounds yet'], ...lk.sounds];
    else {
      opts = [...lk.refs];
      if (p.k === 'what' || p.k === 'where') { /* spawn's template is an object, not a role */ }
      if (!opts.some(o => o[0] === get())) opts.push([get(), String(get() || '(pick one)')]);
    }
    return h('select.stu-bi', { 'aria-label': aria, onchange: e => set(e.target.value) },
      opts.map(([v, l]) => h('option', { value: v, text: l, selected: String(v) === String(get()) })));
  }
  function condEl(b) {
    const c = b.cond;
    const lk = lookups();
    const setC = (patch, label) => commit(label || 'Changed a condition', () => { b.cond = patch.type && patch.type !== b.cond.type ? B.defCond(patch.type) : { ...b.cond, ...patch }; }, !!patch.type);
    const sel = (value, opts, on, aria) => h('select.stu-bi', { 'aria-label': aria, onchange: e => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, text: l, selected: String(v) === String(value) })));
    const refSel = (k, aria) => sel(c[k], lk.refs.some(o => o[0] === c[k]) ? lk.refs : [...lk.refs, [c[k], c[k]]], v => setC({ [k]: v }), aria);
    const parts = [sel(c.type, B.COND_TYPES, v => setC({ type: v }), 'Condition kind')];
    if (c.type === 'var') {
      const id = `stu-bv-${++uid}`;
      parts.push(
        h('input.stu-bi.stu-bi--text', { type: 'text', value: c.name, list: id, 'aria-label': 'Variable', onchange: e => setC({ name: e.target.value.trim() || 'score' }) }),
        h('datalist', { id }, ['score', 'lives', 'time', ...lk.vars].map(v => h('option', { value: v }))),
        sel(c.op, B.OPS, v => setC({ op: v }), 'Comparison'),
        h('input.stu-bi.stu-bi--num', { type: 'number', value: String(c.n), 'aria-label': 'Number', onchange: e => setC({ n: parseFloat(e.target.value) || 0 }) }));
    } else if (c.type === 'held') parts.push(sel(c.key, B.HELD, v => setC({ key: v }), 'Key'));
    else if (c.type === 'touching') parts.push(refSel('a', 'First'), h('span', { text: 'and' }), refSel('b', 'Second'));
    else parts.push(h('input.stu-bi.stu-bi--num', { type: 'number', value: String(c.pct), min: '0', max: '100', 'aria-label': 'Percent', onchange: e => setC({ pct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) }) }), h('span', { text: '% of the time' }));
    return h('span.stu-blk__cond', parts);
  }

  /* ---- drawing ---- */
  function slot(list, ownerId, index) {
    const z = h('div.stu-slot', { 'aria-hidden': 'true' });
    z.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('application/x-stu-block')) { e.preventDefault(); e.stopPropagation(); z.classList.add('is-over'); } });
    z.addEventListener('dragleave', () => z.classList.remove('is-over'));
    z.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); z.classList.remove('is-over');
      let data = null;
      try { data = JSON.parse(e.dataTransfer.getData('application/x-stu-block')); } catch (err) { data = null; }
      drop(data, list, index, ownerId);
    });
    return z;
  }
  function listEl(list, owner, which) {
    const isActive = active && active.id === owner.id && active.which === which;
    const box = h(`div.stu-blist${isActive ? '.is-active' : ''}`, {
      onclick: e => { if (e.target === box || e.target.classList.contains('stu-blist__hint')) { active = { id: owner.id, which }; paint(); } },
    });
    list.forEach((b, i) => { box.append(slot(list, owner.id, i), blockEl(b, list, i)); });
    box.append(slot(list, owner.id, list.length));
    if (!list.length) box.append(h('div.stu-blist__hint', { text: isActive ? 'Click a block on the left to add it here' : 'Empty. Click here, then a block on the left' }));
    return box;
  }
  function blockEl(b, list, i) {
    const spec = B.SPEC[b.type];
    const el = h(`div.stu-blk.stu-blk--${spec.cat}${spec.hat ? '.stu-blk--hat' : ''}`, { dataset: { id: b.id, type: b.type } });
    const grip = h('span.stu-blk__grip', { title: spec.hat ? 'Move the script up or down' : 'Drag to move', 'aria-hidden': 'true', draggable: spec.hat ? 'false' : 'true' }, icon('menu'));
    if (!spec.hat) {
      grip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/x-stu-block', JSON.stringify({ from: 'block', id: b.id }));
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('is-dragging');
      });
      grip.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    }
    const row = h('div.stu-blk__row', grip);
    for (const p of spec.parts) row.append(typeof p === 'string' ? h('span.stu-blk__t', { text: p }) : control(b, p));
    if (spec.cond) row.append(condEl(b));
    const mv = (d, label) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return;
      commit(`Moved a ${b.type} block`, () => { [list[i], list[j]] = [list[j], list[i]]; });
    };
    row.append(h('span.stu-blk__ctl',
      h('button.stu-bx', { type: 'button', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, onclick: () => mv(-1) }, icon('chevron-up')),
      h('button.stu-bx', { type: 'button', 'aria-label': 'Move down', title: 'Move down', disabled: i === list.length - 1, onclick: () => mv(1) }, icon('chevron-down')),
      h('button.stu-bx', { type: 'button', 'aria-label': 'Remove this block', title: 'Remove', onclick: () => commit(`Removed a ${b.type} block`, () => { list.splice(i, 1); if (active && active.id === b.id) active = null; }) }, icon('x'))));
    el.append(row);
    if (spec.note) el.append(h('div.stu-blk__note', { text: spec.note }));
    if (b.body) el.append(h('div.stu-blk__in', listEl(b.body, b, 'body')));
    if (b.else) {
      el.append(h('div.stu-blk__t.stu-blk__else', { text: 'otherwise' }));
      el.append(h('div.stu-blk__in', listEl(b.else, b, 'else')));
    }
    return el;
  }

  /* ---- the pane ---- */
  const palette = h('div.stu-pal', { role: 'group', 'aria-label': 'Blocks to add' });
  const work = h('div.stu-work');
  const codeBox = h('pre.stu-bcode', { 'aria-label': 'The JavaScript these blocks make' });
  const notice = h('div.stu-bnote', { hidden: true, role: 'alert' });
  const undoB = h('button.stu-tb.stu-tb--icon', { type: 'button', 'aria-label': 'Undo a blocks edit', title: 'Undo', onclick: undo }, icon('rotate-ccw'));
  const redoB = h('button.stu-tb.stu-tb--icon.stu-flip', { type: 'button', 'aria-label': 'Redo a blocks edit', title: 'Redo', onclick: redo }, icon('rotate-ccw'));
  const codeB = h('button.stu-mini', { type: 'button', 'aria-pressed': 'false', onclick: () => { showCode = !showCode; paint(); } }, icon('code'), h('span', { text: 'See the code' }));
  const clearB = h('button.stu-mini', { type: 'button', onclick: () => { if (prog.scripts.length) commit('Cleared all blocks', () => { prog.scripts = []; active = null; }); } }, icon('trash'), h('span', { text: 'Clear' }));
  const head = h('div.stu-bhead', h('b', { text: 'Blocks' }), h('span.stu-bhead__s', { text: 'Click or drag blocks into a “when…” script. They write the game’s code for you.' }), h('div.stu-top__grow'), undoB, redoB, codeB, clearB);
  const el = h('div.stu-blocks', head, notice,
    h('div.stu-bmain', h('div.stu-pal-wrap', palette), work), codeBox);
  work.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('application/x-stu-block')) e.preventDefault(); });
  work.addEventListener('drop', e => {
    let data = null;
    try { data = JSON.parse(e.dataTransfer.getData('application/x-stu-block')); } catch (err) { data = null; }
    if (data && data.from === 'palette') { e.preventDefault(); addBlock(data.type); }
  });

  function labelOf(type) {
    const spec = B.SPEC[type];
    return spec.parts.map(p => (typeof p === 'string' ? p : '…')).join(' ') + (spec.cond ? ' …' : '');
  }
  function paintPalette() {
    clear(palette);
    for (const [cat, name] of B.CATS) {
      palette.append(h('div.stu-pal__cat', { text: name }));
      for (const type of Object.keys(B.SPEC).filter(t => B.SPEC[t].cat === cat)) {
        const btn = h(`button.stu-pb.stu-blk--${cat}`, { type: 'button', draggable: 'true', title: `Add: ${labelOf(type)}`, dataset: { type }, onclick: () => addBlock(type) }, h('span', { text: labelOf(type) }));
        btn.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-stu-block', JSON.stringify({ from: 'palette', type })); e.dataTransfer.effectAllowed = 'copy'; });
        palette.append(btn);
      }
    }
  }
  function paint() {
    clear(work);
    notice.hidden = !loadError;
    notice.textContent = loadError;
    if (!prog.scripts.length) {
      work.append(h('div.stu-bempty', icon('layers'), h('b', { text: 'No blocks yet' }),
        h('span', { text: 'Start with an event, like “when the game starts” or “when … touches …”, then add what should happen under it.' })));
    }
    prog.scripts.forEach((s, i) => {
      const card = h('div.stu-script');
      card.append(blockEl(s, prog.scripts, i));
      work.append(card);
    });
    undoB.disabled = !undoStack.length;
    redoB.disabled = !redoStack.length;
    codeB.setAttribute('aria-pressed', String(showCode));
    codeBox.hidden = !showCode;
    if (showCode) codeBox.textContent = B.toCode(prog) || '// No blocks yet.';
  }

  paintPalette();
  paint();
  return {
    el,
    program: () => prog,
    load(program, error = '') { prog = B.validateProgram(program); loadError = error; active = null; undoStack = []; redoStack = []; paint(); },
    paint,
    undo, redo,
  };
}

export default { createBlocksEditor };
