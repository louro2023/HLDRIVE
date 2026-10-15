#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cache="$root/.deps/pacbrew"
sdk="${PS5_PAYLOAD_SDK:-/opt/ps5-payload-sdk}"
version=v0.40.2
hash=a85f65de418a8e6a898c6c3e3c870d50fff7618a200e4dd59ea9692af6ecec4d
archive="$cache/download/ps5-payload-dev.tar.gz"
prefix="$sdk/target/user/homebrew"
marker="$prefix/.hldrive-pacbrew-version"
expected="$version $hash"
mkdir -p "$cache/download"
if [[ -f "$marker" && "$(cat "$marker")" == "$expected" && -f "$prefix/lib/libcurl.a" ]]; then
    touch "$cache/.complete"
    exit 0
fi
if [[ ! -f "$archive" ]] || ! printf '%s  %s\n' "$hash" "$archive" | sha256sum -c >/dev/null 2>&1; then
    temporary="$archive.download"
    curl -fL --retry 3 "https://github.com/ps5-payload-dev/pacbrew-repo/releases/download/$version/ps5-payload-dev.tar.gz" -o "$temporary"
    printf '%s  %s\n' "$hash" "$temporary" | sha256sum -c
    mv "$temporary" "$archive"
fi
mkdir -p "$sdk/target"
tar -xzf "$archive" -C "$sdk/target" --strip-components=3 opt/ps5-payload-sdk/target/user/homebrew
[[ -f "$prefix/lib/libcurl.a" && -f "$prefix/include/curl/curl.h" ]] || {
    echo "PacBrew archive is missing libcurl or its headers." >&2
    exit 2
}
printf '%s\n' "$expected" > "$marker"
touch "$cache/.complete"
