/* ============================================================
   qr-scan.js — Static QR's "Scan" side: read a QR code with the camera,
   or from a picture. Loaded by js/apps/qr.js the first time Scan is
   opened (this file is not an app of its own).

     mountScan({ api, root, openLink?, history? }) -> teardown

   A scanned code is text from a stranger, so:
   · it is shown with textContent, never as markup;
   · nothing is opened for you — a link waits for a press on "Open link",
     and only http and https links get that button; every other kind of
     code (javascript:, data:, mailto:… or plain words) can only be
     copied;
   · the link is shown in full with its real host picked out, and a login
     in the address or a look-alike (xn--) host is called out.
   Some codes are read for what they are, and still only act on a press:
   · Wi-Fi (WIFI:S:…;T:…;P:…;;) shows the network, its security and a
     Copy password button. A web page can't join a network, and says so.
   · A contact (a vCard or a MECARD) is shown in full; "Add to Contacts…"
     asks first, then writes it through js/core/contacts.js.
   · An event (a VEVENT, or a whole VCALENDAR) is read by js/core/ics.js
     the way Calendar's import reads a file; "Add to Calendar…" asks
     first, then adds it through js/core/calendar.js.
   · A place (geo:lat,lon) shows its coordinates, with Copy, a forecast
     in Weather and a map in the Browser — each one only on a press.
   history (from qr.js): every code read is remembered there, newest
   first, unless the person switched the history off; qr.js takes any
   Wi-Fi password out before it is stored. A code shown again from the
   history is shown exactly like a new one, and opens nothing either.
   The camera is released the moment a code is read, when a picture is
   chosen instead, when Scan is left, and when the window closes.
   Reading itself is js/core/scancam.js (BarcodeDetector, else jsQR).
   ============================================================ */
import { openCamera, cameraProblem, stopStream, readQR, describeCode } from '../core/scancam.js';
import * as C from '../core/contacts.js';
import * as CAL from '../core/calendar.js';
import * as ICS from '../core/ics.js';

const EVERY = 150;               /* ms between looks at the camera */
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const line = (s, n = 200) => String(s ?? '').replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- what a code is, beyond text and links ---------- */

/** WIFI:S:<ssid>;T:<WPA|WEP|nopass>;P:<password>;H:<true>;; — fields in any order, \ escapes \ ; , : " */
export function parseWifi(text) {
  const t = String(text || '');
  if (!/^WIFI:/i.test(t) || t.length > 1000) return null;
  const parts = [];
  let cur = '';
  for (let i = 5; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\\' && i + 1 < t.length) { cur += t[i + 1]; i++; continue; }
    if (ch === ';') { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  const f = {};
  for (const p of parts) {
    const at = p.indexOf(':');
    if (at < 1) continue;
    const k = p.slice(0, at).toUpperCase();
    if (!(k in f)) f[k] = p.slice(at + 1);
  }
  const ssid = String(f.S || '').replace(CTRL, '').slice(0, 64);
  if (!ssid) return null;
  const T = String(f.T || '').toUpperCase();
  const password = String(f.P || '').slice(0, 128);
  const security = T === 'WEP' ? 'WEP' : T === 'NOPASS' || (!T && !password) ? 'none' : /EAP/.test(T) ? 'WPA Enterprise' : 'WPA';
  return { kind: 'wifi', ssid, security, password: security === 'none' ? '' : password, hidden: /^true$/i.test(String(f.H || '')) };
}

/** geo:lat,lon[,alt][;params][?q=…(label)] (RFC 5870, and the label Android's maps use). */
export function parseGeo(text) {
  const m = /^geo:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,-?\d+(?:\.\d+)?)?(?:;[^?]*)?(?:\?(.*))?$/i.exec(String(text || '').trim());
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  let label = '';
  if (m[3]) {
    try {
      const q = new URLSearchParams(m[3]).get('q') || '';
      const l = /\(([^()]{1,80})\)\s*$/.exec(q);
      if (l) label = line(l[1], 80);
    } catch (e) { /* no label */ }
  }
  return { kind: 'geo', lat, lon, label };
}

/** A VEVENT on its own (the usual QR form) or a whole VCALENDAR, read as Calendar's import reads a file. */
export function parseEvent(text) {
  const t = String(text || '').trim();
  if (!/^BEGIN:(VEVENT|VCALENDAR)/i.test(t) || t.length > 20000) return null;
  const src = /^BEGIN:VCALENDAR/i.test(t) ? t : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${t}\r\nEND:VCALENDAR`;
  let r;
  try { r = ICS.parse(src); } catch (e) { return null; }
  if (!r || !r.ok || (!r.items.length && !r.skipped.length)) return null;
  return { kind: 'event', items: r.items.slice(0, 20), skipped: r.skipped.slice(0, 20) };
}

/** A vCard or a MECARD. */
export function parseContact(text) {
  const t = String(text || '').trim();
  if (/^BEGIN:VCARD/i.test(t)) {
    const r = C.parseVCards(t, { max: 10, maxBytes: 20000 });
    return r.contacts.length ? { kind: 'contact', contacts: r.contacts } : null;
  }
  if (/^MECARD:/i.test(t)) {
    const c = C.parseMeCard(t);
    return c ? { kind: 'contact', contacts: [c] } : null;
  }
  return null;
}

/** What a code holds, for the result and for the history list. */
export function readCode(text) {
  return parseWifi(text) || parseGeo(text) || parseEvent(text) || parseContact(text) || { kind: 'plain', d: describeCode(text) };
}
const coordText = (lat, lon) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
/** One line for the history: "Wi-Fi: Cafe Guest", "Event: Science fair", "example.com". */
export function shortLabel(text) {
  const r = readCode(text);
  if (r.kind === 'wifi') return `Wi-Fi: ${r.ssid}`;
  if (r.kind === 'geo') return `Place: ${r.label || coordText(r.lat, r.lon)}`;
  if (r.kind === 'event') return `Event: ${line((r.items[0] || r.skipped[0] || {}).title || 'Untitled event', 60)}`;
  if (r.kind === 'contact') return `Contact: ${C.display(r.contacts[0])}`;
  if (r.d.kind === 'link' && r.d.link.host) return r.d.link.host;
  return line(text, 60) || 'Empty code';
}

export function mountScan({ api, root, openLink, history }) {
  const { h, icon } = api;
  const S = { dead: false, stream: null, gen: 0, timer: 0, busy: false };
  const open = openLink || (url => api.openApp('browser', { url }));

  const video = h('video.qrs__video', { muted: true, playsinline: true, autoplay: true, 'aria-label': 'What the camera sees' });
  video.muted = true;
  const msg = h('div.qrs__msg', { hidden: true });
  const frame = h('div.qrs__frame', { 'aria-hidden': 'true' });
  const stage = h('div.qrs__stage', video, frame, msg);
  const status = h('p.qrs__status', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.qrs__result', { hidden: true });
  const pick = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Choose a picture with a QR code' });
  const againBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-again' }, onclick: () => start() }, icon('camera'), h('span', { text: 'Scan with camera' }));
  const fileBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-file' }, onclick: () => pick.click() }, icon('image'), h('span', { text: 'Choose a picture…' }));
  const actions = h('div.qrs__actions', againBtn, fileBtn, pick);
  const note = h('p.qrs__note', icon('lock'), h('span', { text: 'The camera picture and what it says stay on this device. Nothing is opened until you press a button.' }));
  const histEl = h('section.qrs__hist', { 'aria-label': 'Scan history' });
  const el = h('section.qrs', { 'aria-label': 'Scan a QR code' }, stage, status, result, actions, note, history ? histEl : null);
  root.appendChild(el);

  const say = t => { status.textContent = t; };

  function release() {
    clearTimeout(S.timer);
    S.timer = 0;
    stopStream(S.stream);
    S.stream = null;
    try { video.pause(); } catch (e) { /* nothing playing */ }
    video.srcObject = null;
    el.classList.remove('is-live');
  }

  function problem(p) {
    release();
    el.classList.remove('has-result');
    msg.replaceChildren(icon('camera'), h('b', { text: p.title }), h('small', { text: p.body }));
    msg.hidden = false;
    say(p.title);
    againBtn.lastChild.textContent = 'Try again';
  }

  async function start() {
    const gen = ++S.gen;
    release();
    el.classList.remove('has-result');
    result.hidden = true;
    result.replaceChildren();
    msg.hidden = true;
    say('Starting the camera…');
    let stream;
    try { stream = await openCamera({ facing: 'environment' }); } catch (err) {
      if (gen === S.gen && !S.dead) problem(cameraProblem(err));
      return;
    }
    if (gen !== S.gen || S.dead) { stopStream(stream); return; }   /* left or closed while the browser was asking */
    S.stream = stream;
    video.srcObject = stream;
    video.play?.().catch?.(() => {});
    el.classList.add('is-live');
    againBtn.lastChild.textContent = 'Scan with camera';
    say('Point the camera at a QR code.');
    loop(gen);
  }

  function loop(gen) {
    S.timer = setTimeout(async () => {
      if (gen !== S.gen || S.dead || !S.stream) return;
      if (!S.busy && video.videoWidth) {
        S.busy = true;
        let found = null;
        try { found = await readQR(video); } catch (err) { found = null; }
        S.busy = false;
        if (gen !== S.gen || S.dead) return;
        if (found) { release(); show(found); return; }
      }
      loop(gen);
    }, EVERY);
  }

  /* ---------- the result ---------- */
  async function copy(text, btn, done = 'Copied', heard = 'Copied to the clipboard.') {
    try { await navigator.clipboard.writeText(text); btn.lastChild.textContent = done; say(heard); }
    catch (e) { say('Couldn’t copy: the clipboard isn’t available here.'); }
  }
  const row = (k, v, fk) => (v ? h('div.qrs__row', h('small', { text: k }), h('span', { text: v, dataset: fk ? { fk } : null })) : null);

  /* Wi-Fi: the network, and its password only on a press */
  function wifiView(w, fromHistory) {
    let shown = false;
    const dots = '•'.repeat(Math.min(12, Math.max(6, w.password.length)));
    const pass = h('span.mono', { dataset: { fk: 'qrs-wifi-pass' }, text: dots });
    const eye = h('button.ibtn', { type: 'button', 'aria-label': 'Show the password', 'aria-pressed': 'false', dataset: { fk: 'qrs-wifi-show' },
      onclick: () => { shown = !shown; pass.textContent = shown ? w.password : dots; eye.setAttribute('aria-pressed', String(shown)); eye.setAttribute('aria-label', shown ? 'Hide the password' : 'Show the password'); } }, icon('eye'));
    const copyPass = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-wifi-copy' }, onclick: () => copy(w.password, copyPass, 'Password copied', 'The Wi-Fi password is on the clipboard.') },
      icon('copy'), h('span', { text: 'Copy password' }));
    const copyName = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-wifi-name' }, onclick: () => copy(w.ssid, copyName, 'Name copied', 'The network name is on the clipboard.') },
      icon('copy'), h('span', { text: 'Copy network name' }));
    const sec = w.security === 'none' ? 'Open — no password' : w.security === 'WEP' ? 'WEP (old and weak)' : w.security === 'WPA Enterprise' ? 'WPA Enterprise (needs a user name too)' : 'WPA / WPA2 / WPA3';
    return {
      kids: [
        h('div.qrs__kind', { text: 'Wi-Fi network' }),
        h('div.qrs__big', { dataset: { fk: 'qrs-wifi-ssid' }, text: w.ssid }),
        h('div.qrs__rows', row('Security', sec, 'qrs-wifi-sec'), w.hidden ? row('Hidden', 'Yes — it won’t appear in the list, so type its name') : null,
          w.password ? h('div.qrs__row', h('small', { text: 'Password' }), pass, eye) : null),
        fromHistory && w.security !== 'none' ? h('p.qrs__flag', icon('lock'), h('span', { text: 'The password isn’t kept in the history. Scan the code again to copy it.' })) : null,
        h('p.qrs__hint', { text: 'A web page can’t join a network for you. Open your device’s Wi-Fi settings, choose this network and paste the password.' }),
      ],
      buttons: [w.password ? copyPass : null, copyName],
      heard: `Found the Wi-Fi network ${w.ssid}. Nothing has been joined or opened.`,
    };
  }

  function contactCard(c) {
    return h('div.qrs__rows',
      row('Name', C.display(c), 'qrs-contact-name'),
      row('Work', C.workLine(c)),
      ...c.phones.map(p => row(p.label, p.value)),
      ...c.emails.map(e => row(e.label, e.value)),
      row('Birthday', C.birthdayText(c.birthday)),
      row('Address', c.address));
  }
  function contactView(r) {
    const c = r.contacts[0];
    const btn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-add-contact' } }, icon('user'), h('span', { text: 'Add to Contacts…' }));
    const goTo = id => { btn.lastChild.textContent = 'Open in Contacts'; btn.onclick = () => api.openApp('contacts', { contact: id }); };
    const same = C.findSame(C.read(), c);
    if (same) goTo(same.id);
    else btn.onclick = async () => {
      const ok = await api.confirm({ title: 'Add this person to Contacts?', message: 'From a QR code you scanned. Nothing is added unless you press Add.', body: h('div.qrs__confirm', contactCard(c)), ok: 'Add' });
      if (!ok || S.dead) return;
      const d = C.read();
      const there = C.findSame(d, c);
      if (there) { goTo(there.id); say(`${C.display(c)} is already in Contacts.`); return; }
      if (d.contacts.length >= C.MAX_CONTACTS) { api.notify({ app: 'Static QR', icon: 'alert', title: 'Contacts is full', message: `It keeps up to ${C.MAX_CONTACTS} people.` }); return; }
      const fresh = C.normContact({ ...C.cloneContact(c), id: C.uid(), created: Date.now(), updated: Date.now() });
      d.contacts.push(fresh);
      C.write(d);
      goTo(fresh.id);
      say(`Added ${C.display(fresh)} to Contacts.`);
      api.notify({ app: 'Static QR', icon: 'user', title: 'Added to Contacts', message: C.display(fresh), timeout: 6000, actions: [{ label: 'Open', onClick: () => api.openApp('contacts', { contact: fresh.id }) }] });
    };
    return {
      kids: [h('div.qrs__kind', { text: 'Contact card' }), contactCard(c),
        same ? h('p.qrs__flag', icon('check'), h('span', { text: 'Already in Contacts.' })) : null,
        r.contacts.length > 1 ? h('p.qrs__hint', { text: `The code holds ${r.contacts.length} cards; this is the first.` }) : null],
      buttons: [btn],
      heard: `Found a contact card for ${C.display(c)}. Nothing has been added.`,
    };
  }

  function eventView(r) {
    const it = r.items[0];
    if (!it) {
      return { kids: [h('div.qrs__kind', { text: 'Event' }), h('div.qrs__big', { text: r.skipped[0].title }), h('p.qrs__flag', icon('alert'), h('span', { dataset: { fk: 'qrs-event-skip' }, text: r.skipped[0].why }))],
        buttons: [], heard: 'Found an event Calendar can’t add.' };
    }
    const probe = it.kind === 'event' ? CAL.normEvent({ ...it.draft, id: 'x' }, it.draft.date) : null;
    const card = () => h('div.qrs__rows',
      row('Event', it.title, 'qrs-event-title'),
      row('When', it.kind === 'span' ? `${it.when} · drawn as a banner` : it.when, 'qrs-event-when'),
      row('Repeats', probe && probe.repeat !== 'none' ? CAL.repeatText(probe) : ''),
      row('Where', it.draft.location),
      row('Notes', it.draft.notes ? line(it.draft.notes, 160) : ''));
    const btn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-add-event' } }, icon('calendar'), h('span', { text: 'Add to Calendar…' }));
    btn.onclick = async () => {
      const ok = await api.confirm({ title: 'Add this event to your calendar?', message: 'From a QR code you scanned. Nothing is added unless you press Add, and no reminder is set.', body: h('div.qrs__confirm', card()), ok: 'Add' });
      if (!ok || S.dead) return;
      const res = it.kind === 'span' ? CAL.saveSpan(it.draft) : CAL.addEvent(it.draft);
      if (!res.ok) { api.notify({ app: 'Static QR', icon: 'alert', title: 'It wasn’t added', message: (res.issues && res.issues[0] && res.issues[0].text) || '', timeout: 6000 }); return; }
      const day = it.kind === 'span' ? res.span.start : res.event.date;
      const where = it.kind === 'span' ? { date: day } : { event: res.event.id, date: day };
      btn.lastChild.textContent = 'Open in Calendar';
      btn.onclick = () => api.openApp('calendar', where);
      say(`Added ${it.title} to Calendar.`);
      api.notify({ app: 'Static QR', icon: 'calendar', title: 'Added to Calendar', message: `${it.title} · ${it.when}`, timeout: 6000, actions: [{ label: 'Open', onClick: () => api.openApp('calendar', where) }] });
    };
    return {
      kids: [h('div.qrs__kind', { text: 'Event' }), card(),
        ...it.notes.map(x => h('p.qrs__hint', { text: x })),
        r.items.length > 1 ? h('p.qrs__hint', { text: `The code holds ${r.items.length} events; this is the first.` }) : null],
      buttons: [btn],
      heard: `Found the event ${it.title}. Nothing has been added.`,
    };
  }

  function geoView(g) {
    const coords = `${+g.lat.toFixed(6)}, ${+g.lon.toFixed(6)}`;
    const copyBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-geo-copy' }, onclick: () => copy(coords, copyBtn) }, icon('copy'), h('span', { text: 'Copy coordinates' }));
    const wx = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-geo-weather' },
      onclick: () => api.openApp('weather', { place: { name: g.label || coordText(g.lat, g.lon), lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4) } }) }, icon('cloud-sun'), h('span', { text: 'Forecast here' }));
    const osm = `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=16/${g.lat}/${g.lon}`;
    const map = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-geo-map' }, onclick: () => open(osm) }, icon('external-link'), h('span', { text: 'Open the map' }));
    return {
      kids: [h('div.qrs__kind', { text: 'Place' }),
        g.label ? h('div.qrs__big', { text: g.label }) : null,
        h('div.qrs__big.mono', { dataset: { fk: 'qrs-geo-coords' }, text: coordText(g.lat, g.lon) }),
        h('p.qrs__hint', { text: 'Forecast here adds it to Weather’s places. Open the map shows it on OpenStreetMap in the Browser.' })],
      buttons: [wx, map, copyBtn],
      heard: `Found a place at ${coordText(g.lat, g.lon)}. Nothing has been opened.`,
    };
  }

  function plainView(text, d) {
    const kids = [];
    const buttons = [];
    if (d.kind === 'link' && d.link.host) {
      const L = d.link;
      kids.push(h('div.qrs__kind', { text: L.openable ? 'Web link' : `${L.scheme.replace(':', '')} link — not a web link` }));
      kids.push(h('div.qrs__hostline', h('span', { text: 'It goes to ' }), h('b.qrs__host', { text: L.host })));
      kids.push(h('div.qrs__url.mono', { dataset: { fk: 'qrs-url' } },
        h('span.qrs__dim', { text: L.before }), L.user ? h('span.qrs__warn', { text: L.user }) : null,
        h('b.qrs__hostpart', { text: L.host }), h('span.qrs__dim', { text: L.port }), h('span', { text: L.rest })));
      if (L.hasLogin) kids.push(h('p.qrs__flag', icon('alert'), h('span', { text: 'This address has a user name in it. The real site is the part after the @ — the part before it is just decoration.' })));
      if (L.lookAlike) kids.push(h('p.qrs__flag', icon('alert'), h('span', { text: 'The host uses letters from another alphabet (shown here in its xn-- form). It can imitate a familiar site — check it carefully.' })));
      if (L.openable) {
        buttons.push(h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'qrs-open' }, onclick: () => open(L.href) }, icon('external-link'), h('span', { text: 'Open link' })));
      } else {
        kids.push(h('p.qrs__flag', icon('lock'), h('span', { text: 'Only web links (http and https) can be opened from here. This one can only be copied.' })));
      }
    } else if (d.kind === 'link') {
      /* javascript:, data:, mailto:, sms: … no host to show: the text exactly as scanned */
      kids.push(h('div.qrs__kind', { text: `${d.link.scheme.replace(':', '')} code — not a web link` }));
      kids.push(h('div.qrs__text.mono', { text, dataset: { fk: 'qrs-text' } }));
      kids.push(h('p.qrs__flag', icon('lock'), h('span', { text: 'Only web links (http and https) can be opened from here. This code can only be copied.' })));
    } else {
      kids.push(h('div.qrs__kind', { text: 'Text' }));
      kids.push(h('div.qrs__text', { text, dataset: { fk: 'qrs-text' } }));
    }
    return { kids, buttons, heard: d.kind === 'link' && d.link.host ? `Found a link to ${d.link.host}. Nothing has been opened.` : 'Found a code. Nothing has been opened.' };
  }

  function show(found) {
    const fromHistory = found.via === 'history';
    const r = readCode(found.text);
    const v = r.kind === 'wifi' ? wifiView(r, fromHistory) : r.kind === 'contact' ? contactView(r) : r.kind === 'event' ? eventView(r) : r.kind === 'geo' ? geoView(r) : plainView(found.text, r.d);
    const via = fromHistory ? `From your scan history · scanned ${api.fmt.fmtAgo(found.at).replace('Yesterday', 'yesterday')}.`
      : found.via === 'browser' ? 'Read by this browser’s own QR reader.' : 'Read by the QR reader bundled with StaticOS.';
    /* the code's own words, for the kinds shown as something else (a Wi-Fi password stays hidden) */
    const raw = r.kind !== 'plain' && r.kind !== 'wifi' ? h('details.qrs__raw', h('summary', { text: 'The code’s text' }), h('pre.qrs__text.mono', { text: found.text })) : null;
    const copyBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-copy' }, onclick: () => copy(found.text, copyBtn) }, icon('copy'), h('span', { text: r.kind === 'plain' ? 'Copy' : 'Copy the code’s text' }));
    /* replaceChildren would write a null out as the word "null" */
    result.replaceChildren(...[...v.kids, raw, h('div.qrs__actions', ...v.buttons.filter(Boolean), r.kind === 'wifi' ? null : copyBtn), h('small.qrs__via', { text: via })].filter(Boolean));
    result.hidden = false;
    msg.hidden = true;
    el.classList.add('has-result');      /* an empty camera box over a code read from a picture says nothing */
    againBtn.lastChild.textContent = 'Scan another';
    say(v.heard);
    if (!fromHistory && history) { history.add(found.text); paintHistory(); }
    result.querySelector('button')?.focus?.({ preventScroll: true });
  }

  /* ---------- the history ---------- */
  function paintHistory() {
    if (!history) return;
    const keep = history.keep();
    const list = history.list();
    const keepIn = h('input', { type: 'checkbox', checked: keep, dataset: { fk: 'qrs-hist-keep' },
      onchange: e => { history.setKeep(e.target.checked); paintHistory(); say(e.target.checked ? 'Scans are kept in the history.' : 'The history is off, and the scans it kept are forgotten.'); } });
    const rows = list.map(x => h('div.qrs__hrow', { role: 'listitem' },
      h('button.qrs__hbtn', { type: 'button', dataset: { fk: 'qrs-hist-item', id: x.id }, title: 'Show it again (nothing opens)',
        onclick: () => { S.gen++; release(); show({ text: x.text, via: 'history', at: x.at }); } },
      h('span.qrs__hlabel', { text: shortLabel(x.text) }), h('small', { text: api.fmt.fmtAgo(x.at).replace('Yesterday', 'yesterday') })),
      h('button.ibtn', { type: 'button', 'aria-label': `Forget ${shortLabel(x.text)}`, dataset: { fk: 'qrs-hist-del' }, onclick: () => { history.remove(x.id); paintHistory(); } }, icon('x'))));
    histEl.replaceChildren(
      h('div.qrs__hhead', h('b', { text: 'Scan history' }), h('span.qr-grow'),
        list.length ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'qrs-hist-clear' }, onclick: () => { history.clear(); paintHistory(); say('The scan history is empty.'); } }, icon('trash'), h('span', { text: 'Clear' })) : null),
      h('label.qr-check-row', keepIn, h('span', { text: 'Keep a history of what I scan' })),
      list.length ? h('div.qrs__hlist', { role: 'list' }, rows)
        : h('small.qrs__hint', { text: keep ? 'Codes you scan show up here. Wi-Fi passwords are never kept.' : 'Nothing is kept while this is off.' }),
      ...(list.length ? [h('small.qrs__hint', { text: 'Kept on this device only. Wi-Fi passwords are never kept.' })] : []));
  }
  paintHistory();

  /* ---------- a picture instead ---------- */
  pick.addEventListener('change', async () => {
    const file = pick.files?.[0];
    pick.value = '';
    if (!file) return;
    S.gen++;
    release();
    result.hidden = true;
    msg.hidden = true;
    el.classList.remove('has-result');
    say('Reading the picture…');
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) { bmp = null; }
    if (S.dead) { bmp?.close?.(); return; }
    if (!bmp) { say('That file couldn’t be opened as a picture.'); return; }
    let found = null;
    try { found = await readQR(bmp); } catch (e) { found = null; }
    bmp.close?.();
    if (S.dead) return;
    if (!found) { say('No QR code found in that picture. Try a sharper, closer one.'); return; }
    show(found);
  });

  start();

  return () => {
    S.dead = true;
    S.gen++;
    release();
    el.remove();
  };
}

export default { mountScan, parseWifi, parseGeo, parseEvent, parseContact, readCode, shortLabel };
