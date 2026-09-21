//! 负向能力验证（change: add-agent-on-demand-reading 任务 9.3）：
//! 常驻补读工具面下的攻击/误用尝试全部失败关闭且零磁盘副作用。
//!
//! 分层防线在此组合复验（每层的专测见各自模块）：
//! - 网关层：`capability_gateway::authorize_tool_call` 只放行四件套（组 5 测试钉死）。
//! - 协议解析层：不在四件套里的工具名（含 `story-snapshot` 系统保留名、写入语义名、
//!   旧点分名）无法反序列化为合法工具调用。
//! - 执行层：绕过授权直调、伪造 work_id、无路由上下文 → 结构化拒绝。
//! - 磁盘层：全部尝试后作品树与讨论档案逐字节不变（零副作用）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use next_story_lib::conversation_store::{
    save_conversation, ConversationRecord, FirstRoundMaterial,
};
use next_story_lib::project::{
    create_new_project, recover_then_read_content_tree, save_document, CreateProjectParams,
};
use next_story_lib::story_tool_channel::{ReadingFuseConfig, StoryToolChannel};
use next_story_lib::story_tools::{
    execute_story_tool_for_conversation, AuthorizationResolution, DiskStoryReader,
    StoryToolCall, StoryToolDenialReason,
};

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

fn setup_work_with_docs(temp: &tempfile::TempDir) -> (PathBuf, Vec<String>) {
    let root = create_new_project(CreateProjectParams {
        name: "负向验证作品".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create work");
    let tree = recover_then_read_content_tree(&root).expect("open tree");
    let mut doc_ids = vec![tree.root_children[0].clone()];
    save_document(&root, &doc_ids[0], &notebook_with_text("正文甲：林晓在天台。")).expect("save");
    for name in ["乙篇", "丙篇"] {
        let id = next_story_lib::project::create_document(&root, None).expect("create doc");
        next_story_lib::project::rename_node(&root, &id, name).expect("rename");
        save_document(&root, &id, &notebook_with_text(&format!("{name}的正文内容。"))).expect("save");
        doc_ids.push(id);
    }
    (root, doc_ids)
}

fn archive_record(conversation_id: &str) -> ConversationRecord {
    ConversationRecord {
        version: next_story_lib::conversation_store::CONVERSATION_VERSION,
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
        on_demand_reading_grant: None,
        on_demand_reading_provenance: None,
    }
}

/// 递归快照：作品目录内全部相对路径与字节（零副作用断言用）。
fn snapshot_tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, prefix: String, out: &mut BTreeMap<String, Vec<u8>>) {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
            if path.is_dir() {
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

fn snapshot_archives(root: &Path) -> BTreeMap<String, Vec<u8>> {
    snapshot_tree(&root.join("next-story-system").join("conversations"))
}

/// 不在四件套里的工具名无法成为合法工具调用（协议解析层失败关闭）。
/// 含：写入语义名、系统保留名 `story-snapshot`、旧点分名、网关禁用名、空名。
#[test]
fn negative_tool_names_fail_to_parse_as_story_tool_calls() {
    for bad in [
        "story-write",
        "story-save",
        "story-snapshot",
        "story.list",
        "story.read_document",
        "tool-bash",
        "tool-fs",
        "story-request-readings",
        "",
    ] {
        let value = serde_json::json!({ "tool": bad, "document_id": "doc-1" });
        let parsed = serde_json::from_value::<StoryToolCall>(value);
        assert!(parsed.is_err(), "工具名 {bad:?} 必须无法解析为合法调用");
    }
    // 网关层同步复验：这些名字也不得被逐名放行（四件套之外一律拒绝）。
    for bad in ["story-write", "story-snapshot", "story.list", "tool-bash"] {
        assert!(
            !next_story_lib::capability_gateway::authorize_tool_call(bad),
            "网关不得放行 {bad}"
        );
    }
    for good in ["story-list", "story-read", "story-search", "story-request-reading"] {
        assert!(next_story_lib::capability_gateway::authorize_tool_call(good));
    }
}

/// 绕过授权直调（未授权讨论）、伪造 work_id、跨作品文档 —— 执行层结构化拒绝，
/// 全程零磁盘副作用（作品树与档案逐字节不变）。
#[test]
fn negative_direct_calls_fail_closed_with_zero_disk_side_effects() {
    let temp = tempfile::TempDir::new().expect("temp dir");
    let (root, doc_ids) = setup_work_with_docs(&temp);
    // 未授权档案 + 已授权档案各一份。
    save_conversation(&root, &archive_record("conv-un")).expect("save un");
    let mut granted = archive_record("conv-gr");
    granted.on_demand_reading_grant = Some(
        next_story_lib::conversation_store::OnDemandReadingGrant {
            granted_at: "2026-09-20T08:30:00.000Z".to_string(),
        },
    );
    save_conversation(&root, &granted).expect("save granted");

    let before_work = snapshot_tree(&root);
    let before_archives = snapshot_archives(&root);
    let reader = DiskStoryReader::open(&root).expect("open reader");

    // ① 绕过授权直调（未授权讨论，即便文档本身允许查看）。
    let denial = execute_story_tool_for_conversation(
        &reader,
        &root,
        "conv-un",
        AuthorizationResolution::FromArchive,
        StoryToolCall::Read {
            work_id: None,
            document_id: doc_ids[0].clone(),
            version: None,
            range: None,
        },
    )
    .expect_err("绕过授权直调必须被拒");
    assert_eq!(
        denial.reason,
        StoryToolDenialReason::OnDemandReadingUnauthorized
    );

    // ② 伪造 work_id（身份不实的作品声明）。
    let denial = execute_story_tool_for_conversation(
        &reader,
        &root,
        "conv-gr",
        AuthorizationResolution::FromArchive,
        StoryToolCall::Read {
            work_id: Some("伪造的作品身份".to_string()),
            document_id: doc_ids[0].clone(),
            version: None,
            range: None,
        },
    )
    .expect_err("伪造 work_id 必须被拒");
    assert_eq!(denial.reason, StoryToolDenialReason::WorkMismatch);

    // ③ 越权文档（不存在 / 跨作品一律同因，不泄露存在性）。
    let denial = execute_story_tool_for_conversation(
        &reader,
        &root,
        "conv-gr",
        AuthorizationResolution::FromArchive,
        StoryToolCall::Read {
            work_id: None,
            document_id: "别的作品的文档".to_string(),
            version: None,
            range: None,
        },
    )
    .expect_err("越权文档必须被拒");
    assert_eq!(denial.reason, StoryToolDenialReason::DocumentMissing);

    // ④ 通道侧：无路由上下文 / 未注册会话的 tool_call 也失败关闭（不悬挂、不落档）。
    let channel = std::sync::Arc::new(StoryToolChannel::with_fuse_config(ReadingFuseConfig::default()));
    channel.handle_tool_call(next_story_lib::dsh_driver::ToolCallPayload {
        session_id: "未注册会话".to_string(),
        message_id: "m1".to_string(),
        call_id: "call-1".to_string(),
        tool: "story-read".to_string(),
        args: serde_json::json!({ "document_id": doc_ids[0] }),
    });
    std::thread::sleep(std::time::Duration::from_millis(500));
    assert!(
        channel
            .resolve_reading_request("未注册会话", "call-1", true)
            .is_err(),
        "负向尝试不得产生待决授权"
    );

    // 零磁盘副作用：作品树（正文、内容树、元信息）与讨论档案逐字节不变。
    assert_eq!(before_work, snapshot_tree(&root), "作品树不得有任何字节变化");
    assert_eq!(
        before_archives,
        snapshot_archives(&root),
        "讨论档案不得有任何字节变化"
    );
}
