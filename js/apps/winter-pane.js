/* ============================================================
   winter-pane.js — Settings › Winter.

   Listed from December 1 to the end of January 1 (js/core/season.js),
   and after that for anyone who has advent treats to manage — they
   keep working all year (js/core/winter.js).

   In season: the master switch, its parts (wallpaper, countdown,
   snow, advent calendar) dimmed while it is off, and the calendar's
   progress. Always: the treats you have — wear a cursor, put a
   sticker on the desktop, use a wallpaper, pick a notification
   sound. Nothing here is counted that didn't happen on this device.

   pane(kit) -> nodes for Settings' pane column. kit is Settings'
   own row-building kit (caption, group, srow, note, btn,
   tabs, prefSwitch, pref, go, repaint, reducedMotion, motionOff).
   ============================================================ */
import * as SEASON from '../core/season.js';
import * as WINTER from '../core/winter.js';
import * as HW from '../core/halloween.js';

export function pane(kit) {
  const { api, caption, group, srow, note, btn, tabs, prefSwitch, pref, repaint } = kit;
  const { h, icon, store } = api;
  const now = new Date();
  const season = SEASON.isWinterSeason(now);
  const on = pref('winterTheme') !== false;
  const out = [];

  if (season) {
    const left = SEASON.christmas(now);
    const when = left.passed
      ? (now.getMonth() === 11 && now.getDate() === 25 ? 'Merry Christmas!' : 'Happy holidays!')
      : left.days >= 2 ? `${left.days} days to Christmas.`
        : left.days === 1 ? '1 day to Christmas.'
          : 'Christmas starts at midnight.';
    out.push(h('div.st-winter' + (on ? '' : '.is-off'),
      h('div.st-winter__art', { 'aria-hidden': 'true' }, icon('snowflake')),
      h('div.st-winter__t',
        h('b', { text: 'Winter' }),
        h('small', { text: on
          ? `On until the end of January 1. ${when}`
          : 'Off. StaticOS looks the way it does the rest of the year.' })),
      h('span.badge.st-winter__state' + (on ? '.badge--accent' : ''), { text: on ? 'On' : 'Off' })));

    /* the parts: dimmed and inert while the season is switched off */
    const part = (id, ctrl) => {
      const r = srow(id, ctrl);
      if (!on) {
        r.classList.add('is-dim');
        r.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; });
      }
      return r;
    };
    const opened = WINTER.openedCount();
    out.push(
      caption('The season'),
      group(srow('winterTheme', prefSwitch('winterTheme'))),
      caption('Extras'),
      group(
        part('winterWallpaper', prefSwitch('winterWallpaper')),
        part('winterCountdown', prefSwitch('winterCountdown')),
        part('winterSnow', prefSwitch('winterSnow')),
        part('winterAdvent', prefSwitch('winterAdvent')),
      ),
      on && pref('winterCountdown') && !store.get('session.user')
        ? note('Desktop widgets are for signed-in accounts, so the countdown appears once you sign in (bottom-right corner).', 'user') : null,
      on && pref('winterSnow') && kit.reducedMotion()
        ? note('Reduce motion is on, so the snow stays away.', 'activity') : null,
      on && pref('winterSnow') && !kit.reducedMotion() && kit.motionOff()
        ? note('Wallpaper motion is off on this machine, so the snow is paused with it.', 'gauge') : null,
      caption('Advent calendar'),
      group(srow('wn.advent',
        h('span.badge', { text: `${opened} of ${WINTER.DOOR_COUNT} open` }),
        on && pref('winterAdvent') ? btn('gift', 'Open the calendar', () => api.bus.emit('winter:advent')) : null)),
    );
  } else {
    out.push(note(WINTER.ownsAny()
      ? 'Winter comes back on December 1. The treats from your advent calendar keep working all year — they are all below.'
      : 'Winter comes back on December 1.', 'snowflake'));
  }

  /* ---- your treats ---- */
  const thumb = (type, id) => h('img', { src: WINTER.artUrl(type, id), alt: '' });
  const cursors = WINTER.ownedList('cursor');
  const stickers = WINTER.ownedList('sticker');
  const walls = WINTER.ownedList('wallpaper');
  const sounds = WINTER.ownedList('sound');
  const wearing = pref('cursorSkin');
  const tone = pref('notiTone');
  out.push(caption('Your treats'));
  if (!cursors.length && !stickers.length && !walls.length && !sounds.length) {
    out.push(note('Nothing yet — each door of the advent calendar gives a wallpaper, a cursor, a sticker or a notification sound.', 'gift'));
    return out.filter(Boolean);
  }
  out.push(group(
    cursors.length ? srow('wn.cursor', tabs('Winter cursor',
      [['none', 'Normal'], ...cursors.map(c => [c.id, c.name.replace(/ pointer$/, '')])],
      WINTER.owns('cursor', wearing) ? wearing : 'none',
      v => { WINTER.setCursor(v); })) : null,
    stickers.length ? srow('wn.stickers',
      h('div.st-wn__row', stickers.map(t => h('button.st-wn__pick', {
        type: 'button', 'aria-label': `Put a ${t.name} sticker on the desktop`, title: t.name,
        onclick: () => HW.placeSticker(t.id),
      }, thumb('sticker', t.id))))) : null,
    walls.length ? srow('wn.walls',
      h('div.st-wn__row', walls.map(t => h('button.st-wn__pick.st-wn__pick--wide', {
        type: 'button', 'aria-label': `Use the ${t.name} wallpaper`, title: t.name,
        onclick: () => { WINTER.useWallpaper(t.id); repaint(); },
      }, thumb('wallpaper', t.id))))) : null,
    sounds.length ? srow('notiTone', tabs('Notification sound',
      [['none', 'Usual'], ...sounds.map(t => [t.id, t.name])],
      WINTER.owns('sound', tone) ? tone : 'none',
      v => { WINTER.setTone(v); if (v !== 'none') import('../core/sfx.js').then(m => { m.unlock(); m.previewTone(v); }).catch(() => {}); })) : null,
  ));
  return out.filter(Boolean);
}

export default { pane };
