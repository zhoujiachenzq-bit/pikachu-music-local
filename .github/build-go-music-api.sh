#!/usr/bin/env bash
# Cross-compiles go-music-api into the APK as a library the app loads in-process.
# It adds an Android entry point, a loopback-only listener and a /diag route, and
# leaves the upstream source otherwise untouched.
set -euo pipefail

commit=bacdfbe6cf6a5ba7331463d2039e3aac915c627f
ndk="$ANDROID_HOME/ndk/$NDK_VERSION/toolchains/llvm/prebuilt/linux-x86_64/bin"
source="$RUNNER_TEMP/go-music-api"
libs="$GITHUB_WORKSPACE/android/app/src/main/jniLibs"

git init "$source"
git -C "$source" remote add origin https://github.com/guohuiyuan/go-music-api.git
git -C "$source" fetch --depth 1 origin "$commit"
git -C "$source" checkout --detach FETCH_HEAD
test "$(git -C "$source" rev-parse HEAD)" = "$commit"
cp "$GITHUB_WORKSPACE/.github/go-music-api-android.go" "$source/android_entry.go"

cd "$source"
for target in "$@"; do
  case "$target" in
    arm64-v8a) goarch=arm64; cc=aarch64-linux-android23-clang ;;
    x86_64) goarch=amd64; cc=x86_64-linux-android23-clang ;;
    *) echo "unknown ABI $target" >&2; exit 1 ;;
  esac
  mkdir -p "$libs/$target"
  GOOS=android GOARCH=$goarch CGO_ENABLED=1 CC="$ndk/$cc" go build -trimpath -buildmode=c-shared -ldflags '-s -w' -o "$libs/$target/libgomusic.so" .
done
ls -l "$libs"/*/libgomusic.so
