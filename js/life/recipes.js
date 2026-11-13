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
   ============================================================ */
import * as R from '../core/recipes.js';
import media from '../core/media.js';
import { hold } from '../core/wakelock.js';
import { read, write, uid } from './data.js';

export function mountRecipes(el, ctx) {
  const { h, icon, vfs, confirm } = ctx.api;
  const S = { view: 'list', id: null, query: '', tag: '', servings: 0, ticked: new Set(), cook: false, draft: null, picking: false, dead: false, focus: '' };
  let lock = null;
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
  function startCook(r) {
    S.cook = true; S.ticked = new Set();
    lock = lock || hold();
    render();
  }
  function stopCook() {
    S.cook = false;
    if (lock) { lock.release(); lock = null; }
    render();
  }

  /* ---------------- actions ---------------- */
  function open(id) { S.id = id; S.view = 'detail'; const r = current(); S.servings = r ? r.servings : 0; S.cook = false; render(); }
  function startEdit(r) {
    S.draft = r ? { ...r, tags: r.tags.join(', '), ingredients: r.ingredients.join('\n'), steps: r.steps.join('\n') }
      : { id: '', title: '', servings: 4, tags: '', ingredients: '', steps: '', pic: '' };
    S.view = 'edit'; S.error = ''; render();
  }
  function saveDraft() {
    const d = S.draft;
    const r = R.normRecipe({ ...d, id: d.id || uid('r') });
    if (!r) { S.error = 'Give the recipe a title.'; render(); return; }
    const list = recipes();
    if (!d.id && list.length >= R.MAX_RECIPES) { S.error = `The box holds up to ${R.MAX_RECIPES} recipes.`; render(); return; }
    save(d.id ? list.map(x => (x.id === r.id ? r : x)) : [...list, r]);
    S.draft = null; S.error = '';
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
        h('button.btn.btn--primary', { type: 'button', onclick: () => startEdit(null) }, icon('plus'), h('span', { text: 'New recipe' }))),
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
          h('button.ibtn', { type: 'button', 'aria-label': 'Edit recipe', onclick: () => startEdit(r) }, icon('edit-3')),
          h('button.ibtn', { type: 'button', 'aria-label': 'Delete recipe', onclick: () => remove(r) }, icon('trash')))),
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
      h('div.life-cook__body',
        h('section', h('h3', { text: 'Ingredients' }), h('ul', r.ingredients.map(l => h('li', { text: scaled(r, l) })))),
        h('section', h('h3', { text: 'Steps' }),
          h('ol', r.steps.map((s, i) => h('li', h('button.life-step', { type: 'button', role: 'checkbox', 'aria-checked': String(S.ticked.has(i)), 'data-step': String(i), class: S.ticked.has(i) ? 'is-done' : '',
            onclick: () => { S.ticked.has(i) ? S.ticked.delete(i) : S.ticked.add(i); S.focus = `[data-step="${i}"]`; render(); } },
            h('span.life-step__box', S.ticked.has(i) ? icon('check') : null), h('span', { text: s }))))))));
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
    const kids = S.view === 'edit' ? editView() : S.view === 'detail' ? detailView(r) : listView();
    const scroll = el.scrollTop;
    el.replaceChildren(...kids.filter(Boolean), ...(S.cook && r ? [cookView(r)] : []));
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
  };
}
