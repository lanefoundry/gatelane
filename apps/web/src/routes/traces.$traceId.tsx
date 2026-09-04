import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { StatusBadge } from "../components/StatusBadge";

interface SpanRow {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  start_time: string;
  end_time: string | null;
  input: unknown;
  output: unknown;
}

interface GenerationRow {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  model: string;
  prompt: unknown;
  completion: unknown;
  token_input: number;
  token_output: number;
  token_total: number;
  cost_cents: number;
  latency_ms: number;
  provider: string;
}

interface ScoreRow {
  id: string;
  name: string;
  value: number;
  source: string;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "running";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ExpandableJson({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined) return null;

  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { /* keep as string */ }
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#6b7280",
          fontSize: 12,
          padding: 0,
          fontFamily: "inherit",
        }}
      >
        {open ? "▼" : "▶"} {label}
      </button>
      {open && (
        <pre style={{
          background: "#f3f4f6",
          padding: 8,
          borderRadius: 4,
          fontSize: 12,
          overflow: "auto",
          maxHeight: 300,
          marginTop: 4,
        }}>
          {typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DurationBar({ start, end, traceStart, traceEnd }: {
  start: string;
  end: string | null;
  traceStart: string;
  traceEnd: string | null;
}) {
  const tStart = new Date(traceStart).getTime();
  const tEnd = new Date(traceEnd ?? new Date().toISOString()).getTime();
  const totalMs = tEnd - tStart || 1;

  const sStart = new Date(start).getTime();
  const sEnd = new Date(end ?? new Date().toISOString()).getTime();

  const leftPct = Math.max(0, ((sStart - tStart) / totalMs) * 100);
  const widthPct = Math.max(1, ((sEnd - sStart) / totalMs) * 100);

  return (
    <div style={{ position: "relative", height: 6, background: "#e5e7eb", borderRadius: 3, width: "100%" }}>
      <div style={{
        position: "absolute",
        left: `${leftPct}%`,
        width: `${Math.min(widthPct, 100 - leftPct)}%`,
        height: "100%",
        background: "#3b82f6",
        borderRadius: 3,
      }} />
    </div>
  );
}

type TreeNode = {
  type: "span";
  data: SpanRow;
  children: TreeNode[];
} | {
  type: "generation";
  data: GenerationRow;
  children: TreeNode[];
};

function buildTree(spans: SpanRow[], generations: GenerationRow[]): TreeNode[] {
  const spanNodes = new Map<string, TreeNode>();
  const rootNodes: TreeNode[] = [];

  for (const s of spans) {
    spanNodes.set(s.id, { type: "span", data: s, children: [] });
  }

  for (const s of spans) {
    const node = spanNodes.get(s.id)!;
    if (s.parent_span_id && spanNodes.has(s.parent_span_id)) {
      spanNodes.get(s.parent_span_id)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  for (const g of generations) {
    const genNode: TreeNode = { type: "generation", data: g, children: [] };
    if (g.parent_span_id && spanNodes.has(g.parent_span_id)) {
      spanNodes.get(g.parent_span_id)!.children.push(genNode);
    } else {
      rootNodes.push(genNode);
    }
  }

  return rootNodes;
}

function SpanNode({ node, depth, traceStart, traceEnd }: {
  node: TreeNode;
  depth: number;
  traceStart: string;
  traceEnd: string | null;
}) {
  if (node.type === "generation") {
    const g = node.data;
    return (
      <div style={{ marginLeft: depth * 24, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            display: "inline-block",
            padding: "1px 6px",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            background: "#fef3c7",
            color: "#92400e",
          }}>
            GEN
          </span>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{g.name}</span>
          <span style={{ color: "#6b7280", fontSize: 12 }}>{g.model}</span>
          <span style={{ color: "#6b7280", fontSize: 12 }}>
            {g.token_input}+{g.token_output}={g.token_total} tok
          </span>
          <span style={{ color: "#6b7280", fontSize: 12 }}>
            ${(g.cost_cents / 100).toFixed(4)}
          </span>
          <span style={{ color: "#6b7280", fontSize: 12 }}>
            {formatMs(g.latency_ms)}
          </span>
        </div>
        <ExpandableJson label="Prompt" value={g.prompt} />
        <ExpandableJson label="Completion" value={g.completion} />
      </div>
    );
  }

  const s = node.data;
  return (
    <div style={{ marginLeft: depth * 24, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-block",
          padding: "1px 6px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          background: "#dbeafe",
          color: "#1e40af",
        }}>
          SPAN
        </span>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</span>
        <span style={{ color: "#6b7280", fontSize: 12 }}>
          {formatDuration(s.start_time, s.end_time)}
        </span>
      </div>
      <div style={{ marginTop: 4, maxWidth: 300 }}>
        <DurationBar start={s.start_time} end={s.end_time} traceStart={traceStart} traceEnd={traceEnd} />
      </div>
      <ExpandableJson label="Input" value={s.input} />
      <ExpandableJson label="Output" value={s.output} />
      {node.children.map((child) => (
        <SpanNode key={child.data.id} node={child} depth={1} traceStart={traceStart} traceEnd={traceEnd} />
      ))}
    </div>
  );
}

const fetchTrace = createServerFn({ method: "GET" })
  .validator((traceId: string) => traceId)
  .handler(async ({ data: traceId }) => {
    const trace = await env.DB.prepare("SELECT * FROM traces WHERE id = ?").bind(traceId).first();
    if (!trace) throw new Error("Trace not found");

    const spans = await env.DB.prepare(
      "SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC",
    ).bind(traceId).all();

    const generations = await env.DB.prepare(
      "SELECT * FROM generations WHERE trace_id = ? ORDER BY created_at ASC",
    ).bind(traceId).all();

    const scores = await env.DB.prepare(
      "SELECT * FROM scores WHERE trace_id = ? ORDER BY created_at ASC",
    ).bind(traceId).all();

    return {
      ...trace,
      spans: spans.results,
      generations: generations.results,
      scores: scores.results,
    } as any;
  });

export const Route = createFileRoute("/traces/$traceId" as any)({
  loader: ({ params }: { params: { traceId: string } }) => fetchTrace({ data: params.traceId }),
  component: TraceDetailPage,
});

function TraceDetailPage() {
  const data = Route.useLoaderData() as Record<string, any>;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to={"/traces" as any} style={{ color: "#6b7280", textDecoration: "none", fontSize: 14 }}>
          ← Back to Traces
        </Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Trace Detail</h1>
      <div style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Name</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{String(data.name)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Status</div>
            <StatusBadge status={String(data.status)} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Duration</div>
            <div style={{ fontSize: 14 }}>{formatDuration(String(data.start_time), data.end_time as string | null)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Start</div>
            <div style={{ fontSize: 14 }}>{String(data.start_time)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>User</div>
            <div style={{ fontSize: 14 }}>{String(data.user_id ?? "-")}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Session</div>
            <div style={{ fontSize: 14 }}>{String(data.session_id ?? "-")}</div>
          </div>
        </div>
        <ExpandableJson label="Input" value={data.input} />
        <ExpandableJson label="Output" value={data.output} />
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Timeline</h2>
      <div style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}>
        {(() => {
          const spans = (data.spans as SpanRow[]) ?? [];
          const generations = (data.generations as GenerationRow[]) ?? [];
          const tree = buildTree(spans, generations);
          if (tree.length === 0) {
            return <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>No spans or generations</div>;
          }
          return tree.map((node) => (
            <SpanNode
              key={node.data.id}
              node={node}
              depth={0}
              traceStart={String(data.start_time)}
              traceEnd={data.end_time as string | null}
            />
          ));
        })()}
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Scores</h2>
      <div style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 20,
      }}>
        {(() => {
          const scores = (data.scores as ScoreRow[]) ?? [];
          if (scores.length === 0) {
            return <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>No scores</div>;
          }
          return (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  {["Name", "Value", "Source"].map((h) => (
                    <th key={h} style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderBottom: "2px solid #e5e7eb",
                      color: "#6b7280",
                      fontWeight: 600,
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scores.map((s) => (
                  <tr key={s.id}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>{s.name}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontFamily: "monospace" }}>{s.value}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
                      <StatusBadge status={s.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>
    </>
  );
}
