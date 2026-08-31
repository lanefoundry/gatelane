/**
 * signed-report.ts — Generate signed PromotionReport with trace IDs and candidate SHAs.
 *
 * Builds a complete PromotionReport from gate run artifacts and signs it
 * using HMAC-SHA256 via the engine's signReport().
 *
 * @see docs/prd.md §5.1 — The gate
 */
import { signReport, canonicalizeReport } from '@lanefoundry/gatelane-engine';
import { shaOfCandidateRef } from '@lanefoundry/gatelane-sdk';
/**
 * Build and sign a PromotionReport from gate run artifacts.
 *
 * This assembles all the pieces required by the PromotionReport type,
 * computes the signature, and returns the complete signed report.
 */
export async function buildSignedReport(args) {
    const { gateRunId, dataset, candidateShas, judgeShas, scorerCodeSha, baselineMetrics, candidateMetrics, judgeMatrix, policy, decision, approver, traceIds = [], signingKey, } = args;
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
    const candidateMetricsForReport = {};
    for (const [ref, metric] of Object.entries(candidateMetrics)) {
        candidateMetricsForReport[ref] = {
            aggregate_delta: metric.aggregate_delta,
            cost_delta: metric.cost_delta,
            latency_delta: metric.latency_delta,
        };
    }
    // Build the report (without signature initially)
    const report = {
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
    const signedReport = {
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
export async function verifySignedReport(report, signingKey) {
    const { verifyReport } = await import('@lanefoundry/gatelane-engine/sign');
    return verifyReport(report, signingKey);
}
/**
 * Generate candidate SHAs from source references.
 * In production, these would come from git commit SHAs or container image digests.
 */
export async function generateCandidateShas(candidates) {
    const shas = {};
    for (const { ref, sourceRef } of candidates) {
        shas[ref] = await shaOfCandidateRef(sourceRef);
    }
    return shas;
}
/**
 * Generate judge SHAs from judge references.
 */
export async function generateJudgeShas(judges) {
    const shas = {};
    for (const { ref, model, version } of judges) {
        const versioned = version ? `${model}@${version}` : model;
        shas[ref] = await shaOfCandidateRef(versioned);
    }
    return shas;
}
/**
 * Export a PromotionReport as canonical JSON for audit logs.
 */
export function exportReportForAudit(report) {
    return canonicalizeReport(report);
}
//# sourceMappingURL=signed-report.js.map