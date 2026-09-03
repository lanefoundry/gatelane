import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";
import { getPromotions } from "../lib/api";

export function PromotionsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["promotions"],
    queryFn: getPromotions,
  });

  return (
    <Layout current="#promotions">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Promotion Reports</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {data && (
        <DataTable
          columns={[
            { key: "id", label: "ID" },
            { key: "candidate_model", label: "Candidate" },
            { key: "baseline_model", label: "Baseline" },
            { key: "delta", label: "Delta (Δ)", render: (r) => Number(r.delta).toFixed(4) },
            { key: "threshold", label: "Threshold" },
            { key: "decision", label: "Decision", render: (r) => <StatusBadge status={String(r.decision)} /> },
            { key: "created_at", label: "Created" },
          ]}
          rows={data.promotions as Record<string, unknown>[]}
          emptyMessage="No promotion reports yet. Run a backtest to generate one."
        />
      )}
    </Layout>
  );
}
