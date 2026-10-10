# Read-only icon diagnosis: query embedded PE icons by size and the running
# window icon handles/sizes. Does NOT modify the app, delete caches, or write to
# production dirs; only reads and exports PNGs under the approved temp path.
param(
  [string[]]$Exe = @(
    "D:\Next Story\src-tauri\target\debug\next-story.exe",
    "D:\Next Story\src-tauri\target\release\next-story.exe"
  ),
  [int[]]$Sizes = @(16, 24, 32, 48, 64, 128, 256),
  [string]$OutDir = "C:\Users\Administrator\AppData\Local\Temp\opencode\package-v5\icon-extract"
)

Add-Type -AssemblyName System.Drawing

$sig = @'
using System;
using System.Runtime.InteropServices;
public static class IconDiag {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern uint PrivateExtractIconsW(string szFileName, int nIconIndex, int cxIcon, int cyIcon, IntPtr[] phicon, int[] piconid, int nIcons, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")]
  public static extern IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")]
  public static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);
  [DllImport("gdi32.dll")]
  public static extern bool DeleteObject(IntPtr hObject);
  [DllImport("gdi32.dll")]
  public static extern int GetObjectW(IntPtr hgdiobj, int cbBuffer, out BITMAP lpvObject);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr hIcon);
  [StructLayout(LayoutKind.Sequential)]
  public struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }
  [StructLayout(LayoutKind.Sequential)]
  public struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes; public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits; }
}
'@
if (-not ("IconDiag" -as [type])) { Add-Type -TypeDefinition $sig }

function Get-IconSize([IntPtr]$hIcon) {
  $ii = New-Object IconDiag+ICONINFO
  if (-not [IconDiag]::GetIconInfo($hIcon, [ref]$ii)) { return $null }
  $bm = New-Object IconDiag+BITMAP
  $ok = [IconDiag]::GetObjectW($ii.hbmColor, [System.Runtime.InteropServices.Marshal]::SizeOf($bm), [ref]$bm)
  if ($ii.hbmMask -ne [IntPtr]::Zero) { [IconDiag]::DeleteObject($ii.hbmMask) | Out-Null }
  if ($ii.hbmColor -ne [IntPtr]::Zero) { [IconDiag]::DeleteObject($ii.hbmColor) | Out-Null }
  if ($ok -eq 0) { return $null }
  return @{ Width = $bm.bmWidth; Height = $bm.bmHeight }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Write-Output ("Is64BitProcess=" + [Environment]::Is64BitProcess)

foreach ($exe in $Exe) {
  Write-Output ("`n===== EXE: " + $exe + " =====")
  if (-not (Test-Path -LiteralPath $exe)) { Write-Output "  MISSING"; continue }
  $fi = Get-Item -LiteralPath $exe
  Write-Output ("  bytes=" + $fi.Length + " mtime=" + $fi.LastWriteTime)
  $tag = if ($exe -match '\\debug\\') { 'debug' } else { 'release' }
  foreach ($s in $Sizes) {
    $hicons = New-Object IntPtr[] 1
    $ids = New-Object int[] 1
    $n = [IconDiag]::PrivateExtractIconsW($exe, 0, $s, $s, $hicons, $ids, 1, 0)
    if ($n -eq 0 -or $hicons[0] -eq [IntPtr]::Zero) { Write-Output ("  req=" + $s + " -> none"); continue }
    $sizeInfo = Get-IconSize $hicons[0]
    $png = Join-Path $OutDir ("{0}_{1}.png" -f $tag, $s)
    try {
      $ico = [System.Drawing.Icon]::FromHandle($hicons[0])
      $bmp = $ico.ToBitmap()
      $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      Write-Output ("  req=" + $s + " -> HICON size=" + $sizeInfo.Width + "x" + $sizeInfo.Height + " saved=" + $png)
    } catch {
      Write-Output ("  req=" + $s + " -> HICON size=" + $sizeInfo.Width + "x" + $sizeInfo.Height + " (save failed)")
    } finally {
      [IconDiag]::DestroyIcon($hicons[0]) | Out-Null
    }
  }
}

Write-Output "`n===== RUNNING WINDOW ICON ====="
$WM_GETICON = 0x7F
$ICON_SMALL = [IntPtr]0
$ICON_BIG = [IntPtr]1
$ICON_SMALL2 = [IntPtr]2
$GCLP_HICON = -14
$GCLP_HICONSM = -34
$procs = Get-Process | Where-Object { $_.ProcessName -match 'next-story' -and $_.MainWindowHandle -ne 0 }
if (-not $procs) { Write-Output "  no running process with a main window" }
foreach ($p in $procs) {
  $h = $p.MainWindowHandle
  Write-Output ("`n  PID=" + $p.Id + " path=" + $p.Path + " title=" + $p.MainWindowTitle)
  $a = [IconDiag]::SendMessage($h, $WM_GETICON, $ICON_SMALL, [IntPtr]::Zero)
  $b = [IconDiag]::SendMessage($h, $WM_GETICON, $ICON_BIG, [IntPtr]::Zero)
  $c = [IconDiag]::SendMessage($h, $WM_GETICON, $ICON_SMALL2, [IntPtr]::Zero)
  $clBig = [IconDiag]::GetClassLongPtr($h, $GCLP_HICON)
  $clSm = [IconDiag]::GetClassLongPtr($h, $GCLP_HICONSM)
  foreach ($pair in @(
    @{ n = "WM_GETICON ICON_SMALL"; v = $a }, @{ n = "WM_GETICON ICON_BIG"; v = $b }, @{ n = "WM_GETICON ICON_SMALL2"; v = $c },
    @{ n = "GetClassLongPtr GCLP_HICON"; v = $clBig }, @{ n = "GetClassLongPtr GCLP_HICONSM"; v = $clSm }
  )) {
    if ($pair.v -eq [IntPtr]::Zero) { Write-Output ("  " + $pair.n + " = 0 (not set)") }
    else { $sz = Get-IconSize $pair.v; Write-Output ("  " + $pair.n + " = " + $pair.v + " size=" + $sz.Width + "x" + $sz.Height) }
  }
}
