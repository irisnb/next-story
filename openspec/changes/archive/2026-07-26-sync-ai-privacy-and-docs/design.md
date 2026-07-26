## Context

The app already sends real OpenAI-compatible requests from the saved single LLM configuration. A test request only needs a fixed test message, while AI generation can include selected story text, an optional `thinking_direction`, successful assistant replies, and all successful follow-up turns held in the current temporary conversation.

The permanent product boundary remains unchanged: AI material stays outside 草稿本 and 正文本, and no AI flow may write back to either notebook. This change is about making the real outbound data flow visible to users and keeping contributor-facing docs aligned with the archived specs.

## Goals / Non-Goals

**Goals:**

- Show clear privacy copy on the LLM configuration page that distinguishes connection testing from AI generation.
- Require a first-use confirmation for the configured API origin before creative text is sent to that service.
- Normalize and display the target origin without exposing the API Key or request body.
- Update README and AGENTS so they describe implemented `AI 及时召唤`, implemented `思维扩展`, and temporary follow-up accurately.
- Add focused tests for privacy notice behavior and document synchronization expectations.

**Non-Goals:**

- No new provider list, model switcher, model presets, or multiple configuration slots.
- No persistent AI conversation history or server-side session store.
- No AI write-back, apply-to-notebook, automatic rewrite, or notebook mutation path.
- No change to the model request content beyond gating it behind a user-visible confirmation.

## Decisions

1. Keep the disclosure in the configuration page and the send confirmation in the AI generation flow.

   The configuration page is where users decide which third-party service to trust, so it should explain the categories of data each action can send. The AI generation flow is the moment creative text actually leaves the machine, so it should own the confirmation. A passive settings notice alone is too easy to miss; a confirmation on every request would interrupt writing too often.

2. Confirm by normalized API origin, not by raw API base URL.

   The user needs to recognize the service receiving content, not the exact internal endpoint string. The confirmation should show scheme, host, and port derived with structured URL parsing, and it must not show API Key, Authorization headers, selected text, direction text, or conversation content.

3. Remember confirmation in frontend state for the current app session.

   The existing generation request contract and Rust backend do not persist conversations. Keeping the confirmation cache in frontend runtime state matches the current temporary AI model and avoids creating a new persistent privacy database. If the configured origin changes, the next generation attempt requires confirmation for the new origin.

4. Treat README and AGENTS updates as spec-covered behavior, not copy-only cleanup.

   These documents guide future agents and contributors. If they deny implemented `思维扩展` behavior, later changes can accidentally remove or mis-scope real capabilities. The delta specs therefore describe what the docs must say at the requirement level while leaving detailed behavior in the main AI specs.

## Risks / Trade-offs

- [Risk] A confirmation prompt can interrupt the first AI request in a writing session. -> Mitigation: show it only before sending creative content to an unconfirmed origin, and remember accepted origins for the app session.
- [Risk] Privacy copy can become too broad and sound like legal boilerplate. -> Mitigation: state concrete payload categories in plain language: test phrase, selected text, direction, and temporary conversation.
- [Risk] Showing raw URLs can leak secrets if a malformed URL includes user info. -> Mitigation: use structured URL parsing and show only normalized origin; existing API address validation rejects user info.
- [Risk] Docs can drift again when AI payload fields change. -> Mitigation: add documentation tasks/tests that tie UI action/request-field changes to README, AGENTS, and specs updates.
