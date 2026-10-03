param([int]$WatchSec = 10, [string]$Marker = "#32770")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$deadline = (Get-Date).AddSeconds($WatchSec)
$found = @()
while ((Get-Date) -lt $deadline) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $wins) {
    try {
      $cls = $w.Current.ClassName
      $n = $w.Current.Name
      $pid2 = $w.Current.ProcessId
      if ($cls -eq "#32770" -or $cls -like "*Dialog*" -or $n -like "*选择*" -or $n -like "*打开*" -or $n -like "*浏览*") {
        $key = "$cls|$n|$pid2"
        if ($found -notcontains $key) { $found += $key; "DIALOG_CANDIDATE cls='$cls' title='$n' pid=$pid2" }
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 400
}
if ($found.Count -eq 0) { "NO_DIALOG_CANDIDATES" }
"WATCH_DONE"
