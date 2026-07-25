## Why

`思维扩展`首次请求可以携带用户填写的方向，并且后端会把该方向放入首次 user message 中。但当前临时对话只保留冻结选区、首次回复和后续追问轮次；继续追问时前端重新发送的材料无法表达首次方向，后端只能把首次 user message 重建为纯选区。结果是同一条临时对话在第一轮按用户方向展开，第二轮开始却丢失这个方向，回答依据发生漂移。

## What Changes

- Preserve the initial user material used to start the current temporary conversation, including the optional `思维扩展` direction when present.
- Ensure follow-up requests send enough structured conversation state for the backend to reconstruct the same first user message that the first request used.
- Keep `及时召唤` unchanged: it still starts without user direction, so its first user material remains the frozen selected text only.
- Add regression coverage proving a `思维扩展` follow-up request keeps the original direction and does not add unsupported context.

## Capabilities

### New Capabilities


### Modified Capabilities
- `ai-thinking-panel`: Clarify that a `思维扩展` temporary conversation retains its initial direction-bearing user material for later follow-ups.
- `summon-ai-follow-up`: Clarify that follow-up requests reuse the original first user material, not a lossy reconstruction from selected text alone.

## Impact

- Affected frontend modules: `src/ai-feature.ts`, `src/ai-panel-state.ts`, and `src/ai-request.ts` depending on where the current temporary conversation stores request metadata.
- Affected backend request assembly: `src-tauri/src/llm_config/generate.rs` if the request schema or first-message reconstruction needs to accept preserved initial user material.
- Affected tests: AI panel DOM/state tests under `tests/`, and Rust generation tests if backend message assembly changes.
- No persistent conversation history, summary, nearby context, full notebook text, AI content library, user-confirmed story information, or direct notebook write behavior changes.
