//! Word 导入分支（add-word-import 建立并归档；add-markdown-import 泛化为
//! 文档导入的 `.docx` 分支）：`.docx` → canonical Tiptap JSON v2。
//!
//! 入口与共享管线（契约结构、损耗记账、拆分建议、事务落盘、命名与哈希）
//! 见 [`super::document_import`]；本模块只负责 docx 特有的读取防护与映射：
//! - **读取防护**：ZIP 结构判定（存在 `[Content_Types].xml`，不信任系统
//!   MIME）；单条目解压量与解压总量上限按**真实读出量**在调用 read_docx 前
//!   用 zip crate 流式预扫描执行（防压缩炸弹，参照 xerj 前例）。
//! - **解析**：docx-rs 0.4.22 读侧 API（spike 已实证对真实 WPS 文件兼容）。
//! - **映射**（add-word-import design D3）：段落 / Heading 样式→标题 /
//!   有效可见编号→列表（`numId=0` 墓碑与不可见定义一律普通段落）/ 表格逐格
//!   拍平 / 空段落保留 / run 级 bold·italic·underline·strike·color·sz·
//!   rFonts·highlight / 超链接 / 对齐缩进行距段距 / 修订取最终态（留 ins 去
//!   del）/ 缺 Fallback 的 AlternateContent 与脚注引用在 document.xml 上按
//!   本地名扫描计数（docx-rs 读侧对两者分别缺少解析与完全不解析）/
//!   `wpsCustomData` 等私货不解析。
//!
//! 值约定（与前端编辑器 CSS 值一致）：fontSize/spacing 用 pt（如 `12pt`），
//! 行距 auto 规则为无单位倍数（如 `1.5`），缩进优先用字符单位 em
//! （`firstLineChars`/`startChars` 的 1/100 字符），无字符单位时退回 pt。

use std::collections::HashMap;
use std::io::{Cursor, Read};

use docx_rs::{
    read_docx_with_options, DocumentChild, Docx, HyperlinkData, Paragraph, ParagraphChild,
    ReadDocxOptions, Run, RunChild, StructuredDataTag, Table, TableCellContent, TableChild,
};
use serde::Serialize;
use serde_json::{json, Map, Value};

use super::document_import::{
    merge_inline_runs, parse_marker_family, InlineRun, LossCounter, ParsedDocument,
};
use super::ProjectError;

/// 单个 ZIP 条目解压后字节上限（防压缩炸弹；正常剧本 document.xml 为个位数 MB）。
const MAX_IMPORT_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
/// 全部条目解压总量上限（docx-rs 会把 media 一并读入内存，总量须有界）。
const MAX_IMPORT_TOTAL_BYTES: u64 = 200 * 1024 * 1024;

// ========== 编号定义索引 ==========

/// 单个编号层级的可见性与形态。`visible=false` 表示编号不可见（numFmt=none、
/// lvlText 为空或定义缺失），按普通段落处理（编号可见性规则）。
#[derive(Debug, Clone)]
struct LevelInfo {
    visible: bool,
    ordered: bool,
    start: u64,
}

/// numId → 各层级定义（按 ilvl 下标）。仅解析 num/abstractNum 两级引用；
/// lvlOverride 的 startOverride 消费（fix-import-fidelity D4，spike 结论：
/// `LevelOverride{level, override_start}` 字段 pub、reader 完整读取）；
/// 样式链编号（numStyleLink）仍不解析，解析不到按降级告知。
#[derive(Default)]
struct NumberingIndex {
    map: HashMap<usize, Vec<Option<LevelInfo>>>,
    /// (numId, ilvl) → startOverride 覆盖起点。
    overrides: HashMap<(usize, usize), u64>,
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
        let mut overrides = HashMap::new();
        for num in &numberings.numberings {
            if let Some(levels) = abstract_levels.get(&num.abstract_num_id) {
                map.insert(num.id, levels.clone());
            }
            for level_override in &num.level_overrides {
                if let Some(start) = level_override.override_start {
                    overrides.insert(
                        (num.id, level_override.level),
                        u64::try_from(start).unwrap_or(1).max(1),
                    );
                }
            }
        }
        Self { map, overrides }
    }

    /// 取 numId 的第 0 层定义；不可见或缺失返回 None（调用方按普通段落处理）。
    fn level0(&self, num_id: usize) -> Option<&LevelInfo> {
        self.map
            .get(&num_id)?
            .first()?
            .as_ref()
            .filter(|info| info.visible)
    }

    /// numId 在指定层级的 startOverride（无覆盖返回 None）。
    fn override_start(&self, num_id: usize, ilvl: usize) -> Option<u64> {
        self.overrides.get(&(num_id, ilvl)).copied()
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

/// 转换完成的一个块级段落：完整块节点 + 列表归组信息 + 序列标记识别结果。
#[derive(Clone)]
struct ParaOut {
    node: Value,
    /// (numId, ordered, start)：参与列表归组的段落携带。
    list: Option<(usize, bool, u64)>,
    /// (family_key, trimmed text)：仅顶层、非列表、全加粗段落识别。
    marker: Option<(String, String)>,
}

// ========== 转换器 ==========

/// 样式表条目（fix-import-fidelity D3 样式上下文）：basedOn 链与预序列化的
/// 字符/段落属性（serde camelCase map，与 docx-rs 私有字段的读取通道一致）。
struct StyleEntry {
    based_on: Option<String>,
    run_property: Map<String, Value>,
    paragraph_property: Map<String, Value>,
}

struct Converter {
    hyperlinks: HashMap<String, String>,
    numbering: NumberingIndex,
    /// styleId → 样式名（标题识别沿用）。
    styles_by_id: HashMap<String, String>,
    /// styleId → 样式条目（D3 样式链）。
    style_entries: HashMap<String, StyleEntry>,
    /// 文档默认字符属性（docDefaults rPrDefault，map 形态）。
    doc_default_rpr: Map<String, Value>,
    /// 文档默认段落属性（docDefaults pPrDefault）。
    doc_default_ppr: Map<String, Value>,
    /// 默认段落样式 ID（styles.xml `w:default="1"`，docx-rs 不读该标志，
    /// 由预扫描捕获的 styles.xml 探测）。
    default_paragraph_style: Option<String>,
    /// D4 编号计数器：(numId, ilvl) → 当前值（跨普通段落打断持续）。
    numbering_counters: HashMap<(usize, usize), u64>,
    losses: LossCounter,
    char_count: usize,
    paragraph_count: usize,
}

impl Converter {
    fn new(docx: &Docx, styles_xml: Option<&str>) -> Self {
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
            .map(|style| {
                (
                    style.style_id.clone(),
                    ser_str(&style.name).unwrap_or_default(),
                )
            })
            .collect();

        // D3 样式上下文：docDefaults（私有字段经 Serialize 提取，spike 结论）
        // ＋样式条目（basedOn 私有 → 同通道；rPr/pPr 字段 pub 直接序列化）。
        let doc_defaults = serde_json::to_value(&docx.styles.doc_defaults)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        // DocDefaults 序列化形状：{"runPropertyDefault":{"runProperty":{…}},
        // "paragraphPropertyDefault":{"paragraphProperty":{…}}}。
        let inner_object = |wrapper_key: &str, inner_key: &str| -> Map<String, Value> {
            doc_defaults
                .get(wrapper_key)
                .and_then(Value::as_object)
                .and_then(|wrapper| wrapper.get(inner_key))
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default()
        };
        let doc_default_rpr = inner_object("runPropertyDefault", "runProperty");
        let doc_default_ppr = inner_object("paragraphPropertyDefault", "paragraphProperty");

        let style_entries = docx
            .styles
            .styles
            .iter()
            .map(|style| {
                (
                    style.style_id.clone(),
                    StyleEntry {
                        based_on: style.based_on.as_ref().and_then(ser_str),
                        run_property: serde_json::to_value(&style.run_property)
                            .ok()
                            .and_then(|value| value.as_object().cloned())
                            .unwrap_or_default(),
                        paragraph_property: serde_json::to_value(&style.paragraph_property)
                            .ok()
                            .and_then(|value| value.as_object().cloned())
                            .unwrap_or_default(),
                    },
                )
            })
            .collect();

        let default_paragraph_style = styles_xml.and_then(detect_default_paragraph_style);

        Self {
            hyperlinks,
            numbering,
            styles_by_id,
            style_entries,
            doc_default_rpr,
            doc_default_ppr,
            default_paragraph_style,
            numbering_counters: HashMap::new(),
            losses: LossCounter::default(),
            char_count: 0,
            paragraph_count: 0,
        }
    }

    /// 解析 basedOn 链（自根到叶，环防护深度 8）：返回根→…→本样式的条目序列。
    fn style_chain(&self, style_id: &str) -> Vec<&StyleEntry> {
        let mut chain = Vec::new();
        let mut current = self.style_entries.get(style_id);
        let mut depth = 0;
        while let Some(entry) = current {
            if depth >= 8 {
                break; // 环防护：超深链截断（异常样式表防御）。
            }
            chain.push(entry);
            depth += 1;
            current = entry
                .based_on
                .as_deref()
                .and_then(|parent| self.style_entries.get(parent));
        }
        chain.reverse(); // 根在前，叶在后：后者覆盖前者。
        chain
    }

    /// 生效段落样式 ID：显式 pStyle 优先，缺省用默认段落样式（Word 语义：
    /// 无 pStyle 的段落挂默认样式，其链上属性照常生效）。
    fn effective_paragraph_style<'a>(&'a self, explicit: Option<&'a str>) -> Option<&'a str> {
        explicit.or(self.default_paragraph_style.as_deref())
    }

    /// 样式链生效字符属性（docDefaults ← 段落样式链）：map 字段级合并，
    /// fonts 子对象按属性位合并（显式 ascii/eastAsia 键胜于主题键的整替）。
    fn chain_char_map(&self, paragraph_style: Option<&str>) -> Map<String, Value> {
        let mut merged = self.doc_default_rpr.clone();
        let chain = paragraph_style
            .map(|id| self.style_chain(id))
            .unwrap_or_default();
        for entry in chain {
            overlay_map(&mut merged, &entry.run_property);
        }
        merged
    }

    /// 样式链生效段落属性（docDefaults ← 段落样式链）。
    fn chain_paragraph_map(&self, paragraph_style: Option<&str>) -> Map<String, Value> {
        let mut merged = self.doc_default_ppr.clone();
        let chain = paragraph_style
            .map(|id| self.style_chain(id))
            .unwrap_or_default();
        for entry in chain {
            overlay_map(&mut merged, &entry.paragraph_property);
        }
        merged
    }

    /// D3 未解析计数：样式链（含 docDefaults）上存在但既不映射也不属已知
    /// 非格式行为属性的键（段落应用一次；rStyle 链按 run 计）。
    /// 注意：docx-rs 的 ParagraphProperty 序列化恒带 `"tabs":[]`（Vec 无
    /// skip），空 tabs 是回声不是信息——只在非空时计数。
    fn count_style_degraded(
        &mut self,
        char_map: &Map<String, Value>,
        para_map: &Map<String, Value>,
    ) {
        for key in char_map.keys() {
            if UNMAPPABLE_CHAR_KEYS.contains(&key.as_str()) {
                self.losses.style_degraded += 1;
            }
        }
        for (key, value) in para_map {
            match key.as_str() {
                "tabs" => {
                    let non_empty = value.as_array().is_some_and(|tabs| !tabs.is_empty());
                    if non_empty {
                        self.losses.style_degraded += 1;
                    }
                }
                "borders" => {
                    self.losses.style_degraded += 1;
                }
                _ => {}
            }
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

    /// 表格拍平：逐格逐段输出普通段落；嵌套表格递归拍平；单元格内段落不转
    /// 列表（拍平语义），有效编号按降级告知。
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

        // D3：生效段落属性＝docDefaults ← 段落样式链 ← 直接属性（后覆盖前），
        // 标题识别仍用显式 pStyle 的 ID/名称。
        let explicit_style = p.property.style.as_ref().map(|style| style.val.as_str());
        let paragraph_style: Option<String> = self
            .effective_paragraph_style(explicit_style)
            .map(str::to_string);
        let mut effective_ppr = self.chain_paragraph_map(paragraph_style.as_deref());
        let direct_ppr = serde_json::to_value(&p.property)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        overlay_map(&mut effective_ppr, &direct_ppr);
        // 样式链（不含直接属性）的未解析键计数（每段一次）。
        let chain_only_ppr = self.chain_paragraph_map(paragraph_style.as_deref());
        let chain_only_char = self.chain_char_map(paragraph_style.as_deref());
        self.count_style_degraded(&chain_only_char, &chain_only_ppr);

        let heading = explicit_style.and_then(|id| self.heading_level_by_id(id));
        let attrs = paragraph_attrs_from_map(&effective_ppr);

        // D4 编号：生效 numberingProperty（含样式链携带的编号，如 ListNumber
        // 样式）；计数器跨普通段落打断持续，更深层级在更浅出现时重置。
        let list = self.resolve_numbering(&effective_ppr, in_table);

        // D3：段落级字符基底（docDefaults ← 段落样式链），run 层再叠
        // rStyle 链与直接属性（collect_run 内）。
        let char_base = self.chain_char_map(paragraph_style.as_deref());

        let mut acc = ParaAccum::new(heading, attrs);
        let mut closed: Vec<ParaAccum> = Vec::new();
        for child in &p.children {
            self.collect_paragraph_child(child, None, &char_base, &mut acc, &mut closed);
        }
        let mut parts = closed;
        parts.push(acc);
        let list = if heading.is_some() { None } else { list };
        parts
            .into_iter()
            .map(|part| self.finalize_para(part, top_level, list))
            .collect()
    }

    fn heading_level_by_id(&self, style_id: &str) -> Option<u8> {
        if let Some(level) = parse_heading_token(style_id) {
            return Some(level);
        }
        self.styles_by_id
            .get(style_id)
            .and_then(|name| parse_heading_token(name))
    }

    /// D4 编号解析：生效 numberingProperty（含样式链携带的编号，如
    /// ListNumber 样式的 pPr numPr）→ 计数器语义下的 (numId, ordered, 当前值)。
    /// 墓碑/缺失→普通段落不计数；ilvl>0/表格内/定义不可见→numbering_degraded
    /// （计数器仍按语义推进，供将来多层渲染）；同 numId 计数跨打断持续、
    /// 更深层级在更浅出现时重置、startOverride 改写起点。
    fn resolve_numbering(
        &mut self,
        effective_ppr: &Map<String, Value>,
        in_table: bool,
    ) -> Option<(usize, bool, u64)> {
        let numbering = effective_ppr
            .get("numberingProperty")
            .and_then(Value::as_object)?;
        let num_id = numbering.get("id").and_then(Value::as_u64)? as usize;
        if num_id == 0 {
            return None; // 墓碑：普通段落，不计数。
        }
        let ilvl = numbering.get("level").and_then(Value::as_u64).unwrap_or(0) as usize;

        // 计数器语义（无论本段是否可渲染为列表都推进）：
        // 更深层级在更浅层级出现时重置。
        let keys_to_reset: Vec<(usize, usize)> = self
            .numbering_counters
            .keys()
            .filter(|(nid, level)| *nid == num_id && *level > ilvl)
            .cloned()
            .collect();
        for key in keys_to_reset {
            self.numbering_counters.remove(&key);
        }
        // 首见计数器起点＝startOverride（若该 numId 覆盖了此层）否则定义层起点。
        let start = self
            .numbering
            .override_start(num_id, ilvl)
            .or_else(|| self.numbering.level0(num_id).map(|info| info.start))
            .unwrap_or(1);
        let counter = self
            .numbering_counters
            .entry((num_id, ilvl))
            .or_insert(start - 1);
        *counter += 1;
        let current = *counter;

        if ilvl > 0 || in_table {
            self.losses.numbering_degraded += 1;
            return None;
        }
        match self.numbering.level0(num_id) {
            Some(info) => Some((num_id, info.ordered, current)),
            None => {
                self.losses.numbering_degraded += 1;
                None
            }
        }
    }

    fn collect_paragraph_child(
        &mut self,
        child: &ParagraphChild,
        link_href: Option<&str>,
        char_base: &Map<String, Value>,
        acc: &mut ParaAccum,
        closed: &mut Vec<ParaAccum>,
    ) {
        match child {
            ParagraphChild::Run(run) => self.collect_run(run, link_href, char_base, acc, closed),
            ParagraphChild::Hyperlink(h) => {
                let href = self.href_for(h);
                for inner in &h.children {
                    self.collect_paragraph_child(inner, href.as_deref(), char_base, acc, closed);
                }
            }
            ParagraphChild::Insert(ins) => {
                // 修订最终态：插入内容保留。
                self.losses.revisions += 1;
                for inner in &ins.children {
                    match inner {
                        docx_rs::InsertChild::Run(run) => {
                            self.collect_run(run, link_href, char_base, acc, closed)
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
                            self.collect_run(run, link_href, char_base, acc, closed)
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
        char_base: &Map<String, Value>,
        acc: &mut ParaAccum,
        closed: &mut Vec<ParaAccum>,
    ) {
        // D3：生效字符属性＝段落基底（docDefaults ← 段落样式链）← rStyle
        // 字符样式链 ← 直接属性（后覆盖前）。rStyle 链克隆到本地后计数与
        // 叠加（避免与 self 的可变借用冲突）。
        let r_style_chain: Vec<Map<String, Value>> = run
            .run_property
            .style
            .as_ref()
            .map(|style| style.val.as_str())
            .map(|style_id| {
                self.style_chain(style_id)
                    .iter()
                    .map(|entry| entry.run_property.clone())
                    .collect()
            })
            .unwrap_or_default();
        let mut effective = char_base.clone();
        // rStyle 链（字符样式链）：其自身引入的未解析键按 run 计（段落链已
        // 计过的基底键不重复计）。
        let mut r_style_degraded = 0usize;
        for entry_map in &r_style_chain {
            for key in entry_map.keys() {
                if UNMAPPABLE_CHAR_KEYS.contains(&key.as_str()) {
                    r_style_degraded += 1;
                }
            }
        }
        self.losses.style_degraded += r_style_degraded;
        for entry_map in &r_style_chain {
            overlay_map(&mut effective, entry_map);
        }
        let direct = serde_json::to_value(&run.run_property)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        overlay_map(&mut effective, &direct);
        // 字体选择按 run 文字字符类别（F05）：文本取全部 w:t 子项拼接
        // （符号/Tab 子项不参与判类；纯符号 run 走空文本回退链）。
        let run_text: String = run
            .children
            .iter()
            .filter_map(|child| match child {
                RunChild::Text(t) => Some(t.text.clone()),
                _ => None,
            })
            .collect();
        let marks = marks_from_char_map(&effective, &run_text, link_href);
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
                RunChild::Sym(sym) => {
                    // 符号字符是可见文字（fix-import-fidelity D2）：常用符号字体
                    // 高置信映射表 → 插入对应 Unicode 字符（忠实解码，非改写）；
                    // 映射失败 → symbol_dropped 计数告知（note 含字体名），不静默。
                    match symbol_to_unicode(&sym.font, &sym.char) {
                        Some(ch) => acc.inline.push(InlineRun {
                            text: ch.to_string(),
                            marks: marks.clone(),
                        }),
                        None => self.losses.symbols += 1,
                    }
                }
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
        let (content, text_total) = merge_inline_runs(acc.inline);
        self.char_count += text_total.chars().count();
        let mut has_text = false;
        let mut all_bold = true;
        for value in &content {
            if !value["text"]
                .as_str()
                .is_some_and(|text| text.trim().is_empty())
            {
                has_text = true;
                let marks = value.get("marks").and_then(Value::as_array);
                let bold =
                    marks.is_some_and(|marks| marks.iter().any(|mark| mark["type"] == "bold"));
                if !bold {
                    all_bold = false;
                }
            }
        }

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

        // 序列标记：仅顶层、非列表、全加粗段落（「格式一致」启发式）。
        let marker = if top_level && list.is_none() && has_text && all_bold {
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

// ========== run 级 marks（格式标记全保留） ==========

/// 东亚字符判定（F05 字体选择的字符类别依据）：覆盖 CJK 统一表意与
/// 扩展 A、CJK 符号标点、假名（平假名／片假名及注音扩展）、注音符号、
/// 谚文（音节／兼容字母／扩展 A/B）、CJK 兼容表意、全角形式。
/// 判定的是「需要东亚字体渲染的字符类别」，不追求 Unicode 块完备。
fn is_east_asian_char(ch: char) -> bool {
    matches!(ch,
        '\u{3000}'..='\u{303F}'   // CJK 符号和标点
        | '\u{3040}'..='\u{309F}' // 平假名
        | '\u{30A0}'..='\u{30FF}' // 片假名
        | '\u{3100}'..='\u{312F}' // 注音符号
        | '\u{3130}'..='\u{318F}' // 谚文兼容字母
        | '\u{31F0}'..='\u{31FF}' // 片假名注音扩展
        | '\u{3400}'..='\u{4DBF}' // CJK 扩展 A
        | '\u{4E00}'..='\u{9FFF}' // CJK 统一表意
        | '\u{A960}'..='\u{A97F}' // 谚文扩展 A
        | '\u{AC00}'..='\u{D7AF}' // 谚文音节
        | '\u{D7B0}'..='\u{D7FF}' // 谚文扩展 B
        | '\u{F900}'..='\u{FAFF}' // CJK 兼容表意
        | '\u{FF00}'..='\u{FFEF}' // 全角形式（含全角 ASCII／假名）
    )
}

/// run 级格式 → canonical marks（按 rank 排序：bold·italic·underline·strike·
/// textStyle·highlight·link）。docx-rs 多个属性结构字段为私有但实现 Serialize，
/// 统一经 serde_json::to_value 读取。
/// 生效字符属性 map（D3 合并产物，serde camelCase 键）→ canonical marks。
/// 键形态：bold/italic→bool，underline→string，strike→bool，color→string，
/// sz→number（半点），fonts→object（按 run 文本字符类别选键，主题键
/// 不解析——docDefaults 显式字体兜底），highlight→string。
fn marks_from_char_map(
    map: &Map<String, Value>,
    run_text: &str,
    link_href: Option<&str>,
) -> Vec<Value> {
    let mut marks = Vec::new();
    if map.get("bold").and_then(Value::as_bool) == Some(true) {
        marks.push(json!({ "type": "bold" }));
    }
    if map.get("italic").and_then(Value::as_bool) == Some(true) {
        marks.push(json!({ "type": "italic" }));
    }
    if let Some(underline) = map.get("underline").and_then(Value::as_str) {
        if !underline.is_empty() && underline != "none" {
            marks.push(json!({ "type": "underline" }));
        }
    }
    if map.get("strike").and_then(Value::as_bool) == Some(true) {
        marks.push(json!({ "type": "strike" }));
    }

    let mut text_style = Map::new();
    if let Some(color) = map.get("color").and_then(Value::as_str) {
        if let Some(hex) = normalize_hex_color(color) {
            text_style.insert("color".to_string(), json!(hex));
        }
    }
    if let Some(half_points) = map.get("sz").and_then(Value::as_u64) {
        if half_points > 0 {
            text_style.insert(
                "fontSize".to_string(),
                json!(format!("{}pt", format_decimal(half_points as f64 / 2.0))),
            );
        }
    }
    if let Some(fonts) = map.get("fonts").and_then(Value::as_object) {
        // 字体选择按 run 文字字符类别（fix-docx-fidelity-residuals F05）。
        // 选定类别键缺失时按剩余键序回退；主题键（asciiTheme 等）不做
        // 主题解析、不计损耗（docDefaults 显式字体兜底，WPS 金样本零
        // style_degraded 的口径之一，见报告）。
        let keys: [&str; 3] = if run_text.is_empty() || run_text.chars().any(is_east_asian_char) {
            // 含东亚字符（混排 run 取东亚字体承载，不拆 run——已知取舍，
            // 不计损耗），或空文本 run（纯符号/Tab，无字符类别可判）——
            // 均维持原回退链 eastAsia 优先。
            ["eastAsia", "ascii", "hiAnsi"]
        } else {
            // 纯拉丁——西文主字体 ascii 优先。
            ["ascii", "hiAnsi", "eastAsia"]
        };
        let family = keys
            .iter()
            .find_map(|key| fonts.get(*key).and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default();
        if !family.is_empty() {
            text_style.insert("fontFamily".to_string(), json!(family));
        }
    }
    if !text_style.is_empty() {
        marks.push(json!({ "type": "textStyle", "attrs": Value::Object(text_style) }));
    }

    if let Some(highlight) = map.get("highlight").and_then(Value::as_str) {
        if let Some(hex) = highlight_color(highlight) {
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

/// map 字段级合并（overlay 覆盖 base；fonts 与 lineSpacing 两个复合对象
/// 按属性位再合并——仅覆盖部分子属性不得丢失其余继承子属性；其余键整替。
/// 显式键与主题键共存时互不整替）。
fn overlay_map(base: &mut Map<String, Value>, overlay: &Map<String, Value>) {
    for (key, value) in overlay {
        if key == "fonts" {
            if let (Some(base_fonts), Some(overlay_fonts)) = (
                base.get_mut("fonts").and_then(Value::as_object_mut),
                value.as_object(),
            ) {
                for (font_key, font_value) in overlay_fonts {
                    base_fonts.insert(font_key.clone(), font_value.clone());
                }
                continue;
            }
        }
        if key == "lineSpacing" {
            // 间距复合对象按子属性（before/after/line/lineRule）逐项覆盖
            // （fix-docx-fidelity-residuals F04）：样式仅覆盖段后间距时，
            // 继承的行距（line/lineRule）不得从合并结果消失。
            if let (Some(base_spacing), Some(overlay_spacing)) = (
                base.get_mut("lineSpacing").and_then(Value::as_object_mut),
                value.as_object(),
            ) {
                for (spacing_key, spacing_value) in overlay_spacing {
                    base_spacing.insert(spacing_key.clone(), spacing_value.clone());
                }
                continue;
            }
        }
        base.insert(key.clone(), value.clone());
    }
}

/// 字符属性：链上存在但语法不承载的键（计入 style_degraded）。szCs（复杂
/// 文字字号＝sz 的孪生）与 vanish（隐藏文字语义另议）不计——前者语义重复，
/// 后者涉及内容取舍而非格式，均记报告。
const UNMAPPABLE_CHAR_KEYS: &[&str] = &[
    "vertAlign",
    "caps",
    "characterSpacing",
    "shading",
    "textBorder",
    "dstrike",
    "fitText",
    "stretch",
];

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

/// 生效段落属性 map（D3 合并产物，serde camelCase 键）→ 编辑器段落属性。
/// 键形态：alignment→string，indent→{start,end,startChars,specialIndent,
/// hangingChars,firstLineChars}，lineSpacing→{lineRule,before,after,line}。
fn paragraph_attrs_from_map(pp: &Map<String, Value>) -> Map<String, Value> {
    let mut attrs = Map::new();

    if let Some(justification) = pp.get("alignment").and_then(Value::as_str) {
        let mapped = match justification {
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

    if let Some(indent) = pp.get("indent").and_then(Value::as_object) {
        // 缩进优先消费字符单位（*Chars，1/100 字符 ≈ em），退回 twips（1/20 pt）。
        let special = indent.get("specialIndent").and_then(Value::as_object);
        let first_line_chars = indent.get("firstLineChars").and_then(Value::as_i64);
        let hanging_chars = indent.get("hangingChars").and_then(Value::as_i64);
        if let Some(chars) = indent.get("startChars").and_then(Value::as_i64) {
            attrs.insert(
                "indentLeft".to_string(),
                json!(format!("{}em", format_decimal(chars as f64 / 100.0))),
            );
        } else if let Some(start) = indent.get("start").and_then(Value::as_i64) {
            if start != 0 {
                attrs.insert(
                    "indentLeft".to_string(),
                    json!(format!("{}pt", format_decimal(start as f64 / 20.0))),
                );
            }
        }
        if let Some(end) = indent.get("end").and_then(Value::as_i64) {
            if end != 0 {
                attrs.insert(
                    "indentRight".to_string(),
                    json!(format!("{}pt", format_decimal(end as f64 / 20.0))),
                );
            }
        }
        // specialIndent 序列化形状：{"type":"firstLine"|"hanging","val":twips}。
        let first_line: Option<String> = if let Some(chars) = first_line_chars {
            Some(format!("{}em", format_decimal(chars as f64 / 100.0)))
        } else if let Some(chars) = hanging_chars {
            Some(format!("-{}em", format_decimal(chars as f64 / 100.0)))
        } else {
            match special.map(|sp| {
                (
                    sp.get("type").and_then(Value::as_str).unwrap_or(""),
                    sp.get("val").and_then(Value::as_i64).unwrap_or(0),
                )
            }) {
                Some(("firstLine", twips)) => {
                    Some(format!("{}pt", format_decimal(twips as f64 / 20.0)))
                }
                Some(("hanging", twips)) => {
                    Some(format!("-{}pt", format_decimal(twips as f64 / 20.0)))
                }
                _ => None,
            }
        };
        if let Some(value) = first_line {
            if value != "0pt" && value != "-0pt" {
                attrs.insert("textIndent".to_string(), json!(value));
            }
        }
    }

    if let Some(spacing_value) = pp.get("lineSpacing").and_then(Value::as_object) {
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

    attrs
}

// ========== 列表归组与解析入口 ==========

/// 相邻同 numId 的编号段落归组为一个列表；任何非列表块打断归组。
/// 同时产出顶层序列标记的（块索引, 族键, 文本）——标记段落必为独立块。
fn group_blocks_with_markers(paras: Vec<ParaOut>) -> (Vec<Value>, Vec<(usize, String, String)>) {
    let mut out: Vec<Value> = Vec::new();
    let mut markers: Vec<(usize, String, String)> = Vec::new();
    let mut items: Vec<Value> = Vec::new();
    let mut current: Option<(usize, bool, u64)> = None;
    for para in paras {
        match (current, para.list) {
            (_, None) => {
                flush_list(&mut out, &mut items, &mut current);
                if let Some((key, text)) = para.marker {
                    markers.push((out.len(), key, text));
                }
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
    (out, markers)
}

fn flush_list(
    out: &mut Vec<Value>,
    items: &mut Vec<Value>,
    current: &mut Option<(usize, bool, u64)>,
) {
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

// ========== ZIP 预扫描与解析入口 ==========

/// ZIP 预扫描产物：document.xml（兼容块/脚注计数用）、docProps（生成器印记）
/// 与 styles.xml（默认段落样式探测——docx-rs 不读 `w:default` 标志，spike 结论）。
#[derive(Debug)]
struct ZipScan {
    document_xml: Option<String>,
    app_xml: Option<String>,
    custom_xml: Option<String>,
    styles_xml: Option<String>,
}

/// 解压防护 + ZIP 结构判定 + 顺带提取 document.xml / docProps，然后解析映射
/// 为共享管线的 [`ParsedDocument`]。
///
/// 上限按**真实解压量**执行：逐条目流式读出并在超限时立即中止，保证后续
/// docx-rs 的解压读取不会超出已验证的安全范围（防声明值造假的压缩炸弹）。
pub(crate) fn parse_docx(bytes: &[u8]) -> Result<ParsedDocument, ProjectError> {
    let scan = prescan_zip(bytes)?;
    let generator = extract_generator(&scan);
    let block_skipped = scan
        .document_xml
        .as_deref()
        .map(count_missing_fallback_blocks)
        .unwrap_or(0);
    // 脚注引用计数走 document.xml 扫描通道（docx-rs 读侧不解析
    // w:footnoteReference，见 count_footnote_references 文档）。
    let footnote_refs = scan
        .document_xml
        .as_deref()
        .map(count_footnote_references)
        .unwrap_or(0);

    let docx = read_docx_with_options(bytes, ReadDocxOptions::default().with_image_previews(false))
        .map_err(|e| {
            ProjectError::ImportRejected(format!("文件解析失败：不是有效的 Word 文档（{e:?}）"))
        })?;
    let mut converter = Converter::new(&docx, scan.styles_xml.as_deref());
    let paras = converter.walk_document(&docx);
    let (blocks, markers) = group_blocks_with_markers(paras);
    let mut losses = converter.losses;
    losses.footnotes += footnote_refs;
    losses.block_skipped = block_skipped;
    Ok(ParsedDocument {
        blocks,
        markers,
        losses,
        char_count: converter.char_count,
        paragraph_count: converter.paragraph_count,
        generator,
    })
}

fn prescan_zip(bytes: &[u8]) -> Result<ZipScan, ProjectError> {
    let invalid = |msg: String| ProjectError::ImportRejected(msg);
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| invalid("不是有效的 .docx 文件（ZIP 结构损坏）".to_string()))?;

    // 按 ZIP 结构判断（存在 [Content_Types].xml），不信任系统 MIME。
    if archive.by_name("[Content_Types].xml").is_err() {
        return Err(invalid(
            "不是有效的 .docx 文件：缺少 [Content_Types].xml（请确认文件由 Word 或 WPS 保存）"
                .to_string(),
        ));
    }

    let mut scan = ZipScan {
        document_xml: None,
        app_xml: None,
        custom_xml: None,
        styles_xml: None,
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
            "word/document.xml" | "docProps/app.xml" | "docProps/custom.xml" | "word/styles.xml"
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
            "docProps/app.xml" => {
                scan.app_xml = Some(String::from_utf8_lossy(&captured).into_owned())
            }
            "docProps/custom.xml" => {
                scan.custom_xml = Some(String::from_utf8_lossy(&captured).into_owned())
            }
            "word/styles.xml" => {
                scan.styles_xml = Some(String::from_utf8_lossy(&captured).into_owned())
            }
            _ => {}
        }
    }
    Ok(scan)
}

/// styles.xml 默认段落样式探测（D3）：`w:default="1"` 且 `w:type="paragraph"`
/// 的 styleId——docx-rs Style 模型无 default 字段（spike 结论），从预扫描
/// 捕获的 styles.xml 以 roxmltree 读取（前缀属性按本地名比对）。styles.xml
/// 缺失/畸形时返回 None（无默认样式，段落链仅 docDefaults）。
fn detect_default_paragraph_style(styles_xml: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(styles_xml).ok()?;
    for style in doc.descendants() {
        if !style.is_element() || style.tag_name().name() != "style" {
            continue;
        }
        let local = |name: &str| {
            style
                .attributes()
                .find(|attr| attr.name() == name)
                .map(|attr| attr.value())
        };
        if local("type") == Some("paragraph") && local("default") == Some("1") {
            return local("styleId").map(str::to_string);
        }
    }
    None
}

// ========== docProps 生成器印记与兼容块计数 ==========

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
            && (bytes[end].is_ascii_alphanumeric()
                || matches!(bytes[end], b':' | b'_' | b'-' | b'.'))
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

// ========== 符号字符映射（fix-import-fidelity D2） ==========

/// `w:sym`（{font, char} 字符引用，char 为十六进制、多在私用区 F0xx）→
/// Unicode 字符。只收高置信常用符号（宁缺毋滥）：Wingdings 勾叉／笑脸／
/// 方块系列＋Symbol 字体（本质是希腊字母数学字体，编码极稳定）的希腊字母
/// 全集与常用数学符号。`F0` 私用区前缀按 OOXML 惯例剥除后查表。
fn symbol_to_unicode(font: &str, char_code: &str) -> Option<char> {
    let code = u32::from_str_radix(char_code.trim(), 16).ok()?;
    // 私用区回声前缀：Wingdings/Symbol 引用常写作 F0xx（F000 区）。
    let code = if (0xF000..=0xF0FF).contains(&code) {
        code - 0xF000
    } else {
        code
    };
    match font.trim() {
        "Wingdings" => wingdings_char(code),
        "Symbol" => symbol_font_char(code),
        _ => None,
    }
}

/// Wingdings 符号映射：以 Alan Wood 公开编码对照表为规范依据
/// （https://www.alanwood.net/demos/wingdings.html），逐条按码位与
/// Unicode 名称对齐（fix-docx-fidelity-residuals F01/F03 修正）；
/// 未列码位返回 None → `symbol_dropped` 告知，不静默。
fn wingdings_char(code: u32) -> Option<char> {
    Some(match code {
        0x28 => '\u{1F57F}', // BLACK TOUCHTONE TELEPHONE
        0x3F => '\u{270D}',  // WRITING HAND
        0x4A => '\u{263A}',  // WHITE SMILING FACE
        0x4B => '\u{1F610}', // NEUTRAL FACE
        0x4C => '\u{2639}',  // WHITE FROWNING FACE
        0x6E => '\u{25A0}',  // BLACK SQUARE
        0x6F => '\u{25A1}',  // WHITE SQUARE
        0x71 => '\u{2751}',  // LOWER RIGHT SHADOWED WHITE SQUARE
        0xA7 => '\u{25AA}',  // BLACK SMALL SQUARE
        0xA8 => '\u{25FB}',  // WHITE MEDIUM SQUARE
        0xAB => '\u{2605}',  // BLACK STAR
        0xB7 => '\u{1F550}', // CLOCK FACE ONE OCLOCK
        0xBB => '\u{1F554}', // CLOCK FACE FIVE OCLOCK
        0xC7 => '\u{2BB4}',  // RIBBON ARROW LEFT UP
        0xCB => '\u{1F66A}', // SOLID QUILT SQUARE ORNAMENT
        0xD8 => '\u{2B9A}',  // THREE-D TOP-LIGHTED RIGHTWARDS EQUILATERAL ARROWHEAD
        0xDC => '\u{2B8A}',  // RIGHTWARDS BLACK CIRCLED WHITE ARROW
        0xE7 => '\u{1F878}', // WIDE-HEADED LEFTWARDS HEAVY BARB ARROW
        0xE8 => '\u{1F87A}', // WIDE-HEADED RIGHTWARDS HEAVY BARB ARROW
        0xE9 => '\u{1F879}', // WIDE-HEADED UPWARDS HEAVY BARB ARROW
        0xEA => '\u{1F87B}', // WIDE-HEADED DOWNWARDS HEAVY BARB ARROW
        0xEB => '\u{1F87C}', // WIDE-HEADED NORTH WEST HEAVY BARB ARROW
        0xF2 => '\u{21E9}',  // DOWNWARDS WHITE ARROW
        0xFB => '\u{1F5F6}', // BALLOT BOLD SCRIPT X
        0xFC => '\u{2714}',  // HEAVY CHECK MARK
        0xFD => '\u{1F5F7}', // BALLOT BOX WITH BOLD SCRIPT X
        0xFE => '\u{1F5F9}', // BALLOT BOX WITH BOLD CHECK
        _ => return None,
    })
}

/// Symbol 字体（Adobe Symbol 编码，希腊字母＝ASCII 位，极稳定）。
/// 数学符号区以 Unicode 托管的 Adobe Symbol 映射表为规范依据
/// （https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt，
/// fix-docx-fidelity-residuals F02 修正）。
fn symbol_font_char(code: u32) -> Option<char> {
    Some(match code {
        // 数学常用。
        0xB1 => '±',
        0xB4 => '×',
        0xB8 => '÷',
        0xB9 => '≠',
        0xBB => '≈',
        0xA3 => '≤',
        0xB3 => '≥',
        0xA5 => '∞',
        0xB0 => '°',
        0xA1 => '\u{03D2}', // GREEK UPSILON WITH HOOK SYMBOL
        0xB2 => '\u{2033}', // DOUBLE PRIME
        0xB7 => '•',        // Symbol 圆点符（Word 默认项目符）
        0xD1 => '\u{2207}', // NABLA
        0xD6 => '\u{221A}', // SQUARE ROOT
        0xD7 => '\u{22C5}', // DOT OPERATOR
        // 希腊小写（Symbol 字体 ASCII 位即希腊字母）。
        0x61 => 'α',
        0x62 => 'β',
        0x63 => 'χ',
        0x64 => 'δ',
        0x65 => 'ε',
        0x66 => 'φ',
        0x67 => 'γ',
        0x68 => 'η',
        0x69 => 'ι',
        0x6A => 'ϕ',
        0x6B => 'κ',
        0x6C => 'λ',
        0x6D => 'μ',
        0x6E => 'ν',
        0x6F => 'ο',
        0x70 => 'π',
        0x71 => 'θ',
        0x72 => 'ρ',
        0x73 => 'σ',
        0x74 => 'τ',
        0x75 => 'υ',
        0x77 => 'ω',
        0x78 => 'ξ',
        0x79 => 'ψ',
        0x7A => 'ζ',
        // 希腊大写。
        0x41 => 'Α',
        0x42 => 'Β',
        0x47 => 'Γ',
        0x44 => 'Δ',
        0x45 => 'Ε',
        0x5A => 'Ζ',
        0x48 => 'Η',
        0x51 => 'Θ',
        0x49 => 'Ι',
        0x4B => 'Κ',
        0x4C => 'Λ',
        0x4D => 'Μ',
        0x4E => 'Ν',
        0x58 => 'Ξ',
        0x4F => 'Ο',
        0x50 => 'Π',
        0x52 => 'Ρ',
        0x54 => 'Τ',
        0x53 => 'Σ',
        0x55 => 'Υ',
        0x46 => 'Φ',
        0x59 => 'Ψ',
        0x57 => 'Ω',
        0x43 => 'Χ',
        _ => return None,
    })
}

// ========== 工具 ==========

fn format_decimal(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    let mut text = format!("{rounded:.2}");
    if text.contains('.') {
        text = text.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    text
}

fn ser_str(value: &impl Serialize) -> Option<String> {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

fn ser_u64(value: &impl Serialize) -> Option<u64> {
    serde_json::to_value(value).ok().and_then(|v| v.as_u64())
}

// ========== 测试 ==========

#[cfg(test)]
mod tests {
    use super::super::document_import::{
        detect_split_from_markers, doc_value_from_blocks, read_file_bounded, sha256_hex,
        split_docs_from_blocks, ImportFormat, MAX_DOCX_INPUT_BYTES,
    };
    use super::*;
    use docx_rs::{
        AbstractNumbering, AlignmentType, Delete, Docx, IndentLevel, Insert, Level, LevelJc,
        LevelText, LineSpacing, LineSpacingType, NumberFormat, NumberingId, Paragraph, Run,
        RunFonts, Start, Style, StyleType, Table, TableCell, TableRow,
    };
    use std::fs;
    use std::io::Write as _;
    use std::path::Path;

    use super::super::{CreateProjectParams, ProjectPaths};

    // ----- 夹具工具 -----

    fn pack(docx: Docx) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        docx.build().pack(&mut cursor).expect("pack docx");
        cursor.into_inner()
    }

    fn parse(bytes: &[u8]) -> ParsedDocument {
        prescan_zip(bytes).expect("prescan");
        parse_docx(bytes).expect("parse and map")
    }

    fn blocks_of(parsed: &ParsedDocument) -> Vec<Value> {
        parsed.blocks.clone()
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

    /// 手工构造最小 .docx ZIP（含 styles.xml——用于 docx-rs 写侧无法表达的
    /// `w:default="1"` 默认样式标志等）。
    fn write_minimal_docx_with_styles(document_xml: &str, styles_xml: &str) -> Vec<u8> {
        const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" PartName="/word/document.xml"/><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" PartName="/word/styles.xml"/></Types>"#;
        const RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
        const DOC_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        writer
            .start_file("[Content_Types].xml", options)
            .expect("start content types");
        std::io::Write::write_all(&mut writer, CONTENT_TYPES.as_bytes()).unwrap();
        writer
            .start_file("_rels/.rels", options)
            .expect("start rels");
        std::io::Write::write_all(&mut writer, RELS.as_bytes()).unwrap();
        writer
            .start_file("word/_rels/document.xml.rels", options)
            .expect("start doc rels");
        std::io::Write::write_all(&mut writer, DOC_RELS.as_bytes()).unwrap();
        writer
            .start_file("word/styles.xml", options)
            .expect("start styles");
        std::io::Write::write_all(&mut writer, styles_xml.as_bytes()).unwrap();
        writer
            .start_file("word/document.xml", options)
            .expect("start document");
        std::io::Write::write_all(&mut writer, document_xml.as_bytes()).unwrap();
        writer.finish().expect("finish zip").into_inner()
    }

    fn seed_project(name: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let temp = tempfile::TempDir::new().unwrap();
        let root = super::super::create_new_project(CreateProjectParams {
            name: name.to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        (temp, root)
    }

    // ----- 文件识别与防护 -----

    #[test]
    fn rejects_non_docx_extension_and_non_zip_bytes() {
        let (temp, root) = seed_project("识别测试");

        let txt = temp.path().join("样本.txt");
        fs::write(&txt, "hello").unwrap();
        let error =
            super::super::document_import::import_document_preview(&root, &txt).unwrap_err();
        assert!(
            error.to_string().contains(".docx") && error.to_string().contains(".md"),
            "报错：{error}"
        );

        let fake = temp.path().join("假文档.docx");
        fs::write(&fake, b"not a zip at all").unwrap();
        let error =
            super::super::document_import::import_document_preview(&root, &fake).unwrap_err();
        assert!(
            error.to_string().contains("不是有效的 .docx 文件"),
            "报错：{error}"
        );
    }

    #[test]
    fn oversized_input_rejected_before_parse() {
        let temp = tempfile::TempDir::new().unwrap();
        let big = temp.path().join("超大.docx");
        let zeros = vec![0u8; MAX_DOCX_INPUT_BYTES as usize + 1];
        fs::write(&big, zeros).unwrap();
        let error = read_file_bounded(&big, MAX_DOCX_INPUT_BYTES).unwrap_err();
        assert!(error.to_string().contains("文件过大"), "报错：{error}");
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
        writer.start_file("bomb.xml", options).expect("start bomb");
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
        assert_eq!(
            types,
            vec![
                "bold",
                "italic",
                "underline",
                "strike",
                "textStyle",
                "highlight"
            ]
        );
        let text_style = &blocks[0]["content"][0]["marks"][4]["attrs"];
        assert_eq!(text_style["color"], "#ff0000");
        assert_eq!(text_style["fontSize"], "12pt");
        assert_eq!(text_style["fontFamily"], "宋体");
        assert_eq!(
            blocks[0]["content"][0]["marks"][5]["attrs"]["color"],
            "#ffff00"
        );
    }

    #[test]
    fn paragraph_attrs_mapped_to_editor_units() {
        // docx-rs 写侧不输出 *Chars 缩进，这里走 twips 路径（w:firstLine）；
        // 字符单位路径由 chars 缩进专项测试覆盖。
        let paragraph = Paragraph::new()
            .align(AlignmentType::Center)
            .indent(
                Some(420),
                Some(docx_rs::SpecialIndentType::FirstLine(400)),
                None,
                None,
            )
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
            .add_paragraph(
                Paragraph::new()
                    .style("Heading1")
                    .add_run(Run::new().add_text("一级")),
            )
            .add_paragraph(
                Paragraph::new()
                    .style("s2")
                    .add_run(Run::new().add_text("二级")),
            )
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
        let value = doc_value_from_blocks(parsed.blocks.clone());
        super::super::validate_notebook_document(&value).expect("映射产物必须通过既有严格语法校验");
    }

    // ----- 修订最终态 -----

    #[test]
    fn revisions_take_final_state() {
        let paragraph = Paragraph::new()
            .add_insert(Insert::new(Run::new().add_text("保留")))
            .add_delete(Delete::new().add_run(Run::new().add_delete_text("丢弃")))
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

        let (temp, root) = seed_project("兼容块测试");
        let file = temp.path().join("兼容样本.docx");
        fs::write(&file, &bytes).unwrap();

        let preview = super::super::document_import::import_document_preview(&root, &file)
            .expect("缺 Fallback 不得崩溃");
        let skipped = preview
            .losses
            .iter()
            .find(|loss| loss.kind == "block_skipped")
            .expect("必须计入告知");
        assert_eq!(skipped.count, 1);
    }

    // ----- 序列标记识别（docx：全加粗段落启发式） -----

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
        let (family, suggestion) =
            detect_split_from_markers(&parsed.markers).expect("应识别集数标记");

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
        assert!(detect_split_from_markers(&parsed.markers).is_none());

        // 加粗但重复不足 3 次：不建议。
        let sparse = Docx::new()
            .add_paragraph(bold_para("第1集"))
            .add_paragraph(bold_para("第2集"));
        let parsed = parse(&pack(sparse));
        assert!(detect_split_from_markers(&parsed.markers).is_none());
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
        let (family, suggestion) =
            detect_split_from_markers(&parsed.markers).expect("应识别章标记");
        assert_eq!(family, "en:chapter");
        assert_eq!(suggestion.marker_sample, "Chapter N");
        assert_eq!(suggestion.count, 3);
    }

    #[test]
    fn numbered_marker_paragraphs_not_marker_eligible() {
        // 列表项段落即使全加粗短序列也不参与标记（避免拆分边界落在列表内部）。
        let docx = Docx::new()
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().bold().add_text("第1集")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().bold().add_text("第2集")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().bold().add_text("第3集")),
            );
        let parsed = parse(&pack(docx));
        assert!(
            parsed.markers.is_empty(),
            "列表项段落不应成为拆分标记：{:?}",
            parsed.markers
        );
    }

    // ----- 预检与提交端到端（走共享命令，泛化后按扩展名分发回本分支） -----

    fn simple_docx_bytes() -> Vec<u8> {
        pack(
            Docx::new()
                .add_paragraph(bold_para("第1集"))
                .add_paragraph(para("第一集正文"))
                .add_paragraph(Paragraph::new())
                .add_paragraph(bold_para("第2集"))
                .add_paragraph(para("第二集正文")),
        )
    }

    fn import_preview(root: &Path, file: &Path) -> super::super::document_import::ImportPreview {
        super::super::document_import::import_document_preview(root, file).expect("预览")
    }

    #[test]
    fn preview_reports_counts_hash_and_no_suggestion_below_threshold() {
        let (temp, root) = seed_project("预览测试");
        let file = temp.path().join("我的剧本.docx");
        let bytes = simple_docx_bytes();
        fs::write(&file, &bytes).unwrap();

        let preview = import_preview(&root, &file);
        assert_eq!(preview.default_doc_name, "我的剧本");
        assert_eq!(
            preview.char_count,
            "第1集第一集正文第2集第二集正文".chars().count()
        );
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
        let bytes = pack(
            Docx::new()
                .add_paragraph(para("前言"))
                .add_paragraph(bold_para("第1集"))
                .add_paragraph(para("一"))
                .add_paragraph(bold_para("第2集"))
                .add_paragraph(para("二"))
                .add_paragraph(bold_para("第3集"))
                .add_paragraph(para("三")),
        );
        fs::write(&file, bytes).unwrap();

        let preview = import_preview(&root, &file);
        let suggestion = preview.split_suggestion.expect("3 个标记应产生建议");
        assert_eq!(suggestion.doc_names, vec!["第1集", "第2集", "第3集"]);
    }

    #[test]
    fn commit_single_doc_creates_validated_document() {
        let (temp, root) = seed_project("提交测试");
        let file = temp.path().join("我的剧本.docx");
        fs::write(&file, simple_docx_bytes()).unwrap();

        let preview = import_preview(&root, &file);
        let result = super::super::document_import::import_document_commit(
            &root,
            &file,
            None,
            false,
            &preview.content_hash,
        )
        .expect("提交");

        assert_eq!(result.created_doc_ids.len(), 1);
        assert!(result.created_folder_id.is_none());

        let tree = super::super::recover_then_read_content_tree(&root).unwrap();
        let doc_id = &result.created_doc_ids[0];
        let node = tree.nodes.get(doc_id).unwrap();
        assert_eq!(node.name, "我的剧本");
        assert!(node.ai_visible, "导入文档 AI 可见性默认与新建文档一致");
        assert!(tree.root_children.contains(doc_id));

        let notebook =
            fs::read_to_string(ProjectPaths::new(root.clone()).document_file(doc_id)).unwrap();
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
        let error = super::super::document_import::import_document_commit(
            &root, &file, None, false, "deadbeef",
        )
        .unwrap_err();
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
        let bytes = pack(
            Docx::new()
                .add_paragraph(para("前言：剧本信息"))
                .add_paragraph(bold_para("第1集"))
                .add_paragraph(para("第一集正文"))
                .add_paragraph(bold_para("第2集"))
                .add_paragraph(para("第二集正文"))
                .add_paragraph(bold_para("第3集"))
                .add_paragraph(para("第三集正文")),
        );
        fs::write(&file, bytes).unwrap();

        let preview = import_preview(&root, &file);
        assert!(preview.split_suggestion.is_some());
        let result = super::super::document_import::import_document_commit(
            &root,
            &file,
            None,
            true,
            &preview.content_hash,
        )
        .expect("拆分提交");

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
        let bytes = pack(
            Docx::new()
                .add_paragraph(bold_para("第1集"))
                .add_paragraph(para("甲"))
                .add_paragraph(bold_para("第1集"))
                .add_paragraph(para("乙"))
                .add_paragraph(bold_para("第2集"))
                .add_paragraph(para("丙")),
        );
        fs::write(&file, bytes).unwrap();

        let preview = import_preview(&root, &file);
        let suggestion = preview.split_suggestion.expect("建议");
        assert_eq!(suggestion.doc_names, vec!["第1集", "第1集 2", "第2集"]);

        let result = super::super::document_import::import_document_commit(
            &root,
            &file,
            None,
            true,
            &preview.content_hash,
        )
        .expect("提交");
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
        let preview = import_preview(&root, &file);
        let result = super::super::document_import::import_document_commit(
            &root,
            &file,
            Some(&folder),
            false,
            &preview.content_hash,
        )
        .expect("提交到文件夹");
        let tree = super::super::recover_then_read_content_tree(&root).unwrap();
        assert!(tree.nodes[&folder]
            .children
            .contains(&result.created_doc_ids[0]));

        // 文档节点不能作为父级。
        let doc_parent = tree.root_children[0].clone();
        let error = super::super::document_import::import_document_commit(
            &root,
            &file,
            Some(&doc_parent),
            false,
            &preview.content_hash,
        )
        .unwrap_err();
        assert!(error.to_string().contains("文件夹"), "报错：{error}");
    }

    #[test]
    fn split_docs_from_blocks_matches_legacy_boundaries() {
        // 拆分边界：标记块是其后文档首块，前言并入第 1 个文档。
        let parsed = parse(&pack(
            Docx::new()
                .add_paragraph(para("前言"))
                .add_paragraph(bold_para("第1集"))
                .add_paragraph(para("甲"))
                .add_paragraph(bold_para("第2集"))
                .add_paragraph(para("乙")),
        ));
        let docs = split_docs_from_blocks(&parsed.blocks, &parsed.markers, "cn:集");
        assert_eq!(docs.len(), 2);
        let first_texts: Vec<String> = docs[0].1["document"]["content"]
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
        assert_eq!(first_texts, vec!["前言", "第1集", "甲"]);
    }

    // ----- 工具函数 -----

    // ===== fix-import-fidelity 复现测试（先失败后修复） =====

    /// 复现 D2：`w:sym` 符号字符当前被静默丢弃（collect_run 的 `_ => {}`）。
    /// F01 修正后 F0FC → U+2714（HEAVY CHECK MARK，Alan Wood 公开表；
    /// 旧值 U+2713 为审计判定的映射错误）。
    #[test]
    fn repro_symbol_characters_mapped_to_unicode() {
        let docx = Docx::new().add_paragraph(
            Paragraph::new()
                .add_run(Run::new().add_sym(docx_rs::Sym::new("Wingdings", "F0FC")))
                .add_run(Run::new().add_text(" 已完成")),
        );
        let parsed = parse(&pack(docx));
        // 期望：勾号成为正文文字（✔ 已完成）。
        assert_eq!(block_text(&parsed.blocks[0]), "\u{2714} 已完成");
        // 未知字体/码位 → symbol_dropped 计数（非静默）。
        let docx = Docx::new().add_paragraph(
            Paragraph::new().add_run(Run::new().add_sym(docx_rs::Sym::new("Webdings", "F0F0"))),
        );
        let parsed = parse(&pack(docx));
        assert_eq!(parsed.losses.symbols, 1, "未知符号字体计入丢弃");
    }

    /// fix-docx-fidelity-residuals 2.2：符号映射表逐条对齐公开编码表
    /// （Wingdings＝Alan Wood 表；Symbol＝Unicode 托管 Adobe Symbol 表，
    /// 取证见 change verification/audit-mapping-verification.md）。
    /// 修正 21＋5 条、对照组不变、未知字体/码位 → None（→ symbol_dropped）。
    #[test]
    fn symbol_tables_match_public_codecharts() {
        // Wingdings 修正条目（含新增 FB）：经 symbol_to_unicode 走 F0 前缀归一化。
        let wingdings_corrected: &[(u32, char)] = &[
            (0xFC, '\u{2714}'),  // HEAVY CHECK MARK
            (0xFD, '\u{1F5F7}'), // BALLOT BOX WITH BOLD SCRIPT X
            (0xFE, '\u{1F5F9}'), // BALLOT BOX WITH BOLD CHECK
            (0x4C, '\u{2639}'),  // WHITE FROWNING FACE
            (0xA8, '\u{25FB}'),  // WHITE MEDIUM SQUARE
            (0xB7, '\u{1F550}'), // CLOCK FACE ONE OCLOCK
            (0xCB, '\u{1F66A}'), // SOLID QUILT SQUARE ORNAMENT
            (0xD8, '\u{2B9A}'),  // THREE-D TOP-LIGHTED RIGHTWARDS EQUILATERAL ARROWHEAD
            (0xE8, '\u{1F87A}'), // WIDE-HEADED RIGHTWARDS HEAVY BARB ARROW
            (0xE9, '\u{1F879}'), // WIDE-HEADED UPWARDS HEAVY BARB ARROW
            (0xEA, '\u{1F87B}'), // WIDE-HEADED DOWNWARDS HEAVY BARB ARROW
            (0xEB, '\u{1F87C}'), // WIDE-HEADED NORTH WEST HEAVY BARB ARROW
            (0xF2, '\u{21E9}'),  // DOWNWARDS WHITE ARROW
            (0xAB, '\u{2605}'),  // BLACK STAR
            (0xBB, '\u{1F554}'), // CLOCK FACE FIVE OCLOCK
            (0xE7, '\u{1F878}'), // WIDE-HEADED LEFTWARDS HEAVY BARB ARROW
            (0xDC, '\u{2B8A}'),  // RIGHTWARDS BLACK CIRCLED WHITE ARROW
            (0xC7, '\u{2BB4}'),  // RIBBON ARROW LEFT UP
            (0x28, '\u{1F57F}'), // BLACK TOUCHTONE TELEPHONE
            (0x3F, '\u{270D}'),  // WRITING HAND
            (0xFB, '\u{1F5F6}'), // BALLOT BOX WITH BOLD SCRIPT X（F03 补缺）
        ];
        for (code, expected) in wingdings_corrected {
            let via_prefix = format!("F0{code:02X}");
            assert_eq!(
                symbol_to_unicode("Wingdings", &via_prefix),
                Some(*expected),
                "Wingdings F0{code:02X} 应映射公开表字符"
            );
        }
        // Wingdings 对照组（公开表一致，不得改）。
        for (code, expected) in [
            (0x4A, '\u{263A}'),
            (0x4B, '\u{1F610}'),
            (0x6E, '\u{25A0}'),
            (0x6F, '\u{25A1}'),
            (0x71, '\u{2751}'),
            (0xA7, '\u{25AA}'),
        ] {
            assert_eq!(
                wingdings_char(code),
                Some(expected),
                "Wingdings {code:#04X}"
            );
        }
        // Symbol 修正条目（F02；Adobe Symbol 表）。
        for (code, expected) in [
            (0xD6, '\u{221A}'), // SQUARE ROOT
            (0xD7, '\u{22C5}'), // DOT OPERATOR
            (0xB2, '\u{2033}'), // DOUBLE PRIME
            (0xA1, '\u{03D2}'), // GREEK UPSILON WITH HOOK SYMBOL
            (0xD1, '\u{2207}'), // NABLA
        ] {
            assert_eq!(symbol_font_char(code), Some(expected), "Symbol {code:#04X}");
        }
        // Symbol 对照组（不得改；一对多条目按既有首行取值）。
        for (code, expected) in [
            (0xB1, '±'),
            (0xB4, '×'),
            (0xB8, '÷'),
            (0xB9, '≠'),
            (0xBB, '≈'),
            (0xA3, '≤'),
            (0xB3, '≥'),
            (0xA5, '∞'),
            (0xB0, '°'),
            (0xB7, '•'),
            (0x6C, 'λ'),
            (0x44, 'Δ'),
            (0x57, 'Ω'),
            (0x6D, 'μ'),
        ] {
            assert_eq!(symbol_font_char(code), Some(expected), "Symbol {code:#04X}");
        }
        // 未知字体 / 未知码位 → None（→ symbol_dropped 计数告知，不静默）。
        assert_eq!(symbol_to_unicode("Webdings", "F0F0"), None, "未知字体");
        assert_eq!(
            symbol_to_unicode("Wingdings", "F040"),
            None,
            "未知 Wingdings 码位"
        );
        assert_eq!(
            symbol_to_unicode("Symbol", "F090"),
            None,
            "未知 Symbol 码位"
        );
        assert_eq!(symbol_to_unicode("Wingdings", "ZZ"), None, "非法十六进制");
    }

    /// fix-docx-fidelity-residuals 2.3：构造覆盖全部修正条目的符号样本，
    /// 经完整导入管线逐字符断言（零错误映射、零丢弃）。
    #[test]
    fn symbol_spike_docx_covers_all_corrected_entries() {
        // (字体, w:char 写法, 期望字符)：Wingdings 21 条＋Symbol 5 条；
        // 混用 F0 前缀与裸写法，覆盖读取层前缀归一化。
        let entries: &[(&str, &str, char)] = &[
            ("Wingdings", "F0FC", '\u{2714}'),
            ("Wingdings", "F0FD", '\u{1F5F7}'),
            ("Wingdings", "F0FE", '\u{1F5F9}'),
            ("Wingdings", "F04C", '\u{2639}'),
            ("Wingdings", "F0A8", '\u{25FB}'),
            ("Wingdings", "F0B7", '\u{1F550}'),
            ("Wingdings", "F0CB", '\u{1F66A}'),
            ("Wingdings", "F0D8", '\u{2B9A}'),
            ("Wingdings", "F0E8", '\u{1F87A}'),
            ("Wingdings", "F0E9", '\u{1F879}'),
            ("Wingdings", "F0EA", '\u{1F87B}'),
            ("Wingdings", "F0EB", '\u{1F87C}'),
            ("Wingdings", "F0F2", '\u{21E9}'),
            ("Wingdings", "F0AB", '\u{2605}'),
            ("Wingdings", "F0BB", '\u{1F554}'),
            ("Wingdings", "F0E7", '\u{1F878}'),
            ("Wingdings", "F0DC", '\u{2B8A}'),
            ("Wingdings", "F0C7", '\u{2BB4}'),
            ("Wingdings", "F028", '\u{1F57F}'),
            ("Wingdings", "F03F", '\u{270D}'),
            ("Wingdings", "F0FB", '\u{1F5F6}'),
            ("Symbol", "F0D6", '\u{221A}'),
            ("Symbol", "F0D7", '\u{22C5}'),
            ("Symbol", "B2", '\u{2033}'),
            ("Symbol", "F0A1", '\u{03D2}'),
            ("Symbol", "D1", '\u{2207}'),
        ];
        let mut paragraph = Paragraph::new();
        let mut expected = String::new();
        for (font, code, ch) in entries {
            paragraph = paragraph.add_run(Run::new().add_sym(docx_rs::Sym::new(*font, *code)));
            expected.push(*ch);
        }
        let parsed = parse(&pack(Docx::new().add_paragraph(paragraph)));
        assert_eq!(
            block_text(&parsed.blocks[0]),
            expected,
            "全部修正条目逐字符一致"
        );
        assert_eq!(parsed.losses.symbols, 0, "已知条目零丢弃");
    }

    /// fix-docx-fidelity-residuals 3.3（F05）：字体选择按 run 文字字符类别。
    #[test]
    fn font_selection_by_script_class() {
        let fonts = || {
            RunFonts::new()
                .ascii("Calibri")
                .east_asia("Microsoft YaHei")
        };
        let docx = Docx::new()
            .add_paragraph(
                Paragraph::new().add_run(Run::new().fonts(fonts()).add_text("Latin text")),
            )
            .add_paragraph(Paragraph::new().add_run(Run::new().fonts(fonts()).add_text("中文文本")))
            .add_paragraph(
                Paragraph::new().add_run(Run::new().fonts(fonts()).add_text("mixed 中文text")),
            )
            // 纯拉丁但缺 ascii 键 → 按西文键序回退 hiAnsi（缺）→ eastAsia。
            .add_paragraph(
                Paragraph::new().add_run(
                    Run::new()
                        .fonts(RunFonts::new().east_asia("Microsoft YaHei"))
                        .add_text("no ascii key"),
                ),
            )
            // 空文本 run（仅符号）：维持原回退链（eastAsia 优先）。
            .add_paragraph(
                Paragraph::new().add_run(
                    Run::new()
                        .fonts(fonts())
                        .add_sym(docx_rs::Sym::new("Wingdings", "F0FC")),
                ),
            );
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);
        let family = |block: usize| {
            blocks[block]["content"][0]["marks"]
                .as_array()
                .unwrap()
                .iter()
                .find_map(|m| m["attrs"]["fontFamily"].as_str().map(str::to_string))
                .unwrap()
        };
        assert_eq!(family(0), "Calibri", "纯拉丁 run 取 ascii 字体");
        assert_eq!(family(1), "Microsoft YaHei", "纯中文 run 取 eastAsia 字体");
        assert_eq!(
            family(2),
            "Microsoft YaHei",
            "混排 run 取东亚字体（不拆 run）"
        );
        assert_eq!(
            family(3),
            "Microsoft YaHei",
            "纯拉丁缺 ascii → 按键序回退至 eastAsia"
        );
        assert_eq!(
            family(4),
            "Microsoft YaHei",
            "空文本 run（符号）维持原回退链 eastAsia"
        );
    }

    /// fix-docx-fidelity-residuals 3.3（F04）：样式链 spacing 按子属性合并。
    #[test]
    fn style_chain_line_spacing_subproperty_merge() {
        let mut base = Style::new("SpBase", StyleType::Paragraph).name("sp-base");
        base.paragraph_property = base.paragraph_property.clone().line_spacing(
            LineSpacing::new()
                .line_rule(LineSpacingType::Auto)
                .line(276),
        );
        let mut mid = Style::new("SpMid", StyleType::Paragraph)
            .name("sp-mid")
            .based_on("SpBase");
        // Mid 仅覆盖段后间距——继承行距不得丢失（F04）。
        mid.paragraph_property = mid
            .paragraph_property
            .clone()
            .line_spacing(LineSpacing::new().after(80));
        let docx = Docx::new()
            .add_style(base)
            .add_style(mid)
            // 场景一：仅样式链（Base line=276 + Mid after=80）。
            .add_paragraph(
                Paragraph::new()
                    .style("SpMid")
                    .add_run(Run::new().add_text("一")),
            )
            // 场景二：直接属性另覆盖 before（多子属性混合；line/after 继承保留）。
            .add_paragraph(
                Paragraph::new()
                    .style("SpMid")
                    .line_spacing(LineSpacing::new().before(120))
                    .add_run(Run::new().add_text("二")),
            )
            // 场景三：直接属性覆盖 line（直接值优先；after 继承保留）。
            .add_paragraph(
                Paragraph::new()
                    .style("SpMid")
                    .line_spacing(
                        LineSpacing::new()
                            .line_rule(LineSpacingType::Auto)
                            .line(360),
                    )
                    .add_run(Run::new().add_text("三")),
            );
        let parsed = parse(&pack(docx));
        let blocks = blocks_of(&parsed);
        assert_eq!(
            blocks[0]["attrs"]["lineHeight"], "1.15",
            "仅覆盖段后间距时继承行距保留"
        );
        assert_eq!(blocks[0]["attrs"]["spacingAfter"], "4pt");
        assert_eq!(
            blocks[1]["attrs"]["lineHeight"], "1.15",
            "直接覆盖 before 不影响继承 line"
        );
        assert_eq!(blocks[1]["attrs"]["spacingBefore"], "6pt");
        assert_eq!(blocks[1]["attrs"]["spacingAfter"], "4pt");
        assert_eq!(blocks[2]["attrs"]["lineHeight"], "1.5", "直接覆盖行距优先");
        assert_eq!(
            blocks[2]["attrs"]["spacingAfter"], "4pt",
            "直接覆盖行距不影响继承段后距"
        );
    }

    /// 复现 D3：basedOn 三层链的样式格式当前丢失（styles_by_id 只存名称）。
    #[test]
    fn repro_style_chain_formatting_applied() {
        let mut grand = Style::new("Grand", StyleType::Paragraph).name("grand");
        grand.run_property = grand.run_property.clone().bold();
        let mut parent = Style::new("Parent", StyleType::Paragraph)
            .name("parent")
            .based_on("Grand");
        parent.run_property = parent.run_property.clone().size(28);
        let mut child = Style::new("Child", StyleType::Paragraph)
            .name("child")
            .based_on("Parent");
        child.run_property = child.run_property.clone().color("FF0000");
        let docx = Docx::new()
            .add_style(grand)
            .add_style(parent)
            .add_style(child)
            .add_paragraph(
                Paragraph::new()
                    .style("Child")
                    .add_run(Run::new().add_text("链式样式文字")),
            );
        let parsed = parse(&pack(docx));
        let marks = &parsed.blocks[0]["content"][0]["marks"];
        let types: Vec<&str> = marks
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["type"].as_str().unwrap())
            .collect();
        // 期望：粗体（来自 Grand）＋颜色（来自 Child）＋字号 14pt（来自 Parent）。
        assert!(types.contains(&"bold"), "祖父样式的粗体应生效：{types:?}");
        assert!(
            types.contains(&"textStyle"),
            "链上字号/颜色应生效：{types:?}"
        );
        let text_style = marks
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["type"] == "textStyle")
            .unwrap();
        assert_eq!(text_style["attrs"]["fontSize"], "14pt");
        assert_eq!(text_style["attrs"]["color"], "#ff0000");
    }

    /// 复现 D4：同一 numId 的有序列表被普通段落打断后，当前从起点重起。
    #[test]
    fn repro_numbering_continues_across_interruption() {
        let docx = Docx::new()
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("第一项")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("第二项")),
            )
            .add_paragraph(para("打断段落"))
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("第三项")),
            );
        let parsed = parse(&pack(docx));
        let ordered: Vec<&Value> = parsed
            .blocks
            .iter()
            .filter(|b| b["type"] == "orderedList")
            .collect();
        assert_eq!(ordered.len(), 2, "打断产生两个列表块");
        // 期望：重续块从 3 续算（当前错误地重起为 1）。
        assert_eq!(
            ordered[1]["attrs"]["start"], 3,
            "重续列表应以当前计数值为 start"
        );
    }

    /// D4 的 startOverride 消费：numId 2 覆盖起点为 5。
    #[test]
    fn repro_start_override_consumed() {
        let abstract_num = AbstractNumbering::new(1).add_level(Level::new(
            0,
            Start::new(1),
            NumberFormat::new("decimal"),
            LevelText::new("%1."),
            LevelJc::new("left"),
        ));
        let docx = Docx::new()
            .add_abstract_numbering(abstract_num)
            .add_numbering(
                docx_rs::Numbering::new(2, 1).add_override(docx_rs::LevelOverride::new(0).start(5)),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(2), IndentLevel::new(0))
                    .add_run(Run::new().add_text("覆盖项")),
            );
        let parsed = parse(&pack(docx));
        let ordered: Vec<&Value> = parsed
            .blocks
            .iter()
            .filter(|b| b["type"] == "orderedList")
            .collect();
        assert_eq!(ordered.len(), 1);
        assert_eq!(ordered[0]["attrs"]["start"], 5, "startOverride 改写起点");
    }

    /// D4 矩阵：双列表交错——各自计数互不干扰、同打断续算。
    #[test]
    fn numbering_two_lists_interleave_independently() {
        let abstract_a = AbstractNumbering::new(1).add_level(Level::new(
            0,
            Start::new(1),
            NumberFormat::new("decimal"),
            LevelText::new("%1."),
            LevelJc::new("left"),
        ));
        let abstract_b = AbstractNumbering::new(2).add_level(Level::new(
            0,
            Start::new(10),
            NumberFormat::new("decimal"),
            LevelText::new("%1."),
            LevelJc::new("left"),
        ));
        let item = |num: usize, text: &str| {
            Paragraph::new()
                .numbering(NumberingId::new(num), IndentLevel::new(0))
                .add_run(Run::new().add_text(text))
        };
        let docx = Docx::new()
            .add_abstract_numbering(abstract_a)
            .add_abstract_numbering(abstract_b)
            .add_numbering(docx_rs::Numbering::new(1, 1))
            .add_numbering(docx_rs::Numbering::new(2, 2))
            .add_paragraph(item(1, "甲一"))
            .add_paragraph(item(2, "乙十"))
            .add_paragraph(item(1, "甲二"))
            .add_paragraph(item(2, "乙十一"));
        let parsed = parse(&pack(docx));
        let ordered: Vec<&Value> = parsed
            .blocks
            .iter()
            .filter(|b| b["type"] == "orderedList")
            .collect();
        // 交错产生 4 个列表块（每次 numId 切换即断组），各自从当前计数续起。
        assert_eq!(ordered.len(), 4, "块序列：{ordered:#?}");
        assert_eq!(ordered[0]["attrs"]["start"], 1, "甲一");
        assert_eq!(ordered[1]["attrs"]["start"], 10, "乙十");
        assert_eq!(ordered[2]["attrs"]["start"], 2, "甲二续算");
        assert_eq!(ordered[3]["attrs"]["start"], 11, "乙十一续算");
    }

    /// D4 矩阵：更深层级出现→重置（ilvl1 降级为普通段，ilvl0 计数不受段落
    /// 打断影响持续）；墓碑 numId=0 与真编号并存互不干扰。
    #[test]
    fn numbering_deeper_level_reset_and_tombstone_coexistence() {
        let abstract_num = AbstractNumbering::new(1)
            .add_level(Level::new(
                0,
                Start::new(1),
                NumberFormat::new("decimal"),
                LevelText::new("%1."),
                LevelJc::new("left"),
            ))
            .add_level(Level::new(
                1,
                Start::new(1),
                NumberFormat::new("decimal"),
                LevelText::new("%2."),
                LevelJc::new("left"),
            ));
        let docx = Docx::new()
            .add_abstract_numbering(abstract_num)
            .add_numbering(docx_rs::Numbering::new(1, 1))
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("第一项")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(1))
                    .add_run(Run::new().add_text("子层（降级为普通段）")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("第二项")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(0), IndentLevel::new(0))
                    .add_run(Run::new().add_text("墓碑段")),
            )
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(1), IndentLevel::new(0))
                    .add_run(Run::new().add_text("第三项")),
            );
        let parsed = parse(&pack(docx));
        // ilvl1 → numbering_degraded；ilvl0 计数跨「降级段＋墓碑段」持续。
        assert_eq!(parsed.losses.numbering_degraded, 1);
        let ordered: Vec<&Value> = parsed
            .blocks
            .iter()
            .filter(|b| b["type"] == "orderedList")
            .collect();
        assert_eq!(ordered.len(), 3, "三个列表片段");
        assert_eq!(ordered[0]["attrs"]["start"], 1, "第一项");
        assert_eq!(ordered[1]["attrs"]["start"], 2, "第二项跨子层降级段续算");
        assert_eq!(ordered[2]["attrs"]["start"], 3, "第三项跨墓碑段续算");
        // 墓碑段是普通段落、文字完整。
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert!(texts.contains(&"墓碑段".to_string()));
    }

    /// D3：样式链携带的编号（ListNumber 风格：pStyle → 样式 pPr numPr）。
    #[test]
    fn style_linked_numbering_applies() {
        let mut list_style = Style::new("ListNumber", StyleType::Paragraph).name("List Number");
        list_style.paragraph_property = list_style
            .paragraph_property
            .clone()
            .numbering(NumberingId::new(1), IndentLevel::new(0));
        let abstract_num = AbstractNumbering::new(1).add_level(Level::new(
            0,
            Start::new(1),
            NumberFormat::new("decimal"),
            LevelText::new("%1."),
            LevelJc::new("left"),
        ));
        let docx = Docx::new()
            .add_abstract_numbering(abstract_num)
            .add_numbering(docx_rs::Numbering::new(1, 1))
            .add_style(list_style)
            .add_paragraph(
                Paragraph::new()
                    .style("ListNumber")
                    .add_run(Run::new().add_text("样式编号项")),
            )
            // 墓碑段：写侧只有在出现直接编号段落时才输出 numbering.xml，
            // 用 numId=0 墓碑强制携带定义（导入侧按墓碑处理为普通段落）。
            .add_paragraph(
                Paragraph::new()
                    .numbering(NumberingId::new(0), IndentLevel::new(0))
                    .add_run(Run::new().add_text("墓碑触发段")),
            );
        let parsed = parse(&pack(docx));
        let ordered: Vec<&Value> = parsed
            .blocks
            .iter()
            .filter(|b| b["type"] == "orderedList")
            .collect();
        assert_eq!(ordered.len(), 1, "样式链携带的编号应生效");
        assert_eq!(
            block_text(&ordered[0]["content"][0]["content"][0]),
            "样式编号项"
        );
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert!(
            texts.contains(&"墓碑触发段".to_string()),
            "墓碑段保留：{texts:?}"
        );
    }

    /// D3：样式链上语法不承载的属性计入 style_degraded（每段一次）。
    #[test]
    fn style_degraded_counted_for_unmappable_chain_props() {
        let mut styled = Style::new("CapStyle", StyleType::Paragraph).name("cap style");
        styled.run_property = styled.run_property.clone().caps();
        let docx = Docx::new()
            .add_style(styled)
            .add_paragraph(
                Paragraph::new()
                    .style("CapStyle")
                    .add_run(Run::new().add_text("全大写样式段")),
            )
            .add_paragraph(para("普通段"));
        let parsed = parse(&pack(docx));
        // caps 不映射：一个使用段落计一次；直接属性上的 caps 不计（既有口径：
        // 计数针对「样式链上」未解析属性）。
        assert_eq!(parsed.losses.style_degraded, 1);
        assert_eq!(block_text(&parsed.blocks[0]), "全大写样式段", "文字无损");
    }

    /// D3：默认段落样式（styles.xml w:default="1"）对无 pStyle 段落生效。
    #[test]
    fn default_paragraph_style_applies_to_unstyled_paragraphs() {
        // docx-rs 写侧不出 default 标志——手工 ZIP 注入 styles.xml。
        let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>无样式段落</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let styles_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="24"/></w:rPr>
  </w:style>
</w:styles>"#;
        let bytes = write_minimal_docx_with_styles(document_xml, styles_xml);
        let parsed = parse(&bytes);
        // 无 pStyle 段落继承默认样式 Normal 的 12pt。
        let text_node = &parsed.blocks[0]["content"][0];
        let marks = text_node["marks"].as_array().expect("应有 textStyle");
        assert_eq!(marks[0]["type"], "textStyle");
        assert_eq!(marks[0]["attrs"]["fontSize"], "12pt");
    }

    /// D3：环状 basedOn 链防护（A→B→A 截断不崩溃）。
    #[test]
    fn cyclic_based_on_chain_guarded() {
        let mut a = Style::new("A", StyleType::Paragraph)
            .name("a")
            .based_on("B");
        a.run_property = a.run_property.clone().bold();
        let mut b = Style::new("B", StyleType::Paragraph)
            .name("b")
            .based_on("A");
        b.run_property = b.run_property.clone().italic();
        let docx = Docx::new().add_style(a).add_style(b).add_paragraph(
            Paragraph::new()
                .style("A")
                .add_run(Run::new().add_text("环链文字")),
        );
        let parsed = parse(&pack(docx));
        assert_eq!(block_text(&parsed.blocks[0]), "环链文字");
        // 环截断后链上属性仍生效（bold 来自 A 自身）。
        let marks = parsed.blocks[0]["content"][0]["marks"].as_array().cloned();
        let has_bold = marks.is_some_and(|ms| ms.iter().any(|m| m["type"] == "bold"));
        assert!(has_bold, "环防护不丢链上属性");
    }

    // ----- 工具函数（原位） -----

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
            styles_xml: None,
        };
        assert_eq!(
            extract_generator(&scan).as_deref(),
            Some("WPS Office / KSOProductBuildVer 12.1.0.26375")
        );
    }

    // 共享管线入口可达性（泛化分发后 docx 分支仍被正确路由）。
    #[allow(dead_code)]
    fn _dispatch_surface(format: ImportFormat) {
        let _ = format;
    }
}
