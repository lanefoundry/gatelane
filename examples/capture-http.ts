/**
 * HTTP capture example — send captures to gatelane from any runtime.
 *
 * No SDK dependency needed. Works from Node.js, Deno, Bun, or browsers.
 */

const GATELANE_URL = "http://localhost:8787";
const GATELANE_TOKEN = process.env.GATELANE_CAPTURE_TOKEN!;

async function captureCall(
  prompt: Array<{ role: string; content: string }>,
  model: string,
  response: unknown,
  metadata?: Record<string, unknown>,
) {
  const res = await fetch(`${GATELANE_URL}/v1/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GATELANE_TOKEN}`,
    },
    body: JSON.stringify({ prompt, model, response, metadata }),
  });

  if (!res.ok) throw new Error(`Capture failed: ${res.status}`);
  return res.json() as Promise<{ id: string; traceId: string }>;
}

// --- Usage ---

async function main() {
  // 1. Make your LLM call as usual
  const llmResponse = { choices: [{ message: { content: "Hello!" } }] };

  // 2. Send it to gatelane
  const captured = await captureCall(
    [{ role: "user", content: "Hi there" }],
    "gpt-4o",
    llmResponse,
    { agentVersion: "1.0.0", userId: "user-123" },
  );

  console.log(`Captured: ${captured.id}`);
}

main().catch(console.error);
