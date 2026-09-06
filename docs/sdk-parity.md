# SDK Parity Matrix

**Drift here is a release-blocking bug.** The CI job
`tools/check-sdk-parity.mjs` exits non-zero if a public symbol exists
in one SDK without an equivalent in the other.

Update this table in the **same PR** that adds a new public surface
or ships a new SDK release. The script reads this file and asserts
each row against the SDK source.

Legend:

- **✓** shipped — symbol exists in source, has tests, has docs example
- **◯** scaffolded — code present but not all criteria met
- **·** planned — tracked for the next minor version
- **—** not applicable

## Capture

| Surface | JS SDK | Python SDK | Wire format |
|---|---|---|---|
| `capture()` | ✓ | ✓ | `POST /v1/capture` |
| `withCapture()` / `with_capture()` | ✓ | ✓ | n/a (decorator) |
| `setStorage()` / `set_storage()` | ✓ | ✓ | n/a (process-global) |
| `getStorage()` / `get_storage()` | ✓ | ✓ | n/a |
| `capture_session()` (context manager) | · | ✓ | n/a |
| `HttpStorage` (HTTP transport) | ✓ | ✓ | `POST /v1/capture` |
| `InMemoryStorage` | ✓ | ✓ | n/a |
| `FilesystemStorage` | ✓ | · | n/a |
| `HttpStorage.read(id)` | · | · | `GET /v1/capture/:id` |
| `HttpStorage.list(filter)` | · | · | `GET /v1/captures?since=` |
| `dry_run` option | ✓ | ✓ | n/a |
| Capture write retries (3, 200ms × 2^n) | ✓ | ✓ | n/a |
| Capture failure does not propagate | ✓ | ✓ | n/a |

## Dataset (freeze-slice)

| Surface | JS SDK | Python SDK | Wire format |
|---|---|---|---|
| `freezeDataset()` | ✓ | · | `POST /v1/dataset` |
| `Dataset` type | ✓ | · | `GET /v1/dataset/:id` |
| `DatasetItem` type | ✓ | · | `GET /v1/dataset/:id/items` |
| `freezeInjectionDataset()` (engine) | ✓ | · | n/a |

## Gate / Promotion

| Surface | JS SDK | Python SDK | Wire format |
|---|---|---|---|
| `runGate()` (CLI) | ✓ | · | `POST /v1/backtest` |
| `PromotionReport` | ✓ | · | `GET /v1/promotion/:id` |
| `PromotionSummary` | · | · | `GET /v1/promotion/:id/summary` |
| `promote()` decision | ✓ | · | same as `runGate()` |
| `rollback()` decision | ✓ | · | same as `runGate()` |

## Red team

| Surface | JS SDK | Python SDK | Wire format |
|---|---|---|---|
| `runAttack()` | ✓ (engine) | · | `POST /v1/redteam` |
| `allVectors` | ✓ (engine) | · | `GET /v1/redteam/vectors` |
| `generateReport()` | ✓ (engine) | · | `GET /v1/redteam/report/:id` |

## Engine primitives (embedded mode)

| Surface | JS SDK | Python SDK | Wire format |
|---|---|---|---|
| `createRunner()` | ✓ | — | n/a |
| `MockLLMCaller` | ✓ | — | n/a |
| `judge()` | ✓ | — | n/a |
| `compare()` | ✓ | — | n/a |
| `sign()` | ✓ | — | n/a |
| `evaluate()` | ✓ | — | n/a |
| `audit()` | ✓ | — | n/a |
| `tracing()` | ✓ | — | n/a |

> Python SDK does not embed the engine in v1. The wire API is
> sufficient for every documented use case; embedded mode is JS-only.

## CLI

| Surface | Status | Wire format |
|---|---|---|
| `gatelane gate ...` | ✓ (JS) | `POST /v1/backtest` |
| `gatelane freeze-slice ...` | ✓ (JS) | `POST /v1/dataset` |
| `gatelane init` | · | `GET /v1/config` |
| `gatelane serve` (worker + dashboard) | · | n/a |

CLI is JS-only in v1; Python SDK users go straight to the HTTP API.

## Audit

| Surface | JS SDK | Python SDK | Wire format |
|---|---|---|---|
| `writeAuditLog()` (server-side) | ✓ (engine) | — | n/a |
| `audit.export()` | · | · | `GET /v1/audit` |

## Cross-cutting

| Surface | JS SDK | Python SDK |
|---|---|---|
| `User-Agent` header | `gatelane-sdk/0.0.1` | `gatelane-sdk-py/0.0.1` |
| `Authorization: Bearer <token>` | ✓ | ✓ |
| `x-gatelane-span-kind` header | ✓ | ✓ |
| Retry on 5xx, fail on 4xx | ✓ | ✓ |
| JSON wire format matches `CaptureRecord` schema | ✓ | ✓ |

## How the CI enforces this

```yaml
# .github/workflows/ci.yml  (add this job)
sdk-parity:
  name: SDK parity drift check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - run: node tools/check-sdk-parity.mjs
```

The script:

1. Reads this file.
2. For each row marked `✓` or `◯`, greps the JS SDK
   (`packages/gatelane-sdk/src/`) and the Python SDK
   (`packages/gatelane-sdk-py/src/`) for the expected symbol.
3. Exits 1 if any expected symbol is missing in either language.
4. Warns (exits 0) if any symbol marked `·` exists in source.

Run it locally before pushing:

```bash
node tools/check-sdk-parity.mjs
```