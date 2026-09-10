import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapturesPage } from "./pages/Captures";
import { TracesPage } from "./pages/Traces";
import { ComparePage } from "./pages/Compare";
import { DatasetsPage } from "./pages/Datasets";
import { ReplayRunsPage } from "./pages/ReplayRuns";
import { PromotionsPage } from "./pages/Promotions";
import { RedTeamPage } from "./pages/RedTeam";
import { AuditLogPage } from "./pages/AuditLog";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function Router() {
  const [hash, setHash] = useState(window.location.hash || "#captures");

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || "#captures");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  switch (hash) {
    case "#captures": return <CapturesPage />;
    case "#traces": return <TracesPage />;
    case "#compare": return <ComparePage />;
    case "#datasets": return <DatasetsPage />;
    case "#replay-runs": return <ReplayRunsPage />;
    case "#promotions": return <PromotionsPage />;
    case "#red-team": return <RedTeamPage />;
    case "#audit-log": return <AuditLogPage />;
    default: return <CapturesPage />;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  );
}
