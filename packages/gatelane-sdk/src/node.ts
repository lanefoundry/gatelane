/**
 * Node-only exports — requires `node:fs` and `node:path`.
 *
 * Import from `@lanefoundry/gatelane-sdk/node` or the individual subpaths
 * (`/storage-fs`, `/trace-store-fs`).
 *
 * The main barrel (`@lanefoundry/gatelane-sdk`) deliberately excludes these
 * so it stays safe on edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge).
 */
export * from './storage-fs.js';
export * from './trace-store-fs.js';
