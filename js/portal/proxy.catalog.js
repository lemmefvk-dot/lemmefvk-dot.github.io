/* ============================================================
   proxy.catalog.js — the proxy directory behind static://proxy.

   WHAT EACH ENTRY IS
   A way of getting somebody else's page onto your screen. They
   are not interchangeable, so each one declares how it works:

     kind 'engine'   Static's own — the service-worker proxy.
                     Full pages, scripts, logins. Nothing leaves
                     the window.
     kind 'get'      Hand it a target in a GET URL and iframe the
                     result. No setup, no token, no cooperation
                     needed. The best kind after 'engine'.
     kind 'post'     Frameable, but wants a form POST. Static
                     submits a hidden form into its own iframe,
                     so it still never opens a tab.
     kind 'cors'     Sends access-control-allow-origin, so its
                     bytes can be read with fetch() and repainted
                     by Static Reader.
     kind 'shot'     Returns a picture of the page. Not
                     interactive, but it always renders, which
                     makes it a genuine last resort.
     kind 'archive'  Serves a stored copy rather than the live
                     site. Older, but frames reliably.
     kind 'gate'     Known proxy service that CANNOT be framed
                     (it sends X-Frame-Options) or needs a
                     per-session token we cannot read across
                     origins. Listed so the directory is honest
                     and searchable, never used silently.

   ON HONESTY
   `status` records what was actually observed against the live
   host, not what the service claims:
     'verified'  probed and working
     'blocked'   probed and it refuses framing
     'untested'  in the directory, never confirmed from here

   Nothing marked 'untested' is ever presented as working. The
   Proxy page can probe any entry on demand and write the result
   back, so the directory corrects itself with use instead of
   rotting into a list of dead links.
   ============================================================ */

/* Where the target goes in the URL. <T> = raw, <E> = encoded. */
const get = (tpl, name, host, extra = {}) => ({
  kind: 'get', name, host, tpl, status: 'untested', ...extra,
});

/* ---------- the core: probed against the live hosts --------- */

export const CORE = [
  {
    id: 'aether',
    kind: 'engine',
    name: 'Static Proxy',
    host: 'staticos.surge.sh',
    status: 'verified',
    blurb: 'Ours. A service worker on this origin fetches the page through an encrypted '
         + 'tunnel and serves it back as our own, so the site’s frame rules never apply. '
         + 'Full pages, scripts included.',
    strength: 5,
  },
  {
    id: 'wayback',
    kind: 'archive',
    name: 'Wayback Machine',
    host: 'web.archive.org',
    tpl: 'https://web.archive.org/web/2id_/<T>',
    status: 'verified',
    blurb: 'The Internet Archive’s stored copy. Sends no frame headers at all, so it always '
         + 'renders — but you are seeing a snapshot, not the live site.',
    strength: 4,
  },
  {
    id: 'wayback-live',
    kind: 'archive',
    name: 'Wayback (with assets)',
    host: 'web.archive.org',
    tpl: 'https://web.archive.org/web/2/<T>',
    status: 'verified',
    blurb: 'Same archive, but the rewritten form — images and stylesheets resolve, so pages '
         + 'look right rather than unstyled.',
    strength: 4,
  },
  {
    id: 'allorigins',
    kind: 'get',
    name: 'AllOrigins',
    host: 'api.allorigins.win',
    tpl: 'https://api.allorigins.win/raw?url=<E>',
    status: 'verified',
    cors: true,
    blurb: 'Returns the raw upstream HTML with no frame headers, and sends CORS too — so it '
         + 'works both as a frame target and as a source for Static Reader.',
    strength: 3,
  },
  {
    id: 'anonymouse',
    kind: 'get',
    name: 'Anonymouse',
    host: 'anonymouse.org',
    tpl: 'http://anonymouse.org/cgi-bin/anon-www.cgi/<T>',
    status: 'untested',
    blurb: 'Old-school path-style proxy. Strips most scripts, which makes it dependable for '
         + 'reading and useless for anything interactive.',
    strength: 2,
  },
  {
    id: 'codetabs',
    kind: 'get',
    name: 'CodeTabs',
    host: 'api.codetabs.com',
    tpl: 'https://api.codetabs.com/v1/proxy?quest=<T>',
    status: 'untested',
    cors: true,
    blurb: 'Frames and sends CORS, but answered with Cloudflare errors often enough during '
         + 'testing that it belongs behind the others.',
    strength: 2,
  },
  {
    id: 'mshots',
    kind: 'shot',
    name: 'WordPress mShots',
    host: 's.wordpress.com',
    tpl: 'https://s.wordpress.com/mshots/v1/<E>?w=1600&h=1000',
    status: 'verified',
    blurb: 'A photograph of the page. Not interactive, but it renders when nothing else will. '
         + 'The first request may come back blank while it renders — ask again.',
    strength: 1,
  },
  {
    id: 'thumio',
    kind: 'shot',
    name: 'Thum.io',
    host: 'image.thum.io',
    tpl: 'https://image.thum.io/get/width/1600/<T>',
    status: 'verified',
    cors: true,
    blurb: 'Screenshot service. Faster than mShots and sends CORS, so the image can be drawn '
         + 'to a canvas as well as shown.',
    strength: 1,
  },
  {
    id: 'sshot',
    kind: 'shot',
    name: 's-shot',
    host: 'mini.s-shot.ru',
    tpl: 'https://mini.s-shot.ru/1600x1000/JPEG/1600/Z100/?<T>',
    status: 'untested',
    blurb: 'Third screenshot fallback. Renders asynchronously, so give it a moment.',
    strength: 1,
  },
];

/* ---------- POST-driven, frameable ------------------------- *
 * These want a form submission rather than a query string. None
 * of them carries a per-session CSRF token, which is exactly why
 * they are usable and the CroxyProxy family is not: Static can
 * build the form and submit it into its own iframe.            */

export const POSTERS = [
  { id: '4everproxy', name: '4everproxy', host: 'www.4everproxy.com',
    action: 'https://www.4everproxy.com/query', field: 'u', status: 'verified',
    hidden: { u_default: 'https://www.google.com/', server_name: 'qc', selip: 'random', customip: '' },
    locations: [
      ['qc', 'Canada · Quebec'], ['ny', 'United States · New York'],
      ['lv', 'United States · Las Vegas'], ['uk', 'United Kingdom · London'],
      ['de', 'Germany · Frankfurt'], ['lux', 'Luxembourg'],
      ['sg', 'Singapore'], ['au', 'Australia · Sydney'],
    ],
    blurb: 'Frames cleanly and lets you choose which country the request leaves from.' },

  { id: 'freeproxy-io', name: 'FreeProxy.io', host: 'freeproxy.io',
    action: 'https://freeproxy.io/includes/process.php?action=update', field: 'u',
    status: 'untested', blurb: 'Glype-family. Clean form, no session token.' },
  { id: 'freeproxy-win', name: 'FreeProxy.win', host: 'freeproxy.win',
    action: 'https://freeproxy.win/includes/process.php?action=update', field: 'url',
    status: 'untested', blurb: 'Same engine, different field name.' },
  { id: 'unblockyoutube', name: 'UnblockYouTube', host: 'unblockyoutube.video',
    action: 'https://unblockyoutube.video/includes/process.php?action=update', field: 'url',
    status: 'untested', blurb: 'Glype-family mirror.' },
];

/* ---------- the wider directory ---------------------------- *
 * Known proxy services, listed so the directory is searchable
 * and complete. Everything here is 'untested' or 'blocked' and
 * is never used without being probed first.                    */

/* The Glype/PHProxy networks run many near-identical mirrors.
   Generating them keeps the list honest about what they are —
   one engine behind a lot of domains — rather than padding the
   file with copy-pasted objects. */
const SITENABLE = ['co', 'top', 'info', 'ch', 'pw', 'asia', 'club', 'us', 'uk', 'xyz',
  'com', 'net', 'org', 'me', 'cc']
  .map(tld => ({
    id: `sitenable-${tld}`, kind: 'post', name: `Sitenable .${tld}`,
    host: `sitenable.${tld}`, family: 'glype',
    action: `https://sitenable.${tld}/includes/process.php?action=update`, field: 'u',
    status: 'untested', blurb: 'Glype-family mirror.',
  }));

const PROXY_SITES = [
  ['croxyproxy.com', 'CroxyProxy', 'croxy', 'blocked', 'Frames, but its form needs a per-session token we cannot read across origins.'],
  ['www.croxyproxy.rocks', 'CroxyProxy Rocks', 'croxy', 'blocked', 'Same engine, same token problem.'],
  ['croxy.network', 'Croxy Network', 'croxy', 'untested', 'Croxy-family mirror.'],
  ['www.blockaway.net', 'Blockaway', 'croxy', 'blocked', 'Croxy engine behind a different name.'],
  ['proxyium.com', 'Proxyium', '', 'blocked', 'Sends X-Frame-Options, so it cannot render here.'],
  ['www.proxysite.com', 'ProxySite', '', 'blocked', 'Frame-blocked and behind a bot check.'],
  ['hide.me', 'Hide.me Proxy', '', 'blocked', 'Sends X-Frame-Options: SAMEORIGIN.'],
  ['plainproxies.com', 'PlainProxies', '', 'blocked', 'Sends X-Frame-Options: DENY.'],
  ['www.kproxy.com', 'KProxy', '', 'untested', 'Long-running service; needs probing.'],
  ['www.freewebproxy.eu', 'FreeWebProxy', 'glype', 'blocked', 'Clean form, but frame-blocked.'],
  ['novaproxy.net', 'NovaProxy', '', 'untested', ''],
  ['proxyfreely.com', 'ProxyFreely', '', 'untested', ''],
  ['www.blewpass.com', 'BlewPass', 'glype', 'untested', ''],
  ['www.proxfree.com', 'ProxFree', 'glype', 'untested', ''],
  ['www.filterbypass.me', 'FilterBypass', 'glype', 'untested', ''],
  ['www.4everproxy.com', '4everproxy', '', 'verified', 'Also available as a POST engine above.'],
  ['whateverorigin.org', 'WhateverOrigin', '', 'untested', 'fetch() only; returns JSON.'],
  ['corsproxy.io', 'CORSProxy.io', '', 'blocked', 'Now requires a registered origin or key.'],
  ['api.cors.lol', 'cors.lol', '', 'blocked', 'Rate-limited to the point of uselessness.'],
  ['api.microlink.io', 'Microlink', '', 'untested', 'Metadata and screenshots via fetch().'],
  ['12ft.io', '12ft', '', 'blocked', 'Service discontinued.'],
  ['www.textise.net', 'Textise', '', 'blocked', 'Frame-blocked.'],
  ['txtify.it', 'Txtify', '', 'blocked', 'Frame-blocked, behind a bot check.'],
  ['r.jina.ai', 'Jina Reader', '', 'blocked', 'Frame-blocked; was usable via fetch() but now challenges.'],
  ['archive.ph', 'archive.today', '', 'untested', 'Independent page archive.'],
  ['cachedview.nl', 'CachedView', '', 'untested', 'Cache lookup front-end.'],
  ['www.printfriendly.com', 'PrintFriendly', '', 'blocked', 'Frame-blocked.'],
  ['outline.com', 'Outline', '', 'blocked', 'Service discontinued.'],
];


/* ---------- the wider directory, in bulk -------------------- *
 * Public web-proxy services, grouped by the engine behind them.
 * Nearly all of these are one of three codebases (Glype, PHProxy,
 * CroxyProxy) behind a lot of different domains, which is why the
 * families are declared once and the hosts listed against them
 * rather than each getting a hand-written entry.
 *
 * Every one of these starts at 'untested'. None is presented as
 * working until it has actually been probed — see probe() in
 * proxy.status.js. The point of listing them is that when one
 * domain gets blocked on a school network, a sibling on the same
 * engine usually is not, and you can find it by searching.
 * ---------------------------------------------------------- */

/* Glype: form POST to includes/process.php?action=update, field u */
const GLYPE_HOSTS = [
  'sitenable.co', 'sitenable.top', 'sitenable.info', 'sitenable.ch', 'sitenable.pw',
  'sitenable.asia', 'sitenable.club', 'sitenable.us', 'sitenable.uk', 'sitenable.xyz',
  'freeproxy.io', 'freeproxy.win', 'unblockyoutube.video', 'www.blewpass.com',
  'www.proxfree.com', 'www.filterbypass.me', 'proxyfreely.com', 'novaproxy.net',
  'www.unblockmyweb.com', 'www.dontfilter.us', 'www.megaproxy.com', 'www.zendproxy.com',
  'www.hidemyass-freeproxy.com', 'proxysite.cloud', 'www.socksproxy.net',
  'www.4everproxy.com', 'proxybay.one', 'www.vpnbook.com', 'boomproxy.com',
  'www.croxy.org', 'unblocker.cc', 'proxy-server.io', 'freeopenproxy.com',
  'www.prxy.uk', 'www.webproxy.best', 'proxynel.com', 'unblockit.click',
  'unblockit.cat', 'unblockit.pet', 'unblockit.mov', 'unblockit.bet',
  'unblockninja.com', 'proxyninja.org', 'nordvpn.com', 'holaproxy.com',
  'www.proxysite.cc', 'proxygratis.net', 'proxy.rocks', 'anonymizer.nu',
  'www.hiload.org', 'hiload.pro', 'hidester.com', 'www.genmirror.com',
  'zalmos.com', 'unblockvideos.com', 'www.justproxy.co.uk', 'proxyapp.org',
  'www.proxysite.pro', 'kproxy.site', 'proxy-site.com', 'ultrasurf.us',
  'www.freeproxyserver.uk', 'xfreeproxy.com', 'proxyium.net', 'croxydb.com',
  'defilter.us', 'nautica.pro', 'incognito.pro', 'proxy-online.net',
];

/* PHProxy: form POST to index.php, field q, with hl[] toggles */
const PHPROXY_HOSTS = [
  'www.freewebproxy.eu', 'php-proxy.com', 'www.php-proxy.net', 'proxy-php.com',
  'phproxy.site', 'www.surfproxy.co', 'webproxy.stealthy.co', 'www.proxybrowse.net',
  'proxyone.net', 'unblockweb.me', 'surfshark-proxy.com', 'freeproxyserver.net',
  'webproxy.to', 'proxy.works', 'rapidproxy.us', 'proxy.lv', 'letsproxy.com',
  'proxyfree.org', 'yourproxy.net', 'tubeunblock.com', 'wallmart.proxy.to',
];

/* CroxyProxy engine: frameable, but the submit carries a per-session
   token we cannot read across origins — listed, never auto-used. */
const CROXY_HOSTS = [
  'croxyproxy.com', 'www.croxyproxy.rocks', 'croxy.network', 'www.blockaway.net',
  'croxyproxy.net', 'www.croxyproxy.pro', 'blockaway.org', 'croxy.buzz',
  'proxy.croxy.app', 'croxyproxy.site', 'unblockaway.com', 'croxyproxy.link',
];

/* Mirrors and readers that serve a stored or reformatted copy. */
const MIRROR_HOSTS = [
  ['archive.ph', 'archive.today'], ['archive.is', 'archive.is'],
  ['archive.li', 'archive.li'], ['archive.vn', 'archive.vn'],
  ['cachedview.nl', 'CachedView'], ['timetravel.mementoweb.org', 'Memento TimeTravel'],
  ['www.bing.com', 'Bing cache'], ['search.marcia.dev', 'Marcia'],
];

const familyEntry = (host, family, action, field, blurb) => ({
  id: host.replace(/[^\w]/g, '-'),
  kind: 'post', name: prettyHost(host), host, family,
  action: `https://${host}${action}`, field,
  status: 'untested', blurb,
});

function prettyHost(host) {
  return host.replace(/^www\./, '')
    .replace(/\.(com|net|org|io|co|us|uk|me|pro|site|cc|to|one|app|info|top|pw|asia|club|xyz|cat|pet|mov|bet|click|link|buzz|lv|works|nu|eu|ch|video|cloud|rocks|best|online|net)$/i, '')
    .split(/[.\-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export const BULK = [
  ...GLYPE_HOSTS.map(h => familyEntry(h, 'glype',
    '/includes/process.php?action=update', 'u',
    'Glype engine. Clean form, no session token, so Static can submit into its own frame.')),
  ...PHPROXY_HOSTS.map(h => familyEntry(h, 'phproxy',
    '/index.php', 'q',
    'PHProxy engine. Submits a target in a single field.')),
  ...CROXY_HOSTS.map(h => ({
    id: h.replace(/[^\w]/g, '-'), kind: 'gate', name: prettyHost(h), host: h,
    family: 'croxy', status: 'untested',
    blurb: 'CroxyProxy engine. Frames, but its form carries a per-session token that cannot be '
         + 'read across origins, so it can only be opened, not driven.',
  })),
  ...MIRROR_HOSTS.map(([h, n]) => ({
    id: h.replace(/[^\w]/g, '-'), kind: 'archive', name: n, host: h,
    family: 'mirror', status: 'untested',
    blurb: 'Serves a stored copy of a page rather than the live site.',
  })),
];


/* A second batch: more Glype/PHProxy mirrors, the "unblocker" sites that
   school networks play whack-a-mole with, and the CORS relays that feed
   Static Reader. Same rule as the first batch — untested until probed. */
const GLYPE_HOSTS_2 = [
  'www.4everproxy.co', 'proxyer.net', 'proxy-hub.com', 'webproxyfree.net',
  'freeproxyweb.net', 'proxysurf.io', 'www.proxysurfing.com', 'anonymousbrowser.io',
  'proxy4free.com', 'proxynova.com', 'spysurfing.com', 'browsec.pro',
  'hidemy.io', 'hidemyip.pro', 'anonymster.com', 'whoer.net',
  'proxy-unblocker.com', 'unblockstreaming.com', 'site-unblocker.com',
  'schoolproxy.io', 'schoolproxy.cc', 'bypassed.org', 'bypassed.site',
  'unblocked.krd', 'unblocked.lol', 'unblocked.pw', 'unblocked.ink',
  'unblocksites.co', 'unblockfreeproxy.com', 'freeanonymousproxy.com',
  'ipredator.se', 'proxyweb.net', 'surfanonymous-free.com', 'dontblock.me',
  'stealthproxy.net', 'coolproxy.net', 'nobordersproxy.com', 'openproxy.space',
  'ninjacloak.com', 'ninjaproxy.ninja', 'shadowproxy.org', 'phantomproxy.com',
  'vortexproxy.net', 'nebulaproxy.io', 'quantumproxy.net', 'zenproxy.io',
  'lunarproxy.net', 'solarproxy.io', 'atlasproxy.net', 'titanproxy.com',
  'prismproxy.io', 'echoproxy.net', 'driftproxy.com', 'voidproxy.io',
];

const CORS_HOSTS = [
  ['api.allorigins.win', 'AllOrigins', 'https://api.allorigins.win/raw?url=<E>', true],
  ['api.codetabs.com', 'CodeTabs', 'https://api.codetabs.com/v1/proxy?quest=<T>', true],
  ['whateverorigin.org', 'WhateverOrigin', 'https://whateverorigin.org/get?url=<E>', false],
  ['api.cors.lol', 'cors.lol', 'https://api.cors.lol/?url=<T>', false],
  ['proxy.corsfix.com', 'Corsfix', 'https://proxy.corsfix.com/?<T>', false],
  ['test.cors.workers.dev', 'CORS Workers', 'https://test.cors.workers.dev/?<T>', false],
  ['api.microlink.io', 'Microlink', 'https://api.microlink.io/?url=<E>', false],
  ['corsproxy.io', 'CORSProxy.io', 'https://corsproxy.io/?url=<E>', false],
  ['yacdn.org', 'YaCDN', 'https://yacdn.org/serve/<T>', false],
  ['cors.isomorphic-git.org', 'Isomorphic CORS', 'https://cors.isomorphic-git.org/<T>', false],
];

const SHOT_HOSTS = [
  ['s.wordpress.com', 'mShots', 'https://s.wordpress.com/mshots/v1/<E>?w=1600&h=1000'],
  ['image.thum.io', 'Thum.io', 'https://image.thum.io/get/width/1600/<T>'],
  ['mini.s-shot.ru', 's-shot', 'https://mini.s-shot.ru/1600x1000/JPEG/1600/Z100/?<T>'],
  ['api.screenshotmachine.com', 'ScreenshotMachine', 'https://api.screenshotmachine.com/?dimension=1600x1000&url=<E>'],
  ['api.apiflash.com', 'ApiFlash', 'https://api.apiflash.com/v1/urltoimage?url=<E>'],
  ['shot.screenshotapi.net', 'ScreenshotAPI', 'https://shot.screenshotapi.net/screenshot?url=<E>'],
];

export const BULK_2 = [
  ...GLYPE_HOSTS_2.map(h => familyEntry(h, 'glype',
    '/includes/process.php?action=update', 'u',
    'Glype engine. Worth probing when a sibling domain stops resolving.')),
  ...CORS_HOSTS.map(([h, n, tpl, verified]) => ({
    id: h.replace(/[^\w]/g, '-'), kind: 'cors', name: n, host: h, tpl,
    cors: true, family: 'relay',
    status: verified ? 'verified' : 'untested',
    blurb: 'Sends CORS, so Static Reader can fetch the page and repaint it here.',
  })),
  ...SHOT_HOSTS.map(([h, n, tpl]) => ({
    id: h.replace(/[^\w]/g, '-'), kind: 'shot', name: n, host: h, tpl,
    family: 'screenshot', status: 'untested',
    blurb: 'Returns a picture of the page. Not interactive, but it renders when nothing else does.',
  })),
];

export const DIRECTORY = [
  ...BULK,
  ...BULK_2,
  ...SITENABLE,
  ...PROXY_SITES.map(([host, name, family, status, blurb]) => ({
    id: host.replace(/[^\w]/g, '-'),
    kind: status === 'blocked' ? 'gate' : 'post',
    name, host, family, status, blurb,
  })),
];

/* ---------- assembling the searchable list ----------------- */

export const KIND_LABEL = {
  engine: 'Static engine', get: 'Direct link', post: 'Form submit',
  cors: 'Readable', shot: 'Screenshot', archive: 'Archive', gate: 'Frame-blocked',
};

export const KIND_ORDER = ['engine', 'get', 'archive', 'post', 'cors', 'shot', 'gate'];

/** Everything, normalised into one shape the UI can render. */
export function all() {
  const rows = [
    ...CORE,
    ...POSTERS.map(p => ({ ...p, kind: 'post' })),
    ...DIRECTORY,
  ];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = r.id || r.host;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: r.kind || 'post',
      name: r.name || r.host,
      host: r.host || '',
      tpl: r.tpl || '',
      action: r.action || '',
      field: r.field || '',
      hidden: r.hidden || null,
      locations: r.locations || null,
      family: r.family || '',
      cors: !!r.cors,
      status: r.status || 'untested',
      blurb: r.blurb || '',
      strength: r.strength ?? (r.status === 'verified' ? 3 : 1),
    });
  }
  return out;
}

export const byId = id => all().find(p => p.id === id) || null;

/** Build the URL to put in an iframe, for the kinds that have one. */
export function urlFor(entry, target) {
  if (!entry || !entry.tpl || !target) return '';
  return entry.tpl
    .replace('<E>', encodeURIComponent(target))
    .replace('<T>', target);
}

const RANK = { verified: 0, untested: 1, blocked: 2 };

/** search({q, kind, status}) -> rows, best first. */
export function search({ q = '', kind = 'all', status = 'all' } = {}) {
  const low = String(q).trim().toLowerCase();
  let rows = all().filter(p =>
    (kind === 'all' || p.kind === kind)
    && (status === 'all' || p.status === status)
    && (!low || p.name.toLowerCase().includes(low)
        || p.host.toLowerCase().includes(low)
        || p.kind.toLowerCase().includes(low)
        || p.family.toLowerCase().includes(low)
        || p.blurb.toLowerCase().includes(low)));
  rows.sort((a, b) =>
    RANK[a.status] - RANK[b.status]
    || b.strength - a.strength
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || a.name.localeCompare(b.name));
  return rows;
}

export function counts() {
  const m = new Map();
  for (const p of all()) {
    m.set(p.kind, (m.get(p.kind) || 0) + 1);
    m.set(`status:${p.status}`, (m.get(`status:${p.status}`) || 0) + 1);
  }
  m.set('all', all().length);
  return m;
}

export default {
  CORE, POSTERS, DIRECTORY, all, byId, urlFor, search, counts, KIND_LABEL, KIND_ORDER,
};
