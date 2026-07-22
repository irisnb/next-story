## Context

The current minimum AI thinking loop already freezes selected text, sends only that text to the saved LLM configuration, shows the response as temporary plain text in the AI panel, and allows a single linear follow-up conversation after the first response succeeds.

The weak point is the backend message contract. The system currently asks the model to provide questions and thinking directions, but it does not strongly define the response posture: stay anchored to the frozen selection, separate textual observations from possible interpretations, avoid story verdicts, and avoid generating replacement prose. Because the model only receives selected text and temporary conversation turns, the prompt must also prevent it from implying access to surrounding text, full work context, persisted history, AI content libraries, or confirmed work facts.

## Goals / Non-Goals

**Goals:**

- Make first AI responses explicitly grounded in the frozen selected text.
- Make follow-up responses explicitly grounded in the original frozen selection plus the current temporary linear conversation.
- Shape AI output toward observations, questions, and possible directions rather than verdicts, rewrites, polish, or user-substituting decisions.
- Preserve the existing no-write-back product boundary and the current one-request, one-temporary-conversation architecture.
- Add tests around backend message construction so future prompt edits cannot silently weaken these boundaries.

**Non-Goals:**

- No new AI entry point, thinking expansion entry, or initial question input for selection invocation.
- No AI panel redesign, conversation history, persistence, summary, full-work reading, nearby context, AI content library, or user-confirmed work information.
- No streaming, stop generation, multiple model providers, or model selection changes.
- No ability for AI output to insert, append, replace, rewrite, delete, move, organize, or save draft/manuscript text.

## Decisions

1. Keep the quality contract in backend message construction.

   The backend already centrally constructs the model messages in `src-tauri/src/llm_config/generate.rs`, while the frontend only sends structured request data. Updating this layer keeps the front end from owning prompt policy and prevents API keys or prompt details from moving into browser-side code.

   Alternative considered: enforce response wording in the AI panel after the model returns. That would only alter display text and would not shape the model's actual behavior, so it is weaker and harder to test meaningfully.

2. Strengthen the prompt as behavior constraints, not UI copy.

   The implementation should instruct the model to frame output around evidence from the selected text, possible interpretations, questions, and directions. It should also explicitly forbid direct replacement prose, polishing requests, story verdicts, and claims based on unavailable context.

   Alternative considered: require a rigid response template with fixed headings. This would be easier to snapshot-test but risks making every reply feel mechanical. The spec should require behavioral posture and testable prompt constraints without forcing an exact visible format unless implementation tests need stable internal strings.

3. Keep follow-up history exactly as the current temporary conversation already defines it.

   Follow-ups should continue to send the frozen selected text and all current successful conversation turns. The change only clarifies what the model is told about that material: it can use the current temporary conversation, but it must not treat it as persisted memory, whole-work knowledge, or confirmed work facts.

   Alternative considered: introduce summaries or a richer conversation model now. That belongs to later changes and would expand scope into memory/history questions this change is meant to avoid.

## Risks / Trade-offs

- Prompt-only constraints cannot mathematically guarantee every model response follows the posture. → Mitigation: make the backend contract explicit and add tests that lock the message construction against losing the core boundaries.
- Too much instruction can make responses stiff. → Mitigation: specify response principles rather than a mandatory public template.
- Tests that assert exact prompt text can become brittle. → Mitigation: test for the presence of core obligations and prohibitions rather than the entire message verbatim.
- Improving answer quality may reveal model differences across OpenAI-compatible services. → Mitigation: keep UI/model configuration unchanged and require only provider-neutral natural-language instructions.
