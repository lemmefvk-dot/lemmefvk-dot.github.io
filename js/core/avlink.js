/* ============================================================
   avlink.js — the camera and microphone link of Watch Together.

   A SECOND peer connection, separate from anything in core/pair.js
   (Watch Together's room has no data channel of its own): it carries
   audio and video only, and uses the room's sealed messages (type
   'msig') to swap offers, answers and network candidates. It is made
   the first time either person turns something on, and every later
   change — a camera or microphone turned on, off, on again — happens
   on that one connection:
     · the first track a side adds makes a new sender, which asks the
       browser to renegotiate (negotiationneeded → a new offer);
     · turning a device off stops its track and sets the sender's
       track to null; turning it on again puts a new track back in the
       same sender, with no renegotiation;
     · both sides may offer at once, so this is the "perfect
       negotiation" pattern: the guest is polite and rolls back, the
       host's offer wins. Every message carries the connection's
       generation `g`, so a connection that has failed is replaced, not
       patched, when either person tries again.
   Public STUN only; there is NO relay (TURN), so on a network that
   refuses direct connections the link fails and the app says so.
   Nothing is recorded; media goes straight between the two devices.
   ============================================================ */

const SDP_MAX = 12000;
const CAND_MAX = 600;
const CANDS_MAX = 60;
export const CONNECT_WAIT = 20000;
const G_RE = /^[a-z0-9]{8}$/;

/** Validate one 'msig' message from the friend → a cleaned copy or null. */
export function checkSig(m) {
  if (!m || typeof m.g !== 'string' || !G_RE.test(m.g)) return null;
  if (m.sdp !== undefined) {
    const d = m.sdp;
    if (!d || typeof d !== 'object' || typeof d.sdp !== 'string' || d.sdp.length > SDP_MAX || d.sdp.length < 10 || (d.type !== 'offer' && d.type !== 'answer')) return null;
    return { g: m.g, sdp: { type: d.type, sdp: d.sdp } };
  }
  const c = m.ice;
  if (!c || typeof c !== 'object' || typeof c.candidate !== 'string' || !c.candidate || c.candidate.length > CAND_MAX) return null;
  if (c.sdpMid !== null && c.sdpMid !== undefined && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 32)) return null;
  if (c.sdpMLineIndex !== null && c.sdpMLineIndex !== undefined && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 16)) return null;
  return { g: m.g, ice: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } };
}

const newGen = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };

/**
 * send(body) → bool: sends an 'msig' to the friend.
 * h: { onTrack(track), onLink(state: 'idle'|'connecting'|'connected'|'failed', why) }
 */
export function createAv({ send, polite, ice, h = {} }) {
  let pc = null, gen = '', cands = 0, dead = false;
  let makingOffer = false, ignoreOffer = false;
  let waitT = 0, discT = 0;
  const pending = [];
  const local = { audio: null, video: null };       /* tracks we want to send */
  const senders = { audio: null, video: null };
  let link = 'idle';
  const setLink = (s, why) => { if (link === s && !why) return; link = s; try { h.onLink?.(s, why); } catch (err) { console.error('[avlink]', err); } };

  function fail(why) {
    clearTimeout(waitT); clearTimeout(discT);
    if (pc) { const c = pc; pc = null; try { c.close(); } catch (e) { /* gone */ } }
    senders.audio = senders.video = null;
    pending.length = 0;
    setLink('failed', why);
  }

  function make(g) {
    gen = g;
    cands = 0; makingOffer = false; ignoreOffer = false;
    senders.audio = senders.video = null;
    try { h.onReset?.(); } catch (err) { console.error('[avlink]', err); }     /* tracks of an older connection are gone */
    const mine = new RTCPeerConnection({ iceServers: ice() });
    pc = mine;
    mine.ontrack = e => { if (pc === mine) h.onTrack?.(e.track); };
    mine.onicecandidate = e => {
      if (pc !== mine || !e.candidate) return;
      const c = typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate;
      if (c.candidate) send({ g: gen, ice: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } });
    };
    mine.onnegotiationneeded = async () => {
      if (pc !== mine) return;
      try {
        makingOffer = true;
        await mine.setLocalDescription();
        if (pc !== mine) return;
        const d = mine.localDescription;
        if (!send({ g: gen, sdp: { type: d.type, sdp: d.sdp } })) fail('The offer was too large or couldn’t be sent.');
      } catch (err) { if (pc === mine) fail('The video link couldn’t be set up.'); }
      finally { makingOffer = false; }
    };
    mine.onconnectionstatechange = () => {
      if (pc !== mine) return;
      const s = mine.connectionState;
      if (s === 'connected') { clearTimeout(waitT); clearTimeout(discT); setLink('connected'); }
      else if (s === 'failed') fail('No direct path between your devices was found.');
      else if (s === 'disconnected') { clearTimeout(discT); discT = setTimeout(() => { if (pc === mine && mine.connectionState !== 'connected') fail('The video link dropped.'); }, 8000); }
    };
    setLink('connecting');
    clearTimeout(waitT);
    waitT = setTimeout(() => { if (pc === mine && mine.connectionState !== 'connected') fail('No direct path between your devices was found in time.'); }, CONNECT_WAIT);
    /* what we already want to send goes on the new connection */
    for (const k of ['audio', 'video']) if (local[k]) attach(k);
    return mine;
  }

  function attach(kind) {
    const t = local[kind];
    if (!pc || !t) return;
    if (senders[kind]) { senders[kind].replaceTrack(t).catch(() => {}); return; }
    try { senders[kind] = pc.addTrack(t, new MediaStream([t])); } catch (err) { fail('The video link couldn’t be set up.'); }
  }

  /** Our camera ('video') or microphone ('audio') track, or null when it is off. */
  function setTrack(kind, track) {
    if (dead) return;
    local[kind] = track || null;
    if (!track) { if (senders[kind]) senders[kind].replaceTrack(null).catch(() => {}); return; }
    if (!pc) make(newGen());
    attach(kind);
  }

  /** A validated 'msig' from the friend. */
  async function handle(m) {
    if (dead) return;
    if (m.g !== gen || !pc) {
      /* their connection, not ours: ours (if any) is replaced by it. A bare candidate for a connection we don't have is dropped. */
      if (!m.sdp || m.sdp.type !== 'offer') return;
      if (pc) { const c = pc; pc = null; try { c.close(); } catch (e) { /* gone */ } }
      make(m.g);
    }
    const mine = pc;
    try {
      if (m.sdp) {
        const collision = m.sdp.type === 'offer' && (makingOffer || mine.signalingState !== 'stable');
        ignoreOffer = !polite && collision;
        if (ignoreOffer) return;
        await mine.setRemoteDescription(m.sdp);
        if (pc !== mine) return;
        while (pending.length) await mine.addIceCandidate(pending.shift()).catch(() => {});
        if (m.sdp.type === 'offer') {
          await mine.setLocalDescription();
          if (pc !== mine) return;
          const d = mine.localDescription;
          if (!send({ g: gen, sdp: { type: d.type, sdp: d.sdp } })) fail('The answer was too large or couldn’t be sent.');
        }
      } else if (m.ice) {
        if (++cands > CANDS_MAX) return;
        if (!mine.remoteDescription) pending.push(m.ice);
        else await mine.addIceCandidate(m.ice).catch(err => { if (!ignoreOffer) throw err; });
      }
    } catch (err) { if (pc === mine) fail('The video link couldn’t be set up.'); }
  }

  /** The friend left or we did: drop the connection. Our own tracks are stopped by the app. */
  function close() {
    dead = true;
    clearTimeout(waitT); clearTimeout(discT);
    const c = pc; pc = null;
    try { c?.close(); } catch (e) { /* gone */ }
    link = 'idle';
  }
  /** After a failure: build a fresh connection for whatever is still being sent. */
  function retry() { if (!dead && !pc) make(newGen()); }

  return { setTrack, retry, handle, close, get link() { return link; }, get pc() { return pc; }, _debug: () => pc };
}

export default { createAv, checkSig, CONNECT_WAIT };
