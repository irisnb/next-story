//! add-fdx-import 任务 5.2 / 5.3：真实 fixture 端到端＋合成样本测试。
//!
//! - 5.2：storyboarder `test.fdx`（FD Version 3 全套）全量导入——以独立遍历
//!   逻辑对 fixture 全部应导入 Text 求出期望块文字序列，逐块逐字断言；损耗
//!   清单按 fixture 实际内容计数断言（TitlePage/SceneProperties/ScriptNote/
//!   DualDialogue/修订定义）。screenplain 双栏对白最小例断言拆分顺序。
//! - 5.3：合成集数场景头序列拆分正反例；混合格式剧本（标题层级＋缩进＋右对
//!   齐齐套）。
//!
//! 样本来源见 `tests/fixtures/fdx/README.md`（两个 MIT 仓库的真实 FD 生成
//! 测试文件，字节原样入库）。

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
        .join("tests/fixtures/fdx")
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

fn loss_count(preview: &ImportPreview, kind: &str) -> usize {
    preview
        .losses
        .iter()
        .find(|loss| loss.kind == kind)
        .map(|loss| loss.count)
        .unwrap_or(0)
}

// ===== 独立期望计算（oracle）：按与实现相同的产品规则独立遍历 XML =====

struct OracleCounts {
    dual_dialogue: usize,
    titlepage: usize,
    scene_metadata: usize,
    scriptnote: usize,
    revision_marks: usize,
}

/// 独立遍历 fixture 求出期望块文字序列与损耗计数。
/// 规则（与 add-fdx-import design D3 对齐，实现细节刻意不复用导入代码）：
/// - TitlePage 的 Content 段落文字（非空）前置；HeaderAndFooter 跳过；
/// - 正文 Content 直接 Paragraph：Text 子元素拼接（ScriptNote/SceneProperties
///   跳过计数）；Scene Heading 且 Number 非空时加「N 」前缀；
/// - 含 DualDialogue 的包裹段：内部 Character/Dialogue/Parenthetical 段按序
///   展开；包裹段内 ScriptNote 计数；
/// - Revisions 的 Revision 定义计数。
fn expected_blocks_and_counts(xml: &str) -> (Vec<String>, OracleCounts) {
    let doc = roxmltree::Document::parse(xml).expect("oracle parse");
    let root = doc.root_element();
    let mut title_texts: Vec<String> = Vec::new();
    let mut script_texts: Vec<String> = Vec::new();
    let mut counts = OracleCounts {
        dual_dialogue: 0,
        titlepage: 0,
        scene_metadata: 0,
        scriptnote: 0,
        revision_marks: 0,
    };

    /// 段落文字 → 行序列（与实现的行格式规则一致）：按换行拆行；**首行保留
    /// 行首空白**（作者缩进语义，如「  The horse breaks…」），后续行剥除
    /// 行首回声；各行剥除行尾空白；纯空白行丢弃。
    fn paragraph_lines(paragraph: roxmltree::Node) -> Vec<String> {
        let mut joined = String::new();
        for child in paragraph.children() {
            if child.is_element() && child.tag_name().name() == "Text" {
                for piece in child.children() {
                    if piece.is_text() {
                        joined.push_str(piece.text().unwrap_or(""));
                    }
                }
            }
        }
        joined
            .split('\n')
            .enumerate()
            .map(|(index, line)| {
                if index == 0 {
                    line.trim_end()
                } else {
                    line.trim()
                }
            })
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect()
    }

    for child in root.children() {
        if !child.is_element() {
            continue;
        }
        match child.tag_name().name() {
            "TitlePage" => {
                counts.titlepage += 1;
                for content in child.children() {
                    if content.is_element() && content.tag_name().name() == "Content" {
                        for paragraph in content.children() {
                            if paragraph.is_element() && paragraph.tag_name().name() == "Paragraph"
                            {
                                for line in paragraph_lines(paragraph) {
                                    title_texts.push(line);
                                }
                            }
                        }
                    }
                }
            }
            "Content" => {
                for paragraph in child.children() {
                    if !paragraph.is_element() || paragraph.tag_name().name() != "Paragraph" {
                        continue;
                    }
                    let dual = paragraph.children().find(|nested| {
                        nested.is_element() && nested.tag_name().name() == "DualDialogue"
                    });
                    match dual {
                        Some(dual) => {
                            counts.dual_dialogue += 1;
                            for nested in paragraph.children() {
                                if nested.is_element() {
                                    match nested.tag_name().name() {
                                        "ScriptNote" => counts.scriptnote += 1,
                                        "SceneProperties" => counts.scene_metadata += 1,
                                        _ => {}
                                    }
                                }
                            }
                            for inner in dual.children() {
                                if inner.is_element() && inner.tag_name().name() == "Paragraph" {
                                    script_texts.extend(paragraph_lines(inner));
                                }
                            }
                        }
                        None => {
                            for nested in paragraph.children() {
                                if nested.is_element() {
                                    match nested.tag_name().name() {
                                        "ScriptNote" => counts.scriptnote += 1,
                                        "SceneProperties" => counts.scene_metadata += 1,
                                        _ => {}
                                    }
                                }
                            }
                            let lines = paragraph_lines(paragraph);
                            if lines.is_empty() {
                                // 空段落原样保留（作者间距）。
                                script_texts.push(String::new());
                            } else {
                                for (position, line) in lines.into_iter().enumerate() {
                                    let mut line = line;
                                    if position == 0
                                        && paragraph.attribute("Type") == Some("Scene Heading")
                                    {
                                        if let Some(number) = paragraph
                                            .attribute("Number")
                                            .filter(|number| !number.is_empty())
                                        {
                                            line = format!("{number} {line}");
                                        }
                                    }
                                    script_texts.push(line);
                                }
                            }
                        }
                    }
                }
            }
            "Revisions" => {
                for revision in child.children() {
                    if revision.is_element() && revision.tag_name().name() == "Revision" {
                        counts.revision_marks += 1;
                    }
                }
            }
            // 未锚定剧注：与实现一致按剧注计数丢弃。
            "UnanchoredScriptNotes" => {
                for note in child.children() {
                    if note.is_element() && note.tag_name().name() == "ScriptNote" {
                        counts.scriptnote += 1;
                    }
                }
            }
            _ => {}
        }
    }

    title_texts.extend(script_texts);
    (title_texts, counts)
}

fn imported_blocks(root: &Path, doc_id: &str) -> Vec<Value> {
    let notebook = fs::read_to_string(ProjectPaths::new(root.to_path_buf()).document_file(doc_id))
        .expect("read imported notebook");
    let value: Value = serde_json::from_str(&notebook).expect("parse imported notebook");
    validate_notebook_document(&value).expect("导入产物必须通过既有严格语法校验");
    value["document"]["content"].as_array().unwrap().clone()
}

// ===== 5.2：storyboarder 全量导入 =====

#[test]
fn storyboarder_fixture_full_import_verbatim() {
    let xml = fs::read_to_string(fixture_path("storyboarder-test.fdx")).expect("read fixture");
    let (expected_texts, counts) = expected_blocks_and_counts(&xml);
    assert!(
        expected_texts.len() > 400,
        "fixture 期望块数应可观：{}",
        expected_texts.len()
    );

    let (_temp, root) = seed_project("fdx 端到端");
    let file = fixture_path("storyboarder-test.fdx");

    let preview = import_document_preview(&root, &file).expect("预览");
    // generator 印记＝Version＋DocumentType。
    assert_eq!(
        preview.generator.as_deref(),
        Some("FinalDraft Version=3, DocumentType=Script")
    );
    // 损耗清单按 fixture 实际内容计数。
    assert_eq!(loss_count(&preview, "titlepage_inlined"), counts.titlepage);
    assert_eq!(
        loss_count(&preview, "scene_metadata_dropped"),
        counts.scene_metadata
    );
    assert_eq!(
        loss_count(&preview, "scriptnote_dropped"),
        counts.scriptnote
    );
    assert_eq!(
        loss_count(&preview, "dual_dialogue_degraded"),
        counts.dual_dialogue
    );
    assert_eq!(
        loss_count(&preview, "revision_marks_ignored"),
        counts.revision_marks
    );
    // fixture 损耗基数（spike census：TitlePage×1、SceneProperties×30、
    // ScriptNote×14、DualDialogue×1、Revision 定义×19）。
    assert_eq!(counts.titlepage, 1);
    assert_eq!(counts.scene_metadata, 30);
    assert_eq!(counts.scriptnote, 14);
    assert_eq!(counts.dual_dialogue, 1);
    assert_eq!(counts.revision_marks, 19);
    // 场景头不是短序列标记：无拆分建议。
    assert!(preview.split_suggestion.is_none());
    // 字数＝期望块文字字符总和（逐字）。
    let expected_chars: usize = expected_texts.iter().map(|t| t.chars().count()).sum();
    assert_eq!(preview.char_count, expected_chars);
    assert_eq!(preview.paragraph_count, expected_texts.len());

    // 提交落盘，逐块逐字对照。
    let commit =
        import_document_commit(&root, &file, None, false, &preview.content_hash).expect("提交");
    assert_eq!(commit.created_doc_ids.len(), 1);
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);
    assert_eq!(blocks.len(), expected_texts.len());
    let actual_texts: Vec<String> = blocks.iter().map(block_text).collect();
    for (index, (actual, expected)) in actual_texts.iter().zip(&expected_texts).enumerate() {
        assert_eq!(actual, expected, "第 {index} 块文字必须逐字一致");
    }

    // 首块是标题页并入文字，随后场景头成二级标题（含编号前缀）。
    assert_eq!(blocks[0]["type"], "paragraph");
    assert_eq!(actual_texts[0], "FARMLAND");
    let heading = blocks
        .iter()
        .find(|b| b["type"] == "heading")
        .expect("存在场景头标题");
    assert_eq!(heading["attrs"]["level"], 2);
    assert!(
        block_text(heading).starts_with("123 EXT"),
        "首个场景头带编号前缀：{}",
        block_text(heading)
    );

    // 缩进保真（ElementSettings 权威布局，基准 Action L1.50 R7.50）：
    // 锚点文本取自 fixture 实际段落，按类型核对编辑器单位等值属性。
    let block_with = |text: &str| -> &Value {
        blocks
            .iter()
            .find(|b| block_text(b) == text)
            .unwrap_or_else(|| panic!("fixture 应含块「{text}」"))
    };
    // Dialogue L2.50 R6.00 → +1.00"=72pt；右收窄 +1.50"=108pt。
    let dialogue = block_with("Was it like this with me?");
    assert_eq!(dialogue["attrs"]["indentLeft"], "72pt");
    assert_eq!(dialogue["attrs"]["indentRight"], "108pt");
    // Parenthetical L3.00 R5.50 → +1.50"=108pt；右收窄 +2.00"=144pt。
    let parenthetical = block_with("(confused)");
    assert_eq!(parenthetical["attrs"]["indentLeft"], "108pt");
    assert_eq!(parenthetical["attrs"]["indentRight"], "144pt");
    // Character L3.50 R7.25 → +2.00"=144pt；右收窄 +0.25"=18pt。
    let character = block_with("WaLTER");
    assert_eq!(character["attrs"]["indentLeft"], "144pt");
    assert_eq!(character["attrs"]["indentRight"], "18pt");
    // Transition Alignment=Right：右对齐；页面几何缩进（L5.50）不搬运。
    let transition = block_with("FADE OUT.");
    assert_eq!(transition["attrs"]["textAlign"], "right");
    assert!(transition["attrs"].get("indentLeft").is_none());
    assert!(transition["attrs"].get("indentRight").is_none());
}

// ===== 5.2：screenplain 双栏对白拆分顺序 =====

#[test]
fn screenplain_dual_dialogue_order_preserved() {
    let (_temp, root) = seed_project("fdx 双栏");
    let file = fixture_path("screenplain-dual-dialogue.fdx");

    let preview = import_document_preview(&root, &file).expect("预览");
    assert_eq!(
        preview.generator.as_deref(),
        Some("FinalDraft Version=1, DocumentType=Script")
    );
    assert_eq!(loss_count(&preview, "dual_dialogue_degraded"), 1);
    assert!(preview
        .losses
        .iter()
        .all(|loss| loss.kind == "dual_dialogue_degraded"));

    let commit =
        import_document_commit(&root, &file, None, false, &preview.content_hash).expect("提交");
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    // 先后两组：GIRL→Hey!→GUY→Hello!，Character/Dialogue 缩进档生效。
    assert_eq!(texts, vec!["GIRL", "Hey!", "GUY", "Hello!"]);
    // 无 ElementSettings（V1 极简样本）→ 回退固定档：Dialogue 浅 2em、
    // Character 深 4em（1:1.5:2 顺序的回退端）。
    assert_eq!(blocks[0]["attrs"]["indentLeft"], "4em");
    assert_eq!(blocks[1]["attrs"]["indentLeft"], "2em");
    assert_eq!(blocks[2]["attrs"]["indentLeft"], "4em");
    assert_eq!(blocks[3]["attrs"]["indentLeft"], "2em");
    assert_eq!(preview.char_count, "GIRLHey!GUYHello!".chars().count());
}

// ===== 5.3：合成样本 =====

/// 集数场景头序列：≥3 触发拆分建议并按边界拆分；不足不触发。
#[test]
fn synthetic_episode_scene_headings_split_roundtrip() {
    let (temp, root) = seed_project("fdx 拆分");
    let mut body = String::new();
    for episode in 1..=3 {
        body.push_str(&format!(
            r#"<Paragraph Type="Scene Heading"><Text>第{episode}集</Text></Paragraph><Paragraph Type="Action"><Text>第{episode}集正文。</Text></Paragraph>"#
        ));
    }
    let source = format!(
        r#"<FinalDraft DocumentType="Script" Version="1"><Content>{body}</Content></FinalDraft>"#
    );
    let file = temp.path().join("集数剧本.fdx");
    fs::write(&file, source).unwrap();

    let preview = import_document_preview(&root, &file).expect("预览");
    let suggestion = preview.split_suggestion.expect("3 个集数场景头应建议拆分");
    assert_eq!(suggestion.marker_sample, "第X集");
    assert_eq!(suggestion.doc_names, vec!["第1集", "第2集", "第3集"]);

    let commit =
        import_document_commit(&root, &file, None, true, &preview.content_hash).expect("拆分提交");
    assert_eq!(commit.created_doc_ids.len(), 3);
    let folder = commit.created_folder_id.expect("拆分建文件夹");
    let tree = project::recover_then_read_content_tree(&root).unwrap();
    assert_eq!(tree.nodes[&folder].name, "集数剧本");
    for (index, doc_id) in commit.created_doc_ids.iter().enumerate() {
        let blocks = imported_blocks(&root, doc_id);
        let texts: Vec<String> = blocks.iter().map(block_text).collect();
        assert_eq!(
            texts,
            vec![
                format!("第{}集", index + 1),
                format!("第{}集正文。", index + 1)
            ]
        );
    }

    // 反例：不足 3 个不触发。
    let sparse = r#"<FinalDraft DocumentType="Script" Version="1"><Content><Paragraph Type="Scene Heading"><Text>第1集</Text></Paragraph><Paragraph Type="Scene Heading"><Text>第2集</Text></Paragraph></Content></FinalDraft>"#;
    let sparse_file = temp.path().join("稀疏.fdx");
    fs::write(&sparse_file, sparse).unwrap();
    let preview = import_document_preview(&root, &sparse_file).expect("预览");
    assert!(preview.split_suggestion.is_none());
}

/// 混合格式剧本：标题层级（New Act/Scene Heading/Outline）＋缩进档＋右对齐
/// ＋样式词组齐套，全部结构落盘保留。
#[test]
fn synthetic_mixed_script_layouts_preserved() {
    let source = r#"<FinalDraft DocumentType="Script" Version="3"><Content><Paragraph Type="New Act"><Text>第一幕</Text></Paragraph><Paragraph Number="4" Type="Scene Heading"><Text>内景 客厅—夜</Text></Paragraph><Paragraph Type="Outline 2"><Text>幕中大纲</Text></Paragraph><Paragraph Type="Action"><Text Style="Bold">黑体动作。</Text></Paragraph><Paragraph Type="Character"><Text>老人</Text></Paragraph><Paragraph Type="Parenthetical"><Text>（叹息）</Text></Paragraph><Paragraph Type="Dialogue"><Text Style="Italic+Underline">都过去了。</Text></Paragraph><Paragraph Type="Transition"><Text>FADE OUT.</Text></Paragraph></Content></FinalDraft>"#;
    let (temp, root) = seed_project("fdx 混合");
    let file = temp.path().join("混合剧本.fdx");
    fs::write(&file, source).unwrap();

    let preview = import_document_preview(&root, &file).expect("预览");
    assert!(
        preview.losses.is_empty(),
        "混合样本无结构性损耗：{:?}",
        preview.losses
    );
    let commit =
        import_document_commit(&root, &file, None, false, &preview.content_hash).expect("提交");
    let blocks = imported_blocks(&root, &commit.created_doc_ids[0]);

    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(
        texts,
        vec![
            "第一幕",
            "4 内景 客厅—夜",
            "幕中大纲",
            "黑体动作。",
            "老人",
            "（叹息）",
            "都过去了。",
            "FADE OUT.",
        ]
    );
    assert_eq!(blocks[0]["attrs"]["level"], 1);
    assert_eq!(blocks[1]["attrs"]["level"], 2);
    assert_eq!(blocks[2]["attrs"]["level"], 2, "Outline 2 → 二级");
    assert!(blocks[3].get("attrs").is_none());
    // 无 ElementSettings → 回退固定档（Dialogue 2em／Parenthetical 3em／
    // Character 4em）。
    assert_eq!(blocks[4]["attrs"]["indentLeft"], "4em", "Character 深档");
    assert_eq!(
        blocks[5]["attrs"]["indentLeft"], "3em",
        "Parenthetical 中档"
    );
    assert_eq!(blocks[6]["attrs"]["indentLeft"], "2em", "Dialogue 浅档");
    assert_eq!(blocks[7]["attrs"]["textAlign"], "right");
    // 样式词组：Bold→bold；Italic+Underline→[italic, underline]。
    assert_eq!(blocks[3]["content"][0]["marks"][0]["type"], "bold");
    let dialogue_marks: Vec<&str> = blocks[6]["content"][0]["marks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["type"].as_str().unwrap())
        .collect();
    assert_eq!(dialogue_marks, vec!["italic", "underline"]);
}

/// 既有文档在导入后不变（逐字节）。
#[test]
fn existing_documents_untouched_after_fdx_import() {
    let (_temp, root) = seed_project("fdx 隔离");
    let tree = project::recover_then_read_content_tree(&root).unwrap();
    let existing = tree.root_children[0].clone();
    let before =
        fs::read_to_string(ProjectPaths::new(root.clone()).document_file(&existing)).unwrap();

    let file = fixture_path("screenplain-dual-dialogue.fdx");
    let preview = import_document_preview(&root, &file).expect("预览");
    import_document_commit(&root, &file, None, false, &preview.content_hash).expect("提交");

    let after =
        fs::read_to_string(ProjectPaths::new(root.clone()).document_file(&existing)).unwrap();
    assert_eq!(before, after, "既有文档正文逐字节不变");
}

// ===== B：边角集样本（MIT screenplain 测试文件，入库 fixtures/fdx/edge/） =====

fn edge_fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/fdx/edge")
        .join(name)
}

/// 通用端到端：预检＋提交＋严格校验，返回（preview, blocks）。
fn full_roundtrip(root: &Path, file: &Path) -> (ImportPreview, Vec<Value>) {
    let preview = import_document_preview(root, file).expect("预检");
    let commit =
        import_document_commit(root, file, None, false, &preview.content_hash).expect("提交");
    let blocks = imported_blocks(root, &commit.created_doc_ids[0]);
    (preview, blocks)
}

/// utf-8-bom.fdx：screenplain 的该测试文件实际入库字节并无 BOM（首字节即
/// `<?xm`）；为驱动 BOM 剥离路径，测试前置 `EF BB BF` 生成副本再导入，
/// 断言首块文字不含 U+FEFF。原样 fixture 本身也应正常导入。
#[test]
fn edge_utf8_bom_fixture_parses_with_bom_stripped() {
    let (temp, root) = seed_project("edge bom");
    let original = edge_fixture_path("utf-8-bom.fdx");

    // 原样导入。
    let (preview, blocks) = full_roundtrip(&root, &original);
    assert_eq!(preview.paragraph_count, blocks.len());
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(texts[0], "EXT. SOMEWHERE - DAY", "首块是场景头：{texts:?}");
    // 多 Text 段内的换行拆段。
    assert!(
        texts.contains(&"It's a sunny day.".to_string())
            && texts.contains(&"Sunnier than normal.".to_string())
            && texts.contains(&"Too sunny to be funny.".to_string()),
        "三行 Action 拆段：{texts:?}"
    );

    // BOM 副本：走剥离路径，正文无 BOM 字符。
    let mut with_bom = vec![0xEF, 0xBB, 0xBF];
    with_bom.extend(fs::read(&original).unwrap());
    let bom_copy = temp.path().join("带BOM副本.fdx");
    fs::write(&bom_copy, &with_bom).unwrap();
    let (preview_bom, blocks_bom) = full_roundtrip(&root, &bom_copy);
    assert_eq!(preview_bom.char_count, preview.char_count, "BOM 不计入字数");
    for block in &blocks_bom {
        let text = block_text(block);
        assert!(
            !text.contains('\u{feff}'),
            "正文不得残留 BOM 字符：{text:?}"
        );
    }
}

/// indentation.fdx：Text 前导空格是作者缩进语义（非 XML 回声），逐字保留。
#[test]
fn edge_indentation_leading_spaces_preserved() {
    let (_temp, root) = seed_project("edge indentation");
    let (preview, blocks) = full_roundtrip(&root, &edge_fixture_path("indentation.fdx"));
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(
        texts,
        vec![
            "EXT. INDENTATION TEST",
            "    Four spaces",
            "   Three spaces",
            "  Two spaces",
            " One space",
            "No spaces",
        ]
    );
    // 前导空格计入字数（逐字）。
    let expected: usize = texts.iter().map(|t| t.chars().count()).sum();
    assert_eq!(preview.char_count, expected);
    // 场景头成二级标题。
    assert_eq!(blocks[0]["type"], "heading");
    assert_eq!(blocks[0]["attrs"]["level"], 2);
}

/// extended-characters.fdx：多语种文本（日/俄/中/韩/阿拉伯）逐字保留。
#[test]
fn edge_extended_characters_preserved() {
    let (_temp, root) = seed_project("edge chars");
    let (_preview, blocks) = full_roundtrip(&root, &edge_fixture_path("extended-characters.fdx"));
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(
        texts,
        vec!["Hello", "こんにちは", "привет", "你好", "안녕하세요", "أهلا"]
    );
}

/// parenthetical.fdx：无 ElementSettings → 回退固定档三类顺序。
#[test]
fn edge_parenthetical_fallback_tiers() {
    let (_temp, root) = seed_project("edge parenthetical");
    let (preview, blocks) = full_roundtrip(&root, &edge_fixture_path("parenthetical.fdx"));
    assert!(
        preview.losses.is_empty(),
        "无结构性损耗：{:?}",
        preview.losses
    );
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(texts, vec!["JOHN DOE", "(screaming)", "Hello!!!"]);
    assert_eq!(blocks[0]["attrs"]["indentLeft"], "4em", "Character 深档");
    assert_eq!(
        blocks[1]["attrs"]["indentLeft"], "3em",
        "Parenthetical 中档"
    );
    assert_eq!(blocks[2]["attrs"]["indentLeft"], "2em", "Dialogue 浅档");
}

/// forced-action.fdx：Text 尾换行强制分段，两行成为相邻段落。
#[test]
fn edge_forced_action_splits_lines() {
    let (_temp, root) = seed_project("edge forced");
    let (_preview, blocks) = full_roundtrip(&root, &edge_fixture_path("forced-action.fdx"));
    let texts: Vec<String> = blocks.iter().map(block_text).collect();
    assert_eq!(
        texts,
        vec!["THIS IS FORCED ACTION", "This is another line of action!"]
    );
}
