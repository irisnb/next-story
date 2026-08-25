//! 使用唯一保存配置，通过 DSH headless 生成 AI 思考材料。
//!
//! 只接收选区原文（含可选方向与追问轮次），由本模块集中组装固定首版思考任务，
//! 序列化为单个 task 字符串交给 DSH。前端不传入 API Key，也不持有任何写入
//! 草稿本或正文本的入口。

use std::path::{Path, PathBuf};

use super::{
    validate_llm_config, FollowUpOrigin, GenerateAiError, GenerateAiErrorCode,
    GenerateAiMessageRole, GenerateAiRequest, LlmConfig,
};
use crate::dsh_sidecar::{self, DshGenerationParams};
use crate::dsh_version::DshVersionLayout;

/// 固定首版思考任务：围绕冻结选区提出观察、问题和可能方向，不代写正文。
/// 该职责集中在后端生成用例，不散落在 DOM 事件、前端桥接或底层 HTTP 模块。
const FIXED_SYSTEM_PROMPT: &str = "你是陪剧本创作者思考的助手。当前请求只提供冻结选区原文，以及用户可选的探索方向。\
你只能基于这段选区原文回应；若提供了探索方向，把它当作用户希望继续探索的角度，而不是作品事实或最终判断。\
先区分从文字里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。\
追问仍锚定首次冻结选区；只把已有轮次当作当前临时线性对话，不当作持久历史，不当作作品事实。\
不直接改草稿本或正文本，不代写正文，不润色，不提供替换文本，不判断故事好坏，不判断正确或错误，不判断高级或低级。\
不能声称读取或使用选区前后文；不能声称读取或使用当前本子全文；不能声称读取或使用摘要；不能声称读取或使用作品元数据；不能声称读取或使用AI 内容库；不能声称读取或使用历史会话；不能声称读取或使用记忆；不能声称读取或使用用户确认的作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

/// 直接提问的固定系统提示词：围绕用户问题与可选选区重点材料思考，不代写正文。
/// 与选区召唤共用输出边界，但把「用户问题」作为明确请求、选区作为可选重点材料。
const DIRECT_QUESTION_SYSTEM_PROMPT: &str = "你是陪剧本创作者思考的助手。当前请求提供用户直接提出的问题，以及用户可选的选区重点材料。\
你只能基于用户问题与提供的重点材料回应；若提供了重点材料，把它当作用户希望重点参考的片段，而不是作品事实或最终判断。\
先区分从材料里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。\
不直接改草稿本或正文本，不代写正文，不润色，不提供替换文本，不判断故事好坏，不判断正确或错误，不判断高级或低级。\
不能声称读取或使用选区前后文；不能声称读取或使用当前本子全文；不能声称读取或使用摘要；不能声称读取或使用作品元数据；不能声称读取或使用AI 内容库；不能声称读取或使用历史会话；不能声称读取或使用记忆；不能声称读取或使用用户确认的作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

/// 使用唯一保存配置，围绕选区原文发起一次真实非流式生成（DSH headless）。
///
/// 使用 DSH 默认 home 与开发目录；测试路径使用本函数，生产命令入口使用
/// [`generate_ai_thinking_in_dir`]（版本隔离 home + 资源目录）。
pub async fn generate_ai_thinking(
    config: &LlmConfig,
    request: impl Into<GenerateAiRequest>,
) -> Result<String, GenerateAiError> {
    let request = request.into();
    generate_with_dsh(config, &request, None, None).await
}

/// 从应用数据目录与资源目录生成：用版本隔离的 DSH_HOME（`<base_dir>/dsh/homes/<current>`）
/// 与打包后的资源目录解析 sidecar。生产命令入口使用本函数。
pub async fn generate_ai_thinking_in_dir(
    config: &LlmConfig,
    request: impl Into<GenerateAiRequest>,
    base_dir: &Path,
    resource_dir: Option<&Path>,
) -> Result<String, GenerateAiError> {
    let request = request.into();
    generate_with_dsh(
        config,
        &request,
        Some(versioned_dsh_home(base_dir)),
        resource_dir,
    )
    .await
}

/// 通过 DSH headless 生成一次回复。
///
/// DSH 一次性任务模型接收单个 task 字符串，因此把固定系统提示词、选区原文、
/// 可选方向与追问轮次序列化进一个 task；spike 已验证「整段对话序列化进一个 task」
/// 的追问仍锚定首次冻结选区。子进程 spawn 是阻塞操作，放进阻塞线程避免占住异步执行线程。
/// 超时由 [`crate::dsh_sidecar::DSH_GENERATION_TIMEOUT`] 控制。
///
/// `dsh_home` 为版本隔离的 DSH_HOME；`None` 表示沿用 DSH 默认 home（仅测试路径）。
/// `resource_dir` 为打包后的资源目录；`None` 表示开发目录回退。
async fn generate_with_dsh(
    config: &LlmConfig,
    request: &GenerateAiRequest,
    dsh_home: Option<PathBuf>,
    resource_dir: Option<&Path>,
) -> Result<String, GenerateAiError> {
    let task = build_task_string(request)?;

    validate_llm_config(config).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置不完整，请检查 API 地址、Key 与模型名",
        )
    })?;

    let paths = dsh_sidecar::resolve_paths(dsh_home, resource_dir)?;
    let params = DshGenerationParams {
        model: config.model.clone(),
        api_base_url: config.api_base_url.clone(),
        api_key: config.api_key.clone(),
    };

    match tauri::async_runtime::spawn_blocking(move || {
        dsh_sidecar::generate_via_dsh(&task, &params, &paths)
    })
    .await
    {
        Ok(Ok(content)) => Ok(content),
        Ok(Err(error)) => Err(error),
        Err(join_error) => Err(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("DSH 生成任务执行失败: {join_error}"),
        )),
    }
}

/// 从应用数据目录派生版本隔离的 DSH_HOME（`<base_dir>/dsh/homes/<current_version>`）。
fn versioned_dsh_home(base_dir: &Path) -> PathBuf {
    DshVersionLayout::new(base_dir.join("dsh")).current_home()
}

/// 把请求序列化为单个 DSH task 字符串：固定系统提示词 + 选区原文（含可选方向）
/// + 追问轮次（按角色标注），保持无状态临时对话语义。
pub fn build_task_string(request: &GenerateAiRequest) -> Result<String, GenerateAiError> {
    validate_generate_ai_request(request)?;

    let mut task = String::new();
    match request {
        GenerateAiRequest::First {
            selected_text,
            thinking_direction,
        } => {
            task.push_str(FIXED_SYSTEM_PROMPT);
            task.push_str("\n\n");
            task.push_str(&first_user_content(selected_text, thinking_direction.as_deref()));
        }
        GenerateAiRequest::FollowUp {
            selected_text,
            thinking_direction,
            origin,
            messages,
        } => {
            let is_direct = matches!(origin, Some(FollowUpOrigin::DirectQuestion));
            if is_direct {
                // 直接提问来源：messages 以 user 原问题开头，选区作为可选重点材料。
                task.push_str(DIRECT_QUESTION_SYSTEM_PROMPT);
                task.push_str("\n\n");
                if let Some(first) = messages.first() {
                    task.push_str(&format!("用户问题：\n{}", first.content));
                }
                let trimmed_selection = selected_text.trim();
                if !trimmed_selection.is_empty() {
                    task.push_str(&format!("\n\n重点参考材料（可选）：\n{}", trimmed_selection));
                }
                for turn in messages.iter().skip(1) {
                    task.push_str("\n\n");
                    match turn.role {
                        GenerateAiMessageRole::User => {
                            task.push_str(&format!("用户追问：{}", turn.content))
                        }
                        GenerateAiMessageRole::Assistant => {
                            task.push_str(&format!("你的上一次回应：{}", turn.content))
                        }
                    }
                }
            } else {
                task.push_str(FIXED_SYSTEM_PROMPT);
                task.push_str("\n\n");
                task.push_str(&first_user_content(selected_text, thinking_direction.as_deref()));
                for turn in messages {
                    task.push_str("\n\n");
                    match turn.role {
                        GenerateAiMessageRole::User => {
                            task.push_str(&format!("用户追问：{}", turn.content))
                        }
                        GenerateAiMessageRole::Assistant => {
                            task.push_str(&format!("你的上一次回应：{}", turn.content))
                        }
                    }
                }
            }
        }
        GenerateAiRequest::DirectQuestion {
            question,
            selected_text,
        } => {
            task.push_str(DIRECT_QUESTION_SYSTEM_PROMPT);
            task.push_str("\n\n");
            task.push_str(&direct_question_user_content(question, selected_text.as_deref()));
        }
    }

    Ok(task)
}

fn invalid_request() -> GenerateAiError {
    GenerateAiError::new(
        GenerateAiErrorCode::InvalidResponse,
        "AI 请求内容无效，请重试",
    )
}

pub fn validate_generate_ai_request(
    request: &GenerateAiRequest,
) -> Result<(), GenerateAiError> {
    match request {
        GenerateAiRequest::First { selected_text, .. } => {
            if selected_text.trim().is_empty() {
                return Err(invalid_request());
            }
        }
        GenerateAiRequest::FollowUp {
            selected_text,
            origin,
            messages,
            ..
        } => {
            let is_direct = matches!(origin, Some(FollowUpOrigin::DirectQuestion));
            // 直接提问来源允许空 selected_text（无选区直接提问）；selection 来源仍要求非空。
            if !is_direct && selected_text.trim().is_empty() {
                return Err(invalid_request());
            }

            if messages.is_empty() {
                return Err(invalid_request());
            }

            for (index, turn) in messages.iter().enumerate() {
                if turn.content.trim().is_empty() {
                    return Err(invalid_request());
                }

                // 直接提问来源以 user 原问题开头；selection 来源以 assistant 首轮回应开头。
                let expected_role = if is_direct {
                    if index % 2 == 0 {
                        GenerateAiMessageRole::User
                    } else {
                        GenerateAiMessageRole::Assistant
                    }
                } else if index % 2 == 0 {
                    GenerateAiMessageRole::Assistant
                } else {
                    GenerateAiMessageRole::User
                };
                if turn.role != expected_role {
                    return Err(invalid_request());
                }
            }

            if messages.last().map(|turn| turn.role) != Some(GenerateAiMessageRole::User) {
                return Err(invalid_request());
            }
        }
        GenerateAiRequest::DirectQuestion { question, .. } => {
            if question.trim().is_empty() {
                return Err(invalid_request());
            }
        }
    }

    Ok(())
}

fn first_user_content(selected_text: &str, thinking_direction: Option<&str>) -> String {
    match thinking_direction.map(str::trim).filter(|d| !d.is_empty()) {
        Some(direction) => format!(
            "选区原文：\n{selected_text}\n\n用户希望探索的角度（不是作品事实或最终判断）：\n{direction}"
        ),
        None => selected_text.to_string(),
    }
}

/// 直接提问的用户内容：必填问题 + 可选选区重点材料，二者明确区分。
fn direct_question_user_content(question: &str, selected_text: Option<&str>) -> String {
    match selected_text.map(str::trim).filter(|s| !s.is_empty()) {
        Some(selection) => format!(
            "用户问题：\n{question}\n\n重点参考材料（可选）：\n{selection}"
        ),
        None => format!("用户问题：\n{question}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm_config::GenerateAiMessage;

    #[test]
    fn build_task_string_for_first_includes_system_prompt_and_selection() {
        let request = GenerateAiRequest::First {
            selected_text: "林站在天台边。".to_string(),
            thinking_direction: None,
        };
        let task = build_task_string(&request).expect("build task");
        assert!(task.contains(FIXED_SYSTEM_PROMPT), "必须包含固定系统提示词");
        assert!(task.contains("林站在天台边。"), "必须包含选区原文");
    }

    #[test]
    fn build_task_string_for_follow_up_preserves_turns_and_roles() {
        let request = GenerateAiRequest::FollowUp {
            selected_text: "林站在天台边。".to_string(),
            thinking_direction: None,
            origin: None,
            messages: vec![
                GenerateAiMessage {
                    role: GenerateAiMessageRole::Assistant,
                    content: "他为什么站上天台？".to_string(),
                },
                GenerateAiMessage {
                    role: GenerateAiMessageRole::User,
                    content: "我还没想清楚。".to_string(),
                },
            ],
        };
        let task = build_task_string(&request).expect("build task");
        assert!(task.contains("你的上一次回应：他为什么站上天台？"));
        assert!(task.contains("用户追问：我还没想清楚。"));
        assert!(task.contains("林站在天台边。"), "追问仍锚定原选区");
    }

    #[test]
    fn build_task_string_rejects_empty_selection() {
        let request = GenerateAiRequest::First {
            selected_text: "   ".to_string(),
            thinking_direction: None,
        };
        let err = build_task_string(&request).expect_err("empty selection rejected");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);
    }

    #[test]
    fn direct_question_without_selection_builds_task_with_question_only() {
        let request = GenerateAiRequest::DirectQuestion {
            question: "这个角色为什么犹豫？".to_string(),
            selected_text: None,
        };
        let task = build_task_string(&request).expect("build task");
        assert!(task.contains(DIRECT_QUESTION_SYSTEM_PROMPT), "必须包含直接提问系统提示词");
        assert!(task.contains("用户问题：\n这个角色为什么犹豫？"));
        assert!(!task.contains("重点参考材料"), "无选区时不得出现重点参考材料");
    }

    #[test]
    fn direct_question_with_selection_distinguishes_question_and_material() {
        let request = GenerateAiRequest::DirectQuestion {
            question: "这段里人物在隐瞒什么？".to_string(),
            selected_text: Some("林站在天台边，没有回头。".to_string()),
        };
        let task = build_task_string(&request).expect("build task");
        assert!(task.contains("用户问题：\n这段里人物在隐瞒什么？"));
        assert!(task.contains("重点参考材料（可选）：\n林站在天台边，没有回头。"));
    }

    #[test]
    fn direct_question_rejects_blank_question() {
        let request = GenerateAiRequest::DirectQuestion {
            question: "   \n  ".to_string(),
            selected_text: Some("选区".to_string()),
        };
        let err = build_task_string(&request).expect_err("blank question rejected");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);
    }

    #[test]
    fn direct_question_system_prompt_declares_grounding_and_output_boundaries() {
        for required in [
            "用户直接提出的问题",
            "用户可选的选区重点材料",
            "不直接改草稿本或正文本",
            "不代写正文",
            "不判断故事好坏",
        ] {
            assert!(
                DIRECT_QUESTION_SYSTEM_PROMPT.contains(required),
                "直接提问系统提示词缺少约束: {required}"
            );
        }
        for prohibited_claim in [
            "选区前后文",
            "当前本子全文",
            "摘要",
            "作品元数据",
            "AI 内容库",
            "历史会话",
            "记忆",
            "用户确认的作品事实",
        ] {
            let expected = format!("不能声称读取或使用{prohibited_claim}");
            assert!(
                DIRECT_QUESTION_SYSTEM_PROMPT.contains(&expected),
                "直接提问系统提示词缺少不可用上下文声明: {expected}"
            );
        }
    }

    /// 固定系统提示词必须声明 grounding 边界、不代写正文、不判断故事好坏，
    /// 并明确拒绝读取任何不可用上下文。这是铁律 2/3 在提示词层的落地。
    #[test]
    fn fixed_system_prompt_declares_grounding_and_output_boundaries() {
        for required in [
            "冻结选区原文",
            "只能基于这段选区原文",
            "不直接改草稿本或正文本",
            "不代写正文",
            "不润色",
            "不提供替换文本",
            "不判断故事好坏",
            "不判断正确或错误",
            "不判断高级或低级",
            "追问仍锚定首次冻结选区",
            "只把已有轮次当作当前临时线性对话",
        ] {
            assert!(
                FIXED_SYSTEM_PROMPT.contains(required),
                "固定系统提示词缺少约束: {required}"
            );
        }
        for prohibited_claim in [
            "选区前后文",
            "当前本子全文",
            "摘要",
            "作品元数据",
            "AI 内容库",
            "历史会话",
            "记忆",
            "用户确认的作品事实",
        ] {
            let expected = format!("不能声称读取或使用{prohibited_claim}");
            assert!(
                FIXED_SYSTEM_PROMPT.contains(&expected),
                "固定系统提示词缺少不可用上下文声明: {expected}"
            );
        }
    }
}
