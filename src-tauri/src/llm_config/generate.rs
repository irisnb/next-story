//! 使用唯一保存配置，通过 DSH headless 生成 AI 思考材料。
//!
//! 只接收选区原文（含可选方向与追问轮次），由本模块集中组装固定首版思考任务，
//! 序列化为单个 task 字符串交给 DSH。制度性提示（陪想身份＋宪法红线）自
//! change: wire-system-prompt-channel 起迁入会话 system 层（信封，单一来源
//! [`session_system_prompt`]），user 文本只承载入口姿态、工具说明、问题与材料。
//! 前端不传入 API Key，也不持有任何写入用户文档的入口。

use std::path::{Path, PathBuf};

use super::{
    load_llm_config, validate_llm_config, FollowUpOrigin, GenerateAiError, GenerateAiErrorCode,
    GenerateAiMessageRole, GenerateAiRequest, GenerateAiResult, LlmConfig,
};
use crate::dsh_driver::{DriverParams, DriverReplayTurn};
use crate::dsh_sidecar;
use crate::dsh_version::DshVersionLayout;

/// 提示词入口：本轮请求以哪种方式发起，决定入口层立场句。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptEntry {
    /// 直接提问：用户问题为主，选区为可选重点材料。
    DirectQuestion,
    /// 及时召唤：只有冻结选区材料，没有用户问题。
    Summon,
}

/// 陪想身份句（信封 persona 段文本；2026-10-06 用户拍板备选 A）。规格要求
/// 「你是陪伴剧本创作者思考与探索的助手」在会话 system 层逐字在场。
const IDENTITY_SENTENCE: &str = "你是陪伴剧本创作者思考与探索的助手。";

/// 宪法红线文本：永久边界、诚实材料边界、追问语义、纯文本输出要求。
/// `pub(crate)`（add-making-module-core 任务 4.5）：制作助手车道（任务组 5）
/// 复用本红线同文组装制作信封——红线条款对制作会话同样成立（design D4），
/// 经同一常量引用，杜绝第二副本漂移。
///
/// 评价条款为 2026-10-07 用户拍板的灰色地带口径（add-posture-slot 任务 2.5，
/// dsh-headless-generation delta 定稿文案）：红线本意防的是「垄断裁决＋单一
/// 标准推着作品变优秀」，不是禁止 AI 开口评价——对故事的评价只给带依据的
/// 观察与假设，讲清线索与依据，判断权归还用户；取代旧三条「不判断」条款
/// （不判断故事好坏／不判断正确或错误／不判断高级或低级）。
pub(crate) const CONSTITUTION_CLAUSES: &str = "不直接修改用户文档，不代写正文，不润色，不提供替换文本。\
对故事的评价只给带依据的观察与假设，讲清线索与依据；不用单一标准判定故事的好坏、正确或错误、高级或低级；内容、解释、评价与方向的判断权都在用户。\
只依据本次实际提供的作品材料及经授权工具实际返回的内容，说明参考范围。未提供、未读取或未取得的内容，不得声称已经读过；目录不等于正文，检索片段不等于全文。不得声称具有跨讨论长期记忆。\
追问围绕用户当前问题回应；首次选区仅在与当前问题相关时继续参考。当前讨论中的既有问答可用于承接对话，但 AI 先前提出的猜测和候选不能当作作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

/// 会话信封（`start_session.system_prompt`）纯常量组装（design D3，单一来源）：
/// 首行＝陪想身份句，首个换行后＝宪法红线全文。首行换行即驱动侧拆段契约
/// （首行遮蔽 `deployment:persona`，其余入 `nextstory:constitution`，见
/// `sidecar/driver/system-prompt-sections.mjs` 与 `protocol.json`）。
///
/// 纯常量确定性组装：正常 `start_session` 与崩溃恢复重放由同一函数重算重发，
/// 逐字一致由无状态保证（契约测试断言两次组装逐字相等）。文本不含 `{{`/`}}`
/// （驱动侧 dsh-system-prompt 严格变量插值，未知引用会 fail loud）。
pub fn session_system_prompt() -> String {
    format!("{IDENTITY_SENTENCE}\n{CONSTITUTION_CLAUSES}")
}

// ========== 链路卡文本组装（add-making-module-core 任务 3.1，design D2） ==========

/// 链路卡注入文本的统一包装头（逐字常量，design D2 审查修订措辞）：
/// 「可替换的讨论方法、非强制规则」声明由系统统一生成，不依赖单张卡自带
/// （保证全链路措辞一致，共识 §5.3）。措辞用「提供」而非「启用」——
/// 试问未启用版本时同一包装不失实（启用与试用场景共用同一文案）。
const CHAIN_CARDS_WRAPPER_HEADER: &str = "以下是用户提供的陪想要求。这是一套可替换的讨论方法，不是必须遵守的规则；觉得不合适可以直接说。所有候选与判断最终由用户决定。";

/// 组装当轮冻结链路卡的注入文本（`send_message.chain_cards` → 信封
/// `nextstory:chain-cards` 挂载位，design D1/D2）：统一包装头＋各卡渲染，
/// 多卡以空行分隔。单卡渲染为 `【标题】＋何时用（触发描述）＋正文`——
/// 触发描述本身已含适用与不适用情形（由制作助手写清），组装层不再拆分。
///
/// 空卡列表返回空串（防御路径：链路库校验保证启用版本至少一卡；无卡轮次
/// 由调用方以 `None` 省略协议字段，不渲染空包装）。文本不含 `{{`/`}}`
/// （驱动侧 dsh-system-prompt 严格变量插值，未知引用会 fail loud）。
pub fn assemble_chain_cards(cards: &[crate::chain_library::RequirementCard]) -> String {
    if cards.is_empty() {
        return String::new();
    }
    let mut text = String::from(CHAIN_CARDS_WRAPPER_HEADER);
    for card in cards {
        text.push_str("\n\n");
        text.push_str(&format!(
            "【{}】\n何时用：{}\n{}",
            card.title, card.trigger_desc, card.body
        ));
    }
    text
}

/// 姿态段注入文本的承接句（逐字常量，add-posture-slot design D3／任务 0
/// 实验 C3 定稿措辞）：肯定式身份性表述——主干说「做什么」（以此声音陪伴
/// 讨论），否定式限定压到最短（判断与红线仍按后文宪法执行），保留可替换
/// 声明（共识 §5.3）。措辞漂移由装置测试逐字断言钉住。
pub(crate) const POSTURE_WRAPPER_HEADER: &str =
    "你的出场姿态由用户设定如下，以此声音陪伴讨论；判断与红线仍按后文宪法执行。该姿态可随时换掉。";

/// 组装姿态段注入文本（`send_message.posture` → 信封 `nextstory:posture` 姿态
/// 挂载位，add-posture-slot design D1/D3；2026-10-07 修订 7.2 多卡签名）：
/// 承接句（仅出现一次）＋空行＋各姿态卡**正文原样**以空行依序拼接——每卡
/// 正文各自剥去开头【…】单行标题行；不编序号、不加执行顺序暗示（与要求卡
/// 渲染口径一致）。装配阶段不改写、不增删用户确认过的正文——元数据（触发
/// 描述／卡名标记／栏目头）不进模型上下文，触发描述根本不参与本组装。
/// 第二人称与「底线不换皮」条款由起草阶段（制作守则）保证，装配不代写。
/// 空姿态卡列表返回空串（无姿态卡时由调用方省略协议字段，不渲染只含承接
/// 句的空壳文本）。多张姿态卡不做冲突调和、不删减，全部依序注入（组合权
/// 在用户）。文本不含 `{{`/`}}`（驱动侧 dsh-system-prompt 严格变量插值）。
pub fn assemble_posture(cards: &[crate::chain_library::RequirementCard]) -> String {
    if cards.is_empty() {
        return String::new();
    }
    let mut text = String::from(POSTURE_WRAPPER_HEADER);
    for card in cards {
        text.push_str("\n\n");
        text.push_str(strip_leading_posture_title(&card.body));
    }
    text
}

/// 剥去正文开头的【…】单行标题行（若有）：首字符为「【」且首个换行前的整行
/// 以「】」收尾时视为标题行，剥去该行（含其换行）；整份正文只有这一行时
/// 同样剥去（其余为空）。其余内容逐字不动。
fn strip_leading_posture_title(body: &str) -> &str {
    if !body.starts_with('【') {
        return body;
    }
    match body.find('\n') {
        Some(newline) if body[..newline].ends_with('】') => &body[newline + 1..],
        None if body.ends_with('】') => "",
        _ => body,
    }
}

/// 入口层：按入口给出本轮请求的立场句（含本轮可见材料的静态描述）。
fn entry_stance(entry: PromptEntry) -> &'static str {
    match entry {
        PromptEntry::DirectQuestion => {
            "当前请求提供用户直接提出的问题，以及用户可选的选区重点材料。\
若提供了重点材料，把它当作用户希望重点参考的片段，而不是作品事实或最终判断。\
先区分从材料里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。"
        }
        PromptEntry::Summon => {
            "当前请求只提供冻结选区原文，没有用户问题。\
把这段选区当作用户希望继续探索的材料，而不是作品事实或最终判断。\
先区分从文字里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。"
        }
    }
}

/// 语境层：本轮可见材料的动态描述。当前随入口层静态表达（材料描述已并入
/// 入口层立场句），此处先立结构留空，未来动态化时在此填入。
fn context_clause(_entry: PromptEntry) -> &'static str {
    ""
}

/// 工具使用层（add-agent-on-demand-reading 任务 5.4）：受控只读补读工具的使用
/// 规范。措辞克制：只说明机制与权限边界，不写阅读效果承诺。强制点在宿主
/// （设计 D13），提示词只是引导，不是闸门。
fn tool_reading_prompt(entry: PromptEntry) -> &'static str {
    match entry {
        PromptEntry::DirectQuestion => {
            "你可以使用只读的作品补读工具：story-list 列出目录、story-read 读取已保存\
正文、story-search 检索片段。默认未获授权时这些调用会被系统拒绝。若现有材料确实\
不足以回答，先调用 story-request-reading 并说明原因，等用户决定后再继续；未获允许\
时，基于现有材料回答并说明哪些部分无法确认。补读只服务于回答当前问题，读取不会\
修改作品任何内容。"
        }
        PromptEntry::Summon => {
            "本轮只围绕提供的冻结选区回应，不使用补读工具，也不请求授权；若确需更多\
材料，先完成本轮回应并说明材料所限。"
        }
    }
}

/// 入口层＋工具层组装（信纸前缀）：入口姿态句＋语境层＋工具使用说明。
///
/// 宪法红线与陪想身份已迁入会话 system 层（信封，[`session_system_prompt`]，
/// change: wire-system-prompt-channel）；user 前缀不得再携带这些条款
/// （禁止双份投递，system-prompt-layering 规格）。每轮差异（入口姿态、
/// 按入口的工具使用说明）留在信纸。
pub fn compose_system_prompt(entry: PromptEntry) -> String {
    let mut prompt = String::from(entry_stance(entry));
    prompt.push_str(context_clause(entry));
    prompt.push_str(tool_reading_prompt(entry));
    prompt
}

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

/// 通过 DSH 生成一次回复（resident-ai-session 改造后）。
///
/// legacy 命令入口（`generate_ai_thinking`）仍走本函数：把入口层提示（姿态句＋
/// 工具使用说明）、选区原文与追问轮次组装成单个消息文本，经常驻驱动以**临时
/// 会话**发送（start → send → end）。制度性内容（身份＋红线）不在 task 文本内
/// ——`start_session` 携带 system_prompt 信封（与常驻链同一单一来源），对前端
/// 保持一次性和非流式的旧契约。流式与增量由新的 `ai_send_message` 命令族承接
/// （见下方常驻会话编排函数）。
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
    let params = DriverParams {
        model: config.model.clone(),
        api_base_url: config.api_base_url.clone(),
        api_key: config.api_key.clone(),
        max_tokens: config.max_tokens,
    };
    let manager = crate::dsh_driver::global_driver_manager().clone();

    tauri::async_runtime::spawn_blocking(move || {
        manager.ensure_started(&params, &paths)?;
        let session_id = format!("legacy-{}", crate::dsh_driver::next_id());
        let message_id = format!("legacy-msg-{}", crate::dsh_driver::next_id());
        manager.start_session(&session_id)?;
        let text = match manager.send_message_and_wait(
            &session_id,
            &message_id,
            &task,
            crate::dsh_driver::REQUEST_TIMEOUT,
        ) {
            Ok(outcome) => outcome.text,
            Err(error) => {
                let _ = manager.end_session(&session_id);
                return Err(error);
            }
        };
        let _ = manager.end_session(&session_id);
        Ok(text)
    })
    .await
    .map_err(|join_error| {
        GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("DSH 生成任务执行失败: {join_error}"),
        )
    })?
}

/// 从应用数据目录派生版本隔离的 DSH_HOME（`<base_dir>/dsh/homes/<current_version>`）。
fn versioned_dsh_home(base_dir: &Path) -> PathBuf {
    DshVersionLayout::new(base_dir.join("dsh")).current_home()
}

// ========== 常驻会话编排（resident-ai-session 任务 3.3–3.4） ==========

/// 常驻会话消息种类：首轮（后端组装系统提示词与材料）或追问（只发增量问题）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiMessageKind {
    /// 首轮（直接提问）：组装系统提示词 + 用户问题 + 可选选区重点材料。
    First,
    /// 追问：只发送本次新增的问题，历史由常驻会话维护。
    FollowUp,
    /// 召唤首轮（及时召唤）：没有用户问题，只有冻结选区材料，
    /// 任务由后端按召唤语义组装（线上值为 `summon_first`）。
    SummonFirst,
}

/// 加载已保存的唯一 LLM 配置（阻塞读取放阻塞线程）。
async fn load_saved_config(base_dir: &Path) -> Result<LlmConfig, GenerateAiError> {
    let base = base_dir.to_path_buf();
    let loaded = tauri::async_runtime::spawn_blocking(move || load_llm_config(&base)).await;
    match loaded {
        Ok(Ok(Some(config))) => Ok(config),
        Ok(Ok(None)) => Err(GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "缺少 LLM 配置，请先到设置中填写并保存 API 地址、Key 与模型名",
        )),
        Ok(Err(_)) => Err(GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置无法读取，请重新保存配置",
        )),
        Err(_) => Err(GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置目录读取任务执行失败，请重启应用后重试",
        )),
    }
}

/// 确保常驻驱动进程以当前配置启动（懒启动 / 参数变化重启 / 崩溃重启）。
async fn ensure_driver_started(
    config: &LlmConfig,
    base_dir: &Path,
    resource_dir: Option<&Path>,
) -> Result<(), GenerateAiError> {
    validate_llm_config(config).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置不完整，请检查 API 地址、Key 与模型名",
        )
    })?;
    let paths = dsh_sidecar::resolve_paths(Some(versioned_dsh_home(base_dir)), resource_dir)?;
    let params = DriverParams {
        model: config.model.clone(),
        api_base_url: config.api_base_url.clone(),
        api_key: config.api_key.clone(),
        max_tokens: config.max_tokens,
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().ensure_started(&params, &paths)
    })
    .await
    .map_err(|join_error| {
        GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("驱动启动任务执行失败: {join_error}"),
        )
    })?
}

/// 常驻会话：启动会话（同时懒启动驱动进程）。
pub async fn ai_start_session_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
) -> GenerateAiResult {
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().start_session(&session_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("会话启动任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：发送消息并等待终态。流式增量经驱动管理器的 sink 转发为前端事件。
///
/// - `First`：后端组装系统提示词 + 用户问题 + 可选选区重点材料（组装语义
///   与旧链路的 `direct_question_user_content` 完全一致）。
/// - `SummonFirst`：后端按召唤语义组装系统提示词 + 冻结选区材料，
///   不包含用户问题文本（前端传空字符串）。
/// - `FollowUp`：只发送本次新增的问题，历史由常驻会话维护。
///
/// `material` 是命令层经 `authorize_selection` 授权通过的选区材料内容，
/// 生成层只使用该授权内容，绝不回读前端请求中的原始 `selected_text` 字段；
/// 无选区（直接提问 / 追问）时为 `None`。
///
/// `chain_cards` 是当轮冻结的要求卡注入文本（add-making-module-core 任务 3.2，
/// design D1）：`Some` 时随 `send_message` 协议字段下发（驱动侧轮级更新
/// `nextstory:chain-cards` 信封段）；`None` 时省略字段，与既有路径逐字节
/// 一致。卡文本走协议字段，绝不拼入 user 文本（「追问按增量发送」不变）。
///
/// `posture` 是当轮冻结的姿态段注入文本（add-posture-slot 任务 2.3，design
/// D2/D3）：`Some` 时随 `send_message.posture` 协议字段下发（驱动侧轮级更新
/// `nextstory:posture` 信封段，与 chain_cards 各自独立幂等）；`None`（无姿态卡）
/// 时省略字段。与 `chain_cards` 来自同一次冻结读取（同源）。
// 参数超限定点豁免：命令层入参直传，结构性收拢归审计 P2-1/P2-2（lib.rs 拆缝）处理。
#[allow(clippy::too_many_arguments)]
pub async fn ai_send_message_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
    message_id: String,
    kind: AiMessageKind,
    question: String,
    material: Option<String>,
    context: Option<String>,
    chain_cards: Option<&str>,
    posture: Option<&str>,
) -> GenerateAiResult {
    let text = match compose_message_text(kind, &question, material.as_deref(), context.as_deref())
    {
        Ok(text) => text,
        Err(error) => return GenerateAiResult::failure(error),
    };
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    let chain_cards = chain_cards.map(str::to_string);
    let posture = posture.map(str::to_string);
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().send_message_with_cards_and_wait(
            &session_id,
            &message_id,
            &text,
            chain_cards.as_deref(),
            posture.as_deref(),
            crate::dsh_driver::REQUEST_TIMEOUT,
        )
    })
    .await;
    match result {
        Ok(Ok(outcome)) => {
            // 成功轮次携带 provider 发送回执：收到 message_sent 为 true，未收到为
            // false（表示「未确认」，不是「未发送」）；失败轮次不附回执。
            let mut result = GenerateAiResult::success(outcome.text);
            result.sent_confirmed = Some(outcome.sent_confirmed);
            result
        }
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("生成任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：取消进行中的生成。进程未启动时为无操作（幂等）。
pub async fn ai_cancel_message_in_dir(session_id: String, message_id: String) -> GenerateAiResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().cancel_message(&session_id, &message_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("取消任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：结束会话（新建对话 / 切换作品）。进程未启动时为无操作（幂等）。
pub async fn ai_end_session_in_dir(session_id: String) -> GenerateAiResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().end_session(&session_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("结束会话任务执行失败: {join_error}"),
        )),
    }
}

/// 崩溃恢复重放的会话来源：决定重放首轮按哪种入口语义组装提示词。
/// 临时对话不跨应用重启持久化，来源只存活在应用会话内存中，由前端传入。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayOrigin {
    /// 直接提问发起的对话。
    DirectQuestion,
    /// 及时召唤发起的对话。
    Summon,
}

/// 常驻会话：注入崩溃恢复历史（前端显示历史的增量投影，不触发再生成）。
///
/// 重放首轮不再拼接提示词前缀（change: wire-system-prompt-channel）：制度性
/// 内容由 `start_session` 携带的 system_prompt（信封）提供，重放会话与原会话
/// 的 system 层逐字一致；`origin` 保留为命令面参数（前端仍传），组装行为上
/// 已无作用。
pub async fn ai_replay_history_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
    _origin: ReplayOrigin,
    turns: Vec<DriverReplayTurn>,
) -> GenerateAiResult {
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().replay_history(&session_id, turns)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("历史注入任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：历史注入完成，驱动以 seed 建会话并确认。
pub async fn ai_replay_done_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
) -> GenerateAiResult {
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().replay_done(&session_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("历史注入确认任务执行失败: {join_error}"),
        )),
    }
}

/// 把请求序列化为单个 DSH task 字符串：入口层提示（姿态句＋工具使用说明）＋
/// 选区原文（含可选方向）＋追问轮次（按角色标注），保持无状态临时对话语义。
/// 制度性内容（身份＋红线）不内嵌——legacy 与常驻链同样经 `start_session` 的
/// system_prompt 信封携带（等价基准，change: wire-system-prompt-channel 2.4）。
pub fn build_task_string(request: &GenerateAiRequest) -> Result<String, GenerateAiError> {
    validate_generate_ai_request(request)?;

    let mut task = String::new();
    match request {
        GenerateAiRequest::First {
            selected_text,
            thinking_direction,
            ..
        } => {
            task.push_str(&compose_system_prompt(PromptEntry::Summon));
            task.push_str("\n\n");
            task.push_str(&first_user_content(
                selected_text,
                thinking_direction.as_deref(),
            ));
        }
        GenerateAiRequest::FollowUp {
            selected_text,
            thinking_direction,
            origin,
            messages,
            ..
        } => {
            let is_direct = matches!(origin, Some(FollowUpOrigin::DirectQuestion));
            if is_direct {
                // 直接提问来源：messages 以 user 原问题开头，选区作为可选重点材料。
                task.push_str(&compose_system_prompt(PromptEntry::DirectQuestion));
                task.push_str("\n\n");
                if let Some(first) = messages.first() {
                    task.push_str(&format!("用户问题：\n{}", first.content));
                }
                let trimmed_selection = selected_text.trim();
                if !trimmed_selection.is_empty() {
                    task.push_str(&format!(
                        "\n\n重点参考材料（可选）：\n{}",
                        trimmed_selection
                    ));
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
                task.push_str(&compose_system_prompt(PromptEntry::Summon));
                task.push_str("\n\n");
                task.push_str(&first_user_content(
                    selected_text,
                    thinking_direction.as_deref(),
                ));
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
            ..
        } => {
            task.push_str(&compose_system_prompt(PromptEntry::DirectQuestion));
            task.push_str("\n\n");
            task.push_str(&direct_question_user_content(
                question,
                selected_text.as_deref(),
            ));
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

pub fn validate_generate_ai_request(request: &GenerateAiRequest) -> Result<(), GenerateAiError> {
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
        Some(selection) => format!("用户问题：\n{question}\n\n重点参考材料（可选）：\n{selection}"),
        None => format!("用户问题：\n{question}"),
    }
}

/// 召唤的用户内容：没有用户问题，只有冻结选区原文作为探索材料。
/// 前端不伪造默认问题文本，材料之外不加任何标签或方向。
fn summon_user_content(selected_text: &str) -> String {
    selected_text.trim().to_string()
}

/// 按消息种类校验并组装发送文本（纯函数，便于测试）。
///
/// `material` 是已授权通过的选区材料内容（`authorize_selection` 校验后传入），
/// 生成层只使用它，不回读原始 `selected_text`。
///
/// - `First` / `FollowUp`：要求 question 非空（现状不变）；`context` 为后端组装的
///   关注文档现场材料 + 目录投影 + 检索片段（阶段五 A），非空时随本轮请求一起注入。
/// - `SummonFirst`：要求 `material` 非空，question 可空（前端传空字符串）；
///   及时召唤不经过常规取材，`context` 被忽略。
fn compose_message_text(
    kind: AiMessageKind,
    question: &str,
    material: Option<&str>,
    context: Option<&str>,
) -> Result<String, GenerateAiError> {
    let context_block = context.map(str::trim).filter(|c| !c.is_empty());
    match kind {
        AiMessageKind::First => {
            if question.trim().is_empty() {
                return Err(invalid_request());
            }
            let mut text = format!(
                "{}\n\n{}",
                compose_system_prompt(PromptEntry::DirectQuestion),
                direct_question_user_content(question, material)
            );
            if let Some(ctx) = context_block {
                text.push_str("\n\n");
                text.push_str(ctx);
            }
            Ok(text)
        }
        AiMessageKind::SummonFirst => {
            let selection = material.unwrap_or("").trim();
            if selection.is_empty() {
                return Err(invalid_request());
            }
            Ok(format!(
                "{}\n\n{}",
                compose_system_prompt(PromptEntry::Summon),
                summon_user_content(selection)
            ))
        }
        AiMessageKind::FollowUp => {
            if question.trim().is_empty() {
                return Err(invalid_request());
            }
            let mut text = question.to_string();
            if let Some(ctx) = context_block {
                text.push_str("\n\n");
                text.push_str(ctx);
            }
            Ok(text)
        }
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
            document_id: None,
            project_path: None,
            document_version: None,
            snapshot: None,
            thinking_direction: None,
        };
        let task = build_task_string(&request).expect("build task");
        assert!(
            task.contains(&compose_system_prompt(PromptEntry::Summon)),
            "必须包含召唤入口的入口层提示（姿态句＋工具使用说明）"
        );
        assert!(task.contains("林站在天台边。"), "必须包含选区原文");
        assert!(
            !task.contains(IDENTITY_SENTENCE),
            "身份句已迁入信封，task 文本不得再内嵌（禁止双份投递）"
        );
    }

    #[test]
    fn build_task_string_for_follow_up_preserves_turns_and_roles() {
        let request = GenerateAiRequest::FollowUp {
            selected_text: "林站在天台边。".to_string(),
            document_id: None,
            project_path: None,
            document_version: None,
            snapshot: None,
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
            document_id: None,
            project_path: None,
            document_version: None,
            snapshot: None,
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
            document_id: None,
            project_path: None,
            document_version: None,
            snapshot: None,
        };
        let task = build_task_string(&request).expect("build task");
        assert!(
            task.contains(&compose_system_prompt(PromptEntry::DirectQuestion)),
            "必须包含直接提问入口的入口层提示（姿态句＋工具使用说明）"
        );
        assert!(task.contains("用户问题：\n这个角色为什么犹豫？"));
        assert!(
            !task.contains("重点参考材料"),
            "无选区时不得出现重点参考材料"
        );
        assert!(
            !task.contains(IDENTITY_SENTENCE),
            "身份句已迁入信封，task 文本不得再内嵌（禁止双份投递）"
        );
    }

    #[test]
    fn direct_question_with_selection_distinguishes_question_and_material() {
        let request = GenerateAiRequest::DirectQuestion {
            question: "这段里人物在隐瞒什么？".to_string(),
            selected_text: Some("林站在天台边，没有回头。".to_string()),
            document_id: None,
            project_path: None,
            document_version: None,
            snapshot: None,
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
            document_id: None,
            project_path: None,
            document_version: None,
            snapshot: None,
        };
        let err = build_task_string(&request).expect_err("blank question rejected");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);
    }

    #[test]
    fn direct_question_compose_declares_entry_stance_without_constitution() {
        let prompt = compose_system_prompt(PromptEntry::DirectQuestion);
        // 入口姿态句（信纸：每轮差异）保留。
        for required in ["用户直接提出的问题", "用户可选的选区重点材料"] {
            assert!(
                prompt.contains(required),
                "直接提问组装提示词缺少入口姿态: {required}"
            );
        }
        // 诚实材料边界条款已迁入信封（system 层）：user 前缀不得携带（禁止双份投递）。
        for migrated in [
            "只依据本次实际提供的作品材料及经授权工具实际返回的内容",
            "未提供、未读取或未取得的内容，不得声称已经读过",
            "目录不等于正文，检索片段不等于全文",
            "不得声称具有跨讨论长期记忆",
            "不直接修改用户文档",
            IDENTITY_SENTENCE,
        ] {
            assert!(
                !prompt.contains(migrated),
                "制度性条款不得留在 user 前缀: {migrated}"
            );
        }
    }

    /// 召唤入口组装的提示词保留召唤立场（信纸），红线与身份条款已迁入信封。
    #[test]
    fn summon_compose_declares_summon_stance_without_constitution() {
        let prompt = compose_system_prompt(PromptEntry::Summon);
        for required in [
            "当前请求只提供冻结选区原文，没有用户问题",
            "把这段选区当作用户希望继续探索的材料",
        ] {
            assert!(
                prompt.contains(required),
                "召唤组装提示词缺少入口姿态: {required}"
            );
        }
        // 追问语义与永久边界条款已迁入信封：user 前缀不得携带。
        for migrated in [
            "追问围绕用户当前问题回应",
            "首次选区仅在与当前问题相关时继续参考",
            "不代写正文",
            "不润色",
            "不提供替换文本",
            "对故事的评价只给带依据的观察与假设",
            IDENTITY_SENTENCE,
        ] {
            assert!(
                !prompt.contains(migrated),
                "制度性条款不得留在 user 前缀: {migrated}"
            );
        }
    }

    /// 信封单一来源（任务 2.1/2.5，design D3）：session_system_prompt 纯常量
    /// 组装，红线条款逐字保留（一条不删），次序为身份句先于红线；两种入口的
    /// user 前缀（信纸）不含任何制度性条款。
    #[test]
    fn session_system_prompt_is_pure_constant_envelope_single_source() {
        let envelope = session_system_prompt();
        // 纯常量：两次组装逐字相等（崩溃重放一致性的基础）。
        assert_eq!(envelope, session_system_prompt());
        // 拆段契约：首行＝身份句，其余＝红线全文（驱动侧按首个换行拆段）。
        // 期望值用逐字字面量（2026-10-06 拍板备选 A）：常量漂移时此处必须失败。
        let mut lines = envelope.split('\n');
        assert_eq!(lines.next(), Some("你是陪伴剧本创作者思考与探索的助手。"));
        let rest: Vec<&str> = lines.collect();
        assert_eq!(rest.len(), 1, "信封恰有一个换行（拆段契约）");
        // 全部红线条款逐字在场（dsh-headless-generation 规格：永久边界＋诚实
        // 材料边界＋追问语义逐字保留于会话 system 层；评价条款为灰色地带新版，
        // add-posture-slot 任务 2.5）。
        for required in [
            "不直接修改用户文档",
            "不代写正文",
            "不润色",
            "不提供替换文本",
            "对故事的评价只给带依据的观察与假设，讲清线索与依据",
            "不用单一标准判定故事的好坏、正确或错误、高级或低级",
            "内容、解释、评价与方向的判断权都在用户",
            "只依据本次实际提供的作品材料及经授权工具实际返回的内容，说明参考范围",
            "未提供、未读取或未取得的内容，不得声称已经读过",
            "目录不等于正文，检索片段不等于全文",
            "不得声称具有跨讨论长期记忆",
            "追问围绕用户当前问题回应；首次选区仅在与当前问题相关时继续参考",
            "当前讨论中的既有问答可用于承接对话，但 AI 先前提出的猜测和候选不能当作作品事实",
            "不要输出 Markdown 或 HTML 格式，使用纯文本回答",
        ] {
            assert!(envelope.contains(required), "信封缺少红线条款: {required}");
        }
        // 旧评价条款由灰色地带三条款取代，不得复活（2026-10-07 拍板）。
        for prohibited_old in ["不判断故事好坏", "不判断正确或错误", "不判断高级或低级"]
        {
            assert!(
                !envelope.contains(prohibited_old),
                "旧评价条款已被灰色地带条款取代，不得出现: {prohibited_old}"
            );
        }
        // 过时限制不得复活（2026-10-06 修正的负断言随之迁移）。
        for prohibited in [
            "不能声称读取或使用",
            "追问仍锚定首次冻结选区",
            "只把已有轮次当作当前临时线性对话",
        ] {
            assert!(
                !envelope.contains(prohibited),
                "信封不得包含已修正的过时限制: {prohibited}"
            );
        }
        // 驱动侧 dsh-system-prompt 严格变量插值：未知 {{…}} 引用会 fail loud。
        assert!(
            !envelope.contains("{{"),
            "信封文本不得包含插值变量引用（{{）"
        );
        // 红线全文逐字锚定（add-posture-slot 任务 2.5，dsh-headless-generation
        // delta 定稿）：期望值用独立逐字字面量——常量漂移时此处必须失败。
        assert_eq!(
            rest[0],
            "不直接修改用户文档，不代写正文，不润色，不提供替换文本。\
             对故事的评价只给带依据的观察与假设，讲清线索与依据；不用单一标准判定故事的好坏、正确或错误、高级或低级；内容、解释、评价与方向的判断权都在用户。\
             只依据本次实际提供的作品材料及经授权工具实际返回的内容，说明参考范围。未提供、未读取或未取得的内容，不得声称已经读过；目录不等于正文，检索片段不等于全文。不得声称具有跨讨论长期记忆。\
             追问围绕用户当前问题回应；首次选区仅在与当前问题相关时继续参考。当前讨论中的既有问答可用于承接对话，但 AI 先前提出的猜测和候选不能当作作品事实。\
             不要输出 Markdown 或 HTML 格式，使用纯文本回答。",
            "红线全文必须与定稿文案逐字一致"
        );
    }

    /// 禁止双份投递（任务 2.5，system-prompt-layering 规格）：任一轮 user 文本
    /// （常驻链 compose_message_text 的三种消息与 legacy 链 build_task_string）
    /// 都不得携带身份句与红线条款——制度性内容只经 start_session 信封投递。
    #[test]
    fn user_texts_carry_no_constitution_clauses() {
        let identity = IDENTITY_SENTENCE;
        let constitution_markers = [
            "不直接修改用户文档",
            "只依据本次实际提供的作品材料及经授权工具实际返回的内容",
            "不得声称具有跨讨论长期记忆",
            "不要输出 Markdown 或 HTML 格式，使用纯文本回答",
        ];
        let context = Some("关注文档《设定》正文：\n林晓站在天台边。");

        let mut user_texts = vec![
            compose_message_text(AiMessageKind::First, "这个角色为什么犹豫？", None, None)
                .expect("first composes"),
            compose_message_text(
                AiMessageKind::First,
                "这个角色为什么犹豫？",
                Some("林站在天台边。"),
                context,
            )
            .expect("first with material composes"),
            compose_message_text(
                AiMessageKind::SummonFirst,
                "",
                Some("林站在天台边。"),
                context,
            )
            .expect("summon composes"),
            compose_message_text(AiMessageKind::FollowUp, "他为什么离开？", None, context)
                .expect("follow up composes"),
            compose_system_prompt(PromptEntry::DirectQuestion),
            compose_system_prompt(PromptEntry::Summon),
        ];
        user_texts.push(
            build_task_string(&GenerateAiRequest::First {
                selected_text: "林站在天台边。".to_string(),
                document_id: None,
                project_path: None,
                document_version: None,
                snapshot: None,
                thinking_direction: None,
            })
            .expect("legacy first task"),
        );
        user_texts.push(
            build_task_string(&GenerateAiRequest::DirectQuestion {
                question: "这段里人物在隐瞒什么？".to_string(),
                selected_text: Some("林站在天台边，没有回头。".to_string()),
                document_id: None,
                project_path: None,
                document_version: None,
                snapshot: None,
            })
            .expect("legacy direct question task"),
        );

        for (index, text) in user_texts.iter().enumerate() {
            assert!(
                !text.contains(identity),
                "user 文本[{index}]不得携带身份句（信封专属）: {text}"
            );
            for marker in constitution_markers {
                assert!(
                    !text.contains(marker),
                    "user 文本[{index}]不得携带红线条款「{marker}」（禁止双份投递）"
                );
            }
        }
    }

    /// 任务 5.4（add-agent-on-demand-reading）：工具使用层随系统提示词组装——
    /// 直接提问入口含四件套引导与「先请求授权」规范；召唤入口含「本轮不使用
    /// 补读工具」的硬门禁引导。措辞锚定防漂移。
    #[test]
    fn tool_reading_prompt_is_composed_for_both_entries() {
        let direct = compose_system_prompt(PromptEntry::DirectQuestion);
        assert!(direct.contains("story-list"), "直接提问应引导目录工具");
        assert!(
            direct.contains("story-request-reading"),
            "直接提问应引导授权请求"
        );
        assert!(
            direct.contains("先调用 story-request-reading 并说明原因"),
            "先请求后读取"
        );
        assert!(direct.contains("等用户决定后再继续"), "等待用户决定");
        assert!(
            direct.contains("读取不会\n修改作品任何内容")
                || direct.contains("读取不会修改作品任何内容"),
            "只读边界"
        );

        let summon = compose_system_prompt(PromptEntry::Summon);
        assert!(
            summon.contains("本轮只围绕提供的冻结选区回应，不使用补读工具"),
            "召唤首轮应声明不使用补读工具"
        );
        assert!(
            !summon.contains("先调用 story-request-reading"),
            "召唤首轮不得引导请求授权"
        );
    }

    /// 召唤首轮组装：含选区材料、不含问题文本、含召唤入口层立场句。
    #[test]
    fn summon_first_message_composes_selection_material_without_question() {
        let text = compose_message_text(
            AiMessageKind::SummonFirst,
            "",
            Some("林站在天台边，没有回头。"),
            None,
        )
        .expect("summon first composes");
        assert!(
            text.contains("当前请求只提供冻结选区原文，没有用户问题"),
            "必须包含召唤入口层立场句"
        );
        assert!(
            text.contains("林站在天台边，没有回头。"),
            "必须包含选区材料"
        );
        assert!(
            !text.contains("用户问题："),
            "召唤首轮不得出现直接提问的问题内容标签"
        );
        assert!(
            !text.contains("重点参考材料"),
            "召唤首轮不得出现直接提问的重点材料标签"
        );
        assert!(
            !text.contains("用户直接提出的问题"),
            "召唤首轮不得使用直接提问入口层立场句"
        );
    }

    /// 空选区的 SummonFirst 被拒（invalid_request）：选区是召唤的前提。
    #[test]
    fn summon_first_message_rejects_empty_selection() {
        for selection in [None, Some(""), Some("   \n  ")] {
            let err = compose_message_text(AiMessageKind::SummonFirst, "", selection, None)
                .expect_err("empty selection rejected");
            assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);
        }
    }

    // 重放首轮不再拼提示词前缀（任务 2.3，system-prompt-layering 规格）：
    // `replay_prompt_prefix` 已移除——重放会话的制度性内容由 start_session
    // 携带的信封提供（原发与重发逐字一致由 session_system_prompt 纯常量
    // 保证），重放轮次是前端显示历史的纯投影。前缀函数不再存在，此处无
    // 纯函数可测；协议级断言见 dsh_driver.rs 的
    // `start_session_carries_verbatim_constant_system_prompt`。

    /// First / FollowUp 的校验规则保持现状：question 非空。
    #[test]
    fn first_and_follow_up_still_require_non_empty_question() {
        let err = compose_message_text(AiMessageKind::First, "   ", Some("选区"), None)
            .expect_err("blank question rejected for First");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);

        let err = compose_message_text(AiMessageKind::FollowUp, "", None, None)
            .expect_err("blank question rejected for FollowUp");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);

        let text = compose_message_text(AiMessageKind::First, "这个角色为什么犹豫？", None, None)
            .expect("first composes");
        assert!(
            text.contains("当前请求提供用户直接提出的问题"),
            "First 必须使用直接提问入口层"
        );
        assert!(text.contains("用户问题：\n这个角色为什么犹豫？"));
    }

    /// 阶段五 A：常规 First / FollowUp 注入取材语境，及时召唤 SummonFirst 不注入。
    #[test]
    fn compose_message_text_injects_context_only_for_regular_entries() {
        let ctx = Some("关注文档《设定》正文：\n林晓站在天台边。");

        let first = compose_message_text(AiMessageKind::First, "这个角色为什么犹豫？", None, ctx)
            .expect("first composes");
        assert!(
            first.contains("关注文档《设定》正文"),
            "First 应注入取材语境"
        );
        assert!(first.contains("林晓站在天台边。"));

        let follow_up = compose_message_text(AiMessageKind::FollowUp, "他为什么离开？", None, ctx)
            .expect("follow up composes");
        assert!(follow_up.contains("他为什么离开？"));
        assert!(
            follow_up.contains("关注文档《设定》正文"),
            "FollowUp 应注入取材语境"
        );
        assert!(
            !follow_up.contains(IDENTITY_SENTENCE),
            "FollowUp 只发增量问题，不携带提示词前缀（消息结构不变）"
        );

        let summon =
            compose_message_text(AiMessageKind::SummonFirst, "", Some("林站在天台边。"), ctx)
                .expect("summon composes");
        assert!(
            !summon.contains("关注文档《设定》正文"),
            "及时召唤不得注入常规取材语境"
        );
    }

    // ========== 链路卡文本组装（add-making-module-core 任务 3.1，design D2） ==========

    use crate::chain_library::RequirementCard;

    fn card(title: &str, trigger: &str, body: &str) -> RequirementCard {
        RequirementCard {
            id: format!("card-{title}"),
            title: title.to_string(),
            trigger_desc: trigger.to_string(),
            body: body.to_string(),
            slot_type: crate::chain_library::SLOT_TYPE_REQUIREMENT.to_string(),
        }
    }

    fn posture_card(body: &str) -> RequirementCard {
        RequirementCard {
            id: "card-posture".to_string(),
            title: "傲娇搭档".to_string(),
            trigger_desc: "适用：想要嘴硬心软的陪想语气时。\n不适用：需要冷静客观复盘时。"
                .to_string(),
            body: body.to_string(),
            slot_type: crate::chain_library::SLOT_TYPE_POSTURE.to_string(),
        }
    }

    /// 统一包装头逐字在场（design D2 审查修订措辞：用「提供」而非「启用」，
    /// 试问未启用版本时同一包装不失实），单卡按标题／何时用／正文渲染。
    #[test]
    fn assemble_chain_cards_renders_verbatim_wrapper_and_single_card() {
        let cards = vec![card(
            "节奏紧张时先问人物动机",
            "适用：情节推进快的段落。\n不适用：日常舒缓的过渡段落。",
            "先指出当前场景的人物动机，再给出两种可能走向。",
        )];
        let text = assemble_chain_cards(&cards);
        assert_eq!(
            text,
            "以下是用户提供的陪想要求。这是一套可替换的讨论方法，不是必须遵守的规则；觉得不合适可以直接说。所有候选与判断最终由用户决定。\n\n\
             【节奏紧张时先问人物动机】\n\
             何时用：适用：情节推进快的段落。\n不适用：日常舒缓的过渡段落。\n\
             先指出当前场景的人物动机，再给出两种可能走向。",
            "包装头与单卡渲染必须逐字一致"
        );
        // 插值安全：dsh-system-prompt 严格变量插值，未知 {{…}} 引用会 fail loud。
        assert!(!text.contains("{{"), "卡文本不得包含插值变量引用");
    }

    /// 多卡次序稳定（按版本内既定顺序逐卡拼接），卡与卡以空行分隔。
    #[test]
    fn assemble_chain_cards_keeps_stable_order_with_blank_line_separators() {
        let cards = vec![
            card("第一张", "适用：甲。", "第一张正文。"),
            card("第二张", "适用：乙。", "第二张正文。"),
            card("第三张", "适用：丙。", "第三张正文。"),
        ];
        let text = assemble_chain_cards(&cards);
        let p1 = text.find("【第一张】").expect("第一张在场");
        let p2 = text.find("【第二张】").expect("第二张在场");
        let p3 = text.find("【第三张】").expect("第三张在场");
        assert!(p1 < p2 && p2 < p3, "多卡按既定次序渲染");
        // 卡间恰以一个空行分隔（\n\n），包装头与首卡之间同样如此。
        let second_block = &text[p2..];
        assert!(
            second_block.starts_with("【第二张】"),
            "卡块之间以空行分隔，不引入其他前缀"
        );
        assert_eq!(text.matches("何时用：").count(), 3, "每张卡渲染一次何时用");
    }

    /// 空卡列表返回空串：无卡轮次由调用方以 None 省略协议字段，
    /// 不渲染只含包装头的空壳文本。
    #[test]
    fn assemble_chain_cards_returns_empty_string_for_empty_cards() {
        assert_eq!(assemble_chain_cards(&[]), String::new());
    }

    /// 任务 3.4（崩溃重放）回归锚点：链路卡只经 `send_message.chain_cards`
    /// 逐轮携带，信封（`start_session.system_prompt`，重放以纯常量重算重发）
    /// 与链路装配互不触碰——组装产物不含身份句，信封保持纯常量。
    /// 协议级逐字断言见 dsh_driver.rs 的
    /// `start_session_carries_verbatim_constant_system_prompt`。
    #[test]
    fn chain_cards_assembly_leaves_session_envelope_constant_untouched() {
        let cards = vec![card("卡名", "适用：甲。", "正文。")];
        let assembled = assemble_chain_cards(&cards);
        let envelope = session_system_prompt();
        assert_eq!(envelope, session_system_prompt(), "信封保持纯常量");
        assert!(
            !assembled.contains(IDENTITY_SENTENCE),
            "卡文本不得内嵌身份句（信封专属）"
        );
        assert_ne!(assembled, envelope);
    }

    // ========== 姿态段组装（add-posture-slot 任务 2.4，design D3） ==========

    /// 承接句逐字常量（装置文本定稿，C3 验证）：任何漂移必须在此失败。
    #[test]
    fn posture_wrapper_header_is_verbatim_constant() {
        assert_eq!(
            POSTURE_WRAPPER_HEADER,
            "你的出场姿态由用户设定如下，以此声音陪伴讨论；判断与红线仍按后文宪法执行。该姿态可随时换掉。"
        );
    }

    /// 姿态段组装（单卡）：承接句＋空行＋正文原样；剥去正文开头的【…】单行
    /// 标题行；触发描述与卡名不进注入文本（去元数据，design D3）。
    #[test]
    fn assemble_posture_renders_header_plus_verbatim_body_without_metadata() {
        let card = posture_card("【傲娇搭档】\n你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。");
        let text = assemble_posture(std::slice::from_ref(&card));
        assert_eq!(
            text,
            "你的出场姿态由用户设定如下，以此声音陪伴讨论；判断与红线仍按后文宪法执行。该姿态可随时换掉。\n\n\
             你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。",
            "承接句＋空行＋正文（开头标题行已剥去）必须逐字一致"
        );
        // 去元数据：触发描述与卡名标记不进注入文本。
        assert!(!text.contains("适用："), "触发描述（何时用）不得进注入文本");
        assert!(
            !text.contains("不适用："),
            "触发描述（不适用）不得进注入文本"
        );
        assert!(!text.contains("傲娇搭档"), "卡名不得以标题行之外的途径混入");
        // 插值安全：未知 {{…}} 引用会 fail loud。
        assert!(!text.contains("{{"), "姿态文本不得包含插值变量引用");
    }

    /// 多卡拼接（2026-10-07 修订 7.2，design D3／chain-assembly「多卡拼接」）：
    /// 承接句仅出现一次；各卡正文（各自剥去开头【…】标题行）以空行**依序**
    /// 拼接；不编序号、不加执行顺序暗示；去元数据对每张卡成立。
    #[test]
    fn assemble_posture_concatenates_multiple_cards_with_single_header() {
        let cards = vec![
            posture_card("【傲娇搭档】\n你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。"),
            posture_card("你以冷静读者的姿态看剧本，先找动机再谈感受。"),
        ];
        let text = assemble_posture(&cards);
        assert_eq!(
            text,
            "你的出场姿态由用户设定如下，以此声音陪伴讨论；判断与红线仍按后文宪法执行。该姿态可随时换掉。\n\n\
             你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。\n\n\
             你以冷静读者的姿态看剧本，先找动机再谈感受。",
            "承接句一次＋两卡正文以空行依序拼接（无序号、无顺序暗示）"
        );
        // 承接句恰好出现一次（多卡不得重复包装）。
        assert_eq!(
            text.matches(POSTURE_WRAPPER_HEADER).count(),
            1,
            "承接句只出现一次"
        );
        // 正文次序＝卡序；卡间恰以一个空行分隔。
        let first_at = text.find("你嘴硬心软").expect("首卡正文在场");
        let second_at = text.find("你以冷静读者").expect("次卡正文在场");
        assert!(first_at < second_at, "正文按版本内既定次序拼接");
        assert!(
            text[first_at + "你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。".len()..]
                .starts_with("\n\n你以冷静读者"),
            "卡间恰以一个空行分隔，不引入其他分隔符"
        );
        // 不编序号／顺序暗示；去元数据对每张卡成立。
        for hint in [
            "姿态1",
            "姿态 1",
            "姿态一",
            "第一张",
            "其次",
            "然后",
            "优先",
        ] {
            assert!(!text.contains(hint), "不得出现序号或执行顺序暗示: {hint}");
        }
        assert!(!text.contains("适用："), "任一卡的触发描述不得进注入文本");
        assert!(!text.contains("傲娇搭档"), "任一卡的卡名不得混入");
        // 插值安全。
        assert!(!text.contains("{{"), "姿态文本不得包含插值变量引用");
    }

    /// 空姿态卡列表返回空串：调用方以 None 省略协议字段，不渲染只含承接句
    /// 的空壳文本（行为与修订前一致）。
    #[test]
    fn assemble_posture_returns_empty_string_for_empty_cards() {
        assert_eq!(assemble_posture(&[]), String::new());
    }

    /// 正文原样传递：无标题行时逐字不动；正文内部的【…】行不剥（只剥开头）；
    /// 正文非【开头时一字不改。
    #[test]
    fn assemble_posture_keeps_body_verbatim_without_leading_title() {
        // 无标题行：逐字不动。
        let plain = posture_card("你说话嘴硬心软。");
        assert!(
            assemble_posture(std::slice::from_ref(&plain)).ends_with("你说话嘴硬心软。"),
            "无标题行的正文逐字保留"
        );

        // 内部【…】行不剥（只剥开头标题行），其余逐字不动。
        let inner = posture_card("你说话嘴硬心软。\n【内部小节】\n看剧本先找动机。");
        let text = assemble_posture(std::slice::from_ref(&inner));
        assert!(
            text.contains("你说话嘴硬心软。\n【内部小节】\n看剧本先找动机。"),
            "正文内部内容逐字保留（只剥开头标题行）"
        );

        // 首行不以「】」收尾（不是标题行）：不剥。
        let not_title = posture_card("【开头但没有收尾 标题行不成立\n正文第二行。");
        assert!(
            assemble_posture(std::slice::from_ref(&not_title))
                .contains("【开头但没有收尾 标题行不成立\n正文第二行。"),
            "首行不以】收尾时不视为标题行，正文逐字保留"
        );
    }

    /// 任务 2.6（崩溃重放姿态语义，信封侧）：姿态段只经 `send_message.posture`
    /// 逐轮携带；信封（`start_session.system_prompt`）保持纯常量、不含姿态
    /// 承接句与姿态正文——重放会话与原会话的 system 层逐字一致（姿态恢复靠
    /// 恢复后首轮按当前指针重新冻结，不从信封或历史复原）。
    #[test]
    fn posture_assembly_leaves_session_envelope_constant_untouched() {
        let cards = vec![
            posture_card("【傲娇搭档】\n你嘴硬心软。"),
            posture_card("你以冷静读者的姿态看剧本。"),
        ];
        let assembled = assemble_posture(&cards);
        let envelope = session_system_prompt();
        assert_eq!(envelope, session_system_prompt(), "信封保持纯常量");
        assert!(
            !assembled.contains(IDENTITY_SENTENCE),
            "姿态文本不得内嵌身份句（信封专属）"
        );
        assert!(
            !envelope.contains(POSTURE_WRAPPER_HEADER),
            "信封不得包含姿态承接句（姿态逐轮经协议字段携带）"
        );
        assert_ne!(assembled, envelope);
    }
}
