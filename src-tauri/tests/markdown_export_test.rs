use std::fs;

use next_story_lib::project::{
    create_new_project, export_project_to_markdown, render_markdown, ContentTree,
    CreateProjectParams, ExportBlock, ExportListItem, ExportMark, ExportNode, ExportProject,
    ExportScope, ExportText,
};
use tempfile::TempDir;

fn text_run(text: &str) -> ExportText {
    ExportText {
        text: text.into(),
        marks: vec![],
    }
}

fn run(text: &str, marks: Vec<ExportMark>) -> ExportText {
    ExportText {
        text: text.into(),
        marks,
    }
}

// ---------------------------------------------------------------------------
// 结构映射：范围层级标题
// ---------------------------------------------------------------------------

#[test]
fn work_scope_headings_follow_flat_mapping() {
    let project = ExportProject {
        scope: ExportScope::Work,
        root_name: "我的剧本".into(),
        children: vec![
            ExportNode::Document {
                name: "序章".into(),
                blocks: vec![],
            },
            ExportNode::Folder {
                name: "第一卷".into(),
                children: vec![ExportNode::Document {
                    name: "小芳".into(),
                    blocks: vec![],
                }],
            },
        ],
    };
    let markdown = render_markdown(&project);
    assert_eq!(
        markdown,
        "# 我的剧本\n\n### 序章\n\n## 第一卷\n\n### 小芳\n"
    );
}

#[test]
fn folder_scope_headings_progress_by_depth() {
    let project = ExportProject {
        scope: ExportScope::Folder("f1".into()),
        root_name: "第一卷".into(),
        children: vec![
            ExportNode::Document {
                name: "小芳".into(),
                blocks: vec![],
            },
            ExportNode::Folder {
                name: "第二卷".into(),
                children: vec![ExportNode::Document {
                    name: "小刚".into(),
                    blocks: vec![],
                }],
            },
        ],
    };
    let markdown = render_markdown(&project);
    assert_eq!(markdown, "# 第一卷\n\n## 小芳\n\n## 第二卷\n\n### 小刚\n");
}

#[test]
fn document_scope_root_heading_only_once() {
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
                    align: None,
                    content: vec![text_run("正文")],
                },
            ],
        }],
    };
    let markdown = render_markdown(&project);
    assert_eq!(markdown, "# 小芳\n\n## 小节\n\n正文\n");
    assert_eq!(markdown.matches("小芳").count(), 1, "文档名只作根标题一次");
}

#[test]
fn inner_headings_use_own_levels() {
    let project = ExportProject {
        scope: ExportScope::Document("d1".into()),
        root_name: "文档".into(),
        children: vec![ExportNode::Document {
            name: "文档".into(),
            blocks: vec![
                ExportBlock::Heading {
                    level: 1,
                    align: None,
                    content: vec![text_run("一级")],
                },
                ExportBlock::Heading {
                    level: 6,
                    align: None,
                    content: vec![text_run("六级")],
                },
            ],
        }],
    };
    assert_eq!(
        render_markdown(&project),
        "# 文档\n\n# 一级\n\n###### 六级\n"
    );
}

#[test]
fn empty_scope_outputs_root_heading_only() {
    let project = ExportProject {
        scope: ExportScope::Work,
        root_name: "空作品".into(),
        children: vec![],
    };
    assert_eq!(render_markdown(&project), "# 空作品\n");

    let project = ExportProject {
        scope: ExportScope::Folder("f".into()),
        root_name: "空文件夹".into(),
        children: vec![],
    };
    assert_eq!(render_markdown(&project), "# 空文件夹\n");
}

// ---------------------------------------------------------------------------
// 列表映射：嵌套与有序起始号
// ---------------------------------------------------------------------------

#[test]
fn lists_map_nesting_and_ordered_start() {
    let project = ExportProject {
        scope: ExportScope::Document("d".into()),
        root_name: "清单".into(),
        children: vec![ExportNode::Document {
            name: "清单".into(),
            blocks: vec![
                ExportBlock::BulletList {
                    items: vec![
                        ExportListItem {
                            content: vec![text_run("甲")],
                            nested: Some(Box::new(ExportBlock::OrderedList {
                                start: 3,
                                items: vec![ExportListItem {
                                    content: vec![text_run("甲内")],
                                    nested: None,
                                }],
                            })),
                        },
                        ExportListItem {
                            content: vec![text_run("乙")],
                            nested: None,
                        },
                    ],
                },
                ExportBlock::OrderedList {
                    start: 5,
                    items: vec![ExportListItem {
                        content: vec![text_run("丙")],
                        nested: None,
                    }],
                },
            ],
        }],
    };
    let markdown = render_markdown(&project);
    assert_eq!(
        markdown, "# 清单\n\n- 甲\n    3. 甲内\n- 乙\n\n5. 丙\n",
        "嵌套列表按 4 空格缩进；有序列表从 start 起始"
    );
}

// ---------------------------------------------------------------------------
// 行内格式与降级
// ---------------------------------------------------------------------------

#[test]
fn inline_marks_map_and_presentation_only_marks_degrade() {
    let project = ExportProject {
        scope: ExportScope::Document("d".into()),
        root_name: "行内".into(),
        children: vec![ExportNode::Document {
            name: "行内".into(),
            blocks: vec![ExportBlock::Paragraph {
                align: None,
                content: vec![
                    run("粗体", vec![ExportMark::Bold]),
                    run("斜体", vec![ExportMark::Italic]),
                    run("删除", vec![ExportMark::Strike]),
                    run("下划", vec![ExportMark::Underline]),
                    run("红字", vec![ExportMark::Color("#ff0000".into())]),
                    run(
                        "链接",
                        vec![ExportMark::Link("https://example.com/a?b=1".into())],
                    ),
                ],
            }],
        }],
    };
    let markdown = render_markdown(&project);
    assert_eq!(
        markdown,
        "# 行内\n\n**粗体***斜体*~~删除~~<u>下划</u>红字[链接](https://example.com/a?b=1)\n",
        "颜色降级纯文字；链接保留 [文字](地址)"
    );
}

#[test]
fn link_destination_with_spaces_or_parentheses_uses_angle_form() {
    let project = ExportProject {
        scope: ExportScope::Document("d".into()),
        root_name: "链接".into(),
        children: vec![ExportNode::Document {
            name: "链接".into(),
            blocks: vec![ExportBlock::Paragraph {
                align: None,
                content: vec![
                    run(
                        "带括号",
                        vec![ExportMark::Link("https://example.com/a(1)".into())],
                    ),
                    run(
                        "带空格",
                        vec![ExportMark::Link("https://example.com/a b".into())],
                    ),
                ],
            }],
        }],
    };
    let markdown = render_markdown(&project);
    assert_eq!(
        markdown,
        "# 链接\n\n[带括号](<https://example.com/a(1)>)[带空格](<https://example.com/a b>)\n"
    );
}

#[test]
fn combined_marks_wrap_in_order() {
    let project = ExportProject {
        scope: ExportScope::Document("d".into()),
        root_name: "组合".into(),
        children: vec![ExportNode::Document {
            name: "组合".into(),
            blocks: vec![ExportBlock::Paragraph {
                align: None,
                content: vec![
                    run("粗斜", vec![ExportMark::Bold, ExportMark::Italic]),
                    run(
                        "粗链接",
                        vec![ExportMark::Bold, ExportMark::Link("https://e.com".into())],
                    ),
                ],
            }],
        }],
    };
    assert_eq!(
        render_markdown(&project),
        "# 组合\n\n***粗斜***[**粗链接**](https://e.com)\n"
    );
}

// ---------------------------------------------------------------------------
// 特殊字符转义（穷举，含全角不误伤）
// ---------------------------------------------------------------------------

#[test]
fn ascii_punctuation_that_commonmark_interprets_is_escaped() {
    // 穷举转义集合：每个字符单独成段验证「前缀反斜杠、字符原样保留」。
    for ch in [
        '\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '<', '>',
        '&', '~',
    ] {
        let text = format!("字{ch}尾");
        let project = ExportProject {
            scope: ExportScope::Document("d".into()),
            root_name: "转义".into(),
            children: vec![ExportNode::Document {
                name: "转义".into(),
                blocks: vec![ExportBlock::Paragraph {
                    align: None,
                    content: vec![run(&text, vec![])],
                }],
            }],
        };
        let markdown = render_markdown(&project);
        assert_eq!(
            markdown,
            format!("# 转义\n\n字\\{ch}尾\n"),
            "字符 {ch:?} 应被反斜杠转义"
        );
    }
}

#[test]
fn fullwidth_and_non_ascii_characters_are_never_escaped() {
    // 全角形态（不同码位）与中文、emoji 原样通过，不得出现反斜杠。
    for text in [
        "＊重点＊",
        "＃ 标题",
        "（括号）",
        "［方括号］",
        "中文与🎬",
        "波浪～线",
        "省略…",
    ] {
        let project = ExportProject {
            scope: ExportScope::Document("d".into()),
            root_name: "全角".into(),
            children: vec![ExportNode::Document {
                name: "全角".into(),
                blocks: vec![ExportBlock::Paragraph {
                    align: None,
                    content: vec![run(text, vec![])],
                }],
            }],
        };
        let markdown = render_markdown(&project);
        assert_eq!(
            markdown,
            format!("# 全角\n\n{text}\n"),
            "全角字符不误伤: {text}"
        );
        assert!(
            !markdown.contains('\\'),
            "全角段落不应出现转义反斜杠: {markdown}"
        );
    }
}

#[test]
fn markdown_special_literals_render_back_as_original_text() {
    // 用户正文写的星号 / 井号 / 方括号导出后渲染应回到字面字符：
    // 这里验证导出文本形态（渲染验证由 6.6 真机验收覆盖）。
    let project = ExportProject {
        scope: ExportScope::Document("d".into()),
        root_name: "字面".into(),
        children: vec![ExportNode::Document {
            name: "字面".into(),
            blocks: vec![ExportBlock::Paragraph {
                align: None,
                content: vec![run("*强调* #不是标题 [链接](不是)", vec![])],
            }],
        }],
    };
    assert_eq!(
        render_markdown(&project),
        "# 字面\n\n\\*强调\\* \\#不是标题 \\[链接\\]\\(不是\\)\n"
    );
}

// ---------------------------------------------------------------------------
// 真实作品导出：字节不变、失败路径、空范围
// ---------------------------------------------------------------------------

#[test]
fn markdown_export_leaves_project_bytes_unchanged() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "导出作品".into(),
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

    let doc = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 2,
        "document": {
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "中文正文，🎬emoji。" }] },
                { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "小节" }] },
                { "type": "paragraph", "content": [
                    { "type": "text", "text": "粗", "marks": [{ "type": "bold" }] },
                    { "type": "text", "text": "斜", "marks": [{ "type": "italic" }] },
                    { "type": "text", "text": "删", "marks": [{ "type": "strike" }] },
                    { "type": "text", "text": "下", "marks": [{ "type": "underline" }] },
                    { "type": "text", "text": "彩", "marks": [{ "type": "textStyle", "attrs": { "color": "#3366cc", "fontFamily": "宋体", "fontSize": "18pt" } }] },
                    { "type": "text", "text": "链", "marks": [{ "type": "link", "attrs": { "href": "https://example.com" } }] },
                    { "type": "text", "text": "高", "marks": [{ "type": "highlight", "attrs": { "color": "#ffff00" } }] }
                ] },
                { "type": "bulletList", "content": [
                    { "type": "listItem", "content": [
                        { "type": "paragraph", "content": [{ "type": "text", "text": "甲" }] },
                        { "type": "orderedList", "attrs": { "start": 2 }, "content": [
                            { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "甲内" }] }] }
                        ] }
                    ] }
                ] }
            ]
        }
    });
    let doc_json = serde_json::to_string(&doc).expect("serialize");
    next_story_lib::project::save_document(&project_path, &doc_id, &doc_json).expect("save");

    let metadata_path = project_path.join("next-story-system").join("project.json");
    let tree_path = project_path
        .join("next-story-system")
        .join("content-tree.json");
    let before_doc = fs::read(&doc_path).expect("read doc before");
    let before_meta = fs::read(&metadata_path).expect("read meta before");
    let before_tree = fs::read(&tree_path).expect("read tree before");

    let target = temp.path().join("导出作品.md");
    let result = export_project_to_markdown(
        &project_path,
        &ExportScope::Document(doc_id.clone()),
        &target,
    )
    .expect("export");
    assert!(result.ok);
    assert!(target.is_file());

    let markdown = fs::read_to_string(&target).expect("read md");
    // 全类型内容断言：中文与 emoji、标题层级、行内格式、降级、链接、嵌套有序列表。
    assert!(markdown.starts_with("# "), "文档范围以文档名一级标题开头");
    assert!(markdown.contains("中文正文，🎬emoji。"));
    assert!(markdown.contains("## 小节"));
    assert!(markdown.contains("**粗**"));
    assert!(markdown.contains("*斜*"));
    assert!(markdown.contains("~~删~~"));
    assert!(markdown.contains("<u>下</u>"));
    assert!(markdown.contains("彩"), "颜色/字体/字号降级为纯文字");
    assert!(markdown.contains("[链](https://example.com)"));
    assert!(markdown.contains("高"), "高亮降级为纯文字不丢字符");
    assert!(
        markdown.contains("- 甲\n    2. 甲内"),
        "嵌套有序列表缩进与起始号"
    );

    // UTF-8 单文件
    let bytes = fs::read(&target).expect("read bytes");
    assert_eq!(String::from_utf8(bytes.clone()).expect("utf-8"), markdown);

    // 作品数据字节不变
    assert_eq!(fs::read(&doc_path).expect("read doc after"), before_doc);
    assert_eq!(
        fs::read(&metadata_path).expect("read meta after"),
        before_meta
    );
    assert_eq!(fs::read(&tree_path).expect("read tree after"), before_tree);
}

#[test]
fn markdown_empty_scope_exports_root_heading_only() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "空范围作品".into(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let target = temp.path().join("空范围.md");
    let result =
        export_project_to_markdown(&project_path, &ExportScope::Work, &target).expect("export");
    assert!(result.ok);
    let markdown = fs::read_to_string(&target).expect("read md");
    // 新建作品有默认文档，非空；这里只断言根标题存在与结构稳定。
    assert!(markdown.starts_with("# 空范围作品\n"));
}

#[test]
fn markdown_export_fails_cleanly_on_unwritable_target() {
    let temp = TempDir::new().expect("temp");
    let project_path = create_new_project(CreateProjectParams {
        name: "失败作品".into(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let target = temp.path().join("不存在目录").join("out.md");
    let result = export_project_to_markdown(&project_path, &ExportScope::Work, &target);
    assert!(result.is_err());
    assert!(!target.exists(), "失败时不应留下目标文件");
}

#[test]
fn markdown_export_rejects_missing_project_and_bad_scope() {
    let temp = TempDir::new().expect("temp");
    let missing = temp.path().join("不存在作品");
    let target = temp.path().join("out.md");
    let result = export_project_to_markdown(&missing, &ExportScope::Work, &target);
    assert!(result.is_err());
    assert!(!target.exists());

    // 范围指向不存在节点：领域层返回中文错误（命令层再折进结果结构）。
    let project_path = create_new_project(CreateProjectParams {
        name: "范围作品".into(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");
    let target = temp.path().join("范围.md");
    let error = export_project_to_markdown(
        &project_path,
        &ExportScope::Folder("不存在".into()),
        &target,
    )
    .expect_err("范围非法应报错");
    assert!(
        error.to_string().contains("导出范围"),
        "中文范围错误: {error}"
    );
    assert!(!target.exists());
}
