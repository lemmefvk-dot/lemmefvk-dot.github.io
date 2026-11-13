/* ============================================================
   brand.js — the single source of the product name.

   Everything user-visible reads from here: window titles, page
   chrome, nav labels, notifications, the start-page wordmark,
   the app names in the launcher and Spotlight.

   Flip `name`/`short` and the whole product renames itself.
   Two earlier identities are kept in the alias list below, so
   every link ever shared still resolves.
   ============================================================ */

export const BRAND = {
  name: 'Static',                        // was: 'Static', before that 'cherri'
  os: 'StaticOS',
  short: 'static',                       // url scheme + lowercase uses
  wordmark: 'static',                    // how the big logotype is set
  tagline: 'everything, behind one address',
  icon: 'diamond',
  version: 'v4.0.0',
  footer: 'v4.0.0 · one origin · no tabs',
  discord: null,                         // set the invite URL to light the button up
};

/* Every scheme resolves to the same pages. `static` is canonical; the two
   older names are kept because links to them exist in notes, bookmarks and
   anything already shared — a rename should never break a URL. */
export const SCHEMES = ['static', 'aether', 'cherri'];
export const LOCAL_PROXY_URL = 'http://localhost:8000/#app=aether-proxy';

const ALIAS = /^(?:aether|cherri):\/\//i;

/** static://games, static://games and static://games are the same page. */
export const canon = url => String(url || '').replace(ALIAS, 'static://');

/** Build a portal URL in the current scheme. */
export const u = path => `${BRAND.short}://${String(path).replace(/^\/+/, '')}`;

export default BRAND;
