import type { AttackResult, AttackReport } from "./types.js";

export function generateReport(
  results: AttackResult[],
  targets: string[],
): AttackReport {
  return {
    id: crypto.randomUUID(),
    targets,
    totalAttacks: results.length,
    successfulAttacks: results.filter((r) => r.success).length,
    results,
    createdAt: new Date().toISOString(),
  };
}
