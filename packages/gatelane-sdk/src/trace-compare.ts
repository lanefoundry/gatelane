/**
 * Trace comparison — diff two sets of traces (before vs after a change).
 *
 * Takes two tagged trace sets (e.g. tag "baseline" vs "candidate"),
 * matches them by input, and compares latency, cost, scores, and outputs.
 */

import type { TraceRecord } from './tracing.js';

export interface ComparisonPair {
  input: unknown;
  baseline: TraceRecord;
  candidate: TraceRecord;
  baselineResponse: string;
  candidateResponse: string;
  delta: {
    latencyMs: number;
    totalGenerations: number;
    scores: Record<string, number>;
  };
  regressions: string[];
  status: 'improved' | 'regressed' | 'unchanged';
}

export interface ComparisonReport {
  id: string;
  baselineTag: string;
  candidateTag: string;
  totalPairs: number;
  regressions: number;
  improvements: number;
  unchanged: number;
  pairs: ComparisonPair[];
  summary: {
    avgLatencyDelta: number;
    avgScoreDelta: Record<string, number>;
    medianScoreDelta: Record<string, number>;
    pctImproved: number;
    pctRegressed: number;
    worstRegression: { input: string; scoreName: string; delta: number } | null;
  };
  createdAt: string;
}

function inputKey(input: unknown): string {
  if (typeof input === 'string') return input;
  return JSON.stringify(input);
}

function traceLatency(t: TraceRecord): number {
  if (!t.endTime) return 0;
  return new Date(t.endTime).getTime() - new Date(t.startTime).getTime();
}

function traceGenerationCount(t: TraceRecord): number {
  return t.spans.reduce((sum, s) => sum + s.generations.length, 0);
}

function extractResponse(t: TraceRecord): string {
  for (const span of t.spans) {
    for (const gen of span.generations) {
      if (gen.output) return gen.output;
    }
    if (span.output && typeof span.output === 'string') return span.output;
  }
  return typeof t.output === 'string' ? t.output : JSON.stringify(t.output ?? '');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function compareTraces(
  baseline: TraceRecord[],
  candidate: TraceRecord[],
  opts: { baselineTag?: string; candidateTag?: string; scoreThreshold?: number } = {},
): ComparisonReport {
  const baselineTag = opts.baselineTag ?? 'baseline';
  const candidateTag = opts.candidateTag ?? 'candidate';
  const scoreThreshold = opts.scoreThreshold ?? 0;

  const baselineMap = new Map<string, TraceRecord>();
  for (const t of baseline) {
    baselineMap.set(inputKey(t.input), t);
  }

  const pairs: ComparisonPair[] = [];
  let regressions = 0;
  let improvements = 0;
  let unchanged = 0;

  let worstRegression: { input: string; scoreName: string; delta: number } | null = null;

  for (const cand of candidate) {
    const key = inputKey(cand.input);
    const base = baselineMap.get(key);
    if (!base) continue;

    const latencyDelta = traceLatency(cand) - traceLatency(base);
    const genDelta = traceGenerationCount(cand) - traceGenerationCount(base);

    const scoreDeltas: Record<string, number> = {};
    const pairRegressions: string[] = [];

    const allScoreNames = new Set([
      ...Object.keys(base.scores ?? {}),
      ...Object.keys(cand.scores ?? {}),
    ]);

    for (const name of allScoreNames) {
      const baseScore = base.scores?.[name] ?? 0;
      const candScore = cand.scores?.[name] ?? 0;
      const delta = candScore - baseScore;
      scoreDeltas[name] = delta;
      if (delta < -scoreThreshold) {
        pairRegressions.push(`${name}: ${baseScore.toFixed(2)} → ${candScore.toFixed(2)} (Δ${delta.toFixed(2)})`);
        if (worstRegression === null || delta < worstRegression.delta) {
          const inputStr = typeof cand.input === 'string' ? cand.input : JSON.stringify(cand.input);
          worstRegression = { input: inputStr, scoreName: name, delta };
        }
      }
    }

    if (latencyDelta > 1000) {
      pairRegressions.push(`latency: +${latencyDelta}ms`);
    }

    let status: ComparisonPair['status'];
    if (pairRegressions.length > 0) {
      regressions++;
      status = 'regressed';
    } else if (Object.values(scoreDeltas).some((d) => d > scoreThreshold)) {
      improvements++;
      status = 'improved';
    } else {
      unchanged++;
      status = 'unchanged';
    }

    pairs.push({
      input: cand.input,
      baseline: base,
      candidate: cand,
      baselineResponse: extractResponse(base),
      candidateResponse: extractResponse(cand),
      delta: {
        latencyMs: latencyDelta,
        totalGenerations: genDelta,
        scores: scoreDeltas,
      },
      regressions: pairRegressions,
      status,
    });
  }

  // Compute averages
  const avgLatencyDelta = pairs.length > 0
    ? pairs.reduce((sum, p) => sum + p.delta.latencyMs, 0) / pairs.length
    : 0;

  const avgScoreDelta: Record<string, number> = {};
  const scoreArrays: Record<string, number[]> = {};
  if (pairs.length > 0) {
    for (const pair of pairs) {
      for (const [name, delta] of Object.entries(pair.delta.scores)) {
        avgScoreDelta[name] = (avgScoreDelta[name] ?? 0) + delta;
        if (!scoreArrays[name]) scoreArrays[name] = [];
        scoreArrays[name].push(delta);
      }
    }
    for (const name of Object.keys(avgScoreDelta)) {
      avgScoreDelta[name] = avgScoreDelta[name]! / pairs.length;
    }
  }

  const medianScoreDelta: Record<string, number> = {};
  for (const [name, arr] of Object.entries(scoreArrays)) {
    medianScoreDelta[name] = median(arr);
  }

  const total = pairs.length || 1;

  return {
    id: crypto.randomUUID(),
    baselineTag,
    candidateTag,
    totalPairs: pairs.length,
    regressions,
    improvements,
    unchanged,
    pairs,
    summary: {
      avgLatencyDelta,
      avgScoreDelta,
      medianScoreDelta,
      pctImproved: Math.round((improvements / total) * 100),
      pctRegressed: Math.round((regressions / total) * 100),
      worstRegression,
    },
    createdAt: new Date().toISOString(),
  };
}
