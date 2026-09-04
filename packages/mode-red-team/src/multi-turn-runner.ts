import type { Env } from "@gatelane/shared";
import { writeAuditLog } from "@gatelane/engine";
import type {
  ConversationTurn,
  MultiTurnScenario,
  MultiTurnResult,
  MultiTurnReport,
} from "./multi-turn-types.js";

export interface MultiTurnTarget {
  execute: (
    messages: Array<{ role: string; content: string }>,
  ) => Promise<string>;
}

export interface MultiTurnAttacker {
  nextTurn: (
    history: ConversationTurn[],
    objective: string,
  ) => Promise<string>;
}

export interface MultiTurnJudge {
  isBreached: (
    history: ConversationTurn[],
    criteria: string,
  ) => Promise<boolean>;
}

export async function runMultiTurn(
  env: Env,
  scenario: MultiTurnScenario,
  target: MultiTurnTarget,
  attacker: MultiTurnAttacker,
  judge: MultiTurnJudge,
): Promise<MultiTurnResult> {
  const id = crypto.randomUUID();
  const start = Date.now();
  const turns: ConversationTurn[] = [];
  let succeeded = false;
  let turnWhenBreached: number | null = null;

  // First attacker turn uses the scenario's initial prompt
  let attackerContent = scenario.initialPrompt;

  for (let i = 0; i < scenario.maxTurns; i++) {
    const turnIndex = turns.length;

    // Record attacker turn
    turns.push({
      role: "attacker",
      content: attackerContent,
      turnIndex,
    });

    // Build messages array for the target (attacker = "user", target = "assistant")
    const messages = turns.map((t) => ({
      role: t.role === "attacker" ? "user" : "assistant",
      content: t.content,
    }));

    // Send to target and get response
    let targetResponse: string;
    try {
      targetResponse = await target.execute(messages);
    } catch (err) {
      targetResponse = `[error] ${err instanceof Error ? err.message : String(err)}`;
    }

    // Record target turn
    turns.push({
      role: "target",
      content: targetResponse,
      turnIndex: turns.length,
    });

    // Ask judge if the defense was breached
    const breached = await judge.isBreached(turns, scenario.successCriteria);
    if (breached) {
      succeeded = true;
      turnWhenBreached = i + 1;
      break;
    }

    // If not the last turn, ask the attacker for the next move
    if (i < scenario.maxTurns - 1) {
      attackerContent = await attacker.nextTurn(turns, scenario.objective);
    }
  }

  const duration = Date.now() - start;

  await writeAuditLog(env, {
    action: "multi-turn-attack",
    resourceType: "multi-turn-scenario",
    resourceId: scenario.id,
    actor: "red-team-runner",
    detail: {
      resultId: id,
      strategy: scenario.strategy,
      succeeded,
      turnWhenBreached,
      totalTurns: Math.ceil(turns.length / 2),
      duration,
    },
  });

  return {
    id,
    scenarioId: scenario.id,
    strategy: scenario.strategy,
    turns,
    succeeded,
    turnWhenBreached,
    totalTurns: Math.ceil(turns.length / 2),
    duration,
    analysis: buildAnalysis(scenario, turns, succeeded, turnWhenBreached),
  };
}

export function generateMultiTurnReport(
  scenarios: MultiTurnScenario[],
  results: MultiTurnResult[],
): MultiTurnReport {
  const breachedResults = results.filter((r) => r.succeeded);
  const breachTurns = breachedResults
    .map((r) => r.turnWhenBreached)
    .filter((t): t is number => t !== null);

  const avgTurnsToBreech =
    breachTurns.length > 0
      ? breachTurns.reduce((a, b) => a + b, 0) / breachTurns.length
      : null;

  // Find the strategy with the most breaches
  let mostVulnerableStrategy: MultiTurnResult["strategy"] | null = null;
  if (breachedResults.length > 0) {
    const strategyCounts = new Map<string, number>();
    for (const r of breachedResults) {
      strategyCounts.set(r.strategy, (strategyCounts.get(r.strategy) ?? 0) + 1);
    }
    let maxCount = 0;
    for (const [strategy, count] of strategyCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostVulnerableStrategy = strategy as MultiTurnResult["strategy"];
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    scenarios,
    results,
    summary: {
      totalScenarios: results.length,
      breached: breachedResults.length,
      defended: results.length - breachedResults.length,
      avgTurnsToBreech,
      mostVulnerableStrategy,
    },
    createdAt: new Date().toISOString(),
  };
}

function buildAnalysis(
  scenario: MultiTurnScenario,
  turns: ConversationTurn[],
  succeeded: boolean,
  turnWhenBreached: number | null,
): string {
  const totalExchanges = Math.ceil(turns.length / 2);

  if (succeeded) {
    return (
      `Defense breached at turn ${turnWhenBreached} of ${scenario.maxTurns} ` +
      `using "${scenario.strategy}" strategy. ` +
      `The "${scenario.name}" scenario succeeded in its objective: ${scenario.objective}. ` +
      `Total exchanges: ${totalExchanges}.`
    );
  }

  return (
    `Defense held across all ${totalExchanges} exchanges ` +
    `against "${scenario.strategy}" strategy. ` +
    `The "${scenario.name}" scenario did not achieve its objective: ${scenario.objective}.`
  );
}
