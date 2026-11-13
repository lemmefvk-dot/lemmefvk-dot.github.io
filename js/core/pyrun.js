/* ============================================================
   pyrun.js — real Python for Code, in a sealed box.

   Engine: Pyodide (CPython 3.14 compiled to WebAssembly), vendored
   in vendor/pyodide/ — no CDN at run time. Loaded only when a
   Python file is first Run; nothing here is in the offline copy.

   Where it runs (three layers, outermost first):
     1. an <iframe sandbox="allow-scripts"> — an opaque origin, like
        the HTML preview (core/sandbox.js): it cannot read StaticOS's
        localStorage, IndexedDB, caches, cookies or DOM, and cannot
        reach the parent page;
     2. a Web Worker made inside that frame, which holds the
        interpreter — so the page stays responsive however long a
        program runs, and Stop really ends it: killing the frame
        terminates the worker, wherever Python was;
     3. Python itself, with an in-memory file system: a copy of the
        project folder, made at Run. Edits it makes there are lost;
        nothing is written back to StaticOS.
   Because the worker's origin is opaque it cannot fetch the engine
   from the site, so the page downloads the files (with real
   progress), and hands the bytes in over postMessage.

   input() and sys.stdin work through WebAssembly JSPI (stack
   switching): Python waits for the answer without freezing the
   worker. Chromium 137+ and Edge have it; where it is missing
   input() raises EOFError and says so (inputSupported tells the UI).

   create({ host, onOut(stream, text), onInput(prompt), onStage(text) })
     -> { ready, run({ files, main }), answer(text), kill(), state, assetsReady }
   download(onProgress(fraction, doneBytes, totalBytes)) -> assets
   ============================================================ */

const BASE = 'vendor/pyodide/';
/* the files' real sizes, for the progress bar (the server may compress, so
   Content-Length is not the count of bytes we receive) */
export const ASSETS = [
  ['pyodide.asm.wasm', 9598218],
  ['python_stdlib.zip', 2545637],
  ['pyodide.asm.mjs', 1250344],
  ['pyodide.mjs', 17931],
];
export const TOTAL_BYTES = ASSETS.reduce((n, a) => n + a[1], 0);
export const LIMITS = { files: 300, bytes: 5 * 1024 * 1024 };

let assetsP = null;

/** Fetch the engine's files, reporting real bytes as they arrive. Once per
    page load: a later Run (or a Run after Stop) reuses them. */
export function download(onProgress) {
  if (assetsP) return assetsP;
  const got = new Array(ASSETS.length).fill(0);
  const report = () => {
    const done = got.reduce((n, v) => n + v, 0);
    onProgress?.(Math.min(1, done / TOTAL_BYTES), done, TOTAL_BYTES);
  };
  const one = async ([name], i) => {
    const res = await fetch(new URL(BASE + name, document.baseURI), { cache: 'default' });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    const reader = res.body.getReader();
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got[i] += value.byteLength;
      report();
    }
    const out = new Uint8Array(got[i]);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.byteLength; }
    got[i] = ASSETS[i][1];
    return out.buffer;
  };
  report();
  assetsP = Promise.all(ASSETS.map(one)).then(([wasm, stdlib, asm, mjs]) => {
    report();
    return { wasm, stdlib, asm, mjs };
  });
  assetsP.catch(() => { assetsP = null; });
  return assetsP;
}

/* ---------------- inside the frame: a relay between page and worker ---------------- */
function frameMain() {
  var worker = null;
  var post = function (m) { parent.postMessage(m, '*'); };
  addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.__py !== 1) return;
    if (d.t === 'boot') {
      var mk = function (buf, type) { return URL.createObjectURL(new Blob([buf], { type: type })); };
      var asmURL = mk(d.asm, 'text/javascript');
      var mjsURL = mk(d.mjs, 'text/javascript');
      try {
        worker = new Worker(mk('(' + d.worker + ')()', 'text/javascript'));
      } catch (err) { post({ __py: 1, t: 'fatal', text: 'Could not start the worker: ' + (err && err.message || err) }); return; }
      worker.onmessage = function (m) { post(m.data); };
      worker.onerror = function (ev) { post({ __py: 1, t: 'fatal', text: 'The Python worker stopped: ' + (ev.message || 'unknown error') }); };
      worker.postMessage({ t: 'init', asmURL: asmURL, mjsURL: mjsURL, wasm: d.wasm, stdlib: d.stdlib }, [d.wasm, d.stdlib]);
    } else if (worker) worker.postMessage(d);
  });
  post({ __py: 1, t: 'frame' });
}

/* ---------------- inside the worker: the interpreter ---------------- */
function workerMain() {
  /* pyodide.mjs refuses a classic worker (it probes importScripts); a module worker cannot be made from an opaque origin's blob, so hide the probe */
  self.importScripts = function () { throw new Error('importScripts is not available'); };
  var send = function (m) { m.__py = 1; self.postMessage(m); };
  var py = null;
  var pending = null;
  var jspi = false;

  var LOCK = { info: { abi_version: '2026_0', arch: 'wasm32', platform: 'emscripten_5_0_3', python: '3.14.2' }, packages: {} };

  /* the Python side: runs one program with a fresh namespace, prints
     tracebacks the way python does (without the runner's own frames),
     and wires input() / sys.stdin to the page */
  var HARNESS = [
    'import sys, os, builtins, traceback, shutil, importlib',
    'import js',
    'from pyodide.ffi import run_sync, can_run_sync',
    'WORK = "/home/pyodide/work"',
    'class _Stdin:',
    '    encoding = "utf-8"',
    '    errors = "strict"',
    '    def isatty(self): return False',
    '    def readable(self): return True',
    '    def readline(self, size=-1):',
    '        return _ask("")',
    '    def read(self, size=-1):',
    '        out = []',
    '        while True:',
    '            line = _ask("")',
    '            if not line: break',
    '            out.append(line)',
    '        return "".join(out)',
    '    def __iter__(self): return self',
    '    def __next__(self):',
    '        line = self.readline()',
    '        if not line: raise StopIteration',
    '        return line',
    'def _ask(prompt):',
    '    if not can_run_sync():',
    '        raise EOFError("input() needs a browser with WebAssembly JSPI (Chrome or Edge 137 or newer); this one does not have it")',
    '    sys.stdout.flush()',
    '    answer = run_sync(js.__staticos_ask(prompt))',
    '    return answer',
    'def _input(prompt=""):',
    '    if prompt:',
    '        sys.stdout.write(str(prompt)); sys.stdout.flush()',
    '    line = _ask(str(prompt))',
    '    if line == "": raise EOFError("EOF when reading a line")',
    '    return line[:-1] if line.endswith("\\n") else line',
    'def staticos_run(main):',
    '    for name, mod in list(sys.modules.items()):',
    '        f = getattr(mod, "__file__", None)',
    '        if isinstance(f, str) and f.startswith(WORK + "/"): del sys.modules[name]',
    '    importlib.invalidate_caches()',
    '    os.chdir(WORK)',
    '    sys.path[:] = [p for p in sys.path if p != WORK]',
    '    sys.path.insert(0, WORK)',
    '    builtins.input = _input',
    '    sys.stdin = _Stdin()',
    '    g = {"__name__": "__main__", "__file__": main, "__builtins__": builtins}',
    '    try:',
    '        with open(main, encoding="utf-8") as fh: src = fh.read()',
    '        exec(compile(src, main, "exec"), g)',
    '        return 0',
    '    except SystemExit as e:',
    '        c = e.code',
    '        if c is None: return 0',
    '        if isinstance(c, int): return c',
    '        sys.stderr.write(str(c) + "\\n"); return 1',
    '    except BaseException as e:',
    '        te = traceback.TracebackException(type(e), e, e.__traceback__)',
    '        te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename != "<exec>"])',
    '        sys.stderr.write("".join(te.format()).replace(WORK + "/", ""))',
    '        return 1',
    'def staticos_clear():',
    '    shutil.rmtree(WORK, ignore_errors=True)',
    '    os.makedirs(WORK, exist_ok=True)',
  ].join('\n');

  var realFetch = self.fetch;

  self.__staticos_ask = function (prompt) {
    return new Promise(function (resolve) { pending = resolve; send({ t: 'input', prompt: String(prompt || '') }); });
  };

  async function init(d) {
    send({ t: 'stage', text: 'Starting Python…' });
    /* the engine looks for its files by URL; there is no site to fetch them from in here */
    self.fetch = function (u, o) {
      var url = String((u && u.url) || u);
      if (/pyodide\.asm\.wasm$/.test(url)) return Promise.resolve(new Response(d.wasm, { headers: { 'Content-Type': 'application/wasm' } }));
      if (/python_stdlib\.zip$/.test(url)) return Promise.resolve(new Response(d.stdlib, { headers: { 'Content-Type': 'application/zip' } }));
      return realFetch.call(self, u, o);
    };
    var mod = await import(d.mjsURL);
    var asm = (await import(d.asmURL)).default;
    py = await mod.loadPyodide({
      indexURL: 'https://pyodide.invalid/',
      lockFileContents: LOCK,
      createPyodideModule: asm,
      env: { PYTHONUNBUFFERED: '1', HOME: '/home/pyodide' },
      fullStdLib: false,
    });
    self.fetch = realFetch;
    var dec = new TextDecoder();
    var decE = new TextDecoder();
    py.setStdout({ write: function (b) { var s = dec.decode(b, { stream: true }); if (s) send({ t: 'out', text: s }); return b.length; } });
    py.setStderr({ write: function (b) { var s = decE.decode(b, { stream: true }); if (s) send({ t: 'err', text: s }); return b.length; } });
    py.runPython(HARNESS);
    /* can_run_sync() is only true inside a call that is already switching stacks, so ask the browser */
    jspi = typeof WebAssembly.Suspending === 'function' && typeof WebAssembly.promising === 'function';
    send({ t: 'ready', version: py.version, jspi: jspi });
  }

  async function run(d) {
    try {
      var clear = py.globals.get('staticos_clear');
      clear(); clear.destroy();
      var root = '/home/pyodide/work';
      var made = {};
      d.files.forEach(function (f) {
        var dir = root + '/' + f.path.split('/').slice(0, -1).join('/');
        dir = dir.replace(/\/$/, '');
        if (!made[dir]) { py.FS.mkdirTree(dir); made[dir] = 1; }
        py.FS.writeFile(root + '/' + f.path, f.text);
      });
      var fn = py.globals.get('staticos_run');
      var code = jspi ? await fn.callPromising(d.main) : fn(d.main);
      fn.destroy();
      send({ t: 'done', id: d.id, code: Number(code) });
    } catch (err) {
      send({ t: 'err', text: String(err && err.message || err) + '\n' });
      send({ t: 'done', id: d.id, code: 1 });
    }
  }

  self.onmessage = function (e) {
    var d = e.data;
    if (!d) return;
    if (d.t === 'init') init(d).catch(function (err) { send({ t: 'fatal', text: 'Python could not start: ' + (err && err.message || err) }); });
    else if (d.t === 'run') run(d);
    else if (d.t === 'answer' && pending) { var r = pending; pending = null; r(String(d.text)); }
  };
}

function frameHtml() {
  return `<!doctype html><meta charset="utf-8"><body><script>(${frameMain})()<\/script>`;
}

/** Make an engine: a hidden sealed frame (with its worker) inside `host`. */
export function create({ host, onOut, onInput, onStage } = {}) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = 'Python runner';
  frame.className = 'cpy__frame';
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  frame.srcdoc = frameHtml();

  const E = { dead: false, state: 'loading', jspi: false, version: '', runId: 0, runWait: null };
  let readyRes, readyRej;
  const ready = new Promise((res, rej) => { readyRes = res; readyRej = rej; });
  ready.catch(() => {});
  let booted = false;

  const toFrame = (msg, transfer) => { try { frame.contentWindow.postMessage({ __py: 1, ...msg }, '*', transfer || []); } catch (e) { /* frame gone */ } };

  const onMsg = e => {
    if (E.dead || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.__py !== 1) return;
    if (d.t === 'frame' && !booted) { booted = true; E.onFrame?.(); }
    else if (d.t === 'stage') onStage?.(String(d.text));
    else if (d.t === 'ready') { E.state = 'idle'; E.jspi = !!d.jspi; E.version = String(d.version || ''); readyRes(E); }
    else if (d.t === 'out') onOut?.('out', String(d.text));
    else if (d.t === 'err') onOut?.('err', String(d.text));
    else if (d.t === 'input') onInput?.(String(d.prompt || ''));
    else if (d.t === 'done') { E.state = 'idle'; const w = E.runWait; E.runWait = null; w?.({ code: d.code }); }
    else if (d.t === 'fatal') { const msg = String(d.text); E.state = 'dead'; readyRej(new Error(msg)); const w = E.runWait; E.runWait = null; w?.({ code: 1, error: msg }); }
  };
  window.addEventListener('message', onMsg);
  host.appendChild(frame);

  /** Hand the downloaded engine to the worker. Resolves when Python is up. */
  E.boot = assets => {
    const send = () => toFrame({
      t: 'boot', worker: String(workerMain),
      wasm: assets.wasm.slice(0), stdlib: assets.stdlib.slice(0), asm: assets.asm.slice(0), mjs: assets.mjs.slice(0),
    });
    if (booted) send(); else E.onFrame = send;
    return ready;
  };
  E.ready = ready;
  E.run = ({ files, main }) => new Promise(resolve => {
    if (E.dead || E.state !== 'idle') { resolve({ code: 1, error: 'Python is not ready.' }); return; }
    E.state = 'running';
    E.runWait = resolve;
    toFrame({ t: 'run', id: ++E.runId, files, main });
  });
  E.answer = text => toFrame({ t: 'answer', text: String(text) });
  /** Stop: removing the frame ends its worker, wherever Python was. */
  E.kill = () => {
    if (E.dead) return;
    E.dead = true;
    E.state = 'dead';
    window.removeEventListener('message', onMsg);
    frame.remove();
    readyRej(new Error('stopped'));
    const w = E.runWait; E.runWait = null; w?.({ code: null, stopped: true });
  };
  E.frame = frame;
  return E;
}

export default { create, download, ASSETS, TOTAL_BYTES, LIMITS };
