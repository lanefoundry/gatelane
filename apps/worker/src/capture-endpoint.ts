import { Hono } from "hono";
import type { Env } from "@gatelane/shared";
import { capture, type CaptureInput } from "@gatelane/engine";
import { writeAuditLog } from "@gatelane/engine";

export const captureEndpoint = new Hono<{ Bindings: Env }>();

captureEndpoint.post("/capture", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.GATELANE_CAPTURE_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json<CaptureInput & { response: unknown }>();

  const { record } = await capture(c.env, body, async () => body.response);

  await writeAuditLog(c.env, {
    action: "capture",
    resourceType: "capture",
    resourceId: record.id,
    actor: "api",
    detail: { model: record.model, provider: record.provider },
  });

  return c.json({ id: record.id, traceId: record.traceId }, 201);
});
