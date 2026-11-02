# Self-signed Authenticode signing for Windows release artifacts.
#
# This proves the files have not changed since signing. It does NOT remove
# SmartScreen "unknown publisher" warnings.
#
# Usage: npm.cmd run sign:win
#        (build:win / build:win:setup / build:win:portable call it automatically)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$version = node -p "require('./package.json').version"
$release = Join-Path $root "release\$version"
if (-not (Test-Path $release)) {
  throw "release directory not found: $release. Run build:win first."
}

$subject = 'CN=StockLens Self-Signed (integrity only)'
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Where-Object { $_.Subject -eq $subject } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1
if (-not $cert) {
  Write-Host 'No self-signed certificate found; creating a 10-year code signing certificate...'
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyExportPolicy Exportable `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(10)
}

$cerPath = Join-Path $release 'stocklens-selfsigned.cer'
Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null
Write-Host "Public certificate: $cerPath"
Write-Host "Certificate thumbprint: $($cert.Thumbprint)"

$candidates = @()
$candidates += Get-ChildItem $release -Filter '*.exe' -File -ErrorAction SilentlyContinue |
  ForEach-Object { $_.FullName }
$candidates += Join-Path $release 'win-unpacked\StockLens.exe'
$candidates += Join-Path $release 'win-unpacked\resources\tdx-bridge\tdx-bridge.exe'
$candidates += Join-Path $release "StockLens-$version-win-x64\StockLens.exe"
$candidates += Join-Path $release "StockLens-$version-win-x64\resources\tdx-bridge\tdx-bridge.exe"

$signed = 0
foreach ($item in $candidates | Where-Object { Test-Path $_ } | Select-Object -Unique) {
  $file = (Resolve-Path $item).Path
  $signature = Set-AuthenticodeSignature `
    -FilePath $file `
    -Certificate $cert `
    -HashAlgorithm SHA256
  if ($signature.Status -in @('HashMismatch', 'NotSigned')) {
    throw "Signing failed: $file ($($signature.Status) $($signature.StatusMessage))"
  }
  $signed += 1
  Write-Host ("Signed: {0}  [{1}]" -f (Split-Path $file -Leaf), $signature.Status)
}

if ($signed -eq 0) {
  throw 'No signable exe found. Run build:win first.'
}
Write-Host "Done: $signed file(s) signed (self-signed, integrity only; SmartScreen still warns)."
