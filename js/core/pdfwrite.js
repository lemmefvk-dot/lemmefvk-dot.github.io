/* ============================================================
   pdfwrite.js — a minimal PDF writer: one picture per page.

     makePdf(pages, { title }) -> Promise<Blob>   (application/pdf)
       pages: [{ width, height, bits }]
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
   the picture's shape needs.
   ============================================================ */

const enc = new TextEncoder();

async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) { return null; }
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
    const { width, height, bits } = pages[i];
    if (!(width > 0 && height > 0) || !(bits instanceof Uint8Array) || bits.length !== ((width + 7) >> 3) * height) {
      throw new Error(`Page ${i + 1} is not a ${width}×${height} 1-bit picture.`);
    }
    const ptW = width > height ? 842 : 595;
    const ptH = +(ptW * height / width).toFixed(2);
    const n = pageNum(i);
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    streamObject(n + 1, '', enc.encode(`q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`));
    const packed = await deflate(bits);
    streamObject(n + 2, `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1${packed ? ' /Filter /FlateDecode' : ''}`, packed || bits);
  }

  const count = 4 + pages.length * 3;                               /* objects 0..count-1 */
  const xref = length;
  text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let k = 1; k < count; k++) text(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

export default { makePdf };
