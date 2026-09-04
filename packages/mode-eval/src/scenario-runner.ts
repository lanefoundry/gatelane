import type { Env } from "@gatelane/shared";
import { writeAuditLog } from "@gatelane/engine";
import type {
  Scenario,
  ScenarioAgent,
  ScenarioResult,
  StepResult,
  EvalConfig,
  MetricResult,
} from "./types.js";
import { assertAll } from "./assertions.js";
import { score } from "./scorer.js";

export async function runScenario(
  env: Env,
  scenario: Scenario,
  agent: ScenarioAgent,
  config: EvalConfig = {},
): Promise<ScenarioResult> {
  const start = Date.now();
  const messages: Array<{ role: string; content: string }> = [];
  const stepResults: StepResult[] = [];
  let allPassed = true;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepStart = Date.now();
    const content = typeof step.content === "string" ? step.content : JSON.stringify(step.content);

    if (step.role === "user") {
      messages.push({ role: "user", content });
      const response = await agent.execute([...messages]);
      messages.push({ role: "assistant", content: response });

      const assertions = step.assertions ?? [];
      const assertionsPassed = assertions.length === 0 || assertAll(response, assertions);

      let scores: MetricResult[] | undefined;
      const metrics = step.metrics ?? config.metrics;
      if (metrics?.length && config.judge) {
        scores = await Promise.all(
          metrics.map((metric) =>
            score(env, {
              metric,
              input: content,
              output: response,
              judge: config.judge!,
              threshold: config.threshold,
            }),
          ),
        );
      }

      const stepPassed = assertionsPassed && (!scores || scores.every((s) => s.passed));
      if (!stepPassed) allPassed = false;

      stepResults.push({
        stepIndex: i,
        role: step.role,
        input: content,
        output: response,
        assertionsPassed,
        scores,
        duration: Date.now() - stepStart,
      });
    } else {
      messages.push({ role: step.role, content });

      stepResults.push({
        stepIndex: i,
        role: step.role,
        input: content,
        output: null,
        assertionsPassed: true,
        duration: Date.now() - stepStart,
      });
    }
  }

  // Run scenario-level assertions on the last agent response
  if (scenario.assertions?.length) {
    const lastAgentOutput = [...stepResults].reverse().find((s) => s.output !== null);
    if (lastAgentOutput?.output) {
      const finalPassed = assertAll(lastAgentOutput.output, scenario.assertions);
      if (!finalPassed) allPassed = false;
    } else {
      allPassed = false;
    }
  }

  const result: ScenarioResult = {
    id: crypto.randomUUID(),
    scenarioId: scenario.id,
    steps: stepResults,
    passed: allPassed,
    duration: Date.now() - start,
    createdAt: new Date().toISOString(),
  };

  await writeAuditLog(env, {
    action: "eval",
    resourceType: "scenario_run",
    resourceId: result.id,
    actor: "system",
    detail: {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      totalSteps: stepResults.length,
      passed: result.passed,
    },
  });

  return result;
}
