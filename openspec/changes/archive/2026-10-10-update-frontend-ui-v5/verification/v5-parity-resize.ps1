param([int]$ClientWidth, [int]$ClientHeight, [ValidateSet('Resize','Inspect','Restore','Maximize')][string]$Action='Resize')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ParityWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc callback, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static IntPtr[] VisibleRoots(uint pid) {
    var rows=new System.Collections.Generic.List<IntPtr>();
    EnumWindows((h,l)=>{uint owner;GetWindowThreadProcessId(h,out owner);var s=new System.Text.StringBuilder(256);GetClassName(h,s,256);if(owner==pid&&GetAncestor(h,2)==h&&s.ToString()=="Tauri Window")rows.Add(h);return true;},IntPtr.Zero);
    return rows.ToArray();
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  public static object Bounds(IntPtr h) {
    RECT c, r; GetClientRect(h, out c); GetWindowRect(h, out r);
    var s=new System.Text.StringBuilder(256); GetClassName(h,s,256);
    return new { hwnd=h.ToInt64(), parent=GetParent(h).ToInt64(), root=GetAncestor(h,2).ToInt64(), windowClass=s.ToString(), client=new int[]{c.Right-c.Left,c.Bottom-c.Top}, screen=new int[]{r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top} };
  }
  public static object[] Children(IntPtr h) {
    var rows=new System.Collections.Generic.List<object>();
    EnumChildWindows(h,(child,l)=>{rows.Add(Bounds(child)); return true;},IntPtr.Zero);
    return rows.ToArray();
  }
}
'@
$parityProcesses = @(Get-Process -Name 'next-story' -ErrorAction Stop | Where-Object { $_.Path -eq 'D:\Next Story\src-tauri\target\debug\next-story.exe' -and $_.MainWindowHandle -ne 0 })
if ($parityProcesses.Count -ne 1) { throw 'Expected exactly one verified Next Story debug window' }
$parityProcess = $parityProcesses[0]
$parityRoots = @([ParityWindow]::VisibleRoots($parityProcess.Id))
if ($parityRoots.Count -ne 1) { $parityRoots | ForEach-Object { [ParityWindow]::Bounds($_) } | ConvertTo-Json -Depth 6; throw 'Expected one visible root window for verified debug PID' }
$parityHandle = $parityRoots[0]
if ([ParityWindow]::GetAncestor($parityHandle,2) -ne $parityHandle) { throw 'Refuse non-root window handle' }
$parityBefore = [ParityWindow]::Bounds($parityHandle)
$parityZoomedBefore = [ParityWindow]::IsZoomed($parityHandle)
if ($Action -eq 'Restore' -or $Action -eq 'Resize') { [void][ParityWindow]::ShowWindow($parityHandle,9) }
if ($Action -eq 'Maximize') { [void][ParityWindow]::ShowWindow($parityHandle,3) }
$parityClient = New-Object ParityWindow+RECT
$parityOuter = New-Object ParityWindow+RECT
[void][ParityWindow]::GetClientRect($parityHandle, [ref]$parityClient)
[void][ParityWindow]::GetWindowRect($parityHandle, [ref]$parityOuter)
$parityBorderWidth = ($parityOuter.Right-$parityOuter.Left)-($parityClient.Right-$parityClient.Left)
$parityBorderHeight = ($parityOuter.Bottom-$parityOuter.Top)-($parityClient.Bottom-$parityClient.Top)
if ($Action -eq 'Resize' -and -not [ParityWindow]::SetWindowPos($parityHandle,[IntPtr]::Zero,0,0,$ClientWidth+$parityBorderWidth,$ClientHeight+$parityBorderHeight,6)) { throw 'SetWindowPos failed' }
[void][ParityWindow]::GetClientRect($parityHandle,[ref]$parityClient)
@{pid=$parityProcess.Id; executable=$parityProcess.Path; action=$Action; dpi=[ParityWindow]::GetDpiForWindow($parityHandle); zoomedBefore=$parityZoomedBefore; zoomedAfter=[ParityWindow]::IsZoomed($parityHandle); before=$parityBefore; bounds=[ParityWindow]::Bounds($parityHandle); webviewChildBounds=[ParityWindow]::Children($parityHandle); client=@(($parityClient.Right-$parityClient.Left),($parityClient.Bottom-$parityClient.Top)); messagePath='ShowWindow/SetWindowPos on verified root HWND; no synthetic WM_SIZE sent'} | ConvertTo-Json -Depth 8 -Compress
