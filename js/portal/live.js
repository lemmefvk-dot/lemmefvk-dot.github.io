/* ============================================================
   live.js — StaticOS's one live connection.

   A single MQTT-over-WebSocket link to a free public broker
   (js/core/mqtt.js), shared by everything that needs other
   people in real time: the Message Hub and signed developer
   broadcasts. No server of ours, no accounts.

   It is best-effort and honest about it: public brokers can be
   slow, and a locked-down network may block them. Status is one
   of 'idle' | 'connecting' | 'live' | 'offline', and callers show
   it plainly rather than pretending.

     onStatus(fn)            -> unsubscribe ; fn(status)
     subscribe(topic, fn)    -> unsubscribe ; fn(text)
     publish(topic, text)
     status()  ·  id()       this client's random id (no identity)

   Topics are namespaced under ROOT so StaticOS traffic keeps to
   itself on a shared broker. Everything sent here is public.
   ============================================================ */
import * as MQTT from '../core/mqtt.js';

export const ROOT = 'staticos/v1/';
const RECONNECT_MS = 4000;
const CONNECT_TIMEOUT = 9000;

let client = null;
let state = 'idle';
let brokerIdx = 0;
let reconnectT = 0;
let connectT = 0;
let started = false;

const cid = `sx-${Math.random().toString(16).slice(2, 10)}`;
const topicSubs = new Map();        /* short topic -> Set(fn) */
const statusSubs = new Set();

function setState(s) {
  if (s === state) return;
  state = s;
  statusSubs.forEach(fn => { try { fn(s); } catch (e) {} });
}

function full(t) { return ROOT + t; }

function open() {
  if (typeof WebSocket === 'undefined') { setState('offline'); return; }
  clearTimeout(reconnectT);
  const url = MQTT.PUBLIC_BROKERS[brokerIdx % MQTT.PUBLIC_BROKERS.length];
  setState('connecting');
  let c;
  try { c = MQTT.connect(url, { clientId: cid, keepalive: 45 }); }
  catch (e) { retry(); return; }
  client = c;

  clearTimeout(connectT);
  connectT = setTimeout(() => { if (state !== 'live') { try { c.end(); } catch (e) {} retry(); } }, CONNECT_TIMEOUT);

  c.on('connect', () => {
    clearTimeout(connectT);
    setState('live');
    for (const t of topicSubs.keys()) c.subscribe(full(t));
  });
  c.on('message', ({ topic, text }) => {
    if (!topic.startsWith(ROOT)) return;
    const set = topicSubs.get(topic.slice(ROOT.length));
    if (set) set.forEach(fn => { try { fn(text); } catch (e) {} });
  });
  c.on('close', () => { if (client === c) { client = null; retry(); } });
  c.on('error', () => { /* close follows */ });
}

function retry() {
  clearTimeout(connectT);
  if (client) { try { client.end(); } catch (e) {} client = null; }
  brokerIdx++;                                   /* next broker on the next try */
  setState('offline');
  clearTimeout(reconnectT);
  if (started) reconnectT = setTimeout(open, RECONNECT_MS);
}

function ensure() {
  started = true;
  if (!client && state !== 'connecting') open();
}

export function onStatus(fn) {
  statusSubs.add(fn);
  try { fn(state); } catch (e) {}
  return () => statusSubs.delete(fn);
}

export function subscribe(topic, fn) {
  ensure();
  let set = topicSubs.get(topic);
  if (!set) { set = new Set(); topicSubs.set(topic, set); if (client && state === 'live') client.subscribe(full(topic)); }
  set.add(fn);
  return () => {
    const s = topicSubs.get(topic);
    if (!s) return;
    s.delete(fn);
    if (s.size) return;
    topicSubs.delete(topic);
    /* tell the broker to stop sending it, instead of letting it push a
       topic nobody is listening to for the rest of the session */
    if (client && state === 'live') { try { client.unsubscribe(full(topic)); } catch (e) {} }
  };
}

export function publish(topic, text) {
  ensure();
  if (client && state === 'live') { client.publish(full(topic), text); return true; }
  return false;
}

export const status = () => state;
export const id = () => cid;
export function start() { ensure(); }

export default { onStatus, subscribe, publish, status, id, start, ROOT };
