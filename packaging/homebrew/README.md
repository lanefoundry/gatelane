# Homebrew tap bootstrap

`lanefoundry/homebrew-tap` is a **separate repo**. This directory
contains everything you need to create it.

## One-time setup

```bash
# 1. Create the repo (must be public)
gh repo create lanefoundry/homebrew-tap --public --description "Homebrew tap for lanefoundry tools"

# 2. Initialise the layout Homebrew expects
mkdir -p Formula
cp ../gatelane/packaging/homebrew/gatelane.rb Formula/gatelane.rb
git add Formula/gatelane.rb && git commit -m "feat: initial gatelane formula" && git push
```

## Per-release bump

After the GitHub Release is published, run from the gatelane repo:

```bash
node packaging/homebrew/bump-formula.mjs -- --tag=vX.Y.Z
cd ../homebrew-tap
git diff Formula/gatelane.rb   # eyeball the change
git commit -am "gatelane: bump to X.Y.Z"
gh pr create --title "gatelane X.Y.Z"
```

The script downloads `SHA256SUMS` from the GitHub Release and rewrites
`Formula/gatelane.rb` in place. **Do not edit the file by hand** —
the `# STAMP:` markers are anchors; if you change them, the bump
script breaks.

## Bottle generation

Bottles are Homebrew's precompiled binary format. After the first
stable release:

```bash
brew install --build-bottle lanefoundry/tap/gatelane
brew bottle lanefoundry/tap/gatelane
# uploads a tarball to lanefoundry/homebrew-tap/releases
# paste the resulting sha256 lines back into Formula/gatelane.rb
```

Until bottles exist, `brew install` builds from source (needs Node
22). This is fine for early-preview users but bottlenecks at scale;
plan the bottle step before phase 2 ships to a wider audience.

## Acceptance criterion

- [ ] `brew install lanefoundry/tap/gatelane` succeeds on macOS 13+
      and Linuxbrew.
- [ ] `brew audit --strict Formula/gatelane.rb` exits 0.
- [ ] `brew test gatelane` passes (the in-formula `test do` block).
- [ ] Bottles are published for `arm64_sonoma`, `sonoma`, and
      `x86_64_linux`.