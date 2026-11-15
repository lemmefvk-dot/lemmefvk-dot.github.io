/* ============================================================
   codefmt.js — Format in Static Code.

   HTML, CSS and JavaScript go through js-beautify 1.15.4 (MIT,
   vendor/jsbeautify/, licence and checksum in its README). It is
   fetched only the first time someone presses Format, and runs in a
   Web Worker of its own: the formatter's code never touches the
   page, and a file that takes it too long can be given up on. It is
   not part of the offline copy, so Format needs the network once per
   visit. JSON is laid out by core/codeedit.js's prettyJson, which
   copies numbers and strings as written.

     canFormat(lang)                    'html' | 'css' | 'js' | 'json'
     format(text, lang, { unit })  ->   { ok, text } | { ok: false, error, line? }
   ============================================================ */
import { prettyJson } from './codeedit.js';

const SRC = 'vendor/jsbeautify/beautifier.min.js';
const TIMEOUT = 15000;

export const canFormat = lang => lang === 'html' || lang === 'css' || lang === 'js' || lang === 'json';

/* the worker: load the formatter once, then format on request */
function workerMain() {
  var ready = false;
  self.onmessage = function (e) {
    var d = e.data || {};
    if (d.t === 'load') {
      try { importScripts(d.url); ready = !!(self.beautifier && self.beautifier.js); postMessage({ t: ready ? 'ready' : 'fail', text: ready ? '' : 'the formatter did not load' }); }
      catch (err) { postMessage({ t: 'fail', text: String((err && err.message) || err) }); }
      return;
    }
    if (d.t !== 'fmt') return;
    try {
      var B = self.beautifier;
      var fn = d.lang === 'css' ? B.css : d.lang === 'html' ? B.html : B.js;
      postMessage({ t: 'done', id: d.id, text: fn(d.text, d.opts) });
    } catch (err) { postMessage({ t: 'done', id: d.id, error: String((err && err.message) || err) }); }
  };
}

let W = null;          /* { worker, ready: Promise } */
let seq = 0;
const waits = new Map();

function start() {
  if (W) return W;
  const url = new URL(SRC, document.baseURI).href;
  const blob = new Blob([`(${workerMain})()`], { type: 'text/javascript' });
  const bu = URL.createObjectURL(blob);
  const worker = new Worker(bu);
  let res, rej;
  const ready = new Promise((a, b) => { res = a; rej = b; });
  ready.catch(() => {});
  ready.finally(() => URL.revokeObjectURL(bu)).catch(() => {});
  worker.onmessage = e => {
    const d = e.data || {};
    if (d.t === 'ready') res();
    else if (d.t === 'fail') { rej(new Error(d.text)); stop(); }
    else if (d.t === 'done') { const w = waits.get(d.id); waits.delete(d.id); w?.(d); }
  };
  worker.onerror = ev => { rej(new Error(ev.message || 'the formatter stopped')); stop(); };
  worker.postMessage({ t: 'load', url });
  W = { worker, ready };
  return W;
}

function stop() {
  if (!W) return;
  W.worker.terminate();
  W = null;
  for (const [, w] of waits) w({ error: 'The formatter stopped.' });
  waits.clear();
}

/** Lay a whole file out again. unit is one indent: '  ', '    ' or '\t'. */
export async function format(text, lang, { unit = '  ' } = {}) {
  if (lang === 'json') {
    const r = prettyJson(text, unit);
    return r.ok ? r : { ok: false, error: `This isn’t valid JSON${r.line ? ` (line ${r.line})` : ''}: ${r.error}`, line: r.line };
  }
  if (!canFormat(lang)) return { ok: false, error: 'Format works on HTML, CSS, JavaScript and JSON files.' };
  const w = start();
  try { await w.ready; }
  catch (e) { return { ok: false, error: `The formatter couldn’t be loaded (${e.message || e}). It is fetched from this site the first time you press Format; check the connection and try again.` }; }
  const tabs = unit === '\t';
  const opts = {
    indent_size: tabs ? 1 : unit.length, indent_char: tabs ? '\t' : ' ', indent_with_tabs: tabs,
    end_with_newline: true, preserve_newlines: true, max_preserve_newlines: 2, extra_liners: [],
    wrap_line_length: 0,
  };
  const id = ++seq;
  const d = await new Promise(resolve => {
    const t = setTimeout(() => { waits.delete(id); stop(); resolve({ error: 'The formatter took too long on this file and was stopped.' }); }, TIMEOUT);
    waits.set(id, r => { clearTimeout(t); resolve(r); });
    w.worker.postMessage({ t: 'fmt', id, lang, text, opts });
  });
  if (d.error) return { ok: false, error: d.error };
  return { ok: true, text: String(d.text) };
}

/** Let the worker go (the window closed). */
export function release() { stop(); }

export default { canFormat, format, release };
