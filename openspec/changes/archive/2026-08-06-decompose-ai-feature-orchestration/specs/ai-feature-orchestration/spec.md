## ADDED Requirements

### Requirement: AI feature orchestration remains behavior-preserving after decomposition
The system SHALL keep the editor-facing `setupAiFeature(...)` integration as the public AI feature composition entry while allowing its internal request, panel, thinking expansion, follow-up, and project lifecycle orchestration responsibilities to be split into smaller modules. The decomposition MUST preserve the existing behavior of AI timely summon, thinking expansion, follow-up submission, retry/edit recovery, configuration-missing handling, and stale-result isolation.

#### Scenario: Timely summon still starts from a frozen selection
- **WHEN** the user chooses `AI 及时召唤` from a valid draft notebook or main notebook selection
- **THEN** the decomposed orchestration uses the frozen selection snapshot to start the first AI request
- **AND** the request does not require or accept an initial user question

#### Scenario: Thinking expansion still preserves optional direction semantics
- **WHEN** the user starts `思维扩展` from a frozen selection with an empty or non-empty direction
- **THEN** the decomposed orchestration builds the same first-request payload shape as before decomposition
- **AND** an empty direction does not create a user direction
- **AND** a non-empty direction remains initial user material for later follow-up requests

#### Scenario: Follow-up recovery still uses the current temporary conversation identity
- **WHEN** the user submits, retries, or edits a follow-up in the current temporary conversation
- **THEN** the decomposed orchestration uses the existing conversation identity and pending turn identity rules
- **AND** rejected follow-up request acceptance only cancels the attempted pending turn

### Requirement: AI feature orchestration keeps zero write-back capability
The decomposed AI feature orchestration MUST NOT receive, create, or expose any callback, command, state transition, or UI action that inserts, appends, replaces, rewrites, deletes, moves, organizes, or saves draft notebook or main notebook text using AI output.

#### Scenario: Decomposed modules do not receive notebook write functions
- **WHEN** AI feature orchestration is composed for the editor
- **THEN** the modules responsible for AI requests, panel state, follow-up handling, and thinking expansion do not receive draft notebook or main notebook write callbacks
- **AND** AI output remains display-only temporary panel material

#### Scenario: Configuration preflight does not broaden AI context
- **WHEN** the decomposed orchestration checks whether LLM configuration exists before a first request or follow-up request
- **THEN** it does not add nearby text, full notebook text, summaries, project metadata, AI content library material, persistent history, or user-confirmed story information to the model request
