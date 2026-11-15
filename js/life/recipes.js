/* ============================================================
   life/recipes.js — the Recipes tab: a box of recipes you write,
   search, scale and cook from. Amount and fraction maths is in
   js/core/recipes.js.

   · A recipe: title, servings, tags, ingredients (one per line),
     steps (one per line) and a picture chosen from your files (or
     brought in from this computer into Pictures). Only the path is
     kept; the bytes stay in Files.
   · Scaling is a view: the servings stepper on the recipe changes
     what you see, never what is saved.
   · Cook mode: big text, tick steps as you go, and the screen stays
     awake where the browser has the Wake Lock API. Where it doesn't,
     nothing is said. Leaving cook mode, or closing the window,
     releases the lock.
   · Recipes you didn't write aren't included. Two small starters of
     our own can be added from the empty state.
   · Step timers: a step that says "simmer for 10 minutes" gets a
     10-minute button in cook mode. It starts one of Clock's named
     timers (js/core/alarms.js), so it rings with cook mode, Static
     Life and Clock all closed, while StaticOS is open.
   · As text: a recipe saves to Documents as a .txt (or copies) in a
     plain layout, and recipe text pasted or opened from a file is read
     into the editor, where nothing is kept until you press Save.
   · Shopping list: pick recipes and servings; the same ingredient in
     the same unit is added up exactly, and the list goes to a Static
     Tasks list (js/core/tasks.js) when you press Send.
   ============================================================ */
import * as R from '../core/recipes.js';
import * as A from '../core/alarms.js';
import * as T from '../core/tasks.js';
import { bus } from '../core/bus.js';
import media from '../core/media.js';
import { hold } from '../core/wakelock.js';
import { read, write, uid } from './data.js';

const clockText = ms => { const s = Math.max(0, Math.ceil(ms / 1000)), hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${hh ? hh + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };
const safeFile = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Recipe';

export function mountRecipes(el, ctx) {
  const { h, icon, vfs, confirm, notify } = ctx.api;
  const S = { view: 'list', id: null, query: '', tag: '', servings: 0, ticked: new Set(), cook: false, draft: null, picking: false, dead: false, focus: '',
    note: '', importText: '', importErr: '', shop: null, shopTo: '', shopMsg: '' };
  let lock = null;
  let tick = 0;
  const cookTimers = new Map();   /* 'step:k' -> Clock timer id, for this recipe's step timers */
  const urls = new Map();   /* picture path -> object URL, so a redraw doesn't reload it */

  const recipes = () => (read().recipes || []).map(R.normRecipe).filter(Boolean);
  const save = list => write('recipes', list);
  const current = () => recipes().find(r => r.id === S.id) || null;
  const scaled = (r, line) => (S.servings && S.servings !== r.servings ? R.scaleLine(line, r.servings, S.servings) : line);

  async function picUrl(path) {
    if (urls.has(path)) return urls.get(path);
    const u = await media.urlOf(path).catch(() => null);
    urls.set(path, u);
    return u;
  }
  function picture(path, cls, alt) {
    const img = h('img', { class: cls, alt: alt || '', loading: 'lazy' });
    picUrl(path).then(u => { if (u && !S.dead) img.src = u; else img.remove(); });
    return img;
  }

  /* ---------------- cook mode ---------------- */
  /* the name Clock shows (and keeps: whitespace folded, 40 characters at most) */
  const timerName = (r, i, k, n, ms) => `${r.title.slice(0, 22)} · step ${i + 1}${n > 1 ? ` (${A.fmtLen(ms)})` : ''}`.replace(/\s+/g, ' ').trim().slice(0, 40);
  function startCook(r) {
    S.cook = true; S.ticked = new Set(); S.note = '';
    lock = lock || hold();
    /* timers started earlier for this recipe (cook mode left, or the window closed) are picked up again */
    cookTimers.clear();
    const mine = A.timers();
    r.steps.forEach((s, i) => { const ts = R.stepTimes(s); ts.forEach((t, k) => { const hit = mine.find(x => x.name === timerName(r, i, k, ts.length, t.ms) && x.total === t.ms && x.status !== 'ready'); if (hit) cookTimers.set(`${i}:${k}`, hit.id); }); });
    if (!tick) tick = setInterval(paintTimers, 1000);
    render();
  }
  function stopCook() {
    S.cook = false; S.note = '';
    if (lock) { lock.release(); lock = null; }
    if (tick) { clearInterval(tick); tick = 0; }
    /* finished step timers are tidied out of Clock; running ones keep going and still ring */
    for (const id of cookTimers.values()) { const t = A.timers().find(x => x.id === id); if (t && t.status === 'done' && !A.ringing().some(x => x.id === id)) A.removeTimer(id); }
    render();
  }
  function startStepTimer(r, i, k) {
    const ts = R.stepTimes(r.steps[i]);
    const t = ts[k];
    if (!t) return;
    const key = `${i}:${k}`;
    const old = cookTimers.get(key);
    if (old && A.timers().some(x => x.id === old)) { A.startTimer(old); paintTimers(); return; }
    const made = A.addTimer({ name: timerName(r, i, k, ts.length, t.ms), ms: t.ms, start: true });
    if (!made) { S.note = `Clock already has ${A.MAX_TIMERS} timers. Remove one in Clock to start this one.`; render(); return; }
    A.init();
    cookTimers.set(key, made.id);
    paintTimers();
  }
  function stopStepTimer(i, k) {
    const id = cookTimers.get(`${i}:${k}`);
    if (id) A.removeTimer(id);
    cookTimers.delete(`${i}:${k}`);
    paintTimers();
  }
  /* the countdowns are read from Clock's timers each second; only their text changes, so focus stays put */
  function paintTimers() {
    if (S.dead || !S.cook) return;
    const all = A.timers();
    for (const b of el.querySelectorAll('[data-tk]')) {
      const id = cookTimers.get(b.dataset.tk);
      const t = id ? all.find(x => x.id === id) : null;
      const go = b.querySelector('.life-tbtn__go'), out = b.querySelector('.life-tbtn__left'), x = b.querySelector('.life-tbtn__stop');
      const state = !t ? 'ready' : t.status;
      b.dataset.state = state;
      out.textContent = state === 'running' ? `${clockText(A.left(t))} left` : state === 'paused' ? `${clockText(A.left(t))} left, paused in Clock` : state === 'done' ? 'Time’s up' : '';
      go.hidden = state === 'running' || state === 'paused';
      go.querySelector('span').textContent = state === 'done' ? `Again ${b.dataset.len}` : `Timer ${b.dataset.len}`;
      x.hidden = state === 'ready';
    }
  }
  const offClock = bus.on('clock:change', () => paintTimers());

  /* ---------------- actions ---------------- */
  function open(id) { S.id = id; S.view = 'detail'; const r = current(); S.servings = r ? r.servings : 0; S.cook = false; S.note = ''; render(); }
  function startEdit(r) {
    S.draft = r ? { ...r, tags: r.tags.join(', '), ingredients: r.ingredients.join('\n'), steps: r.steps.join('\n') }
      : { id: '', title: '', servings: 4, tags: '', ingredients: '', steps: '', pic: '' };
    S.view = 'edit'; S.error = ''; S.note = ''; render();
  }
  function saveDraft() {
    const d = S.draft;
    const r = R.normRecipe({ ...d, id: d.id || uid('r') });
    if (!r) { S.error = 'Give the recipe a title.'; render(); return; }
    const list = recipes();
    if (!d.id && list.length >= R.MAX_RECIPES) { S.error = `The box holds up to ${R.MAX_RECIPES} recipes.`; render(); return; }
    save(d.id ? list.map(x => (x.id === r.id ? r : x)) : [...list, r]);
    S.draft = null; S.error = ''; S.note = '';
    open(r.id);
  }
  async function remove(r) {
    const yes = await confirm({ title: `Delete “${r.title}”?`, message: 'It is removed from this device. This can’t be undone.', ok: 'Delete', danger: true });
    if (!yes || S.dead) return;
    save(recipes().filter(x => x.id !== r.id));
    S.view = 'list'; S.id = null; render();
  }
  function addStarters() {
    const have = new Set(recipes().map(r => r.title));
    const add = R.STARTERS.filter(s => !have.has(s.title)).map(s => R.normRecipe({ ...s, id: uid('r') }));
    save([...recipes(), ...add]);
    render();
  }

  /* ---------------- as text ---------------- */
  function saveText(r) {
    const dir = `${vfs.HOME}/Documents`;
    if (!vfs.node(dir)) vfs.mkdir(dir);
    const base = safeFile(r.title);
    let name = `${base}.txt`, k = 1;
    while (vfs.node(`${dir}/${name}`)) name = `${base} (${++k}).txt`;
    vfs.write(`${dir}/${name}`, R.toText(r));
    notify({ app: 'Static Life', icon: 'file-text', title: 'Saved as text', message: `${name} is in Documents.`,
      actions: [{ label: 'Open in Files', onClick: () => ctx.api.openApp('files', { path: dir }) }] });
  }
  async function copyText(r) {
    try { await navigator.clipboard.writeText(R.toText(r)); S.note = 'Copied the recipe as text.'; }
    catch (e) { S.note = 'The browser blocked copying here. Save as text instead.'; }
    render();
  }
  function readImport() {
    const res = R.fromText(S.importText);
    if (!res.ok) { S.importErr = res.why; render(); return; }
    const d = res.recipe;
    S.draft = { id: '', title: d.title, servings: d.servings, tags: d.tags.join(', '), ingredients: d.ingredients.join('\n'), steps: d.steps.join('\n'), pic: '' };
    S.importErr = ''; S.importText = '';
    S.note = res.guessed ? 'No Ingredients or Steps headings were found, so lines that start with an amount went to Ingredients and the rest to Steps. Check them over, then Save.' : 'Read from your text. Check it over, then Save.';
    S.view = 'edit'; S.error = '';
    render();
  }

  /* ---------------- shopping list ---------------- */
  function openShop() {
    const all = recipes();
    S.shop = new Map(all.filter(r => S.view === 'detail' ? r.id === S.id : false).map(r => [r.id, S.view === 'detail' && S.servings ? S.servings : r.servings]));
    S.shopMsg = '';
    S.shopFrom = S.view === 'detail' ? 'detail' : 'list';
    const lists = T.read().lists;
    if (!lists.some(l => l.id === S.shopTo)) S.shopTo = '';
    S.view = 'shop'; render();
  }
  const shopItems = () => {
    const all = recipes();
    return R.shoppingList(all.filter(r => S.shop.has(r.id)).map(r => ({ recipe: r, servings: S.shop.get(r.id) })));
  };
  function sendShop() {
    const items = shopItems();
    if (!items.length) return;
    const data = T.read();
    let list = data.lists.find(l => l.id === S.shopTo);
    const now = Date.now();
    if (!list) {
      const day = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      list = T.normList({ id: T.uid('l'), name: `Shopping, ${day}`, icon: 'shopping-bag', created: now, tasks: [] });
      data.lists.push(list);
    }
    const have = new Set(list.tasks.filter(t => !t.done).map(t => t.text.toLowerCase()));
    const fresh = items.filter(it => !have.has(it.text.toLowerCase()));
    list.tasks.push(...fresh.map(it => T.normTask({ id: T.uid('t'), text: it.text, notes: `For ${it.from.join(', ')}`, created: now, updated: now })));
    data.activeId = list.id;
    T.write(data);
    const skipped = items.length - fresh.length;
    S.shopTo = list.id;
    S.shopMsg = `Sent ${fresh.length} ${fresh.length === 1 ? 'item' : 'items'} to “${list.name}” in Static Tasks.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already on it.` : ''}`;
    const listId = list.id;
    notify({ app: 'Static Life', icon: 'shopping-bag', title: 'Shopping list sent', message: S.shopMsg, actions: [{ label: 'Open in Tasks', onClick: () => ctx.api.openApp('tasks', { list: listId }) }] });
    render();
  }

  /* ---------------- picture picker ---------------- */
  function pictures() {
    const out = [];
    vfs.walk(vfs.HOME, (n, p) => { if (n.type === 'file' && media.kindOf(n.name) === 'image' && !p.includes('/Trash/')) out.push({ name: n.name, path: p }); });
    return out.slice(0, 120);
  }
  function picker() {
    const q = h('input', { type: 'search', placeholder: 'Search your pictures', 'aria-label': 'Search your pictures' });
    const grid = h('div.life-pics');
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Choose a picture from this computer' });
    const choose = path => { S.draft.pic = path; S.picking = false; render(); };
    const paint = () => {
      const t = q.value.trim().toLowerCase();
      const rows = pictures().filter(p => !t || p.name.toLowerCase().includes(t));
      grid.replaceChildren(...(rows.length ? rows.map(p => h('button.life-pic', { type: 'button', 'data-path': p.path, title: p.name, onclick: () => choose(p.path) }, picture(p.path, '', ''), h('span', { text: p.name })))
        : [h('p.life-note', { text: 'No pictures in your files yet. Bring one in from this computer.' })]));
    };
    q.addEventListener('input', paint);
    file.addEventListener('change', async () => {
      const saved = await media.importFiles(`${vfs.HOME}/Pictures`, file.files).catch(() => []);
      if (saved[0] && !S.dead) choose(saved[0].path);
    });
    paint();
    return h('div.life-card.life-picker', { role: 'dialog', 'aria-label': 'Choose a picture' },
      h('div.life-form__row', h('div.field', q),
        h('button.btn', { type: 'button', onclick: () => file.click() }, icon('upload'), h('span', { text: 'From this computer…' })), file,
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { S.picking = false; render(); } }, h('span', { text: 'Cancel' }))),
      grid);
  }

  /* ---------------- views ---------------- */
  const stepper = r => h('div.life-stepper', { role: 'group', 'aria-label': 'Servings' },
    h('button.ibtn', { type: 'button', 'aria-label': 'Fewer servings', disabled: S.servings <= 1, onclick: () => { S.servings = Math.max(1, S.servings - 1); render(); } }, icon('minus')),
    h('b', { 'data-k': 'servings', 'aria-live': 'polite', text: `${S.servings} ${S.servings === 1 ? 'serving' : 'servings'}` }),
    h('button.ibtn', { type: 'button', 'aria-label': 'More servings', disabled: S.servings >= 99, onclick: () => { S.servings = Math.min(99, S.servings + 1); render(); } }, icon('plus')),
    S.servings !== r.servings ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { S.servings = r.servings; render(); } }, h('span', { text: `Back to ${r.servings}` })) : null);

  function listView() {
    const all = recipes();
    const tags = [...new Set(all.flatMap(r => r.tags))].sort();
    const shown = all.filter(r => R.matches(r, S.query) && (!S.tag || r.tags.includes(S.tag)));
    const q = h('input', { type: 'search', placeholder: 'Search recipes, ingredients, tags', 'aria-label': 'Search recipes', value: S.query,
      oninput: () => { S.query = q.value; S.focus = '.life-search input'; render(); } });
    return [
      h('div.life-head', h('div', h('h2', { text: 'Recipes' }), h('small', { text: all.length ? `${all.length} in your box` : 'Your own recipes, kept on this device' })),
        h('div.life-head__act',
          all.length ? h('button.btn', { type: 'button', 'data-act': 'shop', onclick: openShop }, icon('shopping-bag'), h('span', { text: 'Shopping list' })) : null,
          h('button.btn', { type: 'button', 'data-act': 'import-text', onclick: () => { S.view = 'import'; S.importErr = ''; render(); } }, icon('file-text'), h('span', { text: 'From text' })),
          h('button.btn.btn--primary', { type: 'button', onclick: () => startEdit(null) }, icon('plus'), h('span', { text: 'New recipe' })))),
      all.length ? h('div.life-form__row', h('div.field.life-search.life-grow', icon('search'), q)) : null,
      tags.length ? h('div.life-tags', { role: 'group', 'aria-label': 'Filter by tag' },
        h('button.chip', { type: 'button', 'aria-pressed': String(!S.tag), class: !S.tag ? 'chip--accent' : '', onclick: () => { S.tag = ''; render(); } }, h('span', { text: 'All' })),
        tags.map(t => h('button.chip', { type: 'button', 'aria-pressed': String(S.tag === t), class: S.tag === t ? 'chip--accent' : '', onclick: () => { S.tag = S.tag === t ? '' : t; render(); } }, h('span', { text: t })))) : null,
      !all.length
        ? h('div.empty', icon('file-text'), h('b', { text: 'No recipes yet' }), h('small', { text: 'Write your first, or start from two small ones to see how it works.' }),
          h('div.life-form__row', h('button.btn.btn--primary', { type: 'button', onclick: () => startEdit(null) }, icon('plus'), h('span', { text: 'New recipe' })),
            h('button.btn', { type: 'button', onclick: addStarters }, h('span', { text: 'Add two starter recipes' }))))
        : !shown.length ? h('p.life-note', { text: 'Nothing matches that search.' })
          : h('div.life-recipes', shown.map(r => h('button.life-card.life-recipe', { type: 'button', 'data-id': r.id, onclick: () => open(r.id) },
            r.pic ? picture(r.pic, 'life-recipe__img', '') : h('span.life-recipe__img.is-blank', icon('file-text')),
            h('b', { text: r.title }),
            h('small', { text: `${r.servings} servings · ${r.ingredients.length} ingredients${r.tags.length ? ' · ' + r.tags.join(', ') : ''}` })))),
    ];
  }

  function detailView(r) {
    return [
      h('div.life-head',
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { S.view = 'list'; render(); } }, icon('chevron-left'), h('span', { text: 'All recipes' })),
        h('div.life-head__act',
          h('button.btn.btn--primary', { type: 'button', 'data-act': 'cook', onclick: () => startCook(r) }, icon('play'), h('span', { text: 'Cook mode' })),
          h('button.btn', { type: 'button', 'data-act': 'shop', onclick: openShop }, icon('shopping-bag'), h('span', { text: 'Shopping list' })),
          h('button.ibtn', { type: 'button', 'aria-label': 'Save as a text file in Documents', title: 'Save as text', 'data-act': 'save-text', onclick: () => saveText(r) }, icon('download')),
          h('button.ibtn', { type: 'button', 'aria-label': 'Copy as text', title: 'Copy as text', 'data-act': 'copy-text', onclick: () => copyText(r) }, icon('copy')),
          h('button.ibtn', { type: 'button', 'aria-label': 'Edit recipe', onclick: () => startEdit(r) }, icon('edit-3')),
          h('button.ibtn', { type: 'button', 'aria-label': 'Delete recipe', onclick: () => remove(r) }, icon('trash')))),
      S.note ? h('p.life-note', { role: 'status', text: S.note }) : null,
      h('article.life-recipe-view',
        r.pic ? picture(r.pic, 'life-recipe__hero', `Picture of ${r.title}`) : null,
        h('h2', { text: r.title }),
        r.tags.length ? h('div.life-tags', r.tags.map(t => h('span.chip', { text: t }))) : null,
        stepper(r),
        h('h3', { text: 'Ingredients' }),
        h('ul.life-ings', r.ingredients.map(l => h('li', { text: scaled(r, l) }))),
        h('h3', { text: 'Steps' }),
        h('ol.life-steps', r.steps.map(s => h('li', { text: s })))),
    ];
  }

  function cookView(r) {
    const left = r.steps.length - S.ticked.size;
    return h('div.life-cook', { role: 'dialog', 'aria-label': `Cooking ${r.title}`, tabindex: '-1' },
      h('div.life-cook__bar',
        h('b', { text: r.title }), stepper(r),
        h('span.life-cook__count', { 'aria-live': 'polite', text: left ? `${left} of ${r.steps.length} steps to go` : 'All steps done' }),
        h('button.btn', { type: 'button', 'data-act': 'done', onclick: stopCook }, icon('x'), h('span', { text: 'Leave cook mode' }))),
      S.note ? h('p.life-note.life-cook__note', { role: 'status', text: S.note }) : null,
      h('div.life-cook__body',
        h('section', h('h3', { text: 'Ingredients' }), h('ul', r.ingredients.map(l => h('li', { text: scaled(r, l) })))),
        h('section', h('h3', { text: 'Steps' }),
          h('ol', r.steps.map((s, i) => h('li', h('button.life-step', { type: 'button', role: 'checkbox', 'aria-checked': String(S.ticked.has(i)), 'data-step': String(i), class: S.ticked.has(i) ? 'is-done' : '',
            onclick: () => { S.ticked.has(i) ? S.ticked.delete(i) : S.ticked.add(i); S.focus = `[data-step="${i}"]`; render(); } },
            h('span.life-step__box', S.ticked.has(i) ? icon('check') : null), h('span', { text: s })),
            stepTimers(r, i))))),
        h('small.life-note', { text: 'Step timers are Clock timers: they keep going and ring if you leave cook mode or close this window, while StaticOS is open.' })));
  }
  function stepTimers(r, i) {
    const ts = R.stepTimes(r.steps[i]);
    if (!ts.length) return null;
    return h('div.life-tbtns', { role: 'group', 'aria-label': `Timers for step ${i + 1}` }, ts.map((t, k) => {
      const len = A.fmtLen(t.ms);
      return h('div.life-tbtn', { 'data-tk': `${i}:${k}`, 'data-len': len, 'data-state': 'ready' },
        h('button.btn.btn--sm.life-tbtn__go', { type: 'button', 'aria-label': `Start a ${len} timer for step ${i + 1}${t.range ? ` (the shorter end of “${t.text}”)` : ''}`, onclick: () => startStepTimer(r, i, k) }, icon('clock'), h('span', { text: `Timer ${len}` })),
        h('span.life-tbtn__left', { role: 'timer', 'aria-live': 'off' }),
        h('button.btn.btn--sm.btn--ghost.life-tbtn__stop', { type: 'button', hidden: true, 'aria-label': `Stop the step ${i + 1} timer`, onclick: () => stopStepTimer(i, k) }, icon('x'), h('span', { text: 'Stop' })));
    }));
  }

  function importView() {
    const ta = h('textarea', { rows: '14', placeholder: 'Pancakes\nServes 4\n\nIngredients\n- 1 cup flour\n- 2 eggs\n\nSteps\n1. Mix.\n2. Fry for 2 minutes a side.', 'aria-label': 'Recipe text', oninput: () => { S.importText = ta.value; } });
    ta.value = S.importText;
    const file = h('input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown', hidden: true, 'aria-label': 'Open a text file' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 200000) { S.importErr = 'That file is too long to be one recipe.'; render(); return; }
      try { S.importText = await f.text(); } catch (e) { S.importErr = 'The browser couldn’t read that file.'; }
      if (!S.dead) render();
    });
    return [
      h('div.life-head', h('button.btn.btn--ghost', { type: 'button', onclick: () => { S.view = 'list'; render(); } }, icon('chevron-left'), h('span', { text: 'All recipes' })), h('h2', { text: 'Recipe from text' })),
      h('div.life-card.life-edit',
        h('label.life-field', h('span', { text: 'Paste a recipe, or open a text file' }), ta),
        h('small.life-note', { text: 'A title on the first line, then Ingredients and Steps (or Method, Directions). Bullets and numbers are tidied away. It opens in the editor, and nothing is kept until you press Save.' }),
        h('p.life-err', { role: 'alert', text: S.importErr }),
        h('div.life-form__row',
          h('button.btn.btn--primary', { type: 'button', 'data-act': 'read-text', onclick: readImport }, icon('check'), h('span', { text: 'Read recipe' })),
          h('button.btn', { type: 'button', onclick: () => file.click() }, icon('folder-open'), h('span', { text: 'Open a text file…' })), file)),
    ];
  }

  function shopView() {
    const all = recipes();
    const items = shopItems();
    const lists = T.read().lists;
    const to = h('select.life-select', { 'aria-label': 'Send to', onchange: () => { S.shopTo = to.value; } },
      h('option', { value: '', text: 'A new list', selected: !S.shopTo }),
      lists.map(l => h('option', { value: l.id, text: l.name, selected: S.shopTo === l.id })));
    return [
      h('div.life-head', h('button.btn.btn--ghost', { type: 'button', onclick: () => { S.view = S.shopFrom === 'detail' && current() ? 'detail' : 'list'; render(); } }, icon('chevron-left'), h('span', { text: 'Back' })), h('h2', { text: 'Shopping list' })),
      h('div.life-card.life-shop',
        h('b', { text: 'Recipes' }),
        h('ul.life-shop__pick', all.map(r => {
          const on = S.shop.has(r.id);
          const sv = h('input', { type: 'number', min: '1', max: '99', value: String(on ? S.shop.get(r.id) : r.servings), 'aria-label': `Servings of ${r.title}`, disabled: !on,
            onchange: () => { const n = Math.max(1, Math.min(99, Math.round(+sv.value) || r.servings)); S.shop.set(r.id, n); S.focus = `[data-shop="${r.id}"] input[type=number]`; render(); } });
          return h('li', { 'data-shop': r.id },
            h('label.life-chk', h('input', { type: 'checkbox', checked: on, onchange: e => { if (e.target.checked) S.shop.set(r.id, r.servings); else S.shop.delete(r.id); S.shopMsg = ''; S.focus = `[data-shop="${r.id}"] input[type=checkbox]`; render(); } }), h('span', { text: r.title })),
            h('label.life-shop__sv', h('span', { text: 'Servings' }), h('div.field', sv)));
        }))),
      h('div.life-card.life-shop',
        h('b', { text: items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : 'Pick a recipe above' }),
        items.length ? h('ul.life-ings.life-shop__items', items.map(it => h('li', { title: `For ${it.from.join(', ')}`, text: it.text }))) : null,
        items.length ? h('small.life-note', { text: 'The same ingredient in the same unit is added up exactly. A “~” means the amount was rounded to the nearest eighth.' }) : null,
        h('div.life-form__row',
          h('label.life-symbol', h('span', { text: 'Send to' }), to),
          h('button.btn.btn--primary', { type: 'button', 'data-act': 'send-tasks', disabled: !items.length, onclick: sendShop }, icon('check'), h('span', { text: 'Send to Tasks' }))),
        S.shopMsg ? h('p.life-note', { role: 'status', 'data-k': 'shop-msg', text: S.shopMsg }) : null),
    ];
  }

  function editView() {
    const d = S.draft;
    const field = (label, input) => h('label.life-field', h('span', { text: label }), input);
    const title = h('input', { type: 'text', maxlength: '80', value: d.title, 'aria-label': 'Title', oninput: () => { d.title = title.value; } });
    const serv = h('input', { type: 'number', min: '1', max: '99', value: String(d.servings), 'aria-label': 'Servings', oninput: () => { d.servings = serv.value; } });
    const tags = h('input', { type: 'text', value: d.tags, placeholder: 'dinner, quick', 'aria-label': 'Tags (separated by commas)', oninput: () => { d.tags = tags.value; } });
    const ing = h('textarea', { rows: '8', placeholder: '1/2 cup flour\n2 eggs\n1 1/2 tsp salt', 'aria-label': 'Ingredients, one per line', oninput: () => { d.ingredients = ing.value; } }); ing.value = d.ingredients;
    const steps = h('textarea', { rows: '8', placeholder: 'One step per line', 'aria-label': 'Steps, one per line', oninput: () => { d.steps = steps.value; } }); steps.value = d.steps;
    return [
      h('div.life-head', h('h2', { text: d.id ? 'Edit recipe' : 'New recipe' })),
      S.note ? h('p.life-note', { role: 'status', text: S.note }) : null,
      h('div.life-card.life-edit',
        h('div.life-form__row', field('Title', h('div.field', title)), field('Servings', h('div.field', serv))),
        field('Tags', h('div.field', tags)),
        h('div.life-form__row.life-two', field('Ingredients (one per line, amount first)', ing), field('Steps (one per line)', steps)),
        h('small.life-note', { text: 'Amounts like 1/2, 1 1/2, 0.5 or ½ are scaled exactly when you change servings.' }),
        h('div.life-form__row',
          d.pic ? picture(d.pic, 'life-recipe__thumb', 'Chosen picture') : null,
          h('button.btn', { type: 'button', 'data-act': 'pic', onclick: () => { S.picking = true; render(); } }, icon('image'), h('span', { text: d.pic ? 'Change picture' : 'Choose a picture' })),
          d.pic ? h('button.btn.btn--ghost', { type: 'button', onclick: () => { d.pic = ''; render(); } }, h('span', { text: 'Remove picture' })) : null),
        S.picking ? picker() : null,
        h('p.life-err', { role: 'alert', text: S.error || '' }),
        h('div.life-form__row',
          h('button.btn.btn--primary', { type: 'button', 'data-act': 'save', onclick: saveDraft }, icon('check'), h('span', { text: 'Save recipe' })),
          h('button.btn', { type: 'button', onclick: () => { S.draft = null; S.picking = false; if (S.id && current()) open(S.id); else { S.view = 'list'; render(); } } }, h('span', { text: 'Cancel' })))),
    ];
  }

  function render() {
    if (S.dead) return;
    const r = S.view === 'detail' ? current() : null;
    if (S.view === 'detail' && !r) S.view = 'list';
    if (S.view === 'shop' && !S.shop) S.view = 'list';
    const kids = S.view === 'edit' ? editView() : S.view === 'detail' ? detailView(r) : S.view === 'import' ? importView() : S.view === 'shop' ? shopView() : listView();
    const scroll = el.scrollTop;
    el.replaceChildren(...kids.filter(Boolean), ...(S.cook && r ? [cookView(r)] : []));
    if (S.cook && r) paintTimers();
    if (S.cook && r) { el.classList.add('has-cook'); } else el.classList.remove('has-cook');
    el.scrollTop = scroll;
    if (S.focus) { const f = el.querySelector(S.focus); S.focus = ''; if (f) { f.focus(); if (f.setSelectionRange && f.type === 'search') { const n = f.value.length; try { f.setSelectionRange(n, n); } catch (e) { /* ignore */ } } } }
  }

  const onKey = e => { if (e.key === 'Escape' && S.cook) { e.preventDefault(); stopCook(); } };
  el.addEventListener('keydown', onKey);
  render();
  return () => {
    S.dead = true;
    el.removeEventListener('keydown', onKey);
    if (lock) { lock.release(); lock = null; }
    if (tick) { clearInterval(tick); tick = 0; }
    offClock();
  };
}
