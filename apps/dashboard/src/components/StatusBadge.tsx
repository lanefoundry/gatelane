const COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: "#dcfce7", text: "#166534" },
  running: { bg: "#dbeafe", text: "#1e40af" },
  pending: { bg: "#fef9c3", text: "#854d0e" },
  failed: { bg: "#fee2e2", text: "#991b1b" },
  promote: { bg: "#dcfce7", text: "#166534" },
  rollback: { bg: "#fee2e2", text: "#991b1b" },
};

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? { bg: "#f3f4f6", text: "#374151" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 9999,
      fontSize: 12,
      fontWeight: 600,
      background: color.bg,
      color: color.text,
    }}>
      {status}
    </span>
  );
}
