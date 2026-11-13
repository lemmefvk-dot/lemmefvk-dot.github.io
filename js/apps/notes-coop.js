/* ============================================================
   notes-coop.js — Write Together in Notes: the panel, the bar that
   says who is connected, the friend's caret, and what ties the
   editor to the shared text (core/textcrdt.js) over a private room
   (core/coopnote.js).

   One person presses Write together… on a note and gets a code and
   an invite link (#note=<CODE>). The friend types the code in Notes
   or opens the link, which only fills the code in: they still press
   Join. From then on both can type anywhere at once.

   THE EDITOR stays what Notes made it: contentEditable, with every
   change reaching bodyChanged(). `shown` is the text the editor was
   last drawn from, with an id for every letter; a local change compares
   the editor with `shown` and sends the difference. A friend's change
   goes into the text at once and the editor is redrawn, with this
   person's selection carried across by id, so it stays on the same
   letters when the friend edits above it. A redraw waits while an input
   method is composing or the mouse button is down (a drag in progress
   would lose its place), and only touches the lines that changed.

   WHAT SYNCS: the words; bold and italic; headings, bulleted, numbered
   and check lists and their ticks; the title. Pictures are files on one
   device: a picture line syncs, its bytes don't, so the friend sees
   its name and a note saying where it is. Nothing is ever read from
   or written as HTML: the text carries marks and line kinds from a
   fixed list, and Notes draws them with text nodes.

   Undo (Ctrl+Z) takes back only your own changes. Leaving keeps the
   note as an ordinary note on both sides: the host's own, and the
   guest's new one, which was kept up to date all along.

     createCoop(editor) -> { live(n), owns(n), local(n), fromBlocks(n, blocks),
                             undo(), redo(), title(n, text), redraw(),
                             external(), toggle(), fromOpts(o), active(), destroy() }
   ============================================================ */
import { openCoop } from '../core/coopnote.js';
import { sameBlocks, unitCount, LIMITS } from '../core/textcrdt.js';
import { isCode, normalizeCode, spaced } from '../core/roomcode.js';
import { me } from '../core/identity.js';
import * as live from '../portal/live.js';

const ERR = {
  invalid: 'That isn’t a room code — codes are 6 letters and numbers, like K7QM2X.',
  nobody: 'Nobody answered that code. Check it, and that your friend still has the note open.',
  full: 'That note already has two people writing in it.',
  insecure: 'Write together needs a secure (https) page for its encryption.',
};
const FULL = `A shared note holds up to ${LIMITS.text.toLocaleString('en-US')} characters, and ${LIMITS.nodes.toLocaleString('en-US')} written in all, so that last change didn’t go in. Starting a new room starts the count again.`;
const TOO_LONG = `This note is too long to share: a shared note holds up to ${LIMITS.text.toLocaleString('en-US')} characters.`;
const inviteLink = code => { try { return `${location.origin}${location.pathname}#note=${code}`; } catch (e) { return ''; } };
const MAX_RECTS = 60;

export function createCoop(E) {
  const { h, icon, api, wrap, rich } = E;
  const S = {
    open: false, sess: null, off: null, noteId: null, shown: null, peerCur: null,
    err: '', note: '', joinCode: '', dirty: false, composing: false, pressing: false, timer: 0, dead: false,
  };
  const doc = () => S.sess?.doc || null;
  const shared = () => (S.noteId ? E.note(S.noteId) : null);
  const paired = () => !!S.sess && S.sess.phase === 'paired';
  const ready = () => !!S.sess && S.sess.ready && !!S.shown;
  const peerName = () => S.sess?.peer?.name || 'your friend';
  const owns = n => !!S.sess && !!n && S.noteId === n.id;
  const isLive = n => owns(n) && ready();

  const panel = h('div.notes-co', { role: 'dialog', 'aria-label': 'Write together', hidden: true });
  const bar = h('div.notes-co__bar', { role: 'status', hidden: true });
  const name = h('span.notes-co__name');
  const caret = h('div.notes-co__caret', name);
  const marks = h('div.notes-co__marks');
  const layer = h('div.notes-co__layer', { 'aria-hidden': 'true', hidden: true }, marks, caret);
  E.main.appendChild(panel);
  wrap.parentNode.insertBefore(bar, wrap);
  wrap.appendChild(layer);

  /* ---------------- where this person is, by id ---------------- */
  function selectionNow() {
    const c = E.getCaret();
    if (!c || !S.shown) return null;
    const sel = window.getSelection();
    let backward = false;
    if (sel && !sel.isCollapsed) {
      const r = document.createRange();
      r.setStart(sel.anchorNode, sel.anchorOffset);
      r.setEnd(sel.focusNode, sel.focusOffset);
      backward = r.collapsed;
    }
    return { a: doc().anchorIn(S.shown, c.s), f: doc().anchorIn(S.shown, c.e), backward };
  }
  function announce() {
    const n = shared();
    if (!isLive(n)) return;
    if (!E.inEditor(n) || !E.focused()) { S.sess.cursor({ on: false }); return; }
    const at = selectionNow();
    if (at) S.sess.cursor({ on: true, a: at.a, f: at.f });
  }

  /* ---------------- drawing from the shared text ---------------- */
  /** at: { a, f, backward } keys to put the selection back on; else the selection there is now. */
  function redraw(at = null, { scroll = false } = {}) {
    clearTimeout(S.timer);
    S.timer = 0;
    const n = shared();
    if (!n || !doc()) return;
    S.dirty = false;
    const here = E.inEditor(n) && E.focused();
    const keep = at || (here && S.shown ? selectionNow() : null);
    S.shown = doc().render();
    const sel = keep && here ? { s: doc().where(keep.a, S.shown), e: doc().where(keep.f, S.shown), backward: keep.backward, scroll } : null;
    E.show(n, S.shown.blocks, doc().title, sel);
    paintPeer();
  }
  /* the friend's change. Stays `dirty` while this person is mid-gesture: the editor still
     matches `shown`, whose ids stay good, and their next change or letting go picks it up. */
  function redrawSoon() {
    S.dirty = true;
    if (S.timer) return;
    S.timer = setTimeout(() => {
      S.timer = 0;
      if (!S.dead && !S.composing && !S.pressing) redraw();
    }, 16);
  }

  /* ---------------- what this person changed ---------------- */
  function take(n, blocks, caret) {
    const r = doc().sync(S.shown, blocks, { caret: caret ? caret.e : null });
    if (r.rejected) {
      api.notify({ app: 'Notes', icon: 'alert', title: 'This shared note is full', message: FULL });
      const at = caret ? { a: doc().anchorIn(S.shown, caret.s), f: doc().anchorIn(S.shown, caret.e) } : null;
      redraw(at);
      return;
    }
    S.sess.push(r.ops);
    const at = caret ? { a: r.anchor(caret.s), f: r.anchor(caret.e) } : null;
    const next = doc().render();
    if (S.dirty || !sameBlocks(next.blocks, blocks)) redraw(at);   /* it didn't all go in as typed, or the friend's change is waiting */
    else S.shown = next;
    announce();
    paintPeer();
  }
  function local(n) {
    if (!isLive(n) || !E.inEditor(n)) return;
    take(n, E.read(), E.getCaret());
  }
  function fromBlocks(n, blocks) {
    if (!isLive(n)) return;
    const r = doc().sync(S.shown, blocks);
    if (r.rejected) { api.notify({ app: 'Notes', icon: 'alert', title: 'This shared note is full', message: FULL }); return; }
    S.sess.push(r.ops);
    redraw();
  }
  function step(r) {
    if (!r) return;
    S.sess.push(r.ops);
    const key = r.caret;
    redraw(key ? { a: key, f: key } : null, { scroll: true });
    announce();
  }
  function title(n, text) {
    if (isLive(n)) S.sess.push(doc().setTitle(text));
  }
  /** Another Notes window saved. Its copy of this note may be a moment old, and taking
      that as an edit would delete what the friend just wrote: the shared text wins. */
  function external() {
    const n = shared();
    if (!S.sess || !S.noteId) return;
    if (!n) { S.note = 'The shared note was deleted, so you left the room.'; end(true); return; }
    if (ready()) redrawSoon();
  }

  /* ---------------- the friend's caret ---------------- */
  function rectAt(point, i) {
    const r = document.createRange();
    r.setStart(point.node, point.off);
    r.collapse(true);
    const box = r.getClientRects()[0] || r.getBoundingClientRect();
    if (box && box.height) return box;
    /* an empty line has no text to measure: its start */
    const el = E.blockEls()[i];
    if (!el) return null;
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { left: b.left + (parseFloat(cs.paddingLeft) || 0), top: b.top, height: parseFloat(cs.lineHeight) || b.height };
  }
  function paintPeer() {
    const c = S.peerCur, n = shared();
    if (!c || !c.on || !isLive(n) || !E.inEditor(n)) { layer.hidden = true; return; }
    const d = doc();
    const a = d.where(c.a, S.shown), f = d.where(c.f, S.shown);
    if (!a || !f) return;                          /* letters not here yet: their op is on its way */
    const pa = E.pointAt(a.i, a.o), pf = E.pointAt(f.i, f.o);
    if (!pa || !pf) { layer.hidden = true; return; }
    const home = wrap.getBoundingClientRect();
    const box = rectAt(pf, f.i);
    if (!box) { layer.hidden = true; return; }
    layer.hidden = false;
    const hue = String(S.sess.peer?.color ?? 200);
    layer.style.setProperty('--h', hue);
    caret.style.left = `${box.left - home.left}px`;
    caret.style.top = `${box.top - home.top}px`;
    caret.style.height = `${box.height}px`;
    caret.classList.toggle('is-low', box.top - home.top < 16);
    name.textContent = S.sess.peer?.name || 'Friend';
    const rects = [];
    if (a.i !== f.i || a.o !== f.o) {
      const r = document.createRange();
      try {
        r.setStart(pa.node, pa.off);
        r.setEnd(pf.node, pf.off);
        for (const x of r.getClientRects()) { if (x.width > 0 && rects.length < MAX_RECTS) rects.push(x); }
      } catch (e) { /* the two ends crossed in a redraw */ }
    }
    marks.replaceChildren(...rects.map(x => h('i', { style: {
      left: `${x.left - home.left}px`, top: `${x.top - home.top}px`, width: `${x.width}px`, height: `${x.height}px`,
    } })));
  }

  /* ---------------- starting and ending ---------------- */
  function begin(role, code) {
    if (S.sess) return;
    S.err = '';
    S.note = '';
    const n = E.current();
    if (role === 'host' && (!n || n.path)) { S.err = 'Pick a note first — text files can’t be shared.'; paint(); return; }
    if (role === 'host' && unitCount(E.inEditor(n) ? E.read() : E.parse(n.body)) > LIMITS.text) { S.err = TOO_LONG; paint(); return; }
    const noteId = role === 'host' ? n.id : null;
    const sess = openCoop({
      role, code,
      initial: () => {
        const t = E.note(noteId);
        return { blocks: t ? (E.inEditor(t) ? E.read() : E.parse(t.body)) : [], title: t ? t.title : '' };
      },
    });
    if (sess.phase === 'closed') { S.err = ERR[sess.error] || ERR.nobody; paint(); return; }
    S.sess = sess;
    S.noteId = noteId;
    S.off = sess.on((type, data) => {
      if (S.dead || S.sess !== sess) return;
      if (type === 'remote') { redrawSoon(); return; }
      if (type === 'cursor') { S.peerCur = data; paintPeer(); return; }
      if (type === 'ready') { onReady(); return; }
      if (type === 'toolong') {
        sayInPanel(TOO_LONG);
        end(false);
        return;
      }
      if (type === 'left') {
        const who = data.peer?.name || 'Your friend';
        S.note = `${who} ${data.reason === 'quiet' ? 'went quiet' : 'left'} — your copy of the note stays in Notes.`;
        api.notify({ app: 'Notes', icon: 'users', title: S.note, timeout: 5000 });
        end(false);
        return;
      }
      if (type === 'phase' && data === 'closed') {
        if (sess.error) sayInPanel(ERR[sess.error] || ERR.nobody);
        end(false);
        return;
      }
      paint();
    });
    paint();
  }
  function onReady() {
    const d = doc();
    if (S.sess.role === 'guest') {
      const blocks = d.render().blocks;
      const n = E.addNote(d.title, blocks);
      S.noteId = n.id;
    }
    S.shown = d.render();
    const n = shared();
    if (S.sess.role === 'guest') {
      E.paint();
      E.focus();
    } else if (n && E.inEditor(n) && !sameBlocks(S.shown.blocks, E.read())) redraw();
    S.open = false;
    panel.hidden = true;
    paint();
    announce();
  }
  /** Over: the note is already saved as an ordinary note. Undo starts afresh from here. */
  function end(sayBye) {
    const sess = S.sess;
    if (!sess) return;
    clearTimeout(S.timer);
    S.timer = 0;
    const n = shared();
    if (n && S.shown && doc() && S.dirty) redraw();     /* the friend's last words go in before it ends */
    S.off?.();
    S.off = null;
    S.sess = null;
    S.noteId = null;
    S.shown = null;
    S.peerCur = null;
    S.dirty = false;
    layer.hidden = true;
    if (sayBye) { try { sess.leave(); } catch (e) { /* gone */ } }
    E.ended();
    paint();
  }
  function leaveNow() {
    S.note = paired() ? 'You left — your copy of the note stays in Notes.' : '';
    end(true);
    S.open = true;
    panel.hidden = false;
    paint();
  }

  /* ---------------- the panel and the bar ---------------- */
  async function copyInvite(code) {
    const link = inviteLink(code);
    const text = `Write with me in Notes — room code ${code}${link ? ` · ${link}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      api.notify({ app: 'Notes', icon: 'copy', title: 'Invite copied', message: `Room code ${code}.`, timeout: 3000 });
    } catch (e) { api.notify({ app: 'Notes', icon: 'info', title: `Room code ${code}`, message: 'Copying was blocked here — read the code out instead.' }); }
  }
  function toggle(force) {
    S.open = typeof force === 'boolean' ? force : !S.open;
    panel.hidden = !S.open;
    if (S.open) paint();
  }
  /* something went wrong that the person needs to read, wherever the panel was */
  function sayInPanel(text) {
    S.err = text;
    S.open = true;
    panel.hidden = false;
  }
  function paintPanel() {
    const sess = S.sess;
    const kids = [h('div.notes-co__head', icon('users'), h('b', { text: 'Write together' }),
      h('button.ibtn', { type: 'button', 'aria-label': 'Hide this panel', onclick: () => toggle(false) }, icon('x')))];
    if (!sess) {
      const n = E.current();
      const can = !!n && !n.path;
      const input = h('input.notes-co__in', { type: 'text', maxlength: '80', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
        placeholder: 'Friend’s code', 'aria-label': 'Room code from your friend', value: S.joinCode || '',
        oninput: e => { S.joinCode = e.target.value; } });
      kids.push(
        h('p', { text: 'Write a note with a friend, live: you both type at once, anywhere in it, and see each other’s cursor.' }),
        h('button.btn.btn--primary.notes-co__start', { type: 'button', disabled: can ? null : true, onclick: () => begin('host') },
          icon('users'), h('span', { text: can ? `Share “${(n.title || 'Untitled note').slice(0, 40)}”` : 'Pick a note to share' })),
        h('div.notes-co__or', { text: 'or join theirs' }),
        h('form.notes-co__join', { onsubmit: e => {
          e.preventDefault();
          const c = normalizeCode(input.value);
          S.joinCode = c;
          if (!isCode(c)) { S.err = ERR.invalid; paint(); return; }
          begin('guest', c);
        } }, input, h('button.btn', { type: 'submit' }, h('span', { text: 'Join' }))),
        h('p.notes-co__fine', { text: 'Joining adds a new note of your own, which stays yours when you leave.' }));
    } else if (paired() && !sess.ready) {
      kids.push(h('p.notes-co__wait', h('i.notes-co__spin'), h('span', { text: `Getting ${peerName()}’s note…` })));
    } else if (paired()) {
      kids.push(h('p.notes-co__with', { style: { '--h': String(sess.peer?.color ?? 200) } }, h('i'), h('span', { text: `Writing with ${peerName()}` })));
    } else if (sess.role === 'host') {
      const link = inviteLink(sess.code);
      kids.push(h('p', { text: 'Your room code' }),
        h('div.notes-co__code', { 'aria-label': `Room code ${spaced(sess.code)}`, role: 'group', dataset: { code: sess.code } }, [...sess.code].map(c => h('span', { text: c, 'aria-hidden': 'true' }))),
        h('input.notes-co__link', { type: 'text', readonly: true, value: link, 'aria-label': 'Invite link', onfocus: e => e.target.select() }),
        h('button.btn.btn--sm', { type: 'button', onclick: () => copyInvite(sess.code) }, icon('copy'), h('span', { text: 'Copy invite' })),
        h('p.notes-co__wait', h('i.notes-co__spin'), h('span', { text: sess.phase === 'waiting' ? 'Waiting for your friend — keep writing, they’ll get all of it.' : 'Opening the room…' })));
    } else {
      kids.push(h('p.notes-co__wait', h('i.notes-co__spin'), h('span', { text: `Joining ${sess.code}…` })));
    }
    if (sess && !paired() && live.status() === 'offline') kids.push(h('p.notes-co__err', { text: 'Can’t reach the live server — this network may block it. Trying again…' }));
    if (S.err) kids.push(h('p.notes-co__err', { role: 'alert', text: S.err }));
    if (S.note) kids.push(h('p.notes-co__note', { role: 'status', text: S.note }));
    if (sess) kids.push(h('button.btn.btn--sm.notes-co__leave', { type: 'button', onclick: leaveNow }, h('span', { text: paired() ? 'Leave' : 'Cancel' })));
    kids.push(h('p.notes-co__fine', { text: 'This runs over StaticOS’s live connection, a free public relay. Your note is encrypted with the room code before it leaves this device, so anyone watching the relay sees sealed bytes, not your words — but the code is short and anyone who has it could read along, so treat it like a password. Names aren’t verified. Undo only takes back your own changes. Pictures stay on the device they were added on; your friend sees their name.' }));
    panel.replaceChildren(...kids);
  }
  function paintBar() {
    const sess = S.sess;
    bar.hidden = !sess;
    if (!sess) { bar.replaceChildren(); return; }
    const kids = [];
    if (paired() && sess.ready) {
      const mine = me();
      const n = shared();
      kids.push(
        h('span.notes-co__who', { style: { '--h': String(mine.color ?? 200) } }, h('i'), h('span', { text: `${mine.name || 'You'} (you)` })),
        h('span.notes-co__who.is-peer', { style: { '--h': String(sess.peer?.color ?? 200) } }, h('i'), h('span', { text: peerName() })),
        h('span.notes-co__state', { text: 'writing together' }));
      if (n && E.current()?.id !== n.id) kids.push(h('button.btn.btn--sm', { type: 'button', onclick: () => E.open(n.id) }, h('span', { text: 'Go to the shared note' })));
    } else if (paired()) {
      kids.push(h('i.notes-co__spin'), h('span.notes-co__state', { text: `Getting ${peerName()}’s note…` }));
    } else if (sess.role === 'host') {
      kids.push(h('i.notes-co__spin'), h('span.notes-co__state', { text: sess.phase === 'waiting' ? `Waiting for your friend — code ${sess.code}` : 'Opening the room…' }));
    } else {
      kids.push(h('i.notes-co__spin'), h('span.notes-co__state', { text: `Joining ${sess.code}…` }));
    }
    kids.push(h('div.grow'), h('button.btn.btn--sm.notes-co__barleave', { type: 'button', onclick: leaveNow }, h('span', { text: paired() ? 'Leave' : 'Cancel' })));
    bar.replaceChildren(...kids);
  }
  function paint() {
    if (S.dead) return;
    paintBar();
    if (S.open) paintPanel();
  }

  /* ---------------- wiring ---------------- */
  const offLive = live.onStatus(() => { if (S.sess && !paired()) paint(); });
  const onSelection = () => { if (!S.composing) announce(); };
  document.addEventListener('selectionchange', onSelection);
  const onFocus = () => announce();
  rich.addEventListener('focusin', onFocus);
  rich.addEventListener('focusout', onFocus);
  /* capture: before Notes' own compositionend handler reads the editor */
  const onCompStart = () => { S.composing = true; };
  const onCompEnd = () => { S.composing = false; };
  rich.addEventListener('compositionstart', onCompStart, true);
  rich.addEventListener('compositionend', onCompEnd, true);
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    toggle(false);
    if (E.current() && !E.current().path) rich.focus();
  });
  const onPress = e => { if (e.button === 0) S.pressing = true; };
  const onRelease = () => { if (!S.pressing) return; S.pressing = false; if (S.dirty) redrawSoon(); };
  rich.addEventListener('pointerdown', onPress);
  window.addEventListener('pointerup', onRelease, true);
  window.addEventListener('pointercancel', onRelease, true);
  const onScroll = () => paintPeer();
  rich.addEventListener('scroll', onScroll, { passive: true });
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => paintPeer()); ro.observe(rich); }

  function fromOpts(o) {
    if (!o || !o.coop) return;
    if (S.sess) {
      S.note = 'Leave this room before joining another.';
      toggle(true);
      return;
    }
    S.joinCode = normalizeCode(o.coop).slice(0, 6);
    S.err = '';
    S.note = '';
    toggle(true);
    setTimeout(() => panel.querySelector('.notes-co__join button')?.focus({ preventScroll: true }), 40);
  }

  /* for the play-tests */
  rich.coopPeek = () => {
    const sess = S.sess, d = doc();
    return {
      on: !!sess, phase: sess?.phase || 'none', code: sess?.code || null, topic: sess?.topic || null, role: sess?.role || null,
      ready: !!sess?.ready, peer: sess?.peer || null, noteId: S.noteId, note: S.note, err: S.err,
      blocks: S.shown?.blocks || null, title: d?.title ?? null, digest: d && S.shown ? d.digest() : null, length: d?.length ?? 0,
      peerCur: S.peerCur, net: sess?.peek?.() || null, joinCode: S.joinCode,
    };
  };

  return {
    owns, live: isLive, local, fromBlocks, title, external, toggle, fromOpts,
    redraw: () => redraw(),
    undo: () => step(doc()?.undo()),
    redo: () => step(doc()?.redo()),
    /** In a room at all, with this person's note or waiting for one. */
    active: () => !!S.sess,
    paint,
    destroy() {
      if (S.sess) end(true);
      S.dead = true;
      clearTimeout(S.timer);
      offLive();
      document.removeEventListener('selectionchange', onSelection);
      rich.removeEventListener('focusin', onFocus);
      rich.removeEventListener('focusout', onFocus);
      rich.removeEventListener('compositionstart', onCompStart, true);
      rich.removeEventListener('compositionend', onCompEnd, true);
      rich.removeEventListener('scroll', onScroll);
      rich.removeEventListener('pointerdown', onPress);
      window.removeEventListener('pointerup', onRelease, true);
      window.removeEventListener('pointercancel', onRelease, true);
      ro?.disconnect();
    },
  };
}

export default { createCoop };
