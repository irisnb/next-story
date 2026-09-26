# verify-archive-hash.ps1 — 可离线执行的官方 SHA-256 清单核验。
param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,
    [Parameter(Mandatory = $true)]
    [string]$ArchiveName
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "归档文件不存在：$ArchivePath；已中止，不安装运行时。"
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "官方 SHA-256 清单不存在：$ManifestPath；已中止，不安装运行时。"
}

$Pattern = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($ArchiveName) + '$'
$Hashes = @(foreach ($Line in Get-Content -LiteralPath $ManifestPath -Encoding UTF8) {
    if ($Line -cmatch $Pattern) { $Matches[1] }
})
if ($Hashes.Count -ne 1) {
    throw "官方 SHA-256 清单中必须有且仅有一条归档记录：$ArchiveName；已中止，不安装运行时。"
}

$ActualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash
if ($ActualHash -ine $Hashes[0]) {
    throw "SHA-256 核验失败：$ArchiveName 的哈希与官方清单不匹配；已中止，不安装运行时。"
}

Write-Host "SHA-256 核验通过：$ArchiveName"
