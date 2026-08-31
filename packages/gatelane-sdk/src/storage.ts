/**
 * Storage adapter — pluggable back-end for capture records.
 *
 * gatelane's capture SDK is host-agnostic: the same SDK can write to in-memory
 * (tests), filesystem (local dev), or HTTP (production, talking to a Cloudflare
 * Worker that writes to R2/D1).
 *
 * @see docs/prd.md §5.4 — Shared engine
 */

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
};

export type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(column?: string): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
  all<T = unknown>(): Promise<{ results: T[] }>;
};

export type R2BucketLike = {
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

import type { CapturedCall } from './capture.js';
export type CaptureRecord = CapturedCall;

/** Result of a successful write. */
export type WriteResult = {
  readonly id: string;
  readonly stored_at: string;
  readonly backend: string;
};

/** Storage back-end interface. All implementations must be safe to call concurrently. */
export interface StorageAdapter {
  /** Persist a capture record. Returns the canonical id + storage timestamp. */
  write(record: CaptureRecord): Promise<WriteResult>;
  /** Read back a record by id. Returns null if not found. */
  read(id: string): Promise<CaptureRecord | null>;
  /** List records matching a filter. Used by the freeze-slice tool. */
  list(filter: { source_kind?: string; since?: string; limit?: number }): Promise<ReadonlyArray<CaptureRecord>>;
  /** Identity of the backend (for debugging + audit). */
  readonly name: string;
}

/** In-memory adapter. Default for tests; never persisted across restarts. */
export class InMemoryStorage implements StorageAdapter {
  readonly name = 'memory';
  private readonly records = new Map<string, CaptureRecord>();

  async write(record: CaptureRecord): Promise<WriteResult> {
    this.records.set(record.id, record);
    return {
      id: record.id,
      stored_at: new Date().toISOString(),
      backend: this.name,
    };
  }

  async read(id: string): Promise<CaptureRecord | null> {
    return this.records.get(id) ?? null;
  }

  async list(filter: { source_kind?: string; since?: string; limit?: number }): Promise<ReadonlyArray<CaptureRecord>> {
    let out = Array.from(this.records.values());
    if (filter.source_kind !== undefined) {
      out = out.filter((r) => r.input.metadata?.['source_kind'] === filter.source_kind);
    }
    if (filter.since !== undefined) {
      const since = Date.parse(filter.since);
      out = out.filter((r) => Date.parse(r.started_at) >= since);
    }
    if (filter.limit !== undefined) {
      out = out.slice(0, filter.limit);
    }
    return out;
  }
}

/** Active storage. Module-level mutable singleton — initialized once. */
let activeStorage: StorageAdapter = new InMemoryStorage();

/** Replace the active storage backend. Returns the previous backend for restoration in tests. */
export function setStorage(adapter: StorageAdapter): StorageAdapter {
  const previous = activeStorage;
  activeStorage = adapter;
  return previous;
}

/** Get the active storage backend. */
export function getStorage(): StorageAdapter {
  return activeStorage;
}