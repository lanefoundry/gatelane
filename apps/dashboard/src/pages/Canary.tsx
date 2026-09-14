import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";
import { getCanaries, advanceCanary, rollbackCanaryApi } from "../lib/api";

interface Observation {
  timestamp: string;
  metric: string;
  value: number;
  baseline: number;
  delta: number;
}

interface CanaryRow {
  id: string;
  candidateRef: string;
  state: string;
  trafficPercent: number;
  startedAt: string;
  observationEndsAt: string | null;
  completedAt: string | null;
  error: string | null;
  observations: Observation[];
  [key: string]: unknown;
}

function ObservationsDetail({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) {
    return <div style={{ padding: 12, color: "#9ca3af", fontSize: 13 }}>No observations recorded yet.</div>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
      <thead>
        <tr>
          {["Time", "Metric", "Value", "Baseline", "Delta"].map((h) => (
            <th key={h} style={{
              textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #e5e7eb",
              color: "#6b7280", fontWeight: 600, fontSize: 11, textTransform: "uppercase",
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {observations.map((obs, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
            <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>{obs.timestamp}</td>
            <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>{obs.metric}</td>
            <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>{obs.value.toFixed(4)}</td>
            <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>{obs.baseline.toFixed(4)}</td>
            <td style={{
              padding: "6px 10px", borderBottom: "1px solid #f3f4f6",
              color: obs.delta >= 0 ? "#166534" : "#991b1b", fontWeight: 600,
            }}>
              {obs.delta >= 0 ? "+" : ""}{(obs.delta * 100).toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CanaryPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [rollbackTargetId, setRollbackTargetId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["canaries"],
    queryFn: getCanaries,
    refetchInterval: 10_000,
  });

  const advanceMutation = useMutation({
    mutationFn: advanceCanary,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["canaries"] }),
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rollbackCanaryApi(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canaries"] });
      setRollbackTargetId(null);
      setRollbackReason("");
    },
  });

  const canaries = (data?.canaries ?? []) as CanaryRow[];
  const isTerminal = (state: string) => ["promoted", "rolled_back", "failed"].includes(state);

  return (
    <Layout current="#canary">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Canary Deployments</h1>
      <p style={{ color: "#6b7280", marginBottom: 24, fontSize: 14 }}>
        Canary deployments route a percentage of traffic to a candidate, observe metrics, then promote or rollback.
      </p>

      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}

      {data && (
        <>
          <DataTable
            columns={[
              { key: "id", label: "ID", render: (r) => (
                <button
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14, padding: 0 }}
                >
                  {String(r.id).slice(0, 20)}...
                </button>
              )},
              { key: "candidateRef", label: "Candidate" },
              { key: "state", label: "State", render: (r) => <StatusBadge status={String(r.state)} /> },
              { key: "trafficPercent", label: "Traffic %", render: (r) => `${r.trafficPercent}%` },
              { key: "startedAt", label: "Started" },
              { key: "observationEndsAt", label: "Observe Until", render: (r) => String(r.observationEndsAt ?? "-") },
              { key: "completedAt", label: "Completed", render: (r) => String(r.completedAt ?? "-") },
              { key: "_actions", label: "Actions", render: (r) => {
                if (isTerminal(String(r.state))) return null;
                return (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => advanceMutation.mutate(String(r.id))}
                      disabled={advanceMutation.isPending}
                      style={{
                        padding: "4px 12px", fontSize: 12, borderRadius: 6,
                        background: "#2563eb", color: "#fff", border: "none", cursor: "pointer",
                      }}
                    >
                      Advance
                    </button>
                    <button
                      onClick={() => setRollbackTargetId(String(r.id))}
                      style={{
                        padding: "4px 12px", fontSize: 12, borderRadius: 6,
                        background: "#dc2626", color: "#fff", border: "none", cursor: "pointer",
                      }}
                    >
                      Rollback
                    </button>
                  </div>
                );
              }},
            ]}
            rows={canaries}
            emptyMessage="No canary deployments. Run a gate with promotion to start one."
          />

          {expandedId && (() => {
            const canary = canaries.find((c) => c.id === expandedId);
            if (!canary) return null;
            return (
              <div style={{ marginTop: 16, padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                  Observations for {canary.id.slice(0, 24)}...
                </h3>
                {canary.error && (
                  <p style={{ color: "#991b1b", fontSize: 13, marginBottom: 8 }}>{canary.error}</p>
                )}
                <ObservationsDetail observations={canary.observations ?? []} />
              </div>
            );
          })()}

          {rollbackTargetId && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
            }}>
              <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Rollback Canary</h3>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
                  ID: {rollbackTargetId}
                </p>
                <input
                  type="text"
                  placeholder="Reason for rollback..."
                  value={rollbackReason}
                  onChange={(e) => setRollbackReason(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 12px", border: "1px solid #d1d5db",
                    borderRadius: 6, fontSize: 14, marginBottom: 16, boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setRollbackTargetId(null); setRollbackReason(""); }}
                    style={{ padding: "6px 16px", fontSize: 13, borderRadius: 6, background: "#f3f4f6", border: "none", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => rollbackMutation.mutate({ id: rollbackTargetId, reason: rollbackReason || "Manual rollback" })}
                    disabled={rollbackMutation.isPending}
                    style={{ padding: "6px 16px", fontSize: 13, borderRadius: 6, background: "#dc2626", color: "#fff", border: "none", cursor: "pointer" }}
                  >
                    {rollbackMutation.isPending ? "Rolling back..." : "Confirm Rollback"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
