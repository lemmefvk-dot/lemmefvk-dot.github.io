/* ============================================================
   musicshare.js — the parts of Static Music's "share a playlist with
   a friend" that you see: the panel under a shared playlist and the
   join box. The rules (rooms, merging, matching) are in
   js/core/sharedlist.js; Music wires the two together.
   Everything shown is set with textContent.
   ============================================================ */
import { spaced } from '../core/roomcode.js';

export const inviteLink = code => { try { return `${location.origin}${location.pathname}#list=${code}`; } catch (e) { return ''; } };

export const EXPLAIN = [
  'Every edit — add, remove, move, a station, a new name — is an operation with a timestamp. Each song keeps the stamp of its latest add/remove and of its latest move, and the newer stamp wins.',
  'Two people moving different songs: both moves stay. Moving the same song: the later move wins. If one of you removes a song while the other moves it, it stays removed until someone adds it again. Adding the same song twice shows it once.',
  'The whole list is re-sent every few seconds too, so a message the public server drops is repaired on the next round.',
];

const STATUS = {
  connecting: 'Connecting…', waiting: 'Waiting for your friend to join…', joining: 'Joining…', paired: 'Connected', closed: 'Closed',
};

/** The panel for a shared playlist. cb: { leave, copy, sendDrop(ref), openDrop(code), addStation(id,on), playStation(st), stationsList, menu(e, items) } */
export function sharePanel({ h, icon }, sess, cb) {
  const v = sess.view();
  const friend = sess.peerName;
  const paired = sess.phase === 'paired';
  const box = h('section.mu-sh', { dataset: { role: 'share' }, 'aria-label': 'Shared playlist' });
  box.appendChild(h('div.mu-sh__head', icon('users'), h('b', { text: paired ? `Editing with ${friend}` : 'Shared with a friend' }),
    h('span.mu-sh__st', { role: 'status', text: STATUS[sess.phase] || '' }), h('div.grow'),
    h('button.btn.btn--sm', { type: 'button', dataset: { role: 'sh-leave' }, onclick: cb.leave }, icon('x'), 'Leave (keep my copy)')));
  if (!paired) {
    box.appendChild(h('div.mu-sh__code', { dataset: { code: sess.code }, 'aria-label': `Code ${spaced(sess.code)}` },
      h('span.mu-sh__codetx', { text: sess.code }),
      h('button.btn.btn--sm', { type: 'button', dataset: { role: 'sh-copy' }, onclick: () => cb.copy(sess.code) }, icon('copy'), 'Copy invite'),
      h('small.dim', { text: `Your friend opens Music › Playlists › Join a shared playlist, or the link ${inviteLink(sess.code)}. Treat the code like a password.` })));
  }
  box.appendChild(h('p.mu-sh__note', icon('info'), h('span', { text: 'Only song names, sizes and their order are shared — never the audio. A song is matched to a file your friend already has by file name and size.' })));
  if (sess.offer) {
    box.appendChild(h('div.mu-sh__offer', icon('send'), h('span.grow', { text: `${sess.offer.from} is sending you a file with Drop.` }),
      h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { role: 'sh-opendrop' }, onclick: () => cb.openDrop(sess.offer.code) }, icon('download'), 'Open Drop')));
  }
  if (v.missing.length) {
    const ul = h('ul.mu-sh__list', { dataset: { role: 'sh-missing' } });
    for (const it of v.missing) ul.appendChild(h('li', icon('alert'), h('span.grow', { text: it.name }), h('small.dim', { text: `Not on this device — ${friend} can send it with Drop` })));
    box.appendChild(h('div.mu-sh__sec', h('span.label', { text: `Missing on this device · ${v.missing.length}` }), ul));
  }
  const theirs = v.items.filter(it => it.ref && it.peerMissing);
  if (theirs.length) {
    const ul = h('ul.mu-sh__list', { dataset: { role: 'sh-theirs' } });
    for (const it of theirs) {
      ul.appendChild(h('li', icon('music'), h('span.grow', { text: it.name }),
        h('button.btn.btn--sm', { type: 'button', dataset: { role: 'sh-senddrop' }, onclick: () => cb.sendDrop(it.ref) }, icon('send'), 'Send with Drop')));
    }
    box.appendChild(h('div.mu-sh__sec', h('span.label', { text: `${friend} doesn’t have these · ${theirs.length}` }), ul));
  }
  /* radio stations travel too */
  const chips = h('div.mu-sh__stations', { dataset: { role: 'sh-stations' } });
  for (const id of v.stations) {
    const st = cb.stationsList.find(s => s.id === id);
    if (!st) continue;
    chips.appendChild(h('span.chip.mu-sh__chip', { dataset: { station: id } },
      h('button.mu-sh__play', { type: 'button', 'aria-label': `Play ${st.name}`, onclick: () => cb.playStation(st) }, icon('cast'), st.name),
      h('button.mu-sh__x', { type: 'button', 'aria-label': `Remove ${st.name} from the shared list`, onclick: () => cb.addStation(id, false) }, icon('x'))));
  }
  const free = cb.stationsList.filter(s => !v.stations.includes(s.id));
  box.appendChild(h('div.mu-sh__sec', h('span.label', { text: `Radio stations · ${v.stations.length}` }), chips,
    h('button.btn.btn--sm', { type: 'button', dataset: { role: 'sh-addstation' }, disabled: !free.length, 'aria-haspopup': 'menu',
      onclick: e => cb.menu(e, free.map(s => ({ label: s.name, icon: 'plus', onClick: () => cb.addStation(s.id, true) }))) }, icon('plus'), 'Add a station')));
  box.appendChild(h('details.mu-sh__how', { dataset: { role: 'sh-how' } }, h('summary', { text: 'How edits merge' }), EXPLAIN.map(t => h('p', { text: t }))));
  if (v.log.length) {
    box.appendChild(h('ol.mu-sh__log', { dataset: { role: 'sh-log' }, 'aria-label': 'Recent edits' },
      v.log.slice(-6).reverse().map(l => h('li', { text: `${l.who} ${l.text}` }))));
  }
  return box;
}

/** The "Join a shared playlist" box. Built once; join(code) does the work. */
export function joinBox({ h, icon }, join) {
  const input = h('input', { type: 'text', maxlength: '60', placeholder: 'Code or invite link', 'aria-label': 'Shared playlist code', spellcheck: 'false', autocomplete: 'off', dataset: { role: 'sh-code' } });
  const status = h('span.mu-sh__st', { role: 'status' });
  const go = () => join(input.value);
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } });
  const el = h('div.mu-sh__join', { dataset: { role: 'sh-join' } }, icon('users'), h('b', { text: 'Join a shared playlist' }), input,
    h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { role: 'sh-joingo' }, onclick: go }, 'Join'), status);
  return { el, input, status };
}
