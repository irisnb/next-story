## 1. Privacy Notice And Confirmation

- [x] 1.1 Update LLM configuration page copy to distinguish test connection payload from AI generation payload.
- [x] 1.2 Add frontend runtime confirmation state keyed by normalized API origin for creative-content sends.
- [x] 1.3 Gate AI invocation and thinking expansion generation before the first request to an unconfirmed API origin.
- [x] 1.4 Gate follow-up generation before the first request to an unconfirmed API origin.
- [x] 1.5 Ensure cancellation prevents the model request and does not mutate 草稿本, 正文本, or project metadata.

## 2. Documentation Sync

- [x] 2.1 Update README current-capability sections to include implemented AI 及时召唤, 思维扩展, and temporary follow-up behavior.
- [x] 2.2 Update README data-flow sections to explain project lifecycle, LLM configuration/test, AI generation, and follow-up payloads.
- [x] 2.3 Update AGENTS current-implementation summary to match archived AI specs without duplicating full behavior specs.
- [x] 2.4 Keep permanent AI zero-write-back boundaries explicit in README and AGENTS.

## 3. Verification And Ledger

- [x] 3.1 Add or update focused frontend tests for privacy notice and per-origin confirmation behavior.
- [x] 3.2 Run relevant frontend tests and typecheck/build commands.
- [x] 3.3 Update `.omo/bug-triage-form.md` to mark issue 13 and issue 14 fixed after verification.
- [x] 3.4 Run `openspec validate sync-ai-privacy-and-docs --strict` before implementation handoff and again after implementation.
