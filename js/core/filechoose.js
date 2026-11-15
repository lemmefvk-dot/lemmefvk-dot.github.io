/* ============================================================
   filechoose.js — "pick one of my files" for the instrument apps.

   listFiles(vfs, exts) walks the person's own home folder for files with
   those extensions. chooser({ h, icon, vfs, exts, title, onPick, onClose })
   returns a small panel listing them; the bytes are read by the caller
   (media.blobOf). Nothing outside the person's Files is ever read.
   ============================================================ */
export function listFiles(vfs, exts, limit = 80) {
  const out = [];
  const want = new Set(exts.map(e => e.toLowerCase()));
  try {
    vfs.walk(vfs.HOME, (n, path) => {
      if (out.length >= limit || n.type !== 'file') return;
      const i = n.name.lastIndexOf('.');
      if (i > 0 && want.has(n.name.slice(i + 1).toLowerCase())) out.push({ name: n.name, path });
    }, 6);
  } catch (e) { /* no files */ }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function chooser({ h, icon, vfs, exts, title, empty, onPick, onClose }) {
  const files = listFiles(vfs, exts);
  return h('div.fchoose', { role: 'dialog', 'aria-label': title },
    h('div.fchoose__head', h('b', { text: title }), h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: onClose }, icon('x'))),
    files.length
      ? h('ul.fchoose__list', files.map(f => h('li', h('button.fchoose__item', { type: 'button', dataset: { path: f.path }, title: f.path, onclick: () => onPick(f) }, icon('file'), h('span', { text: f.name })))))
      : h('p.fchoose__empty', { text: empty || 'No matching files in your Files yet. Import one with Files › Import from computer.' }));
}

export default { listFiles, chooser };
