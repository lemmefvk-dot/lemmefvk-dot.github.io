/* ============================================================
   bcsign.js — who is allowed to broadcast to everyone.

   Developer broadcasts (announcements, events, a promoted site)
   travel over a public live channel, so anyone could send one.
   What makes a broadcast real is a signature: the developer signs
   it on their own device with a private key that lives only there,
   and every StaticOS verifies it against the PUBLIC key baked in
   below. A message without a matching signature is ignored — no
   Discord, no server, and nobody but the key's holder can push
   anything to other people.

   The private half is set once in Developer Room → Admin abuse and
   kept in that browser (never shipped). Losing it means generating
   a new pair and updating PUBLIC_KEY here.
   ============================================================ */

/* the developer's public verifying key (ECDSA P-256, JWK) */
export const PUBLIC_KEY = {
  kty: 'EC', crv: 'P-256',
  x: '2sSJQbAc853RHR4mya_6BXbPaSi_fRPTyfVJ5AFmnGA',
  y: 'IYXDRX1i8T9FJnd_JDqgi03ZUNe5sDccchMcSlZGJng',
};

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const bytesToB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

let verifyKey = null;
async function pub() {
  if (verifyKey) return verifyKey;
  verifyKey = await subtle().importKey('jwk', PUBLIC_KEY, ALG, false, ['verify']);
  return verifyKey;
}

/** Is `p` (the signed JSON string) really from the developer? */
export async function verifyBroadcast(p, sigB64) {
  const s = subtle();
  if (!s) return false;
  try {
    return await s.verify(SIGN_ALG, await pub(), b64ToBytes(sigB64), new TextEncoder().encode(String(p)));
  } catch (e) { return false; }
}

/** Sign `p` with a private JWK the developer holds. -> base64 signature. */
export async function signBroadcast(p, privJwk) {
  const s = subtle();
  if (!s) throw new Error('This browser has no Web Crypto.');
  const key = await s.importKey('jwk', privJwk, ALG, false, ['sign']);
  const sig = await s.sign(SIGN_ALG, key, new TextEncoder().encode(String(p)));
  return bytesToB64(sig);
}

/** A private JWK matches the baked public key iff a test signature verifies. */
export async function keyMatches(privJwk) {
  try {
    const probe = `probe:${Date.now()}`;
    return await verifyBroadcast(probe, await signBroadcast(probe, privJwk));
  } catch (e) { return false; }
}

export default { PUBLIC_KEY, verifyBroadcast, signBroadcast, keyMatches };
