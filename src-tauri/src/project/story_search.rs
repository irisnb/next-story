//! 阶段五 A 部分：后端确定性跨文档字面检索（change: add-automatic-story-context）。
//!
//! 候选词只从本轮用户新增问题文本确定性提取，不调用模型、不从作品反向抽词；
//! 检索范围限定为同作品、非回收站、从根可达（可见）、允许 AI 查看、已保存正文的
//! 文档，并排除关注文档以免与现场材料重复。搜索只在正文纯文本中进行，标题
//! （文档名）不作为候选词来源或命中来源，只用于来源显示。
//!
//! 所有数值均为内部初始值，需真实效果验证，非产品效果保证；这些数值是检索输出
//! 的硬上限，不是模型上下文上限（模型上下文上限由本轮材料预算决定，见设计
//! 「超限诚实处理」决策）。
//!
//! 本模块是只读自由函数：不获取作品写入权限，绝不向作品写入任何字节。

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use super::operations::read_and_validate_notebook;
use super::story_material::compute_version;
use super::{
    ContentTree, ContentTreeNode, DirectoryProjection, MaterialDenial, MaterialDenialReason,
    MaterialSnapshot, NodeKind, ProjectPaths, ProjectedNode, ReadMaterialRequest, StoryMaterial,
};

/// 候选词上限（内部初始值）。
pub const MAX_CANDIDATE_TERMS: usize = 8;
/// 命中片段结果上限：最多返回这么多篇文档的命中。
pub const MAX_RESULT_DOCS: usize = 5;
/// 命中片段结果上限：最多返回这么多条片段。
pub const MAX_RESULT_SNIPPETS: usize = 10;
/// 每个命中片段前后保留的 Unicode 字符数（内部初始值）。
pub const SNIPPET_CONTEXT_CHARS: usize = 120;
/// 候选词最少 Unicode 字符数。
const MIN_TERM_CHARS: usize = 2;

/// 检索结果状态：不是正文或材料内容，只用于记录本轮检索发生了什么。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchStatus {
    /// 本轮问题无可提取候选词（no_query_terms）。
    NoQueryTerms,
    /// 有候选词但未在允许读取的文档正文中命中（not_found）。
    NotFound,
    /// 至少命中一条片段。
    Hit,
}

/// 候选词提取结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateTerms {
    /// 按首次出现顺序去重后的候选词（至多 [`MAX_CANDIDATE_TERMS`] 个）。
    pub terms: Vec<String>,
    /// 去重后候选词数超过 [`MAX_CANDIDATE_TERMS`] 被截断时为 true（本次提取受限）。
    pub limited: bool,
}

/// 单个命中片段。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchSnippet {
    /// 来源文档稳定 ID。
    pub document_id: String,
    /// 来源文档名（仅用于来源显示，不作为命中来源）。
    pub document_name: String,
    /// 来源文档版本身份（内容派生散列）。
    pub version: String,
    /// 命中片段文本（命中前后各 [`SNIPPET_CONTEXT_CHARS`] 个 Unicode 字符，重叠合并）。
    pub snippet: String,
    /// 命中该片段的候选词（规范化形式）。
    pub matched_term: String,
    /// 片段在原文中的起始字符索引（含）。
    pub start: usize,
    /// 片段在原文中的结束字符索引（不含）。
    pub end: usize,
}

/// 跨文档字面检索结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchResult {
    pub status: SearchStatus,
    pub snippets: Vec<SearchSnippet>,
    /// 达到候选词 / 文档 / 片段任一硬上限时为 true（本次检索受限，非全量检索）。
    pub limited: bool,
}

/// 规范化后的文本：`chars` 为规范化字符序列，`orig[i]` 为 `chars[i]` 对应的
/// 原文字符索引（用于把命中位置回映射到原文）。
struct NormalizedText {
    chars: Vec<char>,
    orig: Vec<usize>,
}

/// 单字符规范化：Unicode NFKC（兼容分解，宽度折叠 / 连字 / 上下标 / 圈号等）后统一
/// 转小写。每个规范化字符都映射回同一原文字符索引（保留到原文的位置映射）。
fn fold_char(ch: char) -> Vec<char> {
    ch.nfkc().flat_map(|c| c.to_lowercase()).collect()
}

/// 规范化文本并保留到原文的字符位置映射，连续空白折叠为单个空格。
fn normalize_text(text: &str) -> NormalizedText {
    let original: Vec<char> = text.chars().collect();
    let mut chars: Vec<char> = Vec::new();
    let mut orig: Vec<usize> = Vec::new();
    let mut prev_space = false;
    for (i, ch) in original.iter().enumerate() {
        for folded in fold_char(*ch) {
            if folded.is_whitespace() {
                if prev_space {
                    continue;
                }
                prev_space = true;
            } else {
                prev_space = false;
            }
            chars.push(folded);
            orig.push(i);
        }
    }
    NormalizedText { chars, orig }
}

fn is_han(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
    )
}

fn is_latin_alnum(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
}

/// 从本轮用户新增问题文本确定性提取候选词：中文连续片段按原样抽取（不做中文
/// 分词 / 实体识别，整段中文可能漏检，不承诺中文分词），拉丁字母 / 数字连续片段；
/// 每个片段至少 [`MIN_TERM_CHARS`] 个 Unicode 字符；去重按首次出现顺序，至多
/// [`MAX_CANDIDATE_TERMS`] 个。不调用模型、不从作品反向抽词。
pub fn extract_candidate_terms(question: &str) -> CandidateTerms {
    let norm = normalize_text(question);
    let chars = &norm.chars;
    let mut terms: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        let is_han_run = is_han(ch);
        let is_latin_run = is_latin_alnum(ch);
        if !is_han_run && !is_latin_run {
            i += 1;
            continue;
        }
        let mut end = i + 1;
        while end < chars.len() {
            let next = chars[end];
            if (is_han_run && is_han(next)) || (is_latin_run && is_latin_alnum(next)) {
                end += 1;
            } else {
                break;
            }
        }
        if end - i >= MIN_TERM_CHARS {
            let term: String = chars[i..end].iter().collect();
            if seen.insert(term.clone()) && terms.len() < MAX_CANDIDATE_TERMS {
                terms.push(term);
            }
        }
        i = end;
    }
    let limited = seen.len() > MAX_CANDIDATE_TERMS;
    CandidateTerms { terms, limited }
}

/// 从结构化本子 JSON 中按文档顺序抽取纯文本（正文），供字面检索使用。
/// 只收集 `type == "text"` 节点的 `text` 字段，标题（文档名）不在此函数内。
pub fn extract_plain_text(value: &serde_json::Value) -> String {
    let mut out = String::new();
    collect_text(value, &mut out);
    out
}

fn collect_text(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("type").and_then(|v| v.as_str()) == Some("text") {
                if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
                    out.push_str(text);
                }
            }
            for child in map.values() {
                collect_text(child, out);
            }
        }
        serde_json::Value::Array(arr) => {
            for child in arr {
                collect_text(child, out);
            }
        }
        _ => {}
    }
}

/// 在规范化正文中找出 `term` 的全部命中，映射回原文字符区间并追加到 `out`。
fn find_hits(
    norm: &NormalizedText,
    term: &str,
    term_idx: usize,
    out: &mut Vec<(usize, usize, usize)>,
) {
    let term_chars: Vec<char> = term.chars().collect();
    let n = norm.chars.len();
    let m = term_chars.len();
    if m == 0 || m > n {
        return;
    }
    let mut i = 0;
    while i + m <= n {
        if &norm.chars[i..i + m] == &term_chars[..] {
            let start_orig = norm.orig[i];
            let end_orig = norm.orig[i + m - 1] + 1;
            out.push((start_orig, end_orig, term_idx));
        }
        i += 1;
    }
}

/// 从根可达（可见）、非回收站、文档类型、允许 AI 查看、且非关注文档的节点，按树
/// 顺序（深度优先）返回。游离节点（在 nodes 中但不可达）与隐藏/回收站节点天然被排除。
fn visible_documents<'a>(tree: &'a ContentTree, focus_id: &str) -> Vec<&'a ContentTreeNode> {
    let mut result = Vec::new();
    let mut stack: Vec<&str> = tree
        .root_children
        .iter()
        .map(String::as_str)
        .rev()
        .collect();
    while let Some(id) = stack.pop() {
        let Some(node) = tree.nodes.get(id) else {
            continue;
        };
        match node.kind {
            NodeKind::Document => {
                if node.ai_visible && node.id != focus_id {
                    result.push(node);
                }
            }
            NodeKind::Folder => {
                for child in node.children.iter().rev() {
                    stack.push(child.as_str());
                }
            }
        }
    }
    result
}

/// 跨文档字面检索纯函数：在允许读取的文档正文中按候选词搜索，返回带来源身份、
/// 版本与位置的命中片段。`read_body` 按节点返回已保存正文的原始 JSON 字符串；
/// 读取失败跳过该文档（不返回其内容）。
pub fn search_documents(
    tree: &ContentTree,
    focus_document_id: &str,
    question: &str,
    read_body: &impl Fn(&ContentTreeNode) -> Result<String, MaterialDenial>,
) -> SearchResult {
    let candidate = extract_candidate_terms(question);
    if candidate.terms.is_empty() {
        return SearchResult {
            status: SearchStatus::NoQueryTerms,
            snippets: Vec::new(),
            limited: false,
        };
    }

    let mut snippets: Vec<SearchSnippet> = Vec::new();
    let mut docs_visited = 0usize;
    let mut docs_limited = false;
    let mut snippets_limited = false;

    for node in visible_documents(tree, focus_document_id) {
        if docs_visited >= MAX_RESULT_DOCS {
            docs_limited = true;
            break;
        }
        docs_visited += 1;

        let content = match read_body(node) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let plain = extract_plain_text(&value);
        let version = compute_version(&content);
        let original: Vec<char> = plain.chars().collect();
        let norm = normalize_text(&plain);

        let mut hits: Vec<(usize, usize, usize)> = Vec::new();
        for (term_idx, term) in candidate.terms.iter().enumerate() {
            find_hits(&norm, term, term_idx, &mut hits);
        }
        if hits.is_empty() {
            continue;
        }
        hits.sort_unstable_by_key(|(start, end, _)| (*start, *end));

        // 扩展为前后 SNIPPET_CONTEXT_CHARS 的窗口并合并重叠/相邻窗口。
        let mut windows: Vec<(usize, usize, usize)> = Vec::new();
        for (start, end, term_idx) in hits {
            let ws = start.saturating_sub(SNIPPET_CONTEXT_CHARS);
            let we = (end + SNIPPET_CONTEXT_CHARS).min(original.len());
            if let Some(last) = windows.last_mut() {
                if ws <= last.1 {
                    last.1 = last.1.max(we);
                    continue;
                }
            }
            windows.push((ws, we, term_idx));
        }

        for (ws, we, term_idx) in windows {
            if snippets.len() >= MAX_RESULT_SNIPPETS {
                snippets_limited = true;
                break;
            }
            snippets.push(SearchSnippet {
                document_id: node.id.clone(),
                document_name: node.name.clone(),
                version: version.clone(),
                snippet: original[ws..we].iter().collect(),
                matched_term: candidate.terms[term_idx].clone(),
                start: ws,
                end: we,
            });
        }
    }

    let status = if snippets.is_empty() {
        SearchStatus::NotFound
    } else {
        SearchStatus::Hit
    };
    let limited = candidate.limited || docs_limited || snippets_limited;
    SearchResult {
        status,
        snippets,
        limited,
    }
}

/// 磁盘入口：打开作品内容树后执行跨文档字面检索（供命令层调用）。
pub fn search_project(
    project_root: &Path,
    focus_document_id: &str,
    question: &str,
) -> Result<SearchResult, MaterialDenial> {
    let canonical = project_root
        .canonicalize()
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::WorkMismatch))?;
    let tree = super::open_content_tree(&canonical)
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))?;
    let paths = ProjectPaths::new(canonical);
    Ok(search_documents(
        &tree,
        focus_document_id,
        question,
        &|node| {
            read_and_validate_notebook(&paths.document_file(&node.id), &node.name)
                .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))
        },
    ))
}

/// 一条最小出处元数据（不存全文）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextProvenance {
    pub document_id: String,
    /// `focus_document`（关注文档现场材料）或 `search_snippet`（跨文档检索命中片段）。
    pub material_type: String,
    pub version: String,
    /// 仅 `search_snippet` 有值：命中的候选词。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_term: Option<String>,
    /// 关注文档现场材料是否来自发送时刻的未保存快照（仅 `focus_document` 有值；
    /// `false` 表示使用已保存正文）。用于「本次参考了什么」如实标注未保存状态。
    #[serde(default)]
    pub from_unsaved_snapshot: bool,
    /// 本轮跨文档检索结果状态（`hit` / `not_found` / `no_query_terms`）。
    /// 作为该轮检索汇总记录，仅挂在 `focus_document` 条目上；无关注文档取材时为 `None`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_status: Option<String>,
    /// 本轮检索是否达到输出硬上限（本次检索受限，非全量检索）。
    /// 与 `search_status` 一起挂在 `focus_document` 条目上。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_limited: Option<bool>,
}

/// 检索状态的中文/稳定标签（`hit` / `not_found` / `no_query_terms`）。
fn search_status_label(status: SearchStatus) -> &'static str {
    match status {
        SearchStatus::Hit => "hit",
        SearchStatus::NotFound => "not_found",
        SearchStatus::NoQueryTerms => "no_query_terms",
    }
}

/// 一轮常规讨论的取材结果：注入 DSH task 的语境文本 + 最小出处元数据。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoundContext {
    /// 注入 DSH task 的语境文本（关注文档正文 + 目录投影 + 检索片段）。
    pub context_text: String,
    /// 最小出处元数据（不复制正文）。
    pub provenance: Vec<ContextProvenance>,
    /// 检索结果状态（no_query_terms / not_found / hit）。
    pub search_status: SearchStatus,
    /// 检索是否达到硬上限（本次检索受限，非全量检索）。
    pub search_limited: bool,
}

/// 把关注文档现场材料、目录投影与检索片段组装成注入 DSH task 的语境文本（纯函数）。
/// 材料描述明确标注为「候选参考」，不冒充作品事实。
pub fn compose_context_text(
    focus: Option<&StoryMaterial>,
    directory: &DirectoryProjection,
    search: &SearchResult,
) -> String {
    let mut text = String::new();
    if let Some(focus) = focus {
        text.push_str(&format!(
            "关注文档《{}》正文：\n{}",
            focus.document_name, focus.content
        ));
    }
    let mut names: Vec<String> = Vec::new();
    collect_projected_names(&directory.root_children, &mut names);
    if !names.is_empty() {
        text.push_str("\n\n作品可见文档目录（只用于了解结构，不是全部正文）：");
        for name in names {
            text.push_str(&format!("\n- {name}"));
        }
        if directory.hidden_count > 0 {
            text.push_str(&format!(
                "\n（另有 {} 份文件已隐藏）",
                directory.hidden_count
            ));
        }
    }
    if search.status == SearchStatus::Hit {
        text.push_str("\n\n相关片段（候选参考，不是作品事实，也不是判断依据）：");
        for snippet in &search.snippets {
            text.push_str(&format!(
                "\n- 《{}》：{}",
                snippet.document_name, snippet.snippet
            ));
        }
    }
    text
}

fn collect_projected_names(nodes: &[ProjectedNode], out: &mut Vec<String>) {
    for node in nodes {
        if node.kind == NodeKind::Document {
            out.push(node.name.clone());
        }
        collect_projected_names(&node.children, out);
    }
}

fn build_provenance(
    focus: Option<&StoryMaterial>,
    search: &SearchResult,
    focus_from_snapshot: bool,
) -> Vec<ContextProvenance> {
    let mut out = Vec::new();
    if let Some(focus) = focus {
        out.push(ContextProvenance {
            document_id: focus.document_id.clone(),
            material_type: "focus_document".to_string(),
            version: focus.version.clone(),
            matched_term: None,
            from_unsaved_snapshot: focus_from_snapshot,
            // 本轮检索汇总挂在关注文档条目上：只存状态，不存任何正文。
            search_status: Some(search_status_label(search.status).to_string()),
            search_limited: Some(search.limited),
        });
    }
    for snippet in &search.snippets {
        out.push(ContextProvenance {
            document_id: snippet.document_id.clone(),
            material_type: "search_snippet".to_string(),
            version: snippet.version.clone(),
            matched_term: Some(snippet.matched_term.clone()),
            from_unsaved_snapshot: false,
            search_status: None,
            search_limited: None,
        });
    }
    out
}

/// 磁盘入口：为常规讨论的一轮请求组装关注文档现场材料 + 目录投影 + 跨文档检索片段。
///
/// - 关注文档按 [`super::read_material`] 读取（已保存正文，或经校验的未保存快照）；
///   读取失败（快照身份非法 / 文档不可见 / 版本不可用）时失败关闭，绝不静默回退。
/// - 目录投影与检索只覆盖允许读取的范围；检索本身不失败（隐藏/回收站文档被跳过）。
/// - 返回的 `context_text` 供 DSH task 注入，`provenance` 只存最小元数据（不复制正文）。
pub fn assemble_round_context(
    project_root: &Path,
    focus_document_id: &str,
    focus_document_version: Option<&str>,
    focus_snapshot: Option<&str>,
    question: &str,
) -> Result<RoundContext, MaterialDenial> {
    let canonical = project_root
        .canonicalize()
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::WorkMismatch))?;
    let work_id = canonical.to_string_lossy().to_string();
    let tree = super::open_content_tree(&canonical)
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))?;
    let paths = ProjectPaths::new(canonical);

    let focus_request = ReadMaterialRequest {
        work_id: work_id.clone(),
        document_id: focus_document_id.to_string(),
        range: None,
        expected_version: focus_document_version.map(str::to_string),
        snapshot: focus_snapshot.map(|content| MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: focus_document_id.to_string(),
            version: focus_document_version.unwrap_or("").to_string(),
            content: content.to_string(),
        }),
    };
    let focus = super::read_material(project_root, &focus_request)?;

    let directory = super::project_directory(&tree);

    let search = search_documents(&tree, focus_document_id, question, &|node| {
        read_and_validate_notebook(&paths.document_file(&node.id), &node.name)
            .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))
    });

    Ok(RoundContext {
        context_text: compose_context_text(Some(&focus), &directory, &search),
        provenance: build_provenance(Some(&focus), &search, focus_snapshot.is_some()),
        search_status: search.status,
        search_limited: search.limited,
    })
}

#[cfg(test)]
mod tests {
    use super::super::MaterialRange;
    use super::*;
    use std::collections::HashMap;

    fn notebook_with_text(text: &str) -> String {
        serde_json::to_string(&serde_json::json!({
            "format": "next-story-tiptap",
            "version": 2,
            "document": {
                "type": "doc",
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
            }
        }))
        .unwrap()
    }

    fn tree_with_document(name: &str, ai_visible: bool) -> (ContentTree, String) {
        let mut tree = ContentTree::new();
        let id = tree.create_document(None).unwrap();
        tree.rename(&id, name).unwrap();
        if !ai_visible {
            tree.set_ai_visibility(&id, false).unwrap();
        }
        (tree, id)
    }

    fn reader<'a>(
        bodies: &'a HashMap<String, String>,
    ) -> impl Fn(&ContentTreeNode) -> Result<String, MaterialDenial> + 'a {
        move |node| {
            bodies
                .get(&node.id)
                .cloned()
                .ok_or_else(|| MaterialDenial::new(MaterialDenialReason::DocumentMissing))
        }
    }

    // ========== 候选词提取 ==========

    #[test]
    fn candidate_extraction_extracts_chinese_and_latin_segments() {
        let result = extract_candidate_terms("角色 林晓 去了ABC城市");
        // 中文连续片段："角色"、"林晓"、"去了"；拉丁字母数字："abc"、"城市"（城市是中文）。
        // 实际序列：角色 / 林晓 / 去了 / ABC(->abc) / 城市
        let terms: Vec<&str> = result.terms.iter().map(String::as_str).collect();
        assert!(terms.contains(&"角色"));
        assert!(terms.contains(&"林晓"));
        assert!(terms.contains(&"abc"));
    }

    #[test]
    fn candidate_extraction_skips_single_char_segments() {
        let result = extract_candidate_terms("a 林 b");
        assert!(!result
            .terms
            .iter()
            .any(|t| t == "a" || t == "b" || t == "林"));
    }

    #[test]
    fn candidate_extraction_dedups_by_first_appearance() {
        let result = extract_candidate_terms("角色，角色");
        assert_eq!(result.terms, vec!["角色".to_string()]);
        assert!(!result.limited);
    }

    #[test]
    fn candidate_extraction_caps_at_eight_terms() {
        let question = "aa bb cc dd ee ff gg hh ii jj";
        let result = extract_candidate_terms(question);
        assert_eq!(result.terms.len(), MAX_CANDIDATE_TERMS);
        assert!(result.limited, "超过 8 个候选词必须记录受限");
    }

    #[test]
    fn candidate_extraction_folds_fullwidth_and_case() {
        let result = extract_candidate_terms("ＡＢＣ abc");
        // 全角 "ＡＢＣ" 折叠为半角 "abc"，与后续 "abc" 去重。
        assert_eq!(result.terms, vec!["abc".to_string()]);
    }

    #[test]
    fn nfkc_folds_ligature_into_latin_segment() {
        // 连字 ﬁ（U+FB01）经 NFKC 折叠为 "fi"，命中正文中的 "fine"。
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let other = tree.create_document(None).unwrap();
        tree.rename(&other, "设定").unwrap();
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        bodies.insert(other.clone(), notebook_with_text("contains the word fine."));
        let result = search_documents(&tree, &focus, "\u{FB01}", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::Hit);
        assert_eq!(result.snippets[0].document_id, other);
    }

    #[test]
    fn nfkc_folds_circled_digits() {
        // ②①（U+2461 U+2460）经 NFKC 折叠为 "21"。
        let result = extract_candidate_terms("\u{2461}\u{2460}");
        assert_eq!(result.terms, vec!["21".to_string()]);
    }

    #[test]
    fn nfkc_folds_ideographic_space_for_dedup() {
        // 全角空格（U+3000）折叠为普通空格，两侧的 "角色" 去重为一条候选词。
        let result = extract_candidate_terms("角色\u{3000}角色");
        assert_eq!(result.terms, vec!["角色".to_string()]);
    }

    #[test]
    fn candidate_extraction_empty_question_has_no_terms() {
        let result = extract_candidate_terms("  ，。");
        assert!(result.terms.is_empty());
        assert!(!result.limited);
    }

    // ========== 纯文本抽取 ==========

    #[test]
    fn extract_plain_text_walks_notebook_blocks() {
        let value = serde_json::json!({
            "format": "next-story-tiptap",
            "version": 2,
            "document": {
                "type": "doc",
                "content": [
                    { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "标题" }] },
                    { "type": "paragraph", "content": [{ "type": "text", "text": "正文甲" }, { "type": "text", "text": "正文乙" }] }
                ]
            }
        });
        assert_eq!(extract_plain_text(&value), "标题正文甲正文乙");
    }

    // ========== 跨文档字面检索 ==========

    #[test]
    fn search_hits_other_document_with_source_identity() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let other = tree.create_document(None).unwrap();
        tree.rename(&other, "角色设定").unwrap();

        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("这是关注文档正文。"));
        bodies.insert(
            other.clone(),
            notebook_with_text("林晓站在天台边，没有回头。"),
        );

        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::Hit);
        assert_eq!(result.snippets.len(), 1);
        assert_eq!(result.snippets[0].document_id, other);
        assert_eq!(result.snippets[0].document_name, "角色设定");
        assert_eq!(result.snippets[0].matched_term, "林晓");
    }

    #[test]
    fn search_excludes_focus_document() {
        let (tree, focus) = tree_with_document("关注文档", true);
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("林晓站在天台边。"));
        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::NotFound);
    }

    #[test]
    fn search_title_does_not_count_as_body_hit() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let other = tree.create_document(None).unwrap();
        tree.rename(&other, "林晓").unwrap();
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        bodies.insert(other.clone(), notebook_with_text("完全无关的正文"));
        // 候选词 "林晓" 只出现在标题（文档名），正文不含 → 不命中。
        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::NotFound);
    }

    #[test]
    fn search_skips_hidden_document() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let hidden = tree.create_document(None).unwrap();
        tree.rename(&hidden, "隐藏设定").unwrap();
        tree.set_ai_visibility(&hidden, false).unwrap();
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        bodies.insert(hidden.clone(), notebook_with_text("林晓站在天台边。"));
        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::NotFound);
    }

    #[test]
    fn search_skips_recycled_document() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let recycled = tree.create_document(None).unwrap();
        tree.rename(&recycled, "回收站设定").unwrap();
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        bodies.insert(recycled.clone(), notebook_with_text("林晓站在天台边。"));
        tree.delete_to_recycle_bin(&recycled).unwrap();
        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::NotFound);
    }

    #[test]
    fn search_skips_orphan_node() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        // 构造存在于 nodes 但不从根可达的游离文档节点。
        let orphan_id = "orphan-node".to_string();
        tree.nodes.insert(
            orphan_id.clone(),
            ContentTreeNode {
                id: orphan_id.clone(),
                name: "游离文档".to_string(),
                kind: NodeKind::Document,
                children: Vec::new(),
                ai_visible: true,
            },
        );
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        bodies.insert(orphan_id.clone(), notebook_with_text("林晓站在天台边。"));
        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::NotFound);
    }

    #[test]
    fn search_reports_not_found_when_no_hits() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let other = tree.create_document(None).unwrap();
        tree.rename(&other, "无关文档").unwrap();
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        bodies.insert(other.clone(), notebook_with_text("完全无关的内容"));
        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::NotFound);
        assert!(result.snippets.is_empty());
    }

    #[test]
    fn search_reports_no_query_terms() {
        let (tree, focus) = tree_with_document("关注文档", true);
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        let result = search_documents(&tree, &focus, "？", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::NoQueryTerms);
        assert!(!result.limited);
    }

    #[test]
    fn search_snippet_window_applies_context_and_merges_overlap() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let other = tree.create_document(None).unwrap();
        tree.rename(&other, "长文").unwrap();
        let padding = "前".repeat(300);
        let text = format!("{padding}林晓站在天台边{padding}");
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        bodies.insert(other.clone(), notebook_with_text(&text));

        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::Hit);
        // 命中词 "林晓" 长 2 字符，前后各 120 字符 → 片段共 2 + 120 + 120 = 242 字符。
        let snippet = &result.snippets[0];
        assert!(snippet.snippet.contains("林晓站在天台边"));
        assert_eq!(snippet.snippet.chars().count(), 2 + 120 + 120);
    }

    #[test]
    fn search_caps_documents_and_snippets_and_marks_limited() {
        let (mut tree, focus) = tree_with_document("关注文档", true);
        let mut bodies = HashMap::new();
        bodies.insert(focus.clone(), notebook_with_text("关注正文"));
        // 超过 MAX_RESULT_DOCS 篇文档都含命中词。
        for i in 0..(MAX_RESULT_DOCS + 3) {
            let id = tree.create_document(None).unwrap();
            tree.rename(&id, &format!("设定{i}")).unwrap();
            bodies.insert(id, notebook_with_text("林晓站在天台边。"));
        }
        let result = search_documents(&tree, &focus, "林晓", &reader(&bodies));
        assert_eq!(result.status, SearchStatus::Hit);
        assert!(result.limited, "超过文档上限必须记录受限");
        let doc_ids: HashSet<&str> = result
            .snippets
            .iter()
            .map(|s| s.document_id.as_str())
            .collect();
        assert!(doc_ids.len() <= MAX_RESULT_DOCS);
    }

    // ========== 轮次取材组装 ==========

    #[test]
    fn compose_context_text_includes_focus_directory_and_snippets() {
        let focus = StoryMaterial {
            work_id: "w".to_string(),
            document_id: "focus".to_string(),
            document_name: "关注文档".to_string(),
            range: MaterialRange { start: 0, end: 6 },
            version: "v1".to_string(),
            content: "这是关注文档正文。".to_string(),
        };
        let directory = DirectoryProjection {
            root_children: vec![ProjectedNode {
                id: "d1".to_string(),
                name: "设定文档".to_string(),
                kind: NodeKind::Document,
                children: Vec::new(),
            }],
            hidden_count: 1,
        };
        let search = SearchResult {
            status: SearchStatus::Hit,
            snippets: vec![SearchSnippet {
                document_id: "d1".to_string(),
                document_name: "设定文档".to_string(),
                version: "v2".to_string(),
                snippet: "林晓站在天台边。".to_string(),
                matched_term: "林晓".to_string(),
                start: 0,
                end: 6,
            }],
            limited: false,
        };
        let text = compose_context_text(Some(&focus), &directory, &search);
        assert!(text.contains("关注文档《关注文档》正文"));
        assert!(text.contains("作品可见文档目录"));
        assert!(text.contains("另有 1 份文件已隐藏"));
        assert!(text.contains("相关片段"));
        assert!(text.contains("《设定文档》：林晓站在天台边。"));
    }

    #[test]
    fn assemble_round_context_reads_focus_directory_and_search() {
        use super::super::{
            create_document, create_new_project, open_content_tree, save_document,
            CreateProjectParams,
        };
        let temp = tempfile::TempDir::new().unwrap();
        let root = create_new_project(CreateProjectParams {
            name: "测试作品".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();
        let tree = open_content_tree(&root).unwrap();
        let focus_id = tree.root_children[0].clone();
        save_document(&root, &focus_id, &notebook_with_text("关注文档正文。")).unwrap();
        let other_id = create_document(&root, None).unwrap();
        save_document(&root, &other_id, &notebook_with_text("林晓站在天台边。")).unwrap();

        let ctx = assemble_round_context(&root, &focus_id, None, None, "林晓").unwrap();
        assert!(ctx.context_text.contains("关注文档"));
        assert!(ctx.context_text.contains("林晓站在天台边。"));
        assert_eq!(ctx.search_status, SearchStatus::Hit);
        assert!(ctx
            .provenance
            .iter()
            .any(|p| p.material_type == "focus_document" && p.document_id == focus_id));
        assert!(ctx.provenance.iter().any(|p| {
            p.material_type == "search_snippet"
                && p.document_id == other_id
                && p.matched_term.as_deref() == Some("林晓")
        }));
    }

    #[test]
    fn assemble_round_context_rejects_hidden_focus_document() {
        use super::super::{
            create_new_project, open_content_tree, save_document, set_document_ai_visibility,
            CreateProjectParams,
        };
        let temp = tempfile::TempDir::new().unwrap();
        let root = create_new_project(CreateProjectParams {
            name: "测试作品".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();
        let tree = open_content_tree(&root).unwrap();
        let focus_id = tree.root_children[0].clone();
        save_document(&root, &focus_id, &notebook_with_text("关注文档正文。")).unwrap();
        set_document_ai_visibility(&root, &focus_id, false).unwrap();

        let result = assemble_round_context(&root, &focus_id, None, None, "林晓");
        assert!(matches!(
            result,
            Err(MaterialDenial {
                reason: MaterialDenialReason::DocumentNotVisible
            })
        ));
    }

    // ========== 零写回（磁盘入口） ==========

    #[test]
    fn search_project_never_modifies_files() {
        use super::super::{
            create_new_project, open_content_tree, save_document, CreateProjectParams,
        };
        let temp = tempfile::TempDir::new().unwrap();
        let root = create_new_project(CreateProjectParams {
            name: "测试作品".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();
        let tree = open_content_tree(&root).unwrap();
        let doc_id = tree.root_children[0].clone();
        save_document(&root, &doc_id, &notebook_with_text("林晓站在天台边。")).unwrap();

        let paths = ProjectPaths::new(root.clone());
        let before: Vec<u8> = std::fs::read(&paths.document_file(&doc_id)).unwrap();

        let _ = search_project(&root, &doc_id, "林晓");

        let after: Vec<u8> = std::fs::read(&paths.document_file(&doc_id)).unwrap();
        assert_eq!(before, after, "检索不得改写正文文件");
    }
}
