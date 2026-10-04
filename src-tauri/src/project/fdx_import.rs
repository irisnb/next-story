//! Final Draft `.fdx` 导入（add-fdx-import 任务组 2）：明文 UTF-8 XML →
//! canonical Tiptap JSON v2（roxmltree 一次性 DOM，design D1）。
//!
//! - **读取**（design D2）：UTF-8＋BOM 剥离兜底（spike 实证两样本均无 BOM）；
//!   XML 良构性与根元素 `<FinalDraft>` 校验，畸形中文报错；16MB 上限由共享
//!   管线按 [`super::document_import::MAX_FDX_INPUT_BYTES`] 执行；`.fdr` 老格式
//!   在共享分发层直接拒绝。generator 印记＝根元素 Version＋DocumentType。
//! - **映射**（design D3，spike 实证形态＋独立审计修正）：Scene Heading/Shot→
//!   heading 2（Number 场景编号并入标题文字前缀，仅 Scene Heading 读取——
//!   设置段有「123」污染）；New Act→heading 1；Outline N→heading N（clamp
//!   1–6）；Action/General/Cast List/Lyrics/More/未知→paragraph。**段落布局
//!   以 `ElementSettings` 的 `ParagraphSpec` 为权威**：Alignment→textAlign
//!   （三态：显式 Right/Center/Full("justify") 输出、显式 Left 不输出但**不
//!   触发转场右对齐回退**、缺失按缺省处理）；相对缩进＝类型 LeftIndent−基准
//!   （基准取 Action 或 General 的实际值，不硬编码）→indentLeft、正文
//!   RightIndent−类型 RightIndent（右侧收窄）→indentRight；FirstIndent→
//!   textIndent（编辑器段落属性支持负值＝悬挂，英寸×72→pt）。缺块/缺属性/
//!   缺基准回退固定档（Dialogue 浅 2em、Parenthetical 中 3em、Character 深
//!   4em——实测 FD 布局的 1:1.5:2 相对顺序）；Transition 只带对齐（显式
//!   Left 不回退右对齐；缺省回退右对齐；页面几何缩进不搬运）。TitlePage
//!   并入段的 Alignment 保留为 textAlign。`Text@Style` `+` 分隔词组→
//!   bold/italic/underline；`Text@Font/Size/Color`→textStyle（fontFamily/
//!   fontSize〔FD 点值直读〕/color〔FD 12 位十六进制截前 6 位 RGB〕）——
//!   只搬 Text 上的显式值，ElementSettings 的 FontSpec 类型级默认是回声不
//!   搬运；AllCaps 与 AdornmentStyle 是显示属性，忽略不计损耗。段落上的
//!   Alignment/LeftIndent/… 布局属性＝元素默认值回声，一律忽略（权威在
//!   ElementSettings）。
//! - **未知元素计数**（design D1 承诺，审计落实）：已知结构元素与根级机器
//!   家具白名单（真实样本实证全集）之外的白名单外元素计入
//!   `unknown_element_skipped`（名称入 note）；机器家具维持静默。
//! - **结构性降级计数**：DualDialogue 拆为先后两组段落
//!   （dual_dialogue_degraded）；TitlePage 文字逐段并入文档开头、空段丢弃
//!   （titlepage_inlined）；SceneProperties 及 Summary/SceneArcBeats 丢弃
//!   （scene_metadata_dropped，ScriptNote 段内嵌套同理计数丢弃
//!   scriptnote_dropped）；修订体系定义与行内非零 RevisionID 忽略、文字无损
//!   （revision_marks_ignored）；其余根级机器设置（SmartType/ElementSettings/
//!   MoresAndContinueds/Watermarking/LockedPages/SpellCheckIgnoreLists/
//!   SplitState/ListItems 等）无感丢弃。
//! - **拆分建议**（design D4）：场景头已成标题，复用既有「同层级短序列标题
//!   重复 ≥3」框架；标记识别用**无编号前缀**的标题文本（编号前缀不参与序列
//!   模式识别）。默认不拆、用户拍板。

use std::collections::HashMap;

use roxmltree::Node;
use serde_json::{json, Map, Value};

use super::document_import::{
    merge_inline_runs, parse_marker_family, InlineRun, LossCounter, ParsedDocument,
};
use super::ProjectError;

// ========== 固定档回退（缺 ElementSettings/缺属性/缺基准时） ==========
//
// 实测 FD 默认布局的相对顺序：Dialogue 最浅（+1"）、Parenthetical 居中
// （+1.5"）、Character 最深（+2"），比例 1:1.5:2。编辑器缩进语义用 em 档位
// 表达该比例：2em / 3em / 4em（4em 超出编辑器下拉菜单的 1–3em 档，但
// grammar 允许任意非空度量串，保真顺序优先）。

/// Dialogue 回退档（浅）。
const FALLBACK_INDENT_DIALOGUE: &str = "2em";
/// Parenthetical 回退档（中）。
const FALLBACK_INDENT_PARENTHETICAL: &str = "3em";
/// Character 回退档（深）。
const FALLBACK_INDENT_CHARACTER: &str = "4em";

// ========== ElementSettings 布局（用户验收修正：权威布局来源） ==========

/// 对齐三态（审计修正：显式 Left 与属性缺失必须区分）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum FdAlignment {
    /// 显式 Right → textAlign "right"。
    Right,
    /// 显式 Center → textAlign "center"。
    Center,
    /// 显式 Full（两端对齐）→ textAlign "justify"（编辑器语法合法值之一）。
    Full,
    /// 显式 Left → 不输出 textAlign（左对齐是默认值），但**不触发任何回退**。
    Left,
    /// 属性缺失 → 按各类型的缺省规则处理（如 Transition 回退右对齐）。
    #[default]
    Missing,
}

impl FdAlignment {
    fn parse(value: &str) -> Self {
        match value {
            "Right" => FdAlignment::Right,
            "Center" => FdAlignment::Center,
            "Full" => FdAlignment::Full,
            "Left" => FdAlignment::Left,
            // 未知取值：按显式 Left 处理（不输出、不回退），版本差异容忍。
            _ => FdAlignment::Left,
        }
    }

    /// 输出的 textAlign（Left/Missing → None；Missing 的回退由调用方处理）。
    fn text_align(self) -> Option<&'static str> {
        match self {
            FdAlignment::Right => Some("right"),
            FdAlignment::Center => Some("center"),
            FdAlignment::Full => Some("justify"),
            FdAlignment::Left | FdAlignment::Missing => None,
        }
    }
}

/// 单个元素类型的权威布局（来自根级 `ElementSettings > ParagraphSpec`）。
#[derive(Default)]
struct ElementLayout {
    alignment: FdAlignment,
    /// 左缩进（英寸，FD 从页面左缘起算）；缺失/非法＝None。
    left_indent: Option<f64>,
    /// 右缩进（英寸）；缺失/非法＝None。
    right_indent: Option<f64>,
    /// 首行缩进（英寸，相对 LeftIndent；负值＝悬挂，如 Parenthetical −0.10）。
    first_indent: Option<f64>,
}

type LayoutMap = HashMap<String, ElementLayout>;

/// 收集根级 `ElementSettings` 块为 Type→布局映射（重复块后者覆盖前者）。
fn collect_layouts(root: Node) -> LayoutMap {
    let mut map = LayoutMap::new();
    for child in root.children() {
        if !child.is_element() || child.tag_name().name() != "ElementSettings" {
            continue;
        }
        let Some(paragraph_type) = child.attribute("Type") else {
            continue;
        };
        for spec in child.children() {
            if !spec.is_element() || spec.tag_name().name() != "ParagraphSpec" {
                continue;
            }
            let mut layout = ElementLayout::default();
            if let Some(alignment) = spec.attribute("Alignment") {
                layout.alignment = FdAlignment::parse(alignment);
            }
            layout.left_indent = spec
                .attribute("LeftIndent")
                .and_then(|value| value.trim().parse::<f64>().ok());
            layout.right_indent = spec
                .attribute("RightIndent")
                .and_then(|value| value.trim().parse::<f64>().ok());
            layout.first_indent = spec
                .attribute("FirstIndent")
                .and_then(|value| value.trim().parse::<f64>().ok());
            map.insert(paragraph_type.to_string(), layout);
        }
    }
    map
}

/// 正文基准缩进（英寸）：优先 Action、其次 General 的实际值——不硬编码 1.50
/// （不同模板/纸张的基准不同）。返回 (左基准, 右基准)。
fn base_indents(layouts: &LayoutMap) -> (Option<f64>, Option<f64>) {
    let base = |field: fn(&ElementLayout) -> Option<f64>| -> Option<f64> {
        layouts
            .get("Action")
            .and_then(field)
            .or_else(|| layouts.get("General").and_then(field))
    };
    (base(|l| l.left_indent), base(|l| l.right_indent))
}

/// 英寸差 → 编辑器缩进属性值（pt）。沿用 docx 侧已验证的单位约定：绝对
/// 度量（docx 的 twips、fdx 的英寸）换算为 pt，字符相对量才用 em。
/// 差值≈0 输出 None（不产生 "0pt" 噪音）。
fn indent_attr_from_inches(inches: f64) -> Option<String> {
    let pt = (inches * 72.0 * 100.0).round() / 100.0;
    if pt.abs() < 0.005 {
        return None;
    }
    Some(format!("{}pt", format_decimal(pt)))
}

/// 最多两位小数、去尾随零（与 docx 侧 format_decimal 同一算法）。
fn format_decimal(value: f64) -> String {
    let mut text = format!("{value:.2}");
    if text.contains('.') {
        text = text.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    text
}

// ========== 读取与解析入口（design D2） ==========

/// 解析 `.fdx` 字节为共享管线的 [`ParsedDocument`]。
///
/// 步骤：剥 BOM → 严格 UTF-8 → roxmltree 良构性解析 → 根元素校验 →
/// 按上下文遍历映射。畸形与编码问题以中文报错稳定失败，零副作用。
pub(crate) fn parse_fdx(bytes: &[u8]) -> Result<ParsedDocument, ProjectError> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(bytes);
    let text = std::str::from_utf8(bytes).map_err(|_| {
        ProjectError::ImportRejected(
            "文件不是 UTF-8 编码：请用 Final Draft 或文本编辑器转存为 UTF-8 后再导入".to_string(),
        )
    })?;
    let doc = roxmltree::Document::parse(text).map_err(|e| {
        ProjectError::ImportRejected(format!("不是有效的 .fdx 文件（XML 解析失败：{e}）"))
    })?;
    let root = doc.root_element();
    if root.tag_name().name() != "FinalDraft" {
        return Err(ProjectError::ImportRejected(format!(
            "不是有效的 .fdx 文件：根元素应为 FinalDraft，实际为 {}",
            root.tag_name().name()
        )));
    }
    // generator 印记（样本归因）：Version＋DocumentType。
    let version = root.attribute("Version").unwrap_or("未知");
    let document_type = root.attribute("DocumentType").unwrap_or("未知");
    let generator = format!("FinalDraft Version={version}, DocumentType={document_type}");

    // 布局预读：ElementSettings 是每类型布局的权威（ElementSettings 在文档中
    // 出现在 Content 之后也无关——DOM 一次性载入，先收集再遍历正文）。
    let layouts = collect_layouts(root);
    let (base_left, base_right) = base_indents(&layouts);

    let mut converter = FdxConverter::new(layouts, base_left, base_right);
    converter.walk_root(root);
    Ok(converter.finish(Some(generator)))
}

/// 根级机器家具白名单（真实样本实证全集：storyboarder、rsdoiel×2、
/// Big-Fish 的根级子元素并集，去掉被遍历的 Content/TitlePage/Revisions/
/// UnanchoredScriptNotes/ElementSettings）。设置与状态类部件静默丢弃，
/// 不计入未知元素。
const ROOT_FURNITURE: &[&str] = &[
    "SmartType",
    "MoresAndContinueds",
    "Watermarking",
    "LockedPages",
    "SpellCheckIgnoreLists",
    "SplitState",
    "ListItems",
    "Macros",
    "PageLayout",
    "SceneNumberOptions",
    "SceneBreaks",
    "TargetScriptLength",
    "AltCollection",
    "WindowState",
    "TextState",
    "Actors",
    "Cast",
    "CastList",
    "DisplayBoards",
    "CharacterHighlighting",
    "CharacterNavigatorPreferences",
    "ScriptNoteDefinitions",
    "TagData",
    // TitlePage 内的页眉页脚（walk_title_page 只走其 Content 子树）。
    "HeaderAndFooter",
];

// ========== 元素结构遍历（spike 实证：无 Type 段落按上下文分发） ==========

struct FdxConverter {
    losses: LossCounter,
    char_count: usize,
    paragraph_count: usize,
    /// 剧本正文块（最终块序列的主体）。
    blocks: Vec<Value>,
    /// 顶层标题序列标记（块索引 + 带层级前缀的族键 + 文本）。
    markers: Vec<(usize, String, String)>,
    /// TitlePage 并入块（finish 时前置到正文之前，索引随之后移）。
    title_blocks: Vec<Value>,
    /// 每类型权威布局（ElementSettings）。
    layouts: LayoutMap,
    /// 正文基准缩进（英寸，Action/General 实际值）。
    base_left: Option<f64>,
    base_right: Option<f64>,
}

impl FdxConverter {
    fn new(layouts: LayoutMap, base_left: Option<f64>, base_right: Option<f64>) -> Self {
        Self {
            losses: LossCounter::default(),
            char_count: 0,
            paragraph_count: 0,
            blocks: Vec::new(),
            markers: Vec::new(),
            title_blocks: Vec::new(),
            layouts,
            base_left,
            base_right,
        }
    }

    fn walk_root(&mut self, root: Node) {
        for child in root.children() {
            if !child.is_element() {
                continue;
            }
            match child.tag_name().name() {
                "Content" => self.walk_content(child),
                "TitlePage" => self.walk_title_page(child),
                "Revisions" => {
                    // 修订样式定义（Revision 子元素）：忽略＋计数；行内非零
                    // RevisionID 在 Text 处理时计数。文字无损。
                    for revision in child.children() {
                        if revision.is_element() && revision.tag_name().name() == "Revision" {
                            self.losses.revision_marks += 1;
                        }
                    }
                }
                // 未锚定剧注（不挂在任何段落上的 ScriptNote，含真实作者文字）：
                // 按剧注同样丢弃＋计数，不静默。
                "UnanchoredScriptNotes" => {
                    for note in child.children() {
                        if note.is_element() && note.tag_name().name() == "ScriptNote" {
                            self.losses.scriptnote += 1;
                        }
                    }
                }
                // 根级机器家具（真实样本实证全集：storyboarder/rsdoiel×2/
                // Big-Fish 根级子元素并集）：设置与状态类部件，静默丢弃。
                other if ROOT_FURNITURE.contains(&other) => {}
                // 已由布局预读消费（collect_layouts）；遍历期不再处理、不计未知。
                "ElementSettings" => {}
                // 白名单外未知根级部件：计数告知（design D1；未来 FD 版本的
                // 新部件会被看见而不是无声消失）。
                other => self.count_unknown_element(other),
            }
        }
    }

    /// 剧本正文：Content 的直接 Paragraph 子序列。
    fn walk_content(&mut self, content: Node) {
        for paragraph in content.children() {
            if paragraph.is_element() && paragraph.tag_name().name() == "Paragraph" {
                self.walk_script_paragraph(paragraph);
            }
        }
    }

    /// 顶层段落：无 Type 且含 DualDialogue 子元素＝双栏对白包裹段（spike 实证
    /// 结构），拆为先后两组段落；其余按 Type 映射。
    fn walk_script_paragraph(&mut self, paragraph: Node) {
        let dual = paragraph
            .children()
            .find(|child| child.is_element() && child.tag_name().name() == "DualDialogue");
        match dual {
            Some(dual) => {
                // 包裹段内除 DualDialogue 外可能嵌 ScriptNote/SceneProperties
                // （spike 实证包裹段内含剧注）：计数后丢弃。
                self.count_embedded_metadata(paragraph);
                self.losses.dual_dialogue += 1;
                for inner in dual.children() {
                    if inner.is_element() {
                        if inner.tag_name().name() == "Paragraph" {
                            self.emit_typed_paragraph(inner);
                        } else {
                            // DualDialogue 内白名单外子元素：计数告知。
                            self.count_unknown_element(inner.tag_name().name());
                        }
                    }
                }
            }
            None => self.emit_typed_paragraph(paragraph),
        }
    }

    /// 包裹段直接子级中的元数据计数（不进入 DualDialogue 子树——其内部段
    /// 由包裹逻辑另行处理）。
    fn count_embedded_metadata(&mut self, paragraph: Node) {
        for child in paragraph.children() {
            if !child.is_element() {
                continue;
            }
            match child.tag_name().name() {
                "ScriptNote" => self.losses.scriptnote += 1,
                "SceneProperties" => self.losses.scene_metadata += 1,
                _ => {}
            }
        }
    }

    /// TitlePage：文字逐段并入文档开头（保字；空段丢弃；段落 Alignment
    /// 映射到并入段 textAlign——实测片名/署名＝Center）；HeaderAndFooter
    /// 是页面家具，跳过。titlepage_inlined 按 TitlePage 元素计数一次。
    fn walk_title_page(&mut self, title_page: Node) {
        self.losses.titlepage += 1;
        for content in title_page.children() {
            if !content.is_element() || content.tag_name().name() != "Content" {
                continue;
            }
            for paragraph in content.children() {
                if !paragraph.is_element() || paragraph.tag_name().name() != "Paragraph" {
                    continue;
                }
                // 审计修正：TitlePage 段落的显式对齐保留（三态同正文规则；
                // 缺失不输出）。
                let text_align = paragraph
                    .attribute("Alignment")
                    .map(FdAlignment::parse)
                    .and_then(|alignment| alignment.text_align());
                for line in self.collect_lines(paragraph) {
                    let (content_nodes, text_total) = merge_inline_runs(line);
                    if text_total.trim().is_empty() {
                        continue; // 空行丢弃（design D3：空段丢弃）。
                    }
                    self.char_count += text_total.chars().count();
                    self.paragraph_count += 1;
                    let mut node = Map::new();
                    node.insert("type".to_string(), json!("paragraph"));
                    if let Some(align) = text_align {
                        node.insert("attrs".to_string(), json!({ "textAlign": align }));
                    }
                    node.insert("content".to_string(), Value::Array(content_nodes));
                    self.title_blocks.push(Value::Object(node));
                }
            }
        }
    }

    /// 有类型段落（或正文兜底段）：按 Type 固定档映射，收集 Text 行内样式。
    /// Text 内含换行（FD 强制换行／XML 缩进回声）按换行拆为同属性相邻段落。
    fn emit_typed_paragraph(&mut self, paragraph: Node) {
        let paragraph_type = paragraph.attribute("Type").unwrap_or("");
        let block_index = self.blocks.len();
        let lines = self.collect_lines(paragraph);
        // 无编号前缀的全文（标记识别用；各段拼接，与逐块文字一致）。
        let unprefixed: String = lines
            .iter()
            .flat_map(|line| line.iter().map(|run| run.text.as_str()))
            .collect();
        // Number 场景编号：仅 Scene Heading 读取（设置段与 Action 段有污染）。
        let number_prefix = if paragraph_type == "Scene Heading" {
            paragraph
                .attribute("Number")
                .filter(|number| !number.is_empty())
                .map(|number| format!("{number} "))
        } else {
            None
        };

        let mut emitted = 0usize;
        let mut first = true;
        let style = self.paragraph_style(paragraph_type);
        for (line_index, mut line) in lines.into_iter().enumerate() {
            // 行边空白＝XML 缩进回声与换行装饰，按格式规则剥除（与 md 软换行
            // 接合同类：非可见内容改写）。首行行首空白保留（边角样本实证：
            // indentation.fdx 的前导空格是作者缩进语义，非 XML 回声——回声
            // 形态总是伴随换行出现）；后续行的行首空白跟随换行符，剥除。
            if line_index > 0 {
                if let Some(lead) = line.first_mut() {
                    lead.text = lead.text.trim_start().to_string();
                }
            }
            if let Some(tail) = line.last_mut() {
                tail.text = tail.text.trim_end().to_string();
            }
            line.retain(|run| !run.text.is_empty());
            if line.is_empty() {
                continue; // 纯空白行丢弃。
            }
            // 整行仅空白的行（如孤立 " " 文本）＝间距回声，丢弃（与
            // TitlePage 的空行丢弃规则一致）；全部行都被丢弃时由末尾
            // 兜底保留一个空段。
            let line_text_probe: String = line.iter().map(|run| run.text.as_str()).collect();
            if line_text_probe.trim().is_empty() {
                continue;
            }
            // Number 前缀挂在首行行首（无标记前缀 run）。
            if first {
                if let Some(prefix) = &number_prefix {
                    line.insert(
                        0,
                        InlineRun {
                            text: prefix.clone(),
                            marks: Vec::new(),
                        },
                    );
                }
            }
            first = false;
            let (content, line_text) = merge_inline_runs(line);
            self.char_count += line_text.chars().count();
            self.paragraph_count += 1;
            self.push_block(&style, content);
            emitted += 1;
        }
        // 空段落／全空白段落：原样保留为空段（作者的间距表达）。
        if emitted == 0 {
            self.paragraph_count += 1;
            self.push_block(&style, Vec::new());
        }

        // 顶层标题参与序列标记识别（族键带层级前缀，保证「同层级」；
        // 用无编号前缀文本——前缀不参与序列模式识别；标记指向本段首块）。
        if let Some(level) = style.heading_level {
            if let Some(family) = parse_marker_family(&unprefixed) {
                self.markers.push((
                    block_index,
                    format!("{level}:{family}"),
                    unprefixed.trim().to_string(),
                ));
            }
        }
    }

    /// 块级发射：按段落样式构建节点并压入正文块序列。
    fn push_block(&mut self, style: &ParagraphStyle, content: Vec<Value>) {
        let mut node = Map::new();
        if let Some(level) = style.heading_level {
            node.insert("type".to_string(), json!("heading"));
            node.insert("attrs".to_string(), json!({ "level": level }));
        } else {
            node.insert("type".to_string(), json!("paragraph"));
            let mut attrs = Map::new();
            if let Some(align) = style.text_align {
                attrs.insert("textAlign".to_string(), json!(align));
            }
            if let Some(indent) = &style.indent_left {
                attrs.insert("indentLeft".to_string(), json!(indent));
            }
            if let Some(indent) = &style.indent_right {
                attrs.insert("indentRight".to_string(), json!(indent));
            }
            if let Some(indent) = &style.text_indent {
                attrs.insert("textIndent".to_string(), json!(indent));
            }
            if !attrs.is_empty() {
                node.insert("attrs".to_string(), Value::Object(attrs));
            }
        }
        if !content.is_empty() {
            node.insert("content".to_string(), Value::Array(content));
        }
        self.blocks.push(Value::Object(node));
    }

    /// 收集段落的 Text 子元素为「行序列」：Text 内的换行（XML 规范已把
    /// CR/CRLF 归一为 LF）拆行；ScriptNote/SceneProperties 计数后跳过；
    /// 未知子元素忽略。
    fn collect_lines(&mut self, paragraph: Node) -> Vec<Vec<InlineRun>> {
        let mut lines: Vec<Vec<InlineRun>> = vec![Vec::new()];
        for child in paragraph.children() {
            if !child.is_element() {
                continue;
            }
            match child.tag_name().name() {
                "Text" => {
                    // 行内修订标记：非零 RevisionID 忽略＋计数（文字无损）。
                    if let Some(revision_id) = child.attribute("RevisionID") {
                        if !revision_id.is_empty() && revision_id != "0" {
                            self.losses.revision_marks += 1;
                        }
                    }
                    let text = element_text(child);
                    if text.is_empty() {
                        continue;
                    }
                    let marks = text_marks(child);
                    for (index, part) in text.split('\n').enumerate() {
                        if index > 0 {
                            lines.push(Vec::new());
                        }
                        if !part.is_empty() {
                            lines.last_mut().expect("行序列非空").push(InlineRun {
                                text: part.to_string(),
                                marks: marks.clone(),
                            });
                        }
                    }
                }
                "ScriptNote" => {
                    // ScriptNote 嵌套在段落内部（spike 实证）：整树丢弃＋计数。
                    self.losses.scriptnote += 1;
                }
                "SceneProperties" => {
                    // 含 Summary/SceneArcBeats（Story Map 场景数据）：整树丢弃＋计数。
                    self.losses.scene_metadata += 1;
                }
                // DualDialogue 出现在有类型段（异常形态）按结构处理跳过；
                // 白名单外未知元素：计数告知（design D1）。
                "DualDialogue" => {}
                other => self.count_unknown_element(other),
            }
        }
        // 去掉末尾无内容的空行（Text 以换行结尾的回声）。
        if lines.last().is_some_and(Vec::is_empty) {
            lines.pop();
        }
        lines
    }

    /// 未知元素计数（design D1「未知元素忽略＋计数」）：白名单外且非机器
    /// 家具的元素计入 `unknown_element_skipped`，去重名称进 note。
    fn count_unknown_element(&mut self, name: &str) {
        self.losses.unknown_elements += 1;
        if !self
            .losses
            .unknown_element_names
            .iter()
            .any(|existing| existing == name)
        {
            self.losses.unknown_element_names.push(name.to_string());
        }
    }

    fn finish(mut self, generator: Option<String>) -> ParsedDocument {
        // TitlePage 块前置，脚本块标记的块索引随之前移。
        let title_count = self.title_blocks.len();
        let mut blocks = std::mem::take(&mut self.title_blocks);
        blocks.append(&mut self.blocks);
        let markers = std::mem::take(&mut self.markers)
            .into_iter()
            .map(|(index, family, text)| (index + title_count, family, text))
            .collect();
        ParsedDocument {
            blocks,
            markers,
            losses: self.losses,
            char_count: self.char_count,
            paragraph_count: self.paragraph_count,
            generator,
        }
    }
}

// ========== Type → 段落样式（design D3 表＋ElementSettings 权威布局） ==========

/// 一个段落类型解析后的块级样式。
struct ParagraphStyle {
    /// Some(level)＝标题（结构语义；标题不消费布局属性）。
    heading_level: Option<u8>,
    /// textAlign（Right/Center/Full 输出；显式或缺失的 Left 不输出）。
    text_align: Option<&'static str>,
    indent_left: Option<String>,
    indent_right: Option<String>,
    /// 首行缩进（负值＝悬挂；编辑器 textIndent 段落属性承载）。
    text_indent: Option<String>,
}

impl ParagraphStyle {
    fn plain() -> Self {
        Self {
            heading_level: None,
            text_align: None,
            indent_left: None,
            indent_right: None,
            text_indent: None,
        }
    }

    fn heading(level: u8) -> Self {
        Self {
            heading_level: Some(level),
            ..Self::plain()
        }
    }
}

/// 标题层级：Scene Heading/Shot→2、New Act→1、Outline N→clamp 1–6；
/// 非标题类型返回 None（Outline 解析失败按未知类型兜底为普通段落）。
fn heading_level_for(paragraph_type: &str) -> Option<u8> {
    match paragraph_type {
        "Scene Heading" | "Shot" => Some(2),
        "New Act" => Some(1),
        other => other
            .strip_prefix("Outline ")
            .and_then(|rest| rest.trim().parse::<u8>().ok())
            .map(|level| level.clamp(1, 6)),
    }
}

/// 固定档回退：Dialogue 浅、Parenthetical 中、Character 深（1:1.5:2），
/// 其余类型无缩进属性。
fn fallback_indent_left(paragraph_type: &str) -> Option<&'static str> {
    match paragraph_type {
        "Dialogue" => Some(FALLBACK_INDENT_DIALOGUE),
        "Parenthetical" => Some(FALLBACK_INDENT_PARENTHETICAL),
        "Character" => Some(FALLBACK_INDENT_CHARACTER),
        _ => None,
    }
}

impl FdxConverter {
    /// Type → 段落样式：标题只带层级；Transition 只带对齐（三态：显式
    /// Left/Center/Full/Right 照搬、缺失回退右对齐——审计修正：显式 Left
    /// 不再错误回退右对齐；页面几何缩进不搬运）；其余类型按 ElementSettings
    /// 权威布局换算（对齐＋相对缩进＋首行缩进），缺块/缺属性/缺基准按字段
    /// 回退固定档。
    fn paragraph_style(&self, paragraph_type: &str) -> ParagraphStyle {
        if let Some(level) = heading_level_for(paragraph_type) {
            return ParagraphStyle::heading(level);
        }
        let mut style = ParagraphStyle::plain();
        let layout = self.layouts.get(paragraph_type);

        if paragraph_type == "Transition" {
            style.text_align = match layout.map(|item| item.alignment) {
                Some(FdAlignment::Missing) | None => Some("right"), // 缺省回退。
                Some(alignment) => alignment.text_align(),          // 显式 Left → None。
            };
            return style;
        }

        if let Some(layout) = layout {
            style.text_align = layout.alignment.text_align();
            // 相对缩进：左＝类型 LeftIndent−基准；右＝正文 RightIndent−类型
            // RightIndent（右侧收窄为正）。缺基准/缺属性按字段回退固定档。
            style.indent_left = match (self.base_left, layout.left_indent) {
                (Some(base), Some(value)) => indent_attr_from_inches(value - base),
                _ => fallback_indent_left(paragraph_type).map(str::to_string),
            };
            style.indent_right = match (self.base_right, layout.right_indent) {
                (Some(base), Some(value)) => indent_attr_from_inches(base - value),
                _ => None,
            };
            // 首行缩进：英寸×72→pt，负值＝悬挂（grammar 允许任意非空度量串）。
            style.text_indent = layout.first_indent.and_then(indent_attr_from_inches);
            return style;
        }

        // 缺整个设置块：回退固定档（对白三类有档，其余无属性）。
        style.indent_left = fallback_indent_left(paragraph_type).map(str::to_string);
        style
    }
}

/// Text 元素 → canonical marks（按 rank 固定顺序输出）。
///
/// - `Text@Style`（`+` 分隔词组，spike 实证）：Bold/Italic/Underline→对应
///   marks；AllCaps 与未知词是显示属性，忽略不计损耗（文字字符不变）。
/// - `Text@Font/Size/Color`（审计补充）→ textStyle：fontFamily（字体名直读）、
///   fontSize（FD 点值直读，docx 侧 fontSize 同为 pt 字符串）、color（FD 颜色
///   是 12 位十六进制 48bit 形态如 `#000000000000`，截取前 6 位 RGB）。
///   只搬 Text 上的显式值；ElementSettings 的 FontSpec 类型级默认是回声，
///   由类型布局路径处理，不进 run 级。
fn text_marks(text_node: Node) -> Vec<Value> {
    let mut marks = Vec::new();
    let mut bold = false;
    let mut italic = false;
    let mut underline = false;
    if let Some(style) = text_node.attribute("Style") {
        for word in style.split('+') {
            match word.trim() {
                "Bold" => bold = true,
                "Italic" => italic = true,
                "Underline" => underline = true,
                // AllCaps／未知词＝显示属性：忽略。
                _ => {}
            }
        }
    }
    if bold {
        marks.push(json!({ "type": "bold" }));
    }
    if italic {
        marks.push(json!({ "type": "italic" }));
    }
    if underline {
        marks.push(json!({ "type": "underline" }));
    }

    let mut text_style = Map::new();
    if let Some(font) = text_node.attribute("Font").filter(|f| !f.is_empty()) {
        text_style.insert("fontFamily".to_string(), json!(font));
    }
    if let Some(size) = text_node
        .attribute("Size")
        .and_then(|value| value.trim().parse::<f64>().ok())
    {
        // FD Size 已是点值（12＝12pt），与 docx 侧 fontSize 的 pt 字符串同形。
        text_style.insert(
            "fontSize".to_string(),
            json!(format!("{}pt", format_decimal(size))),
        );
    }
    if let Some(color) = text_node.attribute("Color").and_then(fd_color_to_hex) {
        text_style.insert("color".to_string(), json!(color));
    }
    if !text_style.is_empty() {
        marks.push(json!({ "type": "textStyle", "attrs": Value::Object(text_style) }));
    }
    marks
}

/// FD 颜色（12 位十六进制 48bit，如 `#000000000000`；也可能已是 6 位形态）
/// → 编辑器 `#rrggbb`（小写）。非法值返回 None（不产生标记）。
fn fd_color_to_hex(raw: &str) -> Option<String> {
    let digits = raw.trim().strip_prefix('#').unwrap_or(raw.trim());
    if digits.len() == 12 {
        // 48bit：前 6 位即 RGB。
        let rgb = &digits[..6];
        if rgb.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(format!("#{}", rgb.to_ascii_lowercase()));
        }
        return None;
    }
    if digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Some(format!("#{}", digits.to_ascii_lowercase()));
    }
    None
}

/// 元素的全部文本子节点拼接（Text 是叶子元素，防御多文本节点）。
fn element_text(node: Node) -> String {
    let mut out = String::new();
    for child in node.children() {
        if child.is_text() {
            out.push_str(child.text().unwrap_or(""));
        }
    }
    out
}

// ========== 测试（任务 5.1 映射规则单测） ==========

#[cfg(test)]
mod tests {
    use super::super::document_import::detect_split_from_markers;
    use super::*;

    fn parse(input: &str) -> ParsedDocument {
        parse_fdx(input.as_bytes()).expect("parse fdx")
    }

    fn wrap_body(body: &str) -> String {
        format!(
            r#"<FinalDraft DocumentType="Script" Template="No" Version="3"><Content>{body}</Content></FinalDraft>"#
        )
    }

    fn parse_body(body: &str) -> ParsedDocument {
        parse(&wrap_body(body))
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

    fn loss(parsed: &ParsedDocument, field: usize) -> usize {
        let counter: [usize; 19] = [
            parsed.losses.tables,
            parsed.losses.images,
            parsed.losses.footnotes,
            parsed.losses.comments,
            parsed.losses.revisions,
            parsed.losses.numbering_degraded,
            parsed.losses.code_inline,
            parsed.losses.code_blocks,
            parsed.losses.quotes,
            parsed.losses.hr,
            parsed.losses.html_stripped,
            parsed.losses.frontmatter,
            parsed.losses.tasklists,
            parsed.losses.block_skipped,
            parsed.losses.dual_dialogue,
            parsed.losses.titlepage,
            parsed.losses.scene_metadata,
            parsed.losses.scriptnote,
            parsed.losses.revision_marks,
        ];
        counter[field]
    }

    const L_DUAL: usize = 14;
    const L_TITLEPAGE: usize = 15;
    const L_SCENE_META: usize = 16;
    const L_SCRIPTNOTE: usize = 17;
    const L_REVISION: usize = 18;

    // ----- Type 全集映射 -----

    #[test]
    fn paragraph_type_full_mapping() {
        let parsed = parse_body(concat!(
            r#"<Paragraph Type="New Act"><Text>第一幕</Text></Paragraph>"#,
            r#"<Paragraph Type="Scene Heading"><Text>外景 书店门口—日</Text></Paragraph>"#,
            r#"<Paragraph Type="Outline 3"><Text>大纲层</Text></Paragraph>"#,
            r#"<Paragraph Type="Shot"><Text>镜头一</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text>动作描述</Text></Paragraph>"#,
            r#"<Paragraph Type="General"><Text>通用段</Text></Paragraph>"#,
            r#"<Paragraph Type="Cast List"><Text>演员表</Text></Paragraph>"#,
            r#"<Paragraph Type="Lyrics"><Text>歌词</Text></Paragraph>"#,
            r#"<Paragraph Type="More"><Text>（续）</Text></Paragraph>"#,
            r#"<Paragraph Type="Teleplay"><Text>未知类型兜底</Text></Paragraph>"#,
            r#"<Paragraph Type="Character"><Text>玛丽</Text></Paragraph>"#,
            r#"<Paragraph Type="Dialogue"><Text>你好。</Text></Paragraph>"#,
            r#"<Paragraph Type="Parenthetical"><Text>（低声）</Text></Paragraph>"#,
            r#"<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>"#,
        ));
        let blocks = &parsed.blocks;
        assert_eq!(blocks.len(), 14);

        let assert_heading = |block: &Value, level: u8, text: &str| {
            assert_eq!(block["type"], "heading");
            assert_eq!(block["attrs"]["level"], level);
            assert_eq!(block_text(block), text);
        };
        assert_heading(&blocks[0], 1, "第一幕");
        assert_heading(&blocks[1], 2, "外景 书店门口—日");
        assert_heading(&blocks[2], 3, "大纲层");
        assert_heading(&blocks[3], 2, "镜头一");

        for index in [4, 5, 6, 7, 8, 9] {
            assert_eq!(blocks[index]["type"], "paragraph", "index={index}");
            assert!(
                blocks[index].get("attrs").is_none(),
                "普通段无属性：{index}"
            );
        }

        assert_eq!(
            blocks[10]["attrs"]["indentLeft"], "4em",
            "Character 回退深档"
        );
        assert_eq!(
            blocks[11]["attrs"]["indentLeft"], "2em",
            "Dialogue 回退浅档"
        );
        assert_eq!(
            blocks[12]["attrs"]["indentLeft"], "3em",
            "Parenthetical 回退中档"
        );
        assert_eq!(
            blocks[13]["attrs"]["textAlign"], "right",
            "Transition 右对齐"
        );
    }

    #[test]
    fn outline_level_clamped_and_invalid_falls_back() {
        let parsed = parse_body(concat!(
            r#"<Paragraph Type="Outline 9"><Text>超限层级</Text></Paragraph>"#,
            r#"<Paragraph Type="Outline 0"><Text>零层</Text></Paragraph>"#,
            r#"<Paragraph Type="Outline ABC"><Text>非法大纲</Text></Paragraph>"#,
        ));
        assert_eq!(parsed.blocks[0]["type"], "heading");
        assert_eq!(parsed.blocks[0]["attrs"]["level"], 6, "clamp 到 6");
        assert_eq!(parsed.blocks[1]["attrs"]["level"], 1, "clamp 到 1");
        assert_eq!(
            parsed.blocks[2]["type"], "paragraph",
            "非法 Outline 兜底段落"
        );
    }

    // ----- ElementSettings 权威布局（用户验收修正） -----

    /// 带 ElementSettings 的文档骨架（布局值取自真实 fixture 的形态）。
    fn parse_with_settings(settings: &str, body: &str) -> ParsedDocument {
        parse(&format!(
            r#"<FinalDraft DocumentType="Script" Version="3">{settings}<Content>{body}</Content></FinalDraft>"#
        ))
    }

    #[test]
    fn element_settings_drive_alignment_and_relative_indents() {
        // 布局值＝真实 fixture：基准 Action L1.50 R7.50；Dialogue L2.50 R6.00；
        // Parenthetical L3.00 R5.50；Character L3.50 R7.25；Transition Right。
        let settings = concat!(
            r#"<ElementSettings Type="Action"><ParagraphSpec Alignment="Left" LeftIndent="1.50" RightIndent="7.50"/></ElementSettings>"#,
            r#"<ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Left" LeftIndent="2.50" RightIndent="6.00"/></ElementSettings>"#,
            r#"<ElementSettings Type="Parenthetical"><ParagraphSpec Alignment="Left" FirstIndent="-0.10" LeftIndent="3.00" RightIndent="5.50"/></ElementSettings>"#,
            r#"<ElementSettings Type="Character"><ParagraphSpec Alignment="Left" LeftIndent="3.50" RightIndent="7.25"/></ElementSettings>"#,
            r#"<ElementSettings Type="Transition"><ParagraphSpec Alignment="Right" LeftIndent="5.50" RightIndent="7.10"/></ElementSettings>"#,
        );
        let body = concat!(
            r#"<Paragraph Type="Action"><Text>正文基准。</Text></Paragraph>"#,
            r#"<Paragraph Type="Dialogue"><Text>对白。</Text></Paragraph>"#,
            r#"<Paragraph Type="Parenthetical"><Text>（括注）</Text></Paragraph>"#,
            r#"<Paragraph Type="Character"><Text>人物</Text></Paragraph>"#,
            r#"<Paragraph Type="Transition"><Text>FADE OUT.</Text></Paragraph>"#,
        );
        let parsed = parse_with_settings(settings, body);

        // 正文基准：相对缩进 0 → 无属性。
        assert!(parsed.blocks[0].get("attrs").is_none(), "Action 无属性");
        // Dialogue +1.00" → 72pt；右收窄 7.50−6.00=+1.50" → 108pt。
        assert_eq!(parsed.blocks[1]["attrs"]["indentLeft"], "72pt");
        assert_eq!(parsed.blocks[1]["attrs"]["indentRight"], "108pt");
        // Parenthetical +1.50" → 108pt；右收窄 +2.00" → 144pt（FirstIndent 忽略）。
        assert_eq!(parsed.blocks[2]["attrs"]["indentLeft"], "108pt");
        assert_eq!(parsed.blocks[2]["attrs"]["indentRight"], "144pt");
        // Character +2.00" → 144pt；右收窄 +0.25" → 18pt。
        assert_eq!(parsed.blocks[3]["attrs"]["indentLeft"], "144pt");
        assert_eq!(parsed.blocks[3]["attrs"]["indentRight"], "18pt");
        // 相对顺序：Dialogue < Parenthetical < Character（真实 FD 布局）。
        // Transition：对齐来自设置块；页面几何缩进不搬运。
        assert_eq!(parsed.blocks[4]["attrs"]["textAlign"], "right");
        assert!(parsed.blocks[4]["attrs"].get("indentLeft").is_none());
        assert!(parsed.blocks[4]["attrs"].get("indentRight").is_none());
    }

    #[test]
    fn element_settings_center_alignment_mapped() {
        let settings = r#"<ElementSettings Type="Action"><ParagraphSpec Alignment="Left" LeftIndent="1.50" RightIndent="7.50"/></ElementSettings><ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Center" LeftIndent="2.50" RightIndent="6.00"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            settings,
            r#"<Paragraph Type="Dialogue"><Text>居中对白。</Text></Paragraph>"#,
        );
        assert_eq!(parsed.blocks[0]["attrs"]["textAlign"], "center");
        assert_eq!(parsed.blocks[0]["attrs"]["indentLeft"], "72pt");
    }

    #[test]
    fn non_default_base_from_general_or_action() {
        // 基准不硬编码：基准 2.00（General，无 Action 块）时 Dialogue L3.00
        // 仍是 +1.00" → 72pt；Action 优先于 General（取 Action 的 2.50）。
        let general_base = r#"<ElementSettings Type="General"><ParagraphSpec Alignment="Left" LeftIndent="2.00" RightIndent="7.00"/></ElementSettings><ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Left" LeftIndent="3.00" RightIndent="6.00"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            general_base,
            r#"<Paragraph Type="Dialogue"><Text>对白。</Text></Paragraph>"#,
        );
        assert_eq!(parsed.blocks[0]["attrs"]["indentLeft"], "72pt");
        assert_eq!(parsed.blocks[0]["attrs"]["indentRight"], "72pt");

        let action_wins = r#"<ElementSettings Type="General"><ParagraphSpec Alignment="Left" LeftIndent="2.00" RightIndent="7.00"/></ElementSettings><ElementSettings Type="Action"><ParagraphSpec Alignment="Left" LeftIndent="2.50" RightIndent="7.50"/></ElementSettings><ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Left" LeftIndent="3.50" RightIndent="6.50"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            action_wins,
            r#"<Paragraph Type="Dialogue"><Text>对白。</Text></Paragraph>"#,
        );
        // 基准取 Action 2.50：+1.00" → 72pt；右收窄 7.50−6.50 → 72pt。
        assert_eq!(parsed.blocks[0]["attrs"]["indentLeft"], "72pt");
        assert_eq!(parsed.blocks[0]["attrs"]["indentRight"], "72pt");
    }

    #[test]
    fn missing_settings_or_fields_fall_back_to_tiers() {
        // 完全没有 ElementSettings：三类回退固定档（Dialogue 2em／
        // Parenthetical 3em／Character 4em），Transition 回退右对齐。
        let parsed = parse_body(concat!(
            r#"<Paragraph Type="Dialogue"><Text>甲</Text></Paragraph>"#,
            r#"<Paragraph Type="Parenthetical"><Text>乙</Text></Paragraph>"#,
            r#"<Paragraph Type="Character"><Text>丙</Text></Paragraph>"#,
            r#"<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>"#,
        ));
        assert_eq!(parsed.blocks[0]["attrs"]["indentLeft"], "2em");
        assert_eq!(parsed.blocks[1]["attrs"]["indentLeft"], "3em");
        assert_eq!(parsed.blocks[2]["attrs"]["indentLeft"], "4em");
        assert_eq!(parsed.blocks[3]["attrs"]["textAlign"], "right");

        // 有 Dialogue 设置块但缺基准（无 Action/General 块）：按字段回退档。
        let no_base = r#"<ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Left" LeftIndent="2.50" RightIndent="6.00"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            no_base,
            r#"<Paragraph Type="Dialogue"><Text>甲</Text></Paragraph><Paragraph Type="Character"><Text>丙</Text></Paragraph>"#,
        );
        assert_eq!(
            parsed.blocks[0]["attrs"]["indentLeft"], "2em",
            "缺基准回退档"
        );
        assert!(parsed.blocks[0]["attrs"].get("indentRight").is_none());
        assert_eq!(parsed.blocks[1]["attrs"]["indentLeft"], "4em", "缺块回退档");

        // 设置块缺 LeftIndent 属性（RightIndent 在）：左回退档、右按设置换算
        // ——但右换算同样需要基准，一并缺 → 两端都回退。
        let partial = r#"<ElementSettings Type="General"><ParagraphSpec Alignment="Left" LeftIndent="1.50" RightIndent="7.50"/></ElementSettings><ElementSettings Type="Character"><ParagraphSpec Alignment="Left" RightIndent="7.00"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            partial,
            r#"<Paragraph Type="Character"><Text>丙</Text></Paragraph>"#,
        );
        assert_eq!(
            parsed.blocks[0]["attrs"]["indentLeft"], "4em",
            "缺属性回退档"
        );
        assert_eq!(
            parsed.blocks[0]["attrs"]["indentRight"], "36pt",
            "右按设置换算"
        );

        // 非法数值属性＝缺失：回退档。
        let invalid = r#"<ElementSettings Type="Action"><ParagraphSpec Alignment="Left" LeftIndent="1.50" RightIndent="7.50"/></ElementSettings><ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Left" LeftIndent="abc" RightIndent="6.00"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            invalid,
            r#"<Paragraph Type="Dialogue"><Text>甲</Text></Paragraph>"#,
        );
        assert_eq!(
            parsed.blocks[0]["attrs"]["indentLeft"], "2em",
            "非法值回退档"
        );
    }

    // ----- 场景编号并入 -----

    #[test]
    fn scene_number_merged_into_heading_prefix() {
        let parsed = parse_body(concat!(
            r#"<Paragraph Number="12" Type="Scene Heading"><Text>外景 书店门口—日</Text></Paragraph>"#,
            r#"<Paragraph Number="999" Type="Action"><Text>动作段的编号不读取。</Text></Paragraph>"#,
            r#"<Paragraph Type="Scene Heading"><Text>内景 房间—夜</Text></Paragraph>"#,
        ));
        assert_eq!(block_text(&parsed.blocks[0]), "12 外景 书店门口—日");
        assert_eq!(block_text(&parsed.blocks[1]), "动作段的编号不读取。");
        assert_eq!(block_text(&parsed.blocks[2]), "内景 房间—夜");
        // 编号前缀计入字数。
        assert_eq!(
            parsed.char_count,
            "12 外景 书店门口—日动作段的编号不读取。内景 房间—夜"
                .chars()
                .count()
        );
    }

    // ----- DualDialogue 拆分 -----

    #[test]
    fn dual_dialogue_splits_in_order_with_notes_counted() {
        let parsed = parse_body(
            r#"<Paragraph><ScriptNote Name="note"><Paragraph><Text>包裹段剧注</Text></Paragraph></ScriptNote><DualDialogue><Paragraph Type="Character"><Text>玛丽</Text></Paragraph><Paragraph Type="Parenthetical"><Text>（急）</Text></Paragraph><Paragraph Type="Dialogue"><Text>快走！</Text></Paragraph><Paragraph Type="Character"><Text>路易</Text></Paragraph><Paragraph Type="Dialogue"><Text>我说走！</Text></Paragraph></DualDialogue></Paragraph>"#,
        );
        assert_eq!(loss(&parsed, L_DUAL), 1);
        assert_eq!(loss(&parsed, L_SCRIPTNOTE), 1, "包裹段内剧注计数丢弃");
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(
            texts,
            vec!["玛丽", "（急）", "快走！", "路易", "我说走！"],
            "拆为先后两组、括注随组、顺序保留"
        );
        // 内部段落缩进档随类型生效（无 ElementSettings → 回退固定档）。
        assert_eq!(
            parsed.blocks[0]["attrs"]["indentLeft"], "4em",
            "Character 深档"
        );
        assert_eq!(
            parsed.blocks[1]["attrs"]["indentLeft"], "3em",
            "Parenthetical 中档"
        );
    }

    // ----- TitlePage 并入与反例 -----

    #[test]
    fn titlepage_inlined_at_start_with_empty_dropped() {
        let source = r#"<FinalDraft DocumentType="Script" Version="1"><TitlePage><HeaderAndFooter><Header><Paragraph><Text>.</Text></Paragraph></Header></HeaderAndFooter><Content><Paragraph><Text></Text></Paragraph><Paragraph><Text>FARMLAND</Text></Paragraph><Paragraph><Text>作者</Text></Paragraph></Content></TitlePage><Content><Paragraph Type="Scene Heading"><Text>外景 田野—日</Text></Paragraph></Content></FinalDraft>"#;
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_TITLEPAGE), 1);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        // 空段丢弃；HeaderAndFooter（页面家具）不并入；标题页文字在正文开头。
        assert_eq!(texts, vec!["FARMLAND", "作者", "外景 田野—日"]);
    }

    #[test]
    fn no_titlepage_means_no_loss_and_no_prefix() {
        let parsed = parse_body(r#"<Paragraph Type="Action"><Text>正文</Text></Paragraph>"#);
        assert_eq!(loss(&parsed, L_TITLEPAGE), 0);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["正文"]);
    }

    // ----- 修订忽略（文字无损） -----

    #[test]
    fn revision_marks_ignored_with_text_intact() {
        let source = r#"<FinalDraft DocumentType="Script" Version="3"><Content><Paragraph Type="Action"><Text RevisionID="2" Style="Bold">带修订标记的文字</Text></Paragraph></Content><Revisions ActiveSet="1"><Revision ID="1" Name="Blue"/><Revision ID="2" Name="Pink"/></Revisions></FinalDraft>"#;
        let parsed = parse(source);
        assert_eq!(
            loss(&parsed, L_REVISION),
            3,
            "两套修订定义＋一处行内非零 RevisionID"
        );
        assert_eq!(
            block_text(&parsed.blocks[0]),
            "带修订标记的文字",
            "文字无损"
        );
        // RevisionID=0（无修订）不计。
        let parsed = parse_body(
            r#"<Paragraph Type="Action"><Text RevisionID="0">零修订</Text></Paragraph>"#,
        );
        assert_eq!(loss(&parsed, L_REVISION), 0);
    }

    // ----- 场景元数据与剧注 -----

    #[test]
    fn scene_metadata_and_scriptnote_dropped_and_counted() {
        let parsed = parse_body(concat!(
            r##"<Paragraph Number="1" Type="Scene Heading">"##,
            r##"<SceneProperties Color="#00000000FFFF"><Summary><Paragraph><Text>场景摘要不导入</Text></Paragraph></Summary><SceneArcBeats/></SceneProperties>"##,
            r#"<ScriptNote Name="geography"><Paragraph><Text>剧注内容不导入</Text></Paragraph></ScriptNote>"#,
            r#"<Text>外景 农场—日</Text></Paragraph>"#,
        ));
        assert_eq!(loss(&parsed, L_SCENE_META), 1);
        assert_eq!(loss(&parsed, L_SCRIPTNOTE), 1);
        assert_eq!(block_text(&parsed.blocks[0]), "1 外景 农场—日");
        assert_eq!(
            parsed.char_count,
            "1 外景 农场—日".chars().count(),
            "丢弃内容不入字数"
        );
    }

    // ----- Style 词组 -----

    #[test]
    fn style_words_map_to_marks() {
        let parsed = parse_body(concat!(
            r#"<Paragraph Type="Action"><Text Style="Bold">粗体</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text Style="Italic">斜体</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text Style="Underline">下划线</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text Style="Bold+Italic">粗斜</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text Style="Underline+AllCaps">下划全大写</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text Style="AllCaps">全大写忽略</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text Style="">无样式</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text>缺属性</Text></Paragraph>"#,
        ));
        let mark_types = |index: usize| -> Vec<String> {
            parsed.blocks[index]["content"].as_array().unwrap()[0]
                .get("marks")
                .and_then(Value::as_array)
                .map(|marks| {
                    marks
                        .iter()
                        .map(|m| m["type"].as_str().unwrap_or("").to_string())
                        .collect()
                })
                .unwrap_or_default()
        };
        assert_eq!(mark_types(0), vec!["bold"]);
        assert_eq!(mark_types(1), vec!["italic"]);
        assert_eq!(mark_types(2), vec!["underline"]);
        // 词序无关，输出按 canonical rank 排序。
        assert_eq!(mark_types(3), vec!["bold", "italic"]);
        assert_eq!(mark_types(4), vec!["underline"], "AllCaps 忽略");
        assert_eq!(mark_types(5).len(), 0, "纯 AllCaps 无标记");
        assert_eq!(mark_types(6).len(), 0);
        assert_eq!(mark_types(7).len(), 0);
    }

    // ----- 未知元素容忍 -----

    #[test]
    fn unknown_elements_tolerated() {
        let parsed = parse_body(
            r#"<Paragraph Type="Action"><SomeFutureElement Meta="x"/><Text>文字</Text><AnotherUnknown/></Paragraph>"#,
        );
        assert_eq!(block_text(&parsed.blocks[0]), "文字");
        // 审计修正：白名单外未知元素计数告知（非静默）。
        assert_eq!(parsed.losses.unknown_elements, 2, "段内两个未知元素");
        assert_eq!(
            parsed.losses.unknown_element_names,
            vec![
                "SomeFutureElement".to_string(),
                "AnotherUnknown".to_string()
            ]
        );
    }

    #[test]
    fn unknown_root_part_counted_but_furniture_silent() {
        // 白名单外根级部件计数；机器家具白名单静默。
        let source = r#"<FinalDraft DocumentType="Script" Version="3"><Content><Paragraph Type="Action"><Text>正文</Text></Paragraph></Content><SmartType><Characters/></SmartType><FutureModule><Data/></FutureModule></FinalDraft>"#;
        let parsed = parse(source);
        assert_eq!(parsed.losses.unknown_elements, 1, "仅 FutureModule 计数");
        assert_eq!(
            parsed.losses.unknown_element_names,
            vec!["FutureModule".to_string()]
        );
    }

    // ----- 对齐三态（审计 A1） -----

    #[test]
    fn transition_explicit_left_does_not_fall_back_to_right() {
        // 显式 Alignment="Left" 的 Transition：不输出 textAlign，也不回退右对齐。
        let settings = r#"<ElementSettings Type="Transition"><ParagraphSpec Alignment="Left" LeftIndent="5.50" RightIndent="7.10"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            settings,
            r#"<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>"#,
        );
        assert!(
            parsed.blocks[0].get("attrs").is_none(),
            "显式 Left 不输出也不回退：{:#?}",
            parsed.blocks[0]
        );
    }

    #[test]
    fn transition_missing_alignment_falls_back_to_right() {
        // 属性缺失（设置块在但无 Alignment）：回退右对齐。
        let settings = r#"<ElementSettings Type="Transition"><ParagraphSpec LeftIndent="5.50" RightIndent="7.10"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            settings,
            r#"<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>"#,
        );
        assert_eq!(parsed.blocks[0]["attrs"]["textAlign"], "right");
    }

    #[test]
    fn full_alignment_maps_to_justify() {
        // Full＝两端对齐；编辑器 textAlign 合法值含 justify。
        let settings = r#"<ElementSettings Type="Action"><ParagraphSpec Alignment="Left" LeftIndent="1.50" RightIndent="7.50"/></ElementSettings><ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Full" LeftIndent="2.50" RightIndent="6.00"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            settings,
            r#"<Paragraph Type="Dialogue"><Text>两端对齐对白。</Text></Paragraph>"#,
        );
        assert_eq!(parsed.blocks[0]["attrs"]["textAlign"], "justify");
    }

    #[test]
    fn unknown_alignment_value_treated_as_explicit_left() {
        // 未知对齐取值（未来版本）：按显式 Left 处理——不输出、不回退。
        let settings = r#"<ElementSettings Type="Transition"><ParagraphSpec Alignment="Diagonal" LeftIndent="5.50" RightIndent="7.10"/></ElementSettings>"#;
        let parsed = parse_with_settings(
            settings,
            r#"<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>"#,
        );
        assert!(parsed.blocks[0].get("attrs").is_none());
    }

    // ----- Text 显式格式属性 → textStyle（审计 A4） -----

    #[test]
    fn text_format_attributes_map_to_text_style() {
        let parsed = parse_body(concat!(
            r##"<Paragraph Type="Action"><Text Font="Courier Final Draft" Size="12" Color="#000000000000">全套格式</Text></Paragraph>"##,
            r##"<Paragraph Type="Action"><Text Font="黑体" Size="14.5" Color="#FFFF00008080">半套</Text></Paragraph>"##,
            r##"<Paragraph Type="Action"><Text Color="#FF0000">六位色</Text></Paragraph>"##,
            r#"<Paragraph Type="Action"><Text Color="not-a-color">非法色</Text></Paragraph>"#,
            r#"<Paragraph Type="Action"><Text Font="" Size="abc">空与非法</Text></Paragraph>"#,
            r##"<Paragraph Type="Action"><Text Style="Bold" Font="宋体" Size="12" Color="#000000000000">粗体加全套</Text></Paragraph>"##,
        ));
        let marks_of = |index: usize| parsed.blocks[index]["content"][0].get("marks").cloned();
        // 全套：textStyle{fontFamily, fontSize, color}，12 位色截前 6 位。
        let marks = marks_of(0).expect("全套有 marks");
        assert_eq!(marks[0]["type"], "textStyle");
        assert_eq!(marks[0]["attrs"]["fontFamily"], "Courier Final Draft");
        assert_eq!(marks[0]["attrs"]["fontSize"], "12pt");
        assert_eq!(marks[0]["attrs"]["color"], "#000000");
        // 12 位形态第二种（前 6 位 FF FF 00 → #ffff00）；14.5pt 小数。
        let marks = marks_of(1).expect("半套有 marks");
        assert_eq!(marks[0]["attrs"]["color"], "#ffff00");
        assert_eq!(marks[0]["attrs"]["fontSize"], "14.5pt");
        assert_eq!(marks[0]["attrs"]["fontFamily"], "黑体");
        // 6 位形态直接用。
        let marks = marks_of(2).expect("六位色有 marks");
        assert_eq!(marks[0]["attrs"]["color"], "#ff0000");
        // 非法色/空字体/非法字号：跳过该属性，不留空 textStyle。
        assert!(marks_of(3).is_none(), "非法色不产生标记");
        assert!(marks_of(4).is_none(), "空字体与非法字号不产生标记");
        // Style 词组与 textStyle 共存，rank 顺序 bold→textStyle。
        let marks = marks_of(5).expect("组合有 marks");
        assert_eq!(marks[0]["type"], "bold");
        assert_eq!(marks[1]["type"], "textStyle");
        assert_eq!(marks[1]["attrs"]["fontFamily"], "宋体");
    }

    // ----- FirstIndent → textIndent（审计 A5） -----

    #[test]
    fn first_indent_maps_to_text_indent_with_negative_hanging() {
        let settings = concat!(
            r#"<ElementSettings Type="Action"><ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="1.50" RightIndent="7.50"/></ElementSettings>"#,
            r#"<ElementSettings Type="Parenthetical"><ParagraphSpec Alignment="Left" FirstIndent="-0.10" LeftIndent="3.00" RightIndent="5.50"/></ElementSettings>"#,
            r#"<ElementSettings Type="Dialogue"><ParagraphSpec Alignment="Left" FirstIndent="0.25" LeftIndent="2.50" RightIndent="6.00"/></ElementSettings>"#,
        );
        let parsed = parse_with_settings(
            settings,
            concat!(
                r#"<Paragraph Type="Action"><Text>正文。</Text></Paragraph>"#,
                r#"<Paragraph Type="Parenthetical"><Text>（悬挂括注）</Text></Paragraph>"#,
                r#"<Paragraph Type="Dialogue"><Text>首行缩进对白。</Text></Paragraph>"#,
            ),
        );
        // Action FirstIndent=0 → 不输出。
        assert!(parsed.blocks[0].get("attrs").is_none(), "正文无属性");
        // Parenthetical −0.10"×72＝−7.2pt（悬挂，负值允许）。
        assert_eq!(parsed.blocks[1]["attrs"]["textIndent"], "-7.2pt");
        // Dialogue +0.25"×72＝18pt（正值首行缩进）。
        assert_eq!(parsed.blocks[2]["attrs"]["textIndent"], "18pt");
    }

    // ----- TitlePage 段落对齐保留（审计 A3） -----

    #[test]
    fn title_page_paragraph_alignment_preserved() {
        let source = r#"<FinalDraft DocumentType="Script" Version="1"><TitlePage><Content><Paragraph Alignment="Center"><Text>片名居中</Text></Paragraph><Paragraph Alignment="Left"><Text>左对齐署名</Text></Paragraph><Paragraph><Text>缺省对齐</Text></Paragraph></Content></TitlePage><Content><Paragraph Type="Scene Heading"><Text>外景 田野—日</Text></Paragraph></Content></FinalDraft>"#;
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_TITLEPAGE), 1);
        // Center 保留；显式 Left 与缺失都不输出（三态规则）。
        assert_eq!(parsed.blocks[0]["attrs"]["textAlign"], "center");
        assert!(parsed.blocks[1].get("attrs").is_none());
        assert!(parsed.blocks[2].get("attrs").is_none());
        assert_eq!(block_text(&parsed.blocks[0]), "片名居中");
    }

    // ----- 首行前导空白保留（边角样本实证：缩进语义非回声） -----

    #[test]
    fn first_line_leading_whitespace_preserved() {
        // 段首前导空格（无换行前缀）＝作者缩进语义，逐字保留。
        let parsed =
            parse_body(r#"<Paragraph Type="Action"><Text>    Four spaces</Text></Paragraph>"#);
        assert_eq!(block_text(&parsed.blocks[0]), "    Four spaces");
        assert_eq!(parsed.char_count, "    Four spaces".chars().count());
        // 换行后的行首空白（XML 回声形态）仍剥除。
        let parsed = parse_body(
            "<Paragraph Type=\"Action\"><Text>首行\n        次行回声</Text></Paragraph>",
        );
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["首行", "次行回声"]);
    }

    // ----- Text 内换行（真实 fixture 实证形态：pretty-print 回声／强制换行） -----

    #[test]
    fn newlines_inside_text_split_into_adjacent_paragraphs() {
        // XML 缩进回声：首尾空白行丢弃、行边空白剥除，正文完整保留。
        let parsed = parse_body(
            "<Paragraph Type=\"Character\"><Text>\n        Henry\n      </Text></Paragraph>",
        );
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["Henry"]);
        assert_eq!(parsed.blocks[0]["attrs"]["indentLeft"], "4em");

        // 段内强制换行：拆为同属性相邻段落（同 md HardBreak／docx w:br 策略）。
        let parsed =
            parse_body(r#"<Paragraph Type="Dialogue"><Text>第一行&#10;第二行</Text></Paragraph>"#);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["第一行", "第二行"]);
        assert_eq!(parsed.blocks.len(), 2);
        assert_eq!(
            parsed.blocks[1]["attrs"]["indentLeft"], "2em",
            "延续段同属性"
        );
        assert_eq!(parsed.paragraph_count, 2);

        // 全空白段落：保留为空段（作者间距），字数为零。
        let parsed = parse_body(r#"<Paragraph Type="Action"><Text>   </Text></Paragraph>"#);
        assert_eq!(parsed.blocks.len(), 1);
        assert!(parsed.blocks[0].get("content").is_none());
        assert_eq!(parsed.char_count, 0);
    }

    // ----- 文件识别与失败路径 -----

    #[test]
    fn fdr_extension_rejected_with_hint() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = super::super::create_new_project(super::super::CreateProjectParams {
            name: "fdr 测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let file = temp.path().join("老剧本.fdr");
        std::fs::write(&file, b"binary junk").unwrap();
        let error =
            super::super::document_import::import_document_preview(&root, &file).unwrap_err();
        let message = error.to_string();
        assert!(
            message.contains(".fdr") && message.contains("另存为 .fdx"),
            "报错：{message}"
        );
    }

    #[test]
    fn malformed_xml_rejected() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = super::super::create_new_project(super::super::CreateProjectParams {
            name: "畸形测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let file = temp.path().join("坏的.fdx");
        std::fs::write(&file, b"<FinalDraft><Content><Paragraph>").unwrap();
        let error =
            super::super::document_import::import_document_preview(&root, &file).unwrap_err();
        assert!(
            error.to_string().contains("不是有效的 .fdx 文件"),
            "报错：{error}"
        );
    }

    #[test]
    fn wrong_root_element_rejected() {
        let Err(error) = parse_fdx(b"<NotFinalDraft><Content/></NotFinalDraft>") else {
            panic!("根元素不符必须被拒绝");
        };
        let message = error.to_string();
        assert!(
            message.contains("根元素应为 FinalDraft") && message.contains("NotFinalDraft"),
            "报错：{message}"
        );
    }

    #[test]
    fn non_utf8_rejected() {
        let Err(error) = parse_fdx(&[0xD6, 0xD0, 0xCE, 0xC4]) else {
            panic!("非 UTF-8 必须被拒绝");
        };
        assert!(error.to_string().contains("UTF-8"), "报错：{error}");
    }

    #[test]
    fn oversize_rejected() {
        let temp = tempfile::TempDir::new().unwrap();
        let file = temp.path().join("超大.fdx");
        std::fs::write(&file, vec![b'<'; 16 * 1024 * 1024 + 1]).unwrap();
        let error = super::super::document_import::read_file_bounded(
            &file,
            super::super::document_import::MAX_FDX_INPUT_BYTES,
        )
        .unwrap_err();
        assert!(error.to_string().contains("文件过大"), "报错：{error}");
    }

    #[test]
    fn bom_stripped_and_generator_extracted() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(
            r#"<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="3"><Content><Paragraph Type="Action"><Text>带 BOM 正文</Text></Paragraph></Content></FinalDraft>"#.as_bytes(),
        );
        let parsed = parse_fdx(&bytes).expect("BOM 兜底剥离");
        assert_eq!(block_text(&parsed.blocks[0]), "带 BOM 正文");
        assert_eq!(
            parsed.generator.as_deref(),
            Some("FinalDraft Version=3, DocumentType=Script")
        );
    }

    // ----- 拆分建议：集数场景头序列正反例 -----

    #[test]
    fn episode_scene_headings_suggest_split() {
        let mut body = String::new();
        for n in 1..=4 {
            body.push_str(&format!(
                r#"<Paragraph Type="Scene Heading"><Text>第{n}集</Text></Paragraph><Paragraph Type="Action"><Text>第{n}集正文。</Text></Paragraph>"#
            ));
        }
        let parsed = parse_body(&body);
        let (family, suggestion) =
            detect_split_from_markers(&parsed.markers).expect("应识别集数场景头");
        assert_eq!(family, "2:cn:集", "场景头都是二级标题");
        assert_eq!(suggestion.marker_sample, "第X集");
        assert_eq!(suggestion.count, 4);
        assert_eq!(
            suggestion.doc_names,
            vec!["第1集", "第2集", "第3集", "第4集"]
        );
    }

    #[test]
    fn numbered_scene_headings_still_recognized_without_prefix() {
        // 编号前缀不参与序列识别：带 Number 的集数场景头仍可拆分。
        let mut body = String::new();
        for n in 1..=3 {
            body.push_str(&format!(
                r#"<Paragraph Number="{n}" Type="Scene Heading"><Text>第{n}集</Text></Paragraph>"#
            ));
        }
        let parsed = parse_body(&body);
        let suggestion = detect_split_from_markers(&parsed.markers).expect("前缀不阻断识别");
        assert_eq!(suggestion.1.doc_names, vec!["第1集", "第2集", "第3集"]);
    }

    #[test]
    fn sparse_scene_headings_do_not_suggest() {
        let parsed = parse_body(concat!(
            r#"<Paragraph Type="Scene Heading"><Text>第1集</Text></Paragraph>"#,
            r#"<Paragraph Type="Scene Heading"><Text>第2集</Text></Paragraph>"#,
        ));
        assert!(detect_split_from_markers(&parsed.markers).is_none());
    }

    // ----- 产物过严格校验 -----

    #[test]
    fn produced_document_passes_strict_grammar() {
        let source = r#"<FinalDraft DocumentType="Script" Version="3"><TitlePage><Content><Paragraph><Text>标题页</Text></Paragraph></Content></TitlePage><Content><Paragraph Number="7" Type="Scene Heading"><Text>外景 广场—日</Text></Paragraph><Paragraph Type="Action"><Text Style="Bold+Italic">混合样式</Text></Paragraph><Paragraph Type="Character"><Text>角色</Text></Paragraph></Content></FinalDraft>"#;
        let parsed = parse(source);
        let value = super::super::document_import::doc_value_from_blocks(parsed.blocks.clone());
        super::super::validate_notebook_document(&value)
            .expect("fdx 映射产物必须通过既有严格语法校验");
    }
}
