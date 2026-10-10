//! 选区派生（change: fix-ai-and-making-usability，design D4）。
//!
//! 与前端 `src/structured-notebook.ts` 的 `serializeSelectionToPlainText` /
//! `src/shared-document-models.ts` 的 `collectSharedBlocks` **同源**的选区派生：
//! 在已授权的结构化文档（canonical notebook JSON）上，按与编辑器一致的位置模型
//! 定位请求声明的那段选区并派生其原文。
//!
//! 位置模型与 ProseMirror 一致：`doc` 节点自身的开 / 闭 token 不计入位置，
//! 第一个块从 0 开始；文本节点贡献 UTF-16 码元长度（与 JS `String.length` 一致）。
//! 派生规则逐字对齐前端：块间单个 LF、空段落表示为空行、完整非空列表项加
//! `- ` / 实际编号前缀并按嵌套深度缩进 2 空格 × 深度、部分列表项不加前缀也不
//! 缩进、丢弃标题等级与全部行内标记及段落属性、不产生前导或尾随 LF。
//!
//! 本模块是纯函数：不读磁盘、不写任何字节、不记录正文。

use serde_json::Value;

/// 结构化选区范围（ProseMirror 文档位置，左闭右开）。
/// 与「canonical JSON 字符串偏移」无关：这是编辑器文档坐标，不是 JSON 字节偏移。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SelectionRange {
    pub from: usize,
    pub to: usize,
}

/// UTF-16 码元长度（与 JS `String.length` 一致，用于与前端位置模型对齐）。
pub(crate) fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// 把 UTF-16 码元偏移映射为字节偏移；落在代理对中间（非字符边界）时返回 `None`。
fn utf16_boundary_to_byte(s: &str, target: usize) -> Option<usize> {
    if target == 0 {
        return Some(0);
    }
    let mut units = 0usize;
    for (byte_index, ch) in s.char_indices() {
        units += ch.len_utf16();
        if units == target {
            return Some(byte_index + ch.len_utf8());
        }
        if units > target {
            // 目标偏移落在某个代理对中间：不是合法文本边界，失败关闭。
            return None;
        }
    }
    if units == target {
        Some(s.len())
    } else {
        None
    }
}

/// 按 UTF-16 码元区间切分字符串；任一端不在字符边界时返回 `None`。
pub(crate) fn utf16_slice(s: &str, start: usize, end: usize) -> Option<&str> {
    if start > end {
        return None;
    }
    let byte_start = utf16_boundary_to_byte(s, start)?;
    let byte_end = utf16_boundary_to_byte(s, end)?;
    if byte_start > byte_end {
        return None;
    }
    Some(&s[byte_start..byte_end])
}

/// 按 ProseMirror 位置模型计算节点尺寸（与前端 `nodeSize` 逐字一致）：
/// 文本节点返回 UTF-16 码元长度；其余节点返回 `2 + 子节点尺寸总和`。
fn node_size(node: &Value) -> usize {
    if node.get("type").and_then(Value::as_str) == Some("text") {
        return utf16_len(node.get("text").and_then(Value::as_str).unwrap_or(""));
    }
    let mut size = 2usize;
    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            size += node_size(child);
        }
    }
    size
}

/// 段落 / 标题的行内可见文字（按子文本节点顺序拼接；非文本节点贡献空串）。
fn inline_text(content: Option<&Vec<Value>>) -> String {
    let mut out = String::new();
    if let Some(nodes) = content {
        for node in nodes {
            if let Some(text) = node.get("text").and_then(Value::as_str) {
                out.push_str(text);
            }
        }
    }
    out
}

/// 双射二十六进制字母编号（1→A、26→Z、27→AA）；`upper` 为假时小写。
fn letter_marker(value: i64, upper: bool) -> String {
    let mut n = value;
    if n < 1 {
        return n.to_string();
    }
    let mut out: Vec<char> = Vec::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        let base = if upper { b'A' } else { b'a' };
        out.push((base + rem as u8) as char);
        n = (n - 1) / 26;
    }
    out.reverse();
    out.into_iter().collect()
}

/// 标准减法式罗马数字（1954→MCMXCIV）；`upper` 为假时小写；超过 3999 重复 M。
fn roman_marker(value: i64, upper: bool) -> String {
    let mut n = value;
    if n < 1 {
        return n.to_string();
    }
    const TABLE: [(i64, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (num, symbol) in TABLE {
        while n >= num {
            out.push_str(symbol);
            n -= num;
        }
    }
    if upper {
        out
    } else {
        out.to_lowercase()
    }
}

/// 归一化有序列表编号样式：`"A" / "a" / "I" / "i"` 保留，其余（含缺省）回退 `"1"`。
fn normalize_ordered_style(raw: Option<&Value>) -> &'static str {
    match raw.and_then(Value::as_str) {
        Some("A") => "A",
        Some("a") => "a",
        Some("I") => "I",
        Some("i") => "i",
        _ => "1",
    }
}

/// 按编号样式生成列表标记（不含尾部 `. `）。
fn ordered_marker(value: i64, style: &str) -> String {
    match style {
        "A" => letter_marker(value, true),
        "a" => letter_marker(value, false),
        "I" => roman_marker(value, true),
        "i" => roman_marker(value, false),
        _ => value.to_string(),
    }
}

/// 一个「行块」的派生记录（与前端 `SelectionLine` 同形）。
struct ProjectedLine {
    start: usize,
    end: usize,
    text_start: usize,
    text_end: usize,
    text: String,
    /// 完整列表项使用的前缀（`- ` 或 `N. `）；非列表项为 `None`。
    prefix: Option<String>,
    /// 列表嵌套深度（顶层 0），用于纯文本投影缩进。
    depth: usize,
}

fn visit_list(list: &Value, list_pos: usize, depth: usize, records: &mut Vec<ProjectedLine>) {
    let is_ordered = list.get("type").and_then(Value::as_str) == Some("orderedList");
    let attrs = list.get("attrs");
    let start_attr = attrs.and_then(|a| a.get("start")).and_then(Value::as_i64);
    let ordered_start = match start_attr {
        Some(value) if value >= 1 => value,
        _ => 1,
    };
    let style = normalize_ordered_style(attrs.and_then(|a| a.get("type")));

    let mut item_pos = list_pos + 1;
    let mut index: i64 = 0;
    if let Some(items) = list.get("content").and_then(Value::as_array) {
        for item in items {
            let item_end = item_pos + node_size(item);
            let item_content = item.get("content").and_then(Value::as_array);
            let paragraph = item_content.and_then(|content| content.first());
            if let Some(paragraph) = paragraph {
                let paragraph_pos = item_pos + 1;
                let paragraph_size = node_size(paragraph);
                let text = inline_text(paragraph.get("content").and_then(Value::as_array));
                let text_start = paragraph_pos + 1;
                let prefix = if is_ordered {
                    format!("{}. ", ordered_marker(ordered_start + index, style))
                } else {
                    "- ".to_string()
                };
                records.push(ProjectedLine {
                    // 行范围用列表项自身段落范围，不含嵌套子列表（与前端一致）。
                    start: paragraph_pos,
                    end: paragraph_pos + paragraph_size,
                    text_start,
                    text_end: text_start + utf16_len(&text),
                    text,
                    prefix: Some(prefix),
                    depth,
                });
                if let Some(content) = item_content {
                    if content.len() == 2 {
                        visit_list(
                            &content[1],
                            paragraph_pos + paragraph_size,
                            depth + 1,
                            records,
                        );
                    }
                }
            }
            item_pos = item_end;
            index += 1;
        }
    }
}

/// 展开文档为扁平行块记录（与前端 `collectSharedBlocks` 逐字一致）。
fn collect_lines(document: &Value) -> Vec<ProjectedLine> {
    let mut records: Vec<ProjectedLine> = Vec::new();
    let mut pos = 0usize;
    if let Some(blocks) = document.get("content").and_then(Value::as_array) {
        for block in blocks {
            let block_start = pos;
            let block_end = pos + node_size(block);
            let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
            if block_type == "paragraph" || block_type == "heading" {
                let text = inline_text(block.get("content").and_then(Value::as_array));
                let text_start = block_start + 1;
                records.push(ProjectedLine {
                    start: block_start,
                    end: block_end,
                    text_start,
                    text_end: text_start + utf16_len(&text),
                    text,
                    prefix: None,
                    depth: 0,
                });
            } else {
                visit_list(block, block_start, 0, &mut records);
            }
            pos = block_end;
        }
    }
    records
}

/// 文档内容的位置总长（`doc` 自身开 / 闭 token 不计入）。
fn content_position_size(document: &Value) -> usize {
    document
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| blocks.iter().map(node_size).sum())
        .unwrap_or(0)
}

/// 在已授权结构化材料（canonical notebook JSON）上，按前端同源语义派生 `[from, to)`
/// 选区原文。返回 `None` 表示材料不是合法结构化文档、范围越界或切分落在代理对中间
/// （失败关闭）；`Some("")` 表示范围内无可见文字。
pub(crate) fn derive_selection_text(
    canonical_notebook_json: &str,
    range: SelectionRange,
) -> Option<String> {
    let from = range.from;
    let to = range.to;
    let value: Value = serde_json::from_str(canonical_notebook_json).ok()?;
    let document = value.get("document")?;
    if document.get("type").and_then(Value::as_str) != Some("doc") {
        return None;
    }
    if from > to {
        return None;
    }
    if to > content_position_size(document) {
        return None;
    }
    if from >= to {
        return Some(String::new());
    }

    let lines = collect_lines(document);
    let mut parts: Vec<String> = Vec::new();
    for line in &lines {
        if line.end <= from || line.start >= to {
            continue;
        }
        let sel_start = line.text_start.max(from);
        let sel_end = line.text_end.min(to);
        let selected = if sel_start >= sel_end {
            String::new()
        } else {
            utf16_slice(
                &line.text,
                sel_start - line.text_start,
                sel_end - line.text_start,
            )?
            .to_string()
        };
        let fully_selected = from <= line.text_start && to >= line.text_end;
        if let Some(prefix) = &line.prefix {
            if fully_selected && !selected.is_empty() {
                parts.push(format!("{}{}{}", "  ".repeat(line.depth), prefix, selected));
                continue;
            }
        }
        parts.push(selected);
    }
    Some(parts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(value: Value) -> String {
        serde_json::to_string(&serde_json::json!({
            "format": "next-story-tiptap",
            "version": 3,
            "document": value
        }))
        .expect("serialize notebook")
    }

    fn doc_node(content: Value) -> Value {
        serde_json::json!({ "type": "doc", "content": content })
    }

    fn derive(node: Value, from: usize, to: usize) -> String {
        derive_selection_text(&doc(node), SelectionRange { from, to }).expect("derive")
    }

    #[test]
    fn projects_plain_paragraph_selection() {
        let node = doc_node(serde_json::json!([
            { "type": "paragraph", "content": [{ "type": "text", "text": "背叛" }] }
        ]));
        assert_eq!(derive(node, 1, 3), "背叛");
    }

    #[test]
    fn drops_heading_level_and_inline_marks() {
        let node = doc_node(serde_json::json!([
            {
                "type": "heading",
                "attrs": { "level": 1 },
                "content": [
                    { "type": "text", "text": "标", "marks": [{ "type": "bold" }] },
                    { "type": "text", "text": "题" }
                ]
            }
        ]));
        assert_eq!(derive(node, 1, 3), "标题");
    }

    #[test]
    fn projects_full_bullet_list_items_with_markers() {
        let node = doc_node(serde_json::json!([
            {
                "type": "bulletList",
                "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "第一项" }] }] },
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "第二项" }] }] }
                ]
            }
        ]));
        assert_eq!(derive(node, 3, 13), "- 第一项\n- 第二项");
    }

    #[test]
    fn projects_full_ordered_list_items_with_actual_numbers() {
        let node = doc_node(serde_json::json!([
            {
                "type": "orderedList",
                "attrs": { "start": 3 },
                "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "第三项" }] }] },
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "第四项" }] }] }
                ]
            }
        ]));
        assert_eq!(derive(node, 3, 13), "3. 第三项\n4. 第四项");
    }

    #[test]
    fn projects_styled_ordered_list_markers() {
        let node = doc_node(serde_json::json!([
            {
                "type": "orderedList",
                "attrs": { "start": 3, "type": "A" },
                "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "甲项" }] }] },
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "乙项" }] }] }
                ]
            },
            {
                "type": "orderedList",
                "attrs": { "start": 4, "type": "i" },
                "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "丙项" }] }] }
                ]
            }
        ]));
        assert_eq!(derive(node.clone(), 3, 11), "C. 甲项\nD. 乙项");
        assert_eq!(derive(node, 17, 19), "iv. 丙项");
    }

    #[test]
    fn projects_partial_list_item_without_marker() {
        let node = doc_node(serde_json::json!([
            {
                "type": "orderedList",
                "attrs": { "start": 3 },
                "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "第三项" }] }] }
                ]
            }
        ]));
        assert_eq!(derive(node, 4, 6), "三项");
    }

    #[test]
    fn joins_full_list_item_and_paragraph_with_single_lf() {
        let node = doc_node(serde_json::json!([
            {
                "type": "orderedList",
                "attrs": { "start": 3 },
                "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "选择" }] }] }
                ]
            },
            { "type": "paragraph", "content": [{ "type": "text", "text": "代价" }] }
        ]));
        assert_eq!(derive(node, 3, 11), "3. 选择\n代价");
    }

    #[test]
    fn projects_partial_list_item_crossing_into_paragraph_without_marker() {
        let node = doc_node(serde_json::json!([
            {
                "type": "orderedList",
                "attrs": { "start": 3 },
                "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "选择" }] }] }
                ]
            },
            { "type": "paragraph", "content": [{ "type": "text", "text": "代价" }] }
        ]));
        assert_eq!(derive(node, 4, 10), "择\n代");
    }

    #[test]
    fn preserves_empty_paragraph_as_empty_line() {
        let node = doc_node(serde_json::json!([
            { "type": "paragraph", "content": [{ "type": "text", "text": "甲" }] },
            { "type": "paragraph" },
            { "type": "paragraph", "content": [{ "type": "text", "text": "乙" }] }
        ]));
        assert_eq!(derive(node, 1, 7), "甲\n\n乙");
    }

    #[test]
    fn produces_no_leading_or_trailing_lf_for_boundary_aligned_selection() {
        let node = doc_node(serde_json::json!([
            { "type": "paragraph", "content": [{ "type": "text", "text": "甲" }] },
            { "type": "paragraph", "content": [{ "type": "text", "text": "乙" }] }
        ]));
        assert_eq!(derive(node, 1, 5), "甲\n乙");
    }

    #[test]
    fn preserves_leading_and_trailing_spaces_and_emoji() {
        let text = "  前 后  🎬";
        let node = doc_node(serde_json::json!([
            { "type": "paragraph", "content": [{ "type": "text", "text": text }] }
        ]));
        // 段落 [0, 2 + utf16(text)]，文字 [1, 1 + utf16(text)]。
        assert_eq!(derive(node, 1, 1 + utf16_len(text)), text);
    }

    #[test]
    fn projects_nested_list_items_with_indentation() {
        let node = doc_node(serde_json::json!([
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            { "type": "paragraph", "content": [{ "type": "text", "text": "父项" }] },
                            {
                                "type": "bulletList",
                                "content": [
                                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "子项一" }] }] },
                                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "子项二" }] }] }
                                ]
                            }
                        ]
                    },
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "父项二" }] }] }
                ]
            }
        ]));
        assert_eq!(
            derive(node, 3, 28),
            "- 父项\n  - 子项一\n  - 子项二\n- 父项二"
        );
    }

    #[test]
    fn partial_nested_list_item_gets_no_prefix_or_indent() {
        let node = doc_node(serde_json::json!([
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            { "type": "paragraph", "content": [{ "type": "text", "text": "父项" }] },
                            {
                                "type": "bulletList",
                                "content": [
                                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "子项一" }] }] }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]));
        // 只选子项一中间的 "项" 字（[10,11]），不补前缀不补缩进。
        assert_eq!(derive(node, 10, 11), "项");
    }

    #[test]
    fn rejects_out_of_bounds_range() {
        let node = doc_node(serde_json::json!([
            { "type": "paragraph", "content": [{ "type": "text", "text": "甲" }] }
        ]));
        assert!(derive_selection_text(&doc(node), SelectionRange { from: 1, to: 99 }).is_none());
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(derive_selection_text("not json", SelectionRange { from: 0, to: 1 }).is_none());
    }

    #[test]
    fn rejects_range_splitting_a_surrogate_pair() {
        let node = doc_node(serde_json::json!([
            { "type": "paragraph", "content": [{ "type": "text", "text": "🎬" }] }
        ]));
        // "🎬" 占 2 个 UTF-16 码元；切在代理对中间（[1,2]）必须失败关闭。
        assert!(derive_selection_text(&doc(node), SelectionRange { from: 1, to: 2 }).is_none());
    }

    #[test]
    fn utf16_length_matches_js_string_length_for_emoji() {
        assert_eq!(utf16_len("🎬"), 2);
        assert_eq!(utf16_len("abc"), 3);
        assert_eq!(utf16_slice("a🎬b", 0, 1), Some("a"));
        assert_eq!(utf16_slice("a🎬b", 1, 3), Some("🎬"));
        assert_eq!(utf16_slice("a🎬b", 3, 4), Some("b"));
        assert_eq!(utf16_slice("a🎬b", 1, 2), None);
    }

    /// 记录修复前缺陷：对 canonical JSON 原文做纯文本 `contains` 无法匹配前端
    /// 投影（LF 连接、marks 分隔、部分列表项），而按同源语义派生可以得到正确原文。
    /// 这是“先失败测试”的对旧机制的回归钉：旧 `contains/find` 路径在这类输入上失败。
    #[test]
    fn raw_json_contains_is_insufficient_where_projection_succeeds() {
        let node = doc_node(serde_json::json!([
            { "type": "paragraph", "content": [{ "type": "text", "text": "甲乙" }] },
            { "type": "paragraph", "content": [{ "type": "text", "text": "丙丁" }] }
        ]));
        let snapshot = doc(node);
        let projection = "甲乙\n丙丁";
        // 旧机制：canonical JSON 原文上纯文本 contains —— 必然失败。
        assert!(
            !snapshot.contains(projection),
            "JSON 原文 contains 无法匹配前端 LF 连接的投影（正是修复前误拒）"
        );
        // 新机制：按同源语义派生得到正确原文。
        assert_eq!(
            derive_selection_text(&snapshot, SelectionRange { from: 1, to: 7 }),
            Some(projection.to_string())
        );
    }
}
