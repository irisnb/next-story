//! Markdown 渲染层：把导出序列（[`super::export::ExportProject`]）序列化为单个
//! UTF-8 编码的 CommonMark 文本（design.md 决策 6）。
//!
//! 映射表：
//! - 层级：范围根 → 一级标题；`Work` 范围内文件夹二级 / 文档三级（扁平，与 Word
//!   旧行为对齐）；`Folder` 范围内子节点按嵌套深度逐层递进（直接子级二级），
//!   封顶六级；`Document` 范围根即文档名，正文直接跟随；文档内部标题按自身层级。
//! - 列表：无序 `- `、有序从其 `start` 起始编号；嵌套列表按 4 空格缩进逐层递进。
//!   字母/罗马编号样式无法用 Markdown 表达（规范只支持数字标记），降级为数字
//!   并由导出命令在结果 message 如实告知（add-list-numbering-formats D6）。
//! - 行内：粗体 `**`、斜体 `*`、删除线 `~~`、下划线 `<u>`、链接 `[文字](地址)`；
//!   文字颜色、fontFamily、fontSize、highlight 降级为纯文字，不丢字符。
//! - 转义：正文中会被 CommonMark 解释为格式的 ASCII 标点以反斜杠转义，保证渲染后
//!   与原文字面一致；全角字符（`＊`、`＃` 等）不属于 ASCII 标点，不误伤。

use std::fmt::Write as _;

use super::export::{
    ExportBlock, ExportListItem, ExportMark, ExportNode, ExportProject, ExportScope, ExportText,
};

/// 嵌套列表每层缩进的空格数（4 ≥ 无序 `- ` 与有序 `N. ` 的内容列宽，两种标记下
/// 都满足 CommonMark 子列表缩进要求）。
const LIST_INDENT_SPACES: usize = 4;

/// 把导出序列渲染为 Markdown 文本（始终以 `\n` 结尾的 UTF-8 字符串）。
pub fn render_markdown(project: &ExportProject) -> String {
    let mut blocks_out: Vec<String> = Vec::new();
    blocks_out.push(heading_line(1, &project.root_name));

    match &project.scope {
        // 文档范围：根标题即文档名，正文直接跟随，不重复输出文档名标题。
        ExportScope::Document(_) => {
            if let Some(ExportNode::Document { blocks, .. }) = project.children.first() {
                push_blocks(&mut blocks_out, blocks);
            }
        }
        // 作品 / 文件夹范围：按各自映射输出子树。
        _ => {
            for node in &project.children {
                push_node(&mut blocks_out, node, &project.scope, 0);
            }
        }
    }

    let mut out = blocks_out.join("\n\n");
    out.push('\n');
    out
}

/// 子树节点的标题层级：`Work` 扁平映射（文件夹二级 / 文档三级）；
/// `Folder` 按嵌套深度递进（直接子级二级），封顶六级。
fn node_heading_level(scope: &ExportScope, depth: usize, is_folder: bool) -> usize {
    match scope {
        ExportScope::Work => {
            if is_folder {
                2
            } else {
                3
            }
        }
        _ => (depth + 2).min(6),
    }
}

fn push_node(out: &mut Vec<String>, node: &ExportNode, scope: &ExportScope, depth: usize) {
    match node {
        ExportNode::Folder { name, children } => {
            out.push(heading_line(node_heading_level(scope, depth, true), name));
            for child in children {
                push_node(out, child, scope, depth + 1);
            }
        }
        ExportNode::Document { name, blocks } => {
            out.push(heading_line(node_heading_level(scope, depth, false), name));
            push_blocks(out, blocks);
        }
    }
}

fn push_blocks(out: &mut Vec<String>, blocks: &[ExportBlock]) {
    for block in blocks {
        push_block(out, block);
    }
}

fn push_block(out: &mut Vec<String>, block: &ExportBlock) {
    match block {
        ExportBlock::Paragraph { content, .. } => {
            let line = render_inline(content);
            // 空段落输出占位空行内容，保证块边界（可见字符数为零，不丢不添）。
            out.push(if line.is_empty() { String::new() } else { line });
        }
        ExportBlock::Heading { level, content, .. } => {
            out.push(heading_line(*level as usize, &render_inline_plain(content)));
        }
        ExportBlock::BulletList { items } => {
            let mut lines = Vec::new();
            for item in items {
                push_list_item(&mut lines, item, None, 0);
            }
            out.push(lines.join("\n"));
        }
        ExportBlock::OrderedList { start, items, .. } => {
            let mut lines = Vec::new();
            for (index, item) in items.iter().enumerate() {
                push_list_item(&mut lines, item, Some(start + index as u64), 0);
            }
            out.push(lines.join("\n"));
        }
    }
}

/// 一个列表项：本行 `缩进 + 标记 + 行内`，嵌套列表随后以更深缩进逐行输出。
fn push_list_item(
    lines: &mut Vec<String>,
    item: &ExportListItem,
    number: Option<u64>,
    depth: usize,
) {
    let indent = " ".repeat(LIST_INDENT_SPACES * depth);
    let marker = match number {
        Some(n) => format!("{n}. "),
        None => "- ".to_string(),
    };
    lines.push(format!("{indent}{marker}{}", render_inline(&item.content)));

    if let Some(nested) = &item.nested {
        match nested.as_ref() {
            ExportBlock::BulletList { items } => {
                for nested_item in items {
                    push_list_item(lines, nested_item, None, depth + 1);
                }
            }
            ExportBlock::OrderedList { start, items, .. } => {
                for (index, nested_item) in items.iter().enumerate() {
                    push_list_item(lines, nested_item, Some(start + index as u64), depth + 1);
                }
            }
            _ => {}
        }
    }
}

/// 导出序列是否含字母/罗马编号的有序列表（顶层或嵌套；`"1"` 缺省不算）。
/// 供导出命令生成 Markdown 降级告知（add-list-numbering-formats D6）。
pub fn has_styled_ordered_lists(project: &ExportProject) -> bool {
    fn node_has(node: &ExportNode) -> bool {
        match node {
            ExportNode::Document { blocks, .. } => blocks.iter().any(block_has),
            ExportNode::Folder { children, .. } => children.iter().any(node_has),
        }
    }
    fn block_has(block: &ExportBlock) -> bool {
        match block {
            ExportBlock::OrderedList {
                list_type, items, ..
            } => {
                if list_type
                    .as_deref()
                    .is_some_and(|style| matches!(style, "A" | "a" | "I" | "i"))
                {
                    return true;
                }
                items
                    .iter()
                    .filter_map(|item| item.nested.as_deref())
                    .any(block_has)
            }
            ExportBlock::BulletList { items } => items
                .iter()
                .filter_map(|item| item.nested.as_deref())
                .any(block_has),
            _ => false,
        }
    }
    project.children.iter().any(node_has)
}

fn heading_line(level: usize, text: &str) -> String {
    format!(
        "{} {}",
        "#".repeat(level.clamp(1, 6)),
        escape_markdown_text(text)
    )
}

/// 标题正文：行内标记在标题内渲染后仍是合法 Markdown（如 `**粗体**` 生效），
/// 这里按行内规则渲染，再做标题语境的字符转义。
fn render_inline_plain(content: &[ExportText]) -> String {
    render_inline(content)
}

/// 行内序列化：按标记顺序包裹格式，链接最后包在最外层。
fn render_inline(texts: &[ExportText]) -> String {
    let mut out = String::new();
    for text in texts {
        if text.text.is_empty() {
            continue;
        }
        let mut body = escape_markdown_text(&text.text);
        let mut link: Option<&str> = None;
        for mark in &text.marks {
            match mark {
                ExportMark::Bold => body = format!("**{body}**"),
                ExportMark::Italic => body = format!("*{body}*"),
                ExportMark::Strike => body = format!("~~{body}~~"),
                ExportMark::Underline => body = format!("<u>{body}</u>"),
                // color / fontFamily / fontSize / highlight 降级为纯文字。
                ExportMark::Color(_) => {}
                ExportMark::Link(href) => link = Some(href),
            }
        }
        match link {
            Some(href) => {
                let _ = write!(out, "[{body}]({})", format_link_destination(href));
            }
            None => out.push_str(&body),
        }
    }
    out
}

/// 链接目标：常规地址直接输出；含空格 / 括号 / 尖括号的地址用尖括号形式包裹，
/// 内部反斜杠与尖括号转义，保证 CommonMark 解析为同一地址。
fn format_link_destination(href: &str) -> String {
    let needs_angle = href
        .chars()
        .any(|c| matches!(c, ' ' | '(' | ')' | '<' | '>'));
    if !needs_angle {
        return href.to_string();
    }
    let mut escaped = String::with_capacity(href.len() + 2);
    escaped.push('<');
    for ch in href.chars() {
        if matches!(ch, '\\' | '<' | '>') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped.push('>');
    escaped
}

/// 转义正文中会被 CommonMark 解释为格式的 ASCII 标点（反斜杠转义仅对 ASCII 标点
/// 合法）。全角字符（`＊`、`＃`、`（` 等）是不同码位，原样通过，不误伤。
fn escape_markdown_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(
            ch,
            '\\' | '`'
                | '*'
                | '_'
                | '{'
                | '}'
                | '['
                | ']'
                | '('
                | ')'
                | '#'
                | '+'
                | '-'
                | '.'
                | '!'
                | '|'
                | '<'
                | '>'
                | '&'
                | '~'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}
