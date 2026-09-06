#!/usr/bin/env node
/**
 * Container runtime for the gatelane Worker.
 *
 * The Worker is a Cloudflare-bound Hono app (D1 + R2 + KV bindings).
 * In a plain Node container those bindings don't exist, so this shim
 * provides drop-in stand-ins:
 *
 *   - D1  → node:sqlite (DatabaseSync), schema from packages/shared/schema/d1.sql
 *   - R2  → filesystem under ${GATELANE_HOME}/captures
 *   - KV  → filesystem under ${GATELANE_HOME}/kv
 *
 * The Worker bundle is produced by esbuild in the Docker build stage:
 *   esbuild apps/worker/src/worker.ts --bundle --platform=node
 *           --format=esm --external:node:* --outfile=.../worker.bundle.mjs
 *
 * Usage:
 *   node worker-serve.mjs   (listens on $GATELANE_WORKER_PORT, default 8787)
 */
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const PORT = Number(process.env.GATELANE_WORKER_PORT ?? 8787);
const HOME = process.env.GATELANE_HOME ?? "/data";
const CAPTURES_DIR = join(HOME, "captures");
const KV_DIR = join(HOME, "kv");
const DB_PATH = join(HOME, "gatelane.db");
const SCHEMA_PATH = "/app/worker/d1.sql";

// ---------------------------------------------------------------------------
// D1-like adapter over node:sqlite
// ---------------------------------------------------------------------------
class D1Statement {
  constructor(stmt) {
    this.stmt = stmt;
    this.args = [];
  }
  bind(...values) {
    this.args = values;
    return this;
  }
  first(column) {
    const row = this.stmt.get(...this.args);
    if (row === undefined) return null;
    return column ? (row[column] ?? null) : row;
  }
  run() {
    this.stmt.run(...this.args);
    return { success: true, meta: { changes: this.stmt.changes } };
  }
  all() {
    return { results: this.stmt.all(...this.args) };
  }
}

class D1Like {
  constructor(db) {
    this.db = db;
  }
  prepare(sql) {
    return new D1Statement(this.db.prepare(sql));
  }
}

// ---------------------------------------------------------------------------
// R2-like adapter over the filesystem
// ---------------------------------------------------------------------------
class R2Like {
  constructor(dir) {
    this.dir = dir;
  }
  async put(key, value, options) {
    const target = join(this.dir, key);
    await mkdir(dirname(target), { recursive: true });
    const body = value instanceof Uint8Array ? Buffer.from(value) : String(value);
    await writeFile(target, body);
    return { key, httpMetadata: options?.httpMetadata };
  }
  async get(key) {
    const path = join(this.dir, key);
    if (!existsSync(path)) return null;
    return { body: await readFile(path), httpMetadata: {} };
  }
  async delete(key) {
    await rm(join(this.dir, key), { force: true });
  }
}

// ---------------------------------------------------------------------------
// KV-like adapter over the filesystem
// ---------------------------------------------------------------------------
class KVLike {
  constructor(dir) {
    this.dir = dir;
  }
  async put(key, value) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, key), String(value));
  }
  async get(key) {
    const path = join(this.dir, key);
    if (!existsSync(path)) return null;
    return await readFile(path, "utf8");
  }
  async delete(key) {
    await rm(join(this.dir, key), { force: true });
  }
}

// ---------------------------------------------------------------------------
// Boot: init DB, load worker bundle, serve
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(HOME, { recursive: true });

  // Init SQLite from the D1 schema (idempotent — CREATE TABLE IF NOT EXISTS).
  const db = new DatabaseSync(DB_PATH);
  const schema = await readFile(SCHEMA_PATH, "utf8");
  db.exec(schema);

  const env = {
    DB: new D1Like(db),
    CAPTURES: new R2Like(CAPTURES_DIR),
    GATELANE_KV: new KVLike(KV_DIR),
    GATELANE_CAPTURE_TOKEN: process.env.GATELANE_CAPTURE_TOKEN ?? "",
    GATELANE_JUDGE_PROVIDER: process.env.GATELANE_JUDGE_PROVIDER ?? "openai",
    GATELANE_JUDGE_MODEL: process.env.GATELANE_JUDGE_MODEL ?? "gpt-4o",
    GATELANE_RUNTIME: "container",
  };

  // The esbuild bundle exports the Hono app as default.
  const { default: app } = await import("/app/worker/worker.bundle.mjs");

  // Collect the Node request body into a Buffer (undici Request requires
  // a concrete body, not a Node stream).
  async function collectBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  const server = createServer(async (req, res) => {
    // Hono's app.fetch expects a Request; adapt the Node req/res pair.
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const body = hasBody ? await collectBody(req) : undefined;
    const init = { method: req.method, headers };
    if (body) {
      init.body = body;
      init.duplex = "half";
    }

    app.fetch(new Request(url, init), env)
      .then((resp) => {
        res.writeHead(resp.status, Object.fromEntries(resp.headers.entries()));
        if (resp.body) {
          resp.body.pipeTo(new WritableStream({
            write(chunk) { res.write(chunk); },
            close() { res.end(); },
            abort(err) { res.destroy(err); },
          }));
        } else {
          res.end();
        }
      })
      .catch((err) => {
        console.error("[gatelane] worker error:", err);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error", message: String(err) }));
      });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[gatelane] worker listening on :${PORT} (container runtime, D1=sqlite, R2=fs)`);
  });
}

main().catch((err) => {
  console.error("[gatelane] fatal:", err);
  process.exit(1);
});