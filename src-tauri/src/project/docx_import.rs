//! Word 导入（add-word-import 任务组 2/3）：`.docx` → canonical Tiptap JSON v2。
//!
//! 分层与边界：
//! - **文件识别与防护**（design D5）：按扩展名 `.docx` + ZIP 结构（存在
//!   `[Content_Types].xml`）判断，不信任系统 MIME；输入字节、单条目解压量、
//!   解压总量三重上限（防压缩炸弹，参照 xerj 前例），超限中文报错、不崩溃。
//! - **解析**：docx-rs 0.4.22 读侧 API（路线 A，spike 已实证对真实 WPS 文件
//!   兼容）。docx-rs 内部自行解压、无法注入逐条目限额，因此解压上限在调用
//!   `read_docx` 之前用 zip crate 流式预扫描执行（真实读出量而非声明量）。
//! - **映射**（design D3）：段落 / Heading 样式→标题 / 有效可见编号→列表
//!   （`numId=0` 墓碑与不可见定义一律普通段落）/ 表格逐格拍平 / 空段落保留 /
//!   run 级 bold·italic·underline·strike·color·sz·rFonts·highlight / 超链接 /
//!   对齐缩进行距段距 / 修订取最终态（留 ins 去 del）/ 缺 Fallback 的
//!   AlternateContent 与脚注引用在 document.xml 上按本地名扫描计数
//!   （docx-rs 读侧对两者分别缺少解析与完全不解析）/ `wpsCustomData` 等私货
//!   不解析。
//! - **落盘**（design D1）：两步无状态命令——preview 解析返回预览，commit
//!   重新解析并校验内容哈希后经映射式事务一次性提交（失败无残留）。
//! - **合宪性**（design D7）：导入文字 100% 逐字来自用户选定文件，映射只搬
//!   运格式不改字符；只创建新文档，不修改任何既有文档。
//!
//! 值约定（与前端编辑器 CSS 值一致）：fontSize/spacing 用 pt（如 `12pt`），
//! 行距 auto 规则为无单位倍数（如 `1.5`），缩进优先用字符单位 em
//! （`firstLineChars`/`startChars` 的 1/100 字符），无字符单位时退回 pt。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;

use docx_rs::{
    read_docx_with_options, Docx, DocumentChild, HyperlinkData, Paragraph, ParagraphChild,
    ParagraphStyle, ReadDocxOptions, Run, RunChild, RunProperty, SpecialIndentType, StructuredDataTag,
    Table, TableCellContent, TableChild,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::operations::{
    read_bounded_string, recover_interrupted_save, transactional_write_mapped, ManifestPurpose,
    StagedAction, StagedFile, MAX_METADATA_BYTES, MAX_NOTEBOOK_BYTES,
};
use super::{ContentTree, NodeKind, ProjectError, ProjectMetadata, ProjectPaths};

/// 输入文件整体字节上限（design D5.3：超大文件拒绝）。
pub const MAX_IMPORT_INPUT_BYTES: u64 = 64 * 1024 * 1024;
/// 单个 ZIP 条目解压后字节上限（防压缩炸弹；正常剧本 document.xml 为个位数 MB）。
const MAX_IMPORT_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
/// 全部条目解压总量上限（docx-rs 会把 media 一并读入内存，总量须有界）。
const MAX_IMPORT_TOTAL_BYTES: u64 = 200 * 1024 * 1024;

/// 序列标记（拆分建议）识别参数（design D4：保守规则）。
const MARKER_LENGTH_RANGE: std::ops::RangeInclusive<usize> = 3..=14;
const MARKER_CN_NUMERALS: &str = "一二三四五六七八九十百零两";
const MARKER_CN_UNITS: &str = "集章回部卷";
const MARKER_MIN_REPEAT: usize = 3;

// ========== 对外契约结构（前后端共同依据，字段名与 design.md 逐字一致） ==========

/// 单项损耗告知：kind 见 design.md 契约（另补充 `numbering_degraded`，见模块文档）。
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

#[derive(Default)]
struct LossCounter {
    tables: usize,
    images: usize,
    footnotes: usize,
    comments: usize,
    revisions: usize,
    numbering_degraded: usize,
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
        out
    }
}

// ========== 编号定义索引 ==========

/// 单个编号层级的可见性与形态。`visible=false` 表示编号不可见（numFmt=none、
/// lvlText 为空或定义缺失），按普通段落处理（design D3 编号可见性规则）。
#[derive(Debug, Clone)]
struct LevelInfo {
    visible: bool,
    ordered: bool,
    start: u64,
}

/// numId → 各层级定义（按 ilvl 下标）。仅解析 num/abstractNum 两级引用；
/// lvlOverride 与样式链编号（numStyleLink）v1 不解析，解析不到按降级告知。
#[derive(Default)]
struct NumberingIndex {
    map: HashMap<usize, Vec<Option<LevelInfo>>>,
}

impl NumberingIndex {
    fn build(numberings: &docx_rs::Numberings) -> Self {
        let mut abstract_levels: HashMap<usize, Vec<Option<LevelInfo>>> = HashMap::new();
        for abs in &numberings.abstract_nums {
            let mut levels: Vec<Option<LevelInfo>> = Vec::new();
            for level in &abs.levels {
                let lvl_text = ser_str(&level.text).unwrap_or_default();
                let num_fmt = level.format.val.clone();
                let visible = !lvl_text.trim().is_empty() && num_fmt != "none";
                let info = LevelInfo {
                    visible,
                    ordered: num_fmt != "bullet",
                    start: ser_u64(&level.start).unwrap_or(1).max(1),
                };
                if levels.len() <= level.level {
                    levels.resize(level.level + 1, None);
                }
                levels[level.level] = Some(info);
            }
            abstract_levels.insert(abs.id, levels);
        }
        let mut map = HashMap::new();
        for num in &numberings.numberings {
            if let Some(levels) = abstract_levels.get(&num.abstract_num_id) {
                map.insert(num.id, levels.clone());
            }
        }
        Self { map }
    }

    /// 取 numId 的第 0 层定义；不可见或缺失返回 None（调用方按普通段落处理）。
    fn level0(&self, num_id: usize) -> Option<&LevelInfo> {
        self.map
            .get(&num_id)?
            .first()?
            .as_ref()
            .filter(|info| info.visible)
    }
}

// ========== 解析中间结构 ==========

/// 一个待定段落（w:br 会把一个 w:p 拆成多段）。
struct ParaAccum {
    heading: Option<u8>,
    attrs: Map<String, Value>,
    inline: Vec<InlineRun>,
}

impl ParaAccum {
    fn new(heading: Option<u8>, attrs: Map<String, Value>) -> Self {
        Self {
            heading,
            attrs,
            inline: Vec::new(),
        }
    }

    /// 段内换行拆分：延续段落继承相同块属性。
    fn split_clone(&self) -> Self {
        Self {
            heading: self.heading,
            attrs: self.attrs.clone(),
            inline: Vec::new(),
        }
    }
}

struct InlineRun {
    text: String,
    marks: Vec<Value>,
}

/// 转换完成的一个块级段落：完整块节点 + 列表归组信息 + 序列标记识别结果。
#[derive(Clone)]
struct ParaOut {
    node: Value,
    /// (numId, ordered, start)：参与列表归组的段落携带。
    list: Option<(usize, bool, u64)>,
    /// (family_key, trimmed text)：仅顶层段落且全加粗时识别。
    marker: Option<(String, String)>,
}

/// 一次解析的全部产物。
struct ParsedDocx {
    paras: Vec<ParaOut>,
    losses: LossCounter,
    char_count: usize,
    paragraph_count: usize,
}

// ========== 转换器 ==========

struct Converter {
    hyperlinks: HashMap<String, String>,
    numbering: NumberingIndex,
    styles_by_id: HashMap<String, String>,
    losses: LossCounter,
    char_count: usize,
    paragraph_count: usize,
}

impl Converter {
    fn new(docx: &Docx) -> Self {
        let hyperlinks = docx
            .hyperlinks
            .iter()
            .map(|(rid, target, _)| (rid.clone(), target.clone()))
            .collect();
        let numbering = NumberingIndex::build(&docx.numberings);
        let styles_by_id = docx
            .styles
            .styles
            .iter()
            .map(|style| (style.style_id.clone(), ser_str(&style.name).unwrap_or_default()))
            .collect();
        Self {
            hyperlinks,
            numbering,
            styles_by_id,
            losses: LossCounter::default(),
            char_count: 0,
            paragraph_count: 0,
        }
    }

    fn walk_document(&mut self, docx: &Docx) -> Vec<ParaOut> {
        let mut out = Vec::new();
        for child in &docx.document.children {
            match child {
                DocumentChild::Paragraph(p) => out.extend(self.convert_paragraph(p, true, false)),
                DocumentChild::Table(t) => self.flatten_table(t, &mut out),
                DocumentChild::StructuredDataTag(sdt) => self.walk_sdt(sdt, &mut out),
                DocumentChild::CommentStart(_) => self.losses.comments += 1,
                // Bookmark / TOC / Section：不承载可见文字，跳过。
                _ => {}
            }
        }
        out
    }

    fn walk_sdt(&mut self, sdt: &StructuredDataTag, out: &mut Vec<ParaOut>) {
        use docx_rs::StructuredDataTagChild as C;
        for child in &sdt.children {
            match child {
                C::Paragraph(p) => out.extend(self.convert_paragraph(p, true, false)),
                C::Table(t) => self.flatten_table(t, out),
                C::StructuredDataTag(inner) => self.walk_sdt(inner, out),
                C::CommentStart(_) => self.losses.comments += 1,
                _ => {}
            }
        }
    }

    /// 表格拍平（design D3）：逐格逐段输出普通段落；嵌套表格递归拍平；
    /// 单元格内段落不转列表（拍平语义），有效编号按降级告知。
    fn flatten_table(&mut self, table: &Table, out: &mut Vec<ParaOut>) {
        self.losses.tables += 1;
        for row in &table.rows {
            let TableChild::TableRow(r) = row;
            for cell in &r.cells {
                let docx_rs::TableRowChild::TableCell(c) = cell;
                for content in &c.children {
                    match content {
                        TableCellContent::Paragraph(p) => {
                            out.extend(self.convert_paragraph(p, false, true));
                        }
                        TableCellContent::Table(nested) => self.flatten_table(nested, out),
                        TableCellContent::StructuredDataTag(sdt) => self.walk_sdt(sdt, out),
                        _ => {}
                    }
                }
            }
        }
    }

    fn convert_paragraph(
        &mut self,
        p: &Paragraph,
        top_level: bool,
        in_table: bool,
    ) -> Vec<ParaOut> {
        self.paragraph_count += 1;

        // 块属性：对齐 / 缩进 / 行距段距；标题样式优先于列表（标题不参与列表归组）。
        let attrs = paragraph_attrs(&p.property);
        let heading = p
            .property
            .style
            .as_ref()
            .and_then(|style| self.heading_level(style));

        // 编号可见性：numId=0 墓碑与缺失 numId 一律普通段落且不计数；
        // 多级（ilvl>0）、表格内、解析不到定义 → 降级普通段落并计数告知。
        let list = match &p.property.numbering_property {
            None => None,
            Some(np) => match np.id.as_ref().map(|id| id.id) {
                None | Some(0) => None,
                Some(num_id) => {
                    let ilvl = np.level.as_ref().map(|l| l.val).unwrap_or(0);
                    if ilvl > 0 || in_table {
                        self.losses.numbering_degraded += 1;
                        None
                    } else {
                        match self.numbering.level0(num_id) {
                            Some(info) => Some((num_id, info.ordered, info.start)),
                            None => {
                                self.losses.numbering_degraded += 1;
                                None
                            }
                        }
                    }
                }
            },
        };

        let mut acc = ParaAccum::new(heading, attrs);
        let mut closed: Vec<ParaAccum> = Vec::new();
        for child in &p.children {
            self.collect_paragraph_child(child, None, &mut acc, &mut closed);
        }
        let mut parts = closed;
        parts.push(acc);
        let list = if heading.is_some() { None } else { list };
        parts
            .into_iter()
            .map(|part| self.finalize_para(part, top_level, list))
            .collect()
    }

    fn heading_level(&self, style: &ParagraphStyle) -> Option<u8> {
        if let Some(level) = parse_heading_token(&style.val) {
            return Some(level);
        }
        self.styles_by_id
            .get(&style.val)
            .and_then(|name| parse_heading_token(name))
    }

    fn collect_paragraph_child(
        &mut self,
        child: &ParagraphChild,
        link_href: Option<&str>,
        acc: &mut ParaAccum,
        closed: &mut Vec<ParaAccum>,
    ) {
        match child {
            ParagraphChild::Run(run) => self.collect_run(run, link_href, acc, closed),
            ParagraphChild::Hyperlink(h) => {
                let href = self.href_for(h);
                for inner in &h.children {
                    self.collect_paragraph_child(inner, href.as_deref(), acc, closed);
                }
            }
            ParagraphChild::Insert(ins) => {
                // 修订最终态：插入内容保留。
                self.losses.revisions += 1;
                for inner in &ins.children {
                    match inner {
                        docx_rs::InsertChild::Run(run) => {
                            self.collect_run(run, link_href, acc, closed)
                        }
                        docx_rs::InsertChild::Delete(_) => self.losses.revisions += 1,
                        _ => {}
                    }
                }
            }
            ParagraphChild::Delete(_) => {
                // 修订最终态：删除内容丢弃。
                self.losses.revisions += 1;
            }
            ParagraphChild::MoveFrom(_) => {
                self.losses.revisions += 1;
            }
            ParagraphChild::MoveTo(mt) => {
                // moveFrom 丢弃、moveTo 保留，等价于移动的最终态。
                self.losses.revisions += 1;
                for inner in &mt.children {
                    match inner {
                        docx_rs::MoveToChild::Run(run) => {
                            self.collect_run(run, link_href, acc, closed)
                        }
                        docx_rs::MoveToChild::Delete(_) => self.losses.revisions += 1,
                        _ => {}
                    }
                }
            }
            ParagraphChild::CommentStart(_) => self.losses.comments += 1,
            // BookmarkStart / BookmarkEnd / CommentEnd / StructuredDataTag /
            // PageNum / NumPages：不承载可见文字，跳过。
            _ => {}
        }
    }

    fn href_for(&self, h: &docx_rs::Hyperlink) -> Option<String> {
        match &h.link {
            HyperlinkData::External { rid, .. } => self.hyperlinks.get(rid).cloned(),
            HyperlinkData::Anchor { anchor } => Some(format!("#{anchor}")),
        }
        .filter(|href| !href.is_empty())
    }

    fn collect_run(
        &mut self,
        run: &Run,
        link_href: Option<&str>,
        acc: &mut ParaAccum,
        closed: &mut Vec<ParaAccum>,
    ) {
        let marks = run_marks(&run.run_property, link_href);
        for child in &run.children {
            match child {
                RunChild::Text(t) => {
                    // 防御：XML 文本内容按规范不应携带 CR/LF，异常文件按空格处理，
                    // 避免非法字符进入 grammar（text 不允许 CR/LF）。
                    let text = if t.text.contains('\r') || t.text.contains('\n') {
                        t.text.replace(['\r', '\n'], " ")
                    } else {
                        t.text.clone()
                    };
                    if !text.is_empty() {
                        acc.inline.push(InlineRun {
                            text,
                            marks: marks.clone(),
                        });
                    }
                }
                RunChild::Tab(_) => acc.inline.push(InlineRun {
                    text: "\t".to_string(),
                    marks: marks.clone(),
                }),
                RunChild::Break(_) | RunChild::CarriageReturn(_) => {
                    // 段内换行超出语法承载（text 不允许换行符）：按同属性拆分为
                    // 相邻段落，文字不丢失。
                    let continuation = acc.split_clone();
                    closed.push(std::mem::replace(acc, continuation));
                }
                RunChild::Drawing(_) | RunChild::Shape(_) => self.losses.images += 1,
                RunChild::CommentStart(_) => self.losses.comments += 1,
                // 注意：脚注引用不在此计数——docx-rs 读侧不解析
                // w:footnoteReference（模型层看不到），计数统一走
                // document.xml 扫描通道（见 count_footnote_references），
                // 避免未来读侧补上解析后出现双通道重复计数。
                // Sym / FieldChar / InstrText / DeleteText 等域与符号构造
                // 不导入（域的可见结果文字在普通 w:t run 中，正常保留）。
                _ => {}
            }
        }
    }

    fn finalize_para(
        &mut self,
        acc: ParaAccum,
        top_level: bool,
        list: Option<(usize, bool, u64)>,
    ) -> ParaOut {
        // 合并相邻同 marks 文本（canonical 要求），统计可见字符与全加粗判定。
        let mut merged: Vec<(String, Vec<Value>)> = Vec::new();
        let mut text_total = String::new();
        let mut has_text = false;
        let mut all_bold = true;
        for run in acc.inline {
            if run.text.is_empty() {
                continue;
            }
            self.char_count += run.text.chars().count();
            text_total.push_str(&run.text);
            if !run.text.trim().is_empty() {
                has_text = true;
                if !run.marks.iter().any(|m| m["type"] == "bold") {
                    all_bold = false;
                }
            }
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
                let mut obj = Map::new();
                obj.insert("type".to_string(), json!("text"));
                obj.insert("text".to_string(), json!(text));
                if !marks.is_empty() {
                    obj.insert("marks".to_string(), Value::Array(marks));
                }
                Value::Object(obj)
            })
            .collect();

        let block_type = if acc.heading.is_some() {
            "heading"
        } else {
            "paragraph"
        };
        let mut node = Map::new();
        node.insert("type".to_string(), json!(block_type));
        let mut attrs = acc.attrs;
        if let Some(level) = acc.heading {
            attrs.insert("level".to_string(), json!(level));
        }
        if !attrs.is_empty() {
            node.insert("attrs".to_string(), Value::Object(attrs));
        }
        if !content.is_empty() {
            node.insert("content".to_string(), Value::Array(content));
        }

        let marker = if top_level && has_text && all_bold {
            parse_marker_family(&text_total).map(|key| (key, text_total.trim().to_string()))
        } else {
            None
        };

        ParaOut {
            node: Value::Object(node),
            list,
            marker,
        }
    }
}

// ========== run 级 marks（design D3 格式标记全保留） ==========

/// run 级格式 → canonical marks（按 rank 排序：bold·italic·underline·strike·
/// textStyle·highlight·link）。docx-rs 多个属性结构字段为私有但实现 Serialize，
/// 统一经 serde_json::to_value 读取。
fn run_marks(rp: &RunProperty, link_href: Option<&str>) -> Vec<Value> {
    let mut marks = Vec::new();
    if ser_flag(rp.bold.as_ref()) {
        marks.push(json!({ "type": "bold" }));
    }
    if ser_flag(rp.italic.as_ref()) {
        marks.push(json!({ "type": "italic" }));
    }
    if let Some(underline) = &rp.underline {
        let val = ser_str(underline).unwrap_or_default();
        if !val.is_empty() && val != "none" {
            marks.push(json!({ "type": "underline" }));
        }
    }
    if ser_flag(rp.strike.as_ref()) {
        marks.push(json!({ "type": "strike" }));
    }

    let mut text_style = Map::new();
    if let Some(color) = &rp.color {
        if let Some(hex) = normalize_hex_color(&ser_str(color).unwrap_or_default()) {
            text_style.insert("color".to_string(), json!(hex));
        }
    }
    if let Some(sz) = &rp.sz {
        if let Some(half_points) = ser_u64(sz) {
            if half_points > 0 {
                text_style.insert(
                    "fontSize".to_string(),
                    json!(format!("{}pt", format_decimal(half_points as f64 / 2.0))),
                );
            }
        }
    }
    if let Some(fonts) = &rp.fonts {
        if let Some(font_value) = serde_json::to_value(fonts).ok().and_then(|v| {
            v.as_object().cloned()
        }) {
            // 中英混排优先 eastAsia，其次 ascii / hiAnsi。
            let family = ["eastAsia", "ascii", "hiAnsi"]
                .iter()
                .find_map(|key| {
                    font_value
                        .get(*key)
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_default();
            if !family.is_empty() {
                text_style.insert("fontFamily".to_string(), json!(family));
            }
        }
    }
    if !text_style.is_empty() {
        marks.push(json!({ "type": "textStyle", "attrs": Value::Object(text_style) }));
    }

    if let Some(highlight) = &rp.highlight {
        if let Some(hex) = highlight_color(&ser_str(highlight).unwrap_or_default()) {
            marks.push(json!({ "type": "highlight", "attrs": { "color": hex } }));
        }
    }

    if let Some(href) = link_href {
        if !href.is_empty() {
            marks.push(json!({ "type": "link", "attrs": { "href": href } }));
        }
    }
    marks
}

/// OOXML 颜色（RRGGBB / 可能带 alpha 的 RRGGBBAA / auto）→ 小写 #rrggbb；
/// `auto` 与非法值返回 None（按继承处理，不产生标记）。
fn normalize_hex_color(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("auto") {
        return None;
    }
    let digits = if raw.len() == 8 { &raw[2..] } else { raw };
    if digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Some(format!("#{}", digits.to_ascii_lowercase()));
    }
    None
}

/// OOXML 高亮命名色 → 小写 #rrggbb；`none` 与未知值返回 None。
fn highlight_color(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("none") {
        return None;
    }
    let named: &[(&str, &str)] = &[
        ("yellow", "#ffff00"),
        ("green", "#00ff00"),
        ("cyan", "#00ffff"),
        ("magenta", "#ff00ff"),
        ("blue", "#0000ff"),
        ("red", "#ff0000"),
        ("darkBlue", "#00008b"),
        ("darkCyan", "#008b8b"),
        ("darkGreen", "#006400"),
        ("darkMagenta", "#8b008b"),
        ("darkRed", "#8b0000"),
        ("darkYellow", "#808000"),
        ("darkGray", "#808080"),
        ("lightGray", "#c0c0c0"),
        ("black", "#000000"),
        ("white", "#ffffff"),
    ];
    for (name, hex) in named {
        if raw.eq_ignore_ascii_case(name) {
            return Some(hex.to_string());
        }
    }
    normalize_hex_color(raw)
}

// ========== 段落属性（对齐 / 缩进 / 行距 / 段距） ==========

/// 从样式 ID 或样式名解析标题级别：`Heading1` / `heading 1` / `标题 2` 等
/// （Word 用英文样式名，WPS 中文版写中文样式名）。仅接受 1–6。
fn parse_heading_token(text: &str) -> Option<u8> {
    let lower = text.trim().to_lowercase();
    for prefix in ["heading", "标题"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            if let Ok(level) = rest.trim().parse::<u8>() {
                if (1..=6).contains(&level) {
                    return Some(level);
                }
            }
        }
    }
    None
}

fn paragraph_attrs(pp: &docx_rs::ParagraphProperty) -> Map<String, Value> {
    let mut attrs = Map::new();

    if let Some(justification) = &pp.alignment {
        let mapped = match justification.val.as_str() {
            "left" | "start" => Some("left"),
            "center" => Some("center"),
            "right" | "end" => Some("right"),
            "both" => Some("justify"),
            // distribute 等少数对齐语法不承载，按未设置处理。
            _ => None,
        };
        if let Some(align) = mapped {
            attrs.insert("textAlign".to_string(), json!(align));
        }
    }

    if let Some(indent) = &pp.indent {
        // 缩进优先消费字符单位（*Chars，1/100 字符 ≈ em），退回 twips（1/20 pt）。
        if let Some(chars) = indent.start_chars {
            attrs.insert(
                "indentLeft".to_string(),
                json!(format!("{}em", format_decimal(chars as f64 / 100.0))),
            );
        } else if let Some(start) = indent.start {
            if start != 0 {
                attrs.insert(
                    "indentLeft".to_string(),
                    json!(format!("{}pt", format_decimal(start as f64 / 20.0))),
                );
            }
        }
        if let Some(end) = indent.end {
            if end != 0 {
                attrs.insert(
                    "indentRight".to_string(),
                    json!(format!("{}pt", format_decimal(end as f64 / 20.0))),
                );
            }
        }
        let first_line: Option<String> = if let Some(chars) = indent.first_line_chars {
            Some(format!("{}em", format_decimal(chars as f64 / 100.0)))
        } else if let Some(chars) = indent.hanging_chars {
            Some(format!("-{}em", format_decimal(chars as f64 / 100.0)))
        } else {
            match indent.special_indent {
                Some(SpecialIndentType::FirstLine(twips)) => Some(format!(
                    "{}pt",
                    format_decimal(twips as f64 / 20.0)
                )),
                Some(SpecialIndentType::Hanging(twips)) => Some(format!(
                    "-{}pt",
                    format_decimal(twips as f64 / 20.0)
                )),
                None => None,
            }
        };
        if let Some(value) = first_line {
            if value != "0pt" && value != "-0pt" {
                attrs.insert("textIndent".to_string(), json!(value));
            }
        }
    }

    if let Some(spacing) = &pp.line_spacing {
        let spacing_value = serde_json::to_value(spacing).ok().and_then(|v| {
            v.as_object().cloned()
        });
        if let Some(spacing_value) = spacing_value {
            if let Some(before) = spacing_value.get("before").and_then(Value::as_u64) {
                if before > 0 {
                    attrs.insert(
                        "spacingBefore".to_string(),
                        json!(format!("{}pt", format_decimal(before as f64 / 20.0))),
                    );
                }
            }
            if let Some(after) = spacing_value.get("after").and_then(Value::as_u64) {
                if after > 0 {
                    attrs.insert(
                        "spacingAfter".to_string(),
                        json!(format!("{}pt", format_decimal(after as f64 / 20.0))),
                    );
                }
            }
            let line = spacing_value.get("line").and_then(Value::as_i64);
            let rule = spacing_value
                .get("lineRule")
                .and_then(Value::as_str)
                .unwrap_or("auto");
            if let Some(line) = line {
                if line > 0 {
                    let value = if rule == "auto" {
                        // auto：240 = 单倍行距 → 无单位倍数。
                        format_decimal(line as f64 / 240.0)
                    } else {
                        // exact / atLeast：twips → pt（CSS 无 atLeast，按固定值近似）。
                        format!("{}pt", format_decimal(line as f64 / 20.0))
                    };
                    attrs.insert("lineHeight".to_string(), json!(value));
                }
            }
        }
    }

    attrs
}

// ========== 列表归组与文档组装 ==========

/// 相邻同 numId 的编号段落归组为一个列表；任何非列表块打断归组。
fn group_blocks(paras: Vec<ParaOut>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut items: Vec<Value> = Vec::new();
    let mut current: Option<(usize, bool, u64)> = None;
    for para in paras {
        match (current, para.list) {
            (_, None) => {
                flush_list(&mut out, &mut items, &mut current);
                out.push(para.node);
            }
            (None, Some(list)) => {
                current = Some(list);
                items.push(json!({ "type": "listItem", "content": [para.node] }));
            }
            (Some(cur), Some(list)) if cur.0 == list.0 => {
                items.push(json!({ "type": "listItem", "content": [para.node] }));
            }
            (Some(_), Some(list)) => {
                flush_list(&mut out, &mut items, &mut current);
                current = Some(list);
                items.push(json!({ "type": "listItem", "content": [para.node] }));
            }
        }
    }
    flush_list(&mut out, &mut items, &mut current);
    out
}

fn flush_list(out: &mut Vec<Value>, items: &mut Vec<Value>, current: &mut Option<(usize, bool, u64)>) {
    let Some((_, ordered, start)) = current.take() else {
        return;
    };
    if items.is_empty() {
        return;
    }
    let drained: Vec<Value> = std::mem::take(items);
    let list = if ordered {
        json!({ "type": "orderedList", "attrs": { "start": start }, "content": drained })
    } else {
        json!({ "type": "bulletList", "content": drained })
    };
    out.push(list);
}

fn doc_value_from_blocks(blocks: Vec<Value>) -> Value {
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

fn build_single_doc(paras: &[ParaOut]) -> Value {
    doc_value_from_blocks(group_blocks(paras.to_vec()))
}

/// 按标记边界拆分：标记段落是其后文档的首段；首个标记之前的前言并入第 1 个
/// 文档（design「按 N 个标记拆为 N 个文档」，文字零丢弃）。
fn build_split_docs(paras: &[ParaOut], family: &str) -> Vec<(String, Value)> {
    let markers: Vec<(usize, &str)> = paras
        .iter()
        .enumerate()
        .filter_map(|(index, para)| {
            para.marker
                .as_ref()
                .and_then(|(key, text)| (key == family).then_some((index, text.as_str())))
        })
        .collect();
    let mut docs = Vec::new();
    for (position, (marker_index, name)) in markers.iter().enumerate() {
        let start = if position == 0 { 0 } else { *marker_index };
        let end = markers
            .get(position + 1)
            .map(|(next, _)| *next)
            .unwrap_or(paras.len());
        let segment: Vec<ParaOut> = paras[start..end].to_vec();
        docs.push((name.to_string(), doc_value_from_blocks(group_blocks(segment))));
    }
    docs
}

// ========== 序列标记识别（design D4：保守规则，只建议不执行） ==========

/// 独立成段、整段仅为短序列文本（第X集 / 第X章 / Chapter N 风格）。
fn parse_marker_family(text: &str) -> Option<String> {
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

fn family_sample(key: &str) -> String {
    match key.strip_prefix("cn:") {
        Some(unit) => format!("第X{unit}"),
        None => "Chapter N".to_string(),
    }
}

struct FamilyAgg {
    key: String,
    indices: Vec<usize>,
    texts: Vec<String>,
    sample: String,
}

/// 识别拆分建议：同族标记重复 ≥3 次且全部满足格式一致（v1 规则：全加粗，
/// 已在标记识别时过滤）。多族同时达标时无法唯一判定，保守不建议。
fn detect_split(paras: &[ParaOut]) -> Option<(String, SplitSuggestion)> {
    let mut families: Vec<FamilyAgg> = Vec::new();
    for (index, para) in paras.iter().enumerate() {
        if let Some((key, text)) = &para.marker {
            match families.iter_mut().find(|f| &f.key == key) {
                Some(agg) => {
                    agg.indices.push(index);
                    agg.texts.push(text.clone());
                }
                None => families.push(FamilyAgg {
                    key: key.clone(),
                    indices: vec![index],
                    texts: vec![text.clone()],
                    sample: family_sample(key),
                }),
            }
        }
    }
    let qualifying: Vec<&FamilyAgg> = families
        .iter()
        .filter(|f| f.indices.len() >= MARKER_MIN_REPEAT)
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
            count: family.indices.len(),
            doc_names,
        },
    ))
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

// ========== 文件识别与安全预扫描（design D5） ==========

fn validate_docx_extension(file_path: &Path) -> Result<(), ProjectError> {
    let is_docx = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("docx"));
    if !is_docx {
        return Err(ProjectError::ImportRejected(
            "只支持 .docx 文件；.doc 老格式请先在 Word 或 WPS 中另存为 .docx".to_string(),
        ));
    }
    Ok(())
}

/// 有界读取输入文件（take 上限 +1，杜绝先查长度再读的竞态）。
fn read_docx_bytes(file_path: &Path) -> Result<Vec<u8>, ProjectError> {
    let file =
        fs::File::open(file_path).map_err(|_| ProjectError::ImportRejected("无法读取所选文件".to_string()))?;
    let mut limited = file.take(MAX_IMPORT_INPUT_BYTES + 1);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|_| ProjectError::ImportRejected("无法读取所选文件".to_string()))?;
    if bytes.len() as u64 > MAX_IMPORT_INPUT_BYTES {
        return Err(ProjectError::ImportRejected(format!(
            "文件过大：导入上限为 {} MB",
            MAX_IMPORT_INPUT_BYTES / (1024 * 1024)
        )));
    }
    Ok(bytes)
}

/// ZIP 预扫描产物：document.xml（兼容块计数用）与 docProps（生成器印记）。
#[derive(Debug)]
struct ZipScan {
    document_xml: Option<String>,
    app_xml: Option<String>,
    custom_xml: Option<String>,
}

/// 解压防护 + ZIP 结构判定 + 顺带提取 document.xml / docProps。
///
/// 上限按**真实解压量**执行：逐条目流式读出并在超限时立即中止，保证后续
/// docx-rs 的解压读取不会超出已验证的安全范围（防声明值造假的压缩炸弹）。
fn prescan_zip(bytes: &[u8]) -> Result<ZipScan, ProjectError> {
    let invalid = |msg: String| ProjectError::ImportRejected(msg);
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| invalid("不是有效的 .docx 文件（ZIP 结构损坏）".to_string()))?;

    // D5.1：按 ZIP 结构判断（存在 [Content_Types].xml），不信任系统 MIME。
    if archive.by_name("[Content_Types].xml").is_err() {
        return Err(invalid(
            "不是有效的 .docx 文件：缺少 [Content_Types].xml（请确认文件由 Word 或 WPS 保存）".to_string(),
        ));
    }

    let mut scan = ZipScan {
        document_xml: None,
        app_xml: None,
        custom_xml: None,
    };
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| invalid("压缩包读取失败，文件可能已损坏".to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let capture = matches!(
            name.as_str(),
            "word/document.xml" | "docProps/app.xml" | "docProps/custom.xml"
        );
        let mut captured: Vec<u8> = Vec::new();
        let mut entry_total: u64 = 0;
        let mut chunk = [0u8; 64 * 1024];
        let mut limited = (&mut entry).take(MAX_IMPORT_ENTRY_BYTES + 1);
        loop {
            let read = limited
                .read(&mut chunk)
                .map_err(|_| invalid("压缩包解压失败，文件可能已损坏或已加密".to_string()))?;
            if read == 0 {
                break;
            }
            entry_total += read as u64;
            if entry_total > MAX_IMPORT_ENTRY_BYTES {
                return Err(ProjectError::ImportRejected(format!(
                    "压缩包内单个文件解压后超过 {} MB 上限，已拒绝导入（可能是恶意文件）",
                    MAX_IMPORT_ENTRY_BYTES / (1024 * 1024)
                )));
            }
            total += read as u64;
            if total > MAX_IMPORT_TOTAL_BYTES {
                return Err(ProjectError::ImportRejected(format!(
                    "压缩包解压总量超过 {} MB 上限，已拒绝导入（可能是恶意文件）",
                    MAX_IMPORT_TOTAL_BYTES / (1024 * 1024)
                )));
            }
            if capture {
                captured.extend_from_slice(&chunk[..read]);
            }
        }
        match name.as_str() {
            "word/document.xml" => {
                scan.document_xml = Some(String::from_utf8_lossy(&captured).into_owned())
            }
            "docProps/app.xml" => scan.app_xml = Some(String::from_utf8_lossy(&captured).into_owned()),
            "docProps/custom.xml" => {
                scan.custom_xml = Some(String::from_utf8_lossy(&captured).into_owned())
            }
            _ => {}
        }
    }
    Ok(scan)
}

/// 解析并映射全文。
fn parse_and_map(bytes: &[u8]) -> Result<ParsedDocx, ProjectError> {
    let docx = read_docx_with_options(bytes, ReadDocxOptions::default().with_image_previews(false))
        .map_err(|e| {
            ProjectError::ImportRejected(format!("文件解析失败：不是有效的 Word 文档（{e:?}）"))
        })?;
    let mut converter = Converter::new(&docx);
    let paras = converter.walk_document(&docx);
    Ok(ParsedDocx {
        paras,
        losses: converter.losses,
        char_count: converter.char_count,
        paragraph_count: converter.paragraph_count,
    })
}

// ========== docProps 生成器印记与兼容块计数（D5.2 / D5.5） ==========

fn extract_generator(scan: &ZipScan) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(app) = &scan.app_xml {
        if let Some(application) = extract_simple_tag(app, "Application") {
            parts.push(application);
        }
    }
    if let Some(custom) = &scan.custom_xml {
        if let Some(build) = extract_custom_property(custom, "KSOProductBuildVer") {
            parts.push(format!("KSOProductBuildVer {build}"));
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" / "))
    }
}

fn extract_simple_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = xml.find(&open)?;
    let after = &xml[start..];
    let content_start = after.find('>')? + 1;
    let close = format!("</{tag}>");
    let end = after[content_start..].find(&close)? + content_start;
    let content = after[content_start..end]
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn extract_custom_property(xml: &str, name: &str) -> Option<String> {
    let needle = format!("name=\"{name}\"");
    let position = xml.find(&needle)?;
    let rest = &xml[position..];
    let open = rest.find("<vt:lpwstr>")? + "<vt:lpwstr>".len();
    let close = rest[open..].find("</vt:lpwstr>")? + open;
    Some(rest[open..close].trim().to_string())
}

/// 按本地名统计开始标签数（与命名空间前缀无关；忽略结束标签与声明）。
fn count_open_tags_local_name(xml: &str, local: &str) -> usize {
    let bytes = xml.as_bytes();
    let mut count = 0;
    let mut position = 0;
    while let Some(rel) = bytes[position..]
        .iter()
        .position(|&b| b == b'<')
        .map(|p| p + position)
    {
        let mut end = rel + 1;
        if end < bytes.len() && matches!(bytes[end], b'/' | b'!' | b'?') {
            position = rel + 1;
            continue;
        }
        let name_start = end;
        while end < bytes.len()
            && (bytes[end].is_ascii_alphanumeric() || matches!(bytes[end], b':' | b'_' | b'-' | b'.'))
        {
            end += 1;
        }
        if let Some(local_name) = xml[name_start..end].rsplit(':').next() {
            if local_name.eq_ignore_ascii_case(local) {
                count += 1;
            }
        }
        position = rel + 1;
    }
    count
}

/// 缺 Fallback 的 AlternateContent 计数：每个 AlternateContent 至多一个
/// Fallback 子元素，两计数之差即缺 Fallback 的兼容块数（近似，用于告知）。
fn count_missing_fallback_blocks(document_xml: &str) -> usize {
    let alternate = count_open_tags_local_name(document_xml, "AlternateContent");
    let fallback = count_open_tags_local_name(document_xml, "Fallback");
    alternate.saturating_sub(fallback)
}

/// 统计 document.xml 中的脚注引用标记数。
///
/// docx-rs 0.4.22 读侧**没有** `w:footnoteReference` 的解析路径（XMLElement
/// 无该变体、读取器无对应分支，元素被静默忽略），模型层永远看不到脚注引用；
/// 因此脚注计数与 AlternateContent 同通道，在预扫描捕获的 document.xml 上
/// 按本地名计数（WPS 与 Word 的脚注引用都写在正文的 run 内）。
fn count_footnote_references(document_xml: &str) -> usize {
    count_open_tags_local_name(document_xml, "footnoteReference")
}

// ========== 命名与工具 ==========

/// 文档 / 文件夹名净化：替换文件系统非法字符为空格、折叠空白、去尾部点号；
/// 空名回退 fallback（名称是元数据，净化不违反「文字逐字一致」边界）。
fn sanitize_node_name(raw: &str, fallback: &str) -> String {
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

fn doc_name_from_file(file_path: &Path) -> String {
    let stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("导入文档");
    sanitize_node_name(stem, "导入文档")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn format_decimal(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    let mut text = format!("{rounded:.2}");
    if text.contains('.') {
        text = text.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    text
}

fn ser_flag(value: Option<&impl Serialize>) -> bool {
    value
        .and_then(|v| serde_json::to_value(v).ok())
        .and_then(|v| v.as_bool())
        == Some(true)
}

fn ser_str(value: &impl Serialize) -> Option<String> {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

fn ser_u64(value: &impl Serialize) -> Option<u64> {
    serde_json::to_value(value).ok().and_then(|v| v.as_u64())
}

// ========== 预检命令（零写入） ==========

/// 解析并返回预览：字数、段落数、默认文档名、损耗清单、拆分建议、内容哈希、
/// 生成器印记。作品校验走严格只读路径（发现待恢复事务即失败关闭，绝不写入）。
pub fn import_docx_preview(project_root: &Path, file_path: &Path) -> Result<ImportPreview, ProjectError> {
    super::strict_read_content_tree(project_root)?;
    validate_docx_extension(file_path)?;
    let bytes = read_docx_bytes(file_path)?;
    let content_hash = sha256_hex(&bytes);
    let scan = prescan_zip(&bytes)?;
    let generator = extract_generator(&scan);
    let block_skipped = scan
        .document_xml
        .as_deref()
        .map(count_missing_fallback_blocks)
        .unwrap_or(0);
    // 脚注引用计数走 document.xml 扫描通道（docx-rs 读侧不解析
    // w:footnoteReference，见 count_footnote_references 文档），合并进损耗
    // 计数器后再统一生成告知文案。
    let footnote_refs = scan
        .document_xml
        .as_deref()
        .map(count_footnote_references)
        .unwrap_or(0);
    let mut parsed = parse_and_map(&bytes)?;
    parsed.losses.footnotes += footnote_refs;

    // 映射健全性自检：整文件单文档形态必须通过既有严格语法校验，
    // 把映射缺陷挡在用户确认之前。
    let single = build_single_doc(&parsed.paras);
    super::validate_notebook_document(&single).map_err(|e| {
        ProjectError::ImportRejected(format!("导入映射内部校验失败：{e}"))
    })?;

    let mut losses = parsed.losses.into_losses();
    if block_skipped > 0 {
        losses.push(ImportLoss {
            kind: "block_skipped".to_string(),
            count: block_skipped,
            note: format!("{block_skipped} 个兼容块（AlternateContent）缺少回退内容，已跳过"),
        });
    }

    Ok(ImportPreview {
        char_count: parsed.char_count,
        paragraph_count: parsed.paragraph_count,
        default_doc_name: doc_name_from_file(file_path),
        losses,
        split_suggestion: detect_split(&parsed.paras).map(|(_, suggestion)| suggestion),
        content_hash,
        generator,
    })
}

// ========== 提交命令（重解析 + 哈希比对 + 单事务落盘） ==========

/// 重新解析并落盘：内容哈希与预览不一致即拒绝（前端提示重新预检）；
/// 全部新文档经一次映射式事务原子提交，任何失败都不留部分完成的结构。
pub fn import_docx_commit(
    project_root: &Path,
    file_path: &Path,
    parent_id: Option<&str>,
    split: bool,
    expected_hash: &str,
) -> Result<ImportCommitResult, ProjectError> {
    validate_docx_extension(file_path)?;
    let bytes = read_docx_bytes(file_path)?;
    let content_hash = sha256_hex(&bytes);
    if !content_hash.eq_ignore_ascii_case(expected_hash.trim()) {
        return Err(ProjectError::ImportHashMismatch);
    }

    let parsed = parse_and_map(&bytes)?;
    let default_name = doc_name_from_file(file_path);

    // 组装文档集：默认整文件一个文档；用户选择拆分且存在唯一达标标记族时
    // 按标记边界拆分（拆分请求但无标记时回退单文档）。
    let (docs, folder_name): (Vec<(String, Value)>, Option<String>) = if split {
        match detect_split(&parsed.paras) {
            Some((family, _)) => (
                build_split_docs(&parsed.paras, &family),
                Some(default_name.clone()),
            ),
            None => (
                vec![(default_name.clone(), build_single_doc(&parsed.paras))],
                None,
            ),
        }
    } else {
        (
            vec![(default_name.clone(), build_single_doc(&parsed.paras))],
            None,
        )
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
            let unique = unique_sibling_name(&tree, parent_id, &sanitize_node_name(&name, "导入文件夹"), &folder_id);
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

// ========== 测试 ==========

#[cfg(test)]
mod tests {
    use super::*;
    use docx_rs::{
        AbstractNumbering, AlignmentType, Delete, Docx, IndentLevel, Insert, Level, LevelJc,
        LevelText, LineSpacing, LineSpacingType, NumberFormat, NumberingId, Paragraph, Run,
        RunFonts, Start, Style, StyleType, Table, TableCell, TableRow,
    };
    use std::io::Write as _;

    // ----- 夹具工具 -----

    fn pack(docx: Docx) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        docx.build().pack(&mut cursor).expect("pack docx");
        cursor.into_inner()
    }

    fn parse(bytes: &[u8]) -> ParsedDocx {
        prescan_zip(bytes).expect("prescan");
        parse_and_map(bytes).expect("parse and map")
    }

    fn blocks_of(parsed: &ParsedDocx) -> Vec<Value> {
        group_blocks(parsed.paras.clone())
    }

    fn para(text: &str) -> Paragraph {
        Paragraph::new().add_run(Run::new().add_text(text))
    }

    fn bold_para(text: &str) -> Paragraph {
        Paragraph::new().add_run(Run::new().bold().add_text(text))
    }

    fn block_text(block: &Value) -> String {
        block
            .get("content")
            .and_then(Value::as_array)
            .map(|nodes| {
                nodes
                    .iter()
                    .map(|n| n.get("text").and_then(Value::as_str).unwrap_or(""))
                    .collect::<String>()
            })
            .unwrap_or_default()
    }

    /// 手工构造最小 .docx ZIP（用于写入侧无法表达的构造，如缺 Fallback 的
    /// AlternateContent、*Chars 缩进）。属性顺序与 docx-rs ContentTypes 读取器
    /// 约定一致；包含 read_docx 必需的包级与文档级关系部件。
    fn write_minimal_docx(document_xml: &str) -> Vec<u8> {
        const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" PartName="/word/document.xml"/></Types>"#;
        const RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
        const DOC_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#;
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        writer
            .start_file("[Content_Types].xml", options)
            .expect("start content types");
        writer.write_all(CONTENT_TYPES.as_bytes()).unwrap();
        writer
            .start_file("_rels/.rels", options)
            .expect("start rels");
        writer.write_all(RELS.as_bytes()).unwrap();
        writer
            .start_file("word/_rels/document.xml.rels", options)
            .expect("start doc rels");
        writer.write_all(DOC_RELS.as_bytes()).unwrap();
        writer
            .start_file("word/document.xml", options)
            .expect("start document");
        writer.write_all(document_xml.as_bytes()).unwrap();
        writer.finish().expect("finish zip").into_inner()
    }

    // ----- 文件识别与防护 -----

    #[test]
    fn rejects_non_docx_extension_and_non_zip_bytes() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = super::super::create_new_project(super::super::CreateProjectParams {
            name: "识别测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");

        let txt = temp.path().join("样本.txt");
        fs::write(&txt, "hello").unwrap();
        let error = import_docx_preview(&root, &txt).unwrap_err();
        assert!(error.to_string().contains(".docx"), "报错：{error}");

        let fake = temp.path().join("假文档.docx");
        fs::write(&fake, b"not a zip at all").unwrap();
        let error = import_docx_preview(&root, &fake).unwrap_err();
        assert!(
            error.to_string().contains("不是有效的 .docx 文件"),
            "报错：{error}"
        );
    }

    #[test]
    fn oversized_input_rejected_before_parse() {
        let temp = tempfile::TempDir::new().unwrap();
        let big = temp.path().join("超大.docx");
        let zeros = vec![0u8; MAX_IMPORT_INPUT_BYTES as usize + 1];
        fs::write(&big, zeros).unwrap();
        let error = read_docx_bytes(&big).unwrap_err();
        assert!(
            error.to_string().contains("文件过大"),
            "报错：{error}"
        );
    }

    #[test]
    fn compression_bomb_rejected_with_chinese_error() {
        // 单条目真实解压量超过上限：70 MB 全零 deflate 后极小，但预扫描按
        // 实际读出量执行，必须在解析前拒绝。
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer
            .start_file("[Content_Types].xml", options)
            .expect("start content types");
        writer.write_all(b"<Types/>").unwrap();
        writer
            .start_file("bomb.xml", options)
            .expect("start bomb");
        let zeros = vec![0u8; 70 * 1024 * 1024];
        writer.write_all(&zeros).unwrap();
        let bytes = writer.finish().expect("finish").into_inner();
        assert!(bytes.len() < 1024 * 1024, "炸弹压缩后应很小");

        let error = prescan_zip(&bytes).unwrap_err();
        let message = error.to_string();
        assert!(
            message.contains("解压后超过") && message.contains("已拒绝导入"),
            "报错：{message}"
        );
    }

    // ----- 编号：墓碑不编号，真编号转列表 -----

    #[test]
    fn tombstone_numbering_stays_plain_but_real_numbering_becomes_list() {
        let docx = Docx::new()
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("列表一")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(0), IndentLevel::new(0))
                    .add_run(Run::new().add_text("墓碑段落")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("列表二")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("列表三")),
            );
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);

        // 墓碑段落打断列表：[列表(1)] [墓碑普通段] [列表(2)]。
        assert_eq!(blocks.len(), 3, "块数：{blocks:#?}");
        let first = &blocks[0];
        assert_eq!(first["type"], "orderedList");
        assert_eq!(first["attrs"]["start"], 1);
        assert_eq!(first["content"].as_array().unwrap().len(), 1);
        // 墓碑段落：普通段落、无编号、文字完整。
        assert_eq!(blocks[1]["type"], "paragraph");
        assert_eq!(block_text(&blocks[1]), "墓碑段落");
        // 墓碑之后相邻同编号段落归组为一个列表。
        assert_eq!(blocks[2]["type"], "orderedList");
        assert_eq!(blocks[2]["content"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn numbering_with_empty_lvltext_is_not_a_list() {
        // abstractNum 10 的第 0 层 lvlText 为空：编号不可见 → 普通段落。
        let empty_text_abstract = AbstractNumbering::new(10).add_level(Level::new(
            0,
            Start::new(1),
            NumberFormat::new("decimal"),
            LevelText::new(""),
            LevelJc::new("left"),
        ));
        let docx = Docx::new()
            .add_abstract_numbering(empty_text_abstract)
            .add_numbering(docx_rs::Numbering::new(7, 10))
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(7), IndentLevel::new(0))
                    .add_run(Run::new().add_text("不可见编号")),
            );
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], "paragraph");
        assert_eq!(block_text(&blocks[0]), "不可见编号");
        assert!(
            parsed.losses.numbering_degraded >= 1,
            "不可见定义应计入降级告知"
        );
    }

    #[test]
    fn bullet_numbering_becomes_bullet_list() {
        let bullet_abstract = AbstractNumbering::new(20).add_level(Level::new(
            0,
            Start::new(1),
            NumberFormat::new("bullet"),
            LevelText::new("•"),
            LevelJc::new("left"),
        ));
        let docx = Docx::new()
            .add_abstract_numbering(bullet_abstract)
            .add_numbering(docx_rs::Numbering::new(3, 20))
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(3), IndentLevel::new(0))
                    .add_run(Run::new().add_text("项目")),
            );
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);
        assert_eq!(blocks[0]["type"], "bulletList");
    }

    // ----- 表格拍平 -----

    #[test]
    fn table_flattens_each_cell_into_paragraph() {
        let table = Table::new(vec![TableRow::new(vec![
            TableCell::new().add_paragraph(para("左格")),
            TableCell::new().add_paragraph(para("右格")),
        ])]);
        let docx = Docx::new()
            .add_paragraph(para("表格前"))
            .add_table(table)
            .add_paragraph(para("表格后"));
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);

        assert_eq!(parsed.losses.tables, 1);
        let texts: Vec<String> = blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["表格前", "左格", "右格", "表格后"]);
        assert!(blocks.iter().all(|b| b["type"] == "paragraph"));
    }

    // ----- run 级格式与段落属性 -----

    #[test]
    fn run_marks_preserved_and_rank_ordered() {
        let run = Run::new()
            .bold()
            .italic()
            .strike()
            .underline("single")
            .color("FF0000")
            .size(24)
            .highlight("yellow")
            .fonts(RunFonts::new().east_asia("宋体"))
            .add_text("格式文字");
        let docx = Docx::new().add_paragraph(Paragraph::new().add_run(run));
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);

        let marks = &blocks[0]["content"][0]["marks"];
        let types: Vec<&str> = marks
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["type"].as_str().unwrap())
            .collect();
        assert_eq!(types, vec!["bold", "italic", "underline", "strike", "textStyle", "highlight"]);
        let text_style = &blocks[0]["content"][0]["marks"][4]["attrs"];
        assert_eq!(text_style["color"], "#ff0000");
        assert_eq!(text_style["fontSize"], "12pt");
        assert_eq!(text_style["fontFamily"], "宋体");
        assert_eq!(blocks[0]["content"][0]["marks"][5]["attrs"]["color"], "#ffff00");
    }

    #[test]
    fn paragraph_attrs_mapped_to_editor_units() {
        // docx-rs 写侧不输出 *Chars 缩进，这里走 twips 路径（w:firstLine）；
        // 字符单位路径由 chars 缩进专项测试覆盖。
        let paragraph = Paragraph::new()
            .align(AlignmentType::Center)
            .indent(Some(420), Some(SpecialIndentType::FirstLine(400)), None, None)
            .line_spacing(
                LineSpacing::new()
                    .line_rule(LineSpacingType::Auto)
                    .line(360)
                    .before(120)
                    .after(60),
            )
            .add_run(Run::new().add_text("属性文字"));
        let docx = Docx::new().add_paragraph(paragraph);
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);

        let attrs = &blocks[0]["attrs"];
        assert_eq!(attrs["textAlign"], "center");
        assert_eq!(attrs["textIndent"], "20pt");
        assert_eq!(attrs["indentLeft"], "21pt");
        assert_eq!(attrs["lineHeight"], "1.5");
        assert_eq!(attrs["spacingBefore"], "6pt");
        assert_eq!(attrs["spacingAfter"], "3pt");
    }

    #[test]
    fn chars_based_indents_prefer_em_units() {
        // 写侧无法表达 *Chars 缩进，用手工最小 docx 驱动读侧路径：
        // firstLineChars=200 → 2em；leftChars=100 → 1em；hangingChars=50 → -0.5em。
        let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:ind w:firstLineChars="200" w:leftChars="100"/></w:pPr><w:r><w:t>甲</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:hangingChars="50"/></w:pPr><w:r><w:t>乙</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let parsed = parse(&write_minimal_docx(document_xml));
        let blocks = blocks_of(&parsed);
        assert_eq!(blocks[0]["attrs"]["textIndent"], "2em");
        assert_eq!(blocks[0]["attrs"]["indentLeft"], "1em");
        assert_eq!(blocks[1]["attrs"]["textIndent"], "-0.5em");
    }

    #[test]
    fn heading_style_maps_level_from_id_and_chinese_name() {
        let docx = Docx::new()
            .add_style(Style::new("Heading1", StyleType::Paragraph).name("heading 1"))
            .add_style(Style::new("s2", StyleType::Paragraph).name("标题 2"))
            .add_paragraph(Paragraph::new().style("Heading1").add_run(Run::new().add_text("一级")))
            .add_paragraph(Paragraph::new().style("s2").add_run(Run::new().add_text("二级")))
            .add_paragraph(para("普通"));
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);

        assert_eq!(blocks[0]["type"], "heading");
        assert_eq!(blocks[0]["attrs"]["level"], 1);
        assert_eq!(block_text(&blocks[0]), "一级");
        assert_eq!(blocks[1]["type"], "heading");
        assert_eq!(blocks[1]["attrs"]["level"], 2);
        assert_eq!(blocks[2]["type"], "paragraph");
    }

    #[test]
    fn empty_paragraphs_preserved_and_adjacent_same_marks_merged() {
        let docx = Docx::new()
            .add_paragraph(Paragraph::new().add_run(Run::new().bold().add_text("加粗")))
            .add_paragraph(Paragraph::new())
            .add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().bold().add_text("同格式"))
                    .add_run(Run::new().bold().add_text("相邻合并")),
            );
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);

        assert_eq!(blocks.len(), 3);
        // 空段落原样保留（无 content 键）。
        assert_eq!(blocks[1]["type"], "paragraph");
        assert!(blocks[1].get("content").is_none());
        // 相邻同 marks 文本必须合并为单节点（canonical 硬性要求）。
        let content = blocks[2]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1);
        assert_eq!(block_text(&blocks[2]), "同格式相邻合并");
    }

    #[test]
    fn produced_single_doc_passes_strict_grammar() {
        let docx = Docx::new()
            .add_paragraph(bold_para("第一段"))
            .add_paragraph(Paragraph::new())
            .add_paragraph(
                Paragraph::new()
                    .align(AlignmentType::Right)
                    .add_run(Run::new().color("00ff00").size(28).add_text("绿色十四磅")),
            );
        let parsed = parse(&pack(docx));
        let value = build_single_doc(&parsed.paras);
        super::super::validate_notebook_document(&value)
            .expect("映射产物必须通过既有严格语法校验");
    }

    // ----- 修订最终态 -----

    #[test]
    fn revisions_take_final_state() {
        let paragraph = Paragraph::new()
            .add_insert(Insert::new(Run::new().add_text("保留")))
            .add_delete(
                Delete::new()
                    .add_run(Run::new().add_delete_text("丢弃")),
            )
            .add_run(Run::new().add_text("尾巴"));
        let docx = Docx::new().add_paragraph(paragraph);
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);

        assert_eq!(blocks.len(), 1);
        assert_eq!(block_text(&blocks[0]), "保留尾巴");
        assert_eq!(parsed.losses.revisions, 2, "ins 与 del 各计一处修订");
    }

    // ----- 缺 Fallback 的 AlternateContent -----

    #[test]
    fn alternate_content_without_fallback_skipped_and_counted() {
        let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p><w:r><w:t>正文段落</w:t></w:r></w:p>
    <w:p>
      <mc:AlternateContent>
        <mc:Choice Requires="wps"><w:r><w:t>兼容块文字</w:t></w:r></mc:Choice>
      </mc:AlternateContent>
    </w:p>
  </w:body>
</w:document>"#;
        let bytes = write_minimal_docx(document_xml);

        let temp = tempfile::TempDir::new().unwrap();
        let root = super::super::create_new_project(super::super::CreateProjectParams {
            name: "兼容块测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let file = temp.path().join("兼容样本.docx");
        fs::write(&file, &bytes).unwrap();

        let preview = import_docx_preview(&root, &file).expect("缺 Fallback 不得崩溃");
        let skipped = preview
            .losses
            .iter()
            .find(|loss| loss.kind == "block_skipped")
            .expect("必须计入告知");
        assert_eq!(skipped.count, 1);
    }

    // ----- 序列标记识别 -----

    #[test]
    fn episode_markers_suggest_split() {
        let docx = Docx::new()
            .add_paragraph(para("前言：剧本信息"))
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(para("第一集正文"))
            .add_paragraph(bold_para("第2集"))
            .add_paragraph(para("第二集正文"))
            .add_paragraph(bold_para("第3集"))
            .add_paragraph(para("第三集正文"));
        let parsed = parse(&pack(docx));
        let (family, suggestion) = detect_split(&parsed.paras).expect("应识别集数标记");

        assert_eq!(family, "cn:集");
        assert_eq!(suggestion.marker_sample, "第X集");
        assert_eq!(suggestion.count, 3);
        assert_eq!(suggestion.doc_names, vec!["第1集", "第2集", "第3集"]);
    }

    #[test]
    fn non_bold_or_sparse_markers_do_not_suggest() {
        // 不加粗的标记：格式不一致，不建议。
        let docx = Docx::new()
            .add_paragraph(para("第1集"))
            .add_paragraph(para("第2集"))
            .add_paragraph(para("第3集"));
        let parsed = parse(&pack(docx));
        assert!(detect_split(&parsed.paras).is_none());

        // 加粗但重复不足 3 次：不建议。
        let sparse = Docx::new()
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(bold_para("第2集"));
        let parsed = parse(&pack(sparse));
        assert!(detect_split(&parsed.paras).is_none());
    }

    #[test]
    fn chapter_markers_also_recognized() {
        let docx = Docx::new()
            .add_paragraph(bold_para("Chapter 1"))
            .add_paragraph(para("one"))
            .add_paragraph(bold_para("Chapter 2"))
            .add_paragraph(para("two"))
            .add_paragraph(bold_para("Chapter 3"));
        let parsed = parse(&pack(docx));
        let (family, suggestion) = detect_split(&parsed.paras).expect("应识别章标记");
        assert_eq!(family, "en:chapter");
        assert_eq!(suggestion.marker_sample, "Chapter N");
        assert_eq!(suggestion.count, 3);
    }

    // ----- 预检与提交端到端 -----

    fn seed_project(name: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let temp = tempfile::TempDir::new().unwrap();
        let root =
            super::super::create_new_project(super::super::CreateProjectParams {
                name: name.to_string(),
                save_location: temp.path().to_string_lossy().to_string(),
            })
            .expect("create project");
        (temp, root)
    }

    fn simple_docx_bytes() -> Vec<u8> {
        pack(Docx::new()
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(para("第一集正文"))
            .add_paragraph(Paragraph::new())
            .add_paragraph(bold_para("第2集"))
            .add_paragraph(para("第二集正文")))
    }

    #[test]
    fn preview_reports_counts_hash_and_no_suggestion_below_threshold() {
        let (temp, root) = seed_project("预览测试");
        let file = temp.path().join("我的剧本.docx");
        let bytes = simple_docx_bytes();
        fs::write(&file, &bytes).unwrap();

        let preview = import_docx_preview(&root, &file).expect("预览");
        assert_eq!(preview.default_doc_name, "我的剧本");
        assert_eq!(preview.char_count, "第1集第一集正文第2集第二集正文".chars().count());
        assert_eq!(preview.paragraph_count, 5);
        // docx 打包含时间戳，哈希必须对同一份字节计算。
        assert_eq!(preview.content_hash, sha256_hex(&bytes));
        assert!(preview.generator.is_none());
        // 只有 2 个标记（<3）：不产生拆分建议。
        assert!(preview.split_suggestion.is_none());
        // 纯文字与已支持格式：无损耗项。
        assert!(preview.losses.is_empty(), "损耗：{:?}", preview.losses);
    }

    #[test]
    fn preview_requires_three_markers_for_suggestion() {
        let (temp, root) = seed_project("预览建议测试");
        let file = temp.path().join("我的剧本.docx");
        let bytes = pack(Docx::new()
            .add_paragraph(para("前言"))
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(para("一"))
            .add_paragraph(bold_para("第2集"))
            .add_paragraph(para("二"))
            .add_paragraph(bold_para("第3集"))
            .add_paragraph(para("三")));
        fs::write(&file, bytes).unwrap();

        let preview = import_docx_preview(&root, &file).expect("预览");
        let suggestion = preview.split_suggestion.expect("3 个标记应产生建议");
        assert_eq!(suggestion.doc_names, vec!["第1集", "第2集", "第3集"]);
    }

    #[test]
    fn commit_single_doc_creates_validated_document() {
        let (temp, root) = seed_project("提交测试");
        let file = temp.path().join("我的剧本.docx");
        fs::write(&file, simple_docx_bytes()).unwrap();

        let preview = import_docx_preview(&root, &file).expect("预览");
        let result =
            import_docx_commit(&root, &file, None, false, &preview.content_hash).expect("提交");

        assert_eq!(result.created_doc_ids.len(), 1);
        assert!(result.created_folder_id.is_none());

        let tree = super::super::recover_then_read_content_tree(&root).unwrap();
        let doc_id = &result.created_doc_ids[0];
        let node = tree.nodes.get(doc_id).unwrap();
        assert_eq!(node.name, "我的剧本");
        assert!(node.ai_visible, "导入文档 AI 可见性默认与新建文档一致");
        assert!(tree.root_children.contains(doc_id));

        let notebook = fs::read_to_string(
            ProjectPaths::new(root.clone()).document_file(doc_id),
        )
        .unwrap();
        let value: Value = serde_json::from_str(&notebook).unwrap();
        super::super::validate_notebook_document(&value).expect("落盘文档必须通过严格校验");
        let text: Vec<String> = value["document"]["content"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| {
                b.get("content")
                    .and_then(Value::as_array)
                    .map(|ns| {
                        ns.iter()
                            .map(|n| n["text"].as_str().unwrap_or(""))
                            .collect::<String>()
                    })
                    .unwrap_or_default()
            })
            .collect();
        assert_eq!(text, vec!["第1集", "第一集正文", "", "第2集", "第二集正文"]);
    }

    #[test]
    fn commit_hash_mismatch_fails_without_residue() {
        let (temp, root) = seed_project("哈希测试");
        let file = temp.path().join("剧本.docx");
        fs::write(&file, simple_docx_bytes()).unwrap();

        let before = super::super::recover_then_read_content_tree(&root).unwrap();
        let error = import_docx_commit(&root, &file, None, false, "deadbeef").unwrap_err();
        assert!(
            error.to_string().starts_with("hash_mismatch:"),
            "错误信息必须带 hash_mismatch: 前缀：{error}"
        );
        let after = super::super::recover_then_read_content_tree(&root).unwrap();
        assert_eq!(before, after, "哈希不一致时内容树不得有任何变化");
    }

    #[test]
    fn commit_split_creates_folder_and_docs_with_preamble_kept() {
        let (temp, root) = seed_project("拆分提交测试");
        let file = temp.path().join("全本剧本.docx");
        let bytes = pack(Docx::new()
            .add_paragraph(para("前言：剧本信息"))
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(para("第一集正文"))
            .add_paragraph(bold_para("第2集"))
            .add_paragraph(para("第二集正文"))
            .add_paragraph(bold_para("第3集"))
            .add_paragraph(para("第三集正文")));
        fs::write(&file, bytes).unwrap();

        let preview = import_docx_preview(&root, &file).expect("预览");
        assert!(preview.split_suggestion.is_some());
        let result =
            import_docx_commit(&root, &file, None, true, &preview.content_hash).expect("拆分提交");

        assert_eq!(result.created_doc_ids.len(), 3);
        let folder_id = result.created_folder_id.expect("应创建文件夹");

        let tree = super::super::recover_then_read_content_tree(&root).unwrap();
        assert_eq!(tree.nodes[&folder_id].name, "全本剧本");
        let names: Vec<&str> = result
            .created_doc_ids
            .iter()
            .map(|id| tree.nodes[id].name.as_str())
            .collect();
        assert_eq!(names, vec!["第1集", "第2集", "第3集"]);
        for id in &result.created_doc_ids {
            assert!(tree.nodes[&folder_id].children.contains(id));
            let notebook =
                fs::read_to_string(ProjectPaths::new(root.clone()).document_file(id)).unwrap();
            let value: Value = serde_json::from_str(&notebook).unwrap();
            super::super::validate_notebook_document(&value).expect("每份拆分文档须通过校验");
        }

        // 前言并入第 1 个文档且文字零丢失。
        let first = fs::read_to_string(
            ProjectPaths::new(root.clone()).document_file(&result.created_doc_ids[0]),
        )
        .unwrap();
        assert!(first.contains("前言：剧本信息"));
        assert!(first.contains("第一集正文"));
        // 既有文档（创建作品时的默认文档）不受影响。
        let default_doc = &tree.root_children[0];
        assert_ne!(default_doc, &folder_id);
    }

    #[test]
    fn commit_dedupes_repeated_marker_names_and_existing_siblings() {
        let (temp, root) = seed_project("重名测试");
        let file = temp.path().join("重复标记.docx");
        // 两个「第1集」标记 + 第2集：重复名须唯一化。
        let bytes = pack(Docx::new()
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(para("甲"))
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(para("乙"))
            .add_paragraph(bold_para("第2集"))
            .add_paragraph(para("丙")));
        fs::write(&file, bytes).unwrap();

        let preview = import_docx_preview(&root, &file).expect("预览");
        let suggestion = preview.split_suggestion.expect("建议");
        assert_eq!(suggestion.doc_names, vec!["第1集", "第1集 2", "第2集"]);

        let result =
            import_docx_commit(&root, &file, None, true, &preview.content_hash).expect("提交");
        let tree = super::super::recover_then_read_content_tree(&root).unwrap();
        let names: Vec<&str> = result
            .created_doc_ids
            .iter()
            .map(|id| tree.nodes[id].name.as_str())
            .collect();
        assert_eq!(names, vec!["第1集", "第1集 2", "第2集"]);
    }

    #[test]
    fn commit_into_existing_folder_and_rejects_document_parent() {
        let (temp, root) = seed_project("目标测试");
        let file = temp.path().join("目标文档.docx");
        fs::write(&file, simple_docx_bytes()).unwrap();

        let folder = super::super::create_folder(&root, None).expect("建文件夹");
        let preview = import_docx_preview(&root, &file).expect("预览");
        let result = import_docx_commit(&root, &file, Some(&folder), false, &preview.content_hash)
            .expect("提交到文件夹");
        let tree = super::super::recover_then_read_content_tree(&root).unwrap();
        assert!(tree.nodes[&folder].children.contains(&result.created_doc_ids[0]));

        // 文档节点不能作为父级。
        let doc_parent = tree.root_children[0].clone();
        let error =
            import_docx_commit(&root, &file, Some(&doc_parent), false, &preview.content_hash)
                .unwrap_err();
        assert!(error.to_string().contains("文件夹"), "报错：{error}");
    }

    // ----- 工具函数 -----

    #[test]
    fn hex_and_highlight_normalization() {
        assert_eq!(normalize_hex_color("FF0000").as_deref(), Some("#ff0000"));
        assert_eq!(normalize_hex_color("auto"), None);
        assert_eq!(normalize_hex_color(""), None);
        assert_eq!(normalize_hex_color("80FF0000").as_deref(), Some("#ff0000"));
        assert_eq!(normalize_hex_color("xyz"), None);
        assert_eq!(highlight_color("yellow").as_deref(), Some("#ffff00"));
        assert_eq!(highlight_color("none"), None);
        assert_eq!(highlight_color("FFFF00").as_deref(), Some("#ffff00"));
    }

    #[test]
    fn marker_pattern_cases() {
        assert_eq!(parse_marker_family("第1集").as_deref(), Some("cn:集"));
        assert_eq!(parse_marker_family(" 第六十一集 ").as_deref(), Some("cn:集"));
        assert_eq!(parse_marker_family("第X章"), None);
        assert_eq!(parse_marker_family("chapter 12").as_deref(), Some("en:chapter"));
        assert_eq!(parse_marker_family("Chapter 1").as_deref(), Some("en:chapter"));
        assert_eq!(parse_marker_family("第一章的正文内容很长"), None);
        assert_eq!(parse_marker_family("正"), None);
    }

    #[test]
    fn name_sanitization() {
        assert_eq!(sanitize_node_name("第1集", "回退"), "第1集");
        assert_eq!(sanitize_node_name("a:b*c?d", "回退"), "a b c d");
        assert_eq!(sanitize_node_name("  名字. ", "回退"), "名字");
        assert_eq!(sanitize_node_name("...", "回退"), "回退");
    }

    #[test]
    fn missing_fallback_counting_ignores_prefix_and_closing_tags() {
        let xml = r#"<w:document xmlns:mc="x"><mc:AlternateContent><mc:Choice/></mc:AlternateContent><p:AlternateContent><p:Fallback/></p:AlternateContent></w:document>"#;
        assert_eq!(count_open_tags_local_name(xml, "AlternateContent"), 2);
        assert_eq!(count_open_tags_local_name(xml, "Fallback"), 1);
        assert_eq!(count_missing_fallback_blocks(xml), 1);
    }

    #[test]
    fn footnote_reference_counting_scans_local_names() {
        // 读侧不解析 w:footnoteReference（见 count_footnote_references 文档），
        // 计数依赖本地名扫描：前缀无关、不受结束标签与属性干扰。
        let xml = r#"<w:document><w:body><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:p><w:r><x:footnoteReference w:id="2"/></w:r></w:p><w:p><w:r><w:footnoteRef/></w:r></w:p></w:body></w:document>"#;
        assert_eq!(count_footnote_references(xml), 2);
    }

    #[test]
    fn generator_extracted_from_doc_props() {
        let app = r#"<Properties xmlns="x"><Application>WPS Office</Application></Properties>"#;
        let custom = r#"<Properties xmlns="x"><Property fmtid="a" pid="1" name="KSOProductBuildVer"><vt:lpwstr>12.1.0.26375</vt:lpwstr></Property></Properties>"#;
        let scan = ZipScan {
            document_xml: None,
            app_xml: Some(app.to_string()),
            custom_xml: Some(custom.to_string()),
        };
        assert_eq!(
            extract_generator(&scan).as_deref(),
            Some("WPS Office / KSOProductBuildVer 12.1.0.26375")
        );
    }

    // 引入未直接使用但保证链接的公共项（文档化用意：这些是模块的对外面）。
    #[allow(dead_code)]
    fn _surface(_loss: ImportLoss, _suggestion: SplitSuggestion) {}
}
