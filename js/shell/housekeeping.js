/* ============================================================
   housekeeping.js — the quiet parts of looking after your data.
   Each is a core module that works without a window; this only
   starts them once the desktop is up and draws the one thing that
   needs a place on screen.

     data saver       core/datasaver.js — no autoplaying video, lazy pictures
     backup reminder  core/backup.js — "Time for a backup?" after N days without one
     snapshots        core/snapshots.js — today's copy of files and notes
     offline banner   when the connection goes, which apps still work
                      (read from the saved copy: core/offline.js appsSaved)

   A guest keeps nothing, so a guest gets no reminder and no snapshots.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import * as SAVER from '../core/datasaver.js';
import * as P from '../core/profiles.js';
import { t } from '../core/i18n.js';

export function mountHousekeeping(host) {
  const offs = [];
  SAVER.init();

  /* ---- the offline banner ---- */
  let bar = null;
  let dismissed = false;
  const nameList = rows => rows.map(r => r.name).sort((a, b) => a.localeCompare(b)).join(', ');
  async function showOffline() {
    if (bar || dismissed) return;
    const body = h('div.hk-offline__txt', h('b', { text: t('You’re offline') }), h('span', { text: t(' Checking which apps still work…') }));
    const more = h('div.hk-offline__more', { hidden: true });
    const toggle = h('button.hk-offline__btn', { type: 'button', 'aria-expanded': 'false', hidden: true,
      onclick: () => { more.hidden = !more.hidden; toggle.setAttribute('aria-expanded', String(!more.hidden)); toggle.textContent = more.hidden ? 'Which apps?' : 'Hide the list'; } }, t('Which apps?'));
    const x = h('button.hk-offline__x', { type: 'button', 'aria-label': t('Dismiss'), onclick: () => { dismissed = true; hide(); } }, icon('x'));
    bar = h('div.hk-offline', { role: 'status', dataset: { hk: 'offline' } }, icon('wifi-off'), h('div.hk-offline__main', body, more), toggle, x);
    host.appendChild(bar);
    const O = await import('../core/offline.js').catch(() => null);
    const got = O ? await O.appsSaved().catch(() => null) : null;
    if (!bar) return;
    if (!got || !got.works.length) {
      body.replaceChildren(h('b', { text: t('You’re offline') }),
        h('span', { text: t(' This browser has no saved copy of StaticOS to run from, so only what is already open keeps working.') }));
      return;
    }
    body.replaceChildren(h('b', { text: t('You’re offline') }),
      h('span', { text: ` ${got.works.length} apps still work from the copy saved on this device.${got.complete ? '' : ' The copy was not finished, so a few may not open.'}` }));
    more.replaceChildren(
      h('p', { text: t('Work without a connection: ') + nameList(got.works) + '.' }),
      got.online.length ? h('p', { text: t('Open, but what they show comes from the internet: ') + nameList(got.online) + '.' }) : null,
      got.missing.length ? h('p', { text: t('Not saved on this device yet: ') + nameList(got.missing) + '.' }) : null,
      h('p.hk-offline__fine', { text: t('Anything an app fetches from the internet will not load until you are back online.') }));
    toggle.hidden = false;
  }
  function hide() { bar?.remove(); bar = null; }
  const onOffline = () => { dismissed = false; showOffline(); };
  const onOnline = () => { dismissed = false; hide(); };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  offs.push(() => { window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); hide(); });
  /* started offline: say so once the desktop is up */
  if (navigator.onLine === false) offs.push(bus.on('boot:ready', () => showOffline()));

  /* ---- the reminder and the snapshots, once the desktop is up ---- */
  const ready = () => {
    if (!P.idbName()) return;                 /* a guest keeps nothing */
    import('../core/backup.js').then(B => B.startReminder(window.StaticAPI)).catch(err => console.warn('[StaticOS] backup reminder', err));
    import('../core/snapshots.js').then(S => S.init()).catch(err => console.warn('[StaticOS] snapshots', err));
  };
  offs.push(bus.on('boot:ready', ready));

  return () => offs.forEach(f => f?.());
}

export default mountHousekeeping;
