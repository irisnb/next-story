//! DOCX 渲染层：把导出序列（[`super::export::ExportProject`]）转换为真正的
//! Office Open XML `.docx` 字节。
//!
//! 标题层级映射以范围根为基准（design.md 决策 1）：
//! - `Work`：作品名 → Heading1；文件夹名 → Heading2；文档名 → Heading3
//!   （沿用旧「整作品」行为的扁平映射，嵌套不加深）；
//! - `Folder`：文件夹名 → Heading1；子节点按嵌套深度逐层递进（直接子级 Heading2），
//!   封顶 Heading6；
//! - `Document`：文档名 → Heading1（唯一子文档不再重复输出文档名标题）；
//! - 文档正文内的编辑器标题等级 N → Heading{N}。
//!
//! 样式保真（design.md 决策 5，与编辑器呈现对齐）：
//! - 正文字号 12pt（编辑器 16px 的同值换算）、字体「Source Han Sans CN」
//!   （与捆绑字体同族；未安装该字体的机器打开时回退系统字体，内容与颜色不受影响）；
//! - Heading1–6 字号按编辑器 CSS 值对齐（浏览器默认标题刻度 × 16px 正文）：
//!   24/18/14/12/10/8 磅；
//! - 文字颜色沿用；段落对齐消费编辑器 `textAlign`；行距 / 段距本轮不消费。
//!
//! 段落、粗体、斜体、下划线、删除线与文字颜色映射为对应 Word 格式；链接沿既有
//! 降级策略输出纯文字（Word 导出内容保真骨架不动）。列表以可见的项目符号 / 编号
//! 前缀输出（docx-rs 不经 numbering 定义输出列表，采用不损失可见文字与块顺序的
//! 降级策略，见 design.md 风险与取舍）。

use std::io::Cursor;

use docx_rs::{AlignmentType, Docx, Paragraph, Run, RunFonts, Style, StyleType};

use super::export::{
    ExportAlign, ExportBlock, ExportListItem, ExportMark, ExportNode, ExportProject, ExportText,
};
use super::ProjectError;

/// 导出正文字体（与捆绑的思源黑体同族；见 design.md 决策 4）。
const EXPORT_FONT_FAMILY: &str = "Source Han Sans CN";

/// 正文字号（半点）：12pt，对应编辑器 16px 的同值换算。
const BODY_SIZE_HALF_POINTS: usize = 24;

/// Heading1–6 字号（半点）：24/18/14/12/10/8 磅，对齐编辑器 CSS 的浏览器默认
/// 标题刻度（h1 2em / h2 1.5em / h3 1.17em / h4 1em / h5 0.83em / h6 0.67em × 16px）。
const HEADING_SIZES_HALF_POINTS: [(u8, usize); 6] =
    [(1, 48), (2, 36), (3, 28), (4, 24), (5, 20), (6, 16)];

/// 全字体槽统一使用导出字体（ASCII / 高 ANSI / 东亚 / 复杂文种），避免中英文
/// 混排时 Word 按槽位拆分回退到不同字体。
fn export_run_fonts() -> RunFonts {
    RunFonts::new()
        .ascii(EXPORT_FONT_FAMILY)
        .hi_ansi(EXPORT_FONT_FAMILY)
        .east_asia(EXPORT_FONT_FAMILY)
        .cs(EXPORT_FONT_FAMILY)
}

fn alignment_type(align: ExportAlign) -> AlignmentType {
    match align {
        ExportAlign::Left => AlignmentType::Left,
        ExportAlign::Center => AlignmentType::Center,
        ExportAlign::Right => AlignmentType::Right,
        // OOXML 的两端对齐 jc 值为 both。
        ExportAlign::Justify => AlignmentType::Both,
    }
}

/// 把导出序列渲染为 `.docx` 字节。
pub fn render_docx(project: &ExportProject) -> Result<Vec<u8>, ProjectError> {
    let mut docx = Docx::new()
        .default_size(BODY_SIZE_HALF_POINTS)
        .default_fonts(export_run_fonts());

    // 定义 Heading1-6 段落样式，保证 Word 中标题层级可识别、可编辑。
    for (level, half_points) in HEADING_SIZES_HALF_POINTS {
        let style = Style::new(format!("Heading{level}"), StyleType::Paragraph)
            .name(format!("heading {level}"))
            .size(half_points)
            .bold()
            .fonts(export_run_fonts());
        docx = docx.add_style(style);
    }

    // 范围根名称作为最高层级标题（作品 / 文件夹 / 文档名 → Heading1）。
    docx = docx.add_paragraph(
        Paragraph::new()
            .style("Heading1")
            .add_run(Run::new().add_text(project.root_name.clone())),
    );

    match &project.scope {
        // 文档范围：根标题即文档名，正文直接跟随，不再重复输出文档名标题。
        super::export::ExportScope::Document(_) => {
            let Some(ExportNode::Document { blocks, .. }) = project.children.first() else {
                return Err(ProjectError::InvalidStructure(
                    "文档范围的导出序列应恰好包含一篇文档".to_string(),
                ));
            };
            for block in blocks {
                docx = render_block(docx, block);
            }
        }
        // 作品 / 文件夹范围：按各自映射输出子树。
        _ => {
            for node in &project.children {
                docx = render_node(docx, node, &project.scope, 0);
            }
        }
    }

    let mut cursor = Cursor::new(Vec::new());
    docx.build()
        .pack(&mut cursor)
        .map_err(|e| ProjectError::WriteError(format!("DOCX 生成失败: {e:?}")))?;
    Ok(cursor.into_inner())
}

/// 子树节点的标题层级（design.md 决策 1）：
/// - `Work`：文件夹恒 Heading2、文档恒 Heading3（旧扁平映射）；
/// - `Folder`：直接子级 Heading2，逐层递进，封顶 6。
fn node_heading_level(scope: &super::export::ExportScope, depth: usize) -> u8 {
    match scope {
        super::export::ExportScope::Work => 0, // 调用方按节点类型另行映射
        _ => (depth + 2).min(6) as u8,
    }
}

// docx-rs 的构建方法（add_style / add_paragraph）按值消费并返回 Docx（builder 链式），
// 因此以下渲染函数统一采用「消费并返回 Docx」的函数式传递，不借用、不克隆。
fn render_node(
    docx: Docx,
    node: &ExportNode,
    scope: &super::export::ExportScope,
    depth: usize,
) -> Docx {
    match node {
        ExportNode::Folder { name, children } => {
            let style = match scope {
                super::export::ExportScope::Work => "Heading2",
                _ => &format!("Heading{}", node_heading_level(scope, depth)),
            };
            let docx = docx.add_paragraph(
                Paragraph::new()
                    .style(style)
                    .add_run(Run::new().add_text(name.clone())),
            );
            let mut docx = docx;
            for child in children {
                docx = render_node(docx, child, scope, depth + 1);
            }
            docx
        }
        ExportNode::Document { name, blocks } => {
            let style = match scope {
                super::export::ExportScope::Work => "Heading3",
                _ => &format!("Heading{}", node_heading_level(scope, depth)),
            };
            let docx = docx.add_paragraph(
                Paragraph::new()
                    .style(style)
                    .add_run(Run::new().add_text(name.clone())),
            );
            let mut docx = docx;
            for block in blocks {
                docx = render_block(docx, block);
            }
            docx
        }
    }
}

fn render_block(docx: Docx, block: &ExportBlock) -> Docx {
    match block {
        ExportBlock::Paragraph { align, content } => {
            docx.add_paragraph(render_paragraph(content, None, align))
        }
        ExportBlock::Heading {
            level,
            align,
            content,
        } => {
            let style = format!("Heading{level}");
            docx.add_paragraph(render_paragraph(content, Some(&style), align))
        }
        ExportBlock::BulletList { items } => {
            let mut docx = docx;
            for item in items {
                docx = render_list_item(docx, item, "• ", 0);
            }
            docx
        }
        ExportBlock::OrderedList { start, items } => {
            let mut docx = docx;
            for (index, item) in items.iter().enumerate() {
                let number = start + index as u64;
                docx = render_list_item(docx, item, &format!("{number}. "), 0);
            }
            docx
        }
    }
}

fn render_paragraph(
    content: &[ExportText],
    style: Option<&str>,
    align: &Option<ExportAlign>,
) -> Paragraph {
    let mut para = match style {
        Some(style_id) => Paragraph::new().style(style_id),
        None => Paragraph::new(),
    };
    if let Some(align) = align {
        para = para.align(alignment_type(*align));
    }
    for text in content {
        para = para.add_run(run_for_text(text));
    }
    para
}

fn render_list_item(docx: Docx, item: &ExportListItem, marker: &str, depth: usize) -> Docx {
    let mut para = Paragraph::new().add_run(Run::new().add_text(marker.to_string()));
    for text in &item.content {
        para = para.add_run(run_for_text(text));
    }
    let docx = docx.add_paragraph(para);

    if let Some(nested) = &item.nested {
        let indent = "  ".repeat(depth + 1);
        let mut docx = docx;
        match nested.as_ref() {
            ExportBlock::BulletList { items } => {
                for nested_item in items {
                    docx = render_list_item(docx, nested_item, &format!("{indent}• "), depth + 1);
                }
            }
            ExportBlock::OrderedList { start, items } => {
                for (index, nested_item) in items.iter().enumerate() {
                    let number = start + index as u64;
                    docx = render_list_item(
                        docx,
                        nested_item,
                        &format!("{indent}{number}. "),
                        depth + 1,
                    );
                }
            }
            _ => {}
        }
        docx
    } else {
        docx
    }
}

fn run_for_text(text: &ExportText) -> Run {
    // Run 的格式方法全部链式消费并返回 Self：bold/italic/strike 无参数，
    // underline 收 "single" 字符串表示单下划线；add_text 自动保留空格
    // （xml:space="preserve"），连续空格与行首空格无需显式处理。
    // 链接标记沿用 Word 既有降级策略（纯文字），保持既有输出不变。
    let mut run = Run::new();
    for mark in &text.marks {
        match mark {
            ExportMark::Bold => run = run.bold(),
            ExportMark::Italic => run = run.italic(),
            ExportMark::Underline => run = run.underline("single"),
            ExportMark::Strike => run = run.strike(),
            ExportMark::Color(color) => {
                let hex = color.strip_prefix('#').unwrap_or(color);
                run = run.color(hex.to_string());
            }
            ExportMark::Link(_) => {}
        }
    }
    run.add_text(text.text.clone())
}
