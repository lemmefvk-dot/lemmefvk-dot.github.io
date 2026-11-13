/* ============================================================
   scancam.js — what the two scanners share: the camera, and reading
   QR codes. Everything runs on this device.

     openCamera({ facing })  -> Promise<MediaStream>   (throws a plain error: see cameraProblem)
     cameraProblem(err)      -> { kind, title, body }   what went wrong, in words to act on
     stopStream(stream)      stop every track (safe to call twice, or with null)
     readQR(source)          -> Promise<{ text, via } | null>
                                source: canvas, ImageBitmap, <video>, <img>
     describeCode(text)      -> { kind, text, link? }   what a decoded code is

   QR reading: the browser's own BarcodeDetector when there is one,
   otherwise jsQR (js/vendor/jsqr — Apache-2.0, see its README), which
   is only loaded the first time it is needed. A decoded code is data
   from a stranger: describeCode() never touches the page, never opens
   anything, and only marks http and https links as openable.
   ============================================================ */

export function stopStream(stream) {
  try { stream?.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* already ended */ } }); } catch (e) { /* not a stream */ }
}

export async function openCamera({ facing = 'environment', width = 1920, height = 1080 } = {}) {
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
  }
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') throw Object.assign(new Error('no getUserMedia'), { name: 'Unsupported' });
  try {
    return await md.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: width }, height: { ideal: height } } });
  } catch (err) {
    /* a computer with no rear camera: any camera will do */
    if (err?.name === 'OverconstrainedError') return md.getUserMedia({ audio: false, video: true });
    throw err;
  }
}

export function cameraProblem(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  if (name === 'InsecureContext') {
    return { kind: 'insecure', title: 'The camera needs a secure page', body: 'Browsers only allow the camera on https:// pages. Open StaticOS over https, or choose a picture instead.' };
  }
  if (name === 'Unsupported') {
    return { kind: 'unsupported', title: 'This browser can’t use a camera', body: 'It has no camera support. You can still choose a picture from your files.' };
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return { kind: 'denied', title: 'Camera permission was refused',
      body: 'The browser or the computer is not letting StaticOS use the camera. To allow it, use the camera icon at the left end of the address bar, then press Try again. Or choose a picture from your files instead.' };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'nocam', title: 'No camera found', body: 'This device has no camera the browser can see. You can choose a picture from your files instead.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { kind: 'busy', title: 'The camera is in use', body: 'Another app or tab is using it. Close that, then press Try again, or choose a picture from your files.' };
  }
  return { kind: 'failed', title: 'The camera couldn’t start', body: `The browser said: “${msg || 'no details'}”. Press Try again, or choose a picture from your files.` };
}

/* ---------- reading QR codes ---------- */

let jsQRLoad = null;
function loadJsQR() {
  /* the file is a UMD bundle: evaluated as a module it sets self.jsQR */
  jsQRLoad ||= import('../vendor/jsqr/jsQR.js').then(() => {
    if (typeof self.jsQR !== 'function') throw new Error('The QR reader did not load.');
    return self.jsQR;
  }).catch(err => { jsQRLoad = null; throw err; });
  return jsQRLoad;
}

let nativeDetector;              /* undefined: not asked yet; null: none */
async function native() {
  if (nativeDetector !== undefined) return nativeDetector;
  nativeDetector = null;
  try {
    if (typeof window.BarcodeDetector === 'function') {
      const formats = typeof window.BarcodeDetector.getSupportedFormats === 'function' ? await window.BarcodeDetector.getSupportedFormats() : ['qr_code'];
      if (formats.includes('qr_code')) nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
    }
  } catch (e) { nativeDetector = null; }
  return nativeDetector;
}
/** Forget the cached detector (a test removes BarcodeDetector, then asks again). */
export function resetReader() { nativeDetector = undefined; }

const MAX_SIDE = 1100;
function pixelsOf(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return null;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, w, h);
  return { canvas: c, w, h, data: g.getImageData(0, 0, w, h) };
}

export async function readQR(source) {
  const px = pixelsOf(source);
  if (!px) return null;
  const det = await native();
  if (det) {
    try {
      const found = await det.detect(px.canvas);
      const hit = found.find(f => typeof f.rawValue === 'string' && f.rawValue !== '');
      if (hit) return { text: hit.rawValue, via: 'browser' };
    } catch (e) { /* this browser's reader failed: try the bundled one */ }
  }
  const jsQR = await loadJsQR();
  const r = jsQR(px.data.data, px.w, px.h, { inversionAttempts: 'attemptBoth' });
  return r && typeof r.data === 'string' && r.data !== '' ? { text: r.data, via: 'bundled' } : null;
}

/* ---------- what a decoded code is ---------- */

const OPENABLE = new Set(['http:', 'https:']);

/** Only the text; for a link, the pieces to show it honestly. Nothing here opens anything. */
export function describeCode(raw) {
  const text = String(raw ?? '');
  const t = text.trim();
  /* a web address has no spaces, angle brackets or control characters; anything with them is just words */
  if (!t || /[\s<>"\u0000-\u001f\u007f]/.test(t)) return { kind: 'text', text };
  let u = null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) { try { u = new URL(t); } catch (e) { u = null; } }
  if (!u) return { kind: 'text', text };
  const scheme = u.protocol.toLowerCase();
  const host = u.hostname;
  const unicodeLabels = host.split('.').some(l => l.startsWith('xn--'));
  return {
    kind: 'link', text,
    link: {
      scheme, href: u.href, host,
      openable: OPENABLE.has(scheme) && !!host,
      /* the address split so the real host can be picked out of it */
      before: `${scheme}//`, user: u.username || u.password ? `${u.username}${u.password ? `:${u.password}` : ''}@` : '',
      port: u.port ? `:${u.port}` : '', rest: `${u.pathname}${u.search}${u.hash}`,
      hasLogin: !!(u.username || u.password),
      lookAlike: unicodeLabels,
    },
  };
}

export default { openCamera, cameraProblem, stopStream, readQR, resetReader, describeCode };
