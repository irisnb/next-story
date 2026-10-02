//! add-word-import 任务 5.3 / 5.4：补充样本测试与「导出→导入」往返差异测试。
//!
//! - 5.3：用 docx-rs 写侧 API 在测试内合成含图片 / 脚注 / 批注 / 表格的
//!   `.docx`，走 `import_document_preview` 断言损耗计数如实、正文文字逐字保留。
//! - 5.4：构造富文档（段落、多级标题、无序/有序列表、加粗/斜体/颜色/高亮/
//!   链接）→ 既有 `export_project_to_word` 导出 → `import_docx_*` 重新导入，
//!   断言可见文字逐字保留、差异恰好落在既有导出侧降级的可枚举清单内
//!   （design.md Context：导出本身降级，往返不可能是无损的，基准是差异可枚举）。
//!
//! 「微软 Word 生成文件」由 5.5 真机冒烟覆盖（用户侧提供），不在本文件。

use std::fs;
use std::io::Cursor as IoCursor;
use std::path::{Path, PathBuf};

use docx_rs::{Comment, Docx, Footnote, Paragraph, Pic, Run, Table, TableCell, TableRow};
use next_story_lib::project::{
    self, export_project_to_word, import_document_commit, import_document_preview, validate_notebook_document,
    CreateProjectParams, ExportScope, ImportPreview, ProjectPaths,
};
use serde_json::Value;
use tempfile::TempDir;

// ----- 夹具工具 -----

fn seed_project(name: &str) -> (TempDir, PathBuf) {
    let temp = TempDir::new().expect("create temp dir");
    let root = project::create_new_project(CreateProjectParams {
        name: name.to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");
    (temp, root)
}

fn pack_docx(docx: Docx) -> Vec<u8> {
    let mut cursor = IoCursor::new(Vec::new());
    docx.build().pack(&mut cursor).expect("pack docx");
    cursor.into_inner()
}

fn write_docx_file(path: &Path, docx: Docx) {
    fs::write(path, pack_docx(docx)).expect("write docx file");
}

/// 最小真实 1×1 PNG（写入侧不解码、读取侧关预览解码，字节只需是合法媒体）。
const TINY_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, b'I', b'H', b'D',
    b'R', 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
    0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, b'I', b'D', b'A', b'T', 0x78, 0x9C, 0x63, 0x00,
    0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, b'I',
    b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82,
];

fn loss_count(preview: &ImportPreview, kind: &str) -> usize {
    preview
        .losses
        .iter()
        .find(|loss| loss.kind == kind)
        .map(|loss| loss.count)
        .unwrap_or(0)
}

/// 预览 + 断言无拆分建议（这些夹具都不含序列标记）。
fn preview_of(root: &Path, file: &Path) -> ImportPreview {
    let preview = import_document_preview(root, file).expect("预览必须成功");
    assert!(
        preview.split_suggestion.is_none(),
        "夹具不含序列标记，不应产生拆分建议：{:?}",
        preview.split_suggestion
    );
    preview
}

// ===== 任务 5.3：补充样本测试（合成 fixture） =====

/// 图片：Drawing 计入 image_dropped，正文文字逐字保留。
#[test]
fn image_runs_counted_as_image_dropped() {
    let (temp, root) = seed_project("图片样本");
    let file = temp.path().join("含图.docx");
    write_docx_file(
        &file,
        Docx::new().add_paragraph(
            Paragraph::new()
                .add_run(Run::new().add_text("图前"))
                .add_run(Run::new().add_image(Pic::new_with_dimensions(
                    TINY_PNG.to_vec(),
                    1,
                    1,
                )))
                .add_run(Run::new().add_text("图后")),
        ),
    );

    let preview = preview_of(&root, &file);
    assert_eq!(loss_count(&preview, "image_dropped"), 1, "一张图计一处");
    // 其余损耗 kind 不受干扰。
    assert_eq!(loss_count(&preview, "table_flattened"), 0);
    assert_eq!(loss_count(&preview, "footnote_dropped"), 0);
    assert_eq!(loss_count(&preview, "comment_dropped"), 0);
    // 图片前后文字合并为同段相邻同 marks 文本。
    assert_eq!(preview.char_count, "图前图后".chars().count());
}

/// 脚注：footnoteReference 计入 footnote_dropped，脚注内容不入正文。
#[test]
fn footnote_references_counted_as_footnote_dropped() {
    let (temp, root) = seed_project("脚注样本");
    let file = temp.path().join("含脚注.docx");
    let mut footnote = Footnote::new();
    footnote.add_content(Paragraph::new().add_run(Run::new().add_text("脚注内容")));
    write_docx_file(
        &file,
        Docx::new()
            .add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text("正文前"))
                    .add_run(Run::new().add_footnote_reference(footnote))
                    .add_run(Run::new().add_text("正文后")),
            )
            .add_paragraph(
                Paragraph::new().add_run(Run::new().add_footnote_reference({
                    let mut another = Footnote::new();
                    another.add_content(Paragraph::new().add_run(Run::new().add_text("第二条脚注")));
                    another
                })),
            ),
    );

    let preview = preview_of(&root, &file);
    assert_eq!(loss_count(&preview, "footnote_dropped"), 2, "两处脚注引用各计一处");
    // 脚注内容是附件部件，不进入正文字数。
    assert_eq!(preview.char_count, "正文前正文后".chars().count());
}

/// 批注：commentRangeStart 计入 comment_dropped，被批注正文保留。
///
/// 局限说明：docx-rs 公开写侧 API 无法填充 comments.xml 部件（`Comments`
/// 内部字段为 pub(crate)）；本测试用 commentRangeStart / commentRangeEnd 标记
/// 驱动——读取侧的损耗计数正是数这些标记，计数的正确性不依赖批注正文部件。
#[test]
fn comment_ranges_counted_as_comment_dropped() {
    let (temp, root) = seed_project("批注样本");
    let file = temp.path().join("含批注.docx");
    write_docx_file(
        &file,
        Docx::new()
            .add_paragraph(
                Paragraph::new()
                    .add_comment_start(
                        Comment::new(1)
                            .author("评审人")
                            .date("2026-01-01T00:00:00Z")
                            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("批注一"))),
                    )
                    .add_run(Run::new().add_text("被批注的文字"))
                    .add_comment_end(1),
            )
            .add_paragraph(
                Paragraph::new()
                    .add_comment_start(
                        Comment::new(2)
                            .author("评审人")
                            .date("2026-01-01T00:00:00Z")
                            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("批注二"))),
                    )
                    .add_run(Run::new().add_text("另一段被批注文字"))
                    .add_comment_end(2),
            ),
    );

    let preview = preview_of(&root, &file);
    assert_eq!(loss_count(&preview, "comment_dropped"), 2, "两处批注各计一处");
    // 被批注的正文逐字保留，批注内容不进入正文字数。
    assert_eq!(
        preview.char_count,
        "被批注的文字另一段被批注文字".chars().count()
    );
}

/// 混合文档：表格＋图片＋普通段落＋脚注＋批注同时在场，各 kind 计数互不干扰，
/// 全部正文文字逐字保留且顺序不变。
#[test]
fn mixed_document_counts_each_loss_kind_independently() {
    let (temp, root) = seed_project("混合样本");
    let file = temp.path().join("混合.docx");
    let mut footnote = Footnote::new();
    footnote.add_content(Paragraph::new().add_run(Run::new().add_text("脚注")));
    write_docx_file(
        &file,
        Docx::new()
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("开头段")))
            .add_table(Table::new(vec![TableRow::new(vec![
                TableCell::new().add_paragraph(Paragraph::new().add_run(Run::new().add_text("左格"))),
                TableCell::new().add_paragraph(Paragraph::new().add_run(Run::new().add_text("右格"))),
            ])]))
            .add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text("看图"))
                    .add_run(Run::new().add_image(Pic::new_with_dimensions(
                        TINY_PNG.to_vec(),
                        1,
                        1,
                    ))),
            )
            .add_paragraph(
                Paragraph::new()
                    .add_comment_start(
                        Comment::new(1)
                            .author("评审人")
                            .date("2026-01-01T00:00:00Z")
                            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("批注"))),
                    )
                    .add_run(Run::new().add_text("被批注段"))
                    .add_comment_end(1),
            )
            .add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text("带脚注段"))
                    .add_run(Run::new().add_footnote_reference(footnote)),
            ),
    );

    let preview = preview_of(&root, &file);
    assert_eq!(loss_count(&preview, "table_flattened"), 1);
    assert_eq!(loss_count(&preview, "image_dropped"), 1);
    assert_eq!(loss_count(&preview, "comment_dropped"), 1);
    assert_eq!(loss_count(&preview, "footnote_dropped"), 1);
    assert_eq!(loss_count(&preview, "revision_finalized"), 0);
    // 正文文字（表格逐格拍平后按序保留）逐字一致。
    assert_eq!(
        preview.char_count,
        "开头段左格右格看图被批注段带脚注段".chars().count()
    );

    // 提交后逐块核对文字与顺序。
    let commit = import_document_commit(&root, &file, None, false, &preview.content_hash)
        .expect("混合样本提交");
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(
        texts,
        vec!["开头段", "左格", "右格", "看图", "被批注段", "带脚注段"],
        "全部正文按原顺序逐字保留"
    );
}

// ===== 任务 5.4：往返测试（导出→导入差异可枚举） =====

/// 提交导入并读取落盘文档的顶层块数组（已通过严格校验）。
fn imported_blocks(root: &Path, doc_id: &str) -> Vec<Value> {
    let notebook =
        fs::read_to_string(ProjectPaths::new(root.to_path_buf()).document_file(doc_id))
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

/// 收集一个块内全部 text 节点的 marks 类型序列（含 textStyle 的属性键）。
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

/// 构造往返测试的富文档源（canonical 格式版本 2）：段落（含对齐、空段）、
/// 多级标题、无序（含嵌套）/有序（start=3）列表、加粗/斜体/下划删除/颜色/
/// 链接/高亮/字号字体。
fn roundtrip_source_notebook() -> Value {
    let text = |t: &str| serde_json::json!({ "type": "text", "text": t });
    let marked = |t: &str, marks: Value| serde_json::json!({ "type": "text", "text": t, "marks": marks });
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
                "type": "paragraph",
                "attrs": { "textAlign": "center" },
                "content": [ text("开头段落") ]
            },
            { "type": "paragraph" },
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
                            {
                                "type": "bulletList",
                                "content": [ list_item("嵌套项") ]
                            }
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
                    marked("下划删除", serde_json::json!([
                        { "type": "underline" }, { "type": "strike" }
                    ])),
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

/// 导出→重新导入的完整回路：可见文字逐字保留（含列表项文字），差异恰好落在
/// 既有导出侧降级的可枚举清单内，产物通过严格语法校验。
///
/// 已知差异清单（全部来自导出侧既有行为，见 design.md Context 与
/// `docx_export.rs` 模块头；导入侧不新增任何差异）：
/// 1. 范围根名称（文档名）作为 Heading1 冠首——导出侧层级映射决策；
/// 2. 列表 → 纯文字前缀段落（"• "／"N. "，嵌套项再缩进两个空格）；
/// 3. 链接 → 纯文字（link mark 丢失）；
/// 4. 字号 / 字体 / 高亮 mark 丢失（导出侧不输出这三类）；
/// 5. 保留项：加粗 / 斜体 / 下划线 / 删除线 / 颜色、标题层级、对齐、
///    段落与文字顺序、全部可见字符。
#[test]
fn export_import_roundtrip_diffs_are_enumerable() {
    let (temp, root) = seed_project("往返作品");

    // 源文档：保存为作品内一篇文档并命名（文档名将作为导出冠首标题）。
    let tree = project::recover_then_read_content_tree(&root).expect("read tree");
    let source_doc = tree.root_children[0].clone();
    project::rename_node(&root, &source_doc, "往返测试文档").expect("rename doc");
    let source_json = serde_json::to_string_pretty(&roundtrip_source_notebook()).unwrap();
    validate_notebook_document(&roundtrip_source_notebook()).expect("源文档须先通过校验");
    project::save_document(&root, &source_doc, &source_json).expect("save source doc");

    // 既有导出路径生成 .docx。
    let target = temp.path().join("往返产物.docx");
    let export = export_project_to_word(&root, &ExportScope::Document(source_doc.clone()), &target)
        .expect("导出必须成功");
    assert!(export.ok, "导出结果：{export:?}");

    // 重新导入：预览＋提交。
    let preview = preview_of(&root, &target);
    // 往返产物不含结构性损耗：导出侧的降级都写成了普通段落/纯文字，
    // 导入侧不应再产生任何损耗项。
    assert!(
        preview.losses.is_empty(),
        "往返产物的损耗必须为空：{:?}",
        preview.losses
    );
    let commit = import_document_commit(&root, &target, None, false, &preview.content_hash)
        .expect("往返提交必须成功");
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);

    // ---- 断言 1：可见文字逐字保留（含列表项文字），逐块对照 ----
    // 预期序列 = 导出侧已知增量（冠首文档名标题 + 列表前缀）+ 原文文字。
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(
        texts,
        vec![
            "往返测试文档",   // 差异①导出侧：范围根名称 → Heading1
            "开头段落",
            "",               // 空段落原样保留
            "二级标题",
            "五级标题",
            "• 项目一",       // 差异②导出侧：列表 → 文字前缀
            "• 项目二",
            "  • 嵌套项",     // 嵌套项按深度缩进两个空格
            "3. 第三项",      // 有序列表带 start=3 前缀
            "4. 第四项",
            "加粗普通斜体下划删除蓝色文字",
            "链接文字高亮文字带字号字体", // 差异③④：marks 丢失后相邻同 marks 合并
        ],
        "往返块文字序列"
    );
    // 字数与块数同步钉死（防止块内字符意外增减）。
    let total: usize = texts.iter().map(|t| t.chars().count()).sum();
    assert_eq!(preview.char_count, total);
    assert_eq!(preview.paragraph_count, blocks.len());
    assert_eq!(blocks.len(), 12);

    // ---- 断言 2：块结构差异恰好落在清单内 ----
    // 2a. 冠首是文档名的一级标题（差异①）。
    assert_eq!(blocks[0]["type"], "heading");
    assert_eq!(blocks[0]["attrs"]["level"], 1);
    // 2b. 列表降级为普通段落（差异②）：全文不得再出现列表块。
    let list_blocks = blocks
        .iter()
        .filter(|b| b["type"] == "bulletList" || b["type"] == "orderedList")
        .count();
    assert_eq!(list_blocks, 0, "往返后不得残留列表块");
    // 2c. 标题层级保留（差异清单之外的保留项）。
    assert_eq!(blocks[3]["type"], "heading");
    assert_eq!(blocks[3]["attrs"]["level"], 2);
    assert_eq!(blocks[4]["type"], "heading");
    assert_eq!(blocks[4]["attrs"]["level"], 5);
    // 2d. 对齐保留。
    assert_eq!(blocks[1]["attrs"]["textAlign"], "center");

    // ---- 断言 3：mark 差异恰好落在清单内 ----
    // 3a. 富格式段：加粗/斜体/下划线/删除线/颜色保留。
    assert_eq!(
        block_mark_summary(&blocks[10]),
        vec![
            "bold",
            "italic",
            "underline",
            "strike",
            "textStyle.color",
        ],
        "加粗/斜体/下划线/删除线/颜色必须保留"
    );
    assert_eq!(
        blocks[10]["content"][4]["marks"][0]["attrs"]["color"],
        "#3366cc",
        "颜色值往返一致（导出去 #、导入补 #）"
    );
    // 3b. 链接/高亮/字号/字体丢失（差异③④），全文不再出现这些 mark。
    for (index, block) in blocks.iter().enumerate() {
        let summary = block_mark_summary(block);
        assert!(
            !summary.iter().any(|m| m == "link"
                || m == "highlight"
                || m == "textStyle.fontSize"
                || m == "textStyle.fontFamily"),
            "第 {index} 块出现清单外的保留 mark：{summary:?}"
        );
    }
    // 3c. 丢失 marks 后的三个文本节点合并为单个无标记节点（canonical 行为）。
    assert_eq!(blocks[11]["content"].as_array().unwrap().len(), 1);
    assert!(blocks[11]["content"][0].get("marks").is_none());

    // ---- 断言 4：既有文档不受导入影响（导入只新增文档）。 ----
    let after = project::recover_then_read_content_tree(&root).expect("reread tree");
    let source_node = after.nodes.get(&source_doc).expect("源文档仍在");
    assert_eq!(source_node.name, "往返测试文档");
    let source_after = fs::read_to_string(
        ProjectPaths::new(root.clone()).document_file(&source_doc),
    )
    .unwrap();
    assert_eq!(source_after, source_json, "源文档正文逐字节不变");
}
