import { describe, it, expect } from "vitest";
import { score } from "../scorer.js";
import type { JudgeFn } from "../types.js";

const env = {} as any;

describe("score", () => {
  it("returns passed=true when judge score meets default threshold (0.7)", async () => {
    const judge: JudgeFn = async () => 0.8;
    const result = await score(env, {
      metric: "correctness",
      input: "What is 2+2?",
      output: "4",
      judge,
    });

    expect(result.metric).toBe("correctness");
    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(true);
    expect(result.threshold).toBe(0.7);
  });

  it("returns passed=false when judge score is below default threshold", async () => {
    const judge: JudgeFn = async () => 0.3;
    const result = await score(env, {
      metric: "correctness",
      input: "What is 2+2?",
      output: "5",
      judge,
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.3);
  });

  it("uses custom threshold when provided", async () => {
    const judge: JudgeFn = async () => 0.5;
    const result = await score(env, {
      metric: "faithfulness",
      input: "q",
      output: "a",
      judge,
      threshold: 0.4,
    });

    expect(result.passed).toBe(true);
    expect(result.threshold).toBe(0.4);
  });

  it("passes at exact threshold boundary", async () => {
    const judge: JudgeFn = async () => 0.7;
    const result = await score(env, {
      metric: "relevance",
      input: "q",
      output: "a",
      judge,
    });

    expect(result.passed).toBe(true);
  });

  it("preserves the metric name in the result", async () => {
    const judge: JudgeFn = async () => 1.0;
    const result = await score(env, {
      metric: "safety",
      input: "q",
      output: "a",
      judge,
    });

    expect(result.metric).toBe("safety");
  });

  it("passes expected value to judge when provided", async () => {
    let receivedExpected: unknown;
    const judge: JudgeFn = async (_input, _output, expected) => {
      receivedExpected = expected;
      return 1.0;
    };

    await score(env, {
      metric: "correctness",
      input: "q",
      output: "a",
      expected: "expected-value",
      judge,
    });

    expect(receivedExpected).toBe("expected-value");
  });

  it("handles custom metric names", async () => {
    const judge: JudgeFn = async () => 0.9;
    const result = await score(env, {
      metric: "my-custom-metric",
      input: "q",
      output: "a",
      judge,
    });

    expect(result.metric).toBe("my-custom-metric");
    expect(result.passed).toBe(true);
  });
});
