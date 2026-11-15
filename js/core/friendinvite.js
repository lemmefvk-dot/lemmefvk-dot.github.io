/* ============================================================
   friendinvite.js — "Invite a friend" for rooms (Watch Together,
   Flex Battle): a small list of your friends with an Invite button
   each. The invite carries only the room code and goes down the
   private channel you already share with that friend (core/friends.js);
   they get a notice, and nothing joins until they press Join. Offline
   friends are shown but can't be invited. Nobody who isn't a friend
   can be invited here.

   invitePanel({ h, icon, kind: 'watch' | 'flex' | 'piano' | 'beats', code }) -> Promise<HTMLElement>
   ============================================================ */

const SEND = { watch: 'sendWatchInvite', flex: 'sendFlexInvite', piano: 'sendPianoInvite', beats: 'sendBeatsInvite' };

export async function invitePanel({ h, icon, kind, code }) {
  const box = h('div.fi', { role: 'group', 'aria-label': 'Invite a friend', dataset: { fi: kind } });
  let F;
  try { F = await import('./friends.js'); } catch (e) { box.append(h('p.fi__note', { text: 'Friends aren’t available right now.' })); return box; }
  const list = F.friends();
  if (!list.length) {
    box.append(h('p.fi__note', { text: 'You have no friends added yet. Add one in Social › Friends, or give your friend the room code.' }));
    return box;
  }
  const rows = list.map(f => {
    const online = f.presence !== 'offline';
    const status = h('span.fi__st', { role: 'status', text: online ? 'Online' : 'Offline' });
    const btn = h('button.btn.btn--sm', { type: 'button', disabled: !online, 'data-fp': f.fp, 'aria-label': `Invite ${f.display}`,
      onclick: async () => {
        btn.disabled = true;
        let r = null;
        try { r = await F[SEND[kind]](f.fp, code); } catch (e) { r = { ok: false, error: 'net' }; }
        status.textContent = r && r.ok ? (r.live ? 'Invited' : 'Sent, but the live service didn’t confirm it') : r && r.error === 'wait' ? 'Wait a moment and try again' : 'Couldn’t send that';
        if (!(r && r.ok && r.live)) btn.disabled = false;
      } }, icon('send'), h('span', { text: 'Invite' }));
    return h('li.fi__row', { dataset: { online: String(online) } }, h('b', { text: f.display }), status, btn);
  });
  box.append(h('ul.fi__list', rows), h('p.fi__note', { text: 'Your friend gets a notice with a Join button. Nothing joins until they press it.' }));
  return box;
}

export default { invitePanel };
