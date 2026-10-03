[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $wins) {
  try {
    $n = $w.Current.Name
    $cls = $w.Current.ClassName
    $pid = $w.Current.ProcessId
    $off = $w.Current.IsOffscreen
    $proc = ""
    try { $proc = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch {}
    if ($proc -eq "next-story" -or $cls -eq "#32770") {
      "pid=$pid proc=$proc cls='$cls' offscreen=$off title='$n'"
    }
  } catch {}
}
"ENUM_DONE"
