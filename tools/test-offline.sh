#!/usr/bin/env bash
# Only synthetic data. No requests to Google Drive and no console deployment.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/test-include
cp /opt/ps5-payload-sdk/target/include/microhttpd.h build/test-include/
g++ -std=c++20 -Wall -Wextra -Isource/backend/include \
  source/backend/src/drive_parser.cpp tests/drive_parser_test.cpp -o build/drive_parser_test
./build/drive_parser_test
g++ -std=c++20 -Wall -Wextra -Wno-missing-field-initializers -Isource/backend/include -Ibuild/test-include \
  tests/drive_jobs_test.cpp source/backend/src/drive_parser.cpp source/backend/src/json_writer.cpp \
  -pthread -o build/drive_jobs_test
./build/drive_jobs_test
g++ -std=c++20 -Isource/backend/include tests/drive_cookies_test.cpp -lcurl -pthread -o build/drive_cookies_test
./build/drive_cookies_test
gcc -std=gnu11 -Wno-unused-function -Isource/backend/include tests/http_bridge_test.c -o build/http_bridge_test
./build/http_bridge_test
g++ -std=c++20 -Isource/backend/include -Ibuild/test-include tests/lifecycle_test.cpp source/backend/src/json_writer.cpp -pthread -o build/lifecycle_test
./build/lifecycle_test
g++ -std=c++20 -Itests/stubs -Isource/backend/include -Ibuild/test-include tests/media_shortcut_test.cpp -o build/media_shortcut_test
./build/media_shortcut_test
