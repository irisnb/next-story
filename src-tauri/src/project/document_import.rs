//! 文档导入共享管线（add-markdown-import 任务组 3）：按扩展名分发到格式分支
//! 的「文档导入」入口（`.docx` → [`super::docx_import`]，`.md` →
//! [`super::md_import`]），以及两种格式复用的全部骨架。
//!
//! 复用骨架（add-word-import 建立，本 change 泛化）：
//! - **契约结构**：`ImportPreview` / `ImportCommitResult` / `ImportLoss` /
//!   `SplitSuggestion`——字段名与前后端契约逐字一致；`hash_mismatch:` 协议、
//!   事务落盘、失败无残留语义不变。
//! - **损耗记账**：[`LossCounter`] 汇总两种格式的全部降级计数，统一生成中文
//!   告知文案。
//! - **拆分建议**：序列标记族聚合（docx＝全加粗短序列段落；md＝同层级短序列
//!   标题）共用族聚合与边界切分，默认不拆、用户拍板。
//! - **落盘**：单次映射式事务创建全部新文档（内容树 + N 份正文 + 元信息），
//!   失败无残留。
//!
//! 本模块不解析任何格式内容；格式分支各自把文件字节转换成
//! [`ParsedDocument`]（最终 canonical 块 + 顶层标记 + 损耗 + 计数）。

use std::collections::HashSet;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::operations::{
    read_bounded_string, recover_interrupted_save, transactional_write_mapped, ManifestPurpose,
    StagedAction, StagedFile, MAX_METADATA_BYTES, MAX_NOTEBOOK_BYTES,
};
use super::{ContentTree, NodeKind, ProjectError, ProjectMetadata, ProjectPaths};

/// docx 输入文件字节上限（含 ZIP 膨胀余量，add-word-import 既有值）。
pub(crate) const MAX_DOCX_INPUT_BYTES: u64 = 64 * 1024 * 1024;
/// md 输入文件字节上限（纯文本，design D5：约千万字级，宽松于 docx）。
pub(crate) const MAX_MD_INPUT_BYTES: u64 = 16 * 1024 * 1024;

/// 序列标记（拆分建议）识别参数（docx/md 共用；design D4：保守规则）。
const MARKER_LENGTH_RANGE: std::ops::RangeInclusive<usize> = 3..=14;
const MARKER_CN_NUMERALS: &str = "一二三四五六七八九十百零两";
const MARKER_CN_UNITS: &str = "集章回部卷";
const MARKER_MIN_REPEAT: usize = 3;

// ========== 对外契约结构（前后端共同依据，字段名与 design.md 逐字一致） ==========

/// 单项损耗告知：kind 见 design.md 契约（另补充 `numbering_degraded` /
/// `code_degraded` 等，见各格式模块文档）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportLoss {
    pub kind: String,
    pub count: usize,
    pub note: String,
}

/// 拆分建议：识别到的规整序列标记（是否拆分由用户拍板，默认不拆）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitSuggestion {
    pub marker_sample: String,
    pub count: usize,
    pub doc_names: Vec<String>,
}

/// 预检结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub char_count: usize,
    pub paragraph_count: usize,
    pub default_doc_name: String,
    pub losses: Vec<ImportLoss>,
    pub split_suggestion: Option<SplitSuggestion>,
    pub content_hash: String,
    pub generator: Option<String>,
}

/// 提交结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportCommitResult {
    pub created_doc_ids: Vec<String>,
    pub created_folder_id: Option<String>,
}

// ========== 损耗计数 ==========

/// 两种格式共用的损耗计数器。docx 与 md 各自填入相关字段，`into_losses`
/// 统一输出中文告知（只输出计数 > 0 的项）。
#[derive(Default)]
pub(crate) struct LossCounter {
    pub(crate) tables: usize,
    pub(crate) images: usize,
    /// docx：document.xml 扫描到的脚注引用；md：丢弃的脚注定义数。
    pub(crate) footnotes: usize,
    pub(crate) comments: usize,
    pub(crate) revisions: usize,
    pub(crate) numbering_degraded: usize,
    /// md：行内代码（计数与代码块合并输出，note 分列）。
    pub(crate) code_inline: usize,
    /// md：代码块。
    pub(crate) code_blocks: usize,
    /// md：引用块。
    pub(crate) quotes: usize,
    /// md：分隔线。
    pub(crate) hr: usize,
    /// md：剥除的 HTML 标签（含未配对的 `<u>`、HTML 块）。
    pub(crate) html_stripped: usize,
    /// md：剥离的 YAML frontmatter 块。
    pub(crate) frontmatter: usize,
    /// md：任务列表（标记本体丢弃、勾选框字面保留）。
    pub(crate) tasklists: usize,
    /// docx：缺 Fallback 的 AlternateContent 兼容块。
    pub(crate) block_skipped: usize,
}

impl LossCounter {
    fn into_losses(self) -> Vec<ImportLoss> {
        let mut out = Vec::new();
        let mut push = |kind: &str, count: usize, note: String| {
            if count > 0 {
                out.push(ImportLoss {
                    kind: kind.to_string(),
                    count,
                    note,
                });
            }
        };
        push(
            "table_flattened",
            self.tables,
            format!("{} 个表格按「每格一段」拍平：文字保留，表格结构不保留", self.tables),
        );
        push(
            "image_dropped",
            self.images,
            format!("{} 处图片或图形不导入", self.images),
        );
        push(
            "footnote_dropped",
            self.footnotes,
            format!("{} 处脚注不导入", self.footnotes),
        );
        push(
            "comment_dropped",
            self.comments,
            format!("{} 处批注不导入", self.comments),
        );
        push(
            "revision_finalized",
            self.revisions,
            format!("{} 处修订标记按最终状态导入（保留新增、丢弃删除）", self.revisions),
        );
        push(
            "numbering_degraded",
            self.numbering_degraded,
            format!("{} 个段落的编号定义无法映射为列表，按普通段落导入", self.numbering_degraded),
        );
        push(
            "code_degraded",
            self.code_inline + self.code_blocks,
            format!(
                "行内代码 {} 处、代码块 {} 处已降级为纯文字",
                self.code_inline, self.code_blocks
            ),
        );
        push(
            "quote_degraded",
            self.quotes,
            format!("{} 个引用块降级为普通段落", self.quotes),
        );
        push(
            "hr_dropped",
            self.hr,
            format!("{} 条分隔线不导入", self.hr),
        );
        push(
            "html_stripped",
            self.html_stripped,
            format!("{} 个 HTML 标签已剥除（保留其中文字）", self.html_stripped),
        );
        push(
            "frontmatter_dropped",
            self.frontmatter,
            format!("{} 个 YAML frontmatter 块已剥离，不进入正文", self.frontmatter),
        );
        push(
            "tasklist_degraded",
            self.tasklists,
            format!("{} 个任务列表按无序列表导入（勾选框以字面保留）", self.tasklists),
        );
        push(
            "block_skipped",
            self.block_skipped,
            format!(
                "{} 个兼容块（AlternateContent）缺少回退内容，已跳过",
                self.block_skipped
            ),
        );
        out
    }
}

// ========== 解析产物（格式分支 → 共享管线） ==========

/// 一次解析的全部产物：最终 canonical 块序列（单文档形态）、顶层序列标记
/// （块索引 + 族键 + 文本）、损耗与计数；`generator` 仅 docx 填写。
pub(crate) struct ParsedDocument {
    pub(crate) blocks: Vec<Value>,
    pub(crate) markers: Vec<(usize, String, String)>,
    pub(crate) losses: LossCounter,
    pub(crate) char_count: usize,
    pub(crate) paragraph_count: usize,
    pub(crate) generator: Option<String>,
}

/// 行内文本累积单元（docx run / md 文本事件共用）。
pub(crate) struct InlineRun {
    pub(crate) text: String,
    pub(crate) marks: Vec<Value>,
}

/// 把行内序列合并为 canonical 文本节点（相邻同 marks 必须合并、空文本跳过），
/// 返回（content 节点数组, 拼接全文）。
pub(crate) fn merge_inline_runs(inline: Vec<InlineRun>) -> (Vec<Value>, String) {
    let mut merged: Vec<(String, Vec<Value>)> = Vec::new();
    let mut text_total = String::new();
    for run in inline {
        if run.text.is_empty() {
            continue;
        }
        text_total.push_str(&run.text);
        if let Some(last) = merged.last_mut() {
            if last.1 == run.marks {
                last.0.push_str(&run.text);
                continue;
            }
        }
        merged.push((run.text, run.marks));
    }
    let content: Vec<Value> = merged
        .into_iter()
        .map(|(text, marks)| {
            let mut node = Map::new();
            node.insert("type".to_string(), json!("text"));
            node.insert("text".to_string(), json!(text));
            if !marks.is_empty() {
                node.insert("marks".to_string(), Value::Array(marks));
            }
            Value::Object(node)
        })
        .collect();
    (content, text_total)
}

// ========== 文档组装与拆分 ==========

pub(crate) fn doc_value_from_blocks(blocks: Vec<Value>) -> Value {
    // grammar 要求 document.content 非空：空文档兜底一个空段落。
    let content = if blocks.is_empty() {
        vec![json!({ "type": "paragraph" })]
    } else {
        blocks
    };
    json!({
        "format": super::NOTEBOOK_FORMAT,
        "version": super::NOTEBOOK_VERSION,
        "document": { "type": "doc", "content": content }
    })
}

// ========== 序列标记识别（docx/md 共用：保守规则，只建议不执行） ==========

/// 独立成段/成标题、整段仅为短序列文本（第X集 / 第X章 / Chapter N 风格）。
/// 返回族键（`cn:集` / `en:chapter`）；md 分支在此基础上加层级前缀。
pub(crate) fn parse_marker_family(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    if !MARKER_LENGTH_RANGE.contains(&len) {
        return None;
    }
    if chars[0] == '第' {
        let unit = chars[len - 1];
        if MARKER_CN_UNITS.contains(unit) {
            let inner: String = chars[1..len - 1].iter().collect();
            let numeric = !inner.is_empty()
                && inner
                    .chars()
                    .all(|c| c.is_ascii_digit() || MARKER_CN_NUMERALS.contains(c));
            if numeric {
                return Some(format!("cn:{unit}"));
            }
        }
    }
    let lower = trimmed.to_lowercase();
    if let Some(rest) = lower.strip_prefix("chapter") {
        let rest = rest.trim();
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            return Some("en:chapter".to_string());
        }
    }
    None
}

/// 族键 → 建议样例文本（md 族键带层级前缀，如 `2:cn:章`）。
fn family_sample(key: &str) -> String {
    if let Some(position) = key.find("cn:") {
        format!("第X{}", &key[position + "cn:".len()..])
    } else {
        "Chapter N".to_string()
    }
}

/// 族聚合：同族标记重复 ≥3 次才达标；多族同时达标时无法唯一判定，
/// 保守不建议（docx 与 md 同规则）。docx 的「格式一致＝全加粗」与
/// md 的「格式一致＝同标题层级」在标记生成侧保证，聚合逻辑共用。
pub(crate) fn detect_split_from_markers(
    markers: &[(usize, String, String)],
) -> Option<(String, SplitSuggestion)> {
    struct FamilyAgg {
        key: String,
        count: usize,
        texts: Vec<String>,
        sample: String,
    }
    let mut families: Vec<FamilyAgg> = Vec::new();
    for (_, key, text) in markers {
        match families.iter_mut().find(|f| &f.key == key) {
            Some(agg) => {
                agg.count += 1;
                agg.texts.push(text.clone());
            }
            None => families.push(FamilyAgg {
                key: key.clone(),
                count: 1,
                texts: vec![text.clone()],
                sample: family_sample(key),
            }),
        }
    }
    let qualifying: Vec<&FamilyAgg> = families
        .iter()
        .filter(|f| f.count >= MARKER_MIN_REPEAT)
        .collect();
    if qualifying.len() != 1 {
        return None;
    }
    let family = qualifying[0];
    let mut used: HashSet<String> = HashSet::new();
    let doc_names = family
        .texts
        .iter()
        .map(|text| unique_among(&mut used, sanitize_node_name(text, "导入文档")))
        .collect();
    Some((
        family.key.clone(),
        SplitSuggestion {
            marker_sample: family.sample.clone(),
            count: family.count,
            doc_names,
        },
    ))
}

/// 按标记边界切分：标记块是其后的文档首块；首个标记之前的前言并入第 1 个
/// 文档（「按 N 个标记拆为 N 个文档」，文字零丢弃）。
pub(crate) fn segments_for_family(
    markers: &[(usize, String, String)],
    family: &str,
    total: usize,
) -> Vec<(String, usize, usize)> {
    let family_markers: Vec<(usize, &str)> = markers
        .iter()
        .filter_map(|(index, key, text)| (key == family).then_some((*index, text.as_str())))
        .collect();
    let mut segments = Vec::new();
    for (position, (marker_index, text)) in family_markers.iter().enumerate() {
        let start = if position == 0 { 0 } else { *marker_index };
        let end = family_markers
            .get(position + 1)
            .map(|(next, _)| *next)
            .unwrap_or(total);
        segments.push((text.to_string(), start, end));
    }
    segments
}

pub(crate) fn split_docs_from_blocks(
    blocks: &[Value],
    markers: &[(usize, String, String)],
    family: &str,
) -> Vec<(String, Value)> {
    segments_for_family(markers, family, blocks.len())
        .into_iter()
        .map(|(name, start, end)| {
            (
                name,
                doc_value_from_blocks(blocks[start..end].to_vec()),
            )
        })
        .collect()
}

fn unique_among(used: &mut HashSet<String>, base: String) -> String {
    if used.insert(base.clone()) {
        return base;
    }
    let mut index = 2;
    loop {
        let candidate = format!("{base} {index}");
        if used.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

// ========== 格式分发与读取（design D2 / D5） ==========

/// 导入格式：按扩展名分发（`.docx` ZIP 结构校验不变；`.md` 走 md 分支）。
#[derive(Debug, Clone, Copy)]
pub(crate) enum ImportFormat {
    Docx,
    Markdown,
}

impl ImportFormat {
    fn max_input_bytes(self) -> u64 {
        match self {
            ImportFormat::Docx => MAX_DOCX_INPUT_BYTES,
            ImportFormat::Markdown => MAX_MD_INPUT_BYTES,
        }
    }
}

fn detect_import_format(file_path: &Path) -> Result<ImportFormat, ProjectError> {
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("docx") => Ok(ImportFormat::Docx),
        Some("md") => Ok(ImportFormat::Markdown),
        _ => Err(ProjectError::ImportRejected(
            "只支持 .docx 与 .md 文件；.doc 老格式请先在 Word 或 WPS 中另存为 .docx".to_string(),
        )),
    }
}

fn parse_by_format(format: ImportFormat, bytes: &[u8]) -> Result<ParsedDocument, ProjectError> {
    match format {
        ImportFormat::Docx => super::docx_import::parse_docx(bytes),
        ImportFormat::Markdown => super::md_import::parse_md(bytes),
    }
}

/// 有界读取输入文件（take 上限 +1，杜绝先查长度再读的竞态）。
pub(crate) fn read_file_bounded(path: &Path, max: u64) -> Result<Vec<u8>, ProjectError> {
    let file = std::fs::File::open(path)
        .map_err(|_| ProjectError::ImportRejected("无法读取所选文件".to_string()))?;
    let mut limited = file.take(max + 1);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|_| ProjectError::ImportRejected("无法读取所选文件".to_string()))?;
    if bytes.len() as u64 > max {
        return Err(ProjectError::ImportRejected(format!(
            "文件过大：导入上限为 {} MB",
            max / (1024 * 1024)
        )));
    }
    Ok(bytes)
}

// ========== 命名与工具 ==========

/// 文档 / 文件夹名净化：替换文件系统非法字符为空格、折叠空白、去尾部点号；
/// 空名回退 fallback（名称是元数据，净化不违反「文字逐字一致」边界）。
pub(crate) fn sanitize_node_name(raw: &str, fallback: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|ch| {
            if ch.is_control() || "<>:\"/\\|?*".contains(ch) {
                ' '
            } else {
                ch
            }
        })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut trimmed = collapsed.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        trimmed = fallback.to_string();
    }
    trimmed
}

pub(crate) fn doc_name_from_file(file_path: &Path) -> String {
    let stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("导入文档");
    sanitize_node_name(stem, "导入文档")
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

// ========== 预检命令（零写入） ==========

/// 解析并返回预览：字数、段落数、默认文档名、损耗清单、拆分建议、内容哈希、
/// 生成器印记（仅 docx）。作品校验走严格只读路径（发现待恢复事务即失败关闭，
/// 绝不写入）；任何取消／失败都零副作用。
pub fn import_document_preview(
    project_root: &Path,
    file_path: &Path,
) -> Result<ImportPreview, ProjectError> {
    super::strict_read_content_tree(project_root)?;
    let format = detect_import_format(file_path)?;
    let bytes = read_file_bounded(file_path, format.max_input_bytes())?;
    let content_hash = sha256_hex(&bytes);
    let parsed = parse_by_format(format, &bytes)?;

    // 映射健全性自检：整文件单文档形态必须通过既有严格语法校验，
    // 把映射缺陷挡在用户确认之前。
    let single = doc_value_from_blocks(parsed.blocks.clone());
    super::validate_notebook_document(&single)
        .map_err(|e| ProjectError::ImportRejected(format!("导入映射内部校验失败：{e}")))?;

    let split_suggestion = detect_split_from_markers(&parsed.markers).map(|(_, s)| s);

    Ok(ImportPreview {
        char_count: parsed.char_count,
        paragraph_count: parsed.paragraph_count,
        default_doc_name: doc_name_from_file(file_path),
        losses: parsed.losses.into_losses(),
        split_suggestion,
        content_hash,
        generator: parsed.generator,
    })
}

// ========== 提交命令（重解析 + 哈希比对 + 单事务落盘） ==========

/// 重新解析并落盘：内容哈希与预览不一致即拒绝（错误信息带 `hash_mismatch:`
/// 前缀，前端提示重新预检）；全部新文档经一次映射式事务原子提交，任何失败
/// 都不留部分完成的结构。
pub fn import_document_commit(
    project_root: &Path,
    file_path: &Path,
    parent_id: Option<&str>,
    split: bool,
    expected_hash: &str,
) -> Result<ImportCommitResult, ProjectError> {
    let format = detect_import_format(file_path)?;
    let bytes = read_file_bounded(file_path, format.max_input_bytes())?;
    let content_hash = sha256_hex(&bytes);
    if !content_hash.eq_ignore_ascii_case(expected_hash.trim()) {
        return Err(ProjectError::ImportHashMismatch);
    }

    let parsed = parse_by_format(format, &bytes)?;
    let default_name = doc_name_from_file(file_path);
    let single_doc = || vec![(default_name.clone(), doc_value_from_blocks(parsed.blocks.clone()))];

    // 组装文档集：默认整文件一个文档；用户选择拆分且存在唯一达标标记族时
    // 按标记边界拆分（拆分请求但无标记时回退单文档）。
    let (docs, folder_name): (Vec<(String, Value)>, Option<String>) = if split {
        match detect_split_from_markers(&parsed.markers) {
            Some((family, _)) => (
                split_docs_from_blocks(&parsed.blocks, &parsed.markers, &family),
                Some(default_name.clone()),
            ),
            None => (single_doc(), None),
        }
    } else {
        (single_doc(), None)
    };

    // 落盘前逐份校验：必须通过既有严格语法校验且不超过单文档大小上限。
    let mut rendered: Vec<(String, String)> = Vec::with_capacity(docs.len());
    for (name, value) in docs {
        super::validate_notebook_document(&value)
            .map_err(|e| ProjectError::ImportRejected(format!("导入映射内部校验失败：{e}")))?;
        let notebook_json = serde_json::to_string_pretty(&value)
            .map_err(|e| ProjectError::ImportRejected(format!("导入文档序列化失败：{e}")))?;
        if notebook_json.len() as u64 > MAX_NOTEBOOK_BYTES {
            return Err(ProjectError::ImportRejected(format!(
                "导入后的文档「{name}」超过单文档 {} MB 上限，无法导入；可尝试按标记拆分导入",
                MAX_NOTEBOOK_BYTES / (1024 * 1024)
            )));
        }
        rendered.push((name, notebook_json));
    }

    commit_docs_transaction(project_root, rendered, parent_id, folder_name)
}

/// 单事务落盘：内容树（新增文件夹 + N 篇文档）+ N 份正文 + 元信息（最后，
/// 完成标记）。AI 可见性沿用 `create_document` 默认值（允许，与既有新建文档
/// 一致）。事务失败在提交前中止即无可见副作用；提交中途失败由既有恢复机制
/// 前滚补齐（与其他结构变更同语义）。
fn commit_docs_transaction(
    project_root: &Path,
    docs: Vec<(String, String)>,
    parent_id: Option<&str>,
    folder_name: Option<String>,
) -> Result<ImportCommitResult, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());
    recover_interrupted_save(&paths)?;

    let mut tree: ContentTree = super::operations::read_content_tree(&paths)?;
    if let Some(parent) = parent_id {
        let node = tree.nodes.get(parent).ok_or_else(|| {
            ProjectError::ImportRejected("导入目标文件夹不存在，请刷新后重试".to_string())
        })?;
        if node.kind != NodeKind::Folder {
            return Err(ProjectError::ImportRejected(
                "导入目标必须是文件夹".to_string(),
            ));
        }
    }

    // 拆分导入：以默认文档名新建文件夹（名称净化 + 同级唯一化）。
    let mut created_folder_id: Option<String> = None;
    let docs_parent: Option<String> = match folder_name {
        Some(name) => {
            let folder_id = tree
                .create_folder(parent_id)
                .map_err(|e| ProjectError::ImportRejected(format!("创建导入文件夹失败：{e}")))?;
            let unique = unique_sibling_name(
                &tree,
                parent_id,
                &sanitize_node_name(&name, "导入文件夹"),
                &folder_id,
            );
            tree.rename(&folder_id, &unique)
                .map_err(|e| ProjectError::ImportRejected(format!("命名导入文件夹失败：{e}")))?;
            created_folder_id = Some(folder_id.clone());
            Some(folder_id)
        }
        None => parent_id.map(str::to_string),
    };

    // 创建 N 篇文档（create_document 自动分配唯一默认名，重命名为导入名）。
    let mut created_doc_ids: Vec<String> = Vec::with_capacity(docs.len());
    for (raw_name, _) in &docs {
        let doc_id = tree
            .create_document(docs_parent.as_deref())
            .map_err(|e| ProjectError::ImportRejected(format!("创建导入文档失败：{e}")))?;
        let unique = unique_sibling_name(
            &tree,
            docs_parent.as_deref(),
            &sanitize_node_name(raw_name, "导入文档"),
            &doc_id,
        );
        tree.rename(&doc_id, &unique)
            .map_err(|e| ProjectError::ImportRejected(format!("命名导入文档失败：{e}")))?;
        created_doc_ids.push(doc_id);
    }

    tree.validate()
        .map_err(|e| ProjectError::ImportRejected(format!("导入结构校验失败：{e}")))?;

    // 元信息只更新 updated_at；暂存顺序：内容树 → 各正文 → 元信息（最后）。
    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ImportRejected(format!("读取作品元信息失败：{e}")))?;
    let mut metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::ImportRejected(format!("作品元信息无法解析：{e}")))?;
    metadata.updated_at = chrono::Utc::now().to_rfc3339();
    let staged_metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| ProjectError::ImportRejected(format!("序列化作品元信息失败：{e}")))?;
    let tree_json = serde_json::to_string_pretty(&tree)
        .map_err(|e| ProjectError::ImportRejected(format!("序列化内容树失败：{e}")))?;

    let mut staged_writes: Vec<(StagedFile, String)> = vec![(
        StagedFile {
            staged: "content-tree.json".to_string(),
            target: "next-story-system/content-tree.json".to_string(),
            action: StagedAction::Replace,
        },
        tree_json,
    )];
    for (doc_id, (_, notebook_json)) in created_doc_ids.iter().zip(&docs) {
        staged_writes.push((
            StagedFile {
                staged: format!("doc-{doc_id}.json"),
                target: format!("作品文本/documents/{doc_id}.json"),
                action: StagedAction::Replace,
            },
            notebook_json.clone(),
        ));
    }
    staged_writes.push((
        StagedFile {
            staged: "project.json".to_string(),
            target: "next-story-system/project.json".to_string(),
            action: StagedAction::Replace,
        },
        staged_metadata_json,
    ));

    transactional_write_mapped(
        &paths,
        &staged_writes,
        &metadata.updated_at,
        ManifestPurpose::StructureChange,
    )?;

    Ok(ImportCommitResult {
        created_doc_ids,
        created_folder_id,
    })
}

fn sibling_names(tree: &ContentTree, parent: Option<&str>, exclude: &str) -> Vec<String> {
    let ids: Vec<&String> = match parent {
        Some(parent_id) => tree
            .nodes
            .get(parent_id)
            .map(|node| node.children.iter().collect())
            .unwrap_or_default(),
        None => tree.root_children.iter().collect(),
    };
    ids.into_iter()
        .filter(|id| id.as_str() != exclude)
        .filter_map(|id| tree.nodes.get(id).map(|node| node.name.clone()))
        .collect()
}

/// 同级唯一命名：与既有节点（及本次已创建节点）冲突时追加「 2」「 3」后缀，
/// 与内容树既有自动命名风格一致。
fn unique_sibling_name(tree: &ContentTree, parent: Option<&str>, base: &str, exclude: &str) -> String {
    let taken: HashSet<String> = sibling_names(tree, parent, exclude).into_iter().collect();
    if !taken.contains(base) {
        return base.to_string();
    }
    let mut index = 2;
    loop {
        let candidate = format!("{base} {index}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        index += 1;
    }
}
