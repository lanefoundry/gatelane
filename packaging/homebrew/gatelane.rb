# typed: false
# frozen_string_literal: true
#
# Homebrew formula for gatelane.
#
# This file lives at: https://github.com/lanefoundry/homebrew-tap/blob/master/Formula/gatelane.rb
# `brew install lanefoundry/tap/gatelane` resolves it from there.
#
# Update procedure (on every gatelane release):
#   1. Run `node packaging/homebrew/bump-formula.mjs -- --tag=vX.Y.Z` from the gatelane repo.
#      The script downloads SHA256SUMS from the GitHub release and rewrites
#      this file in place.
#   2. Open a PR against lanefoundry/homebrew-tap.
#   3. Once merged, the new version is live to every `brew install`.
#
# Verify locally:
#   brew install --build-from-source ./Formula/gatelane.rb
#   brew audit --strict ./Formula/gatelane.rb
#   brew test gatelane
class Gatelane < Formula
  desc "Pre-production safety + eval gate for AI agents"
  homepage "https://github.com/lanefoundry/gatelane"

  # The CLI is a single Node.js program, not a compiled binary, so the
  # archive is platform specific. Homebrew extracts the top level
  # directory, so the binary is installed from inside it.
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/lanefoundry/gatelane/releases/download/vX.Y.Z/gatelane-darwin-arm64.tar.gz"  # STAMP:url
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"                                                      # STAMP:sha256
    else
      url "https://github.com/lanefoundry/gatelane/releases/download/vX.Y.Z/gatelane-darwin-amd64.tar.gz"  # STAMP:url
      sha256 "PLACEHOLDER_SHA256_DARWIN_AMD64"                                                      # STAMP:sha256
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/lanefoundry/gatelane/releases/download/vX.Y.Z/gatelane-linux-arm64.tar.gz"  # STAMP:url
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"                                                      # STAMP:sha256
    else
      url "https://github.com/lanefoundry/gatelane/releases/download/vX.Y.Z/gatelane-linux-amd64.tar.gz"  # STAMP:url
      sha256 "PLACEHOLDER_SHA256_LINUX_AMD64"                                                      # STAMP:sha256
    end
  end

  version "X.Y.Z"                                                                              # STAMP:version
  license "Apache-2.0"

  # The CLI is a Node.js program, so Node is a runtime dependency, not
  # just a build dependency.
  depends_on "node"

  def install
    bin.install "gatelane-darwin-arm64/gatelane" => "gatelane" if OS.mac? && Hardware::CPU.arm?
    bin.install "gatelane-darwin-amd64/gatelane" => "gatelane" if OS.mac? && !Hardware::CPU.arm?
    bin.install "gatelane-linux-arm64/gatelane" => "gatelane" if OS.linux? && Hardware::CPU.arm?
    bin.install "gatelane-linux-amd64/gatelane" => "gatelane" if OS.linux? && !Hardware::CPU.arm?
  end

  test do
    # The CLI has no --version flag yet; `--help` is the smoke test.
    assert_match "promotion gate", shell_output("#{bin}/gatelane --help")
  end
end
