import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";

const NAV_ITEMS = [
  { label: "Captures", to: "/" },
  { label: "Traces", to: "/traces" },
  { label: "Datasets", to: "/datasets" },
  { label: "Replay Runs", to: "/replay-runs" },
  { label: "Promotions", to: "/promotions" },
  { label: "Red Team", to: "/red-team" },
  { label: "Audit Log", to: "/audit-log" },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{
        width: 220,
        background: "#111827",
        color: "#f9fafb",
        padding: "24px 0",
        flexShrink: 0,
      }}>
        <div style={{ padding: "0 20px 24px", fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>
          gatelane
        </div>
        {NAV_ITEMS.map((item) => {
          const isActive = item.to === "/"
            ? currentPath === "/"
            : currentPath.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to as any}
              style={{
                display: "block",
                padding: "10px 20px",
                color: isActive ? "#60a5fa" : "#9ca3af",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                background: isActive ? "#1f2937" : "transparent",
              }}
            >
              {item.label}
            </Link>
          );
        })}
        <div style={{ padding: "24px 20px 0", fontSize: 11, color: "#6b7280" }}>
          v0.0.0-dev
        </div>
      </nav>
      <main style={{ flex: 1, padding: 32, background: "#f9fafb" }}>
        {children}
      </main>
    </div>
  );
}
