/**
 * audit-export.ts — Export PromotionReport for compliance (JSON/CSV).
 *
 * Produces audit-ready exports of promotion decisions with full traceability.
 * Supports JSON (full fidelity) and CSV (spreadsheet-friendly) formats.
 *
 * @see docs/prd.md §5.1 — The gate (audit trail)
 */
import type { PromotionReport, PromotionDecision } from '@lanefoundry/gatelane-sdk';
import type { FrozenDataset } from '@lanefoundry/gatelane-sdk';
/** Export format. */
export type ExportFormat = 'json' | 'csv';
/** Arguments for audit export. */
export type AuditExportArgs = {
    /** The signed PromotionReport to export. */
    report: PromotionReport;
    /** The PromotionDecision. */
    decision: PromotionDecision;
    /** The FrozenDataset used (optional, for context). */
    dataset?: FrozenDataset;
    /** Export format. Default: 'json'. */
    format?: ExportFormat;
    /** Include full judge matrix in export. Default: true. */
    includeJudgeMatrix?: boolean;
    /** Include per-candidate metric details. Default: true. */
    includeMetrics?: boolean;
    /** Include dataset metadata. Default: true. */
    includeDataset?: boolean;
};
/** Result of audit export. */
export type AuditExportResult = {
    /** Exported content as string. */
    content: string;
    /** MIME type of the export. */
    mimeType: string;
    /** Suggested filename. */
    filename: string;
    /** Export format used. */
    format: ExportFormat;
};
/**
 * Export a PromotionReport for compliance/audit.
 */
export declare function exportAudit(args: AuditExportArgs): AuditExportResult;
/**
 * Export multiple PromotionReports as a combined CSV.
 * Useful for batch audit reviews.
 */
export declare function exportAuditBatch(reports: ReadonlyArray<{
    report: PromotionReport;
    decision: PromotionDecision;
    dataset?: FrozenDataset;
}>, format?: ExportFormat): AuditExportResult;
/**
 * Export a human-readable summary for quick review.
 */
export declare function exportSummary(report: PromotionReport, decision: PromotionDecision): string;
//# sourceMappingURL=audit-export.d.ts.map