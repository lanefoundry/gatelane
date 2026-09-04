/**
 * Tracing SDK example — auto-instrument your agent pipeline with traces,
 * spans, and generations. Viewable in the gatelane dashboard.
 */
import { traced, withTracing, withSpan, withGeneration } from "@gatelane/engine";
import type { Env } from "@gatelane/shared";

// --- Option 1: Builder API (recommended for pipelines) ---

export async function agentPipeline(env: Env, userInput: string) {
  const { trace, results } = await traced(env, "agent-pipeline")
    .span("parse-input", async () => {
      return { intent: "question", entities: ["gatelane"] };
    })
    .span("retrieve-context", async () => {
      return { documents: ["doc1", "doc2"] };
    })
    .span("generate-response", async (ctx) => {
      const generate = withGeneration(
        env,
        {
          traceId: ctx.traceId,
          name: "llm-call",
          model: "gpt-4o",
          parentSpanId: ctx.spanId,
        },
        async (messages) => {
          // Replace with your actual LLM call
          return { content: "Here is your answer..." };
        },
      );
      const { completion } = await generate([
        { role: "user", content: userInput },
      ]);
      return completion;
    })
    .run(userInput);

  console.log(`Trace ${trace.id}: ${results.length} steps completed`);
  return results[results.length - 1];
}

// --- Option 2: Decorator API (wrap existing functions) ---

export function setupTracedAgent(env: Env) {
  const processMessage = withTracing(env, "process-message", async (input: string) => {
    // Your existing logic — now auto-traced
    return { reply: `Processed: ${input}` };
  });

  return { processMessage };
}
