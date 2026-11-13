/* ============================================================
   js/sheets/csv.js — CSV and tab-separated text, both ways.

   Reading follows RFC 4180 and forgives what real files do:
   · a field in double quotes may hold the delimiter, line breaks and
     doubled quotes ("say ""hi""") — all kept exactly;
   · rows end with CRLF, LF or a lone CR; a final line break doesn't
     make an extra empty row; a UTF-8 byte-order mark is dropped;
   · a quote in the middle of an unquoted field is just a character.
   Writing quotes a field only when it must (it holds the delimiter, a
   quote, CR or LF), doubles the quotes inside, and ends every row —
   the last one too — with "\n", the line ending every other text file
   in the StaticOS file system uses.

   Tab-separated text is what spreadsheets put on the clipboard, so
   copy/paste between Static Sheets and Excel or Google Sheets goes
   through parse(text, '\t') and write(rows, '\t').
   ============================================================ */

/** text → rows of fields (strings) */
export function parse(text, delim = ',') {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [], field = '', i = 0, quoted = false, fieldStart = true, pending = false;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && fieldStart) { quoted = true; fieldStart = false; pending = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; fieldStart = true; pending = true; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      row.push(field); rows.push(row);
      row = []; field = ''; fieldStart = true; pending = false;
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; fieldStart = false; pending = true; i++;
  }
  if (pending || quoted) { row.push(field); rows.push(row); }
  return rows;
}

const needsQuotes = (v, delim) => v.includes(delim) || /["\r\n]/.test(v);
/** rows of strings → text, each row ended by "\n" */
export function write(rows, delim = ',', eol = '\n') {
  let out = '';
  for (const row of rows) {
    out += row.map(v => {
      const t = String(v ?? '');
      return needsQuotes(t, delim) ? `"${t.replace(/"/g, '""')}"` : t;
    }).join(delim) + eol;
  }
  return out;
}

/** The delimiter a file most likely uses: tab or semicolon when the first
    line has those and no commas, else comma. */
export function sniff(text, name = '') {
  if (/\.tsv$/i.test(name)) return '\t';
  const first = String(text || '').split(/\r?\n/, 1)[0] || '';
  const count = ch => first.split(ch).length - 1;
  if (count('\t') > 0 && count(',') === 0) return '\t';
  if (count(';') > 0 && count(',') === 0) return ';';
  return ',';
}

export default { parse, write, sniff };
