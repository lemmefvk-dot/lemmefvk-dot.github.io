# The Static portal

`js/portal/` is the whole portal: games, anime, manga, movies, a search engine, and the
pages carried over from the old *big bros games* Google Sites site. It renders inside the
**Browser** app ([js/apps/browser.js](js/apps/browser.js)), which owns the tabs, address
bar and history and delegates every `static://` page to this layer.

## Pages

| URL | Module | What it is |
| --- | --- | --- |
| `static://home` | browser.js | the original start page |
| `static://games` · `/games/<id>` | `games.js` | 20 **real playable** games |
| `static://anime` · `/anime/<id>` | `anime.js` | 7,963 anime, filters + pager |
| `static://manga` · `/manga/<id>` | `anime.js` | 1,200 manga, same UI |
| `static://movies` · `/movies/<id>` | `movies.js` | 22 films/series, metadata only |
| `static://roblox` · `/roblox/<id>` | `roblox.js` | 1,311 Roblox experiences, real art, client launch |
| `static://cloud` | `cloud.js` | cloud gaming hand-off |
| `static://search?q=` | `search.js` | the search engine |
| `static://arcade` | `extras.js` | hub tying it together |
| `static://proxy` | `extras.js` | four engines, two of them ours |
| `static://apply` | `extras.js` | "apply for positions", now a real form |

Typing `games`, `anime`, `movies`, `manga`, `arcade`, `proxy` or `apply` in the address
bar goes straight there. `static://` still works as an alias of `static://` everywhere.

Three of these pages are also **OS apps** — `js/apps/portal.js` mounts the same modules in
their own windows, so Static Games, Static Anime and Static Search appear in the launcher,
Spotlight and the dock, each with its own back/forward history.

## Naming

`js/portal/brand.js` owns the product name. Every visible string — window titles, nav
labels, the start-page wordmark, notification senders, the app names — reads from it:

```js
export const BRAND = { name: 'Static', short: 'aether', wordmark: 'aether',
                       tagline: 'taste the spaghetti code', icon: 'diamond', … };
```

Change `name`/`wordmark` and the whole product renames itself. The crimson palette ramp is
`--aether-50 … --aether-900` in `css/tokens.css`, with `--cherri-*` kept as aliases.

## Auto-sync — new titles appear on their own

`js/portal/anime.data.js` checks the **live site first** and only falls back to the
bundled JSON when it cannot reach it:

```js
sync.remote = {
  anime: 'https://anicade.surge.sh/js/data/anime_data.json',
  manga: 'https://anicade.surge.sh/js/data/manga_data.json',
};
```

So anything added to that site is in Static on the next page load — no rebuild, no code
change. `syncStatus('anime')` reports which source won, the row count and the timing;
`refresh('anime')` re-checks on demand. Point `sync.remote.anime` somewhere else to change
the feed, or set it to `null` to pin the catalogue to the bundled copy.

`node tools/sync-anime.mjs` refreshes the offline snapshots in `data/` (it prints the row
delta, so you can see what the site gained). Worth running before a deploy.

## Auto-embed — one template, every title

Nothing is wired per-anime. `providers.config.animeSource` is a URL template filled from
each record's own ids, so a title added to the site plays the moment it appears:

```js
import { config } from './js/portal/providers.js';
config.animeSource = 'https://your-host/embed/{type}/{tmdb}/{season}/{episode}';
```

| placeholder | from the record |
| --- | --- |
| `{tmdb}` `{imdb}` `{anilist}` `{mal}` `{mangadex}` | its external ids |
| `{season}` `{episode}` | `tmdbSeason` and the chosen episode (default 1) |
| `{type}` | `tv` or `movie`, detected from the record |
| `{dub}` | `config.dub`, `'sub'` or `'dub'` |

`providers.embedFor(record, {episode, season, dub})` builds one directly.
If the template needs an id a record does not carry, it returns `null` rather than a
half-filled URL, and that title stays honestly unavailable. Keep several hosts in
`config.animeSources = { name: template }` and switch with `config.animeSourceId`.
`config.movieSource` does the same for the film catalogue.

The template ships empty — set it to whatever source you intend to use and
`static://anime/<id>` becomes a player with no further wiring.

## Where the data comes from

| file | what | source |
| --- | --- | --- |
| `js/portal/catalog.js` | the curated shelf, 22 movies, proxy links, open positions | your Google Takeout of *big bros games* |
| `data/games.json` | ~890 games, generated | `tools/sync-games.mjs` ← gamemonetize + gamepix feeds + the curated set |
| `data/anime.json` | 7,963 anime (7.9 MB) | `anicade.surge.sh/js/data/anime_data.json` |
| `data/manga.json` | 1,200 manga (1.4 MB) | `anicade.surge.sh/js/data/manga_data.json` |

**More games:** `node tools/sync-games.mjs [--pages N]` rebuilds `data/games.json` from
the GameMonetize and GamePix publisher feeds — both distribute their games for embedding
and ship their own title art. Titles are de-duplicated against the curated shelf, which
always wins. If `data/games.json` is missing the portal falls back to the curated set.

**Games really play.** Each entry keeps the embed URL the old site used
(`madkidgames.com/full/<slug>`, plus `smashkarts.io` and the Poly Track mirror). Those
hosts send `frame-ancestors *` or no frame policy at all, so `static://games/<id>` frames
them for real. If a host ever starts refusing, the stage notices the missing `load` event
after 6s and offers "open it directly".

**Anime and manga records keep every external id** — `malId`, `tmdbId`, `imdbId`,
`anilistId`, `tmdbSeason`, `mangadexId`. The detail page shows them in a copyable table,
because those ids are all a player needs.

## The one seam that matters

Everything asks `js/portal/providers.js` for data, and nothing else. To point Static at a
real backend:

```js
import { config } from './js/portal/providers.js';
config.mode     = 'proxy';
config.endpoint = 'https://your-host/api';
config.key      = '…';           // optional
```

The provider then calls `GET {endpoint}/search|games|movies|trending|resolve` and every
page keeps working unchanged, because each function returns the same shape in both modes:

| function | returns | async |
| --- | --- | --- |
| `searchWeb(q,{page})` | `{query,page,total,took,answer,results[],related[]}` | yes |
| `listGames({category,q,sort})` | `{items,total,categories}` | yes |
| `listMovies({category,q,sort})` | `{items,total,categories}` | yes |
| `trending()` | `{games,movies,queries}` | yes |
| `resolve(target)` | `{kind:'embed'\|'unavailable'\|'blocked', url?, reason?, ids?}` | yes |
| `getGame(id)` `getMovie(id)` | item \| null | no |
| `artFor(title,kind)` | a CSS background string | no |
| `bigCatalogue.query({…})` | `{items,total,page,pages,genres,years}` | no (after `load()`) |

`config.simulateOutage = true` makes local mode throw, so you can work on the error states
without a backend.

**`resolve()` is the only thing a proxy really owns.** Games answer it locally today.
Movies, anime and manga come back `unavailable` with a reason — that is the single
function to change when you have a source.

In proxy mode `resolve()` asks the proxy first and uses its `{kind:'embed', url}`. If the
proxy is down or has no source for that item, a game with its own frameable embed still
falls back to playing locally rather than going dark. `getGame()`/`getMovie()` also
remember every item a list or trending call handed out, so a title the proxy supplied
resolves on its own detail page instead of 404-ing.

## What I deliberately left out

- **Discord** — you said not yet. The start-page pill and the Chat tile are inert; the
  Discord button in `extras.js`'s positions form is just a text field.
- **Filter evasion** — the old site's `about:blank` / "game tab" cloaking is not ported.
  The proxy page is a plain bookmark list, the same content the old page had.
- **Streaming hosts** — `anicade`'s `player.js` built embed URLs against a list of
  third-party streaming sites. Those are not hardcoded here. The catalogue, the ids and
  the seam are all in place, so adding your own source is a change to one function.

## Auto-update

The site notices when it has been rebuilt: `tools/bump.mjs` stamps `build.json` with a
sha1 of every source file, `js/core/updater.js` polls it (and re-checks on tab focus), and
a change raises a real "Update available" notification with a Restart action. Run
`./watch.sh` alongside `./serve.sh` and every save you make shows up that way;
`prefs.autoUpdate` chooses notify / auto-restart / off, exposed in Settings ▸ About.

## Styling it

Every page is built from the `.cx-*` classes at the end
of [css/apps.css](css/apps.css) — page shell, hero, filter chips, cards, detail, play
stage, search results, knowledge panel, pager, skeletons. No page module contains a
colour; they all read `css/tokens.css`. Restyling the portal means editing that one CSS
block, not the page modules.

## Roblox — `static://roblox`

Roblox is the one service that refuses every normal way in, so it is worth writing down
exactly what was tried and what each host actually answered.

```
www.roblox.com/games/<id>                x-frame-options: SAMEORIGIN
www.roblox.com/embed/<id>                x-frame-options: SAMEORIGIN
www.roblox.com/game-details/<id>         x-frame-options: SAMEORIGIN
www.roblox.com/Thumbs/Asset.ashx         404  (the old image endpoints are gone)
www.roblox.com/asset-thumbnail/image     404
games.roblox.com/v1/games?universeIds=   200, no access-control-allow-origin
thumbnails.roblox.com/v1/games/icons     200, no access-control-allow-origin
apis.roblox.com/search-api/omni-search   200, no access-control-allow-origin
tr.rbxcdn.com/<hash>/512/512/Image/Png   200 image/png, no CORS header
```

So nothing Roblox serves can go in an iframe, and no Roblox API can be read by `fetch()`
from a page. Two things still work, and the page is built on both.

**1. `<img>` has never needed CORS.** That asymmetry is the whole trick. `tools/sync-roblox.mjs`
runs in Node — where the same-origin rule does not exist — walks 40 search terms through
Roblox's own omni-search, resolves each universe, and bakes names, creators, player counts,
ratings, visit totals and the `tr.rbxcdn.com` art URLs into `data/roblox.json`. The browser
then renders the genuine Roblox artwork straight from Roblox's CDN.

```bash
node tools/sync-roblox.mjs              # ~1,300 experiences
node tools/sync-roblox.mjs --terms 40   # cast a wider net
```

A chunk that comes back empty is retried at half the size, down to single ids, because a
rate-limit blip on one 50-id batch would otherwise silently drop 50 experiences' metadata.

**2. `roblox://experiences/start?placeId=<id>`** is Roblox's own deep link, lifted from the
markup their `/games/start` page serves. It hands the place id to the installed Roblox
player, which opens straight into the experience with no web page in between — strictly
better than the "open a tab" fallback every other front-end settles for. On mobile the
scheme is `robloxmobile://placeID=<id>`. Static hands it over through a hidden iframe so
that a machine with no Roblox installed fails quietly in that frame instead of throwing a
browser error page over the OS, and offers the web launcher alongside.

**Live player counts** are off by default, because reading them needs CORS. Set up the
proxy worker (below) and they switch on: `roblox.data.js` tops the baked numbers up through
`<worker>/raw?url=…`. One setup, two features.

## Proxy — `static://proxy`

A proxy has to make the outbound request for you, and a static site cannot. That is why
this page used to hand the job to other people's services, and why most of them could only
open a tab. Re-probed 2026-09-24:

```
4everproxy                     frameable, POST /query, no CSRF     -> usable in-frame
croxyproxy / blockaway /       frameable, but POST /servers needs a
  croxyproxy.rocks             per-session CSRF token readable only
                               from their own page                 -> unusable
hide.me / proxysite / proxyium x-frame-options: SAMEORIGIN         -> tab only
```

So Static now brings two of its own.

**Static Reader** (`js/portal/proxy.reader.js`) — no setup at all. A few public relays
re-serve any URL *with* an `Access-Control-Allow-Origin` header, which is enough for
`fetch()` to read the bytes. Static then does the rest itself: `DOMParser` parses it, every
attribute not on a keep-list is dropped (which removes every `on*` handler in one pass),
scripts, iframes, objects and embeds are removed outright, links are rewritten to navigate
back through the reader, and the result is painted in Static's own typography. It never
opens a tab. Scripts do not run, so anything that is really an application will not work.

The relays are flaky per-target — allorigins answered `wikipedia.org` and `522`'d on
`example.com` in the same minute — so `fetchPage` walks the pool with an 11-second budget
each and moves on, rather than trusting any single one.

**Static Proxy Worker** (`tools/aether-proxy.worker.js`) — the real thing, in one file, on
Cloudflare's free tier.

```bash
npx wrangler deploy tools/aether-proxy.worker.js --name aether-proxy
# or paste the file into the dashboard: Workers & Pages -> Create -> Worker
```

Then Proxy → Engine → **My proxy** → paste the URL. It fetches the target, rewrites every
`href`, `src`, `srcset`, form `action` and CSS `url()` through itself with `HTMLRewriter`,
injects a shim that re-points runtime `fetch`, `XMLHttpRequest` and `window.open`, follows
redirects server-side so the browser stays on the worker's origin, drops the upstream's
`x-frame-options` and `content-security-policy`, and adds CORS. Full pages, scripts
included, inside the Static window.

Verified end-to-end against a local `wrangler dev`: `news.ycombinator.com` renders inside
the window with all 229 links live, and `/raw?url=` returns Roblox's games API with
`access-control-allow-origin: *`, which is what turns the live player counts on.

`ALLOW` at the top of the worker is `*`. Narrow it to your own origin if you ever put the
worker somewhere public.

## The proxy that actually works — `static://proxy`

The earlier engines all ran into the same wall: `X-Frame-Options`. A site that sends `SAMEORIGIN`
cannot be put in an iframe, and the browser enforces that before any of our code runs.

Ultraviolet sidesteps the wall instead of attacking it. A service worker registered at the site
root intercepts `/service/<encoded-url>`, fetches the real page through an encrypted WebSocket
tunnel, rewrites it, and serves it back as if it came from `staticos.surge.sh`. The iframe is
pointed at **our** origin, so `SAMEORIGIN` is satisfied trivially and the target's CSP is rewritten
away on the way through.

```
/sw.js                      the worker — at the root, because a worker's scope
                            can never be broader than its own path
/uv/*                       Ultraviolet 3.2.10, the rewriter
/baremux/*                  bare-mux 2.1.6, the request multiplexer
/epoxy/index.mjs            epoxy-transport 3.0.1, the tunnel
/epoxy/baremux-adapter.mjs  the fix (below)
```

**The bug that cost the most to find.** Everything registered, the transport reported itself set,
and every request came back as a bodyless HTTP 500. The warning the console kept printing —
`bare-mux: failed to get a bare-mux SharedWorker MessagePort within 1s, retrying` — was a red
herring; it is a cold-start race that self-heals and appears on successful runs too.

The real cause was a contract mismatch. bare-mux 2.1.6 passes `headers` as a **plain object**;
epoxy 3.0.1 does `for (const [k, v] of headers)` and so needs an **iterable of pairs**. It threw
`TypeError: headers is not iterable` before a byte reached the tunnel, bare-mux reported it back,
and Ultraviolet turned it into its generic 500 — which is why nothing surfaced. `baremux-adapter.mjs`
is a four-method subclass that normalises both directions. (epoxy **2.1.28** is the object-headers
generation and works without the shim, if you would rather drop a file than keep one.)

**The tunnel endpoint** is the one thing a static site cannot host. Three public wisp servers are
used with failover — Mercury Workshop's demo, Terbium and Anura. All three completed real Wisp
handshakes when probed. They are other people's free infrastructure, they are rate-limited, and
Mercury's operator explicitly asks that it not be used for public-facing sites. Static fails over
between them and says which one it is on.

Verified rendering in a real browser frame: `google.com`, `youtube.com`, `en.wikipedia.org`,
`roblox.com/discover` (4,286 nodes, 317 images) and `cineosweb.github.io` — a GitHub-hosted site the
target network blocks outright.

## Cloud gaming — the honest verdict

Every commercial service refuses, and a header check is **not** enough to establish that:

```
play.geforcenow.com   CSP frame-ancestors 'self' … + drops the tunnel's TLS handshake
xbox.com/play         x-frame-options: DENY
luna.amazon.com       x-frame-options: DENY
now.gg                x-frame-options: SAMEORIGIN
nowgg.fun             landing page is header-clean, then 302s to 76.ip.nowgg.fun
                      which sends SAMEORIGIN — BLOCKED in a real browser
streamex.sh           header-clean, pulls google.com into its own frame — blocked
app.apponfly.com      header-clean, frame never materialises
```

The last three matter: they all pass `curl -I` and all fail in a browser. That is how the now.gg
Roblox tile ends up on sites that copy each other — it looks verified and is a dead frame. The only
test that counts is loading it in a real frame and reading what rendered.

So Static Cloud does not try to put them in a window. "Where can I play it?" searches the game
lists the services publish (GeForce NOW, Xbox Cloud Gaming, Boosteroid, Antstream Arcade, Blacknut;
`tools/sync-cloud-games.mjs` → `data/cloud-games.json`, each list dated when fetched) and Play opens
the service's own page in a new tab, where you sign in with your own account. Luna and now.gg
publish no list, so they are offered as links only.

What does work in a window is emulation. `archive.org/embed/<id>` sends no frame headers at all and serves a
full in-browser emulator, and `archive.org/advancedsearch.php` answers with
`access-control-allow-origin: *` — so the library is searched live rather than baked. 8,929 MS-DOS
titles alone, across eight collections.

## Roblox, live — `static://roblox`

Roblox's own APIs send no CORS header, so a browser `fetch()` of them is refused. **roproxy.com**
is a public mirror of the same endpoints that does send `access-control-allow-origin: *`, which
turns on live player counts, live votes, live search and live public-server lists with nothing to
deploy and no key:

```
games.roproxy.com/v1/games?universeIds=…          live CCU, visits, favourites
games.roproxy.com/v1/games/votes?universeIds=…    up/down votes
games.roproxy.com/v1/games/<placeId>/servers/…    real public servers
thumbnails.roproxy.com/v1/…                       every thumbnail type
apis.roproxy.com/search-api/omni-search           live search across all of Roblox
```

The baked catalogue stays the source of truth for what exists; the mirror only tops up numbers that
go stale. If it is unreachable the page still renders with the last sync's figures and a chip that
says so — it never invents one.

## Games — 5,891 playable

`tools/sync-embeds.mjs` bulk-imports from the two networks built for embedding, both verified
header-clean:

```
games.crazygames.com/en_US/<slug>/index.html   ~840 (incl. Polytrack)
html5.gamedistribution.com/<md5>/              ~4,200
```

CrazyGames publishes a sitemap of ~4,400 slugs but no metadata API and client-rendered pages, so
title, artwork and description come from each page's Open Graph tags — which doubles as an
existence check, since roughly one slug in ten is third-party-hosted and 404s on the CDN.
GameDistribution's GraphQL endpoint is CORS-open but caps every query at 100 results and ignores
`offset`, so it is harvested by fanning out ~94 search terms and deduplicating on id.

```bash
node tools/sync-embeds.mjs                 # everything
node tools/sync-embeds.mjs --only crazy    # one source
```
