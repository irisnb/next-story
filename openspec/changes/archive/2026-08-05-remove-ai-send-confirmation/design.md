## Context

The current AI generation flow can show a native confirmation dialog before sending selected-text creative material to the configured API origin. That dialog sits inside the writing action itself, after the user has already selected text and chosen an AI action, so it interrupts the core writing-surface flow.

The LLM/API configuration page already owns model-service disclosure: it is where the user enters the API base URL, API Key, and model name, and where the system explains what testing and generation send to the configured service. This change moves the user-facing boundary to that setup page and removes the repeated blocking confirmation from AI generation.

## Goals / Non-Goals

**Goals:**

- Remove the creative-content send confirmation dialog from first AI generation and follow-up generation.
- Keep the existing payload boundaries: first requests use the frozen selected text and optional thinking-expansion direction; follow-ups use the frozen selection and current successful temporary dialogue rounds.
- Add concise visible copy on the LLM/API configuration page explaining the data sent during AI generation and the temporary nature of AI replies.
- Remove UI states and tests that only exist for a user-canceled send confirmation.

**Non-Goals:**

- No project-level, API-origin-level, or app-session memory for confirmation choices.
- No new project metadata, migration, persisted consent state, or old-format compatibility path.
- No expansion of AI context to nearby text, notebook text, summaries, project metadata, AI content library, or confirmed work information.
- No AI write-back, apply-to-main, insert, replace, rewrite, delete, move, or organize operation for the draft or main notebooks.

## Decisions

1. Remove the confirmation preflight rather than changing its memory policy.

   Rationale: the accepted product decision is that the dialog itself is the wrong interaction in the writing surface. Adding project-first, per-origin, or app-cycle memory would preserve a concept the product does not want in this flow.

2. Keep disclosure on the configuration page.

   Rationale: the API configuration page is the moment where the user chooses which service receives model requests. A visible explanatory line there makes the boundary discoverable before use without interrupting every writing action.

3. Treat canceled-confirmation states as obsolete.

   Rationale: after removing the dialog, there is no normal user path that cancels creative-content send confirmation. The AI panel should still show blocked or error states for real request coordination or preflight failures, but not a confirmation-canceled state.

## Risks / Trade-offs

- [Risk] Users may miss the configuration-page disclosure if they configured the model earlier. -> Mitigation: keep the disclosure visible on the page whenever it is opened, not only during first setup.
- [Risk] Removing the dialog could be mistaken for broadening what is sent. -> Mitigation: keep existing payload requirements unchanged and explicitly state that no broader context or notebook write-back is introduced.
- [Risk] Tauri dialog permission may still be needed for unrelated flows. -> Mitigation: only remove dialog capability if implementation verifies no other native dialog use remains.
