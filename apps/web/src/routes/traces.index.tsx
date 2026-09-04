import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getEvent } from "vinxi/http";
import type { Env } from "@gatelane/shared";
import { DataTable } from "../components/DataTable";
import { StatusBadge } from "../components/StatusBadge";

function formatDuration(start: string, end: string | null): string {
  if (!end) return "...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const fetchTraces = createServerFn({ method: "GET" }).handler(async () => {
  const event = getEvent();
  const env = (event.context as Record<string, any>).cloudflare.env as Env;
  const result = await env.DB.prepare(
    "SELECT * FROM traces ORDER BY created_at DESC LIMIT 50",
  ).all();
  return { traces: result.results as Array<Record<string, string | number | boolean | null>> };
});

export const Route = createFileRoute("/traces/" as any)({
  loader: () => fetchTraces(),
  component: TracesPage,
});

function TracesPage() {
  const { traces } = Route.useLoaderData();

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Traces</h1>
      <DataTable
        columns={[
          {
            key: "name",
            label: "Name",
            render: (r) => (
              <Link
                to={"/traces/$traceId" as any}
                params={{ traceId: String(r.id) } as any}
                style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}
              >
                {String(r.name)}
              </Link>
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
        rows={traces}
        emptyMessage="No traces yet."
      />
    </>
  );
}
