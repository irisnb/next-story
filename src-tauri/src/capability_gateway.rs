//! Next Story 能力网关：AI 核心能做什么、不能做什么的权威声明。
//!
//! 铁律 1：AI 永远不直接改用户文档（不插入/追加/替换/改写/删除/移动/拆分/合并/整理）。
//! 首版的强制手段是「在 DSH patch 里禁掉所有可能触碰文件/命令/联网/子 agent 的工具行」，
//! 本模块把这些行 id 收敛为单一事实源，供 [`crate::dsh_sidecar`] 生成 patch 时使用，
//! 也作为未来引入插件/工具能力时的授权边界参照。

/// 首版永久禁用的危险 DSH 工具/能力行 id（对应 dsh-base 组成里的行）。
///
/// 禁用的目的：让 AI 核心在结构上拿不到「写文件、跑命令、联网、派生子 agent」的入口，
/// 从而在源头守住铁律 1。`tool-todo` 与 `exit_plan_mode` 是 agent 内部记账，
/// 不碰文件/命令，不禁。
///
/// 单一真相源（change: add-agent-on-demand-reading 设计 D14，任务 1.4）：本清单与
/// `sidecar/driver/denied-capabilities.json` 中 `gateway=true` 的条目一一对应，由两端
/// 契约测试双向钉死；该文件的完整 `entries` 同时是 `sidecar/driver/gen-config.mjs`
/// 装配禁用清单（DENY_IDS / cordis.driver.yaml）的来源。增删危险工具只改那份清单文件，
/// 再同步本常量并跑两端测试。
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

/// 受控只读作品工具总集（dash 命名，任务组 1 统一命名）：Agent 按需补读工具面
/// （见 [`AGENT_STORY_TOOLS`]）+ 系统自动取材路径保留的 `story-snapshot`。
///
/// AI 核心请求作品材料只能通过这些名字；任何其它工具名都拒绝。这些是产品级
/// 只读能力名，不含任何写入、命令、联网、子 agent 语义。
pub const READ_ONLY_STORY_TOOLS: &[&str] = &[
    "story-list",
    "story-read",
    "story-search",
    "story-request-reading",
    "story-snapshot",
];

/// Agent 按需补读工具面（change: add-agent-on-demand-reading 设计 D6/D13，任务 3.1）：
/// 宿主真实放行的四个只读工具。
///
/// `story-snapshot` 只保留给系统自动取材路径，不进入 Agent 工具面（本阶段补读
/// 只读已保存正文）。网关按名放行不等于读取放行：每次调用的逐次校验（讨论授权
/// 状态 / 作品身份 / 回收站 / AI 可见性 / 版本 / 待恢复事务）在宿主工具执行器
/// `crate::story_tools` 完成（设计 D3）。
pub const AGENT_STORY_TOOLS: &[&str] = &[
    "story-list",
    "story-read",
    "story-search",
    "story-request-reading",
];

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
/// 工具调用随按需补读改造（add-agent-on-demand-reading，任务 3.1）成为已实现
/// 能力并授权——但能力级放行只是「工具循环被产品允许」，每个具体工具名仍必须
/// 经 [`authorize_tool_call`] 逐名判定（仅四件套放行，默认拒绝）；多 Agent 仍然
/// 拒绝。AI 核心在结构上仍拿不到任何文档写入、命令执行、联网或子 agent 入口
/// （驱动侧默认拒绝装配，见 `sidecar/driver/gen-config.mjs`；协议命令面无文档
/// 写入通道，见 `dsh_driver` 的协议面锚点测试）。
pub fn authorize(capability: crate::runtime_contract::CoreCapability) -> bool {
    matches!(
        capability,
        crate::runtime_contract::CoreCapability::TextGeneration
            | crate::runtime_contract::CoreCapability::Streaming
            | crate::runtime_contract::CoreCapability::Cancellation
            | crate::runtime_contract::CoreCapability::ToolCall
    )
}

/// 工具调用能力的逐名授权（任务 3.1）：仅 Agent 按需补读工具面四件套放行；
/// 其余一律拒绝——含未知名、永久禁用名与系统保留名 `story-snapshot`（它不属于
/// Agent 工具面）。默认失败关闭，绝不落入通用执行。
pub fn authorize_tool_call(name: &str) -> bool {
    AGENT_STORY_TOOLS.contains(&name)
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

    /// 任务 3.1（add-agent-on-demand-reading）：工具调用能力随宿主执行器落地并授权；
    /// 多 Agent 仍然拒绝。能力级放行必须配合逐名判定（见下个测试）。
    #[test]
    fn tool_call_is_authorized_but_multi_agent_stays_rejected() {
        assert!(authorize(CoreCapability::ToolCall));
        assert!(!authorize(CoreCapability::MultiAgent));
    }

    /// 任务 3.1：工具调用逐名授权——仅 Agent 工具面四件套放行；系统保留名
    /// `story-snapshot`、禁用名与未知名一律拒绝（默认失败关闭）。
    #[test]
    fn tool_call_by_name_authorizes_only_agent_story_tools() {
        for name in AGENT_STORY_TOOLS {
            assert!(authorize_tool_call(name), "Agent 工具应放行: {name}");
        }
        // story-snapshot 保留给系统自动取材路径，不得进入 Agent 工具面。
        assert!(!authorize_tool_call("story-snapshot"));
        assert!(!authorize_tool_call("tool-fs"));
        assert!(!authorize_tool_call("tool-bash"));
        assert!(!authorize_tool_call("some-unknown-tool"));
        assert!(!authorize_tool_call(""));
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
            assert_eq!(
                authorize_tool(name),
                ToolAuthorization::ReadOnlyStory,
                "{name}"
            );
            assert!(
                !FORBIDDEN_TOOL_IDS.contains(name),
                "只读工具不应出现在禁用清单: {name}"
            );
        }
        // Agent 工具面是只读总集的子集；story-snapshot 是系统保留名、不在 Agent 面。
        for name in AGENT_STORY_TOOLS {
            assert!(READ_ONLY_STORY_TOOLS.contains(name), "{name}");
        }
        assert!(!AGENT_STORY_TOOLS.contains(&"story-snapshot"));
    }

    #[test]
    fn forbidden_and_unknown_tools_are_rejected() {
        assert_eq!(authorize_tool("tool-fs"), ToolAuthorization::Forbidden);
        assert_eq!(authorize_tool("tool-bash"), ToolAuthorization::Forbidden);
        assert_eq!(
            authorize_tool("tool-subagent"),
            ToolAuthorization::Forbidden
        );
        assert_eq!(
            authorize_tool("some-unknown-tool"),
            ToolAuthorization::Unknown
        );
    }

    #[test]
    fn read_only_tool_names_carry_no_write_semantics() {
        // 只读作品工具集合里不能出现任何写入/编辑语义的名字，守住「无写入能力」。
        for name in READ_ONLY_STORY_TOOLS {
            for write_hint in [
                "write", "save", "edit", "create", "delete", "move", "rename", "replace",
            ] {
                assert!(!name.contains(write_hint), "{name} 疑似含写入语义");
            }
        }
    }

    /// 任务 2.5：讨论档案命令（list/save/delete）是受控应用服务的前端命令，
    /// 绝不注册为 AI 可调用工具、不进入能力网关授权面；未知工具一律拒绝（fail closed）。
    #[test]
    fn conversation_store_commands_are_not_ai_callable_tools() {
        for name in [
            "conversation_list",
            "conversation_save",
            "conversation_delete",
        ] {
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

    /// 任务组 1.4（change: add-agent-on-demand-reading，设计 D14）：禁用能力清单单一真相源
    /// `sidecar/driver/denied-capabilities.json`。本模块的 FORBIDDEN_TOOL_IDS 必须与该清单中
    /// `gateway=true` 的条目双向一一对应；清单完整 `entries` 同时是 gen-config.mjs 装配禁用
    /// 清单（DENY_IDS / cordis.driver.yaml）的来源，两端由各自测试钉死。
    #[test]
    fn forbidden_tool_ids_match_denied_capabilities_truth_source() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sidecar")
            .join("driver")
            .join("denied-capabilities.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("读取 denied-capabilities.json 失败：{e}"));
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("denied-capabilities.json 必须是合法 JSON");
        let entries = value["entries"]
            .as_array()
            .expect("entries 必须是数组")
            .iter()
            .map(|e| {
                let id = e["id"]
                    .as_str()
                    .unwrap_or_else(|| panic!("条目缺少 id：{e}"));
                let gateway = e["gateway"].as_bool().unwrap_or(false);
                (id, gateway)
            })
            .collect::<Vec<_>>();

        let mut all_ids = std::collections::BTreeSet::new();
        let mut gateway_ids = std::collections::BTreeSet::new();
        for (id, gateway) in &entries {
            assert!(all_ids.insert(*id), "清单存在重复 id：{id}");
            if *gateway {
                gateway_ids.insert(*id);
            }
        }

        let rust_ids: std::collections::BTreeSet<&str> =
            FORBIDDEN_TOOL_IDS.iter().copied().collect();
        // 双向钉死：gateway=true 子集 == Rust 危险工具清单。
        assert_eq!(
            gateway_ids, rust_ids,
            "FORBIDDEN_TOOL_IDS 必须与 denied-capabilities.json 的 gateway=true 条目一一对应"
        );
        // 结构性：危险工具必须在装配禁用清单内（装配时同时禁用）。
        for id in FORBIDDEN_TOOL_IDS {
            assert!(all_ids.contains(id), "危险工具 {id} 必须在装配禁用清单内");
        }
        // 只读作品工具（含 Agent 工具面四件套与系统保留名 story-snapshot）
        // 不得出现在任何禁用清单。
        for name in READ_ONLY_STORY_TOOLS {
            assert!(
                !all_ids.contains(name),
                "只读工具 {name} 不得出现在禁用清单"
            );
        }
    }
}
