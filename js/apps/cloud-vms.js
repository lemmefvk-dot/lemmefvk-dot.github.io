import { defineApp } from '../core/registry.js';
import { chooseBackupFile, exportBackup } from '../core/backup.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-cloud-vms-css')) {
  const link = document.createElement('link');
  link.id = 'feat-cloud-vms-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-cloud-vms.css';
  document.head.appendChild(link);
}

/* ---- what each provider's own pages say, and when it was looked at ----
   A fact goes here only if it was read on the provider's own page; `source` is
   that page. `checked` is the day someone last read those pages and tried the
   link. Facts a provider's pages did not show are left out, never guessed: a
   service with none just shows its date and what was not verifiable.

   Checked 2026-11-06:
     Genymotion  cloud.geny.io/launchpad answered; genymotion.com/product-cloud
                 lists its plans (pay-as-you-go $0.06/min, Unlimited, Premium)
                 and says the default payment method is a credit card
                 (prepaid and virtual cards are not accepted), and refers to
                 "your account dashboard".
     Windows 365 windows365.microsoft.com answered, but its page is a script app
                 with no text to read and Microsoft's FAQ refused the request,
                 so no badge is claimed for it. */
const CHECKED = '2026-11-06';
const PRODUCT = 'https://www.genymotion.com/product-cloud/';
const FACTS = {
  genymotion: {
    checked: CHECKED,
    facts: [
      { id: 'account', icon: 'user', text: 'Needs an account', source: PRODUCT },
      { id: 'card', icon: 'alert', text: 'Card is the default way to pay (prepaid and virtual cards refused)', source: PRODUCT },
    ],
    unverified: 'Free tier or trial: the trial in the note above was written earlier and could not be re-read today. Its pricing page lists paid plans only.',
  },
  windows365: {
    checked: CHECKED,
    facts: [],
    unverified: 'Account, card and free-tier details: Microsoft’s pages did not load as readable text when checked, so none is claimed.',
  },
};
const REPORTS = 'portal.cloudvms.reports';      // id -> time you reported its link, kept on this device

defineApp({
  id: 'cloud-vms',
  name: 'Cloud VMs',
  icon: 'cloud',
  g1: '#91a7ff', g2: '#4056a1',
  category: 'Internet',
  keywords: ['cloud vm', 'virtual machine', 'android emulator', 'windows cloud pc', 'genymotion', 'windows 365'],
  desc: 'Open third-party cloud Android devices and Windows PCs',
  singleton: true,
  win: { w: 720, h: 540, minW: 480, minH: 420 },

  mount(ctx) {
    const { root, api } = ctx;
    const { h, icon } = api;
    let saving = false;
    const backupInput = h('input.sr', {
      type: 'file',
      accept: '.json,application/json',
      'aria-label': 'Choose StaticOS data backup',
      onchange: () => chooseBackupFile(api, backupInput),
    });

    async function saveData(button) {
      if (saving) return;
      saving = true;
      button.disabled = true;
      try {
        await exportBackup(api);
      } catch (err) {
        console.error('[StaticOS] data backup failed:', err);
        api.notify({ app: 'StaticOS', icon: 'alert', title: 'Could not download data', message: err.message || 'The browser could not read the saved data.' });
      } finally {
        saving = false;
        button.disabled = false;
      }
    }

    const day = iso => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const reports = () => {
      const v = api.store.get(REPORTS, {});
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    };

    /* "Report a broken link": remembered here, and the sentence is copied so it can be
       pasted into Feedback, which is how the developers actually hear about it. */
    function reportBox(id, title, href) {
      const box = h('div.cvm__reported', { 'aria-live': 'polite' });
      const paint = () => {
        const at = reports()[id];
        api.clear(box);
        if (at) box.append(h('span', { text: `You reported this link on ${new Date(at).toLocaleDateString()}. It is remembered here; the developers only hear it through Feedback.` }));
      };
      paint();
      return { box, button: h('button.btn.btn--ghost.btn--sm', {
        type: 'button', dataset: { act: 'report', service: id },
        onclick: async () => {
          const line = `Cloud VMs: the ${title} link (${href}) did not open for me on ${new Date().toISOString().slice(0, 10)}.`;
          api.store.set(REPORTS, { ...reports(), [id]: Date.now() });
          paint();
          let copied = true;
          try { await navigator.clipboard.writeText(line); } catch (e) { copied = false; }
          api.notify({
            app: 'Cloud VMs', icon: 'alert', timeout: 8000, title: 'Noted on this device',
            message: copied ? 'The sentence is copied. Paste it into Feedback to tell the developers.' : line,
            actions: [{ label: 'Open Feedback', onClick: () => api.openApp('feedback') }],
          });
        },
      }, icon('alert'), 'Report a broken link') };
    }

    const service = ({ id, title, iconName, badge, description, note, href, action }) => {
      const info = FACTS[id] || { checked: '', facts: [], unverified: '' };
      const rep = reportBox(id, title, href);
      return h('section.cvm__card', { dataset: { service: id } },
        h('div.cvm__card-head',
          h('span.cvm__service-icon', icon(iconName)),
          h('div.cvm__heading', h('h2', { text: title }), h('span.cvm__badge', { text: badge }))),
        h('p.cvm__description', { text: description }),
        h('p.cvm__note', { text: note }),
        info.facts.length ? h('div.cvm__badges', { role: 'list', 'aria-label': `${title}: from the provider’s own pages` },
          info.facts.map(f => h('span.cvm__fact', { role: 'listitem', dataset: { fact: f.id } },
            icon(f.icon, { size: 11 }), h('span', { text: f.text }),
            h('a', { href: f.source, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Where ${title} says this (opens in a new tab)`, text: 'source' })))) : null,
        info.unverified ? h('p.cvm__check', { text: `Not verified: ${info.unverified}` }) : null,
        info.checked ? h('p.cvm__check', { dataset: { checked: info.checked }, text: `Last checked ${day(info.checked)}: the link answered, and the facts above were read on the provider’s own pages. They can change.` }) : null,
        h('div.cvm__tools',
          h('a.btn.btn--primary.cvm__link', {
            href,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, icon('external-link'), action),
          rep.button),
        rep.box);
    };

    root.appendChild(h('div.app__content.cvm',
      h('header.cvm__intro',
        h('h1', { text: 'Cloud virtual machines' }),
        h('p', { text: 'These services run on their own infrastructure and open outside StaticOS. Availability, accounts, and pricing are controlled by each provider.' })),
      h('div.cvm__grid',
        service({
          id: 'genymotion',
          title: 'Genymotion Cloud',
          iconName: 'cpu',
          badge: 'Android · limited free trial',
          description: 'Launch Android virtual devices in the cloud from a supported desktop browser.',
          note: 'Individuals can request a 60-minute trial; approval can take up to five business days. A paid plan is required after the trial.',
          href: 'https://cloud.geny.io/launchpad',
          action: 'Open Genymotion',
        }),
        service({
          id: 'windows365',
          title: 'Windows 365',
          iconName: 'monitor',
          badge: 'Windows 10/11 · paid',
          description: 'Access a hosted Windows Cloud PC from Microsoft’s web portal.',
          note: 'Requires a Windows 365 subscription. Microsoft currently says Windows 365 is not available to individuals; Business is for organizations.',
          href: 'https://windows365.microsoft.com/',
          action: 'Open Windows 365',
        })),
      h('section.cvm__download',
        h('div',
          h('h2', { text: 'Take StaticOS with you' }),
          h('p', { text: 'Get a one-file launcher for the hosted site, or the full bundle to run locally.' })),
        h('a.btn.btn--primary.cvm__link', {
          href: 'staticos-launcher.html',
          download: 'staticos-launcher.html',
        }, icon('download'), 'Download one-file launcher'),
        h('a.btn.cvm__link', {
          href: 'takeout-staticos.zip',
          download: 'takeout-staticos.zip',
        }, icon('download'), 'Download full website (.zip)'),
        h('a.cvm__instructions', {
          href: 'download.html',
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'Setup instructions')),
      h('section.cvm__download.cvm__backup',
        h('div',
          h('h2', { text: 'Save your data' }),
          h('p', { text: 'Download your saved StaticOS browser data as a private JSON backup.' })),
        h('button.btn.cvm__link', {
          type: 'button',
          onclick: e => saveData(e.currentTarget),
        }, icon('download'), 'Download my data (.json)'),
        h('button.btn.cvm__link', {
          type: 'button',
          onclick: () => backupInput.click(),
        }, icon('upload'), 'Import my data (.json)')),
      backupInput,
      h('p.cvm__disclaimer', { text: 'StaticOS does not host these VMs. Check the provider’s current terms, trial eligibility, and licensing before use.' })));
  },
});
