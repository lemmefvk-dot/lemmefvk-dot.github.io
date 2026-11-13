/* ============================================================
   settings-notify.js — the panes Settings adds for the notification
   summary, the Do Not Disturb schedule and the start-up chime. They
   live apart from settings.js to keep that file's diff small; it hands
   in its own kit of row/switch/button builders.

   Each of these only edits a pref; the work is done by core modules
   that run without this window: js/core/notisummary.js (+ the cards in
   js/shell/notifications.js), js/core/dndsched.js and js/core/sfx.js.
   ============================================================ */
import * as SUM from '../core/notisummary.js';
import * as DND from '../core/dndrules.js';
import * as sfx from '../core/sfx.js';

const DAYS = [['Sunday', 'S'], ['Monday', 'M'], ['Tuesday', 'T'], ['Wednesday', 'W'], ['Thursday', 'T'], ['Friday', 'F'], ['Saturday', 'S']];
const clockText = (ms, h24) => { const d = new Date(ms); const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0'); return h24 ? `${String(h).padStart(2, '0')}:${m}` : `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`; };

/** Settings › Notifications › Summary. */
export function summaryPane(k) {
  const { h, icon, store, group, row, caption, btn, sw, note, repaint, apps } = k;
  const c = SUM.config();
  const waiting = (store.get('prefs.notiLog') || []).filter(n => n && n.held).length;
  const nextMs = SUM.nextSlot(new Date(), c.times);

  const chips = h('div.sumset__apps', { role: 'group', 'aria-label': 'Apps held for the summary' }, apps.map(a => {
    const on = c.apps.includes(a.id);
    return h('button.chip.sumset__app', {
      type: 'button', text: a.name, 'aria-pressed': String(on), class: on ? 'chip--accent' : null,
      dataset: { app: a.id },
      onclick: () => {
        const cur = SUM.config();
        SUM.configure({ apps: cur.apps.includes(a.id) ? cur.apps.filter(x => x !== a.id) : [...cur.apps, a.id] });
        repaint();
      },
    });
  }));

  const times = h('div.sumset__times', c.times.map((t, i) => h('div.row.sumset__time', { style: { gap: 'var(--sp-2)' } },
    h('input.input', {
      type: 'time', value: t, 'aria-label': `Delivery time ${i + 1}`,
      onchange: e => {
        const next = SUM.config().times.slice();
        next[i] = e.target.value;
        SUM.configure({ times: next });
        repaint();
      },
    }),
    h('button.ibtn.tip', {
      'data-tip': 'Remove', 'aria-label': `Remove delivery time ${t}`, disabled: c.times.length <= 1,
      onclick: () => { SUM.configure({ times: SUM.config().times.filter((_, j) => j !== i) }); repaint(); },
    }, icon('x')))));

  return [
    caption('Summary'),
    group(
      row('bell', 'Notification summary', 'Quiet notifications from the apps below skip the pop-up and arrive together, as one card, at the times you choose. They still reach the Notification Centre as they happen, silently.',
        sw('Notification summary', () => SUM.config().on, v => { SUM.configure({ on: v }); repaint(); })),
    ),
    c.on ? h('div.col.sumset', { style: { gap: 'var(--sp-3)' } },
      caption('Held for the summary'),
      chips,
      caption(`Delivery times · up to ${SUM.MAX_TIMES} a day`),
      times,
      h('div.row', btn('plus', 'Add a time', () => {
        const cur = SUM.config();
        if (cur.times.length >= SUM.MAX_TIMES) return;
        const taken = new Set(cur.times);
        const pick = ['12:00', '15:00', '20:00', '10:00', '21:00'].find(t => !taken.has(t)) || '12:30';
        SUM.configure({ times: [...cur.times, pick] });
        repaint();
      })),
      note(`${c.apps.length ? '' : 'No apps chosen yet. '}${nextMs ? `Next summary: ${clockText(nextMs, store.get('prefs.h24'))}${new Date(nextMs).getDate() === new Date().getDate() ? '' : ' tomorrow'}. ` : ''}${waiting} notification${waiting === 1 ? '' : 's'} waiting. Reminders, the focus timer and anything urgent are never held back.`),
    ) : null,
  ];
}

/** Settings › Notifications › Do Not Disturb schedule. */
export function schedulePane(k) {
  const { h, icon, store, group, row, caption, btn, sw, note, repaint } = k;
  const list = DND.schedules();
  const save = next => DND.saveSchedules(next);
  const patch = (id, p) => save(DND.schedules().map(s => (s.id === id ? { ...s, ...p } : s)));
  const addPreset = key => {
    const cur = DND.schedules();
    if (cur.length >= DND.MAX_SCHEDULES) return;
    save([...cur, { ...DND.PRESETS[key], id: `s${Date.now().toString(36)}${cur.length}`, on: true }]);
    repaint();
  };
  const act = DND.activeAt();
  const h24 = store.get('prefs.h24');

  const card = s => h('div.dsch', { dataset: { id: s.id }, class: s.on ? null : 'is-off' },
    h('div.row', { style: { gap: 'var(--sp-3)' } },
      h('input.input.dsch__name', { value: s.name, 'aria-label': 'Schedule name', maxlength: '40', onchange: e => patch(s.id, { name: e.target.value.trim() || 'Schedule' }) }),
      h('div.grow'),
      sw(`${s.name} on`, () => DND.schedules().find(x => x.id === s.id)?.on, v => patch(s.id, { on: v })),
      h('button.ibtn.tip', { 'data-tip': 'Delete', 'aria-label': `Delete schedule ${s.name}`, onclick: () => { save(DND.schedules().filter(x => x.id !== s.id)); repaint(); } }, icon('trash'))),
    h('div.dsch__days', { role: 'group', 'aria-label': `${s.name} days` }, DAYS.map(([full, short], d) => h('button.chip.dsch__day', {
      type: 'button', text: short, 'aria-label': full, 'aria-pressed': String(s.days.includes(d)), class: s.days.includes(d) ? 'chip--accent' : null,
      onclick: e => {
        const cur = DND.schedules().find(x => x.id === s.id);
        const days = cur.days.includes(d) ? cur.days.filter(x => x !== d) : [...cur.days, d];
        patch(s.id, { days });
        e.currentTarget.setAttribute('aria-pressed', String(days.includes(d)));
        e.currentTarget.classList.toggle('chip--accent', days.includes(d));
      },
    }))),
    h('div.row', { style: { gap: 'var(--sp-3)', flexWrap: 'wrap' } },
      h('label.row.dsch__t', { style: { gap: 'var(--sp-2)' } }, h('small.dim', { text: 'From' }),
        h('input.input', { type: 'time', value: s.start, 'aria-label': `${s.name} start`, onchange: e => e.target.value && patch(s.id, { start: e.target.value }) })),
      h('label.row.dsch__t', { style: { gap: 'var(--sp-2)' } }, h('small.dim', { text: 'Until' }),
        h('input.input', { type: 'time', value: s.end, 'aria-label': `${s.name} end`, onchange: e => e.target.value && patch(s.id, { end: e.target.value }) })),
      s.start > s.end ? h('small.dim', { text: 'Overnight: ends the next morning.' }) : null));

  return [
    caption('Do Not Disturb schedule'),
    list.length ? h('div.col.dsch__list', { style: { gap: 'var(--sp-3)' } }, list.map(card)) : note('No schedules yet. Add one below, or start from a preset.'),
    h('div.row', { style: { gap: 'var(--sp-3)', flexWrap: 'wrap' } },
      btn('calendar', 'School hours', () => addPreset('school')),
      btn('moon', 'Night', () => addPreset('night'))),
    note(act
      ? `${act.name} is in force until ${DND.untilLabel(act.until, h24)}. Turning Do Not Disturb off by hand now lasts until then.`
      : 'Do Not Disturb turns on by itself when a schedule starts and off when it ends. A focus session that is running at the end keeps it on until the session is over.'),
  ];
}

/** Settings › Sound › Startup chime rows. */
export function startupRows(k) {
  const { h, icon, store, row, select, ibtn, note, repaint } = k;
  const cur = sfx.chimeId();
  const info = sfx.startupInfo;
  const why = {
    blocked: 'Your browser did not let StaticOS make sound when it started, so the chime stayed silent. Browsers only allow sound after you have interacted with the page (a key at the boot menu counts). It is never forced.',
    off: 'Boot sounds are switched off, so the chime stayed silent.',
    muted: 'Mute or a zero volume kept the chime silent.',
    unsupported: 'This browser could not play audio for the chime.',
  }[info.state];
  return [
    row('music', 'Startup chime', 'The sound StaticOS plays once the desktop is up. It follows Boot sounds, Mute and the volume.',
      h('div.row', { style: { gap: 'var(--sp-2)' } },
        select('Startup chime', sfx.CHIMES.map(c => [c.id, c.name]), cur, v => { store.set('prefs.bootChime', v); sfx.unlock(); sfx.previewChime(v); repaint(); }),
        ibtn('play', 'Hear it', () => { sfx.unlock(); sfx.previewChime(sfx.chimeId()); }, cur === 'none', 'Hear the start-up chime'))),
    why && info.chime !== 'none' ? note(`Last start-up: ${why}`, 'alert') : null,
  ];
}
