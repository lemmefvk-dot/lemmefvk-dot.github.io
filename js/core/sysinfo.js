/* ============================================================
   sysinfo.js — the facts about this StaticOS and this browser, in
   one place, for everything that wants to show or copy them: About
   This Static (Copy system info, Report a problem), Feedback's
   diagnostics box and Static Developer's Copy diagnostics.

   Every line is read from somewhere real (build.json, the browser,
   the registry, the boot marks index.html and main.js leave on
   window.__staticBoot) and a line the browser will not give is
   left out or says "not reported" — never guessed.

   What is NOT in here, on purpose: a name, an email, an IP address,
   file names or window titles (they can name a person or a school
   project), the contents of any file, and any saved setting. The
   text is built to be read by the person before it goes anywhere.
   ============================================================ */
import * as M from './metrics.js';
import * as DL from './devlog.js';
import { listApps } from './registry.js';

let buildP = null;
/** build.json, once — null when it is missing (a local copy) or offline. */
export function buildStamp() {
  if (!buildP) {
    buildP = fetch('build.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return buildP;
}

const pad2 = n => String(n).padStart(2, '0');
/** "1h 05m 09s" / "4m 09s" */
export function durationText(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), mn = Math.floor((s % 3600) / 60), ss = s % 60;
  return d ? `${d}d ${hr}h ${mn}m` : hr ? `${hr}h ${pad2(mn)}m ${pad2(ss)}s` : `${mn}m ${pad2(ss)}s`;
}

/** Seconds since this tab started loading StaticOS (performance.now() counts from navigation). */
export const sessionSeconds = () => performance.now() / 1000;

/** What start-up measured on this page load: { aliveMs, readyMs } in ms, each null until it happened. */
export function bootTimes() {
  const B = (typeof window !== 'undefined' && window.__staticBoot) || {};
  return {
    aliveMs: Number.isFinite(B.aliveMs) ? B.aliveMs : null,
    readyMs: Number.isFinite(B.readyMs) ? B.readyMs : null,
  };
}
const secText = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
export const bootText = () => {
  const b = bootTimes();
  return {
    alive: b.aliveMs === null ? 'not finished' : secText(b.aliveMs),
    ready: b.readyMs === null ? 'not finished' : secText(b.readyMs),
  };
};

/** The version people know it by, from the stamp when there is one. */
export async function versionLine() {
  const b = await buildStamp();
  const channel = typeof document !== 'undefined' && document.documentElement.dataset.channel === 'beta' ? ' (early access)' : '';
  if (!b) return `StaticOS (unstamped local copy)${channel}`;
  return `StaticOS ${b.version || '?'}${channel}`;
}

/**
 * [[group, [[label, value], …]], …] — the same facts the About window
 * lists. Values the browser does not report are omitted or say so.
 */
export async function groups() {
  const [b, store] = await Promise.all([buildStamp(), M.storage()]);
  const hw = M.hardware();
  const boot = bootText();
  const sw = typeof navigator !== 'undefined' && navigator.serviceWorker ? (navigator.serviceWorker.controller ? 'controlling this page' : 'not controlling this page') : 'not supported';
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  return [
    ['StaticOS', [
      ['Version', await versionLine()],
      ['Build', b?.build ? String(b.build) : 'unstamped'],
      ['Apps', String(listApps().length)],
      ['Drive', (typeof document !== 'undefined' && document.body?.dataset.os) || 'plain'],
      ['Opened as', standalone ? 'an installed app' : 'a web page'],
      ['Service worker', sw],
    ]],
    ['This session', [
      ['Up', durationText(sessionSeconds())],
      ['Desktop up after', boot.alive],
      ['Ready after', boot.ready],
    ]],
    ['This machine', [
      ['Browser', hw.browser],
      ['Platform', hw.platform],
      ['Logical cores', hw.cores ? String(hw.cores) : 'not reported'],
      ['Device memory', hw.memoryGB ? `${hw.memoryGB} GB (rounded by the browser)` : 'not reported'],
      ['Screen', `${hw.screen} @ ${hw.dpr}x`],
      ['Window', hw.viewport],
      ['Language', navigator.language || 'not reported'],
      ['Online', navigator.onLine === false ? 'no' : 'yes'],
    ]],
    ['Storage', [
      ['Used', store ? `${M.formatBytes(store.used)} of ${M.formatBytes(store.quota)}` : 'not reported by this browser'],
    ]],
  ];
}

/** The facts as plain text, ready to paste into a message. */
export async function infoText() {
  const gs = await groups();
  const lines = [];
  for (const [title, rows] of gs) {
    lines.push(`${title}`);
    for (const [k, v] of rows) lines.push(`  ${k}: ${v}`);
  }
  return lines.join('\n');
}

/* Errors the page has logged, newest last: the first line of each, with
   anything token-shaped masked (devlog's own redact), and clipped. */
function recentErrors(n = 3) {
  let list = [];
  try { list = DL.entries().filter(e => e.level === 'error'); } catch (err) { /* devlog not started */ }
  return {
    total: list.length,
    last: list.slice(-n).map(e => {
      const first = String(DL.redact(String(e.text || '')) || '').split('\n')[0].replace(/\s+/g, ' ').trim();
      return `${first.length > 120 ? `${first.slice(0, 119)}…` : first}${e.site ? ` (${e.site})` : ''}`;
    }),
  };
}

/** Which apps have a window open — ids, not titles: a title can be a file name. */
export function openApps() {
  const w = M.windows();
  return [...new Set((w?.apps || []).map(a => a.app))];
}

/**
 * What Feedback's "Include diagnostics" box would send, as the exact
 * text. Short on purpose (it rides in one Discord field), and the same
 * string is shown in the preview and sent — nothing is added on the way.
 */
export async function diagnosticsText() {
  const gs = await groups();
  const get = (g, k) => gs.find(x => x[0] === g)?.[1].find(r => r[0] === k)?.[1];
  const lines = [
    `${await versionLine()} · build ${get('StaticOS', 'Build')}`,
    `Browser: ${get('This machine', 'Browser')} on ${get('This machine', 'Platform')}`,
    `Screen: ${get('This machine', 'Screen')} · window ${get('This machine', 'Window')}`,
    `Cores: ${get('This machine', 'Logical cores')} · memory: ${get('This machine', 'Device memory')}`,
    `Ready after ${get('This session', 'Ready after')} · up ${get('This session', 'Up')}`,
    `Drive: ${get('StaticOS', 'Drive')} · ${get('StaticOS', 'Opened as')}`,
    `Open apps: ${openApps().join(', ') || 'none'}`,
  ];
  const f = M.network();
  if (f) lines.push(`Requests this session: ${f.requests}`);
  const lt = M.longTasks();
  if (lt) lines.push(`Long tasks (50 ms+): ${lt.count}`);
  const err = recentErrors(3);
  lines.push(`Errors logged: ${err.total}`);
  for (const e of err.last) lines.push(`  ${e}`);
  return lines.join('\n');
}

/** Put text on the clipboard; true if it went. Falls back to a hidden field for pages without the Clipboard API. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/** Hand the person a file to keep (a normal browser download). */
export function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default { copyText, downloadText, buildStamp, groups, infoText, diagnosticsText, bootTimes, bootText, durationText, sessionSeconds, openApps, versionLine };
