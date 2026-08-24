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
//! 可见的项目符号 / 编号前缀输出（docx 依赖不提供 numbering.xml 定义，采用
//! 不损失可见文字与块顺序的降级策略，见 design.md 风险与取舍）。

use std::io::Cursor;

use docx::document::{Paragraph, Run, TextSpace};
use docx::formatting::{CharacterProperty, ParagraphProperty, Underline};
use docx::styles::{DefaultStyle, Style, StyleType, Styles};
use docx::Docx;

use super::export::{ExportBlock, ExportListItem, ExportMark, ExportNode, ExportProject, ExportText};
use super::ProjectError;

/// 把导出序列渲染为 `.docx` 字节。
pub fn render_docx(project: &ExportProject) -> Result<Vec<u8>, ProjectError> {
    let mut docx = Docx::default();

    // 定义 Heading1-6 段落样式，保证 Word 中标题层级可识别、可编辑。
    let mut styles = Styles::new();
    styles.default(DefaultStyle::default());
    for (level, size) in [(1u8, 32usize), (2, 28), (3, 24), (4, 20), (5, 18), (6, 16)] {
        let style = Style::new(StyleType::Paragraph, format!("Heading{level}"))
            .name(format!("heading {level}"))
            .paragraph(ParagraphProperty::default())
            .character(CharacterProperty::default().bold(true).size(size * 2));
        styles.push(style);
    }
    docx.styles = styles;

    // 作品名称作为最高层级标题。
    docx.document.push(
        Paragraph::default()
            .property(ParagraphProperty::default().style_id("Heading1"))
            .push_text(project.project_name.clone()),
    );

    for node in &project.children {
        render_node(&mut docx, node);
    }

    let cursor = docx
        .write(Cursor::new(Vec::new()))
        .map_err(|e| ProjectError::WriteError(format!("DOCX 生成失败: {e:?}")))?;
    Ok(cursor.into_inner())
}

fn render_node(docx: &mut Docx, node: &ExportNode) {
    match node {
        ExportNode::Folder { name, children } => {
            docx.document.push(
                Paragraph::default()
                    .property(ParagraphProperty::default().style_id("Heading2"))
                    .push_text(name.clone()),
            );
            for child in children {
                render_node(docx, child);
            }
        }
        ExportNode::Document { name, blocks } => {
            docx.document.push(
                Paragraph::default()
                    .property(ParagraphProperty::default().style_id("Heading3"))
                    .push_text(name.clone()),
            );
            for block in blocks {
                render_block(docx, block);
            }
        }
    }
}

fn render_block(docx: &mut Docx, block: &ExportBlock) {
    match block {
        ExportBlock::Paragraph(content) => {
            docx.document.push(render_paragraph(content, None));
        }
        ExportBlock::Heading { level, content } => {
            let style = format!("Heading{level}");
            docx.document.push(render_paragraph(content, Some(&style)));
        }
        ExportBlock::BulletList(items) => {
            for item in items {
                render_list_item(docx, item, "• ", 0);
            }
        }
        ExportBlock::OrderedList { start, items } => {
            for (index, item) in items.iter().enumerate() {
                let number = start + index as u64;
                render_list_item(docx, item, &format!("{number}. "), 0);
            }
        }
    }
}

fn render_paragraph(content: &[ExportText], style: Option<&str>) -> Paragraph<'static> {
    let mut para = match style {
        Some(style_id) => Paragraph::default()
            .property(ParagraphProperty::default().style_id(style_id.to_string())),
        None => Paragraph::default(),
    };
    for text in content {
        para = para.push(run_for_text(text));
    }
    para
}

fn render_list_item(docx: &mut Docx, item: &ExportListItem, marker: &str, depth: usize) {
    let mut para = Paragraph::default();
    para = para.push_text(marker.to_string());
    for text in &item.content {
        para = para.push(run_for_text(text));
    }
    docx.document.push(para);

    if let Some(nested) = &item.nested {
        let indent = "  ".repeat(depth + 1);
        match nested.as_ref() {
            ExportBlock::BulletList(items) => {
                for nested_item in items {
                    render_list_item(docx, nested_item, &format!("{indent}• "), depth + 1);
                }
            }
            ExportBlock::OrderedList { start, items } => {
                for (index, nested_item) in items.iter().enumerate() {
                    let number = start + index as u64;
                    render_list_item(docx, nested_item, &format!("{indent}{number}. "), depth + 1);
                }
            }
            _ => {}
        }
    }
}

fn run_for_text(text: &ExportText) -> Run<'static> {
    let mut property = CharacterProperty::default();
    for mark in &text.marks {
        match mark {
            ExportMark::Bold => property = property.bold(true),
            ExportMark::Italic => property = property.italics(true),
            ExportMark::Underline => property = property.underline(Underline::default()),
            ExportMark::Strike => property = property.strike(true),
            ExportMark::Color(color) => {
                let hex = color.strip_prefix('#').unwrap_or(color);
                property = property.color(hex.to_string());
            }
        }
    }
    Run::default()
        .property(property)
        .push_text((text.text.clone(), TextSpace::Preserve))
}