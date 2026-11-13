/* ============================================================
   discord.js — real Discord, as far as a static site can go.

   VERIFIED 2026-09-22 against the live API:

     GET /api/guilds/<id>/widget.json          CORS: yes, no auth
         -> server name, live presence_count, voice channels,
            and up to 100 online members with avatars + status.
            Needs the owner to tick Server Settings ▸ Widget ▸
            "Enable server widget". Otherwise: 50004.

     GET /api/v10/invites/<code>?with_counts=true   CORS: yes
         -> server name, icon, banner, description, member and
            online counts.

     https://discord.com/widget?id=…&theme=dark
         -> Discord's own widget, and it sends no X-Frame-Options,
            so it is officially embeddable.

     GET /api/v10/channels/<id>/messages        -> 401 without a token.

   That last line is the boundary. Reading or sending MESSAGES
   needs a token, and neither kind can live in a static page:
     · a bot token shipped to the browser is readable by anyone
       who opens devtools — it is public the moment you deploy;
     · a user token is self-botting, which breaks Discord's terms
       and gets the account banned.
   So messages go through a bridge you run yourself. See
   BRIDGE below and `config.mode = 'live'` in chat.transport.js.
   ============================================================ */

export const config = {
  /** Your server's id. Server Settings ▸ Widget ▸ Server ID. */
  guildId: null,
  /** Optional invite code ("aBcD1234"), used for the join button and counts. */
  invite: null,
  /** How often to re-poll the widget while a view is open. */
  pollMs: 30000,
  /**
   * BRIDGE — the only way to get real messages.
   * Run a small bot of your own and point this at it. It should expose:
   *   GET  /channels                  -> [{id, name, topic}]
   *   GET  /channels/:id/messages     -> [{id, author:{id,name,avatar}, body, at}]
   *   POST /channels/:id/messages     -> the created message
   *   WS   /gateway                   -> {type:'message'|'typing'|'presence', …}
   * The bot token stays on that server and never reaches the browser.
   */
  bridge: null,
};

const API = 'https://discord.com/api';

export class DiscordError extends Error {
  constructor(code, message) { super(message); this.name = 'DiscordError'; this.code = code; }
}

async function get(url, { timeout = 9000 } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(url, { signal: ctrl?.signal, headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      /* 50004 is the one people actually hit, so name it plainly */
      if (body && body.code === 50004) {
        throw new DiscordError('widget-disabled',
          'That server has its widget turned off. The owner can enable it in Server Settings ▸ Widget.');
      }
      throw new DiscordError(`http-${res.status}`, body.message || `Discord returned ${res.status}.`);
    }
    return body;
  } catch (err) {
    if (err instanceof DiscordError) throw err;
    throw new DiscordError(err.name === 'AbortError' ? 'timeout' : 'network',
      err.name === 'AbortError' ? 'Discord did not answer in time.' : 'Could not reach Discord.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}


/* ---------- servers that work with no setup ----------------- *
 * A server's widget is only readable if its owner ticked
 * "Enable Server Widget". Most have not, so an empty first run
 * used to land on a paste-an-invite screen and look broken.
 *
 * These four are large public developer communities that publish
 * theirs, verified live against
 * discord.com/api/guilds/<id>/widget.json. They are a starting
 * point, not a recommendation — the moment you connect your own
 * server that choice is remembered and these stop being used.
 *
 * What this cannot do, and does not pretend to: log you in.
 * Reading your own servers needs OAuth, OAuth needs a client
 * secret, and a secret in a static site is readable by anyone who
 * opens the source. So this shows public widget data — who is
 * online, the voice channels, the invite — and nothing private.
 * ---------------------------------------------------------- */

export const DEFAULTS = [
  { guildId: '267624335836053506', name: 'Python' },
  { guildId: '81384788765712384',  name: 'Discord API' },
  { guildId: '264445053596991498', name: 'Top.gg' },
  { guildId: '336642139381301249', name: 'discord.py' },
];

/**
 * Find a default whose widget actually answers right now, so first run
 * shows a live server instead of an error. Resolves to null if every one
 * of them is unreachable — the caller then falls back to the browser
 * rather than showing a broken panel.
 */
export async function firstWorkingDefault() {
  for (const d of DEFAULTS) {
    try {
      const w = await widget(d.guildId);
      if (w && w.name) return { ...d, widget: w };
    } catch (err) {
      /* try the next one */
    }
  }
  return null;
}

/** Pull a guild id or invite code out of anything the user pastes. */
export function parseTarget(raw) {
  const s = String(raw || '').trim();
  if (!s) return {};
  if (/^\d{17,20}$/.test(s)) return { guildId: s };
  const inv = s.match(/(?:discord\.gg|discord\.com\/invite)\/([\w-]+)/i);
  if (inv) return { invite: inv[1] };
  const gid = s.match(/discord\.com\/channels\/(\d{17,20})/);
  if (gid) return { guildId: gid[1] };
  if (/^[\w-]{2,25}$/.test(s)) return { invite: s };
  return {};
}

/** Live server state: name, online count, voice channels, online members. */
export async function widget(guildId = config.guildId) {
  if (!guildId) throw new DiscordError('no-guild', 'No server id set.');
  const d = await get(`${API}/guilds/${guildId}/widget.json`);
  return {
    id: d.id,
    name: d.name,
    online: d.presence_count ?? (d.members || []).length,
    invite: d.instant_invite || (config.invite ? `https://discord.gg/${config.invite}` : null),
    channels: (d.channels || []).map(c => ({ id: c.id, name: c.name, position: c.position ?? 0 }))
      .sort((a, b) => a.position - b.position),
    members: (d.members || []).map(m => ({
      id: m.id,
      name: m.username,
      status: m.status || 'offline',
      avatar: m.avatar_url || null,
      game: m.game?.name || null,
      channelId: m.channel_id || null,
      deaf: !!(m.deaf || m.self_deaf),
      mute: !!(m.mute || m.self_mute),
    })),
    at: Date.now(),
  };
}

/** Public invite metadata — works even when the widget is off. */
export async function inviteInfo(code = config.invite) {
  if (!code) throw new DiscordError('no-invite', 'No invite code set.');
  const d = await get(`${API}/v10/invites/${encodeURIComponent(code)}?with_counts=true`);
  const g = d.guild || {};
  return {
    code: d.code,
    name: g.name || 'Unknown server',
    description: g.description || '',
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
    banner: g.banner ? `https://cdn.discordapp.com/banners/${g.id}/${g.banner}.png?size=600` : null,
    guildId: g.id || null,
    members: d.approximate_member_count ?? null,
    online: d.approximate_presence_count ?? null,
    url: `https://discord.gg/${d.code}`,
  };
}

/** Discord's own embeddable widget — officially frameable. */
export const widgetEmbedUrl = (guildId = config.guildId, theme = 'dark') =>
  `https://discord.com/widget?id=${encodeURIComponent(guildId)}&theme=${theme}`;

/** Poll the widget while a view is open. Returns an unsubscribe. */
export function watch(guildId, onData, onError) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    try { const d = await widget(guildId); if (!stopped) onData?.(d); }
    catch (err) { if (!stopped) onError?.(err); }
    if (!stopped) timer = setTimeout(tick, Math.max(10000, config.pollMs));
  };
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/* ------------------------------------------------------------------ *
 *  bridge — real messages, only if you run one
 * ------------------------------------------------------------------ */
export const hasBridge = () => !!config.bridge;

export async function bridgeChannels() {
  if (!config.bridge) throw new DiscordError('no-bridge', 'No bridge configured.');
  return get(`${config.bridge.replace(/\/$/, '')}/channels`);
}

export async function bridgeMessages(channelId, { limit = 50 } = {}) {
  if (!config.bridge) throw new DiscordError('no-bridge', 'No bridge configured.');
  return get(`${config.bridge.replace(/\/$/, '')}/channels/${channelId}/messages?limit=${limit}`);
}

export async function bridgeSend(channelId, body) {
  if (!config.bridge) throw new DiscordError('no-bridge', 'No bridge configured.');
  const res = await fetch(`${config.bridge.replace(/\/$/, '')}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new DiscordError(`http-${res.status}`, `Bridge returned ${res.status}.`);
  return res.json();
}

export const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };

/* ------------------------------------------------------------------ *
 *  MESSAGES WITHOUT A BRIDGE — WidgetBot
 *
 *  WidgetBot (widgetbot.io) is a Discord embed service: a server's
 *  owner adds its bot once, and any page can then embed that server's
 *  real channels and messages. Reading works as a guest; sending signs
 *  in with Discord's own login in a popup. The token lives on
 *  WidgetBot's side, never in this page. Verified 2026-09-29: the embed
 *  sends no X-Frame-Options, and its API answers pages on any origin
 *  (CORS *) — "Unable to access this guild, is the bot invited?" when
 *  the bot isn't in the server.
 * ------------------------------------------------------------------ */
export const WIDGETBOT_ADD = 'https://add.widgetbot.io';
export const WIDGETBOT_DEMO = { guildId: '299881420891881473', channelId: '355719584830980096', name: 'WidgetBot demo server' };
export const messagesEmbedUrl = (guildId, channelId) =>
  `https://e.widgetbot.io/channels/${encodeURIComponent(guildId)}${channelId ? `/${encodeURIComponent(channelId)}` : ''}`;
export const openInDiscordUrl = guildId => `https://discord.com/channels/${encodeURIComponent(guildId)}`;
/** the channel to open first: #general if there is one, else the top text channel */
export const firstChannel = channels => {
  const list = Array.isArray(channels) ? channels : [];
  return (list.find(c => /^(general|chat|main)$/i.test(c.name)) || list[0] || null)?.id || null;
};

const WB_API = 'https://stonks.widgetbot.io/api/graphql';
/* the query WidgetBot's own embed sends first; a persisted-query hash can
   change when they ship, which is why an unrecognised answer is 'unknown'
   (show the embed anyway) rather than 'no' */
const WB_GUILD_INFO = '7950df406dacbf940f043ba4facc8757572b1fcec9e48bf081c445166acba6f8';
const wbCache = new Map();          /* guildId -> { at, result } */

/** -> { status: 'yes'|'no'|'unknown', name?, members?, channels?: [{id, name}] } */
export async function messagesStatus(guildId, { fresh = false } = {}) {
  if (!/^\d{15,21}$/.test(String(guildId || ''))) return { status: 'no', reason: 'not-a-server' };
  const hit = wbCache.get(guildId);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.result;
  let result = { status: 'unknown' };
  try {
    const res = await fetch(WB_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ operationName: 'GuildInfo', variables: { guild: String(guildId) },
        extensions: { persistedQuery: { version: 1, sha256Hash: WB_GUILD_INFO } } }]),
    });
    const j = await res.json();
    const one = Array.isArray(j) ? j[0] : j;
    const g = one?.data?.guild;
    if (g && g.id) {
      result = {
        status: 'yes', name: g.name || null,
        members: Number.isFinite(g.memberCount) ? g.memberCount : null,
        channels: Array.isArray(g.channels)
          ? g.channels.filter(c => c && c.__typename === 'TextChannel')
            .map(c => ({ id: c.id, name: c.name, position: Number(c.position) || 0 }))
            .sort((a, b) => a.position - b.position)
          : [],
      };
    } else if ((one?.errors || []).some(e => /bot invited|access this guild/i.test(e?.message || ''))) {
      result = { status: 'no' };
    }
  } catch (err) {
    result = { status: 'unknown', reason: 'unreachable' };
  }
  wbCache.set(guildId, { at: Date.now(), result });
  return result;
}

export default {
  config, widget, inviteInfo, watch, parseTarget, widgetEmbedUrl,
  hasBridge, bridgeChannels, bridgeMessages, bridgeSend, DiscordError, STATUS_LABEL,
  messagesStatus, messagesEmbedUrl, openInDiscordUrl, WIDGETBOT_ADD, WIDGETBOT_DEMO,
};
