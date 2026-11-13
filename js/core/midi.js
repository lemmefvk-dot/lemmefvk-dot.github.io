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
   anything else (clock, pitch bend, aftertouch…) is ignored.

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

export default { parse, describe, createMidi };
