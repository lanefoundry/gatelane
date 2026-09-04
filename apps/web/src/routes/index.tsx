import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DataTable } from "../components/DataTable";

const fetchCaptures = createServerFn({ method: "GET" }).handler(async () => {
  const result = await env.DB.prepare(
    "SELECT * FROM audit_log WHERE action = 'capture' ORDER BY created_at DESC LIMIT 100",
  ).all();
  return { captures: result.results as Array<Record<string, string | number | boolean | null>> };
});

export const Route = createFileRoute("/" as any)({
  loader: () => fetchCaptures(),
  component: CapturesPage,
});

function CapturesPage() {
  const { captures } = Route.useLoaderData();

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Captures</h1>
      <DataTable
        columns={[
          { key: "resource_id", label: "Capture ID" },
          { key: "detail", label: "Detail", render: (r) => JSON.stringify(r.detail) },
          { key: "created_at", label: "Time" },
        ]}
        rows={captures}
        emptyMessage="No captures yet. Send a POST to /v1/capture to get started."
      />
    </>
  );
}
