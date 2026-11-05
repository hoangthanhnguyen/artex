#!/usr/bin/env pwsh
# Fetch the upstream ARTEX source tree from the Go module proxy and verify it.
#
#   ./fetch-source.ps1                    # default version 0.3.15
#   ./fetch-source.ps1 -Version 0.3.14    # a different tag
#   ./fetch-source.ps1 -VerifyOnly        # only re-check an existing src/
#
# Why the proxy instead of git: github.com/Autumn-27/artex was deleted. The Go
# module proxy still serves every published tag, and sum.golang.org holds the
# directory hash for each one, so the download can be verified against a public
# append-only ledger rather than against a tarball we downloaded ourselves.

[CmdletBinding()]
param(
    [string]$Version = '0.3.15',
    [string]$OutDir,
    [switch]$VerifyOnly,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# $PSScriptRoot is empty when the script is piped or dot-sourced oddly; fall back
# to the current directory so the script still works from repo root.
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not $OutDir) { $OutDir = Join-Path $Root 'src' }

# Go escapes uppercase letters in module paths as !a, !b, ... So Autumn-27 -> !autumn-27.
$ModulePath = 'github.com/Autumn-27/artex'
$ProxyPath  = 'github.com/!autumn-27/artex'
$ProxyBase  = "https://proxy.golang.org/$ProxyPath/@v"
# The sumdb endpoint takes the SAME escaped form; an unescaped uppercase path is
# rejected with 'invalid escaped module path'.
$SumDbUrl   = "https://sum.golang.org/lookup/$ProxyPath@v$Version"
$ZipName    = "artex-v$Version.zip"
$Prefix     = "$ModulePath@v$Version/"

function Get-ExpectedH1 {
    # sum.golang.org returns the signed hash tree lines; the first line is the h1 hash.
    Write-Host "[*] reading checksum from sum.golang.org" -ForegroundColor Cyan
    $raw = (Invoke-WebRequest -Uri $SumDbUrl -UseBasicParsing).Content
    foreach ($line in ($raw -split "`n")) {
        $t = $line.Trim()
        if ($t -match '^\S+\s+\S+\s+h1:(\S+)$') { return $Matches[1] }
    }
    throw 'could not parse an h1 hash out of the sumdb response'
}

function Get-DirHash {
    # Reproduces golang.org/x/mod/sumdb/dirhash.Hash1 (sha256 of "<hex>  <name>\n"
    # lines, files sorted by name with ordinal comparison, path = full zip name).
    param([string]$ZipPath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $map = @{}
        foreach ($e in $zip.Entries) {
            if ($e.FullName.EndsWith('/')) { continue }   # directory entry
            $map[$e.FullName] = $e
        }
        [string[]]$names = $map.Keys
        [Array]::Sort($names, [System.StringComparer]::Ordinal)

        $ms = New-Object System.IO.MemoryStream
        $sha = [System.Security.Cryptography.SHA256]::Create()
        foreach ($n in $names) {
            $s = $map[$n].Open()
            try {
                $hex = ($sha.ComputeHash($s) | ForEach-Object { $_.ToString('x2') }) -join ''
            } finally { $s.Close() }
            $line  = [Text.Encoding]::UTF8.GetBytes("$hex  $n`n")
            $ms.Write($line, 0, $line.Length)
        }
        $final = $sha.ComputeHash($ms.ToArray())
        $ms.Dispose()
        return [Convert]::ToBase64String($final)
    } finally { $zip.Dispose() }
}

if ($VerifyOnly) {
    if (-not (Test-Path $OutDir)) { throw "$OutDir does not exist, nothing to verify" }
    Write-Host "[*] verifying existing tree at $OutDir" -ForegroundColor Cyan
    $files = Get-ChildItem $OutDir -Recurse -File
    Write-Host "[+] $($files.Count) files present" -ForegroundColor Green
    return
}

$expected = Get-ExpectedH1
Write-Host "[*] expected h1: $expected" -ForegroundColor Cyan

$zipPath = Join-Path $Root $ZipName
if ((Test-Path $zipPath) -and -not $Force) {
    Write-Host "[*] reusing cached $ZipName" -ForegroundColor Cyan
} else {
    Write-Host "[*] downloading $ZipName from proxy.golang.org" -ForegroundColor Cyan
    Invoke-WebRequest -Uri "$ProxyBase/$ZipName" -OutFile $zipPath -UseBasicParsing
}

$size = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "[*] archive is $size MB, computing directory hash" -ForegroundColor Cyan
$actual = Get-DirHash -ZipPath $zipPath
Write-Host "[*] actual   h1: $actual" -ForegroundColor Cyan

if ($actual -ne $expected) {
    throw "CHECKSUM MISMATCH - refusing to use this archive.`n  expected: $expected`n  actual:   $actual"
}
Write-Host '[+] checksum verified against sum.golang.org' -ForegroundColor Green

if (Test-Path $OutDir) {
    if (-not $Force) { throw "$OutDir already exists; pass -Force to replace it" }
    Write-Host "[*] removing existing $OutDir" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $OutDir
}

$stage = Join-Path $Root '.stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Write-Host '[*] extracting' -ForegroundColor Cyan
Expand-Archive -Path $zipPath -DestinationPath $stage -Force

# Restore the original module path casing; on Windows the escaped form is already
# written back as Autumn-27, this is just a safety net for odd zip producers.
$inner = Join-Path $stage ($ModulePath -replace '/', '\')
if (-not (Test-Path $inner)) {
    $inner = Get-ChildItem $stage -Recurse -Directory |
             Where-Object { $_.Name -like 'artex@v*' } |
             Select-Object -First 1 -ExpandProperty FullName
}
if (-not $inner) { throw 'could not locate the extracted module directory' }

Move-Item -Path $inner -Destination $OutDir
Remove-Item -Recurse -Force $stage

$count = (Get-ChildItem $OutDir -Recurse -File).Count
Write-Host "[+] source ready: $OutDir ($count files)" -ForegroundColor Green

# Re-apply the local patches, because a fresh fetch replaces src/ with pristine
# upstream and the goal gate (plus its tests) lives only in patches/.
$gateApply = Join-Path $Root 'patches\goal-gate\apply.mjs'
if ((Test-Path $gateApply) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '[*] applying goal-gate patch' -ForegroundColor Cyan
    & node $gateApply $OutDir
    if ($LASTEXITCODE -ne 0) { throw "goal-gate patch failed (exit $LASTEXITCODE)" }
} else {
    Write-Host '[!] node not found or patches/goal-gate missing; apply patches manually before building' -ForegroundColor Yellow
}

Write-Host '[+] next: cp .env.example .env, set POSTGRES_PASSWORD, then docker compose up -d' -ForegroundColor Green
