import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { getAuditLog } from "../lib/api";

export function CapturesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit-log-captures"],
    queryFn: async () => {
      const res = await getAuditLog();
      return (res.entries as Record<string, unknown>[]).filter(
        (e) => e.action === "capture",
      );
    },
  });

  return (
    <Layout current="#captures">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Captures</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {data && (
        <DataTable
          columns={[
            { key: "resource_id", label: "Capture ID" },
            { key: "detail", label: "Detail", render: (r) => JSON.stringify(r.detail) },
            { key: "created_at", label: "Time" },
          ]}
          rows={data}
          emptyMessage="No captures yet. Send a POST to /v1/capture to get started."
        />
      )}
    </Layout>
  );
}
