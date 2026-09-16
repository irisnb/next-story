// B 层粘贴样本：成对的 (html, text/plain) 合成粘贴内容，覆盖受控粘贴的代表性路径。
//
// plain 与 html 归一化投影必须满足受控粘贴的比较规则（或刻意不一致以触发整次拒绝）。
// 样本经 parseHtmlToBlocks（注入 happy-dom 的 DOMParser）→ decidePasteAction →
// insertContent 注入四种位置后冻结为 expected-paste/<key>-<position>.json。
export interface PasteFixture {
  /** 样本键，同时是冻结预期文件名前缀 expected-paste/<key>-<position>.json。 */
  key: string;
  /** 覆盖点说明。 */
  covers: string;
  expect: "insert" | "reject";
  /** 外部粘贴的 text/html 投影。 */
  html: string;
  /** 同一次粘贴的 text/plain 内容。 */
  plain: string;
}

export const pasteFixtures: PasteFixture[] = [
  {
    key: "basic-formats",
    covers: "基础格式映射：标题、粗斜、下划线、删除线、颜色、高亮、链接",
    expect: "insert",
    html: [
      "<h2>章节标题</h2>",
      "<p><strong>粗体</strong><em>斜体</em><u>下划线</u><s>删除线</s></p>",
      "<p><span style=\"color: #cc0000;\">红字</span>与<mark style=\"background-color: #fff3b0;\">高亮字</mark>以及<a href=\"https://example.com/ref\">参考链接</a></p>",
    ].join(""),
    plain: "章节标题\n粗体斜体下划线删除线\n红字与高亮字以及参考链接",
  },
  {
    key: "nested-lists",
    covers: "嵌套列表重建",
    expect: "insert",
    html: "<ul><li>水果<ul><li>苹果</li><li>香蕉</li></ul></li><li>蔬菜</li></ul>",
    plain: "水果\n苹果\n香蕉\n蔬菜",
  },
  {
    key: "table-degrade",
    covers: "表格降级为按行段落、单元格 Tab 分隔",
    expect: "insert",
    html: "<table><tr><td>场景</td><td>时间</td></tr><tr><td>夜市</td><td>傍晚</td></tr></table>",
    plain: "场景\t时间\n夜市\t傍晚",
  },
  {
    key: "br-split",
    covers: "br 拆分为多个段落（连续 br 之间的空段被丢弃是当前管线行为，一并冻结）",
    expect: "insert",
    html: "<p>第一行<br>第二行<br><br>第四行</p>",
    plain: "第一行\n第二行\n第四行",
  },
  {
    key: "ordered-start-3",
    covers: "有序列表 start=3，plain 侧带真实列表标记（覆盖 stripListMarker 路径）",
    expect: "insert",
    html: "<ol start=\"3\"><li>第三项</li><li>第四项</li></ol>",
    plain: "3. 第三项\n4. 第四项",
  },
  {
    key: "image-mixed",
    covers: "图文混合：图片被忽略、文字保留",
    expect: "insert",
    html: "<p>插图说明<img src=\"https://example.com/pic.png\" alt=\"示意图\">结尾</p>",
    plain: "插图说明结尾",
  },
  {
    key: "reject-mismatch",
    covers: "整次拒绝：html 投影与 plain 不一致",
    expect: "reject",
    html: "<p>甲乙丙丁</p>",
    plain: "甲乙丙戊",
  },
];
