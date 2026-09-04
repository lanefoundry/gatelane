/**
 * Backtest upgrade — freeze a production traffic slice, replay against
 * a new model, and get a signed promote/rollback decision.
 *
 * Run inside a Cloudflare Worker where `env` bindings are available.
 */
import { backtest } from "@gatelane/mode-blue-team";
import type { Env } from "@gatelane/shared";

export async function runBacktest(env: Env) {
  const report = await backtest(env, {
    window: "7d",
    candidateModel: "gpt-4.1",
    baselineModel: "gpt-4o",
    threshold: 0.02,

    judge: async (prompt, response) => {
      // Replace with your actual judge logic — call an LLM, use a rubric, etc.
      // Return a 0-1 score.
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "Score the response quality 0-1. Reply with only the number.",
            },
            {
              role: "user",
              content: `Prompt: ${JSON.stringify(prompt)}\nResponse: ${JSON.stringify(response)}`,
            },
          ],
        }),
      });
      const data = (await res.json()) as any;
      return parseFloat(data.choices[0].message.content) || 0;
    },

    execute: async (prompt, model) => {
      // Replace with your actual LLM call
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model, messages: prompt }),
      });
      return res.json();
    },
  });

  console.log(`Decision: ${report.decision}`);
  console.log(`Delta: ${report.delta} (threshold: ${report.threshold})`);
  console.log(`Candidate avg score: ${report.summary.candidateAvgScore}`);
  console.log(`Baseline avg score: ${report.summary.baselineAvgScore}`);

  if (report.decision === "promote") {
    console.log(">>> Route 100% traffic to candidate model");
  } else {
    console.log(">>> Keep baseline model, rollback candidate");
  }

  return report;
}
