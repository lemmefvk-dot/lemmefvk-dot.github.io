/* ============================================================
   subtitles.js — read .srt and .vtt subtitle files for Videos.

   parseSubs(text)        -> [{ from, to, text }] in seconds, sorted. SRT and
                             WebVTT are read by the same code: they differ in
                             the header, the comma or dot before the
                             milliseconds, and optional cue ids and settings.
   toVtt(cues, delay)     -> WebVTT text, every cue moved by `delay` seconds.
                             (This is the "converted to VTT" file Videos saves.)
   cueAt(cues, t)         -> the cue showing at time t, or null.
   besideVideo(vfs, path) -> subtitle files next to a video: same name, or the
                             name followed by a language tag ("film.en.srt").

   Cue text is plain: styling tags ({\an8}, <i>, <font>) are dropped, a few
   entities are decoded, and Videos shows it with textContent, never as HTML.
   ============================================================ */

export const SUB_EXT = ['srt', 'vtt'];
export const isSubName = name => SUB_EXT.includes(String(name).toLowerCase().split('.').pop());

/** "00:01:02,500", "01:02.500", "1:02:03.5" -> seconds, or NaN */
export function parseTime(s) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(s).trim());
  if (!m) return NaN;
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&lrm;': '', '&rlm;': '' };
const clean = line => line.replace(/\{\\[^}]*\}/g, '').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp|quot|#39|lrm|rlm);/g, e => ENTITIES[e]);

export function parseSubs(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const [a, rest = ''] = lines[at].split('-->');
    const from = parseTime(a);
    const to = parseTime(rest.trim().split(/\s+/)[0]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const body = lines.slice(at + 1).map(clean).map(l => l.trim()).filter(Boolean).join('\n');
    if (body) cues.push({ from, to, text: body });
  }
  return cues.sort((p, q) => p.from - q.from);
}

const two = n => String(n).padStart(2, '0');
function stamp(t) {
  t = Math.max(0, t);
  const ms = Math.round(t * 1000);
  return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`;
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toVtt(cues, delay = 0) {
  const out = ['WEBVTT', ''];
  cues.forEach((c, i) => {
    const from = c.from + delay, to = c.to + delay;
    if (to <= 0) return;
    out.push(String(i + 1), `${stamp(from)} --> ${stamp(to)}`, esc(c.text), '');
  });
  return out.join('\n');
}

/** The cue showing at time t (after the delay is taken off it), or null. */
export function cueAt(cues, t, delay = 0) {
  const x = t - delay;
  for (const c of cues) {
    if (c.from > x) break;
    if (x < c.to) return c;
  }
  return null;
}

/** Subtitle files beside a video, best match first. */
export function besideVideo(vfs, path) {
  const dir = vfs.parentPath(path);
  const stem = vfs.baseName(path).replace(/\.[^.]+$/, '').toLowerCase();
  const out = [];
  for (const n of vfs.ls(dir, { hidden: true })) {
    if (n.type !== 'file' || !isSubName(n.name) || typeof n.content !== 'string') continue;
    const low = n.name.toLowerCase();
    const body = low.replace(/\.[^.]+$/, '');
    if (body === stem) out.push({ node: n, path: `${dir === '/' ? '' : dir}/${n.name}`, rank: 0 });
    else if (body.startsWith(`${stem}.`)) out.push({ node: n, path: `${dir === '/' ? '' : dir}/${n.name}`, rank: 1 });
  }
  return out.sort((p, q) => p.rank - q.rank || p.node.name.localeCompare(q.node.name));
}

export default { SUB_EXT, isSubName, parseTime, parseSubs, toVtt, cueAt, besideVideo };
