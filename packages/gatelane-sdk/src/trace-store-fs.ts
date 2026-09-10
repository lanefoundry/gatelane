/**
 * Filesystem trace store — writes each trace as a JSON file on disk.
 *
 * Layout:
 *   <dir>/
 *     <date>/           — one folder per day (2026-09-10)
 *       <traceId>.json  — one file per trace
 *
 * Designed for local dev and CI. Not for production (no concurrency control).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { TraceRecord, TraceStore, TraceListFilter } from './tracing.js';

export class FilesystemTraceStore implements TraceStore {
  readonly name: string;
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.name = `trace-fs(${dir})`;
  }

  async write(trace: TraceRecord): Promise<void> {
    const date = trace.startTime.slice(0, 10);
    const dayDir = join(this.dir, date);
    await mkdir(dayDir, { recursive: true });
    const file = join(dayDir, `${trace.id}.json`);
    await writeFile(file, JSON.stringify(trace, null, 2), 'utf-8');
  }

  async read(id: string): Promise<TraceRecord | null> {
    const days = await this._listDays();
    for (const day of days) {
      const dayDir = join(this.dir, day);
      const files = await readdir(dayDir);
      const match = files.find((f) => f === `${id}.json`);
      if (match) {
        return JSON.parse(await readFile(join(dayDir, match), 'utf-8')) as TraceRecord;
      }
    }
    return null;
  }

  async list(filter: TraceListFilter = {}): Promise<TraceRecord[]> {
    const days = await this._listDays();
    const traces: TraceRecord[] = [];

    for (const day of days) {
      if (filter.since && day < filter.since.slice(0, 10)) continue;
      if (filter.until && day > filter.until.slice(0, 10)) continue;

      const dayDir = join(this.dir, day);
      const files = (await readdir(dayDir)).filter((f) => f.endsWith('.json'));

      for (const f of files) {
        try {
          const trace = JSON.parse(await readFile(join(dayDir, f), 'utf-8')) as TraceRecord;
          if (filter.name && trace.name !== filter.name) continue;
          if (filter.tags && !filter.tags.every((t) => trace.tags?.includes(t))) continue;
          traces.push(trace);
        } catch {
          // skip malformed
        }
      }

      if (filter.limit && traces.length >= filter.limit) break;
    }

    traces.sort((a, b) => b.startTime.localeCompare(a.startTime));
    return filter.limit ? traces.slice(0, filter.limit) : traces;
  }

  private async _listDays(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort().reverse();
    } catch {
      return [];
    }
  }
}
