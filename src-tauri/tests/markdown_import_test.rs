//! add-markdown-import 任务 5.2 / 5.3 端到端：md「导出→导入」往返与
//! 公共命令入口的补充样本。
//!
//! - 5.2（核心验收）：富文档（标题 / 嵌套有序列表 start / 粗斜删 / 下划线 /
//!   链接 / 颜色 / 高亮 / 字号字体）经既有 `export_project_to_markdown` 导出
//!   → `import_document_*` 重新导入，除导出侧四项已知降级（颜色 / 字体 /
//!   字号 / 高亮）外逐项断言一致。
//! - 已知差异清单（全部导出侧既有行为，见 add-markdown-import design.md
//!   Context 与 `markdown_export.rs` 模块头；导入侧不新增差异）：
//!   1. 范围根名称（文档名）作为一级标题冠首——导出侧层级映射决策；
//!   2. 文字颜色 / fontFamily / fontSize / highlight 降级为纯文字（四项已知
//!      降级，丢失 marks 后相邻无标记文本按 canonical 合并）；
//!   3. 段落属性（对齐等）不导出（md 方言无承载，往返丢失，非规格保留项）；
//!   4. 空段落经 md 导出消失（空白行是块分隔符）——格式固有属性，非可见
//!      文字，测试源不构造空段落。

use std::fs;
use std::path::{Path, PathBuf};

use next_story_lib::project::{
    self, export_project_to_markdown, import_document_commit, import_document_preview,
    validate_notebook_document, CreateProjectParams, ExportScope, ImportPreview, ProjectPaths,
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

/// 提交导入并读取落盘文档的顶层块数组（已通过严格校验）。
fn imported_blocks(root: &Path, doc_id: &str) -> Vec<Value> {
    let notebook = fs::read_to_string(ProjectPaths::new(root.to_path_buf()).document_file(doc_id))
        .expect("read imported notebook");
    let value: Value = serde_json::from_str(&notebook).expect("parse imported notebook");
    validate_notebook_document(&value).expect("往返产物必须通过既有严格语法校验");
    value["document"]["content"].as_array().unwrap().clone()
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

/// 收集一个块内全部 text 节点的 marks 摘要（type 列表，textStyle 展开属性键）。
fn block_mark_summary(block: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(nodes) = block.get("content").and_then(Value::as_array) {
        for node in nodes {
            if let Some(marks) = node.get("marks").and_then(Value::as_array) {
                for mark in marks {
                    let kind = mark["type"].as_str().unwrap_or("").to_string();
                    if kind == "textStyle" {
                        if let Some(attrs) = mark.get("attrs").and_then(Value::as_object) {
                            for key in attrs.keys() {
                                out.push(format!("textStyle.{key}"));
                            }
                        }
                    } else {
                        out.push(kind);
                    }
                }
            }
        }
    }
    out
}

fn loss_count(preview: &ImportPreview, kind: &str) -> usize {
    preview
        .losses
        .iter()
        .find(|loss| loss.kind == kind)
        .map(|loss| loss.count)
        .unwrap_or(0)
}

// ===== 5.2：md 往返测试（核心验收） =====

/// 往返源文档：标题（多级）、无序（嵌套）/ 有序（start=3）列表、加粗/斜体/
/// 删除线/下划线/链接，另含颜色/字号字体/高亮（用于钉死四项已知降级）。
fn roundtrip_source_notebook() -> Value {
    let text = |t: &str| serde_json::json!({ "type": "text", "text": t });
    let marked =
        |t: &str, marks: Value| serde_json::json!({ "type": "text", "text": t, "marks": marks });
    let list_item = |t: &str| {
        serde_json::json!({
            "type": "listItem",
            "content": [ { "type": "paragraph", "content": [ text(t) ] } ]
        })
    };
    serde_json::json!({
        "format": "next-story-tiptap",
        "version": 2,
        "document": { "type": "doc", "content": [
            {
                "type": "heading",
                "attrs": { "level": 2 },
                "content": [ text("二级标题") ]
            },
            {
                "type": "heading",
                "attrs": { "level": 5 },
                "content": [ text("五级标题") ]
            },
            {
                "type": "bulletList",
                "content": [
                    list_item("项目一"),
                    {
                        "type": "listItem",
                        "content": [
                            { "type": "paragraph", "content": [ text("项目二") ] },
                            { "type": "bulletList", "content": [ list_item("嵌套项") ] }
                        ]
                    }
                ]
            },
            {
                "type": "orderedList",
                "attrs": { "start": 3 },
                "content": [ list_item("第三项"), list_item("第四项") ]
            },
            {
                "type": "paragraph",
                "content": [
                    marked("加粗", serde_json::json!([{ "type": "bold" }])),
                    text("普通"),
                    marked("斜体", serde_json::json!([{ "type": "italic" }])),
                    marked("删除线", serde_json::json!([{ "type": "strike" }])),
                    marked("下划线", serde_json::json!([{ "type": "underline" }])),
                    marked("蓝色文字", serde_json::json!([
                        { "type": "textStyle", "attrs": { "color": "#3366cc" } }
                    ]))
                ]
            },
            {
                "type": "paragraph",
                "content": [
                    marked("链接文字", serde_json::json!([
                        { "type": "link", "attrs": { "href": "https://example.com/roundtrip" } }
                    ])),
                    marked("高亮文字", serde_json::json!([
                        { "type": "highlight", "attrs": { "color": "#ffff00" } }
                    ])),
                    marked("带字号字体", serde_json::json!([
                        { "type": "textStyle", "attrs": { "fontSize": "18pt", "fontFamily": "宋体" } }
                    ]))
                ]
            }
        ] }
    })
}

#[test]
fn export_import_roundtrip_diffs_limited_to_known_four() {
    let (temp, root) = seed_project("往返作品");

    // 源文档：保存为作品内一篇文档并命名（文档名将作为导出冠首标题）。
    let tree = project::recover_then_read_content_tree(&root).expect("read tree");
    let source_doc = tree.root_children[0].clone();
    project::rename_node(&root, &source_doc, "往返测试文档").expect("rename doc");
    let source = roundtrip_source_notebook();
    validate_notebook_document(&source).expect("源文档须先通过校验");
    let source_json = serde_json::to_string_pretty(&source).unwrap();
    project::save_document(&root, &source_doc, &source_json).expect("save source doc");

    // 既有导出路径生成 .md。
    let target = temp.path().join("往返产物.md");
    let export =
        export_project_to_markdown(&root, &ExportScope::Document(source_doc.clone()), &target)
            .expect("导出必须成功");
    assert!(export.ok, "导出结果：{export:?}");

    // 重新导入：预览＋提交。
    let preview = import_document_preview(&root, &target).expect("预览");
    // 自家导出方言全是语法承载元素：导入侧不得产生任何损耗。
    assert!(
        preview.losses.is_empty(),
        "往返产物的损耗必须为空：{:?}",
        preview.losses
    );
    assert!(
        preview.split_suggestion.is_none(),
        "往返产物不应触发拆分建议"
    );
    let commit = import_document_commit(&root, &target, None, false, &preview.content_hash)
        .expect("往返提交必须成功");
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);

    // ---- 结构逐项断言 ----
    // 差异①（导出侧）：文档名冠首为一级标题。
    assert_eq!(blocks.len(), 7, "块序列：{blocks:#?}");
    assert_eq!(blocks[0]["type"], "heading");
    assert_eq!(blocks[0]["attrs"]["level"], 1);
    assert_eq!(block_text(&blocks[0]), "往返测试文档");

    // 标题层级保留。
    assert_eq!(blocks[1]["type"], "heading");
    assert_eq!(blocks[1]["attrs"]["level"], 2);
    assert_eq!(block_text(&blocks[1]), "二级标题");
    assert_eq!(blocks[2]["type"], "heading");
    assert_eq!(blocks[2]["attrs"]["level"], 5);
    assert_eq!(block_text(&blocks[2]), "五级标题");

    // 无序列表嵌套保留（与 docx 往返不同：md 列表结构无损）。
    assert_eq!(blocks[3]["type"], "bulletList");
    let items = blocks[3]["content"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["content"][0]["content"][0]["text"], "项目一");
    let second = &items[1];
    assert_eq!(second["content"].as_array().unwrap().len(), 2);
    assert_eq!(second["content"][1]["type"], "bulletList");
    assert_eq!(
        second["content"][1]["content"][0]["content"][0]["content"][0]["text"],
        "嵌套项"
    );

    // 有序列表 start=3 保留。
    assert_eq!(blocks[4]["type"], "orderedList");
    assert_eq!(blocks[4]["attrs"]["start"], 3);
    let ordered_items = blocks[4]["content"].as_array().unwrap();
    assert_eq!(ordered_items.len(), 2);
    assert_eq!(
        ordered_items[0]["content"][0]["content"][0]["text"],
        "第三项"
    );
    assert_eq!(
        ordered_items[1]["content"][0]["content"][0]["text"],
        "第四项"
    );

    // 富格式段：加粗/斜体/删除线/下划线保留；颜色为四项已知降级之一（丢失）。
    assert_eq!(
        block_mark_summary(&blocks[5]),
        vec!["bold", "italic", "strike", "underline"],
        "加粗/斜体/删除线/下划线必须保留，颜色按已知降级丢失"
    );
    let runs = blocks[5]["content"].as_array().unwrap();
    assert_eq!(runs.len(), 6);
    assert_eq!(runs[0]["text"], "加粗");
    assert_eq!(runs[1]["text"], "普通");
    assert_eq!(runs[2]["text"], "斜体");
    assert_eq!(runs[3]["text"], "删除线");
    assert_eq!(runs[4]["text"], "下划线");
    // 颜色丢失后「蓝色文字」成为无标记节点（相邻节点 marks 不同，不合并）。
    assert!(runs[5].get("marks").is_none());
    assert_eq!(runs[5]["text"], "蓝色文字");

    // 链接保留；高亮/字号/字体为其余三项已知降级（丢失后相邻无标记合并）。
    assert_eq!(
        block_mark_summary(&blocks[6]),
        vec!["link"],
        "链接必须保留，高亮/字号/字体按已知降级丢失"
    );
    let tail_runs = blocks[6]["content"].as_array().unwrap();
    assert_eq!(tail_runs.len(), 2);
    assert_eq!(tail_runs[0]["text"], "链接文字");
    assert_eq!(
        tail_runs[0]["marks"][0]["attrs"]["href"],
        "https://example.com/roundtrip"
    );
    assert_eq!(tail_runs[1]["text"], "高亮文字带字号字体");
    assert!(tail_runs[1].get("marks").is_none());

    // 全文不得残留四项降级的 marks。
    for (index, block) in blocks.iter().enumerate() {
        let summary = block_mark_summary(block);
        assert!(
            !summary.iter().any(|m| m == "highlight"
                || m == "textStyle.color"
                || m == "textStyle.fontSize"
                || m == "textStyle.fontFamily"),
            "第 {index} 块出现已知降级外的保留 mark：{summary:?}"
        );
    }

    // 可见文字零丢失（列表项文字计入）。
    let expected_total: usize = [
        "往返测试文档",
        "二级标题",
        "五级标题",
        "项目一",
        "项目二",
        "嵌套项",
        "第三项",
        "第四项",
        "加粗普通斜体删除线下划线蓝色文字",
        "链接文字高亮文字带字号字体",
    ]
    .iter()
    .map(|t| t.chars().count())
    .sum();
    assert_eq!(preview.char_count, expected_total);
    assert_eq!(preview.paragraph_count, 10);

    // 源文档逐字节不变（导入只新增文档）。
    let source_after =
        fs::read_to_string(ProjectPaths::new(root.clone()).document_file(&source_doc)).unwrap();
    assert_eq!(source_after, source_json, "源文档正文逐字节不变");
}

// ===== 已知边界：同文字下划线＋删除线组合的往返局限 =====

/// **已枚举的导出侧局限（非四项降级、导入侧无法安全修复）**：同一文字同时
/// 携带 underline＋strike 时，导出按 canonical marks 顺序包裹成
/// `~~<u>文字</u>~~`（删除线在外）。CommonMark/GFM 侧翼规则下，闭合 `~~`
/// 前接 `>`（标点）且后接字母时无法成为右翼定界符——删除线按字面 `~~`
/// 解析（文字与波浪线逐字保留、下划线 mark 保留、strike mark 丢失）。
///
/// 来源：`markdown_export.rs` 的 mark 包裹顺序＋CommonMark 侧翼规则交互；
/// 本 change Non-Goals 禁止改导出侧，修复须另立导出 change（把 underline
/// 包到最外层即 `/‹u›~~…~~‹/u›`，两种侧翼组合都能解析）。此测试钉死现状：
/// 导出侧将来修复时此处会失败提醒同步更新清单。
#[test]
fn combined_underline_strike_roundtrip_degrades_to_literal_tildes() {
    let (temp, root) = seed_project("组合标记往返");
    let tree = project::recover_then_read_content_tree(&root).expect("read tree");
    let source_doc = tree.root_children[0].clone();
    project::rename_node(&root, &source_doc, "组合测试").expect("rename");
    let source = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 2,
        "document": { "type": "doc", "content": [
            {
                "type": "paragraph",
                "content": [
                    { "type": "text", "text": "组合", "marks": [
                        { "type": "underline" }, { "type": "strike" }
                    ] },
                    { "type": "text", "text": "后文" }
                ]
            }
        ] }
    });
    validate_notebook_document(&source).expect("源文档须先通过校验");
    project::save_document(
        &root,
        &source_doc,
        &serde_json::to_string_pretty(&source).unwrap(),
    )
    .expect("save");

    let target = temp.path().join("组合产物.md");
    let export = export_project_to_markdown(&root, &ExportScope::Document(source_doc), &target)
        .expect("导出");
    assert!(export.ok);

    let preview = import_document_preview(&root, &target).expect("预览");
    let commit =
        import_document_commit(&root, &target, None, false, &preview.content_hash).expect("提交");
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);

    // 现状断言：文字逐字保留（含字面波浪线）、underline 保留、strike 丢失。
    assert_eq!(blocks[1]["type"], "paragraph");
    assert_eq!(block_text(&blocks[1]), "~~组合~~后文");
    assert_eq!(block_mark_summary(&blocks[1]), vec!["underline"]);
}

// ===== 5.3：公共命令入口的补充样本 =====

#[test]
fn preview_and_commit_end_to_end_with_frontmatter_and_losses() {
    let (temp, root) = seed_project("md 端到端");
    let file = temp.path().join("我的笔记.md");
    let source = "---\ntitle: 笔记\n---\n\n# 我的笔记\n\n软换行甲\n软换行乙\n\n> 引用块\n\n```\n代码行\n```\n\n- [x] 任务项\n\n![图](x.png)\n\n---\n\n[^1]: 脚注定义\n\n正文[^1]结尾。";
    fs::write(&file, source).unwrap();

    let preview = import_document_preview(&root, &file).expect("预览");
    assert_eq!(preview.default_doc_name, "我的笔记");
    assert_eq!(loss_count(&preview, "frontmatter_dropped"), 1);
    assert_eq!(loss_count(&preview, "quote_degraded"), 1);
    assert_eq!(loss_count(&preview, "code_degraded"), 1);
    assert_eq!(loss_count(&preview, "tasklist_degraded"), 1);
    assert_eq!(loss_count(&preview, "image_dropped"), 1);
    assert_eq!(loss_count(&preview, "hr_dropped"), 1);
    assert_eq!(loss_count(&preview, "footnote_dropped"), 1);
    // code_degraded 的 note 分列行内与块。
    let code_note = preview
        .losses
        .iter()
        .find(|loss| loss.kind == "code_degraded")
        .unwrap();
    assert!(
        code_note.note.contains("行内代码 0 处、代码块 1 处"),
        "note：{}",
        code_note.note
    );

    let commit =
        import_document_commit(&root, &file, None, false, &preview.content_hash).expect("提交");
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);

    // 标题、软换行接合（CJK 直连）、引用文字、代码行、脚注引用字面全部保留；
    // frontmatter/图片/分隔线/脚注定义不出现。任务项勾选框字面在列表项内
    // （下方结构断言覆盖）。
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert!(
        texts.contains(&"软换行甲软换行乙".to_string()),
        "软换行接合：{texts:?}"
    );
    assert!(texts.contains(&"引用块".to_string()));
    assert!(texts.contains(&"代码行".to_string()));
    assert!(texts.contains(&"正文[^1]结尾。".to_string()));
    assert!(!texts.iter().any(|t| t.contains("title: 笔记")));
    assert!(!texts.iter().any(|t| t.contains("脚注定义")));
    assert_eq!(blocks[0]["type"], "heading");
    assert_eq!(block_text(&blocks[0]), "我的笔记");
    // 任务列表按无序列表导入，勾选框字面保留（断言下探到列表项段落）。
    let task_block = blocks.iter().find(|b| b["type"] == "bulletList").unwrap();
    assert_eq!(
        block_text(&task_block["content"][0]["content"][0]),
        "[x] 任务项"
    );
}

#[test]
fn markdown_split_commit_by_heading_sequence() {
    let (temp, root) = seed_project("md 拆分");
    let file = temp.path().join("全本小说.md");
    let source = "# 全本小说\n\n前言。\n\n## 第1章\n\n第一章正文\n\n## 第2章\n\n第二章正文\n\n## 第3章\n\n第三章正文";
    fs::write(&file, source).unwrap();

    let preview = import_document_preview(&root, &file).expect("预览");
    let suggestion = preview.split_suggestion.expect("应识别章标题序列");
    assert_eq!(suggestion.marker_sample, "第X章");
    assert_eq!(suggestion.count, 3);
    assert_eq!(suggestion.doc_names, vec!["第1章", "第2章", "第3章"]);

    let commit =
        import_document_commit(&root, &file, None, true, &preview.content_hash).expect("拆分提交");
    assert_eq!(commit.created_doc_ids.len(), 3);
    let folder = commit.created_folder_id.expect("拆分建文件夹");
    let tree = project::recover_then_read_content_tree(&root).unwrap();
    assert_eq!(tree.nodes[&folder].name, "全本小说");

    // 前言（含书名标题）并入第 1 个文档，其后各章边界正确。
    let first = imported_blocks(&root, &commit.created_doc_ids[0]);
    let first_texts: Vec<String> = first.iter().map(block_text).collect();
    assert_eq!(
        first_texts,
        vec!["全本小说", "前言。", "第1章", "第一章正文"]
    );
    let second = imported_blocks(&root, &commit.created_doc_ids[1]);
    let second_texts: Vec<String> = second.iter().map(block_text).collect();
    assert_eq!(second_texts, vec!["第2章", "第二章正文"]);
}

#[test]
fn bom_and_hash_mismatch_via_public_commands() {
    let (temp, root) = seed_project("md 编码");
    // 带 BOM 的文件：正文不含 BOM，哈希对原始字节（含 BOM）计算。
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("带 BOM 正文".as_bytes());
    let file = temp.path().join("带BOM.md");
    fs::write(&file, &bytes).unwrap();

    let preview = import_document_preview(&root, &file).expect("BOM 文件预览");
    assert_eq!(preview.char_count, "带 BOM 正文".chars().count());
    assert!(preview.losses.is_empty());
    assert_eq!(preview.content_hash.len(), 64, "sha256 hex");

    // 哈希不一致：中文前缀错误、零残留。
    let before = project::recover_then_read_content_tree(&root).unwrap();
    let error = import_document_commit(&root, &file, None, false, "deadbeef").unwrap_err();
    assert!(
        error.to_string().starts_with("hash_mismatch:"),
        "错误信息必须带 hash_mismatch: 前缀：{error}"
    );
    let after = project::recover_then_read_content_tree(&root).unwrap();
    assert_eq!(before, after);
}

#[test]
fn oversize_markdown_rejected_with_chinese_error() {
    let (temp, root) = seed_project("md 超限");
    let file = temp.path().join("超大.md");
    // 16MB 上限：写一个超限文件（重复可压缩内容无所谓，按字节数拒绝）。
    let big = "字".repeat(16 * 1024 * 1024 / 3 + 1024);
    fs::write(&file, big.as_bytes()).unwrap();
    let error = import_document_preview(&root, &file).unwrap_err();
    let message = error.to_string();
    assert!(
        message.contains("文件过大") && message.contains("16 MB"),
        "报错：{message}"
    );
}
