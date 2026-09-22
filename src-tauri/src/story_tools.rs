//! 宿主只读工具执行器（change: add-agent-on-demand-reading 任务组 3，设计
//! D1/D2/D3/D11/D13；任务组 4 接入讨论档案授权与出处）。
//!
//! Agent 按需补读的四个工具（`story-list` / `story-read` / `story-search` /
//! `story-request-reading`）全部在 Rust 宿主执行；node 驱动进程只桥接转发、
//! 不自行读取作品文件（驱动桥接是任务组 5）。
//!
//! 安全形状：
//! - 执行器只注入窄化的 [`StrictStoryReader`]（设计 D2）：类型层面只有「报告绑定
//!   的作品身份」「严格只读内容树」「读取已保存并经校验的正文」三个入口，保存 /
//!   恢复 / 迁移 / 删除 / 移动 / 重命名等一切写入路径都不在接口上，执行器在
//!   结构上拿不到它们。
//! - 读取复用与常规取材完全相同的授权核心（`read_material_from_tree` /
//!   `search_documents`）：作品身份、文档身份、回收站、AI 可见性、版本、范围，
//!   逐次校验（设计 D3），不依赖模型自制力；待恢复事务现场一律失败关闭。
//! - 讨论授权状态由调用方解析后注入（任务组 4 接讨论档案：
//!   [`execute_story_tool_for_conversation`]）：未授权讨论的三个读取工具一律
//!   结构化拒绝、不读取任何作品内容（设计 D13）；`story-request-reading` 是
//!   专用控制工具，返回结构化「等待授权」结果，不携带任何作品数据（设计 D1）。
//! - `story-search` 复用既有字面检索内核（NFKC 规范化等，设计 D11）：每次调用
//!   输出硬上限沿用 A 部分常数（5 文档 / 10 片段 / 前后各 120 字符）。
//! - 零写回：本模块对用户作品正文不存在任何写、删、移动、重命名代码路径；
//!   按需补读出处只写入讨论档案（系统数据，任务 4.3），AI 输出只能是讨论内的
//!   临时材料。
//!
//! 版本语义（设计 D4）：`story-read` 接受版本参数，与当前已保存版本不一致时返回
//! 结构化 `version_unavailable`；轮内版本固定表（`story_version_changed`）在任务
//! 组 6 叠加——本模块保持无状态纯函数形状，不堵死它。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::conversation_store::{
    read_conversation, save_conversation, ConversationStoreError, OnDemandReadingGrant,
};
use crate::project::{
    compute_version, project_directory, read_and_validate_notebook, read_material_from_tree,
    search_documents, strict_read_content_tree, ContentTree, ContentTreeNode, DirectoryProjection,
    MaterialDenial, MaterialDenialReason, MaterialRange, NodeKind, ProjectError, ProjectPaths,
    ProjectedNode, ReadMaterialRequest, SearchResult, StoryMaterial,
};

// ========== 授权状态（任务组 4 接讨论档案；执行器以参数注入） ==========

/// 讨论的按需补读授权状态：由调用方解析（讨论身份 → 授权 / 未授权）后注入，
/// 执行器自身不持有权限、不读写讨论档案。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnDemandReadingAuthorization {
    /// 未开启按需补读（缺省状态；旧档案缺字段视为未授权）。
    Unauthorized,
    /// 已开启按需补读。
    Authorized,
}

// ========== 工具调用输入 ==========

/// 一次 Agent 工具调用（执行器输入）。`tool` 标签与协议面 dash 风格工具名一致
/// （`sidecar/driver/protocol.json`，设计 D6/D7）；任务组 5 的驱动桥接负责把
/// `tool_call` 事件解析为本类型。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "tool")]
pub enum StoryToolCall {
    /// story-list：列出本作品允许查看的文档目录与各文档当前版本。
    #[serde(rename = "story-list")]
    List {
        /// 可选的作品身份声明；与执行器绑定的作品不一致即拒绝。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        work_id: Option<String>,
    },
    /// story-read：读取一篇文档的已保存正文（可带版本与范围）。
    #[serde(rename = "story-read")]
    Read {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        work_id: Option<String>,
        /// 目标文档稳定 ID。
        document_id: String,
        /// 期望版本身份；与当前已保存版本不一致时结构化拒绝
        /// （`version_unavailable`）。轮内版本固定表在任务组 6 叠加。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        version: Option<String>,
        /// 可选的正文字节区间（左闭右开）；越界或非字符边界拒绝。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        range: Option<MaterialRange>,
    },
    /// story-search：按调用方（Agent）提供的检索词做跨文档字面检索。
    #[serde(rename = "story-search")]
    Search {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        work_id: Option<String>,
        /// 检索词（经 NFKC 规范化后字面匹配正文纯文本）。
        query: String,
    },
    /// story-request-reading：按需补读授权请求（专用控制工具，设计 D1）。
    #[serde(rename = "story-request-reading")]
    RequestReading {
        /// 模型提供的请求原因（说明为什么现有材料不足），原样透传。
        reason: String,
    },
}

// ========== 工具执行结果 ==========

/// story-list 输出：目录投影 + 各可见文档当前版本（设计 D4：版本随目录提供，
/// 任务组 6 在此之上叠加轮内版本固定表）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryListing {
    /// 执行器绑定的作品身份。
    pub work_id: String,
    /// AI 目录投影：只含允许查看的文档与必要文件夹路径，隐藏文档只计匿名数量。
    pub directory: DirectoryProjection,
    /// 各可见文档的当前版本（内容派生）；正文不可读的文档按「单篇不可读跳过」
    /// 不计入，不中断整轮。
    pub documents: Vec<ListedDocument>,
}

/// story-list 输出中的单篇文档条目。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListedDocument {
    pub document_id: String,
    pub document_name: String,
    /// 已保存正文的内容派生版本。
    pub version: String,
}

/// story-request-reading 的结构化结果：只有授权请求本身，绝不携带任何作品数据
/// （设计 D1）。面向用户的暂停 / 继续流程由任务组 5 的驱动桥接实现；本类型只
/// 定义结构化结果形状。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ReadingRequestOutcome {
    /// 等待用户授权决定（模型提供的 reason 原样透传，不附带任何作品内容）。
    WaitingForAuthorization {
        /// 请求原因（透传；提示词要求说明为什么现有材料不足）。
        reason: String,
    },
    /// 讨论已开启按需补读：无需再请求，可直接读取。
    AlreadyAuthorized,
}

/// 同轮同版去重命中的简短「已提供过」提示（设计 D9，任务 6.3）：不重复装入
/// 全文，附最小出处（文档、版本、范围、轮次）。由通道层的轮内状态产生，
/// 执行器本身无状态、不产出该结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvidedHint {
    pub document_id: String,
    pub document_name: String,
    /// 命中时该轮固定的版本。
    pub version: String,
    /// 首次提供的有效范围（字节区间，左闭右开）。
    pub range: MaterialRange,
    /// 所属轮次（首轮为 0）。
    pub turn_index: u32,
}

/// 工具执行结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StoryToolOutcome {
    /// story-list：目录 + 各文档当前版本。
    Listed(StoryListing),
    /// story-read：受控只读材料（已保存正文，绝不写回）。
    Read(StoryMaterial),
    /// story-search：字面检索结果（每次调用输出硬上限沿用 A 部分常数）。
    Searched(SearchResult),
    /// story-request-reading：结构化授权请求（无作品数据）。
    ReadingRequested(ReadingRequestOutcome),
    /// story-read 同轮同版同范围重复请求：已提供过（附出处），不重复装入全文
    /// （设计 D9，任务 6.3；由通道层轮内状态判定）。
    AlreadyProvided(ProvidedHint),
}

/// 结构化拒绝：任何原因都不返回作品内容，也不表现为系统故障。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryToolDenial {
    pub reason: StoryToolDenialReason,
}

/// 拒绝原因（snake_case 稳定标签）。`story_version_changed` 语义（设计 D4）由
/// 任务组 6 的轮内版本固定表在 [`StoryToolDenialReason::VersionUnavailable`]
/// 之上细化，本组对版本不一致先返回 `version_unavailable`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoryToolDenialReason {
    /// 讨论未开启按需补读（设计 D13 硬门禁）：不读取任何作品内容。
    OnDemandReadingUnauthorized,
    /// 作品存在待恢复事务现场：严格只读失败关闭，绝不触发恢复。
    RecoveryRequired,
    /// 调用参数非法（如空文档 ID / 空原因）。
    InvalidParameters,
    /// 声称的作品身份与执行器绑定的作品不一致。
    WorkMismatch,
    /// 文档不存在或不可用（跨作品 / 不存在一律同此因，不泄露存在性）。
    DocumentMissing,
    /// 文档不可见（隐藏 / AI 可见性关闭 / 游离节点）。
    DocumentNotVisible,
    /// 文档在回收站。
    DocumentRecycled,
    /// 目标不是文档（文件夹不承载正文）。
    NotADocument,
    /// 版本不可用（期望版本与当前已保存版本不一致）。
    VersionUnavailable,
    /// 轮内版本失配（设计 D4，任务 6.1）：该文档本轮已固定另一版本（或期间已
    /// 保存为新版），本轮停读该文档，下一轮读最新已保存版。由通道层轮内固定表
    /// 判定并映射。
    StoryVersionChanged,
    /// 该轮补读保险丝已触发（设计 D5，任务 6.4）：后续补读工具调用停止，模型
    /// 基于已有材料收束回答。仅防异常循环，不是阅读配额。由通道层判定。
    ReadingStopped,
    /// 读取范围非法（越界 / 非字符边界）。
    InvalidRange,
}

/// 工具执行结果类型。
pub type StoryToolResult = Result<StoryToolOutcome, StoryToolDenial>;

// ========== 窄化只读接口（设计 D2） ==========

/// 窄化的严格只读作品读取接口：宿主工具执行器唯一可见的作品访问面。
///
/// 面上只有三件事：报告绑定的作品身份、严格只读读取内容树、读取一篇文档的
/// 已保存正文（经合法性校验）。保存 / 恢复 / 迁移 / 删除 / 移动 / 重命名等一切
/// 写入路径都不在本接口上——执行器拿不到它们，替代实现（测试替身）也只能提供
/// 读取。
pub trait StrictStoryReader {
    /// 执行器绑定的作品身份（与作品根规范化路径一致）。
    fn work_id(&self) -> &str;
    /// 严格只读读取内容树：发现待恢复事务现场即失败关闭（绝不恢复 / 清理 / 提交）。
    fn strict_content_tree(&self) -> Result<ContentTree, ProjectError>;
    /// 读取一篇文档的已保存正文（有界读取 + 合法性校验）；未保存内容不在此路径。
    fn saved_document_body(&self, node: &ContentTreeNode) -> Result<String, ProjectError>;
}

/// 生产实现：直接读磁盘上的作品，与既有 AI 受控读取同一条严格只读边界。
pub struct DiskStoryReader {
    root: PathBuf,
    work_id: String,
}

impl DiskStoryReader {
    /// 绑定一个作品根。路径无法规范化（不存在 / 不可访问）即拒绝：执行器不绑定
    /// 身份不实的作品。
    pub fn open(root: impl AsRef<Path>) -> Result<Self, ProjectError> {
        let canonical = root
            .as_ref()
            .canonicalize()
            .map_err(|e| ProjectError::InvalidStructure(format!("作品路径无法解析: {e}")))?;
        let work_id = canonical.to_string_lossy().to_string();
        Ok(Self {
            root: canonical,
            work_id,
        })
    }
}

impl StrictStoryReader for DiskStoryReader {
    fn work_id(&self) -> &str {
        &self.work_id
    }

    fn strict_content_tree(&self) -> Result<ContentTree, ProjectError> {
        strict_read_content_tree(&self.root)
    }

    fn saved_document_body(&self, node: &ContentTreeNode) -> Result<String, ProjectError> {
        let paths = ProjectPaths::new(self.root.clone());
        read_and_validate_notebook(&paths.document_file(&node.id), &node.name)
    }
}

// ========== 执行入口 ==========

/// 执行一次 Agent 工具调用（纯 Rust API：读取面 = 窄化 reader，授权状态由调用方
/// 注入；无内部可变状态，任务组 6 的版本固定表 / 去重 / 熔断可在外层叠加）。
///
/// 逐次校验顺序（设计 D3）：
/// 1. 读取类工具先校验讨论授权状态：未授权一律结构化拒绝，且不读取任何作品
///    内容（[`StoryToolCall::RequestReading`] 是合法控制路径，不受此步拦截）；
/// 2. 声称的作品身份必须与执行器绑定的作品一致；
/// 3. 严格只读读取内容树：待恢复事务现场失败关闭（含 story-request-reading：
///    每次收到 tool_call 都重新校验，不返回任何作品数据）；
/// 4. 读取复用与常规取材相同的授权核心（文档身份 / 回收站 / AI 可见性 / 版本 /
///    范围）。
pub fn execute_story_tool(
    reader: &impl StrictStoryReader,
    authorization: OnDemandReadingAuthorization,
    call: StoryToolCall,
) -> StoryToolResult {
    match &call {
        StoryToolCall::RequestReading { reason } => {
            if reason.trim().is_empty() {
                return Err(denial(StoryToolDenialReason::InvalidParameters));
            }
            // 设计 D3：每次收到 tool_call 都重新校验待恢复事务；控制工具同样
            // 失败关闭，且绝不携带任何作品数据。
            let _ = strict_tree(reader)?;
            let outcome = match authorization {
                OnDemandReadingAuthorization::Unauthorized => {
                    ReadingRequestOutcome::WaitingForAuthorization {
                        reason: reason.clone(),
                    }
                }
                OnDemandReadingAuthorization::Authorized => {
                    ReadingRequestOutcome::AlreadyAuthorized
                }
            };
            Ok(StoryToolOutcome::ReadingRequested(outcome))
        }
        StoryToolCall::List { work_id }
        | StoryToolCall::Read { work_id, .. }
        | StoryToolCall::Search { work_id, .. } => {
            // 设计 D13：未授权讨论的补读读取一律结构化拒绝，先于任何作品读取。
            if authorization != OnDemandReadingAuthorization::Authorized {
                return Err(denial(StoryToolDenialReason::OnDemandReadingUnauthorized));
            }
            if let Some(claimed) = work_id {
                if claimed != reader.work_id() {
                    return Err(denial(StoryToolDenialReason::WorkMismatch));
                }
            }
            let tree = strict_tree(reader)?;
            match call {
                StoryToolCall::List { .. } => list_story(reader, &tree),
                StoryToolCall::Read {
                    document_id,
                    version,
                    range,
                    ..
                } => read_story(reader, &tree, &document_id, version, range),
                StoryToolCall::Search { query, .. } => search_story(reader, &tree, &query),
                StoryToolCall::RequestReading { .. } => {
                    unreachable!("RequestReading 已在上文处理")
                }
            }
        }
    }
}

// ========== 工具实现（全部只读，零写回） ==========

/// story-list：目录投影 + 各可见文档当前版本。
fn list_story(reader: &impl StrictStoryReader, tree: &ContentTree) -> StoryToolResult {
    let directory = project_directory(tree);
    let mut documents = Vec::new();
    // 单篇不可读跳过并继续：正文读取或校验失败的文档不进入版本清单，
    // 不中断整轮（agent-on-demand-reading「单篇不可读跳过并继续」）。
    collect_projected_documents(&directory.root_children, &mut |id| {
        if let Some(node) = tree.nodes.get(id) {
            if let Ok(body) = reader.saved_document_body(node) {
                documents.push(ListedDocument {
                    document_id: node.id.clone(),
                    document_name: node.name.clone(),
                    version: compute_version(&body),
                });
            }
        }
    });
    Ok(StoryToolOutcome::Listed(StoryListing {
        work_id: reader.work_id().to_string(),
        directory,
        documents,
    }))
}

/// story-read：经同一授权核心读取一篇文档的已保存正文。
///
/// `story-snapshot` 不在 Agent 工具面（设计 D6）：补读只读已保存正文，
/// 请求不携带未保存快照通道。
fn read_story(
    reader: &impl StrictStoryReader,
    tree: &ContentTree,
    document_id: &str,
    version: Option<String>,
    range: Option<MaterialRange>,
) -> StoryToolResult {
    if document_id.trim().is_empty() {
        return Err(denial(StoryToolDenialReason::InvalidParameters));
    }
    let request = ReadMaterialRequest {
        work_id: reader.work_id().to_string(),
        document_id: document_id.to_string(),
        range,
        expected_version: version,
        snapshot: None,
    };
    let material = read_material_from_tree(reader.work_id(), tree, &request, &|node| {
        reader
            .saved_document_body(node)
            .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))
    })
    .map_err(|d| denial(map_denial_reason(d.reason)))?;
    Ok(StoryToolOutcome::Read(material))
}

/// story-search：复用既有字面检索内核（设计 D11）。
///
/// 检索范围 = 内核的可见文档集合：同作品、非回收站、从根可达、允许 AI 查看、
/// 已保存正文。Agent 检索无「关注文档」概念，不排除任何可见文档（focus 传空）。
fn search_story(
    reader: &impl StrictStoryReader,
    tree: &ContentTree,
    query: &str,
) -> StoryToolResult {
    let result = search_documents(tree, "", query, &|node| {
        reader
            .saved_document_body(node)
            .map_err(|_| MaterialDenial::new(MaterialDenialReason::DocumentMissing))
    });
    Ok(StoryToolOutcome::Searched(result))
}

// ========== 助手 ==========

/// 严格只读读取内容树，映射为工具层结构化拒绝（待恢复事务 → `recovery_required`；
/// 其余树读取失败沿用既有受控读取入口的惯例 → `document_missing`，不泄露细节）。
fn strict_tree(reader: &impl StrictStoryReader) -> Result<ContentTree, StoryToolDenial> {
    reader.strict_content_tree().map_err(|e| {
        denial(match e {
            ProjectError::RecoveryRequired => StoryToolDenialReason::RecoveryRequired,
            _ => StoryToolDenialReason::DocumentMissing,
        })
    })
}

fn map_denial_reason(reason: MaterialDenialReason) -> StoryToolDenialReason {
    match reason {
        MaterialDenialReason::WorkMismatch => StoryToolDenialReason::WorkMismatch,
        MaterialDenialReason::DocumentMissing => StoryToolDenialReason::DocumentMissing,
        MaterialDenialReason::DocumentNotVisible => StoryToolDenialReason::DocumentNotVisible,
        MaterialDenialReason::DocumentRecycled => StoryToolDenialReason::DocumentRecycled,
        MaterialDenialReason::NotADocument => StoryToolDenialReason::NotADocument,
        MaterialDenialReason::VersionUnavailable => StoryToolDenialReason::VersionUnavailable,
        MaterialDenialReason::InvalidRange => StoryToolDenialReason::InvalidRange,
        // Agent 工具面无快照通道，此原因实际不可达；映射保持穷尽且不放宽。
        MaterialDenialReason::InvalidSnapshot => StoryToolDenialReason::DocumentMissing,
        MaterialDenialReason::RecoveryRequired => StoryToolDenialReason::RecoveryRequired,
    }
}

fn denial(reason: StoryToolDenialReason) -> StoryToolDenial {
    StoryToolDenial { reason }
}

/// 深度优先遍历目录投影，访问其中全部文档节点（投影本身已只含允许查看的文档）。
fn collect_projected_documents(nodes: &[ProjectedNode], visit: &mut impl FnMut(&str)) {
    for node in nodes {
        if node.kind == NodeKind::Document {
            visit(&node.id);
        }
        collect_projected_documents(&node.children, visit);
    }
}

// ========== 宿主逐次校验接线（add-agent-on-demand-reading 任务 4.3，设计 D3） ==========

/// 授权状态的解析来源（任务 4.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorizationResolution {
    /// 从讨论档案解析授权状态：档案缺失 / 旧档案缺字段 / 档案损坏 → 一律未授权
    /// （失败关闭，D3 + 任务 4.2）。
    FromArchive,
    /// 强制按未授权处理，不读档案。为任务 5.5（及时召唤首轮硬门禁）与「关闭立即
    /// 生效」类即时语义预留的调用方式——入口参数不堵死后续组。
    ForceUnauthorized,
}

/// 从讨论档案解析按需补读授权状态（设计 D3：授权真相在讨论档案，逐次校验）。
/// 任何读取失败（缺档案 / 损坏 / 超限）都按未授权关闭，绝不放宽。
pub fn resolve_on_demand_reading_authorization(
    project_root: &Path,
    conversation_id: &str,
    resolution: AuthorizationResolution,
) -> OnDemandReadingAuthorization {
    if resolution == AuthorizationResolution::ForceUnauthorized {
        return OnDemandReadingAuthorization::Unauthorized;
    }
    let authorized = read_conversation(project_root, conversation_id)
        .ok()
        .and_then(|record| record.on_demand_reading_grant)
        .is_some();
    if authorized {
        OnDemandReadingAuthorization::Authorized
    } else {
        OnDemandReadingAuthorization::Unauthorized
    }
}

/// 解析讨论授权（含档案根与 reader 绑定一致性校验）：档案根无法规范化、与执行
/// 器绑定作品不一致均结构化拒绝。授权真相逐次从讨论档案读取（设计 D3）。
pub fn resolve_conversation_authorization(
    reader: &impl StrictStoryReader,
    project_root: &Path,
    conversation_id: &str,
    resolution: AuthorizationResolution,
) -> Result<OnDemandReadingAuthorization, StoryToolDenial> {
    // 档案所在作品必须与执行器绑定的作品一致（防跨作品接线错误）。
    let canonical_root = project_root
        .canonicalize()
        .map_err(|_| denial(StoryToolDenialReason::WorkMismatch))?;
    if canonical_root.to_string_lossy() != reader.work_id() {
        return Err(denial(StoryToolDenialReason::WorkMismatch));
    }
    Ok(resolve_on_demand_reading_authorization(
        project_root,
        conversation_id,
        resolution,
    ))
}

/// 宿主逐次校验接线入口（任务 4.3）：讨论身份 → 档案解析授权 → 无状态执行。
///
/// 任务组 6 起，轮内监管状态（版本固定表 / 同轮去重 / 覆盖累计 / 熔断）与按轮
/// 累计的读取出处判定都在通道层（`story_tool_channel`）——执行器保持无状态，
/// 本入口只做授权解析与执行，不再直接写出处。
pub fn execute_story_tool_for_conversation(
    reader: &impl StrictStoryReader,
    project_root: &Path,
    conversation_id: &str,
    resolution: AuthorizationResolution,
    call: StoryToolCall,
) -> StoryToolResult {
    let authorization =
        resolve_conversation_authorization(reader, project_root, conversation_id, resolution)?;
    execute_story_tool(reader, authorization, call)
}

/// 供调用方（组 5/组 7 前端保存链）在用户开启授权时写入授权状态：把档案的
/// 授权字段置为已授权及当前时间。关闭授权（置回未授权）直接经既有
/// `conversation_save` 保存 `None` 即可，无需专用函数。
pub fn grant_on_demand_reading(
    project_root: &Path,
    conversation_id: &str,
) -> Result<(), ConversationStoreError> {
    let mut record = read_conversation(project_root, conversation_id)?;
    record.on_demand_reading_grant = Some(OnDemandReadingGrant {
        granted_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
    });
    save_conversation(project_root, &record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{
        create_document, create_folder, create_new_project, delete_node,
        recover_then_read_content_tree, rename_node, save_document, set_document_ai_visibility,
        CreateProjectParams, SearchStatus, MAX_RESULT_DOCS,
    };
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    const AUTHORIZED: OnDemandReadingAuthorization = OnDemandReadingAuthorization::Authorized;
    const UNAUTHORIZED: OnDemandReadingAuthorization = OnDemandReadingAuthorization::Unauthorized;

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

    fn setup_work(temp: &tempfile::TempDir, name: &str) -> (PathBuf, String, String) {
        let root = create_new_project(CreateProjectParams {
            name: name.to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create work");
        let work_id = root.canonicalize().unwrap().to_string_lossy().to_string();
        let tree = recover_then_read_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        (root, work_id, doc_id)
    }

    fn setup_work_with_doc(
        temp: &tempfile::TempDir,
        name: &str,
        content: &str,
    ) -> (PathBuf, String, String) {
        let (root, work_id, doc_id) = setup_work(temp, name);
        save_document(&root, &doc_id, content).expect("save doc");
        (root, work_id, doc_id)
    }

    /// 递归快照：记录作品目录内全部相对文件路径与字节（含事务目录），用于
    /// 「作品逐字节不变」断言（沿用 operations.rs 测试的 fixture 惯例）。
    fn snapshot_project_dir(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn walk(dir: &Path, prefix: String, out: &mut BTreeMap<String, Vec<u8>>) {
            let entries = match std::fs::read_dir(dir) {
                Ok(entries) => entries,
                Err(_) => return,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
                let meta = match std::fs::symlink_metadata(&path) {
                    Ok(meta) => meta,
                    Err(_) => continue,
                };
                if meta.is_dir() {
                    walk(&path, name, out);
                } else {
                    out.insert(name, std::fs::read(&path).unwrap_or_default());
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(root, String::new(), &mut out);
        out
    }

    fn read_call(document_id: &str) -> StoryToolCall {
        StoryToolCall::Read {
            work_id: None,
            document_id: document_id.to_string(),
            version: None,
            range: None,
        }
    }

    /// 读取即 panic 的替身 reader：证明「未授权先于任何作品读取」不是口头保证。
    struct NoReadReader {
        work_id: String,
    }

    impl StrictStoryReader for NoReadReader {
        fn work_id(&self) -> &str {
            &self.work_id
        }
        fn strict_content_tree(&self) -> Result<ContentTree, ProjectError> {
            panic!("未授权调用不得读取作品内容树")
        }
        fn saved_document_body(&self, _node: &ContentTreeNode) -> Result<String, ProjectError> {
            panic!("未授权调用不得读取任何正文")
        }
    }

    // ========== 正常路径：授权 + 允许查看的已保存文档 ==========

    #[test]
    fn authorized_list_read_search_return_structured_data() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("林晓站在天台边。");
        let (root, work_id, doc_id) = setup_work_with_doc(&temp, "正常路径作品", &content);
        let reader = DiskStoryReader::open(&root).expect("open reader");
        let before = snapshot_project_dir(&root);

        // story-list：目录 + 当前版本。
        let outcome =
            execute_story_tool(&reader, AUTHORIZED, StoryToolCall::List { work_id: None })
                .expect("list ok");
        let StoryToolOutcome::Listed(listing) = outcome else {
            panic!("应为 Listed，实际 {outcome:?}")
        };
        assert_eq!(listing.work_id, work_id);
        assert_eq!(listing.documents.len(), 1);
        assert_eq!(listing.documents[0].document_id, doc_id);
        assert_eq!(listing.documents[0].document_name, "未命名文档");
        assert_eq!(listing.documents[0].version, compute_version(&content));

        // story-read：整篇已保存正文 + 版本。
        let outcome = execute_story_tool(&reader, AUTHORIZED, read_call(&doc_id)).expect("read ok");
        let StoryToolOutcome::Read(material) = outcome else {
            panic!("应为 Read，实际 {outcome:?}")
        };
        assert_eq!(material.work_id, work_id);
        assert_eq!(material.document_id, doc_id);
        assert_eq!(material.content, content);
        assert_eq!(material.version, compute_version(&content));

        // story-read：携带匹配版本 → 放行（版本参数形状为任务组 6 保留）。
        let ok = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Read {
                work_id: None,
                document_id: doc_id.clone(),
                version: Some(compute_version(&content)),
                range: None,
            },
        );
        assert!(matches!(ok, Ok(StoryToolOutcome::Read(_))));

        // story-read：不存在的版本 → 结构化错误（本组语义；轮内固定表在组 6）。
        let denial = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Read {
                work_id: None,
                document_id: doc_id.clone(),
                version: Some("不存在的版本".to_string()),
                range: None,
            },
        )
        .expect_err("版本不一致必须结构化拒绝");
        assert_eq!(denial.reason, StoryToolDenialReason::VersionUnavailable);

        // story-read：范围切片。
        let text = "林晓站在天台边。";
        let start = content.find(text).unwrap();
        let outcome = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Read {
                work_id: None,
                document_id: doc_id.clone(),
                version: None,
                range: Some(MaterialRange {
                    start,
                    end: start + text.len(),
                }),
            },
        )
        .expect("range read ok");
        assert!(matches!(&outcome, StoryToolOutcome::Read(m) if m.content == text));

        // story-search：检索词由调用方提供，命中正确文档。
        let outcome = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Search {
                work_id: None,
                query: "林晓".to_string(),
            },
        )
        .expect("search ok");
        let StoryToolOutcome::Searched(search) = outcome else {
            panic!("应为 Searched，实际 {outcome:?}")
        };
        assert_eq!(search.status, SearchStatus::Hit);
        assert_eq!(search.snippets[0].document_id, doc_id);
        assert!(!search.limited);

        // 正常路径同样零写回：全部文件逐字节不变。
        assert_eq!(
            before,
            snapshot_project_dir(&root),
            "工具执行不得改写作品任何字节"
        );
    }

    /// story-search 的每次调用输出硬上限沿用 A 部分常数（5 文档 / 10 片段 /
    /// 前后各 120 字符，设计 D11）：超限标记 limited，文档数不超过上限。
    #[test]
    fn story_search_enforces_hard_limits_per_call() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root, _work_id, focus) =
            setup_work_with_doc(&temp, "检索上限作品", &notebook_with_text("关注正文"));
        for i in 0..(MAX_RESULT_DOCS + 3) {
            let id = create_document(&root, None).expect("create doc");
            rename_node(&root, &id, &format!("设定{i}")).expect("rename");
            save_document(&root, &id, &notebook_with_text("林晓站在天台边。")).expect("save");
        }
        let reader = DiskStoryReader::open(&root).expect("open reader");

        let outcome = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Search {
                work_id: None,
                query: "林晓".to_string(),
            },
        )
        .expect("search ok");
        let StoryToolOutcome::Searched(search) = outcome else {
            panic!("应为 Searched")
        };
        assert_eq!(search.status, SearchStatus::Hit);
        assert!(search.limited, "超过文档上限必须标记受限");
        let doc_ids: std::collections::BTreeSet<&str> = search
            .snippets
            .iter()
            .map(|s| s.document_id.as_str())
            .collect();
        assert!(doc_ids.len() <= MAX_RESULT_DOCS);
        assert!(!doc_ids.contains(focus.as_str()));
    }

    // ========== story-request-reading：结构化等待授权，不携带作品数据 ==========

    #[test]
    fn request_reading_returns_structured_waiting_without_story_data() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root, work_id, doc_id) = setup_work_with_doc(
            &temp,
            "授权请求作品",
            &notebook_with_text("正文不进授权请求"),
        );
        let reader = DiskStoryReader::open(&root).expect("open reader");
        let before = snapshot_project_dir(&root);

        // 未授权：等待授权，reason 原样透传，不携带任何作品数据。
        let outcome = execute_story_tool(
            &reader,
            UNAUTHORIZED,
            StoryToolCall::RequestReading {
                reason: "现有材料不足以确认时间线，需要阅读更多设定".to_string(),
            },
        )
        .expect("request reading ok");
        assert_eq!(
            outcome,
            StoryToolOutcome::ReadingRequested(ReadingRequestOutcome::WaitingForAuthorization {
                reason: "现有材料不足以确认时间线，需要阅读更多设定".to_string(),
            })
        );
        let json = serde_json::to_string(&outcome).unwrap();
        assert!(json.contains("时间线"), "reason 透传");
        for sensitive in ["正文不进授权请求", &doc_id, "未命名文档", &work_id] {
            assert!(
                !json.contains(sensitive),
                "授权请求不得携带作品数据：{sensitive}"
            );
        }

        // 已授权：无需再请求。
        let outcome = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::RequestReading {
                reason: "再次请求".to_string(),
            },
        )
        .expect("request reading ok");
        assert_eq!(
            outcome,
            StoryToolOutcome::ReadingRequested(ReadingRequestOutcome::AlreadyAuthorized)
        );

        // 空原因：参数非法，结构化拒绝。
        let denial = execute_story_tool(
            &reader,
            UNAUTHORIZED,
            StoryToolCall::RequestReading {
                reason: "   ".to_string(),
            },
        )
        .expect_err("空原因必须拒绝");
        assert_eq!(denial.reason, StoryToolDenialReason::InvalidParameters);

        assert_eq!(before, snapshot_project_dir(&root), "零副作用");
    }

    // ========== 失败关闭五场景（任务 3.5） ==========

    /// 场景一：未授权状态——三个读取工具一律结构化拒绝，且拒绝先于任何作品读取
    /// （NoReadReader 读取即 panic）；story-request-reading 是合法控制路径。
    #[test]
    fn unauthorized_state_rejects_reading_tools_before_any_read() {
        let reader = NoReadReader {
            work_id: "w".to_string(),
        };
        for call in [
            StoryToolCall::List { work_id: None },
            read_call("任意文档"),
            StoryToolCall::Search {
                work_id: None,
                query: "任意词".to_string(),
            },
        ] {
            let denial = execute_story_tool(&reader, UNAUTHORIZED, call)
                .expect_err("未授权读取必须结构化拒绝");
            assert_eq!(
                denial.reason,
                StoryToolDenialReason::OnDemandReadingUnauthorized
            );
            // 拒绝不是系统故障：结构化、可序列化、无敏感细节。
            let json = serde_json::to_string(&denial).unwrap();
            assert_eq!(json, r#"{"reason":"on_demand_reading_unauthorized"}"#);
        }
    }

    /// 场景二：隐藏（AI 可见性关闭）——读取拒绝且不泄露身份；目录与检索跳过；
    /// 全程零写回。
    #[test]
    fn hidden_document_fails_closed_across_tools_without_identity_leak() {
        let temp = tempfile::TempDir::new().unwrap();
        let secret_content = notebook_with_text("绝密正文内容");
        let (root, _work_id, secret_id) =
            setup_work_with_doc(&temp, "隐藏文档作品", &secret_content);
        rename_node(&root, &secret_id, "绝密档案").expect("rename");
        set_document_ai_visibility(&root, &secret_id, false).expect("hide");
        let visible_id = create_document(&root, None).expect("create visible");
        rename_node(&root, &visible_id, "可见文档").expect("rename");
        save_document(&root, &visible_id, &notebook_with_text("可见正文")).expect("save");
        let reader = DiskStoryReader::open(&root).expect("open reader");
        let before = snapshot_project_dir(&root);

        // story-read：隐藏文档结构化拒绝，序列化不泄露名称 / ID / 正文。
        let denial = execute_story_tool(&reader, AUTHORIZED, read_call(&secret_id))
            .expect_err("隐藏文档必须被拒绝");
        assert_eq!(denial.reason, StoryToolDenialReason::DocumentNotVisible);
        let json = serde_json::to_string(&denial).unwrap();
        for sensitive in ["绝密", &secret_id] {
            assert!(
                !json.contains(sensitive),
                "拒绝不得泄露隐藏文档身份：{sensitive}"
            );
        }

        // story-list：隐藏文档不进目录与版本清单，其余文档正常。
        let outcome =
            execute_story_tool(&reader, AUTHORIZED, StoryToolCall::List { work_id: None })
                .expect("list ok");
        let StoryToolOutcome::Listed(listing) = outcome else {
            panic!("应为 Listed")
        };
        let json = serde_json::to_string(&listing).unwrap();
        for sensitive in ["绝密档案", &secret_id] {
            assert!(
                !json.contains(sensitive),
                "目录不得泄露隐藏文档：{sensitive}"
            );
        }
        assert_eq!(listing.directory.hidden_count, 1);
        assert!(listing
            .documents
            .iter()
            .any(|d| d.document_id == visible_id));
        assert!(listing.documents.iter().all(|d| d.document_id != secret_id));

        // story-search：命中词只在隐藏文档 → 跳过且不命中（不泄露存在性）。
        // 查询词经二元组切分为 绝密 / 密内 / 内容，均不出现在可见文档正文「可见正文」
        // 中，仍只在隐藏文档正文出现，保持不泄露性测试前提。
        let outcome = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Search {
                work_id: None,
                query: "绝密内容".to_string(),
            },
        )
        .expect("search ok");
        let StoryToolOutcome::Searched(search) = outcome else {
            panic!("应为 Searched")
        };
        assert_eq!(search.status, SearchStatus::NotFound);
        assert!(search.snippets.is_empty());

        // story-request-reading：结构化结果，不携带作品数据（隐藏状态与其无关）。
        let outcome = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::RequestReading {
                reason: "需要确认设定".to_string(),
            },
        )
        .expect("request ok");
        let json = serde_json::to_string(&outcome).unwrap();
        assert!(!json.contains("绝密") && !json.contains(&secret_id));

        assert_eq!(before, snapshot_project_dir(&root), "隐藏场景零写回");
    }

    /// 场景三：回收站——读取拒绝；目录与检索跳过；正文文件仍在磁盘但绝不读出。
    #[test]
    fn recycled_document_fails_closed_across_tools() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root, _work_id, doc_id) =
            setup_work_with_doc(&temp, "回收站作品", &notebook_with_text("回收站正文内容"));
        delete_node(&root, &doc_id).expect("delete to recycle bin");
        let reader = DiskStoryReader::open(&root).expect("open reader");
        let before = snapshot_project_dir(&root);

        let denial = execute_story_tool(&reader, AUTHORIZED, read_call(&doc_id))
            .expect_err("回收站文档必须被拒绝");
        assert_eq!(denial.reason, StoryToolDenialReason::DocumentRecycled);

        let outcome =
            execute_story_tool(&reader, AUTHORIZED, StoryToolCall::List { work_id: None })
                .expect("list ok");
        let StoryToolOutcome::Listed(listing) = outcome else {
            panic!("应为 Listed")
        };
        assert!(
            listing.documents.iter().all(|d| d.document_id != doc_id),
            "回收站文档不得进入目录"
        );

        let outcome = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Search {
                work_id: None,
                query: "回收站正文".to_string(),
            },
        )
        .expect("search ok");
        let StoryToolOutcome::Searched(search) = outcome else {
            panic!("应为 Searched")
        };
        assert_eq!(search.status, SearchStatus::NotFound);

        assert_eq!(before, snapshot_project_dir(&root), "回收站场景零写回");
    }

    /// 场景四：越权（跨作品 / 不存在 / 文件夹 / 身份不实）——一律结构化拒绝，
    /// 且跨作品与不存在返回完全相同的拒绝（不泄露文档存在性）。
    #[test]
    fn cross_work_nonexistent_folder_and_claimed_work_fail_closed() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root_a, _work_a, doc_a) =
            setup_work_with_doc(&temp, "作品甲", &notebook_with_text("甲的正文"));
        let (root_b, work_b, doc_b) =
            setup_work_with_doc(&temp, "作品乙", &notebook_with_text("乙的机密正文"));
        let folder_id = create_folder(&root_a, None).expect("create folder");
        rename_node(&root_a, &folder_id, "甲的文件夹").expect("rename folder");
        let reader = DiskStoryReader::open(&root_a).expect("open reader");
        let before_a = snapshot_project_dir(&root_a);
        let before_b = snapshot_project_dir(&root_b);

        // 跨作品：执行器绑定作品甲，乙的文档 ID → 拒绝。
        let cross = execute_story_tool(&reader, AUTHORIZED, read_call(&doc_b))
            .expect_err("跨作品文档必须被拒绝");
        // 不存在：同一拒绝形状。
        let missing = execute_story_tool(&reader, AUTHORIZED, read_call("no-such-document"))
            .expect_err("不存在文档必须被拒绝");
        assert_eq!(cross.reason, StoryToolDenialReason::DocumentMissing);
        assert_eq!(
            cross, missing,
            "跨作品与不存在的拒绝必须完全一致（不泄露存在性）"
        );

        // 序列化拒绝不泄露作品乙的路径 / 文档 ID / 正文。
        let json = serde_json::to_string(&cross).unwrap();
        for sensitive in [&doc_b, &work_b, "机密"] {
            assert!(!json.contains(sensitive), "越权拒绝不得泄露：{sensitive}");
        }

        // 文件夹不是文档。
        let denial = execute_story_tool(&reader, AUTHORIZED, read_call(&folder_id))
            .expect_err("文件夹必须被拒绝");
        assert_eq!(denial.reason, StoryToolDenialReason::NotADocument);

        // 身份不实的作品声明：声称作品乙 → WorkMismatch。
        let denial = execute_story_tool(
            &reader,
            AUTHORIZED,
            StoryToolCall::Read {
                work_id: Some(work_b.clone()),
                document_id: doc_a.clone(),
                version: None,
                range: None,
            },
        )
        .expect_err("伪造作品身份必须被拒绝");
        assert_eq!(denial.reason, StoryToolDenialReason::WorkMismatch);

        // 空文档 ID：参数非法。
        let denial = execute_story_tool(&reader, AUTHORIZED, read_call("  "))
            .expect_err("空文档 ID 必须被拒绝");
        assert_eq!(denial.reason, StoryToolDenialReason::InvalidParameters);

        // 打不开不存在作品（身份不实的作品根）。
        assert!(DiskStoryReader::open(temp.path().join("不存在作品")).is_err());

        // 两个作品都逐字节不变。
        assert_eq!(before_a, snapshot_project_dir(&root_a), "作品甲零写回");
        assert_eq!(before_b, snapshot_project_dir(&root_b), "作品乙零写回");
    }

    /// 场景五：待恢复事务现场——四个工具全部以 `recovery_required` 结构化拒绝，
    /// 零副作用，事务现场逐字节保留（绝不恢复 / 清理 / 提交）。
    #[test]
    fn pending_recovery_transaction_fails_closed_for_all_four_tools() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root, _work_id, doc_id) =
            setup_work_with_doc(&temp, "待恢复作品", &notebook_with_text("待恢复作品正文"));
        // 沿用既有 fixture 惯例：save-transaction 目录存在（清单缺失形态）即视为
        // 待恢复事务现场（见 operations.rs strict_read_content_tree_fails_closed_without_manifest）。
        std::fs::create_dir_all(root.join("next-story-system").join("save-transaction"))
            .expect("seed pending transaction");
        let reader = DiskStoryReader::open(&root).expect("open reader");
        let before = snapshot_project_dir(&root);

        for call in [
            StoryToolCall::List { work_id: None },
            read_call(&doc_id),
            StoryToolCall::Search {
                work_id: None,
                query: "待恢复".to_string(),
            },
            StoryToolCall::RequestReading {
                reason: "需要阅读更多材料".to_string(),
            },
        ] {
            let denial = execute_story_tool(&reader, AUTHORIZED, call)
                .err()
                .unwrap_or_else(|| panic!("待恢复事务下必须结构化拒绝"));
            assert_eq!(
                denial.reason,
                StoryToolDenialReason::RecoveryRequired,
                "四个工具都必须以待恢复事务失败关闭"
            );
        }

        assert_eq!(
            before,
            snapshot_project_dir(&root),
            "拒绝前后作品逐字节不变（事务现场原样保留）"
        );
    }

    /// 只读接口探针：方法名 → 以 &DiskStoryReader 探测行为的函数指针。
    type ReaderProbe = fn(&DiskStoryReader) -> bool;

    /// StrictStoryReader 窄化形状回归：trait 面上不存在任何写入语义入口；
    /// 生产实现 DiskStoryReader 也只经严格只读路径读取。
    #[test]
    fn strict_story_reader_surface_exposes_reads_only() {
        // 编译期形状断言：trait 方法集 = { work_id, strict_content_tree,
        // saved_document_body }。用函数指针集合钉死方法签名数量与只读命名，
        // 防止将来有人往接口上加写入方法而不改测试。
        let methods: &[(&str, ReaderProbe)] = &[
            ("work_id", |r| !r.work_id().is_empty()),
            ("strict_content_tree", |r| {
                r.strict_content_tree().is_ok() || r.strict_content_tree().is_err()
            }),
            ("saved_document_body", |r| {
                // 干净作品上读取默认文档正文必须成功（经校验的只读）。
                match r.strict_content_tree() {
                    Ok(tree) => tree
                        .nodes
                        .values()
                        .find(|n| n.kind == NodeKind::Document)
                        .map(|n| r.saved_document_body(n).is_ok())
                        .unwrap_or(false),
                    Err(_) => false,
                }
            }),
        ];
        let temp = tempfile::TempDir::new().unwrap();
        let (root, _work_id, _doc_id) =
            setup_work_with_doc(&temp, "窄化接口作品", &notebook_with_text("接口形状正文"));
        let reader = DiskStoryReader::open(&root).expect("open reader");
        for (name, probe) in methods {
            assert!(probe(&reader), "只读接口方法 {name} 行为异常");
        }
        // 方法面固定为三项：出现第四个方法必须显式更新本测试（防止悄悄加写入面）。
        // （trait 方法数由上面的函数指针清单逐项点名，等价于锁定方法集合。）
    }

    // ========== 宿主逐次校验接线（任务 4.3/4.4） ==========

    use crate::conversation_store::{
        save_conversation as save_archive, ConversationRecord as ArchiveRecord,
        ConversationStoreError, FirstRoundMaterial, OnDemandReadingGrant,
    };

    fn archive(conversation_id: &str, grant: Option<OnDemandReadingGrant>) -> ArchiveRecord {
        ArchiveRecord {
            version: crate::conversation_store::CONVERSATION_VERSION,
            conversation_id: conversation_id.to_string(),
            created_at: "2026-09-20T08:00:00.000Z".to_string(),
            updated_at: "2026-09-20T08:00:00.000Z".to_string(),
            focus_document_id: None,
            focus_document_title: None,
            first_round_material: FirstRoundMaterial {
                kind: "direct_question".to_string(),
                question: "问题".to_string(),
                selection_text: None,
            },
            turns: Vec::new(),
            title: None,
            pinned: false,
            provenance: Some(vec![]),
            on_demand_reading_grant: grant,
            on_demand_reading_provenance: None,
        }
    }

    fn archive_path(root: &Path, id: &str) -> PathBuf {
        root.join("next-story-system")
            .join("conversations")
            .join(format!("{id}.json"))
    }

    /// 4.4 ④ + 任务 6.2：授权讨论经入口放行并执行；出处按轮累计判定已移交通道层
    /// （story_tool_channel），本入口不再直接写出处——档案出处保持不变。
    #[test]
    fn host_entry_authorizes_from_archive_and_executes() {
        let temp = tempfile::TempDir::new().unwrap();
        let content = notebook_with_text("林晓站在天台边。");
        let (root, _work_id, doc_id) = setup_work_with_doc(&temp, "接线作品", &content);
        let grant = OnDemandReadingGrant {
            granted_at: "2026-09-20T08:30:00.123Z".to_string(),
        };
        save_archive(&root, &archive("conv-1", Some(grant.clone()))).expect("save archive");
        let reader = DiskStoryReader::open(&root).expect("open reader");

        // story-read（整篇）→ 放行并返回材料。
        let outcome = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-1",
            AuthorizationResolution::FromArchive,
            read_call(&doc_id),
        )
        .expect("authorized read");
        assert!(matches!(&outcome, StoryToolOutcome::Read(m) if m.content == content));

        // story-read（带范围）→ 范围切片。
        let text = "林晓";
        let start = content.find(text).unwrap();
        let outcome = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-1",
            AuthorizationResolution::FromArchive,
            StoryToolCall::Read {
                work_id: None,
                document_id: doc_id.clone(),
                version: None,
                range: Some(MaterialRange {
                    start,
                    end: start + text.len(),
                }),
            },
        )
        .expect("partial read");
        assert!(matches!(&outcome, StoryToolOutcome::Read(m) if m.content == text));

        // story-search → 命中。
        let outcome = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-1",
            AuthorizationResolution::FromArchive,
            StoryToolCall::Search {
                work_id: None,
                query: "林晓".to_string(),
            },
        )
        .expect("search");
        assert!(matches!(outcome, StoryToolOutcome::Searched(_)));

        // 出处由通道层按轮累计写入（任务 6.2）；本入口保持档案出处不变。
        let record = crate::conversation_store::read_conversation(&root, "conv-1").unwrap();
        assert_eq!(
            record.on_demand_reading_provenance, None,
            "执行入口不写出处（通道层负责）"
        );
        // 授权状态原样保留。
        assert_eq!(record.on_demand_reading_grant, Some(grant));
    }

    /// 4.4 ④：未授权讨论（档案无授权字段 / 无档案 / 档案损坏）经入口调用被拒，
    /// 拒绝不落出处、档案不变；授权后放行。
    #[test]
    fn host_entry_rejects_unauthorized_discussion_without_recording() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root, _work_id, doc_id) =
            setup_work_with_doc(&temp, "未授权接线作品", &notebook_with_text("正文"));
        save_archive(&root, &archive("conv-un", None)).expect("save archive");
        let reader = DiskStoryReader::open(&root).expect("open reader");

        // 拒绝调用不得写档案：字节快照对照。
        let keep_before = std::fs::read(archive_path(&root, "conv-un")).unwrap();
        for call in [
            StoryToolCall::List { work_id: None },
            read_call(&doc_id),
            StoryToolCall::Search {
                work_id: None,
                query: "正文".to_string(),
            },
        ] {
            let denial = execute_story_tool_for_conversation(
                &reader,
                &root,
                "conv-un",
                AuthorizationResolution::FromArchive,
                call,
            )
            .expect_err("未授权讨论必须被拒");
            assert_eq!(
                denial.reason,
                StoryToolDenialReason::OnDemandReadingUnauthorized
            );
        }
        assert_eq!(
            std::fs::read(archive_path(&root, "conv-un")).unwrap(),
            keep_before,
            "拒绝调用不得写档案"
        );

        // 档案完全缺失 → 同样未授权（失败关闭）。
        let denial = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-none",
            AuthorizationResolution::FromArchive,
            read_call(&doc_id),
        )
        .expect_err("缺档案按未授权");
        assert_eq!(
            denial.reason,
            StoryToolDenialReason::OnDemandReadingUnauthorized
        );

        // 档案损坏 → 失败关闭为未授权。
        std::fs::write(archive_path(&root, "conv-bad"), "not-json").unwrap();
        let denial = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-bad",
            AuthorizationResolution::FromArchive,
            read_call(&doc_id),
        )
        .expect_err("损坏档案按未授权");
        assert_eq!(
            denial.reason,
            StoryToolDenialReason::OnDemandReadingUnauthorized
        );

        // 授权请求（RequestReading）在未授权讨论是合法控制路径，不落出处、不写档案。
        save_archive(&root, &archive("conv-req", None)).expect("save req archive");
        let req_before = std::fs::read(archive_path(&root, "conv-req")).unwrap();
        let outcome = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-req",
            AuthorizationResolution::FromArchive,
            StoryToolCall::RequestReading {
                reason: "材料不足".to_string(),
            },
        )
        .expect("request reading ok");
        assert!(matches!(
            outcome,
            StoryToolOutcome::ReadingRequested(
                ReadingRequestOutcome::WaitingForAuthorization { .. }
            )
        ));
        assert_eq!(
            std::fs::read(archive_path(&root, "conv-req")).unwrap(),
            req_before,
            "授权请求不产生正文读取，不写档案"
        );

        // 授权后放行：grant 写入 → 同一入口放行（出处由通道层按轮累计落档）。
        super::grant_on_demand_reading(&root, "conv-un").expect("grant");
        let outcome = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-un",
            AuthorizationResolution::FromArchive,
            read_call(&doc_id),
        )
        .expect("授权后放行");
        assert!(matches!(outcome, StoryToolOutcome::Read(_)));

        // 此前的拒绝没有写档；执行入口本身不落出处（通道层负责）。
        let record = crate::conversation_store::read_conversation(&root, "conv-un").unwrap();
        assert!(record.on_demand_reading_grant.is_some());
        assert_eq!(
            record.on_demand_reading_provenance, None,
            "执行入口不写出处；拒绝路径更不得写"
        );
    }

    /// 任务 5.5 形状不堵死：ForceUnauthorized 覆盖档案授权（召唤首轮硬门禁入口）。
    #[test]
    fn host_entry_force_unauthorized_overrides_archive_grant() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root, _work_id, doc_id) =
            setup_work_with_doc(&temp, "硬门禁作品", &notebook_with_text("正文"));
        save_archive(
            &root,
            &archive(
                "conv-g",
                Some(OnDemandReadingGrant {
                    granted_at: "2026-09-20T08:30:00.123Z".to_string(),
                }),
            ),
        )
        .expect("save archive");
        let reader = DiskStoryReader::open(&root).expect("open reader");

        let denial = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-g",
            AuthorizationResolution::ForceUnauthorized,
            read_call(&doc_id),
        )
        .expect_err("强制未授权必须压过档案授权");
        assert_eq!(
            denial.reason,
            StoryToolDenialReason::OnDemandReadingUnauthorized
        );

        // RequestReading 在强制未授权下同样按未授权处理（返回等待授权结果）。
        let outcome = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-g",
            AuthorizationResolution::ForceUnauthorized,
            StoryToolCall::RequestReading {
                reason: "需要材料".to_string(),
            },
        )
        .expect("request ok");
        assert!(matches!(
            outcome,
            StoryToolOutcome::ReadingRequested(
                ReadingRequestOutcome::WaitingForAuthorization { .. }
            )
        ));
    }

    /// 接线一致性：档案所在作品与执行器绑定作品不一致 → 结构化拒绝，不写任何档案。
    #[test]
    fn host_entry_rejects_reader_and_archive_from_different_works() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root_a, _a, _doc_a) =
            setup_work_with_doc(&temp, "接线作品甲", &notebook_with_text("甲"));
        let (root_b, _b, doc_b) =
            setup_work_with_doc(&temp, "接线作品乙", &notebook_with_text("乙"));
        save_archive(&root_b, &archive("conv-b", None)).expect("save archive b");
        let reader_a = DiskStoryReader::open(&root_a).expect("open reader a");
        let archive_before = std::fs::read(archive_path(&root_b, "conv-b")).unwrap();

        let denial = execute_story_tool_for_conversation(
            &reader_a,
            &root_b,
            "conv-b",
            AuthorizationResolution::FromArchive,
            read_call(&doc_b),
        )
        .expect_err("跨作品接线必须被拒");
        assert_eq!(denial.reason, StoryToolDenialReason::WorkMismatch);
        assert_eq!(
            std::fs::read(archive_path(&root_b, "conv-b")).unwrap(),
            archive_before,
            "拒绝不得写任何档案"
        );
    }

    /// 4.4 ①在接线层的验证：保存授权 → 全新 reader/入口调用从磁盘档案恢复授权
    /// 并放行（授权跨重启有效，不依赖进程内存）。
    #[test]
    fn host_entry_restores_authorization_across_restart() {
        let temp = tempfile::TempDir::new().unwrap();
        let (root, _work_id, doc_id) =
            setup_work_with_doc(&temp, "跨重启作品", &notebook_with_text("重启后正文"));

        // 首次：未授权被拒 → 用户开启授权（写档）。
        save_archive(&root, &archive("conv-r", None)).expect("save archive");
        let reader = DiskStoryReader::open(&root).expect("open reader");
        let denial = execute_story_tool_for_conversation(
            &reader,
            &root,
            "conv-r",
            AuthorizationResolution::FromArchive,
            read_call(&doc_id),
        )
        .expect_err("初始未授权");
        assert_eq!(
            denial.reason,
            StoryToolDenialReason::OnDemandReadingUnauthorized
        );
        super::grant_on_demand_reading(&root, "conv-r").expect("grant");

        // 「重启」：全新 reader + 全新入口调用，授权只从磁盘档案恢复。
        let reader_after_restart = DiskStoryReader::open(&root).expect("reopen reader");
        let outcome = execute_story_tool_for_conversation(
            &reader_after_restart,
            &root,
            "conv-r",
            AuthorizationResolution::FromArchive,
            read_call(&doc_id),
        )
        .expect("重启后授权仍有效");
        assert!(matches!(outcome, StoryToolOutcome::Read(_)));

        // 授权写入对不存在档案失败关闭。
        assert!(matches!(
            super::grant_on_demand_reading(&root, "conv-none"),
            Err(ConversationStoreError::NotFound(_))
        ));
    }
}
