# Install HandoffKit to a prefix and build examples/consumer_core against it.
# Usage:
#   pwsh packages/cpp/scripts/consumer_install_smoke.ps1
#   pwsh packages/cpp/scripts/consumer_install_smoke.ps1 -BuildDir packages/cpp/build-core -Prefix $env:TEMP\hk-prefix

param(
    [string]$SourceDir = "",
    [string]$BuildDir = "",
    [string]$Prefix = "",
    [string]$ConsumerBuild = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
if (-not $SourceDir) { $SourceDir = Join-Path $RepoRoot "packages\cpp" }
if (-not $BuildDir) { $BuildDir = Join-Path $RepoRoot "packages\cpp\build-consumer-smoke" }
if (-not $Prefix) { $Prefix = Join-Path $RepoRoot "packages\cpp\.local-prefix-smoke" }
if (-not $ConsumerBuild) { $ConsumerBuild = Join-Path $RepoRoot "packages\cpp\build-consumer" }

Write-Host "== configure handoffkit =="
cmake -S $SourceDir -B $BuildDir `
    -DCMAKE_BUILD_TYPE=Release `
    -DHANDOFFKIT_WITH_HTTP=OFF `
    -DHANDOFFKIT_BUILD_TESTS=ON `
    -DHANDOFFKIT_BUILD_EXAMPLES=OFF `
    -DHANDOFFKIT_BUILD_CLI=OFF
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== build handoffkit =="
cmake --build $BuildDir --config Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== install to $Prefix =="
if (Test-Path $Prefix) { Remove-Item -Recurse -Force $Prefix }
cmake --install $BuildDir --prefix $Prefix --config Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$coreHdr = Join-Path $Prefix "include\handoffkit\handoffkit_core.hpp"
$coreLib = Join-Path $Prefix "lib\libhandoffkit_core.a"
if (-not (Test-Path $coreHdr)) { throw "missing $coreHdr" }
if (-not (Test-Path $coreLib) -and -not (Test-Path (Join-Path $Prefix "lib\handoffkit_core.lib"))) {
    # MSVC or different lib name
    $found = Get-ChildItem -Path (Join-Path $Prefix "lib") -Filter "*handoffkit_core*" -ErrorAction SilentlyContinue
    if (-not $found) { throw "missing handoffkit_core library under $Prefix/lib" }
}

Write-Host "== configure consumer_core =="
$consumerSrc = Join-Path $SourceDir "examples\consumer_core"
cmake -S $consumerSrc -B $ConsumerBuild -DCMAKE_PREFIX_PATH="$Prefix" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== build + run consumer_core =="
cmake --build $ConsumerBuild --config Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $ConsumerBuild "consumer_core.exe"
if (-not (Test-Path $exe)) { $exe = Join-Path $ConsumerBuild "consumer_core" }
if (-not (Test-Path $exe)) {
    $exe = Get-ChildItem -Path $ConsumerBuild -Recurse -Filter "consumer_core*" -File |
        Where-Object { $_.Extension -in @(".exe", "") -or $_.Name -eq "consumer_core" } |
        Select-Object -First 1 -ExpandProperty FullName
}
$outDir = Join-Path $RepoRoot "packages\cpp\.local-tests-consumer-reports"
& $exe $outDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "consumer_install_smoke OK prefix=$Prefix"
exit 0
