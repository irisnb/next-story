## Why

LLM 配置页已经追踪当前输入是否被修改，但返回按钮和窗口关闭流程没有使用这个状态。用户填写 API 地址、API Key 或模型名后，如果没有保存就返回或关闭应用，输入会静默丢失。

这个问题现在需要单独修复，因为它属于系统配置页的数据丢失保护，不应和草稿本、正文本的手动保存语义混在一起。

## What Changes

- LLM 配置页在用户修改 API 地址、API Key 或模型名后，必须把当前配置输入视为未保存修改。
- 用户从配置页返回欢迎页或编辑器前，如果配置输入未保存，系统必须先给出离开确认，而不是直接切页。
- 用户关闭窗口前，如果配置页存在未保存配置输入，系统必须接入关闭保护，而不是只检查编辑器文本是否未保存。
- 用户必须能选择保存并离开、放弃修改并离开，或取消离开继续编辑配置。
- 保存成功后，系统必须更新配置页的保存基线并清除未保存状态；保存失败时不得离开，也不得清除未保存状态。
- 离开确认不得显示 API Key 明文。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `llm-configuration`: 增加 LLM 配置页未保存修改的返回与窗口关闭保护要求。

## Impact

- Affected frontend state and UI flow:
  - `src/llm-config-state.ts`
  - `src/llm-config-form.ts`
  - `src/main.ts`
  - existing leave/close coordination around `src/close-guard.ts` and `src/leave-dialog.ts`
- Affected tests:
  - `tests/llm-config-state.test.ts`
  - frontend DOM or close-guard tests as needed for return and close behavior
- No backend API change is expected.
- This change must not alter草稿本/正文本保存 semantics and must not write LLM 配置 into project files.
