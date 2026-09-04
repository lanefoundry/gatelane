import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getEvent } from "vinxi/http";
import type { Env } from "@gatelane/shared";
import { DataTable } from "../components/DataTable";

const fetchAuditLog = createServerFn({ method: "GET" }).handler(async () => {
  const event = getEvent();
  const env = (event.context as Record<string, any>).cloudflare.env as Env;
  const result = await env.DB.prepare(
    "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100",
  ).all();
  return { entries: result.results as Array<Record<string, string | number | boolean | null>> };
});

export const Route = createFileRoute("/audit-log" as any)({
  loader: () => fetchAuditLog(),
  component: AuditLogPage,
});

function AuditLogPage() {
  const { entries } = Route.useLoaderData();

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Audit Log</h1>
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
        rows={entries}
        emptyMessage="No audit log entries yet."
      />
    </>
  );
}
