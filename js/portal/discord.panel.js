/* ============================================================
   discord.panel.js — the real-Discord surface inside Static Chat.

   Everything here is live data: presence from Discord's public,
   CORS-enabled widget, and the server's real channels and messages
   through WidgetBot once its bot is in the server (see
   js/portal/discord.js for what a static page can and can't reach).
   ============================================================ */
import * as DC from './discord.js';
import { buildBrowser } from './discord.browse.js';
import { BRAND } from './brand.js';

const KEY = 'portal.discord';

export function savedConfig(store) {
  const v = store.get(KEY) || {};
  DC.config.guildId = v.guildId || DC.config.guildId;
  DC.config.invite = v.invite || DC.config.invite;
  DC.config.bridge = v.bridge || DC.config.bridge;
  return v;
}
export function saveConfig(store, patch) {
  const next = { ...(store.get(KEY) || {}), ...patch };
  store.set(KEY, next);
  Object.assign(DC.config, {
    guildId: next.guildId || null, invite: next.invite || null, bridge: next.bridge || null,
  });
  return next;
}

/**
 * build({api, store, onChange}) -> {el, stop()}
 * Renders the whole panel and keeps it polling while it is on screen.
 */
export function buildDiscordPanel({ api, store, onChange }) {
  const { h, icon } = api;
  const el = h('div.dc');
  let stopWatch = null;
  let browser = null;
  const S = { tab: (store.get(KEY) || {}).tab || 'messages', demo: false, bodyKey: '', last: null, wbName: null, wbMembers: null };

  savedConfig(store);
  /* First run used to land on a paste-an-invite screen, which reads as
     broken. Connect to a known-public server instead, so the panel is live
     immediately — and fall through to the browser only if every default is
     unreachable. Any server you pick after this is remembered and wins. */
  if (!DC.config.guildId && !DC.config.invite) {
    paintConnecting();
    DC.firstWorkingDefault().then(found => {
      if (!el.isConnected) return;
      if (!found) { paintBrowse(); return; }
      saveConfig(store, { guildId: found.guildId, invite: null });
      onChange?.();
      paint();
    }).catch(() => { if (el.isConnected) paintBrowse(); });
  } else {
    paint();
  }

  function paintConnecting() {
    api.render(el, h('div.dc__wait',
      h('div.spinner'),
      h('small', { text: 'Connecting to a public server…' }),
      h('small.dim', { text: 'No sign-in. This reads a server’s public widget — who is online and '
        + 'its voice channels. Reading your own servers would need a login key that cannot be kept '
        + 'secret in a page like this.' })));
  }

  /* ---- the server browser ---- */
  function paintBrowse() {
    stopWatch?.(); stopWatch = null;
    browser?.stop();
    browser = buildBrowser({
      api, store,
      onOpen: ({ guildId, invite }) => {
        saveConfig(store, { guildId: guildId || null, invite: invite || null });
        onChange?.();
        paint();
      },
    });
    api.render(el, browseHeader(), browser.el);
  }

  function browseHeader() {
    const connected = DC.config.guildId || DC.config.invite;
    return h('div.row', { style: { gap: 'var(--sp-3)' } },
      h('div.cx__sec-t', { text: 'Browse servers' }),
      h('div.grow'),
      connected
        ? h('button.btn.btn--sm', { type: 'button', onclick: paint },
            icon('arrow-right', { size: 13 }), 'Back to your server')
        : null);
  }

  function paint() {
    browser?.stop(); browser = null;
    if (!DC.config.guildId && !DC.config.invite) { paintBrowse(); return; }
    api.render(el, h('div.center', { style: { padding: 'var(--sp-8)' } }, h('div.spinner')));
    refresh();
  }

  async function refresh() {
    try { await refreshInner(); }
    catch (err) {
      /* nothing below should escape, but a rejected paint must never become an
         unhandled rejection — a server with its widget off is a normal state */
      if (!dead()) api.render(el, errorCard(err));
    }
  }

  function dead() { return !el.isConnected && !el.parentNode; }

  async function refreshInner() {
    stopWatch?.();
    /* invite metadata works even when the widget is off, so ask for both */
    const [inv, wid] = await Promise.allSettled([
      DC.config.invite ? DC.inviteInfo(DC.config.invite) : Promise.reject(new Error('no invite')),
      DC.config.guildId ? DC.widget(DC.config.guildId) : Promise.reject(new Error('no guild')),
    ]);
    const invite = inv.status === 'fulfilled' ? inv.value : null;
    const live = wid.status === 'fulfilled' ? wid.value : null;
    const widgetErr = wid.status === 'rejected' ? wid.reason : null;

    /* a server with its public widget off can still share its channels
       through WidgetBot, so a server ID alone is enough to go on */
    if (!invite && !live) {
      const st = DC.config.guildId ? await DC.messagesStatus(DC.config.guildId) : { status: 'no' };
      if (st.status !== 'yes') { api.render(el, errorCard(widgetErr || inv.reason)); return; }
      S.wbName = st.name || null;
      if (S.tab === 'people') S.tab = 'messages';
    }
    if (invite && !DC.config.guildId && invite.guildId) {
      saveConfig(store, { guildId: invite.guildId });
    }
    render(invite, live, widgetErr);

    if (DC.config.guildId && live) {
      stopWatch = DC.watch(DC.config.guildId,
        d => render(invite, d, null),
        () => {});
    }
  }

  /* ---- the connected server: a header and three tabs ----
     Messages  real channels through WidgetBot (see discord.js)
     People    who is online and in voice, from the public widget
     Server    Discord's own widget, the invite, the bridge
     The widget is polled every 30 s; only the header and People repaint
     on a poll, so the Messages and Server iframes never reload under you. */
  let shell = null, headSlot = null, tabSlot = null, bodySlot = null;

  function buildShell() {
    headSlot = h('div.dc__headslot');
    tabSlot = h('div.dc-tabs', { role: 'tablist', 'aria-label': 'Discord views' });
    bodySlot = h('div.dc__body');
    shell = h('div.dc__shell', headSlot, tabSlot, bodySlot);
    S.bodyKey = '';
    api.render(el, shell);
  }

  function render(invite, live, widgetErr) {
    S.last = { invite, live, widgetErr };
    if (!shell || shell.parentNode !== el) buildShell();
    paintHead();
    paintTabs();
    const key = `${S.tab}|${DC.config.guildId || DC.config.invite}|${S.demo}`;
    if (S.tab === 'people' || key !== S.bodyKey) { S.bodyKey = key; paintBody(); }
  }

  function setTab(t) {
    if (t === S.tab) return;
    S.tab = t;
    saveConfig(store, { tab: t });
    render(S.last.invite, S.last.live, S.last.widgetErr);
  }

  function paintHead() {
    const { invite, live } = S.last;
    const name = live?.name || invite?.name || S.wbName || 'Discord';
    const online = live?.online ?? invite?.online ?? null;
    const members = invite?.members ?? S.wbMembers ?? null;
    const joinUrl = invite?.url || live?.invite || null;
    api.render(headSlot,
      h('div.dc__head',
        invite?.icon
          ? h('img.dc__icon', { src: invite.icon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
          : h('div.dc__icon.center', icon('message-circle')),
        h('div.grow',
          h('div.dc__name', { text: name }),
          invite?.description ? h('div.dc__desc', { text: invite.description }) : null,
          h('div.dc__counts',
            online != null ? h('span.chip', h('span.dc__dot'),
              h('span', { text: `${online.toLocaleString()} online` })) : null,
            members != null ? h('span.chip', icon('users'),
              h('span', { text: `${members.toLocaleString()} members` })) : null,
            h('span.badge', { text: 'live from Discord' }))),
        joinUrl
          ? h('button.btn.btn--sm', { type: 'button', onclick: () => copyInvite(joinUrl) },
              icon('copy', { size: 13 }), 'Copy invite')
          : null,
        h('button.btn.btn--sm.tip.tip--below', { 'data-tip': 'Browse other servers',
          type: 'button', onclick: paintBrowse }, icon('grid-9', { size: 13 }), 'Browse'),
        h('button.ibtn.tip.tip--below', { 'data-tip': 'Change server', 'aria-label': 'Change server',
          type: 'button', onclick: () => api.render(el, connectForm()) }, icon('settings'))));
  }

  function paintTabs() {
    const tab = (id, ic, label) => h(`button.dc-tab${S.tab === id ? '.is-on' : ''}`, {
      type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => setTab(id),
    }, icon(ic, { size: 13 }), h('span', { text: label }));
    api.render(tabSlot,
      tab('messages', 'message-circle', 'Messages'),
      tab('people', 'users', 'People'),
      tab('server', 'info', 'Server'));
  }

  function paintBody() {
    if (S.tab === 'messages') api.render(bodySlot, messagesBody());
    else if (S.tab === 'people') api.render(bodySlot, peopleBody());
    else api.render(bodySlot, serverBody());
  }

  /* ---- Messages: the real channels, through WidgetBot ---- */
  function messagesBody() {
    const gid = S.demo ? DC.WIDGETBOT_DEMO.guildId : DC.config.guildId;
    const box = h('div.dc-msg');
    if (!gid) {
      api.render(box, h('div.card',
        h('div.card__head', icon('info'), h('div.card__t', { text: 'This needs the server’s ID' })),
        h('small.dim', { text: 'An invite link gives the name and counts, but showing channels needs the server ID. In Discord: Server Settings ▸ Widget ▸ Server ID.' }),
        h('div.row', { style: { marginTop: 'var(--sp-4)' } },
          h('button.btn.btn--sm', { type: 'button', onclick: () => api.render(el, connectForm()) }, icon('sliders', { size: 13 }), 'Enter the server ID'))));
      return box;
    }
    api.render(box, h('div.dc-msg__wait', h('div.spinner'), h('small', { text: 'Checking whether this server shares its channels…' })));
    DC.messagesStatus(gid).then(st => {
      if (!box.isConnected) return;
      if (st.status === 'yes' && !S.demo && !S.last.live && !S.last.invite) {
        S.wbName = st.name || S.wbName; S.wbMembers = st.members ?? null; paintHead();
      }
      api.render(box, st.status === 'no' ? setupCard() : embedView(gid, st));
    });
    return box;
  }

  function embedView(gid, st) {
    const name = S.demo ? DC.WIDGETBOT_DEMO.name : (S.last.live?.name || S.last.invite?.name || st.name || 'this server');
    return h('div.dc-msg__wrap',
      S.demo ? h('div.dc-msg__demo', icon('eye', { size: 13 }),
        h('span', { text: 'This is WidgetBot’s own demo server, to show what yours will look like.' }),
        h('button.btn.btn--sm', { type: 'button', onclick: () => { S.demo = false; S.bodyKey = ''; render(S.last.invite, S.last.live, S.last.widgetErr); } }, 'Back to your server')) : null,
      h('div.dc-msg__frame',
        h('iframe', {
          src: DC.messagesEmbedUrl(gid, S.demo ? DC.WIDGETBOT_DEMO.channelId : DC.firstChannel(st.channels)),
          title: `${name} — Discord channels`,
          sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms',
          allow: 'clipboard-write',
          loading: 'lazy',
        })),
      h('div.dc-msg__foot',
        h('small.dim', { text: st.status === 'unknown'
          ? 'Channels from Discord, shown by WidgetBot. If it says the server is unavailable, the server’s owner needs to add WidgetBot.'
          : 'Live channels from Discord, shown by WidgetBot. Reading needs no account; to send, sign in with Discord inside the view.' }),
        h('div.grow'),
        h('button.btn.btn--sm', { type: 'button', onclick: () => window.open(DC.openInDiscordUrl(gid), '_blank', 'noopener') },
          icon('external-link', { size: 13 }), 'Open in Discord')));
  }

  function setupCard() {
    const name = S.last.live?.name || S.last.invite?.name || 'this server';
    return h('div.card.dc-setup',
      h('div.card__head', icon('message-circle'), h('div.card__t', { text: `Show ${name}’s channels here` })),
      h('small.dim', { text: 'Discord doesn’t hand messages to a website on its own. WidgetBot is a free Discord embed: once the server’s owner adds its bot, the channels and messages show up right here, and anyone can send by signing in with Discord.' }),
      h('ol.dc-setup__steps',
        h('li', { text: 'The server’s owner (or anyone with Manage Server) adds WidgetBot to the server.' }),
        h('li', { text: 'Come back and press Check again.' })),
      h('div.row', { style: { gap: 'var(--sp-3)', flexWrap: 'wrap', marginTop: 'var(--sp-4)' } },
        h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => window.open(DC.WIDGETBOT_ADD, '_blank', 'noopener') },
          icon('plus', { size: 13 }), 'Add WidgetBot'),
        h('button.btn.btn--sm', { type: 'button', onclick: async () => {
          await DC.messagesStatus(DC.config.guildId, { fresh: true });
          S.bodyKey = ''; render(S.last.invite, S.last.live, S.last.widgetErr);
        } }, icon('refresh', { size: 13 }), 'Check again'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { S.demo = true; S.bodyKey = ''; render(S.last.invite, S.last.live, S.last.widgetErr); } },
          icon('eye', { size: 13 }), 'See a demo'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => api.render(el, connectForm()) },
          icon('sliders', { size: 13 }), 'Use a different server')));
  }

  /* ---- People: who is online, from the public widget ---- */
  function peopleBody() {
    const { live, widgetErr } = S.last;
    return h('div.dc__col',
      widgetErr && widgetErr.code === 'widget-disabled'
        ? h('div.card',
            h('div.card__head', icon('info'), h('div.card__t', { text: 'Live presence is switched off' })),
            h('small.dim', { text: widgetErr.message }))
        : null,
      live?.members?.length
        ? h('div',
            h('div.cx__sec-h', icon('users'),
              h('div.cx__sec-t', { text: 'Online now' }),
              h('div.cx__sec-n', {
                text: live.members.length >= 100
                  ? `showing 100 of ${live.online.toLocaleString()}`
                  : `${live.members.length}`,
              })),
            h('div.dc__people', live.members.map(person)))
        : (!widgetErr ? h('small.dim', { text: 'Nobody is showing as online right now.' }) : null),
      live?.channels?.length
        ? h('div',
            h('div.cx__sec-h', icon('volume'), h('div.cx__sec-t', { text: 'Voice channels' })),
            h('div.dc__voice', live.channels.map(c => {
              const here = live.members.filter(m => m.channelId === c.id);
              return h('div.dc-vc', icon('volume'), h('span', { text: c.name }),
                h('small', { text: here.length ? `${here.length} in voice` : 'empty' }));
            })))
        : null);
  }

  /* ---- Server: Discord's own widget and the bridge ----
     The iframe only when the widget is actually enabled: pointing it at a
     server that has it off just renders Discord's own error page. */
  function serverBody() {
    const { invite, live } = S.last;
    const name = live?.name || invite?.name || 'Discord';
    return h('div.dc__col',
      DC.config.guildId && live
        ? h('div',
            h('div.cx__sec-h', icon('message-circle'),
              h('div.cx__sec-t', { text: 'Discord widget' }),
              h('div.cx__sec-n', { text: 'served by discord.com' })),
            h('div.dc__embed',
              h('iframe', {
                src: DC.widgetEmbedUrl(DC.config.guildId),
                title: `${name} on Discord`,
                allowtransparency: 'true',
                sandbox: 'allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts',
                referrerpolicy: 'no-referrer',
              })))
        : null,
      bridgeCard());
  }

  async function copyInvite(url) {
    try {
      await navigator.clipboard.writeText(url);
      api.notify?.({ app: BRAND.name, icon: 'copy', title: 'Invite copied', message: 'Paste it into Discord to join.' });
    } catch (err) {
      api.notify?.({ app: BRAND.name, icon: 'alert', title: 'Copy blocked', message: url });
    }
  }

  function person(m) {
    return h('div.dc-person',
      h('div.dc-ring', { class: `dc-ring is-${m.status}` },
        m.avatar
          ? h('img.dc-person__av', { src: m.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
          : h('div.dc-person__av')),
      h('div.dc-person__w',
        h('div.dc-person__n', { text: m.name }),
        h('div.dc-person__s', { text: m.game || DC.STATUS_LABEL[m.status] || m.status })));
  }

  function bridgeCard() {
    const on = DC.hasBridge();
    return h('div.card',
      h('div.card__head', icon(on ? 'check-circle' : 'shield'),
        h('div.card__t', { text: on ? 'Message bridge connected' : 'Your own message bridge (advanced)' }),
        h('div.grow'),
        h('span.badge', { class: on ? 'badge badge--ok' : 'badge', text: on ? 'live' : 'not connected' })),
      h('small.dim', {
        text: on
          ? 'Messages are coming from the bridge you configured, so this space behaves like any other.'
          : 'The Messages tab covers most servers through WidgetBot. A bridge is for running it yourself instead: '
          + 'Discord will not hand a static page any messages (the endpoint returns 401 without a token), '
          + 'and neither kind of token can live in a browser — a bot token shipped to the page is readable '
          + 'by anyone who opens devtools, and a user token is self-botting, which breaks Discord’s terms '
          + 'and gets accounts banned. Run a small bot of your own and point Static at it instead; '
          + 'the token stays on your server.',
      }),
      h('div.row', { style: { marginTop: 'var(--sp-4)', flexWrap: 'wrap' } },
        h('button.btn.btn--sm', { type: 'button', onclick: () => api.render(el, connectForm()) },
          icon('sliders', { size: 13 }), on ? 'Bridge settings' : 'Set up a bridge'),
        h('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          onclick: () => api.openApp('code', { path: '/home/static/Projects' }),
        }, icon('code', { size: 13 }), 'What the bridge must expose')),
      h('div.mono', {
        style: { fontSize: 'var(--fs-10)', color: 'var(--ink-3)', marginTop: 'var(--sp-4)',
                 lineHeight: '1.7', whiteSpace: 'pre-wrap' },
        text: 'GET  /channels                 -> [{id, name, topic}]\n'
            + 'GET  /channels/:id/messages    -> [{id, author:{id,name,avatar}, body, at}]\n'
            + 'POST /channels/:id/messages    -> the created message\n'
            + 'WS   /gateway                  -> {type:"message"|"typing"|"presence", …}',
      }));
  }

  function connectForm() {
    const idIn = h('input', {
      type: 'text', spellcheck: 'false', placeholder: 'Server ID, or a discord.gg invite link',
      value: DC.config.guildId || (DC.config.invite ? `https://discord.gg/${DC.config.invite}` : ''),
      'aria-label': 'Discord server',
    });
    const bridgeIn = h('input', {
      type: 'text', spellcheck: 'false', placeholder: 'https://your-bridge.example (optional)',
      value: DC.config.bridge || '', 'aria-label': 'Bridge URL',
    });
    const msg = h('small.dim');

    const connect = () => {
      const parsed = DC.parseTarget(idIn.value);
      if (!parsed.guildId && !parsed.invite) {
        msg.textContent = 'That is not a server ID or an invite link.';
        return;
      }
      saveConfig(store, {
        guildId: parsed.guildId || null,
        invite: parsed.invite || null,
        bridge: bridgeIn.value.trim() || null,
      });
      onChange?.();
      paint();
    };

    return h('div.dc',
      h('div.card',
        h('div.card__head', icon('message-circle'), h('div.card__t', { text: 'Connect your Discord' })),
        h('small.dim', {
          text: `Paste your server ID or an invite link. ${BRAND.name} reads the parts Discord makes public: `
              + 'the server name, who is online right now, and the voice channels. For live presence, turn on '
              + 'Server Settings ▸ Widget ▸ Enable server widget — an invite link alone still gives '
              + 'you the name and member counts.',
        }),
        h('div.dc__form', { style: { marginTop: 'var(--sp-5)' } },
          h('div.field', icon('message-circle'), idIn),
          h('button.btn.btn--primary', { type: 'button', onclick: connect },
            icon('check', { size: 14 }), 'Connect'),
          h('button.btn', { type: 'button', onclick: paintBrowse },
            icon('grid-9', { size: 14 }), 'Browse')),
        h('div.label', { style: { marginTop: 'var(--sp-5)' }, text: 'Message bridge (optional)' }),
        h('div.dc__form',
          h('div.field', icon('link'), bridgeIn)),
        h('small.dim', { style: { display: 'block', marginTop: 'var(--sp-3)' },
          text: 'Only needed for reading and sending messages. Leave it empty and this stays a live view of the server.' }),
        msg));
  }

  function errorCard(err) {
    return h('div.card',
      h('div.card__head', icon('alert'), h('div.card__t', { text: 'Could not reach that server' })),
      h('small.dim', { text: err?.message || String(err) }),
      h('div.row', { style: { marginTop: 'var(--sp-4)' } },
        h('button.btn.btn--sm', { type: 'button', onclick: paint }, icon('refresh', { size: 13 }), 'Retry'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => api.render(el, connectForm()) },
          icon('sliders', { size: 13 }), 'Change server'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: paintBrowse },
          icon('grid-9', { size: 13 }), 'Browse')));
  }


  return { el, stop() { stopWatch?.(); stopWatch = null; browser?.stop(); browser = null; } };
}

export default { buildDiscordPanel, savedConfig, saveConfig };
