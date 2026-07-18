# Consumer: `handoffkit::core` only

Out-of-tree smoke that proves an **installed** HandoffKit prefix works with
`find_package(handoffkit)` and links **`handoffkit::core`** (no fusion demos).

## Prerequisites

Build and install the C++ package once:

```powershell
cmake -S packages/cpp -B packages/cpp/build -DCMAKE_BUILD_TYPE=Release -DHANDOFFKIT_WITH_HTTP=OFF
cmake --build packages/cpp/build --config Release
cmake --install packages/cpp/build --prefix $env:USERPROFILE/handoffkit-prefix --config Release
```

## Configure / run

```powershell
cmake -S packages/cpp/examples/consumer_core -B packages/cpp/build-consumer `
  -DCMAKE_PREFIX_PATH="$env:USERPROFILE/handoffkit-prefix"
cmake --build packages/cpp/build-consumer --config Release
./packages/cpp/build-consumer/consumer_core.exe runs/consumer_core
```

Linux:

```bash
cmake -S packages/cpp/examples/consumer_core -B packages/cpp/build-consumer \
  -DCMAKE_PREFIX_PATH="$HOME/handoffkit-prefix"
cmake --build packages/cpp/build-consumer
./packages/cpp/build-consumer/consumer_core runs/consumer_core
```

Or use the monorepo helper:

```powershell
pwsh packages/cpp/scripts/consumer_install_smoke.ps1
```

```bash
bash packages/cpp/scripts/consumer_install_smoke.sh
```

Expected stdout includes `consumer_core OK` and `target=handoffkit::core`.
