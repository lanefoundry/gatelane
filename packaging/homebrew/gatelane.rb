# typed: false
# frozen_string_literal: true
#
# Homebrew formula for gatelane.
#
# This file lives at: https://github.com/lanefoundry/homebrew-tap/blob/master/Formula/gatelane.rb
# `brew install lanefoundry/tap/gatelane` resolves it from there.
#
# Update procedure (on every gatelane release):
#   1. Run `pnpm release:bump-formula -- --tag=vX.Y.Z` from the gatelane repo.
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
  url "https://github.com/lanefoundry/gatelane/releases/download/vX.Y.Z/gatelane-X.Y.Z.tar.gz"  # STAMP:url
  version "X.Y.Z"                                                                              # STAMP:version
  sha256 "PLACEHOLDER_SHA256_LINUX_AMD64"                                                      # STAMP:sha256
  license "Apache-2.0"

  depends_on "node" => :build   # only required when building from source; bottled binaries skip it

  # Multi-platform. Homebrew resolves the right bottle at install time.
  bottle do
    root_url "https://github.com/lanefoundry/homebrew-tap/releases/download/gatelane-X.Y.Z"   # STAMP:bottle_root
    sha256 cellar: :any_skip_relocation, arm64_sonoma: "PLACEHOLDER_SHA256_DARWIN_ARM64"
    sha256 cellar: :any_skip_relocation, sonoma:        "PLACEHOLDER_SHA256_DARWIN_AMD64"
    sha256 cellar: :any_skip_relocation, x86_64_linux:  "PLACEHOLDER_SHA256_LINUX_AMD64_BOTTLE"
  end if false   # bottles generated after first stable release

  def install
    # Pre-built binary layout from packaging/homebrew/binary-layout.
    bin.install "gatelane"
    (etc/"gatelane").install "config.example.toml"
  end

  service do
    run [opt_bin/"gatelane", "serve", "--config", etc/"gatelane/config.toml"]
    keep_alive true
    log_path var/"log/gatelane.log"
    error_log_path var/"log/gatelane.err.log"
  end

  test do
    assert_match "gatelane", shell_output("#{bin}/gatelane --version")
    assert_match "ok", shell_output("#{bin}/gatelane health --check")
  end
end