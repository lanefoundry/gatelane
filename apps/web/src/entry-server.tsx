import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { Env } from "@gatelane/shared";
import { api } from "./server/api";

const ssrHandler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (
      url.pathname.startsWith("/v1/") ||
      url.pathname === "/health" ||
      (url.pathname === "/" && request.headers.get("accept")?.includes("application/json"))
    ) {
      return api.fetch(request, env, ctx);
    }

    return ssrHandler(request);
  },
};
