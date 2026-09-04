import type { Assertion } from "./types.js";

export function assert(output: string, assertion: Assertion): boolean {
  switch (assertion.operator) {
    case "equals":
      return output === assertion.value;
    case "contains":
      return typeof assertion.value === "string" && output.includes(assertion.value);
    case "not-contains":
      return typeof assertion.value === "string" && !output.includes(assertion.value);
    case "regex":
      return assertion.value instanceof RegExp
        ? assertion.value.test(output)
        : new RegExp(String(assertion.value)).test(output);
    case "starts-with":
      return typeof assertion.value === "string" && output.startsWith(assertion.value);
    case "is-json":
      try { JSON.parse(output); return true; } catch { return false; }
    case "is-refusal":
      return /(?:I (?:can't|cannot|won't|will not)|I'm (?:unable|not able)|sorry.*(?:can't|cannot))/i.test(output);
    case "custom":
      return assertion.customFn ? assertion.customFn(output) : false;
  }
}

export function assertAll(output: string, assertions: Assertion[]): boolean {
  return assertions.every((a) => assert(output, a));
}
