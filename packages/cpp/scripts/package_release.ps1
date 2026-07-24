# Build a self-contained handoffkit-cpp-<version> tarball for GitHub Releases.
param(
    [string]$Version = "1.14.2",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $OutDir) {
    $OutDir = Join-Path $Root "build\release-assets"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$BuildDir = Join-Path $Root "build\package-tarball"
cmake -S $Root -B $BuildDir -DHANDOFFKIT_BUILD_TESTS=OFF -DHANDOFFKIT_BUILD_EXAMPLES=OFF | Out-Host
cmake --build $BuildDir --target package_source_tarball --config Release | Out-Host

$Tarball = Join-Path $BuildDir "handoffkit-cpp-$Version.tar.gz"
$Sums = Join-Path $BuildDir "SHA256SUMS"
if (-not (Test-Path $Tarball)) {
    throw "Missing tarball: $Tarball"
}
Copy-Item -Force $Tarball $OutDir
if (Test-Path $Sums) {
    Copy-Item -Force $Sums $OutDir
}
Write-Host "Packaged assets in $OutDir"
Get-ChildItem $OutDir | Format-Table Name, Length
