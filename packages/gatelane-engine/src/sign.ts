/**
 * HMAC-SHA256 signing for PromotionReport.
 *
 * The signing key comes from the `GATELANE_REPORT_SIGNING_KEY` env var (32+ random
 * bytes recommended). The signed payload is the canonical JSON of the report
 * (without the `signature` field); the signature is base64url-encoded HMAC.
 *
 * The same key reproduces the same signature, so auditors can verify
 * "did this report actually get signed at decision time?" by recomputing.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { PromotionReport } from '@lanefoundry/gatelane-sdk';
/** Stable JSON for signing (excludes `signature`; recursively sorts keys). */
export function canonicalizeReport(report: PromotionReport): string {
  const { signature: _sig, ...rest } = report;
  return JSON.stringify(sortKeysDeep(rest));
}

/** Recursively sort object keys for canonical JSON. Arrays preserve order. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeysDeep(obj[key]);
    }
    return out;
  }
  return value;
}

 const encoder = new TextEncoder();

/** Sign a PromotionReport with the given key. Returns the new signature string. */
export async function signReport(report: PromotionReport, key: string): Promise<string> {
  if (key.length < 16) {
    throw new Error('signing key must be ≥ 16 chars; got ' + key.length);
  }
  const keyBytes = encoder.encode(key);
  const payloadBytes = encoder.encode(canonicalizeReport(report));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, payloadBytes as BufferSource);
  return base64url(new Uint8Array(sig));
}

/** Verify a PromotionReport's signature. Returns true if signature matches. */
export async function verifyReport(report: PromotionReport, key: string): Promise<boolean> {
  const expected = await signReport(report, key);
  return constantTimeEqual(expected, report.signature);
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}