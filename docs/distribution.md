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

### 3.1 npm — the `@lanefoundry/*` package family

**What ships**

- `@lanefoundry/gatelane-sdk` — capture client, type-only shapes, storage
  adapters (`storage-fs`, `storage-http`). Today: `0.0.1-dev`.
- `@lanefoundry/gatelane-engine` — replay, compare, judge, sign. Runs in
  the Worker; published for users that want to embed the engine into a
  custom runtime. Today: `0.0.2-dev`.
- `@lanefoundry/source-prod-slice` — freeze / replay / compare / canary
  orchestration. Runtime dependency of the CLI. Today: `0.0.1-dev`.
- `@lanefoundry/gatelane-cli` — `bin: { gatelane: ... }`. Today:
  `0.0.1-dev`.
- `@lanefoundry/gatelane-ci-adapter` — `bin: { gatelane-ci: ... }`, GitHub
  Actions glue. Today: `0.0.0-dev`.

**Where**

- Public registry: `https://registry.npmjs.org/`
- Five packages ship together, in this order (dependencies first):
  `gatelane-sdk` → `gatelane-engine` → `source-prod-slice` → `gatelane-cli`
  → `gatelane-ci-adapter`.
- All of them set `publishConfig.access = "public"`; the packages are
  scoped, and npm defaults scoped packages to restricted.

**Install**

```bash
# canary channel — published from every push to main
pnpm add @lanefoundry/gatelane-sdk@canary
pnpm add @lanefoundry/gatelane-engine@canary    # optional, embedded engine
pnpm add -D @lanefoundry/gatelane-cli@canary    # CLI

# stable channel — published from a v*.*.* tag
pnpm add @lanefoundry/gatelane-sdk
```

**Offline / pre-publish fallback**

```bash
pnpm -r --filter "./packages/*" build
pnpm pack:all            # artifacts/npm/*.tgz, workspace:* already rewritten
npm i /path/to/gatelane/artifacts/npm/*.tgz
```

**Automatic packing (no registry account needed)**

`.github/workflows/pack.yml` runs on every push to `main`, every PR and on
demand. It builds the workspace, stamps a version, packs all five
tarballs, verifies they install into an empty project, and uploads them as
a run artifact. No npm org, token or variable is involved.

```bash
gh workflow run "Pack npm tarballs"           # manual run
gh run download <run-id> -n gatelane-npm-tarballs-<version>
npm i ./*.tgz
```

Pushing a `v*.*.*` tag does the same thing but attaches the tarballs to
the **GitHub Release**, which gives permanent URLs:

```bash
V=v0.1.0
VER=${V#v}
BASE=https://github.com/lanefoundry/gatelane/releases/download/$V
npm i \
  "$BASE/lanefoundry-gatelane-sdk-$VER.tgz" \
  "$BASE/lanefoundry-gatelane-engine-$VER.tgz" \
  "$BASE/lanefoundry-source-prod-slice-$VER.tgz" \
  "$BASE/lanefoundry-gatelane-cli-$VER.tgz" \
  "$BASE/lanefoundry-gatelane-ci-adapter-$VER.tgz"
```

**Troubleshooting**

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_PNPM_FETCH_404` on `@lanefoundry/*` | package not published (or only `canary` exists) | install with `@canary`, or use the tarball fallback |
| `npm i github:lanefoundry/gatelane` "succeeds" but nothing imports | repo root is `private` with no `main`/`exports` | never install the monorepo root |
| `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND ... workspace:*` | `workspace:*` is only rewritten by `pack`/`publish` | install tarballs / published versions, not git paths |
| `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` | pnpm 10 blocks build scripts of git dependencies | prefer registry installs; if you must use git, allowlist the package |
| install pulls an empty tarball | package published without `dist/` (it is gitignored) | build first; `pnpm verify:pack` catches this in CI |
| `ERR_PNPM_FETCH_404` on `source-prod-slice` only | CLI's runtime dependency was left out of the publish step | both publish workflows now include all five packages |
| npm publish fails with `Scope not found` | the `lanefoundry` npm org does not exist yet | create it (see runbook) or use the tarball channels |

**Acceptance criterion**

- [ ] `pnpm view @lanefoundry/gatelane-sdk version` returns a non-dev
      semver tag.
- [ ] `pnpm dlx @lanefoundry/gatelane-cli --help` works on Node 22+ with
      zero local clone.
- [ ] CI packs the workspace, installs the tarballs into a clean project
      and imports the SDK, so an empty or unresolvable package cannot ship.
- [ ] A `v*.*.*` tag produces a GitHub Release with the five tarballs
      attached and installable via a plain `npm i <url>`.

**Release runbook**

One-time prerequisites:

1. **Create the npm organisation** (this is the scope; `npm org` has no
   create subcommand, it must be done in the web UI):
   1. Sign in at <https://www.npmjs.com/login>.
   2. Avatar (top right) → **Add an Organization**.
   3. Name: `lanefoundry` — the org name becomes the package scope.
   4. Choose **Unlimited public packages** (free) → **Create**.
   5. Invite the publishing account as a member with the `developer` role.

   Verify locally:

   ```bash
   npm login
   npm org ls lanefoundry     # lists the members of the scope
   curl -s https://registry.npmjs.org/-/org/lanefoundry/package
   # -> 200; before creation this returned {"error":"Scope not found"}
   ```

2. **Create the token**: avatar → **Access Tokens** → **Generate New Token**
   → **Granular Access Token**.
   - Expiration: 90 days (rotate before it lapses)
   - **Packages and scopes**: `Read and write`
   - Organizations: `lanefoundry`
   - Leave "bypass 2FA" enabled so CI can publish non-interactively.

   Sanity check the token is not needed for a dry run — packaging can be
   validated without credentials:

   ```bash
   cd packages/gatelane-sdk && npm publish --dry-run --access public --tag canary
   ```

3. **Wire it into GitHub** (repo → Settings → Secrets and variables →
   Actions), or via CLI:

   ```bash
   gh variable set ENABLE_NPM_CANARY --body true   # Variables tab
   gh variable set ENABLE_NPM_PUBLISH --body true  # Variables tab (stable releases)
   gh secret set NPM_TOKEN                         # Secrets tab, paste token
   ```

   These two variables are independent on purpose:

   | Variable | Effect when unset |
   |---|---|
   | `ENABLE_NPM_CANARY` | `publish-npm.yml` shows a **skipped** job with a warning annotation; no npm publish happens |
   | `ENABLE_NPM_PUBLISH` | `release.yml`'s npm job is skipped; the GitHub Release, tarballs, binaries and Docker image are still produced |

   So a tag can be pushed **before** the npm org exists, and consumers
   install from the GitHub Release tarballs.

Canary (runs on every push to `main` once enabled):

```bash
# publish the current main without waiting for a push
gh workflow run "Publish npm (canary)" -f publish=true

# confirm
npm view @lanefoundry/gatelane-sdk@canary version
```

Consumers install `@canary` until a stable release exists.

Stable:

```bash
pnpm changeset          # describe the change, pick a bump
pnpm changeset:version  # apply versions + changelog
git commit -am "chore: release"
git tag v0.1.0          # stable semver only — no -rc / -dev suffix
git push --follow-tags
```

`release.yml` stamps `v0.1.0` into all five `package.json` files and
`packages/gatelane-sdk-py/pyproject.toml`, publishes in dependency order,
and then verifies that `@latest` resolves to the stamped version for every
package before the run can pass. The same run attaches the five tarballs to
the GitHub Release, so the release is usable even if the npm job was
skipped.

### 3.2 PyPI — `gatelane-sdk`

**What ships**

- A thin Python client mirroring the JS SDK shape, plus Python-native
  idioms (`with`-statement context manager, sync + async, type hints via
  `py.typed`).

**Where**

- Public registry: `https://pypi.org/`
- Source lives in `packages/gatelane-sdk-py/`. The checked-in version is a
  `-dev` placeholder; `release.yml` stamps the tag version into
  `pyproject.toml` before building. This channel is **not shipped yet** —
  `pip install gatelane-sdk` returns "No matching distribution found".

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
| `scan.run()` | shipped (engine) | planned | via `gate --dataset-source scan` | `POST /v1/scan` (planned) |
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