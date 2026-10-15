#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export PS5_PAYLOAD_SDK=/opt/ps5-payload-sdk
export LLVM_CONFIG=/usr/lib/llvm20/bin/llvm-config
export PATH="/usr/lib/llvm20/bin:/usr/bin:/bin:$PATH"
if [[ ! -e /usr/lib/llvm20/bin/ld.lld ]]; then
  ln -s /usr/bin/ld.lld /usr/lib/llvm20/bin/ld.lld
fi
bash "$PROJECT_ROOT/tools/setup-pacbrew.sh"
mkdir -p /opt/hldrive-deps
cd /opt/hldrive-deps
if [[ ! -f "$PS5_PAYLOAD_SDK/target/lib/libmicrohttpd.a" ]]; then
  curl -fL --retry 3 https://ftp.gnu.org/gnu/libmicrohttpd/libmicrohttpd-1.0.2.tar.gz -o microhttpd.tar.gz
  tar -xzf microhttpd.tar.gz
  cd libmicrohttpd-1.0.2
  CC="$PS5_PAYLOAD_SDK/bin/prospero-clang" AR="$PS5_PAYLOAD_SDK/bin/prospero-ar" RANLIB="$PS5_PAYLOAD_SDK/bin/prospero-ranlib" \
    ./configure --host=x86_64-unknown-freebsd --prefix="$PS5_PAYLOAD_SDK/target" --disable-shared --enable-static --disable-https --disable-examples --disable-doc --disable-tools CFLAGS=-O2
  make -j4
  make install
fi
