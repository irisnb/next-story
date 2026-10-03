# Independent DOCX source re-derivation (read-only; stdlib zip+xml only)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = (Get-ChildItem -LiteralPath "C:\Users\Administrator\Desktop" -Filter "*.docx" | Select-Object -First 1).FullName
"FILE: $path"
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
$entry = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" }
$ms = New-Object System.IO.MemoryStream
$s = $entry.Open(); $s.CopyTo($ms); $s.Close()
$zip.Dispose()
$xml = New-Object System.Xml.XmlDocument
$xml.LoadXml([System.Text.Encoding]::UTF8.GetString($ms.ToArray()))
$nsm = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$nsm.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
$body = $xml.SelectSingleNode("//w:body", $nsm)
$paras = @($body.SelectNodes("w:p", $nsm))
"TOTAL_W_P: $($paras.Count)"
$brTotal = 0
$brParasText = @()
$numPrParas = 0
$pStyleParas = 0
$rStyleRuns = 0
$symRuns = 0
$charTotal = 0
$emptyParas = 0
$jiParas = 0
$jiVals = @{}
$i = 0
foreach ($p in $paras) {
  $i = $i + 1
  $brs = @($p.SelectNodes(".//w:br", $nsm)).Count
  if ($brs -gt 0) {
    $brTotal = $brTotal + $brs
    $brParasText += $i
  }
  if (@($p.SelectNodes(".//w:numPr", $nsm)).Count -gt 0) { $numPrParas = $numPrParas + 1 }
  if (@($p.SelectNodes(".//w:pStyle", $nsm)).Count -gt 0) { $pStyleParas = $pStyleParas + 1 }
  $rStyleRuns = $rStyleRuns + @($p.SelectNodes(".//w:r/w:rStyle", $nsm)).Count
  $symRuns = $symRuns + @($p.SelectNodes(".//w:sym", $nsm)).Count
  $txt = ($p.SelectNodes(".//w:t", $nsm) | ForEach-Object { $_.InnerText }) -join ""
  $charTotal = $charTotal + $txt.Length
  if ($txt.Trim().Length -eq 0) { $emptyParas = $emptyParas + 1 }
  if ($txt -match "第[0-9０-９一二三四五六七八九十百千]+集") { $jiParas = $jiParas + 1 }
  if ($txt -match "^(第[0-9０-９一二三四五六七八九十百千]+集)") { $jiVals[$matches[1]] = 1 }
}
"W_BR_TOTAL: $brTotal"
"W_BR_PARA_INDEXES: $($brParasText -join ',')"
"NUMPR_PARAS: $numPrParas"
"PSTYLE_PARAS: $pStyleParas"
"RSTYLE_RUNS: $rStyleRuns"
"SYM_RUNS: $symRuns"
"CHAR_TOTAL_W_T: $charTotal"
"EMPTY_OR_WS_PARAS: $emptyParas"
"JI_MARK_PARAS: $jiParas"
"UNIQUE_JI_VALUES: $($jiVals.Count)"
"TABLES: $(@($body.SelectNodes('.//w:tbl', $nsm)).Count)"
"DRAWINGS: $(@($body.SelectNodes('.//w:drawing', $nsm)).Count)"
foreach ($idx in @(1, 2, 3, 804, 805)) {
  $txt = ($paras[$idx - 1].SelectNodes(".//w:t", $nsm) | ForEach-Object { $_.InnerText }) -join ""
  $show = $txt.Substring(0, [Math]::Min(60, $txt.Length))
  "PARA_$idx`: $show"
}
# dump full paragraph texts for expected-sequence comparison (w:t only, joined per para)
$lines = @()
foreach ($p in $paras) {
  $txt = ($p.SelectNodes(".//w:t", $nsm) | ForEach-Object { $_.InnerText }) -join ""
  $lines += $txt
}
$lines | Set-Content -LiteralPath "C:\Users\Administrator\AppData\Local\Temp\opencode\fidelity-ui-20261003\docx-paragraphs.txt" -Encoding UTF8
"DOCX_PARAS_DUMPED: $($lines.Count)"
