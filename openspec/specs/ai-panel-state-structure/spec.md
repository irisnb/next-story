# ai-panel-state-structure Specification

## Purpose
Document the internal AI panel state boundaries that keep panel visibility, request status, temporary conversation state, follow-up turn state, read-only views, and subscriber notifications separated while preserving the current selection summon and single linear temporary follow-up behavior.

## Requirements
### Requirement: AI panel state responsibilities remain separated
The AI panel state implementation SHALL keep panel visibility, request status, temporary conversation state, follow-up turn state, read-only view construction, and subscriber notification as separable responsibilities while preserving the existing public AI panel behavior.

#### Scenario: Existing callers keep using the facade
- **WHEN** feature orchestration, panel rendering, or scroll logic needs AI panel state
- **THEN** the system SHALL expose a stable facade that preserves the current AI panel state behavior without requiring callers to coordinate internal state modules directly

#### Scenario: State transitions preserve notification behavior
- **WHEN** a public AI panel state operation changes state successfully
- **THEN** the system SHALL notify subscribers once with a read-only view that reflects the completed transition

#### Scenario: Invalid state operations remain inert
- **WHEN** a public AI panel state operation is rejected because the current state does not allow it
- **THEN** the system SHALL preserve existing state and avoid emitting a subscriber notification

### Requirement: Temporary conversation state preserves current AI boundaries
The temporary conversation state SHALL preserve the current single in-memory linear conversation model anchored to one frozen selection snapshot, with one first assistant response, ordered successful follow-up turns, and at most one pending follow-up turn.

#### Scenario: Follow-up requests use the frozen anchor
- **WHEN** the user submits or retries a follow-up question after the first AI response succeeds
- **THEN** the generated follow-up request SHALL use the original frozen selected text and the existing successful conversation turns, not the editor's current selection or notebook text

#### Scenario: New invocation replaces the prior conversation
- **WHEN** a new summon request is accepted
- **THEN** the system SHALL establish a new temporary conversation identity and prevent later results from the replaced conversation from modifying the current conversation

#### Scenario: Reset clears temporary AI state
- **WHEN** the current project is unloaded or replaced
- **THEN** the system SHALL close the panel, return the request state to idle, and remove the current temporary conversation from memory

### Requirement: Refactor introduces no new AI product capability
The state split SHALL NOT add AI panel behavior beyond the currently implemented selection summon and single linear temporary follow-up flow.

#### Scenario: No new context source is added
- **WHEN** the AI panel state is refactored
- **THEN** the system SHALL NOT add nearby text, full-document text, summaries, persisted history, multiple conversations, or user-confirmed project information to AI requests

#### Scenario: No notebook write path is added
- **WHEN** AI output or follow-up content is displayed in the panel
- **THEN** the system SHALL NOT provide an insert, replace, apply, organize, save, or other direct write path into the draft notebook or main notebook

#### Scenario: Request semantics remain unchanged
- **WHEN** first summon and follow-up requests are generated after the refactor
- **THEN** the system SHALL preserve the existing request semantics, including non-streaming generation and use of the single saved LLM configuration
