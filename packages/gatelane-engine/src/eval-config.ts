/**
 * Eval config — the YAML-driven definition behind `gatelane eval`.
 *
 * One file describes a deployed agent endpoint (`target`), how to judge its
 * answers (`judge`), fixed test cases (`tests`), which attack categories to
 * replay (`redteam`) and what a good refusal looks like (`blueteam`).
 *
 * This module only validates an already-parsed object; reading the file,
 * YAML parsing and `${ENV}` expansion happen in the CLI so the engine stays
 * free of Node-only APIs.
 */

import {
  ATTACK_CATEGORIES,
  type AttackCategory,
} from "./http-attacks/index.js";

export const ASSERTION_TYPES = [
  "contains",
  "not-contains",
  "llm-rubric",
  "latency",
  "status",
  "json-path",
] as const;

export type AssertionType = (typeof ASSERTION_TYPES)[number];

export const JUDGE_PROVIDERS = ["mock", "openai", "anthropic"] as const;

export type JudgeProvider = (typeof JUDGE_PROVIDERS)[number];

export interface EvalAssertion {
  /** contains / not-contains are case-sensitive. */
  type: AssertionType;
  /** Substring, rubric text, latency ms, HTTP status, or json path (json-path only). */
  value?: string | number;
  /** json-path: dotted path into the raw JSON response. Falls back to `value`. */
  path?: string;
  /** json-path: the value (or any array element) contains this substring. */
  contains?: string;
  /** json-path: the array contains these items in this relative order. */
  ordered?: string[];
  gte?: number;
  lte?: number;
  equals?: unknown;
}

export interface EvalTestCase {
  input: string;
  name?: string;
  assert?: EvalAssertion[];
}

export interface EvalTarget {
  url: string;
  /** HTTP method. Defaults to POST. */
  method?: string;
  /** JSON body template; every `{{input}}` in a string value is replaced by the test input. */
  request: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Dotted path to the answer text inside the JSON response, e.g. `data.answer`. */
  response_path?: string;
  /** Per-request timeout. Defaults to 60 000 ms. */
  timeout_ms?: number;
}

export interface EvalJudge {
  provider: JudgeProvider;
  model?: string;
  /** Env var holding the API key. Defaults to OPENAI_API_KEY / ANTHROPIC_API_KEY. */
  api_key_env?: string;
}

export interface EvalRedteam {
  /** Attack categories to replay. Omitted or empty → every category. */
  categories?: AttackCategory[];
  custom_vectors?: { payload: string; name?: string }[];
}

export interface EvalBlueteam {
  /** Assertions every blocked attack response must satisfy. */
  on_block?: { assert: EvalAssertion[] };
  /** Strings that must never appear in a blocked response. */
  no_leak?: string[];
  /** Normal queries that must not be blocked (status defaults to 200). */
  false_positive_tests?: EvalTestCase[];
}

export interface EvalConfig {
  target: EvalTarget;
  judge?: EvalJudge;
  tests?: EvalTestCase[];
  redteam?: EvalRedteam;
  blueteam?: EvalBlueteam;
  /** Path to a text file with one extra test input per line (`#` comments). */
  queries_file?: string;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(path: string, msg: string): never {
  throw new Error(`gatelane config: ${path} ${msg}`);
}

function optString(o: Obj, key: string, path: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(`${path}.${key}`, "must be a string");
  return v;
}

function optNumber(o: Obj, key: string, path: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v))
    fail(`${path}.${key}`, "must be a number");
  return v;
}

function parseAssertion(raw: unknown, path: string): EvalAssertion {
  if (!isObj(raw)) fail(path, 'must be an object with a "type"');
  const type = raw["type"];
  if (
    typeof type !== "string" ||
    !(ASSERTION_TYPES as readonly string[]).includes(type)
  ) {
    fail(
      `${path}.type`,
      `must be one of ${ASSERTION_TYPES.join(", ")} (got ${JSON.stringify(type)})`,
    );
  }
  const a: EvalAssertion = { type: type as AssertionType };
  const value = raw["value"];
  if (value !== undefined && value !== null) {
    if (typeof value !== "string" && typeof value !== "number")
      fail(`${path}.value`, "must be a string or number");
    a.value = value;
  }
  const p = optString(raw, "path", path);
  if (p !== undefined) a.path = p;
  const contains = optString(raw, "contains", path);
  if (contains !== undefined) a.contains = contains;
  if (raw["ordered"] !== undefined) {
    if (!Array.isArray(raw["ordered"]))
      fail(`${path}.ordered`, "must be a list");
    a.ordered = (raw["ordered"] as unknown[]).map(String);
  }
  const gte = optNumber(raw, "gte", path);
  if (gte !== undefined) a.gte = gte;
  const lte = optNumber(raw, "lte", path);
  if (lte !== undefined) a.lte = lte;
  if (raw["equals"] !== undefined) a.equals = raw["equals"];

  switch (a.type) {
    case "contains":
    case "not-contains":
    case "llm-rubric":
      if (typeof a.value !== "string" || a.value === "")
        fail(`${path}.value`, `is required for ${a.type}`);
      break;
    case "latency":
    case "status":
      if (typeof a.value !== "number")
        fail(`${path}.value`, `must be a number for ${a.type}`);
      break;
    case "json-path":
      if (a.path === undefined && typeof a.value !== "string")
        fail(path, 'json-path needs "path" (or a string "value")');
      break;
  }
  return a;
}

function parseAssertions(
  raw: unknown,
  path: string,
): EvalAssertion[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) fail(path, "must be a list");
  return raw.map((a, i) => parseAssertion(a, `${path}[${i}]`));
}

function parseTestCase(raw: unknown, path: string): EvalTestCase {
  if (!isObj(raw)) fail(path, 'must be an object with an "input"');
  const input = raw["input"];
  if (typeof input !== "string" || input === "")
    fail(`${path}.input`, "is required");
  const tc: EvalTestCase = { input };
  const name = optString(raw, "name", path);
  if (name !== undefined) tc.name = name;
  const assert = parseAssertions(raw["assert"], `${path}.assert`);
  if (assert !== undefined) tc.assert = assert;
  return tc;
}

function parseStringRecord(raw: unknown, path: string): Record<string, string> {
  if (!isObj(raw)) fail(path, "must be a map of strings");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string" && typeof v !== "number")
      fail(`${path}.${k}`, "must be a string");
    out[k] = String(v);
  }
  return out;
}

export function parseEvalConfig(raw: unknown): EvalConfig {
  if (!isObj(raw))
    throw new Error("gatelane config: the file must contain a YAML mapping");

  const t = raw["target"];
  if (!isObj(t)) fail("target", 'is required (with "url" and "request")');
  const url = t["url"];
  if (typeof url !== "string" || url === "") fail("target.url", "is required");
  try {
    new URL(url);
  } catch {
    fail("target.url", `is not a valid URL: ${url}`);
  }
  if (!isObj(t["request"]))
    fail("target.request", "is required (a JSON body template with {{input}})");
  if (!JSON.stringify(t["request"]).includes("{{input}}")) {
    fail("target.request", "must contain the {{input}} placeholder somewhere");
  }
  const target: EvalTarget = { url, request: t["request"] };
  const method = optString(t, "method", "target");
  if (method !== undefined) target.method = method.toUpperCase();
  if (t["headers"] !== undefined)
    target.headers = parseStringRecord(t["headers"], "target.headers");
  const responsePath = optString(t, "response_path", "target");
  if (responsePath !== undefined) target.response_path = responsePath;
  const timeout = optNumber(t, "timeout_ms", "target");
  if (timeout !== undefined) target.timeout_ms = timeout;

  const config: EvalConfig = { target };

  const j = raw["judge"];
  if (j !== undefined && j !== null) {
    if (!isObj(j)) fail("judge", "must be an object");
    const provider = j["provider"] ?? "mock";
    if (
      typeof provider !== "string" ||
      !(JUDGE_PROVIDERS as readonly string[]).includes(provider)
    ) {
      fail(
        "judge.provider",
        `must be one of ${JUDGE_PROVIDERS.join(", ")} (got ${JSON.stringify(provider)})`,
      );
    }
    const judge: EvalJudge = { provider: provider as JudgeProvider };
    const model = optString(j, "model", "judge");
    if (model !== undefined) judge.model = model;
    const keyEnv = optString(j, "api_key_env", "judge");
    if (keyEnv !== undefined) judge.api_key_env = keyEnv;
    config.judge = judge;
  }

  if (raw["tests"] !== undefined && raw["tests"] !== null) {
    if (!Array.isArray(raw["tests"])) fail("tests", "must be a list");
    config.tests = raw["tests"].map((tc, i) =>
      parseTestCase(tc, `tests[${i}]`),
    );
  }

  const rt = raw["redteam"];
  if (rt !== undefined && rt !== null) {
    if (!isObj(rt)) fail("redteam", "must be an object");
    const redteam: EvalRedteam = {};
    if (rt["categories"] !== undefined) {
      if (!Array.isArray(rt["categories"]))
        fail("redteam.categories", "must be a list");
      redteam.categories = rt["categories"].map((c, i) => {
        if (
          typeof c !== "string" ||
          !(ATTACK_CATEGORIES as readonly string[]).includes(c)
        ) {
          fail(
            `redteam.categories[${i}]`,
            `must be one of ${ATTACK_CATEGORIES.join(", ")} (got ${JSON.stringify(c)})`,
          );
        }
        return c as AttackCategory;
      });
    }
    if (rt["custom_vectors"] !== undefined) {
      if (!Array.isArray(rt["custom_vectors"]))
        fail("redteam.custom_vectors", "must be a list");
      redteam.custom_vectors = rt["custom_vectors"].map((v, i) => {
        const path = `redteam.custom_vectors[${i}]`;
        if (!isObj(v) || typeof v["payload"] !== "string")
          fail(path, 'needs a "payload" string');
        const name = optString(v, "name", path);
        return name !== undefined
          ? { payload: v["payload"], name }
          : { payload: v["payload"] };
      });
    }
    config.redteam = redteam;
  }

  const bt = raw["blueteam"];
  if (bt !== undefined && bt !== null) {
    if (!isObj(bt)) fail("blueteam", "must be an object");
    const blueteam: EvalBlueteam = {};
    const ob = bt["on_block"];
    if (ob !== undefined && ob !== null) {
      if (!isObj(ob))
        fail("blueteam.on_block", 'must be an object with "assert"');
      blueteam.on_block = {
        assert: parseAssertions(ob["assert"], "blueteam.on_block.assert") ?? [],
      };
    }
    if (bt["no_leak"] !== undefined) {
      if (!Array.isArray(bt["no_leak"]))
        fail("blueteam.no_leak", "must be a list");
      blueteam.no_leak = bt["no_leak"].map(String);
    }
    if (
      bt["false_positive_tests"] !== undefined &&
      bt["false_positive_tests"] !== null
    ) {
      if (!Array.isArray(bt["false_positive_tests"]))
        fail("blueteam.false_positive_tests", "must be a list");
      blueteam.false_positive_tests = bt["false_positive_tests"].map((tc, i) =>
        parseTestCase(tc, `blueteam.false_positive_tests[${i}]`),
      );
    }
    config.blueteam = blueteam;
  }

  const queries = optString(raw, "queries_file", "config");
  if (queries !== undefined) config.queries_file = queries;

  if (!config.tests?.length && !config.redteam && !config.queries_file) {
    fail(
      "config",
      'has nothing to run — add "tests", "queries_file" or "redteam"',
    );
  }

  return config;
}
