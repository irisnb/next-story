# ns-resize.ps1 — fix-ui-friction-2026-10 真机冒烟的窗口尺寸助手。
# 沿 2026-10-10 update-frontend-ui-v5 ui-native-resize.ps1 的 Win32 做法，改为动态发现
# next-story 进程（不再硬编码 PID），并增加 -Query（只读当前尺寸）与外框精确还原模式。
# 用法：
#   powershell -File ns-resize.ps1 -Query
#   powershell -File ns-resize.ps1 -ClientWidth 980 -ClientHeight 720   （按客户区尺寸缩放，位置不动）
#   powershell -File ns-resize.ps1 -X l -Y t -OuterWidth w -OuterHeight h （按外框精确还原位置与尺寸）
param(
  [switch]$Query,
  [int]$ClientWidth = 0,
  [int]$ClientHeight = 0,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$OuterWidth = 0,
  [int]$OuterHeight = 0
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class NsWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
}
'@
$exe = 'D:\Next Story\src-tauri\target\debug\next-story.exe'
$proc = Get-Process -Name next-story -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) {
  $proc = Get-Process -Name next-story -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}
if (-not $proc) { throw 'next-story window not found' }
$h = $proc.MainWindowHandle
$c = New-Object NsWin+RECT
$o = New-Object NsWin+RECT
[void][NsWin]::GetClientRect($h, [ref]$c)
[void][NsWin]::GetWindowRect($h, [ref]$o)
if (-not $Query) {
  if ($OuterWidth -gt 0 -and $OuterHeight -gt 0) {
    if (-not [NsWin]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $OuterWidth, $OuterHeight, 0x0004)) { throw 'SetWindowPos failed' }
  } elseif ($ClientWidth -gt 0 -and $ClientHeight -gt 0) {
    $bw = ($o.Right - $o.Left) - ($c.Right - $c.Left)
    $bh = ($o.Bottom - $o.Top) - ($c.Bottom - $c.Top)
    if (-not [NsWin]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, $ClientWidth + $bw, $ClientHeight + $bh, 6)) { throw 'SetWindowPos failed' }
  } else {
    throw 'no size arguments'
  }
  [void][NsWin]::GetClientRect($h, [ref]$c)
  [void][NsWin]::GetWindowRect($h, [ref]$o)
}
@{ procId = $proc.Id; exe = $proc.Path; client = @(($c.Right - $c.Left), ($c.Bottom - $c.Top)); outer = @($o.Left, $o.Top, ($o.Right - $o.Left), ($o.Bottom - $o.Top)) } | ConvertTo-Json -Compress
