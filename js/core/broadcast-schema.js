/* ============================================================
   broadcast-schema.js — what a developer broadcast may contain.

   One shape, checked the same way in two places: the site
   (core/broadcast.js, before showing anything) and the Discord bot
   (tools/feedback-bot.mjs, before publishing anything). Pure — no
   DOM, no store — so Node can import it too.

   A broadcast is published as data/broadcast.json:
     {
       id, at, until,                       ms timestamps; until = when it ends
       announcement: null | {
         title, message, style: 'info'|'event'|'warning',
         button: null | { label, url }      https only, opened when clicked
                      | { label, app, opts } a StaticOS app, opened when clicked
       },
       event: null | {
         effect: 'none'|'confetti'|'snow'|'disco',
         accent: null | a theme id          everyone's accent, for the duration
       },
       promo: null | {                      a corner card advertising a site
         title, message, url, label,        url https only, opened when clicked
         image: null | https image url
       }
     }
   Nothing in a broadcast can navigate anyone anywhere by itself:
   links, apps and promoted sites open only when a visitor clicks.
   ============================================================ */

export const MARK = '📣 Broadcast request';
export const STYLES = ['info', 'event', 'warning'];
export const EFFECTS = ['none', 'confetti', 'snow', 'disco'];
export const ACCENTS = ['aether', 'azure', 'violet', 'mint', 'amber', 'pink', 'moonwalk', 'nocturne', 'sakura', 'mono'];
/* apps a button may open, and the only options each may be given */
export const BUTTON_APPS = {
  arcade: ['game'], play: ['tab'], forge: ['prompt'], 'aether-games': ['url'], store: ['section'],
  whatsnew: [], feedback: [], aetherium: [], 'aether-anime': [], chat: [], profile: [], pumpkin: [],
};
export const LIMITS = { title: 80, message: 400, label: 30, url: 500, prompt: 200, maxDays: 14 };

/** a full https URL (as text), or '' */
function https(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > LIMITS.url) return '';
  try { const u = new URL(v.trim()); return u.protocol === 'https:' ? u.href : ''; } catch (e) { return ''; }
}
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n) : '');

/** -> { ok: true, value } | { ok: false, errors: [..] } */
export function cleanBroadcast(raw, now = Date.now()) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Not a broadcast.'] };
  if (raw.clear === true) return { ok: true, value: { clear: true, at: now } };

  const at = Number.isFinite(raw.at) ? raw.at : now;
  let until = Number(raw.until);
  if (!Number.isFinite(until)) errors.push('It needs an end time.');
  else if (until <= now) errors.push('It has already ended.');
  else if (until - now > LIMITS.maxDays * 864e5) until = now + LIMITS.maxDays * 864e5;

  let announcement = null;
  if (raw.announcement) {
    const a = raw.announcement;
    const title = str(a.title, LIMITS.title);
    const message = str(a.message, LIMITS.message);
    if (!title && !message) errors.push('The announcement is empty.');
    let button = null;
    if (a.button && typeof a.button === 'object') {
      const label = str(a.button.label, LIMITS.label) || 'Open';
      if (typeof a.button.url === 'string' && a.button.url.trim()) {
        const url = a.button.url.trim().slice(0, LIMITS.url);
        let ok = false;
        try { ok = new URL(url).protocol === 'https:'; } catch (e) { ok = false; }
        if (ok) button = { label, url };
        else errors.push('The button link must be a full https:// address.');
      } else if (typeof a.button.app === 'string') {
        const allowed = BUTTON_APPS[a.button.app];
        if (!allowed) errors.push(`The button can’t open "${str(a.button.app, 30)}".`);
        else {
          const opts = {};
          for (const k of allowed) {
            const v = a.button.opts && a.button.opts[k];
            if (typeof v !== 'string' || !v.trim()) continue;
            if (k === 'url' && !/^static:\/\/games\/[\w-]{1,80}$/.test(v.trim())) { errors.push('A game link must look like static://games/<id>.'); continue; }
            opts[k] = str(v, k === 'prompt' ? LIMITS.prompt : 80);
          }
          button = { label, app: a.button.app, opts };
        }
      }
    }
    announcement = {
      title, message,
      style: STYLES.includes(a.style) ? a.style : 'info',
      button,
    };
  }

  let event = null;
  if (raw.event) {
    const e = raw.event;
    const effect = EFFECTS.includes(e.effect) ? e.effect : 'none';
    const accent = ACCENTS.includes(e.accent) ? e.accent : null;
    if (effect !== 'none' || accent) event = { effect, accent };
  }

  let promo = null;
  if (raw.promo) {
    const p = raw.promo;
    const title = str(p.title, LIMITS.title);
    const message = str(p.message, LIMITS.message);
    const url = https(p.url);
    if (!url) errors.push('The promoted site needs a full https:// address.');
    else if (!title) errors.push('The promoted site needs a name.');
    else {
      const image = p.image ? https(p.image) : null;
      if (p.image && !image) errors.push('The promo picture must be an https:// address.');
      promo = { title, message, url, label: str(p.label, LIMITS.label) || 'Visit', image };
    }
  }

  if (!announcement && !event && !promo) errors.push('Add an announcement, an event or a promoted site.');
  if (errors.length) return { ok: false, errors };
  const id = str(raw.id, 40) || `bc-${now.toString(36)}`;
  return { ok: true, value: { id, at, until, announcement, event, promo } };
}

/** A short human summary, for Discord and for the preview. */
export function describeBroadcast(b) {
  if (!b) return '';
  if (b.clear) return 'Clear the current broadcast.';
  const out = [];
  if (b.announcement) {
    const a = b.announcement;
    out.push(`Announcement (${a.style}): ${a.title}${a.title && a.message ? ' — ' : ''}${a.message}`);
    if (a.button) out.push(a.button.url ? `Button “${a.button.label}” → ${a.button.url}` : `Button “${a.button.label}” opens ${a.button.app}${Object.keys(a.button.opts || {}).length ? ` ${JSON.stringify(a.button.opts)}` : ''}`);
  }
  if (b.event) {
    if (b.event.effect !== 'none') out.push(`Effect: ${b.event.effect}`);
    if (b.event.accent) out.push(`Everyone’s accent: ${b.event.accent}`);
  }
  if (b.promo) {
    out.push(`Corner promo: ${b.promo.title}${b.promo.message ? ` — ${b.promo.message}` : ''}`);
    out.push(`“${b.promo.label}” → ${b.promo.url}${b.promo.image ? ` (picture: ${b.promo.image})` : ''}`);
  }
  out.push(`Ends: ${new Date(b.until).toUTCString()}`);
  return out.join('\n');
}

export default { MARK, STYLES, EFFECTS, ACCENTS, BUTTON_APPS, LIMITS, cleanBroadcast, describeBroadcast };
