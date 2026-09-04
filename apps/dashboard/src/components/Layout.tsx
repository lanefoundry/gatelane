import type { ReactNode } from "react";

const NAV_ITEMS = [
  { label: "Captures", href: "#captures" },
  { label: "Traces", href: "#traces" },
  { label: "Datasets", href: "#datasets" },
  { label: "Replay Runs", href: "#replay-runs" },
  { label: "Promotions", href: "#promotions" },
  { label: "Red Team", href: "#red-team" },
  { label: "Audit Log", href: "#audit-log" },
];

export function Layout({ children, current }: { children: ReactNode; current: string }) {
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
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            style={{
              display: "block",
              padding: "10px 20px",
              color: current === item.href ? "#60a5fa" : "#9ca3af",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: current === item.href ? 600 : 400,
              background: current === item.href ? "#1f2937" : "transparent",
            }}
          >
            {item.label}
          </a>
        ))}
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
