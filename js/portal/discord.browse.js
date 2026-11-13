/* ============================================================
   discord.browse.js — the server browser.

   Discord does NOT expose a public directory to a browser:
     /api/v10/discoverable-guilds   -> 401 (needs a token)
     /api/v9/discovery/search       -> 404
     top.gg, disboard               -> 403, and no CORS headers
   What IS public and CORS-enabled is invite resolution, so the
   browser is built on that: paste or pick any invite and Discord
   itself supplies the name, icon, banner, description and the
   live member / online counts. Nothing here is hardcoded except
   the invite codes in STARTERS — every word on screen comes back
   from the API at render time.
   ============================================================ */
import * as DC from './discord.js';

const KEY = 'portal.discord.servers';

/* Invite codes only. Names, art and counts are fetched live. */
const STARTERS = [
  'discord-developers', 'discord-api', 'python', 'reactiflux',
  'rust-lang', 'minecraft',
];

const listSaved = store => {
  const v = store.get(KEY);
  return Array.isArray(v) ? v.filter(x => x && (x.invite || x.guildId)) : [];
};
const saveList = (store, rows) => store.set(KEY, rows);

/** Resolve a handful at a time so we never open 30 sockets at once. */
async function resolveAll(codes, onEach, limit = 4) {
  const queue = [...codes];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      try { onEach(code, await DC.inviteInfo(code), null); }
      catch (err) { onEach(code, null, err); }
    }
  });
  await Promise.all(workers);
}

/**
 * buildBrowser({api, store, onOpen}) -> {el, stop()}
 *   onOpen({guildId, invite}) is called when a server is chosen.
 */
export function buildBrowser({ api, store, onOpen }) {
  const { h, icon } = api;
  const el = h('div.dcb');
  let dead = false;
  const cache = new Map();          // code -> info
  const S = { q: '', preview: null, busy: false };

  const grid = h('div.dcb__grid');
  const previewSlot = h('div');
  const addIn = h('input', {
    type: 'text', spellcheck: 'false',
    placeholder: 'Paste an invite link, or a server ID',
    'aria-label': 'Add a server',
    oninput: api.fmt.debounce(() => preview(), 420),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addCurrent(); } },
  });
  const findIn = h('input', {
    type: 'search', spellcheck: 'false', placeholder: 'Filter servers…',
    'aria-label': 'Filter servers',
    oninput: e => { S.q = e.target.value.trim().toLowerCase(); paintGrid(); },
  });

  api.render(el,
    h('div.dcb__bar',
      h('div.field', icon('plus'), addIn),
      h('button.btn.btn--primary', { type: 'button', onclick: addCurrent },
        icon('check', { size: 14 }), 'Add'),
      h('div.grow'),
      h('div.field', { style: { width: '190px', height: '32px' } }, icon('search'), findIn)),
    previewSlot,
    h('div.cx__sec-h', icon('message-circle'),
      h('div.cx__sec-t', { text: 'Servers' }),
      h('div.cx__sec-n', { id: 'dcb-count', text: 'loading…' })),
    grid);

  load();

  /* ---------------- data ---------------- */
  function codes() {
    const saved = listSaved(store);
    const mine = saved.map(s => s.invite).filter(Boolean);
    const extras = STARTERS.filter(c => !mine.includes(c));
    return { saved, list: [...mine, ...extras] };
  }

  async function load() {
    const { list } = codes();
    paintGrid();                                   // skeletons first
    await resolveAll(list, (code, info) => {
      if (dead) return;
      if (info) cache.set(code, info);
      else cache.set(code, { code, failed: true, name: code });
      paintGrid();
    });
  }

  /* ---------------- preview ---------------- */
  async function preview() {
    const parsed = DC.parseTarget(addIn.value);
    if (!parsed.invite && !parsed.guildId) { S.preview = null; api.clear(previewSlot); return; }
    if (parsed.guildId && !parsed.invite) {
      api.render(previewSlot, h('div.dcb-preview',
        h('small.dim', { text: `Server ID ${parsed.guildId} — press Add to save it. Live presence needs the widget enabled.` })));
      S.preview = { guildId: parsed.guildId };
      return;
    }
    api.render(previewSlot, h('div.dcb-preview', h('div.row', h('div.spinner'),
      h('small.dim', { text: 'Looking it up…' }))));
    try {
      const info = await DC.inviteInfo(parsed.invite);
      if (dead) return;
      S.preview = { invite: parsed.invite, guildId: info.guildId, info };
      api.render(previewSlot, h('div.dcb-preview',
        h('div.row',
          info.icon ? h('img.dcb-card__icon', { src: info.icon, alt: '', referrerpolicy: 'no-referrer' })
                    : h('div.dcb-card__icon'),
          h('div.grow',
            h('div.dcb-card__n', { text: info.name }),
            h('small.dim', { text: `${fmtN(info.members)} members · ${fmtN(info.online)} online` })),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: addCurrent },
            icon('plus', { size: 13 }), 'Add'))));
    } catch (err) {
      if (dead) return;
      S.preview = null;
      api.render(previewSlot, h('div.dcb-preview',
        h('small.dim', { text: err.message || 'That invite did not resolve.' })));
    }
  }

  function addCurrent() {
    const parsed = S.preview || DC.parseTarget(addIn.value);
    if (!parsed || (!parsed.invite && !parsed.guildId)) return;
    const rows = listSaved(store);
    if (rows.some(r => (parsed.invite && r.invite === parsed.invite)
                    || (parsed.guildId && r.guildId === parsed.guildId))) {
      api.notify({ app: 'Discord', icon: 'info', title: 'Already in your list',
                   message: parsed.info?.name || parsed.invite || parsed.guildId });
      return;
    }
    rows.push({ invite: parsed.invite || null, guildId: parsed.guildId || null });
    saveList(store, rows);
    if (parsed.info) cache.set(parsed.invite, parsed.info);
    addIn.value = '';
    S.preview = null;
    api.clear(previewSlot);
    load();
  }

  function remove(code, guildId) {
    const rows = listSaved(store).filter(r =>
      !(code && r.invite === code) && !(guildId && !code && r.guildId === guildId));
    saveList(store, rows);
    paintGrid();
  }

  /* ---------------- grid ---------------- */
  function paintGrid() {
    if (dead) return;
    const { saved, list } = codes();
    const mine = new Set(saved.map(s => s.invite).filter(Boolean));
    const rows = list
      .map(code => ({ code, info: cache.get(code), mine: mine.has(code) }))
      .filter(r => {
        if (!S.q) return true;
        const n = (r.info?.name || r.code).toLowerCase();
        return n.includes(S.q) || (r.info?.description || '').toLowerCase().includes(S.q);
      })
      .sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0)
        || (b.info?.online || 0) - (a.info?.online || 0));

    const countEl = el.querySelector('#dcb-count');
    if (countEl) {
      const done = rows.filter(r => r.info && !r.info.failed).length;
      countEl.textContent = done < rows.length ? `${done} of ${rows.length} loaded` : `${rows.length}`;
    }

    api.clear(grid);
    if (!rows.length) {
      grid.appendChild(h('div.empty', icon('search'),
        h('b', { text: 'Nothing matches that' }),
        h('small', { text: 'Clear the filter, or paste an invite link above to add a server.' })));
      return;
    }
    for (const r of rows) grid.appendChild(card(r));
  }

  function card({ code, info, mine }) {
    /* built flat on purpose: deep ternaries inside nested h() calls are how
       you lose a bracket and a whole afternoon */
    if (!info) {
      const skel = h('div.dcb-card.is-skel');
      skel.append(
        h('div.dcb-card__top', h('div.dcb-card__icon'), h('div.grow', h('div.dcb-card__n'))),
        h('div.dcb-card__d'));
      return skel;
    }

    if (info.failed) {
      const bad = h('div.dcb-card');
      bad.append(
        h('div.dcb-card__top',
          h('div.dcb-card__icon.center', icon('alert')),
          h('div.grow',
            h('div.dcb-card__n', { text: code }),
            h('small.dim', { text: 'Invite did not resolve' }))));
      if (mine) {
        bad.appendChild(h('div.dcb-card__acts',
          h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => remove(code) },
            icon('trash', { size: 13 }), 'Remove')));
      }
      return bad;
    }

    const box = h('div.dcb-card');
    if (info.banner) {
      box.appendChild(h('div.dcb-card__banner', {
        style: { backgroundImage: `url("${info.banner}")` },
      }));
    }

    const badge = h('div.dcb-card__m');
    if (info.online != null) {
      badge.appendChild(h('span.chip', h('span.dc__dot'),
        h('span', { text: `${fmtN(info.online)} online` })));
    }
    if (info.members != null) {
      badge.appendChild(h('span.chip', icon('users'), h('span', { text: fmtN(info.members) })));
    }

    const art = info.icon
      ? h('img.dcb-card__icon', { src: info.icon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : h('div.dcb-card__icon.center', icon('message-circle'));

    box.append(
      h('div.dcb-card__top', art,
        h('div.grow', h('div.dcb-card__n', { text: info.name }), badge)),
      h('div.dcb-card__d', { text: info.description || 'No description.' }));

    const openBtn = h('button.btn.btn--sm.btn--primary', {
      type: 'button',
      onclick: () => onOpen?.({ guildId: info.guildId, invite: info.code }),
    }, icon('arrow-right', { size: 13 }), 'Open');

    const saveBtn = mine
      ? h('button.btn.btn--sm.btn--ghost.tip', {
          type: 'button', 'data-tip': 'Remove from your list', 'aria-label': 'Remove from your list',
          onclick: () => remove(code, info.guildId),
        }, icon('trash', { size: 13 }))
      : h('button.btn.btn--sm.tip', {
          type: 'button', 'data-tip': 'Save to your list', 'aria-label': 'Save to your list',
          onclick: () => {
            const rows = listSaved(store);
            rows.push({ invite: info.code, guildId: info.guildId });
            saveList(store, rows);
            paintGrid();
          },
        }, icon('plus', { size: 13 }));

    const copyBtn = h('button.btn.btn--sm.btn--ghost.tip', {
      type: 'button', 'data-tip': 'Copy invite', 'aria-label': 'Copy invite',
      onclick: async () => {
        try { await navigator.clipboard.writeText(info.url); } catch (err) { /* clipboard is optional */ }
      },
    }, icon('copy', { size: 13 }));

    box.appendChild(h('div.dcb-card__acts', openBtn, saveBtn, copyBtn));
    return box;
  }

  const fmtN = n => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

  return { el, stop() { dead = true; } };
}

export default { buildBrowser };
