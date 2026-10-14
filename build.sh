#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PS5_PAYLOAD_SDK="${PS5_PAYLOAD_SDK:-/opt/ps5-payload-sdk}"
export LLVM_CONFIG="${LLVM_CONFIG:-/usr/lib/llvm20/bin/llvm-config}"
export PATH="/usr/lib/llvm20/bin:/usr/bin:/bin:$PATH"
test -f "$PS5_PAYLOAD_SDK/toolchain/prospero.mk"
test -f "$PS5_PAYLOAD_SDK/target/lib/libmicrohttpd.a"
make frontend
make -j4
sha256sum build/HLDRIVE.elf > build/HLDRIVE.elf.sha256
