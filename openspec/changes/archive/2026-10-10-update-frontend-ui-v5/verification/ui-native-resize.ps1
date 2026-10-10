param([int]$ClientWidth, [int]$ClientHeight)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class UiWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
}
'@
$uiProcess = Get-Process -Id 25172 -ErrorAction Stop
if ($uiProcess.Path -ne 'D:\Next Story\src-tauri\target\debug\next-story.exe') { throw 'Owned PID executable mismatch' }
$uiHandle = $uiProcess.MainWindowHandle
if ($uiHandle -eq 0) { throw 'Owned app has no native window' }
$clientRect = New-Object UiWindow+RECT
$outerRect = New-Object UiWindow+RECT
[void][UiWindow]::GetClientRect($uiHandle, [ref]$clientRect)
[void][UiWindow]::GetWindowRect($uiHandle, [ref]$outerRect)
$borderWidth = ($outerRect.Right-$outerRect.Left)-($clientRect.Right-$clientRect.Left)
$borderHeight = ($outerRect.Bottom-$outerRect.Top)-($clientRect.Bottom-$clientRect.Top)
if (-not [UiWindow]::SetWindowPos($uiHandle,[IntPtr]::Zero,0,0,$ClientWidth+$borderWidth,$ClientHeight+$borderHeight,6)) { throw 'SetWindowPos failed' }
[void][UiWindow]::GetClientRect($uiHandle,[ref]$clientRect)
[void][UiWindow]::GetWindowRect($uiHandle,[ref]$outerRect)
@{pid=25172; dpi=[UiWindow]::GetDpiForWindow($uiHandle); client=@(($clientRect.Right-$clientRect.Left),($clientRect.Bottom-$clientRect.Top)); outer=@(($outerRect.Right-$outerRect.Left),($outerRect.Bottom-$outerRect.Top)); method='Win32 SetWindowPos; physical client pixels'} | ConvertTo-Json -Compress
