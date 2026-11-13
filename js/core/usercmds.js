/* ============================================================
   usercmds.js — your own terminal commands.

   A custom command is a real file, ~/.commands/<name>.js, so it
   survives reloads, shows up in Files (hidden folder) and opens in
   Code. Typing its name in the terminal runs the file.

   The code runs in a sandbox — a hidden iframe with only
   allow-scripts, so it gets an opaque origin: it cannot read
   StaticOS's storage, files, cookies or windows, cannot navigate
   the page, and cannot open popups. Imported code from anywhere is
   therefore safe to run. It gets:

     args      the words after the command name (array of strings)
     print()   write a line to the terminal (console.log does too)
     sleep(ms) wait
     env       { user, cwd, os, version } — read-only facts
     fetch     the browser's own; works with sites that allow it (CORS)
   and the value it returns (if any) is printed. Top-level await works.
   Each run is stopped after 20 seconds, or by Ctrl+C.
   ============================================================ */
import { vfs } from './vfs.js';

export const DIR = `${vfs.HOME}/.commands`;
export const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export const MAX_BYTES = 200_000;
const TIMEOUT_MS = 20_000;
const MAX_LINES = 500;

export const TEMPLATE = name => `// ${name} — a StaticOS terminal command.
// Run it by typing:  ${name} some words
//
// You get: args (the words), print(), sleep(ms), env, fetch.
// Whatever you return is printed too. await works at the top level.

const who = args.join(' ') || env.user || 'world';
print(\`Hello, \${who}!\`);
`;

const path = name => `${DIR}/${name}.js`;
function ensureDir() { if (!vfs.node(DIR)) vfs.mkdir(DIR); }

export function list() {
  const dir = vfs.node(DIR);
  if (!dir || dir.type !== 'dir') return [];
  return vfs.ls(DIR, { hidden: true })
    .filter(n => n.type === 'file' && /\.js$/.test(n.name) && NAME_RE.test(n.name.slice(0, -3)))
    .map(n => n.name.slice(0, -3)).sort();
}
export const has = name => NAME_RE.test(name) && !!vfs.node(path(name));
export const read = name => (has(name) ? vfs.read(path(name)) : null);
export const fileOf = path;

/** -> the file path, or throws with a plain reason */
export function save(name, code) {
  if (!NAME_RE.test(name)) throw new Error('names are lowercase letters, digits, - and _, starting with a letter (max 32)');
  const text = String(code ?? '');
  if (text.length > MAX_BYTES) throw new Error(`that code is too big (${Math.round(text.length / 1000)} KB — the limit is ${MAX_BYTES / 1000} KB)`);
  ensureDir();
  const p = path(name);
  if (vfs.node(p)) vfs.write(p, text); else vfs.touch(p, text);
  return p;
}
export function remove(name) { return has(name) ? vfs.rm(path(name)) : false; }

/* the page the command runs in: the user's code is handed over as a JSON
   string and compiled with the AsyncFunction constructor inside the
   sandbox, so a syntax error is reported instead of silently failing */
function page(id, code, args, env) {
  const J = v => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><script>(function(){
var ID=${J(id)};
var post=function(k,t){try{parent.postMessage({__staticCmd:ID,kind:k,text:String(t)},'*')}catch(e){}};
var fmt=function(v){try{if(v instanceof Error)return v.name+': '+v.message;if(v&&typeof v==='object')return JSON.stringify(v,null,1);return String(v)}catch(e){return String(v)}};
var out=function(){post('out',[].map.call(arguments,fmt).join(' '))};
var bad=function(){post('err',[].map.call(arguments,fmt).join(' '))};
console.log=out;console.info=out;console.debug=out;console.warn=bad;console.error=bad;
addEventListener('error',function(e){bad((e.message||'Error')+(e.lineno?' (line '+e.lineno+')':''))});
addEventListener('unhandledrejection',function(e){bad('Unhandled promise rejection: '+fmt(e.reason))});
var AF=Object.getPrototypeOf(async function(){}).constructor,fn;
try{fn=new AF('args','print','sleep','env',${J(code)})}catch(e){bad((e.name||'Error')+': '+e.message);post('done','1');return}
var sleep=function(ms){return new Promise(function(r){setTimeout(r,Math.max(0,+ms||0))})};
Promise.resolve().then(function(){return fn(${J(args)},out,sleep,Object.freeze(${J(env)}))}).then(
 function(v){if(v!==undefined)out(v);post('done','0')},
 function(e){bad(fmt(e));post('done','1')});
})();<\/script>`;
}

/**
 * Run a command. -> { stop(), done: Promise<{ code: 0|1, reason? }> }
 * onOut(text) / onErr(text) receive each line as it is printed.
 */
export function run(name, args, { env = {}, onOut, onErr, timeoutMs = TIMEOUT_MS } = {}) {
  const code = read(name);
  if (code == null) throw new Error(`no command called ${name}`);
  const id = `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-9999px;top:0';
  let lines = 0;
  let finish;
  const done = new Promise(res => { finish = res; });
  let over = false;
  const end = result => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    window.removeEventListener('message', onMsg);
    frame.remove();
    finish(result);
  };
  const onMsg = e => {
    if (e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.__staticCmd !== id) return;
    if (d.kind === 'done') { end({ code: d.text === '0' ? 0 : 1 }); return; }
    if (++lines > MAX_LINES) {
      if (lines === MAX_LINES + 1) onErr?.(`(stopped after ${MAX_LINES} lines of output)`);
      end({ code: 1, reason: 'output' });
      return;
    }
    const text = String(d.text).slice(0, 4000);
    (d.kind === 'err' ? onErr : onOut)?.(text);
  };
  window.addEventListener('message', onMsg);
  const timer = setTimeout(() => { onErr?.(`(stopped after ${Math.round(timeoutMs / 1000)} s)`); end({ code: 1, reason: 'timeout' }); }, timeoutMs);
  frame.srcdoc = page(id, code, args.map(String), env);
  document.body.appendChild(frame);
  return { done, stop: () => end({ code: 130, reason: 'interrupted' }) };
}

export default { DIR, NAME_RE, TEMPLATE, list, has, read, save, remove, run, fileOf };
