/* ============================================================
   contacts.js — Static Contacts: a simple address book on this device.

   A name, a company and job title, phone numbers, email addresses, an
   address, a birthday, notes, groups and a picture chosen from your own
   files (Pictures and the rest of your home folder). Search finds people
   by anything on their card. You can import a .vcf file and save
   everyone, one group or one person as .vcf, or print them.

   Also here:
   · Favourites (the star on a card) and Recently added, in the group menu.
   · A birthday can have a yearly reminder (9 AM on the day, the day
     before or a week before) — Automations' reminder engine, src
     'contacts', kept topped up by js/core/contacts.js init() — and every
     birthday shows in Calendar (the Birthdays layer, js/core/callayers.js).
   · Find duplicates suggests pairs (the same name, a number or an email in
     common); merging is always a side-by-side review where the person
     picks each field. Nothing is ever merged by itself.
   · Show as QR code: the card as a vCard, drawn by Static QR's own
     encoder (js/apps/qr.js), with the notes left out.
   · A card can be linked to one of your Static Social friends — only one
     you pick from your own friends list; nothing is linked for you.
   Opening it with { contact: id } shows that person (a birthday
   reminder's "Open" and Calendar's Birthdays layer do this).

   Plain on purpose:
   · It stays on this device: saved under store('portal.contacts') and
     nowhere else. The app never makes a network request, and it does not
     read the computer's own contacts.
   · Everything is drawn as text (never HTML). The only links it makes are
     tel: and mailto:, from numbers and addresses that passed the checks
     in js/core/contacts.js; anything else is shown but not linked.
   · A picture is a path to a file in your home folder; the file itself
     stays where it is. If it is deleted the card shows initials again.
   · No CSV: a spreadsheet would run a cell that starts with = + - or @.
     vCard has no such risk, so vCard is what goes in and out.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as C from '../core/contacts.js';
import vfs from '../core/vfs.js';
import media from '../core/media.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-contacts-css')) {
  const link = document.createElement('link');
  link.id = 'feat-contacts-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-contacts.css';
  document.head.appendChild(link);
}

const NARROW = 540;
const DATA_IMG = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

/** A URL an <img> may show for a picture path in the person's files, or null. */
async function photoUrl(path) {
  if (!C.photoOk(path)) return null;
  const n = vfs.node(path);
  if (!n || n.type !== 'file') return null;
  try {
    if (media.isMedia(n)) return await media.urlOf(n);
    const c = typeof n.content === 'string' ? n.content : '';
    return DATA_IMG.test(c) && c.length < 4_000_000 ? c : null;
  } catch (e) { return null; }
}

/* the group menu's two lists that aren't groups: a group name is trimmed, so it can never start with a space */
const FAV = ' favourites';
const RECENT = ' recent';
const REMIND_TEXT = { 0: '9 AM on the day', 1: '9 AM the day before', 7: '9 AM a week before' };

defineApp({
  id: 'contacts',
  name: 'Static Contacts',
  icon: 'user',
  g1: '#ffb86b', g2: '#e0573b',
  category: 'Productivity',
  keywords: ['contacts', 'address book', 'people', 'phone', 'phone number', 'email', 'vcard', 'vcf', 'friends', 'family', 'names', 'birthday', 'birthdays', 'company', 'favourites', 'duplicates', 'merge', 'print'],
  desc: 'A simple address book that stays on this device, with birthdays, favourites and vCard import and export',
  singleton: true,
  win: { w: 860, h: 600, minW: 440, minH: 420 },

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, store, confirm, menu, notify, fmt } = api;
    const say = (title, message, ic = 'user') => notify({ app: 'Static Contacts', icon: ic, title, message, timeout: 6000 });

    const S = {
      data: C.read(),
      sel: null,            /* the contact shown */
      mode: 'view',         /* 'view' | 'edit' | 'new' | 'dupes' | 'merge' */
      pair: null,           /* the two being reviewed: { a, b, why } */
      query: '',
      group: '',            /* a group's name, FAV or RECENT */
      narrow: false,
      pane: 'list',         /* a phone shows one pane: 'list' | 'card' */
      dead: false,
      picker: false,
      problems: [],
    };
    let writing = false;     /* our own writes repaint once, not twice */
    const save = () => { writing = true; try { S.data = C.write(S.data); } finally { writing = false; } };
    const byId = id => S.data.contacts.find(c => c.id === id) || null;
    const inView = c => (S.group === FAV ? c.favourite : S.group === RECENT ? true : !S.group || c.groups.includes(S.group));
    function sorted() {
      const pool = S.group === RECENT ? C.recentlyAdded(S.data.contacts) : S.data.contacts;
      const rows = pool.filter(c => inView(c) && C.matches(c, S.query));
      return S.group === RECENT ? rows : rows.sort(C.byName);
    }
    const viewName = () => (S.group === FAV ? 'Favourites' : S.group === RECENT ? 'Recently added' : S.group || 'Contacts');
    const dayText = ms => { const d = new Date(ms); return `${fmt.monthName(d, true)} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : ''}`; };

    /* ---------------- pictures ---------------- */
    function avatar(c, size = 40) {
      const el = h('span.contacts-av', { style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` }, 'aria-hidden': 'true' },
        h('span', { text: c ? C.initials(c) : '?' }));
      if (c && c.photo) {
        photoUrl(c.photo).then(u => {
          if (!u || S.dead || !el.isConnected) return;
          const img = h('img', { alt: '', draggable: 'false' });
          img.onerror = () => img.remove();
          img.src = u;
          el.append(img);
        });
      }
      return el;
    }

    /* ---------------- shell ---------------- */
    const sideEl = h('aside.app__side.contacts__side', { 'aria-label': 'Contacts' });
    const mainEl = h('div.app__main.contacts__main');
    const appEl = h('div.app.contacts', sideEl, mainEl);
    root.appendChild(appEl);

    const fileIn = h('input', { type: 'file', accept: '.vcf,text/vcard,text/x-vcard,text/directory', hidden: true, 'aria-hidden': 'true', tabindex: '-1',
      onchange: async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) await importFile(f); } });
    appEl.append(fileIn);

    /* ---------------- list pane ---------------- */
    const searchIn = h('input.contacts-search__in', { type: 'search', placeholder: 'Search contacts', 'aria-label': 'Search contacts', maxlength: '80',
      oninput: e => { S.query = e.target.value; paintList(); },
      onkeydown: e => { if (e.key === 'ArrowDown') { e.preventDefault(); listEl.querySelector('.contacts-row')?.focus(); } } });
    const groupSel = h('select.select.contacts-group', { 'aria-label': 'Show a group', onchange: e => { S.group = e.target.value; paintList(); } });
    const listEl = h('div.contacts-list', { role: 'list', 'aria-label': 'People' });
    const footEl = h('div.contacts-foot');
    function toolsMenu(e) {
      const all = S.data.contacts;
      const shown = sorted();
      const grp = S.group ? shown : null;
      const nm = viewName();
      const file = `${nm.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 60) || 'Contacts'}.vcf`;
      menu([
        { label: 'Import a .vcf file…', icon: 'upload', onClick: () => fileIn.click() },
        { label: 'Find duplicates…', icon: 'users', disabled: all.length < 2, onClick: () => showDupes() },
        '-',
        grp ? { label: `Save “${nm}” (${grp.length}) to Documents (.vcf)`, icon: 'download', disabled: !grp.length, onClick: () => exportToFiles(grp, file) } : null,
        grp ? { label: `Download “${nm}” as .vcf`, icon: 'download', disabled: !grp.length, onClick: () => download(grp, file) } : null,
        { label: 'Save everyone to Documents (.vcf)', icon: 'download', disabled: !all.length, onClick: () => exportToFiles(all, 'Contacts.vcf') },
        { label: 'Download everyone as .vcf', icon: 'download', disabled: !all.length, onClick: () => download(all, 'Contacts.vcf') },
        '-',
        { label: shown.length === all.length ? 'Print everyone…' : `Print this list (${shown.length})…`, icon: 'printer', disabled: !shown.length, onClick: () => printPeople(shown, shown.length === all.length ? 'Contacts' : nm) },
      ].filter(Boolean), e.clientX, e.clientY, { label: 'Import, export and print' });
    }
    const toolbar = h('div.contacts-tools',
      h('div.field.contacts-search', icon('search'), searchIn),
      h('div.contacts-tools__row', groupSel,
        h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => startNew() }, icon('plus'), h('span', { text: 'New' })),
        h('button.ibtn', { type: 'button', 'aria-label': 'Import and export', dataset: { fk: 'contacts-tools' }, onclick: toolsMenu }, icon('more-horizontal'))));
    sideEl.append(toolbar, listEl, footEl);

    function paintList() {
      const groups = C.groupNames(S.data.contacts);
      const favs = C.favourites(S.data.contacts).length;
      const recent = C.recentlyAdded(S.data.contacts).length;
      if (S.group && S.group !== FAV && S.group !== RECENT && !groups.includes(S.group)) S.group = '';
      groupSel.replaceChildren(h('option', { value: '', text: `All contacts (${S.data.contacts.length})` }),
        h('option', { value: FAV, text: `★ Favourites (${favs})` }),
        h('option', { value: RECENT, text: `Recently added (${recent})` }),
        ...(groups.length ? [h('option', { disabled: true, text: '──────────' })] : []),
        ...groups.map(g => h('option', { value: g, text: `${g} (${S.data.contacts.filter(c => c.groups.includes(g)).length})`, selected: g === S.group ? '' : null })));
      groupSel.value = S.group;
      const rows = sorted();
      const kids = [];
      let last = '';
      for (const c of rows) {
        if (S.group !== RECENT) {
          const letter = (C.display(c).normalize('NFD')[0] || '#').toUpperCase();
          const key = /\p{L}/u.test(letter) ? letter : '#';
          if (key !== last) { last = key; kids.push(h('div.contacts-letter', { role: 'presentation', text: key })); }
        }
        const on = c.id === S.sel;
        const sub = S.group === RECENT ? `Added ${fmt.fmtAgo(c.created).replace('Yesterday', 'yesterday')}`
          : (c.name && (c.phones[0] ? c.phones[0].value : c.emails[0] ? c.emails[0].value : C.workLine(c))) || c.groups.join(', ');
        kids.push(h('button.contacts-row', { type: 'button', role: 'listitem', class: on ? 'is-on' : '', dataset: { id: c.id }, 'aria-current': on ? 'true' : null,
          'aria-label': `${C.display(c)}${c.favourite ? ', favourite' : ''}`,
          onclick: () => open(c.id),
          onkeydown: e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const all = [...listEl.querySelectorAll('.contacts-row')];
            const n = all[all.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)];
            if (n) n.focus(); else if (e.key === 'ArrowUp') searchIn.focus();
          } },
          avatar(c, 34),
          h('span.contacts-row__t', h('b', { text: C.display(c) }), h('small', { text: sub })),
          c.favourite ? h('span.contacts-row__star', { 'aria-hidden': 'true' }, icon('star')) : null));
      }
      if (!rows.length) {
        const why = S.group === FAV ? ['No favourites yet', 'Open someone and press the star to keep them here.']
          : S.group === RECENT ? ['No one added lately', `People you add show here for ${C.RECENT_DAYS} days.`]
            : S.data.contacts.length ? ['No one matches', 'Try fewer words, or a different group.'] : ['No contacts yet', 'Add a person, or import a .vcf file. It all stays on this device.'];
        kids.push(h('div.empty', icon(S.group === FAV ? 'star' : 'user'), h('b', { text: why[0] }), h('small', { text: why[1] })));
      }
      listEl.replaceChildren(...kids);
      footEl.replaceChildren(h('small', { text: S.data.contacts.length ? `${rows.length === S.data.contacts.length ? '' : rows.length + ' of '}${S.data.contacts.length} contact${S.data.contacts.length === 1 ? '' : 's'}` : 'Saved on this device only.' }),
        ...(S.data.contacts.length ? [h('small', { text: 'Saved on this device only.' })] : []));
    }

    /* ---------------- actions ---------------- */
    function open(id) { S.sel = id; S.mode = 'view'; S.problems = []; S.picker = false; S.pair = null; if (S.narrow) S.pane = 'card'; render(); }
    function startNew() { S.sel = null; S.mode = 'new'; S.problems = []; S.picker = false; S.pair = null; if (S.narrow) S.pane = 'card'; render(); }
    async function removeContact(c) {
      const ok = await confirm({ title: 'Delete this contact?', message: `“${C.display(c)}” will be removed from this device. This can’t be undone.`, ok: 'Delete', danger: true });
      if (!ok || S.dead) return;
      S.data.contacts = S.data.contacts.filter(x => x.id !== c.id);
      save();
      S.sel = null; S.mode = 'view'; if (S.narrow) S.pane = 'list';
      render();
    }
    function toggleFavourite(c) {
      S.data.contacts = S.data.contacts.map(x => (x.id === c.id ? { ...x, favourite: !x.favourite } : x));
      save();
      render();
      mainEl.querySelector('[data-fk="contacts-star"]')?.focus({ preventScroll: true });
    }
    const fileName = c => `${C.display(c).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 60) || 'Contact'}.vcf`;
    function exportToFiles(list, name) {
      const text = C.toVCards(list);
      const dir = `${vfs.HOME}/Documents`;
      if (!vfs.node(dir)) vfs.mkdir(dir);
      let path = `${dir}/${name}`, i = 2;
      while (vfs.node(path)) path = `${dir}/${name.replace(/\.vcf$/, '')} ${i++}.vcf`;
      if (!vfs.touch(path, text)) { say('Could not save', 'Documents can’t be written to.', 'alert'); return; }
      notify({ app: 'Static Contacts', icon: 'check', title: 'Saved', message: `${list.length} contact${list.length === 1 ? '' : 's'} in ${path}`, timeout: 7000,
        actions: [{ label: 'Open Files', onClick: () => api.openApp('files', { path: dir }) }] });
    }
    function download(list, name) {
      const url = URL.createObjectURL(new Blob([C.toVCards(list)], { type: 'text/vcard' }));
      const a = h('a', { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    async function importFile(f) {
      if (f.size > C.MAX_IMPORT_BYTES) { say('That file is too big', `A contacts file over ${Math.round(C.MAX_IMPORT_BYTES / 1024 / 1024)} MB isn’t read.`, 'alert'); return; }
      let text = '';
      try { text = await f.text(); } catch (e) { say('Could not read that file', 'It was not opened.', 'alert'); return; }
      if (S.dead) return;
      const res = C.parseVCards(text);
      const known = new Set(S.data.contacts.map(c => `${c.name}|${c.phones[0] ? c.phones[0].value : ''}|${c.emails[0] ? c.emails[0].value : ''}`));
      let added = 0, dupes = 0, full = 0;
      for (const c of res.contacts) {
        const key = `${c.name}|${c.phones[0] ? c.phones[0].value : ''}|${c.emails[0] ? c.emails[0].value : ''}`;
        if (known.has(key)) { dupes++; continue; }
        if (S.data.contacts.length >= C.MAX_CONTACTS) { full++; continue; }
        known.add(key); S.data.contacts.push(c); added++;
      }
      if (added) save();
      const bits = [`${added} added`];
      if (dupes) bits.push(`${dupes} already here`);
      if (full) bits.push(`${full} left out (the limit is ${C.MAX_CONTACTS})`);
      if (res.skipped.length) bits.push(res.skipped.slice(0, 2).join(' '));
      notify({ app: 'Static Contacts', icon: added ? 'check' : 'alert', title: added ? 'Imported' : 'Nothing imported', message: bits.join(' · '), timeout: 9000 });
      render();
    }

    /* ---------------- print ----------------
       A sheet of plain text, built here and shown only to the printer
       (css/feat-contacts.css hides everything else while it prints). */
    let printEl = null;
    const endPrint = () => { document.documentElement.classList.remove('contacts-printing'); printEl?.remove(); printEl = null; window.removeEventListener('afterprint', endPrint); };
    function printPeople(list, title) {
      if (!list.length) return;
      endPrint();
      const person = c => h('li.contacts-print__p',
        h('b', { text: C.display(c) }),
        C.workLine(c) ? h('div', { text: C.workLine(c) }) : null,
        ...c.phones.map(p => h('div', { text: `${p.label}: ${p.value}` })),
        ...c.emails.map(e => h('div', { text: `${e.label}: ${e.value}` })),
        c.address ? h('div.contacts-print__pre', { text: c.address }) : null,
        c.birthday ? h('div', { text: `Birthday: ${C.birthdayText(c.birthday)}` }) : null,
        c.groups.length ? h('div.contacts-print__dim', { text: c.groups.join(', ') }) : null,
        list.length === 1 && c.notes ? h('div.contacts-print__pre', { text: c.notes }) : null);
      printEl = h('div.contacts-print', { 'aria-hidden': 'true' },
        h('h1', { text: title }),
        h('p', { text: `${list.length} contact${list.length === 1 ? '' : 's'} · printed ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}` }),
        h('ul', list.map(person)));
      document.body.appendChild(printEl);
      document.documentElement.classList.add('contacts-printing');
      window.addEventListener('afterprint', endPrint);
      try { window.print(); } catch (e) { endPrint(); }
    }

    /* ---------------- show as a QR code ----------------
       The card as a vCard, drawn with Static QR's own encoder. The notes
       and groups stay out of it: they are for you, not for whoever scans. */
    let qrEl = null;
    function closeQr() { if (!qrEl) return; const back = qrEl._back; qrEl.remove(); qrEl = null; back?.focus?.({ preventScroll: true }); }
    async function showQr(c) {
      closeQr();
      let Q;
      try { Q = await import('./qr.js'); } catch (e) { say('The QR code couldn’t be made', 'Static QR didn’t load.', 'alert'); return; }
      if (S.dead) return;
      const text = C.toVCard(c, { leave: ['notes', 'groups'] });
      const q = Q.encodeQR(text, { level: 'M' });
      const held = [c.name ? 'name' : '', C.workLine(c) ? 'work' : '', c.phones.length ? `${c.phones.length} phone number${c.phones.length === 1 ? '' : 's'}` : '',
        c.emails.length ? `${c.emails.length} email${c.emails.length === 1 ? '' : 's'}` : '', c.address ? 'address' : '', c.birthday ? 'birthday' : ''].filter(Boolean);
      const canvas = h('canvas.contacts-qr__code', { role: 'img', 'aria-label': `QR code holding ${C.display(c)}’s contact card` });
      const closeBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'contacts-qr-close' }, onclick: closeQr }, h('span', { text: 'Close' }));
      const dl = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'contacts-qr-png' }, disabled: !q.ok,
        onclick: () => canvas.toBlob(b => { if (!b) return; const url = URL.createObjectURL(b); const a = h('a', { href: url, download: `${fileName(c).replace(/\.vcf$/, '')} QR.png` }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }, 'image/png') },
      icon('download'), h('span', { text: 'Download PNG' }));
      qrEl = h('div.contacts-picker.contacts-qr', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${C.display(c)} as a QR code`,
        onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQr(); } } },
      h('div.contacts-picker__card',
        h('div.contacts-picker__h', h('b', { text: `${C.display(c)} as a QR code` }), h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: closeQr }, icon('x'))),
        q.ok ? canvas : h('div.contacts-errs', { text: 'This card holds more than one QR code can carry. Remove an address or a few numbers and try again.' }),
        h('small.contacts-qr__what', { dataset: { fk: 'contacts-qr-what' }, text: `Holds ${held.join(', ') || 'the name'}. The notes, groups and picture are left out. A phone camera adds it as a contact.` }),
        h('div.contacts-form__act', dl, closeBtn)));
      qrEl._back = document.activeElement;
      mainEl.append(qrEl);
      if (q.ok) {
        const per = Math.max(3, Math.floor(280 / (q.size + 8)));
        const px = per * (q.size + 8);
        canvas.width = canvas.height = px;
        canvas.style.width = canvas.style.height = `${px}px`;
        Q.drawCode(canvas.getContext('2d'), q, px, 4, '#000000', '#FFFFFF');
        canvas.dataset.text = text;
      }
      requestAnimationFrame(() => { try { closeBtn.focus(); } catch (e) {} });
    }

    /* ---------------- the card (view) ---------------- */
    function backBtn() { return S.narrow ? h('button.ibtn', { type: 'button', 'aria-label': 'Back to the list', onclick: () => { S.pane = 'list'; if (S.mode === 'dupes' || S.mode === 'merge') S.mode = 'view'; render(); } }, icon('chevron-left')) : null; }
    function field(label, ...kids) { return h('div.contacts-f', h('div.contacts-f__l', { text: label }), h('div.contacts-f__v', ...kids)); }

    function birthdayLine(c) {
      const next = C.nextBirthday(c.birthday);
      const age = C.turns(c.birthday, next);
      const days = Math.round((new Date(`${next}T12:00:00`) - new Date(new Date().toDateString())) / 86400000 - 0.5);
      const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      const res = C.lastReminders()[c.id];
      const rem = c.remind === null ? 'No reminder' : res === 'full' ? 'No reminder: there are too many reminders already' : `Reminder ${REMIND_TEXT[c.remind]}, every year`;
      return [h('div.contacts-text', { text: C.birthdayText(c.birthday) }),
        h('small.contacts-sub', { dataset: { fk: 'contacts-bday-next' }, text: `${age ? `Turns ${age}` : 'Next birthday'} ${when}${days > 1 ? ` (${dayText(new Date(`${next}T12:00:00`).getTime())})` : ''}` }),
        h('small.contacts-sub', { dataset: { fk: 'contacts-bday-remind' }, text: rem })];
    }

    function renderCard(c) {
      const phones = c.phones.map(p => {
        const href = C.telHref(p.value);
        return h('div.contacts-line', h('small', { text: p.label }), href ? h('a', { href, rel: 'noopener', text: p.value }) : h('span', { text: p.value }));
      });
      const emails = c.emails.map(e => {
        const href = C.mailHref(e.value);
        return h('div.contacts-line', h('small', { text: e.label }), href ? h('a', { href, rel: 'noopener', text: e.value }) : h('span', { text: e.value }));
      });
      const work = C.workLine(c);
      mainEl.replaceChildren(
        h('div.app__bar', backBtn(), h('div.app__title', { text: C.display(c) }), h('span.contacts-spacer'),
          h('button.ibtn.contacts-star', { type: 'button', dataset: { fk: 'contacts-star' }, class: c.favourite ? 'is-on' : '', 'aria-pressed': c.favourite ? 'true' : 'false',
            'aria-label': c.favourite ? 'Remove from favourites' : 'Add to favourites', title: c.favourite ? 'Remove from favourites' : 'Add to favourites', onclick: () => toggleFavourite(c) }, icon('star')),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.mode = 'edit'; S.problems = []; render(); } }, icon('edit-3'), h('span', { text: 'Edit' })),
          h('button.ibtn', { type: 'button', 'aria-label': 'More', dataset: { fk: 'contacts-more' }, onclick: e => menu([
            { label: 'Show as QR code', icon: 'grid', onClick: () => showQr(c) },
            { label: 'Save as .vcf in Documents', icon: 'download', onClick: () => exportToFiles([c], fileName(c)) },
            { label: 'Download as .vcf', icon: 'download', onClick: () => download([c], fileName(c)) },
            { label: 'Print this card…', icon: 'printer', onClick: () => printPeople([c], C.display(c)) },
            '-',
            { label: 'Delete contact', icon: 'trash', danger: true, onClick: () => removeContact(c) },
          ], e.clientX, e.clientY) }, icon('more-horizontal'))),
        h('div.app__content.contacts-card',
          h('div.contacts-hero', avatar(c, 84), h('div.contacts-hero__t', h('h2', { text: C.display(c) }),
            work ? h('div.contacts-work', { text: work }) : null,
            c.groups.length ? h('div.contacts-chips', c.groups.map(g => h('span.contacts-chip', { text: g }))) : null)),
          phones.length ? field('Phone', ...phones) : null,
          emails.length ? field('Email', ...emails) : null,
          c.birthday ? field('Birthday', ...birthdayLine(c)) : null,
          c.address ? field('Address', h('div.contacts-text', { text: c.address })) : null,
          c.friend ? field('Friend', h('div.contacts-line', h('span', { text: c.friend.name }),
            h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'contacts-open-social' }, onclick: () => api.openApp('social', { friends: true }) }, icon('users'), h('span', { text: 'Open in Social' })))) : null,
          c.notes ? field('Notes', h('div.contacts-text', { text: c.notes })) : null,
          !phones.length && !emails.length && !c.address && !c.notes && !c.birthday && !work ? h('div.contacts-nothing', { text: 'Nothing else on this card yet. Choose Edit to add more.' }) : null,
          h('small.contacts-added', { text: `Added ${dayText(c.created)}` })));
    }

    /* ---------------- the editor ---------------- */
    function renderEditor(c0) {
      const isNew = S.mode === 'new';
      const c = c0 || C.normContact({});
      const draft = { photo: c.photo, friend: c.friend };
      const nameIn = h('input.contacts-in', { type: 'text', value: c.name, maxlength: String(C.LIMITS.name), 'aria-label': 'Name', placeholder: 'Name' });
      const companyIn = h('input.contacts-in', { type: 'text', value: c.company, maxlength: String(C.LIMITS.company), 'aria-label': 'Company', placeholder: 'Company', dataset: { fk: 'contacts-company' } });
      const titleIn = h('input.contacts-in', { type: 'text', value: c.title, maxlength: String(C.LIMITS.title), 'aria-label': 'Job title', placeholder: 'Job title', dataset: { fk: 'contacts-title' } });
      const addrIn = h('textarea.contacts-in.contacts-ta', { rows: '2', maxlength: String(C.LIMITS.address), 'aria-label': 'Address', placeholder: 'Address' });
      addrIn.value = c.address;
      const notesIn = h('textarea.contacts-in.contacts-ta', { rows: '3', maxlength: String(C.LIMITS.notes), 'aria-label': 'Notes', placeholder: 'Notes' });
      notesIn.value = c.notes;
      const groupsIn = h('input.contacts-in', { type: 'text', value: c.groups.join(', '), maxlength: '200', 'aria-label': 'Groups, separated by commas', placeholder: 'Family, School, …', list: 'contacts-groups' });
      const dl = h('datalist', { id: 'contacts-groups' }, C.groupNames(S.data.contacts).map(g => h('option', { value: g })));

      /* birthday: month and day, the year if you know it */
      const bp = C.birthdayParts(c.birthday);
      const monthSel = h('select.select.contacts-bm', { 'aria-label': 'Birthday month', dataset: { fk: 'contacts-bday-month' } },
        h('option', { value: '', text: 'Month' }), ...C.MONTH_NAMES.map((m, i) => h('option', { value: String(i + 1), text: m, selected: bp && bp.m === i + 1 ? '' : null })));
      const daySel = h('select.select.contacts-bd', { 'aria-label': 'Birthday day', dataset: { fk: 'contacts-bday-day' } },
        h('option', { value: '', text: 'Day' }), ...Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1), selected: bp && bp.d === i + 1 ? '' : null })));
      const yearIn = h('input.contacts-in.contacts-by', { type: 'number', min: '1900', max: String(new Date().getFullYear()), step: '1', placeholder: 'Year (optional)', value: bp && bp.y ? String(bp.y) : '',
        'aria-label': 'Birthday year (optional)', dataset: { fk: 'contacts-bday-year' } });
      const remindSel = h('select.select.contacts-in', { 'aria-label': 'Birthday reminder', dataset: { fk: 'contacts-bday-remind' } },
        h('option', { value: '', text: 'No reminder' }), ...C.REMIND_DAYS.map(d => h('option', { value: String(d), text: `Remind me ${REMIND_TEXT[d]}`, selected: c.remind === d ? '' : null })));
      let remindTouched = false;
      remindSel.addEventListener('change', () => { remindTouched = true; });
      const remindHint = h('small.contacts-hint', { text: 'Every year, as a notification while StaticOS is open in this browser.' });
      const paintRemind = () => {
        const has = !!(monthSel.value && daySel.value);
        remindSel.disabled = !has;
        /* a birthday that is new on this card gets a reminder on the day, which can be changed right here */
        if (has && !c.birthday && !remindTouched && remindSel.value === '') remindSel.value = '0';
        remindHint.hidden = !has || remindSel.value === '';
      };
      for (const el of [monthSel, daySel]) el.addEventListener('change', paintRemind);
      remindSel.addEventListener('change', paintRemind);
      paintRemind();
      const readBirthday = () => {
        if (!monthSel.value && !daySel.value && !yearIn.value.trim()) return { value: '' };
        if (!monthSel.value || !daySel.value) return { error: 'A birthday needs a month and a day.' };
        const y = yearIn.value.trim();
        if (y && !/^\d{4}$/.test(y)) return { error: 'The birthday year should be four digits, like 2009.' };
        const raw = y ? `${y}-${String(monthSel.value).padStart(2, '0')}-${String(daySel.value).padStart(2, '0')}` : `--${String(monthSel.value).padStart(2, '0')}-${String(daySel.value).padStart(2, '0')}`;
        const v = C.normBirthday(raw);
        if (!v) return { error: `${C.MONTH_NAMES[+monthSel.value - 1]} ${daySel.value}${y ? `, ${y}` : ''} isn’t a date that exists${y && +y > new Date().getFullYear() ? ' yet' : ''}.` };
        if (y && v.startsWith('--')) return { error: `The year ${y} can’t be a birth year here. Leave it empty if you don’t know it.` };
        return { value: v };
      };

      /* a friend from Static Social, only if you pick one */
      const friendSel = h('select.select.contacts-in', { 'aria-label': 'Static Social friend', dataset: { fk: 'contacts-friend' } },
        h('option', { value: '', text: 'Not linked' }),
        c.friend ? h('option', { value: c.friend.fp, text: c.friend.name, selected: '' }) : null);
      const friendRow = h('label.contacts-fl', { hidden: !c.friend }, h('span', { text: 'Friend in Static Social' }), friendSel,
        h('small.contacts-hint', { text: 'Only you see this link. It doesn’t tell your friend anything.' }));
      if (store.get('portal.friends')) {
        import('../core/friends.js').then(F => {
          if (S.dead || !friendSel.isConnected || !F.available()) return;
          const list = F.friends();
          if (!list.length && !c.friend) return;
          const opts = list.map(f => h('option', { value: f.fp, text: f.display, selected: c.friend && c.friend.fp === f.fp ? '' : null }));
          const gone = c.friend && !list.some(f => f.fp === c.friend.fp) ? h('option', { value: c.friend.fp, text: `${c.friend.name} (no longer a friend)`, selected: '' }) : null;
          friendSel.replaceChildren(h('option', { value: '', text: 'Not linked' }), ...opts, ...(gone ? [gone] : []));
          friendSel.value = c.friend ? c.friend.fp : '';
          friendSel._names = new Map(list.map(f => [f.fp, f.display]));
          friendRow.hidden = false;
        }).catch(() => {});
      }

      const multi = (kind, labels, items, ph, type) => {
        const box = h('div.contacts-multi');
        const add = (it = { label: labels[0], value: '' }) => {
          const sel = h('select.select.contacts-lab', { 'aria-label': `${kind} type` }, labels.map(l => h('option', { value: l, text: l, selected: l === it.label ? '' : null })));
          const inp = h('input.contacts-in', { type, value: it.value, maxlength: '254', 'aria-label': kind, placeholder: ph, inputmode: kind === 'Phone' ? 'tel' : 'email', autocomplete: 'off' });
          const row = h('div.contacts-mrow', { dataset: { kind } }, sel, inp,
            h('button.ibtn', { type: 'button', 'aria-label': `Remove this ${kind.toLowerCase()}`, onclick: () => row.remove() }, icon('x')));
          box.append(row);
          return inp;
        };
        (items.length ? items : [{ label: labels[0], value: '' }]).forEach(add);
        return { box, add, read: () => [...box.querySelectorAll('.contacts-mrow')].map(r => ({ label: r.querySelector('select').value, value: r.querySelector('input').value })).filter(x => x.value.trim()) };
      };
      const ph = multi('Phone', C.PHONE_LABELS, c.phones, 'Phone number', 'tel');
      const em = multi('Email', C.EMAIL_LABELS, c.emails, 'Email address', 'email');

      const photoBox = h('div.contacts-photo');
      const paintPhoto = () => {
        photoBox.replaceChildren(avatar({ ...c, name: nameIn.value || c.name, photo: draft.photo }, 64),
          h('div.contacts-photo__b',
            h('button.btn.btn--sm', { type: 'button', onclick: () => { S.picker = true; paintPicker(); } }, icon('image'), h('span', { text: draft.photo ? 'Change picture…' : 'Choose a picture…' })),
            draft.photo ? h('button.btn.btn--sm', { type: 'button', onclick: () => { draft.photo = ''; paintPhoto(); } }, h('span', { text: 'Remove picture' })) : null,
            h('small', { text: draft.photo ? draft.photo.split('/').pop() : 'From your files. The picture itself stays where it is.' })));
      };
      paintPhoto();

      /* picker over the form */
      const pickerEl = h('div.contacts-picker', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a picture', style: { display: 'none' } });
      function paintPicker() {
        if (!S.picker) { pickerEl.style.display = 'none'; return; }
        const pics = [];
        vfs.walk(vfs.HOME, (n, p) => { if (n.type === 'file' && C.photoOk(p) && !p.includes('/.Trash')) pics.push({ n, p }); }, 6);
        pics.sort((a, b) => new Date(b.n.mtime) - new Date(a.n.mtime));
        const find = h('input.contacts-in', { type: 'search', placeholder: 'Search your pictures', 'aria-label': 'Search your pictures', maxlength: '60' });
        const grid = h('div.contacts-pics');
        const close = () => { S.picker = false; paintPicker(); };
        const fill = () => {
          const q = find.value.trim().toLowerCase();
          const rows = pics.filter(x => !q || x.n.name.toLowerCase().includes(q)).slice(0, 80);
          grid.replaceChildren(...(rows.length ? rows.map(x => {
            const img = h('img', { alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
            photoUrl(x.p).then(u => { if (u) img.src = u; });
            return h('button.contacts-pic', { type: 'button', title: x.p, dataset: { path: x.p }, onclick: () => { draft.photo = x.p; S.picker = false; paintPicker(); paintPhoto(); } },
              img, h('small', { text: x.n.name }));
          }) : [h('div.dim', { text: pics.length ? 'No picture matches.' : 'No pictures in your files yet. Take one with Camera, or import one in Files.' })]));
        };
        find.addEventListener('input', fill);
        find.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
        pickerEl.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
        pickerEl.replaceChildren(h('div.contacts-picker__card',
          h('div.contacts-picker__h', h('b', { text: 'Choose a picture' }), h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
          find, grid));
        pickerEl.style.display = '';
        fill();
        requestAnimationFrame(() => { try { find.focus(); } catch (e) {} });
      }

      const errEl = h('div.contacts-errs', { role: 'alert' }, S.problems.map(p => h('div', { text: p })));
      const cancel = () => { S.mode = 'view'; S.problems = []; S.picker = false; if (isNew) { S.sel = null; if (S.narrow) S.pane = 'list'; } render(); };
      function submit(e) {
        e && e.preventDefault();
        const bd = readBirthday();
        const fp = friendSel.value;
        const friend = !fp ? null : fp === (c.friend && c.friend.fp) ? c.friend : { fp, name: (friendSel._names && friendSel._names.get(fp)) || 'Friend' };
        const draftC = { name: nameIn.value, company: companyIn.value, title: titleIn.value, phones: ph.read(), emails: em.read(), address: addrIn.value, notes: notesIn.value, photo: draft.photo,
          groups: groupsIn.value.split(','), birthday: bd.value || '', remind: bd.value && remindSel.value !== '' ? Number(remindSel.value) : null, friend,
          favourite: c.favourite };
        const probs = [...C.problems(draftC), ...(bd.error ? [bd.error] : [])];
        if (probs.length) { S.problems = probs; errEl.replaceChildren(...probs.map(p => h('div', { text: p }))); return; }
        if (isNew && S.data.contacts.length >= C.MAX_CONTACTS) { errEl.replaceChildren(h('div', { text: `You can keep up to ${C.MAX_CONTACTS} contacts.` })); return; }
        const next = C.normContact({ ...draftC, id: isNew ? undefined : c.id, created: isNew ? Date.now() : c.created, updated: Date.now() });
        if (isNew) S.data.contacts.push(next); else S.data.contacts = S.data.contacts.map(x => (x.id === c.id ? next : x));
        save();
        S.sel = next.id; S.mode = 'view'; S.problems = []; S.picker = false;
        render();
      }
      const form = h('form.contacts-form', { novalidate: true, onsubmit: submit,
        onkeydown: e => { if (e.key === 'Escape' && !S.picker) { e.preventDefault(); cancel(); } } },
        photoBox,
        h('label.contacts-fl', h('span', { text: 'Name' }), nameIn),
        h('div.contacts-pair',
          h('label.contacts-fl', h('span', { text: 'Company' }), companyIn),
          h('label.contacts-fl', h('span', { text: 'Job title' }), titleIn)),
        h('div.contacts-fl', h('span', { text: 'Phone numbers' }), ph.box,
          h('button.btn.btn--sm', { type: 'button', onclick: () => ph.add().focus() }, icon('plus'), h('span', { text: 'Add a number' }))),
        h('div.contacts-fl', h('span', { text: 'Email addresses' }), em.box,
          h('button.btn.btn--sm', { type: 'button', onclick: () => em.add().focus() }, icon('plus'), h('span', { text: 'Add an address' }))),
        h('div.contacts-fl', h('span', { text: 'Birthday' }), h('div.contacts-bday', monthSel, daySel, yearIn), remindSel, remindHint),
        h('label.contacts-fl', h('span', { text: 'Address' }), addrIn),
        h('label.contacts-fl', h('span', { text: 'Groups' }), groupsIn, dl),
        friendRow,
        h('label.contacts-fl', h('span', { text: 'Notes' }), notesIn),
        errEl,
        h('div.contacts-form__act',
          h('button.btn.btn--primary', { type: 'submit' }, icon('check'), h('span', { text: 'Save' })),
          h('button.btn', { type: 'button', onclick: cancel }, h('span', { text: 'Cancel' }))));
      mainEl.replaceChildren(
        h('div.app__bar', backBtn(), h('div.app__title', { text: isNew ? 'New contact' : `Edit ${C.display(c)}` })),
        h('div.app__content.contacts-editwrap', form, pickerEl));
      requestAnimationFrame(() => { try { nameIn.focus(); } catch (e) {} });
      if (S.picker) paintPicker();
    }

    /* ---------------- duplicates: suggested, then reviewed side by side ---------------- */
    function showDupes() { S.mode = 'dupes'; S.pair = null; S.picker = false; if (S.narrow) S.pane = 'card'; render(); }
    function renderDupes() {
      const pairs = C.duplicates(S.data);
      mainEl.replaceChildren(
        h('div.app__bar', backBtn(), h('div.app__title', { text: 'Possible duplicates' }), h('span.contacts-spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.mode = 'view'; render(); } }, h('span', { text: 'Done' }))),
        h('div.app__content.contacts-card',
          h('p.contacts-hint', { text: 'Cards that look like the same person. Nothing is merged unless you review a pair and choose what to keep.' }),
          pairs.length ? h('div.contacts-dupes', { role: 'list' }, pairs.map(p => h('div.contacts-dupe', { role: 'listitem' },
            avatar(p.a, 30), avatar(p.b, 30),
            h('span.contacts-row__t', h('b', { text: `${C.display(p.a)} and ${C.display(p.b)}` }), h('small', { text: `Both have ${p.why.join(' and ')}` })),
            h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'contacts-review' }, onclick: () => { S.pair = p; S.mode = 'merge'; render(); } }, h('span', { text: 'Review…' })))))
            : h('div.empty', icon('check-circle'), h('b', { text: 'No duplicates found' }), h('small', { text: 'No two cards share a name, a phone number or an email address.' }))));
    }
    function renderMerge() {
      const a = byId(S.pair.a.id), b = byId(S.pair.b.id);
      if (!a || !b) { S.mode = 'dupes'; S.pair = null; renderDupes(); return; }
      const pick = {};
      const shown = (k, c) => (k === 'birthday' ? C.birthdayText(c.birthday) : k === 'photo' ? (c.photo ? c.photo.split('/').pop() : '') : c[k]);
      const rows = [];
      for (const [k, label] of C.MERGE_FIELDS) {
        const va = shown(k, a), vb = shown(k, b);
        if (a[k] === b[k] || (!va && !vb)) continue;
        pick[k] = va ? 'a' : 'b';
        const name = `contacts-merge-${k}`;
        const opt = (side, text) => h('label.contacts-merge__opt', { class: !text ? 'is-empty' : null },
          h('input', { type: 'radio', name, value: side, checked: pick[k] === side, dataset: { fk: `merge-${k}-${side}` }, onchange: () => { pick[k] = side; } }),
          h('span', { text: text || '(empty)' }));
        rows.push(h('div.contacts-merge__row', { role: 'radiogroup', 'aria-label': label },
          h('div.contacts-f__l', { text: label }),
          opt('a', va), opt('b', vb),
          k === 'notes' && va && vb ? h('label.contacts-merge__opt.contacts-merge__both',
            h('input', { type: 'radio', name, value: 'both', dataset: { fk: 'merge-notes-both' }, onchange: () => { pick.notes = 'both'; } }), h('span', { text: 'Keep both' })) : null));
      }
      const preview = C.merge(a, b, {});
      const kept = [
        preview.phones.length ? `${preview.phones.length} phone number${preview.phones.length === 1 ? '' : 's'} (${preview.phones.map(p => p.value).join(', ')})` : '',
        preview.emails.length ? `${preview.emails.length} email${preview.emails.length === 1 ? '' : 's'} (${preview.emails.map(e => e.value).join(', ')})` : '',
        preview.groups.length ? `the groups ${preview.groups.join(', ')}` : '',
      ].filter(Boolean);
      const col = (c, which) => h('div.contacts-merge__col', avatar(c, 40), h('span.contacts-row__t', h('b', { text: C.display(c) }), h('small', { text: `Card ${which} · added ${dayText(c.created)}` })));
      mainEl.replaceChildren(
        h('div.app__bar', backBtn(), h('div.app__title', { text: 'Merge two cards' })),
        h('div.app__content.contacts-card.contacts-merge', { dataset: { fk: 'contacts-merge' } },
          h('p.contacts-hint', { text: `They look alike: both have ${S.pair.why.join(' and ')}. Choose what the one card keeps.` }),
          h('div.contacts-merge__heads', h('div.contacts-f__l'), col(a, 'A'), col(b, 'B')),
          rows.length ? rows : h('p.contacts-hint', { text: 'Everything else on the two cards is the same.' }),
          kept.length ? h('div.contacts-merge__kept', h('div.contacts-f__l', { text: 'From both' }), h('div.contacts-text', { dataset: { fk: 'merge-kept' }, text: `Kept: ${kept.join('; ')}.` })) : null,
          h('div.contacts-form__act',
            h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'merge-go' }, onclick: () => doMerge(a, b, pick) }, icon('check'), h('span', { text: 'Merge into one card' })),
            h('button.btn', { type: 'button', dataset: { fk: 'merge-apart' }, onclick: () => keepApart(a, b) }, h('span', { text: 'They’re different people' })),
            h('button.btn', { type: 'button', onclick: () => { S.mode = 'dupes'; S.pair = null; render(); } }, h('span', { text: 'Cancel' })))));
    }
    function doMerge(a, b, pick) {
      const before = { a: C.cloneContact(a), b: C.cloneContact(b) };
      const one = C.merge(a, b, pick);
      S.data.contacts = S.data.contacts.filter(x => x.id !== b.id).map(x => (x.id === a.id ? one : x));
      save();
      S.sel = one.id; S.mode = 'view'; S.pair = null;
      render();
      notify({ app: 'Static Contacts', icon: 'check', title: 'Merged', message: `${C.display(before.a)} and ${C.display(before.b)} are one card now.`, timeout: 9000,
        actions: [{ label: 'Undo', onClick: () => {
          const d = C.read();
          d.contacts = [...d.contacts.filter(x => x.id !== before.a.id && x.id !== before.b.id), before.a, before.b];
          writing = true;
          try { S.data = C.write(d); } finally { writing = false; }
          if (!S.dead) render();
        } }] });
    }
    function keepApart(a, b) {
      S.data.apart = [...(S.data.apart || []), [a.id, b.id]];
      save();
      S.mode = 'dupes'; S.pair = null;
      render();
    }

    function renderEmpty() {
      mainEl.replaceChildren(h('div.app__bar', backBtn(), h('div.app__title', { text: 'Static Contacts' })),
        h('div.app__content', h('div.empty', icon('user'),
          h('b', { text: S.data.contacts.length ? 'Choose someone' : 'Your address book is empty' }),
          h('small', { text: 'Names, numbers, emails and notes. Saved on this device only, never sent anywhere.' }),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => startNew() }, icon('plus'), h('span', { text: 'New contact' })))));
    }

    function render() {
      if (S.dead) return;
      closeQr();
      appEl.classList.toggle('is-narrow', S.narrow);
      appEl.classList.toggle('show-card', S.narrow && S.pane === 'card');
      paintList();
      const c = S.sel ? byId(S.sel) : null;
      if (S.sel && !c) S.sel = null;
      if (S.mode === 'dupes') renderDupes();
      else if (S.mode === 'merge' && S.pair) renderMerge();
      else if (S.mode === 'new') renderEditor(null);
      else if (c && S.mode === 'edit') renderEditor(c);
      else if (c) renderCard(c);
      else renderEmpty();
    }

    /* changes made somewhere else (Static QR adding a scanned card, an Undo in a notification) */
    let writingOff = store.sub(C.STORE_KEY, () => {
      if (S.dead || writing || S.mode === 'edit' || S.mode === 'new') return;
      const next = C.read();
      if (JSON.stringify(next) === JSON.stringify(S.data)) return;
      S.data = next;
      render();
    });

    function handle(o) {
      if (o && typeof o.contact === 'string' && byId(o.contact)) { open(o.contact); return true; }
      return false;
    }
    win.onReopen(o => { if (!S.dead) handle(o); });

    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect?.width || appEl.clientWidth;
        const n = w > 0 && w < NARROW;
        if (n !== S.narrow) { S.narrow = n; if (!S.dead) render(); }
      });
      ro.observe(appEl);
    }
    if (!handle(opts)) render();

    return () => {
      S.dead = true;
      writingOff?.(); writingOff = null;
      closeQr();
      endPrint();
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
    };
  },
});
