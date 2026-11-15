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
     · Practice: press keys and see what each one does, without it
       doing it
     · Save the list as a note or a PDF; export your changed keys to a
       file and import them again (on another computer, or after a reset)

   pane({ api, caption, note, btn, go }) -> nodes for Settings' pane
   column. The changes live in prefs.keymap.
   ============================================================ */
import * as KM from '../core/keymap.js';
import * as SL from '../core/shortcutlist.js';
import { t, plural } from '../core/i18n.js';

const MODNAMES = ['Control', 'Alt', 'Shift', 'Meta'];

export function pane({ api, caption, note, btn, go }) {
  const { h, icon, fmt, bus } = api;
  const mac = fmt.isMac;
  const say = t => bus.emit('a11y:say', t);
  const box = h('div.sc-pane', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' } });
  let cap = null;          /* { id, combo?, error?, conflicts? } while recording */
  let flash = null;        /* { id, warn } — the row just changed */
  let practice = null;     /* { combo, hits, esc } while practice mode listens */
  let toolFocus = null;    /* selector of the toolbar button to focus after the next paint */
  let fileMsg = null;      /* { text, undo? } after an import */
  const pbox = h('div.sc-practice');

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
        h('td', { text: a.label, title: a.where ? t('Bound in {where}', { where: a.where }) : null }),
        h('td', h('small.dim', { text: a.hold ? t('Hold') : t('Standard key'), title: t('The same on every desktop, so it can’t be changed') })));
    }
    const recording = cap && cap.id === a.id;
    const clash = clashes.get(a.id);
    const warn = a.changed ? KM.warnFor(a.keys[0], mac) : '';
    const keysCell = recording
      ? h('div.sc-rec', { role: 'status', 'aria-live': 'polite' },
          h('span.kbd.sc-rec__k', { text: cap.combo ? KM.keysText(cap.combo, mac) : t('Press keys…') }))
      : chips(a.keys);
    const status = recording
      ? h('small.sc-status' + (cap.error ? '.is-error' : ''), { role: cap.error ? 'alert' : null },
          cap.error || t('Press the new keys for this. Esc cancels.'))
      : null;
    const swap = recording && cap.conflicts && cap.conflicts.length === 1 && cap.conflicts[0].id
      ? h('button.btn.btn--sm.sc-swap', { type: 'button', onclick: () => doSwap(a, cap.combo, cap.conflicts[0]) },
          icon('repeat'), h('span', { text: t('Swap with “{conflicts}”', { conflicts: cap.conflicts[0].label }) }))
      : null;
    return h('tr.sc-row' + (recording ? '.is-recording' : '') + (clash ? '.is-conflict' : ''), { dataset: { id: a.id } },
      h('td',
        keysCell,
        a.changed && !recording ? h('span.badge.badge--accent.sc-badge', { text: t('Changed') }) : null,
        clash && !recording ? h('span.badge.badge--warn.sc-badge.sc-clash', { text: t('Conflict'), title: t('Same keys as {list}', { list: clash.map(c => `“${c.label}”`).join(', ') }) }) : null),
      h('td', { title: a.where ? t('Bound in {where}', { where: a.where }) : null },
        h('span', { text: a.label }),
        status,
        swap,
        clash && !recording ? h('small.sc-note', { text: t('Same keys as {list}', { list: clash.map(c => `“${c.label}”`).join(', ') }) }) : null,
        warn && !recording ? h('small.sc-note.sc-warn', { text: warn }) : null,
        flash && flash.id === a.id && !recording ? h('small.sc-note.sc-done', { text: t('Now {v}.', { v: KM.keysText(a.keys[0], mac) }) }) : null),
      h('td', h('div.row', { style: { gap: 'var(--sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' } },
        h('button.btn.btn--sm.sc-change', {
          type: 'button', 'aria-pressed': recording ? 'true' : 'false',
          'aria-label': recording ? t('Recording new keys for {label}. Press them now, or Escape to cancel', { label: a.label }) : t('Change the keys for {label} (now {keys})', { label: a.label, keys: KM.keysText(a.keys.join(' / '), mac) }),
          onclick: () => (recording ? stopCapture(t('Cancelled')) : startCapture(a.id)),
        }, h('span', { text: recording ? t('Cancel') : t('Change…') })),
        a.changed ? h('button.ibtn.tip.sc-reset', {
          type: 'button', 'data-tip': t('Reset'), 'aria-label': t('Reset {label} to {keys}', { label: a.label, keys: KM.keysText(a.defaults.join(' / '), mac) }),
          onclick: () => { KM.resetBinding(a.id); flash = null; paint(); say(t('{label}: back to {v}', { label: a.label, v: KM.keysText(a.defaults[0], mac) })); },
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
      h('thead', h('tr', h('th', { text: t('Keys'), style: { width: '34%' } }), h('th', { text: t('Action') }), h('th', { text: '', style: { width: '1%' } }))),
      h('tbody', list)));
    const own = KM.appRows(api.getApp('settings'));
    api.render(box,
      h('div.row', { style: { gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' } },
        h('small.dim', { text: changed ? t('{changed} changed by you', { changed }) : t('All at their defaults') }),
        h('div.grow'),
        h('button.btn.btn--sm.sc-reset-all', { type: 'button', disabled: !changed, onclick: () => {
          KM.resetAll(); flash = null; paint(); say(t('Every shortcut is back to its default'));
        } }, icon('rotate-ccw'), h('span', { text: t('Reset all') }))),
      h('div.row.sc-tools', { style: { gap: 'var(--sp-3)', flexWrap: 'wrap' } },
        h('button.btn.btn--sm.sc-practice-btn', { type: 'button', 'aria-pressed': practice ? 'true' : 'false', onclick: () => { toolFocus = '.sc-practice-btn'; practice ? stopPractice() : startPractice(); } },
          icon('keyboard'), h('span', { text: practice ? t('Stop practice') : t('Practice') })),
        h('button.btn.btn--sm.sc-save-note', { type: 'button', onclick: () => { SL.saveAsNote(SL.sections(mac, api.getApp('settings'))); say(t('Saved as a note')); } },
          icon('sticky-note'), h('span', { text: t('Save as note') })),
        h('button.btn.btn--sm.sc-save-pdf', { type: 'button', onclick: () => { SL.printList(SL.sections(mac, api.getApp('settings'))); } },
          icon('printer'), h('span', { text: t('Save as PDF') })),
        h('div.grow'),
        h('button.btn.btn--sm.sc-export', { type: 'button', onclick: () => { toolFocus = '.sc-export'; exportFile(); } }, icon('download'), h('span', { text: t('Export keys') })),
        h('button.btn.btn--sm.sc-import', { type: 'button', onclick: () => fileIn.click() }, icon('upload'), h('span', { text: t('Import keys…') })), fileIn),
      fileMsg ? h('div.st-note.sc-filemsg', { role: 'status' }, icon('info'), h('small', { text: fileMsg.text }),
        fileMsg.undo ? h('button.btn.btn--sm.sc-undo', { type: 'button', onclick: () => { toolFocus = '.sc-import'; fileMsg.undo(); } }, h('span', { text: t('Undo') })) : null) : null,
      pbox,
      groups.map(g => [caption(g), table(rows.filter(r => r.group === g).map(r => rowFor(r, clashes)))]),
      own.length ? [caption(t('In Settings')), table(own.map(r => rowFor({ fixed: true, keys: r.keys.split(' / '), label: r.label, where: 'apps/settings.js' }, clashes)))] : null,
      note(t('Hold {modLabel} for a second anywhere to see these, with the shortcuts of the app in front. ', { modLabel: fmt.modLabel })
        + t('Change… records new keys: hold the modifiers and press a key. Keys your computer keeps for itself (Alt+Tab, ⌘Tab) are refused; keys the browser may keep — ⌘W, Ctrl+T, ⌘Q — work in full screen or an installed app, and say so beside them.')),
      h('div.row', btn('keyboard', t('Key tester'), () => go('keyboard'))));
    paintPractice();
    const id = cap ? cap.id : fid;
    const b = id && (cap || had) ? box.querySelector(`tr[data-id="${CSS.escape(id)}"] .sc-change`) : null;
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
    /* a toolbar button was pressed: the repaint replaced it, so focus goes to its twin */
    if (toolFocus) { box.querySelector(toolFocus)?.focus({ preventScroll: true }); toolFocus = null; }
  }

  /* ---- practice: what does this key do? ---- */
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': t('Shortcuts file'),
    onchange: async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importText(await f.text(), f.name);
    } });
  function paintPractice() {
    pbox.replaceChildren();
    pbox.hidden = !practice;
    if (!practice) return;
    const p = practice;
    pbox.appendChild(h('div.card.sc-practice__card',
      h('div.card__head', icon('keyboard'), h('div.card__t', { text: t('Practice') })),
      h('p.dim', { style: { margin: 0 }, text: t('Press any keys. Nothing happens except this box telling you what they would do. Esc twice to stop.') }),
      h('div.sc-practice__keys', { role: 'status', 'aria-live': 'polite' },
        p.combo ? h('span.kbd.sc-practice__k', { text: KM.keysText(p.combo, mac) }) : h('small.dim', { text: t('Waiting for a key…') }),
        p.combo ? (p.hits.length
          ? h('ul.sc-practice__hits', p.hits.map(a => h('li', h('b', { text: a.label }), h('small.dim', { text: ` — ${a.fixed ? 'a standard key' : a.group}` }))))
          : h('p.sc-practice__none', { text: t('{v} does nothing in StaticOS itself. An app may still use it inside its own window.', { v: KM.keysText(p.combo, mac) }) }))
          : null,
        p.esc ? h('p.dim.sc-practice__esc', { text: t('Esc closes menus and sheets. Press it again to stop practising.') }) : null)));
  }
  const onPractice = e => {
    if (!practice || e.isComposing) return;
    own(e);
    if (MODNAMES.includes(e.key)) return;
    const bare = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (bare && e.key === 'Escape' && practice.esc) { stopPractice(); say(t('Practice stopped')); return; }
    const combo = KM.fromEvent(e, mac);
    if (!combo) return;
    const hits = KM.identify(e, mac);
    practice = { combo, hits, esc: bare && e.key === 'Escape' };
    paintPractice();
    say(hits.length ? `${KM.keysText(combo, mac)}: ${hits.map(a => a.label).join('; ')}` : t('{v}: nothing', { v: KM.keysText(combo, mac) }));
  };
  function startPractice() {
    if (practice) return;
    if (cap) stopCapture();
    practice = { combo: '', hits: [], esc: false };
    KM.capture(true);                    /* no shortcut fires while practising */
    window.addEventListener('keydown', onPractice, true);
    window.addEventListener('keyup', onUp2, true);
    mo.observe(document.body, { childList: true, subtree: true });
    paint();
    say(t('Practice. Press any keys to see what they do. Escape twice to stop.'));
  }
  const onUp2 = e => { if (practice) own(e); };
  function stopPractice() {
    if (!practice) return;
    practice = null;
    KM.capture(false);
    window.removeEventListener('keydown', onPractice, true);
    window.removeEventListener('keyup', onUp2, true);
    mo.disconnect();
    if (box.isConnected) paint();
  }

  /* ---- keys as a file ---- */
  function exportFile() {
    const data = KM.exportBindings();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'staticos-shortcuts.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const n = Object.keys(data.bindings).length;
    fileMsg = { text: n ? plural(n, 'Saved {n} changed shortcut to staticos-shortcuts.json.', 'Saved {n} changed shortcuts to staticos-shortcuts.json.') : t('Saved staticos-shortcuts.json. Every shortcut is at its default, so the file is empty.') };
    paint();
    say(fileMsg.text);
  }
  function importText(text, name) {
    const r = KM.readBindings(text, mac);
    if (!r.ok) { fileMsg = { text: r.error }; paint(); say(r.error); return; }
    const before = KM.exportBindings().bindings;
    const res = KM.applyBindings(r.bindings);
    const sk = r.skipped.length;
    fileMsg = {
      text: plural(res.applied, 'Imported {n} shortcut from {name}, replacing the ones you had changed.', 'Imported {n} shortcuts from {name}, replacing the ones you had changed.', { name: name || t('the file') })
        + (sk ? t(' {sk} skipped: {list}.', { sk, list: r.skipped.map(x => `${x.label || x.id} (${x.why})`).join('; ') }) : '')
        + (res.clashes ? t(' {clashes} now share keys with another shortcut; they are marked Conflict below.', { clashes: res.clashes }) : ''),
      undo: () => { KM.applyBindings(before); fileMsg = { text: t('Your earlier shortcuts are back.') }; paint(); say(fileMsg.text); },
    };
    paint();
    say(fileMsg.text);
  }

  /* ---- recording ---- */
  const own = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  function onKey(e) {
    if (!cap || e.isComposing) return;
    const bare = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (bare && e.key === 'Escape') { own(e); stopCapture(t('Cancelled')); return; }
    if (bare && e.key === 'Tab') { stopCapture(); return; }          /* focus moves on */
    own(e);
    if (MODNAMES.includes(e.key)) return;
    const combo = KM.fromEvent(e, mac);
    if (!combo) return;
    const r = KM.check(cap.id, combo, mac);
    if (r.error) {
      cap = { id: cap.id, combo, error: t('{error} Press other keys, or Esc to cancel.', { error: r.error }), conflicts: r.conflicts || null };
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
  const mo = new MutationObserver(() => { if (!box.isConnected) { stopCapture(); stopPractice(); } });

  function startCapture(id) {
    if (practice) stopPractice();
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
    say(t('Press the new keys for {label}. Escape cancels.', { label: KM.action(id, mac)?.label || t('this shortcut') }));
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
