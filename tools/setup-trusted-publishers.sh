#!/usr/bin/env bash
#
# Configure npm's OIDC trusted publishing for the @lanefoundry/* packages.
#
# Trusted publishing replaces the long-lived npm token with a short-lived
# OIDC token that npm mints for one specific workflow. It is the
# recommended way to publish from CI.
#
# Requirements:
#   - npm >= 11.15.0
#   - 2FA enabled on the npm account
#   - logged in: `npm login`
#   - a token that is NOT a granular access token with "bypass 2FA"
#
# Usage:
#   npm install -g npm@^11.21.0
#   bash tools/setup-trusted-publishers.sh
#
# The first call asks for 2FA. npm offers to skip 2FA for the next five
# minutes, which lets the remaining calls go through — the script sleeps
# two seconds between calls to stay under the rate limit.
#
# To check what is configured:
#   npm trust list @lanefoundry/gatelane-sdk
#
# To remove a configuration:
#   npm trust revoke @lanefoundry/gatelane-sdk --id <id>
set -euo pipefail

REPO="${GATELANE_REPO:-lanefoundry/gatelane}"
PACKAGES=(
  "@lanefoundry/gatelane-sdk"
  "@lanefoundry/gatelane-engine"
  "@lanefoundry/source-prod-slice"
  "@lanefoundry/gatelane-cli"
  "@lanefoundry/gatelane-ci-adapter"
)

# The workflow file and the GitHub environment it runs in. Each pair needs
# its own trusted publisher configuration, because npm matches the
# workflow filename and the environment name against the OIDC claims.
#
#   publish-npm.yml → the canary channel (every push to main)
#   release.yml     → the stable channel (a v*.*.* tag)
TARGETS=(
  "publish-npm.yml:npm-canary"
  "release.yml:npm-publish"
)

npm_version="$(npm --version)"
major="${npm_version%%.*}"
minor="$(echo "$npm_version" | cut -d. -f2)"
if [ "$major" -lt 11 ] || { [ "$major" -eq 11 ] && [ "$minor" -lt 15 ]; }; then
  echo "npm $npm_version is too old; trusted publishing needs npm >= 11.15.0" >&2
  echo "  npm install -g npm@^11.21.0" >&2
  exit 1
fi

echo "npm $npm_version"
echo "repository: $REPO"
echo

for pkg in "${PACKAGES[@]}"; do
  for target in "${TARGETS[@]}"; do
    file="${target%%:*}"
    env="${target##*:}"
    echo "── $pkg  ($file, environment: $env)"
    if npm trust github "$pkg" \
      --file "$file" \
      --repo "$REPO" \
      --env "$env" \
      --allow-publish \
      --yes; then
      echo "   ✓ configured"
    else
      echo "   ✗ failed — check the error above" >&2
    fi
    # npm asks for 2FA on the first call and offers a five minute skip
    # window for the rest. Sleeping keeps the calls under the rate limit.
    sleep 2
  done
done

echo
echo "Done. Verify with:"
for pkg in "${PACKAGES[@]}"; do
  echo "  npm trust list $pkg"
done
