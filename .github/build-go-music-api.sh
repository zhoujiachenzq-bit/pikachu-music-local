#!/usr/bin/env bash
# Cross-compiles go-music-api into the APK as a loopback-only executable. Android
# only runs executables from the native library folder, hence the .so name.
# cgo links bionic, because Go's own DNS resolver cannot find servers on Android.
set -euo pipefail

version=v1.0.1
commit=3008180a96c30469bcc874b3aa1f2f60edcd622a
ndk="$ANDROID_HOME/ndk/$NDK_VERSION/toolchains/llvm/prebuilt/linux-x86_64/bin"
source="$RUNNER_TEMP/go-music-api"
libs="$GITHUB_WORKSPACE/android/app/src/main/jniLibs"

git clone --depth 1 --branch "$version" https://github.com/guohuiyuan/go-music-api.git "$source"
test "$(git -C "$source" rev-parse HEAD)" = "$commit"
sed -i 's/r\.Run(":8080")/r.Run("127.0.0.1:8080")/' "$source/main.go"
grep -q 'r.Run("127.0.0.1:8080")' "$source/main.go"

cd "$source"
for target in "$@"; do
  case "$target" in
    arm64-v8a) goarch=arm64; cc=aarch64-linux-android23-clang ;;
    x86_64) goarch=amd64; cc=x86_64-linux-android23-clang ;;
    *) echo "unknown ABI $target" >&2; exit 1 ;;
  esac
  mkdir -p "$libs/$target"
  GOOS=android GOARCH=$goarch CGO_ENABLED=1 CC="$ndk/$cc" go build -trimpath -buildmode=pie -ldflags '-s -w' -o "$libs/$target/libgomusic.so" .
done
ls -l "$libs"/*/libgomusic.so
