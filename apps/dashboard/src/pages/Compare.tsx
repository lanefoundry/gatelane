import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { getTraces, type TraceRecord } from "../lib/api";

interface ComparisonPair {
  input: string;
  baselineLatency: number;
  candidateLatency: number;
  latencyDelta: number;
  scoreDeltas: Record<string, number>;
  regressions: string[];
}

interface ComparisonResult {
  totalPairs: number;
  improvements: number;
  regressions: number;
  unchanged: number;
  avgLatencyDelta: number;
  avgScoreDelta: Record<string, number>;
  pairs: ComparisonPair[];
}

function traceLatency(t: TraceRecord): number {
  if (!t.endTime) return 0;
  return new Date(t.endTime).getTime() - new Date(t.startTime).getTime();
}

function inputKey(input: unknown): string {
  if (typeof input === "string") return input;
  return JSON.stringify(input);
}

function runComparison(baseline: TraceRecord[], candidate: TraceRecord[]): ComparisonResult {
  const baselineMap = new Map<string, TraceRecord>();
  for (const t of baseline) baselineMap.set(inputKey(t.input), t);

  const pairs: ComparisonPair[] = [];
  let improvements = 0;
  let regressions = 0;
  let unchanged = 0;

  for (const cand of candidate) {
    const base = baselineMap.get(inputKey(cand.input));
    if (!base) continue;

    const bLat = traceLatency(base);
    const cLat = traceLatency(cand);
    const latencyDelta = cLat - bLat;

    const allScoreNames = new Set([
      ...Object.keys(base.scores ?? {}),
      ...Object.keys(cand.scores ?? {}),
    ]);

    const scoreDeltas: Record<string, number> = {};
    const pairRegressions: string[] = [];

    for (const name of allScoreNames) {
      const bScore = base.scores?.[name] ?? 0;
      const cScore = cand.scores?.[name] ?? 0;
      const delta = cScore - bScore;
      scoreDeltas[name] = delta;
      if (delta < 0) pairRegressions.push(`${name}: ${bScore.toFixed(2)} → ${cScore.toFixed(2)}`);
    }

    if (latencyDelta > 1000) pairRegressions.push(`latency: +${latencyDelta}ms`);

    if (pairRegressions.length > 0) regressions++;
    else if (Object.values(scoreDeltas).some((d) => d > 0)) improvements++;
    else unchanged++;

    pairs.push({
      input: inputKey(cand.input),
      baselineLatency: bLat,
      candidateLatency: cLat,
      latencyDelta,
      scoreDeltas,
      regressions: pairRegressions,
    });
  }

  const avgLatencyDelta = pairs.length > 0
    ? pairs.reduce((s, p) => s + p.latencyDelta, 0) / pairs.length : 0;

  const avgScoreDelta: Record<string, number> = {};
  if (pairs.length > 0) {
    for (const pair of pairs) {
      for (const [name, delta] of Object.entries(pair.scoreDeltas)) {
        avgScoreDelta[name] = (avgScoreDelta[name] ?? 0) + delta;
      }
    }
    for (const name of Object.keys(avgScoreDelta)) {
      avgScoreDelta[name] = avgScoreDelta[name]! / pairs.length;
    }
  }

  return { totalPairs: pairs.length, improvements, regressions, unchanged, avgLatencyDelta, avgScoreDelta, pairs };
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      padding: "16px 20px", background: "#fff", borderRadius: 8,
      border: "1px solid #e5e7eb", minWidth: 120, textAlign: "center",
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "#111827" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function DeltaCell({ value, inverse }: { value: number; inverse?: boolean }) {
  const isGood = inverse ? value < 0 : value > 0;
  const isBad = inverse ? value > 0 : value < 0;
  const color = isGood ? "#166534" : isBad ? "#991b1b" : "#6b7280";
  const prefix = value > 0 ? "+" : "";
  return (
    <span style={{ fontWeight: 600, color, fontSize: 13 }}>
      {prefix}{value.toFixed(3)}
    </span>
  );
}

export function ComparePage() {
  const [baselineTag, setBaselineTag] = useState("");
  const [candidateTag, setCandidateTag] = useState("");
  const [runCompare, setRunCompare] = useState(false);

  const baselineQ = useQuery({
    queryKey: ["traces-baseline", baselineTag],
    queryFn: () => getTraces({ tag: baselineTag, limit: 200 }),
    enabled: runCompare && !!baselineTag,
  });

  const candidateQ = useQuery({
    queryKey: ["traces-candidate", candidateTag],
    queryFn: () => getTraces({ tag: candidateTag, limit: 200 }),
    enabled: runCompare && !!candidateTag,
  });

  const isLoading = baselineQ.isLoading || candidateQ.isLoading;
  const error = baselineQ.error || candidateQ.error;

  const result = (baselineQ.data && candidateQ.data)
    ? runComparison(baselineQ.data.traces, candidateQ.data.traces)
    : null;

  const allScoreNames = result
    ? [...new Set(result.pairs.flatMap((p) => Object.keys(p.scoreDeltas)))]
    : [];

  return (
    <Layout current="#compare">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Compare</h1>
      <p style={{ color: "#6b7280", marginBottom: 20, fontSize: 14 }}>
        Compare two trace sets by tag to see improvements and regressions after a change.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Baseline tag</label>
          <input
            type="text"
            placeholder="e.g. v1"
            value={baselineTag}
            onChange={(e) => { setBaselineTag(e.target.value); setRunCompare(false); }}
            style={{
              padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: 6,
              fontSize: 13, width: 140, outline: "none",
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Candidate tag</label>
          <input
            type="text"
            placeholder="e.g. v2"
            value={candidateTag}
            onChange={(e) => { setCandidateTag(e.target.value); setRunCompare(false); }}
            style={{
              padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: 6,
              fontSize: 13, width: 140, outline: "none",
            }}
          />
        </div>
        <button
          onClick={() => setRunCompare(true)}
          disabled={!baselineTag || !candidateTag}
          style={{
            padding: "6px 16px", background: baselineTag && candidateTag ? "#2563eb" : "#9ca3af",
            color: "#fff", border: "none", borderRadius: 6, fontSize: 13,
            fontWeight: 600, cursor: baselineTag && candidateTag ? "pointer" : "not-allowed",
          }}
        >
          Compare
        </button>
      </div>

      {isLoading && <p>Loading traces...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}

      {result && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
            <StatCard label="Matched pairs" value={result.totalPairs} />
            <StatCard label="Improvements" value={result.improvements} color="#166534" />
            <StatCard label="Regressions" value={result.regressions} color="#991b1b" />
            <StatCard label="Unchanged" value={result.unchanged} />
            <StatCard label="Avg latency Δ" value={`${result.avgLatencyDelta.toFixed(0)}ms`}
              color={result.avgLatencyDelta > 500 ? "#991b1b" : "#6b7280"} />
            {Object.entries(result.avgScoreDelta).map(([name, delta]) => (
              <StatCard key={name} label={`Avg ${name} Δ`}
                value={`${delta > 0 ? "+" : ""}${delta.toFixed(3)}`}
                color={delta > 0 ? "#166534" : delta < 0 ? "#991b1b" : "#6b7280"} />
            ))}
          </div>

          {result.totalPairs === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
              No matching input pairs found between baseline and candidate traces.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    {["Input", "Baseline ms", "Candidate ms", "Latency Δ", ...allScoreNames.map((n) => `${n} Δ`), "Status"].map((h) => (
                      <th key={h} style={{
                        textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #e5e7eb",
                        color: "#6b7280", fontWeight: 600, fontSize: 12,
                        textTransform: "uppercase", letterSpacing: 0.5,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.pairs.map((pair, i) => {
                    const isRegression = pair.regressions.length > 0;
                    return (
                      <tr key={i} style={{
                        background: isRegression ? "#fef2f2" : i % 2 === 0 ? "#fff" : "#f9fafb",
                      }}>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {pair.input.slice(0, 60)}{pair.input.length > 60 ? "..." : ""}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontSize: 13 }}>
                          {pair.baselineLatency}ms
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontSize: 13 }}>
                          {pair.candidateLatency}ms
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
                          <DeltaCell value={pair.latencyDelta} inverse />
                        </td>
                        {allScoreNames.map((name) => (
                          <td key={name} style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
                            <DeltaCell value={pair.scoreDeltas[name] ?? 0} />
                          </td>
                        ))}
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
                          {isRegression ? (
                            <span style={{
                              padding: "2px 10px", borderRadius: 9999, fontSize: 12, fontWeight: 600,
                              background: "#fee2e2", color: "#991b1b",
                            }}>regression</span>
                          ) : (
                            <span style={{
                              padding: "2px 10px", borderRadius: 9999, fontSize: 12, fontWeight: 600,
                              background: "#dcfce7", color: "#166534",
                            }}>ok</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
