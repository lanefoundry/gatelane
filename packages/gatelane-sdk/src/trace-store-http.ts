/**
 * HTTP trace store — sends trace records to a gatelane Worker endpoint.
 *
 * Production: `https://<your-worker>.workers.dev/v1/traces`
 * Local dev:  `http://localhost:8787/v1/traces`
 *
 * The Worker writes metadata to D1 and the full trace JSON to R2.
 * Retries: 3 attempts with exponential backoff on 5xx / network errors.
 */

import type { TraceRecord, TraceStore, TraceListFilter } from './tracing.js';

export type HttpTraceStoreOptions = {
  readonly endpoint: string;
  readonly token: string;
  readonly maxRetries?: number;
  readonly initialBackoffMs?: number;
  readonly fetchImpl?: typeof fetch;
};

export class HttpTraceStore implements TraceStore {
  readonly name: string;
  private readonly endpoint: string;
  private readonly token: string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpTraceStoreOptions) {
    this.endpoint = opts.endpoint.replace(/\/$/, '');
    this.token = opts.token;
    this.maxRetries = opts.maxRetries ?? 3;
    this.initialBackoffMs = opts.initialBackoffMs ?? 200;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.name = `trace-http(${new URL(this.endpoint).host})`;
  }

  async write(trace: TraceRecord): Promise<void> {
    const url = `${this.endpoint}/v1/traces`;
    await this._fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(trace),
    });
  }

  async read(id: string): Promise<TraceRecord | null> {
    const url = `${this.endpoint}/v1/traces/${encodeURIComponent(id)}`;
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`trace read failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as TraceRecord;
  }

  async list(filter: TraceListFilter = {}): Promise<TraceRecord[]> {
    const params = new URLSearchParams();
    if (filter.since !== undefined) params.set('since', filter.since);
    if (filter.until !== undefined) params.set('until', filter.until);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.name !== undefined) params.set('name', filter.name);
    if (filter.tags !== undefined && filter.tags.length > 0) {
      params.set('tags', filter.tags.join(','));
    }
    const url = `${this.endpoint}/v1/traces${params.size > 0 ? '?' + params.toString() : ''}`;
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`trace list failed: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as { traces: TraceRecord[] };
    return body.traces;
  }

  private async _fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(url, init);
        if (response.ok) return response;
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`trace write rejected: ${response.status} ${response.statusText}`);
        }
        lastErr = new Error(`trace write failed: ${response.status} ${response.statusText}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('trace write rejected')) {
          throw err;
        }
        lastErr = err;
      }
      if (attempt < this.maxRetries - 1) {
        const delay = this.initialBackoffMs * Math.pow(2, attempt);
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, delay);
        await promise;
      }
    }
    throw new Error(`trace write failed after ${this.maxRetries} attempts: ${String(lastErr)}`);
  }
}
