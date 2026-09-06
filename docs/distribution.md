# Gatelane Distribution

How gatelane ships to four distinct user roles — without forcing any one of
them through `git clone`. This document is the single source of truth for
**how users install, run, and consume gatelane**, and the implementation
checklist for each channel.

> Status: living document. Each section maps to a concrete artifact
> (`Dockerfile`, `.github/workflows/release.yml`, `homebrew-tap`, etc.).
> Implemented channels are checked. Aspirational channels are listed but
> not promised until the artifact exists.

---

## 1. Why multiple channels

Gatelane serves four user roles, and each role's install path is a different
question:

| Role | Question they ask | Wrong default answer |
|---|---|---|
| **Agent developer** | "I want to capture my LLM calls and gate my deployments." | `git clone` the whole monorepo |
| **Platform self-hoster** | "I want the worker, dashboard, and D1/R2 running in my Cloudflare account." | `pip install` only |
| **Security / ML team** | "I want to run red-team probes or backtest against my agent." | `npm install -g` only |
| **Contributor** | "I want to fix a bug or add a feature in gatelane itself." | a binary they can't edit |

Industry consensus (Linux Foundation "Hosting OS Projects on GitHub",
Inngest, Auth0 SDK guidance, Azure SDK guidelines) is to publish **on every
channel the role expects**, and to keep the *thin HTTP layer* invariant so
each SDK stays small. Gatelane follows the same model.

The repository itself is the **last** thing a user should touch — it is the
contributor surface, not the user surface.

---

## 2. Channel matrix

```
                user role
                ┌──────────────────────────────────────────────┐
                │                                              │
                │   Agent          Platform     Sec / ML       │
                │   developer      self-hoster  team           │
   channel      ├──────────────┬─────────────┬───────────────┤
                │              │             │               │
   npm SDK      │   ★ primary   │   ○ also    │   ○ also      │
   PyPI SDK     │   ★ primary   │   ○ also    │   ○ also      │
   Docker image │   –           │   ★ primary │   ★ primary   │
   Homebrew     │   ○           │   ★ primary │   ★ primary   │
   winget       │   –           │   ★ primary │   ★ primary   │
   scoop        │   –           │   ★ primary │   ★ primary   │
   apt / rpm    │   –           │   ★ primary │   ★ primary   │
   tarball      │   ○ evaluate  │   ○ fallback│   ○ CI        │
   GitHub rel.  │   ○           │   ★ primary │   ★ primary   │
   gh repo      │   –           │   –         │   –           │
   git clone    │   –           │   –         │   –           │
                │              │             │               │
                │   contributor surface only ───────────────► │
   git clone    │   ★ primary                                  │
   gh repo      │   ★ primary                                  │
                └──────────────────────────────────────────────┘

   legend:  ★ primary    ○ also works    – not the right channel
```

The bottom two rows are deliberately last. `git clone` is correct **only**
for contributors. Anyone using it as a user is paying a tax (full git
history, build toolchain, monorepo noise) they don't need.

---

## 3. Per-channel specification

Each subsection is a contract: **what ships, where, and the acceptance
criterion** that says "this channel is done." Until the acceptance
criterion passes, the channel is aspirational, not shipped.

### 3.1 npm — `@lanefoundry/gatelane-sdk`, `@lanefoundry/gatelane-engine`, `@lanefoundry/gatelane-cli`

**What ships**

- `@lanefoundry/gatelane-sdk` — capture client, type-only shapes, storage
  adapters (`storage-fs`, `storage-http`). Today: `0.0.1-dev`.
- `@lanefoundry/gatelane-engine` — replay, compare, judge, sign. Runs in
  the Worker; published for users that want to embed the engine into a
  custom runtime. Today: `0.0.2-dev`.
- `@lanefoundry/gatelane-cli` — `bin: { gatelane: ... }`. Today:
  `0.0.1-dev`.

**Where**

- Public registry: `https://registry.npmjs.org/`
- Today the workspace publishes are unconfigured (`publishConfig` only on
  the SDK). Engine and CLI inherit workspace-only linking.

**Install**

```bash
pnpm add @lanefoundry/gatelane-sdk
pnpm add @lanefoundry/gatelane-engine   # optional, only for embedded engine
pnpm add -g @lanefoundry/gatelane-cli   # CLI
```

**Acceptance criterion**

- [ ] `pnpm view @lanefoundry/gatelane-sdk version` returns a non-dev
      semver tag.
- [ ] `pnpm dlx @lanefoundry/gatelane-cli --help` works on Node 22+ with
      zero local clone.
- [ ] A CI release workflow (`.github/workflows/release.yml`) bumps all
      three packages together with a single version policy (SVP) via
      `changesets` or `monochange`.

### 3.2 PyPI — `gatelane-sdk`

**What ships**

- A thin Python client mirroring the JS SDK shape, plus Python-native
  idioms (`with`-statement context manager, sync + async, type hints via
  `py.typed`).

**Where**

- Public registry: `https://pypi.org/`
- The directory `packages/gatelane-sdk-py/` exists but is empty (only
  `.pytest_cache` is checked in). This channel is **not shipped yet**.

**Install**

```bash
pip install gatelane-sdk
```

**Acceptance criterion**

- [ ] `pyproject.toml` with PEP 621 metadata, `py.typed` marker, and
      `build-system = hatchling`.
- [ ] `pip install gatelane-sdk` from a clean venv succeeds.
- [ ] CI publishes on tag via `pypa/gh-action-pypi-publish`.

### 3.3 Docker — `ghcr.io/lanefoundry/gatelane`

**What ships**

- A single image containing the Worker (`apps/worker`), the dashboard
  (`apps/dashboard`), and the CLI. The Worker listens on `:8787`; the
  dashboard on `:8788`. D1 is replaced by a local SQLite when running
  outside Cloudflare; R2 by a local filesystem volume mounted at
  `/data`.

**Where**

- Registry: `ghcr.io/lanefoundry/gatelane` (tags track git tags).

**Run**

```bash
docker run --rm -p 8787:8787 -p 8788:8788 \
  -e GATELANE_CAPTURE_TOKEN=$(openssl rand -hex 32) \
  -v gatelane-data:/data \
  ghcr.io/lanefoundry/gatelane:latest
```

**Acceptance criterion**

- [ ] `Dockerfile` at repo root, multi-stage build (Node 22 → runtime).
- [ ] `docker run` from a machine with no Node installed succeeds and
      exposes both ports.
- [ ] CI builds and pushes the image on tag; multi-arch (`linux/amd64`,
      `linux/arm64`).

### 3.4 Homebrew — `lanefoundry/tap/gatelane`

**What ships**

- A formula that installs the CLI binary to `$(brew --prefix)/bin/`.

**Where**

- Tap repo: `lanefoundry/homebrew-tap` (separate repo, required by
  Homebrew conventions).
- Eventually: upstream `homebrew-core` once stable.

**Install**

```bash
brew tap lanefoundry/tap
brew install gatelane
```

**Acceptance criterion**

- [ ] `lanefoundry/homebrew-tap` repo exists with
      `Formula/gatelane.rb` installing on macOS 13+ and Linuxbrew.
- [ ] `brew install lanefoundry/tap/gatelane` installs without
      dependencies on a Homebrew-bottled toolchain.

### 3.5 winget — `gatelane`

**What ships**

- A manifest in `microsoft/winget-pkgs` that downloads the Windows
  binary from the GitHub Release.

**Where**

- Upstream: `microsoft/winget-pkgs` (manifest PR required).
- Eventually: `community.winget.microsoft.com` for the search entry.

**Install**

```powershell
winget install lanefoundry.gatelane
```

**Acceptance criterion**

- [ ] PR merged into `microsoft/winget-pkgs` with `gatelane.installer.yaml`,
      `gatelane.locale.en-US.yaml`, `gatelane.yaml` manifests.
- [ ] `winget install lanefoundry.gatelane` resolves and installs from
      Windows 11 23H2+.

### 3.6 scoop — `lanefoundry/scoop-bucket`

**What ships**

- A manifest in `lanefoundry/scoop-bucket` (separate repo, same model as
  Homebrew). Scoop installs to `~/scoop/` without admin rights, which
  matters on CI runners and shared Windows hosts.

**Install**

```powershell
scoop bucket add lanefoundry https://github.com/lanefoundry/scoop-bucket
scoop install gatelane
```

**Acceptance criterion**

- [ ] `lanefoundry/scoop-bucket` repo exists with
      `bucket/gatelane.json`.

### 3.7 apt / rpm — Linux server channel

**What ships**

- `.deb` (Debian 12, Ubuntu 24.04) and `.rpm` (RHEL 9, Fedora 41)
  packages attached to the GitHub Release. No system-wide package repo
  in v1; users download from the release page.

**Where**

- GitHub Release assets: `gatelane_0.1.0_amd64.deb`,
  `gatelane-0.1.0-1.x86_64.rpm`.

**Install**

```bash
# Debian / Ubuntu
sudo dpkg -i gatelane_0.1.0_amd64.deb
sudo apt-get install -f

# RHEL / Fedora
sudo dnf install ./gatelane-0.1.0-1.x86_64.rpm
```

**Acceptance criterion**

- [ ] CI builds `.deb` and `.rpm` for `x86_64` and `aarch64`.
- [ ] `dpkg -i` and `dnf install` complete cleanly on a fresh container.
- [ ] Packages signed with the `lanefoundry` GPG key; signature file
      attached to the release.

### 3.8 Tarball — `codeload.github.com`

**What ships**

- The auto-generated source tarball and zip at every git tag. Useful
  for users who want to inspect the source or vendor a pinned version
  without cloning the full history.

**Where**

- `https://codeload.github.com/lanefoundry/gatelane/tar.gz/refs/tags/vX.Y.Z`
- `https://codeload.github.com/lanefoundry/gatelane/zip/refs/tags/vX.Y.Z`

**Note**

These archives **do not** contain build outputs and are missing files
the build expects. For "ship me a working binary," use the GitHub Release
artifact. The codeload tarball is the **source vendor** path, not the
**install** path.

**Acceptance criterion**

- [ ] GitHub tag → codeload tarball resolves. No further work; this is
      free from GitHub.

### 3.9 giget / `npx giget`

**What ships**

- The same source tarball as 3.8, but fetched via giget's GitHub
  provider with caching. 5–10× faster than `git clone` for the
  template-use case.

**Use**

```bash
npx giget lanefoundry/gatelane gatelane-local
cd gatelane-local
pnpm install
pnpm dev
```

**Acceptance criterion**

- [ ] `npx giget lanefoundry/gatelane` resolves. No further work; this
      is a community tool that talks to GitHub's tarball endpoint.

### 3.10 GitHub Releases — canonical versioned artifact

**What ships**

- One release per semver tag. Each release contains:
  - **Source tarball + zip** (auto by GitHub)
  - **Linux binary**: `gatelane-linux-amd64.tar.gz`,
    `gatelane-linux-arm64.tar.gz`
  - **macOS binary**: `gatelane-macos-universal.tar.gz` (or per-arch)
  - **Windows binary**: `gatelane-windows-amd64.zip`
  - **Linux packages**: `gatelane_X.Y.Z_amd64.deb`,
    `gatelane-X.Y.Z-1.x86_64.rpm`
  - **Checksums**: `SHA256SUMS`
  - **Signature**: `SHA256SUMS.asc` (cosign or GPG)

**Why this matters**

This is the only channel where artifacts are **immutable** and
**verifiable**. Every other package manager (Homebrew, winget, scoop,
apt, Docker) is a thin layer over this artifact. If the release is
wrong, every channel is wrong.

**Acceptance criterion**

- [ ] `.github/workflows/release.yml` builds all platform binaries,
      attaches them to the GitHub Release, and writes `SHA256SUMS` +
      signature.
- [ ] Every other channel's PR (Homebrew formula bump, winget manifest
      bump, Docker tag push) reads from this artifact URL.

### 3.11 `git clone` / `gh repo clone`

**What ships**

- The full repository. Required **only** for contributors and users who
  want to vendor and patch gatelane itself.

**Use**

```bash
gh repo clone lanefoundry/gatelane
# or
git clone https://github.com/lanefoundry/gatelane.git
```

**Acceptance criterion**

- [ ] Repo is public. No further work; this is a permanent channel.

---

## 4. Cross-SDK invariants

These are non-negotiable. Every channel — and every language — must obey
them or the promotion gate loses meaning.

1. **Thin HTTP layer.** The Worker API (`/v1/capture`, `/v1/promote`,
   `/v1/backtest`) is the source of truth. SDKs are HTTP clients. The
   engine can be embedded, but the wire format is the contract.
2. **Language-native idioms.** JS uses promises. Python uses
   `with`-statement context managers and `async`/`await`. Go uses
   functional options. Rust uses `Result<T, E>`. Never force one
   language's style into another.
3. **Single version policy (SVP).** All SDK releases carry the same
   `MAJOR.MINOR` tag. A patch may ship independently, but `1.2.x` for
   the JS SDK and `1.1.x` for the Python SDK at the same time is a
   bug. Use `changesets` or `monochange` to coordinate.
4. **Immutable, signed artifacts.** Every release artifact has a
   SHA-256 and a signature. Pin by digest, not by tag, in production.
5. **Documented SDK parity matrix.** Any feature available in the JS
   SDK must be either available in the Python SDK or explicitly listed
   as a gap with a target version. Silent drift is forbidden.

---

## 5. Implementation roadmap

Ordered by leverage per unit of work. Lower items are dependencies for
higher items.

```
phase 0  ──  today (already in repo)
   [✓]   pnpm workspace monorepo
   [✓]   TypeScript SDK + engine + CLI source
   [✓]   CI on PR (lint, typecheck, test)
   [✓]   Auto-generated codeload tarball on tag

phase 1  ──  release the artifact you already have
   [ ]   .github/workflows/release.yml builds binaries + Docker
         image, attaches to GitHub Release with SHA256SUMS + sig
   [ ]   changesets (or monochange) wired in for SVP version bumps
   [ ]   npm publish workflow gated on the same release
   [ ]   Docker image pushed to ghcr.io on tag (multi-arch)

phase 2  ──  package-manager channels
   [ ]   lanefoundry/homebrew-tap — Formula/gatelane.rb
   [ ]   lanefoundry/scoop-bucket — bucket/gatelane.json
   [ ]   .deb / .rpm built and attached to each release
   [ ]   microsoft/winget-pkgs manifest PR (gated on phase 1 being
         stable for ≥ 1 release cycle)

phase 3  ──  polyglot SDK surface
   [ ]   Python SDK at packages/gatelane-sdk-py (pyproject.toml,
         hatchling, py.typed, CI publish to PyPI)
   [ ]   Parity matrix documented in this file (see §6)
   [ ]   Go SDK (pkg.go.dev) — only if demand materializes
   [ ]   Rust SDK (crates.io) — only if demand materializes

phase 4  ──  higher-leverage ecosystem
   [ ]   Homebrew core PR (after 1 stable release)
   [ ]   apt repository (PackageCloud or Cloudsmith) — only if a
         Linux distro vendor asks for it
   [ ]   digests pin in CI workflows of downstream projects
```

Each phase is gated on the previous phase shipping at least one real
release. Aspirational channels (Phase 2+) are not promised until the
artifacts exist and the acceptance criteria pass.

---

## 6. SDK parity matrix

Status of each public surface across language SDKs. **Drift here is a
release-blocking bug.**

| Surface | JS SDK | Python SDK | CLI | HTTP API |
|---|---|---|---|---|
| `capture()` | shipped | scaffolded | wraps API | `POST /v1/capture` |
| `freeze()` (dataset) | shipped | planned | planned | `POST /v1/dataset` |
| `backtest()` | shipped (engine) | planned | planned | `POST /v1/backtest` |
| `promote()` decision | shipped | planned | planned | `GET /v1/promotion/:id` |
| `redteam.run()` | shipped (engine) | planned | planned | `POST /v1/redteam` |
| `sign()` report | shipped | planned | planned | `POST /v1/sign` |
| `audit.export()` | shipped | planned | planned | `GET /v1/audit` |

Update this matrix in the same PR that adds a new public surface or
ships a new SDK release.

---

## 7. Security and trust

- All release artifacts are signed. Today: planned (cosign or GPG).
  Until signing is wired in, pin to a specific commit hash and verify
  `SHA256SUMS` against an out-of-band channel.
- The Docker image runs as a non-root user. The default
  `GATELANE_CAPTURE_TOKEN` is generated on first run if not provided
  (≥ 32 random bytes).
- The Worker binds to `:8787` and the dashboard to `:8788` by default.
  Do not expose these ports to the public internet without TLS and an
  auth proxy.

---

## 8. See also

- [architecture.md](architecture.md) — what the engine actually does
- [roadmap.md](roadmap.md) — when each channel ships
- [positioning.md](positioning.md) — why the channel mix matters for the
  market positioning
- [README.md](../README.md) — top-level entry point for new users