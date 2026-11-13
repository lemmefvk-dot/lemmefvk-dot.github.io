/* ============================================================
   shared.js — Shared Game: what a #creation= share link opens.

   Someone made a game in Static Forge (or Studio) and sent a link
   that carries the whole game (core/sharelink.js). This window is
   the safe front door for it:

   · Opening the link runs NOTHING. The window reads the link, then
     shows the game's name, who the link says made it (names in a
     link are not checked, and the window says so), its size, any
     web addresses its code mentions, and the code itself on request.
   · Play runs it in core/sandbox.js's sealed frame — an opaque
     origin with scripts only: no access to StaticOS, its storage,
     cookies, files or other windows, no popups, no navigation.
   · Save to my creations makes it an ordinary project
     (core/projects.js), so it opens in Forge and Studio like any
     other game. Saving the same game twice is noticed and skipped.

   opts: { link }  the #creation= value (or a whole link)
   Hidden from the launcher: it only makes sense with a link.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as Sandbox from '../core/sandbox.js';
import * as Projects from '../core/projects.js';
import * as ShareLink from '../core/sharelink.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-forge-css')) {
  const l = document.createElement('link');
  l.id = 'feat-forge-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-forge.css';
  document.head.appendChild(l);
}

const kb = n => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

defineApp({
  id: 'shared',
  name: 'Shared Game',
  icon: 'link',
  g1: '#ffb35c', g2: '#d62f6c',
  category: 'Create',
  keywords: ['share link', 'shared game', 'creation link'],
  desc: 'Preview, play and save a game someone shared with a link',
  hidden: true,
  win: { w: 820, h: 620, minW: 380, minH: 420 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, notify } = api;
    const S = { dead: false, creation: null, hosts: [], runner: null, savedId: null, code: false, seq: 0 };
    const body = h('div.shg__body');
    const live = h('div.sr', { role: 'status', 'aria-live': 'polite' });
    root.appendChild(h('div.app.app--col.fg.shg', body, live));
    let sayT = 0;
    const say = t => { live.textContent = ''; clearTimeout(sayT); sayT = setTimeout(() => { if (!S.dead) live.textContent = t; }, 40); };

    /* the parts of a loaded game's page; the stage is never rebuilt while a
       game runs in it (moving an iframe reloads it) */
    let stageEl = null, actsEl = null, codeEl = null;

    function stop() {
      if (S.runner) { S.runner.stop(); S.runner = null; }
    }

    function showMessage(ic, title, text, extra) {
      stop();
      stageEl = actsEl = codeEl = null;
      clear(body);
      body.append(h('div.empty.shg__msg', ic === 'spinner' ? h('div.spinner') : icon(ic), title ? h('b', { text: title }) : null, h('small', { text }), extra || null));
    }

    async function load(link) {
      const seq = ++S.seq;
      stop();
      Object.assign(S, { creation: null, hosts: [], savedId: null, code: false });
      if (!link) {
        showMessage('link', 'No shared game here', 'When someone sends you a StaticOS share link, the game it carries opens here — safely, without running until you press Play.');
        return;
      }
      showMessage('spinner', '', 'Reading the link…');
      let r;
      try { r = await ShareLink.decode(link); }
      catch (e) { r = { ok: false, error: `The link couldn’t be read (${e.message || e}).` }; }
      if (S.dead || seq !== S.seq) return;
      if (!r.ok) {
        win.setSubtitle?.('');
        showMessage('alert', 'This share link can’t be opened', r.error,
          api.getApp('forge') ? h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('forge') }, icon('sparkles'), h('span', { text: 'Open Static Forge' })) : null);
        say(r.error);
        return;
      }
      S.creation = r.creation;
      S.hosts = ShareLink.externalHosts(r.creation.html);
      S.savedId = await savedCopy(r.creation.html);
      if (S.dead || seq !== S.seq) return;
      win.setSubtitle?.(`— ${S.creation.name}`);
      build();
      say(`${S.creation.name} is ready. Nothing has run yet.`);
    }

    /** The id of a project that already holds exactly this game, or null. */
    async function savedCopy(html) {
      try {
        const same = (await Projects.list()).find(p => Projects.current(p) === html);
        return same ? same.id : null;
      } catch (e) { return null; }
    }

    function build() {
      const c = S.creation;
      clear(body);
      const lines = c.html.split('\n').length;
      const facts = [
        ['Made by', c.creator ? `${c.creator} — as written in the link; names aren’t checked` : 'The link doesn’t say'],
        c.at ? ['Shared', new Date(c.at).toLocaleString()] : null,
        ['Size', `${lines.toLocaleString()} line${lines === 1 ? '' : 's'} · ${kb(c.bytes)} (the link was ${kb(c.chars)})`],
        ['Internet', S.hosts.length ? `Its code mentions ${S.hosts.join(', ')} — it may load things from there when it runs.` : 'Its code mentions no web addresses.'],
      ].filter(Boolean);
      stageEl = h('div.shg__stage');
      actsEl = h('div.shg__acts');
      codeEl = h('div.shg__codewrap');
      body.append(
        h('header.shg__head',
          h('span.shg__mark', icon('sparkles')),
          h('div.shg__who',
            h('span.fg-label', { text: 'Shared game' }),
            h('h2.fg-h1.shg__title', { text: c.name }),
            c.prompt ? h('p.shg__prompt', { text: `“${c.prompt}”` }) : null)),
        stageEl,
        actsEl,
        h('dl.fg-facts.shg__facts', facts.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
        codeEl,
        h('p.fg-fine', { text: 'A share link carries the whole game inside the link itself — there is no StaticOS server, and the part after # never leaves your browser. Saving puts a copy in your creations on this device, where it opens in Static Forge and Studio like a game you made.' }));
      paintStage();
      paintActs();
      paintCode();
    }

    function paintStage() {
      if (!stageEl || S.runner) return;
      clear(stageEl);
      stageEl.classList.remove('is-playing');
      stageEl.append(h('div.shg__idle',
        h('span.shg__idleic', icon('shield')),
        h('b', { text: 'Nothing has run yet' }),
        h('small', { text: 'Play runs this game in a sealed box: it can’t see your files, your saved data or the rest of StaticOS.' }),
        h('button.btn.btn--primary', { type: 'button', dataset: { act: 'play' }, onclick: play }, icon('play'), h('span', { text: 'Play' }))));
    }

    function paintActs() {
      if (!actsEl) return;
      clear(actsEl);
      const b = (ic, text, act, fn, cls = '') => h(`button.btn${cls}`, { type: 'button', dataset: { act }, onclick: fn }, icon(ic), h('span', { text }));
      if (S.runner) {
        actsEl.append(
          b('x', 'Stop', 'stop', () => { stop(); paintStage(); paintActs(); say('Stopped.'); }),
          b('refresh', 'Restart', 'restart', () => { S.runner?.reload(S.creation.html); setTimeout(() => S.runner?.focus(), 120); }));
      }
      actsEl.append(S.savedId
        ? b('check', 'In your creations · Open in Forge', 'open-saved', () => api.openApp('forge', { project: S.savedId }))
        : b('download', 'Save to my creations', 'save', save));
      const code = b('code', S.code ? 'Hide code' : 'View code', 'code', () => { S.code = !S.code; paintActs(); paintCode(); }, '.btn--ghost');
      code.setAttribute('aria-pressed', S.code ? 'true' : 'false');
      actsEl.append(code);
    }

    function paintCode() {
      if (!codeEl) return;
      clear(codeEl);
      if (!S.code) return;
      const ta = h('textarea.shg__code', { readonly: true, spellcheck: 'false', rows: '14', 'aria-label': 'The game’s code (read only)' });
      ta.value = S.creation.html;
      codeEl.append(ta);
    }

    function play() {
      const c = S.creation;
      if (!c || S.dead || !stageEl) return;
      stop();
      clear(stageEl);
      stageEl.classList.add('is-playing');
      S.runner = Sandbox.run(stageEl, c.html, { title: c.name, onReady: () => S.runner?.focus() });
      S.runner.frame.classList.add('fg-frame', 'shg__frame');
      paintActs();
      setTimeout(() => S.runner?.focus(), 80);
      say(`Playing ${c.name}.`);
    }

    async function save() {
      const c = S.creation;
      if (!c || S.savedId) return;
      try {
        const already = await savedCopy(c.html);
        if (S.dead) return;
        if (already) { S.savedId = already; paintActs(); say('Already in your creations.'); return; }
        /* the maker stays the one the link names (unchecked), so sharing it on
           credits them, and it is an import — not something you made here */
        const p = await Projects.create({
          name: c.name, prompt: c.prompt || '', html: c.html, source: 'forge', by: 'you', event: 'import',
          creator: c.creator || 'unknown (from a share link)',
          note: c.creator ? `Saved from a share link (made by ${c.creator})` : 'Saved from a share link',
        });
        if (S.dead) return;
        S.savedId = p.id;
        paintActs();
        notify({
          app: 'Shared Game', icon: 'download', timeout: 6000, title: `Saved “${c.name}”`,
          message: 'It’s in your creations on this device.',
          actions: api.getApp('forge') ? [{ label: 'Open in Forge', onClick: () => api.openApp('forge', { project: p.id }) }] : undefined,
        });
        say(`Saved ${c.name} to your creations.`);
      } catch (e) {
        if (S.dead) return;
        notify({ app: 'Shared Game', icon: 'alert', title: 'Couldn’t save the game', message: String(e?.message || e) });
      }
    }

    win.onReopen?.(o => { if (o && o.link) load(o.link); });
    load(opts && opts.link);

    return () => {
      S.dead = true;
      clearTimeout(sayT);
      stop();
    };
  },
});
