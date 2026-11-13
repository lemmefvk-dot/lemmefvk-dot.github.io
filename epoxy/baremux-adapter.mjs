/* ============================================================
   epoxy/baremux-adapter.mjs

   Shim between @mercuryworkshop/epoxy-transport 3.0.1 and
   bare-mux 2.1.6 (the version Ultraviolet 3.2.10 bundles).

   The two disagree about the shape of `headers` in the
   BareTransport contract:

     bare-mux 2.1.6  uses  BareHeaders = Record<string, string | string[]>
                           (a plain object) for BOTH directions.
     epoxy 3.0.1     does  `for (const [k, v] of headers)` on the way in,
                           and returns `headers` as an ARRAY of [k, v] pairs.

   Feeding epoxy a plain object therefore throws
   `TypeError: headers is not iterable` out of EpoxyTransport.request,
   which bare-mux reports back as {type:'error'}, which Ultraviolet
   catches and turns into a bodyless HTTP 500.

   This subclass normalises both directions, so nothing else has to change.
   ============================================================ */
import EpoxyTransport from './index.mjs';

/** plain object (or anything) -> iterable of [name, value] pairs */
function toEntries(headers) {
  if (!headers) return [];
  if (typeof headers[Symbol.iterator] === 'function') return headers; // Headers, Map, [[k,v]]
  const out = [];
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) for (const one of v) out.push([k, String(one)]);
    else if (v !== undefined && v !== null) out.push([k, String(v)]);
  }
  return out;
}

/** iterable of [name, value] pairs -> plain object, repeats collapsed to arrays */
function toObject(headers) {
  if (!headers) return {};
  if (typeof headers[Symbol.iterator] !== 'function') return headers; // already an object
  const out = Object.create(null);
  for (const [k, v] of headers) {
    const key = String(k).toLowerCase();
    if (key in out) out[key] = Array.isArray(out[key]) ? [...out[key], v] : [out[key], v];
    else out[key] = v;
  }
  return Object.assign({}, out);
}

export default class EpoxyBareMuxTransport extends EpoxyTransport {
  async request(remote, method, body, headers, signal) {
    const res = await super.request(remote, method, body, toEntries(headers), signal);
    res.headers = toObject(res.headers);
    return res;
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
    return super.connect(url, protocols, toEntries(requestHeaders), onopen, onmessage, onclose, onerror);
  }
}
