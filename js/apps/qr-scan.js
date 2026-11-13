/* ============================================================
   qr-scan.js — Static QR's "Scan" side: read a QR code with the camera,
   or from a picture. Loaded by js/apps/qr.js the first time Scan is
   opened (this file is not an app of its own).

     mountScan({ api, root, openLink? }) -> teardown

   A scanned code is text from a stranger, so:
   · it is shown with textContent, never as markup;
   · nothing is opened for you — a link waits for a press on "Open link",
     and only http and https links get that button; every other kind of
     code (javascript:, data:, mailto:, WIFI:… or plain words) can only
     be copied;
   · the link is shown in full with its real host picked out, and a login
     in the address or a look-alike (xn--) host is called out.
   The camera is released the moment a code is read, when a picture is
   chosen instead, when Scan is left, and when the window closes.
   Reading itself is js/core/scancam.js (BarcodeDetector, else jsQR).
   ============================================================ */
import { openCamera, cameraProblem, stopStream, readQR, describeCode } from '../core/scancam.js';

const EVERY = 150;               /* ms between looks at the camera */

export function mountScan({ api, root, openLink }) {
  const { h, icon } = api;
  const S = { dead: false, stream: null, gen: 0, timer: 0, busy: false };
  const open = openLink || (url => api.openApp('browser', { url }));

  const video = h('video.qrs__video', { muted: true, playsinline: true, autoplay: true, 'aria-label': 'What the camera sees' });
  video.muted = true;
  const msg = h('div.qrs__msg', { hidden: true });
  const frame = h('div.qrs__frame', { 'aria-hidden': 'true' });
  const stage = h('div.qrs__stage', video, frame, msg);
  const status = h('p.qrs__status', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.qrs__result', { hidden: true });
  const pick = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Choose a picture with a QR code' });
  const againBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-again' }, onclick: () => start() }, icon('camera'), h('span', { text: 'Scan with camera' }));
  const fileBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-file' }, onclick: () => pick.click() }, icon('image'), h('span', { text: 'Choose a picture…' }));
  const actions = h('div.qrs__actions', againBtn, fileBtn, pick);
  const note = h('p.qrs__note', icon('lock'), h('span', { text: 'The camera picture and what it says stay on this device. Nothing is opened until you press a button.' }));
  const el = h('section.qrs', { 'aria-label': 'Scan a QR code' }, stage, status, result, actions, note);
  root.appendChild(el);

  const say = t => { status.textContent = t; };

  function release() {
    clearTimeout(S.timer);
    S.timer = 0;
    stopStream(S.stream);
    S.stream = null;
    try { video.pause(); } catch (e) { /* nothing playing */ }
    video.srcObject = null;
    el.classList.remove('is-live');
  }

  function problem(p) {
    release();
    msg.replaceChildren(icon('camera'), h('b', { text: p.title }), h('small', { text: p.body }));
    msg.hidden = false;
    say(p.title);
    againBtn.lastChild.textContent = 'Try again';
  }

  async function start() {
    const gen = ++S.gen;
    release();
    result.hidden = true;
    result.replaceChildren();
    msg.hidden = true;
    say('Starting the camera…');
    let stream;
    try { stream = await openCamera({ facing: 'environment' }); } catch (err) {
      if (gen === S.gen && !S.dead) problem(cameraProblem(err));
      return;
    }
    if (gen !== S.gen || S.dead) { stopStream(stream); return; }   /* left or closed while the browser was asking */
    S.stream = stream;
    video.srcObject = stream;
    video.play?.().catch?.(() => {});
    el.classList.add('is-live');
    againBtn.lastChild.textContent = 'Scan with camera';
    say('Point the camera at a QR code.');
    loop(gen);
  }

  function loop(gen) {
    S.timer = setTimeout(async () => {
      if (gen !== S.gen || S.dead || !S.stream) return;
      if (!S.busy && video.videoWidth) {
        S.busy = true;
        let found = null;
        try { found = await readQR(video); } catch (err) { found = null; }
        S.busy = false;
        if (gen !== S.gen || S.dead) return;
        if (found) { release(); show(found); return; }
      }
      loop(gen);
    }, EVERY);
  }

  /* ---------- the result ---------- */
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); btn.lastChild.textContent = 'Copied'; say('Copied to the clipboard.'); }
    catch (e) { say('Couldn’t copy: the clipboard isn’t available here.'); }
  }

  function show(found) {
    const d = describeCode(found.text);
    const via = found.via === 'browser' ? 'Read by this browser’s own QR reader.' : 'Read by the QR reader bundled with StaticOS.';
    const kids = [];
    const copyBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-copy' }, onclick: () => copy(found.text, copyBtn) }, icon('copy'), h('span', { text: 'Copy' }));
    const buttons = [];
    if (d.kind === 'link' && d.link.host) {
      const L = d.link;
      kids.push(h('div.qrs__kind', { text: L.openable ? 'Web link' : `${L.scheme.replace(':', '')} link — not a web link` }));
      kids.push(h('div.qrs__hostline', h('span', { text: 'It goes to ' }), h('b.qrs__host', { text: L.host })));
      kids.push(h('div.qrs__url.mono', { dataset: { fk: 'qrs-url' } },
        h('span.qrs__dim', { text: L.before }), L.user ? h('span.qrs__warn', { text: L.user }) : null,
        h('b.qrs__hostpart', { text: L.host }), h('span.qrs__dim', { text: L.port }), h('span', { text: L.rest })));
      if (L.hasLogin) kids.push(h('p.qrs__flag', icon('alert'), h('span', { text: 'This address has a user name in it. The real site is the part after the @ — the part before it is just decoration.' })));
      if (L.lookAlike) kids.push(h('p.qrs__flag', icon('alert'), h('span', { text: 'The host uses letters from another alphabet (shown here in its xn-- form). It can imitate a familiar site — check it carefully.' })));
      if (L.openable) {
        buttons.push(h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-open' }, onclick: () => open(L.href) }, icon('external-link'), h('span', { text: 'Open link' })));
      } else {
        kids.push(h('p.qrs__flag', icon('lock'), h('span', { text: 'Only web links (http and https) can be opened from here. This one can only be copied.' })));
      }
    } else if (d.kind === 'link') {
      /* javascript:, data:, mailto:, wifi: … no host to show: the text exactly as scanned */
      kids.push(h('div.qrs__kind', { text: `${d.link.scheme.replace(':', '')} code — not a web link` }));
      kids.push(h('div.qrs__text.mono', { text: found.text, dataset: { fk: 'qrs-text' } }));
      kids.push(h('p.qrs__flag', icon('lock'), h('span', { text: 'Only web links (http and https) can be opened from here. This code can only be copied.' })));
    } else {
      kids.push(h('div.qrs__kind', { text: 'Text' }));
      kids.push(h('div.qrs__text', { text: found.text, dataset: { fk: 'qrs-text' } }));
    }
    result.replaceChildren(...kids, h('div.qrs__actions', ...buttons, copyBtn), h('small.qrs__via', { text: via }));
    result.hidden = false;
    msg.hidden = true;
    againBtn.lastChild.textContent = 'Scan another';
    say(d.kind === 'link' && d.link.host ? `Found a link to ${d.link.host}. Nothing has been opened.` : 'Found a code. Nothing has been opened.');
    result.querySelector('button')?.focus?.({ preventScroll: true });
  }

  /* ---------- a picture instead ---------- */
  pick.addEventListener('change', async () => {
    const file = pick.files?.[0];
    pick.value = '';
    if (!file) return;
    S.gen++;
    release();
    result.hidden = true;
    msg.hidden = true;
    say('Reading the picture…');
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) { bmp = null; }
    if (S.dead) { bmp?.close?.(); return; }
    if (!bmp) { say('That file couldn’t be opened as a picture.'); return; }
    let found = null;
    try { found = await readQR(bmp); } catch (e) { found = null; }
    bmp.close?.();
    if (S.dead) return;
    if (!found) { say('No QR code found in that picture. Try a sharper, closer one.'); return; }
    show(found);
  });

  start();

  return () => {
    S.dead = true;
    S.gen++;
    release();
    el.remove();
  };
}

export default { mountScan };
