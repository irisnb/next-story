//! DOCX 渲染层：把导出序列（[`super::export::ExportProject`]）转换为真正的
//! Office Open XML `.docx` 字节（见 design.md 决策 1、2）。
//!
//! 标题层级映射（design.md 决策 3）：
//! - 作品名称 → Heading1（最高层级）；
//! - 文件夹名称 → Heading2；
//! - 文档名称 → Heading3；
//! - 文档正文内的编辑器标题等级 N → Heading{N}。
//!
//! 段落、粗体、斜体、下划线、删除线与文字颜色映射为对应 Word 格式；列表以
//! 可见的项目符号 / 编号前缀输出（docx-rs 不经 numbering 定义输出列表，采用
//! 不损失可见文字与块顺序的降级策略，见 design.md 风险与取舍）。

use std::io::Cursor;

use docx_rs::{Docx, Paragraph, Run, Style, StyleType};

use super::export::{
    ExportBlock, ExportListItem, ExportMark, ExportNode, ExportProject, ExportText,
};
use super::ProjectError;

/// 把导出序列渲染为 `.docx` 字节。
pub fn render_docx(project: &ExportProject) -> Result<Vec<u8>, ProjectError> {
    let mut docx = Docx::new();

    // 定义 Heading1-6 段落样式，保证 Word 中标题层级可识别、可编辑。
    // size 直收半点值：Heading1-6 依次 64/56/48/40/36/32（即 32/28/24/20/18/16 磅）。
    for (level, half_points) in [(1u8, 64usize), (2, 56), (3, 48), (4, 40), (5, 36), (6, 32)] {
        let style = Style::new(format!("Heading{level}"), StyleType::Paragraph)
            .name(format!("heading {level}"))
            .size(half_points)
            .bold();
        docx = docx.add_style(style);
    }

    // 作品名称作为最高层级标题。
    docx = docx.add_paragraph(
        Paragraph::new()
            .style("Heading1")
            .add_run(Run::new().add_text(project.project_name.clone())),
    );

    for node in &project.children {
        docx = render_node(docx, node);
    }

    let mut cursor = Cursor::new(Vec::new());
    docx.build()
        .pack(&mut cursor)
        .map_err(|e| ProjectError::WriteError(format!("DOCX 生成失败: {e:?}")))?;
    Ok(cursor.into_inner())
}

// docx-rs 的构建方法（add_style / add_paragraph）按值消费并返回 Docx（builder 链式），
// 因此以下渲染函数统一采用「消费并返回 Docx」的函数式传递，不借用、不克隆。
fn render_node(docx: Docx, node: &ExportNode) -> Docx {
    match node {
        ExportNode::Folder { name, children } => {
            let docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading2")
                    .add_run(Run::new().add_text(name.clone())),
            );
            let mut docx = docx;
            for child in children {
                docx = render_node(docx, child);
            }
            docx
        }
        ExportNode::Document { name, blocks } => {
            let docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading3")
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
        ExportBlock::Paragraph(content) => {
            docx.add_paragraph(render_paragraph(content, None))
        }
        ExportBlock::Heading { level, content } => {
            let style = format!("Heading{level}");
            docx.add_paragraph(render_paragraph(content, Some(&style)))
        }
        ExportBlock::BulletList(items) => {
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

fn render_paragraph(content: &[ExportText], style: Option<&str>) -> Paragraph {
    let mut para = match style {
        Some(style_id) => Paragraph::new().style(style_id),
        None => Paragraph::new(),
    };
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
            ExportBlock::BulletList(items) => {
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
        }
    }
    run.add_text(text.text.clone())
}
