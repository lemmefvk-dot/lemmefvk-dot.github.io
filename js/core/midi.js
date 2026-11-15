/* ============================================================
   midi.js — Web MIDI for the instruments (Static Piano, Static Synth).

   Nothing here runs until a person turns MIDI on: navigator.
   requestMIDIAccess() is called from enable() and from nowhere else, so
   the browser's permission prompt never appears at load.

   parse(bytes) turns one MIDI message into a plain event:
     { type:'on',  ch, note, vel }        vel is 0..1 (note-on with velocity 0
                                           is a note-off, as the spec says)
     { type:'off', ch, note, vel }
     { type:'pedal', ch, down }           controller 64, down at 64 and above
     { type:'allOff', ch }                controllers 120 (sound off) / 123
     { type:'bend', ch, value }           pitch wheel, -1..1
   anything else (clock, aftertouch…) is ignored.

   createMidi({ onEvent, onChange }) → { enable, disable, state, inputs }
     onEvent(ev)   ev.src is 'midi:<input id>', so each keyboard is its own
                   source and one unplugged keyboard cannot cut off another.
     onChange(st)  st = { status, inputs:[{id,name}], reason }, where status
                   is 'off' | 'asking' | 'on' | 'unsupported' | 'denied' | 'error'
   Plugging in or unplugging is followed live. When a keyboard disappears
   with notes down, a note-off and a pedal-up are sent for it, so nothing
   sticks.
   ============================================================ */

export function parse(data) {
  if (!data || data.length < 1) return null;
  const st = data[0], hi = st & 0xf0, ch = st & 0x0f;
  if (st >= 0xf0) return null;
  const d1 = data[1] | 0, d2 = data[2] | 0;
  if (hi === 0x90) return d2 > 0 ? { type: 'on', ch, note: d1, vel: d2 / 127 } : { type: 'off', ch, note: d1, vel: 0 };
  if (hi === 0x80) return { type: 'off', ch, note: d1, vel: d2 / 127 };
  if (hi === 0xb0) {
    if (d1 === 64) return { type: 'pedal', ch, down: d2 >= 64 };
    if (d1 === 120 || d1 === 123) return { type: 'allOff', ch };
  }
  if (hi === 0xe0) return { type: 'bend', ch, value: Math.max(-1, Math.min(1, ((d2 << 7 | d1) - 8192) / 8192)) };   /* -1..1 */
  return null;
}

/** The plain-language line a screen shows for a state. */
export function describe(st) {
  const n = st.inputs.length;
  switch (st.status) {
    case 'off': return 'MIDI is off.';
    case 'asking': return 'Waiting for the browser to allow MIDI…';
    case 'unsupported': return 'This browser does not support MIDI keyboards (Web MIDI). Chrome, Edge and Opera do.';
    case 'denied': return 'The browser did not allow MIDI access, so no keyboard can be used. Allow MIDI for this site in the address bar, then turn it on again.';
    case 'error': return 'MIDI could not start' + (st.reason ? ': ' + st.reason : '.');
    default: return n ? `MIDI on. Connected: ${st.inputs.map(i => i.name).join(', ')}.` : 'MIDI on. No keyboard is connected; plug one in and it will appear here.';
  }
}

export function createMidi({ onEvent, onChange } = {}) {
  let access = null, gen = 0;
  const st = { status: 'off', inputs: [], reason: '' };
  const down = new Map();           /* input id -> Set(note) */
  const pedal = new Set();          /* input ids with the pedal down */
  const wired = new Map();          /* input id -> input */

  const emit = () => { try { onChange && onChange({ status: st.status, inputs: st.inputs.slice(), reason: st.reason }); } catch (e) { /* a listener's problem */ } };
  const fire = ev => { try { onEvent && onEvent(ev); } catch (e) { console.error(e); } };

  function handler(id) {
    return (m) => {
      const ev = parse(m.data);
      if (!ev) return;
      ev.src = 'midi:' + id;
      if (ev.type === 'on') { if (!down.has(id)) down.set(id, new Set()); down.get(id).add(ev.note); }
      else if (ev.type === 'off') down.get(id)?.delete(ev.note);
      else if (ev.type === 'pedal') { ev.down ? pedal.add(id) : pedal.delete(id); }
      else if (ev.type === 'allOff') down.delete(id);
      fire(ev);
    };
  }
  function letGo(id) {
    const src = 'midi:' + id;
    for (const note of [...(down.get(id) || [])]) fire({ type: 'off', ch: 0, note, vel: 0, src });
    down.delete(id);
    if (pedal.delete(id)) fire({ type: 'pedal', ch: 0, down: false, src });
  }
  function scan() {
    if (!access) return;
    const now = new Map();
    access.inputs.forEach(inp => { if (inp.state !== 'disconnected') now.set(inp.id, inp); });
    for (const [id, inp] of [...wired]) {
      if (!now.has(id)) { try { inp.onmidimessage = null; } catch (e) { /* gone */ } wired.delete(id); letGo(id); }
    }
    for (const [id, inp] of now) {
      if (!wired.has(id)) { inp.onmidimessage = handler(id); wired.set(id, inp); }
    }
    st.inputs = [...now.values()].map(i => ({ id: i.id, name: String(i.name || 'MIDI keyboard') }));
    emit();
  }

  async function enable() {
    if (st.status === 'on' || st.status === 'asking') return st.status;
    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      st.status = 'unsupported'; st.inputs = []; emit(); return st.status;
    }
    const mine = ++gen;
    st.status = 'asking'; st.reason = ''; emit();
    try {
      const a = await navigator.requestMIDIAccess({ sysex: false });
      if (mine !== gen) { try { a.onstatechange = null; } catch (e) { /* ignore */ } return st.status; }   /* turned off while the prompt was open */
      access = a;
      access.onstatechange = () => scan();
      st.status = 'on';
      scan();
    } catch (e) {
      if (mine !== gen) return st.status;
      const n = e && e.name;
      st.status = (n === 'SecurityError' || n === 'NotAllowedError') ? 'denied' : 'error';
      st.reason = st.status === 'error' ? String((e && e.message) || e || '') : '';
      st.inputs = [];
      emit();
    }
    return st.status;
  }

  function disable() {
    gen++;
    for (const [id, inp] of [...wired]) { try { inp.onmidimessage = null; } catch (e) { /* ignore */ } letGo(id); }
    wired.clear();
    if (access) { try { access.onstatechange = null; } catch (e) { /* ignore */ } access = null; }
    st.status = 'off'; st.inputs = []; st.reason = '';
    emit();
  }

  return { enable, disable, state: () => ({ ...st, inputs: st.inputs.slice() }) };
}

/* ------------------------------------------------------------
   Standard MIDI Files, written here (no library).

   readSMF(bytes) -> { format, ppq, bpm, tracks:[{ name, notes:[{ t, dur, note, vel, ch }] }], tempos:[{tick,uspq}], seconds }
     t and dur are seconds, taken through the file's tempo changes; vel is 0..1.
     Reads format 0 and 1 (format 2 as separate tracks), running status, and skips
     sysex and meta events it does not use. Returns null for anything that is not a
     MIDI file; a damaged one is read as far as it goes.
   writeSMF({ bpm, ppq, tracks:[{ name, ch, notes:[{ tick, dur, note, vel }] }] }) -> Uint8Array
     Format 1: a tempo track, then one track per entry. tick and dur are in ticks.
   secToTick / tickToSec helpers use a constant tempo.
   ------------------------------------------------------------ */
const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const u16 = (d, o) => (d[o] << 8) | d[o + 1];
export const MAX_SMF = 4 * 1024 * 1024;
export const MAX_SMF_NOTES = 20000;

export function readSMF(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (d.length < 14 || d.length > MAX_SMF || u32(d, 0) !== 0x4d546864 || u32(d, 4) < 6) return null;
  const format = u16(d, 8), ntr = u16(d, 10), div = u16(d, 12);
  if (div & 0x8000 || !div) return null;                /* SMPTE time is not supported */
  const ppq = div;
  const tempos = [{ tick: 0, uspq: 500000 }];
  const raw = [];
  let o = 8 + u32(d, 4), total = 0;
  for (let ti = 0; ti < ntr && o + 8 <= d.length; ti++) {
    const len = u32(d, o + 4), end = Math.min(d.length, o + 8 + len);
    if (u32(d, o) !== 0x4d54726b) { o = end; continue; }
    let p = o + 8, tick = 0, run = 0, name = '';
    const open = new Map(), notes = [];
    const vlq = () => { let v = 0, n = 0, b; do { b = d[p++]; v = (v << 7) | (b & 127); if (++n > 4 || p > end) break; } while (b & 128); return v; };
    while (p < end) {
      tick += vlq();
      let st = d[p];
      if (st === undefined) break;
      if (st & 128) { p++; if (st < 0xf0) run = st; } else st = run;
      if (st === 0xff) {
        const type = d[p++], l = vlq();
        if (type === 0x51 && l === 3) tempos.push({ tick, uspq: (d[p] << 16) | (d[p + 1] << 8) | d[p + 2] });
        else if (type === 0x03 && !name) name = String.fromCharCode(...d.subarray(p, p + Math.min(l, 40))).replace(/[^\x20-\x7e]/g, '');
        else if (type === 0x2f) { p += l; break; }
        p += l;
      } else if (st === 0xf0 || st === 0xf7) { p += vlq(); }
      else {
        const hi = st & 0xf0, ch = st & 15, two = hi !== 0xc0 && hi !== 0xd0;
        const a = d[p++], b = two ? d[p++] : 0;
        if (hi === 0x90 && b > 0) {
          if (open.has(ch * 128 + a)) { const x = open.get(ch * 128 + a); notes.push({ tick: x.tick, end: tick, note: a, vel: x.vel, ch }); }
          open.set(ch * 128 + a, { tick, vel: b / 127 });
        } else if (hi === 0x80 || (hi === 0x90 && b === 0)) {
          const x = open.get(ch * 128 + a);
          if (x) { notes.push({ tick: x.tick, end: tick, note: a, vel: x.vel, ch }); open.delete(ch * 128 + a); }
        }
      }
      if (notes.length + total > MAX_SMF_NOTES) break;
    }
    for (const [k, x] of open) notes.push({ tick: x.tick, end: Math.max(tick, x.tick + ppq / 4), note: k & 127, vel: x.vel, ch: k >> 7 });
    total += notes.length;
    raw.push({ name, notes });
    o = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const t2s = tk => {
    let sec = 0, last = 0, us = 500000;
    for (const t of tempos) { if (t.tick >= tk) break; sec += (t.tick - last) * us / ppq / 1e6; last = t.tick; us = t.uspq; }
    return sec + (tk - last) * us / ppq / 1e6;
  };
  let seconds = 0;
  const tracks = raw.filter(t => t.notes.length).map((t, i) => ({
    name: t.name || `Track ${i + 1}`,
    notes: t.notes.sort((a, b) => a.tick - b.tick).map(n => {
      const s = t2s(n.tick), e = t2s(n.end);
      seconds = Math.max(seconds, e);
      return { t: s, dur: Math.max(0.03, e - s), note: n.note, vel: n.vel, ch: n.ch };
    }),
  }));
  const first = tempos.filter(t => t.tick === 0).pop();       /* a tempo at the very start replaces the default */
  return { format, ppq, bpm: Math.round(6e7 / first.uspq), tempos, tracks, seconds };
}

export function writeSMF({ bpm = 120, ppq = 480, tracks = [] } = {}) {
  const out = [];
  const push = (...b) => { for (const x of b) out.push(x & 255); };
  const vlq = v => { v = Math.max(0, Math.round(v)); const bs = [v & 127]; while ((v >>= 7)) bs.unshift((v & 127) | 128); push(...bs); };
  const chunk = (id, body) => { for (const c of id) push(c.charCodeAt(0)); push(body.length >>> 24, body.length >>> 16, body.length >>> 8, body.length); for (const b of body) out.push(b); };
  const build = fn => { const keep = out.splice(0); fn(); const body = out.splice(0); out.push(...keep); return body; };
  const text = s => { const b = [...String(s).slice(0, 40)].map(c => c.charCodeAt(0) & 127); vlq(b.length); push(...b); };
  push(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length + 1, ppq >> 8, ppq);
  const us = Math.round(6e7 / Math.max(20, Math.min(400, bpm)));
  chunk('MTrk', build(() => { vlq(0); push(0xff, 0x51, 3, us >> 16, us >> 8, us); vlq(0); push(0xff, 0x58, 4, 4, 2, 24, 8); vlq(0); push(0xff, 0x2f, 0); }));
  for (const tr of tracks) {
    const ch = Math.max(0, Math.min(15, tr.ch | 0));
    const ev = [];
    for (const n of tr.notes || []) {
      const note = Math.max(0, Math.min(127, Math.round(n.note)));
      const vel = Math.max(1, Math.min(127, Math.round((n.vel == null ? 0.8 : n.vel) * 127)));
      const on = Math.max(0, Math.round(n.tick)), off = on + Math.max(1, Math.round(n.dur));
      ev.push({ tick: on, ord: 1, b: [0x90 | ch, note, vel] }, { tick: off, ord: 0, b: [0x80 | ch, note, 0] });
    }
    ev.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
    chunk('MTrk', build(() => {
      vlq(0); push(0xff, 0x03); text(tr.name || 'Track');
      let last = 0;
      for (const e of ev) { vlq(e.tick - last); last = e.tick; push(...e.b); }
      vlq(0); push(0xff, 0x2f, 0);
    }));
  }
  return Uint8Array.from(out);
}

export default { parse, describe, createMidi, readSMF, writeSMF };
