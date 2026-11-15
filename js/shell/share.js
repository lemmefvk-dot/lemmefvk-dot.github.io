/* ============================================================
   share.js — the StaticOS share sheet, and links into StaticOS.

   Any app shares something with
       bus.emit('share:open', item)
   item = { kind: 'web'|'arcade'|'creation'|'image'|'collection'|
                  'profile'|'anime'|'roblox'|'file', id, title,
            art?, path?, text? }
   and one native sheet appears with what can really be done with
   it: Copy Link (only for things anyone can open — a catalogue or
   Arcade game), Copy share link (your creations: the whole game
   travels inside the link, core/sharelink.js), Share to Chat
   (Static Social), Copy, Desktop Shortcut, Add to Library. Things
   that only exist on this device (images, collections) say so
   instead of handing out a link that would not work for anyone else.

   Links: https://<site>/#game=<id> · #arcade=<id> · #app=<id>
          · #arcade=<id>&room=<CODE> (an Arcade online-room invite)
          · #arcade=<id>&seed=<s>&beat=<score>&by=<name> (an Arcade "Beat this" round)
          · #party=<CODE> (Static Party opens with the code filled in; the person presses Join)
          · #drop=<CODE> · #watch=<CODE> · #draw=<CODE> · #quiz=<CODE> · #note=<CODE> · #board=<CODE> · #map=<CODE> (Static
            Drop, Watch Together, Draw Together, live Quiz, Write Together, shared Board and shared mind map invites: the app
            opens with the code filled in, and nothing happens until the person presses Join)
          · #friend=<CODE> (a friend code: Social › Friends opens with it filled in)
          · #jumper=<a Pixel Jumper level, packed and checked: preview first, then Play>
          · #creation=<the game itself> · #project=<a web project from Code>
          · #event=<a Calendar event> · #tasklist=<a copy of a Static Tasks list>
          · #deck=<a copy of a Static Study flashcard deck>
            (packed by core/sharelink.js packLink; the app shows it, Add adds it).
          · #graph=<a Static Graph: its functions, sliders and view>
            (packed by core/sharelink.js packLink; the app shows it, Add/Open takes it).
   A #project= link opens Code on a read-only review (core/codeshare.js):
   the files can be read, and nothing runs until Run is pressed.
   openDeepLink() runs after boot and whenever the address's # part
   changes; every id is checked against the catalogue / Arcade / app
   registry, so a link can only ever open something StaticOS already
   has — never an arbitrary URL. A #creation= link opens the Shared
   Game preview, which runs nothing until Play is pressed.
   ============================================================ */
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { bus } from '../core/bus.js';
import { covered } from '../core/cover.js';
import * as L from '../core/layers.js';
import { t } from '../core/i18n.js';

const LINKABLE = new Set(['web', 'arcade', 'app']);

export function linkFor(item) {
  const base = `${location.origin}${location.pathname}`;
  if (!item) return null;
  if (item.kind === 'web') return `${base}#game=${encodeURIComponent(item.id)}`;
  if (item.kind === 'arcade') return `${base}#arcade=${encodeURIComponent(item.id)}`;
  if (item.kind === 'app') return `${base}#app=${encodeURIComponent(item.id)}`;
  return null;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}

/* the name you gave yourself (Profile / Social), else your account's — never the
   generated Player-xxxx, which would mean nothing to whoever opens the link */
function creatorName() {
  const v = api.store.get('portal.identity', null);
  const u = api.store.get('session.user', null);
  const n = (v && typeof v.name === 'string' && v.name.trim()) || (u && (u.name || u.username)) || '';
  return String(n).trim().slice(0, 40) || null;
}

export function mountShare(host) {
  const { h, icon } = api;
  let sheet = null;
  let lastFocus = null;
  let release = null;     /* one Escape layer (core/layers.js): closes this sheet, not what is under it */

  function close() {
    if (!sheet) return;
    const el = sheet; sheet = null;
    release?.({ restoreFocus: false });
    release = null;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 180);
    try { lastFocus?.focus?.({ preventScroll: true }); } catch (e) {}
  }

  function open(item) {
    if (!item || !item.title) return;
    close();
    lastFocus = document.activeElement;
    const link = LINKABLE.has(item.kind) ? linkFor(item) : null;
    const note = h('div.share__note', { role: 'status', 'aria-live': 'polite' });
    const done = (text, ic = 'check') => { note.replaceChildren(icon(ic), h('span', { text })); };
    const act = (ic, label, run, sub) => h('button.share__act', { type: 'button', onclick: run },
      h('span.share__ic', icon(ic)), h('span.share__lbl', h('b', { text: label }), sub ? h('small', { text: sub }) : null));

    const localOnly = ['image', 'collection', 'profile', 'file'].includes(item.kind);
    const gameLike = ['web', 'arcade', 'creation'].includes(item.kind);
    /* a web project from Code: its files travel inside the link (core/codeshare.js) */
    async function projectLink(btn) {
      btn.disabled = true;
      done(t('Packing the project into a link…'), 'sparkles');
      try {
        const C = await import('../core/codeshare.js');
        const r = await C.encodeProject({ name: item.title, files: item.files || [], creator: creatorName() });
        if (!sheet) return;
        if (!r.ok) { linkBox.hidden = true; done(r.error, 'alert'); return; }
        const field = h('input.share__linkin', { type: 'text', readonly: true, value: r.link, 'aria-label': t('Share link'), onfocus: e => e.target.select() });
        linkBox.replaceChildren(field,
          h('button.btn.btn--sm', { type: 'button', onclick: async () => done(await copy(r.link) ? 'Copied again.' : t('Select the link and copy it.')) }, icon('copy'), h('span', { text: t('Copy') })));
        linkBox.hidden = false;
        const size = `${(r.chars / 1024).toFixed(1)} KB link, ${r.count} file${r.count === 1 ? '' : 's'}`;
        const left = r.skipped.length ? ` Left out (not web text files): ${r.skipped.slice(0, 4).join(', ')}${r.skipped.length > 4 ? '…' : ''}.` : '';
        done((await copy(r.link)
          ? t('Link copied ({size}). Whoever opens it in StaticOS reads the code first and chooses whether to run it.', { size })
          : t('Here’s the link ({size}) — select it and copy it.', { size })) + left);
      } catch (e) {
        done(`The link couldn’t be made (${e?.message || e}).`, 'alert');
      } finally { btn.disabled = false; }
    }
    const libraryable = ['web', 'arcade', 'creation', 'anime', 'roblox'].includes(item.kind);
    const linkBox = h('div.share__linkbox', { hidden: true });
    /* a QR code of a creation's link, drawn with Static QR's own encoder (apps/qr.js).
       A code holds about 2.9 KB, so most games' links are too long: then it says so
       instead of drawing something that would not scan. */
    const qrBox = h('div.share__qr', { hidden: true });
    async function showQr(link) {
      try {
        const Q = await import('../apps/qr.js');
        const q = Q.encodeQR(link, { level: 'L' });
        if (!sheet) return;
        if (!q.ok) {
          qrBox.replaceChildren(icon('info'), h('p.share__hint', { text: `No QR code for this game: its link is ${link.length.toLocaleString()} characters and a code holds at most ${q.max.toLocaleString()}. Copy the link, or export the game as a file.` }));
          qrBox.hidden = false;
          return;
        }
        const px = 220;
        const cv = h('canvas.share__qrcv', { width: px, height: px, role: 'img', 'aria-label': t('QR code for the share link of {title}', { title: item.title }) });
        Q.drawCode(cv.getContext('2d'), q, px, 4, '#000000', '#ffffff');
        qrBox.replaceChildren(cv, h('div.share__qrtxt',
          h('p.share__hint', { text: t('Scan it with a phone camera to open this game’s preview in StaticOS ({size}×{size2} modules). It is the same link as above.', { size: q.size, size2: q.size }) }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => {
            const a = h('a', { href: cv.toDataURL('image/png'), download: `${String(item.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game'}-qr.png` });
            document.body.appendChild(a); a.click(); a.remove();
          } }, icon('download'), h('span', { text: t('Save PNG') }))));
        qrBox.hidden = false;
      } catch (e) { qrBox.hidden = true; }
    }

    /* a creation's link carries the game itself; it is made on request */
    async function creationLink(btn) {
      btn.disabled = true;
      qrBox.hidden = true;
      done(t('Packing the game into a link…'), 'sparkles');
      try {
        const [P, L] = await Promise.all([import('../core/projects.js'), import('../core/sharelink.js')]);
        const p = await P.get(item.id);
        if (!sheet) return;
        if (!p) { done(t('This creation isn’t on this device any more.'), 'alert'); return; }
        const r = await L.encode({
          name: p.published?.title || p.name, html: P.current(p), prompt: p.prompt,
          creator: (p.creator && p.creator !== 'you') ? p.creator : creatorName(),
          note: p.versions?.[p.head]?.note, controls: p.published?.controls || ((api.store.get('portal.forge.info', null) || {})[p.id] || {}).controls,
        });
        if (!sheet) return;
        if (!r.ok) { linkBox.hidden = true; done(r.error, 'alert'); return; }
        const field = h('input.share__linkin', { type: 'text', readonly: true, value: r.link, 'aria-label': t('Share link'), onfocus: e => e.target.select() });
        linkBox.replaceChildren(field,
          h('button.btn.btn--sm', { type: 'button', onclick: async () => done(await copy(r.link) ? 'Copied again.' : t('Select the link and copy it.')) }, icon('copy'), h('span', { text: t('Copy') })));
        linkBox.hidden = false;
        showQr(r.link);
        const size = `${(r.chars / 1024).toFixed(1)} KB link`;
        done(await copy(r.link)
          ? t('Link copied ({size}). Whoever opens it in StaticOS sees a safe preview first and chooses whether to play or save it.', { size })
          : t('Here’s the link ({size}) — select it and copy it.', { size }));
      } catch (e) {
        done(`The link couldn’t be made (${e?.message || e}).`, 'alert');
      } finally { btn.disabled = false; }
    }

    const acts = [
      link ? act('link', t('Copy link'), async () => done(await copy(link) ? 'Link copied — anyone with StaticOS opens it straight away.' : t('Copy this link: {link}', { link })), t('Opens it in StaticOS for anyone')) : null,
      item.kind === 'creation' ? act('link', 'Copy share link', e => creationLink(e.currentTarget), 'The whole game, inside a link') : null,
      item.kind === 'project' ? act('link', 'Copy share link', e => projectLink(e.currentTarget), 'The project’s files, inside a link') : null,
      api.getApp('social') && item.kind !== 'project' ? act('message-circle', 'Share to chat', () => {
        api.openApp('social', { share: { kind: item.kind, id: item.id, title: item.title, link } });
        close();
      }, t('Post it in Static Social')) : null,
      act('copy', t('Copy'), async () => {
        const text = link ? `${item.title} — ${link}` : (item.text || item.title);
        done(await copy(text) ? 'Copied.' : t('The clipboard isn’t available here.'));
      }, link ? 'Title and link' : t('The title')),
      gameLike ? act('monitor', t('Desktop shortcut'), async () => {
        const { addToDesktop } = await import('../core/shortcuts.js');
        addToDesktop({ kind: item.kind, id: item.id, title: item.title, art: item.art || null });
        close();
      }, t('Pin it to the desktop')) : null,
      libraryable ? act('bookmark', t('Add to Library'), async e => {
        const C = await import('../core/collections.js');
        const r = e.currentTarget.getBoundingClientRect();
        C.pickMenu(api, { kind: item.kind, id: item.id, title: item.title, art: item.art || null }, r.left, r.bottom + 4);
      }, t('Save it to a collection')) : null,
    ].filter(Boolean);

    sheet = h('div.share', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Share {title}', { title: item.title }), tabindex: '-1',
      onclick: e => { if (e.target === sheet) close(); } },
      h('div.share__card',
        h('div.share__head',
          item.art ? h('img.share__art', { src: item.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('div.share__art.share__art--ic', icon('share')),
          h('div.share__who', h('small', { text: t('Share') }), h('b', { text: item.title })),
          h('button.ibtn', { type: 'button', 'aria-label': t('Close'), onclick: close }, icon('x'))),
        h('div.share__acts', acts),
        linkBox,
        qrBox,
        localOnly ? h('p.share__hint', { text: t('This lives on this device, so there’s no link that would open it for someone else. To pass a game on, export it from Static Forge and send the file.') }) : null,
        item.kind === 'project' ? h('p.share__hint', { text: t('Only HTML, CSS, JavaScript, JSON, text, Markdown and SVG files go in a link (at most 40 files, 1 MB, and about 64 KB once packed). There is no server: the link is the project. Whoever opens it reads the code first and nothing runs until they press Run.') }) : null,
        item.kind === 'creation' ? h('p.share__hint', { text: t('A share link carries the whole game inside it — no server is involved. Very big games don’t fit in a link; export those from Static Forge as an .html file.') }) : null,
        note));
    host.appendChild(sheet);
    release = L.push({ name: 'share', el: sheet, trap: true, close });
    requestAnimationFrame(() => { sheet?.classList.add('is-in'); sheet?.querySelector('.share__act')?.focus({ preventScroll: true }); });
  }

  const offs = [
    bus.on('share:open', open),
    api.on(window, 'keydown', e => { if (e.key === 'Escape' && sheet) { e.stopPropagation(); close(); } }, true),
    /* a link pasted into the address bar of an open StaticOS only changes the # part */
    api.on(window, 'hashchange', () => { openDeepLink(); }),
  ];
  return () => { offs.forEach(f => f?.()); close(); };
}

/** Open whatever a #game= / #arcade= / #app= link points at — once, after boot. */
let waitingForCover = 0;
export async function openDeepLink() {
  const hash = String(location.hash || '').replace(/^#/, '');
  if (!hash) return false;
  /* behind the lock screen or boot menu: open it once they're gone, rather
     than dropping a link (a shared game lives only in the link) */
  if (covered()) {
    if (!waitingForCover) {
      const until = Date.now() + 30 * 60 * 1000;
      waitingForCover = setInterval(() => {
        if (covered() && Date.now() < until) return;
        clearInterval(waitingForCover);
        waitingForCover = 0;
        if (!covered()) openDeepLink();
      }, 500);
    }
    return false;
  }
  const params = new URLSearchParams(hash);
  const clear = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} };
  try {
    if (params.has('creation')) {
      /* the game travels in the link; the preview reads it and runs nothing */
      const link = params.get('creation');
      clear();
      if (!api.getApp('shared')) return false;
      api.openApp('shared', { link });
      return true;
    }
    if (params.has('project')) {
      /* a web project from Code: opens a read-only review; nothing runs until Run is pressed */
      const link = params.get('project');
      clear();
      if (!api.getApp('code')) return false;
      api.openApp('code', { shared: link });
      return true;
    }
    /* a Calendar event (#event=), a Static Tasks list (#tasklist=), a flashcard deck (#deck=) or a
       Static Graph (#graph=) sent by a friend: the app shows what is in it, and takes it only when
       the person presses Add or Open */
    for (const [key, app] of [['event', 'calendar'], ['tasklist', 'tasks'], ['deck', 'study'], ['graph', 'graph']]) {
      if (!params.has(key)) continue;
      const frag = params.get(key);
      clear();
      if (!api.getApp(app)) return false;
      api.openApp(app, { shared: frag });
      return true;
    }
    if (params.has('jumper')) {
      /* a Pixel Jumper level in the link: read strictly (arcade/jumper-share.js), shown as a preview
         with who the link says made it; nothing starts until the person presses Play */
      const frag = params.get('jumper');
      clear();
      const J = await import('../arcade/jumper-share.js');
      const r = await J.decodeLevel(frag);
      if (!r.ok) { api.notify({ app: t('Static Arcade'), icon: 'alert', title: t('That level link wasn’t opened'), message: r.error }); return false; }
      if (!api.getApp('arcade')) return false;
      J.offer(r.level);
      api.openApp('arcade', { game: 'jumper' });
      return true;
    }
    if (params.has('game')) {
      const id = params.get('game');
      const G = await import('../portal/games.data.js');
      await G.load().catch(() => {});
      if (!G.byId(id)) { api.notify({ app: 'StaticOS', icon: 'alert', title: t('That game link doesn’t match a game here'), message: String(id).slice(0, 60) }); clear(); return false; }
      api.openApp('aether-games', { url: `static://games/${id}` });
      clear(); return true;
    }
    if (params.has('arcade')) {
      const id = params.get('arcade');
      const { arcadeById } = await import('../arcade/index.js');
      if (!arcadeById(id) || !api.getApp('arcade')) { clear(); return false; }
      /* an online invite (#arcade=<id>&room=<CODE>) knocks on that room; the
         room itself says which game it plays, and nothing starts until the host does */
      const room = String(params.get('room') || '').toUpperCase();
      const spec = String(params.get('spectate') || '').toUpperCase();
      if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(spec)) api.openApp('arcade', { spectate: spec });   /* a watch link: the code is filled in, nothing starts */
      else if (/^[A-Z0-9]{6}$/.test(room) && arcadeById(id).online) api.openApp('arcade', { join: room });
      /* a Beat-this link (#arcade=<id>&seed=…&beat=<score>&by=…): the same round, behind a card; nothing starts until Play */
      else if (params.has('seed') && params.has('beat')) api.openApp('arcade', { game: arcadeById(id).id, beat: { seed: params.get('seed'), score: params.get('beat'), by: params.get('by') || '', mode: params.get('mode') || '' } });
      else api.openApp('arcade', { game: arcadeById(id).id });
      clear(); return true;
    }
    /* a with-a-friend invite: Static Drop (#drop=), Watch Together (#watch=),
       Draw Together in Paint (#draw=), a live quiz in Static Study (#quiz=). The app opens with the code filled in
       and the person presses Join / Receive themselves — a link never joins,
       receives or plays anything on its own. */
    for (const [key, app, opt] of [['drop', 'drop', 'join'], ['watch', 'watch-together', 'join'], ['draw', 'paint', 'together'], ['quiz', 'study', 'quizJoin'], ['list', 'music', 'joinList'], ['note', 'notes', 'coop'], ['board', 'board', 'boardJoin'], ['map', 'mindmap', 'mapJoin'], ['chat', 'chat', 'join'], ['party', 'party', 'prefill']]) {
      if (!params.has(key)) continue;
      const code = String(params.get(key) || '').toUpperCase();
      clear();
      if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code) || !api.getApp(app)) return false;
      api.openApp(app, { [opt]: code });
      return true;
    }
    /* a friend invite (#friend=<CODE>): Social's Friends opens with the code
       filled in — the request goes only when the person presses Send */
    if (params.has('friend')) {
      const code = String(params.get('friend') || '').toUpperCase();
      clear();
      if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code) || !api.getApp('social')) return false;
      api.openApp('social', { friend: code });
      return true;
    }
    if (params.has('app')) {
      const id = params.get('app');
      const app = api.getApp(id);
      if (!app || app.hidden) { clear(); return false; }
      api.openApp(id, {});
      clear(); return true;
    }
  } catch (e) { /* a bad link just does nothing */ }
  return false;
}

export default { mountShare, openDeepLink, linkFor };
