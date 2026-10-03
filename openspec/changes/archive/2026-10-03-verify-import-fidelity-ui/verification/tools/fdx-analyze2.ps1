# FDX part 2: TitlePage dump + ElementSettings presence + whitespace census
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$path = (Get-ChildItem -LiteralPath "C:\Users\Administrator\Desktop" -Filter "*.fdx" | Select-Object -First 1).FullName
$xml = New-Object System.Xml.XmlDocument
$xml.Load($path)
$root = $xml.DocumentElement
"CHILDREN_OF_ROOT:"
foreach ($c in $root.ChildNodes) { "  <$(($c.Name))> children=$(@($c.ChildNodes).Count)" }
$tp = $root.SelectSingleNode(".//TitlePage")
if ($tp) {
  "--- TITLEPAGE PARAGRAPHS (all) ---"
  $tpParas = @($tp.SelectNodes(".//Paragraph"))
  $i = 0
  foreach ($p in $tpParas) {
    $i++
    $type = $p.GetAttribute("Type"); $align = $p.GetAttribute("Alignment")
    $texts = $p.SelectNodes(".//Text")
    $sb = New-Object System.Text.StringBuilder
    foreach ($t in $texts) { [void]$sb.Append($t.InnerText) }
    "{0,3} [{1}] align={2} :: {3}" -f $i, $type, $align, ($sb.ToString() -replace "`r","").Replace("`n","\n")
  }
}
# Character/Dialogue/Parenthetical whitespace-only or multiline census in Content
$content = $root.SelectSingleNode("Content")
$multiline = 0; $empty = 0
foreach ($p in @($content.SelectNodes("Paragraph"))) {
  $t = ($p.SelectNodes(".//Text") | ForEach-Object { $_.InnerText }) -join ""
  if ($t -match "`n") { $multiline++ }
  if ($t.Trim() -eq "") { $empty++ }
}
"CONTENT_MULTILINE_PARAS: $multiline"
"CONTENT_EMPTY_TEXT_PARAS: $empty"
# Cast List and General and Shot paragraphs full text
foreach ($p in @($content.SelectNodes("Paragraph"))) {
  $type = $p.GetAttribute("Type")
  if ($type -in @("Cast List","General","Shot","Transition")) {
    $t = ($p.SelectNodes(".//Text") | ForEach-Object { $_.InnerText }) -join ""
    "SPECIAL [{0}] :: {1}" -f $type, ($t -replace "`r","").Replace("`n","\n")
  }
}
# ScriptNote text presence (should be dropped)
$snText = 0
foreach ($sn in $root.SelectNodes(".//ScriptNote")) {
  $t = ($sn.SelectNodes(".//Text") | ForEach-Object { $_.InnerText }) -join ""
  if ($t.Trim() -ne "") { $snText++ }
}
"SCRIPTNOTES_WITH_TEXT: $snText"
# TitlePage total text chars
$tpChars = 0
foreach ($t in $root.SelectNodes(".//TitlePage//Text")) { $tpChars += $t.InnerText.Length }
"TITLEPAGE_TEXT_CHARS: $tpChars"
