import { useQuery } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import { DataTable } from "../components/DataTable";
import { getDatasets } from "../lib/api";

export function DatasetsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["datasets"],
    queryFn: getDatasets,
  });

  return (
    <Layout current="#datasets">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Datasets</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p style={{ color: "#dc2626" }}>Error: {String(error)}</p>}
      {data && (
        <DataTable
          columns={[
            { key: "id", label: "ID" },
            { key: "name", label: "Name" },
            { key: "item_count", label: "Items" },
            { key: "window_start", label: "Window Start" },
            { key: "window_end", label: "Window End" },
            { key: "frozen_at", label: "Frozen At" },
          ]}
          rows={data.datasets as Record<string, unknown>[]}
          emptyMessage="No datasets yet. Freeze a production slice to create one."
        />
      )}
    </Layout>
  );
}
