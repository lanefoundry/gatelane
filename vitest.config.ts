import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@lanefoundry/gatelane-sdk': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/index.ts',
      ),
      '@lanefoundry/gatelane-sdk/gate': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/gate.ts',
      ),
      '@lanefoundry/gatelane-sdk/dataset': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/dataset.ts',
      ),
      '@lanefoundry/gatelane-sdk/promotion': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/promotion.ts',
      ),
      '@lanefoundry/gatelane-sdk/candidate': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/candidate.ts',
      ),
      '@lanefoundry/gatelane-sdk/capture': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/capture.ts',
      ),
      '@lanefoundry/gatelane-sdk/storage': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/storage.ts',
      ),
      '@lanefoundry/gatelane-sdk/storage-http': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/storage-http.ts',
      ),
      '@lanefoundry/gatelane-sdk/storage-fs': resolve(
        import.meta.dirname,
        'packages/gatelane-sdk/src/storage-fs.ts',
      ),
      '@lanefoundry/gatelane-cli': resolve(
        import.meta.dirname,
        'packages/cli/src/cli.ts',
      ),
      '@lanefoundry/gatelane-worker': resolve(
        import.meta.dirname,
        'apps/worker/src/worker.ts',
      ),
      '@lanefoundry/gatelane-engine': resolve(
        import.meta.dirname,
        'packages/gatelane-engine/src/index.ts',
      ),
      '@lanefoundry/gatelane-engine/attack': resolve(
        import.meta.dirname,
        'packages/gatelane-engine/src/attack.ts',
      ),
      '@lanefoundry/gatelane-engine/redteam': resolve(
        import.meta.dirname,
        'packages/gatelane-engine/src/redteam.ts',
      ),
      '@lanefoundry/source-prod-slice': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/index.ts',
      ),
      '@lanefoundry/source-prod-slice/freeze-slice': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/freeze-slice.ts',
      ),
      '@lanefoundry/source-prod-slice/replay-batch': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/replay-batch.ts',
      ),
      '@lanefoundry/source-prod-slice/compare-scores': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/compare-scores.ts',
      ),
      '@lanefoundry/source-prod-slice/promotion-decision': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/promotion-decision.ts',
      ),
      '@lanefoundry/source-prod-slice/signed-report': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/signed-report.ts',
      ),
      '@lanefoundry/source-prod-slice/canary-orchestrator': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/canary-orchestrator.ts',
      ),
      '@lanefoundry/source-prod-slice/audit-export': resolve(
        import.meta.dirname,
        'packages/source-prod-slice/src/audit-export.ts',
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'apps/worker/tests/**/*.test.ts', 'packages/gatelane-engine/tests/**/*.test.ts', 'packages/source-prod-slice/tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});