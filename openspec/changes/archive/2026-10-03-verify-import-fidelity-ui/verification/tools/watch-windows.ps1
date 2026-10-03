param([int]$WatchSec = 12)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$deadline = (Get-Date).AddSeconds($WatchSec)
while ((Get-Date) -lt $deadline) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $wins) {
    try {
      $pid2 = $w.Current.ProcessId
      $proc = ""
      try { $proc = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch {}
      if ($proc -eq "next-story") {
        $cls = $w.Current.ClassName
        $n = $w.Current.Name
        if ($cls -ne "Chrome_WidgetWin_1" -or $n -ne "Next Story") {
          "NEW_WINDOW proc=next-story cls='$cls' title='$n'"
        }
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 500
}
"WATCH_DONE"
