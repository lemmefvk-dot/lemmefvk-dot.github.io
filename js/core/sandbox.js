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

   run(host, html, { onLog, onError, onReady }) -> { frame, stop(), reload(html), focus(), snapshot() }
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
  /* the parent may ask for a thumbnail of the game's canvas */
  addEventListener('message',function(e){var d=e.data;if(!d||d.__staticSandbox!==1||d.kind!=='snap')return;
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
    const text = (Array.isArray(d.args) ? d.args : []).map(String).join(' ').slice(0, 2000);
    if (d.kind === 'ready') onReady?.();
    else if (d.kind === 'uncaught' || d.kind === 'error') { onError?.(text, d.kind); onLog?.(d.kind, text); }
    else onLog?.(d.kind, text);
  };
  const snapWaiters = [];
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
