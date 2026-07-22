## 1. Backend Prompt Contract

- [x] 1.1 Inspect `src-tauri/src/llm_config/generate.rs` message construction for first invocation and follow-up requests
- [x] 1.2 Update first-invocation prompt instructions so responses stay anchored to the frozen selection, separate observations from possible interpretations, and provide questions plus possible directions
- [x] 1.3 Update follow-up prompt instructions so responses stay anchored to the original frozen selection and current temporary linear conversation only
- [x] 1.4 Add explicit prompt prohibitions against direct rewriting, polishing, replacement text, story verdicts, full-context claims, history/memory claims, AI content library claims, and confirmed-work-fact claims

## 2. Tests

- [x] 2.1 Add or update Rust tests that assert first-invocation message construction includes the core grounding, observation/interpretation, question/direction, and no-write-back obligations
- [x] 2.2 Add or update Rust tests that assert follow-up message construction includes the frozen-selection anchor and treats prior turns only as current temporary conversation material
- [x] 2.3 Add or update Rust tests that assert prompt construction does not request nearby context, full text, summaries, AI content library, persistent history, direct rewrite, polish, or replacement text

## 3. Verification

- [x] 3.1 Run focused Rust tests for `llm_config` prompt/message construction
- [x] 3.2 Run the repository check command and confirm the change does not require frontend UI, data persistence, dependency, model-provider, or write-back changes
