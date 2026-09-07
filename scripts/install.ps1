# SiSu CLI installer. No admin. Never installs a system Node via OS packages.
# Windows PowerShell:
#   irm https://www.sisu.chat/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$NpmPackage = if ($env:SISU_NPM_PACKAGE) { $env:SISU_NPM_PACKAGE } else { '@stevezhou/sisu' }
$NodeVersion = if ($env:SISU_NODE_VERSION) { $env:SISU_NODE_VERSION } else { '22.23.2' }
$NodeDist = if ($env:SISU_NODE_DIST) { $env:SISU_NODE_DIST } else { 'https://nodejs.org/dist' }
$SisuHome = if ($env:SISU_HOME) { $env:SISU_HOME } else { Join-Path $HOME '.sisu' }

function Write-Sisu([string]$Message) {
    Write-Host "sisu: $Message"
}

function Get-NodeMajor([string]$NodeExe) {
    try {
        $raw = & $NodeExe -p "process.versions.node.split('.')[0]" 2>$null
        return [int]$raw
    } catch {
        return 0
    }
}

function Test-UsableNode {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { return $false }
    return (Get-NodeMajor $cmd.Source) -ge 20
}

function Get-WinNodeArch {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq 'ARM64') { return 'arm64' }
    return 'x64'
}

function Install-PrivateNode {
    $arch = Get-WinNodeArch
    $folder = "node-v$NodeVersion-win-$arch"
    $zipName = "$folder.zip"
    $url = "$NodeDist/v$NodeVersion/$zipName"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("sisu-node-" + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Write-Sisu "installing Node $NodeVersion into $SisuHome\node (user-local, not system npm)"
    $zipPath = Join-Path $tmp $zipName
    Invoke-WebRequest -Uri $url -OutFile $zipPath
    $sums = Invoke-WebRequest -Uri "$NodeDist/v$NodeVersion/SHASUMS256.txt"
    $expected = ($sums.Content -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1)
    if (-not $expected) { throw "no checksum for $zipName" }
    $want = ($expected -split '\s+')[0].ToLowerInvariant()
    $got = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($want -ne $got) { throw "Node checksum mismatch" }
    Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Path $SisuHome -Force | Out-Null
    $dest = Join-Path $SisuHome 'node'
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item (Join-Path $tmp $folder) $dest
    Remove-Item -Recurse -Force $tmp
}

function Resolve-Npm {
    $privateNpm = Join-Path $SisuHome 'node\npm.cmd'
    if (Test-Path $privateNpm) { return $privateNpm }
    if ((Test-UsableNode) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
        return (Get-Command npm).Source
    }
    Install-PrivateNode
    return (Join-Path $SisuHome 'node\npm.cmd')
}

function Add-UserPath([string]$Dir) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $current) { $current = '' }
    $parts = @($current.Split(';') | Where-Object { $_ -and ($_.TrimEnd('\') -ine $Dir.TrimEnd('\')) })
    $next = ($parts + $Dir) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    if ($env:Path -notlike "*${Dir}*") {
        $env:Path = "$Dir;$env:Path"
    }
}

New-Item -ItemType Directory -Path $SisuHome -Force | Out-Null
$npm = Resolve-Npm
Write-Sisu "npm -> $npm"
& $npm install -g --prefix $SisuHome $NpmPackage
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

$nodeDir = Join-Path $SisuHome 'node'
Add-UserPath $SisuHome
if (Test-Path $nodeDir) { Add-UserPath $nodeDir }
$shimDir = Join-Path $env:LOCALAPPDATA 'sisu\bin'
if (Test-Path $shimDir) { Add-UserPath $shimDir }

Write-Sisu "command -> $(Join-Path $SisuHome 'sisu.cmd')"
Write-Sisu "if ``sisu`` is not found in this shell, run:"
Write-Sisu "  `$env:Path = `"$SisuHome;$nodeDir;`" + `$env:Path"
Write-Sisu "next: sisu login ; sisu"
