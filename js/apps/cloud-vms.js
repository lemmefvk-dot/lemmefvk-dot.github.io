import { defineApp } from '../core/registry.js';
import { chooseBackupFile, exportBackup } from '../core/backup.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-cloud-vms-css')) {
  const link = document.createElement('link');
  link.id = 'feat-cloud-vms-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-cloud-vms.css';
  document.head.appendChild(link);
}

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

    const service = ({ title, iconName, badge, description, note, href, action }) =>
      h('section.cvm__card',
        h('div.cvm__card-head',
          h('span.cvm__service-icon', icon(iconName)),
          h('div.cvm__heading', h('h2', { text: title }), h('span.cvm__badge', { text: badge }))),
        h('p.cvm__description', { text: description }),
        h('p.cvm__note', { text: note }),
        h('a.btn.btn--primary.cvm__link', {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, icon('external-link'), action));

    root.appendChild(h('div.app__content.cvm',
      h('header.cvm__intro',
        h('h1', { text: 'Cloud virtual machines' }),
        h('p', { text: 'These services run on their own infrastructure and open outside StaticOS. Availability, accounts, and pricing are controlled by each provider.' })),
      h('div.cvm__grid',
        service({
          title: 'Genymotion Cloud',
          iconName: 'cpu',
          badge: 'Android · limited free trial',
          description: 'Launch Android virtual devices in the cloud from a supported desktop browser.',
          note: 'Individuals can request a 60-minute trial; approval can take up to five business days. A paid plan is required after the trial.',
          href: 'https://cloud.geny.io/launchpad',
          action: 'Open Genymotion',
        }),
        service({
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
