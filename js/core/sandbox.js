/* ============================================================
   sandbox.js — run a generated or hand-written HTML game safely.

   The game is a whole HTML document shown in an <iframe srcdoc>
   with sandbox="allow-scripts allow-pointer-lock": it can run its
   own JavaScript, but it gets an opaque origin — no access to
   StaticOS's storage, cookies, windows or DOM, no top navigation,
   no popups, no forms. Code written by an AI model is untrusted and
   this is what keeps it in its box.

   A small prelude is injected first. It forwards console output,
   uncaught errors and unhandled rejections to the parent with
   postMessage, which is how Studio's console and Forge's "Testing"
   stage see what the game did. Messages are accepted only from
   that iframe's own window.

   The parent can also hand the frame a line of JavaScript to run
   (Code's console input line): the prelude evaluates it inside the
   frame — in the page's own sealed world, never in StaticOS's — and
   posts back the value as text. The frame only takes that from its
   parent window.

   run(host, html, { onLog, onError, onReady }) -> { frame, stop(), reload(html), focus(), snapshot(), evaluate(code) }
   test(html, { ms }) -> Promise<{ errors: [...], logs: [...] }>
     runs the game hidden for `ms` and reports what it printed.
   ============================================================ */

const PRELUDE = `<script>(function(){
  var send=function(kind,args){try{parent.postMessage({__staticSandbox:1,kind:kind,args:args},'*')}catch(e){}};
  var fmt=function(v){try{if(v instanceof Error)return v.name+': '+v.message;if(typeof v==='object')return JSON.stringify(v);return String(v)}catch(e){return String(v)}};
  ['log','info','warn','error','debug'].forEach(function(k){var o=console[k];console[k]=function(){var a=[].slice.call(arguments).map(fmt);send(k==='debug'?'log':k,a);try{o.apply(console,arguments)}catch(e){}}});
  addEventListener('error',function(e){send('uncaught',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')])});
  addEventListener('unhandledrejection',function(e){send('uncaught',['Unhandled promise rejection: '+fmt(e.reason)])});
  addEventListener('load',function(){send('ready',[])});
  /* the parent may ask for a thumbnail of the game's canvas, or run a line typed in its console (here, inside the frame) */
  addEventListener('message',function(e){var d=e.data;if(!d||d.__staticSandbox!==1||e.source!==parent)return;
    if(d.kind==='eval'){var show=function(v){try{if(v===undefined)return'undefined';if(typeof v==='string')return JSON.stringify(v);if(typeof v==='function')return'function '+(v.name||'')+'()';if(typeof Element!=='undefined'&&v instanceof Element)return'<'+v.tagName.toLowerCase()+(v.id?' id="'+v.id+'"':'')+'>';return fmt(v)}catch(err){return String(v)}};var back=function(ok,v){send(ok?'result':'evalerr',[d.id,ok?show(v):(v&&v.name?v.name+': '+v.message:String(v))])};try{var r=(0,eval)(String(d.code));if(r&&typeof r.then==='function')r.then(function(v){back(1,v)},function(err){back(0,err)});else back(1,r)}catch(err){back(0,err)}return}
    if(d.kind!=='snap')return;
    try{var c=document.querySelector('canvas');if(!c){send('snap',['']);return}
      var t=document.createElement('canvas');t.width=320;t.height=180;var g=t.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,320,180);
      var s=Math.min(320/c.width,180/c.height),w=c.width*s,h=c.height*s;g.drawImage(c,(320-w)/2,(180-h)/2,w,h);send('snap',[t.toDataURL('image/jpeg',0.8)])}catch(err){send('snap',[''])}});
})();<\/script>`;

/* put the prelude before any of the game's own scripts */
export function withPrelude(html) {
  const src = String(html || '');
  if (/<head[^>]*>/i.test(src)) return src.replace(/<head[^>]*>/i, m => m + PRELUDE);
  if (/<html[^>]*>/i.test(src)) return src.replace(/<html[^>]*>/i, m => m + '<head>' + PRELUDE + '</head>');
  return '<!doctype html><html><head>' + PRELUDE + '</head><body>' + src + '</body></html>';
}

export function run(host, html, { onLog, onError, onReady, title = 'Game' } = {}) {
  const frame = document.createElement('iframe');
  frame.className = 'sbx-frame';
  frame.title = title;
  frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
  frame.setAttribute('allow', 'gamepad; fullscreen; autoplay');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  const onMsg = e => {
    if (e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.__staticSandbox !== 1) return;
    if (d.kind === 'snap') { const cb = snapWaiters.shift(); cb?.(String(d.args?.[0] || '')); return; }
    if (d.kind === 'result' || d.kind === 'evalerr') {
      const id = Array.isArray(d.args) ? d.args[0] : null;
      const w = evalWaiters.get(id);
      if (w) { evalWaiters.delete(id); w({ ok: d.kind === 'result', text: String(d.args[1] ?? '').slice(0, 4000) }); }
      return;
    }
    const text = (Array.isArray(d.args) ? d.args : []).map(String).join(' ').slice(0, 2000);
    if (d.kind === 'ready') onReady?.();
    else if (d.kind === 'uncaught' || d.kind === 'error') { onError?.(text, d.kind); onLog?.(d.kind, text); }
    else onLog?.(d.kind, text);
  };
  const snapWaiters = [];
  const evalWaiters = new Map();
  let evalSeq = 0;
  window.addEventListener('message', onMsg);
  frame.srcdoc = withPrelude(html);
  host.appendChild(frame);
  return {
    /** a 320x180 JPEG data URL of the game's first canvas, or '' */
    snapshot(timeout = 1500) {
      return new Promise(resolve => {
        const t = setTimeout(() => { const i = snapWaiters.indexOf(done); if (i >= 0) snapWaiters.splice(i, 1); resolve(''); }, timeout);
        const done = url => { clearTimeout(t); resolve(url); };
        snapWaiters.push(done);
        try { frame.contentWindow.postMessage({ __staticSandbox: 1, kind: 'snap' }, '*'); } catch (e) { done(''); }
      });
    },
    /** Run one line of JavaScript inside the frame; resolves { ok, text } (text: the value or the error). */
    evaluate(code, timeout = 4000) {
      return new Promise(resolve => {
        const id = ++evalSeq;
        const t = setTimeout(() => { evalWaiters.delete(id); resolve({ ok: false, text: 'No answer from the page (it may be busy in a loop, or still loading).' }); }, timeout);
        evalWaiters.set(id, r => { clearTimeout(t); resolve(r); });
        try { frame.contentWindow.postMessage({ __staticSandbox: 1, kind: 'eval', id, code: String(code) }, '*'); }
        catch (e) { clearTimeout(t); evalWaiters.delete(id); resolve({ ok: false, text: 'The page isn’t running.' }); }
      });
    },
    frame,
    reload(next) { frame.srcdoc = withPrelude(next ?? html); },
    focus() { try { frame.contentWindow?.focus(); frame.focus(); } catch (e) {} },
    stop() { window.removeEventListener('message', onMsg); frame.remove(); },
  };
}

/** Run hidden for a moment and report what happened — Forge's real test step. */
export function test(html, { ms = 2500 } = {}) {
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:480px;overflow:hidden;opacity:0;pointer-events:none';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    const errors = [], logs = [];
    let ready = false;
    const s = run(host, html, {
      onError: t => errors.push(t),
      onLog: (k, t) => logs.push(`${k}: ${t}`),
      onReady: () => { ready = true; },
      title: 'Test run',
    });
    s.frame.style.cssText = 'width:640px;height:480px;border:0';
    setTimeout(() => { s.stop(); host.remove(); resolve({ errors, logs: logs.slice(-40), ready }); }, ms);
  });
}

export default { run, test, withPrelude };
