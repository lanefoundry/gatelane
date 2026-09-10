import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "@gatelane/shared";
import { captureEndpoint } from "./capture-endpoint.js";
import { replayApi } from "./replay-api.js";
import { traceApi } from "./trace-api.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => c.json({ name: "gatelane", version: "0.0.0-dev", status: "ok" }));
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/v1", captureEndpoint);
app.route("/v1", replayApi);
app.route("/v1", traceApi);

export default app;
