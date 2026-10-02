//! Markdown 导入（add-markdown-import 任务组 2）：`.md` → canonical Tiptap
//! JSON v2 的事件流单遍映射（pulldown-cmark 0.13，design D1）。
//!
//! - **读取**（design D5）：仅 UTF-8——读入字节后剥 `EF BB BF` BOM（spike
//!   实证解析器不剥、U+FEFF 会进入首个 Text 事件），再做严格 UTF-8 校验，
//!   失败中文报错建议转存（不猜 GBK 等其他编码）；上限 16MB。行尾统一为 LF
//!   （CommonMark 将 LF/CR/CRLF 等价为行尾，统一后杜绝 `\r` 进入文本）。
//! - **映射**（design D3）：ATX/setext 标题→heading、段落、嵌套列表与有序
//!   start、`**`/`*`/`~~`→bold/italic/strike、`[文字](地址)`→link、
//!   `<u>` 逐标签 InlineHtml 配对状态机（只做平坦配对，未配对/嵌套按
//!   html_stripped 降级保文字）、转义由解析器自动还原、`HardBreak` 拆相邻
//!   段落（同 docx `w:br` 策略）、`SoftBreak` CJK 接合（两侧均 CJK 直连、
//!   否则插一个空格）。
//! - **降级与损耗**：code_degraded（行内＋块合并计数、note 分列）、
//!   quote_degraded、table_flattened、image_dropped、footnote_dropped（引用
//!   字面保留、定义丢弃计数）、tasklist_degraded（标记本体丢弃、勾选框字面
//!   保留）、hr_dropped、html_stripped（HTML 块剥标签保文字）、
//!   frontmatter_dropped（文件头 YAML 块整体剥离）。
//! - **拆分建议**（design D4）：识别对象为标题——同层级（族键带层级前缀）、
//!   短序列文本、重复 ≥3；默认不拆，用户拍板。

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde_json::{json, Map, Value};

use super::document_import::{
    merge_inline_runs, parse_marker_family, InlineRun, LossCounter, ParsedDocument,
};
use super::ProjectError;

// ========== 读取与预处理（design D5 / 任务 2.1、2.4） ==========

/// 解析 `.md` 字节为共享管线的 [`ParsedDocument`]。
///
/// 步骤：剥 BOM → 严格 UTF-8 → 行尾统一 LF → 剥离文件头 YAML frontmatter →
/// 事件流映射。非 UTF-8 与超限以中文报错稳定失败，零副作用。
pub(crate) fn parse_md(bytes: &[u8]) -> Result<ParsedDocument, ProjectError> {
    // BOM：spike 实证 pulldown-cmark 不剥离，U+FEFF 会进入首个 Text 事件字面。
    let bytes = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF][..])
        .unwrap_or(bytes);
    let text = std::str::from_utf8(bytes).map_err(|_| {
        ProjectError::ImportRejected(
            "文件不是 UTF-8 编码：请用编辑器把文件转存为 UTF-8 后再导入".to_string(),
        )
    })?;
    // CommonMark 将 LF/CR/CRLF 等价为行尾；统一为 LF，杜绝 \r 进入文本。
    let normalized = if text.contains('\r') {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text.to_string()
    };
    let (body, had_frontmatter) = strip_frontmatter(&normalized);

    let mut converter = MdConverter::new();
    if had_frontmatter {
        converter.losses.frontmatter += 1;
    }
    Ok(converter.run(body))
}

/// 识别并剥离文件头 YAML frontmatter（`---` 行开始、独立 `---` 行结束）。
///
/// 规则：必须位于文件头（BOM 已剥），首行（去行尾空白）恰为 `---` 且不缩进；
/// 结束行整行（去行尾空白）为 `---`。没有结束行则不是 frontmatter（交给解析
/// 器按分隔线处理）。返回（剩余正文, 是否剥离了 frontmatter）。
fn strip_frontmatter(text: &str) -> (&str, bool) {
    let line_is_delimiter = |line: &str| line.trim_end_matches([' ', '\t', '\r']) == "---";
    let mut consumed = 0usize;
    let mut found_close = false;
    for line in text.split_inclusive('\n') {
        let bare = line.strip_suffix('\n').unwrap_or(line);
        if consumed == 0 {
            if !line_is_delimiter(bare) {
                return (text, false);
            }
            consumed = line.len();
        } else {
            consumed += line.len();
            if line_is_delimiter(bare) {
                found_close = true;
                break;
            }
        }
    }
    if !found_close {
        return (text, false);
    }
    (&text[consumed..], true)
}

// ========== 事件流映射（design D3） ==========

fn parser_options() -> Options {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_FOOTNOTES);
    options
}

/// CJK 判定（软换行接合规则用）：统一表意文字及其扩展/兼容区、假名、谚文、
/// CJK 标点与全角形式均按 CJK 字符处理（中文排版习惯：此类字符间不加空格）。
fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x1100..=0x11FF       // 谚文字母
            | 0x2E80..=0x303F // CJK 部首区与 CJK 标点（。、《》「」等）
            | 0x3040..=0x30FF // 平假名与片假名
            | 0x3130..=0x318F // 谚文兼容字母
            | 0x3400..=0x4DBF // 扩展 A
            | 0x4E00..=0x9FFF // 统一表意文字
            | 0xA960..=0xA97F // 谚文扩展 A
            | 0xAC00..=0xD7FF // 谚文音节
            | 0xF900..=0xFAFF // 兼容表意文字
            | 0xFE30..=0xFE4F // CJK 兼容形式
            | 0xFF00..=0xFFEF // 全角形式（！？，（）等）
            | 0x20000..=0x2FA1F // 扩展 B 及以后
    )
}

/// mark 的 canonical rank（bold < italic < underline < strike < textStyle <
/// highlight < link），快照时按此排序去重。
fn mark_rank(mark: &Value) -> u8 {
    match mark["type"].as_str().unwrap_or("") {
        "bold" => 0,
        "italic" => 1,
        "underline" => 2,
        "strike" => 3,
        "textStyle" => 4,
        "highlight" => 5,
        "link" => 6,
        _ => 7,
    }
}

/// JavaScript 安全整数上限 2^53 - 1（grammar 对 orderedList.start 的上限）。
/// md 源里更大的起始编号按上限收敛（结构语义仍为有序列表）。
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

enum BufferKind {
    Paragraph,
    Heading(u8),
    /// 表格单元格：flush 时并入 Table 帧的格子序列（拍平）。
    Cell,
}

struct Buffer {
    kind: BufferKind,
    inline: Vec<InlineRun>,
}

enum Frame {
    List(ListFrame),
    /// 列表项：累积其块级内容（首段落 + 可选嵌套列表）。
    Item(Vec<Value>),
    Table(TableFrame),
}

struct ListFrame {
    ordered: bool,
    start: u64,
    items: Vec<Value>,
    /// 超出 grammar 承载的项内多余块（第二个及以后的嵌套列表等），在整个
    /// 列表结束后按原顺序输出到列表之后（文字与顺序零丢失）。
    overflow: Vec<Value>,
}

struct TableFrame {
    /// 逐格累积的段落块（行主序，含表头单元格；空格子跳过）。
    cells: Vec<Value>,
}

struct MdConverter {
    losses: LossCounter,
    char_count: usize,
    paragraph_count: usize,
    /// 顶层最终块序列。
    blocks: Vec<Value>,
    /// 顶层标题序列标记（块索引 + 带层级前缀的族键 + 文本）。
    markers: Vec<(usize, String, String)>,
    stack: Vec<Frame>,
    /// 当前块级行内缓冲（段落/标题/单元格）；紧列表的项文本无 Paragraph
    /// 包装，惰性创建。
    current: Option<Buffer>,
    /// 活动行内标记栈（bold/italic/strike/underline/link 的完整 mark JSON）。
    inline_marks: Vec<Value>,
    /// 软换行接合待决标记：下一个文本到达时按两侧字符类型决定是否插空格。
    pending_break: bool,
    /// `<u>` 配对状态机（只做平坦配对，不跨块）。
    underline_open: bool,
    /// Some = 代码块内容累积中。
    code_buf: Option<String>,
    /// Some = HTML 块内容累积中。
    html_buf: Option<String>,
    /// >0 = 跳过模式（图片 / 脚注定义）内的 Start/End 深度。
    skip_depth: usize,
}

impl MdConverter {
    fn new() -> Self {
        Self {
            losses: LossCounter::default(),
            char_count: 0,
            paragraph_count: 0,
            blocks: Vec::new(),
            markers: Vec::new(),
            stack: Vec::new(),
            current: None,
            inline_marks: Vec::new(),
            pending_break: false,
            underline_open: false,
            code_buf: None,
            html_buf: None,
            skip_depth: 0,
        }
    }

    fn run(mut self, text: &str) -> ParsedDocument {
        for event in Parser::new_ext(text, parser_options()) {
            self.handle(event);
        }
        // 防御性收尾：配对保证下不应有挂起缓冲。
        self.flush_current();
        ParsedDocument {
            blocks: self.blocks,
            markers: self.markers,
            losses: self.losses,
            char_count: self.char_count,
            paragraph_count: self.paragraph_count,
            generator: None,
        }
    }

    fn handle(&mut self, event: Event) {
        // 跳过模式（图片 / 脚注定义）：只追踪 Start/End 深度，内容全部丢弃。
        if self.skip_depth > 0 {
            match event {
                Event::Start(_) => self.skip_depth += 1,
                Event::End(_) => self.skip_depth -= 1,
                _ => {}
            }
            return;
        }
        match event {
            Event::Start(tag) => self.start_tag(tag),
            Event::End(end) => self.end_tag(end),
            Event::Text(text) => self.push_text(&text),
            Event::Code(code) => {
                self.ensure_buffer();
                self.push_run(code.to_string());
                self.losses.code_inline += 1;
            }
            // 未启用 ENABLE_MATH，正常不会出现；防御性按纯文字保留。
            Event::InlineMath(text) | Event::DisplayMath(text) => {
                self.ensure_buffer();
                self.push_run(text.to_string());
            }
            Event::Html(chunk) => {
                if let Some(buf) = &mut self.html_buf {
                    buf.push_str(&chunk);
                }
            }
            Event::InlineHtml(html) => self.inline_html(&html),
            // 脚注引用：原字面保留（`[^id]` 不擅动文字），不构成损耗；
            // 损耗只计被丢弃的脚注定义（见 Start(FootnoteDefinition)）。
            Event::FootnoteReference(id) => {
                self.ensure_buffer();
                self.push_run(format!("[^{id}]"));
            }
            Event::SoftBreak => self.soft_break(),
            Event::HardBreak => self.hard_break(),
            Event::Rule => self.losses.hr += 1,
            // 任务列表：标记本体（勾选状态语义）丢弃，勾选框以字面保留。
            Event::TaskListMarker(checked) => {
                self.ensure_buffer();
                let literal = if checked { "[x] " } else { "[ ] " };
                self.push_run(literal.to_string());
                self.losses.tasklists += 1;
            }
        }
    }

    // ----- 块级开始/结束 -----

    fn start_tag(&mut self, tag: Tag) {
        match tag {
            Tag::Paragraph => {
                self.flush_current();
                self.current = Some(Buffer { kind: BufferKind::Paragraph, inline: Vec::new() });
            }
            Tag::Heading { level, .. } => {
                self.flush_current();
                let level = level as u8;
                self.current = Some(Buffer { kind: BufferKind::Heading(level), inline: Vec::new() });
            }
            // 引用块：外壳降级（quote_degraded 计数），内容块自然汇入
            // 外层容器，文字零丢失。
            Tag::BlockQuote(_) => self.losses.quotes += 1,
            Tag::CodeBlock(_) => {
                self.flush_current();
                self.code_buf = Some(String::new());
            }
            Tag::HtmlBlock => {
                self.flush_current();
                self.html_buf = Some(String::new());
            }
            Tag::List(start) => {
                self.flush_current();
                let (ordered, start) = match start {
                    Some(number) => (true, number.clamp(1, MAX_SAFE_INTEGER)),
                    None => (false, 1),
                };
                self.stack.push(Frame::List(ListFrame {
                    ordered,
                    start,
                    items: Vec::new(),
                    overflow: Vec::new(),
                }));
            }
            Tag::Item => {
                self.flush_current();
                self.stack.push(Frame::Item(Vec::new()));
            }
            // 脚注定义：整体丢弃并计数（引用已在正文以字面保留）。
            Tag::FootnoteDefinition(_) => {
                self.flush_current();
                self.skip_depth = 1;
                self.losses.footnotes += 1;
            }
            Tag::Table(_) => {
                self.flush_current();
                self.stack.push(Frame::Table(TableFrame { cells: Vec::new() }));
            }
            // 行容器：单元格事件自行处理。
            Tag::TableHead | Tag::TableRow => {}
            Tag::TableCell => {
                self.flush_current();
                self.current = Some(Buffer { kind: BufferKind::Cell, inline: Vec::new() });
            }
            // ----- 行内容器：标记入栈 -----
            Tag::Emphasis => self.inline_marks.push(json!({ "type": "italic" })),
            Tag::Strong => self.inline_marks.push(json!({ "type": "bold" })),
            Tag::Strikethrough => self.inline_marks.push(json!({ "type": "strike" })),
            Tag::Link { dest_url, .. } => {
                if !dest_url.is_empty() {
                    self.inline_marks.push(json!({
                        "type": "link",
                        "attrs": { "href": dest_url.to_string() }
                    }));
                }
            }
            // 图片整体丢弃（含替代文字——图片不渲染为可见文字）并计数。
            Tag::Image { .. } => {
                self.skip_depth = 1;
                self.losses.images += 1;
            }
            // 未启用的扩展（上/下标、定义列表、元数据块）不会出现；防御忽略。
            _ => {}
        }
    }

    fn end_tag(&mut self, end: TagEnd) {
        match end {
            TagEnd::Paragraph | TagEnd::Heading(_) => self.flush_current(),
            TagEnd::BlockQuote(_) => {}
            TagEnd::CodeBlock => {
                let buf = self.code_buf.take().unwrap_or_default();
                self.emit_code_block(&buf);
            }
            TagEnd::HtmlBlock => {
                let buf = self.html_buf.take().unwrap_or_default();
                self.emit_html_block(&buf);
            }
            TagEnd::List(_) => self.end_list(),
            TagEnd::Item => self.end_item(),
            TagEnd::FootnoteDefinition => {}
            TagEnd::Table => self.end_table(),
            TagEnd::TableHead | TagEnd::TableRow => {}
            TagEnd::TableCell => self.flush_current(),
            TagEnd::Emphasis => self.pop_mark_of("italic"),
            TagEnd::Strong => self.pop_mark_of("bold"),
            TagEnd::Strikethrough => self.pop_mark_of("strike"),
            TagEnd::Link => self.pop_mark_of("link"),
            TagEnd::Image => {}
            _ => {}
        }
    }

    // ----- 行内事件 -----

    fn push_text(&mut self, text: &str) {
        if let Some(code) = &mut self.code_buf {
            code.push_str(text);
            return;
        }
        self.ensure_buffer();
        self.push_run(text.to_string());
    }

    fn soft_break(&mut self) {
        if let Some(code) = &mut self.code_buf {
            code.push('\n');
            return;
        }
        if self.html_buf.is_some() {
            // HTML 块事件自带行尾，无需处理。
            return;
        }
        self.ensure_buffer();
        self.pending_break = true;
    }

    fn hard_break(&mut self) {
        if let Some(code) = &mut self.code_buf {
            code.push('\n');
            return;
        }
        if self.html_buf.is_some() {
            return;
        }
        // 单元格内硬换行：拍平语义下按软换行接合处理（一格仍是一段）。
        if matches!(self.current_kind(), Some(BufferKind::Cell)) {
            self.pending_break = true;
            return;
        }
        // 硬换行超出语法承载（text 不允许换行符）：按同属性拆分为相邻段落。
        let Some(buffer) = self.current.take() else {
            return;
        };
        let continuation_kind = match &buffer.kind {
            BufferKind::Heading(level) => BufferKind::Heading(*level),
            _ => BufferKind::Paragraph,
        };
        self.flush_buffer(buffer);
        self.current = Some(Buffer {
            kind: continuation_kind,
            inline: Vec::new(),
        });
    }

    fn inline_html(&mut self, html: &str) {
        // `<u>` 配对状态机：只认无属性的纯标签（大小写不敏感）；带属性或
        // 其他标签一律 html_stripped（剥标签保文字）。
        let normalized = html.trim().to_ascii_lowercase();
        if normalized == "<u>" {
            if !self.underline_open {
                self.underline_open = true;
                self.inline_marks.push(json!({ "type": "underline" }));
            } else {
                // 嵌套 <u>：只做平坦配对。
                self.losses.html_stripped += 1;
            }
            return;
        }
        if normalized == "</u>" {
            if self.underline_open {
                self.underline_open = false;
                self.pop_mark_of("underline");
            } else {
                // 未配对闭合。
                self.losses.html_stripped += 1;
            }
            return;
        }
        self.losses.html_stripped += 1;
    }

    /// 惰性创建段落缓冲（紧列表项文本、任务列表标记、脚注引用字面等
    /// 没有 Paragraph 包装的行内事件）。
    fn ensure_buffer(&mut self) {
        if self.current.is_none() && self.code_buf.is_none() && self.html_buf.is_none() {
            self.current = Some(Buffer { kind: BufferKind::Paragraph, inline: Vec::new() });
        }
    }

    fn current_kind(&self) -> Option<&BufferKind> {
        self.current.as_ref().map(|buffer| &buffer.kind)
    }

    /// 弹出指定类型的最近一个标记（应对任意嵌套顺序）。
    fn pop_mark_of(&mut self, mark_type: &str) {
        if let Some(position) = self
            .inline_marks
            .iter()
            .rposition(|mark| mark["type"] == mark_type)
        {
            self.inline_marks.remove(position);
        }
    }

    /// 活动标记快照：去重并按 canonical rank 排序。
    fn snapshot_marks(&self) -> Vec<Value> {
        let mut marks = self.inline_marks.clone();
        marks.sort_by_key(mark_rank);
        let mut seen: Vec<String> = Vec::new();
        marks
            .into_iter()
            .filter(|mark| {
                let mark_type = mark["type"].as_str().unwrap_or("").to_string();
                if seen.contains(&mark_type) {
                    false
                } else {
                    seen.push(mark_type);
                    true
                }
            })
            .collect()
    }

    fn buffer_last_char(&self) -> Option<char> {
        self.current
            .as_ref()
            .and_then(|buffer| buffer.inline.last())
            .and_then(|run| run.text.chars().next_back())
    }

    fn push_run(&mut self, text: String) {
        if text.is_empty() {
            return;
        }
        // 软换行接合决策：两侧均 CJK 直连，否则插一个空格（缓冲为空不插）。
        if self.pending_break {
            self.pending_break = false;
            if let Some(last) = self.buffer_last_char() {
                let next = text.chars().next().unwrap_or(' ');
                if !(is_cjk(last) && is_cjk(next)) {
                    let marks = self.snapshot_marks();
                    self.char_count += 1;
                    if let Some(buffer) = self.current.as_mut() {
                        buffer.inline.push(InlineRun { text: " ".to_string(), marks });
                    }
                }
            }
        }
        self.char_count += text.chars().count();
        let marks = self.snapshot_marks();
        if let Some(buffer) = self.current.as_mut() {
            buffer.inline.push(InlineRun { text, marks });
        }
    }

    // ----- 缓冲落盘 -----

    fn flush_current(&mut self) {
        if let Some(buffer) = self.current.take() {
            self.flush_buffer(buffer);
        }
    }

    fn flush_buffer(&mut self, mut buffer: Buffer) {
        self.pending_break = false;
        // `<u>` 未闭合：本块内 underline 全部按 html_stripped 降级——
        // 移除标记、保留文字（设计：未配对开启按剥标签处理）。
        if self.underline_open {
            self.underline_open = false;
            self.pop_mark_of("underline");
            self.losses.html_stripped += 1;
            for run in &mut buffer.inline {
                run.marks.retain(|mark| mark["type"] != "underline");
            }
        }
        let (content, text_total) = merge_inline_runs(buffer.inline);

        match buffer.kind {
            BufferKind::Cell => {
                // 空格子跳过（无文字可保）；有文字的格子成为拍平段落。
                if content.is_empty() {
                    return;
                }
                self.paragraph_count += 1;
                let node = paragraph_node(content);
                if let Some(Frame::Table(table)) = self.stack.last_mut() {
                    table.cells.push(node);
                }
            }
            BufferKind::Heading(level) => {
                let mut node = Map::new();
                node.insert("type".to_string(), json!("heading"));
                let mut attrs = Map::new();
                attrs.insert("level".to_string(), json!(level));
                node.insert("attrs".to_string(), Value::Object(attrs));
                if !content.is_empty() {
                    node.insert("content".to_string(), Value::Array(content));
                }
                // 顶层标题参与序列标记识别（族键带层级前缀，保证「同层级」）。
                if self.marker_eligible() {
                    if let Some(family) = parse_marker_family(&text_total) {
                        self.markers.push((
                            self.sink_len(),
                            format!("{level}:{family}"),
                            text_total.trim().to_string(),
                        ));
                    }
                }
                self.sink_push(Value::Object(node));
                self.paragraph_count += 1;
            }            BufferKind::Paragraph => {
                self.sink_push(paragraph_node(content));
                self.paragraph_count += 1;
            }
        }
    }

    // ----- 容器帧 -----

    /// 当前块级接收者：最内层列表项的块序列，否则顶层块序列。
    fn sink_push(&mut self, node: Value) {
        for frame in self.stack.iter_mut().rev() {
            if let Frame::Item(blocks) = frame {
                blocks.push(node);
                return;
            }
        }
        self.blocks.push(node);
    }

    fn sink_len(&self) -> usize {
        for frame in self.stack.iter().rev() {
            if let Frame::Item(blocks) = frame {
                return blocks.len();
            }
        }
        self.blocks.len()
    }

    /// 标记仅认「落在顶层块序列」的标题（列表项内的标题不参与）。
    fn marker_eligible(&self) -> bool {
        self.stack.iter().all(|frame| !matches!(frame, Frame::Item(_)))
    }

    fn end_item(&mut self) {
        self.flush_current();
        let Some(Frame::Item(mut blocks)) = self.stack.pop() else {
            return;
        };
        // listItem = [首段落] 或 [首段落, 一个嵌套列表]。
        // 首块是段落（或标题降级为段落）；列表直接开头则补空段落；
        // 多余段落并入首段（软接合语义）；多余列表溢出到列表之后。
        let mut first = match blocks.first().map(|block| block["type"].as_str()) {
            Some(Some("paragraph")) => blocks.remove(0),
            Some(Some("heading")) => {
                let mut node = blocks.remove(0);
                coerce_heading_to_paragraph(&mut node);
                node
            }
            _ => paragraph_node(Vec::new()),
        };
        let mut nested: Option<Value> = None;
        let mut overflow: Vec<Value> = Vec::new();
        for block in blocks {
            let is_list = matches!(
                block["type"].as_str(),
                Some("bulletList") | Some("orderedList")
            );
            if is_list {
                if nested.is_none() {
                    nested = Some(block);
                } else {
                    overflow.push(block);
                }
            } else {
                self.absorb_extra_paragraph(&mut first, block);
            }
        }
        let mut item = json!({ "type": "listItem", "content": [first] });
        if let Some(nested) = nested {
            item["content"].as_array_mut().unwrap().push(nested);
        }
        match self.stack.last_mut() {
            Some(Frame::List(list)) => {
                list.items.push(item);
                list.overflow.extend(overflow);
            }
            // 防御：孤立 item 顶层成块。
            _ => {
                self.blocks.push(item);
                self.blocks.extend(overflow);
            }
        }
    }

    /// 列表项内的多余段落并入首段：文字按 CJK 接合规则衔接，顺序零丢失。
    fn absorb_extra_paragraph(&mut self, first: &mut Value, extra: Value) {
        let Some(extra_nodes) = extra.get("content").and_then(Value::as_array).cloned() else {
            return;
        };
        if extra_nodes.is_empty() {
            return;
        }
        let first_empty = first.get("content").is_none();
        if first_empty {
            first["content"] = Value::Array(extra_nodes);
            return;
        }
        // 接合空格：前文末字符与多余段首字符非双侧 CJK 时补一个空格。
        let last_char = first_text_tail(first);
        let next_char = extra_nodes
            .first()
            .and_then(|node| node["text"].as_str())
            .and_then(|text| text.chars().next());
        if let (Some(last), Some(next)) = (last_char, next_char) {
            if !(is_cjk(last) && is_cjk(next)) {
                self.char_count += 1;
                if let Some(runs) = first["content"].as_array_mut() {
                    runs.push(json!({ "type": "text", "text": " " }));
                }
            }
        }
        if let Some(runs) = first["content"].as_array_mut() {
            runs.extend(extra_nodes);
        }
    }

    fn end_list(&mut self) {
        let Some(Frame::List(list)) = self.stack.pop() else {
            return;
        };
        let node = if list.ordered {
            json!({
                "type": "orderedList",
                "attrs": { "start": list.start },
                "content": list.items
            })
        } else {
            json!({ "type": "bulletList", "content": list.items })
        };
        self.sink_push(node);
        for extra in list.overflow {
            self.sink_push(extra);
        }
    }

    fn end_table(&mut self) {
        let Some(Frame::Table(table)) = self.stack.pop() else {
            return;
        };
        self.losses.tables += 1;
        for cell in table.cells {
            self.sink_push(cell);
        }
    }

    // ----- 代码块与 HTML 块 -----

    /// 代码块逐行拍平为段落（code_degraded 计数一次）。
    fn emit_code_block(&mut self, buf: &str) {
        self.losses.code_blocks += 1;
        let body = buf.strip_suffix('\n').unwrap_or(buf);
        if body.is_empty() {
            return;
        }
        for line in body.split('\n') {
            self.paragraph_count += 1;
            if line.is_empty() {
                self.sink_push(paragraph_node(Vec::new()));
                continue;
            }
            self.char_count += line.chars().count();
            let node = paragraph_node(vec![json!({ "type": "text", "text": line })]);
            self.sink_push(node);
        }
    }

    /// HTML 块：剥除标签保留其中文字，按非空行成为段落（html_stripped 计数
    /// 一次每块；行内非 `<u>` 标签在 inline_html 里逐标签计数）。
    fn emit_html_block(&mut self, buf: &str) {
        self.losses.html_stripped += 1;
        let stripped = strip_html_tags(buf);
        for line in stripped.split('\n') {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            self.paragraph_count += 1;
            self.char_count += line.chars().count();
            let node = paragraph_node(vec![json!({ "type": "text", "text": line })]);
            self.sink_push(node);
        }
    }
}

fn paragraph_node(content: Vec<Value>) -> Value {
    let mut node = Map::new();
    node.insert("type".to_string(), json!("paragraph"));
    if !content.is_empty() {
        node.insert("content".to_string(), Value::Array(content));
    }
    Value::Object(node)
}

/// 标题节点降级为段落（列表项内的罕见构造）：保留行内内容，去掉标题语义。
fn coerce_heading_to_paragraph(node: &mut Value) {
    if let Some(object) = node.as_object_mut() {
        object.insert("type".to_string(), json!("paragraph"));
        object.remove("attrs");
    }
}

fn first_text_tail(node: &Value) -> Option<char> {
    node.get("content")
        .and_then(Value::as_array)
        .and_then(|runs| runs.last())
        .and_then(|run| run["text"].as_str())
        .and_then(|text| text.chars().next_back())
}

/// 剥除 `<...>` 标签段（含注释/声明），保留其余文字。属性内含 `>` 的病态
/// 输入按朴素扫描处理（罕见，接受近似）。
fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

// ========== 测试（任务 5.1 映射规则单测＋5.3 补充样本） ==========

#[cfg(test)]
mod tests {
    use super::super::document_import::detect_split_from_markers;
    use super::*;

    fn parse(input: &str) -> ParsedDocument {
        parse_md(input.as_bytes()).expect("parse md")
    }

    fn blocks_of(input: &str) -> Vec<Value> {
        parse(input).blocks
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

    fn mark_types_of(block: &Value) -> Vec<String> {
        block
            .get("content")
            .and_then(Value::as_array)
            .map(|nodes| {
                nodes
                    .iter()
                    .flat_map(|n| n.get("marks").and_then(Value::as_array).cloned().unwrap_or_default())
                    .map(|m| m["type"].as_str().unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn loss(parsed: &ParsedDocument, field: usize) -> usize {
        let counter: [usize; 14] = [
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
        ];
        counter[field]
    }

    const L_TABLES: usize = 0;
    const L_IMAGES: usize = 1;
    const L_FOOTNOTES: usize = 2;
    const L_CODE_INLINE: usize = 6;
    const L_CODE_BLOCKS: usize = 7;
    const L_QUOTES: usize = 8;
    const L_HR: usize = 9;
    const L_HTML: usize = 10;
    const L_FRONTMATTER: usize = 11;
    const L_TASKLISTS: usize = 12;

    // ----- 5.1：`<u>` 配对正反例 -----

    #[test]
    fn underline_pairs_to_mark() {
        let blocks = blocks_of("前文 <u>下划线</u> 后文");
        assert_eq!(mark_types_of(&blocks[0]), vec!["underline"]);
        let runs = blocks[0]["content"].as_array().unwrap();
        assert_eq!(runs.len(), 3, "三段：纯文字/下划线/纯文字：{runs:#?}");
        assert_eq!(runs[1]["text"], "下划线");
        assert_eq!(runs[1]["marks"][0]["type"], "underline");
    }

    #[test]
    fn unclosed_underline_degrades_with_text_kept() {
        let parsed = parse("前文 <u>未闭合下划线");
        assert_eq!(parsed.blocks.len(), 1);
        // 未配对开启：按 html_stripped 降级——文字保留、无 underline 标记
        // （标签两侧空格是源文件字面，原样保留）。
        assert_eq!(mark_types_of(&parsed.blocks[0]).len(), 0);
        assert_eq!(block_text(&parsed.blocks[0]), "前文 未闭合下划线");
        assert_eq!(loss(&parsed, L_HTML), 1);
    }

    #[test]
    fn stray_close_and_nested_open_degrade() {
        // 孤立闭合 + 嵌套开启：各计一处 html_stripped，文字全保留。
        let parsed = parse("甲</u>乙<u>丙<u>丁</u>戊");
        assert_eq!(loss(&parsed, L_HTML), 2, "孤立闭合与嵌套开启各一处");
        assert_eq!(block_text(&parsed.blocks[0]), "甲乙丙丁戊");
        // 嵌套后仍有平坦配对生效：首个 <u> 覆盖到闭合为止（丙丁），
        // 第二个 <u> 剥除（戊无标记）。
        let runs = parsed.blocks[0]["content"].as_array().unwrap();
        let underlined: Vec<&str> = runs
            .iter()
            .filter(|r| {
                r.get("marks")
                    .and_then(|m| m.as_array())
                    .is_some_and(|ms| ms.iter().any(|m| m["type"] == "underline"))
            })
            .map(|r| r["text"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(underlined, vec!["丙丁"], "平坦配对覆盖到闭合为止");
    }

    #[test]
    fn attribute_bearing_u_tag_stripped() {
        // 带属性的 <u> 不认作配对标签：剥除保文字。
        let parsed = parse("<u style=\"x\">带属性</u>");
        assert_eq!(loss(&parsed, L_HTML), 2, "开闭各按普通标签剥除");
        assert_eq!(block_text(&parsed.blocks[0]), "带属性");
    }

    #[test]
    fn underline_combined_with_other_marks_kept() {
        let blocks = blocks_of("**<u>粗下划线</u>**");
        // canonical rank 序：bold(0) < underline(2)。
        assert_eq!(mark_types_of(&blocks[0]), vec!["bold", "underline"]);
    }

    // ----- 5.1：软换行接合 -----

    #[test]
    fn softbreak_joins_cjk_without_space() {
        let blocks = blocks_of("中文第一行\n中文第二行");
        assert_eq!(blocks.len(), 1, "软换行不拆段");
        assert_eq!(block_text(&blocks[0]), "中文第一行中文第二行");
    }

    #[test]
    fn softbreak_between_latin_inserts_space() {
        let blocks = blocks_of("word one\ntwo three");
        assert_eq!(block_text(&blocks[0]), "word one two three");
    }

    #[test]
    fn softbreak_between_mixed_inserts_space() {
        // 中西混排：任一侧非 CJK 即插一个空格。
        let blocks = blocks_of("中文word\n中文");
        assert_eq!(block_text(&blocks[0]), "中文word 中文");
        let blocks = blocks_of("English\n中文");
        assert_eq!(block_text(&blocks[0]), "English 中文");
    }

    #[test]
    fn softbreak_long_wrapping_text_joins_into_one_paragraph() {
        // 5.3 软换行长文：多行 wrapping 中文合成一个连续段落，无空格。
        let source = "这是一段在编辑器里\n按行宽自动折行的\n中文正文，导入后\n应当接合为连续段落。";
        let parsed = parse(source);
        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(
            block_text(&parsed.blocks[0]),
            "这是一段在编辑器里按行宽自动折行的中文正文，导入后应当接合为连续段落。"
        );
    }

    // ----- 5.1：frontmatter 剥离 -----

    #[test]
    fn frontmatter_stripped_and_counted() {
        let source = "---\ntitle: 我的笔记\ntags: [剧本, 草稿]\n---\n\n# 正文标题\n\n正文段落。";
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_FRONTMATTER), 1);
        assert_eq!(parsed.blocks.len(), 2);
        assert_eq!(parsed.blocks[0]["type"], "heading");
        assert_eq!(block_text(&parsed.blocks[0]), "正文标题");
        // frontmatter 不进入正文字数。
        assert_eq!(
            parsed.char_count,
            "正文标题正文段落。".chars().count()
        );
    }

    #[test]
    fn leading_dashes_without_close_is_not_frontmatter() {
        // 无结束分隔线：不是 frontmatter，首行 --- 按分隔线处理。
        let parsed = parse("---\n正文");
        assert_eq!(loss(&parsed, L_FRONTMATTER), 0);
        assert_eq!(loss(&parsed, L_HR), 1);
        assert_eq!(block_text(&parsed.blocks[0]), "正文");
    }

    #[test]
    fn dashes_not_at_start_is_not_frontmatter() {
        let parsed = parse("正文\n\n---\n\n更多正文");
        assert_eq!(loss(&parsed, L_FRONTMATTER), 0);
        assert_eq!(loss(&parsed, L_HR), 1);
    }

    #[test]
    fn obsidian_style_frontmatter_stripped() {
        // 5.3：Obsidian 典型 frontmatter（首行 --- 直接跟键值、BOM 场景另测）。
        let source = "---\ncreated: 2026-10-02\naliases:\n  - 别名一\n---\n正文只有一个段落。";
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_FRONTMATTER), 1);
        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(block_text(&parsed.blocks[0]), "正文只有一个段落。");
    }

    // ----- 5.1：转义还原 -----

    #[test]
    fn escapes_restored_to_literal_text() {
        // 代码 span 外的转义由解析器自动还原为字面字符。
        let blocks = blocks_of(r#"\*不是斜体\* \#不是标题 100\%"#);
        assert_eq!(mark_types_of(&blocks[0]).len(), 0);
        assert_eq!(block_text(&blocks[0]), "*不是斜体* #不是标题 100%");
        // 行内代码计入降级；代码 span 内的转义不还原（CommonMark 语义：
        // 代码内容字面保留，反斜杠原样），同样是「逐字」。
        let parsed = parse("`带\\`反引号` 后文");
        assert_eq!(loss(&parsed, L_CODE_INLINE), 1);
        assert!(block_text(&parsed.blocks[0]).starts_with("带\\"));
    }

    // ----- 5.1：列表嵌套与 start -----

    #[test]
    fn nested_lists_with_ordered_start_preserved() {
        let source = "3. 第三项\n4. 第四项\n    - 嵌套无序\n5. 第五项\n\n- 无序一\n- 无序二";
        let parsed = parse(source);
        assert_eq!(parsed.blocks.len(), 2);

        let ordered = &parsed.blocks[0];
        assert_eq!(ordered["type"], "orderedList");
        assert_eq!(ordered["attrs"]["start"], 3);
        let items = ordered["content"].as_array().unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0]["content"][0]["content"][0]["text"], "第三项");
        // 嵌套无序列表保留在第二个列表项内。
        assert_eq!(items[1]["content"].as_array().unwrap().len(), 2);
        assert_eq!(items[1]["content"][1]["type"], "bulletList");
        assert_eq!(items[1]["content"][1]["content"][0]["content"][0]["content"][0]["text"], "嵌套无序");

        assert_eq!(parsed.blocks[1]["type"], "bulletList");
        assert_eq!(parsed.blocks[1]["content"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn tight_list_items_become_implicit_paragraphs() {
        let blocks = blocks_of("- 甲\n- 乙\n- 丙");
        assert_eq!(blocks.len(), 1);
        let items = blocks[0]["content"].as_array().unwrap();
        assert_eq!(items.len(), 3);
        for item in items {
            assert_eq!(item["content"][0]["type"], "paragraph");
        }
    }

    // ----- 5.1 / 5.3：各降级 kind 计数正反例 -----

    #[test]
    fn code_block_flattened_line_by_line() {
        let source = "```\n第一行代码\n第二行代码\n```\n\n正文段落。";
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_CODE_BLOCKS), 1);
        assert_eq!(loss(&parsed, L_CODE_INLINE), 0);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["第一行代码", "第二行代码", "正文段落。"]);
    }

    #[test]
    fn quote_degraded_to_plain_paragraphs() {
        let parsed = parse("> 引用第一段\n>\n> 引用第二段");
        assert_eq!(loss(&parsed, L_QUOTES), 1);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["引用第一段", "引用第二段"]);
    }

    #[test]
    fn gfm_table_flattened_cell_by_cell() {
        let source = "| 列甲 | 列乙 |\n|---|---|\n| 一 | 二 |\n| 三 | 四 |";
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_TABLES), 1);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        // 表头 + 两个数据行，逐格拍平、行主序。
        assert_eq!(texts, vec!["列甲", "列乙", "一", "二", "三", "四"]);
        assert!(parsed.blocks.iter().all(|b| b["type"] == "paragraph"));
    }

    #[test]
    fn image_dropped_with_alt_text() {
        let parsed = parse("前文 ![替代文字](image.png) 后文");
        assert_eq!(loss(&parsed, L_IMAGES), 1);
        // 图片整体丢弃（含替代文字）；标签两侧空格是源文件字面，原样保留。
        assert_eq!(block_text(&parsed.blocks[0]), "前文  后文");
    }

    #[test]
    fn footnote_reference_kept_literal_definition_dropped() {
        let source = "正文脚注[^1]。\n\n[^1]: 脚注定义内容。";
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_FOOTNOTES), 1, "只计被丢弃的定义");
        // 引用原字面保留。
        assert_eq!(block_text(&parsed.blocks[0]), "正文脚注[^1]。");
        assert_eq!(parsed.blocks.len(), 1, "定义不成为正文块");
    }

    #[test]
    fn tasklist_marker_literal_kept_in_bullet_list() {
        let source = "- [x] 已完成项\n- [ ] 未完成项";
        let parsed = parse(source);
        assert_eq!(loss(&parsed, L_TASKLISTS), 2);
        assert_eq!(parsed.blocks[0]["type"], "bulletList");
        let items = parsed.blocks[0]["content"].as_array().unwrap();
        let first_text = items[0]["content"][0]["content"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["text"].as_str().unwrap_or(""))
            .collect::<String>();
        assert_eq!(first_text, "[x] 已完成项");
        let second_text = items[1]["content"][0]["content"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["text"].as_str().unwrap_or(""))
            .collect::<String>();
        assert_eq!(second_text, "[ ] 未完成项");
    }

    #[test]
    fn horizontal_rule_dropped() {
        let parsed = parse("上文\n\n---\n\n下文");
        assert_eq!(loss(&parsed, L_HR), 1);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["上文", "下文"]);
    }

    #[test]
    fn other_inline_html_stripped_text_kept() {
        let parsed = parse("普通 <b>加粗标签</b> 与 <!-- 注释 --> 结尾");
        assert!(loss(&parsed, L_HTML) >= 2, "标签剥除按标签计数");
        assert_eq!(block_text(&parsed.blocks[0]), "普通 加粗标签 与  结尾");
    }

    #[test]
    fn html_block_stripped_to_text_lines() {
        let parsed = parse("<div>\n块内文字\n</div>\n\n正文。");
        assert_eq!(loss(&parsed, L_HTML), 1, "HTML 块整块计一处");
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert!(texts.contains(&"块内文字".to_string()), "块内文字保留：{texts:?}");
        assert!(texts.contains(&"正文。".to_string()));
    }

    #[test]
    fn no_losses_for_plain_supported_markdown() {
        // 反例：纯支持元素不产生任何损耗。
        let parsed = parse("# 标题\n\n段落 **粗** *斜* ~~删~~ <u>下划</u> [链](https://e.com)\n\n1. 一\n2. 二");
        let kinds = parsed.losses.loss_kinds_for_test();
        assert!(kinds.is_empty(), "损耗：{kinds:?}");
    }

    // ----- 5.1：硬换行拆段 -----

    #[test]
    fn hard_break_splits_into_adjacent_paragraphs() {
        let parsed = parse("第一行  \n第二行反斜杠\\\n第三行");
        assert_eq!(parsed.blocks.len(), 3);
        let texts: Vec<String> = parsed.blocks.iter().map(block_text).collect();
        assert_eq!(texts, vec!["第一行", "第二行反斜杠", "第三行"]);
    }

    // ----- 拆分建议：同层级标题序列 -----

    #[test]
    fn heading_sequence_suggests_split() {
        let source = "# 书名\n\n前言。\n\n## 第1章\n\n第一章正文\n\n## 第2章\n\n第二章正文\n\n## 第3章\n\n第三章正文";
        let parsed = parse(source);
        let (family, suggestion) =
            detect_split_from_markers(&parsed.markers).expect("应识别章标题序列");
        assert_eq!(family, "2:cn:章");
        assert_eq!(suggestion.marker_sample, "第X章");
        assert_eq!(suggestion.count, 3);
        assert_eq!(suggestion.doc_names, vec!["第1章", "第2章", "第3章"]);
    }

    #[test]
    fn mixed_heading_levels_do_not_suggest() {
        // 层级不一致（# 与 ## 混用）：每族不达「同层级」重复阈值，不建议。
        let source = "## 第1章\n\n# 第2章\n\n## 第3章";
        let parsed = parse(source);
        assert!(detect_split_from_markers(&parsed.markers).is_none());
    }

    #[test]
    fn sparse_headings_do_not_suggest() {
        let parsed = parse("## 第1章\n\n## 第2章");
        assert!(detect_split_from_markers(&parsed.markers).is_none());
    }

    #[test]
    fn paragraph_markers_do_not_qualify_for_md() {
        // md 分支的标记只认标题：全加粗段落「第N集」不构成建议。
        let parsed = parse("**第1集**\n\n**第2集**\n\n**第3集**");
        assert!(parsed.markers.is_empty(), "标记：{:?}", parsed.markers);
        assert!(detect_split_from_markers(&parsed.markers).is_none());
    }

    // ----- 5.3：编码与行尾补充样本 -----

    #[test]
    fn bom_stripped_before_parse() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("带 BOM 的正文".as_bytes());
        let parsed = parse_md(&bytes).expect("BOM 文件必须正常解析");
        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(block_text(&parsed.blocks[0]), "带 BOM 的正文");
        assert!(
            !block_text(&parsed.blocks[0]).contains('\u{feff}'),
            "BOM 不得进入正文"
        );
    }

    #[test]
    fn crlf_line_endings_treated_as_softbreak() {
        let parsed = parse_md("中文甲行\r\n中文乙行\r\n\r\n第二段".as_bytes()).expect("CRLF 解析");
        assert_eq!(parsed.blocks.len(), 2);
        assert_eq!(block_text(&parsed.blocks[0]), "中文甲行中文乙行");
        assert_eq!(block_text(&parsed.blocks[1]), "第二段");
    }

    #[test]
    fn non_utf8_rejected_with_chinese_error() {
        // GBK 编码的「中文」。
        let Err(error) = parse_md(&[0xD6, 0xD0, 0xCE, 0xC4]) else {
            panic!("非 UTF-8 必须被拒绝");
        };
        let message = error.to_string();
        assert!(
            message.contains("UTF-8") && message.contains("转存"),
            "报错：{message}"
        );
    }

    #[test]
    fn full_mapping_produces_valid_grammar() {
        let source = "# 标题\n\n段落 **粗** *斜* ~~删~~ <u>下划</u> [链](https://e.com) `码`\n\n3. 三\n4. 四\n\n> 引用\n\n```\n代码\n```";
        let parsed = parse(source);
        let value = super::super::document_import::doc_value_from_blocks(parsed.blocks.clone());
        super::super::validate_notebook_document(&value)
            .expect("md 映射产物必须通过既有严格语法校验");
    }

    // LossCounter 无公开字段遍历，测试内用 kinds 探针核对「无损耗」断言。
    impl LossCounter {
        #[cfg(test)]
        fn loss_kinds_for_test(&self) -> Vec<String> {
            let mut kinds = Vec::new();
            let fields: [(&str, usize); 13] = [
                ("table_flattened", self.tables),
                ("image_dropped", self.images),
                ("footnote_dropped", self.footnotes),
                ("comment_dropped", self.comments),
                ("revision_finalized", self.revisions),
                ("numbering_degraded", self.numbering_degraded),
                ("code_degraded", self.code_inline + self.code_blocks),
                ("quote_degraded", self.quotes),
                ("hr_dropped", self.hr),
                ("html_stripped", self.html_stripped),
                ("frontmatter_dropped", self.frontmatter),
                ("tasklist_degraded", self.tasklists),
                ("block_skipped", self.block_skipped),
            ];
            for (kind, count) in fields {
                if count > 0 {
                    kinds.push(kind.to_string());
                }
            }
            kinds
        }
    }
}
