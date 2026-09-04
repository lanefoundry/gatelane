import { describe, it, expect } from "vitest";
import { compareToGolden } from "../golden.js";
import type { JudgeFn } from "../types.js";

// Minimal env stub -- compareToGolden only uses the judge function, not Env
const env = {} as any;

describe("compareToGolden", () => {
  it("returns passed=true when judge score meets default threshold (0.7)", async () => {
    const judge: JudgeFn = async () => 0.8;
    const result = await compareToGolden(env, {
      output: "Paris",
      golden: "Paris",
      judge,
    });

    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(true);
    expect(result.threshold).toBe(0.7);
    expect(result.differences).toEqual([]);
  });

  it("returns passed=false when judge score is below default threshold", async () => {
    const judge: JudgeFn = async () => 0.3;
    const result = await compareToGolden(env, {
      output: "London",
      golden: "Paris",
      judge,
    });

    expect(result.score).toBe(0.3);
    expect(result.passed).toBe(false);
    expect(result.threshold).toBe(0.7);
  });

  it("uses a custom threshold when provided", async () => {
    const judge: JudgeFn = async () => 0.5;
    const result = await compareToGolden(env, {
      output: "close",
      golden: "exact",
      judge,
      threshold: 0.4,
    });

    expect(result.passed).toBe(true);
    expect(result.threshold).toBe(0.4);
  });

  it("passes at exact threshold boundary", async () => {
    const judge: JudgeFn = async () => 0.7;
    const result = await compareToGolden(env, {
      output: "answer",
      golden: "answer",
      judge,
    });

    expect(result.passed).toBe(true);
  });

  it("fails just below threshold", async () => {
    const judge: JudgeFn = async () => 0.699;
    const result = await compareToGolden(env, {
      output: "answer",
      golden: "answer",
      judge,
    });

    expect(result.passed).toBe(false);
  });

  it("passes object inputs through str() to the judge", async () => {
    let receivedInput: any;
    const judge: JudgeFn = async (input) => {
      receivedInput = input;
      return 1.0;
    };

    await compareToGolden(env, {
      output: { key: "value" },
      golden: { key: "expected" },
      judge,
    });

    expect(receivedInput).toHaveProperty("system");
    expect(receivedInput).toHaveProperty("user");
    // Object outputs are JSON-stringified in the user prompt
    expect(receivedInput.user).toContain('"key"');
    expect(receivedInput.user).toContain('"value"');
    expect(receivedInput.user).toContain('"expected"');
  });

  it("passes string inputs directly to the judge user prompt", async () => {
    let receivedInput: any;
    const judge: JudgeFn = async (input) => {
      receivedInput = input;
      return 1.0;
    };

    await compareToGolden(env, {
      output: "raw string output",
      golden: "raw string golden",
      judge,
    });

    expect(receivedInput.user).toContain("raw string output");
    expect(receivedInput.user).toContain("raw string golden");
  });

  it("returns a score of 0 when judge returns 0", async () => {
    const judge: JudgeFn = async () => 0;
    const result = await compareToGolden(env, {
      output: "completely wrong",
      golden: "correct answer",
      judge,
    });

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("returns a score of 1 when judge returns 1", async () => {
    const judge: JudgeFn = async () => 1.0;
    const result = await compareToGolden(env, {
      output: "perfect",
      golden: "perfect",
      judge,
    });

    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });
});
