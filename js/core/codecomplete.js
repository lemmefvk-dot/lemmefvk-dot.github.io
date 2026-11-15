/* ============================================================
   codecomplete.js — suggestions as you type in Static Code.

   Written for StaticOS (no library). It reads the text around the
   caret, works out what is being typed there, and offers words that
   fit:
     · HTML — tag names after "<", the open tag after "</", attribute
       names inside a tag (the ones every element has, plus the tag's
       own), and values for a few attributes (type, rel, target…).
       Inside <style> and <script> it switches to CSS and JavaScript.
     · CSS — property names in a rule, values for the property being
       set, tag names, the page's own .classes and #ids, and @rules.
     · JavaScript — keywords, the browser's common globals, members
       after a dot (console., Math., document., an array's or a
       string's methods, an element's), and words already used in the
       open files.
     · Python — keywords, built-ins, modules after "import", members
       of math, random, time, string methods and the draw module.
   Nothing is offered inside a comment or a string (except HTML
   attribute values it knows).

     suggest(text, pos, lang, { words, manual }) ->
       { from, to, items: [{ label, kind, insert, caret }] } | null
       Replacing text[from..to] with item.insert and putting the caret
       at from + item.caret is accepting it.
   ============================================================ */

import { VOID } from './codeedit.js';

const W = s => s.trim().split(/\s+/);

/* ---------------- HTML ---------------- */
export const TAGS = W(`a abbr address article aside audio b blockquote body br button canvas caption code col
  datalist details dialog div dl dt dd em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr
  html i iframe img input label legend li link main mark meta nav noscript ol optgroup option output p picture pre
  progress q s script section select small source span strong style sub summary sup svg table tbody td template
  textarea tfoot th thead time title tr u ul var video`);
const GLOBAL_ATTRS = W(`class id style title hidden tabindex lang dir role aria-label aria-hidden draggable
  contenteditable onclick oninput onchange onkeydown onload`);
const TAG_ATTRS = {
  a: W('href target rel download'), img: W('src alt width height loading'), link: W('rel href type media'),
  script: W('src type defer async'), meta: W('charset name content'), input: W('type name value placeholder checked disabled required min max step autofocus'),
  button: W('type disabled name value'), form: W('action method'), label: W('for'), select: W('name multiple disabled'),
  option: W('value selected disabled'), textarea: W('name rows cols placeholder disabled required'), canvas: W('width height'),
  video: W('src controls autoplay muted loop poster width height'), audio: W('src controls autoplay muted loop'),
  source: W('src type'), iframe: W('src title width height sandbox'), html: W('lang'), ol: W('start reversed'),
  td: W('colspan rowspan'), th: W('colspan rowspan scope'), progress: W('value max'), details: W('open'), dialog: W('open'),
};
const BOOL_ATTRS = new Set(W('hidden checked disabled required defer async multiple selected controls autoplay muted loop open autofocus reversed download'));
const ATTR_VALUES = {
  type: W('text button submit reset checkbox radio number range email password date color file search module'),
  rel: W('stylesheet icon noopener noreferrer'), target: W('_blank _self'), loading: W('lazy eager'),
  method: W('get post'), dir: W('ltr rtl auto'), charset: ['utf-8'], name: W('viewport description'),
};
/* ---------------- CSS ---------------- */
const CSS_PROPS = W(`align-content align-items align-self animation animation-delay animation-duration animation-name
  aspect-ratio backdrop-filter background background-color background-image background-position background-repeat
  background-size border border-bottom border-collapse border-color border-left border-radius border-right border-style
  border-top border-width bottom box-shadow box-sizing color column-gap columns content cursor display filter flex
  flex-basis flex-direction flex-grow flex-shrink flex-wrap float font font-family font-size font-style font-weight gap
  grid grid-area grid-column grid-row grid-template-areas grid-template-columns grid-template-rows height inset
  justify-content justify-items justify-self left letter-spacing line-height list-style margin margin-bottom margin-left
  margin-right margin-top max-height max-width min-height min-width object-fit opacity outline overflow overflow-x
  overflow-y padding padding-bottom padding-left padding-right padding-top place-items pointer-events position right
  row-gap scroll-behavior text-align text-decoration text-shadow text-transform top transform transition
  transition-duration user-select vertical-align visibility white-space width word-break z-index`);
const CSS_VALUES = {
  display: W('block inline inline-block flex inline-flex grid inline-grid none contents'),
  position: W('static relative absolute fixed sticky'), 'flex-direction': W('row column row-reverse column-reverse'),
  'flex-wrap': W('nowrap wrap wrap-reverse'), 'justify-content': W('flex-start flex-end center space-between space-around space-evenly start end'),
  'align-items': W('stretch flex-start flex-end center baseline start end'), 'align-content': W('stretch center space-between space-around start end'),
  'align-self': W('auto stretch center start end'), 'place-items': W('center start end stretch'),
  'text-align': W('left right center justify start end'), 'font-weight': W('normal bold lighter bolder 400 600 700'),
  'font-style': W('normal italic'), 'text-decoration': W('none underline line-through'), 'text-transform': W('none uppercase lowercase capitalize'),
  overflow: W('visible hidden scroll auto clip'), 'overflow-x': W('visible hidden scroll auto'), 'overflow-y': W('visible hidden scroll auto'),
  cursor: W('pointer default text move grab not-allowed crosshair'), visibility: W('visible hidden'),
  'box-sizing': W('border-box content-box'), 'white-space': W('normal nowrap pre pre-wrap'), 'object-fit': W('cover contain fill none'),
  'border-style': W('solid dashed dotted double none'), 'pointer-events': W('auto none'), 'user-select': W('none auto text all'),
  'font-family': ['system-ui, sans-serif', 'serif', 'monospace', 'cursive'], 'list-style': W('none disc decimal square'),
  'vertical-align': W('top middle bottom baseline'), 'word-break': W('normal break-all keep-all'), 'scroll-behavior': W('auto smooth'),
  float: W('left right none'), 'border-collapse': W('collapse separate'),
};
const CSS_COMMON = W('inherit initial unset auto none transparent currentColor');
const CSS_COLORS = W('black white red green blue orange purple pink yellow gray grey teal navy gold silver crimson coral tomato hotpink rebeccapurple');
const CSS_FUNCS = W('rgb() hsl() var() calc() min() max() clamp() url() linear-gradient() repeat() minmax()');
const AT_RULES = W('media keyframes import font-face supports layer container');

/* ---------------- JavaScript ---------------- */
const JS_KW = W(`async await break case catch class const continue debugger default delete do else export extends
  false finally for function if import in instanceof let new null of return static super switch this throw true try
  typeof undefined var void while yield`);
const JS_GLOBALS = W(`document window console Math JSON Array Object String Number Boolean Date Promise Map Set
  setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame fetch alert prompt
  confirm parseInt parseFloat isNaN Symbol Error localStorage navigator location structuredClone queueMicrotask
  Infinity NaN globalThis performance URL Image Audio`);
const MEMBERS = {
  console: W('log info warn error table clear group groupEnd time timeEnd count assert dir'),
  Math: W('abs ceil floor round trunc max min pow sqrt cbrt random sign sin cos tan atan atan2 hypot log log2 log10 exp PI E'),
  JSON: W('parse stringify'), Object: W('keys values entries assign freeze fromEntries create defineProperty'),
  Array: W('from isArray of'), Number: W('isInteger isFinite isNaN parseFloat parseInt MAX_SAFE_INTEGER EPSILON'),
  Promise: W('all allSettled any race resolve reject'), Date: W('now parse UTC'), String: W('fromCharCode raw'),
  document: W(`getElementById querySelector querySelectorAll createElement addEventListener body head title
    documentElement activeElement createTextNode getElementsByClassName`),
  window: W('addEventListener innerWidth innerHeight scrollTo requestAnimationFrame setTimeout location localStorage devicePixelRatio'),
  localStorage: W('getItem setItem removeItem clear'), navigator: W('clipboard language userAgent onLine'),
  performance: W('now'), location: W('href hash reload search'),
};
/* after a dot on something we don't know: what arrays, strings, elements and canvases have */
const ANY_MEMBERS = W(`length push pop shift unshift slice splice map filter reduce forEach find findIndex includes
  indexOf join sort reverse concat some every flat at keys values entries toString trim split replace replaceAll
  startsWith endsWith toUpperCase toLowerCase padStart repeat charAt addEventListener removeEventListener classList
  textContent innerHTML innerText style value checked appendChild append prepend remove setAttribute getAttribute
  querySelector querySelectorAll closest focus click dataset children parentElement getContext getBoundingClientRect
  fillRect clearRect strokeRect fillStyle strokeStyle lineWidth beginPath moveTo lineTo arc fill stroke closePath
  fillText font drawImage save restore translate rotate scale then catch finally json text add toggle contains`);

/* ---------------- Python ---------------- */
const PY_KW = W(`False None True and as assert async await break class continue def del elif else except finally
  for from global if import in is lambda nonlocal not or pass raise return try while with yield`);
const PY_BUILTINS = W(`print input range len int str float bool list dict set tuple enumerate zip sorted reversed sum
  min max abs round open isinstance type map filter any all chr ord format help`);
const PY_MODULES = W('math random time json re datetime collections itertools string statistics draw');
const PY_MEMBERS = {
  math: W('sqrt pi e floor ceil sin cos tan atan2 hypot radians degrees pow log log10 gcd factorial inf isclose'),
  random: W('random randint choice shuffle uniform sample seed randrange'),
  time: W('sleep time perf_counter'), json: W('loads dumps load dump'),
  draw: W('canvas clear background colour color fill no_fill thickness line circle rect dot polygon text show sleep size'),
  statistics: W('mean median mode stdev'), string: W('ascii_letters ascii_lowercase ascii_uppercase digits punctuation'),
};
const PY_ANY = W(`append extend insert pop remove sort reverse index count copy clear keys values items get update
  split join strip lstrip rstrip upper lower title replace startswith endswith find format isdigit isalpha`);

/* ---------------- what is at the caret ---------------- */
const lineBefore = (text, pos) => text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos);

/** Is pos inside a string or a comment on its line (JS, CSS, Python)? */
function inStringOrComment(text, pos, lang) {
  const line = lineBefore(text, pos);
  /* an unclosed block comment before the caret */
  if (lang !== 'py') {
    const open = text.lastIndexOf('/*', pos), close = text.lastIndexOf('*/', pos);
    if (open > close && open >= 0) return true;
  }
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || (c === '`' && lang === 'js')) { q = c; continue; }
    if (lang === 'js' && c === '/' && line[i + 1] === '/') return true;
    if (lang === 'py' && c === '#') return true;
  }
  return !!q;
}

/** Inside an HTML file, which language the caret is in. */
function htmlZone(text, pos) {
  const before = text.slice(0, pos).toLowerCase();
  const so = before.lastIndexOf('<style'), sc = before.lastIndexOf('</style');
  if (so > sc && before.indexOf('>', so) >= 0) return 'css';
  const jo = before.lastIndexOf('<script'), jc = before.lastIndexOf('</script');
  if (jo > jc && before.indexOf('>', jo) >= 0) return 'js';
  return 'html';
}

/* rank: what starts with the prefix in the same case first, then by source, then shortest */
function rank(list, prefix, max = 14) {
  const p = prefix.toLowerCase();
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const l = it.label;
    if (seen.has(l) || (p && !l.toLowerCase().startsWith(p)) || l === prefix) continue;
    seen.add(l);
    out.push(it);
  }
  out.sort((a, b) => (b.label.startsWith(prefix) - a.label.startsWith(prefix)) || (a.w || 0) - (b.w || 0) || a.label.length - b.label.length || a.label.localeCompare(b.label));
  return out.slice(0, max);
}
const items = (words, kind, w = 0) => words.map(label => ({ label, kind, insert: label, caret: label.length, w }));

/** Words worth offering from text: identifiers of 3+ characters. */
export function wordsIn(text, lang) {
  const re = lang === 'py' ? /[A-Za-z_]\w{2,}/g : /[A-Za-z_$][\w$]{2,}/g;
  const out = new Set();
  const t = text.length > 200000 ? text.slice(0, 200000) : text;
  for (const m of t.matchAll(re)) { out.add(m[0]); if (out.size > 4000) break; }
  return out;
}
/* names used after a dot anywhere in the text: likely members of things here */
const membersIn = text => {
  const out = new Set();
  for (const m of text.slice(0, 200000).matchAll(/\.([A-Za-z_$][\w$]{1,})/g)) out.add(m[1]);
  return out;
};

function js(text, pos, words, manual) {
  if (inStringOrComment(text, pos, 'js')) return null;
  const line = lineBefore(text, pos);
  const dot = /([A-Za-z_$][\w$]*)\s*\.\s*([\w$]*)$/.exec(line);
  if (dot) {
    const [, obj, pre] = dot;
    const known = MEMBERS[obj];
    const list = known ? items(known, 'prop') : [...items(ANY_MEMBERS, 'prop', 1), ...items([...membersIn(text)], 'word', 2)];
    return { from: pos - pre.length, to: pos, items: rank(list, pre) };
  }
  const m = /[A-Za-z_$][\w$]*$/.exec(line);
  const pre = m ? m[0] : '';
  if (!manual && pre.length < 2) return null;
  if (/\d$/.test(line.slice(0, line.length - pre.length)) && pre) return null;
  const own = [...words].filter(w => w !== pre);
  return { from: pos - pre.length, to: pos, items: rank([...items(JS_KW, 'kw', 1), ...items(JS_GLOBALS, 'fn', 1), ...items(own, 'word', 0)], pre) };
}

function css(text, pos, manual, base = 0) {
  if (inStringOrComment(text, pos, 'css')) return null;
  const before = text.slice(base, pos);
  /* inside a rule: after the last { that has no } after it */
  const open = before.lastIndexOf('{'), close = before.lastIndexOf('}');
  const line = lineBefore(text, pos);
  const at = /@([\w-]*)$/.exec(line);
  if (at) return { from: pos - at[1].length, to: pos, items: rank(items(AT_RULES, 'kw'), at[1]) };
  if (open > close) {
    const decl = before.slice(Math.max(open, before.lastIndexOf(';')) + 1);
    const colon = decl.indexOf(':');
    if (colon < 0) {
      const pre = (/[\w-]*$/.exec(decl) || [''])[0];
      if (!manual && !pre) return null;
      /* a property comes with its ': ', and the caret goes after it */
      const list = CSS_PROPS.map(label => ({ label, kind: 'prop', insert: `${label}: `, caret: label.length + 2, then: true }));
      return { from: pos - pre.length, to: pos, items: rank(list, pre) };
    }
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const pre = (/[\w-]*$/.exec(decl.slice(colon + 1)) || [''])[0];
    if (!manual && !pre && !/:\s*$/.test(decl)) return null;
    const vals = [...items(CSS_VALUES[prop] || [], 'value'), ...items(/color|background|border|shadow|fill|outline/.test(prop) ? CSS_COLORS : [], 'value', 1),
      ...items(CSS_COMMON, 'value', 2), ...CSS_FUNCS.map(f => ({ label: f, kind: 'fn', insert: f, caret: f.length - 1, w: 3 }))];
    return { from: pos - pre.length, to: pos, items: rank(vals, pre) };
  }
  /* a selector */
  const m = /([.#]?)([\w-]*)$/.exec(line);
  const [, sigil, pre] = m;
  if (!manual && !sigil && pre.length < 1) return null;
  const names = new Set();
  const re = sigil === '#' ? /\bid\s*=\s*["']([^"']+)["']/g : /\bclass\s*=\s*["']([^"']+)["']/g;
  if (sigil) for (const x of text.matchAll(re)) for (const n of x[1].split(/\s+/)) if (n) names.add(n);
  if (sigil) for (const x of text.matchAll(sigil === '#' ? /#([A-Za-z][\w-]*)/g : /\.([A-Za-z][\w-]*)\s*[{,:]/g)) names.add(x[1]);
  const list = sigil ? items([...names], 'word') : items(TAGS, 'tag');
  return { from: pos - pre.length, to: pos, items: rank(list, pre) };
}

function html(text, pos, manual) {
  const zone = htmlZone(text, pos);
  if (zone === 'css') return css(text, pos, manual, text.toLowerCase().lastIndexOf('<style', pos));
  if (zone === 'js') return js(text, pos, wordsIn(text, 'js'), manual);
  const before = text.slice(Math.max(0, pos - 2000), pos);
  /* </ → the nearest tag still open */
  const end = /<\/([\w-]*)$/.exec(before);
  if (end) {
    const open = unclosed(text.slice(0, pos - end[0].length));
    const list = [...(open ? [{ label: open, kind: 'tag', insert: `${open}>`, caret: open.length + 1, w: -1 }] : []), ...TAGS.map(t => ({ label: t, kind: 'tag', insert: `${t}>`, caret: t.length + 1 }))];
    return { from: pos - end[1].length, to: pos, items: rank(list, end[1]) };
  }
  const tagStart = /<([a-zA-Z][\w-]*)$/.exec(before);
  if (tagStart || /<$/.test(before)) {
    const pre = tagStart ? tagStart[1] : '';
    return { from: pos - pre.length, to: pos, items: rank(items(TAGS, 'tag'), pre) };
  }
  /* inside an opening tag */
  const inTag = /<([a-zA-Z][\w-]*)\b([^<>]*)$/.exec(before);
  if (!inTag) return null;
  const tag = inTag[1].toLowerCase();
  const rest = inTag[2];
  const val = /([\w-]+)\s*=\s*["']([^"']*)$/.exec(rest);
  if (val) {
    const vals = ATTR_VALUES[val[1].toLowerCase()];
    return vals ? { from: pos - val[2].length, to: pos, items: rank(items(vals, 'value'), val[2]) } : null;
  }
  if (((rest.match(/"/g) || []).length % 2) || ((rest.match(/'/g) || []).length % 2)) return null;
  const pre = /\s([\w-]*)$/.exec(rest);
  if (!pre || (!manual && !pre[1])) return null;
  const list = [...(TAG_ATTRS[tag] || []).map(a => attrItem(a, 0)), ...GLOBAL_ATTRS.map(a => attrItem(a, 1))];
  return { from: pos - pre[1].length, to: pos, items: rank(list, pre[1]) };
}
const attrItem = (a, w) => BOOL_ATTRS.has(a) && a !== 'download'
  ? { label: a, kind: 'attr', insert: a, caret: a.length, w }
  : { label: a, kind: 'attr', insert: `${a}=""`, caret: a.length + 2, w, then: !!ATTR_VALUES[a] };

/** The innermost element still open at the end of text. */
export function unclosed(text) {
  const stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)\b[^<>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    const t = m[2].toLowerCase();
    if (m[1]) { const i = stack.lastIndexOf(t); if (i >= 0) stack.length = i; }
    else if (!m[3] && !VOID.has(t)) stack.push(t);
  }
  return stack.pop() || null;
}

function py(text, pos, words, manual) {
  if (inStringOrComment(text, pos, 'py')) return null;
  const line = lineBefore(text, pos);
  const imp = /^\s*(?:import|from)\s+([\w]*)$/.exec(line);
  if (imp) return { from: pos - imp[1].length, to: pos, items: rank(items(PY_MODULES, 'mod'), imp[1]) };
  const dot = /([A-Za-z_]\w*)\.(\w*)$/.exec(line);
  if (dot) {
    const list = PY_MEMBERS[dot[1]] ? items(PY_MEMBERS[dot[1]], 'fn') : [...items(PY_ANY, 'fn', 1), ...items([...membersIn(text)], 'word', 2)];
    return { from: pos - dot[2].length, to: pos, items: rank(list, dot[2]) };
  }
  const m = /[A-Za-z_]\w*$/.exec(line);
  const pre = m ? m[0] : '';
  if (!manual && pre.length < 2) return null;
  const own = [...words].filter(w => w !== pre);
  return { from: pos - pre.length, to: pos, items: rank([...items(PY_KW, 'kw', 1), ...items(PY_BUILTINS, 'fn', 1), ...items(own, 'word', 0)], pre) };
}

export function suggest(text, pos, lang, { words = null, manual = false } = {}) {
  let r = null;
  if (lang === 'html') r = html(text, pos, manual);
  else if (lang === 'css') r = css(text, pos, manual);
  else if (lang === 'js') r = js(text, pos, words || wordsIn(text, 'js'), manual);
  else if (lang === 'py') r = py(text, pos, words || wordsIn(text, 'py'), manual);
  if (!r || !r.items.length) return null;
  return r;
}

export default { suggest, wordsIn, unclosed, TAGS };
