import { describe, it, expect } from "vitest";
import { assert, assertAll } from "../assertions.js";
import type { Assertion } from "../types.js";

describe("assert", () => {
  describe("equals", () => {
    it("returns true when output exactly matches value", () => {
      expect(assert("hello", { operator: "equals", value: "hello" })).toBe(true);
    });

    it("returns false when output does not match", () => {
      expect(assert("hello", { operator: "equals", value: "world" })).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(assert("Hello", { operator: "equals", value: "hello" })).toBe(false);
    });

    it("returns false for empty string vs non-empty", () => {
      expect(assert("", { operator: "equals", value: "a" })).toBe(false);
    });

    it("matches empty string to empty string", () => {
      expect(assert("", { operator: "equals", value: "" })).toBe(true);
    });
  });

  describe("contains", () => {
    it("returns true when output contains substring", () => {
      expect(assert("hello world", { operator: "contains", value: "world" })).toBe(true);
    });

    it("returns false when substring is absent", () => {
      expect(assert("hello world", { operator: "contains", value: "xyz" })).toBe(false);
    });

    it("matches at the beginning", () => {
      expect(assert("hello world", { operator: "contains", value: "hello" })).toBe(true);
    });

    it("matches entire string", () => {
      expect(assert("hello", { operator: "contains", value: "hello" })).toBe(true);
    });
  });

  describe("not-contains", () => {
    it("returns true when substring is absent", () => {
      expect(assert("hello world", { operator: "not-contains", value: "xyz" })).toBe(true);
    });

    it("returns false when substring is present", () => {
      expect(assert("hello world", { operator: "not-contains", value: "world" })).toBe(false);
    });
  });

  describe("regex", () => {
    it("matches with a RegExp value", () => {
      expect(assert("abc123", { operator: "regex", value: /\d+/ })).toBe(true);
    });

    it("returns false when RegExp does not match", () => {
      expect(assert("abc", { operator: "regex", value: /\d+/ })).toBe(false);
    });

    it("matches with a string pattern", () => {
      expect(assert("abc123", { operator: "regex", value: "\\d+" })).toBe(true);
    });

    it("returns false when string pattern does not match", () => {
      expect(assert("abc", { operator: "regex", value: "\\d+" })).toBe(false);
    });
  });

  describe("starts-with", () => {
    it("returns true when output starts with value", () => {
      expect(assert("hello world", { operator: "starts-with", value: "hello" })).toBe(true);
    });

    it("returns false when output does not start with value", () => {
      expect(assert("hello world", { operator: "starts-with", value: "world" })).toBe(false);
    });
  });

  describe("is-json", () => {
    it("returns true for valid JSON object", () => {
      expect(assert('{"key": "value"}', { operator: "is-json" })).toBe(true);
    });

    it("returns true for valid JSON array", () => {
      expect(assert("[1, 2, 3]", { operator: "is-json" })).toBe(true);
    });

    it("returns true for JSON string literal", () => {
      expect(assert('"hello"', { operator: "is-json" })).toBe(true);
    });

    it("returns true for JSON number", () => {
      expect(assert("42", { operator: "is-json" })).toBe(true);
    });

    it("returns false for invalid JSON", () => {
      expect(assert("{invalid}", { operator: "is-json" })).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(assert("", { operator: "is-json" })).toBe(false);
    });
  });

  describe("is-refusal", () => {
    it("detects 'I cannot'", () => {
      expect(assert("I cannot help with that request.", { operator: "is-refusal" })).toBe(true);
    });

    it("detects 'I can't'", () => {
      expect(assert("I can't assist you with that.", { operator: "is-refusal" })).toBe(true);
    });

    it("detects 'I won't'", () => {
      expect(assert("I won't do that.", { operator: "is-refusal" })).toBe(true);
    });

    it("detects 'I'm unable'", () => {
      expect(assert("I'm unable to fulfill that request.", { operator: "is-refusal" })).toBe(true);
    });

    it("detects 'sorry...cannot'", () => {
      expect(assert("I'm sorry, but I cannot do that.", { operator: "is-refusal" })).toBe(true);
    });

    it("returns false for non-refusal text", () => {
      expect(assert("Here is the information you requested.", { operator: "is-refusal" })).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(assert("I CANNOT do that.", { operator: "is-refusal" })).toBe(true);
    });
  });

  describe("custom", () => {
    it("calls the custom function", () => {
      const assertion: Assertion = {
        operator: "custom",
        customFn: (output) => output.length > 5,
      };
      expect(assert("long enough", assertion)).toBe(true);
      expect(assert("no", assertion)).toBe(false);
    });

    it("returns false when customFn is not provided", () => {
      expect(assert("anything", { operator: "custom" })).toBe(false);
    });
  });
});

describe("assertAll", () => {
  it("returns true when all assertions pass", () => {
    const assertions: Assertion[] = [
      { operator: "contains", value: "hello" },
      { operator: "not-contains", value: "goodbye" },
    ];
    expect(assertAll("hello world", assertions)).toBe(true);
  });

  it("returns false when any assertion fails", () => {
    const assertions: Assertion[] = [
      { operator: "contains", value: "hello" },
      { operator: "contains", value: "missing" },
    ];
    expect(assertAll("hello world", assertions)).toBe(false);
  });

  it("returns true for empty assertions array", () => {
    expect(assertAll("anything", [])).toBe(true);
  });
});
