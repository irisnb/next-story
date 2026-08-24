//! 作品导出：把内容树解析为稳定的导出序列，并生成真正的 `.docx` 文件。
//!
//! 分层（见 design.md 决策 2）：
//! - 本模块负责「内容树 → 导出序列」：按 `root_children` 及各文件夹 `children`
//!   顺序递归遍历活动内容树，跳过回收站；每篇文档读取其已保存的 Tiptap JSON，
//!   解析为结构化正文块。此层不依赖 DOCX 库，未来可复用给 PDF / Markdown 投影。
//! - [`super::docx_export`] 负责「导出序列 → Word 节点」的渲染。
//!
//! 导出只读取已保存内容，不修改作品文档、内容树或保存状态（见 design.md 决策 5）。

use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::operations::{
    read_and_validate_notebook, read_bounded_string, read_content_tree, recover_interrupted_save,
    MAX_METADATA_BYTES,
};
use super::{ContentTree, NodeKind, ProjectError, ProjectMetadata, ProjectPaths};

/// 可映射到 Word 的文字标记。无法直接表达的展示属性（高亮、链接、字体等）
/// 在解析时降级为纯文字，不丢失可见字符。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ExportMark {
    Bold,
    Italic,
    Underline,
    Strike,
    /// 文字颜色（`#rrggbb`）。
    Color(String),
}

/// 一段带标记的可见文字。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportText {
    pub text: String,
    pub marks: Vec<ExportMark>,
}

/// 列表项：一个段落正文 + 可选一个嵌套列表。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportListItem {
    pub content: Vec<ExportText>,
    pub nested: Option<Box<ExportBlock>>,
}

/// 结构化正文块。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ExportBlock {
    Paragraph(Vec<ExportText>),
    Heading { level: u8, content: Vec<ExportText> },
    BulletList(Vec<ExportListItem>),
    OrderedList { start: u64, items: Vec<ExportListItem> },
}

/// 导出序列中的节点：文件夹只承载层级与顺序，文档承载标题与正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ExportNode {
    Folder { name: String, children: Vec<ExportNode> },
    Document { name: String, blocks: Vec<ExportBlock> },
}

/// 整部作品的导出序列：作品标题 + 按内容树顺序排列的节点。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportProject {
    pub project_name: String,
    pub children: Vec<ExportNode>,
}

/// 导出命令的稳定返回结果。命令始终成功返回该结构，前端据此区分成功 / 失败，
/// 不依赖 Tauri 错误序列化细节。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportWordResult {
    pub ok: bool,
    pub path: Option<String>,
    pub message: Option<String>,
}

impl ExportWordResult {
    pub fn success(path: String) -> Self {
        Self {
            ok: true,
            path: Some(path),
            message: None,
        }
    }

    pub fn failure(message: String) -> Self {
        Self {
            ok: false,
            path: None,
            message: Some(message),
        }
    }
}

/// 把内容树解析为导出序列。`read_document` 按文档 ID 读取并解析其已保存正文。
pub fn build_export_project(
    tree: &ContentTree,
    project_name: &str,
    read_document: impl Fn(&str) -> Result<Vec<ExportBlock>, ProjectError>,
) -> Result<ExportProject, ProjectError> {
    let mut children = Vec::new();
    for id in &tree.root_children {
        children.push(build_node(tree, id, &read_document)?);
    }
    Ok(ExportProject {
        project_name: project_name.to_string(),
        children,
    })
}

fn build_node(
    tree: &ContentTree,
    id: &str,
    read_document: &impl Fn(&str) -> Result<Vec<ExportBlock>, ProjectError>,
) -> Result<ExportNode, ProjectError> {
    let node = tree
        .nodes
        .get(id)
        .ok_or_else(|| ProjectError::InvalidStructure(format!("内容树节点不存在: {id}")))?;
    match node.kind {
        NodeKind::Folder => {
            let mut children = Vec::new();
            for child_id in &node.children {
                children.push(build_node(tree, child_id, read_document)?);
            }
            Ok(ExportNode::Folder {
                name: node.name.clone(),
                children,
            })
        }
        NodeKind::Document => {
            let blocks = read_document(id)?;
            Ok(ExportNode::Document {
                name: node.name.clone(),
                blocks,
            })
        }
    }
}

/// 把已保存的 Tiptap 文档 JSON 解析为结构化正文块。文档在读取前已通过
/// `validate_notebook_document` 校验，此处仍做防御性解析，无法识别的块降级跳过。
fn parse_document_blocks(json: &str) -> Result<Vec<ExportBlock>, ProjectError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|e| ProjectError::InvalidStructure(format!("文档 JSON 无法解析: {e}")))?;
    let content = value
        .get("document")
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_array());
    let Some(content) = content else {
        return Ok(Vec::new());
    };
    let mut blocks = Vec::new();
    for node in content {
        if let Some(block) = parse_block(node) {
            blocks.push(block);
        }
    }
    Ok(blocks)
}

fn parse_block(node: &Value) -> Option<ExportBlock> {
    let ty = node.get("type").and_then(|v| v.as_str())?;
    match ty {
        "paragraph" => Some(ExportBlock::Paragraph(parse_inline(node.get("content")))),
        "heading" => {
            let level = node
                .get("attrs")
                .and_then(|v| v.get("level"))
                .and_then(|v| v.as_u64())
                .unwrap_or(1);
            let level = level.clamp(1, 6) as u8;
            Some(ExportBlock::Heading {
                level,
                content: parse_inline(node.get("content")),
            })
        }
        "bulletList" => Some(ExportBlock::BulletList(parse_list_items(node.get("content")))),
        "orderedList" => {
            let start = node
                .get("attrs")
                .and_then(|v| v.get("start"))
                .and_then(|v| v.as_u64())
                .unwrap_or(1);
            Some(ExportBlock::OrderedList {
                start,
                items: parse_list_items(node.get("content")),
            })
        }
        _ => None,
    }
}

fn parse_inline(content: Option<&Value>) -> Vec<ExportText> {
    let Some(arr) = content.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for node in arr {
        if node.get("type").and_then(|v| v.as_str()) != Some("text") {
            continue;
        }
        let text = node
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let marks = parse_marks(node.get("marks"));
        out.push(ExportText { text, marks });
    }
    out
}

fn parse_marks(marks: Option<&Value>) -> Vec<ExportMark> {
    let Some(arr) = marks.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for mark in arr {
        let ty = mark.get("type").and_then(|v| v.as_str());
        match ty {
            Some("bold") => out.push(ExportMark::Bold),
            Some("italic") => out.push(ExportMark::Italic),
            Some("underline") => out.push(ExportMark::Underline),
            Some("strike") => out.push(ExportMark::Strike),
            Some("textStyle") => {
                if let Some(color) = mark
                    .get("attrs")
                    .and_then(|v| v.get("color"))
                    .and_then(|v| v.as_str())
                {
                    out.push(ExportMark::Color(color.to_string()));
                }
                // fontFamily / fontSize 降级为纯文字。
            }
            // highlight / link 等降级为纯文字，不丢失可见字符。
            _ => {}
        }
    }
    out
}

fn parse_list_items(content: Option<&Value>) -> Vec<ExportListItem> {
    let Some(arr) = content.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter().filter_map(parse_list_item).collect()
}

fn parse_list_item(item: &Value) -> Option<ExportListItem> {
    let content = item.get("content").and_then(|v| v.as_array())?;
    let mut list_content = Vec::new();
    let mut nested = None;
    for child in content {
        let ty = child.get("type").and_then(|v| v.as_str());
        match ty {
            Some("paragraph") => list_content = parse_inline(child.get("content")),
            Some("bulletList") | Some("orderedList") => nested = parse_block(child).map(Box::new),
            _ => {}
        }
    }
    Some(ExportListItem {
        content: list_content,
        nested,
    })
}

/// 导出当前作品为 `.docx` 文件：只读取已保存内容，生成到临时文件后原子写入
/// 目标路径，失败时清理临时文件，不留下被当作成功导出的不完整文件。
pub fn export_project_to_word(
    project_root: &Path,
    target_path: &Path,
) -> Result<ExportWordResult, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    // 导出只读取已保存内容：先恢复中断事务，保证读到一致世代。
    recover_interrupted_save(&paths)?;

    let tree = read_content_tree(&paths)?;

    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::ReadError(format!("作品元信息无法解析: {e}")))?;

    let export_project = build_export_project(&tree, &metadata.name, |id| {
        let json = read_and_validate_notebook(&paths.document_file(id), "文档")?;
        parse_document_blocks(&json)
    })?;

    let bytes = super::docx_export::render_docx(&export_project)?;

    write_docx_atomically(target_path, &bytes)?;

    Ok(ExportWordResult::success(
        target_path.to_string_lossy().to_string(),
    ))
}

/// 把 DOCX 字节先写入目标目录下的临时文件，成功后再原子重命名到目标路径；
/// 任何失败都清理临时文件，避免留下不完整导出文件。
fn write_docx_atomically(target_path: &Path, bytes: &[u8]) -> Result<(), ProjectError> {
    let parent = target_path.parent().ok_or_else(|| {
        ProjectError::WriteError("目标文件缺少父目录".to_string())
    })?;

    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| ProjectError::WriteError(format!("无法创建临时文件: {e}")))?;

    temp_file
        .write_all(bytes)
        .map_err(|e| ProjectError::WriteError(format!("写入临时文件失败: {e}")))?;
    temp_file
        .flush()
        .map_err(|e| ProjectError::WriteError(format!("写入临时文件失败: {e}")))?;
    temp_file
        .as_file()
        .sync_all()
        .map_err(|e| ProjectError::WriteError(format!("写入临时文件失败: {e}")))?;

    // persist 失败时返回的 PersistError 持有临时文件，随错误析构自动清理。
    temp_file
        .persist(target_path)
        .map_err(|e| ProjectError::WriteError(format!("写入目标文件失败: {}", e.error)))?;

    Ok(())
}
