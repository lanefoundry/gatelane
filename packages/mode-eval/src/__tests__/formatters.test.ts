import { describe, it, expect } from "vitest";
import { formatJSON, formatMarkdown, formatJUnit } from "../formatters.js";
import type { EvalSummary, EvalResult, MetricResult } from "../types.js";

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    metric: "correctness",
    score: 0.85,
    passed: true,
    threshold: 0.7,
    ...overrides,
  };
}

function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "result-1",
    testCaseId: "test-case-1",
    metrics: [makeMetric()],
    passed: true,
    duration: 150,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSummary(overrides: Partial<EvalSummary> = {}): EvalSummary {
  return {
    total: 2,
    passed: 2,
    failed: 0,
    results: [
      makeResult({ id: "r1", testCaseId: "tc-1" }),
      makeResult({ id: "r2", testCaseId: "tc-2" }),
    ],
    duration: 500,
    ...overrides,
  };
}

describe("formatJSON", () => {
  it("returns valid JSON with 2-space indentation", () => {
    const summary = makeSummary();
    const output = formatJSON(summary);
    const parsed = JSON.parse(output);

    expect(parsed.total).toBe(2);
    expect(parsed.passed).toBe(2);
    expect(parsed.failed).toBe(0);
    expect(parsed.duration).toBe(500);
    expect(parsed.results).toHaveLength(2);
  });

  it("preserves all result fields", () => {
    const summary = makeSummary({
      total: 1,
      passed: 0,
      failed: 1,
      results: [makeResult({ passed: false, testCaseId: "failing-test" })],
    });
    const parsed = JSON.parse(formatJSON(summary));

    expect(parsed.results[0].testCaseId).toBe("failing-test");
    expect(parsed.results[0].passed).toBe(false);
    expect(parsed.results[0].metrics[0].score).toBe(0.85);
  });

  it("uses 2-space indentation", () => {
    const output = formatJSON(makeSummary());
    // Second line should start with 2 spaces (not tabs, not 4 spaces)
    const lines = output.split("\n");
    expect(lines[1]).toMatch(/^ {2}"/);
  });
});

describe("formatMarkdown", () => {
  it("shows PASS icon when all tests pass", () => {
    const md = formatMarkdown(makeSummary({ failed: 0 }));
    expect(md).toContain("PASS");
    expect(md).not.toContain("FAIL");
  });

  it("shows FAIL icon when any test fails", () => {
    const md = formatMarkdown(
      makeSummary({
        failed: 1,
        passed: 1,
        results: [
          makeResult({ testCaseId: "tc-pass", passed: true }),
          makeResult({ testCaseId: "tc-fail", passed: false }),
        ],
      }),
    );
    expect(md).toContain("FAIL");
  });

  it("includes pass rate percentage", () => {
    const md = formatMarkdown(makeSummary({ total: 4, passed: 3, failed: 1 }));
    expect(md).toContain("75.0%");
  });

  it("includes duration in milliseconds", () => {
    const md = formatMarkdown(makeSummary({ duration: 1234 }));
    expect(md).toContain("1234ms");
  });

  it("renders a table row for each result", () => {
    const summary = makeSummary();
    const md = formatMarkdown(summary);

    expect(md).toContain("| tc-1 |");
    expect(md).toContain("| tc-2 |");
  });

  it("formats metric scores to 2 decimal places in table", () => {
    const summary = makeSummary({
      total: 1,
      passed: 1,
      failed: 0,
      results: [
        makeResult({
          metrics: [
            makeMetric({ metric: "correctness", score: 0.8567 }),
            makeMetric({ metric: "safety", score: 0.9 }),
          ],
        }),
      ],
    });
    const md = formatMarkdown(summary);
    expect(md).toContain("correctness: 0.86");
    expect(md).toContain("safety: 0.90");
  });

  it("shows Yes/No for passed status", () => {
    const summary = makeSummary({
      total: 2,
      passed: 1,
      failed: 1,
      results: [
        makeResult({ testCaseId: "pass-case", passed: true }),
        makeResult({ testCaseId: "fail-case", passed: false }),
      ],
    });
    const md = formatMarkdown(summary);
    const lines = md.split("\n");

    const passLine = lines.find((l) => l.includes("pass-case"));
    const failLine = lines.find((l) => l.includes("fail-case"));
    expect(passLine).toContain("Yes");
    expect(failLine).toContain("No");
  });

  it("handles zero total gracefully (0.0%)", () => {
    const md = formatMarkdown(makeSummary({ total: 0, passed: 0, failed: 0, results: [] }));
    expect(md).toContain("0.0%");
  });

  it("includes markdown table header", () => {
    const md = formatMarkdown(makeSummary());
    expect(md).toContain("| Test Case | Passed | Metrics | Duration |");
    expect(md).toContain("|-----------|--------|---------|----------|");
  });
});

describe("formatJUnit", () => {
  it("generates valid XML with declaration", () => {
    const xml = formatJUnit(makeSummary());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("includes testsuites root with correct test count", () => {
    const xml = formatJUnit(makeSummary({ total: 3, failed: 1, duration: 2000 }));
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('time="2.000"');
  });

  it("includes testsuite element named gatelane-eval", () => {
    const xml = formatJUnit(makeSummary());
    expect(xml).toContain('name="gatelane-eval"');
  });

  it("creates testcase elements for each result", () => {
    const xml = formatJUnit(makeSummary());
    expect(xml).toContain('name="tc-1"');
    expect(xml).toContain('name="tc-2"');
  });

  it("adds failure element for failed test cases", () => {
    const failedMetric = makeMetric({
      metric: "correctness",
      score: 0.3,
      passed: false,
      threshold: 0.7,
    });
    const summary = makeSummary({
      total: 1,
      passed: 0,
      failed: 1,
      results: [makeResult({ passed: false, metrics: [failedMetric] })],
    });
    const xml = formatJUnit(summary);

    expect(xml).toContain("<failure");
    expect(xml).toContain("correctness: 0.30 (threshold: 0.7)");
  });

  it("does not add failure element for passing test cases", () => {
    const summary = makeSummary({ total: 1, passed: 1, failed: 0, results: [makeResult()] });
    const xml = formatJUnit(summary);
    expect(xml).not.toContain("<failure");
  });

  it("escapes XML special characters in test case IDs", () => {
    const summary = makeSummary({
      total: 1,
      passed: 1,
      failed: 0,
      results: [makeResult({ testCaseId: 'test <"inject">' })],
    });
    const xml = formatJUnit(summary);
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&gt;");
    expect(xml).toContain("&quot;");
    expect(xml).not.toContain('name="test <"inject">"');
  });

  it("escapes ampersands in failure messages", () => {
    const summary = makeSummary({
      total: 1,
      passed: 0,
      failed: 1,
      results: [
        makeResult({
          passed: false,
          metrics: [
            makeMetric({ metric: "test & verify", score: 0.1, passed: false }),
          ],
        }),
      ],
    });
    const xml = formatJUnit(summary);
    expect(xml).toContain("&amp;");
  });

  it("converts duration from ms to seconds", () => {
    const summary = makeSummary({
      total: 1,
      passed: 1,
      failed: 0,
      results: [makeResult({ duration: 1500 })],
      duration: 1500,
    });
    const xml = formatJUnit(summary);
    expect(xml).toContain('time="1.500"');
  });

  it("only includes failed metrics in the failure message", () => {
    const summary = makeSummary({
      total: 1,
      passed: 0,
      failed: 1,
      results: [
        makeResult({
          passed: false,
          metrics: [
            makeMetric({ metric: "correctness", score: 0.9, passed: true }),
            makeMetric({ metric: "safety", score: 0.2, passed: false, threshold: 0.7 }),
          ],
        }),
      ],
    });
    const xml = formatJUnit(summary);

    // The failure message should only contain the failed metric
    expect(xml).toContain("safety: 0.20");
    // The passing metric should not appear in the failure message
    // (though the testcase still exists)
    const failureMatch = xml.match(/<failure[^>]*>(.*?)<\/failure>/s);
    expect(failureMatch).toBeTruthy();
    expect(failureMatch![1]).not.toContain("correctness");
  });
});
