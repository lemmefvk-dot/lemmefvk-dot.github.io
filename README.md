# StaticOS 3.0 — Static shell

A desktop-operating-system **frontend** that runs in a browser tab: a top menu bar with a
live tray, a launcher, a magnifying dock, a widget rail, and real floating windows you can
drag, resize, snap, minimise and stack. It is the StaticOS layout wearing the **Static**
theme from `frontendmockup.html`, and the original start page lives on as the Browser
app's start page.

No build step, no dependencies, no backend.

## Run it

```sh
./serve.sh            # → http://localhost:8000   (ES modules need http://, not file://)
                      #   re-stamps build.json every 2 s while it runs, so the open
                      #   tab offers "Update available" as you work
./watch.sh            # the same re-stamping on its own, for another server
```

Any static server works; `python3 -m http.server` is what `serve.sh` uses. With another
server, keep `build.json` current (`./watch.sh`) or delete it: StaticOS keeps an offline
copy of each build (`sw.js`) and serves that build's files until `build.json` changes.

## Offline, and fast on the second visit

After the first visit StaticOS starts from a copy on the device — no network needed for
the desktop, Files, Notes, Settings or the built-in Arcade — and only asks the network
for `build.json` (2.5 s at most) to see whether there is a new build. Apps load when
they are first opened, not at start-up. The second half of `sw.js` explains the copy;
Settings ▸ Storage shows whether it is ready.

## Deploy it

```sh
./deploy.sh                      # → staticos.surge.sh
./deploy.sh mysite.surge.sh      # → your domain
```

In the GitHub repo, pushing to `main` does the same thing with no computer on:
`.github/workflows/deploy.yml` runs the tests, then publishes.

It stamps `build.json` before uploading, so any tab already open on the live site raises
**Update available** within ~20 seconds and can restart into the new build. The downloadable
archive is included in deploys; dev scripts and local-only files stay out of the upload.

## Download a copy

Open `download.html` in the running site and download `takeout-staticos.zip`. Extract the
archive, then run `./serve.sh` on macOS/Linux or `py -m http.server 8000` on Windows and
open `http://localhost:8000`. Serve the files over HTTP; opening `index.html` directly
does not support the ES modules and service workers StaticOS needs.

The Cloud VMs app also offers `staticos-launcher.html`, a tiny one-file shortcut to the
hosted site at `https://staticos.surge.sh/`. The launcher needs an internet connection;
it does not contain the StaticOS website. Use the full ZIP for an offline/local copy.
In the Cloud VMs app, **Download my data (.json)** saves this browser's local StaticOS
storage and IndexedDB data. The export can contain private account details and device
keys, so keep it secure. In Settings → Privacy or Cloud VMs, choose **Import my data**
to restore a backup. Import replaces the current browser's saved StaticOS data after
confirmation; close other StaticOS tabs first.

## The Static portal

The Browser app hosts the **Static portal**: 5,891 playable games, 7,963 anime, 1,200 manga, a film
catalogue, 1,311 Roblox experiences, a search engine and a real proxy — plus the "apply for
positions" page carried over from the old *big bros games* site. It all lives in `js/portal/` and
reads from one data seam. See **[PORTAL.md](PORTAL.md)**.

**Static Proxy** is the headline. A service worker on Static's own origin fetches pages through an
encrypted WebSocket tunnel and serves them back as ours — so the target's `X-Frame-Options` never
applies, because the iframe is pointed at us. Google, YouTube, Wikipedia and Roblox's own site all
render inside the window. Directory choices stay inside the app; the explicit localhost toolbar
action opens the local Proxy app in a separate tab. There are **207 searchable routes** in the
directory behind it, and a status store that records what has actually been confirmed rather than
what was claimed. Five additional Sitenable mirrors are listed as untested candidates and can be
checked from the Proxy directory; existing proxy choices are retained. See `js/portal/uv.js` and
`tools/aether-proxy.worker.js`.
The Proxy toolbar's **Open in localhost tab** action targets
`http://localhost:8000/#app=aether-proxy`; run the local StaticOS server first
(`./serve.sh` on macOS/Linux) for that tab to open.

Browser, VS Code, TikTok, Spotify, Roblox, and Xbox Cloud use locally rendered branded SVG icons.

**Static Roblox** shows 1,311 experiences with genuine `rbxcdn` artwork and **live** player counts,
ratings and public server lists, read through a CORS mirror of Roblox's own API — no setup, no key.
Search falls through to the live catalogue when the baked one runs out. Playing still needs the
Roblox client; the page hands off to it and says so.

**Static Cloud** answers "where can I play this game?": one typo-tolerant search across the lists
GeForce NOW, Xbox Cloud Gaming, Boosteroid, Antstream Arcade and Blacknut publish themselves
(`data/cloud-games.json`, rebuilt and dated by `node tools/sync-cloud-games.mjs`). Each result says
what that service asks of you — Game Pass, owning it on Steam or Epic, a free tier — and Play opens
the service's own site in a new tab; favourites stay on this device. It also runs the Internet
Archive's in-browser emulator — thousands of DOS, arcade and console titles, searched live.

**Everything is measured, not invented.** The System Monitor reads frame rate, JS heap, storage,
transferred bytes and page timing from real browser APIs, and names what a page simply cannot see —
host CPU, GPU, disk, other processes — instead of animating a fake dial.

## Cloud VMs

The **Cloud VMs** app links to third-party services; StaticOS does not host or proxy virtual
machines. Genymotion Cloud offers individuals a limited 60-minute trial by request. Windows 365
is a paid Cloud PC service, and Microsoft currently says it is not available to individuals.
Check each provider's current trial terms, eligibility, pricing, and OS licensing before use.

## What's in the box

**Shell** — boot splash · lock screen · wallpaper (fully procedural: planet, ridgelines,
lake, Static dot-grid) · desktop icons + context menu · top bar with app menus, clock and
a working tray (Wi-Fi, Bluetooth, volume, battery, Game Mode, Control Centre) · launcher
with pinned apps, recents and all-apps · dock with running indicators, badges and
magnification · widget rail (clock, weather, system monitor with live rings and
sparklines, now playing, Game Mode, Static community marquee) · notification toasts and a
notification centre · ⌘K spotlight (apps, files, commands, inline arithmetic) · ⌘\`
window overview.

**Static Chat** — spaces, channels, replies, reactions, typing and presence, laid out
across the top rather than in the usual three columns. **Staticum** — an assistant that
actually drives the OS (open apps, find games and anime, change the look, report system
state) and is honest that it runs locally rather than pretending to be a model. Both have
a swappable engine: see [ARCHITECTURE.md](ARCHITECTURE.md).

**Apps** — Files · Browser (the Static start page) · Static Roblox · Static Store · Settings · Music · TikTok ·
Photos · Videos · VS Code · Notes · Calculator · Calendar · Weather · System Monitor ·
Camera · Clock · Lens · Feedback · Cloud VMs · About. Settings → Privacy can export or
replace saved StaticOS data from a JSON backup and download the full website ZIP for USB.
The terminal (a real shell over the virtual
filesystem, with `neofetch`) is not an app: it lives in the Linux drive's wallpaper
(js/shell/deskterm.js mounts js/apps/terminal.js's engine there).

Proxy toolbar links open a new tab at the same StaticOS origin (including localhost when
running locally).

**Static Forge** gets independent drafts from three free coding models in parallel; a
main reviewer compares them and synthesizes the best result before sandbox testing.
OpenRouter's free models are used: availability, latency, and rate limits can vary. A
free OpenRouter API key is required; it stays in page memory only and is cleared on
reload. OpenRouter currently allows up to 50 free-model API requests per day without
purchased credits; a typical game uses at least five requests. Prompts and code are sent
to OpenRouter and its selected model providers.

Forge also works with no key at all: nine complete templates (js/forge/) — six all-year
games and three Halloween ones that sit on top of Create from Oct 24 to Nov 1 — each one
standalone HTML file with its settings in a JSON block. **Remix** starts a new game from
any game you made: change its name, description and settings with a live preview, save it
as a new game that credits the original, and the original stays exactly as it was.

## Keyboard

| | |
| --- | --- |
| `⌘K` / `⌘Space` | Spotlight |
| `⌘\`` | Window overview |
| `⌘W` / `⌘M` | Close / minimise window |
| `⌘Tab` | Cycle windows |
| `⌥⌘←` `⌥⌘→` `⌥⌘↑` | Snap left / right / maximise |
| `⌃⌥←` `⌃⌥→` `⌃⌥↑` `⌃⌥↓`, `⌃⌥1`–`4` | Snap to a half / a quarter |
| `⌃⌥Z`, or rest on the green button | Snap layouts: halves, thirds, quarters |
| `⌃←` `⌃→` (or `⌃⌘←` `⌃⌘→`, which a Mac lets through) | Previous / next desktop |
| `⌃⌥⇧←` `⌃⌥⇧→` | Take the front window to the next desktop |
| `⌃↑` | Overview with the desktop strip |
| `⌃⌘Q` | Lock screen |
| drag a window to a screen edge | snap (halves, quarters, maximise) — drag it away for its own size back |
| two-finger swipe (or one finger on touch) over the bare desktop | switch desktop |

## Layout

```
index.html
css/    tokens.css → base.css → window.css → shell.css → apps.css
js/core/    dom bus store util icons vfs registry wm desktops api
js/shell/   boot topbar dock launcher widgets notifications
            contextmenu spotlight overview lockscreen desktop
            desktops snaplayouts
js/apps/    one self-registering module per app
```

`ARCHITECTURE.md` is the contract: the app API, the bus events, and the rules
(no hardcoded colours, no new CSS files, build DOM with `h()`).

## Making it real

Everything that will eventually need a backend is already behind one module, so wiring it
up is a swap, not a rewrite:

**TikTok** opens its full scrolling feed in a regular browser tab. TikTok's site blocks
being embedded inside StaticOS.

| seam | today | to make it real |
| --- | --- | --- |
| `js/core/vfs.js` | in-memory tree | same API over a real FS (Tauri/Electron `fs`, WebDAV, OPFS, S3) |
| `store.get('live')` | synthetic drift in `js/main.js` | poll a telemetry endpoint / `sysinfo` IPC |
| `store.get('system')` | static facts | read from the host once at boot |
| `js/apps/terminal.js` | commands implemented against the vfs | forward the line to a real PTY, stream output back |
| `js/portal/providers.js` | local catalogues | `config.mode = 'proxy'` + an endpoint (see CHERRI.md) |
| `js/apps/browser.js` | internal `static://` pages | a `<webview>` / iframe per tab |
| `js/apps/monitor.js` | ring buffers off `live` | real process list + `kill` |
| `js/apps/store.js` | mock catalogue | package index + install jobs |
| `js/shell/notifications.js` | bus events | OS notification bridge |

Persisted state lives in `localStorage` under `staticos.state.v3`
(`window.Static.reset()` clears it). `window.Static` also exposes `api`, `wm`, `store`
and `bus` for poking at the running system from the console.

`frontendmockup.html` is kept unchanged as the original design reference.

## Wallpapers

The desktop takes four kinds of wallpaper: the built-in procedural scene, generated CSS
presets that re-tint with the accent, and any **video, GIF or still image** you point it
at by URL. Settings ▸ Appearance has the picker, an "add by URL" row, and a redeem box:
a wallpaper added with an unlock code stays hidden until that code is typed.
Everything lives in `js/portal/wallpapers.js`; nothing is downloaded into the repo.

Settings ▸ Wallpaper also has:

- **Rotation** (`js/core/wprotate.js`): a new picture every 15 minutes, hour or day, or each
  time StaticOS starts, from a folder in Files (`~/Pictures` by default) or wallpapers you
  tick; shuffled or in name order, cross-faded (a cut with Reduce motion). Files that don't
  open are skipped and named in Settings. Picking a wallpaper by hand turns it off.
- **Day and Night** (`js/core/daycycle.js`, art from `tools/daycycle-art.mjs`): one scene in
  four lights blended by the local time — fixed sunrise 6:30 / sunset 19:30, or the real ones
  for the place in Weather, worked out locally.
- **Weather on the wallpaper** (`js/core/wpweather.js`, drawn by `js/shell/wallplus.js`):
  rain, snow, cloud, fog or sun glare for the place in Weather, asked of Open-Meteo at most
  every 30 minutes; "Weather unavailable" and no effect when it can't be had.

Settings ▸ Themes ▸ **Auto (from wallpaper)** (`js/core/wpaccent.js`) picks the accent out of
whatever wallpaper is showing (rotation and Day and Night included) and `themes.js` fits it
so text on it passes WCAG AA. In spooky season the haunted house steps aside when rotation is
switched on (it counts as picking a wallpaper), rotation waits while the house is up, and the
season's orange accent wins over Auto until the season ends.
