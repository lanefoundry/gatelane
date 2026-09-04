import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";
import { getTraces } from "../lib/api";

function formatDuration(start: string, end: string | null): string {
  if (!end) return "...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TracesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["traces"],
    queryFn: getTraces,
  });

  return (
    <Layout current="#traces">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Traces</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {data && (
        <DataTable
          columns={[
            {
              key: "name",
              label: "Name",
              render: (r) => (
                <a
                  href={`#traces/${r.id}`}
                  style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}
                >
                  {String(r.name)}
                </a>
              ),
            },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={String(r.status)} /> },
            { key: "start_time", label: "Start Time" },
            {
              key: "duration",
              label: "Duration",
              render: (r) => formatDuration(String(r.start_time), r.end_time as string | null),
            },
            { key: "user_id", label: "User", render: (r) => String(r.user_id ?? "-") },
            { key: "session_id", label: "Session", render: (r) => String(r.session_id ?? "-") },
          ]}
          rows={data.traces as Record<string, unknown>[]}
          emptyMessage="No traces yet."
        />
      )}
    </Layout>
  );
}
