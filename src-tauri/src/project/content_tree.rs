use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeKind {
    Folder,
    Document,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentTreeNode {
    pub id: String,
    pub name: String,
    pub kind: NodeKind,
    pub children: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecycleBinEntry {
    pub root_id: String,
    pub original_parent: Option<String>,
    pub original_index: usize,
    pub nodes: HashMap<String, ContentTreeNode>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentTree {
    pub root_children: Vec<String>,
    pub nodes: HashMap<String, ContentTreeNode>,
    pub recycle_bin: Vec<RecycleBinEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContentTreeError {
    NotFound(String),
    InvalidStructure(String),
    InvalidName(String),
    DuplicateName(String),
    InvalidMove(String),
    NotRestorable(String),
}

impl std::fmt::Display for ContentTreeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "内容树节点不存在: {id}"),
            Self::InvalidStructure(message) => write!(f, "内容树结构无效: {message}"),
            Self::InvalidName(message) => write!(f, "节点名称无效: {message}"),
            Self::DuplicateName(name) => write!(f, "同级节点名称已存在: {name}"),
            Self::InvalidMove(message) => write!(f, "节点移动无效: {message}"),
            Self::NotRestorable(message) => write!(f, "节点无法恢复: {message}"),
        }
    }
}

impl std::error::Error for ContentTreeError {}

impl ContentTree {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn document_path(root: &Path, id: &str) -> PathBuf {
        root.join("作品文本")
            .join("documents")
            .join(format!("{id}.json"))
    }

    pub fn validate(&self) -> Result<(), ContentTreeError> {
        let mut seen = HashSet::new();
        let mut all_ids = HashSet::new();
        let mut root_ids = HashSet::new();
        for child in &self.root_children {
            if !root_ids.insert(child) {
                return Err(ContentTreeError::InvalidStructure(
                    "根级存在重复子节点".into(),
                ));
            }
            validate_subtree(&self.nodes, child, &mut seen, &mut all_ids)?;
        }
        if seen.len() != self.nodes.len() {
            return Err(ContentTreeError::InvalidStructure(
                "存在未被根级内容或父级引用的节点".into(),
            ));
        }
        for entry in &self.recycle_bin {
            if !entry.nodes.contains_key(&entry.root_id) {
                return Err(ContentTreeError::InvalidStructure(
                    "回收站根节点不存在".into(),
                ));
            }
            let mut subtree_seen = HashSet::new();
            if let Some(parent) = &entry.original_parent {
                let parent_node = self.nodes.get(parent).ok_or_else(|| {
                    ContentTreeError::InvalidStructure("回收站原父级不存在".into())
                })?;
                if parent_node.kind != NodeKind::Folder {
                    return Err(ContentTreeError::InvalidStructure(
                        "回收站原父级不是文件夹".into(),
                    ));
                }
            }
            validate_subtree(
                &entry.nodes,
                &entry.root_id,
                &mut subtree_seen,
                &mut all_ids,
            )?;
            if subtree_seen.len() != entry.nodes.len() {
                return Err(ContentTreeError::InvalidStructure(
                    "回收站存在未引用节点".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn create_folder(&mut self, parent: Option<&str>) -> Result<String, ContentTreeError> {
        self.create_node(parent, NodeKind::Folder)
    }

    pub fn create_document(&mut self, parent: Option<&str>) -> Result<String, ContentTreeError> {
        self.create_node(parent, NodeKind::Document)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), ContentTreeError> {
        validate_name(name)?;
        let parent = self.parent_of(id)?;
        if self.sibling_ids(parent.as_deref()).iter().any(|sibling| {
            sibling != id
                && self
                    .nodes
                    .get(sibling)
                    .is_some_and(|node| node.name == name)
        }) {
            return Err(ContentTreeError::DuplicateName(name.into()));
        }
        self.node_mut(id)?.name = name.to_owned();
        Ok(())
    }

    pub fn move_node(
        &mut self,
        id: &str,
        new_parent: Option<&str>,
    ) -> Result<(), ContentTreeError> {
        let node = self.node(id)?.clone();
        if let Some(parent) = new_parent {
            let target = self.node(parent)?;
            if target.kind != NodeKind::Folder {
                return Err(ContentTreeError::InvalidMove("文档不能作为父级".into()));
            }
            if node.kind == NodeKind::Folder && self.is_descendant(parent, id)? {
                return Err(ContentTreeError::InvalidMove("不能移动到自身或后代".into()));
            }
            if self.sibling_ids(Some(parent)).iter().any(|sibling| {
                sibling != id
                    && self
                        .nodes
                        .get(sibling)
                        .is_some_and(|item| item.name == node.name)
            }) {
                return Err(ContentTreeError::DuplicateName(node.name));
            }
        }
        let (old_parent, old_index) = self.detach(id)?;
        let siblings = self.children_mut(new_parent)?;
        let index = old_index.min(siblings.len());
        siblings.insert(index, id.to_owned());
        let _ = old_parent;
        Ok(())
    }

    pub fn reorder_children(
        &mut self,
        parent: Option<&str>,
        order: Vec<String>,
    ) -> Result<(), ContentTreeError> {
        let current = self.children(parent)?.to_vec();
        let mut expected = current.clone();
        expected.sort();
        let mut actual = order.clone();
        actual.sort();
        if expected != actual {
            return Err(ContentTreeError::InvalidStructure(
                "排序列表必须完整且不能重复".into(),
            ));
        }
        *self.children_mut(parent)? = order;
        Ok(())
    }

    pub fn delete_to_recycle_bin(&mut self, id: &str) -> Result<(), ContentTreeError> {
        let parent = self.parent_of(id)?;
        let (original_parent, original_index) = self.detach(id)?;
        let mut subtree = HashMap::new();
        collect_subtree(&self.nodes, id, &mut subtree)?;
        for subtree_id in subtree.keys() {
            self.nodes.remove(subtree_id);
        }
        self.recycle_bin.push(RecycleBinEntry {
            root_id: id.to_owned(),
            original_parent: original_parent.or_else(|| parent.clone()),
            original_index,
            nodes: subtree,
        });
        Ok(())
    }

    pub fn restore(&mut self, id: &str) -> Result<(), ContentTreeError> {
        let index = self
            .recycle_bin
            .iter()
            .position(|entry| entry.root_id == id)
            .ok_or_else(|| ContentTreeError::NotRestorable(id.into()))?;
        let entry = self.recycle_bin[index].clone();
        let parent = entry.original_parent.as_deref();
        if let Some(parent_id) = parent {
            let parent_node = self.node(parent_id)?;
            if parent_node.kind != NodeKind::Folder {
                return Err(ContentTreeError::NotRestorable("原父级不是文件夹".into()));
            }
        }
        if self.sibling_ids(parent).iter().any(|sibling| {
            self.nodes.get(sibling).is_some_and(|existing| {
                entry
                    .nodes
                    .get(&entry.root_id)
                    .is_some_and(|root| existing.name == root.name)
            })
        }) {
            return Err(ContentTreeError::NotRestorable("原父级已有同名节点".into()));
        }
        let mut restored_ids = HashSet::new();
        let mut restored_seen = HashSet::new();
        validate_subtree(
            &entry.nodes,
            &entry.root_id,
            &mut restored_seen,
            &mut restored_ids,
        )?;
        if entry
            .nodes
            .keys()
            .any(|node_id| self.nodes.contains_key(node_id))
        {
            return Err(ContentTreeError::NotRestorable("节点 ID 已被占用".into()));
        }
        let restore_index = entry.original_index;
        for (node_id, node) in &entry.nodes {
            self.nodes.insert(node_id.clone(), node.clone());
        }
        let insert_at = restore_index.min(self.children(parent)?.len());
        self.children_mut(parent)?.insert(insert_at, id.to_owned());
        self.recycle_bin.remove(index);
        Ok(())
    }

    fn create_node(
        &mut self,
        parent: Option<&str>,
        kind: NodeKind,
    ) -> Result<String, ContentTreeError> {
        if let Some(parent_id) = parent {
            if self.node(parent_id)?.kind != NodeKind::Folder {
                return Err(ContentTreeError::InvalidMove("文档不能作为父级".into()));
            }
        }
        let base = match kind {
            NodeKind::Folder => "未命名文件夹",
            NodeKind::Document => "未命名文档",
        };
        let name = self.unique_name(parent, base);
        let id = new_id();
        self.nodes.insert(
            id.clone(),
            ContentTreeNode {
                id: id.clone(),
                name,
                kind,
                children: Vec::new(),
            },
        );
        self.children_mut(parent)?.push(id.clone());
        Ok(id)
    }

    fn unique_name(&self, parent: Option<&str>, base: &str) -> String {
        let siblings = self.sibling_ids(parent);
        if !siblings
            .iter()
            .any(|id| self.nodes.get(id).is_some_and(|node| node.name == base))
        {
            return base.into();
        }
        let mut index = 2;
        loop {
            let candidate = format!("{base} {index}");
            if !siblings.iter().any(|id| {
                self.nodes
                    .get(id)
                    .is_some_and(|node| node.name == candidate)
            }) {
                return candidate;
            }
            index += 1;
        }
    }

    fn node(&self, id: &str) -> Result<&ContentTreeNode, ContentTreeError> {
        self.nodes
            .get(id)
            .ok_or_else(|| ContentTreeError::NotFound(id.into()))
    }
    fn node_mut(&mut self, id: &str) -> Result<&mut ContentTreeNode, ContentTreeError> {
        self.nodes
            .get_mut(id)
            .ok_or_else(|| ContentTreeError::NotFound(id.into()))
    }
    fn children(&self, parent: Option<&str>) -> Result<&Vec<String>, ContentTreeError> {
        match parent {
            Some(id) => Ok(&self.node(id)?.children),
            None => Ok(&self.root_children),
        }
    }
    fn children_mut(&mut self, parent: Option<&str>) -> Result<&mut Vec<String>, ContentTreeError> {
        match parent {
            Some(id) => Ok(&mut self.node_mut(id)?.children),
            None => Ok(&mut self.root_children),
        }
    }
    fn sibling_ids(&self, parent: Option<&str>) -> Vec<String> {
        self.children(parent).cloned().unwrap_or_default()
    }

    fn parent_of(&self, id: &str) -> Result<Option<String>, ContentTreeError> {
        self.node(id)?;
        if self.root_children.iter().any(|child| child == id) {
            return Ok(None);
        }
        self.nodes
            .values()
            .find(|node| node.children.iter().any(|child| child == id))
            .map(|node| Ok(Some(node.id.clone())))
            .unwrap_or(Ok(None))
    }

    fn detach(&mut self, id: &str) -> Result<(Option<String>, usize), ContentTreeError> {
        let parent = self.parent_of(id)?;
        let siblings = self.children_mut(parent.as_deref())?;
        let index = siblings
            .iter()
            .position(|child| child == id)
            .ok_or_else(|| ContentTreeError::NotFound(id.into()))?;
        siblings.remove(index);
        Ok((parent, index))
    }

    fn is_descendant(&self, candidate: &str, ancestor: &str) -> Result<bool, ContentTreeError> {
        let mut stack = vec![ancestor.to_owned()];
        while let Some(id) = stack.pop() {
            if id == candidate {
                return Ok(true);
            }
            stack.extend(self.node(&id)?.children.iter().cloned());
        }
        Ok(false)
    }
}

fn validate_name(name: &str) -> Result<(), ContentTreeError> {
    if name.trim().is_empty() {
        return Err(ContentTreeError::InvalidName("名称不能为空".into()));
    }
    if name.ends_with('.')
        || name.ends_with(' ')
        || name
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
    {
        return Err(ContentTreeError::InvalidName(
            "名称包含当前系统不允许的字符".into(),
        ));
    }
    Ok(())
}

fn validate_subtree(
    nodes: &HashMap<String, ContentTreeNode>,
    id: &str,
    seen: &mut HashSet<String>,
    all_ids: &mut HashSet<String>,
) -> Result<(), ContentTreeError> {
    if !seen.insert(id.to_owned()) {
        return Err(ContentTreeError::InvalidStructure("内容树存在循环".into()));
    }
    // 节点 ID 用于正文文件寻址（documents/<id>.json），必须是非空且不含路径分隔符的
    // 普通文件名，防止恶意树元数据把正文读取/写入指向作品文件夹外部。
    if id.is_empty() || id.contains('/') || id.contains('\\') {
        return Err(ContentTreeError::InvalidStructure(
            "节点 ID 包含非法字符".into(),
        ));
    }
    let node = nodes
        .get(id)
        .ok_or_else(|| ContentTreeError::InvalidStructure("子节点引用不存在".into()))?;
    if node.id != id || !all_ids.insert(id.to_owned()) {
        return Err(ContentTreeError::InvalidStructure(
            "节点 ID 不唯一或与索引不一致".into(),
        ));
    }
    validate_name(&node.name)?;
    if node.kind == NodeKind::Document && !node.children.is_empty() {
        return Err(ContentTreeError::InvalidStructure(
            "文档不能包含子节点".into(),
        ));
    }
    let mut children = HashSet::new();
    let mut child_names = HashSet::new();
    for child in &node.children {
        if !children.insert(child) {
            return Err(ContentTreeError::InvalidStructure(
                "同一父级存在重复子节点".into(),
            ));
        }
        let child_node = nodes
            .get(child)
            .ok_or_else(|| ContentTreeError::InvalidStructure("子节点引用不存在".into()))?;
        if !child_names.insert(&child_node.name) {
            return Err(ContentTreeError::InvalidStructure(
                "同一父级存在重复名称".into(),
            ));
        }
        validate_subtree(nodes, child, seen, all_ids)?;
    }
    Ok(())
}

fn collect_subtree(
    nodes: &HashMap<String, ContentTreeNode>,
    id: &str,
    output: &mut HashMap<String, ContentTreeNode>,
) -> Result<(), ContentTreeError> {
    let node = nodes
        .get(id)
        .ok_or_else(|| ContentTreeError::NotFound(id.into()))?
        .clone();
    for child in &node.children {
        collect_subtree(nodes, child, output)?;
    }
    output.insert(id.into(), node);
    Ok(())
}

fn new_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("node-{now}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_mixed_nodes_with_unique_default_names() {
        let mut tree = ContentTree::new();
        let folder = tree.create_folder(None).unwrap();
        let document = tree.create_document(None).unwrap();
        assert_eq!(tree.nodes[&folder].name, "未命名文件夹");
        assert_eq!(tree.nodes[&document].name, "未命名文档");
        let another = tree.create_document(None).unwrap();
        assert_eq!(tree.nodes[&another].name, "未命名文档 2");
        assert_eq!(tree.root_children, vec![folder, document, another]);
        tree.validate().unwrap();
    }

    #[test]
    fn rejects_duplicate_and_invalid_names_and_cycles() {
        let mut tree = ContentTree::new();
        let a = tree.create_folder(None).unwrap();
        let b = tree.create_folder(None).unwrap();
        tree.rename(&a, "角色").unwrap();
        assert!(matches!(
            tree.rename(&b, "角色"),
            Err(ContentTreeError::DuplicateName(_))
        ));
        assert!(tree.rename(&b, "bad/name").is_err());
        let child = tree.create_folder(Some(&a)).unwrap();
        assert!(tree.move_node(&a, Some(&child)).is_err());
    }

    #[test]
    fn delete_and_restore_preserves_subtree_and_document_path() {
        let mut tree = ContentTree::new();
        let folder = tree.create_folder(None).unwrap();
        let doc = tree.create_document(Some(&folder)).unwrap();
        let path = ContentTree::document_path(Path::new("作品"), &doc);
        tree.rename(&doc, "改名后").unwrap();
        tree.delete_to_recycle_bin(&folder).unwrap();
        assert!(!tree.nodes.contains_key(&doc));
        tree.restore(&folder).unwrap();
        assert!(tree.nodes.contains_key(&doc));
        assert_eq!(ContentTree::document_path(Path::new("作品"), &doc), path);
        tree.validate().unwrap();
    }

    #[test]
    fn serializes_without_ai_metadata() {
        let tree = ContentTree::new();
        let json = serde_json::to_string(&tree).unwrap();
        assert!(!json.contains("reference"));
        assert!(!json.contains("参考"));
    }
}
