## 1. Response Normalization

- [x] 1.1 Add a shared assistant content normalization helper in `src-tauri/src/llm_config/http.rs` for string and array content.
- [x] 1.2 Update connection testing and generation response extraction to use the shared helper.
- [x] 1.3 Ensure multipart text parts are trimmed, filtered for non-empty text, preserved in order, and joined with newline separators.
- [x] 1.4 Ensure responses with no non-empty assistant text still return the existing invalid-response error path.

## 2. Regression Tests

- [x] 2.1 Add Rust test coverage for string `message.content` preserving existing behavior.
- [x] 2.2 Add Rust test coverage for array content with multiple non-empty text parts returning the full joined response.
- [x] 2.3 Add Rust test coverage for empty parts and unknown non-text parts being ignored while valid text parts remain usable.
- [x] 2.4 Add Rust test coverage for array content with no valid text parts being rejected.

## 3. Verification

- [x] 3.1 Run the focused Rust LLM configuration tests.
- [x] 3.2 Run `npm run test:rust` or document any environment blocker.
- [x] 3.3 Run `openspec validate normalize-llm-multipart-response --strict`.
