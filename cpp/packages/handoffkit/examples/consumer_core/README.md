# Consumer: `handoffkit::core` only

Out-of-tree smoke that proves an **installed** HandoffKit prefix works with
`find_package(handoffkit)` and links **`handoffkit::core`** (no fusion demos).

## Prerequisites

Build and install the C++ package once:

```powershell
cmake -S cpp/packages/handoffkit -B cpp/packages/handoffkit/build -DCMAKE_BUILD_TYPE=Release -DHANDOFFKIT_WITH_HTTP=OFF
cmake --build cpp/packages/handoffkit/build --config Release
cmake --install cpp/packages/handoffkit/build --prefix $env:USERPROFILE/handoffkit-prefix --config Release
```

## Configure / run

```powershell
cmake -S cpp/packages/handoffkit/examples/consumer_core -B cpp/packages/handoffkit/build-consumer `
  -DCMAKE_PREFIX_PATH="$env:USERPROFILE/handoffkit-prefix"
cmake --build cpp/packages/handoffkit/build-consumer --config Release
./cpp/packages/handoffkit/build-consumer/consumer_core.exe runs/consumer_core
```

Linux:

```bash
cmake -S cpp/packages/handoffkit/examples/consumer_core -B cpp/packages/handoffkit/build-consumer \
  -DCMAKE_PREFIX_PATH="$HOME/handoffkit-prefix"
cmake --build cpp/packages/handoffkit/build-consumer
./cpp/packages/handoffkit/build-consumer/consumer_core runs/consumer_core
```

Or use the monorepo helper:

```powershell
pwsh cpp/packages/handoffkit/scripts/consumer_install_smoke.ps1
```

```bash
bash cpp/packages/handoffkit/scripts/consumer_install_smoke.sh
```

Expected stdout includes `consumer_core OK` and `target=handoffkit::core`.
