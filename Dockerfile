# syntax=docker/dockerfile:1.7
# ---- build stage ----
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /repo

# Copy lockfiles + manifests first for layer cache
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/gatelane-sdk/package.json packages/gatelane-sdk/
COPY packages/gatelane-engine/package.json packages/gatelane-engine/
COPY packages/cli/package.json packages/cli/
COPY packages/mode-red-team/package.json packages/mode-red-team/
COPY packages/mode-backtest/package.json packages/mode-backtest/
COPY packages/source-prod-slice/package.json packages/source-prod-slice/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "./packages/**" --filter "./apps/**"

# Now copy sources and build
COPY tsconfig.json tsconfig.build.json ./
COPY packages packages
COPY apps apps

# Build the TS packages, then bundle the worker into a single self-contained
# ESM file so the runtime image needs no node_modules.
RUN pnpm --filter @gatelane/shared build && \
    pnpm --filter @lanefoundry/gatelane-sdk build && \
    pnpm --filter @lanefoundry/gatelane-engine build && \
    pnpm --filter @lanefoundry/gatelane-cli build && \
    pnpm --filter @gatelane/dashboard build && \
    pnpm --filter @gatelane/worker build && \
    pnpm exec esbuild apps/worker/src/worker.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --external:node:* \
      --outfile=apps/worker/dist/worker.bundle.mjs

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="gatelane"
LABEL org.opencontainers.image.description="Pre-production safety + eval gate for AI agents"
LABEL org.opencontainers.image.source="https://github.com/lanefoundry/gatelane"
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tini supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 gatelane \
    && useradd --system --uid 1001 --gid gatelane --home /data --shell /sbin/nologin gatelane

ENV NODE_ENV=production \
    GATELANE_HOME=/data \
    GATELANE_WORKER_PORT=8787 \
    GATELANE_DASHBOARD_PORT=8788 \
    GATELANE_RUNTIME=container \
    PATH="/usr/local/lib/node_modules/@lanefoundry/gatelane-cli/bin:$PATH"

WORKDIR /app

# Worker: esbuild bundle + D1 schema + container runtime shim
COPY --from=build --chown=gatelane:gatelane /repo/apps/worker/dist/worker.bundle.mjs /app/worker/worker.bundle.mjs
COPY --from=build --chown=gatelane:gatelane /repo/packages/shared/schema/d1.sql /app/worker/d1.sql
COPY docker/worker-serve.mjs /app/worker/worker-serve.mjs

# Dashboard: static assets served by `serve`
COPY --from=build --chown=gatelane:gatelane /repo/apps/dashboard/dist /app/dashboard/dist/

# CLI (published surface, for `gatelane` in the container)
COPY --from=build --chown=gatelane:gatelane /repo/packages/cli/dist /usr/local/lib/node_modules/@lanefoundry/gatelane-cli/
COPY --from=build --chown=gatelane:gatelane /repo/packages/cli/package.json /usr/local/lib/node_modules/@lanefoundry/gatelane-cli/

# entrypoint + supervisor
COPY docker/entrypoint.sh /usr/local/bin/gatelane-entrypoint
COPY docker/supervisord.conf /etc/supervisor/conf.d/gatelane.conf
RUN chmod +x /usr/local/bin/gatelane-entrypoint /app/worker/worker-serve.mjs

RUN mkdir -p /data /var/log/supervisor && chown -R gatelane:gatelane /data /app /var/log/supervisor

USER gatelane
WORKDIR /data

EXPOSE 8787 8788

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/gatelane-entrypoint"]