/* ============================================================
   lrc.js — lyrics from a .lrc (synced) or .txt (plain) file that sits
   beside a song. Nothing is fetched from anywhere: the words are the
   person's own file.

     parseLyrics(text, { lrc }) -> { synced, lines: [{ t, text }], meta }
         t is seconds into the song (null for a plain .txt line)
     activeLine(lines, seconds) -> index of the line being sung, or -1
     siblingNames(songName)     -> ['Song.lrc', 'Song.txt'] — what to look for

   LRC in brief:  [mm:ss.xx] words     one line, one time
                  [00:12.00][01:30.5] words   the same words at two times
                  [ar:Artist] [ti:Title] [al:Album] [offset:+250]   tags
                  <00:12.50> inside a line (word timing) is dropped: the
                  line is shown whole, lit from its own time.
   ============================================================ */

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TAG = /^\[([a-z]{2,8}):([^\]]*)\]\s*$/i;

function secs(m, s, f) {
  const frac = f ? Number(`0.${f}`) : 0;
  return Number(m) * 60 + Number(s) + frac;
}

export function parseLyrics(raw, { lrc = true } = {}) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const meta = {};
  let offset = 0;
  const timed = [];
  const plain = [];
  for (const line of text.split('\n')) {
    if (lrc) {
      const tag = TAG.exec(line.trim());
      if (tag && !/^\d/.test(tag[1])) {
        const k = tag[1].toLowerCase(), v = tag[2].trim();
        if (k === 'offset') { const n = Number(v); if (Number.isFinite(n)) offset = n / 1000; }
        else meta[k] = v;
        continue;
      }
      const stamps = [...line.matchAll(STAMP)];
      if (stamps.length) {
        const words = line.replace(STAMP, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim();
        for (const s of stamps) timed.push({ t: Math.max(0, secs(s[1], s[2], s[3]) - offset), text: words });
        continue;
      }
    }
    plain.push(line.replace(/\s+$/, ''));
  }
  if (timed.length) {
    timed.sort((a, b) => a.t - b.t);
    return { synced: true, lines: timed, meta };
  }
  /* plain text: keep the paragraphs, drop leading/trailing blank lines */
  while (plain.length && !plain[0].trim()) plain.shift();
  while (plain.length && !plain[plain.length - 1].trim()) plain.pop();
  return { synced: false, lines: plain.map(t => ({ t: null, text: t })), meta };
}

/** The last line whose time has come, or -1 before the first one. Binary search: lyrics can run to hundreds of lines. */
export function activeLine(lines, seconds) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= seconds) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The names a song's lyrics may have, best first: same name, .lrc then .txt. */
export function siblingNames(songName) {
  const i = String(songName).lastIndexOf('.');
  const stem = i > 0 ? songName.slice(0, i) : songName;
  return [`${stem}.lrc`, `${stem}.txt`];
}

export default { parseLyrics, activeLine, siblingNames };
