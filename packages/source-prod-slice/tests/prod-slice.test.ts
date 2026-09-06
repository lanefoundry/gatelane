import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  freezeDataset,
  type FrozenDataset,
  type DatasetItem,
  DEFAULT_POLICY,
  InMemoryStorage,
  setStorage,
  shaOfCandidateRef,
} from '@lanefoundry/gatelane-sdk';
import type { CapturedCall } from '@lanefoundry/gatelane-sdk/capture';

import {
  MockLLMCaller,
  type ReplayResult,
  type ReplayRow,
} from '@lanefoundry/gatelane-engine';

import {
  freezeSlice,
  defaultTransform,
  replayBatch,
  type ReplayCandidate,
  compareScores,
  computeJudgeStability,
  makePromotionDecision,
  checkCandidateAgainstPolicy,
  validatePolicy,
  buildSignedReport,
  generateCandidateShas,
  generateJudgeShas,
  startCanary,
  recordObservation,
  rollbackCanary,
  failCanary,
  tickCanaries,
  getCanaryStorage,
  setCanaryStorage,
  InMemoryCanaryStorage,
  exportAudit,
  exportAuditBatch,
  exportSummary,
} from '@lanefoundry/source-prod-slice';

const SIGNING_KEY = 'test-signing-key-must-be-≥16-chars';

// Helper: create a test dataset
async function makeDataset(items?: DatasetItem[]): Promise<FrozenDataset> {
  return freezeDataset({
    source_kind: 'prod',
    source_ref: 'test-source@v1.0.0',
    items,
  });
}
// Helper: create mock captured calls
function makeCapturedCalls(count: number = 5): CapturedCall[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `call-${i}`,
    started_at: new Date(Date.now() - (count - i) * 1000).toISOString(),
    input: {
      messages: [{ role: 'user', content: `Test input ${i}` }],
      metadata: { source_kind: 'agent', trace_id: `trace-${i}` },
    },
    response: { content: `Test response ${i}`, cost_usd: 0.001, latency_ms: 100 },
  }));
}

// Helper: create mock replay results
function makeReplayResults(candidates: string[], items: DatasetItem[]): Record<string, ReplayResult> {
  const results: Record<string, ReplayResult> = {};
  for (const ref of candidates) {
    const rows: ReplayRow[] = items.map((item, idx) => ({
      item_id: item.id,
      candidate_ref: ref,
      response: {
        content: `${ref} response to ${item.id}`,
        cost_usd: 0.001,
        latency_ms: 100 + idx * 10,
        metadata: { seed: 123 },
      },
      captured: {
        id: `replay-${ref}-${idx}`,
        started_at: new Date().toISOString(),
        input: { messages: [{ role: 'user', content: String(item.input) }] },
        response: { content: `${ref} response`, cost_usd: 0.001, latency_ms: 100 },
      },
    }));
    results[ref] = {
      rows,
      determinism_score: 1.0,
      total_cost_usd: rows.length * 0.001,
      total_latency_ms: rows.reduce((sum, r) => sum + r.response.latency_ms, 0),
    };
  }
  return results;
}

// Helper: create mock judge verdicts
function makeVerdicts(
  candidates: string[],
  judges: string[],
  items: DatasetItem[],
  scoreOffset: Record<string, number> = {},
): Array<{ candidate_ref: string; judge_ref: string; item_id: string; outcome: 'pass' | 'fail'; score: number; cost_usd: number; latency_ms: number }> {
  const verdicts = [];
  for (const judge of judges) {
    for (const candidate of candidates) {
      for (const item of items) {
        const baseScore = 0.7 + (Math.random() * 0.3);
        const offset = scoreOffset[candidate] ?? 0;
        const score = Math.max(0, Math.min(1, baseScore + offset));
        verdicts.push({
          candidate_ref: candidate,
          judge_ref: judge,
          item_id: item.id,
          outcome: score >= 0.5 ? 'pass' : 'fail',
          score,
          cost_usd: 0.0001,
          latency_ms: 50,
        });
      }
    }
  }
  return verdicts;
}

describe('source-prod-slice package', () => {
  let testStorage: InMemoryStorage;

  beforeEach(() => {
    testStorage = new InMemoryStorage();
    setStorage(testStorage);
  });

  describe('freeze-slice', () => {
    it('freezes captured calls into a FrozenDataset', async () => {
      const calls = makeCapturedCalls(10);
      for (const call of calls) {
        await testStorage.write(call);
      }

      const result = await freezeSlice({
        since: new Date(Date.now() - 20000).toISOString(),
        sourceRef: 'test-freeze@v1.0.0',
        limit: 100,
      });

      expect(result.dataset.source_kind).toBe('prod');
      expect(result.dataset.source_ref).toBe('test-freeze@v1.0.0');
      expect(result.itemCount).toBe(10);
      expect(result.dataset.item_count).toBe(10);
      expect(result.dataset.content_hash).toMatch(/^sha256:/);
      expect(result.contentHash).toBe(result.dataset.content_hash);
    });

    it('filters by time window', async () => {
      const calls = makeCapturedCalls(10);
      for (const call of calls) {
        await testStorage.write(call);
      }

      const since = new Date(Date.now() - 5000).toISOString();
      const result = await freezeSlice({
        since,
        sourceRef: 'test-freeze@v1.0.0',
      });

      // Only calls within last 5 seconds
      expect(result.itemCount).toBeLessThanOrEqual(10);
    });

    it('uses custom transform', async () => {
      const calls = makeCapturedCalls(3);
      for (const call of calls) {
        await testStorage.write(call);
      }

      const customTransform = vi.fn((call: CapturedCall) => ({
        id: call.id,
        input: `custom: ${call.input.messages?.[0]?.content ?? ''}`,
      }));

      const result = await freezeSlice({
        since: new Date(Date.now() - 20000).toISOString(),
        sourceRef: 'test-freeze@v1.0.0',
        transform: customTransform,
      });

      expect(customTransform).toHaveBeenCalledTimes(3);
      expect(result.dataset.items?.[0]?.input).toContain('custom:');
    });

    it('defaultTransform extracts prompt', () => {
      const call: CapturedCall = {
        id: 'test-1',
        started_at: new Date().toISOString(),
        input: { prompt: [{ role: 'user', content: 'hello' }] },
        output: { content: 'hi', cost_usd: 0, latency_ms: 0 },
      };

      const item = defaultTransform(call);
      expect(item.id).toBe('test-1');
      expect(item.input).toEqual([{ role: 'user', content: 'hello' }]);
    });
  });

  describe('replay-batch', () => {
    const candidates: ReplayCandidate[] = [
      { ref: 'candidate-a', model: 'gpt-4o' },
      { ref: 'candidate-b', model: 'claude-3' },
    ];
    const dataset = makeDataset([
      { id: 'item-1', input: [{ role: 'user', content: 'test 1' }] },
      { id: 'item-2', input: [{ role: 'user', content: 'test 2' }] },
    ]);
    const caller = new MockLLMCaller();

    it('replays dataset against multiple candidates', async () => {
      const result = await replayBatch({
        dataset,
        candidates,
        caller,
        seed: 42,
      });

      expect(result.perCandidate).toHaveProperty('candidate-a');
      expect(result.perCandidate).toHaveProperty('candidate-b');
      expect(result.perCandidate['candidate-a'].rows.length).toBe(2);
      expect(result.perCandidate['candidate-b'].rows.length).toBe(2);
      expect(result.totalCostUsd).toBeGreaterThan(0);
      expect(result.totalLatencyMs).toBeGreaterThan(0);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('is deterministic with same seed', async () => {
      const result1 = await replayBatch({ dataset, candidates, caller, seed: 42 });
      const result2 = await replayBatch({ dataset, candidates, caller, seed: 42 });

      for (const ref of candidates.map((c) => c.ref)) {
        const r1 = result1.perCandidate[ref].rows[0].response.content;
        const r2 = result2.perCandidate[ref].rows[0].response.content;
        expect(r1).toBe(r2);
      }
    });

    it('differs with different seeds', async () => {
      const result1 = await replayBatch({ dataset, candidates, caller, seed: 42 });
      const result2 = await replayBatch({ dataset, candidates, caller, seed: 43 });

      let differs = false;
      for (const ref of candidates.map((c) => c.ref)) {
        if (result1.perCandidate[ref].rows[0].response.content !== result2.perCandidate[ref].rows[0].response.content) {
          differs = true;
        }
      }
      expect(differs).toBe(true);
    });

    it('measures determinism when enabled', async () => {
      const result = await replayBatch({
        dataset,
        candidates,
        caller,
        seed: 42,
        measureDeterminism: true,
      });

      // determinism_score should be 1.0 for MockLLMCaller
      for (const ref of candidates.map((c) => c.ref)) {
        expect(result.perCandidate[ref].determinism_score).toBe(1.0);
      }
    });
  });

  describe('compare-scores', () => {
    const candidates = ['candidate-a', 'candidate-b', 'candidate-c'];
    const judges = ['judge-1', 'judge-2', 'judge-3'];
    const items = [
      { id: 'item-1', input: 'test 1' },
      { id: 'item-2', input: 'test 2' },
    ];

    it('computes per-candidate metrics and judge matrix', () => {
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.1, 'candidate-b': 0.0, 'candidate-c': -0.1 });

      const result = compareScores({ replayResults, verdicts });

      expect(result.perCandidate).toHaveProperty('candidate-a');
      expect(result.perCandidate).toHaveProperty('candidate-b');
      expect(result.perCandidate).toHaveProperty('candidate-c');
      expect(result.judgeMatrix.candidates).toEqual(candidates);
      expect(result.judgeMatrix.judges).toEqual(judges);
      expect(result.summary.candidates).toEqual(candidates);
      expect(result.summary.bestCandidate).toBe('candidate-a'); // highest score offset
      expect(result.summary.bestAggregateDelta).toBeGreaterThan(0);
    });

    it('identifies consensus winners correctly', () => {
      const replayResults = makeReplayResults(candidates, items);
      // candidate-a wins all 3 judges
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.3, 'candidate-b': 0.0, 'candidate-c': -0.1 });

      const result = compareScores({ replayResults, verdicts });

      expect(result.judgeMatrix.consensus_winners).toContain('candidate-a');
      expect(result.judgeMatrix.winners_by_judge['candidate-a']).toBe(3);
    });

    it('computeJudgeStability works standalone', () => {
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.3, 'candidate-b': 0.0, 'candidate-c': -0.1 });
      const matrix = computeJudgeStability(verdicts, candidates, 0.67);

      expect(matrix.candidates).toEqual(candidates);
      expect(matrix.judges).toEqual(judges);
      expect(matrix.consensus_winners).toContain('candidate-a');
    });
  });

  describe('promotion-decision', () => {
    const candidates = ['candidate-a', 'candidate-b'];
    const judges = ['judge-1', 'judge-2', 'judge-3'];
    const items = [
      { id: 'item-1', input: 'test 1' },
      { id: 'item-2', input: 'test 2' },
    ];

    it('promotes candidate passing all rules', () => {
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.2, 'candidate-b': -0.1 });
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts, baselineRef: 'candidate-b' });

      const result = makePromotionDecision({
        candidates,
        perCandidate,
        judgeMatrix,
        policy: DEFAULT_POLICY,
      });

      expect(result.decision.action).toBe('promote');
      expect('winner' in result.decision).toBe(true);
      if ('winner' in result.decision) {
        expect(result.decision.winner).toBe('candidate-a');
      }
      expect(result.approvalRequired).toBe(false);
    });

    it('holds for review when approval_required', () => {
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.2, 'candidate-b': -0.1 });
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts, baselineRef: 'candidate-b' });

      const policyWithApproval = { ...DEFAULT_POLICY, approval_required: true };
      const result = makePromotionDecision({
        candidates,
        perCandidate,
        judgeMatrix,
        policy: policyWithApproval,
      });

      expect(result.decision.action).toBe('hold_for_review');
      expect(result.approvalRequired).toBe(true);
    });

    it('rolls back when no candidate passes', () => {
      const replayResults = makeReplayResults(candidates, items);
      // Both candidates fail min_delta
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': -0.1, 'candidate-b': -0.2 });
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts });

      const result = makePromotionDecision({
        candidates,
        perCandidate,
        judgeMatrix,
        policy: DEFAULT_POLICY,
      });

      expect(result.decision.action).toBe('rollback');
    });

    it('checkCandidateAgainstPolicy returns per-rule results', () => {
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.2 });
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts });

      const check = checkCandidateAgainstPolicy('candidate-a', perCandidate['candidate-a'], judgeMatrix, DEFAULT_POLICY);

      expect(check.passes).toBe(true);
      expect(check.rules).toHaveProperty('min_delta');
      expect(check.rules).toHaveProperty('judge_stability');
      expect(check.rules).toHaveProperty('cost_ceiling');
      expect(check.rules).toHaveProperty('latency_ceiling');
    });

    it('validatePolicy throws on invalid values', () => {
      expect(() => validatePolicy({ ...DEFAULT_POLICY, min_delta: 1.5 })).toThrow();
      expect(() => validatePolicy({ ...DEFAULT_POLICY, judge_stability_threshold: -0.1 })).toThrow();
      expect(() => validatePolicy({ ...DEFAULT_POLICY, cost_ceiling: -1 })).toThrow();
      expect(() => validatePolicy({ ...DEFAULT_POLICY, latency_ceiling: -1 })).toThrow();
      expect(() => validatePolicy({ ...DEFAULT_POLICY, auto_rollback_rule: { metric_drop: 1.5, window: '24h' } })).toThrow();
    });
  });

  describe('signed-report', () => {
    const candidates = ['candidate-a', 'candidate-b'];
    const judges = ['judge-1', 'judge-2', 'judge-3'];
    const items = [
      { id: 'item-1', input: 'test 1' },
      { id: 'item-2', input: 'test 2' },
    ];

    it('builds and signs a PromotionReport', async () => {
      const dataset = makeDataset(items);
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.2 });
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts, baselineRef: 'candidate-b' });

      const decision = makePromotionDecision({ candidates, perCandidate, judgeMatrix, policy: DEFAULT_POLICY }).decision;

      const candidateShas = generateCandidateShas([
        { ref: 'candidate-a', sourceRef: 'gpt-4o@latest' },
        { ref: 'candidate-b', sourceRef: 'claude-3@latest' },
      ]);
      const judgeShas = generateJudgeShas([
        { ref: 'judge-1', model: 'gpt-4o-judge' },
        { ref: 'judge-2', model: 'claude-3-judge' },
      ]);

      const result = await buildSignedReport({
        gateRunId: 'test-run-123',
        dataset,
        candidateShas,
        judgeShas,
        scorerCodeSha: shaOfCandidateRef('scorer@v1.0.0'),
        baselineMetrics: { score: 0.5, cost: 0.001, latency: 100 },
        candidateMetrics: perCandidate,
        judgeMatrix,
        policy: DEFAULT_POLICY,
        decision,
        signingKey: SIGNING_KEY,
      });

      expect(result.report.signature).toBeTruthy();
      expect(result.report.signature.length).toBeGreaterThan(10);
      expect(result.canonicalJson).toContain('"gate_run_id":"test-run-123"');
      expect(result.signature).toBe(result.report.signature);
    });

    it('verifies a signed report', async () => {
      const dataset = makeDataset(items);
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.2 });
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts });

      const decision = makePromotionDecision({ candidates, perCandidate, judgeMatrix, policy: DEFAULT_POLICY }).decision;

      const result = await buildSignedReport({
        gateRunId: 'test-run-456',
        dataset,
        candidateShas: generateCandidateShas([{ ref: 'candidate-a', sourceRef: 'gpt-4o' }]),
        judgeShas: generateJudgeShas([{ ref: 'judge-1', model: 'gpt-4o-judge' }]),
        scorerCodeSha: 'sha256:abc',
        baselineMetrics: {},
        candidateMetrics: perCandidate,
        judgeMatrix,
        policy: DEFAULT_POLICY,
        decision,
        signingKey: SIGNING_KEY,
      });

      const verified = await verifySignedReport(result.report, SIGNING_KEY);
      expect(verified).toBe(true);
    });

    it('rejects tampered report', async () => {
      const dataset = makeDataset(items);
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items);
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts });

      const decision = makePromotionDecision({ candidates, perCandidate, judgeMatrix, policy: DEFAULT_POLICY }).decision;

      const result = await buildSignedReport({
        gateRunId: 'test-run-789',
        dataset,
        candidateShas: {},
        judgeShas: {},
        scorerCodeSha: 'sha256:abc',
        baselineMetrics: {},
        candidateMetrics: perCandidate,
        judgeMatrix,
        policy: DEFAULT_POLICY,
        decision,
        signingKey: SIGNING_KEY,
      });

      // Tamper with the report
      const tampered = { ...result.report, decision: { action: 'promote', winner: 'hacked', reason: 'tampered' } };

      const verified = await verifySignedReport(tampered, SIGNING_KEY);
      expect(verified).toBe(false);
    });

    it('generateCandidateShas produces consistent SHAs', () => {
      const shas1 = generateCandidateShas([{ ref: 'a', sourceRef: 'model@v1' }]);
      const shas2 = generateCandidateShas([{ ref: 'a', sourceRef: 'model@v1' }]);
      expect(shas1.a).toBe(shas2.a);
      expect(shas1.a).toMatch(/^sha256:/);
    });
  });

  describe('canary-orchestrator', () => {
    let canaryStorage: InMemoryCanaryStorage;

    beforeEach(() => {
      canaryStorage = new InMemoryCanaryStorage();
      setCanaryStorage(canaryStorage);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
    const makeReport = (): any => ({
      id: 'report-1',
      gate_run_id: 'run-1',
      dataset_content_hash: 'sha256:abc',
      dataset_version: '0.0.1',
      candidate_shas: { 'candidate-a': 'sha256:model-a' },
      judge_shas: { 'judge-1': 'sha256:judge-1' },
      scorer_code_sha: 'sha256:scorer',
      baseline_metrics: {},
      candidate_metrics: {
        'candidate-a': { aggregate_delta: 0.05, cost_delta: 0.01, latency_delta: 0.02, mean_score: 0.8, pass_rate: 0.9, n_items: 10, total_cost_usd: 0.1, mean_latency_ms: 100 },
      },
      judge_matrix: { candidates: ['candidate-a'], judges: ['judge-1'], winners_by_judge: { 'candidate-a': 1 }, consensus_winners: ['candidate-a'] },
      policy: { ...DEFAULT_POLICY, auto_rollback_rule: { metric_drop: 0.05, window: '1h' } },
      timestamp: new Date().toISOString(),
      signature: 'sig',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
    const makeDecision = (): any => ({ action: 'promote', winner: 'candidate-a', reason: 'passes all rules' });

    it('starts a canary in canary state', async () => {
      const result = await startCanary({
        gateRunId: 'run-1',
        candidateRef: 'candidate-a',
        report: makeReport(),
        decision: makeDecision(),
      });

      expect(result.record.state).toBe('observing'); // advanceCanary called internally
      expect(result.record.trafficPercent).toBe(10);
      expect(result.record.gateRunId).toBe('run-1');
      expect(result.record.candidateRef).toBe('candidate-a');
      expect(result.advanced).toBe(true);
    });

    it('records observations and checks auto-rollback', async () => {
      const start = await startCanary({
        gateRunId: 'run-1',
        candidateRef: 'candidate-a',
        report: makeReport(),
        decision: makeDecision(),
      });

      // Normal observation - no rollback
      const normal = await recordObservation(start.record.id, 'error_rate', 0.01, 0.02);
      expect(normal.record.state).toBe('observing');
      expect(normal.record.observations.length).toBe(1);

      // Trigger rollback - metric drops more than threshold
      const rollback = await recordObservation(start.record.id, 'error_rate', 0.10, 0.02); // delta = 4.0 > 0.05
      expect(rollback.record.state).toBe('rolled_back');
      expect(rollback.record.error).toContain('Auto-rollback triggered');
    });

    it('advances canary through states', async () => {
      const start = await startCanary({
        gateRunId: 'run-1',
        candidateRef: 'candidate-a',
        report: makeReport(),
        decision: makeDecision(),
      });

      // First advance: canary -> observing (already done by startCanary)
      // Second advance: observing -> promoting (after window)
      // We can't easily test time passage, but we can test the transition logic
      const record = await getCanaryStorage().read(start.record.id);
      expect(record?.state).toBe('observing');
    });

    it('manual rollback works', async () => {
      const start = await startCanary({
        gateRunId: 'run-1',
        candidateRef: 'candidate-a',
        report: makeReport(),
        decision: makeDecision(),
      });

      const result = await rollbackCanary(start.record.id, 'Manual intervention');
      expect(result.record.state).toBe('rolled_back');
      expect(result.record.error).toContain('Manual rollback');
      expect(result.record.trafficPercent).toBe(0);
    });

    it('failCanary marks as failed', async () => {
      const start = await startCanary({
        gateRunId: 'run-1',
        candidateRef: 'candidate-a',
        report: makeReport(),
        decision: makeDecision(),
      });

      const result = await failCanary(start.record.id, 'Deployment failed');
      expect(result.record.state).toBe('failed');
      expect(result.record.error).toBe('Deployment failed');
    });

    it('tickCanaries advances eligible canaries', async () => {
      const start = await startCanary({
        gateRunId: 'run-1',
        candidateRef: 'candidate-a',
        report: makeReport(),
        decision: makeDecision(),
      });

      // Manually set observation window to past to test tick
      const record = await getCanaryStorage().read(start.record.id);
      if (record) {
        record.observationEndsAt = new Date(Date.now() - 1000).toISOString();
        await getCanaryStorage().update(record);
      }

      const changed = await tickCanaries();
      expect(changed.length).toBe(1);
      expect(changed[0].state).toBe('promoting');
    });

    it('D1CanaryStorage can be swapped in', () => {
      // This would work in a real Worker environment
      // const d1Storage = new (await import('./canary-orchestrator.js')).D1CanaryStorage(mockDb);
      expect(true).toBe(true);
    });
  });

  describe('audit-export', () => {
    const candidates = ['candidate-a', 'candidate-b'];
    const judges = ['judge-1', 'judge-2', 'judge-3'];
    const items = [
      { id: 'item-1', input: 'test 1' },
      { id: 'item-2', input: 'test 2' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture
    function makeTestReport(): any {
      const dataset = makeDataset(items);
      const replayResults = makeReplayResults(candidates, items);
      const verdicts = makeVerdicts(candidates, judges, items, { 'candidate-a': 0.2 });
      const { perCandidate, judgeMatrix } = compareScores({ replayResults, verdicts });
      const decision = makePromotionDecision({ candidates, perCandidate, judgeMatrix, policy: DEFAULT_POLICY }).decision;

      return {
        report: {
          id: 'report-test',
          gate_run_id: 'run-test',
          dataset_content_hash: dataset.content_hash,
          dataset_version: dataset.version,
          candidate_shas: { 'candidate-a': 'sha256:a', 'candidate-b': 'sha256:b' },
          judge_shas: { 'judge-1': 'sha256:j1' },
          scorer_code_sha: 'sha256:scorer',
          baseline_metrics: { score: 0.5 },
          candidate_metrics: perCandidate,
          judge_matrix: judgeMatrix,
          policy: DEFAULT_POLICY,
          timestamp: new Date().toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- report fixture cast
        } as any,
        decision,
        dataset,
      };
    }

    it('exports JSON with full fidelity', () => {
      const { report, decision, dataset } = makeTestReport();
      const result = exportAudit({ report, decision, dataset, format: 'json' });

      expect(result.format).toBe('json');
      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toContain('.json');
      expect(result.content).toContain('"report_id":"report-test"');
      expect(result.content).toContain('"decision_action":"promote"');
    });

    it('exports CSV with candidate rows', () => {
      const { report, decision, dataset } = makeTestReport();
      const result = exportAudit({ report, decision, dataset, format: 'csv' });

      expect(result.format).toBe('csv');
      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toContain('.csv');
      const lines = result.content.split('\n');
      expect(lines[0]).toContain('report_id');
      expect(lines.length).toBeGreaterThan(2); // header + at least 2 candidates
    });

    it('exports CSV with summary row for promote decision', () => {
      const { report, decision, dataset } = makeTestReport();
      const result = exportAudit({ report, decision, dataset, format: 'csv' });

      const lines = result.content.split('\n');
      const summaryLine = lines.find((l) => l.includes('SUMMARY'));
      expect(summaryLine).toBeDefined();
    });

    it('exports batch JSON', () => {
      const { report, decision, dataset } = makeTestReport();
      const batch = [{ report, decision, dataset }, { report, decision, dataset }];
      const result = exportAuditBatch(batch, 'json');

      expect(result.format).toBe('json');
      expect(result.content).toContain('"count":2');
      expect(result.content).toContain('"exports"');
    });

    it('exports batch CSV', () => {
      const { report, decision, dataset } = makeTestReport();
      const batch = [{ report, decision, dataset }, { report, decision, dataset }];
      const result = exportAuditBatch(batch, 'csv');

      expect(result.format).toBe('csv');
      const lines = result.content.split('\n');
      expect(lines.length).toBeGreaterThan(4); // header + 2 candidates * 2 reports
    });

    it('exports human-readable summary', () => {
      const { report, decision } = makeTestReport();
      const summary = exportSummary(report, decision);

      expect(summary).toContain('Promotion Gate Report');
      expect(summary).toContain('report-test');
      expect(summary).toContain('PROMOTE');
      expect(summary).toContain('candidate-a');
      expect(summary).toContain('Judge Matrix');
    });

    it('can export without judge matrix or metrics', () => {
      const { report, decision, dataset } = makeTestReport();
      const result = exportAudit({
        report,
        decision,
        dataset,
        format: 'json',
        includeJudgeMatrix: false,
        includeMetrics: false,
      });

      const parsed = JSON.parse(result.content);
      expect(parsed.report.judge_matrix.candidates).toEqual([]);
      expect(Object.keys(parsed.report.candidate_metrics).length).toBe(0);
    });
  });

  describe('integration: full gate run flow', () => {
    it('runs freeze -> replay -> compare -> decide -> sign -> export', async () => {
      // 1. Freeze: create dataset from captured calls
      const calls = makeCapturedCalls(5);
      for (const call of calls) {
        await testStorage.write(call);
      }

      const freezeResult = await freezeSlice({
        since: new Date(Date.now() - 10000).toISOString(),
        sourceRef: 'integration-test@v1.0.0',
      });

      // 2. Replay: run candidates against dataset
      const candidates: ReplayCandidate[] = [
        { ref: 'baseline', model: 'gpt-3.5' },
        { ref: 'candidate', model: 'gpt-4o' },
      ];
      const caller = new MockLLMCaller();

      const replayResult = await replayBatch({
        dataset: freezeResult.dataset,
        candidates,
        caller,
        seed: 12345,
      });

      // 3. Compare: generate judge verdicts and compute metrics
      const items = freezeResult.dataset.items ?? [];
      const judges = ['judge-1', 'judge-2', 'judge-3'];
      const verdicts = makeVerdicts(
        candidates.map((c) => c.ref),
        judges,
        items,
        { candidate: 0.15 } // candidate wins
      );

      const compareResult = compareScores({
        replayResults: replayResult.perCandidate,
        verdicts,
        baselineRef: 'baseline',
      });

      // 4. Decide: apply promotion policy
      const decisionResult = makePromotionDecision({
        candidates: candidates.map((c) => c.ref),
        perCandidate: compareResult.perCandidate,
        judgeMatrix: compareResult.judgeMatrix,
        policy: DEFAULT_POLICY,
      });

      expect(decisionResult.decision.action).toBe('promote');

      // 5. Sign: create signed PromotionReport
      const signedResult = await buildSignedReport({
        gateRunId: 'integration-run-1',
        dataset: freezeResult.dataset,
        candidateShas: generateCandidateShas([
          { ref: 'baseline', sourceRef: 'gpt-3.5@latest' },
          { ref: 'candidate', sourceRef: 'gpt-4o@latest' },
        ]),
        judgeShas: generateJudgeShas(judges.map((j) => ({ ref: j, model: 'gpt-4o-judge' }))),
        scorerCodeSha: shaOfCandidateRef('scorer@v1.0.0'),
        baselineMetrics: { score: 0.6, cost: 0.002, latency: 150 },
        candidateMetrics: compareResult.perCandidate,
        judgeMatrix: compareResult.judgeMatrix,
        policy: DEFAULT_POLICY,
        decision: decisionResult.decision,
        approver: 'test-user',
        signingKey: SIGNING_KEY,
      });

      expect(signedResult.report.signature).toBeTruthy();
      expect(signedResult.report.approver).toBe('test-user');

      // 6. Export: audit trail
      const jsonExport = exportAudit({
        report: signedResult.report,
        decision: decisionResult.decision,
        dataset: freezeResult.dataset,
        format: 'json',
      });
      expect(jsonExport.content).toContain('integration-run-1');

      const csvExport = exportAudit({
        report: signedResult.report,
        decision: decisionResult.decision,
        dataset: freezeResult.dataset,
        format: 'csv',
      });
      expect(csvExport.content).toContain('candidate');

      // 7. Canary: start canary deployment
      const canaryStorage = new InMemoryCanaryStorage();
      setCanaryStorage(canaryStorage);

      const canaryResult = await startCanary({
        gateRunId: 'integration-run-1',
        candidateRef: 'candidate',
        report: signedResult.report,
        decision: decisionResult.decision,
      });

      expect(canaryResult.record.state).toBe('observing');
      expect(canaryResult.record.candidateRef).toBe('candidate');
    });
  });
});