import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DataTable } from "../DataTable";
import { StatusBadge } from "../StatusBadge";

afterEach(() => {
  cleanup();
});

describe("DataTable", () => {
  const columns = [
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
  ];

  it("renders empty message when rows is empty", () => {
    render(<DataTable columns={columns} rows={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeDefined();
  });

  it("renders default empty message when none provided", () => {
    render(<DataTable columns={columns} rows={[]} />);
    expect(screen.getByText("No data")).toBeDefined();
  });

  it("renders correct number of rows", () => {
    const rows = [
      { name: "Alice", status: "active" },
      { name: "Bob", status: "inactive" },
      { name: "Charlie", status: "active" },
    ];
    render(<DataTable columns={columns} rows={rows} />);

    const tableRows = screen.getAllByRole("row");
    // 1 header row + 3 data rows
    expect(tableRows).toHaveLength(4);
  });

  it("renders column headers", () => {
    const rows = [{ name: "Alice", status: "active" }];
    render(<DataTable columns={columns} rows={rows} />);

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeDefined();
  });

  it("uses custom render function when provided", () => {
    const columnsWithRender = [
      {
        key: "name",
        label: "Name",
        render: (row: { name: string }) => <strong>{row.name.toUpperCase()}</strong>,
      },
      { key: "status", label: "Status" },
    ];
    const rows = [{ name: "Alice", status: "active" }];

    render(<DataTable columns={columnsWithRender} rows={rows} />);

    const strong = screen.getByText("ALICE");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders cell values as strings from row data", () => {
    const rows = [{ name: "Alice", status: "active" }];
    render(<DataTable columns={columns} rows={rows} />);

    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("active")).toBeDefined();
  });
});

describe("StatusBadge", () => {
  it("renders the status text", () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText("completed")).toBeDefined();
  });

  it("applies correct colors for completed status", () => {
    render(<StatusBadge status="completed" />);
    const badge = screen.getByText("completed");
    expect(badge.style.background).toBe("rgb(220, 252, 231)");
    expect(badge.style.color).toBe("rgb(22, 101, 52)");
  });

  it("applies correct colors for failed status", () => {
    render(<StatusBadge status="failed" />);
    const badge = screen.getByText("failed");
    expect(badge.style.background).toBe("rgb(254, 226, 226)");
    expect(badge.style.color).toBe("rgb(153, 27, 27)");
  });

  it("applies correct colors for running status", () => {
    render(<StatusBadge status="running" />);
    const badge = screen.getByText("running");
    expect(badge.style.background).toBe("rgb(219, 234, 254)");
    expect(badge.style.color).toBe("rgb(30, 64, 175)");
  });

  it("falls back to default colors for unknown status", () => {
    render(<StatusBadge status="something-unknown" />);
    const badge = screen.getByText("something-unknown");
    expect(badge.style.background).toBe("rgb(243, 244, 246)");
    expect(badge.style.color).toBe("rgb(55, 65, 81)");
  });

  it("renders as an inline-block span with pill shape", () => {
    render(<StatusBadge status="pending" />);
    const badge = screen.getByText("pending");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.style.borderRadius).toBe("9999px");
    expect(badge.style.display).toBe("inline-block");
  });
});
