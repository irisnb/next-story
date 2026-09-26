# project-readme Specification Delta

## MODIFIED Requirements

### Requirement: README distinguishes implemented truth, future direction, and permanent boundaries

项目 README MUST 只将正式规格确认的产品能力描述为已实现，MUST 将未来方向标记为未实现，并 MUST 将永久 AI 边界与普通未实现项目分开说明。

#### Scenario: README lists implemented capabilities

- **WHEN** README 声明当前已实现的产品能力
- **THEN** 每项声明都有当前正式规格中的要求作为依据
- **AND** README 可以将"常驻 AI 会话支持直接提问（选区作为可选重点提示自动附带）"写为已实现
- **AND** README 可以将"及时召唤：选中文字后通过浮动入口以选区为材料无打字发起流式讨论"写为已实现
- **AND** README 可以将"回复流式逐字呈现，追问只发送增量问题"写为已实现
- **AND** README 可以将"首次回应成功后进行线性临时追问，可取消生成"写为已实现
- **AND** README 可以将"多窗口：多个讨论窗口同时显示、默认停靠、可拖出浮动、移动、缩放与并排对照"写为已实现
- **AND** README 可以将"关闭窗口不删除讨论，生成中关闭自动停止对应生成；用户可停止生成"写为已实现
- **AND** README 可以将"及时召唤快车道：常规生成进行中可独立发起；超出并发上限时在对应窗口排队"写为已实现
- **AND** README 可以将"驱动进程崩溃后自动重启并重放显示历史恢复会话"写为已实现
- **AND** README 可以将"讨论保存到作品文件夹、重启后按作品提供会话列表并可重开"写为已实现
- **AND** README 可以将"文档级 AI 可见性：可单独设置文档是否允许 AI 查看，受控读取统一校验作品、文档、版本与快照身份"写为已实现
- **AND** README 可以将"常规讨论自动现场材料：首轮与追问自动附带关注文档现场（已保存正文或经校验的未保存快照）、允许目录投影与跨文档字面检索片段，材料出处轻量可查看"写为已实现
- **AND** README 可以将"按需补读：材料不足时模型发起授权请求，用户允许后围绕问题经受控只读工具补读，授权属于讨论、可随时关闭、跨重启保留"写为已实现
- **AND** README 说明新召唤或新建对话开启新讨论并保留旧讨论，讨论不跨重启丢失
- **AND** README 如实说明思维扩展已退场（经用户确认），及时召唤与选区浮动入口已恢复为正式功能
- **AND** README 不得把附近文本、整本摘要、语义或向量检索、AI 内容库、作品信息、自动摘要、多 provider 或多模型支持写成已实现

#### Scenario: README refers to future direction

- **WHEN** README 提及尚未归档进正式规格的产品方向
- **THEN** README 将该内容明确标记为未来方向或当前未实现
- **AND** README 不把方向文档当作已实现事实来源

#### Scenario: README states the permanent AI notebook boundary

- **WHEN** README 说明 AI 与作品文档的关系
- **THEN** README 明确说明首次回应、用户追问和后续 AI 回应都只属于作品文档之外的临时材料
- **AND** README 明确说明 AI 永远不能插入、追加、替换、改写、删除、移动或整理内容树中的作品文档内容
- **AND** README 说明内容只有经过用户亲手复制、粘贴、编辑并保存后才进入作品事实

### Requirement: README separates setup, terminating checks, and long-running development commands
项目 README SHALL 说明经核对的开发前置条件和依赖安装步骤（含根目录与 sidecar 的依赖安装、打包所需内置 Node 运行时的准备方式与锁定版本），并 MUST 区分会执行完并返回的命令与需要用户主动停止的开发命令；README SHALL 说明标准检查命令 `npm run check` 覆盖的科目范围，并说明 CI 使用同一套门禁。

#### Scenario: Reader prepares the development environment
- **WHEN** 读者准备首次运行项目
- **THEN** README 列出与当前 Tauri、前端和 Rust 项目一致的前置条件，并明确 Node 的版本要求
- **AND** README 给出当前仓库适用的依赖安装步骤（根目录与 `sidecar/` 各自安装依赖）
- **AND** README 说明打包额外需要按脚本准备内置 Node 运行时（锁定版本、仅 Windows）

#### Scenario: Reader runs a terminating command
- **WHEN** 读者查看 `npm run check`、`npm run typecheck`、`npm run test:frontend`、`npm run build`、`npm run test:rust` 或 `npm run tauri:build`
- **THEN** README 说明这些命令执行完成后会返回终端
- **AND** README 简要说明各命令验证或生成什么，并说明 `npm run check` 的完整科目与「CI 执行同一套」的关系

#### Scenario: Reader runs a development command
- **WHEN** 读者查看 `npm run dev` 或 `npm run tauri:dev`
- **THEN** README 说明这些开发命令会持续运行且不自动返回
- **AND** README 说明用户需要关闭窗口或按 `Ctrl+C` 停止
- **AND** README 说明首次 Rust 编译可能需要较长时间，持续运行或暂时安静不代表卡死

#### Scenario: Reader prepares an installer build
- **WHEN** 读者准备构建 Windows 安装包
- **THEN** README 说明先安装 sidecar 依赖并按脚本准备内置 Node 运行时
- **AND** README 说明构建前的资源校验会在缺件时以中文错误中止，不产出缺少运行时的安装包

### Requirement: README explains the one-way architecture and current data flows

项目 README SHALL 用初学者可理解的语言说明"前端 → bridge → Tauri commands → Rust domain"的单向责任传递，并 SHALL 说明作品生命周期、LLM 配置和测试、AI 生成与临时追问三条当前数据流。

#### Scenario: Reader follows the architecture chain

- **WHEN** 读者查看架构说明
- **THEN** README 将前端定位到 `src/`
- **AND** README 将 bridge 定位到 `src/project-api.ts`
- **AND** README 将 Tauri commands 定位到 `src-tauri/src/lib.rs`
- **AND** README 将 Rust domain 定位到 `src-tauri/src/project/` 与 `src-tauri/src/llm_config/`
- **AND** README 说明结果和错误会沿调用链返回前端

#### Scenario: Reader follows project lifecycle data

- **WHEN** 读者查看新建、打开、手动保存或切换文档的作品流程
- **THEN** README 说明前端动作经 bridge 和对应 Tauri command 进入 Rust project domain
- **AND** README 说明 project domain 负责校验并读写作品目录
- **AND** README 说明处理结果返回界面
- **AND** README 说明切换文档前会先保存当前文档；保存失败时保留当前内容并提示，不执行切换

#### Scenario: Reader follows LLM configuration and test data

- **WHEN** 读者查看 LLM 配置加载、保存或连接测试流程
- **THEN** README 说明配置表单经 bridge 和对应 Tauri command 进入 Rust llm_config domain
- **AND** README 说明该 domain 负责校验和应用本地配置读写，或使用当前唯一配置发出真实 OpenAI-compatible 测试请求
- **AND** README 说明测试连接只发送固定测试语句和身份凭据，不发送用户剧本文字或讨论内容
- **AND** README 说明成功状态或可读错误返回界面

#### Scenario: Reader follows AI generation and follow-up data

- **WHEN** 读者查看 AI 生成或临时追问流程
- **THEN** README 说明直接提问发送用户问题、可选选区重点材料，以及自动附带的关注文档现场材料（已保存正文或经校验的未保存快照）、允许目录投影与跨文档字面检索片段
- **AND** README 说明继续追问只发送本次新增问题，并由系统重新取得发送时刻的关注文档最新现场材料，此前问答由常驻会话在驱动进程内维护
- **AND** README 说明及时召唤以冻结选区为材料发起，不经过常规自动取材流程
- **AND** README 说明这些创作内容与材料会发送给用户配置的 API 服务，DSH 运行期会话上下文在驱动进程内存中维护，讨论记录由应用保存到作品文件夹内 `next-story-system/conversations/` 并可在重启后重开，删除讨论或应用退出时结束对应会话
- **AND** README 说明 AI 返回内容只显示在 AI 面板中，不能写回作品文档
