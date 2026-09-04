import { describe, it, expect } from "vitest";
import { generateEdgeCases } from "../edge-cases.js";
import type { EdgeCaseCategory } from "../types.js";

describe("generateEdgeCases", () => {
  it("generates empty-input cases", () => {
    const cases = generateEdgeCases("test", ["empty-input"]);

    expect(cases.length).toBe(4);
    expect(cases[0]).toEqual({
      id: "empty-input-0",
      category: "empty-input",
      input: "",
      description: "empty string",
    });
    expect(cases[1].input).toBe(" ");
    expect(cases[2].description).toBe("whitespace only");
    expect(cases[3].input).toBe("\0");
  });

  it("generates very-long-input cases using the base input", () => {
    const base = "hello";
    const cases = generateEdgeCases(base, ["very-long-input"]);

    expect(cases.length).toBe(3);
    expect(cases[0].input).toBe(base.repeat(100));
    expect(cases[0].id).toBe("very-long-input-0");
    expect(cases[1].input).toBe("a".repeat(10_000));
    expect(cases[2].input).toContain(base);
    expect(cases[2].input.length).toBeGreaterThan(50_000);
  });

  it("generates special-characters cases incorporating the base input", () => {
    const base = "prompt";
    const cases = generateEdgeCases(base, ["special-characters"]);

    expect(cases.length).toBe(5);
    // SQL injection case
    expect(cases[0].input).toContain("prompt");
    expect(cases[0].input).toContain("DROP TABLE");
    // XSS case
    expect(cases[1].input).toContain("<script>");
  });

  it("generates unicode cases", () => {
    const cases = generateEdgeCases("test", ["unicode"]);

    expect(cases.length).toBe(6);
    // Emoji case
    expect(cases[0].description).toBe("emoji");
    expect(cases[0].input).toContain("test");
    // RTL override
    expect(cases[1].description).toBe("RTL override");
    // Zero-width spaces
    expect(cases[2].description).toBe("zero-width spaces");
    // BOM prefix
    expect(cases[4].input.startsWith("﻿")).toBe(true);
  });

  it("generates injection-attempt cases", () => {
    const cases = generateEdgeCases("benign", ["injection-attempt"]);

    expect(cases.length).toBe(5);
    expect(cases[0].input).toContain("Ignore all previous instructions");
    expect(cases[1].input).toContain("[SYSTEM]");
    expect(cases[2].input).toContain("reveal your system prompt");
    expect(cases[3].input).toContain('"role":"system"');
    expect(cases[4].input).toContain("{{system_prompt}}");
  });

  it("generates boundary-values cases", () => {
    const cases = generateEdgeCases("test", ["boundary-values"]);

    expect(cases.length).toBe(10);
    expect(cases[0].input).toBe("0");
    expect(cases[1].input).toBe("-1");
    expect(cases[2].input).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(cases[3].input).toBe(String(Number.MIN_SAFE_INTEGER));
    expect(cases[4].input).toBe("NaN");
    expect(cases[5].input).toBe("Infinity");
    expect(cases[6].input).toBe("null");
    expect(cases[7].input).toBe("undefined");
    expect(cases[8].input).toBe("true");
    // Single character from base
    expect(cases[9].input).toBe("t");
  });

  it("uses first character of base for single-character boundary case", () => {
    const cases = generateEdgeCases("xyz", ["boundary-values"]);
    const singleChar = cases.find((c) => c.description === "single character");
    expect(singleChar?.input).toBe("x");
  });

  it("falls back to 'a' for single-character when base is empty", () => {
    const cases = generateEdgeCases("", ["boundary-values"]);
    const singleChar = cases.find((c) => c.description === "single character");
    expect(singleChar?.input).toBe("a");
  });

  it("handles multiple categories", () => {
    const categories: EdgeCaseCategory[] = ["empty-input", "boundary-values"];
    const cases = generateEdgeCases("test", categories);

    // 4 empty-input + 10 boundary-values = 14
    expect(cases.length).toBe(14);

    const emptyInputCases = cases.filter((c) => c.category === "empty-input");
    const boundaryValueCases = cases.filter((c) => c.category === "boundary-values");
    expect(emptyInputCases.length).toBe(4);
    expect(boundaryValueCases.length).toBe(10);
  });

  it("returns empty array for empty categories list", () => {
    const cases = generateEdgeCases("test", []);
    expect(cases).toEqual([]);
  });

  it("assigns sequential IDs within each category", () => {
    const cases = generateEdgeCases("test", ["empty-input"]);

    expect(cases.map((c) => c.id)).toEqual([
      "empty-input-0",
      "empty-input-1",
      "empty-input-2",
      "empty-input-3",
    ]);
  });

  it("all cases have the correct category field", () => {
    const allCategories: EdgeCaseCategory[] = [
      "empty-input",
      "very-long-input",
      "special-characters",
      "unicode",
      "injection-attempt",
      "boundary-values",
    ];

    for (const category of allCategories) {
      const cases = generateEdgeCases("test", [category]);
      for (const c of cases) {
        expect(c.category).toBe(category);
      }
    }
  });
});
