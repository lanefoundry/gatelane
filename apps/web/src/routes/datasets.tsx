import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getEvent } from "vinxi/http";
import type { Env } from "@gatelane/shared";
import { DataTable } from "../components/DataTable";

const fetchDatasets = createServerFn({ method: "GET" }).handler(async () => {
  const event = getEvent();
  const env = (event.context as Record<string, any>).cloudflare.env as Env;
  const result = await env.DB.prepare(
    "SELECT * FROM datasets ORDER BY created_at DESC LIMIT 50",
  ).all();
  return { datasets: result.results as Array<Record<string, string | number | boolean | null>> };
});

export const Route = createFileRoute("/datasets" as any)({
  loader: () => fetchDatasets(),
  component: DatasetsPage,
});

function DatasetsPage() {
  const { datasets } = Route.useLoaderData();

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Datasets</h1>
      <DataTable
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "item_count", label: "Items" },
          { key: "window_start", label: "Window Start" },
          { key: "window_end", label: "Window End" },
          { key: "frozen_at", label: "Frozen At" },
        ]}
        rows={datasets}
        emptyMessage="No datasets yet. Freeze a production slice to create one."
      />
    </>
  );
}
