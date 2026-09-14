import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { getCaptures } from "../lib/api";

export function CapturesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["captures"],
    queryFn: () => getCaptures({ limit: 100 }),
  });

  return (
    <Layout current="#captures">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Captures</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {data && (
        <DataTable
          columns={[
            { key: "id", label: "ID", render: (r) => String(r.id).slice(0, 16) + "..." },
            { key: "model", label: "Model" },
            { key: "provider", label: "Provider" },
            { key: "costCents", label: "Cost", render: (r) => {
              const cents = Number(r.costCents ?? 0);
              return cents > 0 ? `$${(cents / 100).toFixed(4)}` : "-";
            }},
            { key: "latencyMs", label: "Latency", render: (r) => {
              const ms = Number(r.latencyMs ?? 0);
              return ms > 0 ? `${ms}ms` : "-";
            }},
            { key: "createdAt", label: "Created" },
          ]}
          rows={data.captures}
          emptyMessage="No captures yet. Send a POST to /v1/capture to get started."
        />
      )}
    </Layout>
  );
}
