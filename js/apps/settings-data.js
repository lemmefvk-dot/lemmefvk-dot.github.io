/* ============================================================
   settings-data.js — the Settings rows for looking after your data,
   kept apart from settings.js so that file's diff stays small.
   settings.js hands in its own kit of row / switch / button builders
   (the same way settings-notify.js and settings-quiet.js do).

     backupRows      Privacy › Back up your data: when you last did, a
                     protected (passphrase) backup, restore with a
                     preview, add a file as a new profile, the reminder
     keepRows        Storage › Keep my data (persistent storage)
     snapshotRows    Storage › Daily snapshots of files and notes
     offlineRows     Storage › which apps work offline
     updateRows      About › last checked, what changed, the previous version
     installRows     About › install as an app, send to my phone
     startupRows     Desktop › reopen what I had open, skip the boot animation
     lockRows        Desktop › lock after idle minutes
     saverRows       Network › Data saver

   Every row edits a pref or calls a core module that works without
   this window (core/backup.js, snapshots.js, datasaver.js, install.js,
   resume.js, offline.js); nothing here keeps its own data.
   ============================================================ */
import * as B from '../core/backup.js';
import * as SNAP from '../core/snapshots.js';
import * as SAVER from '../core/datasaver.js';
import * as INSTALL from '../core/install.js';
import * as P from '../core/profiles.js';
import { AUTO_LOCK } from '../shell/users.js';
import { t, plural } from '../core/i18n.js';

const when = iso => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/* ---------- Privacy › Back up your data ------------------------------- */
export function backupRows(k) {
  const { h, icon, store, row, srow, group, caption, btn, select, note, api, restoreInput } = k;
  const last = B.lastBackup();
  const state = B.changesSince();
  const chip = state === 'same' ? h('span.badge.badge--ok', { text: t('Nothing changed since') })
    : state === 'changed' ? h('span.badge.badge--warn', { text: t('Files or notes changed since') })
      : h('span.badge', { text: t('Never backed up') });
  const profileInput = h('input.sr', {
    type: 'file', accept: '.json,application/json', 'aria-label': t('Choose a backup to add as a new profile'),
    onchange: async () => { await B.chooseBackupFile(api, profileInput, 'profile'); api.bus.emit('users:changed'); },
  });
  const guest = !P.idbName();
  return [
    caption(t('Back up your data')),
    group(
      row('clock', t('Last backup'), last
        ? t('{v} ({v2}). Only your files and notes are compared with now: settings change all the time.', { v: when(last.at), v2: B.agoText(last.at) })
        : t('You haven’t downloaded a backup from here yet.'), chip),
      row('download', t('Download my data'), t('Save this browser’s StaticOS data as a private JSON backup, Old Games’ saves included. If you use Friends it holds your Friends private key, so keep the file to yourself. Each StaticOS link (staticos.surge.sh and the AWS mirror) keeps its own data — this is how you move it between them.'),
        btn('download', t('Download backup'), () => B.exportBackup(api).then(() => k.repaint()))),
      row('lock', t('Protect a backup with a passphrase'), t('The file is encrypted in this browser (AES-256-GCM, with a key made from your passphrase). If you lose the passphrase, nobody can open the backup — not you, not StaticOS — and it can’t be recovered. A backup without one is plain text.'),
        btn('lock', t('Download protected backup…'), () => B.exportBackup(api, { protect: true }).then(() => k.repaint()))),
      row('upload', t('Import my data'), t('Replace this browser’s saved StaticOS data from a backup JSON file (protected ones ask for their passphrase). You see what is inside first, and can restore only the settings, the files or the notes.'),
        btn('upload', t('Choose backup file'), () => restoreInput.click())),
      row('users', t('Add a backup as a new profile'), t('Open a backup file as a new person on this computer, beside the people already here. Nobody’s data is replaced, and the new profile starts without a PIN.'),
        btn('users', t('Add as a new profile…'), () => profileInput.click()), guest ? h('small.dim', { text: t('Not in a guest session') }) : null),
      srow('backupRemindDays', select(k.SET.backupRemindDays.label, [['0', t('Never')], ['7', 'After 7 days'], ['14', 'After 14 days'], ['30', 'After 30 days']],
        String(store.get('prefs.backupRemindDays', 0) || 0), v => { B.setReminder(Number(v)); }))),
    note(t('A reminder is a notification, so Do Not Disturb holds it until you turn that off. A backup is a copy you keep yourself: StaticOS has no server to keep one for you.')),
    profileInput,
  ];
}

/* ---------- Storage › Keep my data ------------------------------------ */
export function keepRows(k) {
  const { h, icon, srow, group, btn, note, async_, api, repaint } = k;
  return [
    async_(() => (navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : null), persisted => {
      if (persisted === null) return note(t('This browser does not let a page ask to keep its data.'));
      const ask = btn('lock', persisted ? t('Kept') : t('Keep my data'), async e => {
        const b = e.currentTarget;
        b.disabled = true;
        const ok = await navigator.storage.persist().catch(() => false);
        api.notify({ app: t('Settings'), icon: ok ? 'check-circle' : 'info',
          title: ok ? t('Your data is kept') : t('The browser said no'),
          message: ok ? t('The browser will not clear StaticOS’s saved files and settings when the disk gets tight.')
            : t('Browsers usually say yes to sites you use often or have installed. Installing StaticOS as an app (About) helps.') });
        repaint();
      });
      ask.disabled = persisted;
      return group(srow('storage.persist', h('span.badge' + (persisted ? '.badge--ok' : ''), { text: persisted ? t('Kept') : t('Not kept') }), ask));
    }, t('Asking the browser…')),
    note(t('Chromebooks and school computers may clear a site’s saved data when space runs low. “Keep my data” asks the browser not to. It can still be cleared by you, by an administrator, or by “clear browsing data”: a backup is the only copy that survives that.')),
  ];
}

/* ---------- Storage › Daily snapshots --------------------------------- */
const mb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
export function snapshotRows(k) {
  const { h, icon, store, srow, group, caption, btn, sw, note, async_, api, repaint } = k;
  const guest = !P.idbName();
  const say = (title, message, ic = 'check-circle') => api.notify({ app: t('Settings'), icon: ic, title, message });
  const body = async_(async () => ({ list: await SNAP.list() }), ({ list }) => {
    const total = list.reduce((n, s) => n + s.bytes, 0);
    const space = h('div.snap__space', { 'data-snap': 'space' },
      h('b', { text: list.length ? plural(list.length, '{n} snapshot · {v}', '{n} snapshots · {v}', { v: mb(total) }) : t('No snapshots yet') }),
      h('small', { text: t(' — inside your own storage; at most {MAX_KEEP} are kept, within {v}.', { MAX_KEEP: SNAP.MAX_KEEP, v: mb(SNAP.MAX_BYTES) }) }));
    const rows = list.map(s => {
      const more = h('div.snap__files', { hidden: true });
      const fill = async () => {
        const files = await SNAP.browse(s.id);
        more.replaceChildren(...(files.length ? files.slice(0, 200).map(f => h('div.snap__file',
          h('span.snap__path', { text: f.path, title: f.path }), h('small.dim', { text: mb(f.bytes) }),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', disabled: !f.kept, dataset: { act: 'copy-back' }, title: f.kept ? '' : t('Its bytes are kept in the database, which a snapshot doesn’t hold'),
            onclick: async () => {
              try { const to = await SNAP.restoreFile(s.id, f.path); say(t('Copied back'), t('Saved beside your own, as {to}. Nothing you have now was replaced.', { to })); }
              catch (x) { say(t('Could not copy it back'), x.message, 'alert'); }
            } }, t('Copy back')))) : [h('small.dim', { text: t('No files made or changed in this snapshot.') })]),
          files.length > 200 ? h('small.dim', { text: t('…and {v} more.', { v: files.length - 200 }) }) : null);
      };
      return h('div.snap__item', { dataset: { id: s.id } },
        h('div.snap__row',
          h('div.snap__t', h('b', { text: s.label || when(s.at) }), h('small', { text: `${s.label ? when(s.at) + ' · ' : ''}${plural(s.files, '{n} file', '{n} files')} · ${plural(s.notes, '{n} note', '{n} notes')} · ${mb(s.bytes)}` })),
          h('div.snap__acts',
            btn('folder-open', t('Browse'), async () => { more.hidden = !more.hidden; if (!more.hidden) await fill(); }, '.btn--ghost'),
            btn('rotate-ccw', t('Restore'), async () => {
              const ok = await api.confirm({
                title: t('Put your files and notes back?'),
                message: t('This replaces your files and notes with the snapshot from {v}. A snapshot of what you have now is taken first, so you can come back. Settings, projects, pictures and clips are not touched. StaticOS reloads.', { v: when(s.at) }),
                ok: t('Restore and reload'), danger: true });
              if (!ok) return;
              try { await SNAP.restoreAll(s.id); } catch (x) { say(t('Could not restore'), x.message, 'alert'); }
            }, '.btn--ghost'),
            btn('trash', t('Delete'), async () => { await SNAP.remove(s.id); repaint(); }, '.btn--ghost'))),
        more);
    });
    return h('div.col', { style: { gap: 'var(--sp-3)' } }, space, list.length ? h('div.set-group.snap__list', rows) : null);
  }, t('Reading the snapshots…'));
  return [
    caption(t('Daily snapshots')),
    group(srow('snapshots', sw(k.SET.snapshots.label, () => store.get('prefs.snapshots', true) !== false, v => { k.setPref('snapshots', v); }))),
    guest ? note(t('A guest session keeps nothing, so it takes no snapshots.')) : body,
    h('div.row', { style: { flexWrap: 'wrap' } },
      btn('camera', t('Take one now'), async () => {
        const made = await SNAP.takeNow(t('Taken by hand'));
        say(made ? t('Snapshot taken') : t('Nothing to take'), made ? t('{files} files and {notes} notes, {v}.', { files: made.files, notes: made.notes, v: mb(made.bytes) }) : t('Snapshots are not kept in a guest session.'), made ? 'camera' : 'info');
        repaint();
      }),
      btn('trash', t('Delete all snapshots'), async () => {
        const ok = await api.confirm({ title: t('Delete every snapshot?'), message: t('Your files and notes themselves are not touched, only the copies.'), ok: t('Delete them'), danger: true });
        if (ok) { await SNAP.clear(); repaint(); }
      }, '.btn--ghost')),
    note(t('Once a day, the first time StaticOS is open, your files and notes are copied into your own storage — never a server. A copy identical to the last is not kept. A snapshot holds the files tree and notes; pictures, video and music kept in the database, projects and settings are in a backup instead.')),
  ];
}

/* ---------- Storage › which apps work offline -------------------------- */
export function offlineRows(k) {
  const { h, group, row, note, async_, caption } = k;
  return [
    caption(t('Apps without a connection')),
    async_(() => import('../core/offline.js').then(O => O.appsSaved()), got => {
      if (!got) return note(t('Nothing to list: this browser has no saved copy of StaticOS here.'));
      const names = rows => rows.map(r => r.name).sort((a, b) => a.localeCompare(b)).join(', ');
      return h('div.col', { style: { gap: 'var(--sp-3)' } },
        group(row('check-circle', t('{length} apps work with no connection', { length: got.works.length }), names(got.works) || t('None yet.'),
          h('span.badge' + (got.complete ? '.badge--ok' : ''), { text: got.complete ? t('Available offline') : t('Still saving') })),
        got.online.length ? row('globe', t('{length} open, but need the internet for what they show', { length: got.online.length }), names(got.online)) : null,
        got.missing.length ? row('info', t('{length} not saved here yet', { length: got.missing.length }), names(got.missing)) : null),
        note(t('Read from the copy saved on this device, app by app. An app that works offline still can’t fetch anything from the internet.')));
    }, t('Reading the saved copy…')),
  ];
}

/* ---------- About › updates ------------------------------------------- */
const updater = () => window.Static && window.Static.updater;
export function updateRows(k) {
  const { h, row, srow, group, btn, sw, note, async_, api, repaint, store } = k;
  const u = updater();
  const at = u && u.checkedAt ? new Date(u.checkedAt).toLocaleTimeString([], { timeStyle: 'short' }) : null;
  return [
    row('clock', t('Last checked'), at ? t('{at} today, by this tab. StaticOS looks every 20 seconds while it is open, if checking is on.', { at }) : t('Not yet in this tab.'),
      btn('download', t('Check for updates now'), () => { api.bus.emit('update:check'); setTimeout(repaint, 1800); })),
    u && u.pending ? row('download', t('An update is ready'), t('Restart to load it. Your windows and files are kept.'),
      btn('refresh', t('Restart now'), () => u.restart()), btn('sparkles', t('What changed'), () => u.showChanges(), '.btn--ghost')) : null,
    srow('keepPrevious', sw(k.SET.keepPrevious.label, () => store.get('prefs.keepPrevious', false) === true, v => {
      k.setPref('keepPrevious', v);
      import('../core/offline.js').then(O => O.keepPrevious(v)).then(() => setTimeout(repaint, 600));
    })),
    async_(() => import('../core/offline.js').then(O => O.status()), st => {
      const have = !!(st && st.previous);
      return row('rotate-ccw', t('Use the previous version once'),
        have ? t('The build before this one is still stored ({previous}). It starts for one load; the next load goes back to the newest.', { previous: st.previous })
          : st && st.keep ? t('Nothing stored yet: the build before the next update will be kept.')
            : t('Turn on “Keep the previous version” above first. The old copy is otherwise removed once an update is in.'),
        btn('rotate-ccw', t('Use previous version once'), async () => {
          const ok = await api.confirm({ title: t('Start the previous version?'), message: t('StaticOS reloads from the older copy stored on this device, once. Your data is kept. After that it goes back to the newest.'), ok: t('Reload on the previous version') });
          if (ok && !(await (await import('../core/offline.js')).usePrevious())) api.notify({ app: 'Settings', icon: 'alert', title: t('No previous version'), message: t('The old copy is gone from this device.') });
        }, have ? '' : '.is-off'));
    }, t('Asking the offline copy…')),
  ];
}

/* ---------- About › install -------------------------------------------- */
/** A canvas holding a QR code for `url`, drawn with Static QR's own encoder (js/apps/qr.js): black on white,
    with a quiet margin, so a phone's camera reads it. */
export function qrCanvas(url, px = 168) {
  const el = document.createElement('canvas');
  el.className = 'inst__qr';
  el.width = el.height = px;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', t('QR code for {url}', { url }));
  import('./qr.js').then(Q => {
    const code = Q.encodeQR(url, { level: 'M' });
    if (!code.ok) { el.hidden = true; return; }
    Q.drawCode(el.getContext('2d'), code, px, 4, '#000000', '#ffffff');
    el.dataset.drawn = '1';
  }).catch(() => { el.hidden = true; });
  return el;
}

export function installRows(k) {
  const { h, icon, row, group, btn, note, caption, api } = k;
  const st = INSTALL.state();
  const lab = {
    installed: t('StaticOS is running as an installed app.'),
    ready: t('Your browser can install StaticOS as an app, with its own window and an icon.'),
    ios: 'In Safari, tap Share, then Add to Home Screen.',
    unavailable: t('Your browser hasn’t offered to install StaticOS here. In Chrome or Edge, look for the install icon in the address bar or the browser menu.'),
  }[st];
  const { url, reachable } = INSTALL.link();
  const qr = reachable ? qrCanvas(url) : null;
  const copy = btn('copy', t('Copy link'), async () => {
    try { await navigator.clipboard.writeText(url); api.notify({ app: t('Settings'), icon: 'check-circle', title: t('Link copied'), message: url }); }
    catch (e) { api.notify({ app: t('Settings'), icon: 'alert', title: t('Could not copy'), message: url }); }
  });
  return [
    caption(t('Install StaticOS')),
    group(
      row('download', t('Install as an app'), lab,
        st === 'ready' ? btn('download', t('Install'), async () => {
          const r = await INSTALL.install();
          api.notify({ app: t('Settings'), icon: r === 'accepted' ? 'check-circle' : 'info', title: r === 'accepted' ? t('StaticOS is installed') : r === 'dismissed' ? t('Not installed') : t('Could not install'), message: r === 'accepted' ? t('Open it from your apps or desktop.') : t('You can install it any time from here.') });
          k.repaint();
        }) : h('span.badge' + (st === 'installed' ? '.badge--ok' : ''), { text: st === 'installed' ? t('Installed') : st === 'ios' ? t('Use Share') : t('Not offered') })),
      row('send', t('Send to my phone'), reachable
        ? t('Scan this with your phone’s camera to open StaticOS there, or text yourself the link. Each device keeps its own data: Download my data and Import it on the phone to move it.')
        : t('This address ({url}) can only be opened on this computer, so a phone could not follow it. Open StaticOS at its public address and this will work.', { url }),
      h('div.inst__send', reachable ? qr : null,
        h('div.inst__btns', copy, reachable ? h('a.btn.btn--sm', { href: INSTALL.textLink(url), dataset: { act: 'text-link' } }, icon('send'), h('span', { text: t('Text me the link') })) : null)))),
  ];
}

/* ---------- Desktop › startup, lock ------------------------------------ */
export function startupRows(k) {
  const { srow, prefSwitch } = k;
  return [
    srow('reopenWindows', prefSwitch('reopenWindows')),
    srow('bootFast', prefSwitch('bootFast')),
  ];
}
export function lockRows(k) {
  const { srow, select, store } = k;
  return [
    srow('autoLock', select(k.SET.autoLock.label, AUTO_LOCK.map(m => [String(m), m ? plural(m, 'After {n} minute', 'After {n} minutes') : t('Never')]),
      String(Number(store.get('prefs.autoLock', 0)) || 0), v => k.setPref('autoLock', Number(v)))),
  ];
}

/* ---------- Network › data saver --------------------------------------- */
export function saverRows(k) {
  const { h, srow, select, note, store, caption, group } = k;
  const why = SAVER.reason();
  return [
    caption(t('Data saver')),
    group(srow('dataSaver', select(k.SET.dataSaver.label, [['auto', t('Follow my browser')], ['on', t('On')], ['off', t('Off')]],
      String(store.get('prefs.dataSaver', 'auto')), v => { k.setPref('dataSaver', v); k.repaint(); }))),
    note((why === 'on' ? t('On. Videos that start by themselves don’t, pictures load as they come into view, and the offline copy fills in as you use things rather than all at once.')
      : why === 'browser' ? t('On because your browser’s own Data Saver is on. Videos that start by themselves don’t, pictures load as they come into view, and the offline copy fills in as you use things.')
        : t('Off. When it is on, videos that start by themselves (the wallpaper clip) show a still instead, pictures load as they come into view, and the offline copy fills in as you use things rather than all at once.'))
      + t(' A page can’t ask other sites for smaller pictures, so those arrive at the size they send.')),
  ];
}
