import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";

const fetchPromotions = createServerFn({ method: "GET" }).handler(async () => {
  const result = await env.DB.prepare(
    "SELECT * FROM promotions ORDER BY created_at DESC LIMIT 50",
  ).all();
  return { promotions: result.results as Array<Record<string, string | number | boolean | null>> };
});

export const Route = createFileRoute("/promotions" as any)({
  loader: () => fetchPromotions(),
  component: PromotionsPage,
});

function PromotionsPage() {
  const { promotions } = Route.useLoaderData();

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Promotion Reports</h1>
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
        rows={promotions}
        emptyMessage="No promotion reports yet. Run a blue team backtest to generate one."
      />
    </>
  );
}
