//! Next Story 能力网关：AI 核心能做什么、不能做什么的权威声明。
//!
//! 铁律 1：AI 永远不直接改用户文档（不插入/追加/替换/改写/删除/移动/拆分/合并/整理）。
//! 首版的强制手段是「在 DSH patch 里禁掉所有可能触碰文件/命令/联网/子 agent 的工具行」，
//! 本模块把这些行 id 收敛为单一事实源，供 [`crate::dsh_sidecar`] 生成 patch 时使用，
//! 也作为未来引入插件/工具能力时的授权边界参照。

/// 首版永久禁用的 DSH 工具/能力行 id（对应 dsh-base 组成里的行）。
///
/// 禁用的目的：让 AI 核心在结构上拿不到「写文件、跑命令、联网、派生子 agent」的入口，
/// 从而在源头守住铁律 1。`tool-todo` 与 `exit_plan_mode` 是 agent 内部记账，
/// 不碰文件/命令，不禁。
pub const FORBIDDEN_TOOL_IDS: &[&str] = &[
    "tool-bash",
    "tool-pwsh",
    "tool-fs",
    "tool-fs-search",
    "tool-str-replace-editor",
    "tool-web",
    "tool-skill",
    "tool-subagent",
    "tool-subagent-control",
    "tool-subagent-list-agents",
    "tool-subagent-fork",
    "tool-subagent-report",
    "tool-workflow",
    "tool-jobs",
    "tool-goal",
    "tool-ralph",
    "skill",
    "skill-filesystem",
];

/// 验证 harness 唯一暴露的受控只读作品工具名（任务 2.2/2.3/2.4 的边界锚点）。
///
/// AI 核心请求作品材料只能通过这些名字；任何其它工具名都拒绝。这些是产品级
/// 只读能力名，不含任何写入、命令、联网、子 agent 语义。
pub const READ_ONLY_STORY_TOOLS: &[&str] = &["story-list", "story-read", "story-snapshot"];

/// 工具授权判定：把某个工具/能力名归入「只读作品」「永久禁用」「未知拒绝」。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolAuthorization {
    /// 受控只读作品能力（本 change 唯一新增放行的入口）。
    ReadOnlyStory,
    /// 永久禁用（文件 / 命令 / 联网 / 子 agent 等危险入口）。
    Forbidden,
    /// 未知工具：一律拒绝，绝不落入通用执行。
    Unknown,
}

/// 判定一个工具/能力名是否被允许，以及属于哪一类。未知工具一律拒绝（fail closed）。
pub fn authorize_tool(name: &str) -> ToolAuthorization {
    if READ_ONLY_STORY_TOOLS.contains(&name) {
        ToolAuthorization::ReadOnlyStory
    } else if FORBIDDEN_TOOL_IDS.contains(&name) {
        ToolAuthorization::Forbidden
    } else {
        ToolAuthorization::Unknown
    }
}

/// 授权检查：判断某个核心能力是否被产品允许。
///
/// 文本生成、流式与取消随常驻会话改造（resident-ai-session）落地并授权；
/// 工具调用与多 Agent 仍然拒绝——AI 核心在结构上拿不到任何文档写入、
/// 命令执行、联网或子 agent 入口（驱动侧默认拒绝装配，见
/// `sidecar/driver/gen-config.mjs`；协议命令面无文档写入通道，见
/// `dsh_driver` 的协议面锚点测试）。
pub fn authorize(capability: crate::runtime_contract::CoreCapability) -> bool {
    matches!(
        capability,
        crate::runtime_contract::CoreCapability::TextGeneration
            | crate::runtime_contract::CoreCapability::Streaming
            | crate::runtime_contract::CoreCapability::Cancellation
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_contract::CoreCapability;

    #[test]
    fn text_generation_is_authorized() {
        assert!(authorize(CoreCapability::TextGeneration));
    }

    #[test]
    fn streaming_and_cancellation_are_authorized_with_resident_session() {
        // resident-ai-session 落地后：流式与取消成为已实现能力并授权。
        assert!(authorize(CoreCapability::Streaming));
        assert!(authorize(CoreCapability::Cancellation));
    }

    #[test]
    fn tool_call_and_multi_agent_are_rejected() {
        assert!(!authorize(CoreCapability::ToolCall));
        assert!(!authorize(CoreCapability::MultiAgent));
    }

    #[test]
    fn forbidden_tool_list_covers_file_and_command_and_network_and_subagent() {
        // 三类最危险的入口必须都在禁用清单里：文件写、命令执行、联网、子 agent。
        for required in [
            "tool-fs",
            "tool-bash",
            "tool-pwsh",
            "tool-web",
            "tool-subagent",
        ] {
            assert!(
                FORBIDDEN_TOOL_IDS.contains(&required),
                "禁用清单缺少 {required}"
            );
        }
    }

    #[test]
    fn read_only_story_tools_are_authorized_and_never_forbidden() {
        for name in READ_ONLY_STORY_TOOLS {
            assert_eq!(authorize_tool(name), ToolAuthorization::ReadOnlyStory, "{name}");
            assert!(
                !FORBIDDEN_TOOL_IDS.contains(&name),
                "只读工具不应出现在禁用清单: {name}"
            );
        }
    }

    #[test]
    fn forbidden_and_unknown_tools_are_rejected() {
        assert_eq!(authorize_tool("tool-fs"), ToolAuthorization::Forbidden);
        assert_eq!(authorize_tool("tool-bash"), ToolAuthorization::Forbidden);
        assert_eq!(authorize_tool("tool-subagent"), ToolAuthorization::Forbidden);
        assert_eq!(authorize_tool("some-unknown-tool"), ToolAuthorization::Unknown);
    }

    #[test]
    fn read_only_tool_names_carry_no_write_semantics() {
        // 只读作品工具集合里不能出现任何写入/编辑语义的名字，守住「无写入能力」。
        for name in READ_ONLY_STORY_TOOLS {
            for write_hint in ["write", "save", "edit", "create", "delete", "move", "rename", "replace"] {
                assert!(
                    !name.contains(write_hint),
                    "{name} 疑似含写入语义"
                );
            }
        }
    }

    /// 任务 2.5：讨论档案命令（list/save/delete）是受控应用服务的前端命令，
    /// 绝不注册为 AI 可调用工具、不进入能力网关授权面；未知工具一律拒绝（fail closed）。
    #[test]
    fn conversation_store_commands_are_not_ai_callable_tools() {
        for name in ["conversation_list", "conversation_save", "conversation_delete"] {
            assert!(
                !READ_ONLY_STORY_TOOLS.contains(&name),
                "讨论档案命令不应出现在只读作品工具集合: {name}"
            );
            assert!(
                !FORBIDDEN_TOOL_IDS.contains(&name),
                "讨论档案命令不应出现在禁用工具清单（它根本不是 AI 工具）: {name}"
            );
            assert_eq!(
                authorize_tool(name),
                ToolAuthorization::Unknown,
                "讨论档案命令作为工具名应被拒绝: {name}"
            );
        }
    }
}
