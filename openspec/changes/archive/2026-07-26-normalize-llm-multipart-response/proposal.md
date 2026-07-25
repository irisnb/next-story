## Why

Some OpenAI-compatible services return assistant `message.content` as an ordered array of text parts instead of one string. Next Story currently accepts that structure during connection validation, but generation extracts only the first non-empty text part, silently dropping the rest of the model reply.

This must be fixed before users rely on compatible providers that emit multipart content, because truncated AI panel material gives an incomplete model response without any visible error.

## What Changes

- Normalize assistant response content with one shared rule for both connection testing and AI thinking generation.
- Preserve the current string content behavior.
- For array content, collect all valid non-empty text parts in their original order and join them into one assistant reply using an explicit separator.
- Ignore non-text or empty parts without treating the whole response as valid unless at least one text part remains.
- Keep invalid, empty, non-JSON, error-object, or no-choice responses as failures.
- Do not change prompts, conversation persistence, model selection, provider configuration, or any writing-notebook behavior.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `llm-configuration`: clarify that OpenAI-compatible assistant content arrays are normalized by preserving all valid text parts, not only the first one, and that connection testing and generation use the same response-validity semantics.

## Impact

- Affected Rust response boundary: `src-tauri/src/llm_config/http.rs`.
- Affected generation path: `src-tauri/src/llm_config/generate.rs` only through the normalized assistant text it receives.
- Affected tests: `src-tauri/tests/llm_config_test.rs` should cover string content, multipart text content, empty parts, unknown parts, and invalid responses.
- No new dependencies, no frontend UI changes, no persistence migration, and no changes to草稿本 or 正文本 write behavior.
