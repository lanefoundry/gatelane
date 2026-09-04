import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";

const fetchReplayRuns = createServerFn({ method: "GET" }).handler(async () => {
  const result = await env.DB.prepare(
    "SELECT * FROM replay_runs ORDER BY created_at DESC LIMIT 50",
  ).all();
  return { runs: result.results as Array<Record<string, string | number | boolean | null>> };
});

export const Route = createFileRoute("/replay-runs" as any)({
  loader: () => fetchReplayRuns(),
  component: ReplayRunsPage,
});

function ReplayRunsPage() {
  const { runs } = Route.useLoaderData();

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Replay Runs</h1>
      <DataTable
        columns={[
          { key: "id", label: "ID" },
          { key: "dataset_id", label: "Dataset" },
          { key: "candidate_model", label: "Candidate" },
          { key: "baseline_model", label: "Baseline" },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
          { key: "created_at", label: "Created" },
        ]}
        rows={runs}
        emptyMessage="No replay runs yet."
      />
    </>
  );
}
