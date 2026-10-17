#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[string]$previousLocation = (Get-Location).Path

function Invoke-WingetInstall {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$PackageId)
    try {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
            throw 'Windows Package Manager is required. Install App Installer from Microsoft Store, then rerun bootstrap.'
        }
        & winget.exe install --id $PackageId --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
        if ($LASTEXITCODE -notin @(0, 3010)) { throw "winget failed for $PackageId (exit $LASTEXITCODE)." }
    }
    catch { throw }
    finally { }
}

function Find-Moonlight {
    [CmdletBinding()]
    [OutputType([string])]
    param()
    try {
        $command = Get-Command Moonlight.exe -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
        foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
            if (-not $root) { continue }
            [string]$candidate = Join-Path $root 'Moonlight Game Streaming\Moonlight.exe'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
        return ''
    }
    catch { throw }
    finally { }
}

try {
    if (-not $IsWindows) { throw 'Use bootstrap.sh on Linux.' }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        Invoke-WingetInstall -PackageId 'OpenJS.NodeJS.LTS'
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    & node.exe -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
    if ($LASTEXITCODE -ne 0) { throw 'Node.js >= 22 is required. Upgrade Node.js and rerun bootstrap.' }
    [string]$moonlightPath = Find-Moonlight
    if (-not $moonlightPath) {
        Invoke-WingetInstall -PackageId 'MoonlightGameStreamingProject.Moonlight'
        $moonlightPath = Find-Moonlight
        if (-not $moonlightPath) { throw 'Moonlight installation did not produce a discoverable executable; restart your terminal and rerun bootstrap.' }
    }
    Set-Location -LiteralPath (Resolve-Path -LiteralPath $ProjectPath).Path
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
    [PSCustomObject]@{
        Success = $true
        MoonlightPath = $moonlightPath
        ProjectPath = (Get-Location).Path
        NextStep = 'Run npm start. Pair Moonlight with your host before streaming.'
    }
}
catch { throw }
finally { Set-Location -LiteralPath $previousLocation }
