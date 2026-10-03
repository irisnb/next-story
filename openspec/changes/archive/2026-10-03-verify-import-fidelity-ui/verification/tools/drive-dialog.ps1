# Native dialog driver: waits for #32770 dialog, sets path, confirms.
# Usage: drive-dialog.ps1 -Path "<full path>" [-Kind file|folder] [-TimeoutSec 25]
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [string]$Kind = "file",
  [int]$TimeoutSec = 25
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$dlg = $null
while ((Get-Date) -lt $deadline -and -not $dlg) {
  Start-Sleep -Milliseconds 400
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "#32770")))
  foreach ($w in $wins) {
    try {
      if ($w.Current.IsOffscreen -eq $false -and $w.Current.Name) { $dlg = $w; break }
    } catch {}
  }
}
if (-not $dlg) { Write-Output "DIALOG_NOT_FOUND"; exit 1 }
Write-Output ("DIALOG_FOUND: '" + $dlg.Current.Name + "' pid=" + $dlg.Current.ProcessId)

# find edit box (prefer AutomationId 1001 = File name)
$edits = $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
$edit = $null
foreach ($e in $edits) { if ($e.Current.AutomationId -eq "1001") { $edit = $e } }
if (-not $edit -and $edits.Count -gt 0) { $edit = $edits[$edits.Count - 1] }
if (-not $edit) { Write-Output "EDIT_NOT_FOUND count=$($edits.Count)"; exit 2 }

try {
  $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue($Path)
  Write-Output "PATH_SET_VP"
} catch {
  try {
    $edit.SetFocus()
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait($Path)
    Write-Output "PATH_SET_SENDKEYS"
  } catch { Write-Output ("PATH_SET_FAILED: " + $_.Exception.Message); exit 3 }
}
Start-Sleep -Milliseconds 400

# confirm: button AutomationId "1" (Open / Select Folder); fallback Enter
$btn = $null
$btns = $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
foreach ($b in $btns) { if ($b.Current.AutomationId -eq "1") { $btn = $b } }
$invoked = $false
if ($btn) {
  try {
    $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $ip.Invoke()
    $invoked = $true
    Write-Output ("CONFIRM_CLICKED: '" + $btn.Current.Name + "'")
  } catch {}
}
if (-not $invoked) {
  $edit.SetFocus()
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Write-Output "CONFIRM_ENTER"
}
Start-Sleep -Milliseconds 600
Write-Output "DONE"
