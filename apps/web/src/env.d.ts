declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    CAPTURES: R2Bucket;
    GATELANE_KV: KVNamespace;
    GATELANE_CAPTURE_TOKEN: string;
    GATELANE_JUDGE_PROVIDER: string;
    GATELANE_JUDGE_API_KEY: string;
    GATELANE_JUDGE_MODEL: string;
  }
}
