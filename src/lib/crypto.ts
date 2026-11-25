const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const toB64Url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(input)));
}

/** sha256(value + pepper). Used for IPs and for rate-limit keys, so raw values are never stored. */
export async function pepperedHash(value: string, pepper: string): Promise<string> {
  return sha256Hex(value + pepper);
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** HMAC-SHA256, base64url. Domain-separated with a purpose prefix so one secret can't sign another purpose. */
export async function sign(secret: string, purpose: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  return toB64Url(await crypto.subtle.sign('HMAC', key, enc.encode(`${purpose}:${message}`)));
}

/** Constant-time string comparison (length is the only thing that can leak). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
