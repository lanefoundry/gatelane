export type MetricName =
  | "correctness"
  | "faithfulness"
  | "relevance"
  | "hallucination"
  | "safety"
  | "format-compliance"
  | "toxicity"
  | (string & {});

export interface MetricResult {
  metric: MetricName;
  score: number;
  passed: boolean;
  threshold: number;
  detail?: string;
}

export interface EvalResult {
  id: string;
  testCaseId: string;
  metrics: MetricResult[];
  passed: boolean;
  duration: number;
  createdAt: string;
}

export type AssertionOperator =
  | "equals"
  | "contains"
  | "not-contains"
  | "regex"
  | "starts-with"
  | "is-json"
  | "is-refusal"
  | "custom";

export interface Assertion {
  operator: AssertionOperator;
  value?: string | RegExp;
  customFn?: (output: string) => boolean;
}

export interface TestCase {
  id: string;
  input: unknown;
  expectedOutput?: unknown;
  assertions?: Assertion[];
  metadata?: Record<string, unknown>;
}

export interface ScenarioStep {
  role: "user" | "assistant" | "tool_call" | "tool_result";
  content: unknown;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  steps: ScenarioStep[];
  assertions?: Assertion[];
  metrics?: MetricName[];
}

export interface JudgeFn {
  (input: unknown, output: unknown, expected?: unknown): Promise<number>;
}

export interface EvalConfig {
  metrics?: MetricName[];
  threshold?: number;
  judge?: JudgeFn;
  concurrency?: number;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  results: EvalResult[];
  duration: number;
}
