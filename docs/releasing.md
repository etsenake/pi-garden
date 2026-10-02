# Releasing a Homebrew build by hand

The tag-triggered `Release` workflow can't publish a macOS build yet: the
repository has no macOS signing secrets, so `build-macos` fails at "Validate
macOS signing credentials". The Linux and Windows jobs also fail at "Verify
packaged runtime dependencies" (`protobufjs` requires `@types/node`; packaged
resolution is missing). Until both are fixed, macOS releases are built locally
as unsigned, ad-hoc signed arm64 DMGs and published by hand. Versions 1.0.2,
1.0.3, and 1.0.4 were released this way.

## Before you start

- On `main`, up to date with `origin/main`, with a clean working tree.
- Dependencies installed: `pnpm install --frozen-lockfile`. Afterwards check
  `git status`. A fresh install can drop the lockfile entries for
  `examples/desktop-extensions/*`, which aren't workspace members. Revert with
  `git checkout -- pnpm-lock.yaml`.
- `gh` may be aliased to `glab` on some machines, so the GitHub steps below use
  `curl` with the credential git already uses to push.

```sh
VERSION=1.0.4
DMG="pi-garden-$VERSION-arm64.dmg"
```

## 1. Bump the version and tag it

The release contract requires the same version in the root, desktop, and
website `package.json` files.

```sh
PREVIOUS=$(node -p 'require("./package.json").version')
for file in package.json apps/desktop/package.json apps/website/package.json; do
  sed -i '' "s/\"version\": \"$PREVIOUS\"/\"version\": \"$VERSION\"/" "$file"
done
node scripts/verify-release-version.mjs --tag "v$VERSION"
git commit -am "Release $VERSION."
git tag -a "v$VERSION" -m "Release $VERSION."
git push origin main
git push origin "v$VERSION"
```

Pushing the tag starts the `Release` workflow. It fails as described above and
skips `publish` and `sync-homebrew`, so it doesn't interfere with the manual
release.

## 2. Build the DMG

```sh
cd apps/desktop
rm -rf release
pnpm run build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg --arm64 --publish never
```

Without a signing identity, electron-builder falls back to an ad-hoc signature
and skips notarization. The output is `release/$DMG`.

## 3. Check the DMG

```sh
MNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "release/$DMG"
APP="$MNT/Pi Garden.app"
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist"
sed -n 8p "$APP/Contents/Resources/reference/INDEX.md"
ls "$APP/Contents/Resources/skills"
codesign --verify --deep "$APP" && echo codesign-ok
hdiutil detach "$MNT"
SHA256=$(shasum -a 256 "release/$DMG" | cut -d' ' -f1)
echo "$SHA256"
```

Expect the new version, the release commit in `INDEX.md` without "with
uncommitted changes", every bundled skill, and `codesign-ok`.

## 4. Publish the GitHub release

```sh
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | sed -n 's/^password=//p')
RELEASE_ID=$(curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/etsenake/pi-garden/releases \
  -d "$(jq -n --arg v "$VERSION" '{tag_name: "v\($v)", name: "v\($v)",
        body: "Pi Garden \($v)\n\nUnsigned ad-hoc arm64 DMG for Homebrew installs.\n"}')" \
  | jq -r .id)
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/x-apple-diskimage" \
  --data-binary "@release/$DMG" \
  "https://uploads.github.com/repos/etsenake/pi-garden/releases/$RELEASE_ID/assets?name=$DMG" \
  | jq -r '"\(.name) \(.state) \(.size)"'
curl -sL "https://github.com/etsenake/pi-garden/releases/download/v$VERSION/$DMG" | shasum -a 256
```

The downloaded hash must equal `$SHA256`.

## 5. Update the Homebrew tap

Run from the repository root.

```sh
cd ../..
TAP_DIR=/tmp/homebrew-tap
[ -d "$TAP_DIR" ] && git -C "$TAP_DIR" pull --ff-only \
  || git clone https://github.com/etsenake/homebrew-tap.git "$TAP_DIR"
node scripts/release-homebrew-sync.mjs --tap-dir "$TAP_DIR" --version "$VERSION" \
  --asset-url "https://github.com/etsenake/pi-garden/releases/download/v$VERSION/$DMG" \
  --sha256 "$SHA256"
git -C "$TAP_DIR" diff
git -C "$TAP_DIR" commit -am "Update pi-garden to $VERSION"
git -C "$TAP_DIR" push origin HEAD
```

The diff should change only the cask's `version`, `sha256`, and `url`.

## 6. Upgrade

`brew upgrade` refreshes taps only when its auto-update interval has passed, so
an upgrade soon after the previous one can still see the old cask. Refresh first:

```sh
brew update
brew upgrade --cask pi-garden
```
