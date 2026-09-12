//! 受控只读作品材料边界（change: dsh-capability-integration-validation 任务 2.2–2.4）。
//!
//! AI 核心需要参考作品时，只能通过本模块的只读入口取得被允许的材料。
//! 边界逐项校验：作品身份、文档身份、可见性（隐藏 / 回收站拒绝）、文档类型、
//! 版本身份、范围与未保存快照身份；任何不匹配都返回结构化拒绝，绝不返回内容，
//! 也绝不向作品写入任何字节。
//!
//! 与 `read_document` 一样，本入口是自由函数：作品锁由命令层（`lib.rs`）负责，
//! 本模块只保证「只读」与「失败关闭」，不获取任何写入权限。

use serde::{Deserialize, Serialize};
use std::path::Path;

use super::{ContentTree, ContentTreeNode, NodeKind, ProjectError, ProjectPaths};

// ========== 身份与材料类型 ==========

/// 结构化只读作品材料：经能力边界校验后才返回给 AI 的受控材料。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryMaterial {
    /// 作品身份（与作品根规范化路径一致）。
    pub work_id: String,
    /// 文档节点稳定 ID。
    pub document_id: String,
    /// 文档名称（可见树中的名称）。
    pub document_name: String,
    /// 返回内容的范围身份（字节区间，左闭右开）。
    pub range: MaterialRange,
    /// 版本身份（内容派生，或来自合法快照）。
    pub version: String,
    /// 正文内容（受控只读，绝不写回）。
    pub content: String,
}

/// 范围身份：正文的字节偏移区间（左闭右开）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialRange {
    pub start: usize,
    pub end: usize,
}

/// 一次受控只读读取请求（来自桥接层 / Agent，必须经本边界校验）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadMaterialRequest {
    /// 请求声称的作品身份；与作品根规范化路径不一致即拒绝。
    pub work_id: String,
    /// 目标文档节点稳定 ID。
    pub document_id: String,
    /// 可选范围；`None` 表示整篇。
    pub range: Option<MaterialRange>,
    /// 期望版本身份；与返回版本不一致即拒绝（旧版本 / 不可用版本）。
    pub expected_version: Option<String>,
    /// 可选的前端未保存快照；身份与可见性校验通过时才生效。
    pub snapshot: Option<MaterialSnapshot>,
}

/// 未保存快照：前端显式提供的、携带自身身份的受控快照。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialSnapshot {
    pub work_id: String,
    pub document_id: String,
    /// 快照的版本身份（必须非空）。
    pub version: String,
    /// 快照正文（合法 Tiptap JSON 字符串）。
    pub content: String,
}

/// 结构化拒绝：任何原因都不返回内容。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialDenial {
    pub reason: MaterialDenialReason,
}

/// 拒绝原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaterialDenialReason {
    /// 作品身份不匹配或无法解析。
    WorkMismatch,
    /// 文档不存在。
    DocumentMissing,
    /// 文档不可见（隐藏 / 游离节点）。
    DocumentNotVisible,
    /// 文档在回收站。
    DocumentRecycled,
    /// 目标节点不是文档。
    NotADocument,
    /// 版本不可用（期望版本与当前版本不一致）。
    VersionUnavailable,
    /// 范围非法（越界 / 非字符边界）。
    InvalidRange,
    /// 快照身份或内容非法。
    InvalidSnapshot,
}

/// 只读材料结果。
pub type MaterialResult = Result<StoryMaterial, MaterialDenial>;

impl MaterialDenial {
    pub fn new(reason: MaterialDenialReason) -> Self {
        Self { reason }
    }
}

// ========== 入口 ==========

/// 受控只读读取：校验作品 / 文档 / 可见性 / 版本 / 范围 / 快照后返回结构化材料。
/// 任何失败都以结构化拒绝关闭，不返回内容，不写入任何文件。
pub fn read_material(project_root: &Path, request: &ReadMaterialRequest) -> MaterialResult {
    let canonical = project_root
        .canonicalize()
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::WorkMismatch))?;
    let work_id = canonical.to_string_lossy().to_string();
    if request.work_id != work_id {
        return Err(MaterialDenial::new(MaterialDenialReason::WorkMismatch));
    }

    let paths = ProjectPaths::new(canonical.clone());
    let tree = super::open_content_tree(&canonical)
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))?;

    read_material_from_tree(&work_id, &tree, request, &|node| {
        super::operations::read_and_validate_notebook(&paths.document_file(&node.id), &node.name)
            .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))
    })
}

/// 纯校验核心：在已解析的内容树上校验并抽取材料（供磁盘入口与测试复用）。
fn read_material_from_tree(
    work_id: &str,
    tree: &ContentTree,
    request: &ReadMaterialRequest,
    read_document_content: &impl Fn(&ContentTreeNode) -> Result<String, MaterialDenial>,
) -> MaterialResult {
    let document_id = request.document_id.as_str();

    // 回收站文档：先于缺失判定，给出明确理由（回收站节点不在可见 nodes 中）。
    if is_recycled(tree, document_id) {
        return Err(MaterialDenial::new(MaterialDenialReason::DocumentRecycled));
    }

    // 存在性：可见节点映射中必须存在。
    let node = tree
        .nodes
        .get(document_id)
        .ok_or_else(|| MaterialDenial::new(MaterialDenialReason::DocumentMissing))?;

    // 可见性：必须从根可达（隐藏 / 游离节点拒绝）。
    if !is_visible(tree, document_id) {
        return Err(MaterialDenial::new(
            MaterialDenialReason::DocumentNotVisible,
        ));
    }

    // 类型：必须是文档节点，文件夹不承载正文。
    if node.kind != NodeKind::Document {
        return Err(MaterialDenial::new(MaterialDenialReason::NotADocument));
    }

    // AI 可见性：文档被用户关闭「允许 AI 查看」时拒绝，且不泄露其身份/正文。
    if !node.ai_visible {
        return Err(MaterialDenial::new(
            MaterialDenialReason::DocumentNotVisible,
        ));
    }

    // 正文与版本：合法快照优先于磁盘稿（未保存内容最新）。
    let (content, version) = match &request.snapshot {
        Some(snapshot) => {
            validate_snapshot(work_id, document_id, snapshot)?;
            (snapshot.content.clone(), snapshot.version.clone())
        }
        None => {
            let content = read_document_content(node)?;
            let version = compute_version(&content);
            (content, version)
        }
    };

    // 期望版本：与返回版本不一致即拒绝（旧版本 / 不可用版本）。
    if let Some(expected) = &request.expected_version {
        if expected != &version {
            return Err(MaterialDenial::new(
                MaterialDenialReason::VersionUnavailable,
            ));
        }
    }

    // 范围：默认整篇；越界或非字符边界拒绝。
    let full_end = content.len();
    let range = match request.range {
        Some(range) => {
            if range.start > range.end || range.end > full_end {
                return Err(MaterialDenial::new(MaterialDenialReason::InvalidRange));
            }
            if !content.is_char_boundary(range.start) || !content.is_char_boundary(range.end) {
                return Err(MaterialDenial::new(MaterialDenialReason::InvalidRange));
            }
            range
        }
        None => MaterialRange {
            start: 0,
            end: full_end,
        },
    };

    Ok(StoryMaterial {
        work_id: work_id.to_string(),
        document_id: document_id.to_string(),
        document_name: node.name.clone(),
        range,
        version,
        content: content[range.start..range.end].to_string(),
    })
}

// ========== AI 目录投影 ==========

/// AI 目录投影中的单个节点：只含允许查看的文档及其必要文件夹路径。
/// 文档的 `children` 恒为空；文件夹的 `children` 只含仍能到达可见文档的路径。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectedNode {
    pub id: String,
    pub name: String,
    pub kind: NodeKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ProjectedNode>,
}

/// 提供给 AI 读取路径的作品目录投影。
///
/// 只列允许查看且不在回收站的文档及其必要文件夹路径；隐藏文档的名称、ID、
/// 路径、正文和仅含隐藏内容的文件夹都不出现在投影中，只以匿名数量提示存在。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectoryProjection {
    pub root_children: Vec<ProjectedNode>,
    /// 匿名隐藏文件数量（不含回收站内文档），不携带任何可推断身份的信息。
    pub hidden_count: usize,
}

/// 在内容树上生成 AI 目录投影（纯函数，供磁盘入口与测试复用）。
pub fn project_directory(tree: &ContentTree) -> DirectoryProjection {
    let mut hidden_count = 0usize;
    let root_children = tree
        .root_children
        .iter()
        .filter_map(|id| project_node(tree, id, &mut hidden_count))
        .collect();
    DirectoryProjection {
        root_children,
        hidden_count,
    }
}

/// 递归投影单个节点：隐藏文档只增加匿名计数并返回 `None`；文件夹仅当其子树
/// 仍包含可见文档时才保留（必要路径），否则连同仅含隐藏内容的文件夹一起隐藏。
fn project_node(tree: &ContentTree, id: &str, hidden_count: &mut usize) -> Option<ProjectedNode> {
    let node = tree.nodes.get(id)?;
    match node.kind {
        NodeKind::Document => {
            if node.ai_visible {
                Some(ProjectedNode {
                    id: node.id.clone(),
                    name: node.name.clone(),
                    kind: NodeKind::Document,
                    children: Vec::new(),
                })
            } else {
                *hidden_count += 1;
                None
            }
        }
        NodeKind::Folder => {
            let children: Vec<ProjectedNode> = node
                .children
                .iter()
                .filter_map(|child| project_node(tree, child, hidden_count))
                .collect();
            if children.is_empty() {
                None
            } else {
                Some(ProjectedNode {
                    id: node.id.clone(),
                    name: node.name.clone(),
                    kind: NodeKind::Folder,
                    children,
                })
            }
        }
    }
}

/// 读取作品并生成 AI 目录投影（磁盘入口，供命令层调用）。
pub fn read_directory_projection(project_root: &Path) -> Result<DirectoryProjection, ProjectError> {
    let tree = super::open_content_tree(project_root)?;
    Ok(project_directory(&tree))
}

// ========== 校验助手 ==========

fn is_recycled(tree: &ContentTree, id: &str) -> bool {
    tree.recycle_bin
        .iter()
        .any(|entry| entry.nodes.contains_key(id))
}

fn is_visible(tree: &ContentTree, id: &str) -> bool {
    let mut stack: Vec<&str> = tree.root_children.iter().map(String::as_str).collect();
    while let Some(current) = stack.pop() {
        if current == id {
            return true;
        }
        if let Some(node) = tree.nodes.get(current) {
            stack.extend(node.children.iter().map(String::as_str));
        }
    }
    false
}

/// 内容派生的版本身份：FNV-1a 64 位散列的十六进制表示。内容变则版本变。
fn compute_version(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn validate_snapshot(
    work_id: &str,
    document_id: &str,
    snapshot: &MaterialSnapshot,
) -> Result<(), MaterialDenial> {
    if snapshot.work_id != work_id {
        return Err(MaterialDenial::new(MaterialDenialReason::InvalidSnapshot));
    }
    if snapshot.document_id != document_id {
        return Err(MaterialDenial::new(MaterialDenialReason::InvalidSnapshot));
    }
    if snapshot.version.trim().is_empty() {
        return Err(MaterialDenial::new(MaterialDenialReason::InvalidSnapshot));
    }
    if snapshot.content.len() as u64 > super::operations::MAX_NOTEBOOK_BYTES {
        return Err(MaterialDenial::new(MaterialDenialReason::InvalidSnapshot));
    }
    let value: serde_json::Value = serde_json::from_str(&snapshot.content)
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::InvalidSnapshot))?;
    super::validate_notebook_document(&value)
        .map_err(|_| MaterialDenial::new(MaterialDenialReason::InvalidSnapshot))?;
    // 版本身份必须由内容派生：即便 work_id / document_id 合法、版本非空，只要
    // version 与 compute_version(content) 不一致即拒绝，防止伪造版本身份。
    if snapshot.version != compute_version(&snapshot.content) {
        return Err(MaterialDenial::new(MaterialDenialReason::InvalidSnapshot));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{
        create_new_project, open_content_tree, read_document, save_document,
        set_document_ai_visibility, ContentTree, ContentTreeNode, CreateProjectParams, NodeKind,
        ProjectPaths,
    };
    use std::path::PathBuf;

    fn notebook_with_text(text: &str) -> String {
        serde_json::to_string(&serde_json::json!({
            "format": "next-story-tiptap",
            "version": 2,
            "document": {
                "type": "doc",
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
            }
        }))
        .unwrap()
    }

    fn setup_work(temp: &tempfile::TempDir) -> (PathBuf, String) {
        let root = create_new_project(CreateProjectParams {
            name: "测试作品".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create work");
        let work_id = root.canonicalize().unwrap().to_string_lossy().to_string();
        (root, work_id)
    }

    fn default_document_id(root: &std::path::Path) -> String {
        let tree = open_content_tree(root).expect("open tree");
        tree.root_children[0].clone()
    }

    fn setup_work_with_doc(temp: &tempfile::TempDir, content: &str) -> (PathBuf, String, String) {
        let (root, work_id) = setup_work(temp);
        let doc_id = default_document_id(&root);
        save_document(&root, &doc_id, content).expect("save doc");
        (root, work_id, doc_id)
    }

    fn request(work_id: &str, document_id: &str) -> ReadMaterialRequest {
        ReadMaterialRequest {
            work_id: work_id.to_string(),
            document_id: document_id.to_string(),
            range: None,
            expected_version: None,
            snapshot: None,
        }
    }

    // ========== 授权读取成功 ==========

    #[test]
    fn authorized_document_read_returns_structured_material() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("林站在天台边。");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let material = read_material(&root, &request(&work_id, &doc_id)).expect("authorized read");

        assert_eq!(material.work_id, work_id);
        assert_eq!(material.document_id, doc_id);
        assert_eq!(material.document_name, "未命名文档");
        assert_eq!(material.version, compute_version(&content));
        assert_eq!(material.content, content);
        assert_eq!(
            material.range,
            MaterialRange {
                start: 0,
                end: content.len()
            }
        );
    }

    #[test]
    fn read_material_slices_requested_range() {
        let temp = tempfile::TempDir::new().unwrap();
        let text = "hello";
        let content = notebook_with_text(text);
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let start = content.find(text).unwrap();
        let end = start + text.len();
        let mut req = request(&work_id, &doc_id);
        req.range = Some(MaterialRange { start, end });

        let material = read_material(&root, &req).expect("range read");
        assert_eq!(material.content, &content[start..end]);
        assert_eq!(material.range, MaterialRange { start, end });
    }

    // ========== 失败关闭：作品身份 ==========

    #[test]
    fn wrong_work_fails_closed_without_content() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("林站在天台边。");
        let (root, _work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let denial = read_material(&root, &request("别的作品身份", &doc_id))
            .expect_err("wrong work must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::WorkMismatch);
    }

    // ========== 失败关闭：缺失 / 隐藏 / 回收站 / 非文档 ==========

    #[test]
    fn missing_document_fails_closed() {
        let mut tree = ContentTree::new();
        tree.create_document(None).unwrap();
        let req = request("w", "not-there");

        let denial =
            read_material_from_tree("w", &tree, &req, &|_node| panic!("缺失文档不得读取正文"))
                .expect_err("missing document must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::DocumentMissing);
    }

    #[test]
    fn hidden_document_fails_closed() {
        let mut tree = ContentTree::new();
        tree.create_document(None).unwrap();
        // 构造一个存在于 nodes 但不从根可达的隐藏/游离文档节点。
        let hidden_id = "hidden-orphan".to_string();
        tree.nodes.insert(
            hidden_id.clone(),
            ContentTreeNode {
                id: hidden_id.clone(),
                name: "隐藏文档".to_string(),
                kind: NodeKind::Document,
                children: Vec::new(),
                ai_visible: true,
            },
        );
        let req = request("w", &hidden_id);

        let denial =
            read_material_from_tree("w", &tree, &req, &|_node| panic!("隐藏文档不得读取正文"))
                .expect_err("hidden document must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::DocumentNotVisible);
    }

    #[test]
    fn recycled_document_fails_closed() {
        let mut tree = ContentTree::new();
        let doc = tree.create_document(None).unwrap();
        tree.delete_to_recycle_bin(&doc).unwrap();
        let req = request("w", &doc);

        let denial =
            read_material_from_tree("w", &tree, &req, &|_node| panic!("回收站文档不得读取正文"))
                .expect_err("recycled document must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::DocumentRecycled);
    }

    #[test]
    fn folder_is_not_a_readable_document() {
        let mut tree = ContentTree::new();
        let folder = tree.create_folder(None).unwrap();
        let req = request("w", &folder);

        let denial =
            read_material_from_tree("w", &tree, &req, &|_node| panic!("文件夹不得读取正文"))
                .expect_err("folder must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::NotADocument);
    }

    // ========== 失败关闭：文档 AI 可见性（ai_visible） ==========

    #[test]
    fn ai_visible_false_document_fails_closed_without_content() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("将被隐藏的正文");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        // 关闭可见性后读取被拒绝，且不返回正文。
        set_document_ai_visibility(&root, &doc_id, false).expect("关闭可见性");
        let denial =
            read_material(&root, &request(&work_id, &doc_id)).expect_err("隐藏文档必须被拒绝");
        assert_eq!(denial.reason, MaterialDenialReason::DocumentNotVisible);

        // 重新允许后恢复读取。
        set_document_ai_visibility(&root, &doc_id, true).expect("恢复可见性");
        assert!(read_material(&root, &request(&work_id, &doc_id)).is_ok());
    }

    #[test]
    fn snapshot_from_ai_visible_false_document_fails_closed() {
        let mut tree = ContentTree::new();
        let doc = tree.create_document(None).unwrap();
        tree.set_ai_visibility(&doc, false).unwrap();
        let mut req = request("w", &doc);
        req.snapshot = Some(MaterialSnapshot {
            work_id: "w".to_string(),
            document_id: doc.clone(),
            version: "v1".to_string(),
            content: notebook_with_text("快照正文"),
        });

        let denial = read_material_from_tree("w", &tree, &req, &|_node| {
            panic!("隐藏文档的快照不得读取正文")
        })
        .expect_err("hidden document snapshot must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::DocumentNotVisible);
    }

    // ========== AI 目录投影：匿名隐藏计数 ==========

    #[test]
    fn directory_projection_hides_hidden_docs_and_counts_them_anonymously() {
        let mut tree = ContentTree::new();
        let visible = tree.create_document(None).unwrap();
        tree.rename(&visible, "可见文档").unwrap();
        let hidden = tree.create_document(None).unwrap();
        tree.rename(&hidden, "隐藏文档").unwrap();
        tree.set_ai_visibility(&hidden, false).unwrap();

        let projection = project_directory(&tree);
        assert_eq!(projection.hidden_count, 1);
        assert_eq!(projection.root_children.len(), 1);
        assert_eq!(projection.root_children[0].name, "可见文档");
        assert_eq!(projection.root_children[0].kind, NodeKind::Document);

        // 序列化不得泄露隐藏文档名称 / ID。
        let json = serde_json::to_string(&projection).unwrap();
        assert!(!json.contains("隐藏文档"));
        assert!(!json.contains(&hidden));
    }

    #[test]
    fn directory_projection_drops_folder_with_only_hidden_content() {
        let mut tree = ContentTree::new();
        let folder = tree.create_folder(None).unwrap();
        tree.rename(&folder, "仅隐藏的文件夹").unwrap();
        let hidden = tree.create_document(Some(&folder)).unwrap();
        tree.rename(&hidden, "隐藏文档").unwrap();
        tree.set_ai_visibility(&hidden, false).unwrap();

        let projection = project_directory(&tree);
        assert!(
            projection.root_children.is_empty(),
            "仅含隐藏内容的文件夹不得暴露路径"
        );
        assert_eq!(projection.hidden_count, 1);

        let json = serde_json::to_string(&projection).unwrap();
        assert!(!json.contains("仅隐藏的文件夹"));
        assert!(!json.contains("隐藏文档"));
    }

    #[test]
    fn directory_projection_keeps_necessary_folder_paths() {
        let mut tree = ContentTree::new();
        let folder = tree.create_folder(None).unwrap();
        tree.rename(&folder, "角色").unwrap();
        let visible = tree.create_document(Some(&folder)).unwrap();
        tree.rename(&visible, "小芳").unwrap();
        let hidden = tree.create_document(Some(&folder)).unwrap();
        tree.rename(&hidden, "小刚").unwrap();
        tree.set_ai_visibility(&hidden, false).unwrap();

        let projection = project_directory(&tree);
        assert_eq!(projection.root_children.len(), 1);
        let role = &projection.root_children[0];
        assert_eq!(role.kind, NodeKind::Folder);
        assert_eq!(role.name, "角色");
        assert_eq!(role.children.len(), 1);
        assert_eq!(role.children[0].name, "小芳");
        assert_eq!(projection.hidden_count, 1);

        let json = serde_json::to_string(&projection).unwrap();
        assert!(json.contains("角色"));
        assert!(json.contains("小芳"));
        assert!(!json.contains("小刚"));
    }

    // ========== 失败关闭：旧版本 / 非法范围 ==========

    #[test]
    fn unavailable_version_fails_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("当前内容");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let mut req = request(&work_id, &doc_id);
        req.expected_version = Some("不存在的旧版本".to_string());

        let denial = read_material(&root, &req).expect_err("old version must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::VersionUnavailable);
    }

    #[test]
    fn expected_version_matching_current_succeeds() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("当前内容");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);
        let version = compute_version(&content);

        let mut req = request(&work_id, &doc_id);
        req.expected_version = Some(version.clone());

        let material = read_material(&root, &req).expect("matching version read");
        assert_eq!(material.version, version);
    }

    #[test]
    fn invalid_range_fails_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("hello");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        for bad in [
            MaterialRange { start: 5, end: 3 }, // start > end
            MaterialRange {
                start: 0,
                end: content.len() + 8,
            }, // end 越界
        ] {
            let mut req = request(&work_id, &doc_id);
            req.range = Some(bad);
            let denial = read_material(&root, &req).expect_err("invalid range must be denied");
            assert_eq!(denial.reason, MaterialDenialReason::InvalidRange);
        }
    }

    #[test]
    fn range_not_on_char_boundary_fails_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let text = "你好";
        let content = notebook_with_text(text);
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let start = content.find('你').unwrap();
        assert!(content.is_char_boundary(start));
        assert!(!content.is_char_boundary(start + 1));

        let mut req = request(&work_id, &doc_id);
        req.range = Some(MaterialRange {
            start,
            end: start + 1,
        });
        let denial = read_material(&root, &req).expect_err("non-boundary range must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::InvalidRange);
    }

    // ========== 未保存快照 ==========

    #[test]
    fn snapshot_with_wrong_work_fails_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("磁盘旧稿");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let mut req = request(&work_id, &doc_id);
        req.snapshot = Some(MaterialSnapshot {
            work_id: "别的作品".to_string(),
            document_id: doc_id.clone(),
            version: "snapshot-v1".to_string(),
            content: notebook_with_text("快照新稿"),
        });

        let denial = read_material(&root, &req).expect_err("wrong-work snapshot denied");
        assert_eq!(denial.reason, MaterialDenialReason::InvalidSnapshot);
    }

    #[test]
    fn snapshot_with_wrong_document_fails_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("磁盘旧稿");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let mut req = request(&work_id, &doc_id);
        req.snapshot = Some(MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: "别的文档".to_string(),
            version: "snapshot-v1".to_string(),
            content: notebook_with_text("快照新稿"),
        });

        let denial = read_material(&root, &req).expect_err("wrong-document snapshot denied");
        assert_eq!(denial.reason, MaterialDenialReason::InvalidSnapshot);
    }

    #[test]
    fn snapshot_with_empty_version_fails_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("磁盘旧稿");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let mut req = request(&work_id, &doc_id);
        req.snapshot = Some(MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: doc_id.clone(),
            version: "   ".to_string(),
            content: notebook_with_text("快照新稿"),
        });

        let denial = read_material(&root, &req).expect_err("empty-version snapshot denied");
        assert_eq!(denial.reason, MaterialDenialReason::InvalidSnapshot);
    }

    #[test]
    fn snapshot_version_must_match_snapshot_content() {
        let mut tree = ContentTree::new();
        let doc = tree.create_document(None).unwrap();
        let snapshot_content = notebook_with_text("快照正文");
        // 伪造版本：非空、且与 expected_version 一致，但并非由内容派生。
        let forged_version = "forged-version".to_string();

        let mut req = request("w", &doc);
        req.expected_version = Some(forged_version.clone());
        req.snapshot = Some(MaterialSnapshot {
            work_id: "w".to_string(),
            document_id: doc.clone(),
            version: forged_version,
            content: snapshot_content,
        });

        // 即便快照身份合法、版本非空且与 expected_version 相同，只要它不等于
        // compute_version(content)，就必须失败关闭为 InvalidSnapshot，且不读磁盘正文。
        let denial = read_material_from_tree("w", &tree, &req, &|_node| {
            panic!("伪造版本快照不得读取磁盘正文")
        })
        .expect_err("forged snapshot version must be denied");
        assert_eq!(denial.reason, MaterialDenialReason::InvalidSnapshot);
    }

    #[test]
    fn snapshot_with_invalid_content_fails_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("磁盘旧稿");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let mut req = request(&work_id, &doc_id);
        req.snapshot = Some(MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: doc_id.clone(),
            version: "snapshot-v1".to_string(),
            content: "不是合法本子 JSON".to_string(),
        });

        let denial = read_material(&root, &req).expect_err("invalid-content snapshot denied");
        assert_eq!(denial.reason, MaterialDenialReason::InvalidSnapshot);
    }

    #[test]
    fn valid_snapshot_returns_latest_content_over_disk() {
        let temp = tempfile::TempDir::new().unwrap();
        let disk_content = notebook_with_text("磁盘旧稿");
        let snapshot_content = notebook_with_text("快照新稿");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &disk_content);

        let snapshot_version = compute_version(&snapshot_content);
        let mut req = request(&work_id, &doc_id);
        req.snapshot = Some(MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: doc_id.clone(),
            version: snapshot_version.clone(),
            content: snapshot_content.clone(),
        });

        let material = read_material(&root, &req).expect("valid snapshot read");
        assert_eq!(material.content, snapshot_content);
        assert_eq!(material.version, snapshot_version);

        // 磁盘稿仍是旧内容：快照只读传递，绝不写回磁盘。
        assert_eq!(read_document(&root, &doc_id).unwrap(), disk_content);
    }

    // ========== 任务 6.2：读取不改变作品文件 ==========

    #[test]
    fn reads_never_modify_project_files() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("原始内容");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, &content);

        let paths = ProjectPaths::new(root.clone());
        let tree = open_content_tree(&root).unwrap();
        let mut files = vec![paths.content_tree_file.clone(), paths.metadata_file.clone()];
        for node in tree.nodes.values() {
            if node.kind == NodeKind::Document {
                files.push(paths.document_file(&node.id));
            }
        }
        let before: Vec<Vec<u8>> = files
            .iter()
            .map(|path| std::fs::read(path).expect("read project file before"))
            .collect();

        // 成功读取 + 多种失败读取 + 快照读取，都不应改写任何作品文件。
        let _ = read_material(&root, &request(&work_id, &doc_id));
        let _ = read_material(&root, &request("别的作品", &doc_id));

        let mut snapshot_req = request(&work_id, &doc_id);
        snapshot_req.snapshot = Some(MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: doc_id.clone(),
            version: "v".to_string(),
            content: notebook_with_text("快照"),
        });
        let _ = read_material(&root, &snapshot_req);

        for (path, before_bytes) in files.iter().zip(before.iter()) {
            assert_eq!(
                &std::fs::read(path).expect("read project file after"),
                before_bytes,
                "读取不得改写作品文件: {}",
                path.display()
            );
        }
    }
}
