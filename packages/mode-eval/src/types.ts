export type MetricName =
  | "correctness"
  | "faithfulness"
  | "relevance"
  | "coherence"
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
  assertions?: Assertion[];
  metrics?: MetricName[];
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

export interface GoldenComparisonResult {
  score: number;
  passed: boolean;
  threshold: number;
  differences: string[];
  detail?: string;
}

export interface PairwiseComparisonResult {
  winner: "A" | "B" | "tie";
  confidence: number;
  reasoning: string;
}

export interface ScenarioAgent {
  execute: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}

export interface StepResult {
  stepIndex: number;
  role: ScenarioStep["role"];
  input: unknown;
  output: string | null;
  assertionsPassed: boolean;
  scores?: MetricResult[];
  duration: number;
}

export interface ScenarioResult {
  id: string;
  scenarioId: string;
  steps: StepResult[];
  passed: boolean;
  duration: number;
  createdAt: string;
}

export type EdgeCaseCategory =
  | "empty-input"
  | "very-long-input"
  | "special-characters"
  | "unicode"
  | "injection-attempt"
  | "boundary-values";

export interface EdgeCase {
  id: string;
  category: EdgeCaseCategory;
  input: string;
  description: string;
}

export type OutputFormat = "json" | "markdown" | "junit";

export interface CIConfig {
  testCases: TestCase[];
  execute: (input: unknown) => Promise<unknown>;
  metrics?: MetricName[];
  threshold?: number;
  perMetricThresholds?: Partial<Record<MetricName, number>>;
  judge: JudgeFn;
  outputFormat?: OutputFormat;
  concurrency?: number;
}

export interface CIResult {
  passed: boolean;
  summary: EvalSummary;
  output: string;
  exitCode: 0 | 1;
  failureReasons: string[];
}

export interface CaptureFilters {
  model?: string;
  minScore?: number;
  maxCostCents?: number;
}

export interface GenerateTestCasesOptions {
  datasetId?: string;
  limit?: number;
  filters?: CaptureFilters;
  includeExpected?: boolean;
}

export interface FeatureGateConfig {
  testCases: TestCase[];
  execute: (input: unknown) => Promise<unknown>;
  metrics: MetricName[];
  thresholds: Record<MetricName, number>;
  requiredAssertions?: Assertion[];
  judge: JudgeFn;
  concurrency?: number;
}

export interface FeatureReadiness {
  ready: boolean;
  blockers: string[];
  scores: Partial<Record<MetricName, number>>;
  timestamp: string;
}
