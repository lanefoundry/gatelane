/**
 * Basic capture example — instrument a single LLM call with gatelane.
 *
 * Run inside a Cloudflare Worker where `env` bindings are available,
 * or use the HTTP API from any runtime (see capture-http.ts).
 */
import { capture } from "@gatelane/engine";
import type { Env } from "@gatelane/shared";

export async function handleUserMessage(env: Env, userInput: string) {
  const { response, record } = await capture(
    env,
    {
      prompt: [{ role: "user", content: userInput }],
      model: "gpt-4o",
      metadata: { agentVersion: "1.0.0", feature: "chat" },
    },
    async () => {
      // Replace with your actual LLM call
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: userInput }],
        }),
      });
      return res.json();
    },
  );

  console.log(`Captured: ${record.id} (${record.latencyMs}ms)`);
  return response;
}
