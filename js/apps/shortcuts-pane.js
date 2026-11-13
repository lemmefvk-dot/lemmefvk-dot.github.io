/* ============================================================
   shortcuts-pane.js — Settings › Shortcuts.

   Every global shortcut from js/core/keymap.js — the same list the
   shortcut sheet (hold ⌘ / Ctrl), Help and the dock hint read — and
   a "Change…" on each one that can be changed: press the new keys,
   and it is the shortcut everywhere at once, because every handler
   asks keymap.matches() rather than testing keys itself.

     · Esc cancels, Tab leaves; nothing else fires while recording
     · keys another shortcut has are refused and named, with a swap
     · keys the computer keeps (Alt+Tab, ⌘Tab …) are refused; keys the
       browser may keep (⌘W, Ctrl+T, ⌘Q …) or apps use (⌘C) are allowed
       with a warning beside them
     · Reset on each changed row, and Reset all

   pane({ api, caption, note, btn, go }) -> nodes for Settings' pane
   column. The changes live in prefs.keymap.
   ============================================================ */
import * as KM from '../core/keymap.js';

const MODNAMES = ['Control', 'Alt', 'Shift', 'Meta'];

export function pane({ api, caption, note, btn, go }) {
  const { h, icon, fmt, bus } = api;
  const mac = fmt.isMac;
  const say = t => bus.emit('a11y:say', t);
  const box = h('div.sc-pane', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' } });
  let cap = null;          /* { id, combo?, error?, conflicts? } while recording */
  let flash = null;        /* { id, warn } — the row just changed */

  const chips = keys => {
    const out = [];
    keys.forEach((k, i) => {
      if (i) out.push(h('small.dim', { text: '/' }));
      out.push(h('span.kbd', { text: KM.keysText(k, mac) }));
    });
    return h('div.row', { style: { gap: '3px', flexWrap: 'wrap' } }, out);
  };

  function rowFor(a, clashes) {
    if (a.fixed) {
      return h('tr.sc-row.is-fixed',
        h('td', chips(a.keys)),
        h('td', { text: a.label, title: a.where ? `Bound in ${a.where}` : null }),
        h('td', h('small.dim', { text: a.hold ? 'Hold' : 'Standard key', title: 'The same on every desktop, so it can’t be changed' })));
    }
    const recording = cap && cap.id === a.id;
    const clash = clashes.get(a.id);
    const warn = a.changed ? KM.warnFor(a.keys[0], mac) : '';
    const keysCell = recording
      ? h('div.sc-rec', { role: 'status', 'aria-live': 'polite' },
          h('span.kbd.sc-rec__k', { text: cap.combo ? KM.keysText(cap.combo, mac) : 'Press keys…' }))
      : chips(a.keys);
    const status = recording
      ? h('small.sc-status' + (cap.error ? '.is-error' : ''), { role: cap.error ? 'alert' : null },
          cap.error || 'Press the new keys for this. Esc cancels.')
      : null;
    const swap = recording && cap.conflicts && cap.conflicts.length === 1 && cap.conflicts[0].id
      ? h('button.btn.btn--sm.sc-swap', { type: 'button', onclick: () => doSwap(a, cap.combo, cap.conflicts[0]) },
          icon('repeat'), h('span', { text: `Swap with “${cap.conflicts[0].label}”` }))
      : null;
    return h('tr.sc-row' + (recording ? '.is-recording' : '') + (clash ? '.is-conflict' : ''), { dataset: { id: a.id } },
      h('td',
        keysCell,
        a.changed && !recording ? h('span.badge.badge--accent.sc-badge', { text: 'Changed' }) : null,
        clash && !recording ? h('span.badge.badge--warn.sc-badge.sc-clash', { text: 'Conflict', title: `Same keys as ${clash.map(c => `“${c.label}”`).join(', ')}` }) : null),
      h('td', { title: a.where ? `Bound in ${a.where}` : null },
        h('span', { text: a.label }),
        status,
        swap,
        clash && !recording ? h('small.sc-note', { text: `Same keys as ${clash.map(c => `“${c.label}”`).join(', ')}` }) : null,
        warn && !recording ? h('small.sc-note.sc-warn', { text: warn }) : null,
        flash && flash.id === a.id && !recording ? h('small.sc-note.sc-done', { text: `Now ${KM.keysText(a.keys[0], mac)}.` }) : null),
      h('td', h('div.row', { style: { gap: 'var(--sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' } },
        h('button.btn.btn--sm.sc-change', {
          type: 'button', 'aria-pressed': recording ? 'true' : 'false',
          'aria-label': recording ? `Recording new keys for ${a.label}. Press them now, or Escape to cancel` : `Change the keys for ${a.label} (now ${KM.keysText(a.keys.join(' / '), mac)})`,
          onclick: () => (recording ? stopCapture('Cancelled') : startCapture(a.id)),
        }, h('span', { text: recording ? 'Cancel' : 'Change…' })),
        a.changed ? h('button.ibtn.tip.sc-reset', {
          type: 'button', 'data-tip': 'Reset', 'aria-label': `Reset ${a.label} to ${KM.keysText(a.defaults.join(' / '), mac)}`,
          onclick: () => { KM.resetBinding(a.id); flash = null; paint(); say(`${a.label}: back to ${KM.keysText(a.defaults[0], mac)}`); },
        }, icon('rotate-ccw')) : null)));
  }

  function paint() {
    /* a repaint replaces the buttons: keep keyboard focus on the same row */
    const had = box.contains(document.activeElement);
    const fid = had ? document.activeElement.closest?.('tr[data-id]')?.dataset.id : null;
    const rows = KM.actionRows(mac);
    const clashes = KM.conflicts(mac);
    const changed = rows.filter(r => r.changed).length;
    const groups = [...new Set(rows.map(r => r.group))];
    const table = list => h('div.set-group', h('table.table.sc-table',
      h('thead', h('tr', h('th', { text: 'Keys', style: { width: '34%' } }), h('th', { text: 'Action' }), h('th', { text: '', style: { width: '1%' } }))),
      h('tbody', list)));
    const own = KM.appRows(api.getApp('settings'));
    api.render(box,
      h('div.row', { style: { gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' } },
        h('small.dim', { text: changed ? `${changed} changed by you` : 'All at their defaults' }),
        h('div.grow'),
        h('button.btn.btn--sm.sc-reset-all', { type: 'button', disabled: !changed, onclick: () => {
          KM.resetAll(); flash = null; paint(); say('Every shortcut is back to its default');
        } }, icon('rotate-ccw'), h('span', { text: 'Reset all' }))),
      groups.map(g => [caption(g), table(rows.filter(r => r.group === g).map(r => rowFor(r, clashes)))]),
      own.length ? [caption('In Settings'), table(own.map(r => rowFor({ fixed: true, keys: r.keys.split(' / '), label: r.label, where: 'apps/settings.js' }, clashes)))] : null,
      note(`Hold ${fmt.modLabel} for a second anywhere to see these, with the shortcuts of the app in front. `
        + 'Change… records new keys: hold the modifiers and press a key. Keys your computer keeps for itself '
        + '(Alt+Tab, ⌘Tab) are refused; keys the browser may keep — ⌘W, Ctrl+T, ⌘Q — work in full screen '
        + 'or an installed app, and say so beside them.'),
      h('div.row', btn('keyboard', 'Key tester', () => go('keyboard'))));
    const id = cap ? cap.id : fid;
    const b = id && (cap || had) ? box.querySelector(`tr[data-id="${CSS.escape(id)}"] .sc-change`) : null;
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
  }

  /* ---- recording ---- */
  const own = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  function onKey(e) {
    if (!cap || e.isComposing) return;
    const bare = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (bare && e.key === 'Escape') { own(e); stopCapture('Cancelled'); return; }
    if (bare && e.key === 'Tab') { stopCapture(); return; }          /* focus moves on */
    own(e);
    if (MODNAMES.includes(e.key)) return;
    const combo = KM.fromEvent(e, mac);
    if (!combo) return;
    const r = KM.check(cap.id, combo, mac);
    if (r.error) {
      cap = { id: cap.id, combo, error: `${r.error} Press other keys, or Esc to cancel.`, conflicts: r.conflicts || null };
      paint();
      say(cap.error);
      return;
    }
    const a = KM.action(cap.id, mac);
    KM.setBinding(cap.id, combo);
    flash = { id: cap.id };
    stopCapture();
    say(`${a.label}: ${KM.keysText(combo, mac)}${r.warn ? '. ' + r.warn : ''}`);
  }
  const onUp = e => { if (cap) own(e); };
  const onPointer = e => { if (cap && !e.target.closest?.('.sc-row.is-recording')) stopCapture(); };

  /* leaving the pane mid-recording (another section, the window closing) stops it */
  const mo = new MutationObserver(() => { if (!box.isConnected) stopCapture(); });

  function startCapture(id) {
    if (cap) stopCapture();
    cap = { id };
    flash = null;
    KM.capture(true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', stopCapture);
    mo.observe(document.body, { childList: true, subtree: true });
    paint();
    say(`Press the new keys for ${KM.action(id, mac)?.label || 'this shortcut'}. Escape cancels.`);
  }
  function stopCapture(said) {
    if (!cap) return;
    cap = null;
    KM.capture(false);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onUp, true);
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('blur', stopCapture);
    mo.disconnect();
    if (box.isConnected) paint();
    if (typeof said === 'string') say(said);
  }
  /* the keys go here, and this action's old keys go to the one that had them */
  function doSwap(a, combo, other) {
    const mine = a.keys.join(' / ');
    stopCapture();
    KM.setBinding(other.id, mine);
    KM.setBinding(a.id, combo);
    flash = { id: a.id };
    paint();
    say(`${a.label}: ${KM.keysText(combo, mac)}. ${other.label}: ${KM.keysText(mine, mac)}`);
  }

  paint();
  return [box];
}

/** How many rows Settings › Shortcuts lists (its toolbar badge) */
export const count = (api) => KM.actionRows(api.fmt.isMac).length + KM.appRows(api.getApp('settings')).length;

export default { pane, count };
