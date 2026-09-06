/**
 * Red-team attack report + patch-verify cycle.
 * Built on top of the gate's replay + judge + compare primitives.
 *
 * @see docs/prd.md §5.2.1 — Red-team dataset
 * @see docs/roadmap.md Week 3-4 — Red-team dataset source
 */
import type { LLMCaller } from './llm.js';
import type { ReplayResult, ReplayArgs } from './replay.js';
import type { JudgeVerdict } from './judge.js';
import { LLMJudge } from './judge.js';
import { replay } from './replay.js';
import { compare } from './compare.js';
import { evaluate, type EvaluateResult } from './evaluate.js';
import { signReport } from './sign.js';
import type { PromotionReport, PromotionDecision, PromotionPolicy } from '@lanefoundry/gatelane-sdk/promotion';
import { shaOfCandidateRef } from '@lanefoundry/gatelane-sdk';
import type { FrozenDataset } from '@lanefoundry/gatelane-sdk/dataset';
import type { InjectionCategory, InjectionPayload } from './attack.js';
import { injectionMetaOf } from './attack.js';

/** Per-verdict detail enriched with attack taxonomy. */
export type AttackVerdict = JudgeVerdict & {
  /** Attack category from payload registry. */
  category: InjectionCategory;
  /** OWASP Agentic Top 10 mapping from payload registry. */
  mapped_asi: InjectionPayload['mapped_asi'];
};

/** Per-candidate summary of attack outcomes. */
export type CandidateAttackSummary = {
  /** Candidate ref (e.g., 'model:gpt-4o'). */
  candidate_ref: string;
  /** Total items evaluated. */
  total: number;
  /** Items where candidate survived (judge verdict = pass). */
  survived: number;
  /** Items where candidate was compromised (judge verdict = fail). */
  failed: number;
  /** Fraction survived. */
  survival_rate: number;
  /** Breakdown by attack category. */
  by_category: Record<InjectionCategory, { survived: number; failed: number; total: number }>;
  /** Specific failing attacks (vulnerabilities). */
  vulnerabilities: AttackVerdict[];
};

/** Per-ASI gap summary. */
export type ASIGapSummary = {
  asi: string;
  /** Total items mapped to this ASI. */
  total: number;
  /** Items where candidate failed this ASI. */
  failed: number;
  /** Failed fraction. */
  fail_rate: number;
};

/** Complete attack report. */
export type AttackReport = {
  /** FrozenDataset content hash. */
  dataset_content_hash: string;
  /** FrozenDataset version. */
  dataset_version: string;
  /** Timestamp of report generation. */
  generated_at: string;
  /** Per-candidate summaries. */
  candidates: CandidateAttackSummary[];
  /** Per-ASI vulnerability gaps across all candidates. */
  by_asi: ASIGapSummary[];
  /** Candidates evaluated. */
  candidate_refs: string[];
  /** Judges used. */
  judges: string[];
};

/** Options for running the red-team gate. */
export type RunRedTeamArgs = {
  /** Dataset to attack (e.g., from freezeInjectionDataset()). */
  dataset: FrozenDataset;
  /** Candidate refs to evaluate. */
  candidates: ReadonlyArray<string>;
  /** Judge refs. */
  judges: ReadonlyArray<string>;
  /** LLM caller for candidates. */
  caller: LLMCaller;
  /** Per-judge callers (optional; falls back to caller). */
  judge_callers?: Record<string, LLMCaller>;
  /** Master seed for deterministic replay. */
  seed?: number;
  /** Promotion policy for gate decision. */
  policy?: PromotionPolicy;
  /** Optional baseline candidate ref. */
  baseline?: string;
  /** Optional approver (when policy.approval_required). */
  approver?: string;
  /** Optional signing key — if provided, returns signed PromotionReport. */
  signing_key?: string;
};

/** Result of running the red-team gate. */
export type RunRedTeamResult = {
  /** Attack report with vulnerability details. */
  attackReport: AttackReport;
  /** Gate result (promote/rollback/hold + signed report if signing_key provided). */
  gateResult: {
    report: PromotionReport;
    decision: PromotionDecision;
    evaluate: EvaluateResult;
  } | null;
};

/** Result of patch verification. */
export type PatchVerdict = {
  /** True if patch resolves all baseline failures without regressions. */
  holds: boolean;
  /** Attack item ids that baseline failed and patched now passes. */
  resolved: string[];
  /** Attack item ids that baseline passed but patched fails (regressions). */
  regressed: string[];
  /** Attack item ids baseline failed and patched still fails. */
  stillVulnerable: string[];
  /** Baseline candidate ref. */
  baselineCandidate: string;
  /** Patched candidate ref. */
  patchedCandidate: string;
  /** Baseline attack report. */
  before: AttackReport;
  /** Patched attack report. */
  after: AttackReport;
};

/**
 * Enrich raw JudgeVerdicts with attack taxonomy (category + ASI).
 * Uses INJECTION_META from attack.ts to look up by item_id.
 */
export function enrichVerdicts(verdicts: JudgeVerdict[], _dataset: FrozenDataset): AttackVerdict[] {
  return verdicts.map((v) => {
    const meta = injectionMetaOf(v.item_id);
    return {
      ...v,
      category: meta?.category ?? 'prompt_injection', // default
      mapped_asi: meta?.mapped_asi ?? 'ASI01',
    };
  });
}

/**
 * Build an AttackReport from enriched verdicts and the dataset.
 */
export function buildAttackReport(args: {
  verdicts: AttackVerdict[];
  dataset: FrozenDataset;
  candidate_refs: ReadonlyArray<string>;
  judges: ReadonlyArray<string>;
}): AttackReport {
  const { verdicts, dataset, candidate_refs, judges } = args;

  // Group verdicts by candidate
  const byCandidate = new Map<string, AttackVerdict[]>();
  for (const v of verdicts) {
    const arr = byCandidate.get(v.candidate_ref) ?? [];
    arr.push(v);
    byCandidate.set(v.candidate_ref, arr);
  }


  // Build per-candidate summaries
  const candidates: CandidateAttackSummary[] = candidate_refs.map((ref) => {
    const vlist = byCandidate.get(ref) ?? [];
    const survived = vlist.filter((v) => v.outcome === 'pass').length;
    const failed = vlist.filter((v) => v.outcome === 'fail').length;
    const total = vlist.length;

    // By category
    const by_category: Record<InjectionCategory, { survived: number; failed: number; total: number }> = {
      prompt_injection: { survived: 0, failed: 0, total: 0 },
      privilege_escalation: { survived: 0, failed: 0, total: 0 },
      code_injection: { survived: 0, failed: 0, total: 0 },
      tool_misuse: { survived: 0, failed: 0, total: 0 },
    };
    for (const v of vlist) {
      const bucket = by_category[v.category];
      bucket.total += 1;
      if (v.outcome === 'pass') bucket.survived += 1;
      else bucket.failed += 1;
    }

    return {
      candidate_ref: ref,
      total,
      survived,
      failed,
      survival_rate: total === 0 ? 1 : survived / total,
      by_category,
      vulnerabilities: vlist.filter((v) => v.outcome === 'fail'),
    };
  });

  // Per-ASI gaps across all candidates
  const asiCounts = new Map<string, { total: number; failed: number }>();
  for (const v of verdicts) {
    const key = v.mapped_asi;
    const cur = asiCounts.get(key) ?? { total: 0, failed: 0 };
    cur.total += 1;
    if (v.outcome === 'fail') cur.failed += 1;
    asiCounts.set(key, cur);
  }
  const by_asi: ASIGapSummary[] = Array.from(asiCounts.entries())
    .map(([asi, { total, failed }]) => ({
      asi,
      total,
      failed,
      fail_rate: total === 0 ? 0 : failed / total,
    }))
    .sort((a, b) => b.fail_rate - a.fail_rate); // highest-impact gaps first

  return {
    dataset_content_hash: dataset.content_hash,
    dataset_version: dataset.version,
    generated_at: new Date().toISOString(),
    candidates,
    by_asi,
    candidate_refs: [...candidate_refs],
    judges: [...judges],
  };
}

/**
 * Collect judge verdicts for a replay result.
 * Extracted from runner logic so both runner and red-team path share it.
 */
export async function collectVerdicts(args: {
  replayResult: ReplayResult;
  dataset: FrozenDataset;
  candidates: ReadonlyArray<{ ref: string; model: string }>;
  judges: ReadonlyArray<string>;
  caller: LLMCaller;
  judge_callers?: Record<string, LLMCaller>;
}): Promise<JudgeVerdict[]> {
  const { replayResult, dataset, candidates, judges, caller, judge_callers } = args;
  const verdicts: JudgeVerdict[] = [];

  for (const cand of candidates) {
    for (const judgeRef of judges) {
      const judgeCaller = judge_callers?.[judgeRef] ?? caller;
      const judge = new LLMJudge({ name: judgeRef, caller: judgeCaller });
      const candRows = replayResult.rows.filter((r) => r.candidate_ref === cand.ref);
      for (const row of candRows) {
        const itemId = row.item_id;
        const itemInput = dataset.items?.find((it) => (it.id ?? '<anonymous>') === itemId)?.input;
        const v = await judge.judge({
          candidate_ref: cand.ref,
          item_id: itemId,
          item_input: itemInput ?? null,
          candidate_output: row.response.content,
        });
        verdicts.push(v);
      }
    }
  }
  return verdicts;
}

/**
 * Resolve candidate refs to { ref, model } objects for replay.
 * Mirrors runner logic: 'model:foo' → model 'foo', others → full ref.
 */
export function resolveCandidates(refs: ReadonlyArray<string>): ReadonlyArray<{ ref: string; model: string }> {
  return refs.map((ref) => ({
    ref,
    model: ref.startsWith('model:') ? ref.slice('model:'.length) : ref,
  }));
}

/**
 * Run the full red-team gate: replay + judge + compare + sign + evaluate + attack report.
 * Returns both the attack report and the gate decision.
 */
export async function runRedTeamGate(args: RunRedTeamArgs): Promise<RunRedTeamResult> {
  const {
    dataset,
    candidates,
    judges,
    caller,
    judge_callers,
    seed,
    policy,
    baseline,
    approver,
    signing_key,
  } = args;

  // 1. Replay
  const candidateObjs = resolveCandidates(candidates);
  const replayArgs: ReplayArgs = {
    dataset,
    candidates: candidateObjs,
    caller,
    ...(seed !== undefined ? { seed } : {}),
  };
  const replayResult = await replay(replayArgs);

  // 2. Judge (collect verdicts)
  const verdicts = await collectVerdicts({
    replayResult,
    dataset,
    candidates: candidateObjs,
    judges,
    caller,
    judge_callers,
  });

  // 3. Enrich verdicts with attack taxonomy
  const enriched = enrichVerdicts(verdicts, dataset);

  // 4. Build attack report
  const attackReport = buildAttackReport({
    verdicts: enriched,
    dataset,
    candidate_refs: candidates,
    judges,
  });

  // 5. Compare + evaluate (gate decision)
  const { perCandidate, judgeMatrix } = compare({
    replay: replayResult,
    verdicts,
    ...(baseline !== undefined ? { baseline_ref: baseline } : {}),
  });

  const candidate_shas: Record<string, string> = {};
  for (const ref of candidates) candidate_shas[ref] = await shaOfCandidateRef(ref);
  const judge_shas: Record<string, string> = {};
  for (const j of judges) judge_shas[j] = await shaOfCandidateRef(j);
  const scorerCodeSha = await shaOfCandidateRef('gatelane-engine:redteam:v0.0.1-dev');

  const candidate_metrics: Record<string, { aggregate_delta: number; cost_delta: number; latency_delta: number }> = {};
  for (const [ref, m] of Object.entries(perCandidate)) {
    candidate_metrics[ref] = {
      aggregate_delta: m.aggregate_delta,
      cost_delta: m.cost_delta,
      latency_delta: m.latency_delta,
    };
  }
  const baseline_metrics: Record<string, number> = {};
  if (baseline !== undefined) {
    const b = perCandidate[baseline];
    if (b !== undefined) {
      baseline_metrics.primary_score = b.mean_score;
      baseline_metrics.cost = b.total_cost_usd;
      baseline_metrics.latency = b.mean_latency_ms;
    }
  }

  const runId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const baseReport: PromotionReport = {
    id: reportId,
    gate_run_id: runId,
    dataset_content_hash: dataset.content_hash,
    dataset_version: dataset.version,
    candidate_shas,
    judge_shas,
    scorer_code_sha: scorerCodeSha,
    baseline_metrics,
    candidate_metrics,
    judge_matrix: judgeMatrix,
    policy: policy ?? (await import('@lanefoundry/gatelane-sdk')).DEFAULT_POLICY,
    ...(approver !== undefined ? { approver } : {}),
    timestamp: new Date().toISOString(),
    signature: 'pending',
  };

  let gateResult: RunRedTeamResult['gateResult'] = null;
  if (signing_key) {
    const signature = await signReport(baseReport, signing_key);
    const signed: PromotionReport = { ...baseReport, signature };
    const { decision, rule_results } = evaluate({
      candidates,
      perCandidate,
      judgeMatrix,
      policy: baseReport.policy,
      ...(approver !== undefined ? { approver } : {}),
    });
    gateResult = { report: signed, decision, evaluate: { decision, rule_results } };
  }

  return { attackReport, gateResult };
}

/**
 * Verify that a patch holds against the same red-team dataset.
 * Compares baseline candidate failures vs patched candidate outcomes.
 */
export function verifyPatchHolds(args: {
  before: AttackReport;
  after: AttackReport;
  baselineCandidate: string;
  patchedCandidate: string;
}): PatchVerdict {
  const { before, after, baselineCandidate, patchedCandidate } = args;

  const beforeSummary = before.candidates.find((c) => c.candidate_ref === baselineCandidate);
  const afterSummary = after.candidates.find((c) => c.candidate_ref === patchedCandidate);

  if (!beforeSummary || !afterSummary) {
    throw new Error(`Candidate not found in reports: baseline=${baselineCandidate}, patched=${patchedCandidate}`);
  }

  const beforeFails = new Set(beforeSummary.vulnerabilities.map((v) => v.item_id));
  const afterFails = new Set(afterSummary.vulnerabilities.map((v) => v.item_id));

  const resolved = Array.from(beforeFails).filter((id) => !afterFails.has(id));
  const regressed = Array.from(afterFails).filter((id) => !beforeFails.has(id));
  const stillVulnerable = Array.from(beforeFails).filter((id) => afterFails.has(id));

  const holds = stillVulnerable.length === 0 && regressed.length === 0;

  return {
    holds,
    resolved,
    regressed,
    stillVulnerable,
    baselineCandidate,
    patchedCandidate,
    before,
    after,
  };
}