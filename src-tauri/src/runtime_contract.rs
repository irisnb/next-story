//! Next Story 与 AI 核心之间的 Runtime Contract。
//!
//! 产品内部类型，与前端 `GenerateAiRequest` / `GenerateAiResult` 契约解耦：
//! 前端契约保持稳定；本模块定义「宿主如何向 AI 核心提交任务、声明能力、
//! 收取结果」。文本生成、常驻会话的流式输出与取消、按需补读的工具调用
//! 已实现并由能力网关授权；多 Agent 仍为未来扩展位，不把核心压成 `String -> String`。

use serde::{Deserialize, Serialize};

use crate::llm_config::GenerateAiError;

/// AI 核心能力。文本生成、流式输出、取消与工具调用已实现并由能力网关放行；
/// 工具调用限于受控只读补读，多 Agent 仍为未来扩展位，当前由能力网关拒绝。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreCapability {
    /// 文本生成（已实现并授权，支持常驻会话的首轮与追问）。
    TextGeneration,
    /// 流式输出（随常驻会话实现并授权）。
    Streaming,
    /// 工具调用（随按需补读实现并授权，限于受控只读工具）。
    ToolCall,
    /// 多 Agent / 子 Agent（未来扩展位）。
    MultiAgent,
    /// 任务取消（随常驻会话实现并授权）。
    Cancellation,
}

/// 提交给 AI 核心的一次任务。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeTask {
    /// 任务标识，用于日志、诊断与事件/取消关联。
    pub id: String,
    /// 本任务申请的能力。
    pub capability: CoreCapability,
    /// 已组装好的完整自包含任务文本（冻结选区 + 可选方向 + 追问轮次）。
    pub prompt: String,
}

impl RuntimeTask {
    /// 构造一个文本生成任务。
    pub fn generate(id: impl Into<String>, prompt: impl Into<String>) -> Self {
        RuntimeTask {
            id: id.into(),
            capability: CoreCapability::TextGeneration,
            prompt: prompt.into(),
        }
    }
}

/// 任务终态结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeOutcome {
    /// 成功，携带最终文本。
    Completed { content: String },
    /// 失败，携带稳定错误。
    Failed { error: GenerateAiError },
    /// 被取消（常驻会话的取消路径已实现）。
    Cancelled,
}

impl RuntimeOutcome {
    pub fn completed(content: impl Into<String>) -> Self {
        RuntimeOutcome::Completed {
            content: content.into(),
        }
    }

    pub fn failed(error: GenerateAiError) -> Self {
        RuntimeOutcome::Failed { error }
    }
}

impl From<Result<String, GenerateAiError>> for RuntimeOutcome {
    fn from(result: Result<String, GenerateAiError>) -> Self {
        match result {
            Ok(content) => RuntimeOutcome::completed(content),
            Err(error) => RuntimeOutcome::failed(error),
        }
    }
}
