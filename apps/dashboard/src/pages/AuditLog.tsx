import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { getAuditLog } from "../lib/api";

export function AuditLogPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit-log"],
    queryFn: getAuditLog,
  });

  return (
    <Layout current="#audit-log">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Audit Log</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {data && (
        <DataTable
          columns={[
            { key: "action", label: "Action" },
            { key: "resource_type", label: "Resource Type" },
            { key: "resource_id", label: "Resource ID" },
            { key: "actor", label: "Actor" },
            { key: "detail", label: "Detail", render: (r) => (
              <code style={{ fontSize: 12 }}>{JSON.stringify(r.detail)}</code>
            )},
            { key: "created_at", label: "Time" },
          ]}
          rows={data.entries as Record<string, unknown>[]}
          emptyMessage="No audit log entries yet."
        />
      )}
    </Layout>
  );
}
