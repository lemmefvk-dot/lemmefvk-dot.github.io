/* ============================================================
   screenshot.js — a real screenshot of StaticOS.

   A web page cannot read its own pixels, so this asks the browser
   for them the one honest way there is: getDisplayMedia, pointed
   at this tab (preferCurrentTab). The browser shows its own "share
   this tab?" prompt; when the person agrees, ONE frame is taken
   (ImageCapture.grabFrame, or a <video> drawn to a canvas once it
   has a picture), every track is stopped at once so the sharing
   indicator goes away, and the frame is saved as a PNG in
   ~/Pictures/Screenshots through media.save() — a real file with
   its real size, openable in Photos and downloadable.

     take() -> Promise<{ path, blob } | null>

   take() must be called straight from a click or a key press
   (the browser only shows the prompt for a user gesture), so it
   calls getDisplayMedia before anything else — no await first.
   A cancelled prompt is not an error: it gets a quiet toast. A
   browser that can't capture, or one that refuses without asking
   (turned off by an administrator or the computer's settings),
   says so and points at the computer's own screenshot keys.
   ============================================================ */
import api from './api.js?v=ps5-cloud-proxy-v11';
import * as media from './media.js';

const DIR = () => `${api.vfs.HOME}/Pictures/Screenshots`;
const pad2 = n => String(n).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 'YYYY-MM-DD at HH.MM.SS' — the file-name stamp. */
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} at ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;
}

/* the computer's own screenshot shortcut, for when the browser can't */
function nativeKeys() {
  const ua = navigator.userAgent || '';
  if (/CrOS/.test(ua)) return 'Ctrl + Show windows';
  if (/Windows/.test(ua)) return 'Win + Shift + S';
  if (/iPhone|iPad/.test(ua)) return 'the side button + volume up';
  if (/Mac/.test(ua)) return '⌘ + Shift + 3';
  if (/Android/.test(ua)) return 'power + volume down';
  return 'your computer\'s screenshot key';
}

const say = n => api.notify({ app: 'StaticOS', icon: 'screenshot', ...n });

/** A real download to the person's computer. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* revoking at once can cancel the download in some browsers */
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function stopAll(stream) {
  try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* already stopped */ }
}

/* one frame of the shared surface, as a canvas */
async function grab(stream, track) {
  if (typeof ImageCapture === 'function') {
    try {
      const bmp = await Promise.race([new ImageCapture(track).grabFrame(), sleep(2500).then(() => null)]);
      if (bmp && bmp.width && bmp.height) {
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close?.();
        return c;
      }
    } catch (err) { /* fall through to the <video> route */ }
  }
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  try {
    v.play()?.catch?.(() => {});
    const t0 = performance.now();
    while (!(v.readyState >= 2 && v.videoWidth > 0)) {
      if (performance.now() - t0 > 4000) throw new Error('The browser shared the tab but sent no picture.');
      await sleep(40);
    }
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  } finally {
    v.pause();
    v.srcObject = null;
  }
}

async function keep(stream) {
  const track = stream.getVideoTracks()[0];
  let canvas;
  try {
    if (!track) throw new Error('The browser shared no picture.');
    /* let a launcher, menu or palette that is closing finish fading out */
    await sleep(240);
    canvas = await grab(stream, track);
  } finally {
    stopAll(stream);                      /* the sharing indicator goes away now */
  }
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  const w = canvas.width, h = canvas.height;
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('The picture could not be encoded as a PNG.');
  const dir = DIR();
  const { path } = await media.save(dir, `Screenshot ${stamp()}.png`, blob);
  const name = api.vfs.baseName(path);
  say({
    title: 'Screenshot saved',
    message: `${name} · ${w}×${h} · ${api.fmt.fmtBytes(blob.size)}`,
    actions: [
      { label: 'Mark up', onClick: () => api.openApp('markup', { path }) },
      { label: 'Show', onClick: () => api.openApp('files', { path: dir }) },
      { label: 'Download', onClick: () => downloadBlob(blob, name) },
    ],
  });
  return { path, blob };
}

function refused(err, ms) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    if (/system/i.test(msg)) {
      say({ icon: 'lock', title: 'Your computer is blocking screen capture',
        message: `This browser isn't allowed to record the screen. On a Mac: System Settings › Privacy & Security › Screen & System Audio Recording, turn on your browser and reopen it. Or press ${nativeKeys()}.`,
        timeout: 12000 });
      return;
    }
    /* no prompt can be answered this fast: the browser refused by itself */
    if (ms < 300) {
      say({ icon: 'lock', title: 'Screen capture is turned off here',
        message: `The browser refused without asking — it may be switched off on this device (for example by an administrator). Press ${nativeKeys()} to use your computer's own screenshot tool.`,
        timeout: 12000 });
      return;
    }
    say({ title: 'Screenshot cancelled', message: 'Nothing was shared, so nothing was saved.', timeout: 2600 });
    return;
  }
  if (name === 'InvalidStateError' || name === 'InvalidAccessError') {
    say({ icon: 'alert', title: 'Screenshot needs a click',
      message: 'The browser only asks to share the tab right after a click or a key press. Try the button again.' });
    return;
  }
  if (name === 'NotFoundError') {
    say({ icon: 'alert', title: 'Nothing to capture', message: 'The browser found no screen or tab it can share.' });
    return;
  }
  say({ icon: 'alert', title: 'Screenshot failed', message: `${name || 'Error'}: ${msg || 'the browser gave no details'}` });
}

let busy = false;

/** Ask the browser for this tab, keep one frame as a PNG. Call from a user gesture. */
export function take() {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  if (!md || typeof md.getDisplayMedia !== 'function') {
    say({ icon: 'alert', title: 'Screenshots aren\'t available here',
      message: (typeof isSecureContext !== 'undefined' && !isSecureContext)
        ? `Screen capture only works on a secure page (https:// or localhost). Press ${nativeKeys()} instead.`
        : `This browser can't capture the screen. Press ${nativeKeys()} to use your computer's own screenshot tool.`,
      timeout: 10000 });
    return Promise.resolve(null);
  }
  if (busy) {                                     /* the browser's prompt is already up */
    say({ title: 'Already asking', message: 'Answer the browser\'s “share this tab” prompt first.', timeout: 2600 });
    return Promise.resolve(null);
  }
  busy = true;
  const t0 = performance.now();
  let asked;
  try {
    /* called synchronously, inside the gesture */
    asked = md.getDisplayMedia({
      video: { displaySurface: 'browser' },
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      audio: false,
    });
  } catch (err) {
    asked = Promise.reject(err);
  }
  return Promise.resolve(asked)
    .then(stream => keep(stream).catch(err => {
      stopAll(stream);
      say({ icon: 'alert', title: 'Screenshot not saved', message: err?.message || String(err) });
      return null;
    }), err => { refused(err, performance.now() - t0); return null; })
    .finally(() => { busy = false; });
}

export default { take, downloadBlob };
