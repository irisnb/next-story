//! 真实链路驱动级回归（change: add-agent-on-demand-reading 任务 9.2）：
//! 真实端点（智谱 glm-5.3-flash）上的工具循环 + 授权流程 + 熔断 + message_sent 回执。
//!
//! 运行方式（手动，真实模型往返按分钟计）：
//! ```text
//! $env:ZHIPU_API_KEY = "<key>"   # 必需；缺省端点 https://open.bigmodel.cn/api/paas/v4
//! cargo test --manifest-path src-tauri/Cargo.toml --test real_link_on_demand_reading_test -- --ignored --test-threads=1
//! ```
//! 可选覆盖：`ZHIPU_API_BASE`、`ZHIPU_MODEL`（缺省 `glm-5.3-flash`）。
//! 单场景请求级超时 300 秒（< 10 分钟上限）；授权等待窗口 180 秒。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use next_story_lib::conversation_store::{
    read_conversation, save_conversation, set_on_demand_reading, ConversationRecord,
    FirstRoundMaterial,
};
use next_story_lib::dsh_driver::{DriverParams, DshDriverManager};
use next_story_lib::dsh_sidecar::resolve_paths;
use next_story_lib::project::{
    create_document, create_new_project, recover_then_read_content_tree, rename_node,
    save_document, CreateProjectParams,
};
use next_story_lib::story_tool_channel::{ReadingFuseConfig, StoryToolChannel};

/// 真实端点参数：Key 缺失时明确报错（不静默跳过、不用假结果冒充）。
fn real_params() -> DriverParams {
    let api_key = std::env::var("ZHIPU_API_KEY").unwrap_or_else(|_| {
        panic!(
            "真实链路回归需要环境变量 ZHIPU_API_KEY（智谱 API Key）。\
             请设置后重跑：cargo test --test real_link_on_demand_reading_test -- --ignored"
        )
    });
    DriverParams {
        model: std::env::var("ZHIPU_MODEL").unwrap_or_else(|_| "glm-5.3-flash".to_string()),
        api_base_url: std::env::var("ZHIPU_API_BASE")
            .unwrap_or_else(|_| "https://open.bigmodel.cn/api/paas/v4".to_string()),
        api_key,
        max_tokens: None,
    }
}

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
        restriction: None,
    }
}

/// 真实链路夹具：三篇文档（甲篇含唯一关键词）+ 三份讨论档案。
struct RealLinkFixture {
    /// TempDir 必须存活到 fixture 丢弃（Drop 时清理临时作品目录），字段本身不被读取。
    #[allow(dead_code)]
    temp: tempfile::TempDir,
    root: PathBuf,
}

fn setup_fixture() -> RealLinkFixture {
    let temp = tempfile::TempDir::new().expect("temp dir");
    let root = create_new_project(CreateProjectParams {
        name: "真实链路作品".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create work");
    let tree = recover_then_read_content_tree(&root).expect("open tree");
    let doc_a = tree.root_children[0].clone();
    rename_node(&root, &doc_a, "甲篇").expect("rename a");
    save_document(
        &root,
        &doc_a,
        &notebook_with_text("林晓在天台边发现了第七封信。"),
    )
    .expect("save a");
    for name in ["乙篇", "丙篇"] {
        let id = create_document(&root, None).expect("create doc");
        rename_node(&root, &id, name).expect("rename");
        save_document(
            &root,
            &id,
            &notebook_with_text(&format!("{name}：平凡的一天。")),
        )
        .expect("save");
    }
    save_conversation(&root, &archive_record("conv-tools")).expect("archive tools");
    save_conversation(&root, &archive_record("conv-auth")).expect("archive auth");
    save_conversation(&root, &archive_record("conv-fuse")).expect("archive fuse");
    // 授权只经受控窄更新写入；普通保存无权改变授权（fix-conversation-permission-and-ownership）。
    set_on_demand_reading(&root, "conv-tools", true).expect("grant tools");
    set_on_demand_reading(&root, "conv-fuse", true).expect("grant fuse");
    RealLinkFixture { temp, root }
}

/// 组装单驱动 + 双通道（按会话分发）：默认保险丝通道（conv-tools/conv-auth）与
/// 紧熔断通道（fuse-* 会话，每轮 1 次补读）。返回计数器与事件收集器。
struct WiredChannels {
    manager: Arc<DshDriverManager>,
    normal: Arc<StoryToolChannel>,
    tight: Arc<StoryToolChannel>,
    /// 全部 tool_call 到达计数。
    calls_total: Arc<AtomicU64>,
    /// 紧熔断通道的 tool_call 到达计数。
    calls_tight: Arc<AtomicU64>,
    /// 授权请求事件（conv-auth）。
    reading_requests: Arc<Mutex<Vec<next_story_lib::story_tool_channel::ReadingRequestEvent>>>,
}

fn wire(params: &DriverParams, home: tempfile::TempDir) -> WiredChannels {
    let paths = resolve_paths(Some(home.path().join("dsh-home")), None).expect("resolve paths");
    let manager = Arc::new(DshDriverManager::new());
    let normal = Arc::new(StoryToolChannel::new());
    let tight = Arc::new(StoryToolChannel::with_fuse_config(ReadingFuseConfig {
        max_tool_calls: 1,
        max_accumulated_duration: Duration::from_secs(120),
    }));
    normal.attach_driver((*manager).clone());
    tight.attach_driver((*manager).clone());

    let calls_total = Arc::new(AtomicU64::new(0));
    let calls_tight = Arc::new(AtomicU64::new(0));
    let reading_requests = Arc::new(Mutex::new(Vec::new()));

    let total_for_sink = calls_total.clone();
    let tight_for_sink = calls_tight.clone();
    let normal_for_sink = normal.clone();
    let tight_for_sink_ch = tight.clone();
    manager.set_tool_call_sink(Arc::new(move |payload| {
        total_for_sink.fetch_add(1, Ordering::SeqCst);
        if payload.session_id.starts_with("fuse") {
            tight_for_sink.fetch_add(1, Ordering::SeqCst);
            tight_for_sink_ch.handle_tool_call(payload);
        } else {
            normal_for_sink.handle_tool_call(payload);
        }
    }));

    let requests_for_sink = reading_requests.clone();
    normal.set_reading_request_sink(Arc::new(move |event| {
        requests_for_sink.lock().unwrap().push(event);
    }));

    manager
        .ensure_started(params, &paths)
        .expect("真实驱动启动");
    WiredChannels {
        manager,
        normal,
        tight,
        calls_total,
        calls_tight,
        reading_requests,
    }
}

fn provenance_docs(root: &std::path::Path, conversation_id: &str) -> usize {
    read_conversation(root, conversation_id)
        .expect("read archive")
        .on_demand_reading_provenance
        .map(|entries| entries.len())
        .unwrap_or(0)
}

/// 场景 A（工具循环 + message_sent）：已授权讨论，模型经工具循环读取甲篇并引用。
#[test]
#[ignore = "真实链路：需要 ZHIPU_API_KEY + 网络 + DSH sidecar，手动 --ignored 运行"]
fn real_link_tool_loop_reads_document_and_confirms_sent() {
    let fixture = setup_fixture();
    let home = tempfile::TempDir::new().expect("home dir");
    let wired = wire(&real_params(), home);
    wired
        .manager
        .start_session("s-tools")
        .expect("start session");
    wired
        .normal
        .register_round("s-tools", "conv-tools", fixture.root.clone(), false);

    let outcome = wired
        .manager
        .send_message_and_wait(
            "s-tools",
            "m1",
            "这是工具能力测试。请先用 story-list 工具查看文档目录，\
             再用 story-read 工具读取名为《甲篇》的文档全文，\
             然后在回答中原样引用甲篇正文里的至少一句话。必须使用工具读取，不要凭空编造。",
            Duration::from_secs(300),
        )
        .expect("真实链路轮次应完成");

    assert!(
        outcome.sent_confirmed,
        "message_sent 回执必须观测到（真实 provider 侧证据）"
    );
    let calls = wired.calls_total.load(Ordering::SeqCst);
    assert!(
        calls >= 1,
        "真实模型应至少发起一次工具调用（实际 {calls} 次）"
    );
    assert!(
        outcome.text.contains("第七封信"),
        "回答应引用经工具读取的甲篇正文（含关键词「第七封信」）：{}",
        outcome.text.chars().take(300).collect::<String>()
    );
    // 出处落档：至少一条读取记录（真实读取证据）。
    assert!(
        provenance_docs(&fixture.root, "conv-tools") >= 1,
        "读取出处应写入讨论档案"
    );
    wired.manager.shutdown_best_effort();
    drop(fixture);
}

/// 场景 B（授权流程）：未授权讨论，模型发起 story-request-reading → 轮次挂起
/// （不产生模型请求）→ 用户允许 → 原问题自动继续完成；授权落档。
#[test]
#[ignore = "真实链路：需要 ZHIPU_API_KEY + 网络 + DSH sidecar，手动 --ignored 运行"]
fn real_link_authorization_request_suspends_then_grant_continues() {
    let fixture = setup_fixture();
    let home = tempfile::TempDir::new().expect("home dir");
    let wired = wire(&real_params(), home);
    wired
        .manager
        .start_session("s-auth")
        .expect("start session");
    wired
        .normal
        .register_round("s-auth", "conv-auth", fixture.root.clone(), false);

    let manager_for_send = wired.manager.clone();
    let send = std::thread::spawn(move || {
        manager_for_send.send_message_and_wait(
            "s-auth",
            "m1",
            "现有材料不足。请立即调用 story-request-reading 工具发起按需补读授权请求，\
             reason 填写「需要读取作品设定文档」。等待用户决定后再继续。",
            Duration::from_secs(300),
        )
    });

    // 等待授权请求事件（真实模型发起；窗口 180 秒）。
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    loop {
        if !wired.reading_requests.lock().unwrap().is_empty() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "180 秒内未收到授权请求事件（模型未调用 story-request-reading）"
        );
        assert!(!send.is_finished(), "等待授权期间轮次不得自行终结");
        std::thread::sleep(Duration::from_millis(500));
    }
    let event = wired.reading_requests.lock().unwrap()[0].clone();
    assert_eq!(event.conversation_id, "conv-auth");
    assert!(!event.reason.trim().is_empty(), "请求原因必须透传");

    // 用户允许 → 工具结果回填 → 原轮继续并完成。
    wired
        .normal
        .resolve_reading_request("s-auth", &event.call_id, true)
        .expect("resolve granted");
    let outcome = send.join().expect("send 线程").expect("授权后原轮应完成");
    assert!(outcome.sent_confirmed, "回执断言");
    assert!(!outcome.text.trim().is_empty(), "继续后的回答应有内容");
    assert!(
        read_conversation(&fixture.root, "conv-auth")
            .expect("read archive")
            .on_demand_reading_grant
            .is_some(),
        "允许决定必须写入讨论档案"
    );
    wired.manager.shutdown_best_effort();
    drop(fixture);
}

/// 场景 C（熔断）：紧配置（每轮 1 次补读）下要求读三篇 → 第 2 次起补读被
/// reading_stopped 拒绝（到达数 > 落档数），模型仍完成收束（message_done）。
#[test]
#[ignore = "真实链路：需要 ZHIPU_API_KEY + 网络 + DSH sidecar，手动 --ignored 运行"]
fn real_link_fuse_stops_excess_reads_and_model_concludes() {
    let fixture = setup_fixture();
    let home = tempfile::TempDir::new().expect("home dir");
    let wired = wire(&real_params(), home);
    wired
        .manager
        .start_session("fuse-s1")
        .expect("start session");
    wired
        .tight
        .register_round("fuse-s1", "conv-fuse", fixture.root.clone(), false);

    let outcome = wired
        .manager
        .send_message_and_wait(
            "fuse-s1",
            "m1",
            "请依次使用 story-read 工具分别读取《甲篇》《乙篇》《丙篇》三篇文档的全文\
             （每篇一次工具调用，共三次），然后逐一总结每篇内容。",
            Duration::from_secs(300),
        )
        .expect("熔断场景轮次应完成（模型基于已有材料收束）");

    assert!(outcome.sent_confirmed, "回执断言");
    let arrived = wired.calls_tight.load(Ordering::SeqCst);
    let recorded = provenance_docs(&fixture.root, "conv-fuse");
    assert!(
        arrived >= 2,
        "紧熔断下模型应至少尝试两次补读（实际到达 {arrived} 次），以触发保险丝"
    );
    assert!(
        (recorded as u64) < arrived,
        "保险丝证据：成功落档读取数（{recorded}）必须小于到达数（{arrived}）——超出部分被 reading_stopped 拒绝"
    );
    assert!(
        recorded <= 1,
        "每轮 1 次补读上限：落档读取至多 1 篇（实际 {recorded}）"
    );
    assert!(
        !outcome.text.trim().is_empty(),
        "被熔断后模型应基于已读材料给出收束回答"
    );
    wired.manager.shutdown_best_effort();
    drop(fixture);
}
