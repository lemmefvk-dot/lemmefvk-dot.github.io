/* ============================================================
   pdfkit.js — read and change PDFs, on this device.

   Two libraries do the work, both vendored (vendor/pdfjs, Mozilla's
   pdf.js, Apache-2.0, and vendor/pdflib, pdf-lib, MIT) and loaded only
   when a PDF is first opened or saved, so the rest of StaticOS never pays
   for them. Neither makes a network request: pdf.js runs in a worker from
   our own files, with no font or cmap downloads.

     openPdf(bytes)                -> { doc, pages, close() }   (pdf.js)
     renderPage(doc, n, width)     -> canvas, drawn at that pixel width
     pageText(doc, n)              -> the page's text, as one string
     annotate(bytes, edits)        -> Uint8Array, the PDF with the marks drawn in
     mergePdfs([bytes, ...])       -> Uint8Array
     extractPages(bytes, [n...])   -> Uint8Array, those pages (1-based) in that order
     parseRanges("1-3, 5", pages)  -> [[1,2,3],[5]]   or throws RangeError

   An annotation is drawn into the page itself (pdf-lib), never over the
   original file: callers save the result as a new file. Edits are kept in
   the page as it is shown: x and y are fractions of the shown width and
   height, from the top left, so the same numbers draw the same place
   whether the page is turned or not. Sizes are fractions of the shown width.
     edits: { [pageNumber]: { marks: [
        { t: 'pen',  color: '#rrggbb', w, pts: [[x, y], ...] }
        { t: 'hl',   color, x, y, w, h }                       a highlight box
        { t: 'text', color, x, y, size, text }                 x, y: top left
        { t: 'img',  x, y, w, h, png: 'data:image/png;base64,...' }   a signature
     ] } }
   Text is set in Helvetica, which has Latin letters only: any other
   character is written as "?" and counted in the result.
   ============================================================ */

let jsP = null, libP = null;

/** pdf.js, loaded on first use. */
export function loadPdfJs() {
  if (!jsP) {
    jsP = import('../../vendor/pdfjs/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    }).catch(err => { jsP = null; throw err; });
  }
  return jsP;
}
/** pdf-lib, loaded on first use. */
export function loadPdfLib() {
  if (!libP) libP = import('../../vendor/pdflib/pdf-lib.esm.min.js').catch(err => { libP = null; throw err; });
  return libP;
}

export class PdfError extends Error {}

const looksPdf = bytes => bytes && bytes.length > 8 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;   /* %PDF */

export async function openPdf(bytes) {
  if (!looksPdf(bytes)) throw new PdfError('This file doesn’t start like a PDF, so it can’t be opened.');
  const pdfjs = await loadPdfJs();
  /* pdf.js takes ownership of the array it is given: hand it a copy */
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true, disableFontFace: false, verbosity: 0 });
  let doc;
  try { doc = await task.promise; } catch (err) {
    if (err && err.name === 'PasswordException') throw new PdfError('This PDF is password-protected, which Static PDF tools can’t open.');
    throw new PdfError('This PDF is damaged or in a form that can’t be read.');
  }
  return { doc, pages: doc.numPages, close: () => { try { task.destroy(); } catch (e) { /* already gone */ } } };
}

/** The page's size as shown (turned by its own /Rotate), in points. */
export async function pageSize(doc, n) {
  const p = await doc.getPage(n);
  const v = p.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
}

export async function renderPage(doc, n, width) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const view = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(view.width));
  canvas.height = Math.max(1, Math.round(view.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view }).promise;
  return canvas;
}

export async function pageText(doc, n) {
  const page = await doc.getPage(n);
  const t = await page.getTextContent();
  return t.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
}

const hexRgb = (lib, hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || ['', '000000'];
  const n = parseInt(m[1], 16);
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const b64Bytes = dataUrl => {
  const s = atob(String(dataUrl).split(',')[1] || '');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** Draw the marks in. Returns { bytes, replaced } — replaced counts characters Helvetica can't write. */
export async function annotate(bytes, edits) {
  if (!looksPdf(bytes)) throw new PdfError('This file doesn’t start like a PDF.');
  const lib = await loadPdfLib();
  let src;
  try { src = await lib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }); } catch (err) {
    throw new PdfError('This PDF can’t be changed here: it may be password-protected or damaged.');
  }
  const font = await src.embedFont(lib.StandardFonts.Helvetica);
  const pages = src.getPages();
  let replaced = 0;
  for (const [num, entry] of Object.entries(edits || {})) {
    const page = pages[Number(num) - 1];
    if (!page || !entry || !entry.marks || !entry.marks.length) continue;
    const { width: W, height: H } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const vw = rot % 180 ? H : W, vh = rot % 180 ? W : H;           /* the page as shown */
    /* a place on the shown page (u, v from the top left) -> the page's own coordinates */
    const at = (u, v) => (rot === 0 ? { x: u * W, y: (1 - v) * H }
      : rot === 90 ? { x: v * W, y: u * H }
        : rot === 180 ? { x: (1 - u) * W, y: v * H }
          : { x: (1 - v) * W, y: (1 - u) * H });
    const turn = lib.degrees(rot);
    for (const m of entry.marks) {
      if (m.t === 'pen' && m.pts && m.pts.length) {
        const thickness = Math.max(0.5, (m.w || 0.004) * vw);
        const color = hexRgb(lib, m.color);
        const pts = m.pts.length === 1 ? [m.pts[0], [m.pts[0][0] + 0.0001, m.pts[0][1]]] : m.pts;
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({ start: at(pts[i - 1][0], pts[i - 1][1]), end: at(pts[i][0], pts[i][1]), thickness, color, lineCap: lib.LineCapStyle.Round });
        }
      } else if (m.t === 'hl') {
        const a = at(m.x, m.y + m.h);                                  /* the box's shown bottom-left */
        page.drawRectangle({ x: a.x, y: a.y, width: m.w * vw, height: m.h * vh, rotate: turn, color: hexRgb(lib, m.color || '#ffe14d'), opacity: 0.4, borderWidth: 0 });
      } else if (m.t === 'text' && m.text) {
        const size = Math.max(4, (m.size || 0.03) * vw);
        let line = '';
        for (const ch of String(m.text)) {
          let ok = true;
          try { font.encodeText(ch); } catch (e) { ok = false; }
          if (ok) line += ch; else { line += '?'; replaced++; }
        }
        const lines = line.split(/\r?\n/);
        lines.forEach((ln, i) => {
          /* the baseline sits about 0.8 of the size below the top, a line is 1.2 */
          const a = at(m.x, m.y + ((0.8 + 1.2 * i) * size) / vh);
          if (ln) page.drawText(ln, { x: a.x, y: a.y, size, font, color: hexRgb(lib, m.color), rotate: turn });
        });
      } else if (m.t === 'img' && m.png) {
        const img = await src.embedPng(b64Bytes(m.png));
        const a = at(m.x, m.y + m.h);
        page.drawImage(img, { x: a.x, y: a.y, width: m.w * vw, height: m.h * vh, rotate: turn });
      }
    }
  }
  return { bytes: new Uint8Array(await src.save()), replaced };
}

export async function mergePdfs(list) {
  if (!list.length) throw new PdfError('Choose at least one PDF to merge.');
  const lib = await loadPdfLib();
  const out = await lib.PDFDocument.create();
  for (let i = 0; i < list.length; i++) {
    if (!looksPdf(list[i])) throw new PdfError(`File ${i + 1} doesn’t start like a PDF.`);
    let src;
    try { src = await lib.PDFDocument.load(list[i], { updateMetadata: false }); } catch (err) {
      throw new PdfError(`File ${i + 1} can’t be read: it may be password-protected or damaged.`);
    }
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach(p => out.addPage(p));
  }
  return new Uint8Array(await out.save());
}

export async function extractPages(bytes, nums) {
  const lib = await loadPdfLib();
  let src;
  try { src = await lib.PDFDocument.load(bytes, { updateMetadata: false }); } catch (err) {
    throw new PdfError('This PDF can’t be read: it may be password-protected or damaged.');
  }
  const out = await lib.PDFDocument.create();
  const copied = await out.copyPages(src, nums.map(n => n - 1));
  copied.forEach(p => out.addPage(p));
  return new Uint8Array(await out.save());
}

/** "1-3, 5, 7-" -> [[1,2,3],[5],[7,8,9]] for a 9 page file. Throws RangeError with a plain sentence. */
export function parseRanges(text, pages) {
  const out = [];
  const parts = String(text || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new RangeError('Type the pages you want, like 1-3, 5.');
  for (const part of parts) {
    const m = /^(\d+)?\s*(?:-|–|to)\s*(\d+)?$/.exec(part) || /^(\d+)$/.exec(part);
    if (!m) throw new RangeError(`“${part}” isn’t a page or a range of pages.`);
    const a = m[1] === undefined ? (m.length > 2 ? 1 : NaN) : Number(m[1]);
    const b = m.length > 2 ? (m[2] === undefined ? pages : Number(m[2])) : a;
    if (!(a >= 1) || !(b >= 1)) throw new RangeError(`“${part}” isn’t a page or a range of pages.`);
    if (a > pages || b > pages) throw new RangeError(`This file has ${pages} page${pages === 1 ? '' : 's'}; “${part}” goes past the end.`);
    if (b < a) throw new RangeError(`“${part}” runs backwards.`);
    const run = [];
    for (let i = a; i <= b; i++) run.push(i);
    out.push(run);
  }
  return out;
}

export default { openPdf, renderPage, pageText, pageSize, annotate, mergePdfs, extractPages, parseRanges, loadPdfJs, loadPdfLib, PdfError };
