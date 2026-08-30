# ai-feature-orchestration 规格增量

## MODIFIED Requirements

### Requirement: AI feature orchestration remains behavior-preserving after decomposition
The system SHALL keep the editor-facing `setupAiFeature(...)` integration as the public AI feature composition entry while allowing its internal request, panel, follow-up, and project lifecycle orchestration responsibilities to be split into smaller modules. The decomposition MUST preserve the existing behavior of direct-question submission, summon submission, follow-up submission, retry/edit recovery, configuration-missing handling, and stale-result isolation. The retired `思维扩展` entry MUST NOT be part of the composed orchestration. The restored `AI 及时召唤` entry (see `selection-ai-summon`) SHALL be part of the composed orchestration as a second first-round entry into the unified temporary conversation.

#### Scenario: Direct question still starts from frozen materials
- **WHEN** the user submits a direct question with an optional selection attachment
- **THEN** the decomposed orchestration uses the frozen question and selection snapshot to start the first AI request

#### Scenario: Summon starts from frozen selection without typed question
- **WHEN** the user triggers 及时召唤 from the floating selection entry
- **THEN** the decomposed orchestration uses the frozen selection snapshot to start a streaming first request without any user-typed question text

#### Scenario: Follow-up recovery still uses the current temporary conversation identity
- **WHEN** the user submits, retries, or edits a follow-up in the current temporary conversation
- **THEN** the decomposed orchestration uses the existing conversation identity and pending turn identity rules
- **AND** rejected follow-up request acceptance only cancels the attempted pending turn

#### Scenario: Retired selection tools are not composed
- **WHEN** the AI feature orchestration is composed for the editor
- **THEN** no `思维扩展` action is registered
- **AND** the floating selection entry is registered as the single-action 及时召唤 entry
