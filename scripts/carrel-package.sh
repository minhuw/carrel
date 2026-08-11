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
codesign --verify --deep --strict --verbose=2 "$APP_ROOT/$APP_NAME.app" 2>&1 | head -3
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
	for TARGET in linux-x64 linux-arm64 darwin-arm64; do
		REH_OUT="$(pwd)/../VSCode-reh-$TARGET"
		REH_TGZ="$APP_ROOT/carrel-reh-$TARGET-$VERSION.tar.gz"
		echo "==> Building REH server for $TARGET"
		rm -rf "$REH_OUT"
		npm run gulp "vscode-reh-$TARGET-min"
		tar -czf "$REH_TGZ" -C "$REH_OUT" .
		ASSETS="$ASSETS $REH_TGZ"
	done

	if gh release view "$TAG" --repo minhuw/carrel >/dev/null 2>&1; then
		gh release upload "$TAG" $ASSETS --repo minhuw/carrel --clobber
	else
		gh release create "$TAG" $ASSETS --repo minhuw/carrel --title "Carrel $VERSION" --notes "Carrel $VERSION"
	fi
	echo "==> Published $TAG: https://github.com/minhuw/carrel/releases/tag/$TAG"
fi
