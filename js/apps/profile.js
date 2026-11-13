/* ============================================================
   profile.js — your profile (sections 17 + 42).

   Who you are on this device: a picture, a display name, a short
   bio, your top games, your creations, collections, activity and
   achievements. Everything shown is this device's real data, and
   all of it is saved on this device only.

   · Picture  — pick one of StaticOS's built-in avatars, or upload
     an image and crop it to a square (it is re-encoded at 256×256;
     the original file is never kept). core/avatar.js draws it.
   · Costume  — a witch hat, vampire cape or ghost sheet drawn over
     the picture. Available all year; from 24 October to 1 November
     the costume row is put up front and highlighted.
   · Name     — the same name Static Social and Party show
     (core/identity.js), so there is one name, not two. Names are
     not verified by anyone, and the field says so.
   · Top games — core/plays.js: games launched on this device, the
     most-launched first. A count is shown only where it was really
     counted; older history shows when it was last played instead.
   · Creations — Forge and Studio projects (core/projects.js), each
     with Share link (shell/share.js → core/sharelink.js).
   · Achievements are read defensively: if the achievements module
     is missing, changed or throws, the section is simply left out.

   Followers and other people's profiles need accounts on a server,
   which StaticOS doesn't have — the page says that plainly.

   Store: portal.profile = { bio, picture, costume }   (see core/avatar.js)
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as Avatar from '../core/avatar.js';
import * as Identity from '../core/identity.js';
import { launchItem } from '../core/launch.js';
import { arcadeById } from '../arcade/index.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-profile-css')) {
  const l = document.createElement('link');
  l.id = 'feat-profile-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-profile.css';
  document.head.appendChild(l);
}

const KEY = Avatar.KEY;          /* portal.profile = { bio, picture, costume } */
const MAX_FILE = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const CROP = 240;                /* crop viewport, CSS px */
const OUT = 256;                 /* saved picture, px */

const KIND_LABEL = { web: 'Static Games', arcade: 'Static Arcade', creation: 'Your creation' };

defineApp({
  id: 'profile',
  name: 'Profile',
  icon: 'user',
  g1: '#a78bfa', g2: '#5b21b6',
  category: 'Create',
  keywords: ['profile', 'creator', 'me', 'avatar', 'picture', 'photo', 'costume', 'halloween', 'my games', 'top games', 'creations', 'published', 'bio', 'name'],
  desc: 'Your picture, name, top games, creations and achievements',
  singleton: true,
  win: { w: 780, h: 660, minW: 400, minH: 460 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon, clear, store, bus, fmt } = api;
    let dead = false;
    let sheet = null;               /* the picture editor, when open */
    let pending = false;            /* a repaint waiting for typing to end */
    const body = h('div.pf__body');
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    const appEl = h('div.app.app--col.pf', body, live);
    root.appendChild(appEl);
    const say = t => { live.textContent = ''; setTimeout(() => { if (!dead) live.textContent = t; }, 40); };

    const prof = () => { const v = store.get(KEY, {}); return v && typeof v === 'object' ? v : {}; };
    const saveProf = patch => store.set(KEY, { ...prof(), ...patch });
    const who = () => store.get('session.user', null);
    const myName = () => {
      const v = store.get('portal.identity', null);
      return (v && typeof v.name === 'string' && v.name) || '';
    };
    const shownName = () => myName() || (who() && (who().name || who().username)) || '';
    const initial = () => (shownName() || Identity.me().name || '?').trim().charAt(0).toUpperCase();
    const thumbs = () => store.get('portal.forge.thumbs', {}) || {};
    const ago = ms => (Number.isFinite(Number(ms)) && ms > 0 ? fmt.fmtAgo(new Date(Number(ms)).toISOString()) : '');

    /* ------------------------------------------------------------------ */
    /*  creations                                                          */
    /* ------------------------------------------------------------------ */
    function creationTile(p) {
      const t = p.published?.thumbnail || thumbs()[p.id];
      const title = p.published?.title || p.name;
      const src = p.source === 'studio' ? 'Studio' : p.source === 'remix' ? 'Remix' : 'Forge';
      const meta = [src, p.published ? 'Published' : `${p.versions.length} version${p.versions.length === 1 ? '' : 's'}`].join(' · ');
      return h('div.pf__game', { dataset: { project: p.id } },
        h('button.pf__gopen', { type: 'button', onclick: () => api.openApp('forge', { project: p.id }), 'aria-label': `Open ${title}` },
          h('div.pf__thumb', t ? { style: { backgroundImage: `url("${String(t).replace(/"/g, '\\"')}")` } } : null, t ? null : icon('sparkles')),
          h('div.pf__gt', { text: title }),
          h('div.pf__gm', { text: meta })),
        h('button.ibtn.pf__gshare', {
          type: 'button', title: 'Share link', 'aria-label': `Share link for ${title}`, dataset: { fk: `share:${p.id}` },
          onclick: () => bus.emit('share:open', { kind: 'creation', id: p.id, title, art: t || null }),
        }, icon('link')));
    }

    /* ------------------------------------------------------------------ */
    /*  top games — real launches on this device                           */
    /* ------------------------------------------------------------------ */
    function topGames(plays) {
      const list = typeof plays.top === 'function' ? plays.top(6) : plays.recent(6).map(r => ({ ...r, plays: null }));
      const since = typeof plays.countedSince === 'function' ? plays.countedSince() : null;
      const cap = h('div.pf__caprow', h('div.pf__cap', { text: 'Your top games' }),
        h('small.pf__capnote', { text: `From your play history on this device${since ? ` · launches counted since ${new Date(since).toLocaleDateString()}` : ''}` }));
      if (!list.length) {
        return h('section.pf__sec.pf__top', cap,
          h('div.pf__empty', h('span', { text: 'Nothing played on this device yet. Games you play in Static Play, the Arcade or Forge show up here.' }),
            api.getApp('play') ? h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('play') }, icon('gamepad'), 'Open Static Play') : null));
      }
      return h('section.pf__sec.pf__top', cap,
        h('ol.pf__tops', list.map((g, i) => {
          const ag = g.kind === 'arcade' ? arcadeById(g.id) : null;
          const art = typeof g.art === 'string' && /^(https:|data:image\/)/.test(g.art) ? g.art : null;
          const sub = g.plays ? `${g.plays} ${g.plays === 1 ? 'launch' : 'launches'} · last ${ago(g.at)}` : `Last played ${ago(g.at)}`;
          return h('li', h('button.pf__topb', {
            type: 'button', 'aria-label': `Play ${g.title}, ${sub}`, dataset: { fk: `top:${g.kind}:${g.id}` },
            onclick: () => launchItem({ kind: g.kind, id: g.id }),
          },
            h('span.pf__rank', { text: String(i + 1), 'aria-hidden': 'true' }),
            h('span.pf__topart', { class: ag ? 'is-hue' : '', style: ag ? { '--hue': String(ag.hue) } : null },
              art ? h('img', { src: art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : icon(ag ? ag.icon : g.kind === 'creation' ? 'sparkles' : 'gamepad')),
            h('span.pf__topt', h('b', { text: g.title }), h('small', { text: `${KIND_LABEL[g.kind] || 'Game'} · ${sub}` }))));
        })));
    }

    /* ------------------------------------------------------------------ */
    /*  activity                                                           */
    /* ------------------------------------------------------------------ */
    function activity(projects, cols, ach, plays) {
      const ev = [];
      const push = (at, ic, text, open) => { if (at) ev.push({ at: Number(at), ic, text, open }); };
      for (const p of projects) {
        const title = p.published?.title || p.name;
        const open = () => api.openApp('forge', { project: p.id });
        push(p.createdAt, p.source === 'remix' ? 'git-branch' : 'sparkles', p.source === 'remix' ? `You remixed a game into “${title}”` : `You started “${title}”`, open);
        (p.versions || []).slice(1).forEach(v => {
          if (v.by === 'ai') push(v.at, 'sparkles', `AI changed “${title}”${v.note ? `: ${String(v.note).slice(0, 80)}` : ''}`, open);
          else if (v.by === 'you') push(v.at, 'edit-3', `You edited “${title}”`, open);
        });
        (p.published?.updates || []).forEach(u => push(u.at, 'upload', `${u.note === 'First release' ? 'Published' : 'Updated'} “${title}”`, open));
      }
      cols.forEach(c => push(c.createdAt, 'bookmark', `You made the collection “${c.name}”`, () => api.openApp('aether-library')));
      (ach || []).filter(a => a.at).forEach(a => push(a.at, a.icon || 'star', `Unlocked “${a.name}”`, () => api.openApp('aether-library')));
      plays.recent(12).forEach(r => push(r.at, 'play', `Played ${r.title}`, null));
      ev.sort((a, b) => b.at - a.at);
      const list = ev.slice(0, 14);
      if (!list.length) return null;
      return h('section.pf__sec',
        h('div.pf__cap', { text: 'Activity on this device' }),
        h('ol.pf__feed', list.map(e => h('li',
          h('span.pf__feedic', icon(e.ic)),
          e.open ? h('button.pf__feedt', { type: 'button', onclick: e.open, text: e.text }) : h('span.pf__feedt', { text: e.text }),
          h('time', { dateTime: new Date(e.at).toISOString(), text: fmt.fmtAgo(new Date(e.at).toISOString()) })))));
    }

    /** Another team owns achievements; read whatever is there, never trust its shape. */
    async function readAchievements(plays) {
      try {
        const A = await import('../core/achievements.js');
        if (!A || typeof A.list !== 'function') return null;
        const all = A.list({ distinct: plays.count(), total: plays.total() });
        if (!Array.isArray(all)) return null;
        return all.filter(a => a && typeof a === 'object' && a.unlocked && typeof a.name === 'string')
          .map(a => ({ name: a.name.slice(0, 60), desc: typeof a.desc === 'string' ? a.desc : '', icon: typeof a.icon === 'string' ? a.icon : 'star', at: Number(a.at) || null }));
      } catch (e) { return null; }
    }

    /* ------------------------------------------------------------------ */
    /*  costume row                                                        */
    /* ------------------------------------------------------------------ */
    function costumes(pic, season) {
      const cur = Avatar.normCostume(prof().costume);
      const opts = [{ id: 'none', name: 'No costume' }, ...Avatar.COSTUMES];
      const row = h('div.pf__cos', { role: 'radiogroup', 'aria-label': 'Costume' },
        opts.map(o => h('button.pf__cosb', {
          type: 'button', role: 'radio', 'aria-checked': cur === o.id ? 'true' : 'false',
          class: cur === o.id ? 'is-on' : '', dataset: { fk: `cos:${o.id}`, costume: o.id },
          onclick: () => setCostume(o.id),
          onkeydown: e => {
            const i = opts.findIndex(x => x.id === o.id);
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (d) { e.preventDefault(); setCostume(opts[(i + d + opts.length) % opts.length].id); }
          },
        },
          Avatar.avatarEl(h, { picture: pic, costume: o.id, initial: initial(), size: 40 }),
          h('span', { text: o.name }))));
      return h('section.pf__sec.pf__costumes', { class: season ? 'is-season' : '' },
        h('div.pf__caprow',
          h('div.pf__cap', { text: 'Costume' }),
          season ? h('span.pf__season', icon('moon'), h('span', { text: 'Halloween season · until 1 November' })) : h('small.pf__capnote', { text: 'Drawn over your picture. Wear one any time.' })),
        row);
    }
    function setCostume(id) {
      const c = Avatar.normCostume(id);
      saveProf({ costume: c });
      say(c === 'none' ? 'Costume off.' : `Wearing the ${Avatar.COSTUMES.find(x => x.id === c).name.toLowerCase()}.`);
    }

    /* ------------------------------------------------------------------ */
    /*  paint                                                              */
    /* ------------------------------------------------------------------ */
    let seq = 0;
    async function paint() {
      if (dead) return;
      const a = document.activeElement;
      if (a && body.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'))) { pending = true; return; }
      const fk = a && body.contains(a) ? a.dataset?.fk : null;
      const my = ++seq;
      const [P, C, plays] = await Promise.all([
        import('../core/projects.js'), import('../core/collections.js').catch(() => null), import('../core/plays.js'),
      ]);
      let projects = [];
      try { projects = await P.list(); } catch (e) { projects = []; }
      const ach = await readAchievements(plays);
      if (dead || my !== seq) return;
      const published = projects.filter(p => p.published);
      const cols = C?.list ? C.list() : [];
      const u = who();
      const { picture } = Avatar.read();
      const season = Avatar.isHalloweenSeason();

      const name = h('input.pf__name', {
        type: 'text', maxlength: '24', placeholder: Identity.me().name, 'aria-label': 'Display name',
        autocomplete: 'nickname', spellcheck: 'false', dataset: { fk: 'name' },
      });
      name.value = shownName();
      const commitName = () => {
        const v = Identity.tidy(name.value, 24);
        if (v === myName()) return;
        Identity.setName(v);
        say(v ? `Your name is now ${v}.` : 'Name cleared.');
      };
      name.addEventListener('change', commitName);
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });

      const bio = h('textarea.pf__bio', { rows: '2', maxlength: '240', placeholder: 'Say what you like to play and make…', 'aria-label': 'Bio', dataset: { fk: 'bio' } });
      bio.value = prof().bio || '';
      bio.addEventListener('change', () => saveProf({ bio: bio.value.slice(0, 240) }));

      const stats = [
        [projects.length, projects.length === 1 ? 'creation' : 'creations'],
        [published.length, 'published'],
        [plays.count(), plays.count() === 1 ? 'game played' : 'games played'],
        ach ? [ach.length, ach.length === 1 ? 'achievement' : 'achievements'] : null,
      ].filter(Boolean);

      clear(body);
      /* native append prints null as text — drop the empty sections first */
      body.append(...[
        h('header.pf__hero', { class: season ? 'is-season' : '' },
          h('div.pf__avwrap',
            h('button.pf__avbtn', { type: 'button', 'aria-label': 'Change your picture', title: 'Change picture', dataset: { fk: 'avatar' }, onclick: openSheet },
              Avatar.avatarEl(h, { initial: initial(), size: 88, label: 'Your profile picture' }),
              h('span.pf__avedit', { 'aria-hidden': 'true' }, icon('camera')))),
          h('div.pf__who',
            name,
            h('div.pf__handle', { text: u ? `@${u.username} · shown in Static Social and Party too. Names aren’t checked by anyone.` : 'Shown in Static Social and Party too. Names aren’t checked by anyone.' }),
            bio),
          h('div.pf__stats', stats.map(([n, l]) => h('div', h('b', { text: String(n) }), h('span', { text: l }))))),
        costumes(picture, season),
        topGames(plays),
        h('section.pf__sec.pf__creations',
          h('div.pf__caprow', h('div.pf__cap', { text: 'Your creations' }), h('small.pf__capnote', { text: 'Made in Static Forge and Studio on this device' })),
          projects.length ? h('div.pf__grid', projects.map(creationTile))
            : h('div.pf__empty', h('span', { text: 'No creations yet.' }), h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('forge') }, icon('sparkles'), 'Open Static Forge'))),
        cols.length ? h('section.pf__sec', h('div.pf__cap', { text: 'Collections' }),
          h('div.pf__chips', cols.map(c => h('button.pf__chip', { type: 'button', onclick: () => api.openApp('aether-library') }, icon('bookmark'), h('span', { text: `${c.name} · ${(c.items || []).length}` }))))) : null,
        activity(projects, cols, ach, plays),
        ach && ach.length ? h('section.pf__sec.pf__ach', h('div.pf__cap', { text: 'Achievements' }),
          h('div.pf__chips', ach.map(x => h('span.pf__chip.pf__chip--ach', { title: x.desc }, icon(x.icon), h('span', { text: x.name }))))) : null,
        h('p.pf__note', { text: 'This profile lives on this device — your picture, name and bio are saved here and nowhere else. Followers and other people’s profiles need accounts on a server, which StaticOS doesn’t have. To pass a game on, use Share link on any creation.' }),
      ].filter(Boolean));
      if (fk) body.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
    }
    body.addEventListener('focusout', () => {
      if (!pending) return;
      setTimeout(() => {
        const a = document.activeElement;
        if (dead || (a && body.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'))) return;
        pending = false;
        paint();
      }, 0);
    });

    /* ------------------------------------------------------------------ */
    /*  picture editor                                                     */
    /* ------------------------------------------------------------------ */
    function closeSheet() {
      if (!sheet) return;
      sheet.cleanup?.();
      sheet.el.remove();
      sheet = null;
      body.querySelector('[data-fk="avatar"]')?.focus({ preventScroll: true });
    }

    function openSheet() {
      closeSheet();
      const saved = Avatar.read();
      const st = { tab: saved.picture?.kind === 'upload' ? 'upload' : 'builtin', choice: saved.picture, crop: null, err: '' };
      const preview = h('div.pfs__preview');
      const tabsEl = h('div.tabs.pfs__tabs', { role: 'tablist', 'aria-label': 'Picture source' });
      const pane = h('div.pfs__pane');
      const errEl = h('div.pfs__err', { role: 'alert' });
      const fileIn = h('input.sr', { type: 'file', accept: IMAGE_TYPES.join(','), tabindex: '-1', 'aria-hidden': 'true', onchange: e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadFile(f); } });
      const saveBtn = h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { act: 'save-picture' }, onclick: () => commit() }, icon('check'), h('span', { text: 'Save picture' }));
      const card = h('div.pfs__card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Change your picture', tabindex: '-1' },
        h('div.pfs__head', h('b', { text: 'Your picture' }), h('span.grow'),
          h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('x'))),
        h('div.pfs__top', preview, h('div.pfs__toptext',
          h('small', { text: 'Saved on this device only. An uploaded picture is cropped to a square and saved small (256 × 256) — the original file isn’t kept.' }))),
        tabsEl, pane, errEl, fileIn,
        h('div.pfs__foot',
          saved.picture ? h('button.btn.btn--ghost.btn--sm', { type: 'button', dataset: { act: 'remove-picture' }, onclick: () => { saveProf({ picture: null }); say('Picture removed.'); closeSheet(); } }, icon('trash'), h('span', { text: 'Use my initial' })) : null,
          h('span.grow'),
          h('button.btn.btn--sm', { type: 'button', onclick: closeSheet }, 'Cancel'),
          saveBtn));
      const el = h('div.pfs', { onclick: e => { if (e.target === el) closeSheet(); } }, card);
      appEl.append(el);
      sheet = { el, cleanup: null };
      /* Esc closes it wherever focus is (a file picker leaves it on the page) —
         but only while this window is the one in front */
      const onEsc = e => {
        if (e.key !== 'Escape' || !sheet || sheet.el !== el) return;
        if (!ctx.win.el?.classList.contains('is-active') && !el.contains(document.activeElement)) return;
        e.preventDefault(); e.stopPropagation(); closeSheet();
      };
      window.addEventListener('keydown', onEsc, true);

      const setErr = t => { st.err = t || ''; errEl.textContent = st.err; };
      function paintPreview() {
        clear(preview);
        const pic = st.tab === 'upload' && st.crop ? null : st.choice;
        if (st.tab === 'upload' && st.crop) {
          preview.append(h('span.av.pfs__cropmini', { style: { '--av': '72px' } }, h('span.av__pic', st.crop.mini)));
        } else {
          preview.append(Avatar.avatarEl(h, { picture: pic, initial: initial(), size: 72 }));
        }
      }
      function paintTabs() {
        clear(tabsEl);
        for (const [id, label, ic] of [['builtin', 'Built-in', 'user'], ['upload', 'Upload', 'upload']]) {
          tabsEl.append(h('button.tab', {
            type: 'button', role: 'tab', 'aria-selected': st.tab === id ? 'true' : 'false', class: st.tab === id ? 'is-on' : '',
            dataset: { tab: id }, onclick: () => { st.tab = id; setErr(''); paintTabs(); paintPane(); paintPreview(); },
          }, icon(ic), h('span', { text: label })));
        }
      }
      function paintPane() {
        clear(pane);
        if (st.tab === 'builtin') {
          pane.append(h('div.pfs__grid', { role: 'radiogroup', 'aria-label': 'Built-in avatars' },
            Avatar.BUILTIN.map(b => {
              const on = st.choice?.kind === 'builtin' && st.choice.id === b.id;
              return h('button.pfs__pick', {
                type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: on ? 'is-on' : '', dataset: { avatar: b.id },
                onclick: () => { st.choice = { kind: 'builtin', id: b.id }; paintPane(); paintPreview(); pane.querySelector(`[data-avatar="${b.id}"]`)?.focus(); },
              }, Avatar.avatarEl(h, { picture: { kind: 'builtin', id: b.id }, costume: 'none', size: 56 }), h('span', { text: b.name }));
            })));
          saveBtn.disabled = !(st.choice && st.choice.kind === 'builtin');
          return;
        }
        if (!st.crop) {
          pane.append(h('div.pfs__drop', {
            ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('is-over'); },
            ondragleave: e => e.currentTarget.classList.remove('is-over'),
            ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); },
          },
            icon('image'),
            h('b', { text: 'Choose an image' }),
            h('small', { text: 'PNG, JPEG, WebP or GIF — or drop one here. You’ll crop it to a square next.' }),
            h('button.btn.btn--sm', { type: 'button', dataset: { act: 'choose-file' }, onclick: () => fileIn.click() }, icon('upload'), h('span', { text: 'Choose file…' }))));
          saveBtn.disabled = true;
          return;
        }
        pane.append(cropView());
        saveBtn.disabled = false;
      }

      async function loadFile(f) {
        setErr('');
        if (!IMAGE_TYPES.includes(f.type)) { setErr('That isn’t a PNG, JPEG, WebP or GIF image.'); return; }
        if (f.size > MAX_FILE) { setErr(`That image is ${(f.size / 1048576).toFixed(1)} MB; pictures up to ${MAX_FILE / 1048576} MB can be used.`); return; }
        let img;
        try { img = await decode(f); } catch (e) { if (!sheet) return; setErr('This browser couldn’t read that image.'); return; }
        if (!sheet || dead) return;
        const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
        if (!iw || !ih) { setErr('That image has no size to crop.'); return; }
        st.crop = { img, iw, ih, z: 1, cx: iw / 2, cy: ih / 2, mini: null };
        st.tab = 'upload';
        paintTabs();
        paintPane();
      }
      function decode(f) {
        if (typeof createImageBitmap === 'function') return createImageBitmap(f);
        return new Promise((res, rej) => {
          const url = URL.createObjectURL(f);
          const im = new Image();
          im.onload = () => { URL.revokeObjectURL(url); res(im); };
          im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
          im.src = url;
        });
      }

      /* the square of the image that is in view: centre (cx, cy), side `side` */
      function view(c) {
        const s0 = Math.max(CROP / c.iw, CROP / c.ih);
        const side = CROP / (s0 * c.z);
        const half = side / 2;
        c.cx = Math.min(Math.max(c.cx, half), c.iw - half);
        c.cy = Math.min(Math.max(c.cy, half), c.ih - half);
        return { sx: c.cx - half, sy: c.cy - half, side, scale: s0 * c.z };
      }
      function cropView() {
        const c = st.crop;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cv = h('canvas.pfs__canvas', { width: String(CROP * dpr), height: String(CROP * dpr), 'aria-hidden': 'true' });
        const g = cv.getContext('2d');
        const mini = h('canvas', { width: '72', height: '72' });
        c.mini = mini;
        const draw = () => {
          const v = view(c);
          g.clearRect(0, 0, cv.width, cv.height);
          g.drawImage(c.img, v.sx, v.sy, v.side, v.side, 0, 0, cv.width, cv.height);
          const m = mini.getContext('2d');
          m.clearRect(0, 0, 72, 72);
          m.drawImage(c.img, v.sx, v.sy, v.side, v.side, 0, 0, 72, 72);
        };
        const zoom = h('input.pfs__zoom', { type: 'range', min: '1', max: '4', step: '0.01', value: String(c.z), 'aria-label': 'Zoom', dataset: { act: 'zoom' },
          oninput: e => { c.z = Number(e.target.value) || 1; draw(); } });
        let drag = null;
        const box = h('div.pfs__crop', {
          tabindex: '0', role: 'application', 'aria-label': 'Crop area. Drag, or use the arrow keys, to move the picture; plus and minus zoom.',
          onpointerdown: e => { drag = { x: e.clientX, y: e.clientY, cx: c.cx, cy: c.cy }; box.setPointerCapture?.(e.pointerId); },
          onpointermove: e => {
            if (!drag) return;
            const s = view(c).scale;
            c.cx = drag.cx - (e.clientX - drag.x) / s;
            c.cy = drag.cy - (e.clientY - drag.y) / s;
            draw();
          },
          onpointerup: () => { drag = null; },
          onpointercancel: () => { drag = null; },
          onkeydown: e => {
            const s = view(c).scale;
            const step = (e.shiftKey ? 40 : 10) / s;
            const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (k) { e.preventDefault(); c.cx += k[0]; c.cy += k[1]; draw(); return; }
            if (e.key === '+' || e.key === '=' || e.key === '-') {
              e.preventDefault();
              c.z = Math.min(4, Math.max(1, c.z + (e.key === '-' ? -0.1 : 0.1)));
              zoom.value = String(c.z);
              draw();
            }
          },
          onwheel: e => { e.preventDefault(); c.z = Math.min(4, Math.max(1, c.z * (e.deltaY < 0 ? 1.06 : 1 / 1.06))); zoom.value = String(c.z); draw(); },
        }, cv, h('span.pfs__ring', { 'aria-hidden': 'true' }));
        draw();
        requestAnimationFrame(() => paintPreview());
        return h('div.pfs__cropwrap', box,
          h('div.pfs__cropctl',
            h('label.pfs__zoomrow', icon('search'), zoom),
            h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => fileIn.click() }, icon('image'), h('span', { text: 'Another image…' }))));
      }

      /** The cropped square at 256×256, as small as it can be while still looking right. */
      function exportCrop() {
        const c = st.crop;
        const v = view(c);
        const out = document.createElement('canvas');
        out.width = OUT; out.height = OUT;
        const g = out.getContext('2d');
        g.fillStyle = '#16121c';           /* transparent PNGs get a dark backing, not black JPEG fill */
        g.fillRect(0, 0, OUT, OUT);
        g.imageSmoothingQuality = 'high';
        g.drawImage(c.img, v.sx, v.sy, v.side, v.side, 0, 0, OUT, OUT);
        for (const q of [0.86, 0.75, 0.6, 0.45]) {
          let url = out.toDataURL('image/webp', q);
          if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/jpeg', q);
          if (url.length <= Avatar.MAX_UPLOAD_CHARS) return url;
        }
        return null;
      }

      function commit() {
        setErr('');
        if (st.tab === 'upload') {
          if (!st.crop) { setErr('Choose an image first.'); return; }
          const url = exportCrop();
          if (!url || !Avatar.normPicture({ kind: 'upload', dataUrl: url })) { setErr('That picture couldn’t be saved small enough. Try a different image.'); return; }
          saveProf({ picture: { kind: 'upload', dataUrl: url } });
          say('Picture saved.');
        } else {
          const p = Avatar.normPicture(st.choice);
          if (!p) { setErr('Pick an avatar first.'); return; }
          saveProf({ picture: p });
          say(`Picture set to the ${Avatar.BUILTIN.find(b => b.id === p.id).name.toLowerCase()}.`);
        }
        closeSheet();
      }

      sheet.cleanup = () => {
        window.removeEventListener('keydown', onEsc, true);
        const im = st.crop?.img;
        if (im && typeof im.close === 'function') im.close();
      };
      paintTabs();
      paintPane();
      paintPreview();
      requestAnimationFrame(() => (tabsEl.querySelector('.is-on') || card).focus({ preventScroll: true }));
    }

    paint();
    const offs = [bus.on('projects:change', paint), bus.on('achievement:unlock', paint), store.sub('session.user', paint),
      store.sub('portal.collections', paint), bus.on('game:launch', paint), store.sub(KEY, paint), store.sub('portal.identity', paint)];
    return () => { dead = true; closeSheet(); offs.forEach(f => f?.()); };
  },
});
