/* ============================================================
   forge/doc.js — a Forge template as a standalone game document,
   and the settings block inside it (see forge/templates.js).

   buildDoc(t, values?), readParams(html), writeParams(html, values),
   paramValues(info), cleanValue(p, v)
   ============================================================ */
import { forgeKit } from './kit.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i;

/** A value made safe for its setting: numbers clamped and snapped,
    colours must be #rrggbb, text is one short line. Returns the
    setting's current value when v is unusable. */
export function cleanValue(p, v) {
  if (!p) return v;
  if (p.type === 'range') {
    let n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return p.value;
    const min = Number.isFinite(p.min) ? p.min : -Infinity;
    const max = Number.isFinite(p.max) ? p.max : Infinity;
    n = Math.min(max, Math.max(min, n));
    if (p.step > 0 && Number.isFinite(p.min)) n = p.min + Math.round((n - p.min) / p.step) * p.step;
    const dec = p.step > 0 ? Math.max(0, (String(p.step).split('.')[1] || '').length) : 4;
    return Number(Math.min(max, Math.max(min, n)).toFixed(dec));
  }
  if (p.type === 'color') return HEX.test(String(v)) ? String(v).toLowerCase() : p.value;
  if (p.type === 'toggle') return v === true || v === 'true' || v === 1 || v === 'on';
  if (p.type === 'text') {
    const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, p.max || 40);
    return s || p.value;
  }
  return p.value;
}

/* one setting per line, and "<" written as < so nothing in a value
   can close the <script> element it sits in */
function formatParams(info) {
  const head = { forge: 1, template: info.template || null };
  const lines = (info.params || []).map(p => '  ' + JSON.stringify(p));
  const json = `{"forge":${head.forge},"template":${JSON.stringify(head.template)},"params":[\n${lines.join(',\n')}\n]}`;
  return json.replace(/</g, '\\u003c');
}

const PARAMS_RE = /(<script\b[^>]*\bid\s*=\s*["']forge-params["'][^>]*>)([\s\S]*?)(<\/script\s*>)/i;

/** The settings block of a game document, or null if it has none (or it is broken). */
export function readParams(html) {
  const m = String(html || '').match(PARAMS_RE);
  if (!m) return null;
  try {
    const o = JSON.parse(m[2]);
    if (!o || !Array.isArray(o.params)) return null;
    const params = o.params.filter(p => p && typeof p.k === 'string' && /^[A-Za-z_]\w{0,40}$/.test(p.k)
      && ['range', 'color', 'text', 'toggle'].includes(p.type));
    return { forge: o.forge || 1, template: typeof o.template === 'string' ? o.template : null, params };
  } catch (err) { return null; }
}

/** { k: value } of a settings block. */
export const paramValues = info => Object.fromEntries((info?.params || []).map(p => [p.k, p.value]));

/** The document with new setting values written into its block (and the
    title setting, if there is one, into <title>). Unknown keys are ignored;
    a document without a block comes back unchanged. */
export function writeParams(html, values = {}) {
  const src = String(html || '');
  const info = readParams(src);
  if (!info) return src;
  const params = info.params.map(p => (Object.prototype.hasOwnProperty.call(values, p.k) ? { ...p, value: cleanValue(p, values[p.k]) } : p));
  let out = src.replace(PARAMS_RE, (m0, open, body, close) => `${open}\n${formatParams({ ...info, params })}\n${close}`);
  const t = params.find(p => p.k === 'title' && p.type === 'text');
  if (t) out = out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(t.value)}</title>`);
  return out;
}

/** The template as a standalone game document. */
export function buildDoc(t, values = {}) {
  const params = t.params.map(p => ({ ...p, value: Object.prototype.hasOwnProperty.call(values, p.k) ? cleanValue(p, values[p.k]) : p.value }));
  const title = params.find(p => p.k === 'title')?.value || t.name;
  const bg = t.colors?.[0] || '#05060a';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:${bg}}canvas{display:block;width:100vw;height:100vh;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;outline:none}</style>
</head><body><canvas id="c" tabindex="0"></canvas>
<!-- ${esc(t.name)}: a Static Forge template. Its settings are the JSON below.
     Remix in Static Forge edits them for you; you can change them here too. -->
<script type="application/json" id="forge-params">
${formatParams({ template: t.id, params })}
</script>
<script>
/* ---- The game kit shared by every Static Forge template: start, pause and game-over
   screens, keyboard + touch input, particles, screen shake and beeps made in code. ---- */
${forgeKit.toString()}

/* ---- ${t.name} ---- */
${t.game.toString()}

forgeKit(game);
</script>
</body></html>
`;
}
