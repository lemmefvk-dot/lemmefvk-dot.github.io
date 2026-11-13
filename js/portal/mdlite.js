/* ============================================================
   mdlite.js — just enough Markdown for a model's answer.

   Model text is untrusted, so this never touches innerHTML: every
   node is built with createElement and every string lands as a text
   node. It covers what an answer actually uses — paragraphs with
   hard line breaks, headings, bullet and numbered lists, fenced
   code, simple pipe tables, **bold**, *italic* and `code` — and
   leaves anything else as the literal text it was.

   LaTeX is flattened to plain symbols first, because a small model
   reaches for \frac and \times even when asked not to.

   render(text) -> DocumentFragment
   render(text, { doc: true }) -> the same for a whole document (Code's
     Markdown preview): real h1–h6, [links](https://…) (only http, https
     and mailto ever become links; anything else, javascript: included,
     stays plain text), > quotes, --- rules, ~~strike~~, and images shown
     as their alt text — nothing is ever loaded or run. Raw HTML in the
     text is just text.
   ============================================================ */

const TEX = [
  [/\\\(|\\\)|\\\[|\\\]/g, ''],
  [/\$\$([^$]+)\$\$/g, '$1'],
  [/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)'],
  [/\\sqrt\{([^{}]+)\}/g, '√($1)'],
  [/\\times/g, '×'], [/\\div/g, '÷'], [/\\cdot/g, '·'], [/\\pm/g, '±'],
  [/\\le(q)?\b/g, '≤'], [/\\ge(q)?\b/g, '≥'], [/\\neq?\b/g, '≠'], [/\\approx/g, '≈'],
  [/\\pi\b/g, 'π'], [/\\theta\b/g, 'θ'], [/\\alpha\b/g, 'α'], [/\\beta\b/g, 'β'],
  [/\\infty/g, '∞'], [/\\degree|\^\\circ|\^\{\\circ\}/g, '°'],
  [/\\text\{([^{}]*)\}/g, '$1'], [/\\(left|right)/g, ''], [/\\,|\\;|\\!/g, ' '],
  [/\^2\b/g, '²'], [/\^3\b/g, '³'],
];
const untex = s => TEX.reduce((acc, [re, to]) => acc.replace(re, to), s);

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

/* only these ever become links; the rest (javascript:, data:, relative paths…) is text */
const SAFE_URL = /^(?:https?:\/\/\S+|mailto:\S+)$/i;
const DOC_INLINE = /(!?\[[^\]\n]*\]\([^)\n]*\)|\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;
const CHAT_INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

/* **bold**, *italic*, `code` — anything unmatched stays literal */
function inline(parent, text, doc) {
  const re = new RegExp((doc ? DOC_INLINE : CHAT_INLINE).source, 'g');
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const t = m[0];
    let n;
    const link = doc && t.match(/^(!?)\[([^\]\n]*)\]\(\s*([^)\n]*?)\s*\)$/);
    if (link) {
      const [, img, label, url] = link;
      if (img) { n = el('span', 'md-img'); n.textContent = `[image: ${label || url}]`; }
      else if (SAFE_URL.test(url)) {
        n = el('a', 'md-a');
        n.setAttribute('href', url);
        n.setAttribute('target', '_blank');
        n.setAttribute('rel', 'noopener noreferrer nofollow');
        n.textContent = label || url;
      } else n = document.createTextNode(label || url);
    }
    else if (t.startsWith('**')) { n = el('strong'); n.textContent = t.slice(2, -2); }
    else if (t.startsWith('~~')) { n = el('s'); n.textContent = t.slice(2, -2); }
    else if (t.startsWith('`')) { n = el('code'); n.textContent = t.slice(1, -1); }
    else { n = el('em'); n.textContent = t.slice(1, -1); }
    parent.appendChild(n);
    last = m.index + t.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const HEAD = /^\s*(#{1,4})\s+(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{2,}/;

export function render(src, opts = {}) {
  const doc = !!opts.doc;
  const frag = document.createDocumentFragment();
  const parts = String(src || '').split(/```/);

  parts.forEach((part, i) => {
    /* odd parts are inside a fence; the first line may name the language */
    if (i % 2 === 1) {
      const pre = el('pre', 'md-pre');
      const code = el('code');
      code.textContent = part.replace(/^[\w+-]*\n/, '').replace(/\n$/, '');
      pre.appendChild(code);
      frag.appendChild(pre);
      return;
    }
    const lines = (doc ? part : untex(part)).split('\n');
    let para = null, list = null, table = null, quote = null;
    const close = () => { para = null; list = null; table = null; quote = null; };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { close(); continue; }
      let m;
      if (doc && /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        close();
        frag.appendChild(el('hr', 'md-hr'));
      } else if (doc && (m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*$/))) {
        close();
        const hd = el(`h${m[1].length}`, 'md-h');
        inline(hd, m[2], true);
        frag.appendChild(hd);
      } else if (doc && (m = line.match(/^\s{0,3}>\s?(.*)$/))) {
        para = null; list = null; table = null;
        if (!quote) { quote = el('blockquote', 'md-quote'); quote.appendChild(el('p', 'md-p')); frag.appendChild(quote); }
        const qp = quote.lastChild;
        if (qp.childNodes.length) qp.appendChild(document.createTextNode(' '));
        inline(qp, m[1], true);
      } else if ((m = line.match(HEAD))) {
        close();
        const hd = el('div', 'md-h');
        inline(hd, m[2].replace(/\*\*/g, ''));
        frag.appendChild(hd);
      } else if (ROW.test(line)) {
        if (RULE.test(line) && table) continue;
        para = null; list = null;
        if (!table) { table = el('table', 'md-table'); frag.appendChild(table); }
        const tr = el('tr');
        const cells = line.trim().replace(/^\||\|$/g, '').split('|');
        const head = !table.rows.length;
        for (const c of cells) { const td = el(head ? 'th' : 'td'); inline(td, c.trim(), doc); tr.appendChild(td); }
        table.appendChild(tr);
      } else if ((m = line.match(BULLET)) || (m = line.match(NUMBER))) {
        const ordered = NUMBER.test(line);
        const body = ordered ? line.match(NUMBER)[2] : m[1];
        para = null; table = null;
        if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) {
          list = el(ordered ? 'ol' : 'ul', 'md-list');
          if (ordered) list.start = Number(line.match(NUMBER)[1]) || 1;
          frag.appendChild(list);
        }
        const li = el('li');
        inline(li, body, doc);
        list.appendChild(li);
      } else {
        list = null; table = null; quote = null;
        if (!para) { para = el('p', 'md-p'); frag.appendChild(para); }
        else if (doc) para.appendChild(document.createTextNode(' '));
        else para.appendChild(el('br'));
        inline(para, line.trim(), doc);
      }
    }
  });
  return frag;
}

export default { render };
