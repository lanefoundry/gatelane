/**
 * signed-report.ts — Generate signed PromotionReport with trace IDs and candidate SHAs.
 *
 * Builds a complete PromotionReport from gate run artifacts and signs it
 * using HMAC-SHA256 via the engine's signReport().
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type {
  PromotionReport,
  PromotionPolicy,
  PromotionDecision,
  JudgeStabilityMatrix,
} from '@lanefoundry/gatelane-sdk';
import type { FrozenDataset } from '@lanefoundry/gatelane-sdk';
import type { CandidateMetric } from '@lanefoundry/gatelane-engine';
import { signReport, canonicalizeReport, verifyReport } from '@lanefoundry/gatelane-engine';
import { shaOfCandidateRef } from '@lanefoundry/gatelane-sdk';

/** Input for building a signed PromotionReport. */
export type SignedReportArgs = {
  /** Unique gate run ID (e.g., UUID). */
  gateRunId: string;
  /** The frozen dataset used for this gate run. */
  dataset: FrozenDataset;
  /** Candidate SHAs (ref -> SHA). From candidate build / source control. */
  candidateShas: Record<string, string>;
  /** Judge SHAs (ref -> SHA). From judge model versions. */
  judgeShas: Record<string, string>;
  /** SHA of the scorer/evaluator code. */
  scorerCodeSha: string;
  /** Baseline metrics (per-metric name -> value). */
  baselineMetrics: Record<string, number>;
  /** Per-candidate metrics from compareScores(). */
  candidateMetrics: Record<string, CandidateMetric>;
  /** Judge stability matrix from compareScores(). */
  judgeMatrix: JudgeStabilityMatrix;
  /** Policy applied to this gate run. */
  policy: PromotionPolicy;
  /** The promotion decision. */
  decision: PromotionDecision;
  /** Optional approver (when policy.approval_required). */
  approver?: string;
  /** Trace IDs for observability (from capture SDK / OTel). */
  traceIds?: ReadonlyArray<string>;
  /** HMAC signing key (from env GATELANE_REPORT_SIGNING_KEY). */
  signingKey: string;
};

/** Result of signed report generation. */
export type SignedReportResult = {
  /** The signed PromotionReport. */
  report: PromotionReport;
  /** Canonical JSON used for signing (without signature field). */
  canonicalJson: string;
  /** The signature (base64url-encoded HMAC-SHA256). */
  signature: string;
};

/**
 * Build and sign a PromotionReport from gate run artifacts.
 *
 * This assembles all the pieces required by the PromotionReport type,
 * computes the signature, and returns the complete signed report.
 */
export async function buildSignedReport(args: SignedReportArgs): Promise<SignedReportResult> {
  const {
    gateRunId,
    dataset,
    candidateShas,
    judgeShas,
    scorerCodeSha,
    baselineMetrics,
    candidateMetrics,
    judgeMatrix,
    policy,
    approver,
    signingKey,
  } = args;

  // Validate required fields
  if (!signingKey || signingKey.length < 16) {
    throw new Error('signingKey must be >= 16 characters');
  }
  if (!gateRunId) {
    throw new Error('gateRunId is required');
  }
  if (!dataset.content_hash) {
    throw new Error('dataset must have content_hash');
  }

  // Build candidate_metrics in the shape expected by PromotionReport
  const candidateMetricsForReport: PromotionReport['candidate_metrics'] = {};
  for (const [ref, metric] of Object.entries(candidateMetrics)) {
    candidateMetricsForReport[ref] = {
      aggregate_delta: metric.aggregate_delta,
      cost_delta: metric.cost_delta,
      latency_delta: metric.latency_delta,
    };
  }

  // Build the report (without signature initially)
  const report: PromotionReport = {
    id: `report-${gateRunId}`,
    gate_run_id: gateRunId,
    dataset_content_hash: dataset.content_hash,
    dataset_version: dataset.version,
    candidate_shas: candidateShas,
    judge_shas: judgeShas,
    scorer_code_sha: scorerCodeSha,
    baseline_metrics: baselineMetrics,
    candidate_metrics: candidateMetricsForReport,
    judge_matrix: judgeMatrix,
    policy,
    approver,
    timestamp: new Date().toISOString(),
    signature: '', // placeholder; will be filled after signing
  };

  // Sign the report
  const signature = await signReport(report, signingKey);

  // Return signed report
  const signedReport: PromotionReport = {
    ...report,
    signature,
  };

  return {
    report: signedReport,
    canonicalJson: canonicalizeReport(signedReport),
    signature,
  };
}

/**
 * Verify a PromotionReport's signature.
 * Returns true if the signature matches the canonical JSON.
 */
export async function verifySignedReport(report: PromotionReport, signingKey: string): Promise<boolean> {
  return verifyReport(report, signingKey);
}

/**
 * Generate candidate SHAs from source references.
 * In production, these would come from git commit SHAs or container image digests.
 */
export async function generateCandidateShas(
  candidates: ReadonlyArray<{ ref: string; sourceRef: string }>,
): Promise<Record<string, string>> {
  const shas: Record<string, string> = {};
  for (const { ref, sourceRef } of candidates) {
    shas[ref] = await shaOfCandidateRef(sourceRef);
  }
  return shas;
}

/**
 * Generate judge SHAs from judge references.
 */
export async function generateJudgeShas(
  judges: ReadonlyArray<{ ref: string; model: string; version?: string }>,
): Promise<Record<string, string>> {
  const shas: Record<string, string> = {};
  for (const { ref, model, version } of judges) {
    const versioned = version ? `${model}@${version}` : model;
    shas[ref] = await shaOfCandidateRef(versioned);
  }
  return shas;
}

/**
 * Export a PromotionReport as canonical JSON for audit logs.
 */
export function exportReportForAudit(report: PromotionReport): string {
  return canonicalizeReport(report);
}