/* ============================================================
   pdfwrite.js — a minimal PDF writer: one picture per page.

     makePdf(pages, { title }) -> Promise<Blob>   (application/pdf)
       pages: [{ width, height, bits, paper? }]
         bits   Uint8Array, 1 bit a pixel, MSB first, rows padded to
                whole bytes, 1 = white (docscan.pack1bit)

   The file is PDF 1.4: a Catalog, a Pages node, then for each page a
   Page, a content stream that paints the picture over the whole page,
   and the picture itself as a 1-bit DeviceGray image XObject. A cross-
   reference table with exact byte offsets and a trailer close it.
   The picture is deflated with the browser's CompressionStream where it
   has one (/FlateDecode wants zlib framing, which 'deflate' is) and
   stored as is where it doesn't. Nothing is fetched or sent anywhere.
   The page is A4 wide (595 pt, or 842 pt when landscape) and as tall as
   the picture's shape needs. A page can ask for real paper instead
   (paper: 'a4' | 'letter'): the picture is then fitted inside that sheet,
   turned landscape when the picture is wider than tall.

   A page may also be a colour or grey picture instead of a 1-bit one:
     { width, height, jpeg }  a baseline JPEG file's bytes (3 components,
                              what canvas.toBlob('image/jpeg') writes),
                              stored as is (/DCTDecode)
     { width, height, gray }  Uint8Array, 8 bits a pixel, row after row
   ============================================================ */

const enc = new TextEncoder();

async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) { return null; }
}

/** Sheet sizes in points, portrait. */
export const PAPER = { a4: [595, 842], letter: [612, 792] };

/** Where a page's picture goes: the sheet (MediaBox) and the picture's box on it. */
function layoutOf({ width, height, paper }) {
  const land = width > height;
  const P = PAPER[paper];
  if (!P) {
    const ptW = land ? 842 : 595;
    const ptH = +(ptW * height / width).toFixed(2);
    return { ptW, ptH, x: 0, y: 0, w: ptW, h: ptH };
  }
  const ptW = land ? P[1] : P[0], ptH = land ? P[0] : P[1];
  const k = Math.min(ptW / width, ptH / height);
  const w = +(width * k).toFixed(2), h = +(height * k).toFixed(2);
  return { ptW, ptH, x: +((ptW - w) / 2).toFixed(2), y: +((ptH - h) / 2).toFixed(2), w, h };
}

/* PDF strings: Latin-1 text in parentheses, or UTF-16BE with a BOM in hex for anything else */
function pdfText(s) {
  const t = String(s ?? '');
  if (/^[\x20-\x7e]*$/.test(t)) return `(${t.replace(/[\\()]/g, m => `\\${m}`)})`;
  let hex = 'FEFF';
  for (let i = 0; i < t.length; i++) hex += t.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}

const pdfDate = d => {
  const p = n => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

export async function makePdf(pages, { title = 'Scan', now = new Date() } = {}) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('A PDF needs at least one page.');
  const parts = [];                 /* Uint8Arrays, in file order */
  let length = 0;
  const offsets = [];               /* object number -> byte offset */
  const push = bytes => { parts.push(bytes); length += bytes.length; };
  const text = s => push(enc.encode(s));
  const object = (num, body) => { offsets[num] = length; text(`${num} 0 obj\n${body}\nendobj\n`); };
  const streamObject = (num, dict, data) => {
    offsets[num] = length;
    text(`${num} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
    push(data);
    text('\nendstream\nendobj\n');
  };

  /* object numbers: 1 catalog, 2 pages, 3 info, then three per page */
  const pageNum = i => 4 + i * 3;
  text('%PDF-1.4\n');
  push(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));          /* the "binary file" comment */
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] >>`);
  object(3, `<< /Title ${pdfText(title)} /Producer (StaticOS Scan) /CreationDate (${pdfDate(now)}) >>`);

  for (let i = 0; i < pages.length; i++) {
    const { width, height, bits, jpeg, gray } = pages[i];
    const bad = () => new Error(`Page ${i + 1} is not a ${width}×${height} picture I can write.`);
    if (!(width > 0 && height > 0)) throw bad();
    let dict, data;
    if (jpeg !== undefined) {
      if (!(jpeg instanceof Uint8Array) || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw bad();
      dict = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`;
      data = jpeg;
    } else if (gray !== undefined) {
      if (!(gray instanceof Uint8Array) || gray.length !== width * height) throw bad();
      const packed = await deflate(gray);
      dict = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8${packed ? ' /Filter /FlateDecode' : ''}`;
      data = packed || gray;
    } else {
      if (!(bits instanceof Uint8Array) || bits.length !== ((width + 7) >> 3) * height) throw bad();
      const packed = await deflate(bits);
      dict = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1${packed ? ' /Filter /FlateDecode' : ''}`;
      data = packed || bits;
    }
    const { ptW, ptH, x, y, w, h } = layoutOf(pages[i]);
    const n = pageNum(i);
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    streamObject(n + 1, '', enc.encode(`q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q`));
    streamObject(n + 2, dict, data);
  }

  const count = 4 + pages.length * 3;                               /* objects 0..count-1 */
  const xref = length;
  text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let k = 1; k < count; k++) text(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

export default { makePdf };
