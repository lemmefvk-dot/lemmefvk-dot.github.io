/* ============================================================
   citations.js — format a source in MLA 9, APA 7 or Chicago 17
   (notes-bibliography, the bibliography entry). No DOM, no network:
   every word of a citation is a field the user typed.

   A source is
     { type: 'website'|'book'|'article'|'newspaper'|'video'|'podcast'|'film'|'interview',
       authors: [{ first, last }]     last only = an organisation or one name;
                                      a film's directors, a podcast's hosts,
                                      the person interviewed
       title, site (website / video site / newspaper / podcast / where an
       interview appeared), publisher (a film's studio, a podcast's network),
       city (Chicago only), edition, journal, volume, issue, pages,
       year, month (1-12 or ''), day, accessed ('YYYY-MM-DD'),
       url, doi, uploader (video channel), length (video and podcast,
       Chicago only), season, episode (podcast), interviewer ("First Last"),
       ikind (interview: 'published' or 'personal', one you did yourself) }

   The result of format() is { author, rest, runs }: runs are
   [{ t: text, i: italic }], so the preview can show italics and the
   copy can carry them (toHtml) next to a plain-text fallback (toText).
   `author` is the leading author part (kept apart so a list can print
   "---." for a repeated author), or null when the title leads.

   Rules applied (what each guide says, with the limits stated):
   · Names. MLA: one author inverted; two "Last, First, and First Last";
     three or more "Last, First, et al." APA: "Last, F. M."; up to 20
     authors listed, with "&" before the last; 21 or more list the first
     19, then ". . . " and the last (APA never uses et al. in the
     reference list). Chicago: first author inverted, the rest natural,
     "and" before the last; up to 10 authors listed, 11 or more the
     first seven then "et al."
   · Titles. MLA and Chicago use headline capitalisation (headline() in
     textcase.js, small words lowercase). APA uses sentence case for the
     titles of works; a title not typed in headline style is kept as typed
     so proper nouns survive. Journal and container names are headline.
     Put *asterisks* around words that must be italic inside a title.
   · Italics. MLA: container (website, journal, video site) and book
     titles; the title of a part is in quotation marks. APA: titles of
     books, web pages and videos, and the journal name with its volume.
     Chicago: book titles and journal names; article, page and video
     titles in quotation marks.
   · Dates. MLA "6 July 2010" with abbreviated months (Jan., Sept.).
     APA "(2020, June 5)". Chicago "June 5, 2020"; journals "(April 2016)".
   · Links. MLA drops "https://", APA and Chicago keep it. A DOI is
     always written https://doi.org/…, and is used instead of the URL.
   · Pages. Kept as typed, with the dash normalised (MLA "-", APA and
     Chicago "–"). Chicago's digit-shortening of page ranges is not applied.
   · Newspapers. MLA: "Title." *Paper*, date, p. A1, link. APA: (date), the
     title in sentence case, *Paper*, then the page (no "p."), then the link.
     Chicago: "Title." *Paper*, date, with no page (CMOS 14.191), link.
   · Podcast episodes. The hosts lead with their role: MLA "Last, First,
     host." and "season 1, episode 3" after the podcast's name; APA
     "Last, F. (Host)." and "Title (No. 3) [Audio podcast episode]. In
     *Podcast*."; Chicago "Last, First, host." and "Podcast audio".
   · Films. The directors lead: MLA "Last, First, director."; APA
     "Last, F. (Director). (2018). *Title* [Film]. Studio."; Chicago
     "Last, First, dir." With no director the title leads.
   · Interviews. Published: the person interviewed leads, then the title if
     it has one, "Interview by First Last." and where it appeared. One you
     did yourself: MLA "Personal interview." with the date; Chicago
     "Interview by the author." (it says Chicago usually puts these in a
     note). APA 7 leaves personal interviews out of the reference list
     (personal communications are cited in the text only), so format()
     gives no entry and says what to write in the text instead (`skip`).
   ============================================================ */
import { headline, apaTitle } from './textcase.js';

export const STYLES = [['mla', 'MLA 9'], ['apa', 'APA 7'], ['chicago', 'Chicago 17']];
export const TYPES = [['website', 'Website'], ['book', 'Book'], ['article', 'Journal article'], ['newspaper', 'Newspaper article'], ['video', 'Video'], ['podcast', 'Podcast episode'], ['film', 'Film'], ['interview', 'Interview']];
export const HEADINGS = { mla: 'Works Cited', apa: 'References', chicago: 'Bibliography' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

/* ---------- runs ---------- */
const R = (t, i = false) => ({ t, i });
export const toText = runs => runs.map(r => r.t).join('');
function merge(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.t) continue;
    const l = out[out.length - 1];
    if (l && l.i === r.i) l.t += r.t; else out.push({ t: r.t, i: r.i });
  }
  return out;
}
const cat = (...parts) => merge(parts.flatMap(p => (Array.isArray(p) ? p : p ? [p] : [])));
const endsPunct = runs => /[.?!]$/.test(toText(runs));
const endP = runs => (endsPunct(runs) ? runs : cat(runs, R('.')));
/** "Some *word* here" -> runs; a * toggles italics, flipped inside an italic container. */
function marks(s, base = false) {
  const str = String(s || '');
  if ((str.match(/\*/g) || []).length % 2) return [R(str.replace(/\*/g, ''), base)];
  return merge(str.split('*').map((t, k) => R(t, (k % 2 === 1) !== base)));
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const toHtml = runs => runs.map(r => (r.i ? `<i>${esc(r.t)}</i>` : esc(r.t))).join('');

/* ---------- fields ---------- */
const trim = v => String(v == null ? '' : v).trim();
function clean(src) {
  const s = { ...src };
  for (const k of ['title', 'site', 'publisher', 'city', 'edition', 'journal', 'volume', 'issue', 'pages', 'year', 'day', 'url', 'doi', 'uploader', 'length', 'accessed', 'season', 'episode', 'interviewer']) s[k] = trim(s[k]);
  s.month = Number(s.month) >= 1 && Number(s.month) <= 12 ? Number(s.month) : 0;
  s.ikind = src.ikind === 'personal' ? 'personal' : 'published';
  s.authors = (src.authors || []).map(a => ({ first: trim(a.first), last: trim(a.last) }))
    .map(a => (a.last ? a : { first: '', last: a.first })).filter(a => a.last);
  return s;
}
const doiUrl = s => {
  if (!s.doi) return '';
  const m = s.doi.match(/10\.\d{4,9}\/\S+/);
  return m ? `https://doi.org/${m[0]}` : s.doi;
};
const linkOf = s => doiUrl(s) || s.url;
const sameText = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
function edLabel(e) { return e ? (/\bed(ition)?\.?$/i.test(e) ? e.replace(/\bedition$/i, 'ed.').replace(/\bed$/i, 'ed.') : `${e} ed.`) : ''; }
function pages(p, style) {
  if (!p) return { text: '', plural: false };
  const dash = style === 'mla' ? '-' : '–';
  const text = p.replace(/\s*[-–—]\s*/g, dash);
  return { text, plural: !/^([a-z]?\d+|[ivxlcdm]+)$/i.test(p) };      /* "A1", a newspaper's section page, is one page */
}
const accessed = a => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a || '');
  return m ? { y: m[1], m: Number(m[2]), d: Number(m[3]) } : null;
};
const ordered = (...a) => a.filter(Boolean);

/* ---------- names ---------- */
const inv = a => (a.first ? `${a.last}, ${a.first}` : a.last);
const nat = a => (a.first ? `${a.first} ${a.last}` : a.last);
function initials(first) {
  return first.split(/[\s.]+/).filter(Boolean).map(t => t.split('-').filter(Boolean).map(p => `${p.charAt(0).toLocaleUpperCase()}.`).join('-')).join(' ');
}
const apaName = a => (a.first ? `${a.last}, ${initials(a.first)}` : a.last);

export function mlaAuthors(au) {
  if (!au.length) return '';
  if (au.length === 1) return inv(au[0]);
  if (au.length === 2) return `${inv(au[0])}, and ${nat(au[1])}`;
  return `${inv(au[0])}, et al.`;
}
export function apaAuthors(au) {
  const n = au.map(apaName);
  if (!n.length) return '';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]}, & ${n[1]}`;
  if (n.length <= 20) return `${n.slice(0, -1).join(', ')}, & ${n[n.length - 1]}`;
  return `${n.slice(0, 19).join(', ')}, . . . ${n[n.length - 1]}`;
}
export function chicagoAuthors(au) {
  if (!au.length) return '';
  if (au.length >= 11) return `${[inv(au[0]), ...au.slice(1, 7).map(nat)].join(', ')}, et al.`;
  if (au.length === 1) return inv(au[0]);
  if (au.length === 2) return `${inv(au[0])}, and ${nat(au[1])}`;
  return `${[inv(au[0]), ...au.slice(1, -1).map(nat)].join(', ')}, and ${nat(au[au.length - 1])}`;
}
/* the names with their role, for the people who lead a film or a podcast:
   MLA "Koenig, Sarah, host" · APA "Glass, I. (Host)" · Chicago "Coogler, Ryan, dir." */
const ROLES = {
  host: { mla: ['host', 'hosts'], apa: ['Host', 'Hosts'], chicago: ['host', 'hosts'] },
  director: { mla: ['director', 'directors'], apa: ['Director', 'Directors'], chicago: ['dir.', 'dirs.'] },
};
function withRole(au, role, style) {
  const names = style === 'apa' ? apaAuthors(au) : style === 'chicago' ? chicagoAuthors(au) : mlaAuthors(au);
  if (!names) return '';
  const r = ROLES[role][style][au.length > 1 ? 1 : 0];
  return style === 'apa' ? `${names} (${r})` : `${names}, ${r}`;
}
/** "Laura Miller" -> "L. Miller" (APA's form of a name typed whole). */
const apaWhole = s => { const p = s.split(/\s+/).filter(Boolean); return p.length > 1 ? `${initials(p.slice(0, -1).join(' '))} ${p[p.length - 1]}` : s; };

/* ---------- dates ---------- */
function mlaDate(s) { return ordered(s.day && s.month ? s.day : '', s.month ? MLA_MONTHS[s.month - 1] : '', s.year).join(' '); }
function chiDate(s) {
  if (!s.year) return '';
  if (s.month && s.day) return `${MONTHS[s.month - 1]} ${s.day}, ${s.year}`;
  return ordered(s.month ? MONTHS[s.month - 1] : '', s.year).join(' ');
}
function mlaAccessed(a) { return a ? `${a.d} ${MLA_MONTHS[a.m - 1]} ${a.y}` : ''; }
function longAccessed(a) { return a ? `${MONTHS[a.m - 1]} ${a.d}, ${a.y}` : ''; }

/* ---------- build ---------- */
const join = (...items) => cat(...items.flatMap((it, k) => (k ? [R(' '), it] : [it])));
const sepJoin = (items, sep = ', ') => cat(...items.flatMap((it, k) => (k ? [R(sep), it] : [it])));
const q = runs => cat(R('“'), endP(runs), R('”'));

function mla(s) {
  const au = s.type === 'film' ? withRole(s.authors, 'director', 'mla') : s.type === 'podcast' ? withRole(s.authors, 'host', 'mla') : mlaAuthors(s.authors);
  const author = au ? [R(au.endsWith('.') ? au : `${au}.`)] : null;
  const p = pages(s.pages, 'mla');
  const link = doiUrl(s) || s.url.replace(/^https?:\/\//i, '');
  const date = mlaDate(s);
  const acc = accessed(s.accessed);
  let first, els;
  const t = marks(headline(s.title, { keepRest: true }), s.type === 'book' || s.type === 'film');
  if (s.type === 'book') {
    first = endP(t);
    els = [s.edition ? edLabel(s.edition) : '', s.publisher, s.year, link].filter(Boolean).map(x => R(x));
  } else if (s.type === 'film') {
    first = endP(t);
    els = [s.publisher, s.year, link].filter(Boolean).map(x => R(x));
  } else if (s.type === 'interview') {
    const parts = [];
    if (s.title && s.ikind !== 'personal') parts.push(q(marks(headline(s.title, { keepRest: true }), false)));
    if (s.ikind === 'personal') {
      parts.push([R('Personal interview.')]);
      if (date) parts.push([R(`${date}.`)]);
      return { author, rest: join(...parts) };
    }
    if (s.interviewer) parts.push([R(`Interview by ${s.interviewer}.`)]);
    const ce = [s.site ? R(headline(s.site, { keepRest: true }), true) : null, date ? R(date) : null, link ? R(link) : null].filter(Boolean);
    if (ce.length) parts.push(endP(sepJoin(ce)));
    if (acc) parts.push([R(`Accessed ${mlaAccessed(acc)}.`)]);
    return { author, rest: join(...parts) };
  } else {
    first = q(marks(headline(s.title, { keepRest: true }), false));
    if (s.type === 'article') {
      els = [s.journal ? R(headline(s.journal, { keepRest: true }), true) : null, s.volume ? R(`vol. ${s.volume}`) : null, s.issue ? R(`no. ${s.issue}`) : null,
        date ? R(date) : null, p.text ? R(`${p.plural ? 'pp.' : 'p.'} ${p.text}`) : null, link ? R(link) : null].filter(Boolean);
    } else if (s.type === 'video') {
      els = [s.site ? R(s.site, true) : null, s.uploader ? R(`uploaded by ${s.uploader}`) : null, date ? R(date) : null, link ? R(link) : null].filter(Boolean);
    } else if (s.type === 'newspaper') {
      els = [s.site ? R(headline(s.site, { keepRest: true }), true) : null, date ? R(date) : null, p.text ? R(`${p.plural ? 'pp.' : 'p.'} ${p.text}`) : null, link ? R(link) : null].filter(Boolean);
    } else if (s.type === 'podcast') {
      els = [s.site ? R(headline(s.site, { keepRest: true }), true) : null, s.season ? R(`season ${s.season}`) : null, s.episode ? R(`episode ${s.episode}`) : null,
        s.publisher ? R(s.publisher) : null, date ? R(date) : null, link ? R(link) : null].filter(Boolean);
    } else {
      els = [s.site ? R(s.site, true) : null, s.publisher && !sameText(s.publisher, s.site) ? R(s.publisher) : null, date ? R(date) : null, link ? R(link) : null].filter(Boolean);
    }
  }
  const container = els.length ? endP(sepJoin(els)) : null;
  const tail = acc && s.type !== 'book' ? [R(`Accessed ${mlaAccessed(acc)}.`)] : [];
  const rest = join(first, ...(container ? [container] : []), ...tail);
  return { author, rest };
}

function apa(s) {
  const au = s.type === 'film' ? withRole(s.authors, 'director', 'apa') : s.type === 'podcast' ? withRole(s.authors, 'host', 'apa') : apaAuthors(s.authors);
  const channel = s.type === 'video' ? s.uploader : '';
  let who = au ? (channel && !sameText(channel, au) ? `${au} [${channel}]` : au) : '';
  if (!who && channel) who = channel;
  const date = ['website', 'video', 'newspaper', 'podcast', 'interview'].includes(s.type)
    ? (s.year ? ordered(s.year, s.month ? `${MONTHS[s.month - 1]}${s.day ? ` ${s.day}` : ''}` : '').join(', ') : 'n.d.')
    : (s.year || 'n.d.');
  const title = marks(apaTitle(s.title), false);
  const titleI = marks(apaTitle(s.title), true);          /* an italic container: * flips */
  const link = linkOf(s);
  const acc = accessed(s.accessed);
  const parts = [];
  const lead = !who;                                       /* the title takes the author's place */
  let author = null;
  const asTitle = (italic) => (italic ? titleI : title);
  const italicTitle = s.type !== 'article';
  if (who) author = [R(who.endsWith('.') ? who : `${who}.`)];
  else author = endP(asTitle(italicTitle));
  const datePart = R(`(${date}).`);
  if (s.type === 'book') {
    if (!lead) parts.push(s.edition ? cat(titleI, R(` (${edLabel(s.edition)}).`)) : endP(titleI));
    else if (s.edition) author = cat(titleI, R(` (${edLabel(s.edition)}).`));
    if (s.publisher) parts.push(endP([R(s.publisher)]));
    if (link) parts.push([R(link)]);
  } else if (s.type === 'article') {
    if (!lead) parts.push(endP(title));
    if (s.journal) {
      const jn = headline(s.journal, { keepRest: true });
      const p = pages(s.pages, 'apa');
      parts.push(cat(R(s.volume ? `${jn}, ${s.volume}` : jn, true), s.volume && s.issue ? R(`(${s.issue})`) : null, p.text ? R(`, ${p.text}`) : null, R('.')));
    }
    if (link) parts.push([R(link)]);
  } else if (s.type === 'video') {
    if (!lead) parts.push(cat(titleI, R(' [Video].')));
    else author = cat(titleI, R(' [Video].'));
    if (s.site) parts.push(endP([R(s.site)]));
    if (link) parts.push([R(link)]);
  } else if (s.type === 'newspaper') {
    if (!lead) parts.push(endP(title));
    else author = endP(title);
    if (s.site) { const p = pages(s.pages, 'apa'); parts.push(cat(R(headline(s.site, { keepRest: true }), true), p.text ? R(`, ${p.text}`) : null, R('.'))); }
    if (link) parts.push([R(link)]);
  } else if (s.type === 'podcast') {
    const num = s.season && s.episode ? ` (Season ${s.season}, Episode ${s.episode})` : s.episode ? ` (No. ${s.episode})` : s.season ? ` (Season ${s.season})` : '';
    const head = cat(title, R(`${num} [Audio podcast episode].`));
    if (!lead) parts.push(head); else author = head;
    if (s.site) parts.push(cat(R('In '), R(headline(s.site, { keepRest: true }), true), R('.')));
    if (s.publisher && !sameText(s.publisher, s.site)) parts.push(endP([R(s.publisher)]));
    if (link) parts.push([R(link)]);
  } else if (s.type === 'film') {
    const head = cat(titleI, R(' [Film].'));
    if (!lead) parts.push(head); else author = head;
    if (s.publisher) parts.push(endP([R(s.publisher)]));
    if (link) parts.push([R(link)]);
  } else if (s.type === 'interview') {
    const by = `[Interview${s.interviewer ? ` by ${apaWhole(s.interviewer)}` : ''}].`;
    const head = s.title ? cat(title, R(` ${by}`)) : [R(by)];
    if (!lead) parts.push(head); else author = head;
    if (s.site) parts.push(endP([R(headline(s.site, { keepRest: true }), true)]));
    if (link) parts.push([R(link)]);
  } else {
    if (!lead) parts.push(endP(titleI));
    if (s.site && !sameText(s.site, who)) parts.push(endP([R(s.site)]));
    if (link) parts.push(acc ? [R(`Retrieved ${longAccessed(acc)}, from ${link}`)] : [R(link)]);
  }
  return { author, rest: join(datePart, ...parts) };
}

function chicago(s) {
  let au = s.type === 'film' ? withRole(s.authors, 'director', 'chicago') : s.type === 'podcast' ? withRole(s.authors, 'host', 'chicago') : chicagoAuthors(s.authors);
  if (!au && s.type === 'video' && s.uploader) au = s.uploader;
  const author = au ? [R(au.endsWith('.') ? au : `${au}.`)] : null;
  const link = linkOf(s);
  const acc = accessed(s.accessed);
  const date = chiDate(s);
  const items = [];
  const tI = marks(headline(s.title, { keepRest: true }), true);
  const tQ = marks(headline(s.title, { keepRest: true }), false);
  if (s.type === 'book') {
    items.push(endP(tI));
    if (s.edition) items.push([R(edLabel(s.edition))]);
    const pub = ordered(s.city ? `${s.city}:` : '', s.publisher ? `${s.publisher}${s.year ? ',' : ''}` : '', s.year).join(' ');
    if (pub) items.push(endP([R(pub)]));
    if (link) items.push(endP([R(link)]));
  } else if (s.type === 'article') {
    items.push(q(tQ));
    const p = pages(s.pages, 'chicago');
    const when = chiDate(s);
    const jn = s.journal ? headline(s.journal, { keepRest: true }) : '';
    items.push(endP(cat(jn ? R(jn, true) : null, s.volume ? R(`${jn ? ' ' : ''}${s.volume}`) : null, s.issue ? R(`${s.volume ? ', ' : jn ? ' ' : ''}no. ${s.issue}`) : null,
      when ? R(`${jn || s.volume || s.issue ? ' ' : ''}(${when})`) : null, p.text ? R(`${jn || s.volume || s.issue || when ? ': ' : ''}${p.text}`) : null)));
    if (link) items.push(endP([R(link)]));
  } else if (s.type === 'video') {
    items.push(q(tQ));
    items.push(endP([R(`${s.site ? `${s.site} video` : 'Video'}${s.length ? `, ${s.length}` : ''}`)]));
    if (date) items.push(endP([R(date)]));
    if (link) items.push(endP([R(link)]));
  } else if (s.type === 'newspaper') {
    items.push(q(tQ));
    if (s.site || date) items.push(endP(cat(s.site ? R(headline(s.site, { keepRest: true }), true) : null, date ? R(`${s.site ? ', ' : ''}${date}`) : null)));
    if (link) items.push(endP([R(link)]));
  } else if (s.type === 'podcast') {
    items.push(q(tQ));
    if (s.site) items.push(endP(cat(R(headline(s.site, { keepRest: true }), true), s.season ? R(`, season ${s.season}`) : null, s.episode ? R(`, episode ${s.episode}`) : null)));
    const pub = ordered(s.publisher, date).join(', ');
    if (pub) items.push(endP([R(pub)]));
    items.push(endP([R(`Podcast audio${s.length ? `, ${s.length}` : ''}`)]));
    if (link) items.push(endP([R(link)]));
  } else if (s.type === 'film') {
    items.push(endP(tI));
    const pub = ordered(s.publisher, s.year).join(', ');
    if (pub) items.push(endP([R(pub)]));
    if (link) items.push(endP([R(link)]));
  } else if (s.type === 'interview') {
    if (s.ikind === 'personal') {
      items.push([R('Interview by the author.')]);
      if (date) items.push(endP([R(date)]));
      return { author, rest: join(...items) };
    }
    if (s.title) items.push(q(tQ));
    if (s.interviewer) items.push([R(`Interview by ${s.interviewer}.`)]);
    if (s.site || date) items.push(endP(cat(s.site ? R(headline(s.site, { keepRest: true }), true) : null, date ? R(`${s.site ? ', ' : ''}${date}`) : null)));
    if (link) items.push(endP([R(link)]));
  } else {
    items.push(q(tQ));
    if (s.site) items.push(endP([R(s.site)]));
    if (s.publisher && !sameText(s.publisher, s.site)) items.push(endP([R(s.publisher)]));
    if (date) items.push(endP([R(date)]));
    else if (acc) items.push([R(`Accessed ${longAccessed(acc)}.`)]);
    if (link) items.push(endP([R(link)]));
  }
  return { author, rest: join(...items) };
}

/** APA's in-text form of a personal interview: "(J. Smith, personal communication, March 12, 2024)". */
function personalComm(s) {
  const a = s.authors[0];
  const who = a ? (a.first ? `${initials(a.first)} ${a.last}` : a.last) : 'Name';
  const when = s.year ? (s.month ? `${MONTHS[s.month - 1]}${s.day ? ` ${s.day}` : ''}, ${s.year}` : s.year) : 'the date';
  return `(${who}, personal communication, ${when})`;
}

/**
 * Format one source. `title` is required (an interview needs the person
 * interviewed instead); anything else left blank is left out.
 * -> { author, rest, runs, empty, skip?, note? }: `skip` (with no runs) when
 *    the style has no entry for it, saying why; `note` is a word on the style.
 */
export function format(src, style) {
  const s = clean(src);
  if (!s.title && !(s.type === 'interview' && s.authors.length)) return { author: null, rest: [], runs: [], empty: true };
  if (s.type === 'interview' && s.ikind === 'personal' && style === 'apa') {
    return { author: null, rest: [], runs: [], empty: false, skip: `APA 7 leaves an interview you did yourself out of the reference list. Cite it in your text instead: ${personalComm(s)}.` };
  }
  const f = style === 'apa' ? apa(s) : style === 'chicago' ? chicago(s) : mla(s);
  const author = f.author ? merge(f.author) : null;
  const rest = merge(f.rest);
  const out = { author, rest, runs: author ? merge([...author, R(' '), ...rest]) : rest, empty: false };
  if (s.type === 'interview' && s.ikind === 'personal' && style === 'chicago') out.note = 'Chicago usually cites an interview you did yourself in a note rather than the bibliography; ask whether your teacher wants it listed.';
  if (s.type === 'interview' && s.ikind !== 'personal' && style === 'apa') out.note = 'APA 7 cites a published interview as the kind of work it appeared in. If it is a newspaper article, a video or a podcast episode, that source type may suit it better.';
  return out;
}

/* ---------- the list ---------- */
const lead = t => t.toLowerCase().replace(/^(?:a|an|the)\s+/, '');
function sortKey(src, style) {
  const s = clean(src);
  const au = s.authors.length ? s.authors.map(a => `${a.last} ${a.first}`).join(' ') : (s.type === 'video' && s.uploader && !s.authors.length ? s.uploader : '');
  const base = (au || lead(s.title)).toLowerCase();
  const yr = style === 'apa' ? (s.year ? s.year.padStart(4, '0') : '0000') : '';
  return [base.replace(/[^\p{L}\p{N} ]/gu, ''), yr, lead(s.title)];
}
export function sortSources(list, style) {
  const keys = new Map(list.map(s => [s, sortKey(s, style)]));
  return [...list].sort((a, b) => {
    const x = keys.get(a), y = keys.get(b);
    for (let k = 0; k < 3; k++) { const c = x[k].localeCompare(y[k], 'en', { sensitivity: 'base', numeric: true }); if (c) return c; }
    return 0;
  });
}

/** The saved list as printed: sorted, with the repeated-author dash for MLA and Chicago. `skipped`: sources the style has no entry for. */
export function bibliography(list, style) {
  const items = [];
  const skipped = [];
  let prev = '';
  for (const src of sortSources(list, style)) {
    const f = format(src, style);
    if (f.skip) skipped.push({ id: src.id, why: f.skip });
    if (f.empty || f.skip) continue;
    const key = f.author ? toText(f.author) : '';
    let runs = f.runs;
    if (key && key === prev && style !== 'apa') runs = merge([R(style === 'mla' ? '---.' : '———.'), R(' '), ...f.rest]);
    prev = key;
    items.push({ id: src.id, runs });
  }
  return { heading: HEADINGS[style] || HEADINGS.mla, items, skipped };
}

/** HTML for the clipboard: italics as <i>, a hanging indent for a list. */
export function listHtml(items) {
  return items.map(it => `<p style="margin:0 0 0.5em 0.5in;text-indent:-0.5in">${toHtml(it.runs)}</p>`).join('');
}
export const listText = items => items.map(it => toText(it.runs)).join('\n');
