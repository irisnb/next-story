# 公开编码表核对记录（Wingdings／Symbol）——任务 1.1

> 取证：@librarian 独立会话（独立于实现），2026-10-04，实时抓取原始 URL。
> 来源：
> - Wingdings：Alan Wood 表 https://www.alanwood.net/demos/wingdings.html （© 2003–2018 Alan Wood；业内通行对照源；本次抓取件本地留存 `C:\Users\Administrator\.local\share\opencode\tool-output\tool_1079405ca001i7Qxza3FTAMRQv`）
> - Symbol：Unicode 托管 Adobe 映射表 https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt （Table v1.0, 2011-07-12）
> 结论：审计修正清单（F01/F02/F03）与公开表**逐条一致、零差异**；对照组合规。
> 注意：规范依据以 **U+ 码位与 Unicode 名称原文**为准（个别手写字符本体可能失真，不用于断言）。

## Wingdings 待修正条目（21 条）

| 编码 | 目标 | Unicode 名称 | Alan Wood 行摘录 |
|---|---|---|---|
| FC | U+2714 | Heavy check mark | `252 0xFC checkbld` |
| FD | U+1F5F7 | Ballot box with bold script X | `253 0xFD boxxmarkbld` |
| FE | U+1F5F9 | Ballot box with bold check | `254 0xFE boxcheckbld` |
| 4C | U+2639 | White frowning face | `76 0x4C frownface` |
| A8 | U+25FB | White medium square | `168 0xA8 box2` |
| B7 | U+1F550 | Clock face one oclock | `183 0xB7 oneoclock` |
| CB | U+1F66A | Solid quilt square ornament | `203 0xCB quiltsquare2` |
| D8 | U+2B9A | Three-D top-lighted rightwards equilateral arrowhead | `216 0xD8 head2right` |
| E8 | U+1F87A | Wide-headed rightwards heavy barb arrow | `232 0xE8 barb4right` |
| E9 | U+1F879 | Wide-headed upwards heavy barb arrow | `233 0xE9 barb4up` |
| EA | U+1F87B | Wide-headed downwards heavy barb arrow | `234 0xEA barb4down` |
| EB | U+1F87C | Wide-headed north west heavy barb arrow | `235 0xEB barb4nw` |
| F2 | U+21E9 | Downwards white arrow | `242 0xF2 bdown` |
| AB | U+2605 | Black star | `171 0xAB pentastar2` |
| BB | U+1F554 | Clock face five oclock | `187 0xBB fiveoclock` |
| E7 | U+1F878 | Wide-headed leftwards heavy barb arrow | `231 0xE7 barb4left` |
| DC | U+2B8A | Rightwards black circled white arrow | `220 0xDC circleright` |
| C7 | U+2BB4 | Ribbon arrow left up | `199 0xC7 arrowleftup1` |
| 28 | U+1F57F | Black touchtone telephone | `40 0x28 telephonesolid` |
| 3F | U+270D | Writing hand | `63 0x3F handwrite` |
| FB | U+1F5F6 | Ballot bold script X | `251 0xFB xmarkbld` |

## Wingdings 对照组（确认保持一致，6 条）

| 编码 | 目标 | 名称 |
|---|---|---|
| 4A | U+263A | White smiling face |
| 4B | U+1F610 | Neutral face |
| 6E | U+25A0 | Black square |
| 6F | U+25A1 | White square |
| 71 | U+2751 | Lower right shadowed white square |
| A7 | U+25AA | Black small square |

## Symbol 待修正条目（5 条）

| Symbol 码 | 目标 | 名称 | 映射行原文 |
|---|---|---|---|
| D6 | U+221A | Square root | `221A	D6	# SQUARE ROOT	# radical` |
| D7 | U+22C5 | Dot operator | `22C5	D7	# DOT OPERATOR	# dotmath` |
| B2 | U+2033 | Double prime | `2033	B2	# DOUBLE PRIME	# second` |
| A1 | U+03D2 | Greek upsilon with hook symbol | `03D2	A1	# GREEK UPSILON WITH HOOK SYMBOL	# Upsilon1` |
| D1 | U+2207 | Nabla | `2207	D1	# NABLA	# gradient` |

## Symbol 对照组（确认保持一致，14 条）

- B1→U+00B1、B4→U+00D7、B8→U+00F7、B9→U+2260、BB→U+2248、A3→U+2264、B3→U+2265、A5→U+221E、B0→U+00B0、B7→U+2022、6C→U+03BB。
- 一对多如实列全：44→U+0394／U+2206、57→U+03A9／U+2126、6D→U+00B5／U+03BC（实现取首行：44→U+0394、57→U+03A9、6D→U+00B5，维持现状）。

## 与审计清单的差异

- 21 条 Wingdings＋5 条 Symbol 修正值：**全部一致，零差异**（逐条比对完成）。
- 对照组：全部确认无误。
- 声明：Alan Wood 表为个人维护的业内通行对照源；如需更硬依据可对 Microsoft 官方 `WINGDING.TXT` 交叉核验（本项未做）。
