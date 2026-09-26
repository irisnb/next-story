# vendor-node.ps1 — 下载并安装 DSH sidecar 所需的 Node 运行时。
#
# 为什么：DSH 以 `node bin.js` 方式运行，生产打包需要内置 Node，不能依赖用户系统 PATH。
# 该脚本把指定版本的 Node 解压到 sidecar/node-runtime/，由 tauri.conf.json 的
# bundle.resources 打进安装包。node-runtime/ 已加入 .gitignore，不入库。
#
# 用法（在项目根目录运行）：
#   powershell -ExecutionPolicy Bypass -File scripts\vendor-node.ps1

$ErrorActionPreference = "Stop"

# 与 DSH 要求（>= 22.19）一致，锁精确版本保证可复现。
$NodeVersion = "24.15.0"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root "sidecar\node-runtime"

if ($env:OS -eq "Windows_NT") {
    $Archive = "node-v$NodeVersion-win-x64.zip"
    $DistributionUrl = "https://nodejs.org/dist/v$NodeVersion"
    $Url = "$DistributionUrl/$Archive"
} else {
    throw "本脚本目前只支持 Windows；其它平台请按需扩展下载地址与解压方式。"
}

$Temp = Join-Path $env:TEMP "next-story-vendor-node"
New-Item -ItemType Directory -Path $Temp -Force | Out-Null
$Zip = Join-Path $Temp $Archive

Write-Host "下载 Node v$NodeVersion ..."
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

$Manifest = Join-Path $Temp "SHASUMS256.txt"
Write-Host "下载官方 SHA-256 清单并核验 ..."
Invoke-WebRequest -Uri "$DistributionUrl/SHASUMS256.txt" -OutFile $Manifest -UseBasicParsing
& (Join-Path $PSScriptRoot "verify-archive-hash.ps1") -ArchivePath $Zip -ManifestPath $Manifest -ArchiveName $Archive

Write-Host "解压并验证版本 ..."
$Extract = Join-Path $Temp "extract"
if (Test-Path $Extract) { Remove-Item $Extract -Recurse -Force }
Expand-Archive -Path $Zip -DestinationPath $Extract -Force

$ExtractedNode = Join-Path $Extract "node-v$NodeVersion-win-x64\node.exe"
$ActualVersion = & $ExtractedNode --version
if ($LASTEXITCODE -ne 0 -or $ActualVersion -cne "v$NodeVersion") {
    throw "Node 版本核验失败：期望 v$NodeVersion，实际为 $ActualVersion；已中止，不安装运行时。"
}

Write-Host "安装到 $RuntimeDir ..."
if (Test-Path $RuntimeDir) { Remove-Item $RuntimeDir -Recurse -Force }
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
Copy-Item $ExtractedNode (Join-Path $RuntimeDir "node.exe") -Force

Write-Host "完成。Node 运行时已安装到 $RuntimeDir"
