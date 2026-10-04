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

/// fix-docx-fidelity-residuals 2.4／4.1（样本级，D-1 基线翻转）：
/// acceptance-complex.docx 重导入——F0FB 补映射后 `symbol_dropped`＝2
/// （仅两个虚构字体）、总字数＝1,141（源侧口径）；P07 符号段逐字符断言：
/// F0FC→U+2714、F0FB→U+1F5F6（Alan Wood 公开表；归档冻结记录 :375–376 的
/// U+2713/U+2717 预期经审计 F01/F03 判定为记录瑕疵，以公开表为准、
/// 不回改冻结清单）；Symbol 006C/F0B7 与 Wingdings F0A7 为对照组不变
/// （样本内 F0B7 属 Symbol 字体→U+2022；U+1F550 为 Wingdings B7 的
/// 修正，与本样本无关）。依据与裁定见 change
/// verification/audit-mapping-verification.md 与
/// archive/2026-10-03-verify-import-fidelity-ui §2.2/§5.1（D-1）。
#[test]
fn acceptance_complex_symbol_count_and_mapping() {
    let (_temp, root) = seed_project("acc 符号基线");
    let (preview, blocks) = full_roundtrip(&root, &fixture_path("acceptance-complex.docx"));

    // D-1 翻转：符号丢弃 3 → 2（仅 UnmappedFont/0047、BogusSymbol/002A）。
    let symbol_dropped = preview
        .losses
        .iter()
        .find(|loss| loss.kind == "symbol_dropped")
        .map(|loss| loss.count);
    assert_eq!(
        symbol_dropped,
        Some(2),
        "F0FB 补映射后仅两个虚构字体符号丢弃"
    );
    // D-1 同根：字数 1,140 → 1,141（FB 不再丢失）。
    assert_eq!(preview.char_count, 1141, "源侧 1,141 字符全保留");

    // P07 符号段逐 run 断言（run 边界＝文本/符号交替）。
    let sym_para = blocks
        .iter()
        .find(|b| block_text(b).contains("SYM01"))
        .expect("SYM01 段");
    let texts: Vec<&str> = sym_para["content"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["text"].as_str().unwrap_or(""))
        .collect();
    let expected_runs = [
        "SYM01 wingdings F0FC then ",
        "\u{2714}", // F0FC → HEAVY CHECK MARK（公开表；冻结 :375 记录瑕疵）
        " then wingdings F0FB then ",
        "\u{1F5F6}", // F0FB → BALLOT BOLD SCRIPT X（F03 补缺；冻结 :376 记录瑕疵）
        " then symbol 006C then ",
        "\u{03BB}", // Symbol 006C → λ（对照组）
        " then symbol F0B7 then ",
        "\u{2022}", // Symbol F0B7 → •（对照组；Symbol 字体的 B7，非 Wingdings B7）
        " then wingdings F0A7 then ",
        "\u{25AA}", // F0A7 → ▪（对照组）
        // 两个虚构符号（UnmappedFont/0047、BogusSymbol/002A）丢弃后不产生
        // 空片段，相邻文本按同 marks canonical 合并为一个片段（丢弃位呈现
        // 双空格）；符号字符 run 因字体选择类别差异（空文本→eastAsia 链）
        // 与拉丁文本 run（ascii 链）marks 不同，各自独立成片段。
        " then unknown unmappedfont 0047 then  then unknown bogussymbol 002A then  SYM01 end",
    ];
    // 未知符号丢弃后相邻文本 run 可能被合并（同 marks canonical 合并），
    // 因此按拼接全文＋关键字符断言，同时钉住每个已知符号字符。
    let joined = texts.concat();
    for (label, ch) in [
        ("F0FC→U+2714", '\u{2714}'),
        ("F0FB→U+1F5F6", '\u{1F5F6}'),
        ("006C→λ", '\u{03BB}'),
        ("F0B7(Symbol)→U+2022", '\u{2022}'),
        ("F0A7→U+25AA", '\u{25AA}'),
    ] {
        assert!(joined.contains(ch), "{label}：拼接文本缺该字符：{joined:?}");
    }
    // 旧错误值不得出现（零错误映射）。
    for wrong in ['\u{2713}', '\u{2717}', '\u{25CF}'] {
        assert!(!joined.contains(wrong), "旧映射值 {wrong:?} 不应出现");
    }
    assert_eq!(
        joined.matches('\u{2714}').count(),
        1,
        "P07 恰一个 F0FC 符号"
    );
    // run 序列形态：已知符号各自成为独立文本片段（含 15 个期望片段的交替结构）。
    let owned: Vec<String> = texts.iter().map(|s| s.to_string()).collect();
    let expected_owned: Vec<String> = expected_runs.iter().map(|s| s.to_string()).collect();
    assert_eq!(owned, expected_owned, "run 边界与文本逐个一致");

    // 4.1／4.2（实测 vs 呈现一致性）：F04（行距子属性合并）与 F05（字体
    // 按字符类别）修复后，本样本不再有静默样式损耗——`style_degraded`
    // 不得出现（零真实样式损耗，未触发不虚报）；完整损耗清单恰为
    // numbering_degraded x5（D-2 冻结基准冲突，范围外、有告知）＋
    // symbol_dropped x2（虚构字体、允许损耗），与预检呈现一一对应。
    let mut kinds: Vec<(String, usize)> = preview
        .losses
        .iter()
        .map(|loss| (loss.kind.clone(), loss.count))
        .collect();
    kinds.sort();
    assert_eq!(
        kinds,
        vec![
            ("numbering_degraded".to_string(), 5),
            ("symbol_dropped".to_string(), 2),
        ],
        "损耗清单与实测一致，无静默项"
    );
}
