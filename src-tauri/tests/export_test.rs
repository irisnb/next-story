use std::fs;
use std::io::Read;
use std::path::Path;

use next_story_lib::project::{
    build_export_project, create_new_project, export_project_to_word, render_docx, ContentTree,
    ContentTreeNode, CreateProjectParams, ExportAlign, ExportBlock, ExportListItem, ExportMark,
    ExportNode, ExportProject, ExportScope, ExportText, NodeKind,
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
    read_zip_entry(path, "word/document.xml")
}

/// 读取生成的 .docx 中 `word/styles.xml` 的文本内容。
fn read_styles_xml(path: &Path) -> String {
    read_zip_entry(path, "word/styles.xml")
}

fn read_zip_entry(path: &Path, entry: &str) -> String {
    let file = fs::File::open(path).expect("open docx");
    let mut archive = zip::ZipArchive::new(file).expect("open docx as zip");
    let mut xml = String::new();
    archive
        .by_name(entry)
        .unwrap_or_else(|_| panic!("find {entry}"))
        .read_to_string(&mut xml)
        .expect("read entry");
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
        ai_visible: true,
    }
}

/// 示例树：根级 d3（序章）与 f1（第一卷）；f1 下 d1（小芳）与 f2（第二卷）；
/// f2 下 d2（小刚）。
fn sample_tree() -> ContentTree {
    let mut tree = ContentTree::new();
    tree.nodes.insert(
        "f1".into(),
        node(
            "f1",
            "第一卷",
            NodeKind::Folder,
            vec!["d1".into(), "f2".into()],
        ),
    );
    tree.nodes.insert(
        "f2".into(),
        node("f2", "第二卷", NodeKind::Folder, vec!["d2".into()]),
    );
    tree.nodes
        .insert("d1".into(), node("d1", "小芳", NodeKind::Document, vec![]));
    tree.nodes
        .insert("d2".into(), node("d2", "小刚", NodeKind::Document, vec![]));
    tree.nodes
        .insert("d3".into(), node("d3", "序章", NodeKind::Document, vec![]));
    tree.root_children = vec!["d3".into(), "f1".into()];
    tree
}

/// 把 DOCX 字节写入临时目录并返回路径（保持 TempDir 存活）。
fn write_docx_to_temp(bytes: &[u8]) -> (TempDir, std::path::PathBuf) {
    let temp = TempDir::new().expect("temp");
    let path = temp.path().join("out.docx");
    fs::write(&path, bytes).expect("write docx");
    (temp, path)
}

fn text_run(text: &str) -> ExportText {
    ExportText {
        text: text.into(),
        marks: vec![],
    }
}

// ---------------------------------------------------------------------------
// 4.1 内容树遍历与导出序列（范围模型）
// ---------------------------------------------------------------------------

#[test]
fn work_scope_follows_tree_order_with_nested_folders() {
    let tree = sample_tree();
    let project =
        build_export_project(&tree, "我的剧本", &ExportScope::Work, |_| Ok(vec![])).expect("build");

    assert_eq!(project.root_name, "我的剧本");
    assert_eq!(project.scope, ExportScope::Work);
    assert_eq!(project.children.len(), 2);
    match &project.children[0] {
        ExportNode::Document { name, .. } => assert_eq!(name, "序章"),
        other => panic!("期望文档，实际: {other:?}"),
    }
    match &project.children[1] {
        ExportNode::Folder { name, children } => {
            assert_eq!(name, "第一卷");
            assert_eq!(children.len(), 2);
            match &children[0] {
                ExportNode::Document { name, .. } => assert_eq!(name, "小芳"),
                other => panic!("期望文档，实际: {other:?}"),
            }
            match &children[1] {
                ExportNode::Folder { name, children } => {
                    assert_eq!(name, "第二卷");
                    assert_eq!(children.len(), 1);
                }
                other => panic!("期望文件夹，实际: {other:?}"),
            }
        }
        other => panic!("期望文件夹，实际: {other:?}"),
    }
}

#[test]
fn folder_scope_projects_subtree_with_folder_root_name() {
    let tree = sample_tree();
    let project = build_export_project(
        &tree,
        "我的剧本",
        &ExportScope::Folder("f1".into()),
        |_| Ok(vec![]),
    )
    .expect("build");

    // 根名称为文件夹名；children 是该文件夹的子树（不含文件夹自身包裹）。
    assert_eq!(project.root_name, "第一卷");
    assert_eq!(project.scope, ExportScope::Folder("f1".into()));
    assert_eq!(project.children.len(), 2);
    match &project.children[0] {
        ExportNode::Document { name, .. } => assert_eq!(name, "小芳"),
        other => panic!("期望文档，实际: {other:?}"),
    }
    match &project.children[1] {
        ExportNode::Folder { name, children } => {
            assert_eq!(name, "第二卷");
            assert_eq!(children.len(), 1);
        }
        other => panic!("期望文件夹，实际: {other:?}"),
    }
}

#[test]
fn document_scope_projects_single_document_with_document_root_name() {
    let tree = sample_tree();
    let read_ids = std::cell::RefCell::new(Vec::new());
    let project = build_export_project(
        &tree,
        "我的剧本",
        &ExportScope::Document("d1".into()),
        |id| {
            read_ids.borrow_mut().push(id.to_string());
            Ok(vec![ExportBlock::Paragraph {
                align: None,
                content: vec![text_run("正文")],
            }])
        },
    )
    .expect("build");

    assert_eq!(project.root_name, "小芳");
    assert_eq!(project.children.len(), 1);
    match &project.children[0] {
        ExportNode::Document { name, blocks } => {
            assert_eq!(name, "小芳");
            assert_eq!(blocks.len(), 1);
        }
        other => panic!("期望文档，实际: {other:?}"),
    }
    // 只读取范围内文档，不触碰范围外的其他文档。
    assert_eq!(*read_ids.borrow(), vec!["d1".to_string()]);
}

#[test]
fn scope_with_missing_or_wrong_kind_node_fails_in_chinese() {
    let tree = sample_tree();
    for scope in [
        ExportScope::Document("不存在".into()),
        ExportScope::Folder("不存在".into()),
        ExportScope::Document("f1".into()), // 文档范围指向文件夹
        ExportScope::Folder("d1".into()),   // 文件夹范围指向文档
    ] {
        let error = build_export_project(&tree, "作品", &scope, |_| Ok(vec![]))
            .expect_err("范围非法应报错");
        assert!(
            error.to_string().contains("导出范围"),
            "错误应为中文导出范围说明: {error}"
        );
    }
}

#[test]
fn export_sequence_excludes_recycle_bin() {
    let mut tree = ContentTree::new();
    tree.nodes.insert(
        "d1".into(),
        node("d1", "活动文档", NodeKind::Document, vec![]),
    );
    tree.root_children = vec!["d1".into()];
    // 回收站里的节点不在 nodes / root_children 中，遍历不应触及。
    tree.recycle_bin
        .push(next_story_lib::project::RecycleBinEntry {
            root_id: "trash-1".into(),
            original_parent: None,
            original_index: 0,
            nodes: {
                let mut m = std::collections::HashMap::new();
                m.insert(
                    "trash-1".into(),
                    node("trash-1", "已删除", NodeKind::Document, vec![]),
                );
                m
            },
        });

    let project =
        build_export_project(&tree, "作品", &ExportScope::Work, |_| Ok(vec![])).expect("build");
    assert_eq!(project.children.len(), 1);
    match &project.children[0] {
        ExportNode::Document { name, .. } => assert_eq!(name, "活动文档"),
        other => panic!("期望文档，实际: {other:?}"),
    }
}

#[test]
fn empty_scopes_project_root_heading_only() {
    // 空作品（Work 范围）
    let tree = ContentTree::new();
    let project =
        build_export_project(&tree, "空作品", &ExportScope::Work, |_| Ok(vec![])).expect("build");
    assert_eq!(project.root_name, "空作品");
    assert!(project.children.is_empty());

    // 空文件夹（Folder 范围）
    let mut tree = ContentTree::new();
    tree.nodes
        .insert("f".into(), node("f", "空文件夹", NodeKind::Folder, vec![]));
    tree.root_children = vec!["f".into()];
    let project = build_export_project(&tree, "作品", &ExportScope::Folder("f".into()), |_| {
        Ok(vec![])
    })
    .expect("build");
    assert_eq!(project.root_name, "空文件夹");
    assert!(project.children.is_empty());
}

#[test]
fn parse_captures_text_align_and_link_marks() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "对齐作品".into(),
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
                { "type": "paragraph", "attrs": { "textAlign": "center" }, "content": [
                    { "type": "text", "text": "居中" },
                    { "type": "text", "text": "链接", "marks": [
                        { "type": "link", "attrs": { "href": "https://example.com" } }
                    ] }
                ] },
                { "type": "paragraph", "content": [
                    { "type": "text", "text": "未设置对齐" }
                ] }
            ]
        }
    });
    let doc_json = serde_json::to_string(&doc).expect("serialize");
    next_story_lib::project::save_document(&project_path, &doc_id, &doc_json).expect("save");

    let target = temp.path().join("对齐作品.docx");
    let result =
        export_project_to_word(&project_path, &ExportScope::Work, &target).expect("export");
    assert!(result.ok);

    let xml = read_document_xml(&target);
    // 段落对齐映射为 w:jc；非法值不输出对齐。
    assert!(xml.contains(r#"<w:jc w:val="center""#));
    // 链接沿 Word 既有降级策略：纯文字保留，不丢字符。
    assert!(xml.contains("链接"));
}

// ---------------------------------------------------------------------------
// 4.2 DOCX 生成（样式保真与范围层级映射）
// ---------------------------------------------------------------------------

#[test]
fn render_docx_produces_valid_zip_with_document_xml() {
    let project = ExportProject {
        scope: ExportScope::Work,
        root_name: "测试作品".into(),
        children: vec![ExportNode::Document {
            name: "序章".into(),
            blocks: vec![ExportBlock::Paragraph {
                align: None,
                content: vec![ExportText {
                    text: "你好，世界".into(),
                    marks: vec![],
                }],
            }],
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
        scope: ExportScope::Work,
        root_name: "作品".into(),
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
        assert!(
            names.iter().any(|n| n == required),
            "缺少 OOXML 部件: {required}"
        );
    }
}

#[test]
fn render_docx_styles_align_with_editor_presentation() {
    let project = ExportProject {
        scope: ExportScope::Work,
        root_name: "作品".into(),
        children: vec![],
    };
    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);

    let styles = read_styles_xml(&path);
    // 文档默认（docDefaults）与 Heading1–6 都使用导出字体；正文 12pt（编辑器
    // 16px 同值换算）；标题字号按编辑器 CSS 的浏览器默认标题刻度对齐：
    // 24/18/14/12/10/8 磅（半点 48/36/28/24/20/16）。
    assert!(
        styles.contains("w:eastAsia=\"Source Han Sans CN\""),
        "默认字体"
    );
    assert!(styles.contains(r#"w:val="24""#), "正文默认 12pt");
    for (heading, half_points) in [
        ("Heading1", "48"),
        ("Heading2", "36"),
        ("Heading3", "28"),
        ("Heading4", "24"),
        ("Heading5", "20"),
        ("Heading6", "16"),
    ] {
        let style_block = styles
            .split("<w:style ")
            .find(|chunk| chunk.contains(&format!("w:styleId=\"{heading}\"")))
            .unwrap_or_else(|| panic!("缺少样式 {heading}"));
        assert!(
            style_block.contains(&format!("w:val=\"{half_points}\"")),
            "{heading} 应为 {half_points} 半点: {style_block}"
        );
        assert!(
            style_block.contains("w:eastAsia=\"Source Han Sans CN\""),
            "{heading} 应使用导出字体"
        );
    }
}

#[test]
fn render_docx_work_scope_preserves_heading_levels_and_text_order() {
    let project = ExportProject {
        scope: ExportScope::Work,
        root_name: "作品".into(),
        children: vec![
            ExportNode::Folder {
                name: "角色".into(),
                children: vec![ExportNode::Document {
                    name: "小芳".into(),
                    blocks: vec![
                        ExportBlock::Heading {
                            level: 1,
                            align: None,
                            content: vec![ExportText {
                                text: "背景".into(),
                                marks: vec![],
                            }],
                        },
                        ExportBlock::Paragraph {
                            align: None,
                            content: vec![ExportText {
                                text: "她住在海边。".into(),
                                marks: vec![],
                            }],
                        },
                    ],
                }],
            },
            ExportNode::Document {
                name: "结尾".into(),
                blocks: vec![ExportBlock::Paragraph {
                    align: None,
                    content: vec![ExportText {
                        text: "剧终。".into(),
                        marks: vec![],
                    }],
                }],
            },
        ],
    };

    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);
    let xml = read_document_xml(&path);

    // 标题层级（作品范围扁平映射）：作品 Heading1、文件夹 Heading2、文档 Heading3、
    // 正文内标题按自身层级 Heading1。
    assert!(xml.contains(r#"w:val="Heading1""#));
    assert!(xml.contains(r#"w:val="Heading2""#));
    assert!(xml.contains(r#"w:val="Heading3""#));

    // 文字顺序
    let texts = extract_texts(&xml);
    let joined: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
    let joined = joined.join("|");
    let order = [
        "作品",
        "角色",
        "小芳",
        "背景",
        "她住在海边。",
        "结尾",
        "剧终。",
    ];
    let mut last = 0;
    for expected in order {
        let pos = joined
            .find(expected)
            .unwrap_or_else(|| panic!("缺少文字: {expected}"));
        assert!(pos >= last, "文字顺序错误: {expected}");
        last = pos;
    }
}

/// 找到 `text` 第一次出现位置之前最近的 `w:val="HeadingN"` 样式引用，
/// 返回其片段（如 `w:val="Heading2"`）；用于断言某段文字的标题层级。
fn nearest_heading_style_before<'a>(xml: &'a str, text: &str) -> &'a str {
    let pos = xml.find(text).unwrap_or_else(|| panic!("缺少文字: {text}"));
    let before = &xml[..pos];
    let (start, _) = before
        .rmatch_indices(r#"w:val="Heading"#)
        .next()
        .unwrap_or_else(|| panic!("{text} 之前没有标题样式"));
    let chunk = &before[start..];
    let open = chunk.find('"').expect("样式值开引号");
    let close = chunk[open + 1..]
        .find('"')
        .map(|i| open + 1 + i + 1)
        .unwrap_or(chunk.len());
    &chunk[..close]
}

#[test]
fn render_docx_folder_scope_headings_progress_by_depth() {
    // 文件夹范围：根（文件夹名）Heading1；直接子级 Heading2（文档与嵌套文件夹同层）；
    // 嵌套文件夹的子级 Heading3。
    let project = ExportProject {
        scope: ExportScope::Folder("f1".into()),
        root_name: "第一卷".into(),
        children: vec![
            ExportNode::Document {
                name: "小芳".into(),
                blocks: vec![ExportBlock::Paragraph {
                    align: None,
                    content: vec![text_run("正文一")],
                }],
            },
            ExportNode::Folder {
                name: "第二卷".into(),
                children: vec![ExportNode::Document {
                    name: "小刚".into(),
                    blocks: vec![ExportBlock::Paragraph {
                        align: None,
                        content: vec![text_run("正文二")],
                    }],
                }],
            },
        ],
    };

    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);
    let xml = read_document_xml(&path);

    let texts = extract_texts(&xml);
    let joined = texts.join("|");
    // 顺序：第一卷（H1）→ 小芳（H2）→ 正文一 → 第二卷（H2）→ 小刚（H3）→ 正文二。
    assert!(joined.starts_with("第一卷|"), "根标题应最先: {joined}");
    assert_eq!(
        nearest_heading_style_before(&xml, "第一卷"),
        r#"w:val="Heading1""#
    );
    assert_eq!(
        nearest_heading_style_before(&xml, "小芳"),
        r#"w:val="Heading2""#,
        "直接子级文档 Heading2"
    );
    assert_eq!(
        nearest_heading_style_before(&xml, "第二卷"),
        r#"w:val="Heading2""#,
        "嵌套文件夹与直接子级同层 Heading2"
    );
    assert_eq!(
        nearest_heading_style_before(&xml, "小刚"),
        r#"w:val="Heading3""#,
        "嵌套文件夹内文档 Heading3"
    );
}

#[test]
fn render_docx_document_scope_uses_root_heading_without_document_title() {
    let project = ExportProject {
        scope: ExportScope::Document("d1".into()),
        root_name: "小芳".into(),
        children: vec![ExportNode::Document {
            name: "小芳".into(),
            blocks: vec![
                ExportBlock::Heading {
                    level: 2,
                    align: None,
                    content: vec![text_run("小节")],
                },
                ExportBlock::Paragraph {
                    align: Some(ExportAlign::Right),
                    content: vec![text_run("正文")],
                },
            ],
        }],
    };

    let bytes = render_docx(&project).expect("render");
    let (_temp, path) = write_docx_to_temp(&bytes);
    let xml = read_document_xml(&path);

    // 文档名只出现一次（根标题），正文直接跟随；内部标题按自身层级。
    let texts = extract_texts(&xml);
    assert_eq!(texts.iter().filter(|t| *t == "小芳").count(), 1);
    assert!(xml.contains(r#"w:val="Heading2""#), "内部标题按自身层级");
    // 段落对齐消费 textAlign。
    assert!(xml.contains(r#"<w:jc w:val="right""#));
}

#[test]
fn render_docx_preserves_chinese_emoji_and_marks() {
    let project = ExportProject {
        scope: ExportScope::Work,
        root_name: "作品".into(),
        children: vec![ExportNode::Document {
            name: "正文".into(),
            blocks: vec![ExportBlock::Paragraph {
                align: None,
                content: vec![
                    ExportText {
                        text: "中文".into(),
                        marks: vec![ExportMark::Bold],
                    },
                    ExportText {
                        text: "🎬".into(),
                        marks: vec![ExportMark::Italic],
                    },
                    ExportText {
                        text: "下划线".into(),
                        marks: vec![ExportMark::Underline],
                    },
                    ExportText {
                        text: "删除".into(),
                        marks: vec![ExportMark::Strike],
                    },
                    ExportText {
                        text: "红字".into(),
                        marks: vec![ExportMark::Color("#ff0000".into())],
                    },
                    ExportText {
                        text: "链接".into(),
                        marks: vec![ExportMark::Link("https://example.com".into())],
                    },
                ],
            }],
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
    assert!(xml.contains("链接"), "链接标记降级为纯文字仍保留可见字符");
    // 粗体 / 斜体 / 下划线 / 删除线 / 颜色（docx-rs 输出为自闭合标记，
    // 形态见 docx-rs 0.4.22 run/underline/color 元素单测）
    assert!(xml.contains("<w:b />"));
    assert!(xml.contains("<w:i />"));
    assert!(xml.contains("<w:u"));
    assert!(xml.contains("<w:strike />"));
    assert!(xml.contains(r#"w:val="ff0000""#));
}

#[test]
fn render_docx_preserves_list_text() {
    let project = ExportProject {
        scope: ExportScope::Work,
        root_name: "作品".into(),
        children: vec![ExportNode::Document {
            name: "清单".into(),
            blocks: vec![
                ExportBlock::BulletList {
                    items: vec![
                        ExportListItem {
                            content: vec![text_run("甲")],
                            nested: None,
                        },
                        ExportListItem {
                            content: vec![text_run("乙")],
                            nested: None,
                        },
                    ],
                },
                ExportBlock::OrderedList {
                    start: 3,
                    items: vec![ExportListItem {
                        content: vec![text_run("丙")],
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
    assert!(xml.contains("3. "), "有序列表从 start 起始编号");
}

// ---------------------------------------------------------------------------
// 4.3 失败路径与作品数据不变
// ---------------------------------------------------------------------------

#[test]
fn work_scope_export_matches_legacy_behavior_and_leaves_project_unchanged() {
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
    let tree_path = project_path
        .join("next-story-system")
        .join("content-tree.json");

    let body = valid_notebook_json("导出正文第一行\n导出正文第二行");
    next_story_lib::project::save_document(&project_path, &doc_id, &body).expect("save");

    let before_doc = fs::read(&doc_path).expect("read doc before");
    let before_meta = fs::read(&metadata_path).expect("read meta before");
    let before_tree = fs::read(&tree_path).expect("read tree before");

    let target = temp.path().join("导出作品.docx");
    let result =
        export_project_to_word(&project_path, &ExportScope::Work, &target).expect("export");
    assert!(result.ok);
    assert!(target.is_file());

    // 作品数据字节不变
    assert_eq!(fs::read(&doc_path).expect("read doc after"), before_doc);
    assert_eq!(
        fs::read(&metadata_path).expect("read meta after"),
        before_meta
    );
    assert_eq!(fs::read(&tree_path).expect("read tree after"), before_tree);

    // 生成的是真正的 docx
    let xml = read_document_xml(&target);
    assert!(xml.contains("导出正文第一行"));
    assert!(xml.contains("导出正文第二行"));
}

#[test]
fn document_scope_export_single_document_and_leaves_project_unchanged() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "文档范围作品".into(),
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
    let doc_path = project_path
        .join("作品文本")
        .join("documents")
        .join(format!("{doc_id}.json"));

    let body = valid_notebook_json("文档范围正文");
    next_story_lib::project::save_document(&project_path, &doc_id, &body).expect("save");
    let before = fs::read(&doc_path).expect("read before");

    let target = temp.path().join("文档范围作品.docx");
    let result = export_project_to_word(
        &project_path,
        &ExportScope::Document(doc_id.clone()),
        &target,
    )
    .expect("export");
    assert!(result.ok);

    let xml = read_document_xml(&target);
    assert!(xml.contains("文档范围正文"));
    // 文档范围默认根标题即文档名（这里是新建作品的默认文档名）。
    let texts = extract_texts(&xml);
    assert!(
        texts
            .iter()
            .any(|t| t.contains("正文") || t.contains("文档")),
        "应含根标题"
    );

    assert_eq!(
        fs::read(&doc_path).expect("read after"),
        before,
        "作品数据字节不变"
    );
}

#[test]
fn export_fails_cleanly_on_unwritable_target() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "失败作品".into(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    // 目标路径指向一个不存在的目录，写入必然失败。
    let target = temp.path().join("不存在目录").join("out.docx");
    let result = export_project_to_word(&project_path, &ExportScope::Work, &target);
    assert!(result.is_err());
    assert!(!target.exists(), "失败时不应留下目标文件");
}

#[test]
fn export_rejects_missing_project() {
    let temp = TempDir::new().expect("temp");
    let missing = temp.path().join("不存在作品");
    for scope in [
        ExportScope::Work,
        ExportScope::Document("d1".into()),
        ExportScope::Folder("f1".into()),
    ] {
        let target = temp.path().join("out.docx");
        let result = export_project_to_word(&missing, &scope, &target);
        assert!(result.is_err());
        assert!(!target.exists());
    }
}
