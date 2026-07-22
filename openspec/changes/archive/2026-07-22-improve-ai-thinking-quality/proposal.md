## Why

The current selection AI invocation and follow-up flow is functional, but its response contract is still too loose: the model can drift from the frozen selection, answer like a general writing judge, or imply it knows more context than the system provides.

This change tightens the existing AI thinking behavior so the first version feels like a trustworthy writing-site thinking companion while preserving the product boundary that AI output remains temporary material outside the draft and manuscript notebooks.

## What Changes

- Require the first AI response to stay anchored to the frozen selected text and make clear what is observed from the text versus what is only a possible interpretation.
- Require follow-up responses to remain anchored to the same frozen selection and the current temporary linear conversation, without implying access to surrounding text, full work context, history, memory, or confirmed work facts.
- Require AI responses to prioritize observations, questions, and possible directions over verdicts, rewrites, polish, replacement text, or decisions for the user.
- Forbid judgment-style language that rates the story as good/bad, right/wrong, advanced/basic, or otherwise treats one theory as a universal rule.
- Preserve the existing product scope: no new AI entry point, no thinking expansion entry, no conversation history, no persistence, no full-work reading, no AI content library, and no write-back path into draft or manuscript notebooks.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `selection-ai-invocation`: Tighten the first-response AI thinking contract for frozen selected text.
- `summon-ai-follow-up`: Tighten the follow-up response contract for the existing temporary linear conversation anchored to the frozen selection.

## Impact

- Backend AI message construction in `src-tauri/src/llm_config/generate.rs` will need updated fixed prompt/message instructions and tests.
- Existing frontend request flow and panel structure should remain unchanged except where tests require terminology alignment.
- No new dependencies, model providers, stored data, UI entry points, or write access to draft/manuscript text are introduced.
