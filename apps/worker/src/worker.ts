import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "@gatelane/shared";
import { captureEndpoint } from "./capture-endpoint.js";
import { replayApi } from "./replay-api.js";
import { canaryApi } from "./canary-api.js";
import { scheduled } from "./scheduled.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => c.json({ name: "gatelane", version: "0.0.0-dev", status: "ok" }));
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/v1", captureEndpoint);
app.route("/v1", replayApi);
app.route("/v1", canaryApi);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await scheduled(env);
  },
};
