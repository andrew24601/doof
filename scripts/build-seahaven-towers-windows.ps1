param(
    [switch]$Run,
    [string]$BuildType = "Release",
    [string]$VcpkgRoot = $env:VCPKG_ROOT,
    [string]$VcVarsPath = $env:DOOF_VCVARS_PATH
)

$ErrorActionPreference = "Stop"

function Import-BatchEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BatchPath
    )

    if (-not (Test-Path $BatchPath)) {
        throw "vcvars batch file was not found at $BatchPath"
    }

    $command = "call `"$BatchPath`" >nul && set"
    $output = & cmd.exe /d /s /c $command
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to import Visual C++ environment from $BatchPath"
    }

    foreach ($line in $output) {
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) {
            continue
        }

        $name = $line.Substring(0, $separator)
        $value = $line.Substring($separator + 1)
        Set-Item -Path "Env:$name" -Value $value
    }
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    throw "cmake was not found on PATH. Install Kitware.CMake first."
}

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    if ($VcVarsPath) {
        Import-BatchEnvironment -BatchPath $VcVarsPath
    }

    if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
        throw "cl.exe was not found on PATH. Launch a Developer PowerShell for Visual Studio or pass -VcVarsPath to this script."
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$emitDir = Join-Path $repoRoot "samples/seahaven-towers/build"
$buildDir = Join-Path $repoRoot "samples/seahaven-towers/_build-windows"

Push-Location $repoRoot
try {
    npm run build

    if (Test-Path $emitDir) {
        Remove-Item $emitDir -Recurse -Force
    }

    node dist/cli.js emit samples/seahaven-towers

    $cmakeArgs = @(
        "-S", "samples/seahaven-towers",
        "-B", $buildDir,
        "-DCMAKE_BUILD_TYPE=$BuildType"
    )

    if ($VcpkgRoot) {
        $cmakeArgs += "-DCMAKE_TOOLCHAIN_FILE=$VcpkgRoot/scripts/buildsystems/vcpkg.cmake"
    }

    cmake @cmakeArgs
    cmake --build $buildDir --config $BuildType

    $binary = Join-Path $buildDir "$BuildType/DoofSeahavenTowers.exe"
    if (-not (Test-Path $binary)) {
        $binary = Join-Path $buildDir "DoofSeahavenTowers.exe"
    }

    Write-Host "Built $binary"
    if ($Run) {
        & $binary
    }
}
finally {
    Pop-Location
}