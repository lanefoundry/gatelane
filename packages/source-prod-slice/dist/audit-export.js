/**
 * audit-export.ts — Export PromotionReport for compliance (JSON/CSV).
 *
 * Produces audit-ready exports of promotion decisions with full traceability.
 * Supports JSON (full fidelity) and CSV (spreadsheet-friendly) formats.
 *
 * @see docs/prd.md §5.1 — The gate (audit trail)
 */
/**
 * Export a PromotionReport for compliance/audit.
 */
export function exportAudit(args) {
    const { report, decision, dataset, format = 'json', includeJudgeMatrix = true, includeMetrics = true, includeDataset = true, } = args;
    if (format === 'json') {
        return exportJson(report, decision, dataset, includeJudgeMatrix, includeMetrics, includeDataset);
    }
    return exportCsv(report, decision, dataset, includeJudgeMatrix, includeMetrics, includeDataset);
}
/** Export as full-fidelity JSON. */
function exportJson(report, decision, dataset, includeJudgeMatrix, includeMetrics, includeDataset) {
    const output = {
        report: includeJudgeMatrix && includeMetrics
            ? report
            : stripReport(report, includeJudgeMatrix, includeMetrics),
        decision,
        exported_at: new Date().toISOString(),
        export_version: '1.0',
    };
    if (includeDataset && dataset) {
        output.dataset = {
            content_hash: dataset.content_hash,
            version: dataset.version,
            source_kind: dataset.source_kind,
            source_ref: dataset.source_ref,
            slice_filter: dataset.slice_filter,
            frozen_at: dataset.frozen_at,
            item_count: dataset.item_count,
        };
    }
    const content = JSON.stringify(output, null, 2);
    return {
        content,
        mimeType: 'application/json',
        filename: `promotion-report-${report.id}-${Date.now()}.json`,
        format: 'json',
    };
}
/** Export as CSV (one row per candidate). */
function exportCsv(report, decision, dataset, _includeJudgeMatrix, _includeMetrics, _includeDataset) {
    const rows = [];
    const headers = [
        'report_id',
        'gate_run_id',
        'dataset_content_hash',
        'dataset_version',
        'dataset_source_kind',
        'dataset_source_ref',
        'dataset_frozen_at',
        'dataset_item_count',
        'candidate_ref',
        'candidate_sha',
        'judge_sha',
        'aggregate_delta',
        'cost_delta',
        'latency_delta',
        'mean_score',
        'pass_rate',
        'n_items',
        'total_cost_usd',
        'mean_latency_ms',
        'judge_wins',
        'is_consensus_winner',
        'policy_min_delta',
        'policy_judge_stability_threshold',
        'policy_cost_ceiling',
        'policy_latency_ceiling',
        'policy_approval_required',
        'decision_action',
        'decision_winner',
        'decision_reason',
        'approver',
        'report_timestamp',
        'signature',
    ];
    rows.push(headers);
    const { candidate_metrics, candidate_shas, judge_shas, judge_matrix, policy } = report;
    const firstJudgeKey = Object.keys(judge_shas)[0];
    for (const candidateRef of Object.keys(candidate_metrics)) {
        const metric = candidate_metrics[candidateRef];
        if (!metric)
            continue;
        const candidateSha = candidate_shas[candidateRef] ?? '';
        const judgeSha = firstJudgeKey ? judge_shas[firstJudgeKey] ?? '' : '';
        const judgeWins = judge_matrix.winners_by_judge[candidateRef] ?? 0;
        const isConsensus = judge_matrix.consensus_winners.includes(candidateRef);
        const row = [
            report.id,
            report.gate_run_id,
            report.dataset_content_hash,
            report.dataset_version,
            dataset?.source_kind ?? '',
            dataset?.source_ref ?? '',
            dataset?.frozen_at ?? '',
            String(dataset?.item_count ?? ''),
            candidateRef,
            candidateSha,
            judgeSha,
            String(metric.aggregate_delta),
            String(metric.cost_delta),
            String(metric.latency_delta),
            // Note: CandidateMetric doesn't have mean_score/pass_rate directly
            // These would need to come from the original compare output
            '', // mean_score
            '', // pass_rate
            '', // n_items
            '', // total_cost_usd
            '', // mean_latency_ms
            String(judgeWins),
            String(isConsensus),
            String(policy.min_delta),
            String(policy.judge_stability_threshold),
            String(policy.cost_ceiling),
            String(policy.latency_ceiling),
            String(policy.approval_required),
            decision.action,
            'winner' in decision ? decision.winner : '',
            decision.reason,
            report.approver ?? '',
            report.timestamp,
            report.signature,
        ];
        rows.push(row);
    }
    // Add a summary row for the overall decision
    if (decision.action === 'promote' && 'winner' in decision) {
        const winnerMetric = candidate_metrics[decision.winner];
        if (winnerMetric) {
            const summaryRow = [
                report.id,
                report.gate_run_id,
                report.dataset_content_hash,
                report.dataset_version,
                dataset?.source_kind ?? '',
                dataset?.source_ref ?? '',
                dataset?.frozen_at ?? '',
                String(dataset?.item_count ?? ''),
                `SUMMARY (${decision.winner})`,
                candidate_shas[decision.winner] ?? '',
                (() => { const jk = Object.keys(judge_shas)[0]; return jk ? judge_shas[jk] ?? '' : ''; })(),
                String(winnerMetric.aggregate_delta),
                String(winnerMetric.cost_delta),
                String(winnerMetric.latency_delta),
                '', '', '', '', '',
                String(judge_matrix.winners_by_judge[decision.winner] ?? 0),
                String(judge_matrix.consensus_winners.includes(decision.winner)),
                String(policy.min_delta),
                String(policy.judge_stability_threshold),
                String(policy.cost_ceiling),
                String(policy.latency_ceiling),
                String(policy.approval_required),
                decision.action,
                decision.winner,
                decision.reason,
                report.approver ?? '',
                report.timestamp,
                report.signature,
            ];
            rows.push(summaryRow);
        }
    }
    const content = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    return {
        content,
        mimeType: 'text/csv',
        filename: `promotion-report-${report.id}-${Date.now()}.csv`,
        format: 'csv',
    };
}
/** Escape a value for CSV. */
function escapeCsv(value) {
    const s = value ?? '';
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
/** Strip optional fields from report for smaller exports. */
function stripReport(report, includeJudgeMatrix, includeMetrics) {
    const { judge_matrix, candidate_metrics, ...rest } = report;
    return {
        ...rest,
        ...(includeJudgeMatrix ? { judge_matrix } : { judge_matrix: { candidates: [], judges: [], winners_by_judge: {}, consensus_winners: [] } }),
        ...(includeMetrics ? { candidate_metrics } : { candidate_metrics: {} }),
    };
}
/**
 * Export multiple PromotionReports as a combined CSV.
 * Useful for batch audit reviews.
 */
export function exportAuditBatch(reports, format = 'csv') {
    if (format === 'json') {
        const content = JSON.stringify({
            exports: reports.map(({ report, decision, dataset }) => ({
                report: stripReport(report, true, true),
                decision,
                dataset: dataset ? {
                    content_hash: dataset.content_hash,
                    version: dataset.version,
                    source_kind: dataset.source_kind,
                    source_ref: dataset.source_ref,
                    frozen_at: dataset.frozen_at,
                    item_count: dataset.item_count,
                } : undefined,
            })),
            exported_at: new Date().toISOString(),
            export_version: '1.0',
            count: reports.length,
        }, null, 2);
        return {
            content,
            mimeType: 'application/json',
            filename: `promotion-reports-batch-${Date.now()}.json`,
            format: 'json',
        };
    }
    // CSV batch export
    const allRows = [];
    const headers = [
        'report_id',
        'gate_run_id',
        'dataset_content_hash',
        'dataset_version',
        'dataset_source_kind',
        'dataset_source_ref',
        'dataset_frozen_at',
        'dataset_item_count',
        'candidate_ref',
        'candidate_sha',
        'aggregate_delta',
        'cost_delta',
        'latency_delta',
        'judge_wins',
        'is_consensus_winner',
        'policy_min_delta',
        'policy_judge_stability_threshold',
        'policy_cost_ceiling',
        'policy_latency_ceiling',
        'policy_approval_required',
        'decision_action',
        'decision_winner',
        'decision_reason',
        'approver',
        'report_timestamp',
        'signature',
    ];
    allRows.push(headers);
    for (const { report, decision, dataset } of reports) {
        const { candidate_metrics, candidate_shas, judge_matrix, policy } = report;
        for (const candidateRef of Object.keys(candidate_metrics)) {
            const metric = candidate_metrics[candidateRef];
            if (!metric)
                continue;
            const judgeWins = judge_matrix.winners_by_judge[candidateRef] ?? 0;
            const isConsensus = judge_matrix.consensus_winners.includes(candidateRef);
            const row = [
                report.id,
                report.gate_run_id,
                report.dataset_content_hash,
                report.dataset_version,
                dataset?.source_kind ?? '',
                dataset?.source_ref ?? '',
                dataset?.frozen_at ?? '',
                String(dataset?.item_count ?? ''),
                candidateRef,
                candidate_shas[candidateRef] ?? '',
                String(metric.aggregate_delta),
                String(metric.cost_delta),
                String(metric.latency_delta),
                String(judgeWins),
                String(isConsensus),
                String(policy.min_delta),
                String(policy.judge_stability_threshold),
                String(policy.cost_ceiling),
                String(policy.latency_ceiling),
                String(policy.approval_required),
                decision.action,
                'winner' in decision ? decision.winner : '',
                decision.reason,
                report.approver ?? '',
                report.timestamp,
                report.signature,
            ];
            allRows.push(row);
        }
    }
    const content = allRows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    return {
        content,
        mimeType: 'text/csv',
        filename: `promotion-reports-batch-${Date.now()}.csv`,
        format: 'csv',
    };
}
/**
 * Export a human-readable summary for quick review.
 */
export function exportSummary(report, decision) {
    const lines = [
        `=== Promotion Gate Report ===`,
        `Report ID: ${report.id}`,
        `Gate Run: ${report.gate_run_id}`,
        `Dataset: ${report.dataset_content_hash} (v${report.dataset_version})`,
        `Timestamp: ${report.timestamp}`,
        `Decision: ${decision.action.toUpperCase()}`,
        ...(decision.action === 'promote' && 'winner' in decision ? [`Winner: ${decision.winner}`] : []),
        `Reason: ${decision.reason}`,
        `Approver: ${report.approver ?? 'N/A'}`,
        `Signature: ${report.signature.slice(0, 16)}...`,
        ``,
        `=== Policy ===`,
        `Min Delta: ${report.policy.min_delta}`,
        `Judge Stability: ${report.policy.judge_stability_threshold}`,
        `Cost Ceiling: ${report.policy.cost_ceiling}`,
        `Latency Ceiling: ${report.policy.latency_ceiling}`,
        `Approval Required: ${report.policy.approval_required}`,
        ``,
        `=== Judge Matrix ===`,
        `Judges: ${report.judge_matrix.judges.join(', ')}`,
        `Consensus Winners: ${report.judge_matrix.consensus_winners.join(', ') || 'none'}`,
        ``,
        `=== Candidate Metrics ===`,
    ];
    for (const [ref, metric] of Object.entries(report.candidate_metrics)) {
        lines.push(`  ${ref}: delta=${metric.aggregate_delta.toFixed(4)}, cost_delta=${metric.cost_delta.toFixed(4)}, latency_delta=${metric.latency_delta.toFixed(4)}`);
    }
    lines.push(``, `=== Judge Wins ===`);
    for (const [ref, wins] of Object.entries(report.judge_matrix.winners_by_judge)) {
        lines.push(`  ${ref}: ${wins} win(s)`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=audit-export.js.map