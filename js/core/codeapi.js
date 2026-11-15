/* ============================================================
   codeapi.js — "Try web APIs" in Static Code: a simple request tool.

   apiPanel({ h, icon, clear, render, notify, insert, copy }) -> { el, focus(), dispose() }

   You type a web address, pick GET, POST and the rest, add headers or
   a body if you want, and Send. The request goes straight from this
   browser to that site with fetch(), and the answer is shown: status,
   how long it took (measured), its size, the headers the site lets a
   page see, and the body — JSON laid out, an image shown, anything
   else as plain text (an HTML answer is never drawn as a page).

   What it is not: a proxy. Nothing is routed through StaticOS or any
   other server, so it only reaches sites that allow requests from web
   pages (CORS). When a site doesn't, the browser stops the request
   and the panel says so plainly; there is no way round that from here.

   What it sends: only what you typed. No cookies (credentials: 'omit'),
   no referrer, nothing about StaticOS or you. Requests aren't saved
   anywhere: the list of recent ones lasts until the window closes.

   "Insert as code" puts the same request in the editor as fetch().
   ============================================================ */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const MAX_BODY = 5 * 1024 * 1024;     /* bytes read from an answer */
const SHOW_TEXT = 300000;             /* characters shown */
const TIMEOUT = 20000;
/* the browser won't let a page set these, so say so instead of failing quietly */
const FORBIDDEN = /^(accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie|cookie2|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/i;

/* public APIs that answer browser requests, for a first try (nothing is sent until Send) */
export const EXAMPLES = [
  { name: 'Weather', hint: 'Open-Meteo: the temperature in London now', method: 'GET', url: 'https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13&current=temperature_2m,wind_speed_10m' },
  { name: 'A Pokémon', hint: 'PokéAPI: Pikachu', method: 'GET', url: 'https://pokeapi.co/api/v2/pokemon/pikachu' },
  { name: 'GitHub', hint: 'GitHub’s API: a line of its zen', method: 'GET', url: 'https://api.github.com/zen' },
  { name: 'Send JSON', hint: 'JSONPlaceholder: a pretend new post (it isn’t really kept)', method: 'POST', url: 'https://jsonplaceholder.typicode.com/posts', body: '{\n  "title": "Hello",\n  "body": "Sent from Static Code",\n  "userId": 1\n}' },
];

const kb = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** The request as JavaScript someone can paste into their page (a plain script: no top-level await). */
export function asCode({ method, url, headers, body, json = false }) {
  const opts = [];
  if (method !== 'GET') opts.push(`  method: '${method}',`);
  const hs = headers.filter(([k]) => k.trim());
  if (hs.length) opts.push(`  headers: {\n${hs.map(([k, v]) => `    ${JSON.stringify(k.trim())}: ${JSON.stringify(v)},`).join('\n')}\n  },`);
  if (body && method !== 'GET' && method !== 'HEAD') opts.push(`  body: ${JSON.stringify(body)},`);
  const call = opts.length ? `fetch(${JSON.stringify(url)}, {\n${opts.join('\n')}\n})` : `fetch(${JSON.stringify(url)})`;
  if (method === 'HEAD') return `${call}\n  .then(res => console.log(res.status, res.headers.get('content-type')));\n`;
  return `${call}\n  .then(res => {\n    console.log(res.status);\n    return res.${json ? 'json' : 'text'}();\n  })\n  .then(data => console.log(data));\n`;
}

/** Why a request couldn't be made, in words. */
export function whyFailed(url, err) {
  if (err && err.name === 'AbortError') return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You’re offline, so nothing could be sent.';
  try {
    const u = new URL(url);
    if (typeof location !== 'undefined' && location.protocol === 'https:' && u.protocol === 'http:') return 'This page is https, and the browser won’t send from it to a plain http:// address. Try the https:// version of the address.';
  } catch (e) { /* checked before */ }
  return 'The browser blocked the answer, or the site couldn’t be reached. Most often the site doesn’t allow requests from web pages (it sends no CORS permission), so only its own pages and servers can use it. StaticOS sends requests straight from your browser and doesn’t route them through anything else, so there’s no way round that here: try an API that says it allows browser (CORS) requests.';
}

export function apiPanel({ h, icon, clear, render, insert, copy }) {
  const method = h('select.cap__method', { 'aria-label': 'Method', onchange: () => paintBody() }, ...METHODS.map(m => h('option', { value: m, text: m })));
  const url = h('input.cap__url', { type: 'url', 'aria-label': 'Web address', placeholder: 'https://api.example.com/…', spellcheck: 'false', autocomplete: 'off',
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); send(); } e.stopPropagation(); } });
  const sendBtn = h('button.btn.btn--primary', { type: 'button', 'data-act': 'api-send', onclick: () => send() }, icon('send'), h('span', { text: 'Send' }));
  const headRows = h('div.cap__rows');
  const bodyIn = h('textarea.cap__body', { 'aria-label': 'Request body', spellcheck: 'false', rows: '5', placeholder: '{ "name": "value" }', onkeydown: e => e.stopPropagation() });
  const bodyType = h('select', { 'aria-label': 'Body type' }, h('option', { value: 'application/json', text: 'JSON' }), h('option', { value: 'text/plain', text: 'Text' }), h('option', { value: 'application/x-www-form-urlencoded', text: 'Form' }));
  const bodyBox = h('div.cap__bodybox', h('div.cap__lbl', h('span', { text: 'Body' }), bodyType), bodyIn);
  const warn = h('div.cap__warn', { role: 'note' });
  const result = h('section.cap__result', { 'aria-label': 'Answer', 'aria-live': 'polite' });
  const recent = h('div.cap__recent');
  const S = { ctl: null, recent: [], last: null, dead: false };

  function headerRow(k = '', v = '') {
    const key = h('input', { type: 'text', 'aria-label': 'Header name', placeholder: 'Header', value: k, spellcheck: 'false', oninput: () => checkHeaders(), onkeydown: e => e.stopPropagation() });
    const val = h('input', { type: 'text', 'aria-label': 'Header value', placeholder: 'Value', value: v, spellcheck: 'false', onkeydown: e => e.stopPropagation() });
    const row = h('div.cap__row', key, val, h('button.ibtn.tip', { type: 'button', 'data-tip': 'Remove', 'aria-label': 'Remove this header', onclick: () => { row.remove(); checkHeaders(); } }, icon('x')));
    headRows.append(row);
    return key;
  }
  const headers = () => [...headRows.querySelectorAll('.cap__row')].map(r => { const [k, v] = r.querySelectorAll('input'); return [k.value, v.value]; }).filter(([k]) => k.trim());
  function checkHeaders() {
    const bad = headers().filter(([k]) => FORBIDDEN.test(k.trim())).map(([k]) => k.trim());
    warn.textContent = bad.length ? `Browsers don’t let a page set ${bad.join(', ')}, so ${bad.length === 1 ? 'it' : 'they'} won’t be sent.` : '';
  }
  function paintBody() { bodyBox.hidden = method.value === 'GET' || method.value === 'HEAD'; }

  function use(ex) {
    method.value = ex.method;
    url.value = ex.url;
    bodyIn.value = ex.body || '';
    clear(headRows);
    paintBody();
    url.focus();
  }

  function paintRecent() {
    clear(recent);
    if (!S.recent.length) return;
    recent.append(h('div.side__label', { text: 'This session' }), ...S.recent.map(r => h('button.cap__past', { type: 'button', title: r.url, onclick: () => use(r) },
      h('b', { text: r.method }), h('span.trunc', { text: r.url }), h('small', { text: r.status ? String(r.status) : 'blocked' }))));
  }

  async function send() {
    const raw = url.value.trim();
    let u;
    try { u = new URL(raw); } catch (e) { render(result, h('div.cap__bad', { role: 'alert', text: 'That isn’t a web address. It should start with https:// (or http://).' })); return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') { render(result, h('div.cap__bad', { role: 'alert', text: 'Only http:// and https:// addresses can be tried here.' })); return; }
    S.ctl?.abort();
    const ctl = S.ctl = new AbortController();
    const m = method.value;
    const hs = headers().filter(([k]) => !FORBIDDEN.test(k.trim()));
    const opts = { method: m, headers: {}, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'follow', mode: 'cors', signal: ctl.signal };
    for (const [k, v] of hs) opts.headers[k.trim()] = v;
    if (m !== 'GET' && m !== 'HEAD' && bodyIn.value) {
      opts.body = bodyIn.value;
      if (!hs.some(([k]) => /^content-type$/i.test(k.trim()))) opts.headers['Content-Type'] = bodyType.value;
    }
    const req = { method: m, url: u.href, headers: hs, body: opts.body || '' };
    S.last = req;
    render(result, h('div.cap__wait', h('div.spinner'), h('span', { text: `Sending ${m} to ${u.host}…` }),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => ctl.abort() }, icon('x'), h('span', { text: 'Cancel' }))));
    sendBtn.disabled = true;
    const timer = setTimeout(() => ctl.abort('timeout'), TIMEOUT);
    const t0 = performance.now();
    let res, bytes = new Uint8Array(0), cut = false;
    try {
      res = await fetch(u.href, opts);
      if (m !== 'HEAD' && res.body) {
        const reader = res.body.getReader();
        const parts = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (n + value.byteLength > MAX_BODY) { parts.push(value.subarray(0, MAX_BODY - n)); n = MAX_BODY; cut = true; reader.cancel().catch(() => {}); break; }
          parts.push(value); n += value.byteLength;
        }
        bytes = new Uint8Array(n);
        let at = 0;
        for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
      }
    } catch (err) {
      clearTimeout(timer);
      if (S.dead || ctl !== S.ctl) return;
      sendBtn.disabled = false;
      const timedOut = ctl.signal.aborted && ctl.signal.reason === 'timeout';
      const why = timedOut ? `No answer after ${TIMEOUT / 1000} seconds, so it was given up.` : whyFailed(u.href, err);
      S.recent = [{ ...req, status: 0 }, ...S.recent.filter(r => r.url !== req.url || r.method !== req.method)].slice(0, 8);
      paintRecent();
      render(result, why ? h('div.cap__bad', { role: 'alert' }, h('b', { text: timedOut ? 'No answer' : 'The site didn’t answer this page' }), h('p', { text: why })) : h('div.cap__wait', h('span', { text: 'Cancelled.' })));
      return;
    }
    clearTimeout(timer);
    if (S.dead || ctl !== S.ctl) return;
    sendBtn.disabled = false;
    const ms = Math.round(performance.now() - t0);
    S.recent = [{ ...req, status: res.status }, ...S.recent.filter(r => r.url !== req.url || r.method !== req.method)].slice(0, 8);
    paintRecent();
    showAnswer(res, bytes, ms, cut);
  }

  function showAnswer(res, bytes, ms, cut) {
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const good = res.ok;
    const head = h('div.cap__status',
      h('span', { class: `cap__code ${good ? 'is-ok' : 'is-bad'}`, text: `${res.status}${res.statusText ? ` ${res.statusText}` : ''}` }),
      h('span.dim', { text: `${ms} ms` }),
      h('span.dim', { text: cut ? `the first ${kb(bytes.length)} (it is bigger)` : kb(bytes.length) }),
      type ? h('span.dim.mono', { text: type.split(';')[0] }) : null,
      h('div.grow'),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'api-insert', onclick: () => insert(asCode({ ...S.last, json: /json/.test(type) })) }, icon('code'), h('span', { text: 'Insert as code' })),
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => copy(new TextDecoder().decode(bytes)) }, icon('copy'), h('span', { text: 'Copy' })));
    const hdrs = [...res.headers.entries()];
    const hdrList = h('details.cap__hdrs', h('summary', { text: `Headers the site lets a page see (${hdrs.length})` }),
      h('dl', ...hdrs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
    let body;
    if (!bytes.length) body = h('div.cap__empty', { text: res.status === 204 || res.type === 'opaque' ? 'No body.' : 'The answer has no body.' });
    else if (/^image\/(png|jpe?g|gif|webp|avif|bmp)/.test(type) && !cut) {
      const urlObj = URL.createObjectURL(new Blob([bytes], { type: type.split(';')[0] }));
      body = h('div.cap__img', h('img', { src: urlObj, alt: 'The image the site sent' }));
      if (S.img) URL.revokeObjectURL(S.img);
      S.img = urlObj;
    } else {
      let text = new TextDecoder().decode(bytes);
      let pretty = null;
      if (/json/.test(type) || /^\s*[{[]/.test(text)) { try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { pretty = null; } }
      if (pretty) text = pretty;
      const long = text.length > SHOW_TEXT;
      body = h('pre.cap__text', { tabindex: '0', 'aria-label': 'The answer’s body', text: long ? `${text.slice(0, SHOW_TEXT)}\n\n… (${(text.length - SHOW_TEXT).toLocaleString()} more characters not shown)` : text });
      if (pretty) body.classList.add('is-json');
    }
    render(result, head, body, hdrList);
  }

  const el = h('section.cap', { role: 'region', 'aria-label': 'Try web APIs' },
    h('div.cap__top',
      h('div.cap__line', method, h('label.field.cap__urlbox', icon('globe'), url), sendBtn),
      h('p.cap__note', { text: 'Requests go straight from your browser to the site; nothing is routed through StaticOS. Only sites that allow requests from web pages (CORS) answer. No cookies or saved data are sent, and nothing here is kept after you close it. Don’t paste passwords or private keys: whatever you send goes to that site.' }),
      h('div.cap__ex', h('small.dim', { text: 'Try:' }), ...EXAMPLES.map(ex => h('button.btn.btn--sm.btn--ghost', { type: 'button', title: ex.hint, 'data-example': ex.name, onclick: () => use(ex) }, h('span', { text: ex.name })))),
      h('details.cap__more', h('summary', { text: 'Headers and body' }),
        h('div.cap__lbl', h('span', { text: 'Headers' }), h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'api-add-header', onclick: () => headerRow().focus() }, icon('plus'), h('span', { text: 'Add a header' }))),
        headRows, warn, bodyBox)),
    h('div.cap__main', result, recent));
  paintBody();
  render(result, h('div.cap__empty', { text: 'Pick an example or type an address, then Send.' }));

  return {
    el,
    focus() { url.focus({ preventScroll: true }); },
    dispose() { S.dead = true; S.ctl?.abort(); if (S.img) URL.revokeObjectURL(S.img); },
  };
}

export default { apiPanel, asCode, whyFailed, EXAMPLES };
