# Changelog

All notable changes to gatelane are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release carries one version across every SDK — the JS SDK, the JS
engine, the CLI, the CI adapter and the Python SDK share the same
`MAJOR.MINOR`. The git tag is the source of truth: the release workflow
stamps it into every `package.json` and into the Python `pyproject.toml`.

## [Unreleased]

### Added

- `gatelane eval` — black-box test a deployed agent's HTTP endpoint from a
  YAML config (`gatelane.yaml`): test cases with `contains`,
  `not-contains`, `llm-rubric`, `latency`, `status` and `json-path`
  assertions, a red-team replay of the attack library against the
  endpoint, and blue-team checks on blocked responses, leaks and false
  positives. Config values may reference `${ENV}` vars; `.env` is loaded.
  Runs are saved to `.gatelane/runs/<tag>.json`.
- `gatelane compare` — diff two eval runs; exits non-zero on a regressed
  test or a newly bypassed attack, so it can gate CI.
- `gatelane init` — write a starter `gatelane.yaml`.
- `@lanefoundry/gatelane-engine` exports `./eval`, `./eval-config` and
  `./http-attacks`.

### Fixed

- The HTTP attack library (direct and indirect injection, chain attacks,
  context window flood, memory poisoning, tool abuse; 56 vectors) that the
  0.1.0 notes below describe was deleted along with `mode-red-team` before
  the release, so 0.1.0 shipped only the 20 hand-curated `scan` payloads.
  It is back in the engine and is what `eval` replays.

## [0.1.0] — 2026-10-22

First release. Early preview — the interfaces are not stable yet.

### Added

**The gate itself**

- `gatelane gate` — replay candidates against a dataset, judge the
  results, compare against a baseline, sign a report and evaluate a
  promotion policy into `promote | rollback | hold_for_review`.
- `gatelane freeze-slice` — freeze a window of captured production
  traffic (`7d`, `24h`, `30h`) into a reproducible dataset file.
- `gatelane gate --dataset-source scan` replays the built-in attack
  library; `prod` replays a frozen production slice.
- 50+ prompt injection vectors in the attack library: direct and
  indirect injection, chain attacks, context window flood, memory
  poisoning and tool abuse.
- LLM providers: `mock` (deterministic, no API key), `openai`
  (and any OpenAI-compatible endpoint) and `anthropic`.

**Packages on npm** — all published under the `@lanefoundry` scope with
provenance attestations:

| Package | What it is |
|---|---|
| `@lanefoundry/gatelane-sdk` | Capture client, candidate/dataset/gate/promotion types, pluggable storage (`storage-fs`, `storage-http`) |
| `@lanefoundry/gatelane-engine` | LLM caller, judge, replay, compare, sign, evaluate, security scan, audit, tracing and OpenTelemetry export |
| `@lanefoundry/source-prod-slice` | Freeze-slice, replay-batch, compare-scores, canary orchestrator, signed report, audit export |
| `@lanefoundry/gatelane-cli` | The `gatelane` command |
| `@lanefoundry/gatelane-ci-adapter` | The `gatelane-ci` command, for GitHub Actions |

**The Worker** (`apps/worker`) — a Hono app on Cloudflare Workers with
`/v1/capture`, `/v1/captures`, `/v1/replay`, `/v1/canaries/*`, D1
metadata storage, R2 for raw captures and KV for rate limiting. A
container runtime shim backs the same bindings with `node:sqlite` and
the local filesystem, so the whole stack runs without Cloudflare.

**The dashboard** (`apps/dashboard`) — React + Vite + TanStack Query.

**The Python SDK** (`packages/gatelane-sdk-py`) — a thin client mirroring
the JS SDK shape, with a `with`-statement context manager, sync and
async transports and `py.typed` annotations. Not published to PyPI yet.

**Distribution**

- npm packages, a canary channel on every push to `main`, and a stable
  channel on a `v*.*.*` tag.
- GitHub Release with npm tarballs, a standalone CLI for linux, macos
  and windows, `.deb` and `.rpm` packages, and `SHA256SUMS` signed with
  cosign keyless signing.
- A multi-arch Docker image on `ghcr.io/lanefoundry/gatelane`.

### Fixed

The distribution pipeline was not able to ship anything before this
release. The fixes are listed in the commit history between the first
push and `0.1.0`; the ones that mattered most:

- The `@lanefoundry/*` packages were never published, and installing
  from GitHub was blocked by the monorepo's `workspace:*` ranges. Both
  paths work now.
- The publish workflow reported success while publishing nothing.
- npm provenance verification failed because the packages had no
  `repository` field.
- The standalone CLI binaries were built with `pkg`, which cannot
  resolve subpath exports, so they threw at runtime. They are esbuild
  bundles now, and CI runs them before attaching them to a release.
- The `.rpm` in the release was a `.deb` with the wrong file name.
- The release attached neither the CLI archives nor a matching
  `SHA256SUMS`.
- The Docker image referenced packages that were deleted months ago and
  shipped a D1 schema that had moved.
- `cosign` was not installed on the runner, so the signing step failed.

### Known limitations

- The Python SDK is not on PyPI. The publish job exists and is gated
  behind `ENABLE_PYPI_PUBLISH`.
- npm trusted publishing (OIDC) is not enabled yet; CI publishes with a
  long-lived token. `tools/setup-trusted-publishers.sh` configures it.
- Old canary versions accumulate on the registry. npm does not allow
  `npm unpublish` with the token this repository uses, so the cleanup
  has to be run from a logged-in session.
- The `.deb` and `.rpm` packages are not GPG-signed yet. Only
  `SHA256SUMS` is signed.
- The Homebrew, Scoop and winget channels point at repositories that do
  not exist yet. The manifests in `packaging/` are ready to be pushed.

[0.1.0]: https://github.com/lanefoundry/gatelane/releases/tag/v0.1.0
