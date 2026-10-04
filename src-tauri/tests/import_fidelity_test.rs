//! fix-import-fidelity 端到端：python-docx 真实 fixtures（MIT，入库
//! `tests/fixtures/docx/`，来源见该目录 README）——样式链／编号保真修复的
//! 真实 Word 生成字节回归。

use std::fs;
use std::path::{Path, PathBuf};

use next_story_lib::project::{
    self, import_document_commit, import_document_preview, validate_notebook_document,
    CreateProjectParams, ImportPreview, ProjectPaths,
};
use serde_json::Value;
use tempfile::TempDir;

fn seed_project(name: &str) -> (TempDir, PathBuf) {
    let temp = TempDir::new().expect("create temp dir");
    let root = project::create_new_project(CreateProjectParams {
        name: name.to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");
    (temp, root)
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/docx")
        .join(name)
}

fn block_text(block: &Value) -> String {
    block
        .get("content")
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .map(|n| n["text"].as_str().unwrap_or(""))
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn full_roundtrip(root: &Path, file: &Path) -> (ImportPreview, Vec<Value>) {
    let preview = import_document_preview(root, file).expect("预检");
    let commit =
        import_document_commit(root, file, None, false, &preview.content_hash).expect("提交");
    let notebook = fs::read_to_string(
        ProjectPaths::new(root.to_path_buf()).document_file(&commit.created_doc_ids[0]),
    )
    .expect("read notebook");
    let value: Value = serde_json::from_str(&notebook).expect("parse notebook");
    validate_notebook_document(&value).expect("须过严格校验");
    (
        preview,
        value["document"]["content"].as_array().unwrap().clone(),
    )
}

/// num-having-numbering-part.docx：编号经段落样式（ListNumber pPr numPr）
/// 携带——D3 样式链＋D4 编号联合路径。修复前：普通段落（编号完全丢失）。
#[test]
fn fixture_num_via_style_becomes_ordered_list() {
    let (_temp, root) = seed_project("num 样式");
    let (preview, blocks) = full_roundtrip(&root, &fixture_path("num-having-numbering-part.docx"));

    // 修复基线（2026-10-02）：普通段落、无列表。
    // 修复后：样式链编号生效 → orderedList start=1。
    let ordered: Vec<&Value> = blocks
        .iter()
        .filter(|b| b["type"] == "orderedList")
        .collect();
    assert_eq!(ordered.len(), 1, "样式链编号应生效：{blocks:#?}");
    assert_eq!(ordered[0]["attrs"]["start"], 1);
    assert_eq!(
        block_text(&ordered[0]["content"][0]["content"][0]),
        "Paragraph having List Number style."
    );
    assert!(
        preview.losses.is_empty(),
        "无降级损耗：{:?}",
        preview.losses
    );
}

/// sty-having-styles-part.docx：正文为空但 styles.xml 完整——解析健壮性。
#[test]
fn fixture_styles_part_parses_without_incident() {
    let (_temp, root) = seed_project("sty 样式");
    let (preview, blocks) = full_roundtrip(&root, &fixture_path("sty-having-styles-part.docx"));
    // 正文为空：单个空段落兜底。
    assert_eq!(blocks.len(), 1);
    assert_eq!(block_text(&blocks[0]), "");
    assert!(preview.losses.is_empty(), "损耗：{:?}", preview.losses);
}

/// par-known-styles.docx：五段挂不同 pStyle——docDefaults 基准＋样式链
/// 格式生效（Heading1 链上的粗体／颜色／字号、docDefaults 的默认字号）。
#[test]
fn fixture_known_styles_chain_format_applies() {
    let (_temp, root) = seed_project("par 样式");
    let (_preview, blocks) = full_roundtrip(&root, &fixture_path("par-known-styles.docx"));

    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(
        texts,
        vec![
            "no specified style",
            "missing style",
            "Heading 1",
            "Body Text",
            ""
        ]
    );
    // Heading 1（pStyle Heading1，链 Normal←Heading1）：标题层级保留＋
    // 样式链字符属性生效（该样本 Heading1 定义 b/color 365F91/sz 28）。
    assert_eq!(blocks[2]["type"], "heading");
    assert_eq!(blocks[2]["attrs"]["level"], 1);
    let heading_marks = blocks[2]["content"][0]
        .get("marks")
        .and_then(Value::as_array)
        .cloned()
        .expect("Heading1 链应有 marks");
    let mark_types: Vec<&str> = heading_marks
        .iter()
        .map(|m| m["type"].as_str().unwrap_or(""))
        .collect();
    assert!(mark_types.contains(&"bold"), "链上粗体生效：{mark_types:?}");
    let text_style = heading_marks
        .iter()
        .find(|m| m["type"] == "textStyle")
        .expect("链上字号颜色生效");
    assert_eq!(
        text_style["attrs"]["fontSize"], "14pt",
        "样式 sz=28 覆盖 docDefaults"
    );
    assert_eq!(text_style["attrs"]["color"], "#365f91");
    // docDefaults（sz=22 → 11pt）经默认样式链对其余段落生效。
    for index in [0usize, 1, 3] {
        let marks = blocks[index]["content"][0]
            .get("marks")
            .and_then(Value::as_array)
            .cloned();
        let font_size = marks.as_ref().and_then(|ms| {
            ms.iter()
                .find(|m| m["type"] == "textStyle")
                .and_then(|m| m["attrs"]["fontSize"].as_str().map(str::to_string))
        });
        assert_eq!(
            font_size.as_deref(),
            Some("11pt"),
            "docDefaults 基准字号应生效（第 {index} 块）"
        );
    }
}
