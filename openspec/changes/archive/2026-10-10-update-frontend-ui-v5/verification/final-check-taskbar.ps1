# final-check taskbar verification (read-only shell check; launches the release exe,
# queries window icon resolution, screenshots the taskbar, then stops the app it started).
param(
  [string]$ExePath = "D:\Next Story\src-tauri\target\release\next-story.exe",
  [string]$OutDir = "D:\Next Story\openspec\changes\update-frontend-ui-v5\verification\icon-final-taskbar-2026-10-10"
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class TaskbarWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
  [DllImport("gdi32.dll")] public static extern int GetObjectW(IntPtr hgdiobj, int cbBuffer, out BITMAP lpvObject);
  [StructLayout(LayoutKind.Sequential)]
  public struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }
  [StructLayout(LayoutKind.Sequential)]
  public struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes; public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits; }
}
'@
if (-not ("TaskbarWin" -as [type])) { Add-Type -TypeDefinition $code }

function Get-IconSize([IntPtr]$hIcon) {
  $ii = New-Object TaskbarWin+ICONINFO
  if (-not [TaskbarWin]::GetIconInfo($hIcon, [ref]$ii)) { return $null }
  $bm = New-Object TaskbarWin+BITMAP
  $ok = [TaskbarWin]::GetObjectW($ii.hbmColor, [System.Runtime.InteropServices.Marshal]::SizeOf($bm), [ref]$bm)
  if ($ii.hbmMask -ne [IntPtr]::Zero) { [TaskbarWin]::DeleteObject($ii.hbmMask) | Out-Null }
  if ($ii.hbmColor -ne [IntPtr]::Zero) { [TaskbarWin]::DeleteObject($ii.hbmColor) | Out-Null }
  if ($ok -eq 0) { return $null }
  return @{ Width = $bm.bmWidth; Height = $bm.bmHeight }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$outAbs = (Resolve-Path $OutDir).Path

Write-Output ("launching: " + $ExePath)
$before = Get-Date
$proc = Start-Process -FilePath $ExePath -PassThru
$pidVal = $proc.Id
Write-Output ("pid=" + $pidVal)

# wait for a visible main window
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $found = New-Object System.Collections.ArrayList
  $targetPid = [uint32]$pidVal
  $cb = [TaskbarWin+EnumProc]{ param($h,$l) [uint32]$wpid=0; [TaskbarWin]::GetWindowThreadProcessId($h,[ref]$wpid) | Out-Null; if ($wpid -eq $targetPid) { $cn=New-Object System.Text.StringBuilder 256; [TaskbarWin]::GetClassName($h,$cn,256)|Out-Null; $tt=New-Object System.Text.StringBuilder 256; [TaskbarWin]::GetWindowText($h,$tt,256)|Out-Null; if ([TaskbarWin]::IsWindowVisible($h)) { [void]$found.Add([pscustomobject]@{Hwnd=$h;Class=$cn.ToString();Title=$tt.ToString()}) } }; return $true }
  [TaskbarWin]::EnumWindows($cb,[IntPtr]::Zero) | Out-Null
  $root = $found | Where-Object { $_.Class -eq 'Tauri Window' } | Select-Object -First 1
  if ($root) { $hwnd = $root.Hwnd; break }
}

Write-Output "=== visible top-level windows ==="
if ($found.Count -eq 0) { Write-Output "(none)" } else { $found | ForEach-Object { Write-Output ("hwnd={0} class='{1}' title='{2}'" -f $_.Hwnd,$_.Class,$_.Title) } }
Write-Output ("Tauri root hwnd=" + $hwnd)

if ($hwnd -ne [IntPtr]::Zero) {
  $WM_GETICON = 0x7F
  $pairs = @(
    @{ n="WM_GETICON ICON_SMALL"; v=[TaskbarWin]::SendMessage($hwnd,$WM_GETICON,[IntPtr]0,[IntPtr]::Zero) },
    @{ n="WM_GETICON ICON_BIG"; v=[TaskbarWin]::SendMessage($hwnd,$WM_GETICON,[IntPtr]1,[IntPtr]::Zero) },
    @{ n="WM_GETICON ICON_SMALL2"; v=[TaskbarWin]::SendMessage($hwnd,$WM_GETICON,[IntPtr]2,[IntPtr]::Zero) },
    @{ n="GetClassLongPtr GCLP_HICON"; v=[TaskbarWin]::GetClassLongPtr($hwnd,-14) },
    @{ n="GetClassLongPtr GCLP_HICONSM"; v=[TaskbarWin]::GetClassLongPtr($hwnd,-34) }
  )
  Write-Output "=== window icon resolution ==="
  foreach ($p in $pairs) {
    if ($p.v -eq [IntPtr]::Zero) {
      Write-Output ("  " + $p.n + " = 0 (not set -> taskbar falls back to exe embedded icon)")
    } else {
      $s = Get-IconSize $p.v
      Write-Output ("  " + $p.n + " = " + $p.v + " size=" + $s.Width + "x" + $s.Height)
      try {
        $ico = [System.Drawing.Icon]::FromHandle($p.v)
        $bmp = $ico.ToBitmap()
        $pth = Join-Path $outAbs (($p.n -replace '[^A-Za-z0-9]+','-') + ".png")
        $bmp.Save($pth, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Output ("      saved " + $pth)
      } catch { Write-Output ("      save failed: " + $_.Exception.Message) }
    }
  }
}

# screenshots: full screen and bottom taskbar strip
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output ("screen bounds: " + $bounds.Width + "x" + $bounds.Height)
$fullBmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($fullBmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$fullPath = Join-Path $outAbs "taskbar-fullscreen.png"
$fullBmp.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
$fullBmp.Dispose()

$stripH = 64
$strip = New-Object System.Drawing.Bitmap $bounds.Width, $stripH
$g2 = [System.Drawing.Graphics]::FromImage($strip)
$g2.CopyFromScreen([System.Drawing.Point]::new($bounds.X, $bounds.Y + $bounds.Height - $stripH), [System.Drawing.Point]::Empty, [System.Drawing.Size]::new($bounds.Width, $stripH))
$g2.Dispose()
$stripPath = Join-Path $outAbs "taskbar-strip.png"
$strip.Save($stripPath, [System.Drawing.Imaging.ImageFormat]::Png)
$strip.Dispose()
Write-Output ("saved " + $fullPath)
Write-Output ("saved " + $stripPath)

Write-Output ("stopping owned pid " + $pidVal)
Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$still = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
Write-Output ("stopped=" + (-not [bool]$still))
