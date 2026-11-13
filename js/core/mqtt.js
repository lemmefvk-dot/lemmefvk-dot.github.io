/* ============================================================
   mqtt.js — a tiny MQTT 3.1.1 client over WebSocket.

   Just enough to run a live, no-account chat over a free public
   broker (see js/apps/hub.js): CONNECT, SUBSCRIBE, PUBLISH at
   QoS 0, keep-alive PINGs, and a Last-Will so a dropped client is
   announced. No dependency — the packets are built by hand.

   It is deliberately small: QoS 0 only (fire and forget, no acks
   to track), no retained-message bookkeeping, no TLS options
   (the URL is a wss:// the browser dials). Everything a public
   broker can refuse or drop is treated as "not connected" rather
   than thrown at the user.

     const c = connect(url, { clientId, will });
     c.on('connect' | 'message' | 'close' | 'error', fn)
     c.subscribe(topic);  c.publish(topic, string);  c.end();
   'message' gives { topic, text }.
   ============================================================ */

const enc = new TextEncoder();
const dec = new TextDecoder();

/* MQTT remaining-length is a base-128 varint, up to 4 bytes. */
function encodeLen(n) {
  const out = [];
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 0x80; out.push(d); } while (n > 0);
  return out;
}
/* a length-prefixed UTF-8 string (2-byte big-endian length) */
function str(s) {
  const b = enc.encode(String(s));
  return [b.length >> 8, b.length & 0xff, ...b];
}
function packet(type, flags, body) {
  const head = (type << 4) | flags;
  return new Uint8Array([head, ...encodeLen(body.length), ...body]);
}

export function connect(url, { clientId, will, keepalive = 45 } = {}) {
  const listeners = { connect: [], message: [], close: [], error: [] };
  const emit = (ev, arg) => listeners[ev].forEach(fn => { try { fn(arg); } catch (e) {} });
  const id = clientId || `staticos-${Math.random().toString(16).slice(2, 10)}`;

  let ws;
  try { ws = new WebSocket(url, 'mqtt'); } catch (e) { setTimeout(() => emit('error', e), 0); return dead(); }
  ws.binaryType = 'arraybuffer';

  let ping = 0;
  let open = false;
  let closed = false;

  function dead() {
    return { on, subscribe() {}, unsubscribe() {}, publish() {}, end() {}, get connected() { return false; } };
  }
  function on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); return () => { listeners[ev] = listeners[ev].filter(f => f !== fn); }; }

  ws.onopen = () => {
    /* CONNECT: protocol "MQTT" level 4, clean session, optional will */
    let flags = 0x02;                                   // clean session
    const payload = [...str(id)];
    if (will && will.topic) {
      flags |= 0x04;                                    // will flag, will QoS 0, no retain
      payload.push(...str(will.topic), ...str(will.text || ''));
    }
    const varHeader = [...str('MQTT'), 0x04, flags, keepalive >> 8, keepalive & 0xff];
    send(packet(1, 0, [...varHeader, ...payload]));
  };

  ws.onmessage = ev => {
    const data = new Uint8Array(ev.data);
    let i = 0;
    while (i < data.length) {
      const type = data[i] >> 4;
      i++;
      /* remaining length varint */
      let len = 0, mult = 1, byte;
      do { byte = data[i++]; len += (byte & 0x7f) * mult; mult *= 128; } while (byte & 0x80 && i < data.length);
      const end = i + len;
      if (type === 2) {                                 // CONNACK
        const code = data[i + 1];
        if (code === 0) { open = true; startPing(); emit('connect'); }
        else emit('error', new Error(`broker refused the connection (code ${code})`));
      } else if (type === 3) {                          // PUBLISH (QoS 0 → no packet id)
        const tlen = (data[i] << 8) | data[i + 1];
        const topic = dec.decode(data.subarray(i + 2, i + 2 + tlen));
        const text = dec.decode(data.subarray(i + 2 + tlen, end));
        emit('message', { topic, text });
      }
      /* SUBACK / PINGRESP need no action */
      i = end;
    }
  };
  /* an error is not guaranteed to be followed by a close event, so stop the
     keep-alive here too rather than leave it pinging a dead socket forever */
  ws.onerror = () => { clearInterval(ping); emit('error', new Error('the realtime connection failed')); };
  ws.onclose = () => { closed = true; clearInterval(ping); if (!open) emit('error', new Error('could not reach the broker')); emit('close'); };

  function send(bytes) { try { if (ws.readyState === 1) ws.send(bytes); } catch (e) {} }
  function startPing() {
    clearInterval(ping);
    ping = setInterval(() => {
      /* if the socket has gone, stop rather than pinging into nothing */
      if (closed || ws.readyState !== 1) { clearInterval(ping); return; }
      send(new Uint8Array([0xc0, 0x00]));
    }, keepalive * 1000 * 0.75);
  }

  let pid = 1;
  return {
    on,
    get connected() { return open && !closed; },
    subscribe(topic) {
      const id2 = pid++ & 0xffff;
      send(packet(8, 0x02, [id2 >> 8, id2 & 0xff, ...str(topic), 0x00]));   // QoS 0
    },
    /* Without this the broker keeps pushing a topic down the socket for the
       whole session after the last listener has gone — wasted bandwidth,
       which matters on a slow or metered connection. UNSUBSCRIBE carries no
       QoS byte, unlike SUBSCRIBE. */
    unsubscribe(topic) {
      const id2 = pid++ & 0xffff;
      send(packet(10, 0x02, [id2 >> 8, id2 & 0xff, ...str(topic)]));
    },
    publish(topic, text) {
      send(packet(3, 0x00, [...str(topic), ...enc.encode(String(text))]));   // QoS 0, no retain
    },
    end() {
      clearInterval(ping);
      try { if (ws.readyState === 1) { send(new Uint8Array([0xe0, 0x00])); ws.close(); } else ws.close(); } catch (e) {}
    },
  };
}

/* Public brokers that speak MQTT over WSS with an open origin policy.
   Tried in order; the first that answers wins. They are third-party and
   best-effort — a locked-down network may block them, which the hub says. */
export const PUBLIC_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

export default { connect, PUBLIC_BROKERS };
