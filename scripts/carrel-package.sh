#!/bin/bash
# carrel-package.sh — production build + codesign for Carrel (macOS arm64).
#
# Usage:
#   ./scripts/carrel-package.sh [--sign-only]
#
#   --sign-only   Skip the gulp build and only (re)sign an existing
#                 VSCode-darwin-arm64/Carrel.app tree.
#   --publish     After building, create the GitHub release for the packaged
#                 version and upload the signed zip as its asset.
#
# Environment:
#   CODESIGN_IDENTITY   Signing identity used by build/darwin/sign.ts.
#                       Defaults to the "Apple Development" identity on this
#                       machine. A free (personal) Apple Development
#                       certificate works for local use; notarization
#                       requires a paid Developer ID certificate and is out
#                       of scope here.
#
# Produces:
#   VSCode-darwin-arm64/Carrel.app     signed application bundle
#   VSCode-darwin-arm64/Carrel.zip     zipped, signed bundle
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="${CODESIGN_IDENTITY:-Apple Development: minhuw@acm.org (58HNHLZ49V)}"
export PATH="$HOME/.local/node24/bin:$PATH"

if [ "${1:-}" != "--sign-only" ]; then
	echo "==> Pruning packages that are no longer referenced (removed AI/etc. deps)…"
	# The package task assembles node_modules.asar from the on-disk
	# node_modules; without pruning, removed dependencies still get packed.
	npm prune

	echo "==> Building production bundle (gulp vscode-darwin-arm64-min)…"
	# Always rebuild the bundle from scratch: the esbuild bundle embeds
	# product.json (incl. the commit stamp) at bundle time and packaging
	# re-stamps it; a cached bundle from an older commit makes the extension
	# host exit with ExtensionHostExitCode.VersionMismatch at runtime.
	rm -rf out-vscode-min out-build out-cli
	npm run gulp vscode-darwin-arm64-min
fi

# The packaged app takes its display name from product.json nameLong.
APP_NAME="Carrel"
APP_ROOT="$(pwd)/../VSCode-darwin-arm64"

echo "==> Signing $APP_ROOT/$APP_NAME.app with identity: $IDENTITY"
# build/darwin/sign.ts targets CI (needs AGENT_TEMPDIRECTORY + a build
# keychain); for local dev signing, codesign --deep is the pragmatic route.

# Carrel: strip non-English Electron locales (~45MB of .lproj folders).
# Must happen BEFORE signing so the signature covers the trimmed bundle.
LPROJ_DIR="$APP_ROOT/$APP_NAME.app/Contents/Frameworks/Electron Framework.framework/Versions/Current/Resources"
if [ -d "$LPROJ_DIR" ]; then
	find "$LPROJ_DIR" -maxdepth 1 -name '*.lproj' ! -name 'en.lproj' ! -name 'en_US.lproj' ! -name 'en_GB.lproj' -exec rm -rf {} +
	echo "==> Trimmed Electron locales to English"
fi

codesign --deep --force --timestamp --sign "$IDENTITY" "$APP_ROOT/$APP_NAME.app"

echo "==> Verifying signature"
# Pipe to a file, not head: under pipefail, head closing the pipe SIGPIPEs
# codesign and aborts the script before the zip/publish steps.
codesign --verify --deep --strict --verbose=2 "$APP_ROOT/$APP_NAME.app" > /tmp/carrel-codesign-verify.log 2>&1 || true
head -3 /tmp/carrel-codesign-verify.log
codesign -dv "$APP_ROOT/$APP_NAME.app" 2>&1 | grep -E "Identifier|Authority" | head -3 || true

echo "==> Creating zip"
rm -f "$APP_ROOT/$APP_NAME.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_ROOT/$APP_NAME.app" "$APP_ROOT/$APP_NAME.zip"

echo "==> Done: $APP_ROOT/$APP_NAME.app and $APP_ROOT/$APP_NAME.zip"

if [ "${1:-}" = "--publish" ] || [ "${2:-}" = "--publish" ]; then
	PRODUCT_JSON="$APP_ROOT/$APP_NAME.app/Contents/Resources/app/product.json"
	VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PRODUCT_JSON")"
	TAG="v$VERSION"
	ASSET="Carrel-darwin-arm64-$VERSION.zip"

	echo "==> Publishing $TAG"
	cp "$APP_ROOT/$APP_NAME.zip" "$APP_ROOT/$ASSET"

	# Build the remote extension host (REH) servers that the bundled
	# open-remote-ssh extension downloads onto SSH targets. The download URL
	# template lives in product.json (serverDownloadUrlTemplate).
	ASSETS="$APP_ROOT/$ASSET"
	for TARGET in linux-x64 darwin-arm64; do
		# NOTE: linux-arm64 needs an arm64 Linux host or CI for its native
		# modules (cross-built macOS natives are useless); add it back when
		# release CI exists.
		REH_OUT="$(pwd)/../VSCode-reh-$TARGET"
		REH_TGZ="$APP_ROOT/carrel-reh-$TARGET-$VERSION.tar.gz"
		echo "==> Building REH server for $TARGET"
		rm -rf "$REH_OUT"
		npm run gulp "vscode-reh-$TARGET-min"
		# The cross-built package contains host-platform (macOS) native
		# modules; linux targets must have their natives overlaid with
		# linux builds before publishing (see commit history / CI). Guard
		# against shipping a broken tarball:
		if [ "${TARGET%%-*}" = "linux" ] && find "$REH_OUT/node_modules" -name "*.node" -exec file {} + 2>/dev/null | grep -q "Mach-O"; then
			echo "ERROR: $TARGET server package contains macOS native modules — overlay linux natives before publishing" >&2
			exit 1
		fi
		tar -czf "$REH_TGZ" -C "$REH_OUT" .
		ASSETS="$ASSETS $REH_TGZ"
	done

	if gh release view "$TAG" --repo minhuw/carrel >/dev/null 2>&1; then
		gh release upload "$TAG" $ASSETS --repo minhuw/carrel --clobber
	else
		gh release create "$TAG" $ASSETS --repo minhuw/carrel --title "Carrel $VERSION" --notes "Carrel $VERSION"
	fi
	echo "==> Published $TAG: https://github.com/minhuw/carrel/releases/tag/$TAG"

	# Update the Homebrew tap cask to the new version.
	ZIP_SHA256="$(shasum -a 256 "$APP_ROOT/$ASSET" | cut -d' ' -f1)"
	CASK_CONTENT=$(cat <<RUBY
cask "carrel" do
  version "$VERSION"
  sha256 "$ZIP_SHA256"

  url "https://github.com/minhuw/carrel/releases/download/v#{version}/Carrel-darwin-arm64-#{version}.zip"
  name "Carrel"
  desc "Slim, AI-free desktop code editor derived from Code - OSS"
  homepage "https://github.com/minhuw/carrel"

  depends_on arch: :arm64

  app "Carrel.app"

  # Carrel is signed with a personal Apple Development certificate (not
  # notarized), so clear any quarantine attribute after install.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Carrel.app"]
  end

  zap trash: [
    "~/.carrel",
    "~/Library/Application Support/Carrel",
    "~/Library/Caches/carrel",
    "~/Library/Preferences/com.carrel.editor.plist",
    "~/Library/Saved Application State/com.carrel.editor.savedState",
  ]
end
RUBY
)
	CASK_SHA=$(gh api repos/minhuw/homebrew-carrel/contents/Casks/carrel.rb --jq .sha 2>/dev/null || true)
	gh api repos/minhuw/homebrew-carrel/contents/Casks/carrel.rb -X PUT \
		-f message="carrel $VERSION" \
		-f content="$(printf '%s' "$CASK_CONTENT" | base64)" \
		${CASK_SHA:+-f sha="$CASK_SHA"} --silent && echo "==> Updated homebrew-carrel cask to $VERSION"
fi
