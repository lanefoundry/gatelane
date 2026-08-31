/**
 * HTTP storage adapter — sends capture records to a gatelane Worker endpoint.
 *
 * Production: `https://<your-worker>.workers.dev/v1/capture`
 * Local dev:  `http://localhost:8787/v1/capture`
 *
 * The Worker writes the record body to R2 (raw blob) and the metadata to D1.
 * This adapter only handles transport; the storage / persistence happens server-side.
 *
 * Retries: 3 attempts with exponential backoff on 5xx / network errors.
 *
 * @see docs/prd.md §6.1 — Cloudflare-first deployment
 */

import type { CaptureRecord, StorageAdapter, WriteResult } from './storage.js';

export type HttpStorageOptions = {
  /** Base URL of the gatelane Worker, no trailing slash. */
  readonly endpoint: string;
  /** Bearer token for the `/v1/capture` route. */
  readonly token: string;
  /** Max retry attempts on transient failures. Defaults to 3. */
  readonly maxRetries?: number;
  /** Initial backoff in ms. Doubles each retry. Defaults to 200. */
  readonly initialBackoffMs?: number;
  /** Override fetch for testing. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
};

export class HttpStorage implements StorageAdapter {
  readonly name: string;
  private readonly endpoint: string;
  private readonly token: string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpStorageOptions) {
    this.endpoint = opts.endpoint.replace(/\/$/, '');
    this.token = opts.token;
    this.maxRetries = opts.maxRetries ?? 3;
    this.initialBackoffMs = opts.initialBackoffMs ?? 200;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.name = `http(${new URL(this.endpoint).host})`;
  }

  async write(record: CaptureRecord): Promise<WriteResult> {
    const url = `${this.endpoint}/v1/capture`;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.token}`,
            'x-gatelane-span-kind': record.span_kind ?? 'gate.replay',
          },
          body: JSON.stringify(record),
        });
        if (response.ok) {
          const body = (await response.json()) as { id: string; stored_at: string };
          return { id: body.id, stored_at: body.stored_at, backend: this.name };
        }
        // 4xx is fatal — don't retry. 5xx is transient — retry.
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`capture write rejected: ${response.status} ${response.statusText}`);
        }
        lastErr = new Error(`capture write failed: ${response.status} ${response.statusText}`);
      } catch (err) {
        // Re-throw 4xx immediately so the caller sees the rejection; only network / 5xx retries.
        if (err instanceof Error && err.message.startsWith('capture write rejected')) {
          throw err;
        }
        lastErr = err;
      }
      // Backoff before next attempt (5xx / network path).
      if (attempt < this.maxRetries - 1) {
        const delay = this.initialBackoffMs * Math.pow(2, attempt);
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, delay);
        await promise;
      }
    }
    throw new Error(`capture write failed after ${this.maxRetries} attempts: ${String(lastErr)}`);
  }

  async read(_id: string): Promise<CaptureRecord | null> {
    // Worker exposes GET /v1/capture/:id in v0.2. Stub: return null.
    // Returning null means "not in local cache; ask the Worker". Tests don't depend on read.
    return null;
  }

  async list(_filter: { source_kind?: string; since?: string; limit?: number }): Promise<ReadonlyArray<CaptureRecord>> {
    // Worker exposes GET /v1/captures?since=... in v0.2. Stub: return [].
    return [];
  }
}