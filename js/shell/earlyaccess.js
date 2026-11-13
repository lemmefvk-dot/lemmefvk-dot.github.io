/* ============================================================
   shell/earlyaccess.js — what the beta site adds to StaticOS.

   Only active when this site's channel.json says "beta" (see
   core/earlyaccess.js); on the stable site it does nothing.

     banner   a slim "Early access build" strip, always visible, with
              the build time and a link back to the stable site
     gate     on a first visit, "sign in with the developer account to
              continue", using the same PBKDF2 verifier as shell/account.js.
              After that the normal session (store 'session.user') remembers it.

   Honest limits: this is a front door, not a vault. The page and its
   files are public, and anyone with DevTools can set the session
   themselves. The gate keeps casual visitors out and tells them what
   this build is; nothing secret may ever sit behind it.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { thisChannel, STABLE_URL, when } from '../core/earlyaccess.js';
import { signInDev } from './account.js';

const isDev = () => !!store.get('session.user', null)?.dev;

export async function mountEarlyAccess(host) {
  const ch = await thisChannel();
  if (!ch) return () => {};
  document.documentElement.dataset.channel = 'beta';

  const t = when(ch.built);
  const banner = h('div.ea-banner', { role: 'note' },
    icon('zap'),
    h('b', { text: 'Early access build' }),
    t ? h('span', { text: `built ${t}` }) : null,
    h('a', { href: STABLE_URL, rel: 'noopener', text: 'Back to the stable site' }));
  document.body.appendChild(banner);

  let gate = null;
  const lift = on => { try { host.inert = on; } catch (e) { /* older browsers */ } };
  function openGate() {
    if (gate) return;
    const err = h('div.ea-gate__err', { role: 'alert' });
    const pw = h('input.acct-field__in', { type: 'password', autocomplete: 'off', 'aria-label': 'Developer password' });
    const go = h('button.btn.btn--primary', { type: 'submit' }, 'Continue');
    const form = h('form.ea-gate__form', {
      onsubmit: async e => {
        e.preventDefault();
        err.textContent = '';
        go.disabled = true;
        try { await signInDev(pw.value); } catch (x) { err.textContent = x.message; go.disabled = false; pw.select(); }
      },
    }, h('label.acct-field', h('span', { text: 'Developer password' }), pw), go);
    gate = h('div.ea-gate', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ea-gate-t' },
      h('div.ea-gate__card',
        h('div.ea-gate__brand', icon('zap'), h('b', { text: 'StaticOS early access' })),
        h('h1#ea-gate-t.ea-gate__t', { text: 'Early-access build' }),
        h('p', { text: 'This is the early-access build for StaticOS developers. Sign in with the developer account to continue.' }),
        form, err,
        h('p.ea-gate__small', 'This is a front door, not a vault. The password is checked in your browser against a one-way hash, and this page is public: nothing secret is behind it. ', h('a', { href: STABLE_URL, rel: 'noopener', text: 'Go to the stable site' }))));
    document.body.appendChild(gate);
    lift(true);
    setTimeout(() => pw.focus(), 30);
  }
  function closeGate() { gate?.remove(); gate = null; lift(false); }
  const sync = () => (isDev() ? closeGate() : openGate());
  sync();
  const off = store.sub('session.user', sync);
  return () => { off?.(); closeGate(); banner.remove(); delete document.documentElement.dataset.channel; };
}
export default mountEarlyAccess;
