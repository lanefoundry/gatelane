/**
 * Replay engine — runs each dataset item against each candidate via LLMCaller.
 *
 * Determinism: a stable seed per (candidate, item) produces reproducible output.
 * Same input + same seed = same response content. The replay engine surfaces
 * a `determinism_score` (0.0–1.0) = fraction of items where two replays matched.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { CapturedCall } from '@lanefoundry/gatelane-sdk/capture';
import type { DatasetItem, FrozenDataset } from '@lanefoundry/gatelane-sdk/dataset';

import type { LLMCaller, LLMResponse } from './llm.js';

export type ReplayRow = {
  item_id: string;
  candidate_ref: string;
  response: LLMResponse;
  /** Same seed = same response. CapturedCall for storage. */
  captured: CapturedCall;
};

export type ReplayResult = {
  rows: ReplayRow[];
  /** 0.0–1.0 across all (candidate, item) pairs. Higher = more reproducible. */
  determinism_score: number;
  total_cost_usd: number;
  total_latency_ms: number;
};

export type ReplayArgs = {
  dataset: FrozenDataset;
  candidates: ReadonlyArray<{
    ref: string;
    model: string;
    messages_from_item?: (item: DatasetItem) => Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  }>;
  caller: LLMCaller;
  /** Master seed; per (candidate, item) seed is derived deterministically. */
  seed?: number;
  /** If true, replay twice to measure determinism. Doubles cost. */
  measureDeterminism?: boolean;
};

function deriveSeed(master: number, candidateRef: string, itemId: string): number {
  // FNV-1a-ish 32-bit hash; small but stable across runs.
  let h = 0x811c9dc5 ^ master;
  for (const ch of `${candidateRef}|${itemId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function itemId(item: DatasetItem, idx: number): string {
  return item.id ?? `<item-${idx}>`;
}

export async function replay(args: ReplayArgs): Promise<ReplayResult> {
  const items = args.dataset.items ?? [];
  if (items.length === 0) {
    return { rows: [], determinism_score: 1, total_cost_usd: 0, total_latency_ms: 0 };
  }
  const master = args.seed ?? 0xC0FFEE;
  const rows: ReplayRow[] = [];
  let totalCost = 0;
  let totalLatency = 0;
  let matches = 0;
  let attempts = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const id = itemId(item, i);
    for (const cand of args.candidates) {
      const seed = deriveSeed(master, cand.ref, id);
      const messages = cand.messages_from_item?.(item) ?? deriveMessages(item);
      const response = await args.caller.call({
        candidate_ref: cand.ref,
        model: cand.model,
        messages,
        seed,
      });
      const captured: CapturedCall = response.toCapturedCall({
        id: `r-${id}-${cand.ref}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        span_kind: 'gate.replay',
      });
      rows.push({ item_id: id, candidate_ref: cand.ref, response, captured });
      totalCost += response.cost_usd;
      totalLatency += response.latency_ms;

      if (args.measureDeterminism === true) {
        const second = await args.caller.call({
          candidate_ref: cand.ref,
          model: cand.model,
          messages,
          seed,
        });
        attempts += 1;
        if (second.content === response.content) matches += 1;
      }
    }
  }

  const determinism_score = attempts === 0 ? 1 : matches / attempts;
  return {
    rows,
    determinism_score,
    total_cost_usd: totalCost,
    total_latency_ms: totalLatency,
  };
}

function deriveMessages(item: DatasetItem): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  if (Array.isArray(item.input)) {
    return item.input
      .filter((m): m is { role: string; content: string } => typeof m === 'object' && m !== null && 'role' in m && 'content' in m)
      .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
  }
  return [{ role: 'user', content: String(item.input ?? '') }];
}