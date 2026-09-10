import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { getTraces, type TraceRecord, type SpanRecord } from "../lib/api";

function traceLatency(t: TraceRecord): string {
  if (!t.endTime) return "—";
  const ms = new Date(t.endTime).getTime() - new Date(t.startTime).getTime();
  return `${ms}ms`;
}

function spanCount(t: TraceRecord): number {
  return t.spans.length;
}

function genCount(t: TraceRecord): number {
  return t.spans.reduce((sum, s) => sum + s.generations.length, 0);
}

function ScoreBadges({ scores }: { scores?: Record<string, number> }) {
  if (!scores || Object.keys(scores).length === 0) return <span style={{ color: "#9ca3af" }}>—</span>;
  return (
    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {Object.entries(scores).map(([k, v]) => (
        <span key={k} style={{
          display: "inline-block",
          padding: "1px 8px",
          borderRadius: 9999,
          fontSize: 11,
          fontWeight: 600,
          background: v >= 0.7 ? "#dcfce7" : v >= 0.4 ? "#fef9c3" : "#fee2e2",
          color: v >= 0.7 ? "#166534" : v >= 0.4 ? "#854d0e" : "#991b1b",
        }}>
          {k}: {v.toFixed(2)}
        </span>
      ))}
    </span>
  );
}

function TagBadges({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return <span style={{ color: "#9ca3af" }}>—</span>;
  return (
    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {tags.map((t) => (
        <span key={t} style={{
          display: "inline-block",
          padding: "1px 8px",
          borderRadius: 9999,
          fontSize: 11,
          fontWeight: 500,
          background: "#e0e7ff",
          color: "#3730a3",
        }}>
          {t}
        </span>
      ))}
    </span>
  );
}

function SpanTree({ spans, parentId, depth }: { spans: SpanRecord[]; parentId: string | null; depth: number }) {
  const children = spans.filter((s) => s.parentSpanId === parentId);
  if (children.length === 0) return null;

  return (
    <>
      {children.map((span) => (
        <div key={span.id} style={{ marginLeft: depth * 20 }}>
          <div style={{
            padding: "6px 10px",
            borderLeft: "2px solid #60a5fa",
            marginBottom: 4,
            background: "#f8fafc",
            borderRadius: 4,
            fontSize: 13,
          }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <strong>{span.name}</strong>
              {span.level && span.level !== "DEFAULT" && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: "0 6px", borderRadius: 4,
                  background: span.level === "ERROR" ? "#fee2e2" : span.level === "WARNING" ? "#fef9c3" : "#f3f4f6",
                  color: span.level === "ERROR" ? "#991b1b" : span.level === "WARNING" ? "#854d0e" : "#374151",
                }}>{span.level}</span>
              )}
              {span.endTime && (
                <span style={{ fontSize: 11, color: "#9ca3af" }}>
                  {new Date(span.endTime).getTime() - new Date(span.startTime).getTime()}ms
                </span>
              )}
            </div>
            {span.output != null && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, maxHeight: 60, overflow: "hidden" }}>
                {String(typeof span.output === "string" ? span.output : JSON.stringify(span.output))}
              </div>
            )}
            {span.generations.map((gen) => (
              <div key={gen.id} style={{
                marginTop: 6, padding: "4px 8px", background: "#eff6ff",
                borderRadius: 4, fontSize: 12,
              }}>
                <span style={{ fontWeight: 600 }}>⚡ {gen.name}</span>
                <span style={{ color: "#6b7280", marginLeft: 8 }}>model: {gen.model}</span>
                {gen.usage && (
                  <span style={{ color: "#6b7280", marginLeft: 8 }}>
                    tokens: {(gen.usage.promptTokens ?? 0) + (gen.usage.completionTokens ?? 0)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <SpanTree spans={spans} parentId={span.id} depth={depth + 1} />
        </div>
      ))}
    </>
  );
}

function TraceDetail({ trace }: { trace: TraceRecord }) {
  return (
    <div style={{ padding: "12px 16px", background: "#fff", borderTop: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", gap: 24, marginBottom: 12, fontSize: 13 }}>
        <div><strong>ID:</strong> {trace.id}</div>
        {trace.userId && <div><strong>User:</strong> {trace.userId}</div>}
        {trace.sessionId && <div><strong>Session:</strong> {trace.sessionId}</div>}
      </div>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <strong>Input:</strong>{" "}
        <span style={{ color: "#374151" }}>
          {String(typeof trace.input === "string" ? trace.input : JSON.stringify(trace.input))}
        </span>
      </div>
      {trace.output != null && (
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <strong>Output:</strong>{" "}
          <span style={{ color: "#374151" }}>
            {String(typeof trace.output === "string" ? trace.output : JSON.stringify(trace.output))}
          </span>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <strong style={{ fontSize: 13 }}>Spans ({trace.spans.length}):</strong>
        <div style={{ marginTop: 8 }}>
          <SpanTree spans={trace.spans} parentId={null} depth={0} />
        </div>
      </div>
    </div>
  );
}

export function TracesPage() {
  const [tagFilter, setTagFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["traces", tagFilter, sinceFilter],
    queryFn: () => getTraces({
      ...(tagFilter ? { tag: tagFilter } : {}),
      ...(sinceFilter ? { since: sinceFilter } : {}),
      limit: 50,
    }),
  });

  const traces = data?.traces ?? [];

  return (
    <Layout current="#traces">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Traces</h1>
      <p style={{ color: "#6b7280", marginBottom: 16, fontSize: 14 }}>
        Collected agent traces. Click a row to expand the span tree.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Filter by tag..."
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          style={{
            padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: 6,
            fontSize: 13, width: 160, outline: "none",
          }}
        />
        <input
          type="date"
          value={sinceFilter}
          onChange={(e) => setSinceFilter(e.target.value)}
          style={{
            padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: 6,
            fontSize: 13, outline: "none",
          }}
        />
        <span style={{ fontSize: 13, color: "#9ca3af", alignSelf: "center" }}>
          {traces.length} trace{traces.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {!isLoading && !error && traces.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
          No traces yet. Integrate the gatelane tracing SDK to start collecting.
        </div>
      )}
      {traces.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Time", "Name", "Tags", "Spans", "Gens", "Latency", "Scores"].map((h) => (
                  <th key={h} style={{
                    textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #e5e7eb",
                    color: "#6b7280", fontWeight: 600, fontSize: 12,
                    textTransform: "uppercase", letterSpacing: 0.5,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traces.map((t, i) => (
                <>
                  <tr
                    key={t.id}
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    style={{
                      background: i % 2 === 0 ? "#fff" : "#f9fafb",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", fontSize: 12, color: "#6b7280" }}>
                      {t.startTime.slice(0, 19).replace("T", " ")}
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontWeight: 500 }}>
                      {t.name}
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
                      <TagBadges tags={t.tags} />
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", textAlign: "center" }}>
                      {spanCount(t)}
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", textAlign: "center" }}>
                      {genCount(t)}
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                      {traceLatency(t)}
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
                      <ScoreBadges scores={t.scores} />
                    </td>
                  </tr>
                  {expandedId === t.id && (
                    <tr key={`${t.id}-detail`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <TraceDetail trace={t} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
