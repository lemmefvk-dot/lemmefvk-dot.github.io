/* ============================================================
   looks-pane.js — the Settings rows for the "looks" batch:

     styleRows(kit)    Appearance: dock style, top bar style, interface
                       font, and light/dark by the sun
     sunRow(kit)       the sun switch and what it will do, in words
     soundRows(kit)    Sound: each sound's own level with a Hear it
                       button, and the typing sounds (off by default)
     themeFileRows(kit) Themes: save the look to a file, open one from Files
     pictureRows(kit)  Wallpaper: your own picture from Files
     cardArt / favButton   the picker's cards: Files pictures, live scenes, hearts
     crtRow(kit)       Desktop: the retro CRT start-up and a preview

   Each takes Settings' own helpers as `kit` (api, caption, group, row,
   srow, note, btn, sw, select, tabs, setPref, pref, repaint) and returns
   nodes. The engines are js/core/appearance.js, themefile.js, sfx.js,
   livewp.js and js/portal/wallpapers.js.
   ============================================================ */
import { store } from '../core/store.js';
import { vfs } from '../core/vfs.js';
import * as MEDIA from '../core/media.js';
import * as WP from '../portal/wallpapers.js';
import * as THEMES from '../core/themes.js';
import * as DAY from '../core/daycycle.js';
import * as TF from '../core/themefile.js';
import * as sfx from '../core/sfx.js';
import { DOCK_STYLES, BAR_STYLES, UI_FONTS } from '../core/appearance.js';
import { t } from '../core/i18n.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clock = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/* ---------- Appearance: dock, top bar, font, the sun ---------- */
export function sunRow(kit) {
  const { api, row, sw, pref, setPref, repaint } = kit;
  const { h } = api;
  const s = DAY.source();
  const say = s.kind === 'place'
    ? t('Light from {v} to {v2} for {place} (the place Weather has), worked out on this computer.', { v: clock(s.rise), v2: clock(s.set), place: s.place })
    : s.why
      ? t('{why}, so fixed times are used: light from {v} to {v2}.', { why: s.why, v: clock(s.rise), v2: clock(s.set) })
      : t('Light from {v} to {v2}. Give Weather a place (a city, or your location) to follow the real sun there.', { v: clock(s.rise), v2: clock(s.set) });
  const r = row('sun', t('Light by day, dark by night'), say,
    sw(t('Light by day, dark by night'), () => pref('themeSun') === true, v => { setPref('themeSun', v); repaint(); }));
  r.dataset.fk = 'theme-sun';
  r.querySelector('small')?.setAttribute('data-fk', 'theme-sun-say');
  return r;
}

export function styleRows(kit) {
  const { caption, group, row, tabs, select, setPref, pref, note } = kit;
  const names = { default: t('Default'), transparent: t('Transparent'), compact: t('Compact'), glass: t('Glass'), solid: t('Solid'), minimal: t('Minimal'), system: t('System'), rounded: t('Rounded'), serif: t('Serif'), mono: t('Monospace') };
  const dock = row('apps', t('Dock style'), t('Glass is the frosted default. Solid is an opaque bar. Minimal takes the bar away and leaves the icons.'),
    tabs(t('Dock style'), DOCK_STYLES.map(v => [v, names[v]]), String(pref('dockStyle')), v => setPref('dockStyle', v)));
  const bar = row('window', t('Top bar style'), t('Transparent lets the wallpaper show through. Compact makes the bar a little shorter.'),
    tabs(t('Top bar style'), BAR_STYLES.map(v => [v, names[v]]), String(pref('barStyle')), v => setPref('barStyle', v)));
  const font = row('type', t('Interface font'), t('The typeface the interface is set in. A reading font chosen in Accessibility still wins over it.'),
    select(t('Interface font'), UI_FONTS.map(v => [v, v === 'default' ? t('Default (Inter)') : names[v]]), String(pref('uiFont')), v => setPref('uiFont', v)));
  dock.dataset.fk = 'dock-style'; bar.dataset.fk = 'bar-style'; font.dataset.fk = 'ui-font';
  return [caption(t('Dock, top bar and font')), group(dock, bar, font), note(t('These change only how the dock, the bar and the text look. Nothing moves and every app works the same.'), 'palette')];
}

/* ---------- Sound: each sound's level, typing ---------- */
export function soundRows(kit) {
  const { api, caption, group, row, sw, note, btn, setPref, pref } = kit;
  const { h } = api;
  const off = pref('uiSounds') === false;
  const levels = () => ({ ...(store.get('prefs.soundLevels', {}) || {}) });
  const rows = sfx.SOUNDS.map(s => {
    const cur = Math.round(sfx.soundLevel(s.id) * 100);
    const out = h('small.dim', { text: `${cur}%`, style: { width: '38px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
    const input = h('input.slider', {
      type: 'range', min: '0', max: '100', step: '5', value: String(cur), 'aria-label': t('{name} volume', { name: s.name }), dataset: { fk: `snd-${s.id}` },
      style: { flex: '1 1 auto', minWidth: '0' },
      oninput: e => { const v = Number(e.target.value); out.textContent = `${v}%`; },
      onchange: e => { setPref('soundLevels', { ...levels(), [s.id]: Number(e.target.value) }); sfx.unlock(); sfx.previewCue(s.id); },
    });
    const hear = btn('play', t('Hear it'), () => { sfx.unlock(); sfx.previewCue(s.id); }, '.btn--ghost');
    hear.dataset.fk = `snd-hear-${s.id}`;
    hear.setAttribute('aria-label', t('Hear {v}', { v: s.name.toLowerCase() }));
    const r = row('volume-2', s.name, s.id === 'key' ? t('Heard only with typing sounds on.') : null, h('div.row', { style: { width: '168px' } }, input, out), hear);
    r.dataset.sound = s.id;
    return r;
  });
  const typing = row('keyboard', t('Typing sounds'), t('A soft key sound as you type in a text field, in your sound pack’s voice. Off unless you turn it on. Shortcuts and instruments stay quiet.'),
    sw(t('Typing sounds'), () => pref('typeSounds') === true, v => { setPref('typeSounds', v); if (v) { sfx.unlock(); sfx.previewCue('key'); } }));
  typing.dataset.fk = 'type-sounds';
  const dim = r => { if (off) { r.classList.add('is-dim'); r.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; }); } return r; };
  const reset = btn('rotate-ccw', t('Every sound back to 100%'), () => { setPref('soundLevels', {}); kit.repaint(); }, '.btn--ghost');
  return [
    caption(t('Each sound')),
    group(dim(typing), ...rows.map(dim)),
    h('div.row', { style: { justifyContent: 'flex-end' } }, reset),
    note(t('Each level sits under the UI sound volume above. 0% silences just that sound; Hear it plays it once in the current pack.')),
  ];
}

/* ---------- Themes: to a file and back ---------- */
/* what the pane says (and the name typed) survives the repaint that follows a save */
let carry = '';
let lastName = t('My theme');
export function themeFileRows(kit) {
  const { api, caption, group, row, btn, select, note, repaint } = kit;
  const { h, icon } = api;
  const say = h('small', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'theme-file-say' } });
  const nameIn = h('input', { type: 'text', maxlength: '40', value: lastName, 'aria-label': t('Theme name'), spellcheck: 'false', dataset: { fk: 'theme-file-name' } });
  const preview = h('div.st-note', { hidden: true, dataset: { fk: 'theme-file-preview' } });
  say.textContent = carry; carry = '';

  /* a theme that has been read and is waiting for a yes */
  let pending = null;
  const offer = (label, text) => {
    const r = TF.validate(text);
    if (!r.ok) { pending = null; preview.hidden = true; say.textContent = r.error; return; }
    pending = r.theme;
    say.textContent = '';
    preview.hidden = false;
    preview.replaceChildren(
      h('i.st-custom__preview', { style: { background: THEMES.swatch(pending.accent || 'aether'), width: '22px', height: '22px', borderRadius: '50%', flex: 'none' } }),
      h('small', h('b', { text: `${pending.name} ` }), t('from {label}: {v}.', { label, v: TF.describe(pending) })),
      btn('check', t('Use this theme'), () => {
        TF.apply(pending);
        carry = t('“{name}” is on.', { name: pending.name });
        pending = null; preview.hidden = true;
        repaint();
      }),
      btn('x', t('Not now'), () => { pending = null; preview.hidden = true; say.textContent = ''; }, '.btn--ghost'));
  };

  const saveBtn = btn('download', t('Save to Files'), () => {
    const p = TF.save(nameIn.value);
    carry = t('Saved to {path}. Send that file to a friend, or open it here later.', { path: p.replace(vfs.HOME, '~') }); lastName = nameIn.value;
    repaint();
  });
  saveBtn.dataset.fk = 'theme-file-save';

  const found = TF.files();
  const pick = select(t('Theme files in Files'), [['', found.length ? t('Pick a theme file…') : t('No theme files in Files yet')], ...found.map(f => [f.path, `${f.name}  (${f.path.replace(vfs.HOME, '~')})`])], '', v => {
    if (!v) return;
    offer(t('Files'), vfs.read(v) || '');
  });
  pick.dataset.fk = 'theme-file-pick';
  pick.disabled = !found.length;

  const input = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true, dataset: { fk: 'theme-file-input' },
    onchange: async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > TF.MAX_BYTES) { say.textContent = t('That file is too big to be a theme.'); return; }
      offer(f.name, await f.text());
    },
  });

  return [
    caption(t('Share a theme')),
    group(
      row('save', t('Save this look as a file'), t('Your accent, light or dark, icon style, dock and bar styles, font and sound pack — and the wallpaper, if it is one that ships with StaticOS. It goes in Documents.'),
        h('div.field', { style: { width: '150px' } }, nameIn), saveBtn),
      row('folder-open', t('Open a theme file'), t('From Files, or from a file on your computer. You see what it changes before anything does.'),
        pick, btn('upload', t('From my computer…'), () => input.click(), '.btn--ghost'), input)),
    preview,
    say,
    note(t('A theme file is plain text with a handful of choices in it. It can’t hold code, a link or a picture of yours, so opening someone else’s can only pick among looks StaticOS already has.'), 'lock'),
  ];
}

/* ---------- Wallpaper: your own picture, the hearts ---------- */
const imagesInFiles = () => {
  const out = [];
  vfs.walk(vfs.HOME, (n, p) => {
    if (n.type === 'file' && MEDIA.kindOf(n.name) === 'image' && MEDIA.isMedia(n) && !/\/Trash\//.test(p) && !/\/\./.test(p)) out.push({ path: p, name: n.name });
  });
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
};

export function pictureRows(kit) {
  const { api, caption, group, row, btn, select, note, repaint } = kit;
  const { h } = api;
  const say = h('small', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'wp-file-say' } });
  const files = imagesInFiles();
  const use = path => {
    try {
      const w = WP.addFile(store, path);
      WP.setActive(store, w.id);
      api.bus.emit('wallpaper:changed');
      say.textContent = t('“{name}” is your wallpaper.', { name: w.name });
      repaint();
    } catch (e) { say.textContent = e.message; }
  };
  const pick = select(t('A picture from Files'), [['', files.length ? t('Pick a picture…') : t('No pictures in Files yet')], ...files.map(f => [f.path, f.path.replace(vfs.HOME, '~')])], '', v => { if (v) use(v); });
  pick.dataset.fk = 'wp-file-pick';
  pick.disabled = !files.length;
  const input = h('input', {
    type: 'file', accept: 'image/*', hidden: true, dataset: { fk: 'wp-file-input' },
    onchange: async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const dir = `${vfs.HOME}/Pictures`;
        if (!vfs.node(dir)) vfs.mkdir(dir);
        const [saved] = await MEDIA.importFiles(dir, [f]);
        if (!saved) { say.textContent = t('That isn’t a picture this can use.'); return; }
        use(saved.path || `${dir}/${saved.name}`);
      } catch (err) { say.textContent = err.message || t('That picture couldn’t be saved.'); }
    },
  });
  return [
    caption(t('Your own picture')),
    group(row('image', t('Use a picture from Files'), t('Pick any picture in Files, or bring one in from your computer. It stays in your Files — this takes no room in your settings — and is yours alone.'),
      pick, btn('upload', t('From my computer…'), () => input.click(), '.btn--ghost'), input)),
    say,
  ];
}

/** Fill a picker card's art for the kinds the picker doesn't know: a live
    scene (its preview gradient) and a picture from Files (read when shown). */
export function cardArt(art, w) {
  if (w.kind === 'live') { art.style.background = w.css; return true; }
  if (w.kind === 'file') {
    art.style.backgroundSize = 'cover'; art.style.backgroundPosition = 'center';
    MEDIA.urlOf(w.path).then(u => { if (u) art.style.backgroundImage = `url("${String(u).replace(/"/g, '%22')}")`; }, () => {});
    return true;
  }
  return false;
}

/** The heart on a picker card: favourites feed rotation and "Next wallpaper". */
export function favButton(w, kit, onChange) {
  const { api } = kit;
  const { h, icon } = api;
  /* updated in place: repainting the picker under a focused heart upsets the focus */
  const el = h('span.ibtn.wpp-card__fav', { role: 'button', tabindex: '0', dataset: { fav: w.id } }, icon('heart'));
  const paint = () => {
    const on = WP.isFav(store, w.id);
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', String(on));
    el.setAttribute('aria-label', on ? t('Remove {name} from favourites', { name: w.name }) : t('Add {name} to favourites', { name: w.name }));
  };
  const flip = () => { WP.toggleFav(store, w.id); paint(); onChange?.(); };
  paint();
  el.addEventListener('click', e => { e.stopPropagation(); flip(); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); flip(); } });
  return el;
}

/* ---------- Desktop: the retro CRT start-up ---------- */
export function crtRow(kit) {
  const { api, row, sw, btn, pref, setPref } = kit;
  const prev = btn('play', t('Preview'), async () => {
    prev.disabled = true;
    try { const m = await import('../shell/boot.js'); await m.previewCrt(document.getElementById('os') || document.body); } finally { prev.disabled = false; }
  }, '.btn--ghost');
  prev.dataset.fk = 'boot-crt-preview';
  const r = row('monitor', 'Retro CRT start-up', t('The start-up splash as a green screen that switches on and off. It plays after the boot menu, for plain StaticOS. Still, with no flicker, under Reduce motion.'),
    sw('Retro CRT start-up', () => pref('bootCrt') === true, v => setPref('bootCrt', v)), prev);
  r.dataset.fk = 'boot-crt';
  return r;
}

export default { styleRows, sunRow, soundRows, themeFileRows, pictureRows, cardArt, favButton, crtRow };
