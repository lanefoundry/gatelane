# Linux packaging (.deb / .rpm)

gatelane Linux packages are built **on every release** by
`.github/workflows/release.yml` via
[`jiro4989/build-deb-action`](https://github.com/jiro4989/build-deb-action).
The action accepts `format: rpm` for RHEL/Fedora.

The packages are attached directly to the GitHub Release — no
package repo. Users download the file for their distro from the
release page.

## Why no apt/yum repo (yet)

- **apt repo**: requires either `reprepro` (self-host), a paid
  Cloudsmith/PackageCloud plan, or a Launchpad PPA. None is
  justified at v0.x adoption.
- **yum repo**: same problem, different tooling. Fedora COPR is
  free but adds a third-party source the user has to trust.

Direct release downloads are the **correct trade-off** until gatelane
has a paying distribution that would notice the friction.

## Build details

The `release.yml` workflow runs the action with:

```yaml
- uses: jiro4989/build-deb-action@v1
  with:
    package: gatelane
    version: ${{ steps.tag.outputs.value }}
    package_root: artifacts/bin/gatelane-linux-amd64
    architecture: amd64
    maintainer: lanefoundry <noreply@lanefoundry.dev>
    description: Pre-production safety + eval gate for AI agents.
    license: Apache-2.0
    homepage: https://github.com/lanefoundry/gatelane
    section: utils
```

The `package_root` is the standalone binary directory produced by
the `pkg` step in the workflow. It contains a single `gatelane`
executable at its root.

The `.rpm` job reuses the same `package_root` with
`format: rpm`.

## Verify locally

```bash
# Build (requires Docker)
docker run --rm -v "$PWD:/work" -w /work \
  --entrypoint /bin/sh \
  jiro4989/build-deb-action -c \
     'build-deb -p gatelane -v 0.1.0 -a amd64 \
                -m "lanefoundry <noreply@lanefoundry.dev>" \
                -d "Pre-production safety + eval gate" \
                -C /work/artifacts/bin/gatelane-linux-amd64 /work'

# Inspect
dpkg-deb -I gatelane_0.1.0_amd64.deb
rpm -qpi gatelane-0.1.0-1.x86_64.rpm

# Smoke install
sudo dpkg -i gatelane_0.1.0_amd64.deb && gatelane --version
sudo dnf install ./gatelane-0.1.0-1.x86_64.rpm && gatelane --version
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
- [ ] `gatelane --version` prints the package version after install.
- [ ] `.deb` and `.rpm` are signed; `dpkg-sig --verify` and
      `rpm --checksig` return `GOOD`.
- [ ] SHA256SUMS contains both packages.