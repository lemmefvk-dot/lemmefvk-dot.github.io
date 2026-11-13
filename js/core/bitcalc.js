/* ============================================================
   bitcalc.js — the arithmetic behind the Calculator's Programmer mode.

   Every number is a BigInt held as an UNSIGNED bit pattern of the
   chosen word size (8, 16, 32 or 64 bits). "Signed" is only a way of
   reading that pattern: with signed on, the top bit means negative
   (two's complement); with it off, the pattern is the number.

   Overflow behaviour is two's complement wrap-around, always: a result
   that does not fit the word keeps only its low bits (127 + 1 is -128 in
   8-bit signed, 255 + 1 is 0 in 8-bit unsigned), and apply() says so
   with `overflow: true` for + − × ÷ so the calculator can tell the person.

   Changing the word size keeps the NUMBER where it fits: widening a
   negative signed value sign-extends it (8-bit -1 is FF, 16-bit -1 is
   FFFF), widening an unsigned one zero-extends, and narrowing keeps the
   low bits.

   Shifts: << fills with zeros; >> is arithmetic (copies the sign bit)
   when signed and logical (fills zeros) when unsigned. A shift by the
   word size or more empties the word (or leaves all sign bits).
   Rotates wrap the bits around the word; the count is taken modulo the
   word size. A negative count is an error.
   ============================================================ */

export const SIZES = [8, 16, 32, 64];
export const BASES = [16, 10, 8, 2];
export const BASE_NAME = { 16: 'HEX', 10: 'DEC', 8: 'OCT', 2: 'BIN' };

const big = n => BigInt(n);
export const mask = n => (1n << big(n)) - 1n;
/** Any integer → its unsigned n-bit pattern (two's complement for negatives). */
export const wrap = (v, n) => BigInt.asUintN(n, big(v));
/** The number a pattern means: signed reads the top bit as the sign. */
export const value = (u, n, signed) => (signed ? BigInt.asIntN(n, u) : BigInt.asUintN(n, u));
export const minOf = (n, signed) => (signed ? -(1n << big(n - 1)) : 0n);
export const maxOf = (n, signed) => (signed ? (1n << big(n - 1)) - 1n : mask(n));

/** The same number in a different word size (sign- or zero-extended, or truncated). */
export const resize = (u, from, to, signed) => wrap(value(u, from, signed), to);
export const not = (u, n) => (u ^ mask(n)) & mask(n);
export const negate = (u, n) => wrap(-u, n);
export const toggleBit = (u, i, n) => ((u ^ (1n << big(i))) & mask(n));
export const bitAt = (u, i) => ((u >> big(i)) & 1n) === 1n;
export function popcount(u) { let c = 0; for (let x = u; x > 0n; x >>= 1n) if (x & 1n) c++; return c; }

/* ---- text <-> number ---- */
const DIGITS = '0123456789ABCDEF';
export const digitValue = ch => DIGITS.indexOf(String(ch).toUpperCase());
/** Digits typed in `base` → a non-negative BigInt, or null when empty / not all valid digits. */
export function parseDigits(str, base) {
  const s = String(str || '').replace(/[\s_,]/g, '').toUpperCase();
  if (!s) return null;
  let v = 0n;
  const b = big(base);
  for (const ch of s) {
    const d = digitValue(ch);
    if (d < 0 || d >= base) return null;
    v = v * b + big(d);
  }
  return v;
}
/** Would typing this magnitude stay inside the word? (Decimal follows the signed range when signed.) */
export const fits = (mag, n, signed, base) => mag <= (base === 10 ? maxOf(n, signed) : mask(n));

/** The pattern written in `base`. Hex, octal and binary show the raw bits; decimal the signed or unsigned number. */
export function format(u, n, signed, base) {
  if (base === 10) return value(u, n, signed).toString(10);
  if (base === 16) return u.toString(16).toUpperCase();
  if (base === 2) return u.toString(2).padStart(n, '0');
  return u.toString(8);
}
/** Readable grouping: nibbles in hex and binary, thousands in decimal, threes in octal. */
export function group(s, base) {
  const neg = s.startsWith('-');
  const t = neg ? s.slice(1) : s;
  const size = base === 10 ? 3 : base === 8 ? 3 : 4;
  const sep = base === 10 ? ',' : ' ';
  const parts = [];
  for (let i = t.length; i > 0; i -= size) parts.unshift(t.slice(Math.max(0, i - size), i));
  return (neg ? '-' : '') + parts.join(sep);
}

/* ---- the operations ---- */
export const BINARY = ['and', 'or', 'xor', 'add', 'sub', 'mul', 'div', 'mod', 'shl', 'shr', 'rol', 'ror'];

/** a OP b on n-bit patterns. -> { u, overflow, error? } — u is the n-bit result pattern. */
export function apply(op, a, b, n, signed) {
  const M = mask(n);
  a &= M; b &= M;
  const va = value(a, n, signed), vb = value(b, n, signed);
  const arith = exact => { const u = wrap(exact, n); return { u, overflow: value(u, n, signed) !== exact }; };
  switch (op) {
    case 'and': return { u: a & b, overflow: false };
    case 'or': return { u: a | b, overflow: false };
    case 'xor': return { u: a ^ b, overflow: false };
    case 'add': return arith(va + vb);
    case 'sub': return arith(va - vb);
    case 'mul': return arith(va * vb);
    case 'div': return vb === 0n ? { u: 0n, overflow: false, error: 'Cannot divide by zero' } : arith(va / vb);   /* toward zero */
    case 'mod': return vb === 0n ? { u: 0n, overflow: false, error: 'Cannot divide by zero' } : arith(va % vb);   /* sign of the dividend */
    case 'shl': case 'shr': case 'rol': case 'ror': {
      if (vb < 0n) return { u: 0n, overflow: false, error: 'A shift count can’t be negative' };
      if (op === 'shl') return { u: wrap(a << (vb > 1000n ? 1000n : vb), n), overflow: false };
      if (op === 'shr') return { u: wrap(value(a, n, signed) >> (vb > 1000n ? 1000n : vb), n), overflow: false };
      const c = Number(vb % big(n));
      if (c === 0) return { u: a, overflow: false };
      const left = op === 'rol' ? c : n - c;
      return { u: ((a << big(left)) | (a >> big(n - left))) & M, overflow: false };
    }
    default: return { u: 0n, overflow: false, error: 'Unknown operation' };
  }
}

export default { SIZES, BASES, BASE_NAME, BINARY, mask, wrap, value, minOf, maxOf, resize, not, negate, toggleBit, bitAt, popcount, digitValue, parseDigits, fits, format, group, apply };
