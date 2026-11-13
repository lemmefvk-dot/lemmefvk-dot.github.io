/* ============================================================
   contacts.js — Static Contacts: a simple address book on this device.

   A name, phone numbers, email addresses, an address, notes, groups and
   a picture chosen from your own files (Pictures and the rest of your
   home folder). Search finds people by anything on their card. You can
   import a .vcf file and save everyone (or one person) as .vcf.

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

defineApp({
  id: 'contacts',
  name: 'Static Contacts',
  icon: 'user',
  g1: '#ffb86b', g2: '#e0573b',
  category: 'Productivity',
  keywords: ['contacts', 'address book', 'people', 'phone', 'phone number', 'email', 'vcard', 'vcf', 'friends', 'family', 'names'],
  desc: 'A simple address book that stays on this device, with vCard import and export',
  singleton: true,
  win: { w: 860, h: 600, minW: 440, minH: 420 },

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, confirm, menu, notify } = api;
    const say = (title, message, ic = 'user') => notify({ app: 'Static Contacts', icon: ic, title, message, timeout: 6000 });

    const S = {
      data: C.read(),
      sel: null,            /* the contact shown */
      mode: 'view',         /* 'view' | 'edit' | 'new' */
      query: '',
      group: '',
      narrow: false,
      pane: 'list',         /* a phone shows one pane: 'list' | 'card' */
      dead: false,
      picker: false,
      problems: [],
    };
    const save = () => { S.data = C.write(S.data); };
    const byId = id => S.data.contacts.find(c => c.id === id) || null;
    const sorted = () => S.data.contacts.filter(c => (!S.group || c.groups.includes(S.group)) && C.matches(c, S.query)).sort(C.byName);

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
    const toolbar = h('div.contacts-tools',
      h('div.field.contacts-search', icon('search'), searchIn),
      h('div.contacts-tools__row', groupSel,
        h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => startNew() }, icon('plus'), h('span', { text: 'New' })),
        h('button.ibtn', { type: 'button', 'aria-label': 'Import and export', onclick: e => menu([
          { label: 'Import a .vcf file…', icon: 'upload', onClick: () => fileIn.click() },
          '-',
          { label: 'Save everyone to Documents (.vcf)', icon: 'download', disabled: !S.data.contacts.length, onClick: () => exportToFiles(S.data.contacts, 'Contacts.vcf') },
          { label: 'Download everyone as .vcf', icon: 'download', disabled: !S.data.contacts.length, onClick: () => download(S.data.contacts, 'Contacts.vcf') },
        ], e.clientX, e.clientY, { label: 'Import and export' }) }, icon('more-horizontal'))));
    sideEl.append(toolbar, listEl, footEl);

    function paintList() {
      const groups = C.groupNames(S.data.contacts);
      if (S.group && !groups.includes(S.group)) S.group = '';
      groupSel.replaceChildren(h('option', { value: '', text: `All contacts (${S.data.contacts.length})` }),
        ...groups.map(g => h('option', { value: g, text: `${g} (${S.data.contacts.filter(c => c.groups.includes(g)).length})`, selected: g === S.group ? '' : null })));
      groupSel.value = S.group;
      const rows = sorted();
      const kids = [];
      let last = '';
      for (const c of rows) {
        const letter = (C.display(c).normalize('NFD')[0] || '#').toUpperCase();
        const key = /\p{L}/u.test(letter) ? letter : '#';
        if (key !== last) { last = key; kids.push(h('div.contacts-letter', { role: 'presentation', text: key })); }
        const on = c.id === S.sel;
        kids.push(h('button.contacts-row', { type: 'button', role: 'listitem', class: on ? 'is-on' : '', dataset: { id: c.id }, 'aria-current': on ? 'true' : null,
          onclick: () => open(c.id),
          onkeydown: e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const all = [...listEl.querySelectorAll('.contacts-row')];
            const n = all[all.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)];
            if (n) n.focus(); else if (e.key === 'ArrowUp') searchIn.focus();
          } },
          avatar(c, 34),
          h('span.contacts-row__t', h('b', { text: C.display(c) }),
            h('small', { text: (c.name && (c.phones[0] ? c.phones[0].value : c.emails[0] ? c.emails[0].value : '')) || c.groups.join(', ') }))));
      }
      if (!rows.length) {
        kids.push(h('div.empty', icon('user'),
          h('b', { text: S.data.contacts.length ? 'No one matches' : 'No contacts yet' }),
          h('small', { text: S.data.contacts.length ? 'Try fewer words, or a different group.' : 'Add a person, or import a .vcf file. It all stays on this device.' })));
      }
      listEl.replaceChildren(...kids);
      footEl.replaceChildren(h('small', { text: S.data.contacts.length ? `${rows.length === S.data.contacts.length ? '' : rows.length + ' of '}${S.data.contacts.length} contact${S.data.contacts.length === 1 ? '' : 's'}` : 'Saved on this device only.' }),
        S.data.contacts.length ? h('small', { text: 'Saved on this device only.' }) : null);
    }

    /* ---------------- actions ---------------- */
    function open(id) { S.sel = id; S.mode = 'view'; S.problems = []; S.picker = false; if (S.narrow) S.pane = 'card'; render(); }
    function startNew() { S.sel = null; S.mode = 'new'; S.problems = []; S.picker = false; if (S.narrow) S.pane = 'card'; render(); }
    async function removeContact(c) {
      const ok = await confirm({ title: 'Delete this contact?', message: `“${C.display(c)}” will be removed from this device. This can’t be undone.`, ok: 'Delete', danger: true });
      if (!ok || S.dead) return;
      S.data.contacts = S.data.contacts.filter(x => x.id !== c.id);
      save();
      S.sel = null; S.mode = 'view'; if (S.narrow) S.pane = 'list';
      render();
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

    /* ---------------- the card (view) ---------------- */
    function backBtn() { return S.narrow ? h('button.ibtn', { type: 'button', 'aria-label': 'Back to the list', onclick: () => { S.pane = 'list'; render(); } }, icon('chevron-left')) : null; }
    function field(label, ...kids) { return h('div.contacts-f', h('div.contacts-f__l', { text: label }), h('div.contacts-f__v', ...kids)); }

    function renderCard(c) {
      const phones = c.phones.map(p => {
        const href = C.telHref(p.value);
        return h('div.contacts-line', h('small', { text: p.label }), href ? h('a', { href, rel: 'noopener', text: p.value }) : h('span', { text: p.value }));
      });
      const emails = c.emails.map(e => {
        const href = C.mailHref(e.value);
        return h('div.contacts-line', h('small', { text: e.label }), href ? h('a', { href, rel: 'noopener', text: e.value }) : h('span', { text: e.value }));
      });
      mainEl.replaceChildren(
        h('div.app__bar', backBtn(), h('div.app__title', { text: C.display(c) }), h('span.contacts-spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.mode = 'edit'; S.problems = []; render(); } }, icon('edit-3'), h('span', { text: 'Edit' })),
          h('button.ibtn', { type: 'button', 'aria-label': 'More', onclick: e => menu([
            { label: 'Save as .vcf in Documents', icon: 'download', onClick: () => exportToFiles([c], fileName(c)) },
            { label: 'Download as .vcf', icon: 'download', onClick: () => download([c], fileName(c)) },
            '-',
            { label: 'Delete contact', icon: 'trash', danger: true, onClick: () => removeContact(c) },
          ], e.clientX, e.clientY) }, icon('more-horizontal'))),
        h('div.app__content.contacts-card',
          h('div.contacts-hero', avatar(c, 84), h('div.contacts-hero__t', h('h2', { text: C.display(c) }),
            c.groups.length ? h('div.contacts-chips', c.groups.map(g => h('span.contacts-chip', { text: g }))) : null)),
          phones.length ? field('Phone', ...phones) : null,
          emails.length ? field('Email', ...emails) : null,
          c.address ? field('Address', h('div.contacts-text', { text: c.address })) : null,
          c.notes ? field('Notes', h('div.contacts-text', { text: c.notes })) : null,
          !phones.length && !emails.length && !c.address && !c.notes ? h('div.contacts-nothing', { text: 'Nothing else on this card yet. Choose Edit to add more.' }) : null));
    }

    /* ---------------- the editor ---------------- */
    function renderEditor(c0) {
      const isNew = S.mode === 'new';
      const c = c0 || C.normContact({});
      const draft = { photo: c.photo };
      const nameIn = h('input.contacts-in', { type: 'text', value: c.name, maxlength: String(C.LIMITS.name), 'aria-label': 'Name', placeholder: 'Name' });
      const addrIn = h('textarea.contacts-in.contacts-ta', { rows: '2', maxlength: String(C.LIMITS.address), 'aria-label': 'Address', placeholder: 'Address' });
      addrIn.value = c.address;
      const notesIn = h('textarea.contacts-in.contacts-ta', { rows: '3', maxlength: String(C.LIMITS.notes), 'aria-label': 'Notes', placeholder: 'Notes' });
      notesIn.value = c.notes;
      const groupsIn = h('input.contacts-in', { type: 'text', value: c.groups.join(', '), maxlength: '200', 'aria-label': 'Groups, separated by commas', placeholder: 'Family, School, …', list: 'contacts-groups' });
      const dl = h('datalist', { id: 'contacts-groups' }, C.groupNames(S.data.contacts).map(g => h('option', { value: g })));

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
        const draftC = { name: nameIn.value, phones: ph.read(), emails: em.read(), address: addrIn.value, notes: notesIn.value, photo: draft.photo,
          groups: groupsIn.value.split(',') };
        const probs = C.problems(draftC);
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
        h('div.contacts-fl', h('span', { text: 'Phone numbers' }), ph.box,
          h('button.btn.btn--sm', { type: 'button', onclick: () => ph.add().focus() }, icon('plus'), h('span', { text: 'Add a number' }))),
        h('div.contacts-fl', h('span', { text: 'Email addresses' }), em.box,
          h('button.btn.btn--sm', { type: 'button', onclick: () => em.add().focus() }, icon('plus'), h('span', { text: 'Add an address' }))),
        h('label.contacts-fl', h('span', { text: 'Address' }), addrIn),
        h('label.contacts-fl', h('span', { text: 'Groups' }), groupsIn, dl),
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

    function renderEmpty() {
      mainEl.replaceChildren(h('div.app__bar', backBtn(), h('div.app__title', { text: 'Static Contacts' })),
        h('div.app__content', h('div.empty', icon('user'),
          h('b', { text: S.data.contacts.length ? 'Choose someone' : 'Your address book is empty' }),
          h('small', { text: 'Names, numbers, emails and notes. Saved on this device only, never sent anywhere.' }),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => startNew() }, icon('plus'), h('span', { text: 'New contact' })))));
    }

    function render() {
      if (S.dead) return;
      appEl.classList.toggle('is-narrow', S.narrow);
      appEl.classList.toggle('show-card', S.narrow && S.pane === 'card');
      paintList();
      const c = S.sel ? byId(S.sel) : null;
      if (S.sel && !c) S.sel = null;
      if (S.mode === 'new') renderEditor(null);
      else if (c && S.mode === 'edit') renderEditor(c);
      else if (c) renderCard(c);
      else renderEmpty();
    }

    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect?.width || appEl.clientWidth;
        const n = w > 0 && w < NARROW;
        if (n !== S.narrow) { S.narrow = n; if (!S.dead) render(); }
      });
      ro.observe(appEl);
    }
    render();

    return () => {
      S.dead = true;
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
    };
  },
});
