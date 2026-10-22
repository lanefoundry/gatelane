# Linux packaging (.deb / .rpm)

gatelane Linux packages are built **on every release** by
`.github/workflows/release.yml` using
[nfpm](https://nfpm.goreleaser.com) with the config in
[`nfpm.yaml`](./nfpm.yaml).

The packages are attached directly to the GitHub Release — no package
repo. Users download the file for their distro from the release page.

> **History.** This used to be built with
> `jiro4989/build-deb-action`. That action is Debian-only: the `format: rpm`
> input was silently ignored and a second `.deb` was written with an `.rpm`
> extension, `package_root` and `architecture` were not the input names the
> action actually reads, and `description` / `license` / `homepage` /
> `section` were dropped. nfpm builds both formats correctly from one
> config.

## Why no apt/yum repo (yet)

- **apt repo**: requires either `reprepro` (self-host), a paid
  Cloudsmith/PackageCloud plan, or a Launchpad PPA. None is
  justified at v0.x adoption.
- **yum repo**: same problem, different tooling. Fedora COPR is
  free but adds a third-party source the user has to trust.

Direct release downloads are the **correct trade-off** until gatelane
has a paying distribution that would notice the friction.

## What ships

The CLI is bundled with esbuild into a **single Node.js file** with a
`#!/usr/bin/env node` shebang (`artifacts/bin/gatelane-linux-<arch>/gatelane`).
It installs to `/usr/bin/gatelane` and declares `nodejs` as a dependency.

> `pkg` was used for the standalone binaries before. It cannot resolve
> subpath exports such as `@lanefoundry/gatelane-engine/attack`, so the
> binaries it produced threw at runtime. The esbuild bundle is verified in
> CI before it is attached to a release.

## Build details

`release.yml` builds the bundle, then runs nfpm for both architectures:

```bash
export NFPM_VERSION="${GITHUB_REF_NAME#v}"   # e.g. 0.1.0
export NFPM_ARCH=amd64                        # or arm64
/tmp/nfpm package -f packaging/linux/nfpm.yaml -p deb --target "artifacts/gatelane_${NFPM_VERSION}_${deb_arch}.deb"
/tmp/nfpm package -f packaging/linux/nfpm.yaml -p rpm --target "artifacts/gatelane-${NFPM_VERSION}-1.${rpm_arch}.rpm"
```

Output file names:

| Format | File |
|---|---|
| deb | `gatelane_0.1.0_amd64.deb`, `gatelane_0.1.0_arm64.deb` |
| rpm | `gatelane-0.1.0-1.x86_64.rpm`, `gatelane-0.1.0-1.aarch64.rpm` |

## Verify locally

```bash
# 1. build the bundle
pnpm -r --filter "./packages/*" build
pnpm exec esbuild packages/cli/dist/cli.js \
  --bundle --platform=node --format=cjs --target=node22 \
  --outfile=artifacts/bin/gatelane-linux-amd64/gatelane
chmod +x artifacts/bin/gatelane-linux-amd64/gatelane

# 2. install nfpm
curl -sSL https://nfpm.goreleaser.com/install.sh | bash

# 3. build
NFPM_VERSION=0.1.0 NFPM_ARCH=amd64 \
  nfpm package -f packaging/linux/nfpm.yaml -p deb --target ./gatelane_0.1.0_amd64.deb
NFPM_VERSION=0.1.0 NFPM_ARCH=amd64 \
  nfpm package -f packaging/linux/nfpm.yaml -p rpm --target ./gatelane-0.1.0-1.x86_64.rpm

# 4. inspect
dpkg-deb -I gatelane_0.1.0_amd64.deb
rpm -qpi gatelane-0.1.0-1.x86_64.rpm

# 5. smoke install
sudo dpkg -i gatelane_0.1.0_amd64.deb && gatelane --help
sudo dnf install ./gatelane-0.1.0-1.x86_64.rpm && gatelane --help
```

## GPG signing

`.deb` and `.rpm` are signed in CI via `dpkg-sig` / `rpm --addsign`
using a `lanefoundry` GPG key stored in the GitHub Actions secret
`GPG_SIGNING_KEY`. Consumers can verify:

```bash
dpkg-sig --verify gatelane_0.1.0_amd64.deb
rpm --checksig gatelane-0.1.0-1.x86_64.rpm
```

The public key is published at <https://lanefoundry.dev/.well-known/gpg.pub>.

## Acceptance criterion

- [ ] `dpkg -i` and `dnf install` complete cleanly on a fresh
      container (`debian:12-slim`, `fedora:41`).
- [ ] `gatelane --help` prints the usage text after install.
- [ ] The `.rpm` is a real RPM (`rpm -qpi` succeeds) — the previous
      build produced a `.deb` with an `.rpm` extension.
- [ ] `.deb` and `.rpm` are signed; `dpkg-sig --verify` and
      `rpm --checksig` return `GOOD`.
- [ ] SHA256SUMS contains both packages and does not contain itself.
