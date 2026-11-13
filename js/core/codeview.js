/* ============================================================
   codeview.js — the Python pane in Code's preview column.

   pyPane({ h, icon, clear }) -> { el, run({ files, main, dir, known, reveal }), stop(), dispose(), running }

   · Nothing is downloaded until the first Run. Then a real progress
     bar counts the engine's bytes (core/pyrun.js), "Starting Python…"
     while it boots, and the program's output streams in live.
   · stdout and stderr stay apart (errors are red). Tracebacks keep
     their file and line numbers, and a line that names a project file
     gets a button that jumps there.
   · input() shows a one-line field under the output; Enter sends it.
   · Stop ends the program wherever it is — even  while True: pass —
     by removing the sealed frame its worker lives in.
   · Everything Python prints is added as text, never as HTML.
   ============================================================ */

const MAX_OUT = 300000;          /* characters kept on screen */
const FLUSH_MAX = 120000;        /* characters one frame will paint: a program that prints forever cannot freeze the page */

export function pyPane({ h, icon, clear }) {
  const status = h('span.cpy__status', { role: 'status', 'aria-live': 'polite', text: 'Press Run to run this file' });
  const stopBtn = h('button.btn.btn--sm.btn--ghost.cpy__stop', { type: 'button', 'aria-label': 'Stop the program', onclick: () => stop() }, icon('square'), h('span', { text: 'Stop' }));
  const clearBtn = h('button.btn.btn--sm.btn--ghost', { type: 'button', 'aria-label': 'Clear the output', onclick: () => clearOut() }, icon('trash'), h('span', { text: 'Clear' }));
  stopBtn.hidden = true;
  const barFill = h('i');
  const progLabel = h('span.cpy__proglabel');
  const prog = h('div.cpy__prog', { hidden: true },
    progLabel,
    h('div.bar', { role: 'progressbar', 'aria-label': 'Downloading Python', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, barFill));
  const out = h('pre.cpy__pre', { role: 'log', 'aria-label': 'Program output', tabindex: '0' });
  const inField = h('input.cpy__field', { type: 'text', 'aria-label': 'Program input', spellcheck: 'false', autocomplete: 'off', placeholder: 'Type your answer and press Enter' });
  const inRow = h('form.cpy__inrow', { hidden: true, onsubmit: e => { e.preventDefault(); sendInput(); } },
    icon('chevron-right'), inField,
    h('button.btn.btn--sm', { type: 'submit' }, h('span', { text: 'Send' })));
  const note = h('p.cpy__note', { text: 'Python runs in a sealed worker. It can read a copy of this folder’s text files and use the standard library; it can’t see your other files, saved data or settings, and nothing it writes is kept. Stop ends it.' });
  const el = h('div.cpy', h('div.cpy__head', icon('terminal'), h('b', { text: 'Python' }), status, h('div.grow'), clearBtn, stopBtn), prog, out, inRow, note);

  const S = { eng: null, seq: 0, running: false, cur: null, chars: 0, queue: [], raf: 0, errBuf: '', errT: 0, known: () => false, reveal: null, cut: false, dead: false };

  const setStatus = t => { status.textContent = t; };
  const setRunning = on => { S.running = on; stopBtn.hidden = !on; if (!on) inRow.hidden = true; };

  function trim() {
    while (S.chars > MAX_OUT && out.firstChild) {
      const over = S.chars - MAX_OUT;
      const first = out.firstChild;
      const len = first.textContent.length;
      if (len <= over) { first.remove(); S.chars -= len; }
      else { first.firstChild.deleteData(0, over); S.chars -= over; }
      S.cut = true;
    }
  }
  function put(kind, text, goTo) {
    if (!text) return;
    let node = S.cur && S.cur.kind === kind && !goTo ? S.cur.node : null;
    if (!node) {
      node = h(`span.cpy__${kind}`);
      node.append(document.createTextNode(''));
      out.appendChild(node);
      S.cur = { kind, node };
    }
    node.firstChild.appendData(text);
    S.chars += text.length;
    if (goTo) { out.appendChild(goTo); S.cur = null; }
    trim();
  }
  function clearOut() {
    S.queue = []; S.cur = null; S.chars = 0; S.cut = false; S.errBuf = '';
    clear(out);
  }
  const stick = () => out.scrollHeight - out.scrollTop - out.clientHeight < 40;

  function paint() {
    S.raf = 0;
    if (S.dead) return;
    const near = stick();
    let text = S.queue.map(q => q.text).join('');
    const kinds = S.queue;
    S.queue = [];
    if (text.length > FLUSH_MAX) {
      /* more than a frame can show: keep the tail, and say so once */
      put('sys', '\n… output was too fast to show, some was skipped …\n');
      let keep = FLUSH_MAX, tail = [];
      for (let i = kinds.length - 1; i >= 0 && keep > 0; i--) { const t = kinds[i].text.slice(-keep); tail.unshift({ ...kinds[i], text: t }); keep -= t.length; }
      for (const q of tail) emit(q.kind, q.text);
    } else for (const q of kinds) emit(q.kind, q.text);
    if (near) out.scrollTop = out.scrollHeight;
  }
  function emit(kind, text) {
    if (kind === 'err') errLines(text);
    else put(kind, text);
  }
  /* stderr a line at a time, so a traceback line that names a file can carry a jump button */
  function errLines(text) {
    S.errBuf += text;
    clearTimeout(S.errT);
    let i;
    while ((i = S.errBuf.indexOf('\n')) >= 0) {
      const ln = S.errBuf.slice(0, i + 1);
      S.errBuf = S.errBuf.slice(i + 1);
      const m = /^\s*File "([^"]+)", line (\d+)/.exec(ln);
      let go = null;
      if (m && S.known(m[1]) && S.reveal) {
        const file = m[1], line = Number(m[2]);
        go = h('button.cpv__go', { type: 'button', title: `Show ${file}:${line} in the editor`, 'aria-label': `Go to ${file}:${line}`, onclick: () => S.reveal(file, line) }, h('span', { text: `${file}:${line}` }));
      }
      put('err', ln.replace(/\n$/, ''), go);
      put('err', '\n');
    }
    if (S.errBuf) S.errT = setTimeout(flushErr, 120);
  }
  function flushErr() {
    clearTimeout(S.errT);
    if (S.errBuf) { const t = S.errBuf; S.errBuf = ''; put('err', t); }
  }
  const queue = (kind, text) => {
    S.queue.push({ kind, text });
    if (!S.raf) S.raf = requestAnimationFrame(paint);
  };
  const flushNow = () => { if (S.raf) { cancelAnimationFrame(S.raf); paint(); } flushErr(); };

  function sendInput() {
    const text = inField.value;
    inField.value = '';
    inRow.hidden = true;
    flushNow();
    put('in', text + '\n');
    out.scrollTop = out.scrollHeight;
    S.eng?.answer(text + '\n');
  }

  function killEngine() {
    S.eng?.kill();
    S.eng = null;
  }
  function stop(say = true) {
    S.seq++;
    const was = S.running || !!S.eng;
    flushNow();
    killEngine();
    prog.hidden = true;
    setRunning(false);
    if (was && say) { put('sys', '\n■ Stopped.\n'); setStatus('Stopped'); }
  }

  const fail = (my, text) => {
    if (my !== S.seq || S.dead) return;
    flushNow();
    prog.hidden = true;
    killEngine();
    setRunning(false);
    put('err', `${text}\n`);
    setStatus('Could not run');
  };

  async function run({ files, main, known, reveal }) {
    if (S.dead) return;
    const my = ++S.seq;
    S.known = known || (() => false);
    S.reveal = reveal || null;
    if (S.eng && S.eng.state === 'running') killEngine();
    clearOut();
    inRow.hidden = true;
    setRunning(true);
    const P = await import('./pyrun.js');
    if (my !== S.seq) return;
    if (!S.eng || S.eng.dead || S.eng.state === 'dead') {
      S.eng = null;
      setStatus('Getting Python ready…');
      prog.hidden = false;
      const mb = n => (n / 1048576).toFixed(1);
      const show = (f, done, total) => {
        const pct = Math.round(f * 100);
        barFill.style.width = `${pct}%`;
        prog.querySelector('.bar').setAttribute('aria-valuenow', String(pct));
        progLabel.textContent = `Downloading Python once for this visit: ${mb(done)} of ${mb(total)} MB`;
        setStatus(`Downloading Python… ${pct}%`);
      };
      let assets;
      try { assets = await P.download(show); }
      catch (e) { fail(my, `Python couldn’t be downloaded (${e.message || e}). It is a one-time download of about ${mb(P.TOTAL_BYTES)} MB from this site; check the connection and press Run again.`); return; }
      if (my !== S.seq) return;
      progLabel.textContent = 'Starting Python…';
      setStatus('Starting Python…');
      barFill.style.width = '100%';
      const eng = P.create({
        host: el,
        onOut: (kind, text) => queue(kind, text),
        onInput: () => { if (S.dead || !S.running) return; flushNow(); inRow.hidden = false; inField.focus({ preventScroll: true }); setStatus('Waiting for your input'); },
        onStage: t => { if (my === S.seq) { progLabel.textContent = t; } },
      });
      S.eng = eng;
      try { await eng.boot(assets); }
      catch (e) { if (my === S.seq) fail(my, `Python couldn’t start (${e.message || e}).`); return; }
      if (my !== S.seq) return;
      prog.hidden = true;
      if (!eng.jspi) put('sys', 'Note: input() isn’t available in this browser (it needs WebAssembly JSPI: Chrome or Edge 137 or newer). A program that calls input() gets an EOFError.\n');
    }
    setStatus(`Running ${main}`);
    const r = await S.eng.run({ files, main });
    if (my !== S.seq) return;
    flushNow();
    setRunning(false);
    if (r.error) { put('err', `${r.error}\n`); setStatus('Stopped'); return; }
    put('sys', r.code === 0 ? `\n✓ Finished.\n` : `\n✗ Exited with code ${r.code}.\n`);
    setStatus(r.code === 0 ? 'Finished' : `Exited with code ${r.code}`);
  }

  return {
    el,
    run,
    stop,
    get running() { return S.running; },
    get engine() { return S.eng; },
    dispose() { S.dead = true; S.seq++; cancelAnimationFrame(S.raf); clearTimeout(S.errT); killEngine(); },
    /** drop the engine (frees its memory) without any message */
    release() { stop(false); },
  };
}

export default { pyPane };
