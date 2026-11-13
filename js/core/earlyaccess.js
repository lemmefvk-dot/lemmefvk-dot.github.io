/* ============================================================
   earlyaccess.js — the early-access channel for StaticOS developers.

   Two sites run the same code from different branches:
     stable   https://staticos.surge.sh        (main, fully tested)
     beta     https://staticos-early.surge.sh   (branch `beta`, every push)
   The beta's deploy (.github/workflows/beta.yml) writes a small
   channel.json beside the page: {"channel":"beta","built":…,"commit":…}.
   The stable site has no such file, so "no channel.json" means stable.

   Each address keeps its own saved data (Settings → Back up your data
   moves it), which is why the stable site only links across.

   Nothing here is a secret. The beta is a public web address; the
   developer sign-in in front of it (shell/earlyaccess.js) is a front
   door, not a vault, exactly like shell/account.js.
   ============================================================ */
export const STABLE_URL = 'https://staticos.surge.sh/';
export const BETA_URL = 'https://staticos-early.surge.sh/';

const getJson = async (url, ms = 8000) => {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl?.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(t); }
};

/* clean a channel.json; null for anything that is not a well-formed one */
const clean = c => (c && typeof c === 'object' && typeof c.channel === 'string'
  ? { channel: c.channel, built: typeof c.built === 'string' ? c.built : '', commit: typeof c.commit === 'string' ? c.commit.slice(0, 40) : '' }
  : null);

/* This site's own channel: {channel:'beta', built, commit}, or null for stable. */
let own = null;
export function thisChannel() {
  own ||= getJson('channel.json').then(c => { const k = clean(c); return k && k.channel === 'beta' ? k : null; });
  return own;
}

export const when = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

/* The same card for the account menu's sheet and the Developer Room.
   It only links across: the stable site cannot read the beta's files (Surge
   sends no CORS header), so it shows no version or notes of its own. */
export function earlyAccessCard(h, icon) {
  return h('div.ea-card',
    h('p.ea-card__p', { text: 'Early access is the build developers get before everyone else, finished or not. It lives at its own web address, so its saved data is separate from this site (Settings → Back up your data moves it).' }),
    h('p.ea-card__p', { text: 'What\'s new there shows when you open it.' }),
    h('div.ea-card__acts',
      h('a.btn.btn--primary.btn--sm', { href: BETA_URL, target: '_blank', rel: 'noopener', 'data-ea': 'open' }, icon('external-link'), 'Open early access')));
}
