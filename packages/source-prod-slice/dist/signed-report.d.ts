/**
 * signed-report.ts — Generate signed PromotionReport with trace IDs and candidate SHAs.
 *
 * Builds a complete PromotionReport from gate run artifacts and signs it
 * using HMAC-SHA256 via the engine's signReport().
 *
 * @see docs/prd.md §5.1 — The gate
 */
import type { PromotionReport, PromotionPolicy, PromotionDecision, JudgeStabilityMatrix } from '@lanefoundry/gatelane-sdk';
import type { FrozenDataset } from '@lanefoundry/gatelane-sdk';
import type { CandidateMetric } from '@lanefoundry/gatelane-engine';
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
export declare function buildSignedReport(args: SignedReportArgs): Promise<SignedReportResult>;
/**
 * Verify a PromotionReport's signature.
 * Returns true if the signature matches the canonical JSON.
 */
export declare function verifySignedReport(report: PromotionReport, signingKey: string): Promise<boolean>;
/**
 * Generate candidate SHAs from source references.
 * In production, these would come from git commit SHAs or container image digests.
 */
export declare function generateCandidateShas(candidates: ReadonlyArray<{
    ref: string;
    sourceRef: string;
}>): Promise<Record<string, string>>;
/**
 * Generate judge SHAs from judge references.
 */
export declare function generateJudgeShas(judges: ReadonlyArray<{
    ref: string;
    model: string;
    version?: string;
}>): Promise<Record<string, string>>;
/**
 * Export a PromotionReport as canonical JSON for audit logs.
 */
export declare function exportReportForAudit(report: PromotionReport): string;
//# sourceMappingURL=signed-report.d.ts.map