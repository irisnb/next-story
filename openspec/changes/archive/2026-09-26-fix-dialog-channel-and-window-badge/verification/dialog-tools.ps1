param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Out = "",
  [string]$ButtonText = "",
  [int]$ButtonId = -1,
  [int]$ButtonIndex = -1
)

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinDlg {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
Add-Type $code

function Get-DialogHandle {
  $found = [IntPtr]::Zero
  $cb = [WinDlg+EnumProc]{
    param($h, $l)
    if ([WinDlg]::IsWindowVisible($h)) {
      $wp = 0
      [void][WinDlg]::GetWindowThreadProcessId($h, [ref]$wp)
      $pn = (Get-Process -Id $wp -ErrorAction SilentlyContinue).ProcessName
      if ($pn -eq "next-story") {
        $cn = New-Object System.Text.StringBuilder 256
        [void][WinDlg]::GetClassName($h, $cn, 256)
        if ($cn.ToString() -eq "#32770") { $script:found = $h; return $false }
      }
    }
    return $true
  }
  [void][WinDlg]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:found
}

function Get-Children([IntPtr]$parent) {
  $list = New-Object System.Collections.Generic.List[object]
  $cb = [WinDlg+EnumProc]{
    param($h, $l)
    $cn = New-Object System.Text.StringBuilder 256
    [void][WinDlg]::GetClassName($h, $cn, 256)
    $len = [WinDlg]::GetWindowTextLength($h)
    $sb = New-Object System.Text.StringBuilder ($len + 2)
    [void][WinDlg]::GetWindowText($h, $sb, $sb.Capacity)
    $id = [WinDlg]::GetDlgCtrlID($h)
    $list.Add([pscustomobject]@{ Handle = $h; Class = $cn.ToString(); Id = $id; Text = $sb.ToString() })
    return $true
  }
  [void][WinDlg]::EnumChildWindows($parent, $cb, [IntPtr]::Zero)
  return $list
}

$dlg = Get-DialogHandle
if ($dlg -eq [IntPtr]::Zero) { Write-Output "NO_DIALOG"; exit 0 }

switch ($Action) {
  "list" {
    Write-Output "DIALOG_HANDLE: $dlg"
    Get-Children $dlg | ForEach-Object { Write-Output ("{0} | id={1} | {2}" -f $_.Class, $_.Id, $_.Text) }
  }
  "capture" {
    $r = New-Object WinDlg+RECT
    [void][WinDlg]::GetWindowRect($dlg, [ref]$r)
    $w = $r.Right - $r.Left
    $h = $r.Bottom - $r.Top
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    [void][WinDlg]::PrintWindow($dlg, $hdc, 2)
    $g.ReleaseHdc($hdc)
    $g.Dispose()
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "CAPTURED: $Out ($w x $h)"
  }
  "click" {
    $target = $null
    $children = Get-Children $dlg
    if ($ButtonIndex -ge 0) {
      $buttons = @($children | Where-Object { $_.Class -eq "Button" })
      if ($ButtonIndex -lt $buttons.Count) { $target = $buttons[$ButtonIndex] }
    } else {
      foreach ($child in $children) {
        if ($ButtonId -ge 0 -and $child.Id -eq $ButtonId) { $target = $child; break }
        if ($ButtonId -lt 0 -and $ButtonText -ne "" -and $child.Text -eq $ButtonText) { $target = $child; break }
      }
    }
    if ($null -eq $target) { Write-Output "BUTTON_NOT_FOUND"; exit 1 }
    # BM_CLICK = 0x00F5
    [void][WinDlg]::SendMessage($target.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Output ("CLICKED: {0} | id={1}" -f $target.Text, $target.Id)
  }
}
