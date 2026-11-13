/* ============================================================
   dev-tools-json.js - the JSON half of Dev Tools, with no DOM.

   · parseJson(text)   -> { ok, value } or { ok:false, error:{ message,
     pos, line, col } }. JSON.parse decides what is valid; when it says no,
     a small scanner of our own finds WHERE and says why in plain words
     (engines word their errors differently and not all give a position).
   · reformat(text, indent) re-indents (or, with 0, minifies) the SOURCE
     TEXT token by token, so numbers keep their exact digits (12345678901234567890
     stays that, 1.0 stays 1.0), keys keep their order and duplicate keys
     survive. Going through JSON.stringify would lose all three.
   · rows(root, expanded, cap) lists only the nodes that are on screen
     once their parents are open, so a multi-megabyte file costs what is
     expanded, not what exists. find(root, q) walks the tree without
     building nodes. pathOf(row) writes a $.a[0]["b c"] path.

   Everything here treats keys and values as data. Nothing returns
   markup.
   ============================================================ */

export function lineCol(text, pos) {
  let line = 1, last = -1;
  const end = Math.min(pos, text.length);
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) { line++; last = i; }
  return { line, col: end - last };
}

const isWs = c => c === 32 || c === 10 || c === 13 || c === 9;
const isDigit = c => c >= 48 && c <= 57;

/* Where (and why) `text` is not JSON. null when it is. */
export function scan(text) {
  const n = text.length;
  let i = 0;
  const ws = () => { while (i < n && isWs(text.charCodeAt(i))) i++; };
  const show = c => (c === undefined ? 'the end of the text' : c === '\n' ? 'a line break' : `“${c}”`);
  const fail = (pos, message) => ({ pos, message });
  const stack = [];          /* '{' or '[' for each open container */
  let state = 'value';       /* what comes next */
  let comma = -1;            /* position of the last comma, for "trailing comma" */

  function str() {           /* i is at the opening quote */
    const start = i++;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) { i++; return null; }
      if (c === 92) {
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return fail(i, 'A \\u escape needs four hex digits');
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else return fail(i, e === undefined ? 'The text ends inside a string' : `“\\${e}” is not a valid escape in a string`);
      } else if (c < 32) return fail(i, 'A line break or control character inside a string must be written as \\n or \\u….');
      else i++;
    }
    return fail(start, 'This string is never closed (missing ending quote)');
  }

  function num() {
    const start = i;
    if (text[i] === '-') i++;
    if (text[i] === '0') {
      i++;
      if (isDigit(text.charCodeAt(i))) return fail(start, 'Numbers can’t have leading zeros');
    } else if (isDigit(text.charCodeAt(i))) while (isDigit(text.charCodeAt(i))) i++;
    else return fail(i, `Expected a digit after the minus sign, found ${show(text[i])}`);
    if (text[i] === '.') {
      i++;
      if (!isDigit(text.charCodeAt(i))) return fail(i, `Expected a digit after the decimal point, found ${show(text[i])}`);
      while (isDigit(text.charCodeAt(i))) i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!isDigit(text.charCodeAt(i))) return fail(i, `Expected a digit in the exponent, found ${show(text[i])}`);
      while (isDigit(text.charCodeAt(i))) i++;
    }
    return null;
  }

  for (;;) {
    ws();
    if (state === 'value') {
      const c = text[i];
      if (c === undefined) return fail(n, 'The text ends where a value should be');
      let err = null;
      if (c === '{') {
        i++; ws();
        if (text[i] === '}') { i++; state = 'after'; continue; }
        stack.push('{'); state = 'key'; continue;
      }
      if (c === '[') {
        i++; ws();
        if (text[i] === ']') { i++; state = 'after'; continue; }
        stack.push('['); continue;
      }
      if (c === '"') err = str();
      else if (c === '-' || isDigit(c.charCodeAt(0))) err = num();
      else if (text.startsWith('true', i)) i += 4;
      else if (text.startsWith('false', i)) i += 5;
      else if (text.startsWith('null', i)) i += 4;
      else if (c === ']' && stack[stack.length - 1] === '[' && comma >= 0) return fail(comma, 'Trailing comma: remove the comma before the closing ]');
      else if (c === "'") return fail(i, 'Strings use double quotes in JSON, not single quotes');
      else return fail(i, `Expected a value, found ${show(c)}`);
      if (err) return err;
      state = 'after'; continue;
    }
    if (state === 'key') {
      const c = text[i];
      if (c === '"') {
        const err = str();
        if (err) return err;
        ws();
        if (text[i] !== ':') return fail(i, `Expected “:” after a property name, found ${show(text[i])}`);
        i++; state = 'value'; comma = -1; continue;
      }
      if (c === '}' && comma >= 0) return fail(comma, 'Trailing comma: remove the comma before the closing }');
      if (c === undefined) return fail(n, 'The text ends where a property name should be');
      return fail(i, c === "'" ? 'Property names use double quotes in JSON, not single quotes' : `Expected a property name in double quotes, found ${show(c)}`);
    }
    /* after a value */
    if (!stack.length) return i < n ? fail(i, `Unexpected ${show(text[i])} after the end of the JSON`) : null;
    const top = stack[stack.length - 1];
    const c = text[i];
    if (c === ',') { comma = i; i++; ws(); state = top === '{' ? 'key' : 'value'; continue; }
    if ((c === '}' && top === '{') || (c === ']' && top === '[')) { stack.pop(); i++; comma = -1; continue; }
    if (c === undefined) return fail(n, `The text ends before the ${top === '{' ? '}' : ']'} that closes ${top === '{' ? 'an object' : 'an array'}`);
    return fail(i, `Expected “,” or “${top === '{' ? '}' : ']'}” here, found ${show(c)}`);
  }
}

export function parseJson(text) {
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  try { return { ok: true, value: JSON.parse(src) }; } catch (err) {
    let found = scan(src);
    if (!found) {
      /* the scanner thinks it is valid but the engine disagrees: trust the engine's own position if it gave one */
      const m = /position (\d+)/.exec(err.message || '');
      found = { pos: m ? +m[1] : 0, message: String(err.message || 'Not valid JSON') };
    }
    return { ok: false, error: { ...found, ...lineCol(src, found.pos) } };
  }
}

/* Re-indent valid JSON text without touching a single token. indent: 0
   minifies; a number is that many spaces; '\t' is a tab. */
export function reformat(text, indent = 2) {
  const unit = indent === 0 ? '' : indent === '\t' ? '\t' : ' '.repeat(indent);
  const pretty = unit !== '';
  const n = text.length;
  const out = [];
  let depth = 0;
  const nl = () => { if (pretty) out.push('\n' + unit.repeat(depth)); };
  for (let i = 0; i < n;) {
    const ch = text[i];
    const c = text.charCodeAt(i);
    if (isWs(c) || c === 0xFEFF) { i++; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i, j + 1)); i = j + 1; continue;
    }
    if (ch === '{' || ch === '[') {
      let j = i + 1;
      while (j < n && isWs(text.charCodeAt(j))) j++;
      if (text[j] === (ch === '{' ? '}' : ']')) { out.push(ch + text[j]); i = j + 1; continue; }
      out.push(ch); depth++; nl(); i++; continue;
    }
    if (ch === '}' || ch === ']') { depth--; nl(); out.push(ch); i++; continue; }
    if (ch === ',') { out.push(','); nl(); i++; continue; }
    if (ch === ':') { out.push(pretty ? ': ' : ':'); i++; continue; }
    let j = i;
    while (j < n && !isWs(text.charCodeAt(j)) && ',:]}'.indexOf(text[j]) < 0) j++;
    out.push(text.slice(i, j)); i = j;
  }
  return out.join('');
}

/* ---------------- the tree ---------------- */

export const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
export const isBranch = v => v !== null && typeof v === 'object';
const esc = k => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

export function sizeOf(v) {
  return Array.isArray(v) ? v.length : Object.keys(v).length;
}

/* The rows of the open part of the tree, in order. A row is
   { id, depth, key, value, type, count, open, parent }. Stops at `cap`. */
export function rows(root, expanded, cap = 300000) {
  const out = [];
  const walk = (value, key, id, depth, parent) => {
    if (out.length >= cap) return;
    const branch = isBranch(value);
    const open = branch && expanded.has(id);
    const row = { id, depth, key, value, type: typeOf(value), count: branch ? sizeOf(value) : 0, open, parent };
    out.push(row);
    if (!open) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length && out.length < cap; i++) walk(value[i], i, id + '/' + i, depth + 1, row);
    } else {
      for (const k of Object.keys(value)) { if (out.length >= cap) break; walk(value[k], k, id + '/' + esc(k), depth + 1, row); }
    }
  };
  walk(root, null, '', 0, null);
  return out;
}

export const idOf = keys => keys.map(k => '/' + esc(k)).join('');

/* "$.a[0]["b c"]" for a row (or a list of keys) */
export function pathOf(rowOrKeys) {
  let keys = rowOrKeys;
  if (!Array.isArray(rowOrKeys)) {
    keys = [];
    for (let r = rowOrKeys; r && r.parent; r = r.parent) keys.unshift(r.key);
  }
  let s = '$';
  for (const k of keys) s += typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
  return s;
}

/* Every key and value that contains q (any case), in document order, as
   key lists. Stops at `cap` and says so. */
export function find(root, q, cap = 500) {
  const needle = String(q).toLowerCase();
  const hits = [];
  if (!needle) return { hits, capped: false };
  const stack = [[root, []]];
  let capped = false;
  while (stack.length) {
    const [value, keys] = stack.pop();
    if (keys.length && typeof keys[keys.length - 1] === 'string' && keys[keys.length - 1].toLowerCase().includes(needle)) {
      if (hits.length >= cap) { capped = true; break; }
      hits.push({ keys, where: 'key' });
    } else if (!isBranch(value) && String(value).toLowerCase().includes(needle)) {
      if (hits.length >= cap) { capped = true; break; }
      hits.push({ keys, where: 'value' });
    }
    if (isBranch(value)) {
      if (Array.isArray(value)) for (let i = value.length - 1; i >= 0; i--) stack.push([value[i], keys.concat(i)]);
      else { const ks = Object.keys(value); for (let i = ks.length - 1; i >= 0; i--) stack.push([value[ks[i]], keys.concat(ks[i])]); }
    }
  }
  return { hits, capped };
}

export function valueAt(root, keys) {
  let v = root;
  for (const k of keys) { if (!isBranch(v)) return undefined; v = v[k]; }
  return v;
}
