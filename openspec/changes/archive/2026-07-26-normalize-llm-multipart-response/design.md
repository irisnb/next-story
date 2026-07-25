## Context

The LLM HTTP boundary accepts OpenAI-compatible chat-completions responses for both configuration testing and AI thinking generation. The current implementation recognizes assistant content as either a string or an array, but array extraction returns after the first non-empty text part. That creates a mismatch: a multipart response can pass connection testing while generation returns only the first segment.

The fix belongs at the Rust response-normalization boundary so every caller receives the same assistant text semantics. The AI output remains temporary panel material and must not gain any path to modify草稿本 or 正文本.

## Goals / Non-Goals

**Goals:**

- Use one normalization rule for assistant content in connection testing and generation.
- Preserve string `message.content` behavior.
- For array content, gather every valid non-empty text part in source order and return the complete text.
- Keep responses without any valid non-empty assistant text as invalid responses.
- Add focused Rust regression tests for multipart content.

**Non-Goals:**

- Changing prompt construction, AI panel state, follow-up transcript rules, or request payload shape.
- Adding streaming, tool-call handling, image/audio content handling, or provider-specific adapters.
- Persisting AI conversations or adding any AI write-back operation.
- Changing LLM configuration UI, model list behavior, or API-key storage.

## Decisions

1. Normalize at the HTTP response boundary.

   `post_chat_completions` already owns the raw provider response. Keeping multipart handling there prevents generation and connection testing from inventing separate validity rules.

   Alternative considered: normalize only in generation. That would leave connection testing and generation with different behavior, which is the current class of bug.

2. Join multipart text parts with a newline separator.

   Multipart text parts are ordered fragments of one assistant reply. A newline preserves readable separation without inventing prose or merging words across provider part boundaries.

   Alternative considered: concatenate with no separator. That can corrupt responses when providers split paragraphs or sentences across parts.

3. Ignore empty and non-text array parts when extracting assistant text.

   OpenAI-compatible providers may include structured parts that are not plain text. Next Story only displays plain temporary text in the AI panel, so non-text parts do not become user-visible content. The response remains invalid if no non-empty text parts exist.

   Alternative considered: fail on any unknown part. That would reject otherwise useful text replies from providers that include extra structured metadata.

## Risks / Trade-offs

- Multipart providers may intend some non-text parts to carry meaning -> This change deliberately exposes only plain text because the current AI panel is text-only and the product has not proposed multimodal or tool-call rendering.
- Newline joining may add line breaks where a provider expected tighter concatenation -> This is safer than silently collapsing part boundaries and is easy for the user to read and copy.
- Tests may need a local mock HTTP server shape that mirrors existing LLM tests -> Keep the regression tests inside the current Rust test module and reuse existing helpers where possible.
