# winget manifest

Microsoft's winget package manager is gated on PR review into
[`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs).
The review bar is high (validation must pass, locale must be
English-only, monikers must be unique). We pre-stage the manifest
files here so the per-release bump is one line.

## File layout

```
manifests/l/lanefoundry/gatelane/X.Y.Z/
├── lanefoundry.gatelane.yaml              (version manifest)
├── lanefoundry.gatelane.installer.yaml    (installer entries)
└── lanefoundry.gatelane.locale.en-US.yaml (locale metadata)
```

These three files are exactly what the winget-pkgs repo expects at
the same relative path.

## Per-release bump

```bash
node packaging/winget/bump-manifest.mjs -- --tag=vX.Y.Z
# Follow the printed instructions: switch to the winget-pkgs fork,
# commit, push, open the PR.
```

## Acceptance criterion

- [ ] PR merged into `microsoft/winget-pkgs` for the tagged version.
- [ ] `winget validate --manifest manifests/l/lanefoundry/gatelane/X.Y.Z/lanefoundry.gatelane.yaml`
      passes locally.
- [ ] On Windows 11, `winget install lanefoundry.gatelane` resolves
      and installs.
- [ ] `winget upgrade lanefoundry.gatelane` picks up the next
      release without an explicit re-install.