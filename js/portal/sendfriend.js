/* ============================================================
   sendfriend.js — "send this page to a friend", shared by Static
   Games and Static Roblox.

   It only ever sends a link to the same page over the friend
   channel (js/core/friends.js › sendLink): the friend gets a
   notification and opens it in their own Static Games or Static
   Roblox, if they choose to. Nothing is synced, streamed or
   proxied, and no room is opened.
   ============================================================ */

/**
 * Fill `hold` with the friends list and a Send button for each.
 *   item = { kind: 'game' | 'roblox', id, title }
 * `alive()` says whether the page is still on screen.
 */
export async function paintFriendPanel(ctx, hold, item, alive = () => true) {
  const { api } = ctx;
  const { h, icon } = api;
  api.render(hold, h('small.dim', { text: 'Looking at your friends…' }));
  let F = null;
  try { F = await import('../core/friends.js'); } catch (e) { F = null; }
  if (!alive()) return;
  if (!F || !F.available()) {
    api.render(hold, h('small.dim', { text: 'Friends are not available here. Sign in to a profile to add friends in Static Social.' }));
    return;
  }
  const list = F.friends();
  if (!list.length) {
    api.render(hold, h('small.dim', { text: 'You have no friends added yet.' }),
      h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('social', { friends: true }) },
        icon('users', { size: 13 }), 'Open Friends'));
    return;
  }
  api.render(hold,
    h('small.dim', { text: `This sends a link to ${item.title}, nothing more. They choose whether to open it.` }),
    h('div.ag-friend__list', list.map(f => h('div.ag-friend__row', { dataset: { fp: f.fp } },
      h('span', { class: `ag-friend__dot is-${f.presence}`, 'aria-hidden': 'true' }),
      h('b', { text: f.display }),
      h('small.dim', { text: f.presence === 'offline' ? 'offline' : f.presence }),
      h('div.grow'),
      h('button.btn.btn--sm', {
        type: 'button', 'aria-label': `Send ${item.title} to ${f.display}`,
        onclick: async e => {
          const b = e.currentTarget;
          b.disabled = true;
          const r = await F.sendLink(f.fp, item);
          b.disabled = false;
          api.notify({
            app: 'Static', icon: r.ok ? 'send' : 'alert', timeout: 5000,
            title: r.ok ? `Sent to ${f.display}` : 'Could not send it',
            message: r.ok ? `${item.title}. They will see it when their StaticOS is open.`
              : r.error === 'wait' ? 'Wait a moment before sending another.' : 'That friend is not reachable right now.',
          });
        },
      }, icon('send', { size: 13 }), 'Send')))));
}

/**
 * The same friends list for something that is not a page in a catalogue: a Spotify
 * item, a TikTok, a Static Drop code. `send(fp)` does the sending and resolves to
 * friends.js's { ok, error? }; `note` says exactly what goes.
 */
export async function paintMediaPanel(ctx, hold, { label, note, send, noun = 'it' }, alive = () => true) {
  const { api } = ctx;
  const { h, icon } = api;
  if (typeof document !== 'undefined' && !document.getElementById('feat-dropmedia-css')) {
    const l = document.createElement('link');
    l.id = 'feat-dropmedia-css';
    l.rel = 'stylesheet';
    l.href = 'css/feat-dropmedia.css';
    document.head.appendChild(l);
  }
  api.render(hold, h('small.dim', { text: 'Looking at your friends…' }));
  let F = null;
  try { F = await import('../core/friends.js'); } catch (e) { F = null; }
  if (!alive()) return;
  if (!F || !F.available()) {
    api.render(hold, h('small.dim', { text: 'Friends are not available here. Sign in to a profile to add friends in Static Social.' }));
    return;
  }
  const list = F.friends();
  if (!list.length) {
    api.render(hold, h('small.dim', { text: 'You have no friends added yet.' }),
      h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('social', { friends: true }) },
        icon('users', { size: 13 }), 'Open Friends'));
    return;
  }
  api.render(hold,
    h('small.dim', { text: note }),
    h('div.ag-friend__list', { 'data-role': 'friend-list' }, list.map(f => h('div.ag-friend__row', { dataset: { fp: f.fp } },
      h('span', { class: `ag-friend__dot is-${f.presence}`, 'aria-hidden': 'true' }),
      h('b', { text: f.display }),
      h('small.dim', { text: f.presence === 'offline' ? 'offline' : f.presence }),
      h('div.grow'),
      h('button.btn.btn--sm', {
        type: 'button', 'aria-label': `Send ${label} to ${f.display}`,
        onclick: async e => {
          const b = e.currentTarget;
          b.disabled = true;
          const r = await send(f.fp);
          b.disabled = false;
          api.notify({
            app: 'Static', icon: r.ok ? 'send' : 'alert', timeout: 5000,
            title: r.ok ? `Sent to ${f.display}` : 'Could not send it',
            message: r.ok ? `${label}. They will see it when their StaticOS is open, and choose what to do with ${noun}.`
              : r.error === 'wait' ? 'Wait a moment before sending another.' : 'That friend is not reachable right now.',
          });
        },
      }, icon('send', { size: 13 }), 'Send')))));
}
