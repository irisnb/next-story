[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$path = (Get-ChildItem -LiteralPath "C:\Users\Administrator\Desktop" -Filter "*.fdx" | Select-Object -First 1).FullName
$xml = New-Object System.Xml.XmlDocument
$xml.Load($path)
$root = $xml.DocumentElement
foreach ($es in $root.SelectNodes("ElementSettings")) {
  "=== ElementSettings ==="
  $es.OuterXml.Substring(0, [Math]::Min(500, $es.OuterXml.Length))
  ""
}
# Dual dialogue check: find the General paragraph raw XML (MARY... block)
$content = $root.SelectSingleNode("Content")
foreach ($p in @($content.SelectNodes("Paragraph"))) {
  $t = ($p.SelectNodes(".//Text") | ForEach-Object { $_.InnerText }) -join ""
  if ($t -like "MARYBut Daddy*") {
    "=== GENERAL (MARY block) RAW ==="
    $p.OuterXml
  }
}
# Character Henry whitespace para raw
$i = 0
foreach ($p in @($content.SelectNodes("Paragraph"))) {
  $i++
  if ($i -eq 11) { "=== PARA 11 (Henry) RAW ==="; $p.OuterXml }
}
