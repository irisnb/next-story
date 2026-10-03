# Independent FDX source analysis (read-only; no project code involved)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$path = (Get-ChildItem -LiteralPath "C:\Users\Administrator\Desktop" -Filter "*.fdx" | Select-Object -First 1).FullName
$xml = New-Object System.Xml.XmlDocument
$xml.Load($path)
$root = $xml.DocumentElement
"ROOT: $($root.Name)"
$content = $root.SelectSingleNode("Content")
$paras = @($content.SelectNodes("Paragraph"))
"TOTAL_PARAGRAPHS: $($paras.Count)"

# ElementSettings summary
$settings = $root.SelectNodes("ElementSettings/Element")
"ELEMENT_SETTINGS:"
foreach ($s in $settings) {
  $type = $s.GetAttribute("Type")
  $align = $s.GetAttribute("Alignment")
  $li = $s.GetAttribute("LeftIndent")
  $ri = $s.GetAttribute("RightIndent")
  $fi = $s.GetAttribute("FirstIndent")
  "  $type align=$align left=$li right=$ri first=$fi"
}

# Paragraph type census + text extraction in document order
$typeCounts = @{}
$rows = [System.Collections.Generic.List[object]]::new()
$i = 0
foreach ($p in $paras) {
  $i++
  $type = $p.GetAttribute("Type")
  $number = $p.GetAttribute("Number")
  if (-not $type) { $type = "(none)" }
  if ($typeCounts.ContainsKey($type)) { $typeCounts[$type]++ } else { $typeCounts[$type] = 1 }
  # text: all Text descendants; DualDialogue contains Paragraph>Paragraph nesting
  $texts = $p.SelectNodes(".//Text")
  $sb = New-Object System.Text.StringBuilder
  foreach ($t in $texts) { [void]$sb.Append($t.InnerText) }
  $rows.Add([pscustomobject]@{ Idx = $i; Type = $type; Number = $number; Text = $sb.ToString() })
}
"TYPE_CENSUS:"
foreach ($k in ($typeCounts.Keys | Sort-Object)) { "  $k = $($typeCounts[$k])" }

# Structural elements
$dd = $paras | Where-Object { $_.GetAttribute("Type") -eq "Dual Dialogue" }
"DUAL_DIALOGUE_PARAS: $($dd.Count)"
$titlePages = $root.SelectNodes(".//TitlePage")
"TITLEPAGE_NODES: $($titlePages.Count)"
$tpParas = 0
foreach ($tp in $titlePages) { $tpParas += @($tp.SelectNodes(".//Paragraph")).Count }
"TITLEPAGE_PARAGRAPHS: $tpParas"
$scriptNotes = $root.SelectNodes(".//ScriptNote")
"SCRIPTNOTES: $($scriptNotes.Count)"
$sceneProps = $root.SelectNodes(".//SceneProperties")
"SCENEPROPERTIES: $($sceneProps.Count)"
$revs = $root.SelectNodes(".//Revision")
"INLINE_REVISION_NODES: $($revs.Count)"
$revSets = $root.SelectNodes("RevisionSettings")
"REVISION_SETTINGS: $($revSets.Count)"

# First 40 and last 30 paragraphs with text
"--- FIRST 40 ---"
$rows | Select-Object -First 40 | ForEach-Object { "{0,4} [{1}] num={2} :: {3}" -f $_.Idx, $_.Type, $_.Number, ($_.Text -replace "`n","\n") }
"--- LAST 30 ---"
$rows | Select-Object -Last 30 | ForEach-Object { "{0,4} [{1}] num={2} :: {3}" -f $_.Idx, $_.Type, $_.Number, ($_.Text -replace "`n","\n") }

# Repeated short scene-heading sequence check (split suggestion)
$headTexts = $rows | Where-Object { $_.Type -eq "Scene Heading" } | ForEach-Object { $_.Text.Trim() }
"SCENE_HEADINGS: $($headTexts.Count)"
$seq = $headTexts | Group-Object { if ($_ -match '^(.{1,6})') { ($matches[1] -replace '[0-9０-９一二三四五六七八九十百]+','$#') } else { $_ } } | Where-Object { $_.Count -ge 3 -and $_.Name.Length -le 8 }
"REPEATED_SHORT_SEQ_CANDIDATES:"
foreach ($g in ($seq | Sort-Object Count -Descending | Select-Object -First 10)) { "  $($g.Name) x$($g.Count)" }

# Full visible text join (Text nodes only, main Content) char count
$all = New-Object System.Text.StringBuilder
foreach ($p in $paras) { foreach ($t in $p.SelectNodes(".//Text")) { [void]$all.Append($t.InnerText) } }
"CONTENT_TEXT_CHARS: $($all.Length)"
# Save full paragraph dump for later comparison
$rows | ForEach-Object { "{0}`t{1}`t{2}`t{3}" -f $_.Idx, $_.Type, $_.Number, ($_.Text -replace "`r","").Replace("`n","\n") } | Set-Content -LiteralPath "C:\Users\Administrator\AppData\Local\Temp\opencode\fidelity-ui-20261003\fdx-paragraphs.tsv" -Encoding UTF8
"TSV_SAVED"
