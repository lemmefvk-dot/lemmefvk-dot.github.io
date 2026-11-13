/* ============================================================
   classics/frame.js — the document a Free Classics game runs in.

   The game gets an <iframe sandbox="allow-scripts …" srcdoc="…"> with
   NO allow-same-origin, so its origin is opaque. From in there it
   cannot read localStorage, IndexedDB, Cache Storage or cookies, and
   it cannot touch the page above it: StaticOS's files, settings and
   private keys are out of reach, whatever the game's code does. The
   content security policy below also gives it no network at all.

   Having no storage and no fetch is why everything crosses postMessage:
   runner.js downloads the files and hands them in, and saved games are
   copied out to the database that runner.js keeps for them.

   frameMain() runs inside the frame, from its own source text. It can
   use nothing from this module: only its argument and the frame's
   own globals.
   ============================================================ */

/* 'unsafe-eval' and 'wasm-unsafe-eval' are for WebAssembly, 'unsafe-inline' for
   this document's own scripts, blob: for the game's script. No connect-src, no
   http(s) source anywhere: a game cannot send or fetch anything. */
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'worker-src blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/* A sandbox without allow-modals ignores alert() and friends; no need to touch them. */
function frameMain(cfg) {
  const post = (m, transfer) => parent.postMessage(m, '*', transfer || []);
  const fail = why => post({ t: 'error', message: String(why && why.message || why).slice(0, 400) });

  /* the function keys are the game's (F5 is Beneath a Steel Sky's save menu),
     not the browser's: F5 must not reload StaticOS out from under a game */
  addEventListener('keydown', e => {
    if (/^F([1-9]|10)$/.test(e.key)) e.preventDefault();
  }, true);

  /* a link in the game would otherwise navigate this frame away from the game */
  addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    e.preventDefault();
    post({ t: 'link', href: a.getAttribute('href') });
  }, true);

  /* Sound: every path out goes through a gain we control, so mute is instant
     and also holds for a context the game resumes by itself. */
  let muted = !!cfg.muted;
  const gains = [];
  const meters = [];
  const contexts = [];
  const Native = window.AudioContext;
  if (Native) {
    const Wrapped = class extends Native {
      constructor(...args) {
        super(...args);
        const out = this.createGain();
        const meter = this.createAnalyser();
        out.gain.value = muted ? 0 : 1;
        out.connect(meter);
        meter.connect(super.destination);
        gains.push(out);
        meters.push(meter);
        contexts.push(this);
        Object.defineProperty(this, 'destination', { value: out });
      }
    };
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
  }
  /* read by the test suite, which has no other way to see inside a game */
  window.__classic = {
    audio: () => contexts.map(c => c.state),
    /* the loudest sample going out right now, 0 to 1: is sound really being made? */
    level: () => meters.reduce((peak, m) => {
      const buf = new Float32Array(m.fftSize);
      m.getFloatTimeDomainData(buf);
      return buf.reduce((p, v) => Math.max(p, Math.abs(v)), peak);
    }, 0),
    log: [],
  };
  const logLine = line => {
    const log = window.__classic.log;
    log.push(String(line).slice(0, 300));
    if (log.length > 60) log.shift();
  };

  addEventListener('error', e => { logLine(`error: ${e.message}`); post({ t: 'problem', message: String(e.message).slice(0, 300) }); });

  /* The page sort of game keeps its saves in localStorage, which this origin does
     not have: touching it throws. This one starts from the saves handed in, and
     everything set on it goes straight out to the page above. */
  if (cfg.localStorage) {
    const data = new Map(Object.entries(cfg.saved || {}));
    const shim = {
      getItem: k => (data.has(String(k)) ? data.get(String(k)) : null),
      setItem: (k, v) => { data.set(String(k), String(v)); post({ t: 'save', path: `localStorage/${k}`, data: String(v) }); },
      removeItem: k => { data.delete(String(k)); post({ t: 'del', path: `localStorage/${k}` }); },
      clear: () => { for (const k of data.keys()) post({ t: 'del', path: `localStorage/${k}` }); data.clear(); },
      key: i => [...data.keys()][i] ?? null,
      get length() { return data.size; },
    };
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  }

  /* Saved games in an Emscripten game: whenever it closes a file it wrote,
     look through the watched folders and send out whatever changed. */
  function watchSaves(FS, dirs) {
    const seen = new Map();
    const walk = (dir, out) => {
      let names;
      try { names = FS.readdir(dir); } catch (err) { return out; }
      for (const name of names) {
        if (name === '.' || name === '..') continue;
        const p = `${dir}/${name}`;
        const st = FS.stat(p);
        if (FS.isDir(st.mode)) walk(p, out);
        else out.push([p, `${st.size}:${+st.mtime}`]);
      }
      return out;
    };
    const scan = report => {
      const now = new Map();
      for (const d of dirs) for (const [p, sig] of walk(d, [])) now.set(p, sig);
      for (const [p, sig] of now) {
        if (seen.get(p) === sig) continue;
        seen.set(p, sig);
        if (!report) continue;
        const bytes = FS.readFile(p);
        post({ t: 'save', path: p, data: bytes.buffer }, [bytes.buffer]);
      }
      for (const p of [...seen.keys()]) {
        if (now.has(p)) continue;
        seen.delete(p);
        if (report) post({ t: 'del', path: p });
      }
    };
    scan(false);
    let timer = 0;
    const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; scan(true); }, 40); };
    const wrap = (name, after) => {
      const orig = FS[name];
      FS[name] = function (...args) {
        const r = orig.apply(this, args);
        after(...args);
        return r;
      };
    };
    wrap('close', stream => { if (stream && (stream.flags & 3)) soon(); });   /* O_WRONLY | O_RDWR */
    wrap('unlink', soon);
    wrap('rename', soon);
  }

  /* A game that draws to a fixed-shape canvas keeps its shape: the canvas is placed
     in the frame by hand (not object-fit, which would throw off SDL's mouse position). */
  function keepAspect(canvas, aspect) {
    const fit = () => {
      const w = Math.min(innerWidth, innerHeight * aspect);
      const h = w / aspect;
      const set = (k, v) => canvas.style.setProperty(k, v, 'important');
      set('position', 'absolute');
      set('left', `${(innerWidth - w) / 2}px`);
      set('top', `${(innerHeight - h) / 2}px`);
      set('width', `${w}px`);
      set('height', `${h}px`);
    };
    addEventListener('resize', fit);
    fit();
  }

  function bootWasm(b) {
    const canvas = document.getElementById('canvas');
    if (b.aspect) keepAspect(canvas, b.aspect);
    const Module = {
      arguments: b.args.slice(),
      canvas,
      wasmBinary: b.wasm,
      print: logLine,
      printErr: logLine,
      preRun: [() => {
        const FS = Module.FS;
        const mkdirs = path => {
          let at = '';
          for (const part of path.split('/').filter(Boolean)) {
            at += `/${part}`;
            try { FS.mkdir(at); } catch (err) { /* already there */ }
          }
        };
        const put = f => {
          mkdirs(f.path.slice(0, f.path.lastIndexOf('/')));
          FS.writeFile(f.path, new Uint8Array(f.data));
        };
        for (const d of b.watch) mkdirs(d);
        b.files.forEach(put);
        b.saves.forEach(put);
        watchSaves(FS, b.watch);
      }],
      onRuntimeInitialized: () => { post({ t: 'running' }); try { canvas.focus(); } catch (err) { /* fine */ } },
      onAbort: fail,
      onExit: () => post({ t: 'exit' }),
    };
    window.Module = Module;
    const url = URL.createObjectURL(new Blob([b.glue], { type: 'text/javascript' }));
    const s = document.createElement('script');
    s.src = url;
    s.onerror = () => fail('The game’s code would not load.');
    document.head.appendChild(s);
  }

  addEventListener('message', e => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m) return;
    if (m.t === 'boot') { try { bootWasm(m); } catch (err) { fail(err); } }
    else if (m.t === 'mute') {
      muted = !!m.on;
      for (const g of gains) g.gain.value = muted ? 0 : 1;
    } else if (m.t === 'focus') {
      window.focus();
      const target = document.getElementById('canvas');
      if (target) target.focus();
    }
  });

  if (cfg.type === 'page') {
    addEventListener('DOMContentLoaded', () => post({ t: 'running' }));
  } else {
    post({ t: 'ready' });
  }
}

/* JSON is safe inside a script once it cannot close the tag; U+2028 has been legal in strings since ES2019 */
const safeJson = v => JSON.stringify(v).replace(/</g, '\\u003c');

const bootstrap = cfg => `<script>(${frameMain.toString()})(${safeJson(cfg)});</script>`;
const csp = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;

/** The frame for an Emscripten game: a canvas that fills it. */
export function wasmDocument(cfg) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' + csp
    + '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}'
    + 'canvas{display:block;width:100%;height:100%;outline:none;image-rendering:pixelated}</style></head>'
    + `<body><canvas id="canvas" tabindex="0"></canvas>${bootstrap(cfg)}</body></html>`;
}

/** A self-contained game page: the policy and the bootstrap go in first, before any of its own script. */
export function pageDocument(html, cfg) {
  const at = html.search(/<head[^>]*>/i);
  if (at < 0) throw new Error('The game page has no <head>.');
  const end = html.indexOf('>', at) + 1;
  return html.slice(0, end) + csp + bootstrap(cfg) + html.slice(end);
}
