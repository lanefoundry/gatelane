import type { Env } from "@gatelane/shared";
import type { JudgeFn, GoldenComparisonResult } from "./types.js";

const GOLDEN_SYSTEM = [
  "You are an evaluation judge comparing a model output to a golden reference answer.",
  "Return ONLY a JSON object with these fields:",
  "- \"score\": number 0.0-1.0 (1.0 = equivalent to golden answer)",
  "- \"differences\": string[] (list of key differences, empty if identical)",
  "- \"reasoning\": string (brief explanation)",
].join("\n");

const str = (v: unknown): string =>
  typeof v === "string" ? v : JSON.stringify(v, null, 2);

export async function compareToGolden(
  _env: Env,
  opts: {
    output: unknown;
    golden: unknown;
    judge: JudgeFn;
    threshold?: number;
  },
): Promise<GoldenComparisonResult> {
  const threshold = opts.threshold ?? 0.7;

  const judgeInput = {
    system: GOLDEN_SYSTEM,
    user: `Model Output: ${str(opts.output)}\nGolden Answer: ${str(opts.golden)}`,
  };

  const value = await opts.judge(judgeInput, opts.output, opts.golden);

  return {
    score: value,
    passed: value >= threshold,
    threshold,
    differences: [],
  };
}
