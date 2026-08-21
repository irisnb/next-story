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

/// 授权检查：判断某个核心能力是否被首版产品允许。
///
/// 首版只开放文本生成与追问（见 [`crate::runtime_contract::CoreCapability`]）；
/// 流式、工具调用、多 Agent、取消均为未来扩展位，当前一律拒绝。
pub fn authorize(capability: crate::runtime_contract::CoreCapability) -> bool {
    matches!(
        capability,
        crate::runtime_contract::CoreCapability::TextGeneration
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
    fn future_capabilities_are_rejected() {
        assert!(!authorize(CoreCapability::Streaming));
        assert!(!authorize(CoreCapability::ToolCall));
        assert!(!authorize(CoreCapability::MultiAgent));
        assert!(!authorize(CoreCapability::Cancellation));
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
}
