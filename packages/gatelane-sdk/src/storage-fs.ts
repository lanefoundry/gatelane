/**
 * Filesystem storage adapter — writes capture records as JSONL files on disk.
 *
 * Use this in local dev when you don't want to spin up a Cloudflare Worker.
 * Each record is one JSON line; the file name encodes the time so listing is cheap.
 *
 * Not for production: no concurrency control, no rotation, no replay-friendly
 * content addressing. Use HttpStorage in production.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CaptureRecord, StorageAdapter, WriteResult } from './storage.js';

export type FilesystemStorageOptions = {
  /** Directory to write capture files. Created if missing. */
  readonly dir: string;
};

export class FilesystemStorage implements StorageAdapter {
  readonly name: string;
  private readonly dir: string;

  constructor(opts: FilesystemStorageOptions) {
    this.dir = opts.dir;
    this.name = `fs(${opts.dir})`;
  }

  async write(record: CaptureRecord): Promise<WriteResult> {
    await mkdir(this.dir, { recursive: true });
    const stored_at = new Date().toISOString();
    const file = join(this.dir, `${record.started_at.replace(/[:.]/g, '-')}-${record.id}.jsonl`);
    await writeFile(file, JSON.stringify(record), 'utf-8');
    return { id: record.id, stored_at, backend: this.name };
  }

  async read(id: string): Promise<CaptureRecord | null> {
    const files = await readdir(this.dir);
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const text = await readFile(join(this.dir, f), 'utf-8');
      try {
        const record = JSON.parse(text) as CaptureRecord;
        if (record.id === id) return record;
      } catch {
        // skip malformed
      }
    }
    return null;
  }

  async list(filter: { source_kind?: string; since?: string; limit?: number }): Promise<ReadonlyArray<CaptureRecord>> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.jsonl')).sort();
    let out: CaptureRecord[] = [];
    for (const f of files) {
      const text = await readFile(join(this.dir, f), 'utf-8');
      try {
        out.push(JSON.parse(text) as CaptureRecord);
      } catch {
        // skip
      }
    }
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