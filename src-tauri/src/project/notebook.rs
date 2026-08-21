//! 结构化本子文档：格式版本 2 的严格 grammar 校验。
//!
//! 与前端 `src/structured-notebook.ts` 共享同一组规范 / 非规范 JSON 样例
//! （见 `tests/fixtures/notebook-samples.json`），确保前后端对额外字段、空数组、
//! marks、列表结构、孤立代理项和整数域范围的判定一致。
//!
//! 格式版本 2 相对版本 1 新增下划线、删除线、textStyle、highlight、link 字符标记，
//! 段落属性、一到六级标题与嵌套列表；版本 1 是版本 2 的严格子集，打开时按版本 2 接受。

use serde_json::{Map, Value};

pub const NOTEBOOK_FORMAT: &str = "next-story-tiptap";
pub const NOTEBOOK_VERSION: u64 = 2;
/// JavaScript 安全整数上限 2^53 - 1。
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

const MARK_RANK_BOLD: u32 = 0;
const MARK_RANK_ITALIC: u32 = 1;
const MARK_RANK_UNDERLINE: u32 = 2;
const MARK_RANK_STRIKE: u32 = 3;
const MARK_RANK_TEXT_STYLE: u32 = 4;
const MARK_RANK_HIGHLIGHT: u32 = 5;
const MARK_RANK_LINK: u32 = 6;

fn mark_rank(mark_type: &str) -> Option<u32> {
    match mark_type {
        "bold" => Some(MARK_RANK_BOLD),
        "italic" => Some(MARK_RANK_ITALIC),
        "underline" => Some(MARK_RANK_UNDERLINE),
        "strike" => Some(MARK_RANK_STRIKE),
        "textStyle" => Some(MARK_RANK_TEXT_STYLE),
        "highlight" => Some(MARK_RANK_HIGHLIGHT),
        "link" => Some(MARK_RANK_LINK),
        _ => None,
    }
}

fn is_attrless_mark(mark_type: &str) -> bool {
    matches!(mark_type, "bold" | "italic" | "underline" | "strike")
}

const TEXT_STYLE_ATTR_KEYS: [&str; 3] = ["color", "fontFamily", "fontSize"];
const PARAGRAPH_ATTR_KEYS: [&str; 7] = [
    "textAlign",
    "lineHeight",
    "spacingBefore",
    "spacingAfter",
    "textIndent",
    "indentLeft",
    "indentRight",
];
const MEASURE_ATTR_KEYS: [&str; 6] = [
    "lineHeight",
    "spacingBefore",
    "spacingAfter",
    "textIndent",
    "indentLeft",
    "indentRight",
];

/// 校验对象键：不得含 allowed 之外的键，且 required 键必须全部存在。
fn check_keys(
    obj: &Map<String, Value>,
    required: &[&str],
    optional: &[&str],
) -> Result<(), String> {
    for key in obj.keys() {
        if !required.contains(&key.as_str()) && !optional.contains(&key.as_str()) {
            return Err(format!("含额外字段: {key}"));
        }
    }
    for key in required {
        if !obj.contains_key(*key) {
            return Err(format!("缺少字段: {key}"));
        }
    }
    Ok(())
}

fn object_keys<'a>(value: &'a Value, loc: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{loc} 不是 JSON 对象"))
}

/// 颜色规范：小写 #rrggbb 六位十六进制。
fn is_hex_color(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}

/// mark 的稳定字符串签名：type + 完整 attrs（含带属性 mark 的身份比较）。
fn mark_signature(mark: &Map<String, Value>) -> String {
    let mark_type = mark.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if is_attrless_mark(mark_type) {
        return mark_type.to_string();
    }
    let mut signature = format!("{mark_type}:");
    if let Some(attrs) = mark.get("attrs").and_then(|v| v.as_object()) {
        let mut keys: Vec<&String> = attrs.keys().collect();
        keys.sort();
        for key in keys {
            signature.push_str(&format!("{key}={};", attrs[key]));
        }
    }
    signature
}

fn same_mark_set(a: &[Value], b: &[Value]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| match (x.as_object(), y.as_object()) {
            (Some(xm), Some(ym)) => mark_signature(xm) == mark_signature(ym),
            _ => false,
        })
}

fn validate_mark(value: &Value, loc: &str) -> Result<(), String> {
    let obj = object_keys(value, loc)?;
    let mark_type = obj
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{loc} 缺少 type"))?;

    if is_attrless_mark(mark_type) {
        check_keys(obj, &["type"], &[])?;
        return Ok(());
    }

    if mark_type == "textStyle" {
        check_keys(obj, &["type", "attrs"], &[])?;
        let attrs = obj
            .get("attrs")
            .and_then(|v| v.as_object())
            .ok_or_else(|| format!("{loc}: textStyle attrs 不是对象"))?;
        check_keys(attrs, &[], &TEXT_STYLE_ATTR_KEYS)?;
        if attrs.is_empty() {
            return Err(format!("{loc}: textStyle attrs 不能为空"));
        }
        if let Some(color) = attrs.get("color") {
            if color.as_str().map(is_hex_color) != Some(true) {
                return Err(format!("{loc}: textStyle color 必须为小写 #rrggbb"));
            }
        }
        if let Some(font_family) = attrs.get("fontFamily") {
            if font_family.as_str().map(|s| !s.is_empty()) != Some(true) {
                return Err(format!("{loc}: textStyle fontFamily 必须为非空字符串"));
            }
        }
        if let Some(font_size) = attrs.get("fontSize") {
            if font_size.as_str().map(|s| !s.is_empty()) != Some(true) {
                return Err(format!("{loc}: textStyle fontSize 必须为非空字符串"));
            }
        }
        return Ok(());
    }

    if mark_type == "highlight" {
        check_keys(obj, &["type", "attrs"], &[])?;
        let attrs = obj
            .get("attrs")
            .and_then(|v| v.as_object())
            .ok_or_else(|| format!("{loc}: highlight attrs 不是对象"))?;
        check_keys(attrs, &["color"], &[])?;
        let color = attrs
            .get("color")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("{loc}: highlight 缺少 color"))?;
        if !is_hex_color(color) {
            return Err(format!("{loc}: highlight color 必须为小写 #rrggbb"));
        }
        return Ok(());
    }

    if mark_type == "link" {
        check_keys(obj, &["type", "attrs"], &[])?;
        let attrs = obj
            .get("attrs")
            .and_then(|v| v.as_object())
            .ok_or_else(|| format!("{loc}: link attrs 不是对象"))?;
        check_keys(attrs, &["href"], &[])?;
        let href = attrs
            .get("href")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("{loc}: link 缺少 href"))?;
        if href.is_empty() {
            return Err(format!("{loc}: link href 必须为非空字符串"));
        }
        return Ok(());
    }

    Err(format!("{loc} 不支持的行内标记"))
}

fn validate_marks(value: &Value, loc: &str) -> Result<(), String> {
    let marks = value
        .as_array()
        .ok_or_else(|| format!("{loc}: marks 不是数组"))?;
    if marks.is_empty() {
        return Err(format!("{loc}: marks 不能为空数组"));
    }
    let mut ranks: Vec<u32> = Vec::with_capacity(marks.len());
    for (i, mark) in marks.iter().enumerate() {
        validate_mark(mark, &format!("{loc} 第 {} 个 mark", i + 1))?;
        let mark_type = mark.get("type").and_then(|v| v.as_str()).unwrap();
        ranks.push(mark_rank(mark_type).unwrap());
    }
    // 顺序必须按 rank 严格递增（不重复）。
    for i in 1..ranks.len() {
        if ranks[i - 1] >= ranks[i] {
            return Err(format!("{loc}: marks 顺序必须按 rank 升序且不重复"));
        }
    }
    Ok(())
}

fn validate_text(value: &Value, loc: &str) -> Result<(), String> {
    let obj = object_keys(value, loc)?;
    check_keys(obj, &["type", "text"], &["marks"])?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("text") {
        return Err(format!("{loc}: 节点类型应为 text"));
    }
    let text = obj
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{loc}: 缺少 text"))?;
    if text.is_empty() {
        return Err(format!("{loc}: text 不能为空字符串"));
    }
    if text.contains('\r') || text.contains('\n') {
        return Err(format!("{loc}: text 不能包含 CR 或 LF"));
    }
    // 孤立代理项：Rust String 为 UTF-8，天然无法携带代理项；输入侧由 JSON
    // 解析器在解析阶段拒绝未配对代理项转义，见 parse 层测试。
    if let Some(marks) = obj.get("marks") {
        validate_marks(marks, loc)?;
    }
    Ok(())
}

/// 校验段落或标题的 content（只允许 text，且相邻同 marks 文本必须已合并）。
fn validate_inline_content(value: Option<&Value>, loc: &str) -> Result<(), String> {
    let content = match value {
        None => return Ok(()),
        Some(v) => v
            .as_array()
            .ok_or_else(|| format!("{loc}: content 不是数组"))?,
    };
    if content.is_empty() {
        return Err(format!("{loc}: content 不能为空数组"));
    }
    let mut has_previous = false;
    let mut previous_marks: Vec<Value> = Vec::new();
    for (i, node) in content.iter().enumerate() {
        let here = format!("{loc} 第 {} 个节点", i + 1);
        validate_text(node, &here)?;
        let current_marks = node
            .get("marks")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if has_previous && same_mark_set(&previous_marks, &current_marks) {
            return Err(format!("{loc}: 相同 marks 的相邻文本必须合并"));
        }
        previous_marks = current_marks;
        has_previous = true;
    }
    Ok(())
}

/// 校验段落属性值合法性（忽略 level 等非段落键，供标题复用）。
fn validate_paragraph_attr_values(attrs: &Map<String, Value>, loc: &str) -> Result<(), String> {
    if let Some(v) = attrs.get("textAlign") {
        match v.as_str() {
            Some("left" | "center" | "right" | "justify") => {}
            _ => return Err(format!("{loc}: textAlign 值非法")),
        }
    }
    for key in MEASURE_ATTR_KEYS {
        if let Some(v) = attrs.get(key) {
            if v.as_str().map(|s| !s.is_empty()) != Some(true) {
                return Err(format!("{loc}: {key} 必须为非空字符串"));
            }
        }
    }
    Ok(())
}

/// 校验纯段落 attrs（不含 level），要求非空且键都在白名单内。
fn validate_paragraph_attrs_only(attrs: &Map<String, Value>, loc: &str) -> Result<(), String> {
    check_keys(attrs, &[], &PARAGRAPH_ATTR_KEYS)?;
    if attrs.is_empty() {
        return Err(format!("{loc}: attrs 不能为空对象"));
    }
    validate_paragraph_attr_values(attrs, loc)
}

fn validate_paragraph(value: &Value, loc: &str) -> Result<(), String> {
    let obj = object_keys(value, loc)?;
    check_keys(obj, &["type"], &["content", "attrs"])?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("paragraph") {
        return Err(format!("{loc}: 节点类型应为 paragraph"));
    }
    if let Some(attrs) = obj.get("attrs").and_then(|v| v.as_object()) {
        validate_paragraph_attrs_only(attrs, loc)?;
    }
    validate_inline_content(obj.get("content"), loc)
}

fn validate_heading(value: &Value, loc: &str) -> Result<(), String> {
    let obj = object_keys(value, loc)?;
    check_keys(obj, &["type", "attrs"], &["content"])?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("heading") {
        return Err(format!("{loc}: 节点类型应为 heading"));
    }
    let attrs = obj
        .get("attrs")
        .and_then(|v| v.as_object())
        .ok_or_else(|| format!("{loc}: attrs 不是对象"))?;
    check_keys(attrs, &["level"], &PARAGRAPH_ATTR_KEYS)?;
    let level = attrs
        .get("level")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("{loc}: level 必须为整数"))?;
    if !(1..=6).contains(&level) {
        return Err(format!("{loc}: heading 等级只能为 1 到 6"));
    }
    validate_paragraph_attr_values(attrs, loc)?;
    validate_inline_content(obj.get("content"), loc)
}

fn validate_list_item(value: &Value, loc: &str) -> Result<(), String> {
    let obj = object_keys(value, loc)?;
    check_keys(obj, &["type", "content"], &[])?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("listItem") {
        return Err(format!("{loc}: 节点类型应为 listItem"));
    }
    let content = obj
        .get("content")
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("{loc}: content 不是数组"))?;
    if content.is_empty() || content.len() > 2 {
        return Err(format!(
            "{loc}: listItem content 必须为一个 paragraph 加可选一个嵌套列表"
        ));
    }
    validate_paragraph(&content[0], &format!("{loc} 的 paragraph"))?;
    if content.len() == 2 {
        let nested = &content[1];
        match nested.get("type").and_then(|v| v.as_str()) {
            Some("bulletList") => validate_bullet_list(nested, &format!("{loc} 的嵌套列表"))?,
            Some("orderedList") => validate_ordered_list(nested, &format!("{loc} 的嵌套列表"))?,
            _ => return Err(format!("{loc} 的嵌套内容必须是列表")),
        }
    }
    Ok(())
}

fn validate_list_items(value: &Value, loc: &str) -> Result<(), String> {
    let content = value
        .as_array()
        .ok_or_else(|| format!("{loc}: content 不是数组"))?;
    if content.is_empty() {
        return Err(format!("{loc}: 列表 content 不能为空"));
    }
    for (i, item) in content.iter().enumerate() {
        validate_list_item(item, &format!("{loc} 第 {} 个列表项", i + 1))?;
    }
    Ok(())
}

fn validate_bullet_list(value: &Value, loc: &str) -> Result<(), String> {
    let obj = object_keys(value, loc)?;
    check_keys(obj, &["type", "content"], &[])?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("bulletList") {
        return Err(format!("{loc}: 节点类型应为 bulletList"));
    }
    match obj.get("content") {
        Some(content) => validate_list_items(content, loc),
        None => Err(format!("{loc}: 缺少 content")),
    }
}

fn validate_ordered_list(value: &Value, loc: &str) -> Result<(), String> {
    let obj = object_keys(value, loc)?;
    check_keys(obj, &["type", "attrs", "content"], &[])?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("orderedList") {
        return Err(format!("{loc}: 节点类型应为 orderedList"));
    }
    let attrs = obj
        .get("attrs")
        .and_then(|v| v.as_object())
        .ok_or_else(|| format!("{loc}: attrs 不是对象"))?;
    check_keys(attrs, &["start"], &[])?;
    let start = attrs
        .get("start")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("{loc}: start 必须为整数"))?;
    if !(1..=MAX_SAFE_INTEGER).contains(&start) {
        return Err(format!("{loc}: start 必须在 1 到 2^53-1 之间"));
    }
    let content = obj
        .get("content")
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("{loc}: content 不是数组"))?;
    if content.is_empty() {
        return Err(format!("{loc}: 列表 content 不能为空"));
    }
    for (i, item) in content.iter().enumerate() {
        validate_list_item(item, &format!("{loc} 第 {} 个列表项", i + 1))?;
    }
    let count = content.len() as u64;
    if start + (count - 1) > MAX_SAFE_INTEGER {
        return Err(format!("{loc}: 列表实际编号超出安全整数范围"));
    }
    Ok(())
}

fn validate_doc_node(value: &Value) -> Result<(), String> {
    let obj = object_keys(value, "document")?;
    check_keys(obj, &["type", "content"], &[])?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("doc") {
        return Err("document 节点类型应为 doc".to_string());
    }
    let content = obj
        .get("content")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "document.content 不是数组".to_string())?;
    if content.is_empty() {
        return Err("document.content 不能为空数组".to_string());
    }
    for (i, node) in content.iter().enumerate() {
        let loc = format!("document 第 {} 个块", i + 1);
        let node_type = node
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("{loc} 不是对象"))?;
        match node_type {
            "paragraph" => validate_paragraph(node, &loc)?,
            "heading" => validate_heading(node, &loc)?,
            "bulletList" => validate_bullet_list(node, &loc)?,
            "orderedList" => validate_ordered_list(node, &loc)?,
            other => return Err(format!("{loc}: 不支持的节点类型 {other}")),
        }
    }
    Ok(())
}

/// 校验完整本子文档（外层 + document grammar），失败返回中文错误。
/// 版本 1 是版本 2 的严格子集，打开时按版本 2 grammar 接受。
pub fn validate_notebook_document(value: &Value) -> Result<(), String> {
    let obj = object_keys(value, "本子")?;
    check_keys(obj, &["format", "version", "document"], &[])?;
    if obj.get("format").and_then(|v| v.as_str()) != Some(NOTEBOOK_FORMAT) {
        return Err("本子格式不受支持".to_string());
    }
    match obj.get("version").and_then(|v| v.as_u64()) {
        Some(1) | Some(2) => {}
        _ => return Err("本子文档版本不受支持".to_string()),
    }
    let document = obj
        .get("document")
        .ok_or_else(|| "本子缺少 document".to_string())?;
    validate_doc_node(document)
}

/// 生成新建本子时的合法最小空白文档 JSON 值。
pub fn empty_notebook_value() -> Value {
    serde_json::json!({
        "format": NOTEBOOK_FORMAT,
        "version": NOTEBOOK_VERSION,
        "document": {
            "type": "doc",
            "content": [{ "type": "paragraph" }]
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn load_shared_samples() -> Vec<Value> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/notebook-samples.json"
        );
        let text = fs::read_to_string(path).expect("read shared samples fixture");
        let parsed: Value = serde_json::from_str(&text).expect("parse shared samples fixture");
        parsed["samples"]
            .as_array()
            .expect("samples is array")
            .clone()
    }

    #[test]
    fn shared_samples_agree_with_frontend() {
        for sample in load_shared_samples() {
            let name = sample["name"].as_str().unwrap_or("(unnamed)").to_string();
            let expected_valid = sample["valid"].as_bool().expect("valid flag");
            let result = validate_notebook_document(&sample["value"]);
            assert_eq!(
                result.is_ok(),
                expected_valid,
                "sample '{name}' mismatch: {result:?}"
            );
        }
    }

    #[test]
    fn rejects_lone_surrogate_escape_at_parse_time() {
        let raw = r#"{"format":"next-story-tiptap","version":2,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a\ud800b"}]}]}}"#;
        let parsed: Result<Value, _> = serde_json::from_str(raw);
        assert!(parsed.is_err(), "未配对代理项转义应在 JSON 解析阶段被拒绝");
    }

    #[test]
    fn accepts_valid_surrogate_pair_emoji() {
        let value = serde_json::json!({
            "format": "next-story-tiptap",
            "version": 2,
            "document": {
                "type": "doc",
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "🎬" }] }]
            }
        });
        assert!(validate_notebook_document(&value).is_ok());
    }

    #[test]
    fn empty_notebook_value_is_valid() {
        assert!(validate_notebook_document(&empty_notebook_value()).is_ok());
    }
}
