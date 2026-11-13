/* ============================================================
   drop.js — Static Drop: send files or photos to a friend's
   StaticOS with a code, straight from device to device.

   Send. Add files from Files (its context menu has "Send with
   Drop…", or "Add from Files" here) or from this computer, press
   Get a code, and read the six characters to your friend or send
   the invite link (#drop=<CODE>). When they join, they see your
   name and each file's name, size and type. Nothing moves until
   they press Accept; then the bytes go over a direct, encrypted
   WebRTC link, never through the public server. Both sides see
   progress and can cancel. Each file is checked with SHA-256 on
   arrival and only then saved to their ~/Downloads.

   Receive. Type the code (or open the invite link and press
   Receive). Accept or Decline — Decline is always there. Files
   over this device's caps are listed as refused and never asked
   for. Saved files are listed with "Show in Files"; nothing opens
   by itself.

   Move my StaticOS. Each StaticOS link (staticos.surge.sh, the AWS
   link) is its own web address with its own saved data. This sends
   the same backup Settings › Back up your data makes; the other side
   is offered to restore it, with a plain warning that it replaces
   everything saved on that link, then the usual restore confirmation.

   Honest limits, said in the window: the code and the room run over
   a free public server (sealed with the code, but anyone who has the
   code can join); setting up the direct link shows each person the
   other's network address; with no relay server, two networks that
   refuse a direct path (some school and work networks) can't Drop,
   and Drop says so rather than pretending.

   opts: { send: [paths], go? } adds those files (go: and gets a code
   at once) · { join: CODE } fills
   the code on Receive · { move: true } shows Move my StaticOS.
   Emits bus 'drop:hosting' { code, names } when a send gets its code
   (Watch Together uses it to tell a friend which drop is theirs).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import * as live from '../portal/live.js';
import { startSend, startReceive, LIMITS, DOWNLOADS } from '../core/drop.js';
import { isCode, normalizeCode, spaced } from '../core/roomcode.js';
import { rtcAvailable } from '../core/pair.js';
import { fmtSize } from '../core/fileimport.js';
import * as profiles from '../core/profiles.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-drop-css')) {
  const l = document.createElement('link');
  l.id = 'feat-drop-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-drop.css';
  document.head.appendChild(l);
}

const PICK_DIRS = ['Downloads', 'Pictures', 'Videos', 'Music', 'Documents', 'Desktop'];
const LIVE_TEXT = {
  idle: 'Not connected yet',
  connecting: 'Connecting to the live server…',
  live: 'Connected to the live server',
  offline: 'Can’t reach the live server — this network may block it. Trying again…',
};
const LINK_TEXT = {
  off: '',
  connecting: 'Setting up a direct link…',
  direct: 'Direct link up — files go straight between your devices',
  failed: 'No direct link could be made',
  lost: 'The direct link dropped',
};
const JOIN_ERR = {
  invalid: ['That isn’t a Drop code', 'Codes are 6 letters and numbers, like K7QM2X.'],
  nobody: ['Nobody answered', 'No Drop is waiting with that code right now. Check the code, and that your friend still has Drop open.'],
  full: ['That Drop is taken', 'Someone else already joined it. Ask your friend for a new code.'],
  insecure: ['Drop can’t run here', 'Drop needs a secure (https) page for its encryption.'],
};
const FAIL_TEXT = who => ({
  nolink: `A direct connection to ${who} couldn’t be made, so nothing was sent. StaticOS has no relay server: when both networks block direct links (some school and work networks do), Drop can’t work between them. Try again on another network — or both on the same Wi-Fi.`,
  lost: `The direct link to ${who} dropped partway. Files that finished and checked out were kept; the rest weren’t.`,
  left: `${who} left, or the connection to them was lost.`,
  damaged: 'A file didn’t arrive intact (its size or SHA-256 didn’t match), so it wasn’t saved and the drop was stopped.',
  error: 'Something went wrong reading a file to send.',
});
const inviteLink = code => { try { return `${location.origin}${location.pathname}#drop=${code}`; } catch (e) { return ''; } };
const kindIcon = (name, type) => {
  const k = media.kindOf(type) || media.kindOf(name);
  return k === 'image' ? 'image' : k === 'video' ? 'film' : k === 'audio' ? 'music' : /json|text|markdown|csv/.test(type || '') ? 'file-text' : 'file';
};
const typeLabel = (name, type) => {
  if (type) return type;
  const i = name.lastIndexOf('.');
  return i > 0 ? `.${name.slice(i + 1).toLowerCase()} file` : 'file';
};
const hostName = () => { try { return location.host || 'this link'; } catch (e) { return 'this link'; } };

defineApp({
  id: 'drop',
  name: 'Static Drop',
  icon: 'send',
  g1: '#9a7dff', g2: '#4d27cf',
  category: 'Internet',
  keywords: ['send', 'share', 'files', 'transfer', 'airdrop', 'friend', 'code', 'photos', 'webrtc', 'move', 'backup', 'migrate', 'aws', 'surge'],
  desc: 'Send files to a friend’s StaticOS with a code — straight from device to device',
  singleton: true,
  win: { w: 600, h: 620, minW: 420, minH: 460 },

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, vfs, notify } = api;
    const HOME = vfs.HOME;

    const S = {
      dead: false,
      tab: 'send',
      queue: [],                  /* { key, name, size, type, blob(), path? } */
      picking: false,
      pickDir: `${HOME}/Downloads`,
      session: null,
      offs: [],
      joinCode: '',
      note: '',
      noteErr: false,
    };

    const body = h('div.drp__body');
    const tabs = h('div.tabs.drp__tabs', { role: 'tablist', 'aria-label': 'Send or receive' });
    const tabBtn = (id, label, ic) => h('button', {
      type: 'button', role: 'tab', id: `drp-tab-${id}`, 'aria-selected': 'false', dataset: { tab: id },
      onclick: () => { if (S.session && !ended()) return; S.tab = id; paint(); },
    }, icon(ic), h('span', { text: label }));
    tabs.append(tabBtn('send', 'Send', 'upload'), tabBtn('receive', 'Receive', 'download'));
    const liveEl = h('div.drp__live', { role: 'status' }, h('i.drp__dot'), h('span'));
    const foot = h('div.drp__foot',
      icon('shield'),
      h('p', { text: 'Drop finds your friend through StaticOS’s live connection, a free public server, using the code (sealed with it, but anyone who has the code can join — treat it like a password). Files never go through that server: they travel straight between your two devices over an encrypted direct link. Setting that link up shows each of you the other’s network address. Names aren’t verified.' }));
    const drp = h('div.drp', { 'aria-label': 'Static Drop' }, h('div.drp__top', tabs, liveEl), body, foot);
    root.appendChild(h('div.app.app--col', drp));

    const fileIn = h('input.sr', { type: 'file', multiple: true, tabindex: '-1', 'aria-hidden': 'true', onchange: e => { const fs = [...(e.target.files || [])]; e.target.value = ''; addComputerFiles(fs); } });
    drp.appendChild(fileIn);

    const ended = () => !S.session || ['done', 'restore', 'declined', 'cancelled', 'failed', 'closed'].includes(S.session.state);
    const peerName = () => S.session?.peer?.name || 'your friend';

    /* ---------- live status line ---------- */
    const offLive = live.onStatus(st => {
      liveEl.dataset.st = st;
      liveEl.lastChild.textContent = LIVE_TEXT[st] || LIVE_TEXT.idle;
      liveEl.hidden = !S.session || ended();
    });

    /* ---------- the send queue ---------- */
    function say(text, err = false) { S.note = text; S.noteErr = err; }
    function addItem(it) {
      if (S.queue.some(q => q.key === it.key)) return true;
      if (S.queue.length >= LIMITS.files) { say(`A drop holds up to ${LIMITS.files} files.`, true); return false; }
      if (it.size > LIMITS.fileMax) { say(`“${it.name}” is ${fmtSize(it.size)} — Drop sends files up to ${fmtSize(LIMITS.fileMax)} each.`, true); return false; }
      const total = S.queue.reduce((a, q) => a + q.size, 0) + it.size;
      if (total > LIMITS.totalMax) { say(`That would be ${fmtSize(total)} — one drop carries up to ${fmtSize(LIMITS.totalMax)}.`, true); return false; }
      S.queue.push(it);
      return true;
    }
    function itemFromPath(path) {
      const n = vfs.node(path);
      if (!n || n.type !== 'file') return { err: 'That isn’t a file.' };
      if (media.isMedia(n)) {
        return { key: `vfs:${path}`, path, name: n.name, size: Number(n.size) || 0, type: '', blob: () => media.blobOf(n) };
      }
      const text = typeof n.content === 'string' ? n.content : '';
      if (!text && (n.size || 0) > 0) return { err: `“${n.name}” has no content in this browser, so there’s nothing to send.` };
      const blob = new Blob([text], { type: 'text/plain' });
      return { key: `vfs:${path}`, path, name: n.name, size: blob.size, type: 'text/plain', blob: async () => blob };
    }
    function addPaths(paths) {
      let added = 0;
      S.note = '';
      for (const p of paths || []) {
        const it = itemFromPath(p);
        if (it.err) { say(it.err, true); continue; }
        if (addItem(it)) added++;
      }
      return added;
    }
    function addComputerFiles(files) {
      S.note = '';
      for (const f of files) addItem({ key: `pc:${f.name}:${f.size}:${f.lastModified}`, name: f.name, size: f.size, type: f.type || '', blob: async () => f });
      paint();
    }

    /* ---------- sessions ---------- */
    function watch(sess) {
      S.offs.forEach(f => f());
      S.session = sess;
      let lastState = sess.state;
      S.offs = [sess.on((type, data) => {
        if (S.dead) return;
        if (type === 'progress') { paintProgress(); return; }
        if (type === 'state' && data === 'waiting' && sess.role === 'send') api.bus.emit('drop:hosting', { code: sess.code, names: S.queue.map(q => q.name) });
        if (type === 'state' && data !== lastState) {
          lastState = data;
          if (data === 'done') api.bus.emit('drop:done', { role: sess.role });
          if (data === 'done' && sess.role === 'receive') {
            const ok = sess.saved.filter(s => s.ok).length;
            if (ok) notify({ app: 'Static Drop', icon: 'download', title: `Saved ${ok} file${ok === 1 ? '' : 's'} from ${peerName()}`, message: 'They’re in Downloads.' });
          }
        }
        paint();
      })];
      paint();
    }
    function sendQueue() {
      if (!S.queue.length || (S.session && !ended())) return;
      if (!rtcAvailable()) { say('This browser can’t make direct links (WebRTC), so it can’t Drop.', true); paint(); return; }
      watch(startSend({ items: S.queue.map(q => ({ name: q.name, type: q.type, blob: q.blob })), mode: 'files' }));
    }
    async function sendMove() {
      if (S.session && !ended()) return;
      if (!rtcAvailable()) { say('This browser can’t make direct links (WebRTC), so it can’t Drop.', true); paint(); return; }
      /* a backup is one person's data (core/backup.js); a guest has none to send */
      if (!profiles.idbName()) { say('A guest session keeps nothing, so there is no StaticOS to move. Sign in to your own profile first.', true); paint(); return; }
      const whose = profiles.people().length > 1 ? `everything ${profiles.displayName()} has saved` : 'everything saved';
      const yes = await api.confirm({
        title: 'Move your StaticOS?',
        message: `This sends ${whose} on ${hostName()} — settings, files, projects, account details and private device keys${api.store.get('portal.friends', null)?.me?.priv ? ', your Friends private key among them' : ''} — to whoever joins with the code. Only do this between your own devices, and only read the code to yourself.`,
        ok: 'Get a code',
      });
      if (!yes || S.dead) return;
      const { createBackup } = await import('../core/backup.js');
      const stamp = new Date().toISOString().slice(0, 10);
      watch(startSend({
        mode: 'move', from: hostName(),
        items: [{ name: `StaticOS backup ${hostName()} ${stamp}.json`, type: 'application/json', blob: async () => new Blob([JSON.stringify(await createBackup())], { type: 'application/json' }) }],
      }));
    }
    function receive(code) {
      if (S.session && !ended()) return;
      const c = normalizeCode(code);
      S.joinCode = c;
      if (!isCode(c)) { say('That isn’t a Drop code — codes are 6 letters and numbers, like K7QM2X.', true); paint(); return; }
      if (!rtcAvailable()) { say('This browser can’t make direct links (WebRTC), so it can’t receive a Drop.', true); paint(); return; }
      S.note = '';
      watch(startReceive(c));
    }
    function reset() {
      S.offs.forEach(f => f());
      S.offs = [];
      try { S.session?.close(); } catch (e) { /* gone */ }
      if (S.session?.role === 'send' && S.session.state === 'done') S.queue = [];
      S.session = null;
      S.note = '';
      paint();
    }
    async function copyInvite(code) {
      const link = inviteLink(code);
      const text = `Get my files with Static Drop — code ${code}${link ? ` · ${link}` : ''}`;
      try { await navigator.clipboard.writeText(text); notify({ app: 'Static Drop', icon: 'copy', title: 'Invite copied', message: `Code ${code}. Send it to your friend.` }); }
      catch (e) { notify({ app: 'Static Drop', icon: 'info', title: `Code ${code}`, message: 'Copying was blocked here — read the code out instead.' }); }
    }

    /* ---------- painting ---------- */
    const btn = (label, ic, onclick, cls = '', extra = {}) => h(`button.btn${cls}`, { type: 'button', onclick, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
    const noteEl = () => (S.note ? h('p.drp__note', { class: S.noteErr ? 'is-err' : '', role: S.noteErr ? 'alert' : 'status', text: S.note }) : null);
    function fileRow(f, { remove = null, status = null, bar = false } = {}) {
      const meta = `${fmtSize(f.size ?? f.s)} · ${typeLabel(f.name ?? f.n, f.type ?? f.ty)}`;
      return h('li.drp-file', { dataset: { status: status || '' } },
        h('span.drp-file__ic', icon(kindIcon(f.name ?? f.n, f.type ?? f.ty))),
        h('span.drp-file__t', h('b.trunc', { text: f.name ?? f.n }), h('small', { text: meta })),
        status ? h('span.drp-file__st', { text: status }) : null,
        bar ? h('span.drp-file__bar.bar.bar--thin', h('i', { style: { width: '0%' } })) : null,
        remove ? h('button.ibtn', { type: 'button', 'aria-label': `Remove ${f.name}`, onclick: remove }, icon('x')) : null);
    }
    function codeBlock(code) {
      return h('div.drp-code', { 'aria-label': `Code ${spaced(code)}`, dataset: { code } }, [...code].map(ch => h('span', { text: ch, 'aria-hidden': 'true' })));
    }
    function linkLine(sess) {
      const t = LINK_TEXT[sess.link] || '';
      return t ? h('p.drp-link', { dataset: { link: sess.link } }, h('i.drp__dot'), h('span', { text: t })) : null;
    }
    function progressBlock(sess) {
      return h('div.drp-prog', { role: 'progressbar', 'aria-label': sess.role === 'send' ? 'Sent' : 'Received', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' },
        h('div.bar', h('i.drp-prog__fill', { style: { width: '0%' } })), h('small.drp-prog__t', { text: '' }));
    }
    function paintProgress() {
      const sess = S.session;
      if (!sess) return;
      const p = sess.progress;
      const done = sess.role === 'send' ? Math.max(p.confirmed || 0, 0) : p.done;
      const sent = sess.role === 'send' ? p.done : p.done;
      const pct = p.total ? Math.min(100, Math.round((done / p.total) * 100)) : (['done', 'confirming'].includes(sess.state) ? 100 : 0);
      for (const el of body.querySelectorAll('.drp-prog__fill')) el.style.width = `${pct}%`;
      for (const el of body.querySelectorAll('.drp-prog__t')) {
        el.textContent = sess.role === 'send'
          ? `${fmtSize(done)} of ${fmtSize(p.total)} received by ${peerName()}${sent > done ? ` (${fmtSize(sent)} sent)` : ''}`
          : `${fmtSize(done)} of ${fmtSize(p.total)}`;
      }
      const prog = body.querySelector('.drp-prog');
      if (prog) prog.setAttribute('aria-valuenow', String(pct));
      for (const row of body.querySelectorAll('.drp-file[data-i]')) {
        const f = sess.files.find(x => String(x.i) === row.dataset.i);
        const st = row.querySelector('.drp-file__st');
        if (f && st) st.textContent = statusText(f, sess);
        if (f) row.dataset.status = f.status;
      }
    }
    function statusText(f, sess) {
      if (sess.role === 'send') {
        if (!f.accepted && sess.state !== 'offered' && sess.state !== 'waiting') return 'not taken';
        return { waiting: 'waiting', sending: 'sending…', sent: 'sent — checking', saved: 'saved ✓', failed: `not saved (${f.why || 'failed'})` }[f.status] || '';
      }
      if (f.status === 'refused') return f.why === 'toobig' ? `too big (over ${fmtSize(sess.mode === 'move' ? LIMITS.moveMax : LIMITS.fileMax)})` : 'over this drop’s limit';
      return { offered: f.accepted ? 'waiting' : '', receiving: 'receiving…', saved: sess.mode === 'move' ? 'checked ✓' : 'saved ✓', failed: f.why === 'damaged' ? 'damaged — not saved' : 'not saved' }[f.status] || '';
    }
    function sessFiles(sess) {
      return h('ul.drp-list', sess.files.map(f => {
        const row = fileRow(f, { status: statusText(f, sess) });
        row.dataset.i = String(f.i);
        row.dataset.status = f.status;
        return row;
      }));
    }
    function card(state, ...kids) { return h('section.drp-card', { dataset: { state } }, ...kids); }

    function paintSendIdle() {
      const total = S.queue.reduce((a, q) => a + q.size, 0);
      const list = S.queue.length
        ? h('ul.drp-list', S.queue.map(q => fileRow(q, { remove: () => { S.queue = S.queue.filter(x => x !== q); S.note = ''; paint(); } })))
        : h('div.drp-empty', icon('send'), h('b', { text: 'Pick something to send' }), h('small', { text: 'Add files from Files or from this computer. Your friend sees each name, size and type, and nothing is sent until they accept.' }));
      const go = btn(S.queue.length ? `Get a code for ${S.queue.length} file${S.queue.length === 1 ? '' : 's'} (${fmtSize(total)})` : 'Get a code', 'send', sendQueue, '.btn--primary.drp-go', { disabled: !S.queue.length });
      return h('div.drp-pane', { dataset: { pane: 'send' } },
        h('h2.drp__h', { text: 'Send files to a friend' }),
        list,
        h('div.drp-row',
          btn('Add from Files', 'folder-open', () => { S.picking = !S.picking; paint(); }, '.btn--sm', { 'aria-expanded': String(S.picking) }),
          btn('Add from this computer…', 'upload', () => fileIn.click(), '.btn--sm')),
        S.picking ? picker() : null,
        noteEl(),
        h('div.drp-row', go),
        h('p.drp__fine', { text: `Up to ${LIMITS.files} files, ${fmtSize(LIMITS.fileMax)} each, ${fmtSize(LIMITS.totalMax)} in one drop.` }),
        h('section.drp-move',
          h('div.drp-move__t', icon('refresh'), h('b', { text: 'Move my StaticOS' })),
          h('p', { text: 'staticos.surge.sh and the AWS link are separate web addresses, so each keeps its own settings and files. Open Drop on both, send from the one you’ve been using, and receive on the other — it’s offered to replace that link’s data with yours.' }),
          btn('Move my StaticOS…', null, sendMove, '.btn--sm.drp-move__go')));
    }
    function picker() {
      const dirs = PICK_DIRS.map(d => `${HOME}/${d}`).filter(p => vfs.node(p));
      if (!dirs.includes(S.pickDir)) S.pickDir = dirs[0] || HOME;
      const sel = h('select.drp-pick__dir', { 'aria-label': 'Folder', onchange: e => { S.pickDir = e.target.value; paint(); } },
        dirs.map(p => h('option', { value: p, text: vfs.baseName(p), selected: p === S.pickDir ? true : null })));
      const files = vfs.ls(S.pickDir).filter(n => n.type === 'file');
      return h('div.drp-pick', { role: 'group', 'aria-label': 'Add from Files' },
        h('div.drp-row', sel, h('small', { text: files.length ? 'Press a file to add it' : 'No files in this folder' })),
        h('ul.drp-pick__list', files.map(n => {
          const p = `${S.pickDir}/${n.name}`;
          const inQ = S.queue.some(q => q.key === `vfs:${p}`);
          return h('li', h('button.drp-pick__f', {
            type: 'button', 'aria-pressed': String(inQ), dataset: { path: p },
            onclick: () => { if (inQ) S.queue = S.queue.filter(q => q.key !== `vfs:${p}`); else addPaths([p]); paint(); },
          }, icon(inQ ? 'check' : kindIcon(n.name, '')), h('span.trunc', { text: n.name }), h('small', { text: fmtSize(n.size || 0) })));
        })));
    }

    function paintSendSession(sess) {
      const who = peerName();
      const cancel = btn('Cancel', 'x', () => sess.cancel(), '.drp-cancel');
      const back = (label = 'Done') => btn(label, null, reset, '.btn--primary.drp-back');
      const moveNote = sess.mode === 'move' ? h('p.drp__warn', { text: 'This is a whole-StaticOS move: it carries your private data. Only let your own device join.' }) : null;
      switch (sess.state) {
        case 'opening':
          return card('opening', h('div.drp-wait', h('i.drp-spin'), h('span', { text: sess.mode === 'move' ? 'Packing up your StaticOS…' : 'Getting your files ready…' })), h('div.drp-row', cancel));
        case 'waiting':
          return card('waiting',
            h('h2.drp__h', { text: 'Your Drop code' }),
            codeBlock(sess.code),
            h('p.drp__p', { text: sess.mode === 'move' ? 'On your other StaticOS: open Static Drop → Receive, and type this code.' : 'Send it to your friend. On their StaticOS: Static Drop → Receive, then type the code — or open the invite link.' }),
            h('div.drp-row', btn('Copy invite', 'copy', () => copyInvite(sess.code), '.btn--primary'), cancel),
            moveNote,
            h('div.drp-wait', h('i.drp-spin'), h('span', { text: 'Waiting for your friend to join…' })),
            sessFiles(sess));
        case 'offered':
          return card('offered',
            h('h2.drp__h', { text: `${who} joined` }),
            h('p.drp__p', { text: `Waiting for ${who} to accept or decline. Nothing has been sent.` }),
            linkLine(sess), sessFiles(sess), h('div.drp-row', cancel));
        case 'accepted':
          return card('accepted',
            h('h2.drp__h', { text: `${who} accepted` }),
            h('div.drp-wait', h('i.drp-spin'), h('span', { text: 'Connecting straight to their device…' })),
            linkLine(sess), sessFiles(sess), h('div.drp-row', cancel));
        case 'sending': case 'confirming':
          return card(sess.state,
            h('h2.drp__h', { text: sess.state === 'confirming' ? `${who} is checking the files…` : `Sending to ${who}` }),
            progressBlock(sess), linkLine(sess), sessFiles(sess), h('div.drp-row', cancel));
        case 'done': {
          const files = sess.files.filter(f => f.accepted);
          const ok = files.filter(f => f.status === 'saved').length;
          return card('done',
            h('h2.drp__h', { text: sess.reason === 'unconfirmed' ? `Sent to ${who}` : `${who} got ${ok} of ${files.length} file${files.length === 1 ? '' : 's'}` }),
            sess.reason === 'unconfirmed' ? h('p.drp__p', { text: `${who} didn’t confirm every file before leaving.` }) : null,
            sessFiles(sess), h('div.drp-row', back('Send more')));
        }
        case 'declined':
          return card('declined', h('h2.drp__h', { text: `${who} declined` }), h('p.drp__p', { text: 'Nothing was sent.' }), h('div.drp-row', back('Back')));
        case 'cancelled':
          return card('cancelled', h('h2.drp__h', { text: sess.reason === 'them' ? `${who} cancelled` : 'Cancelled' }),
            h('p.drp__p', { text: 'The drop stopped. Files your friend had already received and checked were kept on their side.' }), h('div.drp-row', back('Back')));
        default: {
          const err = JOIN_ERR[sess.reason];
          const text = sess.reason === 'prepare' ? `${sess.detail || 'A file couldn’t be read.'} Nothing was sent.` : FAIL_TEXT(who)[sess.reason] || FAIL_TEXT(who).left;
          return card('failed', h('h2.drp__h', { text: err ? err[0] : 'Drop didn’t finish' }), h('p.drp__p', { text: err ? err[1] : text }), h('div.drp-row', back('Back')));
        }
      }
    }

    function paintReceiveIdle() {
      const input = h('input.drp-in', {
        type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '80',
        placeholder: 'Their code, e.g. K7QM2X', 'aria-label': 'Drop code from your friend', value: S.joinCode || '',
      });
      const form = h('form.drp-join', { onsubmit: e => { e.preventDefault(); receive(input.value); } },
        input, h('button.btn.btn--primary', { type: 'submit' }, icon('download'), h('span', { text: 'Receive' })));
      setTimeout(() => { if (!S.dead && body.contains(input)) (S.joinCode ? form.querySelector('button') : input).focus({ preventScroll: true }); }, 30);
      return h('div.drp-pane', { dataset: { pane: 'receive' } },
        h('h2.drp__h', { text: 'Receive from a friend' }),
        h('p.drp__p', { text: 'Type the code your friend’s Static Drop shows. You’ll see who it’s from and every file’s name, size and type — nothing is saved until you press Accept.' }),
        form, noteEl(),
        h('p.drp__fine', { text: `This device takes files up to ${fmtSize(LIMITS.fileMax)} each and ${fmtSize(LIMITS.totalMax)} in one drop. They’re saved to Downloads.` }));
    }

    function paintReceiveSession(sess) {
      const who = peerName();
      const cancel = btn('Cancel', 'x', () => sess.cancel(), '.drp-cancel');
      const back = (label = 'Done') => btn(label, null, reset, '.btn--primary.drp-back');
      switch (sess.state) {
        case 'joining':
          return card('joining', h('div.drp-wait', h('i.drp-spin'), h('span', { text: `Looking for Drop ${sess.code}…` })), h('div.drp-row', btn('Cancel', 'x', reset, '.drp-cancel')));
        case 'joined':
          return card('joined', h('h2.drp__h', { text: `Connected to ${who}` }), h('div.drp-wait', h('i.drp-spin'), h('span', { text: 'Waiting for the list of files…' })), linkLine(sess), h('div.drp-row', cancel));
        case 'offered': {
          const files = sess.files;
          const takeable = files.filter(f => f.status === 'offered');
          const total = takeable.reduce((a, f) => a + f.s, 0);
          const move = sess.mode === 'move';
          const accept = btn(move ? 'Accept the backup' : `Accept ${takeable.length === files.length ? '' : `${takeable.length} of ${files.length} `}(${fmtSize(total)})`, 'check', () => sess.accept(), '.btn--primary.drp-accept', { disabled: !takeable.length });
          const decline = btn('Decline', 'x', () => sess.decline(), '.drp-decline');
          setTimeout(() => { if (!S.dead && body.contains(decline)) decline.focus({ preventScroll: true }); }, 30);
          return card('offered',
            h('h2.drp__h', { text: move ? `${who} wants to move a whole StaticOS here` : `${who} wants to send you ${files.length} file${files.length === 1 ? '' : 's'}` }),
            move ? h('div.drp__warn', { role: 'note' },
              h('b', { text: `Restoring it REPLACES everything saved on ${hostName()}` }),
              h('p', { text: `It’s a full backup${sess.from ? ` from ${sess.from}` : ''}: settings, files, projects, account details and keys. Accepting only downloads and checks it — you’ll be asked once more before anything here is replaced. Only accept a move from your own device.` })) : null,
            sessFiles(sess),
            !takeable.length ? h('p.drp__note.is-err', { role: 'alert', text: 'Everything here is over this device’s limits, so it can’t be accepted.' }) : null,
            h('p.drp__fine', { text: 'Names aren’t verified — anyone can call themselves anything. Received files are saved to Downloads and never opened by themselves.' }),
            linkLine(sess),
            h('div.drp-row', accept, decline));
        }
        case 'accepted':
          return card('accepted', h('h2.drp__h', { text: `Receiving from ${who}` }), h('div.drp-wait', h('i.drp-spin'), h('span', { text: 'Connecting straight to their device…' })), linkLine(sess), sessFiles(sess), h('div.drp-row', cancel));
        case 'receiving':
          return card('receiving', h('h2.drp__h', { text: `Receiving from ${who}` }), progressBlock(sess), linkLine(sess), sessFiles(sess), h('div.drp-row', cancel));
        case 'done': {
          const saved = sess.saved.filter(s => s.ok);
          return card('done',
            h('h2.drp__h', { text: saved.length ? `Saved ${saved.length} file${saved.length === 1 ? '' : 's'} to Downloads` : 'Nothing was saved' }),
            h('p.drp__p', { text: 'Each one was checked with SHA-256 before it was saved.' }),
            sessFiles(sess),
            h('div.drp-row',
              saved.length ? btn('Show in Files', 'folder-open', () => api.openApp('files', { path: saved[0].path || DOWNLOADS() }), '.btn--primary') : null,
              btn('Done', null, reset, '.drp-back')));
        }
        case 'restore':
          return card('restore',
            h('h2.drp__h', { text: `${who}’s StaticOS arrived` }),
            h('p.drp__p', { text: `The backup${sess.from ? ` from ${sess.from}` : ''} arrived whole and its SHA-256 checks out. It isn’t applied yet.` }),
            h('div.drp__warn', { role: 'note' }, h('b', { text: `Replacing removes everything saved on ${hostName()} now` }),
              h('p', { text: 'Your settings, files, projects and keys here are swapped for the backup’s, then StaticOS reloads. This can’t be undone — download a backup from Settings first if you might want this link’s data back.' })),
            h('div.drp-row',
              btn('Replace this StaticOS with it…', 'refresh', async () => {
                const { importBackup } = await import('../core/backup.js');
                const blob = sess.backup;
                if (!blob) return;
                await importBackup(new File([blob], 'staticos-move.json', { type: 'application/json' }), api);
              }, '.btn--danger.drp-restore'),
              btn('Discard', null, () => { sess.discard(); reset(); }, '.drp-back')));
        case 'declined':
          return card('declined', h('h2.drp__h', { text: 'Declined' }), h('p.drp__p', { text: 'Nothing was received or saved.' }), h('div.drp-row', back('Back')));
        case 'cancelled':
          return card('cancelled', h('h2.drp__h', { text: sess.reason === 'them' ? `${who} stopped the drop` : 'Cancelled' }),
            h('p.drp__p', { text: sess.saved.some(s => s.ok) ? 'Files that had already arrived and checked out were kept in Downloads; the rest were thrown away.' : 'Nothing was saved.' }),
            sess.saved.length ? sessFiles(sess) : null, h('div.drp-row', back('Back')));
        default: {
          const err = JOIN_ERR[sess.reason];
          return card('failed', h('h2.drp__h', { text: err ? err[0] : 'Drop didn’t finish' }),
            h('p.drp__p', { text: err ? err[1] : (FAIL_TEXT(who)[sess.reason] || FAIL_TEXT(who).left) }),
            sess.saved.length ? sessFiles(sess) : null, h('div.drp-row', back('Back')));
        }
      }
    }

    function paint() {
      if (S.dead) return;
      const sess = S.session;
      if (sess) S.tab = sess.role === 'send' ? 'send' : 'receive';
      for (const b of tabs.children) {
        const on = b.dataset.tab === S.tab;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
        b.disabled = !!sess && !ended() && !on;
      }
      liveEl.hidden = !sess || ended();
      const view = sess ? (sess.role === 'send' ? paintSendSession(sess) : paintReceiveSession(sess))
        : (S.tab === 'send' ? paintSendIdle() : paintReceiveIdle());
      body.replaceChildren(view);
      body.dataset.tab = S.tab;
      paintProgress();
      win.setSubtitle(sess && !ended() ? (sess.role === 'send' ? 'Sending' : 'Receiving') : '');
    }

    function fromOpts(o) {
      if (!o) return;
      if (Array.isArray(o.send) && o.send.length) {
        if (S.session && !ended()) { notify({ app: 'Static Drop', icon: 'info', title: 'A drop is already running', message: 'Finish or cancel it, then add more files.' }); return; }
        S.session = null;
        S.tab = 'send';
        addPaths(o.send.slice(0, LIMITS.files));
        paint();
        /* "Send it with Drop" from Watch Together: the person asked for a code already */
        if (o.go && S.queue.length) sendQueue();
      } else if (o.join) {
        if (S.session && !ended()) return;
        S.session = null;
        S.tab = 'receive';
        S.joinCode = normalizeCode(o.join).slice(0, 6);
        paint();
      } else if (o.move) {
        if (S.session && !ended()) return;
        S.tab = 'send';
        paint();
        setTimeout(() => body.querySelector('.drp-move__go')?.focus({ preventScroll: true }), 40);
      }
    }
    win.onReopen(fromOpts);
    paint();
    fromOpts(opts);

    /* for the play-tests */
    drp.dropPeek = () => {
      const s = S.session;
      return s ? {
        role: s.role, mode: s.mode, state: s.state, reason: s.reason, code: s.code, topic: s.room?.topic || null,
        link: s.link, stats: s.room?.stats?.() || null, files: s.files, progress: s.progress, saved: s.role === 'receive' ? s.saved : null,
        peer: s.peer, hasBackup: !!s.backup,
      } : { state: 'idle', queue: S.queue.map(q => ({ name: q.name, size: q.size })) };
    };
    drp.dropDebug = { room: () => S.session?.room || null };

    return () => {
      S.dead = true;
      offLive();
      S.offs.forEach(f => f());
      try { S.session?.close(); } catch (e) { /* gone */ }
      S.session = null;
    };
  },
});
