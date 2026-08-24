use std::fs;
use std::io::Read;
use std::path::Path;

use next_story_lib::project::{
    build_export_project, create_new_project, export_project_to_word, render_docx,
    CreateProjectParams, ContentTree, ContentTreeNode, ExportBlock, ExportMark, ExportNode,
    ExportProject, ExportText, NodeKind,
};
use tempfile::TempDir;

/// 生成一段合法格式版本 2 的本子 JSON 字符串（每行一个正文段落）。
fn valid_notebook_json(text: &str) -> String {
    let content: Vec<serde_json::Value> = text
        .split('\n')
        .map(|line| {
            if line.is_empty() {
                serde_json::json!({ "type": "paragraph" })
            } else {
                serde_json::json!({
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": line }]
                })
            }
        })
        .collect();
    let value = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 2,
        "document": { "type": "doc", "content": content }
    });
    serde_json::to_string_pretty(&value).expect("serialize notebook")
}

/// 读取生成的 .docx 中 `word/document.xml` 的文本内容。
fn read_document_xml(path: &Path) -> String {
    let file = fs::File::open(path).expect("open docx");
    let mut archive = zip::ZipArchive::new(file).expect("open docx as zip");
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .expect("find document.xml")
        .read_to_string(&mut xml)
        .expect("read document.xml");
    xml
}

/// 从 document.xml 中按顺序提取所有 `<w:t>` 文本。
fn extract_texts(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<w:t") {
        let after_tag = &rest[start..];
        let text_start = after_tag.find('>').map(|i| i + 1).unwrap_or(0);
        let text_end = after_tag[text_start..]
            .find("</w:t>")
            .map(|i| text_start + i)
            .unwrap_or(after_tag.len());
        out.push(after_tag[text_start..text_end].to_string());
        rest = &after_tag[text_end..];
    }
    out
}

fn node(id: &str, name: &str, kind: NodeKind, children: Vec<String>) -> ContentTreeNode {
    ContentTreeNode {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        children,
    }
}

/// 把 DOCX 字节写入临时目录并返回路径（保持 TempDir 存活）。
fn write_docx_to_temp(bytes: &[u8]) -> (TempDir, std::path::PathBuf) {
    let temp = TempDir::new().expect("temp");
    let path = temp.path().join("out.docx");
    fs::write(&path, bytes).expect("write docx");
    (temp, path)
}

// ---------------------------------------------------------------------------
// 4.1 内容树遍历与导出序列
// ---------------------------------------------------------------------------

#[test]
fn export_sequence_follows_tree_order_with_nested_folders() {
    let mut tree = ContentTree::new();
    tree.nodes.insert(
        "f1".into(),
        node("f1", "角色", NodeKind::Folder, vec!["d1".into(), "d2".into()]),
    );
    tree.nodes.insert("d1".into(), node("d1", "小芳", NodeKind::Document, vec![]));
    tree.nodes.insert("d2".into(), node("d2", "小刚", NodeKind::Document, vec![]));
    tree.nodes.insert("d3".into(), node("d3", "序章", NodeKind::Document, vec![]));
    tree.root_children = vec!["d3".into(), "f1".into()];

    let project = build_export_project(&tree, "我的剧本", |_| Ok(vec![])).expect("build");

    assert_eq!(project.project_name, "我的剧本");
    assert_eq!(project.children.len(), 2);
    match &project.children[0] {
        ExportNode::Document { name, .. } => assert_eq!(name, "序章"),
        other => panic!("期望文档，实际: {other:?}"),
    }
    match &project.children[1] {
        ExportNode::Folder { name, children } => {
            assert_eq!(name, "角色");
            assert_eq!(children.len(), 2);
            match &children[0] {
                ExportNode::Document { name, .. } => assert_eq!(name, "小芳"),
                other => panic!("期望文档，实际: {other:?}"),
            }
            match &children[1] {
                ExportNode::Document { name, .. } => assert_eq!(name, "小刚"),
                other => panic!("期望文档，实际: {other:?}"),
            }
        }
        other => panic!("期望文件夹，实际: {other:?}"),
    }
}

#[test]
fn export_sequence_excludes_recycle_bin() {
    let mut tree = ContentTree::new();
    tree.nodes.insert("d1".into(), node("d1", "活动文档", NodeKind::Document, vec![]));
    tree.root_children = vec!["d1".into()];
    // 回收站里的节点不在 nodes / root_children 中，遍历不应触及。
    tree.recycle_bin.push(next_story_lib::project::RecycleBinEntry {
        root_id: "trash-1".into(),
        original_parent: None,
        original_index: 0,
        nodes: {
            let mut m = std::collections::HashMap::new();
            m.insert("trash-1".into(), node("trash-1", "已删除", NodeKind::Document, vec![]));
            m
        },
    });

    let project = build_export_project(&tree, "作品", |_| Ok(vec![])).expect("build");
    assert_eq!(project.children.len(), 1);
    match &project.children[0] {
        ExportNode::Document { name, .. } => assert_eq!(name, "活动文档"),
        other => panic!("期望文档，实际: {other:?}"),
    }
}

#[test]
fn export_sequence_handles_empty_project() {
    let tree = ContentTree::new();
    let project = build_export_project(&tree, "空作品", |_| Ok(vec![])).expect("build");
    assert_eq!(project.project_name, "空作品");
    assert!(project.children.is_empty());
}

#[test]
fn export_sequence_parses_rich_document_blocks() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "富文本作品".into(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let tree_json = fs::read_to_string(
        project_path
            .join("next-story-system")
            .join("content-tree.json"),
    )
    .expect("read tree");
    let tree: ContentTree = serde_json::from_str(&tree_json).expect("parse tree");
    let doc_id = tree.root_children[0].clone();

    let doc = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 2,
        "document": {
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "第一段" }] },
                { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "小节" }] },
                { "type": "bulletList", "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "甲" }] }] },
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "乙" }] }] }
                ] },
                { "type": "orderedList", "attrs": { "start": 3 }, "content": [
                    { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "丙" }] }] }
                ] }
            ]
        }
    });
    let doc_json = serde_json::to_string(&doc).expect("serialize");
    next_story_lib::project::save_document(&project_path, &doc_id, &doc_json).expect("save");

    let target = temp.path().join("富文本作品.docx");
    let result = export_project_to_word(&project_path, &target).expect("export");
    assert!(result.ok);

    let xml = read_document_xml(&target);
    // 正文内标题映射为 Heading2
    assert!(xml.contains(r#"w:val="Heading2""#));
    // 列表文字与编号前缀
    assert!(xml.contains("甲"));
    assert!(xml.contains("乙"));
    assert!(xml.contains("丙"));
    assert!(xml.contains("3. "));
    // 文字顺序：第一段 → 小节 → 列表
    let texts = extract_texts(&xml);
    let joined = texts.join("|");
    let first = joined.find("第一段").expect("第一段");
    let heading = joined.find("小节").expect("小节");
    let item_a = joined.find("甲").expect("甲");
    assert!(first < heading && heading < item_a, "块顺序错误: {joined}");
}

// ---------------------------------------------------------------------------
// 4.2 DOCX 生成
// ---------------------------------------------------------------------------

#[test]
fn render_docx_produces_valid_zip_with_document_xml() {
    let project = ExportProject {
        project_name: "测试作品".into(),
        children: vec![ExportNode::Document {
            name: "序章".into(),
            blocks: vec![ExportBlock::Paragraph(vec![ExportText {
                text: "你好，世界".into(),
                marks: vec![],
            }])],
        }],
    };

    let bytes = render_docx(&project).expect("render docx");
    // zip 魔数 PK
    assert_eq!(&bytes[0..2], b"PK");
    let (_temp, path) = write_docx_to_temp(&bytes);
    let xml = read_document_xml(&path);
    assert!(xml.contains("你好，世界"));
}

#[test]
fn render_docx_contains_required_ooxml_parts() {
    let project = ExportProject {
        project_name: "作品".into(),
        children: vec![],
    };
    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);

    let file = fs::File::open(&path).expect("open docx");
    let mut archive = zip::ZipArchive::new(file).expect("open docx as zip");
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).expect("entry").name().to_string())
        .collect();

    // Word 打开 .docx 所需的 OOXML 包结构。
    for required in [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/_rels/document.xml.rels",
        "word/styles.xml",
    ] {
        assert!(names.iter().any(|n| n == required), "缺少 OOXML 部件: {required}");
    }
}

#[test]
fn render_docx_preserves_heading_levels_and_text_order() {
    let project = ExportProject {
        project_name: "作品".into(),
        children: vec![
            ExportNode::Folder {
                name: "角色".into(),
                children: vec![ExportNode::Document {
                    name: "小芳".into(),
                    blocks: vec![
                        ExportBlock::Heading {
                            level: 1,
                            content: vec![ExportText { text: "背景".into(), marks: vec![] }],
                        },
                        ExportBlock::Paragraph(vec![ExportText {
                            text: "她住在海边。".into(),
                            marks: vec![],
                        }]),
                    ],
                }],
            },
            ExportNode::Document {
                name: "结尾".into(),
                blocks: vec![ExportBlock::Paragraph(vec![ExportText {
                    text: "剧终。".into(),
                    marks: vec![],
                }])],
            },
        ],
    };

    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);
    let xml = read_document_xml(&path);

    // 标题层级：作品 Heading1、文件夹 Heading2、文档 Heading3、正文内标题 Heading1。
    assert!(xml.contains(r#"w:val="Heading1""#));
    assert!(xml.contains(r#"w:val="Heading2""#));
    assert!(xml.contains(r#"w:val="Heading3""#));

    // 文字顺序
    let texts = extract_texts(&xml);
    let joined: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
    let joined = joined.join("|");
    let order = ["作品", "角色", "小芳", "背景", "她住在海边。", "结尾", "剧终。"];
    let mut last = 0;
    for expected in order {
        let pos = joined.find(expected).unwrap_or_else(|| panic!("缺少文字: {expected}"));
        assert!(pos >= last, "文字顺序错误: {expected}");
        last = pos;
    }
}

#[test]
fn render_docx_preserves_chinese_emoji_and_marks() {
    let project = ExportProject {
        project_name: "作品".into(),
        children: vec![ExportNode::Document {
            name: "正文".into(),
            blocks: vec![ExportBlock::Paragraph(vec![
                ExportText { text: "中文".into(), marks: vec![ExportMark::Bold] },
                ExportText { text: "🎬".into(), marks: vec![ExportMark::Italic] },
                ExportText { text: "下划线".into(), marks: vec![ExportMark::Underline] },
                ExportText { text: "删除".into(), marks: vec![ExportMark::Strike] },
                ExportText { text: "红字".into(), marks: vec![ExportMark::Color("#ff0000".into())] },
            ])],
        }],
    };

    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);
    let xml = read_document_xml(&path);

    assert!(xml.contains("中文"));
    assert!(xml.contains("🎬"));
    assert!(xml.contains("下划线"));
    assert!(xml.contains("删除"));
    assert!(xml.contains("红字"));
    // 粗体 / 斜体 / 下划线 / 删除线 / 颜色
    assert!(xml.contains(r#"<w:b w:val="true"/>"#));
    assert!(xml.contains(r#"<w:i w:val="true"/>"#));
    assert!(xml.contains("<w:u"));
    assert!(xml.contains(r#"<w:strike w:val="true"/>"#));
    assert!(xml.contains(r#"w:val="ff0000""#));
}

#[test]
fn render_docx_preserves_list_text() {
    let project = ExportProject {
        project_name: "作品".into(),
        children: vec![ExportNode::Document {
            name: "清单".into(),
            blocks: vec![
                ExportBlock::BulletList(vec![
                    next_story_lib::project::ExportListItem {
                        content: vec![ExportText { text: "甲".into(), marks: vec![] }],
                        nested: None,
                    },
                    next_story_lib::project::ExportListItem {
                        content: vec![ExportText { text: "乙".into(), marks: vec![] }],
                        nested: None,
                    },
                ]),
                ExportBlock::OrderedList {
                    start: 3,
                    items: vec![next_story_lib::project::ExportListItem {
                        content: vec![ExportText { text: "丙".into(), marks: vec![] }],
                        nested: None,
                    }],
                },
            ],
        }],
    };

    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);
    let xml = read_document_xml(&path);
    assert!(xml.contains("甲"));
    assert!(xml.contains("乙"));
    assert!(xml.contains("丙"));
}

// ---------------------------------------------------------------------------
// 4.3 失败路径与作品数据不变
// ---------------------------------------------------------------------------

#[test]
fn export_project_to_word_writes_real_docx_and_leaves_project_unchanged() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "导出作品".into(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    // 读取根级文档 ID 并写入正文
    let tree_json = fs::read_to_string(
        project_path
            .join("next-story-system")
            .join("content-tree.json"),
    )
    .expect("read tree");
    let tree: ContentTree = serde_json::from_str(&tree_json).expect("parse tree");
    let doc_id = tree.root_children[0].clone();
    let doc_path = project_path
        .join("作品文本")
        .join("documents")
        .join(format!("{doc_id}.json"));
    let metadata_path = project_path.join("next-story-system").join("project.json");
    let tree_path = project_path.join("next-story-system").join("content-tree.json");

    let body = valid_notebook_json("导出正文第一行\n导出正文第二行");
    next_story_lib::project::save_document(&project_path, &doc_id, &body).expect("save");

    let before_doc = fs::read(&doc_path).expect("read doc before");
    let before_meta = fs::read(&metadata_path).expect("read meta before");
    let before_tree = fs::read(&tree_path).expect("read tree before");

    let target = temp.path().join("导出作品.docx");
    let result = export_project_to_word(&project_path, &target).expect("export");
    assert!(result.ok);
    assert!(target.is_file());

    // 作品数据字节不变
    assert_eq!(fs::read(&doc_path).expect("read doc after"), before_doc);
    assert_eq!(fs::read(&metadata_path).expect("read meta after"), before_meta);
    assert_eq!(fs::read(&tree_path).expect("read tree after"), before_tree);

    // 生成的是真正的 docx
    let xml = read_document_xml(&target);
    assert!(xml.contains("导出正文第一行"));
    assert!(xml.contains("导出正文第二行"));
}

#[test]
fn export_project_to_word_fails_cleanly_on_unwritable_target() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "失败作品".into(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    // 目标路径指向一个不存在的目录，写入必然失败。
    let target = temp.path().join("不存在目录").join("out.docx");
    let result = export_project_to_word(&project_path, &target);
    assert!(result.is_err());
    assert!(!target.exists(), "失败时不应留下目标文件");
}

#[test]
fn export_project_to_word_rejects_missing_project() {
    let temp = TempDir::new().expect("temp");
    let missing = temp.path().join("不存在作品");
    let target = temp.path().join("out.docx");
    let result = export_project_to_word(&missing, &target);
    assert!(result.is_err());
    assert!(!target.exists());
}
