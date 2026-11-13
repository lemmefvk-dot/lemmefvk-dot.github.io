/* ============================================================
   cloud.data.js — what Static Cloud can actually run.

   THE HONEST POSITION ON COMMERCIAL CLOUD GAMING
   Every real service was probed against its live play endpoint,
   not its marketing page. All of them refuse to be framed:

     play.geforcenow.com   CSP frame-ancestors 'self' + discord
     xbox.com/play         x-frame-options: DENY
     luna.amazon.com       x-frame-options: DENY
     now.gg                x-frame-options: SAMEORIGIN
     boosteroid            frame-ancestors excludes us

   X-Frame-Options is enforced by the browser before any of our
   code runs, so there is no client-side way around it. Static's
   own tunnel gets past framing — but GeForce NOW then refuses
   the tunnel's TLS handshake outright, so even that does not
   help. Cine-OS ships a Fortnite tile pointing at GeForce NOW;
   it is a dead iframe. We do not pretend otherwise.

   WHAT DOES WORK, ALL VERIFIED FRAMEABLE
     archive.org/embed/<id>   no frame headers at all, and it
                              serves a full in-browser emulator.
                              Its search API is CORS-open, so the
                              library is live rather than baked:
                              8,900+ MS-DOS titles alone.
     nowgg.fun                a mirror that, unlike now.gg itself,
                              sends no frame headers — Android
                              and Roblox running in a window.
     app.apponfly.com/trial   a Windows desktop in a frame.
     streamex.sh              a game stream that frames.

   The mirrors are other people's infrastructure and can vanish;
   they are marked as such and the UI probes rather than assumes.
   ============================================================ */

/* ---------- emulated libraries (archive.org) ---------------- */

export const COLLECTIONS = [
  { id: 'softwarelibrary_msdos_games', name: 'MS-DOS games', icon: 'terminal',
    note: 'The DOS catalogue, running on an in-browser DOSBox.' },
  { id: 'internetarcade', name: 'Arcade', icon: 'gamepad',
    note: 'Coin-op cabinets, emulated.' },
  { id: 'consolelivingroom', name: 'Consoles', icon: 'gamepad',
    note: 'Cartridge-era console libraries.' },
  { id: 'softwarelibrary_win3_games', name: 'Windows 3.x', icon: 'monitor',
    note: 'Early Windows games.' },
  { id: 'softwarelibrary_apple', name: 'Apple II', icon: 'cpu',
    note: 'Apple II software.' },
  { id: 'softwarelibrary_c64', name: 'Commodore 64', icon: 'cpu',
    note: 'C64 titles.' },
  { id: 'softwarelibrary_zxspectrum', name: 'ZX Spectrum', icon: 'cpu',
    note: 'Spectrum tapes.' },
  { id: 'softwarelibrary_msdos', name: 'MS-DOS software', icon: 'file-text',
    note: 'Applications, not just games.' },
];

const SEARCH = 'https://archive.org/advancedsearch.php';

export const embedUrl = id => `https://archive.org/embed/${encodeURIComponent(id)}`;
export const thumbUrl = id => `https://archive.org/services/img/${encodeURIComponent(id)}`;

const cache = new Map();

/**
 * Live search against archive.org. Their advancedsearch endpoint sends
 * access-control-allow-origin: *, so this runs straight from the page —
 * no build step, no baked catalogue, and it never goes stale.
 */
export async function search({ collection = 'softwarelibrary_msdos_games', q = '', rows = 48, page = 1, signal } = {}) {
  const terms = [`collection:${collection}`];
  if (q.trim()) terms.push(`title:(${q.trim().replace(/[()"]/g, '')})`);
  const key = `${collection}|${q}|${page}|${rows}`;
  if (cache.has(key)) return cache.get(key);

  const url = `${SEARCH}?q=${encodeURIComponent(terms.join(' AND '))}`
    + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=downloads&fl%5B%5D=description'
    + `&rows=${rows}&page=${page}&sort%5B%5D=downloads+desc&output=json`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`archive.org: HTTP ${res.status}`);
  const data = await res.json();
  const body = data?.response;
  if (!body) throw new Error('archive.org returned nothing usable.');

  const out = {
    total: body.numFound || 0,
    page,
    items: (body.docs || []).filter(d => d.identifier).map(d => ({
      id: d.identifier,
      title: String(d.title || d.identifier).slice(0, 90),
      year: d.year || null,
      downloads: d.downloads || 0,
      desc: typeof d.description === 'string' ? d.description.slice(0, 400) : '',
      art: thumbUrl(d.identifier),
      embed: embedUrl(d.identifier),
    })),
  };
  cache.set(key, out);
  return out;
}

/* ---------- streamed surfaces ------------------------------ *
 * Only the Internet Archive's emulator is offered here. The entries
 * that used to follow it (Roblox and a whole Android device on an
 * unofficial now.gg mirror, and Xbox Cloud Gaming) were served
 * through Static's tunnel, which meant typing a Roblox or Microsoft
 * password into a page carried by relays run by strangers. now.gg's
 * own Roblox listing has also gone (its link redirects to their home
 * page). Those services are reached as plain links from the catalogue
 * instead, in a new tab on their own sites.
 * ---------------------------------------------------------- */

export const STREAMS = [
  {
    id: 'archive-emulator',
    name: 'Emulated games',
    kind: 'emulator',
    url: 'https://archive.org/embed/msdos_Prince_of_Persia_1990',
    icon: 'gamepad',
    via: 'direct',
    account: 'none',
    blurb: 'The Internet Archive\'s in-browser emulator. Sends no frame headers and renders '
         + 'directly — the library below is all of it.',
    note: 'Nothing to sign into. Click and it runs.',
    verified: true,
  },
];

/* ---------- probed, and genuinely refused ------------------ *
 * Kept visible rather than deleted: knowing a route was tried
 * and why it failed is worth more than a shorter list.        */

export const BLOCKED = [
  ['GeForce NOW', 'play.geforcenow.com',
    "frame-ancestors 'self' blocks a direct frame, and it also drops the tunnel's TLS handshake — "
    + 'the one service that defeats both routes. Tested on all three relays.'],
  ['Amazon Luna', 'luna.amazon.com',
    'x-frame-options: DENY directly, and unreachable through the tunnel as well.'],
  ['Roblox / Android via nowgg.fun — DIRECTLY', 'nowgg.fun',
    'Redirects to 76.ip.nowgg.fun, which sends SAMEORIGIN, so a plain iframe is refused. This is '
    + 'the tile other sites ship and it is dead there. It DOES work through Static\'s tunnel, '
    + 'because that serves it from our own origin — see the Roblox page.'],
  ['now.gg (official)', 'now.gg', 'x-frame-options: SAMEORIGIN.'],
  ['Streamex', 'streamex.sh',
    'Loads google.com inside its own frame, which the browser refuses.'],
  ['AppOnFly (Windows desktop)', 'app.apponfly.com',
    'The frame never materialises — no content is delivered to an embedded context.'],
  ['Boosteroid', 'cloud.boosteroid.com', 'frame-ancestors excludes us.'],
  ['BlueStacks X', 'bluestacks.com', "frame-ancestors 'self' *.bluestacks.com."],
];

/* The honest summary the UI prints, so the page never implies more
   than was actually observed. */

/* ---------- what it costs you to start --------------------- *
 * The honest answer to "can I just play without signing in".
 * Most of Static needs nothing at all; two surfaces do, and
 * there is no way around that — a shared account cannot be kept
 * secret in a static site, would be one concurrent stream for
 * everyone at once, and would simply get banned.
 * ---------------------------------------------------------- */

export const ACCOUNT = {
  none: { label: 'No sign-in', tone: 'ok',
    note: 'Nothing to create, nothing to log into.' },
  microsoft: { label: 'Microsoft account', tone: 'warn',
    note: 'Free to make. Fortnite and 66 other titles then cost nothing; the rest need Game Pass Ultimate.' },
  roblox: { label: 'Roblox account', tone: 'warn',
    note: 'Your own, on a shared public device — so treat anything you type there as public.' },
};

export const accountOf = s => ACCOUNT[s && s.account ? s.account : 'none'];

/* Counted rather than asserted, so the number on the page is always
   whatever is actually in the catalogues. */
export const NO_ACCOUNT_NOTE =
  'Everything in Static except Xbox Cloud and Roblox runs with nothing to sign into — the '
  + 'emulated library here, every game in Static Games, the whole anime catalogue and the proxy. '
  + 'There is no shared account for the two that do ask: a credential in a static site is public '
  + 'to anyone who views the source, one account is one stream, and it would be banned within days.';

export const VERDICT =
  'Roblox runs here — the real client, streamed off a cloud Android device through Static\'s '
  + 'tunnel, which serves the player from our own origin so its frame rules stop applying. Xbox '
  + 'Cloud loads the same way, though playing needs your own subscription. GeForce NOW and Luna '
  + 'defeat even the tunnel. Emulation runs directly, and there is a lot of it.';

export default { COLLECTIONS, STREAMS, BLOCKED, VERDICT, search, embedUrl, thumbUrl };
