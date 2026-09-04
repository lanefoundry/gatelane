import type { Env } from "@gatelane/shared";
import type { JudgeFn, PairwiseComparisonResult } from "./types.js";

const PAIRWISE_SYSTEM = [
  "You are an evaluation judge comparing two model outputs for the same input.",
  "Return ONLY a JSON object with these fields:",
  "- \"winner\": \"A\" | \"B\" | \"tie\"",
  "- \"confidence\": number 0.0-1.0 (how confident you are in the choice)",
  "- \"reasoning\": string (brief explanation of why one is better)",
].join("\n");

const str = (v: unknown): string =>
  typeof v === "string" ? v : JSON.stringify(v, null, 2);

export async function comparePairwise(
  _env: Env,
  opts: {
    input: unknown;
    outputA: unknown;
    outputB: unknown;
    judge: JudgeFn;
  },
): Promise<PairwiseComparisonResult> {
  const judgeInput = {
    system: PAIRWISE_SYSTEM,
    user: `Input: ${str(opts.input)}\nOutput A: ${str(opts.outputA)}\nOutput B: ${str(opts.outputB)}`,
  };

  const value = await opts.judge(judgeInput, opts.outputA, opts.outputB);

  // The judge returns a numeric score: >0.5 favors A, <0.5 favors B, ~0.5 is a tie
  const TIE_BAND = 0.1;
  let winner: "A" | "B" | "tie";
  if (value > 0.5 + TIE_BAND) {
    winner = "A";
  } else if (value < 0.5 - TIE_BAND) {
    winner = "B";
  } else {
    winner = "tie";
  }

  const confidence = Math.abs(value - 0.5) * 2;

  return {
    winner,
    confidence,
    reasoning: "",
  };
}
