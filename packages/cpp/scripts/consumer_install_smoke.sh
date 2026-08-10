#!/usr/bin/env bash
# Install HandoffKit to a prefix and build examples/consumer_core against it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="${SRC:-$ROOT/packages/cpp}"
BUILD="${BUILD:-$ROOT/.local-tests/cpp-consumer-smoke-build}"
PREFIX="${PREFIX:-$ROOT/.local-tests/cpp-prefix-smoke}"
CONSUMER_BUILD="${CONSUMER_BUILD:-$ROOT/.local-tests/cpp-consumer-build}"
OUTPUT="${OUTPUT:-$ROOT/.local-tests/cpp-consumer-reports}"

echo "== configure handoffkit =="
cmake -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DHANDOFFKIT_WITH_HTTP=OFF \
  -DHANDOFFKIT_BUILD_TESTS=ON \
  -DHANDOFFKIT_BUILD_EXAMPLES=OFF \
  -DHANDOFFKIT_BUILD_CLI=OFF

echo "== build handoffkit =="
cmake --build "$BUILD" --config Release

echo "== install to $PREFIX =="
rm -rf "$PREFIX"
cmake --install "$BUILD" --prefix "$PREFIX" --config Release

test -f "$PREFIX/include/handoffkit/handoffkit_core.hpp"
test -f "$PREFIX/lib/libhandoffkit_core.a" \
  || test -f "$PREFIX/lib64/libhandoffkit_core.a" \
  || test -f "$PREFIX/lib/handoffkit_core.lib"

echo "== configure consumer_core =="
cmake -S "$SRC/examples/consumer_core" -B "$CONSUMER_BUILD" \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DCMAKE_BUILD_TYPE=Release

echo "== build + run consumer_core =="
cmake --build "$CONSUMER_BUILD" --config Release

BIN="$CONSUMER_BUILD/consumer_core"
if [[ ! -x "$BIN" ]]; then
  BIN="$(find "$CONSUMER_BUILD" -type f -name 'consumer_core' -o -name 'consumer_core.exe' | head -n1)"
fi
"$BIN" "$OUTPUT"

echo "consumer_install_smoke OK prefix=$PREFIX output=$OUTPUT"
