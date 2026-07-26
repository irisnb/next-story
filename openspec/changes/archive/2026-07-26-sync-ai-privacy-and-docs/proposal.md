## Why

Current AI generation can send selected story text, an optional thinking direction, and the temporary follow-up conversation to the configured model service, but the configuration page only warns that the API Key is sent. README and AGENTS also still describe parts of the implemented AI entry as future or unavailable, which can mislead users and future contributors about the real data flow.

## What Changes

- Update the LLM configuration experience so users can clearly see which data is sent during connection testing versus AI generation.
- Add a first-use confirmation for each configured API origin before creative text is sent for AI generation, showing the normalized service origin without exposing the API Key.
- Sync README with the implemented AI surface: separate `AI 及时召唤` with no initial input from `思维扩展` with optional direction input, and describe the current temporary follow-up data flow accurately.
- Sync AGENTS current-state summary with the archived specs so contributors do not treat implemented `思维扩展` behavior as future-only or nonexistent.
- Keep the permanent boundary unchanged: AI output remains temporary material and no AI flow writes to 草稿本 or 正文本.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `llm-configuration`: require explicit user-facing disclosure of the data sent to configured model services, including the difference between test requests and AI generation requests, plus per-origin first-use confirmation before creative content leaves the machine.
- `project-readme`: require README to describe implemented `AI 及时召唤`, implemented `思维扩展`, temporary follow-up, and AI data flow without labeling implemented behavior as future-only.
- `project-mission-governance`: require AGENTS current-state summary to match the implemented `AI 及时召唤` and `思维扩展` behavior while preserving concise governance boundaries.

## Impact

- Frontend LLM configuration UI and AI generation start flow.
- Local app state needed to remember which API origins have already been confirmed during the current appropriate scope.
- Frontend tests covering privacy copy, first-use confirmation, and docs/spec synchronization expectations.
- Documentation updates in `README.md` and `AGENTS.md`.
- No new provider list, model slot, AI write-back path, persistent conversation store, or notebook mutation behavior.
