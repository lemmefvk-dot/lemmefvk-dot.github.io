/* ============================================================
   install.js — installing StaticOS as an app (Settings › About).

   index.html links manifest.webmanifest (name, colours and icons
   drawn from StaticOS's own artwork), and sw.js is the worker an
   installable page needs. When the browser decides StaticOS can be
   installed it hands the page an install prompt exactly once; index.html
   keeps it (window.__staticInstall) so it is still there when the
   person opens Settings. Only the browser can install: this module
   asks, and says what it answered.

     state()     'installed' | 'ready' | 'ios' | 'unavailable'
     install()   show the browser's install prompt; 'accepted' | 'dismissed' | 'unavailable'
     link()      the address to open on another device, and whether
                 another device could reach it
     textLink()  an sms: link that fills in a message with the address
   ============================================================ */
import { bus } from './bus.js';

const standalone = () => {
  try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch (e) { return false; }
};
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '') && !standalone();

export function state() {
  if (standalone()) return 'installed';
  if (window.__staticInstall) return 'ready';
  if (ios()) return 'ios';
  return 'unavailable';
}

export async function install() {
  const e = window.__staticInstall;
  if (!e) return 'unavailable';
  try {
    await e.prompt();
    const choice = await e.userChoice;
    /* the browser gives the prompt out once: after it is used there is no second one */
    window.__staticInstall = null;
    bus.emit('install:change');
    return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch (err) {
    return 'unavailable';
  }
}

/** The address for another device. `reachable` is false for an address only this computer can open. */
export function link() {
  const url = location.origin + location.pathname.replace(/[^/]*$/, '');
  const host = location.hostname;
  const private_ = host === 'localhost' || host === '[::1]' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /\.local$/.test(host);
  return { url, reachable: location.protocol === 'https:' && !private_ };
}

export const textLink = (url = link().url) => `sms:?&body=${encodeURIComponent(`Open StaticOS: ${url}`)}`;

if (typeof window !== 'undefined') {
  window.addEventListener('appinstalled', () => { window.__staticInstall = null; bus.emit('install:change'); });
}

export default { state, install, link, textLink };
