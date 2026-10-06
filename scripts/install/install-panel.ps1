<#
.SYNOPSIS
  AE Studio panelini o'rnatadi (Windows, P5.11).
.DESCRIPTION
  1) Adobe UnifiedPluginInstallerAgent (Creative Cloud bilan keladi) bo'lsa: --install <zxp>.
  2) Bo'lmasa (yoki -Manual): ZXP (zip) foydalanuvchi CEP extensions papkasiga ochiladi.
  ZXP imzolangan (self-signed) — PlayerDebugMode shart emas.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install-panel.ps1 -Zxp .\ae-studio-0.1.0.zxp
#>
param(
  [string]$Zxp = "",
  [switch]$Manual,
  [string]$ExtensionsDir = (Join-Path $env:APPDATA "Adobe\CEP\extensions")
)

$ErrorActionPreference = "Stop"
$Id = "com.aestudio.panel"

if ($Zxp -eq "") {
  $found = Get-ChildItem -Path $PSScriptRoot -Filter "ae-studio-*.zxp" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -eq $found) { throw "ZXP topilmadi: -Zxp <fayl> bering" }
  $Zxp = $found.FullName
}
if (-not (Test-Path $Zxp)) { throw "ZXP topilmadi: $Zxp" }
$Zxp = (Resolve-Path $Zxp).Path
Write-Host "AE Studio: $Zxp"

$upia = Join-Path ${env:CommonProgramFiles} "Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"
if (-not $Manual -and (Test-Path $upia)) {
  Write-Host "UnifiedPluginInstallerAgent bilan o'rnatilmoqda..."
  & $upia --install $Zxp
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Tayyor. After Effects'ni qayta oching: Window > Extensions > AE Studio"
    exit 0
  }
  Write-Warning "UPIA xato qaytardi ($LASTEXITCODE): qo'lda o'rnatishga o'tiladi"
}

$target = Join-Path $ExtensionsDir $Id
if (Test-Path $target) {
  $backup = "$target.old-$(Get-Date -Format yyyyMMddHHmmss)"
  Move-Item $target $backup
  Write-Host "Eski versiya saqlandi: $backup"
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
$zip = Join-Path ([System.IO.Path]::GetTempPath()) "$Id-$([guid]::NewGuid()).zip"
Copy-Item $Zxp $zip
try {
  Expand-Archive -Path $zip -DestinationPath $target -Force
} finally {
  Remove-Item $zip -Force
}
if (-not (Test-Path (Join-Path $target "CSXS\manifest.xml"))) { throw "manifest.xml topilmadi: ZXP buzilgan" }
Write-Host "O'rnatildi: $target"
Write-Host "After Effects'ni qayta oching: Window > Extensions > AE Studio"
