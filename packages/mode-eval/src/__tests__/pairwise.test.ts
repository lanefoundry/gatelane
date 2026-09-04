import { describe, it, expect } from "vitest";
import { comparePairwise } from "../pairwise.js";
import type { JudgeFn } from "../types.js";

const env = {} as any;

describe("comparePairwise", () => {
  it("declares A as winner when judge returns score > 0.6", async () => {
    const judge: JudgeFn = async () => 0.9;
    const result = await comparePairwise(env, {
      input: "What is 2+2?",
      outputA: "4",
      outputB: "5",
      judge,
    });

    expect(result.winner).toBe("A");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("declares B as winner when judge returns score < 0.4", async () => {
    const judge: JudgeFn = async () => 0.1;
    const result = await comparePairwise(env, {
      input: "What is 2+2?",
      outputA: "5",
      outputB: "4",
      judge,
    });

    expect(result.winner).toBe("B");
  });

  it("declares a tie when judge returns score within tie band (0.4 to 0.6)", async () => {
    const judge: JudgeFn = async () => 0.5;
    const result = await comparePairwise(env, {
      input: "What is 2+2?",
      outputA: "4",
      outputB: "4",
      judge,
    });

    expect(result.winner).toBe("tie");
  });

  it("tie at lower boundary (0.4)", async () => {
    const judge: JudgeFn = async () => 0.4;
    const result = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge,
    });

    expect(result.winner).toBe("tie");
  });

  it("tie at upper boundary (0.6)", async () => {
    const judge: JudgeFn = async () => 0.6;
    const result = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge,
    });

    expect(result.winner).toBe("tie");
  });

  it("A wins just above upper tie boundary", async () => {
    const judge: JudgeFn = async () => 0.61;
    const result = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge,
    });

    expect(result.winner).toBe("A");
  });

  it("B wins just below lower tie boundary", async () => {
    const judge: JudgeFn = async () => 0.39;
    const result = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge,
    });

    expect(result.winner).toBe("B");
  });

  it("confidence is 0 when score is exactly 0.5", async () => {
    const judge: JudgeFn = async () => 0.5;
    const result = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge,
    });

    expect(result.confidence).toBe(0);
  });

  it("confidence is 1.0 when score is 0 or 1", async () => {
    const judgeZero: JudgeFn = async () => 0;
    const resultZero = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge: judgeZero,
    });
    expect(resultZero.confidence).toBe(1.0);

    const judgeOne: JudgeFn = async () => 1.0;
    const resultOne = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge: judgeOne,
    });
    expect(resultOne.confidence).toBe(1.0);
  });

  it("confidence scales linearly with distance from 0.5", async () => {
    const judge: JudgeFn = async () => 0.75;
    const result = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge,
    });

    // confidence = |0.75 - 0.5| * 2 = 0.5
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it("passes object inputs through str() to the judge", async () => {
    let receivedInput: any;
    const judge: JudgeFn = async (input) => {
      receivedInput = input;
      return 0.5;
    };

    await comparePairwise(env, {
      input: { question: "test" },
      outputA: { answer: "A" },
      outputB: { answer: "B" },
      judge,
    });

    expect(receivedInput).toHaveProperty("system");
    expect(receivedInput).toHaveProperty("user");
    expect(receivedInput.user).toContain("question");
    expect(receivedInput.user).toContain("Output A:");
    expect(receivedInput.user).toContain("Output B:");
  });

  it("returns empty reasoning string", async () => {
    const judge: JudgeFn = async () => 0.8;
    const result = await comparePairwise(env, {
      input: "q",
      outputA: "a",
      outputB: "b",
      judge,
    });

    expect(result.reasoning).toBe("");
  });
});
