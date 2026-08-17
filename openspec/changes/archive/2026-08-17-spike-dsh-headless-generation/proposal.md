## Why

在把整个后端（8 个命令）一次性迁移到 DeepSeek Harness（DSH）之前，必须先验证 DSH 的 headless 模式能真正扛住 Next Story 的 AI 生成链路——冻结选区 + 可选方向 + 无状态全量历史线性追问。DSH 仍是 developer preview（7 天发 7 版、官方声明会有破坏性变更），先用最小代价验证可行性，避免「迁到一半发现地基承不住」。

## What Changes

- 新增一个 headless DSH sidecar，通过它跑 AI 生成链（等价于现有 `generate_ai_thinking`），作为**实验性并行路径**，不改动现有 Rust 生成链（作为对照）。
- DSH 精确锁版 `0.1.0-rc.7`，并 vendor Node 22.19+ 运行时。
- 把 `dsh-credentials-keyring` 挂进 DSH 凭据接缝（`ctx.credentials`），验证 API Key 复用。
- 建立 Tauri 壳「启动 / 看守 / 关停」sidecar 进程的通路。
- 不迁移作品生命周期（create/open/save）与 LLM 配置（save/load/test）命令——属于本 spike 之外。

## Capabilities

### New Capabilities
- `dsh-headless-generation`: 通过 headless DSH sidecar 生成 AI 思考响应，保持现有生成行为（冻结选区 + 可选方向 + 线性追问）与错误契约不变。

### Modified Capabilities

<!-- 无：现有 spec 行为不变，本 spike 是等价实现迁移，不改需求。 -->

## Impact

- 新增依赖：`@deepseek-ai/dsh@0.1.0-rc.7`（精确锁版）+ Node 22.19+ 运行时（vendor）。
- Tauri 壳新增 sidecar 启动 / 看守代码。
- `dsh-credentials-keyring` 挂载进 DSH 凭据接缝。
- `generate_ai_thinking` 链路新增一条 DSH 支持的实验路径（默认仍走 Rust，可切换对照）。
