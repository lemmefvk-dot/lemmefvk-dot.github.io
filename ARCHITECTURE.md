# StaticOS 3.0 — frontend architecture

A desktop-shell frontend: the **StaticOS** layout (top bar, launcher, dock,
widget rail, floating windows) wearing the crimson-glass theme derived from
`frontendmockup.html`. That mockup's page survives as the Browser app's start
page. Everything is a static frontend today, but every seam that will later
need real data is already a module boundary.

    index.html
    build.json                 build fingerprint, polled by js/core/updater.js
    offline.json               what sw.js keeps for offline (tools/bump.mjs writes both)
    sw.js                      the proxy (/service/) + the offline copy of the shell
    data/      anime.json manga.json          (the big catalogues)
    css/   tokens.css → base.css → window.css → shell.css → apps.css
    js/core/   dom bus store util icons vfs registry wm api updater
               apploader (apps load on first open) appearance offline
               desktops (the list of desktops; wm.js moves the windows)
    js/shell/  boot topbar dock launcher widgets notifications
               contextmenu spotlight lockscreen overview desktop
               desktops (⌃←/→, swipes, HUD) snaplayouts (the maximise-button picker)
    js/apps/   files terminal browser settings music monitor code notes
               calculator calendar photos videos weather camera store about
               portal          (portal pages hosted as OS apps)
               manifest.js     every app's metadata, generated (see below)
    js/portal/ brand providers catalog anime.data pages
               games movies anime search extras   ← see PORTAL.md
    tools/bump.mjs  +  watch.sh                   ← the auto-update stamp

**Naming.** One constant, `js/portal/brand.js`, owns the product name. Every
visible string reads from it, so renaming the product is a one-line change.
`static://` URLs still resolve as aliases of `static://`.

## Rules

1. **No hardcoded colours.** Only `var(--…)` tokens from `css/tokens.css`.
   Switching `data-accent` on `<html>` must retheme the whole OS.
2. **No new CSS files.** Use the kit in `css/apps.css` (`.app`, `.app__side`,
   `.side__item`, `.app__bar`, `.card`, `.list`, `.btn`, `.field`, `.tabs`,
   `.set-row`, `.empty`, `.badge`, `.bar`, `.stat`, …). If something truly
   needs a new rule, keep it in a `<style>`-free JS-set inline style.
3. **Build DOM with `h()`** from `js/core/dom.js`. No innerHTML for structure.
4. **Apps never import shell modules.** Talk through `ctx.api` / the bus.
5. **Everything must work with no network and no backend.**
6. Keyboard reachable: real `<button>`s, `aria-label` on icon-only controls.

## App contract

```js
import { defineApp } from '../core/registry.js';

defineApp({
  id: 'files', name: 'Files', icon: 'folder',
  g1: '#7ab8ff', g2: '#2b62d9',        // glyph gradient (light → dark)
  category: 'System',                   // System | Media | Productivity | Internet | Utilities
  keywords: ['finder', 'browse'],
  desc: 'Browse your files',
  pinned: true,  dock: true,  singleton: false,
  handles: ['text', 'code'],            // vfs kinds this app opens
  win: { w: 740, h: 470, minW: 460, minH: 300 },
  mount(ctx) { /* … */ return () => {/* teardown */}; },
});
```

**Apps load on demand.** Nothing imports an app module at boot. The shell
knows every app from `js/apps/manifest.js` — a generated copy of each
`defineApp()`'s metadata — and `js/core/apploader.js` imports the module the
first time the app mounts (the window shows "Opening …" meanwhile). Add an
app with `cd tests && node app-manifest.mjs <module>`, and re-run it after
changing an app's name, icon, category or window size; the `apps-manifest`
suite fails until you do. Anything that must happen without the app's window
— a global listener, a preference applied all session — belongs in a core
module (see `js/core/appearance.js`), or in the loader's `WAKE` table (Music
is woken by `media:play` and handed the event through its exported `wake()`).

`ctx` = `{ root, win, opts, api }`

* `root` — the `.win__body` element. Append one child with class `app`.
* `win` — `setTitle(s)`, `setSubtitle(s)`, `setLead(...nodes)` (left of the
  title: back/forward), `setTools(...nodes)` (right side of the title bar),
  `setBarClass(c)`, `close()`, `focus()`, `minimize()`, `toggleMax()`,
  `snap(side)` — `left right max up down tl tr bl br l3 c3 r3 l23 r23`
  (halves, quarters, thirds, two-thirds; `wm.snapRect(side)` gives the rect),
  `moveToDesktop(id, {follow})`, `onClose(fn)`, `onResize(fn)`, `onFocus(fn)`,
  `onReopen(fn)`, `rect`, `desk` (the desktop it is on), `snapped`, `max`,
  `state` (free scratch object). `state.reopen = { path | url | … }` says
  what the window shows now, once it has moved on from its `opts`: a closed
  window comes back with ⇧⌘T showing that (`js/core/reopen.js`).
* Window movement is transform/opacity only. A snap or maximise sets the
  real geometry once (one `onResize`) and draws the move with a FLIP
  transform; it never animates `left/top/width/height`. Every transition
  is timed frame by frame with `metrics.track()` (System Monitor shows it).
* `opts` — whatever `openApp`/`openFile` passed, e.g. `{path, file}`.
* `api` — see below.

## ctx.api

| member | what |
| --- | --- |
| `h, q, qa, on, render, clear, toggle, placeInView, raf` | DOM helpers |
| `icon(name, opt?)` | `<span class="icon">` with an SVG; `icon('play',{fill:true})` |
| `fmt` | `fmtBytes fmtAgo fmtClock fmtDur fmtDateLong dayName monthName clamp round drift seeded sparkPath smoothPath throttle debounce modLabel` |
| `vfs` | `node ls read write mkdir touch rm rename mv size iconFor recent search walk norm parentPath baseName HOME` |
| `store` | `get(path) set(path,v) patch(path,obj) sub(path,fn)` |
| `bus` | `on(evt,fn) emit(evt,…)` |
| `wm` | `open close focus list byApp toggleApp workArea` |
| `openApp(id,opts)` `openFile(path,appId?)` | launch |
| `notify({app,title,message,icon,actions,timeout})` | toast |
| `menu(items,x,y)` | context menu; items `{label,icon,hint,onClick,danger,disabled}` or `'-'` |
| `confirm({title,message,ok,cancel})` | → Promise\<bool\> |
| `spotlight() lock() overview()` | shell actions |
| `live` `system` `prefs` | telemetry + settings snapshots |

Icon names: see `iconNames()` in `js/core/icons.js` (135 of them, plus
aliases). Never invent one — check first, or use a close alias.

## Bus events

| event | payload | who emits |
| --- | --- | --- |
| `win:open` `win:close` `win:focus` `win:minimize` `win:restore` `win:list` | window | wm |
| `win:snap` `win:unsnap` `win:max` `win:desk` | window | wm |
| `desktop:switch` | `{from, to, dir}` | wm |
| `desktops:change` | `{kind, list, current}` | desktops |
| `metrics:transition` | `{label, frames, dropped, worst, …}` | metrics |
| `app:open` | `{id, opts}` | shell |
| `noti:push` | notification | anyone |
| `menu:open` | `{items,x,y}` | anyone |
| `menu:extend` | `{items, extra}` — push rows into `extra` to put them on top of the menu opening | shell/contextmenu.js (Read aloud adds itself) |
| `ambient:change` | `state()` of the ambient sounds | js/core/ambient.js (Music › Ambient sounds) |
| `ambient:stop` | — | Control Centre, Sound menu |
| `speech:change` | `state()` of read aloud | js/core/speech.js |
| `speech:read-selection` `speech:read` `speech:stop` | — / text / — | Spotlight, Settings → shell/readaloud.js |
| `spotlight:open` | query string | shell |
| `overview:toggle` | — | shell |
| `power:lock` `power:sleep` `power:restart` | — | shell |
| `fs:change` | `(dirPath, path)` | vfs |
| `state:change` | `(path, value)` | store |
| `media:play` `media:pause` `media:next` `media:prev` `media:seek` `media:track` | track | Music ⇄ widget |
| `tick:1s` `tick:5s` | `Date` | main loop |
| `win:playing` | window (its `state.playing` = `{kind, id, title, icon}` or null) | Static Games, Arcade — read by Screen Time |
| `focus:change` | `state()` of the focus timer | js/core/focus.js (Clock › Focus) |
| `screentime:change` | — (history cleared) | js/core/screentime.js |
| `theme:change` | prefs | Settings |

## Chat and Staticum

Two apps ship with their logic split out as an engine, so the UI can be replaced without
touching behaviour — and a real backend can be swapped in without touching the UI.

**`js/portal/chat.transport.js`** is the seam under Static Chat. Every read and write goes
through it: `listSpaces` `listChannels` `listMessages` `send` `react` `edit` `remove`
`members` `markRead` `draft` `setTyping` `subscribe`. All of it is async and event-driven,
so a socket slots straight in:

```js
import { config } from './js/portal/chat.transport.js';
config.mode = 'live';
config.endpoint = 'wss://your-host/chat';
```

In local mode it persists to `store` under `portal.chat`, seeds four spaces and ten
channels, and a small cast replies so the room is not silent. `config.ambient = 0` turns
the simulated replies off.

**`js/portal/aetherium.js`** is the assistant engine. It is a **skill engine, not a
language model**, and it says so rather than bluffing: each skill declares what it matches
and does the real thing — opening apps, querying the game and anime catalogues, changing
theme/accent/density, reporting live system stats, searching the filesystem, arithmetic,
media control. Anything no skill claims gets an honest "that is outside what I do" plus an
offer to search.

To put a real model behind it, without ever hardcoding a key:

```js
import { config } from './js/portal/aetherium.js';
config.mode = 'api';
config.endpoint = 'https://api.anthropic.com/v1/messages';
config.model = 'claude-sonnet-4-5';
config.apiKey = '…';   // entered by the user, stored in their browser only
```

`ask()` then forwards only what the skills did not claim, so the local actions keep
working. `ask(text, ctx)` always resolves to
`{say, kind, chips[], cards[], did}` in both modes.

## Auto-update

`tools/bump.mjs` writes `build.json`, a sha1 of every source file. The running
page polls it (and re-checks on tab focus) and raises a real "Update available"
notification when it changes; `prefs.autoUpdate` chooses notify / auto-restart /
off, and Settings ▸ About exposes it. `./watch.sh` re-stamps on every save, so a
local edit surfaces the same way a deploy does (`./serve.sh` does it too).

## Offline copy

`sw.js` keeps a copy of the app shell per build (`staticos-shell-<build>`),
filled after start-up from `offline.json`; files whose hash didn't change are
copied from the previous build's copy. Each visit asks the network for
`build.json` (2.5 s at most): a new id becomes the current build, no answer
serves the copy. A tab stays on the build it started with, so apps it opens
later come from that build's copy; a build's copy goes when no tab runs it.
`data/*.json` is network-first, `build.json` and `data/broadcast.json` always
come from the network. The updater asks `build.json?running` for its baseline
(the worker answers with the tab's own build) and tells the worker which build
to serve before "Restart now" reloads. Suites: `offline`, `update-flow`.

## Running it

    ./serve.sh            # http://localhost:8000
    ./watch.sh            # optional: re-stamp build.json on every save
