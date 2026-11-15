/* ============================================================
   setups-pane.js — the parts of Settings that keep, move and tune
   your setup. Settings hands each one its own helpers as `kit`
   (api, caption, group, row, srow, note, btn, sw, slider, setPref, pref,
   dflt, SET, repaint, async_, bytes …), as the other pane modules take.

     setupsPane(kit)    Settings › Setups & modes: Modes (Study, Gaming,
                        Chill), whole-setup profiles ("Home", "School",
                        "Night") and moving your settings to another computer
     mixerRows(kit)     Settings › Sound: a level for each app's own sound
     storageByApp(kit)  Settings › Storage: what each app is holding, and Clear
     quickStrip(kit)    the strip above every pane: the switches you chose
     textPreview(kit)   Settings › Accessibility: font, spacing, size and
                        contrast, together, on real text
     labsRows(kit)      Settings › Labs: what each experiment changes, and
                        whether turning it off puts everything back
     changedPane(kit)   every setting that is not at its default, each with Reset

   The engines are js/core/setup.js (snapshots, profiles, modes),
   js/core/lookcode.js (the look inside them) and js/core/appearance.js
   (the volume).
   ============================================================ */
import { store } from '../core/store.js';
import * as SU from '../core/setup.js';
import * as TAP from '../core/audiotap.js';
import { appOf } from '../core/appearance.js';
import { vfs } from '../core/vfs.js';
import * as MEDIA from '../core/media.js';
import { LABS } from '../core/labs.js';
import { hasIcon } from '../core/icons.js';
import { appTile } from '../core/appart.js';
import { t, plural } from '../core/i18n.js';

const ic = n => (hasIcon(n) ? n : 'sliders');
const show = v => (v === true ? t('on') : v === false ? t('off') : v === undefined || v === null || v === '' ? t('not set')
  : typeof v === 'object' ? (Array.isArray(v) ? plural(v.length, '{n} item', '{n} items') : t('custom'))
    : String(v).length > 28 ? `${String(v).slice(0, 27)}…` : String(v));
const countOf = it => ({
  file: plural(it.count, '{n} file', '{n} files'), note: plural(it.count, '{n} note', '{n} notes'),
  clip: plural(it.count, '{n} clip', '{n} clips'), project: plural(it.count, '{n} project', '{n} projects'),
  history: plural(it.count, '{n} history', '{n} histories'),
})[it.unit] || `${it.count} ${it.unit}`;
const stamp = at => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

/* ---------------- Setups & modes ---------------------------------- */
export function setupsPane(K) {
  const { api, caption, group, row, note, btn, SET, repaint } = K;
  const { h, icon } = api;
  const labelOf = k => SET[k]?.label || k;
  const say = (title, message, undo) => api.notify({
    app: t('Settings'), icon: 'layers', title, message, timeout: 9000,
    actions: undo ? [{ label: t('Undo'), onClick: () => { undo(); repaint(); } }] : undefined,
  });
  const cur = SU.mode();

  /* ---- Modes ---- */
  const modeRows = SU.MODES.map(m => {
    const on = cur === m.id;
    const ch = SU.modeChanges(m.id);
    const names = [...new Set((on ? Object.keys(store.get('prefs.modeBackup', {})?.set || {}) : ch.map(c => c.key)).map(labelOf))];
    const r = row(ic(m.icon), t('{name} mode', { name: m.name }), `${m.note}${names.length ? ` ${on ? t('Changed') : t('Would change')}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? t(' and {n} more', { n: names.length - 8 }) : ''}.` : ''}`,
      on ? h('span.badge.badge--accent', { text: t('On') }) : null,
      btn(on ? 'rotate-ccw' : 'play', on ? t('Turn off') : t('Turn on'), () => {
        if (on) { SU.clearMode(); say(t('{name} mode off', { name: m.name }), t('What it changed is back, unless you changed it yourself since.')); repaint(); return; }
        const undo = SU.setMode(m.id);
        say(t('{name} mode on', { name: m.name }), plural(ch.length, '{n} setting changed. Turn it off any time to put them back.', '{n} settings changed. Turn it off any time to put them back.'), undo);
        repaint();
      }));
    r.dataset.mode = m.id;
    return r;
  });

  /* ---- whole-setup profiles ---- */
  const input = h('input', { type: 'text', maxlength: '24', placeholder: t('Name this setup'), spellcheck: 'false', 'aria-label': t('Setup name'), autocomplete: 'off', 'data-setup-name': '' });
  const save = () => {
    try {
      const one = SU.saveSetup(input.value);
      say(t('“{name}” saved', { name: one.name }), t('Your settings, Dock and look are kept under that name.'));
      repaint();
    } catch (e) { say(t('Not saved'), e.message); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  const list = SU.setups();
  const setupRows = list.map(s => {
    const n = Object.keys(s.snap.prefs || {}).length;
    const r = row('layers', s.name, t('{n} settings and {v} Dock apps, kept {v2}.', { n, v: (s.snap.dock || []).length, v2: stamp(s.snap.at) }),
      btn('check', t('Use'), () => {
        const used = SU.useSetup(s.id);
        if (!used) return;
        say(t('“{name}” is on', { name: s.name }), `${plural(used.plan.changes.length, '{n} setting changed', '{n} settings changed')}${used.plan.dock ? t(', and the Dock') : ''}.`, used.undo);
        repaint();
      }, '.btn--primary'),
      btn('save', t('Update'), () => { try { SU.saveSetup(s.name); say(t('“{name}” updated', { name: s.name }), t('It now holds how things are set up right now.')); repaint(); } catch (e) { say(t('Not saved'), e.message); } }),
      btn('trash', t('Remove'), () => { SU.removeSetup(s.id); repaint(); }, '.btn--ghost'));
    r.dataset.setup = s.name;
    return r;
  });

  /* ---- move settings ---- */
  const preview = h('div.st-import', { 'aria-live': 'polite' });
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-import': '' });
  const doExport = () => {
    const snap = SU.snapshot(t('My settings'));
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `staticos-settings-${new Date().toISOString().slice(0, 10)}${SU.EXT}` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    say(t('Settings saved to a file'), t('{v} settings. No files, notes or saves are in it.', { v: Object.keys(snap.prefs).length }));
  };
  const showImport = (v) => {
    api.clear(preview);
    if (!v.ok) { preview.append(h('div.st-lookprev__err', icon('alert'), h('span', { text: v.error }))); return; }
    const pl = SU.plan(v.snap);
    const opts = { dock: true, look: true };
    const lines = pl.changes.slice(0, 12).map(c => h('li', { text: `${labelOf(c.key)}: ${show(c.from)} → ${show(c.to)}` }));
    const rest = pl.changes.length - 12;
    preview.append(
      h('div.st-lookprev__h', { text: plural(pl.changes.length, '“{name}” would change {n} setting:', '“{name}” would change {n} settings:', { name: v.snap.name }) }),
      lines.length ? h('ul', lines, rest > 0 ? h('li', { text: t('…and {rest} more', { rest }) }) : null) : h('small.dim', { text: t('Everything in the file is already how it is here.') }),
      pl.unknown.length ? h('small.dim', { text: plural(pl.unknown.length, '{n} setting this version of StaticOS doesn’t know will be left out.', '{n} settings this version of StaticOS doesn’t know will be left out.') }) : null,
      pl.refused.length ? h('small.dim', { text: plural(pl.refused.length, '{n} value that didn’t look right will be left out.', '{n} values that didn’t look right will be left out.') }) : null,
      pl.dock ? h('label.st-check', h('input', { type: 'checkbox', checked: true, 'aria-label': t('Also set the Dock'), onchange: e => { opts.dock = e.target.checked; } }), h('span', { text: t('Also set the Dock ({length} apps)', { length: pl.dock.length }) })) : null,
      pl.look && pl.look.length ? h('label.st-check', h('input', { type: 'checkbox', checked: true, 'aria-label': t('Also set the wallpaper'), onchange: e => { opts.look = e.target.checked; } }), h('span', { text: t('Also set the look: {list}', { list: pl.look.join(' · ') }) })) : null,
      h('div.row', { style: { gap: '6px', marginTop: '8px' } },
        h('button.btn.btn--sm.btn--primary', { type: 'button', 'data-import-apply': '', onclick: () => {
          const undo = SU.apply(v.snap, opts);
          api.clear(preview);
          say(t('Settings imported'), plural(pl.changes.length, '{n} setting changed.', '{n} settings changed.'), undo);
          repaint();
        } }, icon('check'), t('Apply')),
        h('button.btn.btn--sm', { type: 'button', onclick: () => api.clear(preview) }, t('Cancel'))));
  };
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    if (f.size > SU.MAX_BYTES) { showImport({ ok: false, error: t('That file is too big to be a settings file.') }); return; }
    showImport(SU.validate(await f.text()));
  });

  return [
    caption(t('Modes')),
    group(...modeRows),
    note(t('A mode switches a handful of ordinary settings together. Turning it off puts back what it changed, and leaves alone anything you changed yourself afterwards.'), 'layers'),
    caption(t('Your setups')),
    group(...(setupRows.length ? setupRows : [row('layers', t('No setups yet'), t('Keep how everything is set up right now under a name, like Home, School or Night, and switch in one click.'))]),
      h('div.set-row.st-setupnew',
        h('div.set-row__t', h('b', { text: t('Keep this setup') }),
          h('div.st-chips', SU.SETUP_NAMES.map(n => h('button.st-chip', { type: 'button', onclick: () => { input.value = n; input.focus(); } }, n)))),
        h('div.set-row__c', h('div.field', { style: { width: '150px' } }, input), btn('save', t('Keep'), save, '.btn--primary')))),
    note(t('A setup holds your settings, the Dock and your look (the wallpaper, theme, icons and sounds). It never holds files, notes, saves, PINs, keys or where you are.'), 'info'),
    caption(t('Move your settings')),
    group(row('download', t('Settings file'), t('Write your settings, Dock and look to a file, to set up another computer without moving anything else.'),
      btn('download', t('Save to a file'), doExport),
      btn('upload', t('Open a file…'), () => file.click()))),
    file, preview,
  ];
}

/* ---------------- the volume mixer --------------------------------- */
export function mixerRows(K) {
  const { api, caption, group, row, note, btn, slider, setPref } = K;
  const { h } = api;
  const levels = () => ({ ...(store.get('prefs.appVolume', {}) || {}) });
  const sounding = id => [...document.querySelectorAll('audio,video')].some(el => !el.paused && !el.ended && appOf(el) === id);
  const ids = [...new Set([
    ...['music', 'radio', 'videos'],
    ...TAP.list().map(s => s.id),
    ...[...document.querySelectorAll('audio,video')].map(appOf),
    ...Object.keys(levels()),
  ])].filter(id => id && api.getApp(id));
  const rows = ids.map(id => {
    const app = api.getApp(id);
    const lvl = Math.round((Number.isFinite(Number(levels()[id])) ? Number(levels()[id]) : 100));
    const r = row(appTile(app, { gs: '26px' }), app.name, sounding(id) ? t('Playing now') : t('Its own level, under the system volume.'),
      slider(t('{name} volume', { name: app.name }), lvl, v => { const m = levels(); if (v >= 100) delete m[id]; else m[id] = v; setPref('appVolume', m); }));
    r.dataset.mixer = id;
    return r;
  });
  return [
    caption(t('Volume mixer')),
    group(...rows),
    h('div.row', { style: { gap: 'var(--sp-3)' } },
      btn('rotate-ccw', t('Back to 100% for every app'), () => { setPref('appVolume', {}); K.repaint(); }, '.btn--ghost')),
    note(t('This controls the sound StaticOS’s own apps play: the Music and Radio players, Videos, and any audio or video inside an app’s window. It can’t turn down sound made inside a game or page from another website (the browser keeps that out of reach), and it can’t change your computer’s volume. The interface sounds have their own level above.'), 'info'),
  ];
}

/* ---------------- storage by app ----------------------------------- */
export function storageByApp(K) {
  const { api, caption, group, row, note, btn, async_, bytes, repaint } = K;
  const { h } = api;
  const dir = name => `${vfs.HOME}/${name}`;
  const dirSize = name => { const n = vfs.node(dir(name)); return n && n.type === 'dir' ? vfs.size(n) : 0; };
  const dirCount = name => { const n = vfs.node(dir(name)); return n && n.type === 'dir' ? n.children.length : 0; };
  const clearDir = async name => {
    const n = vfs.node(dir(name));
    if (!n || n.type !== 'dir') return;
    for (const c of [...n.children]) vfs.rm(`${dir(name)}/${c.name}`, { permanent: true });
    try { await MEDIA.gc(); } catch (e) { /* nothing to collect */ }
  };
  const load = async () => {
    const out = [];
    /* the file system's own folders, as the file system records them */
    for (const [id, name, app, icon_, what] of [
      ['photos', 'Pictures', t('Photos and Pictures'), 'image', 'files'], ['music', 'Music', t('Music'), 'music', 'files'],
      ['videos', 'Videos', t('Videos'), 'film', 'files'], ['docs', 'Documents', t('Documents'), 'file-text', 'files'],
      ['downloads', 'Downloads', t('Downloads'), 'download', 'files'],
    ]) out.push({ id, name: app, icon: icon_, size: dirSize(name), count: dirCount(name), unit: 'file', run: () => clearDir(name) });
    const notes = store.get('notes', null);
    out.push({ id: 'notes', name: t('Notes'), icon: 'file-text', size: notes ? JSON.stringify(notes).length : 0, count: Array.isArray(notes) ? notes.length : (notes && Array.isArray(notes.items) ? notes.items.length : (notes ? 1 : 0)), unit: 'note', approx: true,
      run: () => store.set('notes', store.defaults?.notes ?? null) });
    try {
      const P = await import('../core/projects.js');
      const list = await P.list();
      out.push({ id: 'projects', name: t('Game projects (Forge)'), icon: 'sparkles', size: list.reduce((n, p) => n + JSON.stringify(p).length, 0), count: list.length, unit: 'project', approx: true,
        run: async () => { for (const p of list) await P.remove(p.id); } });
    } catch (e) { /* no database in this session */ }
    try {
      const DB = await import('../core/db.js');
      const clips = (await DB.kv('clips').all()).filter(c => c && c.id);
      out.push({ id: 'clips', name: t('Arcade clips'), icon: 'film', size: clips.reduce((n, c) => n + (c.blob && c.blob.size ? c.blob.size : JSON.stringify(c).length), 0), count: clips.length, unit: 'clip',
        run: async () => { for (const c of clips) await DB.kv('clips').del(c.id); api.bus.emit('clips:change', { kind: 'clear' }); } });
    } catch (e) { /* no database in this session */ }
    try {
      const ST = await import('../core/screentime.js');
      const n = (() => { try { return (JSON.stringify(JSON.parse(localStorage.getItem(ST.KEY) || '{}')) || '').length; } catch (e) { return 0; } })();
      out.push({ id: 'screentime', name: t('Screen Time history'), icon: 'bar-chart', size: n, count: ST.range(ST.KEEP_DAYS).total ? 1 : 0, unit: 'history', approx: true, run: () => ST.clear() });
    } catch (e) { /* not loaded */ }
    return out.sort((a, b) => b.size - a.size);
  };
  return [
    caption(t('Storage by app')),
    async_(load, list => h('div.col', { style: { gap: 'var(--sp-4)' } },
      group(...list.map(it => {
        const r = row(it.icon, it.name, it.count ? countOf(it) : t('Nothing stored'),
          h('span.badge', { text: `${it.approx && it.size ? '≈ ' : ''}${it.size ? bytes(it.size) : '0 B'}` }),
          btn('trash', t('Clear'), async () => {
            const yes = await api.confirm({ title: t('Clear {name}?', { name: it.name }), message: t('{what} ({size}) will be deleted from this computer. This can’t be undone.', { what: countOf(it), size: bytes(it.size) }), ok: t('Clear it'), danger: true });
            if (!yes) return;
            await it.run();
            api.notify({ app: t('Settings'), icon: 'trash', title: t('{name} cleared', { name: it.name }) });
            repaint();
          }, '.btn--ghost'));
        r.dataset.storage = it.id;
        if (!it.count && !it.size) { r.classList.add('is-dim'); r.querySelector('.btn').disabled = true; }
        return r;
      })),
      note(t('Sizes are what each app’s own saved data adds up to on this computer. Notes, projects and history are measured as saved text, so those are approximate (≈). The browser’s total above also counts caches and the offline copy.'), 'info')),
    t('Adding it up…')),
  ];
}

/* ---------------- the quick settings strip --------------------------- */
const STRIP = {
  volume: { icon: 'volume', label: t('Volume'), slider: { key: 'volume', min: 0, max: 100, d: 62 } },
  brightness: { icon: 'sun', label: t('Brightness'), slider: { key: 'brightness', min: 20, max: 100, d: 100 } },
  dnd: { icon: 'dnd', label: t('Do Not Disturb'), toggle: { get: () => !!store.get('prefs.dnd'), set: v => store.set('prefs.dnd', v) } },
  dark: { icon: 'moon', label: t('Dark mode'), toggle: {
    get: () => store.get('prefs.theme') !== 'light',
    set: v => { store.set('prefs.themeAuto', false); store.set('prefs.themeSun', false); store.set('prefs.theme', v ? 'dark' : 'light'); } } },
  mute: { icon: 'volume-x', label: t('Mute'), toggle: { get: () => !!store.get('prefs.muted'), set: v => store.set('prefs.muted', v) } },
  night: { icon: 'night-shift', label: t('Night Shift'), toggle: { get: () => !!store.get('prefs.nightShift'), set: v => store.set('prefs.nightShift', v) } },
};
export const STRIP_IDS = Object.keys(STRIP);

/** The strip: the controls you chose, kept in step with the rest of the system. Returns { el, destroy }. */
export function quickStrip(K) {
  const { api, dflt } = K;
  const { h, icon } = api;
  const el = h('div.set-quick', { role: 'group', 'aria-label': t('Quick settings') });
  const chosen = () => {
    const v = store.get('prefs.quickStrip', null);
    const list = (Array.isArray(v) ? v : dflt('quickStrip') || []).filter(id => STRIP[id]);
    return [...new Set(list)];
  };
  const syncs = [];
  function build() {
    syncs.length = 0;
    api.clear(el);
    for (const id of chosen()) {
      const d = STRIP[id];
      if (d.slider) {
        const { key, min, max, d: def } = d.slider;
        const input = h('input.slider', { type: 'range', min: String(min), max: String(max), 'aria-label': d.label, dataset: { quick: id },
          oninput: e => store.set('prefs.' + key, Number(e.target.value)) });
        const out = h('small', { style: { width: '34px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
        const sync = () => { const v = Math.round(Number(store.get('prefs.' + key, def))); if (document.activeElement !== input) input.value = String(v); out.textContent = `${v}%`; };
        sync(); syncs.push(sync);
        el.appendChild(h('div.set-quick__i', icon(d.icon), h('span', { text: d.label }), input, out));
      } else {
        const b = h('button.set-quick__t', { type: 'button', role: 'switch', dataset: { quick: id }, 'aria-label': d.label, onclick: () => d.toggle.set(!d.toggle.get()) }, icon(d.icon), h('span', { text: d.label }));
        const sync = () => { const on = !!d.toggle.get(); b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); };
        sync(); syncs.push(sync);
        el.appendChild(b);
      }
    }
    el.appendChild(h('div.grow'));
    el.appendChild(h('button.st-mini', { type: 'button', 'aria-label': t('Choose what the quick settings show'), 'data-quick-edit': '', onclick: e => {
      const r = e.currentTarget.getBoundingClientRect();
      api.menu(STRIP_IDS.map(id => ({ label: STRIP[id].label, icon: STRIP[id].icon, checked: chosen().includes(id),
        onClick: () => {
          const now = chosen();
          const next = now.includes(id) ? now.filter(x => x !== id) : [...now, id].sort((a, b) => STRIP_IDS.indexOf(a) - STRIP_IDS.indexOf(b));
          store.set('prefs.quickStrip', next);
        } })), r.right - 190, r.bottom + 6);
    } }, t('Edit')));
  }
  build();
  let q = 0;
  const off = [
    store.sub('prefs', (_v, path) => {
      if (typeof path === 'string' && path === 'prefs.quickStrip') { build(); return; }
      if (!q) q = requestAnimationFrame(() => { q = 0; syncs.forEach(f => f()); });
    }),
  ];
  return { el, destroy: () => { cancelAnimationFrame(q); off.forEach(f => f()); } };
}

/* ---------------- text preview --------------------------------------- */
const SIZE = { small: t('Small'), normal: t('Default'), large: t('Large'), larger: t('Largest') };
const FONT = { default: t('Default'), dyslexic: 'OpenDyslexic', hyperlegible: t('Atkinson Hyperlegible') };
const CONTRAST = { normal: t('Standard contrast'), high: t('Increased contrast'), max: t('High contrast') };

/** One card on real text that follows size, font, spacing and contrast as you change them. */
export function textPreview(K) {
  const { api, pref } = K;
  const { h, icon } = api;
  const sum = h('div.st-textprev__sum', { 'aria-live': 'polite' });
  const spacing = () => {
    const lh = Number(pref('lineHeight')) || 0, ls = Number(pref('letterSpacing')) || 0, ws = Number(pref('wordSpacing')) || 0;
    return [lh > 1.21 ? t('lines {n}', { n: lh.toFixed(1) }) : null, ls > 0.001 ? t('letters +{n}em', { n: ls.toFixed(2) }) : null, ws > 0.001 ? t('words +{n}em', { n: ws.toFixed(2) }) : null].filter(Boolean).join(', ') || t('spacing as designed');
  };
  const chips = () => [SIZE[pref('textScale')] || t('Default'), FONT[pref('fontFace')] || t('Default font'), spacing(), CONTRAST[pref('contrast')] || t('Standard contrast')];
  const card = h('div.card.st-textprev', { 'data-textprev': '' },
    h('div.card__head', icon('type'), h('div.card__t', { text: t('Text preview') }), h('div.grow'),
      h('small.dim', { text: t('Changes show here as you make them') })),
    h('div.st-textprev__page',
      h('h4', { text: t('A heading, as it will look') }),
      h('p', { text: t('Reading is easier when the size, the font, the space between lines and letters, and the contrast all suit you. This is real text, set the way every app on this computer will set it.') }),
      h('p.st-textprev__muted', { text: t('Secondary text, like the small lines under a setting, sits a little fainter.') }),
      h('div.row', { style: { gap: 'var(--sp-3)', flexWrap: 'wrap' } },
        h('button.btn.btn--sm.btn--primary', { type: 'button', text: t('A button') }),
        h('a.st-textprev__link', { href: '#', onclick: e => e.preventDefault(), text: t('A link') }),
        h('span.chip.chip--accent', { text: t('A chip') }))),
    sum);
  const paint = () => api.render(sum, chips().map(t => h('span.chip', { text: t })));
  paint();
  const off = store.sub('prefs', () => { if (!card.isConnected) { off(); return; } paint(); });
  return card;
}

/* ---------------- Labs ------------------------------------------------ */
export function labsRows(K) {
  const { api, srow, prefSwitch } = K;
  const { h, icon } = api;
  return LABS.map(l => {
    const r = srow(l.key, prefSwitch(l.key));
    r.dataset.lab = l.key;
    r.querySelector('.set-row__t')?.append(h('div.st-lab',
      h('div', h('b', { text: t('Changes: ') }), h('span', { text: l.changes.join('; ') + '.' })),
      l.sends ? h('div.st-lab__sends', icon('globe'), h('span', { text: l.sends })) : h('div', h('b', { text: t('Sends nothing off this computer.') })),
      h('div.st-lab__undo', icon('rotate-ccw'), h('span', { text: l.undo }))));
    return r;
  });
}

/* ---------------- changed from default ------------------------------- */
const sameV = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Is this setting different from what it is when nothing has been chosen? */
export function isChanged(K, id) {
  const v = store.get('prefs.' + id);
  if (v === undefined) return false;
  const d = K.dflt(id);
  if (d === undefined) return !(v === false || v === null || v === 0 || v === '' || (v && typeof v === 'object' && !Object.keys(v).length));
  return !sameV(v, d);
}

export function changedPane(K) {
  const { api, caption, row, group, btn, note, SET, secName, shown, secOf, go, setPref, dflt, repaint } = K;
  const { h } = api;
  const ids = Object.keys(SET).filter(id => SET[id].p && shown(secOf(SET[id].sec)) && isChanged(K, id));
  const rows = ids.map(id => {
    const d = SET[id];
    const r = row(d.icon, d.label, t('{section} · now {now}, default {def}', { section: secName(d.sec), now: show(store.get('prefs.' + id)), def: show(dflt(id)) }),
      btn('arrow-right', t('Show'), () => go(d.sec, true, d.label), '.btn--ghost'),
      btn('rotate-ccw', t('Reset'), () => { setPref(id, dflt(id)); repaint(); }));
    r.dataset.changed = id;
    return r;
  });
  return [
    caption(t('Changed from default · {length}', { length: ids.length })),
    ids.length ? group(...rows) : group(row('check', t('Nothing has been changed'), t('Every setting StaticOS tracks is how it comes out of the box.'))),
    ids.length ? h('div.row', btn('rotate-ccw', t('Reset all of these'), async () => {
      const yes = await api.confirm({ title: t('Reset every changed setting?'), message: plural(ids.length, '{n} setting go back to the StaticOS default. Your files, notes and Dock stay as they are.', '{n} settings go back to the StaticOS default. Your files, notes and Dock stay as they are.'), ok: t('Reset them') });
      if (!yes) return;
      for (const id of ids) setPref(id, dflt(id));
      repaint();
    }, '.btn--danger')) : null,
    note(t('Only settings with a known default are listed here. A setting that has no row in Settings (some apps keep their own) isn’t counted.'), 'info'),
  ].filter(Boolean);
}
