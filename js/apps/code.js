/* ============================================================
   Code — a small editor over the vfs.
   File tree of ~/Projects, a tab strip of open files, and a
   transparent textarea layered over a highlighted <pre> that a
   tiny regex tokeniser paints. ⌘S writes back through vfs.

   Live preview (Run, or the Preview button): the HTML page of the
   open file — the .html itself, or the page in its folder that
   uses it (else index.html) — runs beside the editor and reloads
   as you type (the open tabs' unsaved text, not just what is
   saved). Local <link rel="stylesheet" href> and <script src> are
   read from the vfs and written into the page, because the page
   has nowhere to fetch them from. A .js file with no page runs in
   an empty one, so its console output still shows.

   The page runs in core/sandbox.js: <iframe srcdoc> with
   sandbox="allow-scripts allow-pointer-lock" — an opaque origin,
   so no access to StaticOS's storage, cookies, DOM or windows, no
   popups, no forms, no top navigation, and no network access
   beyond what any sandboxed frame has. Its console.log / info /
   warn / error, uncaught errors and unhandled rejections come
   back over postMessage into the Console panel under it. Error
   line numbers are mapped back to the file and line you wrote
   (“script.js:4”), and a click goes there.

   The pane beside the editor follows the open file:
     · HTML, CSS, JavaScript — the live page and its console (above)
     · Markdown (.md) — the document, drawn as you type; raw HTML in it
       is shown as text and only http, https and mailto links are live
       (portal/mdlite.js builds DOM nodes, never innerHTML)
     · Python (.py) — Run starts real Python (Pyodide) in a sealed Web
       Worker (core/pyrun.js, core/codeview.js); output streams in,
       input() works, Stop ends even an endless loop
   Templates (website, canvas game, quiz page, Python program) start a
   real project in ~/Projects in one click (core/codetemplates.js).
   Share sends a web project as a link (core/codeshare.js); opening
   such a link here shows a read-only review — who it claims to be
   from, every file's code — and runs nothing until Run is pressed,
   then only in the sealed preview, never with access to StaticOS.

   A public GitHub Gist opens the same way (core/gist.js): paste its link
   or id into "Open a gist", it is fetched straight from api.github.com
   with nothing of yours sent, and shows up in that read-only review —
   the owner's login as a claim, the file list, the code. Run and Save a
   copy are the only ways it goes further.

   Editing: Find and Replace (one match or all), Search across the
   project's files (the sidebar's Search), go to a line, comment and
   uncomment, duplicate a line, indent and outdent, brackets and quotes
   that close themselves (and HTML tags), Python's indent after ":",
   suggestions as you type for HTML, CSS, JavaScript and Python
   (core/codecomplete.js), Format for HTML, CSS, JavaScript and JSON
   (core/codefmt.js, js-beautify loaded on demand), "Fix tabs and
   trailing spaces", JSON laid out on save, and a snippet library
   (core/codesnips.js). Each of these is one edit, so Undo takes it
   back. The status bar sets the file's indent (2, 4 or 8 spaces, or
   tabs) and word wrap; its text-size menu sets the editor's font size,
   its light or dark colours, and turns the helpers on and off.
   The file tree makes, renames and deletes (to the Trash) files and
   folders. A project downloads as a .zip, and a .zip opens as a new
   project. Version history keeps earlier versions of each project in
   this person's own IndexedDB (core/codehist.js, core/codehistui.js).
   The preview's console has an input line: what you type there runs
   inside the sealed preview frame (core/sandbox.js), never here.
   Two more panes: SQL (.sql — SQLite in a worker with sample
   databases, core/codesql.js) and shaders (.frag, .glsl — WebGL in its
   own canvas, core/codeshader.js). Python's `draw` module draws beside
   its output (core/pydraw.js). "Try web APIs" (core/codeapi.js) sends
   a request straight from the browser to a site that allows it (CORS)
   and shows the answer; it is not a proxy.

   Store: portal.code = { preview, live, prevW, size, theme, wrap, pairs, suggest, tidyJson, indent } (prefs only);
   your snippets in portal.code.snippets (core/codesnips.js).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as SB from '../core/sandbox.js';
import { render as renderMd } from '../portal/mdlite.js';
import { TEMPLATES } from '../core/codetemplates.js';
import { pyPane } from '../core/codeview.js';
import * as Share from '../core/codeshare.js';
import * as Gist from '../core/gist.js';
import { externalHosts } from '../core/sharelink.js';
import * as E from '../core/codeedit.js';
import { suggest } from '../core/codecomplete.js';
import * as Snips from '../core/codesnips.js';
import * as Hist from '../core/codehist.js';
import { historyPanel } from '../core/codehistui.js';
import { sqlPane } from '../core/codesql.js';
import { shaderPane } from '../core/codeshader.js';
import * as Z from '../core/zip.js';
import media from '../core/media.js';
import * as fsops from '../core/fsops.js';
import * as fileimport from '../core/fileimport.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-code-css')) {
  const l = document.createElement('link');
  l.id = 'feat-code-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-code.css';
  document.head.appendChild(l);
}

/* Each alternative in these patterns is exactly one capture group and
   spans the whole match, so group index → token class. */
const SPECS = {
  js: {
    re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|delete|void|yield|static|this|null|undefined|true|false|in|of|pub|fn|mut|struct|impl|use|def|self|lambda|None|True|False)\b)|(\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*(?=\s*\())|(=>|\.{3}|[-+*/%<>=!&|^~?]+|[{}()[\];,.:])/g,
    cls: ['tok-com', 'tok-str', 'tok-kw', 'tok-num', 'tok-fn', 'tok-op'],
  },
  css: {
    re: /(\/\*[\s\S]*?\*\/)|("[^"\n]*"|'[^'\n]*')|(@[\w-]+)|(--[\w-]+|\b[a-z-]+(?=\s*:))|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|s|ms|vh|vw|fr|deg|ch)?\b)|([A-Za-z_$][\w$-]*(?=\())|([{}();,>+~*:])/g,
    cls: ['tok-com', 'tok-str', 'tok-kw', 'tok-attr', 'tok-num', 'tok-fn', 'tok-op'],
  },
  html: {
    re: /(<!--[\s\S]*?-->)|(<\/?[\w:-]+|\/?>)|([\w:-]+(?==))|("[^"\n]*"|'[^'\n]*')|(&[a-z]+;)/g,
    cls: ['tok-com', 'tok-tag', 'tok-attr', 'tok-str', 'tok-op'],
  },
  json: {
    re: /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(\b(?:true|false|null)\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([{}[\],:])/g,
    cls: ['tok-attr', 'tok-str', 'tok-kw', 'tok-num', 'tok-op'],
  },
  md: {
    re: /(^#{1,6}[^\n]*)|(```[\s\S]*?```|`[^`\n]*`)|(^[ \t]*>[^\n]*)|(^[ \t]*(?:[-*+]|\d+\.)[ \t])|(\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)|(^[ \t]*(?:-{3,}|={3,})[ \t]*$)/gm,
    cls: ['tok-kw', 'tok-str', 'tok-com', 'tok-op', 'tok-attr', 'tok-fn', 'tok-op'],
  },
  py: {
    re: /(#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?"""|\b[fFrRbBuU]{0,2}(?:'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"))|(\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|self|None|True|False)\b)|(\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*(?=\s*\())|([-+*/%<>=!&|^~@]+|[{}()[\];,.:])/g,
    cls: ['tok-com', 'tok-str', 'tok-kw', 'tok-num', 'tok-fn', 'tok-op'],
  },
  conf: {
    re: /(#[^\n]*|\/\/[^\n]*)|("[^"\n]*"|'[^'\n]*')|(^[ \t]*\[[^\]\n]+\])|(^[ \t]*[\w.-]+(?=[ \t]*[=:]))|(\b(?:true|false|on|off|yes|no|none)\b)|(\b\d+(?:\.\d+)?\b)|([=:,])/gm,
    cls: ['tok-com', 'tok-str', 'tok-kw', 'tok-attr', 'tok-kw', 'tok-num', 'tok-op'],
  },
  sql: {
    re: /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*'|"(?:""|[^"\n])*")|(\b(?:select|from|where|and|or|not|insert|into|values|update|set|delete|create|table|view|index|drop|alter|add|column|primary|key|foreign|references|unique|default|null|is|in|like|between|as|on|join|left|right|inner|outer|cross|group|by|order|asc|desc|limit|offset|having|distinct|union|all|case|when|then|else|end|exists|with|recursive|integer|text|real|blob|numeric|if|begin|commit|rollback|transaction|trigger|autoincrement|check|constraint|glob|replace|pragma|true|false)\b)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*(?=\s*\())|([-+*\/%<>=!|,;.()]+)/gi,
    cls: ['tok-com', 'tok-str', 'tok-kw', 'tok-num', 'tok-fn', 'tok-op'],
  },
  glsl: {
    re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(^[ \t]*#[^\n]*)|(\b(?:void|float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234]|sampler2D|uniform|attribute|varying|in|out|inout|const|precision|highp|mediump|lowp|if|else|for|while|do|return|break|continue|discard|struct|true|false)\b)|(\b\d+\.?\d*(?:e[+-]?\d+)?\b|\.\d+\b)|([A-Za-z_]\w*(?=\s*\())|([-+*\/%<>=!&|^~?:]+|[{}()[\];,.])/gm,
    cls: ['tok-com', 'tok-attr', 'tok-kw', 'tok-num', 'tok-fn', 'tok-op'],
  },
};

const LANGS = {
  js: ['JavaScript', 'js'], mjs: ['JavaScript', 'js'], ts: ['TypeScript', 'js'],
  rs: ['Rust', 'js'], py: ['Python', 'py'], c: ['C', 'js'], h: ['C Header', 'js'],
  css: ['CSS', 'css'], html: ['HTML', 'html'], htm: ['HTML', 'html'], svg: ['SVG', 'html'],
  json: ['JSON', 'json'], md: ['Markdown', 'md'],
  toml: ['TOML', 'conf'], conf: ['Config', 'conf'], ini: ['INI', 'conf'],
  yml: ['YAML', 'conf'], yaml: ['YAML', 'conf'], sh: ['Shell', 'conf'],
  txt: ['Plain Text', null], log: ['Log', null], csv: ['CSV', null],
  sql: ['SQL', 'sql'], frag: ['GLSL', 'glsl'], glsl: ['GLSL', 'glsl'], vert: ['GLSL', 'glsl'],
};

const MAX_HL = 80000;   /* above this, skip highlighting and stay responsive */
const MAX_LOG = 300;
const PREF = 'portal.code';
const WEB = /\.(html?|css|m?js)$/i;
const MD = /\.(md|markdown)$/i;
const PY = /\.py$/i;
const SQLF = /\.sql$/i;
const GLSL = /\.(frag|glsl)$/i;
/* panes that open by themselves beside their file, and close again after */
const AUTO_PANE = new Set(['md', 'sql', 'glsl']);
/* what can be read as text from a .zip */
const TEXTISH = /\.(html?|css|m?js|ts|json|md|markdown|txt|py|sql|frag|glsl|vert|svg|xml|csv|tsv|ya?ml|toml|ini|conf|cfg|sh|c|h|rs|log|gitignore)$/i;
/* where a shared project's files live while it is only being read: not a place in the vfs */
const SH_ROOT = '/__shared__/';
/* what the preview pane shows for a file */
const modeOf = f => (!f ? null : MD.test(f.name) ? 'md' : PY.test(f.name) ? 'py' : SQLF.test(f.name) ? 'sql' : GLSL.test(f.name) ? 'glsl' : 'web');
/* a URL the page would have to fetch: those stay as they are */
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/* a new web project: three small files that show the preview, the console
   and a click handler working together */
const STARTER = name => ({
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello from StaticOS</h1>
  <p>Edit index.html, style.css or script.js: the preview updates as you type.</p>
  <button id="count" type="button">Clicked 0 times</button>
  <script src="script.js"></script>
</body>
</html>
`,
  'style.css': `body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
  background: #fdf6f8;
  color: #2a1a22;
}

h1 {
  color: #d6336c;
}

button {
  font: inherit;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid #d6336c;
  background: #fff;
  cursor: pointer;
}
`,
  'script.js': `const button = document.getElementById('count');
let clicks = 0;

button.addEventListener('click', () => {
  clicks++;
  button.textContent = \`Clicked \${clicks} time\${clicks === 1 ? '' : 's'}\`;
  console.log('clicked', clicks);
});

console.log('script.js loaded');
`,
});

defineApp({
  id: 'code',
  name: 'Static Code',
  icon: 'code',
  g1: '#a5b8ff', g2: '#3730c4',
  category: 'Productivity',
  keywords: ['code', 'editor', 'ide', 'source', 'text', 'write', 'html', 'css', 'javascript', 'web', 'preview', 'live preview', 'console', 'python', 'py', 'markdown', 'md', 'template', 'starter', 'share project', 'sql', 'sqlite', 'database', 'shader', 'glsl', 'webgl', 'api', 'fetch', 'zip', 'format', 'autocomplete', 'snippets', 'version history'],
  desc: 'Edit files with a live preview for HTML, CSS, JavaScript and Markdown, run Python and SQL, play with shaders, start from a template, or share a web project as a link',
  pinned: true, dock: true,
  /* 'text' is Notes' kind (notes.js declares it and edits vfs text files
     read-through). Claiming it here made which app opened a .md depend on
     which module's dynamic import resolved first. */
  handles: ['code', 'config'],
  win: { w: 980, h: 600, minW: 520, minH: 340 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Mod+S', 'Save'],
    ['Mod+F', 'Find'],
    ['Mod+Alt+F', 'Find and replace'],
    ['Mod+Shift+F', 'Search every file in the project'],
    ['Ctrl+G', 'Go to a line'],
    ['Mod+/', 'Comment or uncomment the lines'],
    ['Shift+Alt+↓ / ↑', 'Duplicate the line below / above'],
    ['Shift+Alt+F', 'Format the file'],
    ['Ctrl+Space', 'Show suggestions'],
    ['Mod+Shift+P', 'Run: preview HTML, CSS or JavaScript, run Python or SQL'],
    ['Mod+Enter', 'Run (in a .sql file: the selected lines, or all)'],
    ['Tab / Shift+Tab', 'Indent / outdent'],
    ['Esc', 'Close Find or the suggestions'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, fmt, render, clear, store } = api;

    const PROJ = `${vfs.HOME}/Projects`;
    const prefs = () => { const v = store.get(PREF, null); return v && typeof v === 'object' ? v : {}; };
    const setPref = patch => store.set(PREF, { ...prefs(), ...patch });
    /* the editor's own settings: the status bar and its text-size menu */
    const edPrefs = () => {
      const p = prefs();
      return {
        size: Number.isFinite(p.size) && p.size >= 9 && p.size <= 28 ? p.size : null,
        theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'auto',
        wrap: p.wrap === true, pairs: p.pairs !== false, suggest: p.suggest !== false, tidyJson: p.tidyJson !== false,
        indent: p.indent && typeof p.indent === 'object' ? p.indent : {},
      };
    };
    const isMacKeys = fmt.modLabel === '⌘';
    const ALT = isMacKeys ? '⌥' : 'Alt+';
    const SHIFT = isMacKeys ? '⇧' : 'Shift+';

    /* ---------------- state ---------------- */
    const S = {
      open: [],                 /* [{path,name,text,dirty,lang,label}] */
      cur: -1,
      back: [], fwd: [],
      folds: new Set([PROJ]),
      hits: [], hitI: 0,
      lines: -1, gut: [],
      dead: false,
      /* preview: sb = the running sandbox, page = path of the page shown,
         html = what it was given, map = its line → file:line table */
      pv: { on: prefs().preview === true, live: prefs().live !== false, sb: null, page: null, html: null, map: null, t: 0, logs: [], logOpen: true, why: '', auto: false },
      mode: null,               /* what the pane shows now: 'web' | 'md' | 'py' */
      fileMode: null,           /* what kind the open file is (for opening Markdown beside it) */
      shSeq: 0,
      sh: null,                 /* a shared project under review: { project, files: Map, cur, page, ... } */
      ed: edPrefs(),            /* size, theme, wrap, pairs, suggest, tidyJson, indent */
      repl: false,              /* the Replace field is showing */
      side: 'files',            /* the sidebar shows 'files', 'search' or 'snips' */
      cm: null,                 /* the open suggestion list: { items, i, from, to } */
      applying: false,          /* an edit of ours is going in (not typing) */
      panel: null,              /* an overlay over the editor: history or web APIs */
      search: { q: '', scope: 'project', cased: false, t: 0 },
      hist: [],                 /* console input lines, for ↑ and ↓ */
      histAt: 0,
    };
    const current = () => (S.cur >= 0 ? S.open[S.cur] : null);

    /* ---------------- chrome --------------- */
    const btnBack = h('button.ibtn.tip', { 'data-tip': 'Back', 'aria-label': 'Back', onclick: () => hop(S.back, S.fwd) }, icon('chevron-left'));
    const btnFwd = h('button.ibtn.tip', { 'data-tip': 'Forward', 'aria-label': 'Forward', onclick: () => hop(S.fwd, S.back) }, icon('chevron-right'));
    win.setLead(btnBack, btnFwd);

    const findInput = h('input', {
      type: 'search', placeholder: 'Find in file…', spellcheck: 'false',
      oninput: () => runFind(0),
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? -1 : 1, true); }
        if (e.key === 'Escape') { e.preventDefault(); showFind(false); }
      },
    });
    const findCount = h('small.dim', { style: { flex: '0 0 auto' } });
    const replToggle = h('button.cfx__tog', { type: 'button', 'aria-label': 'Show Replace', title: `Replace (${fmt.modLabel}${ALT}F)`, 'aria-expanded': 'false', onclick: () => showFind(true, !S.repl) }, icon('chevron-down', { size: 11 }));
    const findBox = h('div.field.hidden', { style: { width: '216px', height: '24px' } },
      icon('search'), findInput, findCount, replToggle);
    const replInput = h('input', {
      type: 'text', placeholder: 'Replace with…', spellcheck: 'false', 'aria-label': 'Replace with',
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) replaceAll(); else replaceOne(); }
        if (e.key === 'Escape') { e.preventDefault(); showFind(false); }
      },
    });
    const replBox = h('div.field.hidden.cfx__repl', { style: { width: '230px', height: '24px' } },
      icon('edit-3'), replInput,
      h('button.cfx__rb', { type: 'button', 'data-act': 'replace-one', title: 'Replace this match and go to the next (Enter)', onclick: () => replaceOne(), text: 'Replace' }),
      h('button.cfx__rb', { type: 'button', 'data-act': 'replace-all', title: `Replace every match (${fmt.modLabel}Enter)`, onclick: () => replaceAll(), text: 'All' }));

    const btnSave = h('button.ibtn.tip', { 'data-tip': `Save (${fmt.modLabel}S)`, 'aria-label': 'Save', onclick: () => save() }, icon('save'));
    const btnFind = h('button.ibtn.tip', {
      'data-tip': `Find (${fmt.modLabel}F)`, 'aria-label': 'Find in file',
      onclick: () => showFind(findBox.classList.contains('hidden')),
    }, icon('search'));
    const btnRun = h('button.ibtn.tip', { 'data-tip': `Run in the preview (${fmt.modLabel}⇧P)`, 'aria-label': 'Run in the preview', onclick: () => run() }, icon('play'));
    const btnPrev = h('button.ibtn.tip', { 'data-tip': 'Show or hide the live preview', 'aria-label': 'Live preview', 'aria-pressed': 'false', onclick: () => setPreview(!S.pv.on) }, icon('sidebar'));
    const webLink = h('a.ibtn.tip', {
      'data-tip': 'Open vscode.dev',
      'aria-label': 'Open vscode.dev',
      href: 'https://vscode.dev/',
      target: '_blank',
      rel: 'noopener noreferrer',
    }, icon('external-link'));
    const btnShare = h('button.ibtn.tip', { 'data-tip': 'Share this web project as a link', 'aria-label': 'Share this project', onclick: () => shareProject() }, icon('share'));
    const btnGist = h('button.ibtn.tip', { 'data-tip': 'Open a public GitHub Gist from its link', 'aria-label': 'Open a gist', 'data-act': 'open-gist', onclick: () => openGist() }, icon('link'));
    const btnMore = h('button.ibtn.tip', { 'data-tip': 'More: replace, format, history, zip, web APIs…', 'aria-label': 'More actions', 'aria-haspopup': 'menu', onclick: e => moreMenu(e.currentTarget) }, icon('more-horizontal'));
    win.setTools(btnSave, btnFind, findBox, replBox, btnRun, btnPrev, btnShare, btnGist, btnMore, webLink);

    /* ---------------- layout --------------- */
    const sideBody = h('div.cfx__sidebody');
    const sideTab = (id, ic, label) => h('button.cfx__stab', { type: 'button', role: 'tab', 'data-side': id, 'aria-selected': String(id === 'files'), 'aria-label': label, title: label, onclick: () => setSide(id) }, icon(ic, { size: 12 }), h('span.cfx__stabl', { text: label }));
    const sideTabs = h('div.cfx__stabs', { role: 'tablist', 'aria-label': 'Sidebar' }, sideTab('files', 'folder', 'Files'), sideTab('search', 'search', 'Search'), sideTab('snips', 'list-plus', 'Snippets'));
    const side = h('aside.app__side.cfx__side', sideTabs, sideBody);
    /* .brw__tab min-width means >4 tabs overflow a default window, and
       .win__body clips — so let the strip scroll instead of hiding them. */
    const tabsEl = h('div.brw__tabs.scroll-none', {
      style: { overflowX: 'auto', overflowY: 'hidden' },
    });
    const gutter = h('div.code__gutter', { style: { overflow: 'hidden' } });
    /* the UA sheet's pre{font-family:monospace} beats inheritance, so the
       highlight layer must restate --mono or it drifts out of step with
       the textarea one glyph at a time. */
    const layer = h('pre.code__body', {
      'aria-hidden': 'true',
      style: { position: 'absolute', inset: '0', margin: '0', overflow: 'hidden',
               pointerEvents: 'none', fontFamily: 'var(--mono)', fontSize: 'inherit',
               lineHeight: 'inherit' },
    });
    const ta = h('textarea.code__body', {
      spellcheck: 'false', wrap: 'off', autocapitalize: 'off', autocorrect: 'off',
      'aria-label': 'Source editor', 'aria-autocomplete': 'list', 'aria-controls': `${win.id}-cm`,
      style: {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        resize: 'none', border: '0', background: 'transparent',
        color: 'transparent', WebkitTextFillColor: 'transparent',
        caretColor: 'var(--accent-soft)',
      },
    });
    /* suggestions as you type, and the Go to line box, float over the text */
    const cmList = h('div.ccm', { id: `${win.id}-cm`, role: 'listbox', 'aria-label': 'Suggestions', hidden: true });
    const gotoIn = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Line number to go to', placeholder: 'Line or line:column', spellcheck: 'false', autocomplete: 'off' });
    const gotoOf = h('small.dim');
    const gotoBox = h('form.cgo', { hidden: true, onsubmit: e => { e.preventDefault(); goFromBox(); } }, h('span', { text: 'Go to line' }), gotoIn, gotoOf);
    const edWrap = h('div.grow', { style: { position: 'relative' } }, layer, ta, cmList, gotoBox);
    const editor = h('div.code', gutter, edWrap);
    const newProjBtn = () => h('button.btn.btn--sm', { type: 'button', onclick: () => newWebProject() }, icon('plus'), h('span', { text: 'New web project' }));
    const gistBtn = () => h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'open-gist-blank', onclick: () => openGist() }, icon('link'), h('span', { text: 'Open a gist' }));
    const tplBtn = () => h('button.btn.btn--sm.btn--ghost.cpv__tpl', { type: 'button', 'aria-haspopup': 'menu', onclick: e => templateMenu(e.currentTarget) }, icon('layers'), h('span', { text: 'Templates' }));
    const blank = h('div.empty.grow.hidden', icon('file-code'),
      h('b', { text: 'No file open' }),
      h('small', { text: 'Pick something from the project tree, open a file from Files, or start a web project with a live preview.' }),
      h('div.cpv__starts', newProjBtn(), tplBtn(), gistBtn()));
    const foot = h('div.app__bar.app__bar--foot');

    /* ---------------- preview pane ---------- */
    const pvPage = h('span.cpv__page');
    const liveSw = h('button.switch', { type: 'button', role: 'switch', 'aria-label': 'Live: reload as you type', onclick: () => setLive(!S.pv.live) });
    const pvReload = h('button.ibtn.tip', { 'data-tip': 'Reload the preview', 'aria-label': 'Reload the preview', onclick: () => refresh(true) }, icon('refresh'));
    const pvClose = h('button.ibtn.tip', { 'data-tip': 'Close the preview', 'aria-label': 'Close the preview', onclick: () => setPreview(false) }, icon('x'));
    const pvHost = h('div.cpv__host');
    const pvEmpty = h('div.cpv__empty', { hidden: true });
    const logList = h('div.cpv__list', { role: 'log', 'aria-label': 'Preview console' });
    const logCounts = h('span.cpv__counts');
    const logFold = h('button.ibtn.tip', { 'data-tip': 'Hide the console', 'aria-label': 'Hide the console', onclick: () => { S.pv.logOpen = !S.pv.logOpen; paintLog(); } }, icon('chevron-down'));
    const evalIn = h('input.cpv__evalin', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Run JavaScript in the preview page', placeholder: 'Run JavaScript in the page…', onkeydown: e => evalKey(e) });
    const evalRow = h('form.cpv__eval', { title: 'Runs inside the preview’s sealed page, like its own scripts: it can’t reach StaticOS', onsubmit: e => { e.preventDefault(); runEval(); } }, icon('chevron-right'), evalIn);
    const logEl = h('section.cpv__log', { 'aria-label': 'Console' },
      h('div.cpv__loghead', icon('terminal'), h('b', { text: 'Console' }), logCounts, h('div.grow'),
        h('button.btn.btn--sm.btn--ghost.cpv__clear', { type: 'button', onclick: () => { S.pv.logs = []; paintLog(); } }, icon('trash'), h('span', { text: 'Clear' })),
        logFold),
      logList, evalRow);
    const mdView = h('div.cpv__md', { hidden: true, role: 'document', tabindex: '0', 'aria-label': 'Markdown preview' });
    const py = pyPane({ h, icon, clear });
    py.el.hidden = true;
    const sqlP = sqlPane({ h, icon, clear });
    sqlP.el.hidden = true;
    const shader = shaderPane({ h, icon, clear });
    shader.el.hidden = true;
    const pvSplit = h('div.cpv__split', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the preview', tabindex: '0' });
    const preview = h('aside.cpv', { 'aria-label': 'Live preview', hidden: true },
      h('div.cpv__bar', icon('globe'), h('b', { text: 'Preview' }), pvPage, h('div.grow'),
        h('label.cpv__live', { title: 'Reload the preview as you type' }, liveSw, h('span', { text: 'Live' })),
        pvReload, pvClose),
      h('div.cpv__stage', pvHost, pvEmpty, mdView, py.el, sqlP.el, shader.el),
      logEl);
    const work = h('div.cpv__work', editor, blank, pvSplit, preview);
    const appEl = h('div.app.cpv-app', side, h('div.app__main', tabsEl, work, foot));
    root.appendChild(appEl);
    /* Open a .zip as a project: a file from the computer */
    const zipIn = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'aria-hidden': 'true', tabindex: '-1', 'data-act': 'zip-input', onchange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) openZip(file); } });
    appEl.appendChild(zipIn);

    /* ---------------- tree ----------------- */
    function paintTree() {
      if (S.side !== 'files') return;
      clear(sideBody);
      const group = h('div.side__group',
        h('div.side__label.cpv__sidehead', h('span', { text: 'Projects' }),
          h('span.cpv__sidebtns',
            h('button.ibtn.tip', { 'data-tip': 'New file', 'aria-label': 'New file', onclick: () => newFile(targetDir()) }, icon('file')),
            h('button.ibtn.tip', { 'data-tip': 'New folder', 'aria-label': 'New folder', onclick: () => newFolder(targetDir()) }, icon('folder')),
            h('button.ibtn.tip', { 'data-tip': 'Start from a template', 'aria-label': 'Templates', 'aria-haspopup': 'menu', onclick: e => templateMenu(e.currentTarget) }, icon('layers')),
            h('button.ibtn.tip', { 'data-tip': 'New web project', 'aria-label': 'New web project', onclick: () => newWebProject() }, icon('plus')))));
      group.appendChild(rowFor({ name: '~/Projects', type: 'dir' }, PROJ, 0, 'folder-git'));
      if (S.folds.has(PROJ)) branch(group, PROJ, 1);
      const openG = h('div.side__group', h('div.side__label', { text: `Open · ${S.open.length}` }),
        ...(S.open.length ? S.open.map((f, i) => {
          const b = h('button.side__item', { onclick: () => go(i) },
            icon(f.dirty ? 'edit-3' : 'file-code'), h('span', { text: f.name }));
          if (i === S.cur) b.classList.add('is-on');
          if (f.dirty) b.appendChild(h('small', { text: '●' }));
          return b;
        }) : [h('small.dim', { text: 'Nothing open', style: { padding: '0 var(--sp-3)' } })]));
      sideBody.append(group, openG, h('small.dim.cfx__hint', { text: 'Right-click a file or folder to rename or delete it.' }));
    }

    function branch(parent, dir, depth) {
      for (const n of vfs.ls(dir)) {
        const p = `${dir}/${n.name}`;
        parent.appendChild(rowFor(n, p, depth));
        if (n.type === 'dir' && S.folds.has(p)) branch(parent, p, depth + 1);
      }
    }

    function rowFor(n, p, depth, forceIcon) {
      const isDir = n.type === 'dir';
      const open = S.folds.has(p);
      const row = h('button.side__item', {
        style: { paddingLeft: `${6 + depth * 10}px` },
        'data-path': p,
        onclick: () => {
          if (isDir) { open ? S.folds.delete(p) : S.folds.add(p); paintTree(); }
          else openPath(p);
        },
        oncontextmenu: e => { e.preventDefault(); treeMenu(n, p, e.clientX, e.clientY); },
      },
        isDir ? icon(open ? 'chevron-down' : 'chevron-right', { size: 11 }) : h('span', { style: { width: '11px', flex: '0 0 auto' } }),
        icon(forceIcon || (isDir ? (open ? 'folder-open' : 'folder') : vfs.iconFor(n))),
        h('span', { text: n.name }));
      const cur = current();
      if (!isDir && cur && cur.path === p) row.classList.add('is-on');
      return row;
    }

    /* ---------------- tabs ----------------- */
    /* .brw__tab span{flex:1} would stretch the glyph, so pin it. */
    const noGrow = el => { el.style.flex = '0 0 auto'; return el; };

    function paintTabs() {
      clear(tabsEl);
      S.open.forEach((f, i) => {
        const tab = h('div.brw__tab', { class: i === S.cur ? 'is-on' : null, style: { minWidth: '152px' } },
          h('button', {
            style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flex: '1', minWidth: '0' },
            onclick: () => go(i),
          }, noGrow(icon(vfs.iconFor({ type: 'file', kind: vfs.kindOf(f.name) }), { size: 12 })),
            h('span.trunc', { text: f.name })),
          f.dirty ? h('i.tip', {
            'data-tip': 'Unsaved changes',
            style: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', flex: '0 0 auto' },
          }) : null,
          h('button.ibtn.tip', {
            'data-tip': 'Close', 'aria-label': `Close ${f.name}`,
            style: { height: '18px', minWidth: '18px', padding: '0' },
            onclick: e => { e.stopPropagation(); closeTab(i); },
          }, icon('x', { size: 11 })));
        tabsEl.appendChild(tab);
      });
      if (!S.open.length) tabsEl.appendChild(h('small.dim', { text: 'No open files', style: { padding: '0 var(--sp-3) var(--sp-3)' } }));
    }

    /* ---------------- open / close ---------- */
    function openPath(path, record = true) {
      const p = vfs.norm(path);
      const n = vfs.node(p);
      if (!n || n.type !== 'file') return;
      const cur = current();
      if (record && cur && cur.path !== p) { S.back.push(cur.path); S.fwd.length = 0; }
      const at = S.open.findIndex(f => f.path === p);
      if (at >= 0) { S.cur = at; }
      else {
        const ext = vfs.extOf(n.name);
        const [label, lang] = LANGS[ext] || ['Plain Text', null];
        const text = vfs.read(p) || '';
        S.open.push({ path: p, name: n.name, text, dirty: false, lang, label, ...indentFor(text, lang) });
        S.cur = S.open.length - 1;
      }
      swap();
    }

    function go(i) {
      if (i === S.cur || !S.open[i]) return;
      const cur = current();
      if (cur) { S.back.push(cur.path); S.fwd.length = 0; }
      S.cur = i;
      swap();
    }

    function hop(from, to) {
      const p = from.pop();
      if (!p) return;
      const cur = current();
      if (cur) to.push(cur.path);
      const at = S.open.findIndex(f => f.path === p);
      if (at >= 0) S.cur = at; else { openPath(p, false); return; }
      swap();
    }

    function closeTab(i) {
      const f = S.open[i];
      if (!f) return;
      S.open.splice(i, 1);
      S.cur = S.open.length ? Math.max(0, Math.min(i, S.open.length - 1)) : -1;
      S.back = S.back.filter(p => p !== f.path);
      S.fwd = S.fwd.filter(p => p !== f.path);
      swap();
    }

    /* ---------------- editor --------------- */
    function swap() {
      const f = current();
      editor.classList.toggle('hidden', !f);
      blank.classList.toggle('hidden', !!f);
      closeSuggest();
      if (f) {
        ta.value = f.text;
        ta.scrollTop = 0; ta.scrollLeft = 0;
        ta.style.tabSize = layer.style.tabSize = String(f.indent || 4);
        S.lines = -1;
        win.setTitle(f.name);
        win.setSubtitle(vfs.parentPath(f.path).replace(vfs.HOME, '~'));
        highlight();
      } else {
        /* nothing open: drop the closed file's text so a later reopen (and
           the caret/line readouts) never see the previous buffer */
        ta.value = '';
        S.lines = -1;
        clear(layer);
        win.setTitle('Code');
        win.setSubtitle('');
      }
      S.hits = []; findCount.textContent = '';
      btnBack.disabled = !S.back.length;
      btnFwd.disabled = !S.fwd.length;
      paintTabs(); paintTree(); paintGutter(); paintFoot();
      /* a Markdown file opens with its preview beside it, and the pane goes
         back to how it was when you move on to something else */
      const was = S.fileMode;
      S.fileMode = modeOf(f);
      if (AUTO_PANE.has(S.fileMode) && was !== S.fileMode && !S.pv.on) setPreview(true, true);
      else if (!AUTO_PANE.has(S.fileMode) && S.pv.auto && S.pv.on) setPreview(false, true);
      if (S.side !== 'files') paintSide();
      /* the page being previewed may be a different one now */
      if (S.pv.on) refresh(false);
    }

    function highlight() {
      const f = current();
      if (!f) return;
      const text = ta.value;
      const spec = text.length > MAX_HL ? null : SPECS[f.lang];
      /* the trailing '\n' matches the blank last line a textarea always
         keeps: without it the layer is a line shorter than the textarea
         and slips out of register at the bottom of a long file. */
      if (S.ed.wrap) render(layer, ...byLines(tokens(text, spec)));
      else render(layer, ...tokens(text, spec), '\n');
      layer.scrollTop = ta.scrollTop;
      layer.scrollLeft = ta.scrollLeft;
    }

    /* word wrap: one block per line, so a wrapped line's height can be read for its number */
    function byLines(toks) {
      const lines = [];
      let cur = [];
      const push = () => { lines.push(h('div.code__ln', ...(cur.length ? cur : ['\u200b']))); cur = []; };
      for (const t of toks) {
        const str = typeof t === 'string' ? t : t.textContent;
        if (!str.includes('\n')) { cur.push(t); continue; }
        str.split('\n').forEach((part, i) => {
          if (i) push();
          if (part) cur.push(typeof t === 'string' ? part : h(`span.${t.className}`, { text: part }));
        });
      }
      push();
      return lines;
    }

    function tokens(text, spec) {
      if (!spec) return [text];
      const out = [];
      let last = 0, m;
      spec.re.lastIndex = 0;
      while ((m = spec.re.exec(text))) {
        if (m[0] === '') { spec.re.lastIndex++; continue; }
        if (m.index > last) out.push(text.slice(last, m.index));
        let cls = null;
        for (let g = 1; g < m.length; g++) if (m[g] !== undefined) { cls = spec.cls[g - 1]; break; }
        out.push(cls ? h(`span.${cls}`, { text: m[0] }) : m[0]);
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }

    function paintGutter() {
      const n = current() ? ta.value.split('\n').length : 0;
      if (n !== S.lines) {
        S.lines = n;
        clear(gutter);
        S.gut = [];
        for (let i = 1; i <= n; i++) {
          const d = h('div', { text: String(i) });
          S.gut.push(d);
          gutter.appendChild(d);
        }
      }
      if (S.ed.wrap) {
        /* each number as tall as its line is wrapped */
        const rows = layer.children;
        const hs = S.gut.map((d, i) => (rows[i] ? rows[i].offsetHeight : 0));
        S.gut.forEach((d, i) => { d.style.height = hs[i] ? `${hs[i]}px` : ''; });
      } else if (S.gut.length && S.gut[0].style.height) S.gut.forEach(d => { d.style.height = ''; });
      const { line } = caret();
      S.gut.forEach((d, i) => { d.style.color = i + 1 === line ? 'var(--accent-soft)' : ''; });
      gutter.scrollTop = ta.scrollTop;
    }

    function caret() {
      const v = ta.value, s = ta.selectionStart || 0;
      const before = v.slice(0, s);
      return {
        line: before.split('\n').length,
        col: s - before.lastIndexOf('\n'),
        sel: (ta.selectionEnd || 0) - s,
      };
    }

    function onEdit() {
      const f = current();
      if (!f) return;
      if (f.text === ta.value) return;
      f.text = ta.value;
      if (!f.dirty) { f.dirty = true; paintTabs(); paintTree(); }
      highlight(); paintGutter(); paintFoot();
      if (S.pv.on && S.pv.live && WEB.test(f.name)) scheduleRefresh();
      else if (S.pv.on && MD.test(f.name)) scheduleRefresh(90);
      else if (S.pv.on && S.pv.live && GLSL.test(f.name)) scheduleRefresh(250);
    }

    function insert(str) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      applyEdit({ from: s, to: e, insert: str, selStart: s + str.length, selEnd: s + str.length });
    }

    /** Replace text[from..to] with insert, then select selStart..selEnd: one
        step on the textarea's own Undo stack (execCommand keeps it). */
    function applyEdit(r) {
      if (!r || !current()) return false;
      S.applying = true;
      try {
        if (document.activeElement !== ta) ta.focus({ preventScroll: true });
        if (r.from !== r.to || r.insert) {
          ta.setSelectionRange(r.from, r.to);
          let ok = false;
          try { ok = r.insert ? document.execCommand('insertText', false, r.insert) : document.execCommand('delete'); } catch (err) { ok = false; }
          /* no execCommand (or it refused): still make the change, without Undo */
          if (!ok) ta.setRangeText(r.insert, r.from, r.to, 'end');
        }
        ta.setSelectionRange(r.selStart, r.selEnd);
      } finally { S.applying = false; }
      onEdit();
      paintGutter();
      paintFoot();
      return true;
    }
    /* one indent of the open file */
    const unit = (f = current()) => (f && f.tabs ? '\t' : ' '.repeat((f && f.indent) || 2));

    /** Put the caret at the start of line n (1-based) and show it. */
    function gotoLine(n) {
      const v = ta.value;
      let pos = 0;
      for (let i = 1; i < n; i++) { const j = v.indexOf('\n', pos); if (j < 0) break; pos = j + 1; }
      const end = v.indexOf('\n', pos);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, end < 0 ? v.length : end);
      ta.scrollTop = Math.max(0, lineTop(n) - ta.clientHeight / 3);
      syncScroll();
      paintGutter();
      paintFoot();
    }

    /* ---------------- actions -------------- */
    function save() {
      const f = current();
      if (!f) return;
      if (!f.dirty) { api.notify({ app: 'Code', icon: 'check', title: 'Already saved', message: f.name, timeout: 2200 }); return; }
      let note = '';
      /* JSON is laid out again on save (numbers and strings stay as written); JSON that doesn't parse is kept as typed */
      if (f.lang === 'json' && S.ed.tidyJson && f === current() && f.text.trim()) {
        const r = E.prettyJson(f.text, unit(f));
        if (r.ok && r.text !== f.text) {
          const was = caret().line;
          applyEdit({ from: 0, to: ta.value.length, insert: r.text, selStart: 0, selEnd: 0 });
          caretTo(Math.min(was, r.text.split('\n').length));
          note = ' · laid out';
        } else if (!r.ok) note = ` · not valid JSON${r.line ? ` (line ${r.line})` : ''}, saved as typed`;
      }
      /* how the project was before this save: kept as its first version when it has none yet
         (version history is for projects in ~/Projects) */
      const dir = projectOf(f.path);
      const kept = inProjects(f.path);
      const prev = kept ? diskFiles(dir) : null;
      const before = kept ? Hist.list(dir).then(vs => (vs.length ? null : prev)).catch(() => null) : null;
      vfs.write(f.path, f.text);
      f.dirty = false;
      api.bus.emit('file:saved', { path: f.path, app: 'code' });
      api.notify({ app: 'Code', icon: 'save', title: 'File saved', message: `${f.name} · ${fmt.fmtBytes(f.text.length)}${note}` });
      paintTabs(); paintTree(); paintFoot();
      if (kept) keepVersion(dir, before, f.name);
    }

    /* Run = show this file working: web files in the live preview. Nothing
       else can run in a browser tab, and Code says so rather than pretend. */
    function run() {
      const f = current();
      if (!f) return;
      if (WEB.test(f.name) || MD.test(f.name) || GLSL.test(f.name)) { setPreview(true); refresh(true); return; }
      if (PY.test(f.name)) { runPython(f); return; }
      if (SQLF.test(f.name)) { runSql(f); return; }
      api.notify({ app: 'Code', icon: 'alert', title: 'Nothing to run', message: `Run previews HTML, CSS, JavaScript, Markdown and shaders, and runs Python and SQL. ${f.label} files cannot run in the browser.`, timeout: 3600 });
    }

    /** Every text file under dir as { path (relative), text }, with the
        editor's unsaved text. `only` limits it to names that match. */
    function collect(dir, only, maxFiles = 300, maxBytes = 5 * 1024 * 1024, read = textOf) {
      const flat = dir === PROJ || dir === vfs.HOME;       /* never sweep up every project at once */
      const out = [];
      let bytes = 0, over = false;
      const walk = (d, rel, depth) => {
        for (const n of vfs.ls(d)) {
          const p = `${d}/${n.name}`;
          if (n.type === 'dir') { if (!flat && depth < 4) walk(p, `${rel}${n.name}/`, depth + 1); continue; }
          if (only ? !only.test(n.name) : !/\.(py|txt|json|csv|tsv|md|markdown|html?|css|m?js|xml|ya?ml|toml|ini|cfg|log|svg|sql|frag|glsl|vert)$/i.test(n.name)) continue;
          if (media.isMedia(n)) continue;
          const text = read(p) ?? '';
          if (out.length >= maxFiles || bytes + text.length > maxBytes) { over = true; continue; }
          bytes += text.length;
          out.push({ path: `${rel}${n.name}`, text });
        }
      };
      walk(dir, '', 0);
      return { files: out, over };
    }

    function runPython(f) {
      setPreview(true);
      const dir = vfs.parentPath(f.path);
      const { files, over } = collect(dir);
      if (over) api.notify({ app: 'Code', icon: 'alert', title: 'A big folder', message: 'Python gets the first 300 text files (5 MB) of this folder; the rest were left out.', timeout: 4200 });
      const rel = f.path.slice(dir.length + 1);
      if (!files.some(x => x.path === rel)) files.push({ path: rel, text: f.text });
      py.run({
        files, main: rel,
        known: name => files.some(x => x.path === name),
        reveal: (file, line) => { const abs = vfs.norm(`${dir}/${file}`); if (vfs.node(abs)) { openPath(abs); gotoLine(line); } },
      });
    }

    function showFind(on, repl = S.repl) {
      S.repl = !!(on && repl);
      findBox.classList.toggle('hidden', !on);
      replBox.classList.toggle('hidden', !S.repl);
      replToggle.setAttribute('aria-expanded', String(S.repl));
      replToggle.setAttribute('aria-label', S.repl ? 'Hide Replace' : 'Show Replace');
      btnFind.classList.toggle('is-on', on);
      if (on) {
        /* a short selection on one line is what you want to find */
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        if (sel && sel.length < 200 && !sel.includes('\n') && document.activeElement === ta) findInput.value = sel;
        if (repl && findInput.value) { replInput.focus(); replInput.select(); } else { findInput.focus(); findInput.select(); }
        runFind(0);
      } else { findCount.textContent = ''; S.hits = []; ta.focus(); }
    }

    /** Replace: the selected match becomes the replacement, then the next match is selected. */
    function replaceOne() {
      const f = current();
      const q = findInput.value;
      if (!f || !q) { findInput.focus(); return; }
      if (!S.hits.length) runFind(0);
      if (!S.hits.length) return;
      const at = S.hits[S.hitI];
      const rep = replInput.value;
      const back = document.activeElement;
      if (ta.selectionStart === at && ta.selectionEnd === at + q.length) {
        applyEdit({ from: at, to: at + q.length, insert: rep, selStart: at + rep.length, selEnd: at + rep.length });
        runFind(0);
        /* the next match after the one just replaced */
        const k = S.hits.findIndex(i => i >= at + rep.length);
        if (S.hits.length) { S.hitI = (k >= 0 ? k : 0) - 1; runFind(1); }
      } else runFind(0);
      back?.focus?.({ preventScroll: true });
    }

    function replaceAll() {
      const f = current();
      const q = findInput.value;
      if (!f || !q) { findInput.focus(); return; }
      runFind(0);
      const n = S.hits.length;
      if (!n) { findCount.textContent = 'no matches'; return; }
      const rep = replInput.value;
      let out = '', last = 0;
      for (const i of S.hits) { out += ta.value.slice(last, i) + rep; last = i + q.length; }
      out += ta.value.slice(last);
      const back = document.activeElement;
      applyEdit({ from: 0, to: ta.value.length, insert: out, selStart: S.hits[0], selEnd: S.hits[0] + rep.length });
      S.hits = [];
      findCount.textContent = `${n} replaced`;
      back?.focus?.({ preventScroll: true });
    }

    function runFind(step, focusEditor) {
      const f = current();
      const q = findInput.value;
      if (!f || !q) { S.hits = []; findCount.textContent = ''; return; }
      if (!step) {
        const hay = f.text.toLowerCase(), needle = q.toLowerCase();
        S.hits = [];
        for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) S.hits.push(i);
        S.hitI = 0;
      } else if (S.hits.length) {
        S.hitI = (S.hitI + step + S.hits.length) % S.hits.length;
      }
      if (!S.hits.length) { findCount.textContent = 'no matches'; return; }
      findCount.textContent = `${S.hitI + 1}/${S.hits.length}`;
      const at = S.hits[S.hitI];
      ta.setSelectionRange(at, at + q.length);
      const line = f.text.slice(0, at).split('\n').length;
      ta.scrollTop = Math.max(0, lineTop(line) - ta.clientHeight / 2);
      syncScroll();
      if (focusEditor) ta.focus();
      paintFoot();
    }

    const syncScroll = () => {
      layer.scrollTop = ta.scrollTop;
      layer.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    };

    /* ---------------- new web project ------ */
    function newWebProject() {
      startProject('my-site', STARTER, ['script.js', 'style.css', 'index.html'], 'index.html, style.css and script.js — the preview updates as you type.');
    }

    /** A real project in ~/Projects: its files written, the last of `order` shown. */
    function startProject(base, filesFor, order, message) {
      let name = base;
      for (let n = 2; vfs.node(`${PROJ}/${name}`); n++) name = `${base}-${n}`;
      const dir = `${PROJ}/${name}`;
      if (!vfs.mkdir(dir)) { api.notify({ app: 'Code', icon: 'alert', title: 'Could not make the project', message: `${PROJ} is not a folder.` }); return; }
      for (const [file, text] of Object.entries(filesFor(name))) vfs.write(`${dir}/${file}`, text);
      S.folds.add(PROJ); S.folds.add(dir);
      order.forEach((file, i) => openPath(`${dir}/${file}`, i > 0));
      setPreview(true);
      api.notify({ app: 'Code', icon: 'file-code', title: `Made ~/Projects/${name}`, message, timeout: 4200 });
    }

    function newFromTemplate(t) {
      const others = Object.keys(t.files('')).filter(f => f !== t.open);
      startProject(t.dir, t.files, [...others, t.open],
        t.preview === 'py' ? 'main.py is open: press Run (the play button) to run it. The first run downloads Python once.'
          : t.preview === 'sql' ? `${t.open} is open: press Run to run its queries on the Corner shop sample. The first run downloads SQLite once (about 0.7 MB).`
          : t.preview === 'glsl' ? 'The shader is drawing beside the editor: change a number and it updates as you type.'
          : 'The preview is running: edit any file and it updates as you type.');
    }

    function templateMenu(btn) {
      const r = btn.getBoundingClientRect();
      api.menu([
        { label: 'Website', icon: 'globe', hint: 'A page, a style and a button', onClick: () => newWebProject() },
        ...TEMPLATES.map(t => ({ label: t.name, icon: t.icon, hint: t.hint, onClick: () => newFromTemplate(t) })),
      ], r.left, r.bottom + 4, { label: 'Start from a template' });
    }

    /* ================= live preview ================= */
    /** The text of a file as the editor has it (unsaved edits included). */
    const textOf = p => { const f = S.open.find(x => x.path === p); return f ? f.text : vfs.read(p); };
    const attrOf = (tag, name) => {
      const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
    };
    /** A page-relative URL → a vfs path, or null for anything remote. */
    const localPath = (dir, url) => {
      if (url === null || url === '' || REMOTE.test(url)) return null;
      const clean = url.split(/[?#]/)[0];
      try { return vfs.norm(clean.startsWith('/') ? `${dir}${clean}` : `${dir}/${decodeURIComponent(clean)}`); } catch (err) { return vfs.norm(`${dir}/${clean}`); }
    };
    const pages = dir => vfs.ls(dir).filter(n => n.type === 'file' && /\.html?$/i.test(n.name)).map(n => `${dir}/${n.name}`);

    /** Which page shows the open file: itself, the page in its folder that
        links it, index.html, or the only page there. */
    function pageFor(f) {
      if (!f || !WEB.test(f.name)) return S.pv.page && vfs.node(S.pv.page) ? S.pv.page : null;
      if (/\.html?$/i.test(f.name)) return f.path;
      const dir = vfs.parentPath(f.path);
      const all = pages(dir);
      const uses = all.find(p => {
        const t = textOf(p) || '';
        const re = /<(?:link|script)\b[^>]*>/gi;
        let m;
        while ((m = re.exec(t))) if (localPath(dir, attrOf(m[0], 'href') ?? attrOf(m[0], 'src')) === f.path) return true;
        return false;
      });
      return uses || all.find(p => /\/index\.html?$/i.test(p)) || (all.length === 1 ? all[0] : null);
    }

    /**
     * The page as one document: local stylesheets and scripts written in.
     * Returns { html, segs, missing } — segs say which file each stretch of
     * the result came from, so error lines can be traced back.
     */
    function compose(pagePath, read = textOf) {
      const src = read(pagePath) || '';
      const dir = vfs.parentPath(pagePath);
      const segs = [];
      const missing = [];
      const lineAt = i => { let n = 1; for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) n++; return n; };
      const re = /<!--[\s\S]*?-->|<link\b[^>]*>|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
      let last = 0, m;
      while ((m = re.exec(src))) {
        const tag = m[0];
        if (tag.startsWith('<!--')) continue;
        let rep = null;
        if (/^<link/i.test(tag)) {
          if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag)) continue;
          const href = attrOf(tag, 'href');
          const p = localPath(dir, href);
          if (!p) continue;
          const body = read(p);
          if (body === null) { missing.push(href); continue; }
          rep = { open: `<style data-file="${href.replace(/["<>&]/g, '')}">`, body: body.replace(/<\/style/gi, '<\\/style'), close: '</style>', file: p };
        } else {
          const s = attrOf(m[1], 'src');
          const p = localPath(dir, s);
          if (!p) continue;
          const body = read(p);
          if (body === null) { missing.push(s); continue; }
          const attrs = m[1].replace(/\s*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
          rep = { open: `<script${attrs} data-file="${s.replace(/["<>&]/g, '')}">`, body: body.replace(/<\/script/gi, '<\\/script'), close: '</script>', file: p };
        }
        segs.push({ text: src.slice(last, m.index), file: pagePath, line: lineAt(last) });
        segs.push({ text: rep.open + '\n', file: null });
        segs.push({ text: rep.body, file: rep.file, line: 1 });
        segs.push({ text: '\n' + rep.close, file: null });
        last = m.index + tag.length;
      }
      segs.push({ text: src.slice(last), file: pagePath, line: lineAt(last) });
      return { html: segs.map(s => s.text).join(''), segs, missing };
    }

    /** Line n of the composed page → { file, line } (or null). */
    function lineTable(segs) {
      const map = [null];            /* 1-based */
      let cl = 1, pending = true;    /* line 1 starts in the first segment */
      for (const s of segs) {
        if (!s.text) continue;
        const pieces = s.text.split('\n');
        if (pending) { map[cl] = s.file ? { file: s.file, line: s.line } : null; pending = false; }
        for (let k = 1; k < pieces.length; k++) {
          cl++;
          if (k === pieces.length - 1 && pieces[k] === '') { pending = true; continue; }
          map[cl] = s.file ? { file: s.file, line: s.line + k } : null;
        }
      }
      return map;
    }

    /** What the sandbox adds in front of the page moves its lines down:
        find where, and by how much. */
    function preludeShift(html) {
      const out = SB.withPrelude(html);
      let i = 0;
      while (i < html.length && html.charCodeAt(i) === out.charCodeAt(i)) i++;
      let at = 1;
      for (let k = 0; k < i; k++) if (html.charCodeAt(k) === 10) at++;
      const nl = s => (s.match(/\n/g) || []).length;
      return { at, by: nl(out) - nl(html) };
    }

    function setPreview(on, auto = false) {
      S.pv.on = !!on;
      S.pv.auto = S.pv.on && auto;
      if (!auto) setPref({ preview: S.pv.on });
      preview.hidden = !S.pv.on;
      pvSplit.hidden = !S.pv.on;
      btnPrev.setAttribute('aria-pressed', String(S.pv.on));
      btnPrev.classList.toggle('is-on', S.pv.on);
      appEl.classList.toggle('has-preview', S.pv.on);
      if (S.pv.on) { applyWidth(); refresh(true); }
      else { stopPreview(); py.release(); shader.hide(); }
      fitLayout();
    }
    function setLive(on) {
      S.pv.live = !!on;
      setPref({ live: S.pv.live });
      paintLive();
      if (S.pv.live) refresh(false);
    }
    function paintLive() {
      liveSw.classList.toggle('is-on', S.pv.live);
      liveSw.setAttribute('aria-checked', String(S.pv.live));
    }
    function stopPreview() {
      clearTimeout(S.pv.t);
      S.pv.sb?.stop();
      S.pv.sb = null;
      S.pv.html = null;
    }
    function scheduleRefresh(ms = 320) {
      clearTimeout(S.pv.t);
      S.pv.t = setTimeout(() => { if (!S.dead) refresh(false); }, ms);
    }

    /** The pane shows one of three things, by the open file: a page, a document, a program. */
    function setMode(mode) {
      S.mode = mode;
      preview.dataset.mode = mode;
      mdView.hidden = mode !== 'md';
      py.el.hidden = mode !== 'py';
      sqlP.el.hidden = mode !== 'sql';
      shader.el.hidden = mode !== 'glsl';
      if (mode !== 'glsl') shader.hide();
      if (mode !== 'web') { pvHost.hidden = true; pvEmpty.hidden = true; }
    }
    function drawMd(f) {
      const text = f.text.length > 300000 ? `${f.text.slice(0, 300000)}\n\n(The preview stops here: the file is longer than 300 000 characters.)` : f.text;
      const top = mdView.scrollTop;
      mdView.replaceChildren(renderMd(text, { doc: true }));
      mdView.scrollTop = top;
    }
    mdView.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href]');
      const url = a && a.getAttribute('href');
      /* a link opens in StaticOS's own browser window rather than a new tab */
      if (url && /^https?:/i.test(url) && api.getApp('browser')) { e.preventDefault(); api.openApp('browser', { url }); }
    });

    /** Show the page for the open file. force: reload even when unchanged. */
    function refresh(force) {
      clearTimeout(S.pv.t);
      if (!S.pv.on || S.dead) return;
      const f = current();
      const mode = modeOf(f) || 'web';
      if (mode !== 'web') {
        /* a document or a program: the page (if any) stops, the pane changes */
        if (S.mode === 'web') stopPreview();
        setMode(mode);
        pvPage.textContent = f.name;
        pvPage.title = f.path.replace(vfs.HOME, '~');
        if (mode === 'md') drawMd(f);
        else if (mode === 'glsl') shader.show(f.text, n => { openPath(f.path); gotoLine(n); });
        else if (mode === 'sql') sqlP.show(f, n => { openPath(f.path); gotoLine(n); });
        return;
      }
      setMode('web');
      let page = pageFor(f);
      let built;
      if (page) built = compose(page);
      else if (f && /\.m?js$/i.test(f.name)) {
        /* a script with no page: run it in an empty one */
        const body = f.text.replace(/<\/script/gi, '<\\/script');
        const head = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${f.name.replace(/[<>&]/g, '')}</title></head>\n<body>\n<script${/\.mjs$/i.test(f.name) ? ' type="module"' : ''}>\n`;
        built = { html: `${head}${body}\n</script>\n</body></html>\n`, segs: [{ text: head, file: null }, { text: body, file: f.path, line: 1 }, { text: '\n</script>\n</body></html>\n', file: null }], missing: [] };
        page = f.path;
      } else {
        S.pv.page = null;
        stopPreview();
        showEmpty(!f ? 'Open an HTML, CSS or JavaScript file to preview it.'
          : WEB.test(f.name) ? `There is no HTML page in ${vfs.parentPath(f.path).replace(vfs.HOME, '~')} that uses ${f.name}. Add an index.html next to it to see it.`
          : `${f.label} files have nothing to preview. Open an HTML, CSS or JavaScript file.`);
        return;
      }
      const html = built.html;
      if (!force && S.pv.sb && html === S.pv.html && page === S.pv.page) return;
      showEmpty('');
      S.pv.page = page;
      S.pv.html = html;
      S.pv.map = { lines: lineTable(built.segs), shift: preludeShift(html) };
      pvPage.textContent = page.replace(`${PROJ}/`, '');
      pvPage.title = page.replace(vfs.HOME, '~');
      S.pv.logs = [];
      log('system', `Loaded ${vfs.baseName(page)} · ${new Date().toLocaleTimeString()}`);
      for (const m of built.missing) log('warn', `${m} was not found next to ${vfs.baseName(page)}, so it was left out.`);
      if (S.pv.sb) S.pv.sb.reload(html);
      else {
        S.pv.sb = SB.run(pvHost, html, { title: `Preview of ${vfs.baseName(page)}`, onLog: (kind, text) => log(kind, text, true) });
        S.pv.sb.frame.classList.add('cpv__frame');
      }
    }
    function showEmpty(text) {
      pvEmpty.hidden = !text;
      pvHost.hidden = !!text;
      pvEmpty.textContent = text || '';
      if (text) { pvPage.textContent = ''; S.pv.logs = []; paintLog(); }
    }

    /* ---------------- console --------------- */
    /** "(line 12)" from the page → the file and line it came from */
    function where(text, map = S.pv.map) {
      const m = text.match(/\(line (\d+)\)/);
      if (!m || !map) return { text, at: null };
      const n = Number(m[1]);
      const { at, by } = map.shift;
      const k = n <= at ? n : n > at + by ? n - by : null;
      const hit = k ? map.lines[k] : null;
      if (!hit) return { text: text.replace(m[0], '').trim(), at: null };
      return { text: text.replace(m[0], '').trim(), at: hit };
    }
    function log(kind, text, fromPage = false) {
      const row = { kind, t: Date.now(), ...(fromPage && (kind === 'uncaught' || kind === 'error') ? where(String(text)) : { text: String(text), at: null }) };
      S.pv.logs.push(row);
      if (S.pv.logs.length > MAX_LOG) S.pv.logs.splice(0, S.pv.logs.length - MAX_LOG);
      queueLog();
    }
    let logQ = 0;
    function queueLog() {
      if (logQ) return;
      logQ = requestAnimationFrame(() => { logQ = 0; if (!S.dead) paintLog(); });
    }
    function paintLog() {
      logEl.classList.toggle('is-closed', !S.pv.logOpen);
      logFold.setAttribute('aria-label', S.pv.logOpen ? 'Hide the console' : 'Show the console');
      logFold.dataset.tip = S.pv.logOpen ? 'Hide the console' : 'Show the console';
      const errs = S.pv.logs.filter(l => l.kind === 'error' || l.kind === 'uncaught').length;
      const warns = S.pv.logs.filter(l => l.kind === 'warn').length;
      const msgs = S.pv.logs.filter(l => l.kind !== 'system').length;
      clear(logCounts);
      if (errs) logCounts.append(h('span.cpv__cnt.cpv__cnt--err', { text: `${errs} error${errs === 1 ? '' : 's'}` }));
      if (warns) logCounts.append(h('span.cpv__cnt.cpv__cnt--warn', { text: `${warns} warning${warns === 1 ? '' : 's'}` }));
      if (!errs && !warns && msgs) logCounts.append(h('span.cpv__cnt', { text: `${msgs} message${msgs === 1 ? '' : 's'}` }));
      if (!S.pv.logOpen) return;
      const stick = logList.scrollHeight - logList.scrollTop - logList.clientHeight < 24;
      clear(logList);
      if (!S.pv.logs.some(l => l.kind !== 'system')) {
        logList.append(...S.pv.logs.map(rowEl), h('div.cpv__none', { text: 'Nothing logged yet. console.log() in the page, and any error, shows up here.' }));
        return;
      }
      for (const l of S.pv.logs) logList.append(rowEl(l));
      if (stick) logList.scrollTop = logList.scrollHeight;
    }
    function rowEl(l) {
      const kind = l.kind === 'uncaught' ? 'error' : l.kind;
      const ic = kind === 'error' ? 'x-circle' : kind === 'warn' ? 'alert' : kind === 'system' ? 'refresh' : kind === 'info' ? 'info' : kind === 'result' ? 'corner-up-left' : 'chevron-right';
      const loc = l.at ? `${vfs.baseName(l.at.file)}:${l.at.line}` : '';
      return h(`div.cpv__row.cpv__row--${kind}`,
        icon(ic),
        h('span.cpv__x', { text: l.kind === 'uncaught' && !/^Uncaught\b/.test(l.text) ? `Uncaught ${l.text}` : l.text }),
        loc ? h('button.cpv__go', { type: 'button', title: `Show ${loc} in the editor`, 'aria-label': `Go to ${loc}`, onclick: () => reveal(l.at) }, h('span', { text: loc })) : null);
    }
    function reveal(at) {
      if (S.sh && at.file.startsWith(SH_ROOT)) { shShow(at.file.slice(SH_ROOT.length), at.line); return; }
      if (!vfs.node(at.file) && !S.open.some(f => f.path === at.file)) return;
      openPath(at.file);
      gotoLine(at.line);
    }

    /* ================= share a project, and review one ================= */
    function shareProject() {
      const f = current();
      if (!f) { api.notify({ app: 'Code', icon: 'alert', title: 'Nothing to share', message: 'Open a file from a web project first.', timeout: 3200 }); return; }
      const dir = vfs.parentPath(f.path);
      const { files } = collect(dir, null, 120, 4 * 1024 * 1024);
      const title = dir === PROJ || dir === vfs.HOME ? f.name : vfs.baseName(dir);
      api.bus.emit('share:open', { kind: 'project', id: dir, title, files, name: title });
    }

    /** A project that arrived in a link. It is only read here: the files are in
        memory (never the vfs), shown as text, and nothing runs until Run. */
    async function openShared(link) {
      closePanel();
      closeShared();
      const my = ++S.shSeq;
      const el = h('section.csh', { role: 'region', 'aria-label': 'Shared project: review before running' });
      const sh = S.sh = { el, my, files: new Map(), sb: null, logs: [], map: null, cur: null, page: null, project: null, source: 'link' };
      appEl.appendChild(el);
      render(el, h('div.csh__msg', h('div.spinner'), h('small', { text: 'Reading the link…' })));
      let r;
      try { r = await Share.decode(link); } catch (e) { r = { ok: false, error: `The link couldn’t be read (${e.message || e}).` }; }
      if (S.dead || my !== S.shSeq || S.sh !== sh) return;
      if (!r.ok) {
        render(el, h('div.csh__msg', icon('alert'), h('b', { text: 'This share link can’t be opened' }), h('small', { role: 'alert', text: r.error }),
          h('button.btn.btn--sm', { type: 'button', onclick: closeShared }, icon('x'), h('span', { text: 'Close' }))));
        return;
      }
      const P = sh.project = r.project;
      for (const f of P.files) sh.files.set(SH_ROOT + f.path, f.text);
      sh.page = Share.entryPage(P.files);
      sh.cur = sh.page;
      sh.hosts = externalHosts(P.files.filter(f => /\.(html?|js|mjs|css|svg)$/i.test(f.path)).map(f => f.text).join('\n'));
      buildShared();
    }

    /** A public GitHub Gist: ask for its link or id, fetch it straight from GitHub,
        and show it in the same read-only review as a shared project. Nothing runs. */
    function openGist(text) {
      closePanel();
      closeShared();
      const my = ++S.shSeq;
      const el = h('section.csh', { role: 'region', 'aria-label': 'Open a GitHub Gist' });
      const sh = S.sh = { el, my, files: new Map(), sb: null, logs: [], map: null, cur: null, page: null, project: null, source: 'gist', ctl: null };
      appEl.appendChild(el);
      const field = h('input', { type: 'text', 'data-act': 'gist-input', 'aria-label': 'Gist link or id', placeholder: 'https://gist.github.com/name/…  or the gist id', spellcheck: 'false', autocomplete: 'off', value: text || '' });
      const status = h('div.csh__gstatus', { role: 'status', 'aria-live': 'polite' });
      const go = h('button.btn.btn--primary', { type: 'button', 'data-act': 'gist-open' }, icon('download'), h('span', { text: 'Open' }));
      const say = (msg, bad) => { status.className = `csh__gstatus${bad ? ' is-bad' : ''}`; status.setAttribute('role', bad ? 'alert' : 'status'); status.textContent = msg; };
      const submit = async () => {
        if (sh.busy) return;
        const parsed = Gist.parseGist(field.value);
        if (!parsed.ok) { say(parsed.error, true); field.focus(); return; }
        sh.busy = true; go.disabled = true;
        say('Asking GitHub for the gist…');
        sh.ctl = new AbortController();
        let r;
        try { r = await Gist.fetchGist(field.value, { signal: sh.ctl.signal }); } catch (e) { r = { ok: false, error: `The gist couldn’t be read (${e.message || e}).` }; }
        if (S.dead || my !== S.shSeq || S.sh !== sh) return;
        sh.busy = false; go.disabled = false; sh.ctl = null;
        if (!r.ok) { say(r.error, true); field.focus(); return; }
        sh.project = r.project;
        sh.gist = { id: r.id, url: r.url, skipped: r.skipped };
        for (const f of r.project.files) sh.files.set(SH_ROOT + f.path, f.text);
        sh.page = Share.entryPage(r.project.files);
        sh.cur = sh.page;
        sh.hosts = externalHosts(r.project.files.filter(f => /\.(html?|js|mjs|css|svg)$/i.test(f.path)).map(f => f.text).join('\n'));
        buildShared();
      };
      go.onclick = submit;
      field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      render(el, h('div.csh__msg.csh__gist', icon('link'), h('b', { text: 'Open a public GitHub Gist' }),
        h('small', { text: 'Paste its link or id. StaticOS asks GitHub for it directly and sends nothing about you. The gist is only shown to you: it doesn’t run unless you press Run.' }),
        h('div.csh__grow', h('label.field', icon('link'), field), go), status,
        h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'close-shared', onclick: closeShared }, icon('x'), h('span', { text: 'Close' }))));
      field.focus({ preventScroll: true });
      if (text) submit();
    }

    function closeShared() {
      const sh = S.sh;
      if (!sh) return;
      sh.ctl?.abort();
      sh.sb?.stop();
      sh.el.remove();
      S.sh = null;
    }

    const kb = n => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

    function buildShared() {
      const sh = S.sh, P = sh.project;
      const lines = P.files.reduce((n, f) => n + f.text.split('\n').length, 0);
      const fileList = h('div.csh__files', { role: 'list', 'aria-label': 'Files in this project' });
      const codeHead = h('div.csh__codehead');
      const code = h('pre.csh__code', { tabindex: '0', 'aria-label': 'Code of the selected file (read only)' });
      const stage = h('div.csh__stage');
      const log = h('div.cpv__list.csh__log', { role: 'log', 'aria-label': 'Console of the shared project' });
      const runBtn = h('button.btn.btn--primary', { type: 'button', 'data-act': 'run-shared', onclick: () => shRun() }, icon('play'), h('span', { text: 'Run' }));
      sh.ui = { fileList, codeHead, code, stage, log, runBtn };
      const gist = sh.source === 'gist';
      const facts = [
        gist
          ? (P.creator ? `Posted by ${P.creator} on GitHub — that is the name GitHub gave; it says nothing about whether the code is safe.` : 'GitHub doesn’t name an owner for this gist.')
          : P.creator ? `Made by ${P.creator} — as written in the link; names aren’t checked.` : 'The link doesn’t say who made it.',
        gist
          ? `${P.files.length} file${P.files.length === 1 ? '' : 's'} · ${lines.toLocaleString()} lines · ${kb(P.bytes)}, fetched from gist.github.com/${sh.gist.id}.`
          : `${P.files.length} file${P.files.length === 1 ? '' : 's'} · ${lines.toLocaleString()} lines · ${kb(P.bytes)} (the link was ${kb(P.chars)}).`,
        ...(gist && sh.gist.skipped.length ? [`Left out, because they aren’t web files StaticOS opens: ${sh.gist.skipped.slice(0, 5).join(', ')}${sh.gist.skipped.length > 5 ? ` and ${sh.gist.skipped.length - 5} more` : ''}.`] : []),
        sh.hosts.length ? `Its code mentions ${sh.hosts.join(', ')} — it may load things from there when it runs.` : 'Its code mentions no web addresses.',
      ];
      render(sh.el,
        h('header.csh__notice',
          h('span.csh__shield', icon('shield')),
          h('div.csh__says',
            h('b', { text: 'This came from someone else' }),
            h('p', { text: `${gist ? 'A GitHub Gist' : 'A link'} brought you “${P.name}”. Nothing has run. Read the code first: it only runs when you press Run, in a sealed box that can’t see your files, saved data or the rest of StaticOS.` }),
            h('ul.csh__facts', facts.map(t => h('li', { text: t })))),
          h('div.csh__acts',
            runBtn,
            h('button.btn', { type: 'button', 'data-act': 'save-shared', onclick: () => shSave() }, icon('download'), h('span', { text: 'Save a copy' })),
            h('button.btn.btn--ghost', { type: 'button', 'data-act': 'close-shared', onclick: () => closeShared() }, icon('x'), h('span', { text: 'Close' })))),
        h('div.csh__main',
          h('aside.csh__side', h('div.side__label', { text: 'Files' }), fileList),
          h('div.csh__codecol', codeHead, code),
          h('div.csh__run',
            h('div.cpv__bar', icon('globe'), h('b', { text: 'Preview' }), h('div.grow'),
              h('button.ibtn.tip', { 'data-tip': 'Stop it', 'aria-label': 'Stop the shared project', onclick: () => shStop() }, icon('square'))),
            stage,
            h('div.cpv__loghead', icon('terminal'), h('b', { text: 'Console' })),
            log)));
      shIdle();
      shShow(sh.cur, 0);
      fileList.querySelector('button')?.focus({ preventScroll: true });
    }

    function shIdle() {
      const { stage } = S.sh.ui;
      render(stage, h('div.csh__idle', icon('shield'), h('b', { text: 'Nothing has run yet' }),
        h('small', { text: 'Press Run to open the project’s page in the sealed preview.' })));
    }

    function shShow(path, line) {
      const sh = S.sh;
      if (!sh || !sh.files.has(SH_ROOT + path)) return;
      sh.cur = path;
      const { fileList, codeHead, code } = sh.ui;
      render(fileList, ...sh.project.files.map(f => h('button.side__item', {
        type: 'button', role: 'listitem', class: f.path === path ? 'is-on' : null, onclick: () => shShow(f.path, 0),
      }, icon(vfs.iconFor({ type: 'file', kind: vfs.kindOf(f.path) })), h('span.trunc', { text: f.path }), h('small', { text: kb(f.bytes) }))));
      const f = sh.project.files.find(x => x.path === path);
      render(codeHead, icon('lock', { size: 12 }), h('span.mono', { text: f.path }), h('small.dim', { text: 'read only' }));
      const ext = vfs.extOf(f.path);
      const spec = f.text.length > MAX_HL ? null : SPECS[(LANGS[ext] || [])[1]];
      render(code, ...tokens(f.text, spec));
      if (line > 0) {
        const lh = parseFloat(getComputedStyle(code).lineHeight) || 18;
        code.scrollTop = Math.max(0, (line - 1) * lh - code.clientHeight / 3);
      } else code.scrollTop = 0;
    }

    function shLog(kind, text, fromPage = false) {
      const sh = S.sh;
      if (!sh) return;
      const row = { kind, t: Date.now(), ...(fromPage && (kind === 'uncaught' || kind === 'error') ? where(String(text), sh.map) : { text: String(text), at: null }) };
      sh.logs.push(row);
      if (sh.logs.length > MAX_LOG) sh.logs.shift();
      render(sh.ui.log, ...sh.logs.map(rowEl));
      sh.ui.log.scrollTop = sh.ui.log.scrollHeight;
    }

    /** Run: only now does the project's code start, in the same sealed frame as any other preview. */
    function shRun() {
      const sh = S.sh;
      if (!sh) return;
      /* a shared page may only read the shared files — never the vfs */
      const read = p => (sh.files.has(p) ? sh.files.get(p) : null);
      const built = compose(SH_ROOT + sh.page, read);
      sh.map = { lines: lineTable(built.segs), shift: preludeShift(built.html) };
      sh.logs = [];
      shLog('system', `Running ${sh.page} · ${new Date().toLocaleTimeString()}`);
      for (const m of built.missing) shLog('warn', `${m} isn’t one of the shared files, so it was left out.`);
      sh.sb?.stop();
      clear(sh.ui.stage);
      sh.sb = SB.run(sh.ui.stage, built.html, { title: `Shared project: ${sh.page}`, onLog: (kind, text) => shLog(kind, text, true) });
      sh.sb.frame.classList.add('csh__frame');
      sh.ui.runBtn.querySelector('span').textContent = 'Run again';
    }

    function shStop() {
      const sh = S.sh;
      if (!sh || !sh.sb) return;
      sh.sb.stop();
      sh.sb = null;
      shIdle();
      shLog('system', 'Stopped.');
    }

    /** Save a copy into ~/Projects — only when asked. */
    function shSave() {
      const sh = S.sh;
      if (!sh) return;
      let name = Share.folderName(sh.project.name);
      for (let n = 2; vfs.node(`${PROJ}/${name}`); n++) name = `${Share.folderName(sh.project.name)}-${n}`;
      const dir = `${PROJ}/${name}`;
      if (!vfs.mkdir(dir)) { api.notify({ app: 'Code', icon: 'alert', title: 'Could not save', message: `${PROJ} is not a folder.` }); return; }
      for (const f of sh.project.files) {
        const parts = f.path.split('/');
        let at = dir;
        for (const part of parts.slice(0, -1)) { at = `${at}/${part}`; vfs.mkdir(at); S.folds.add(at); }
        const to = vfs.norm(`${dir}/${f.path}`);
        if (to.startsWith(`${dir}/`)) vfs.write(to, f.text);
      }
      const page = `${dir}/${sh.page}`;
      S.folds.add(PROJ); S.folds.add(dir);
      closeShared();
      openPath(page, false);
      api.notify({ app: 'Code', icon: 'download', title: `Saved ~/Projects/${name}`, message: 'A copy of the shared project. It is yours to edit; press Run to preview it.', timeout: 4200 });
    }

    /* ---------------- preview width ---------- */
    function applyWidth() {
      const w = Number(prefs().prevW);
      preview.style.width = Number.isFinite(w) && w >= 220 ? `${Math.round(w)}px` : '';
    }
    pvSplit.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      pvSplit.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = preview.getBoundingClientRect().width;
      const max = () => Math.max(260, work.getBoundingClientRect().width - 200);
      /* the page must not swallow the pointer while the edge is dragged */
      appEl.classList.add('is-resizing');
      const move = ev => { preview.style.width = `${Math.round(Math.min(max(), Math.max(220, w0 - (ev.clientX - x0))))}px`; };
      const up = () => {
        pvSplit.removeEventListener('pointermove', move);
        pvSplit.removeEventListener('pointerup', up);
        pvSplit.removeEventListener('pointercancel', up);
        appEl.classList.remove('is-resizing');
        setPref({ prevW: preview.getBoundingClientRect().width });
      };
      pvSplit.addEventListener('pointermove', move);
      pvSplit.addEventListener('pointerup', up);
      pvSplit.addEventListener('pointercancel', up);
    });
    pvSplit.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const w = preview.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 24 : -24);
      preview.style.width = `${Math.round(Math.max(220, Math.min(work.getBoundingClientRect().width - 200, w)))}px`;
      setPref({ prevW: preview.getBoundingClientRect().width });
    });
    /* in a narrow window the file tree makes room for the preview */
    function fitLayout() { appEl.classList.toggle('is-tight', S.pv.on && appEl.clientWidth < 860); }
    /* a wrapped line's height changes with the width: its number follows */
    const ro = new ResizeObserver(() => { fitLayout(); if (S.ed.wrap && current()) requestAnimationFrame(() => { if (!S.dead) paintGutter(); }); });
    ro.observe(appEl);

    /* ---------------- status bar ----------- */
    function paintFoot() {
      const f = current();
      if (!f) { render(foot, h('span.dim', { text: 'Ready' })); return; }
      const { line, col, sel: chosen } = caret();
      const fb = (text, title, act, onclick) => h('button.cfx__fb', { type: 'button', title, 'data-act': act, onclick: e => onclick(e.currentTarget) }, h('span', { text }));
      render(foot,
        h('button.ibtn.tip', {
          'data-tip': 'Reveal in Files', style: { height: '20px', fontSize: 'var(--fs-10)' },
          onclick: () => api.openApp('files', { path: vfs.parentPath(f.path) }),
        }, icon('file-code', { size: 11 }), h('span', { text: f.label })),
        h('span.dim', { text: '·' }),
        h('button.cfx__fb.mono.cpv__pos', { type: 'button', title: 'Go to a line (Ctrl+G)', 'data-act': 'goto', onclick: () => openGoto(), text: `Ln ${line}, Col ${col}${chosen ? ` (${chosen} selected)` : ''}` }),
        h('span.dim', { text: '·' }),
        h('span.dim', { text: `${ta.value.split('\n').length} lines` }),
        h('div.grow'),
        S.hits.length ? h('span.dim', { text: `${S.hits.length} matches` }) : null,
        fb(f.tabs ? `Tabs: ${f.indent}` : `Spaces: ${f.indent}`, 'How this file is indented: Tab and Enter use it', 'indent', indentMenu),
        fb(S.ed.wrap ? 'Wrap: on' : 'Wrap: off', 'Word wrap: long lines fold to fit the editor', 'wrap', () => setEd({ wrap: !S.ed.wrap })),
        h('span.dim', { text: 'UTF-8' }),
        h('span.dim', { text: 'LF' }),
        h('button.ibtn.tip.cfx__aa', { 'data-tip': 'Text size, colours and typing helpers', 'aria-label': 'Editor settings', 'data-act': 'editor-settings', onclick: e => editorMenu(e.currentTarget) }, icon('type', { size: 12 })),
        f.dirty
          ? h('span.badge.badge--warn', { text: 'Unsaved' })
          : h('span.badge.badge--ok', { text: 'Saved' }));
    }

    /* ================= editing helpers ================= */
    const sel = () => [ta.selectionStart, ta.selectionEnd];

    /** A file's indent: what its text already uses, else what was last picked
        for its language, else 4 spaces for Python and 2 for everything else. */
    function indentFor(text, lang) {
      const det = E.detectIndent(text);
      if (det) return { indent: det.size, tabs: det.tabs };
      const pick = S.ed.indent[lang || 'txt'];
      if (pick === 'tab') return { indent: 4, tabs: true };
      const n = Number(pick);
      return { indent: [2, 4, 8].includes(n) ? n : lang === 'py' ? 4 : 2, tabs: false };
    }
    function setIndent(n, tabs) {
      const f = current();
      if (!f) return;
      f.indent = n; f.tabs = tabs;
      ta.style.tabSize = layer.style.tabSize = String(n);
      S.ed.indent = { ...S.ed.indent, [f.lang || 'txt']: tabs ? 'tab' : n };
      setPref({ indent: S.ed.indent });
      paintFoot();
    }

    /** The top of line n inside the text (a wrapped line is taller than one row). */
    function lineTop(n) {
      if (S.ed.wrap) {
        const row = layer.children[n - 1];
        if (row) return row.offsetTop - (parseFloat(getComputedStyle(layer).paddingTop) || 0);
      }
      return (n - 1) * (parseFloat(getComputedStyle(ta).lineHeight) || 18);
    }
    /** Caret to line n, column col (1-based), without selecting. */
    function caretTo(n, col = 1) {
      const v = ta.value;
      let pos = 0;
      for (let i = 1; i < n; i++) { const j = v.indexOf('\n', pos); if (j < 0) break; pos = j + 1; }
      let end = v.indexOf('\n', pos);
      if (end < 0) end = v.length;
      const p = Math.min(end, pos + Math.max(0, col - 1));
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(p, p);
      ta.scrollTop = Math.max(0, lineTop(n) - ta.clientHeight / 3);
      syncScroll(); paintGutter(); paintFoot();
    }
    function selectAt(at, len) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(at, at + len);
      ta.scrollTop = Math.max(0, lineTop(ta.value.slice(0, at).split('\n').length) - ta.clientHeight / 3);
      syncScroll(); paintGutter(); paintFoot();
    }

    function cmdComment() {
      const f = current();
      if (!f) return;
      const [s, e] = sel();
      if (!E.COMMENT[f.lang]) { api.notify({ app: 'Code', icon: 'info', title: 'No comments here', message: `${f.label} files have no comment mark Code knows.`, timeout: 2600 }); return; }
      applyEdit(E.toggleComment(ta.value, s, e, f.lang));
    }
    function cmdDuplicate(down) { if (!current()) return; const [s, e] = sel(); applyEdit(E.duplicateLines(ta.value, s, e, down)); }
    function cmdIndent(out) { if (!current()) return; const [s, e] = sel(); applyEdit(out ? E.outdentLines(ta.value, s, e, unit()) : E.indentLines(ta.value, s, e, unit())); }

    /* which formatter a file gets */
    const fmtLang = f => {
      const ext = vfs.extOf(f.name);
      return ext === 'html' || ext === 'htm' ? 'html' : ext === 'css' ? 'css' : ext === 'js' || ext === 'mjs' ? 'js' : ext === 'json' ? 'json' : null;
    };
    async function cmdFormat() {
      const f = current();
      if (!f) return;
      const lang = fmtLang(f);
      if (!lang) { api.notify({ app: 'Code', icon: 'info', title: 'Format isn’t available here', message: 'Format works on HTML, CSS, JavaScript and JSON files.', timeout: 3200 }); return; }
      const text = f.text, path = f.path;
      const F = await import('../core/codefmt.js');
      const r = await F.format(text, lang, { unit: unit(f) });
      if (S.dead) return;
      const now = current();
      if (!now || now.path !== path || now.text !== text) { api.notify({ app: 'Code', icon: 'alert', title: 'Not formatted', message: 'The file changed while it was being formatted. Press Format again.', timeout: 3200 }); return; }
      if (!r.ok) { api.notify({ app: 'Code', icon: 'alert', title: 'Couldn’t format', message: r.error, timeout: 5200 }); return; }
      if (r.text === text) { api.notify({ app: 'Code', icon: 'check', title: 'Already tidy', message: `${f.name} is laid out the way Format would.`, timeout: 2400 }); return; }
      const line = caret().line;
      applyEdit({ from: 0, to: ta.value.length, insert: r.text, selStart: 0, selEnd: 0 });
      caretTo(Math.min(line, r.text.split('\n').length));
      api.notify({ app: 'Code', icon: 'check', title: 'Formatted', message: `${f.name} is laid out again. Undo (${fmt.modLabel}Z) puts it back.`, timeout: 3200 });
    }
    function cmdFixSpaces() {
      const f = current();
      if (!f) return;
      const r = E.fixWhitespace(ta.value, { unit: unit(f), md: f.lang === 'md' });
      if (!r.changed) { api.notify({ app: 'Code', icon: 'check', title: 'Nothing to fix', message: `${f.name} has no stray tabs or trailing spaces.`, timeout: 2400 }); return; }
      const line = caret().line;
      applyEdit({ from: 0, to: ta.value.length, insert: r.text, selStart: 0, selEnd: 0 });
      caretTo(Math.min(line, r.text.split('\n').length));
      api.notify({ app: 'Code', icon: 'check', title: `Tidied ${r.changed} line${r.changed === 1 ? '' : 's'}`, message: `${f.tabs ? 'Indents are tabs' : `Indents are ${f.indent} spaces`}, and the spaces at line ends are gone. Undo puts it back.`, timeout: 3600 });
    }

    /* ---------------- go to a line ---------------- */
    function openGoto() {
      if (!current()) return;
      gotoOf.textContent = `of ${ta.value.split('\n').length}`;
      gotoIn.value = '';
      gotoBox.hidden = false;
      gotoIn.focus();
    }
    function goFromBox() {
      const m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(gotoIn.value);
      if (!m) { gotoIn.select(); return; }
      gotoBox.hidden = true;
      caretTo(Math.max(1, Math.min(Number(m[1]), ta.value.split('\n').length)), m[2] ? Number(m[2]) : 1);
    }
    gotoIn.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); gotoBox.hidden = true; ta.focus(); } });
    gotoIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== gotoIn) gotoBox.hidden = true; }, 150));

    /* ================= suggestions as you type ================= */
    const KIND = { kw: 'keyword', fn: 'function', prop: 'property', tag: 'tag', attr: 'attribute', value: 'value', word: 'in this file', mod: 'module' };
    const suggestLang = f => {
      const ext = vfs.extOf(f.name);
      return /^(html?|svg)$/.test(ext) ? 'html' : ext === 'css' ? 'css' : /^(m?js|ts)$/.test(ext) ? 'js' : ext === 'py' ? 'py' : null;
    };
    function openSuggest(manual = false) {
      const f = current();
      const lang = f && suggestLang(f);
      if (!lang || (!S.ed.suggest && !manual) || ta.selectionStart !== ta.selectionEnd || ta.value.length > MAX_HL) { closeSuggest(); return; }
      const pos = ta.selectionStart;
      const r = suggest(ta.value, pos, lang, { manual });
      if (!r) { closeSuggest(); return; }
      S.cm = { items: r.items, i: 0, from: r.from, to: pos };
      paintSuggest();
    }
    function paintSuggest() {
      const cm = S.cm;
      clear(cmList);
      const pre = ta.value.slice(cm.from, cm.to).toLowerCase();
      cm.items.forEach((it, i) => {
        const k = pre && it.label.toLowerCase().startsWith(pre) ? pre.length : 0;
        cmList.append(h('div.ccm__item', {
          role: 'option', id: `${win.id}-cm-${i}`, 'aria-selected': String(i === cm.i), class: i === cm.i ? 'is-on' : null,
          onpointerdown: e => { e.preventDefault(); acceptSuggest(i); },
        }, h('span.ccm__label', h('b', { text: it.label.slice(0, k) }), it.label.slice(k)), h('small', { text: KIND[it.kind] || it.kind })));
      });
      cmList.hidden = false;
      ta.setAttribute('aria-activedescendant', `${win.id}-cm-${cm.i}`);
      placeSuggest();
    }
    /** Where character i is drawn: the highlight layer lays the text out exactly as the textarea does. */
    function charRect(i) {
      const v = ta.value;
      if (i < 0 || i >= v.length || v[i] === '\n') return null;
      let at = [null, 0];
      if (S.ed.wrap) {
        const before = v.slice(0, i);
        const row = layer.children[before.split('\n').length - 1];
        if (row) at = textAt(row, i - (before.lastIndexOf('\n') + 1));
      } else at = textAt(layer, i);
      const [node, off] = at;
      if (!node) return null;
      const r = document.createRange();
      r.setStart(node, off);
      r.setEnd(node, off + 1);
      const rects = r.getClientRects();
      return rects.length ? rects[0] : null;
    }
    function textAt(root, k) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) { const len = n.nodeValue.length; if (k < len) return [n, k]; k -= len; }
      return [null, 0];
    }
    function placeSuggest() {
      const box = edWrap.getBoundingClientRect();
      let x, y, top;
      const here = charRect(S.cm.from), prev = here ? null : charRect(S.cm.from - 1);
      if (here) { x = here.left - box.left; y = here.bottom - box.top; top = here.top - box.top; }
      else if (prev) { x = prev.right - box.left; y = prev.bottom - box.top; top = prev.top - box.top; }
      else {
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
        const line = caret().line;
        top = lineTop(line) - ta.scrollTop + (parseFloat(getComputedStyle(ta).paddingTop) || 0);
        y = top + lh;
        x = parseFloat(getComputedStyle(ta).paddingLeft) || 0;
      }
      const w = cmList.offsetWidth || 220, hh = cmList.offsetHeight || 160;
      cmList.style.left = `${Math.max(4, Math.min(box.width - w - 4, x))}px`;
      const yy = y + hh + 4 > box.height && top - hh - 2 > 0 ? top - hh - 2 : y + 2;
      cmList.style.top = `${Math.max(2, Math.min(Math.max(2, box.height - hh - 2), yy))}px`;
    }
    function acceptSuggest(i = S.cm?.i) {
      const cm = S.cm;
      const it = cm && cm.items[i];
      if (!it) return;
      const to = ta.selectionStart;
      closeSuggest();
      applyEdit({ from: cm.from, to, insert: it.insert, selStart: cm.from + it.caret, selEnd: cm.from + it.caret });
      if (it.then) openSuggest(true);
    }
    function closeSuggest() {
      if (!S.cm && cmList.hidden) return;
      S.cm = null;
      cmList.hidden = true;
      clear(cmList);
      ta.removeAttribute('aria-activedescendant');
    }
    function moveSuggest(d) {
      const cm = S.cm;
      const n = cm.items.length;
      cm.i = Math.abs(d) > 1 ? Math.max(0, Math.min(n - 1, cm.i + d)) : (cm.i + d + n) % n;
      paintSuggest();
      cmList.children[cm.i]?.scrollIntoView({ block: 'nearest' });
    }

    /* ================= the sidebar: files, search, snippets ================= */
    function setSide(id) {
      S.side = id;
      for (const b of sideTabs.children) { const on = b.dataset.side === id; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); }
      paintSide();
      if (id === 'search') { searchIn.focus(); searchIn.select(); }
    }
    function paintSide() {
      if (S.side === 'files') { paintTree(); return; }
      clear(sideBody);
      if (S.side === 'search') { sideBody.append(searchForm); doSearch(); }
      else paintSnips();
    }

    const inProjects = path => !!path && path.startsWith(`${PROJ}/`);
    /** The project a file belongs to: its top folder in ~/Projects (else its own folder). */
    function projectOf(path) {
      if (path && path.startsWith(`${PROJ}/`)) {
        const rest = path.slice(PROJ.length + 1);
        const i = rest.indexOf('/');
        if (i > 0) return `${PROJ}/${rest.slice(0, i)}`;
        return PROJ;
      }
      return path ? vfs.parentPath(path) : PROJ;
    }
    const TEXT_FILE = /\.(py|txt|json|csv|tsv|md|markdown|html?|css|m?js|ts|xml|ya?ml|toml|ini|cfg|conf|log|svg|sql|frag|glsl|vert|sh|c|h|rs)$/i;
    /** Every text file under dir (paths), at most `max`. ~/Projects itself is searched whole only when asked. */
    function textFiles(dir, deep, max = 800) {
      const out = [];
      const walk = (d, depth) => {
        for (const n of vfs.ls(d)) {
          if (out.length >= max) return;
          const p = `${d}/${n.name}`;
          if (n.type === 'dir') { if (depth < deep) walk(p, depth + 1); continue; }
          if (TEXT_FILE.test(n.name) && !media.isMedia(n)) out.push(p);
        }
      };
      walk(dir, 0);
      return out;
    }

    const searchIn = h('input', {
      type: 'search', placeholder: 'Search the project…', 'aria-label': 'Search in the project’s files', spellcheck: 'false',
      oninput: () => { clearTimeout(S.search.t); S.search.t = setTimeout(doSearch, 180); },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } },
    });
    const searchScope = h('select.cfx__scope', { 'aria-label': 'Where to search', onchange: () => doSearch() },
      h('option', { value: 'project', text: 'This project' }), h('option', { value: 'all', text: 'All of ~/Projects' }));
    const searchCase = h('input', { type: 'checkbox', 'aria-label': 'Match case', onchange: () => doSearch() });
    const searchOut = h('div.csr', { role: 'list', 'aria-label': 'Matches' });
    const searchForm = h('div.cfx__search',
      h('label.field', icon('search'), searchIn),
      h('div.cfx__opts', searchScope, h('label.cfx__case', { title: 'Match case' }, searchCase, h('span', { text: 'Aa' }))),
      searchOut);

    function doSearch() {
      clearTimeout(S.search.t);
      const q = searchIn.value;
      clear(searchOut);
      if (!q) { searchOut.append(h('small.dim', { text: 'Type to search every file of the project, unsaved changes included.' })); return; }
      const f = current();
      const all = searchScope.value === 'all' || !f;
      const dir = all ? PROJ : projectOf(f.path);
      const files = textFiles(dir, dir === PROJ && !all ? 0 : 8);
      const cased = searchCase.checked;
      const needle = cased ? q : q.toLowerCase();
      const MAXHITS = 500;
      let total = 0, inFiles = 0;
      for (const p of files) {
        if (total >= MAXHITS) break;
        const text = textOf(p) ?? '';
        const hay = cased ? text : text.toLowerCase();
        let i = hay.indexOf(needle);
        if (i < 0) continue;
        inFiles++;
        const hits = [];
        while (i >= 0 && total < MAXHITS) { hits.push(i); total++; i = hay.indexOf(needle, i + needle.length); }
        const rel = p.slice(dir.length + 1);
        const group = h('div.csr__file', { role: 'listitem' },
          h('button.csr__name', { type: 'button', title: p.replace(vfs.HOME, '~'), onclick: () => openPath(p) },
            icon(vfs.iconFor({ type: 'file', kind: vfs.kindOf(p) }), { size: 12 }), h('b', { text: vfs.baseName(p) }),
            rel.includes('/') ? h('small', { text: rel.slice(0, rel.lastIndexOf('/')) }) : null, h('span.csr__n', { text: String(hits.length) })));
        let line = 1, from = 0;
        for (const at of hits.slice(0, 60)) {
          for (let k = from; k < at; k++) if (text.charCodeAt(k) === 10) line++;
          from = at;
          const ls = text.lastIndexOf('\n', at - 1) + 1;
          let le = text.indexOf('\n', at);
          if (le < 0) le = text.length;
          const start = Math.max(ls, at - 28);
          const ln = line;
          group.append(h('button.csr__hit', { type: 'button', 'data-line': String(ln), onclick: () => { openPath(p); selectAt(at, q.length); } },
            h('span.csr__ln', { text: String(ln) }),
            h('span.csr__tx', (start > ls ? '…' : '') + text.slice(start, at).trimStart(), h('mark', { text: text.slice(at, at + q.length) }), text.slice(at + q.length, Math.min(le, at + q.length + 60)))));
        }
        if (hits.length > 60) group.append(h('small.dim.csr__more', { text: `and ${hits.length - 60} more in this file` }));
        searchOut.append(group);
      }
      searchOut.prepend(h('small.dim.csr__sum', { role: 'status', text: total ? `${total >= MAXHITS ? `The first ${MAXHITS}` : total} match${total === 1 ? '' : 'es'} in ${inFiles} file${inFiles === 1 ? '' : 's'}` : `No matches in ${files.length} file${files.length === 1 ? '' : 's'}` }));
    }

    function paintSnips() {
      clear(sideBody);
      const f = current();
      if (!f) { sideBody.append(h('small.dim', { text: 'Open a file to see snippets for its language.' })); return; }
      const list = Snips.forLang(f.lang);
      sideBody.append(h('div.side__label', { text: `Snippets · ${f.label}` }));
      if (!list.length) sideBody.append(h('small.dim', { text: `No snippets for ${f.label} files yet. Select some code and save it as one.` }));
      const box = h('div.csn__list');
      for (const sn of list) {
        box.append(h('div.csn',
          h('button.csn__use', { type: 'button', 'data-snip': sn.name, title: `Put “${sn.name}” in at the caret`, onclick: () => insertSnippet(sn) },
            h('b', { text: sn.name }), h('small.mono', { text: sn.body.replace('$0', '').split('\n')[0].trim() || '…' })),
          sn.mine ? h('button.ibtn.tip', { 'data-tip': 'Delete this snippet', 'aria-label': `Delete the snippet ${sn.name}`, onclick: () => { Snips.remove(sn.id); paintSnips(); } }, icon('trash')) : null));
      }
      sideBody.append(box, h('button.btn.btn--sm.cfx__savesnip', { type: 'button', 'data-act': 'save-snippet', onclick: () => saveSnippet() }, icon('plus'), h('span', { text: 'Save the selection as a snippet' })));
    }
    function insertSnippet(sn) {
      if (!current()) return;
      const [s, e] = sel();
      const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
      const indent = (ta.value.slice(ls, s).match(/^[ \t]*/) || [''])[0];
      const { text, caret: c } = Snips.place(sn.body, indent);
      applyEdit({ from: s, to: e, insert: text, selStart: s + c, selEnd: s + c });
    }
    async function saveSnippet() {
      const f = current();
      if (!f) return;
      const body = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (!body.trim()) { api.notify({ app: 'Code', icon: 'info', title: 'Select some code first', message: 'Select the lines you want to keep, then press Save the selection as a snippet.', timeout: 3200 }); return; }
      const name = await askName({ title: 'Save as a snippet', message: `It shows in Snippets for ${f.label} files.`, value: body.trim().split('\n')[0].slice(0, 30), ok: 'Save', check: v => (v ? '' : 'Give the snippet a name.') });
      if (!name) return;
      const r = Snips.add({ name, lang: f.lang, body });
      if (!r.ok) { api.notify({ app: 'Code', icon: 'alert', title: 'Not saved', message: r.error, timeout: 3600 }); return; }
      if (S.side === 'snips') paintSnips();
      api.notify({ app: 'Code', icon: 'check', title: 'Snippet saved', message: `“${r.snip.name}” is in Snippets.`, timeout: 2600 });
    }

    /* ================= files and folders in the tree ================= */
    /** Where a new file goes: the open file's folder when it is in ~/Projects, else ~/Projects. */
    function targetDir() {
      const f = current();
      const d = f ? vfs.parentPath(f.path) : PROJ;
      return d === PROJ || d.startsWith(`${PROJ}/`) ? d : PROJ;
    }
    function nameIssue(dir, name, self = null) {
      if (!name) return 'Type a name.';
      if (/[/\\]/.test(name)) return 'A name can’t have / or \\ in it.';
      if (name === '.' || name === '..') return 'That name isn’t allowed.';
      if (/[\u0000-\u001f\u007f]/.test(name)) return 'That name has a character a file can’t have.';
      if (name.length > 80) return 'Keep the name under 80 characters.';
      if (name !== self && vfs.node(`${dir}/${name}`)) return `There’s already a “${name}” in ${vfs.baseName(dir)}.`;
      return '';
    }
    function askName({ title, message = '', value = '', ok = 'Create', check }) {
      const input = h('input.cfx__name', { type: 'text', value, 'aria-label': 'Name', spellcheck: 'false', autocomplete: 'off', 'data-act': 'name-input' });
      setTimeout(() => { input.focus(); const dot = value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : value.length); }, 40);
      return api.confirm({ title, message, ok, body: h('label.field', icon('edit-3'), input), validate: () => check(input.value.trim()), collect: () => input.value.trim() })
        .then(v => (typeof v === 'string' && v ? v : null));
    }
    async function newFile(dir) {
      const f = current();
      const ext = f ? vfs.extOf(f.name) : '';
      const name = await askName({ title: 'New file', message: `In ${dir.replace(vfs.HOME, '~')}`, value: `untitled.${ext || 'txt'}`, check: v => nameIssue(dir, v) });
      if (!name || S.dead) return;
      const p = `${dir}/${name}`;
      if (!vfs.touch(p, '')) { api.notify({ app: 'Code', icon: 'alert', title: 'Couldn’t make the file', message: `${dir.replace(vfs.HOME, '~')} can’t be written to.` }); return; }
      S.folds.add(dir);
      openPath(p);
    }
    async function newFolder(dir) {
      const name = await askName({ title: 'New folder', message: `In ${dir.replace(vfs.HOME, '~')}`, value: 'new-folder', check: v => nameIssue(dir, v) });
      if (!name || S.dead) return;
      const p = `${dir}/${name}`;
      if (!vfs.mkdir(p)) { api.notify({ app: 'Code', icon: 'alert', title: 'Couldn’t make the folder', message: `${dir.replace(vfs.HOME, '~')} can’t be written to.` }); return; }
      S.folds.add(dir); S.folds.add(p);
      paintTree();
    }
    async function renamePath(p) {
      const n = vfs.node(p);
      if (!n) return;
      const dir = vfs.parentPath(p), old = n.name;
      const name = await askName({ title: `Rename ${n.type === 'dir' ? 'folder' : 'file'}`, value: old, ok: 'Rename', check: v => nameIssue(dir, v, old) });
      if (!name || name === old || S.dead) return;
      if (!vfs.rename(p, name)) { api.notify({ app: 'Code', icon: 'alert', title: 'Couldn’t rename it', message: `“${name}” is taken.` }); return; }
      const to = `${dir}/${name}`;
      const move = x => (x === p ? to : x && x.startsWith(`${p}/`) ? to + x.slice(p.length) : x);
      for (const f of S.open) {
        const np = move(f.path);
        if (np === f.path) continue;
        f.path = np;
        f.name = vfs.baseName(np);
        [f.label, f.lang] = LANGS[vfs.extOf(f.name)] || ['Plain Text', null];
      }
      S.back = S.back.map(move); S.fwd = S.fwd.map(move);
      S.folds = new Set([...S.folds].map(move));
      if (S.pv.page) S.pv.page = move(S.pv.page);
      /* a project's history goes with its folder */
      if (n.type === 'dir' && dir === PROJ) Hist.move(p, to);
      const f = current();
      if (f) { const top = ta.scrollTop, s = ta.selectionStart, e = ta.selectionEnd; swap(); ta.setSelectionRange(s, e); ta.scrollTop = top; syncScroll(); }
      else paintTree();
    }
    async function deletePath(p) {
      const n = vfs.node(p);
      if (!n || p === PROJ) return;
      const under = x => x === p || x.startsWith(`${p}/`);
      const dirty = S.open.filter(f => under(f.path) && f.dirty).length;
      const dir = n.type === 'dir';
      const ok = await api.confirm({
        title: `Move “${n.name}” to the Trash?`, ok: 'Move to Trash', danger: true,
        message: `${dir ? 'The folder and everything in it go' : 'It goes'} to the Trash, where you can put ${dir ? 'them' : 'it'} back.${dirty ? ` ${dirty} open file${dirty === 1 ? ' has' : 's have'} unsaved changes, which will be lost.` : ''}`,
      });
      if (!ok || S.dead) return;
      const r = fsops.trash([p]);
      if (!r.done) { api.notify({ app: 'Code', icon: 'alert', title: 'Couldn’t move it to the Trash', message: n.name }); return; }
      const cur = current();
      S.open = S.open.filter(f => !under(f.path));
      S.back = S.back.filter(x => !under(x)); S.fwd = S.fwd.filter(x => !under(x));
      const at = cur ? S.open.indexOf(cur) : -1;
      S.cur = at >= 0 ? at : S.open.length ? 0 : -1;
      if (S.pv.page && under(S.pv.page)) S.pv.page = null;
      swap();
      api.notify({ app: 'Code', icon: 'trash', title: 'Moved to the Trash', message: `${n.name} — Files › Trash can put it back.`, timeout: 3600 });
    }
    function treeMenu(n, p, x, y) {
      const isDir = n.type === 'dir';
      api.menu([
        ...(isDir
          ? [{ label: 'New file…', icon: 'file', onClick: () => newFile(p) }, { label: 'New folder…', icon: 'folder', onClick: () => newFolder(p) }]
          : [{ label: 'Open', icon: 'file-code', onClick: () => openPath(p) }]),
        ...(p === PROJ ? [] : ['-',
          { label: 'Rename…', icon: 'edit-3', onClick: () => renamePath(p) },
          { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => deletePath(p) }]),
      ], x, y, { label: n.name });
    }

    /* ================= version history ================= */
    /** The project's text files as they are on disk (not the editor's unsaved text). */
    const diskFiles = dir => collect(dir, null, 300, 5 * 1024 * 1024, p => vfs.read(p)).files;
    /** After a save: keep a version (and, the first time, how it was before). */
    function keepVersion(dir, before, file) {
      const after = diskFiles(dir);
      Promise.resolve(before)
        .then(b => (b && b.length ? Hist.record(dir, b, { reason: 'first' }) : null))
        .then(() => Hist.record(dir, after, { reason: 'save', file }))
        .catch(() => { /* history is a help, never in the way of saving */ });
    }
    function closePanel() {
      const p = S.panel;
      if (!p) return;
      p.dispose?.();
      p.el.remove();
      S.panel = null;
    }
    function openHistory() {
      const f = current();
      if (!f) { api.notify({ app: 'Code', icon: 'info', title: 'Open a file first', message: 'Version history is kept for the project the open file belongs to.', timeout: 3000 }); return; }
      if (!inProjects(f.path)) { api.notify({ app: 'Code', icon: 'info', title: 'Version history is for projects', message: `Code keeps versions of projects in ~/Projects. ${f.name} is in ${vfs.parentPath(f.path).replace(vfs.HOME, '~')}.`, timeout: 4200 }); return; }
      const dir = projectOf(f.path);
      closePanel();
      closeShared();
      const panel = historyPanel({
        h, icon, clear, render, dir, title: dir.replace(vfs.HOME, '~'),
        now: () => collect(dir).files,
        save: () => {
          const input = h('input.cfx__name', { type: 'text', 'aria-label': 'A name for this version (it can stay empty)', placeholder: 'A name (it can stay empty)', spellcheck: 'false', autocomplete: 'off', maxlength: '60', 'data-act': 'name-input' });
          setTimeout(() => input.focus(), 40);
          return api.confirm({ title: 'Save a version', message: 'Keeps how every file of the project looks now, unsaved changes included.', ok: 'Save', body: h('label.field', icon('edit-3'), input) })
            .then(ok => (ok ? Hist.record(dir, collect(dir).files, { reason: 'manual', name: input.value.trim() }) : null))
            .catch(() => null);
        },
        restoreFile: (rel, text) => restoreFile(dir, rel, text),
        restoreAll: files => restoreAll(dir, files),
        onClose: () => closePanel(),
      });
      S.panel = panel;
      appEl.appendChild(panel.el);
    }
    /** Make every folder down to dir (inside ~/Projects). */
    function mkdirs(dir) {
      if (vfs.node(dir)) return true;
      if (!dir.startsWith(`${PROJ}/`)) return false;
      let at = PROJ;
      for (const part of dir.slice(PROJ.length + 1).split('/')) { at = `${at}/${part}`; if (!vfs.node(at) && !vfs.mkdir(at)) return false; }
      return true;
    }
    /* an open file now holds this text, as saved */
    function reloadOpen(f, text) {
      f.text = text;
      f.dirty = false;
      if (f === current()) { const top = ta.scrollTop; ta.value = text; S.lines = -1; highlight(); ta.scrollTop = top; syncScroll(); paintGutter(); paintFoot(); }
    }
    async function restoreFile(dir, rel, text) {
      const p = `${dir}/${rel}`;
      const ok = await api.confirm({ title: `Restore ${rel}?`, message: 'It goes back to how it was in this version. Code first keeps a version of how things are now, so you can come back.', ok: 'Restore' });
      if (!ok || S.dead) return false;
      await Hist.record(dir, collect(dir).files, { reason: 'restore' });
      if (!mkdirs(vfs.parentPath(p))) return false;
      vfs.write(p, text);
      const f = S.open.find(x => x.path === p);
      if (f) reloadOpen(f, text);
      paintTabs(); paintTree();
      if (S.pv.on) refresh(true);
      api.notify({ app: 'Code', icon: 'undo', title: `Restored ${rel}`, message: 'The version before the restore is kept in the history.', timeout: 3600 });
      return true;
    }
    async function restoreAll(dir, files) {
      const ok = await api.confirm({ title: 'Restore the whole project?', message: 'Every file goes back to how it was in this version, and files made since go to the Trash. Code first keeps a version of how things are now, so you can come back.', ok: 'Restore' });
      if (!ok || S.dead) return false;
      await Hist.record(dir, collect(dir).files, { reason: 'restore' });
      const keep = new Map(files.map(f => [f.path, f.text]));
      for (const [rel, text] of keep) { const p = `${dir}/${rel}`; if (mkdirs(vfs.parentPath(p))) vfs.write(p, text); }
      const extra = collect(dir).files.map(f => f.path).filter(rel => !keep.has(rel)).map(rel => `${dir}/${rel}`);
      if (extra.length) fsops.trash(extra);
      const cur = current();
      for (const f of S.open) if (f.path.startsWith(`${dir}/`) && keep.has(f.path.slice(dir.length + 1))) reloadOpen(f, keep.get(f.path.slice(dir.length + 1)));
      S.open = S.open.filter(f => !extra.includes(f.path));
      const at = cur ? S.open.indexOf(cur) : -1;
      S.cur = at >= 0 ? at : S.open.length ? 0 : -1;
      swap();
      api.notify({ app: 'Code', icon: 'undo', title: 'Restored the project', message: `${keep.size} file${keep.size === 1 ? '' : 's'} put back${extra.length ? `, ${extra.length} newer moved to the Trash` : ''}. The version before the restore is kept in the history.`, timeout: 4200 });
      return true;
    }

    /* ================= a project as a .zip ================= */
    function saveToComputer(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name, hidden: true, rel: 'noopener' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function downloadZip() {
      const f = current();
      if (!f) { api.notify({ app: 'Code', icon: 'info', title: 'Open a file first', message: 'Download as a .zip takes the project the open file belongs to.', timeout: 3000 }); return; }
      const dir = projectOf(f.path);
      /* a file outside a project folder goes alone */
      const one = dir === PROJ || !inProjects(f.path);
      const name = one ? f.name.replace(/\.[^.]+$/, '') || f.name : vfs.baseName(dir);
      const enc = new TextEncoder();
      const items = [], skipped = [];
      const when = n => { const d = new Date(n.mtime || Date.now()); return Number.isNaN(d.getTime()) ? new Date() : d; };
      const add = (n, p, rel) => {
        if (n.type === 'dir') {
          items.push({ name: `${rel}/`, dir: true, date: when(n) });
          for (const c of n.children) add(c, `${p}/${c.name}`, `${rel}/${c.name}`);
          return;
        }
        const isMedia = media.isMedia(n);
        const text = isMedia ? null : textOf(p);
        if (!isMedia && !text && (n.size || 0) > 0) { skipped.push(rel); return; }
        items.push({
          name: rel, date: when(n), size: n.size || 0,
          read: async () => {
            if (!isMedia) return enc.encode(textOf(p) || '');
            let b = null;
            try { b = await media.blobOf(n); } catch (e) { b = null; }
            if (!b) throw new Z.ZipError('skip', 'Its bytes couldn’t be read in this browser.');
            return b;
          },
        });
      };
      if (one) add(vfs.node(f.path), f.path, f.name);
      else add(vfs.node(dir), dir, name);
      let made;
      try { made = await Z.makeZip(items); } catch (e) { api.notify({ app: 'Code', icon: 'alert', title: 'Couldn’t make the .zip', message: e.message || String(e) }); return; }
      if (S.dead) return;
      saveToComputer(made.blob, `${name}.zip`);
      const left = [...skipped, ...made.skipped.map(x => x.name || x)];
      const nfiles = made.count - items.filter(i => i.dir).length;
      api.notify({ app: 'Code', icon: 'download', title: `Downloading ${name}.zip`, message: `${nfiles} file${nfiles === 1 ? '' : 's'} · ${fmt.fmtBytes(made.blob.size)}${left.length ? ` · left out (no content in this browser): ${left.slice(0, 3).join(', ')}` : ''}`, timeout: 4200 });
    }
    /** Text a zip entry holds, or null when it is something else (a picture, a font…). */
    function asText(name, bytes) {
      if (bytes.length > 512 * 1024) return null;
      if (!TEXTISH.test(name) && /\.[^./]+$/.test(name)) return null;
      try {
        const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return t.includes('\u0000') ? null : t.replace(/^﻿/, '');
      } catch (e) { return null; }
    }
    async function openZip(file) {
      let z;
      try { z = await Z.readZip(file); }
      catch (e) { api.notify({ app: 'Code', icon: 'alert', title: `Couldn’t open ${file.name}`, message: e.message || String(e), timeout: 5000 }); return; }
      if (S.dead) return;
      const junk = e => e.parts[0] === '__MACOSX' || e.parts[e.parts.length - 1] === '.DS_Store';
      const entries = z.entries.filter(e => !e.problem && e.parts && e.parts.length && !junk(e));
      const skipped = z.entries.filter(e => e.problem).map(e => `${e.name} (${e.problem})`);
      if (!entries.some(e => !e.dir)) { api.notify({ app: 'Code', icon: 'alert', title: 'Nothing to open', message: skipped.length ? `None of it could be unpacked: ${skipped.slice(0, 2).join('; ')}` : `${file.name} has no files in it.`, timeout: 5000 }); return; }
      /* one folder holding everything: that folder is the project */
      const tops = new Set(entries.map(e => e.parts[0]));
      const wrapped = tops.size === 1 && entries.every(e => e.parts.length > 1 || e.dir);
      const base = Share.folderName(wrapped ? [...tops][0] : file.name.replace(/\.zip$/i, '')) || 'project';
      let pname = base;
      for (let n = 2; vfs.node(`${PROJ}/${pname}`); n++) pname = `${base}-${n}`;
      const dir = `${PROJ}/${pname}`;
      if (!mkdirs(dir)) { api.notify({ app: 'Code', icon: 'alert', title: 'Couldn’t make the project', message: `${PROJ} is not a folder.` }); return; }
      const TEXT_ROOM = 1_000_000;           /* characters of editable text one .zip may bring in */
      let chars = 0, texts = 0;
      const blobs = new Map();
      for (const e of entries) {
        const parts = wrapped ? e.parts.slice(1) : e.parts;
        if (!parts.length) continue;
        const target = `${dir}/${parts.join('/')}`;
        if (e.dir) { mkdirs(target); continue; }
        if (!mkdirs(vfs.parentPath(target))) { skipped.push(`${parts.join('/')} (its folder couldn’t be made)`); continue; }
        let bytes;
        try { bytes = await Z.entryBytes(file, e); } catch (err) { skipped.push(`${parts.join('/')} (${err.message || err})`); continue; }
        const leaf = parts[parts.length - 1];
        const text = asText(leaf, bytes);
        if (text !== null && chars + text.length <= TEXT_ROOM) { vfs.write(target, text); chars += text.length; texts++; }
        else if (text !== null) skipped.push(`${parts.join('/')} (more text than this browser keeps editable at once)`);
        else {
          const d = vfs.parentPath(target);
          if (!blobs.has(d)) blobs.set(d, []);
          blobs.get(d).push(new File([bytes], leaf));
        }
      }
      let kept = 0;
      for (const [d, list] of blobs) {
        const res = await fileimport.importFiles(d, list);
        for (const r of res) { if (r.ok) kept++; else skipped.push(`${r.name} (${r.why})`); }
      }
      if (S.dead) return;
      S.folds.add(PROJ); S.folds.add(dir);
      const found = textFiles(dir, 6);
      const open = found.find(p => /\/index\.html?$/i.test(p)) || found.find(p => /\/main\.py$/i.test(p)) || found.find(p => /readme\.md$/i.test(p)) || found[0];
      if (open) openPath(open); else paintTree();
      api.notify({ app: 'Code', icon: 'package', title: `Opened ${file.name}`, message: `As ~/Projects/${pname}: ${texts} text file${texts === 1 ? '' : 's'}${kept ? ` and ${kept} other file${kept === 1 ? '' : 's'}` : ''}.${skipped.length ? ` Left out: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''}.` : ''}`, timeout: 6000 });
    }

    /* ================= try web APIs ================= */
    async function openApiTool() {
      closePanel();
      closeShared();
      const { apiPanel } = await import('../core/codeapi.js');
      if (S.dead) return;
      const pnl = apiPanel({ h, icon, clear, render, insert: code => insertCode(code), copy: text => copyText(text) });
      const wrap = h('section.csh.cap-wrap', { role: 'region', 'aria-label': 'Try web APIs' },
        h('header.chs__head', icon('send'), h('div.chs__titles', h('b', { text: 'Try web APIs' }), h('small.dim', { text: 'A simple request tool: straight from your browser, only to sites that allow it' })), h('div.grow'),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', 'data-act': 'api-close', onclick: () => closePanel() }, icon('x'), h('span', { text: 'Close' }))),
        pnl.el);
      S.panel = { el: wrap, dispose: () => pnl.dispose() };
      appEl.appendChild(wrap);
      pnl.focus();
    }
    function insertCode(code) {
      const f = current();
      if (f && f.lang === 'js' && /\.(m?js|ts)$/i.test(f.name)) {
        closePanel();
        const [s, e] = sel();
        applyEdit({ from: s, to: e, insert: code, selStart: s + code.length, selEnd: s + code.length });
        api.notify({ app: 'Code', icon: 'code', title: 'Added to the file', message: `The request is in ${f.name} as fetch(). It runs when the page does.`, timeout: 3200 });
      } else copyText(code, 'The fetch() code is copied: paste it into a JavaScript file.');
    }
    function copyText(text, message = 'Copied.') {
      const done = ok => api.notify({ app: 'Code', icon: ok ? 'copy' : 'alert', title: ok ? 'Copied' : 'Couldn’t copy', message: ok ? message : 'The browser didn’t allow it.', timeout: 2600 });
      try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch (e) { done(false); }
    }

    /* ================= SQL and the console's input line ================= */
    function runSql(f) {
      setPreview(true);
      const mine = f === current();
      const [s, e] = sel();
      const part = mine && e > s && ta.value.slice(s, e).trim() ? ta.value.slice(s, e) : f.text;
      const line = part === f.text ? 0 : ta.value.slice(0, s).split('\n').length - 1;
      sqlP.show(f, n => { openPath(f.path); gotoLine(n); });
      sqlP.run(part, { line });
    }
    function evalKey(e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!S.hist.length) return;
      e.preventDefault();
      S.histAt = Math.max(0, Math.min(S.hist.length, S.histAt + (e.key === 'ArrowUp' ? -1 : 1)));
      evalIn.value = S.hist[S.histAt] ?? '';
    }
    /** The console's input line: the code runs inside the sealed preview page (core/sandbox.js), not here. */
    async function runEval() {
      const code = evalIn.value.trim();
      if (!code) return;
      S.hist = [...S.hist.filter(x => x !== code), code].slice(-50);
      S.histAt = S.hist.length;
      evalIn.value = '';
      const sb = S.pv.sb;
      if (!sb || S.mode !== 'web') { log('system', 'Nothing is running in the preview yet: open an HTML or JavaScript file and it starts.'); return; }
      log('input', code);
      const r = await sb.evaluate(code);
      if (S.dead) return;
      log(r.ok ? 'result' : 'error', r.text);
    }

    /* ================= the editor's look ================= */
    function applyEditorLook() {
      const e = S.ed;
      editor.style.fontSize = e.size ? `${e.size}px` : '';
      const dark = e.theme === 'dark' || (e.theme === 'auto' && document.documentElement.dataset.theme !== 'light');
      editor.classList.toggle('code--light', !dark);
      editor.classList.toggle('code--dark', dark && e.theme === 'dark');
      editor.classList.toggle('is-wrap', e.wrap);
      ta.wrap = e.wrap ? 'soft' : 'off';
    }
    function setEd(patch) {
      S.ed = { ...S.ed, ...patch };
      setPref(patch);
      applyEditorLook();
      closeSuggest();
      S.lines = -1;
      highlight(); paintGutter(); paintFoot();
    }
    function editorMenu(btn) {
      const r = btn.getBoundingClientRect();
      const px = Math.round(parseFloat(getComputedStyle(editor).fontSize) || 11);
      api.menu([
        { header: true, label: `Text size · ${px} px` },
        { label: 'Bigger', icon: 'zoom-in', disabled: px >= 28, onClick: () => setEd({ size: Math.min(28, px + 1) }) },
        { label: 'Smaller', icon: 'zoom-out', disabled: px <= 9, onClick: () => setEd({ size: Math.max(9, px - 1) }) },
        { label: 'Usual size', icon: 'type', disabled: !S.ed.size, onClick: () => setEd({ size: null }) },
        '-',
        { header: true, label: 'Editor colours' },
        { label: 'Match StaticOS', checked: S.ed.theme === 'auto', onClick: () => setEd({ theme: 'auto' }) },
        { label: 'Dark', checked: S.ed.theme === 'dark', onClick: () => setEd({ theme: 'dark' }) },
        { label: 'Light', checked: S.ed.theme === 'light', onClick: () => setEd({ theme: 'light' }) },
        '-',
        { label: 'Close brackets, quotes and tags', checked: S.ed.pairs, onClick: () => setEd({ pairs: !S.ed.pairs }) },
        { label: 'Suggestions as you type', checked: S.ed.suggest, onClick: () => setEd({ suggest: !S.ed.suggest }) },
        { label: 'Lay out JSON when saving', checked: S.ed.tidyJson, onClick: () => setEd({ tidyJson: !S.ed.tidyJson }) },
      ], r.left, r.top - 4, { label: 'Editor settings' });
    }
    function indentMenu(btn) {
      const f = current();
      if (!f) return;
      const r = btn.getBoundingClientRect();
      api.menu([
        { header: true, label: `Indent ${f.name} with` },
        ...[2, 4, 8].map(n => ({ label: `${n} spaces`, checked: !f.tabs && f.indent === n, onClick: () => setIndent(n, false) })),
        { label: 'Tabs', checked: !!f.tabs, onClick: () => setIndent(f.indent || 4, true) },
        '-',
        { label: 'Fix tabs and trailing spaces', icon: 'wrench', onClick: () => cmdFixSpaces() },
      ], r.left, r.top - 4, { label: 'Indent' });
    }
    function moreMenu(btn) {
      const f = current();
      const r = btn.getBoundingClientRect();
      api.menu([
        { header: true, label: 'Edit' },
        { label: 'Find and replace', icon: 'search', hint: `${fmt.modLabel}${ALT}F`, disabled: !f, onClick: () => showFind(true, true) },
        { label: 'Go to line…', icon: 'arrow-right', hint: '⌃G', disabled: !f, onClick: () => openGoto() },
        { label: 'Comment or uncomment', icon: 'code', hint: `${fmt.modLabel}/`, disabled: !f || !E.COMMENT[f.lang], onClick: () => cmdComment() },
        { label: 'Duplicate line', icon: 'copy', hint: `${SHIFT}${ALT}↓`, disabled: !f, onClick: () => cmdDuplicate(true) },
        { label: 'Format', icon: 'align-left', hint: `${SHIFT}${ALT}F`, disabled: !f || !fmtLang(f), onClick: () => cmdFormat() },
        { label: 'Fix tabs and trailing spaces', icon: 'wrench', disabled: !f, onClick: () => cmdFixSpaces() },
        { label: 'Snippets…', icon: 'list-plus', onClick: () => setSide('snips') },
        '-',
        { header: true, label: 'Project' },
        { label: 'Search in the project', icon: 'search', hint: `${fmt.modLabel}${SHIFT}F`, onClick: () => setSide('search') },
        { label: 'New file…', icon: 'file', onClick: () => newFile(targetDir()) },
        { label: 'New folder…', icon: 'folder', onClick: () => newFolder(targetDir()) },
        { label: 'Version history…', icon: 'clock', disabled: !f, onClick: () => openHistory() },
        { label: 'Download as a .zip', icon: 'download', disabled: !f, onClick: () => downloadZip() },
        { label: 'Open a .zip as a project…', icon: 'upload', onClick: () => zipIn.click() },
        '-',
        { label: 'Try web APIs…', icon: 'send', onClick: () => openApiTool() },
      ], r.left, r.bottom + 4, { label: 'More' });
    }

    /* ---------------- first file ----------- */
    function firstFile() {
      const found = [];
      const scan = dir => {
        for (const n of vfs.ls(dir)) {
          const p = `${dir}/${n.name}`;
          if (n.type === 'dir') { S.folds.add(p); scan(p); } else found.push(p);
        }
      };
      scan(PROJ);
      return found.find(p => /readme\.md$/i.test(p)) || found.find(p => /main\.js$/i.test(p)) || found[0] || null;
    }

    applyEditorLook();
    sideTabs.firstChild.classList.add('is-on');
    paintLive();
    paintLog();
    preview.hidden = !S.pv.on;
    pvSplit.hidden = !S.pv.on;
    btnPrev.setAttribute('aria-pressed', String(S.pv.on));
    btnPrev.classList.toggle('is-on', S.pv.on);
    appEl.classList.toggle('has-preview', S.pv.on);
    if (S.pv.on) applyWidth();

    const wanted = opts && opts.path ? vfs.norm(opts.path) : null;
    if (wanted && vfs.node(wanted)) { S.folds.add(vfs.parentPath(wanted)); firstFile(); openPath(wanted, false); }
    else { const p = firstFile(); if (p) openPath(p, false); else swap(); }
    if (opts && opts.preview) setPreview(true);
    if (opts && opts.shared) openShared(opts.shared);
    else if (opts && opts.gist) openGist(String(opts.gist));
    /* opened at a match (Spotlight's words-inside results): that line, selected */
    if (wanted && Number(opts.line) > 0) requestAnimationFrame(() => gotoLine(Number(opts.line)));

    /* ---------------- wiring --------------- */
    const onInput = e => {
      onEdit();
      if (S.applying) return;
      const t = e && e.inputType;
      if (t === 'insertText' && e.data && /[\w$.<\/:@#\- "'=]$/.test(e.data)) openSuggest(false);
      else if (t === 'deleteContentBackward' && S.cm) openSuggest(false);
      else closeSuggest();
    };
    const onMove = () => { paintGutter(); paintFoot(); };
    ta.addEventListener('input', onInput);
    ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta) closeSuggest(); }, 100));
    ta.addEventListener('mousedown', () => closeSuggest());
    ta.addEventListener('scroll', () => {
      syncScroll();
      /* typing past the edge scrolls the text: the suggestions follow the caret */
      if (S.cm) placeSuggest();
      if (S.pv.on && S.mode === 'md') {
        const room = ta.scrollHeight - ta.clientHeight;
        if (room > 0) mdView.scrollTop = (ta.scrollTop / room) * (mdView.scrollHeight - mdView.clientHeight);
      }
    });
    ta.addEventListener('click', onMove);
    ta.addEventListener('keyup', onMove);
    ta.addEventListener('select', onMove);
    /* the editing keys: suggestions first, then commands, then the typing helpers */
    ta.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      const f = current();
      if (!f) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (S.cm) {
        if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); moveSuggest(k === 'ArrowDown' ? 1 : -1); return; }
        if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); moveSuggest(k === 'PageDown' ? 5 : -5); return; }
        if ((k === 'Enter' && !mod && !e.shiftKey && !e.altKey) || (k === 'Tab' && !e.shiftKey)) { e.preventDefault(); acceptSuggest(); return; }
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSuggest(); return; }
        if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') closeSuggest();
      }
      if (k === ' ' && e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openSuggest(true); return; }
      if (mod && !e.altKey && !e.shiftKey && (k === '/' || e.code === 'Slash')) { e.preventDefault(); cmdComment(); return; }
      if (e.shiftKey && e.altKey && !mod && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); cmdDuplicate(k === 'ArrowDown'); return; }
      if (e.shiftKey && e.altKey && !mod && e.code === 'KeyF') { e.preventDefault(); cmdFormat(); return; }
      if (mod && !e.shiftKey && !e.altKey && (k === ']' || k === '[')) { e.preventDefault(); cmdIndent(k === '['); return; }
      if (mod && k === 'Enter' && SQLF.test(f.name)) { e.preventDefault(); runSql(f); return; }
      if (k === 'Tab' && !mod && !e.altKey) {
        e.preventDefault();
        const [s, en] = sel();
        if (e.shiftKey) cmdIndent(true);
        else if (ta.value.slice(s, en).includes('\n')) cmdIndent(false);
        else insert(unit(f));
        return;
      }
      if (k === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const [s, en] = sel();
        applyEdit(E.enterEdit(ta.value, s, en, f.lang, unit(f)));
        return;
      }
      if (!S.ed.pairs || mod || e.altKey) return;
      const [s, en] = sel();
      if (k === 'Backspace') { const r = E.backspacePair(ta.value, s, en); if (r) { e.preventDefault(); applyEdit(r); } return; }
      if (k.length !== 1) return;
      let r = null;
      if (k === '>' && f.lang === 'html') r = E.closeTagEdit(ta.value, s, en);
      else if ('()[]{}"\'`'.includes(k)) r = E.pairEdit(k, ta.value, s, en, f.lang);
      if (r) { e.preventDefault(); closeSuggest(); applyEdit(r); if (k === '"' || k === "'") openSuggest(false); }
    });

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
      else if (mod && e.altKey && e.code === 'KeyF') { e.preventDefault(); showFind(true, true); }
      else if (mod && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); setSide('search'); }
      else if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); showFind(true); }
      else if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); openGoto(); }
      else if (mod && (e.key === 'p' || e.key === 'P') && e.shiftKey) { e.preventDefault(); run(); }
      else if (e.key === 'Escape' && !findBox.classList.contains('hidden')) showFind(false);
      else if (e.key === 'Escape' && S.panel && !e.defaultPrevented && !document.querySelector('.menu, [role="dialog"][aria-modal="true"]')) closePanel();
    };
    window.addEventListener('keydown', onKey);
    win.state.save = save;                 /* File › Save in the menu bar */

    /* the editor's colours follow StaticOS's light or dark look when set to match it */
    const themeObs = new MutationObserver(() => { if (S.ed.theme === 'auto') applyEditorLook(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const offFs = api.bus.on('fs:change', (dir, path) => {
      if (dir === PROJ || (dir && dir.startsWith(PROJ))) paintTree();
      const f = S.open.find(x => x.path === path);
      if (f && !f.dirty && f !== current()) f.text = vfs.read(path) || '';
      /* a file the page uses changed on disk (saved here or elsewhere) */
      if (S.pv.on && S.pv.live && path && WEB.test(path) && S.pv.page && vfs.parentPath(path) === vfs.parentPath(S.pv.page)) scheduleRefresh();
    });

    win.onReopen(o => { if (o && o.shared) openShared(o.shared); else if (o && o.gist) openGist(String(o.gist)); if (o && o.path) openPath(o.path); if (o && o.preview) setPreview(true); if (o && o.path && Number(o.line) > 0) gotoLine(Number(o.line)); win.focus(); });
    win.onClose(() => {
      const dirty = S.open.filter(f => f.dirty).length;
      if (dirty) api.notify({ app: 'Code', icon: 'alert', title: 'Closed with unsaved changes', message: `${dirty} file${dirty === 1 ? '' : 's'} were not written.` });
    });

    return () => {
      S.dead = true;
      window.removeEventListener('keydown', onKey);
      offFs();
      ro.disconnect();
      clearTimeout(S.pv.t);
      if (logQ) cancelAnimationFrame(logQ);
      S.pv.sb?.stop();
      S.pv.sb = null;
      py.dispose();
      sqlP.dispose();
      shader.dispose();
      closeShared();
      closePanel();
      themeObs.disconnect();
      clearTimeout(S.search.t);
    };
  },
});
