/**
 * Replay engine — runs each dataset item against each candidate via LLMCaller.
 *
 * Two modes:
 * - Single-turn: one prompt → one response (legacy, item.input only)
 * - Multi-turn: replay full agent trace with mocked tool results (item.turns)
 *
 * Multi-turn replay feeds user/system turns to the candidate, lets the model
 * decide tool calls, injects the ORIGINAL tool results from the captured trace,
 * and records the complete new trace. This isolates model behavior changes
 * from tool behavior changes.
 *
 * Determinism: a stable seed per (candidate, item) produces reproducible output.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { CapturedCall, Turn } from '@lanefoundry/gatelane-sdk/capture';
import type { DatasetItem, FrozenDataset } from '@lanefoundry/gatelane-sdk/dataset';

import type { LLMCaller, ChatMessage, LLMResponse } from './llm.js';

export type ReplayRow = {
  item_id: string;
  candidate_ref: string;
  response: LLMResponse;
  captured: CapturedCall;
  /** Full multi-turn trace when replaying an agent trace. */
  turns?: Turn[];
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
    messages_from_item?: (item: DatasetItem) => Array<ChatMessage>;
  }>;
  caller: LLMCaller;
  /** Master seed; per (candidate, item) seed is derived deterministically. */
  seed?: number;
  /** If true, replay twice to measure determinism. Doubles cost. */
  measureDeterminism?: boolean;
  /** Max LLM round-trips per multi-turn replay (prevents infinite loops). */
  maxTurns?: number;
};

function deriveSeed(master: number, candidateRef: string, itemId: string): number {
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

/** Build a tool-result lookup from original turns: tool_call_id → tool content. */
function buildToolResultMap(turns: ReadonlyArray<Turn>): Map<string, Turn> {
  const map = new Map<string, Turn>();
  for (const t of turns) {
    if (t.role === 'tool' && t.tool_call_id) {
      map.set(t.tool_call_id, t);
    }
  }
  return map;
}

/** Convert Turn[] into ChatMessage[] for the LLMCaller (which only takes role+content). */
function turnsToMessages(turns: ReadonlyArray<Turn>): ChatMessage[] {
  return turns
    .filter((t): t is Turn & { content: string } => t.content !== null)
    .map((t) => ({
      role: t.role === 'tool' ? 'user' as const : t.role as ChatMessage['role'],
      content: t.role === 'tool'
        ? `[Tool result from ${t.name ?? 'unknown'}]: ${t.content}`
        : t.content,
    }));
}

/**
 * Multi-turn replay: replay a full agent trace with mocked tool results.
 *
 * The model makes fresh decisions (may call different tools), but tool results
 * come from the original trace. If the model calls a tool that wasn't in the
 * original trace, the tool result is "Tool not available in replay".
 */
async function replayMultiTurn(args: {
  item: DatasetItem;
  itemTurns: ReadonlyArray<Turn>;
  candidateRef: string;
  model: string;
  caller: LLMCaller;
  seed: number;
  maxTurns: number;
}): Promise<{ response: LLMResponse; replayTurns: Turn[]; totalCost: number; totalLatency: number }> {
  const { itemTurns, candidateRef, model, caller, seed, maxTurns } = args;

  const toolResultMap = buildToolResultMap(itemTurns);
  const replayTurns: Turn[] = [];
  let totalCost = 0;
  let totalLatency = 0;
  let lastResponse: LLMResponse | null = null;

  // Start with system and user turns from the original trace
  const initialTurns = itemTurns.filter((t) => t.role === 'system' || t.role === 'user');
  for (const t of initialTurns) {
    replayTurns.push({ ...t });
  }

  let roundTrips = 0;
  while (roundTrips < maxTurns) {
    roundTrips++;
    const messages = turnsToMessages(replayTurns);
    const startedAt = new Date().toISOString();
    const response = await caller.call({
      candidate_ref: candidateRef,
      model,
      messages,
      seed,
    });
    const completedAt = new Date().toISOString();
    totalCost += response.cost_usd;
    totalLatency += response.latency_ms;
    lastResponse = response;

    // Parse tool_calls from the raw response if the provider returned them
    const rawToolCalls = extractToolCalls(response);

    if (rawToolCalls.length > 0) {
      // Model wants to call tools
      replayTurns.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: rawToolCalls,
        status: 'ok',
        span_kind: 'llm',
        model,
        started_at: startedAt,
        completed_at: completedAt,
        cost_usd: response.cost_usd,
        latency_ms: response.latency_ms,
        tokens_in: response.tokens_in,
        tokens_out: response.tokens_out,
      });

      // Inject original tool results (mocked)
      for (const tc of rawToolCalls) {
        const originalResult = toolResultMap.get(tc.id);
        if (originalResult) {
          replayTurns.push({
            ...originalResult,
            status: originalResult.status ?? 'ok',
          });
        } else {
          replayTurns.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify({ error: 'Tool not available in replay', tool: tc.name }),
            status: 'error',
            error: { type: 'ReplayError', message: `Tool "${tc.name}" was not called in the original trace` },
          });
        }
      }
    } else {
      // Model gave a final text response — done
      replayTurns.push({
        role: 'assistant',
        content: response.content,
        status: response.finish_reason === 'error' ? 'error' : 'ok',
        span_kind: 'llm',
        model,
        started_at: startedAt,
        completed_at: completedAt,
        cost_usd: response.cost_usd,
        latency_ms: response.latency_ms,
        tokens_in: response.tokens_in,
        tokens_out: response.tokens_out,
        ...(response.finish_reason === 'error' ? {
          error: { type: 'LLMError', message: 'Model returned error finish_reason' },
        } : {}),
      });
      break;
    }
  }

  if (!lastResponse) {
    throw new Error(`Multi-turn replay produced no response for ${candidateRef}`);
  }

  return { response: lastResponse, replayTurns, totalCost, totalLatency };
}

/** Extract tool_calls from a raw LLM response (OpenAI format). */
function extractToolCalls(response: LLMResponse): Array<{ id: string; name: string; arguments: string }> {
  if (response.finish_reason !== 'tool_calls') return [];
  const raw = response.raw as Record<string, unknown> | undefined;
  if (!raw) return [];

  // OpenAI format: choices[0].message.tool_calls
  const choices = raw.choices as Array<{ message?: { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> | undefined;
  const toolCalls = choices?.[0]?.message?.tool_calls;
  if (!toolCalls || !Array.isArray(toolCalls)) return [];

  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}

export async function replay(args: ReplayArgs): Promise<ReplayResult> {
  const items = args.dataset.items ?? [];
  if (items.length === 0) {
    return { rows: [], determinism_score: 1, total_cost_usd: 0, total_latency_ms: 0 };
  }
  const master = args.seed ?? 0xC0FFEE;
  const maxTurns = args.maxTurns ?? 10;
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

      // Multi-turn replay when item has turns
      if (item.turns && item.turns.length > 0) {
        const result = await replayMultiTurn({
          item,
          itemTurns: item.turns,
          candidateRef: cand.ref,
          model: cand.model,
          caller: args.caller,
          seed,
          maxTurns,
        });
        const captured: CapturedCall = result.response.toCapturedCall({
          id: `r-${id}-${cand.ref}`,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          span_kind: 'gate.replay',
        });
        rows.push({
          item_id: id,
          candidate_ref: cand.ref,
          response: result.response,
          captured,
          turns: result.replayTurns,
        });
        totalCost += result.totalCost;
        totalLatency += result.totalLatency;
      } else {
        // Single-turn replay (legacy path)
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
  }

  const determinism_score = attempts === 0 ? 1 : matches / attempts;
  return {
    rows,
    determinism_score,
    total_cost_usd: totalCost,
    total_latency_ms: totalLatency,
  };
}

function deriveMessages(item: DatasetItem): Array<ChatMessage> {
  if (Array.isArray(item.input)) {
    return item.input
      .filter((m): m is { role: string; content: string } => typeof m === 'object' && m !== null && 'role' in m && 'content' in m)
      .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
  }
  return [{ role: 'user', content: String(item.input ?? '') }];
}
