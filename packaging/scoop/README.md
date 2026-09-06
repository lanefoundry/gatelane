# Scoop bucket bootstrap

`lanefoundry/scoop-bucket` is a **separate repo**. This directory
contains everything you need to create it.

## One-time setup

```bash
gh repo create lanefoundry/scoop-bucket --public --description "Scoop bucket for lanefoundry tools"
mkdir -p bucket
cp ../gatelane/packaging/scoop/gatelane.json bucket/gatelane.json
git add bucket/gatelane.json && git commit -m "feat: initial gatelane manifest" && git push
```

## Per-release bump

```bash
node packaging/scoop/bump-manifest.mjs -- --tag=vX.Y.Z
cd ../scoop-bucket
git diff bucket/gatelane.json
git commit -am "gatelane: bump to X.Y.Z"
gh pr create --title "gatelane X.Y.Z"
```

## Why a separate bucket

Scoop has one official bucket (`ScoopInstaller/Scoop`) with strict
quality bar (CI, review). gatelane is early-preview; the official
bucket is phase 4. A self-hosted bucket gets us Windows installs now
without waiting for review.

## Acceptance criterion

- [ ] `scoop bucket add lanefoundry https://github.com/lanefoundry/scoop-bucket`
- [ ] `scoop install gatelane` succeeds on Windows 10+ with PowerShell 5+.
- [ ] `scoop update gatelane` resolves the new version automatically
      (the `suggest.checkver.github` block).
- [ ] `gatelane.exe --version` returns the version that matches the
      manifest.