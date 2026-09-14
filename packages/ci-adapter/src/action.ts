#!/usr/bin/env node
/**
 * gatelane CI/CD action — reads a gate report, sets GitHub Actions outputs,
 * writes a step summary, and exits with the appropriate code.
 *
 * Usage in GitHub Actions:
 *   - run: node packages/ci-adapter/dist/action.js
 *     env:
 *       GATELANE_REPORT_PATH: report.json
 *
 * Or pipe from stdin:
 *   cat report.json | node packages/ci-adapter/dist/action.js
 */
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseGateOutput,
  toGitHubOutput,
  exitCodeForDecision,
  formatGitHubSummary,
} from './index.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function main(): Promise<number> {
  let jsonString: string;

  const reportPath = process.env.GATELANE_REPORT_PATH;
  if (reportPath) {
    jsonString = await readFile(resolve(reportPath), 'utf-8');
  } else if (!process.stdin.isTTY) {
    jsonString = await readStdin();
  } else {
    process.stderr.write(
      'error: set GATELANE_REPORT_PATH or pipe report JSON to stdin\n',
    );
    return 2;
  }

  const parsed = parseGateOutput(jsonString);
  const outputs = toGitHubOutput(parsed);

  // Set GitHub Actions outputs via $GITHUB_OUTPUT file
  const githubOutputFile = process.env.GITHUB_OUTPUT;
  if (githubOutputFile) {
    const lines = Object.entries(outputs)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
    await appendFile(githubOutputFile, lines);
  }

  // Write step summary via $GITHUB_STEP_SUMMARY file
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    await appendFile(summaryFile, formatGitHubSummary(parsed) + '\n');
  }

  // Always print to stderr for local visibility
  process.stderr.write(`\n  gatelane gate: ${parsed.decision.toUpperCase()}\n`);
  if (parsed.winner) process.stderr.write(`  winner:        ${parsed.winner}\n`);
  process.stderr.write(`  reason:        ${parsed.reason}\n`);
  process.stderr.write(`  report:        ${parsed.report_id}\n\n`);

  // Print outputs as JSON to stdout
  process.stdout.write(JSON.stringify(outputs, null, 2) + '\n');

  return exitCodeForDecision(parsed.decision);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
