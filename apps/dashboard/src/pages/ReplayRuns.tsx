import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";
import { getReplayRuns } from "../lib/api";

export function ReplayRunsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["replay-runs"],
    queryFn: getReplayRuns,
  });

  return (
    <Layout current="#replay-runs">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Replay Runs</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {data && (
        <DataTable
          columns={[
            { key: "id", label: "ID" },
            { key: "dataset_id", label: "Dataset" },
            { key: "candidate_model", label: "Candidate" },
            { key: "baseline_model", label: "Baseline" },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
            { key: "created_at", label: "Created" },
          ]}
          rows={data.runs as Record<string, unknown>[]}
          emptyMessage="No replay runs yet."
        />
      )}
    </Layout>
  );
}
