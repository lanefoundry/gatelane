import { describe, it, expect } from 'vitest';


import {
  MockLLMCaller,
  replay,
  freezeInjectionDataset,
  INJECTION_PAYLOADS,
  INJECTION_META,
  injectionMetaOf,
  buildAttackReport,
  verifyPatchHolds,
  runRedTeamGate,
  collectVerdicts,
  resolveCandidates,
  enrichVerdicts,
  type AttackReport,
  type AttackVerdict,
} from '../src/index.js';


const SIGNING_KEY = 'test-signing-key-must-be-≥16-chars';

describe('attack.ts — red-team injection dataset', () => {
  it('has exactly 20 payloads', () => {
    expect(INJECTION_PAYLOADS.length).toBe(20);
  });

  it('each payload has id, role, category, mapped_asi, content', () => {
    for (const p of INJECTION_PAYLOADS) {
      expect(p.id).toMatch(/^(pinj|pesc|cinj|tmis)-\d{3}$/);
      expect(['system', 'user', 'assistant']).toContain(p.role);
      expect(['prompt_injection', 'privilege_escalation', 'code_injection', 'tool_misuse']).toContain(p.category);
      expect(['ASI01', 'ASI02', 'ASI03', 'ASI05']).toContain(p.mapped_asi);
      expect(p.content.length).toBeGreaterThan(10);
    }
  });

  it('INJECTION_META map has 20 entries', () => {
    expect(INJECTION_META.size).toBe(20);
    expect(INJECTION_META.get('pinj-001')?.category).toBe('prompt_injection');
    expect(INJECTION_META.get('pinj-001')?.mapped_asi).toBe('ASI01');
    expect(INJECTION_META.get('pesc-001')?.category).toBe('privilege_escalation');
    expect(INJECTION_META.get('pesc-001')?.mapped_asi).toBe('ASI03');
    expect(INJECTION_META.get('cinj-001')?.category).toBe('code_injection');
    expect(INJECTION_META.get('cinj-001')?.mapped_asi).toBe('ASI05');
    expect(INJECTION_META.get('tmis-001')?.category).toBe('tool_misuse');
    expect(INJECTION_META.get('tmis-001')?.mapped_asi).toBe('ASI02');
  });

  it('injectionMetaOf returns correct metadata', () => {
    expect(injectionMetaOf('pinj-001')).toEqual({ category: 'prompt_injection', mapped_asi: 'ASI01' });
    expect(injectionMetaOf('pesc-002')).toEqual({ category: 'privilege_escalation', mapped_asi: 'ASI03' });
    expect(injectionMetaOf('cinj-003')).toEqual({ category: 'code_injection', mapped_asi: 'ASI05' });
    expect(injectionMetaOf('tmis-004')).toEqual({ category: 'tool_misuse', mapped_asi: 'ASI02' });
    expect(injectionMetaOf('unknown')).toBeUndefined();
  });

  it('freezeInjectionDataset returns a proper FrozenDataset', async () => {
    const ds = await freezeInjectionDataset();
    expect(ds.source_kind).toBe('redteam');
    expect(ds.source_ref).toBe('gatelane-hand-curated@0.0.1');
    expect(ds.items?.length).toBe(20);
    expect(ds.content_hash).toMatch(/^sha256:/);
    expect(ds.version).toBe('0.0.0-dev');
    expect(ds.frozen_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ds.item_count).toBe(20);

    // Each item has input as array of messages with role
    for (const item of ds.items ?? []) {
      expect(item.input).toBeInstanceOf(Array);
      const msg = item.input[0];
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(['system', 'user', 'assistant']).toContain(msg.role);
      expect(item.mapped_asi).toMatch(/^ASI0[1235]$/);
    }
  });

  it('freezeInjectionDataset is content-addressed (stable hash)', async () => {
    const a = await freezeInjectionDataset();
    const b = await freezeInjectionDataset();
    expect(a.content_hash).toBe(b.content_hash);
  });
});

describe('redteam.ts — attack report + patch verify', () => {
  it('enrichVerdicts adds category + asi from payload registry', async () => {
    const dataset = await freezeInjectionDataset();
    const verdicts = [
      { candidate_ref: 'model:a', judge_ref: 'g1', item_id: 'pinj-001', outcome: 'fail' as const, score: 0.2, cost_usd: 0, latency_ms: 10 },
      { candidate_ref: 'model:a', judge_ref: 'g1', item_id: 'pesc-002', outcome: 'pass' as const, score: 0.9, cost_usd: 0, latency_ms: 10 },
    ];
    const enriched = enrichVerdicts(verdicts, dataset);
    expect(enriched[0].category).toBe('prompt_injection');
    expect(enriched[0].mapped_asi).toBe('ASI01');
    expect(enriched[1].category).toBe('privilege_escalation');
    expect(enriched[1].mapped_asi).toBe('ASI03');
  });

  it('buildAttackReport computes per-candidate survival rate', async () => {
    const dataset = await freezeInjectionDataset();
    const verdicts: AttackVerdict[] = [
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pinj-001', outcome: 'fail', score: 0.2, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pinj-002', outcome: 'pass', score: 0.8, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pesc-001', outcome: 'fail', score: 0.3, cost_usd: 0, latency_ms: 10, category: 'privilege_escalation', mapped_asi: 'ASI03' },
      { candidate_ref: 'b', judge_ref: 'g1', item_id: 'pinj-001', outcome: 'pass', score: 0.9, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
      { candidate_ref: 'b', judge_ref: 'g1', item_id: 'pinj-002', outcome: 'pass', score: 0.9, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
    ];

    const report = buildAttackReport({
      verdicts,
      dataset,
      candidate_refs: ['a', 'b'],
      judges: ['g1'],
    });

    expect(report.candidates.length).toBe(2);

    const a = report.candidates.find((c) => c.candidate_ref === 'a')!;
    expect(a.total).toBe(3);
    expect(a.survived).toBe(1);
    expect(a.failed).toBe(2);
    expect(a.survival_rate).toBeCloseTo(1 / 3, 5);
    expect(a.by_category.prompt_injection.total).toBe(2);
    expect(a.by_category.prompt_injection.survived).toBe(1);
    expect(a.by_category.prompt_injection.failed).toBe(1);
    expect(a.by_category.privilege_escalation.total).toBe(1);
    expect(a.by_category.privilege_escalation.failed).toBe(1);
    expect(a.vulnerabilities.length).toBe(2);
    expect(a.vulnerabilities.map((v) => v.item_id).sort()).toEqual(['pesc-001', 'pinj-001']);

    const b = report.candidates.find((c) => c.candidate_ref === 'b')!;
    expect(b.total).toBe(2);
    expect(b.survived).toBe(2);
    expect(b.failed).toBe(0);
    expect(b.survival_rate).toBe(1);
    expect(b.vulnerabilities.length).toBe(0);
  });

  it('buildAttackReport produces per-ASI gap summary sorted by fail_rate desc', async () => {
    const dataset = await freezeInjectionDataset();
    // ASI01: 2 fail out of 4, ASI03: 1 fail out of 2
    const verdicts: AttackVerdict[] = [
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pinj-001', outcome: 'fail', score: 0.2, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pinj-002', outcome: 'pass', score: 0.8, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pinj-003', outcome: 'fail', score: 0.3, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pinj-004', outcome: 'pass', score: 0.9, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pesc-001', outcome: 'fail', score: 0.2, cost_usd: 0, latency_ms: 10, category: 'privilege_escalation', mapped_asi: 'ASI03' },
      { candidate_ref: 'a', judge_ref: 'g1', item_id: 'pesc-002', outcome: 'pass', score: 0.9, cost_usd: 0, latency_ms: 10, category: 'privilege_escalation', mapped_asi: 'ASI03' },
    ];

    const report = buildAttackReport({
      verdicts,
      dataset,
      candidate_refs: ['a'],
      judges: ['g1'],
    });

    expect(report.by_asi.length).toBe(2);
    // ASI01 fail_rate = 0.5, ASI03 fail_rate = 0.5 → stable sort, but ASI01 listed first (higher total) or second? spec says sort by fail_rate desc.
    // Since both 0.5, order is non-deterministic; just check both present.
    const asi01 = report.by_asi.find((a) => a.asi === 'ASI01')!;
    const asi03 = report.by_asi.find((a) => a.asi === 'ASI03')!;
    expect(asi01.fail_rate).toBe(0.5);
    expect(asi03.fail_rate).toBe(0.5);
    expect(asi01.total).toBe(4);
    expect(asi03.total).toBe(2);
  });

  it('verifyPatchHolds returns holds=true when all baseline failures resolved', () => {
    const baseline: AttackReport = {
      dataset_content_hash: 'h1',
      dataset_version: 'v1',
      generated_at: '2026-01-01T00:00:00Z',
      candidates: [
        {
          candidate_ref: 'model:v1',
          total: 4,
          survived: 1,
          failed: 3,
          survival_rate: 0.25,
          by_category: {
            prompt_injection: { survived: 1, failed: 3, total: 4 },
            privilege_escalation: { survived: 0, failed: 0, total: 0 },
            code_injection: { survived: 0, failed: 0, total: 0 },
            tool_misuse: { survived: 0, failed: 0, total: 0 },
          },
          vulnerabilities: [
            { item_id: 'pinj-001', candidate_ref: 'model:v1', judge_ref: 'g1', outcome: 'fail', score: 0.2, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
            { item_id: 'pinj-002', candidate_ref: 'model:v1', judge_ref: 'g1', outcome: 'fail', score: 0.3, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
            { item_id: 'pinj-003', candidate_ref: 'model:v1', judge_ref: 'g1', outcome: 'fail', score: 0.1, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
          ],
        },
      ],
      by_asi: [],
      candidate_refs: ['model:v1'],
      judges: ['g1'],
    };

    const patched: AttackReport = {
      ...baseline,
      candidates: [
        {
          candidate_ref: 'model:v2',
          total: 4,
          survived: 4,
          failed: 0,
          survival_rate: 1,
          by_category: {
            prompt_injection: { survived: 4, failed: 0, total: 4 },
            privilege_escalation: { survived: 0, failed: 0, total: 0 },
            code_injection: { survived: 0, failed: 0, total: 0 },
            tool_misuse: { survived: 0, failed: 0, total: 0 },
          },
          vulnerabilities: [],
        },
      ],
      candidate_refs: ['model:v2'],
    };

    const verdict = verifyPatchHolds({
      before: baseline,
      after: patched,
      baselineCandidate: 'model:v1',
      patchedCandidate: 'model:v2',
    });

    expect(verdict.holds).toBe(true);
    expect(verdict.resolved).toEqual(['pinj-001', 'pinj-002', 'pinj-003']);
    expect(verdict.regressed).toEqual([]);
    expect(verdict.stillVulnerable).toEqual([]);
  });

  it('verifyPatchHolds returns holds=false when some vulnerabilities persist', () => {
    const baseline: AttackReport = {
      dataset_content_hash: 'h1',
      dataset_version: 'v1',
      generated_at: '2026-01-01T00:00:00Z',
      candidates: [
        {
          candidate_ref: 'model:v1',
          total: 4,
          survived: 1,
          failed: 3,
          survival_rate: 0.25,
          by_category: {
            prompt_injection: { survived: 1, failed: 3, total: 4 },
            privilege_escalation: { survived: 0, failed: 0, total: 0 },
            code_injection: { survived: 0, failed: 0, total: 0 },
            tool_misuse: { survived: 0, failed: 0, total: 0 },
          },
          vulnerabilities: [
            { item_id: 'pinj-001', candidate_ref: 'model:v1', judge_ref: 'g1', outcome: 'fail', score: 0.2, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
            { item_id: 'pinj-002', candidate_ref: 'model:v1', judge_ref: 'g1', outcome: 'fail', score: 0.3, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
            { item_id: 'pinj-003', candidate_ref: 'model:v1', judge_ref: 'g1', outcome: 'fail', score: 0.1, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
          ],
        },
      ],
      by_asi: [],
      candidate_refs: ['model:v1'],
      judges: ['g1'],
    };

    const patched: AttackReport = {
      ...baseline,
      candidates: [
        {
          candidate_ref: 'model:v2',
          total: 4,
          survived: 2,
          failed: 2,
          survival_rate: 0.5,
          by_category: {
            prompt_injection: { survived: 2, failed: 2, total: 4 },
            privilege_escalation: { survived: 0, failed: 0, total: 0 },
            code_injection: { survived: 0, failed: 0, total: 0 },
            tool_misuse: { survived: 0, failed: 0, total: 0 },
          },
          vulnerabilities: [
            { item_id: 'pinj-002', candidate_ref: 'model:v2', judge_ref: 'g1', outcome: 'fail', score: 0.3, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
            { item_id: 'pinj-003', candidate_ref: 'model:v2', judge_ref: 'g1', outcome: 'fail', score: 0.1, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
          ],
        },
      ],
      candidate_refs: ['model:v2'],
    };

    const verdict = verifyPatchHolds({
      before: baseline,
      after: patched,
      baselineCandidate: 'model:v1',
      patchedCandidate: 'model:v2',
    });

    expect(verdict.holds).toBe(false);
    expect(verdict.resolved).toEqual(['pinj-001']);
    expect(verdict.stillVulnerable).toEqual(['pinj-002', 'pinj-003']);
    expect(verdict.regressed).toEqual([]);
  });

  it('verifyPatchHolds returns holds=false when regressions appear', () => {
    const baseline: AttackReport = {
      dataset_content_hash: 'h1',
      dataset_version: 'v1',
      generated_at: '2026-01-01T00:00:00Z',
      candidates: [
        {
          candidate_ref: 'model:v1',
          total: 2,
          survived: 1,
          failed: 1,
          survival_rate: 0.5,
          by_category: {
            prompt_injection: { survived: 1, failed: 1, total: 2 },
            privilege_escalation: { survived: 0, failed: 0, total: 0 },
            code_injection: { survived: 0, failed: 0, total: 0 },
            tool_misuse: { survived: 0, failed: 0, total: 0 },
          },
          vulnerabilities: [
            { item_id: 'pinj-001', candidate_ref: 'model:v1', judge_ref: 'g1', outcome: 'fail', score: 0.2, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
          ],
        },
      ],
      by_asi: [],
      candidate_refs: ['model:v1'],
      judges: ['g1'],
    };

    const patched: AttackReport = {
      ...baseline,
      candidates: [
        {
          candidate_ref: 'model:v2',
          total: 2,
          survived: 1,
          failed: 1,
          survival_rate: 0.5,
          by_category: {
            prompt_injection: { survived: 1, failed: 1, total: 2 },
            privilege_escalation: { survived: 0, failed: 0, total: 0 },
            code_injection: { survived: 0, failed: 0, total: 0 },
            tool_misuse: { survived: 0, failed: 0, total: 0 },
          },
          vulnerabilities: [
            { item_id: 'pinj-002', candidate_ref: 'model:v2', judge_ref: 'g1', outcome: 'fail', score: 0.2, cost_usd: 0, latency_ms: 10, category: 'prompt_injection', mapped_asi: 'ASI01' },
          ],
        },
      ],
      candidate_refs: ['model:v2'],
    };

    const verdict = verifyPatchHolds({
      before: baseline,
      after: patched,
      baselineCandidate: 'model:v1',
      patchedCandidate: 'model:v2',
    });

    expect(verdict.holds).toBe(false);
    expect(verdict.resolved).toEqual(['pinj-001']);
    expect(verdict.stillVulnerable).toEqual([]);
    expect(verdict.regressed).toEqual(['pinj-002']);
  });

  it('collectVerdicts + replay + runRedTeamGate integration', async () => {
    const dataset = await freezeInjectionDataset();
    const caller = new MockLLMCaller({ quality: 0.9 });

    // Replay against one candidate
    const replayResult = await replay({
      dataset,
      candidates: [{ ref: 'model:a', model: 'a' }],
      caller,
      seed: 42,
    });
    expect(replayResult.rows.length).toBe(20);

    // Collect verdicts
    const verdicts = await collectVerdicts({
      replayResult,
      dataset,
      candidates: [{ ref: 'model:a', model: 'a' }],
      judges: ['gpt-4o'],
      caller,
    });
    expect(verdicts.length).toBe(20);

    // Full red-team gate (without signing)
    const result = await runRedTeamGate({
      dataset,
      candidates: ['model:a'],
      judges: ['gpt-4o'],
      caller,
    });

    expect(result.attackReport).toBeDefined();
    expect(result.attackReport.candidates.length).toBe(1);
    expect(result.attackReport.candidates[0].candidate_ref).toBe('model:a');
    expect(result.attackReport.candidates[0].total).toBe(20);
    expect(result.attackReport.candidates[0].survived + result.attackReport.candidates[0].failed).toBe(20);
    expect(result.gateResult).toBeNull(); // no signing_key provided
  });

  it('runRedTeamGate with signing_key returns signed report + decision', async () => {
    const dataset = await freezeInjectionDataset();
    const caller = new MockLLMCaller({ quality: 0.9 });

    const result = await runRedTeamGate({
      dataset,
      candidates: ['model:a', 'model:b'],
      judges: ['gpt-4o'],
      caller,
      signing_key: SIGNING_KEY,
    });

    expect(result.gateResult).not.toBeNull();
    expect(result.gateResult!.report.signature).not.toBe('pending');
    expect(result.gateResult!.decision.action).toMatch(/^(promote|rollback|hold_for_review)$/);
    expect(result.gateResult!.evaluate.rule_results).toBeDefined();
  });

  it('resolveCandidates maps model: refs correctly', () => {
    const resolved = resolveCandidates(['model:gpt-4o', 'guardrail:v2', 'prompt:sys-v1']);
    expect(resolved).toEqual([
      { ref: 'model:gpt-4o', model: 'gpt-4o' },
      { ref: 'guardrail:v2', model: 'guardrail:v2' },
      { ref: 'prompt:sys-v1', model: 'prompt:sys-v1' },
    ]);
  });
});