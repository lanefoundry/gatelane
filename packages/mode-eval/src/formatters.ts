import type { EvalSummary } from "./types.js";

export function formatJSON(summary: EvalSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function formatMarkdown(summary: EvalSummary): string {
  const lines: string[] = [];
  const passRate = summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : "0.0";
  const icon = summary.failed === 0 ? "PASS" : "FAIL";

  lines.push(`# Eval Results — ${icon}`);
  lines.push("");
  lines.push(`**${summary.passed}/${summary.total} passed** (${passRate}%) in ${summary.duration}ms`);
  lines.push("");
  lines.push("| Test Case | Passed | Metrics | Duration |");
  lines.push("|-----------|--------|---------|----------|");

  for (const result of summary.results) {
    const status = result.passed ? "Yes" : "No";
    const metrics = result.metrics
      .map((m) => `${m.metric}: ${m.score.toFixed(2)}`)
      .join(", ");
    lines.push(`| ${result.testCaseId} | ${status} | ${metrics} | ${result.duration}ms |`);
  }

  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatJUnit(summary: EvalSummary): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites tests="${summary.total}" failures="${summary.failed}" time="${(summary.duration / 1000).toFixed(3)}">`,
  );
  lines.push(
    `  <testsuite name="gatelane-eval" tests="${summary.total}" failures="${summary.failed}" time="${(summary.duration / 1000).toFixed(3)}">`,
  );

  for (const result of summary.results) {
    const time = (result.duration / 1000).toFixed(3);
    lines.push(`    <testcase name="${escapeXml(result.testCaseId)}" classname="gatelane-eval" time="${time}">`);

    if (!result.passed) {
      const failedMetrics = result.metrics
        .filter((m) => !m.passed)
        .map((m) => `${m.metric}: ${m.score.toFixed(2)} (threshold: ${m.threshold})`)
        .join("; ");
      lines.push(`      <failure message="${escapeXml(failedMetrics)}">${escapeXml(failedMetrics)}</failure>`);
    }

    lines.push("    </testcase>");
  }

  lines.push("  </testsuite>");
  lines.push("</testsuites>");

  return lines.join("\n");
}
