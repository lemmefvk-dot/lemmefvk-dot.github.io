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

   Store: portal.code = { preview, live, prevW } (prefs only).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as SB from '../core/sandbox.js';
import { render as renderMd } from '../portal/mdlite.js';
import { TEMPLATES } from '../core/codetemplates.js';
import { pyPane } from '../core/codeview.js';
import * as Share from '../core/codeshare.js';
import * as Gist from '../core/gist.js';
import { externalHosts } from '../core/sharelink.js';

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
};

const LANGS = {
  js: ['JavaScript', 'js'], mjs: ['JavaScript', 'js'], ts: ['TypeScript', 'js'],
  rs: ['Rust', 'js'], py: ['Python', 'py'], c: ['C', 'js'], h: ['C Header', 'js'],
  css: ['CSS', 'css'], html: ['HTML', 'html'], htm: ['HTML', 'html'], svg: ['SVG', 'html'],
  json: ['JSON', 'json'], md: ['Markdown', 'md'],
  toml: ['TOML', 'conf'], conf: ['Config', 'conf'], ini: ['INI', 'conf'],
  yml: ['YAML', 'conf'], yaml: ['YAML', 'conf'], sh: ['Shell', 'conf'],
  txt: ['Plain Text', null], log: ['Log', null], csv: ['CSV', null],
};

const MAX_HL = 80000;   /* above this, skip highlighting and stay responsive */
const MAX_LOG = 300;
const PREF = 'portal.code';
const WEB = /\.(html?|css|m?js)$/i;
const MD = /\.(md|markdown)$/i;
const PY = /\.py$/i;
/* where a shared project's files live while it is only being read: not a place in the vfs */
const SH_ROOT = '/__shared__/';
/* what the preview pane shows for a file */
const modeOf = f => (!f ? null : MD.test(f.name) ? 'md' : PY.test(f.name) ? 'py' : 'web');
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
  name: 'VS Code',
  icon: 'code',
  g1: '#a5b8ff', g2: '#3730c4',
  category: 'Productivity',
  keywords: ['editor', 'ide', 'source', 'text', 'write', 'html', 'css', 'javascript', 'web', 'preview', 'live preview', 'console', 'python', 'py', 'markdown', 'md', 'template', 'starter', 'share project'],
  desc: 'Edit files with a live preview for HTML, CSS, JavaScript and Markdown, run Python, start from a template, or share a web project as a link',
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
    ['Mod+Shift+P', 'Run: preview HTML, CSS or JavaScript'],
    ['Tab', 'Indent (two spaces)'],
    ['Esc', 'Close Find'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, fmt, render, clear, store } = api;

    const PROJ = `${vfs.HOME}/Projects`;
    const prefs = () => { const v = store.get(PREF, null); return v && typeof v === 'object' ? v : {}; };
    const setPref = patch => store.set(PREF, { ...prefs(), ...patch });

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
    const findBox = h('div.field.hidden', { style: { width: '196px', height: '24px' } },
      icon('search'), findInput, findCount);

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
    win.setTools(btnSave, btnFind, findBox, btnRun, btnPrev, btnShare, btnGist, webLink);

    /* ---------------- layout --------------- */
    const side = h('aside.app__side');
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
      'aria-label': 'Source editor',
      style: {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        resize: 'none', border: '0', background: 'transparent',
        color: 'transparent', WebkitTextFillColor: 'transparent',
        caretColor: 'var(--accent-soft)',
      },
    });
    const editor = h('div.code', gutter, h('div.grow', { style: { position: 'relative' } }, layer, ta));
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
    const logEl = h('section.cpv__log', { 'aria-label': 'Console' },
      h('div.cpv__loghead', icon('terminal'), h('b', { text: 'Console' }), logCounts, h('div.grow'),
        h('button.btn.btn--sm.btn--ghost.cpv__clear', { type: 'button', onclick: () => { S.pv.logs = []; paintLog(); } }, icon('trash'), h('span', { text: 'Clear' })),
        logFold),
      logList);
    const mdView = h('div.cpv__md', { hidden: true, role: 'document', tabindex: '0', 'aria-label': 'Markdown preview' });
    const py = pyPane({ h, icon, clear });
    py.el.hidden = true;
    const pvSplit = h('div.cpv__split', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the preview', tabindex: '0' });
    const preview = h('aside.cpv', { 'aria-label': 'Live preview', hidden: true },
      h('div.cpv__bar', icon('globe'), h('b', { text: 'Preview' }), pvPage, h('div.grow'),
        h('label.cpv__live', { title: 'Reload the preview as you type' }, liveSw, h('span', { text: 'Live' })),
        pvReload, pvClose),
      h('div.cpv__stage', pvHost, pvEmpty, mdView, py.el),
      logEl);
    const work = h('div.cpv__work', editor, blank, pvSplit, preview);
    const appEl = h('div.app.cpv-app', side, h('div.app__main', tabsEl, work, foot));
    root.appendChild(appEl);

    /* ---------------- tree ----------------- */
    function paintTree() {
      clear(side);
      const group = h('div.side__group',
        h('div.side__label.cpv__sidehead', h('span', { text: 'Projects' }),
          h('span.cpv__sidebtns',
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
      side.append(group, openG);
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
        onclick: () => {
          if (isDir) { open ? S.folds.delete(p) : S.folds.add(p); paintTree(); }
          else openPath(p);
        },
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
        S.open.push({ path: p, name: n.name, text: vfs.read(p) || '', dirty: false, lang, label });
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
      if (f) {
        ta.value = f.text;
        ta.scrollTop = 0; ta.scrollLeft = 0;
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
      if (S.fileMode === 'md' && was !== 'md' && !S.pv.on) setPreview(true, true);
      else if (S.fileMode !== 'md' && S.pv.auto && S.pv.on) setPreview(false, true);
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
      render(layer, ...tokens(text, spec), '\n');
      layer.scrollTop = ta.scrollTop;
      layer.scrollLeft = ta.scrollLeft;
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
    }

    function insert(str) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      if (ta.setRangeText) ta.setRangeText(str, s, e, 'end');
      else {
        ta.value = ta.value.slice(0, s) + str + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + str.length;
      }
      onEdit();
    }

    /** Put the caret at the start of line n (1-based) and show it. */
    function gotoLine(n) {
      const v = ta.value;
      let pos = 0;
      for (let i = 1; i < n; i++) { const j = v.indexOf('\n', pos); if (j < 0) break; pos = j + 1; }
      const end = v.indexOf('\n', pos);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, end < 0 ? v.length : end);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
      ta.scrollTop = Math.max(0, (n - 1) * lh - ta.clientHeight / 3);
      syncScroll();
      paintGutter();
      paintFoot();
    }

    /* ---------------- actions -------------- */
    function save() {
      const f = current();
      if (!f) return;
      if (!f.dirty) { api.notify({ app: 'Code', icon: 'check', title: 'Already saved', message: f.name, timeout: 2200 }); return; }
      vfs.write(f.path, f.text);
      f.dirty = false;
      api.bus.emit('file:saved', { path: f.path, app: 'code' });
      api.notify({ app: 'Code', icon: 'save', title: 'File saved', message: `${f.name} · ${fmt.fmtBytes(f.text.length)}` });
      paintTabs(); paintTree(); paintFoot();
    }

    /* Run = show this file working: web files in the live preview. Nothing
       else can run in a browser tab, and Code says so rather than pretend. */
    function run() {
      const f = current();
      if (!f) return;
      if (WEB.test(f.name) || MD.test(f.name)) { setPreview(true); refresh(true); return; }
      if (PY.test(f.name)) { runPython(f); return; }
      api.notify({ app: 'Code', icon: 'alert', title: 'Nothing to run', message: `Run previews HTML, CSS, JavaScript and Markdown, and runs Python. ${f.label} files cannot run in the browser.`, timeout: 3600 });
    }

    /** Every text file under dir as { path (relative), text }, with the
        editor's unsaved text. `only` limits it to names that match. */
    function collect(dir, only, maxFiles = 300, maxBytes = 5 * 1024 * 1024) {
      const flat = dir === PROJ || dir === vfs.HOME;       /* never sweep up every project at once */
      const out = [];
      let bytes = 0, over = false;
      const walk = (d, rel, depth) => {
        for (const n of vfs.ls(d)) {
          const p = `${d}/${n.name}`;
          if (n.type === 'dir') { if (!flat && depth < 4) walk(p, `${rel}${n.name}/`, depth + 1); continue; }
          if (only ? !only.test(n.name) : !/\.(py|txt|json|csv|tsv|md|markdown|html?|css|m?js|xml|ya?ml|toml|ini|cfg|log|svg)$/i.test(n.name)) continue;
          const text = textOf(p) ?? '';
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

    function showFind(on) {
      findBox.classList.toggle('hidden', !on);
      btnFind.classList.toggle('is-on', on);
      if (on) { findInput.focus(); findInput.select(); runFind(0); }
      else { findCount.textContent = ''; S.hits = []; ta.focus(); }
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
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
      const line = f.text.slice(0, at).split('\n').length;
      ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2);
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
        t.preview === 'py' ? 'main.py is open: press Run (the play button) to run it. The first run downloads Python once.' : 'The preview is running: edit any file and it updates as you type.');
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
      else { stopPreview(); py.release(); }
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
      const ic = kind === 'error' ? 'x-circle' : kind === 'warn' ? 'alert' : kind === 'system' ? 'refresh' : kind === 'info' ? 'info' : 'chevron-right';
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
    const ro = new ResizeObserver(() => fitLayout());
    ro.observe(appEl);

    /* ---------------- status bar ----------- */
    function paintFoot() {
      const f = current();
      if (!f) { render(foot, h('span.dim', { text: 'Ready' })); return; }
      const { line, col, sel } = caret();
      render(foot,
        h('button.ibtn.tip', {
          'data-tip': 'Reveal in Files', style: { height: '20px', fontSize: 'var(--fs-10)' },
          onclick: () => api.openApp('files', { path: vfs.parentPath(f.path) }),
        }, icon('file-code', { size: 11 }), h('span', { text: f.label })),
        h('span.dim', { text: '·' }),
        h('span.dim.mono.cpv__pos', { text: `Ln ${line}, Col ${col}${sel ? ` (${sel} selected)` : ''}` }),
        h('span.dim', { text: '·' }),
        h('span.dim', { text: `${ta.value.split('\n').length} lines` }),
        h('div.grow'),
        S.hits.length ? h('span.dim', { text: `${S.hits.length} matches` }) : null,
        h('span.dim', { text: 'Spaces: 2' }),
        h('span.dim', { text: 'UTF-8' }),
        h('span.dim', { text: 'LF' }),
        f.dirty
          ? h('span.badge.badge--warn', { text: 'Unsaved' })
          : h('span.badge.badge--ok', { text: 'Saved' }));
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
    const onInput = () => onEdit();
    const onMove = () => { paintGutter(); paintFoot(); };
    ta.addEventListener('input', onInput);
    ta.addEventListener('scroll', () => {
      syncScroll();
      if (S.pv.on && S.mode === 'md') {
        const room = ta.scrollHeight - ta.clientHeight;
        if (room > 0) mdView.scrollTop = (ta.scrollTop / room) * (mdView.scrollHeight - mdView.clientHeight);
      }
    });
    ta.addEventListener('click', onMove);
    ta.addEventListener('keyup', onMove);
    ta.addEventListener('select', onMove);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); insert('  '); return; }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        const v = ta.value, s = ta.selectionStart;
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const ind = (v.slice(ls, s).match(/^[ \t]*/) || [''])[0];
        const extra = /[{([]$/.test(v.slice(ls, s).trimEnd()) ? '  ' : '';
        e.preventDefault();
        insert(`\n${ind}${extra}`);
      }
    });

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
      else if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); showFind(true); }
      else if (mod && (e.key === 'p' || e.key === 'P') && e.shiftKey) { e.preventDefault(); run(); }
      else if (e.key === 'Escape' && !findBox.classList.contains('hidden')) showFind(false);
    };
    window.addEventListener('keydown', onKey);

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
      closeShared();
    };
  },
});
