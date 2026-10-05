//! 作品导出：把内容树解析为稳定的导出序列，并驱动三种格式（Word / Markdown / PDF）。
//!
//! 分层：
//! - 本模块负责「内容树 → 导出序列」：按 [`ExportScope`]（文档 / 文件夹子树 / 整个作品，
//!   design.md 决策 1）过滤后，按 `root_children` 及各文件夹 `children` 顺序递归遍历
//!   活动内容树，跳过回收站；每篇文档读取其已保存的 Tiptap JSON，解析为结构化正文块。
//!   此层不依赖任何具体格式渲染器，由 [`super::docx_export`]（Word）、
//!   [`super::markdown_export`]（Markdown）与打印窗口前端（PDF）共同复用。
//! - 导出编排（读作品 → 投影 → 渲染 → 原子写）由 [`export_project_to_word`] /
//!   [`export_project_to_markdown`] 提供；PDF 的编排入口见 `crate::pdf_print`。
//!
//! 层级标题映射以范围根为基准（design.md 决策 1）：
//! - `Work`：范围根（作品名）→ 一级；文件夹 → 二级；文档 → 三级；
//! - `Folder`：范围根（文件夹名）→ 一级；其直接子级 → 二级，逐层递进，封顶六级；
//! - `Document`：范围根（文档名）→ 一级；
//! - 文档内部标题始终按自身层级（1–6）输出，不随范围平移。
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

/// 导出范围：三种粒度（design.md 决策 1，三种格式共用）。
/// 序列化为前端可构造的对象：`{ "type": "work" }` / `{ "type": "document", "id": "…" }` /
/// `{ "type": "folder", "id": "…" }`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "id", rename_all = "camelCase")]
pub enum ExportScope {
    /// 整个作品（全树，与旧「整作品导出」行为等价）。
    Work,
    /// 单篇文档。
    Document(String),
    /// 文件夹子树（含嵌套子文件夹）。
    Folder(String),
}

/// 段落对齐（编辑器 `textAlign` attrs 的投影；行距 / 段距本轮不消费，维持现状）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportAlign {
    Left,
    Center,
    Right,
    Justify,
}

/// 可映射的文字标记。无法直接表达的展示属性（高亮、字体等）在解析时降级为纯文字，
/// 不丢失可见字符；链接标记由需要链接的渲染器（Markdown / PDF）消费，Word 渲染器
/// 沿用既有降级策略（纯文字），保持既有输出不变。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ExportMark {
    Bold,
    Italic,
    Underline,
    Strike,
    /// 文字颜色（`#rrggbb`）。
    Color(String),
    /// 链接（`href`）。
    Link(String),
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
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExportBlock {
    Paragraph {
        align: Option<ExportAlign>,
        content: Vec<ExportText>,
    },
    Heading {
        level: u8,
        align: Option<ExportAlign>,
        content: Vec<ExportText>,
    },
    BulletList {
        items: Vec<ExportListItem>,
    },
    OrderedList {
        start: u64,
        /// 编号样式（`"A"`/`"a"`/`"I"`/`"i"`；None 或 `"1"` 为缺省十进制）。
        #[serde(rename = "listType")]
        list_type: Option<String>,
        items: Vec<ExportListItem>,
    },
}

/// 导出序列中的节点：文件夹只承载层级与顺序，文档承载标题与正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExportNode {
    Folder {
        name: String,
        children: Vec<ExportNode>,
    },
    Document {
        name: String,
        blocks: Vec<ExportBlock>,
    },
}

/// 导出序列：范围根名称（作品名 / 文件夹名 / 文档名，按 [`ExportScope`] 取）+ 范围 +
/// 按内容树顺序排列的节点。默认文件名按 `root_name` 生成（前端建议，可修改）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportProject {
    pub scope: ExportScope,
    pub root_name: String,
    pub children: Vec<ExportNode>,
}

/// 导出命令的稳定返回结果（三种格式共用）。命令始终成功返回该结构，前端据此区分
/// 成功 / 失败，不依赖 Tauri 错误序列化细节。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportFileResult {
    pub ok: bool,
    pub path: Option<String>,
    pub message: Option<String>,
}

/// 旧名别名：Word 导出既有契约名称沿用，避免调用方无谓改名。
pub type ExportWordResult = ExportFileResult;

impl ExportFileResult {
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

/// 把内容树解析为导出序列。`work_name` 仅在 `Work` 范围用作根名称（作品名）；
/// `read_document` 按文档 ID 读取并解析其已保存正文。范围指向的节点不存在或类型
/// 不符时返回中文错误；回收站节点不在活动树中，天然不会出现。
pub fn build_export_project(
    tree: &ContentTree,
    work_name: &str,
    scope: &ExportScope,
    read_document: impl Fn(&str) -> Result<Vec<ExportBlock>, ProjectError>,
) -> Result<ExportProject, ProjectError> {
    match scope {
        ExportScope::Work => {
            let mut children = Vec::new();
            for id in &tree.root_children {
                children.push(build_node(tree, id, &read_document)?);
            }
            Ok(ExportProject {
                scope: scope.clone(),
                root_name: work_name.to_string(),
                children,
            })
        }
        ExportScope::Folder(folder_id) => {
            let node = tree.nodes.get(folder_id).ok_or_else(|| {
                ProjectError::InvalidStructure("导出范围指定的文件夹不存在".to_string())
            })?;
            if node.kind != NodeKind::Folder {
                return Err(ProjectError::InvalidStructure(
                    "导出范围指定的节点不是文件夹".to_string(),
                ));
            }
            let mut children = Vec::new();
            for child_id in &node.children {
                children.push(build_node(tree, child_id, &read_document)?);
            }
            Ok(ExportProject {
                scope: scope.clone(),
                root_name: node.name.clone(),
                children,
            })
        }
        ExportScope::Document(document_id) => {
            let node = tree.nodes.get(document_id).ok_or_else(|| {
                ProjectError::InvalidStructure("导出范围指定的文档不存在".to_string())
            })?;
            if node.kind != NodeKind::Document {
                return Err(ProjectError::InvalidStructure(
                    "导出范围指定的节点不是文档".to_string(),
                ));
            }
            let blocks = read_document(document_id)?;
            Ok(ExportProject {
                scope: scope.clone(),
                root_name: node.name.clone(),
                children: vec![ExportNode::Document {
                    name: node.name.clone(),
                    blocks,
                }],
            })
        }
    }
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

/// 只读地装载指定范围的导出序列：先恢复中断事务保证读到一致世代，再读内容树与
/// 作品元信息，最后按范围投影。三种格式的导出命令共用此入口。
pub(crate) fn load_scoped_export_project(
    project_root: &Path,
    scope: &ExportScope,
) -> Result<ExportProject, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    // 导出只读取已保存内容：先恢复中断事务，保证读到一致世代。
    recover_interrupted_save(&paths)?;

    let tree = read_content_tree(&paths)?;

    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::ReadError(format!("作品元信息无法解析: {e}")))?;

    build_export_project(&tree, &metadata.name, scope, |id| {
        let json = read_and_validate_notebook(&paths.document_file(id), "文档")?;
        parse_document_blocks(&json)
    })
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

/// 读取块 / 段落级 `attrs.textAlign`（编辑器对齐属性，本轮新消费；其余段落属性
/// 行距 / 段距 / 缩进维持现状不消费）。非法值按未设置处理。
fn parse_align(node: &Value) -> Option<ExportAlign> {
    let align = node
        .get("attrs")
        .and_then(|v| v.get("textAlign"))
        .and_then(|v| v.as_str())?;
    match align {
        "left" => Some(ExportAlign::Left),
        "center" => Some(ExportAlign::Center),
        "right" => Some(ExportAlign::Right),
        "justify" => Some(ExportAlign::Justify),
        _ => None,
    }
}

fn parse_block(node: &Value) -> Option<ExportBlock> {
    let ty = node.get("type").and_then(|v| v.as_str())?;
    match ty {
        "paragraph" => Some(ExportBlock::Paragraph {
            align: parse_align(node),
            content: parse_inline(node.get("content")),
        }),
        "heading" => {
            let level = node
                .get("attrs")
                .and_then(|v| v.get("level"))
                .and_then(|v| v.as_u64())
                .unwrap_or(1);
            let level = level.clamp(1, 6) as u8;
            Some(ExportBlock::Heading {
                level,
                align: parse_align(node),
                content: parse_inline(node.get("content")),
            })
        }
        "bulletList" => Some(ExportBlock::BulletList {
            items: parse_list_items(node.get("content")),
        }),
        "orderedList" => {
            let attrs = node.get("attrs");
            let start = attrs
                .and_then(|v| v.get("start"))
                .and_then(|v| v.as_u64())
                .unwrap_or(1);
            // 编号样式透传：五值域中非十进制四值保留（"1"/缺省/非法 → None）。
            let list_type = attrs
                .and_then(|v| v.get("type"))
                .and_then(|v| v.as_str())
                .filter(|style| matches!(*style, "A" | "a" | "I" | "i"))
                .map(str::to_string);
            Some(ExportBlock::OrderedList {
                start,
                list_type,
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
            Some("link") => {
                if let Some(href) = mark
                    .get("attrs")
                    .and_then(|v| v.get("href"))
                    .and_then(|v| v.as_str())
                {
                    out.push(ExportMark::Link(href.to_string()));
                }
            }
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
            // highlight 等降级为纯文字，不丢失可见字符。
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

/// 按所选范围导出当前作品为 `.docx` 文件：只读取已保存内容，生成到临时文件后原子
/// 写入目标路径，失败时清理临时文件，不留下被当作成功导出的不完整文件。
pub fn export_project_to_word(
    project_root: &Path,
    scope: &ExportScope,
    target_path: &Path,
) -> Result<ExportFileResult, ProjectError> {
    let export_project = load_scoped_export_project(project_root, scope)?;
    let bytes = super::docx_export::render_docx(&export_project)?;
    write_bytes_atomically(target_path, &bytes)?;
    Ok(ExportFileResult::success(
        target_path.to_string_lossy().to_string(),
    ))
}

/// 按所选范围导出当前作品为 UTF-8 编码的 `.md` 文件：只读取已保存内容，
/// 渲染与原子写边界与 Word 导出一致。文档含字母/罗马编号的有序列表时，
/// Markdown 规范只支持数字标记，导出按数字降级并在结果 message 如实告知。
pub fn export_project_to_markdown(
    project_root: &Path,
    scope: &ExportScope,
    target_path: &Path,
) -> Result<ExportFileResult, ProjectError> {
    let export_project = load_scoped_export_project(project_root, scope)?;
    let markdown = super::markdown_export::render_markdown(&export_project);
    write_bytes_atomically(target_path, markdown.as_bytes())?;
    let message = if super::markdown_export::has_styled_ordered_lists(&export_project) {
        Some(
            "Markdown 规范只支持数字列表标记，字母或罗马编号的有序列表已降级为数字（缩进保持层级）"
                .to_string(),
        )
    } else {
        None
    };
    Ok(ExportFileResult {
        ok: true,
        path: Some(target_path.to_string_lossy().to_string()),
        message,
    })
}

/// 把字节先写入目标目录下的临时文件，成功后再原子重命名到目标路径；
/// 任何失败都清理临时文件，避免留下不完整导出文件。
pub(crate) fn write_bytes_atomically(target_path: &Path, bytes: &[u8]) -> Result<(), ProjectError> {
    let parent = target_path
        .parent()
        .ok_or_else(|| ProjectError::WriteError("目标文件缺少父目录".to_string()))?;

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
