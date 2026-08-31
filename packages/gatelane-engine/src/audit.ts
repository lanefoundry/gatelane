/**
 * Audit log — append-only signed event log for gate runs.
 *
 * Each stage of the gate (replay, judge, compare, sign, evaluate) emits an
 * AuditLogEntry signed with HMAC-SHA256. Entries are stored in D1 for
 * tamper-evident audit trails.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { D1DatabaseLike } from '@lanefoundry/gatelane-sdk';

const encoder = new TextEncoder();

/** Event types emitted during a gate run. */
export type AuditEventType =
  | 'capture'
  | 'replay'
  | 'judge'
  | 'compare'
  | 'promote'
  | 'sign';

/** Audit log entry written to the audit_log table. */
export type AuditLogEntry = {
  /** Unique entry id (UUID). */
  readonly id: string;
  /** Gate run id this entry belongs to. */
  readonly gate_run_id: string;
  /** Stage that produced this entry. */
  readonly event_type: AuditEventType;
  /** ISO 8601 timestamp when entry was created. */
  readonly timestamp: string;
  /** SHA-256 hash of the canonical payload (hex). */
  readonly payload_hash: string;
  /** Base64url-encoded HMAC-SHA256 signature. */
  readonly signature?: string;
};

/** Payload for audit entry signing — canonical JSON of relevant data. */
export type AuditPayload = {
  readonly gate_run_id: string;
  readonly event_type: AuditEventType;
  readonly timestamp: string;
  readonly data: unknown;
};

/**
 * Canonicalize an audit payload for signing.
 * Excludes signature field; recursively sorts keys for deterministic output.
 */
export function canonicalizeAuditPayload(payload: AuditPayload): string {
  return JSON.stringify(sortKeysDeep(payload));
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

/** Compute SHA-256 hash of a string payload (hex). */
export async function hashPayload(payload: string): Promise<string> {
  const payloadBytes = encoder.encode(payload);
  const hash = await crypto.subtle.digest('SHA-256', payloadBytes as BufferSource);
  const hashArray = new Uint8Array(hash);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sign an audit entry with the given key. Returns the signature string. */
export async function signAuditEntry(entry: AuditLogEntry, key: string): Promise<string> {
  if (key.length < 16) {
    throw new Error('signing key must be ≥ 16 chars; got ' + key.length);
  }
  const keyBytes = encoder.encode(key);
  const payloadBytes = encoder.encode(canonicalizeAuditPayload({
    gate_run_id: entry.gate_run_id,
    event_type: entry.event_type,
    timestamp: entry.timestamp,
    data: entry, // entry is the full data for this audit event
  }));
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

/** Verify an audit entry's signature. Returns true if signature matches. */
export async function verifyAuditEntry(entry: AuditLogEntry, key: string): Promise<boolean> {
  if (!entry.signature) return false;
  const expected = await signAuditEntry({ ...entry, signature: undefined }, key);
  return constantTimeEqual(expected, entry.signature);
}

/** Base64url encoding. */
function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time string comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Append an audit entry to the D1 audit_log table.
 * Requires a signed entry (signature must be present).
 */
export async function appendAuditEntry(
  entry: AuditLogEntry,
  db: D1DatabaseLike
): Promise<void> {
  if (!entry.signature) {
    throw new Error('audit entry must be signed before appending');
  }

  const stmt = db.prepare(`
    INSERT INTO audit_log (id, gate_run_id, event_type, timestamp, payload_hash, signature)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  await stmt.bind(
    entry.id,
    entry.gate_run_id,
    entry.event_type,
    entry.timestamp,
    entry.payload_hash,
    entry.signature
  ).run();
}

/**
 * Create and append a signed audit entry in one call.
 * Returns the created entry with signature.
 */
export async function createAndAppendAuditEntry(
  gateRunId: string,
  eventType: AuditEventType,
  data: unknown,
  signingKey: string,
  db: D1DatabaseLike
): Promise<AuditLogEntry> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const payload: AuditPayload = { gate_run_id: gateRunId, event_type: eventType, timestamp, data };
  const canonical = canonicalizeAuditPayload(payload);
  const payloadHash = await hashPayload(canonical);

  const entry: AuditLogEntry = {
    id,
    gate_run_id: gateRunId,
    event_type: eventType,
    timestamp,
    payload_hash: payloadHash,
    signature: undefined,
  };

  const signature = await signAuditEntry(entry, signingKey);
  const signedEntry: AuditLogEntry = { ...entry, signature };

  await appendAuditEntry(signedEntry, db);
  return signedEntry;
}