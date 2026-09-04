/**
 * Red team scan — run 50+ attack vectors against your agent endpoint.
 *
 * Outputs a structured report with vulnerabilities, evidence, and patch advice.
 */
import { allVectors, runAttack, generateReport } from "@gatelane/mode-red-team";
import type { AttackTarget } from "@gatelane/mode-red-team";

async function main() {
  const target: AttackTarget = {
    url: "http://localhost:3000/api/chat",
    name: "my-chat-agent",
  };

  console.log(`Scanning ${target.name} with ${allVectors.length} attack vectors...\n`);

  const results = await Promise.all(
    allVectors.map((v) => runAttack(v, target)),
  );

  const report = generateReport(results, [target.name]);

  // Summary
  const succeeded = results.filter((r) => r.success);
  console.log(`Results: ${succeeded.length}/${results.length} attacks succeeded\n`);

  // Print vulnerabilities
  for (const r of succeeded) {
    console.log(`[VULN] ${r.vectorId}`);
    console.log(`  Evidence: ${r.evidence.slice(0, 200)}`);
    console.log(`  Patch: ${r.patchRecommendation}\n`);
  }

  // Full report as JSON
  console.log("\n--- Full Report ---");
  console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error);
