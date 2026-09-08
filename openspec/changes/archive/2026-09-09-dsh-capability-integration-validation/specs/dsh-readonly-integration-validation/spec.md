## ADDED Requirements

> 范围说明：本规格描述验证 harness 的离线确定性行为，不代表生产 Rust/Tauri 接入。Agent Loop 由确定性替身（sidecar/driver/adapter.mjs）模拟，不运行实机 DSH；只读授权发生在离线验证边界——JS bridge.mjs 对固定 fixture + Rust project/story_material.rs 纯函数（非注册 Tauri 命令），未接入生产 driver.mjs 的工具协议。下文 "validation boundary" 均指验证 harness 自身。

### Requirement: DSH agent loop runs inside the validation boundary
The validation harness SHALL start a DSH Agent Loop (a deterministic stand-in, sidecar/driver/adapter.mjs) through the driver-protocol boundary and SHALL associate every run with an explicit work, discussion, session, turn, message, and request identity.

#### Scenario: Agent loop completes a direct response
- **WHEN** a valid validation request is started with a registered model and a fixed fixture
- **THEN** the DSH Agent Loop produces text events and exactly one terminal completion or failure for that request

#### Scenario: Unknown request identity is rejected
- **WHEN** an event references a session or request identity that is not active
- **THEN** the validation boundary rejects or records the event as invalid without changing any active request state

### Requirement: Read-only story requests are authorized by the validation boundary
The validation harness SHALL expose only controlled read-only story requests, and every request SHALL be authorized by the offline read-only validation boundary (JS bridge on a fixed fixture, mirrored by the Rust story_material pure helper) before material is returned to the DSH stand-in.

#### Scenario: Authorized document read succeeds
- **WHEN** an active request asks for an allowed document in the active work and visible version
- **THEN** the validation boundary returns structured source material with its work, document, range, and version identity

#### Scenario: Unauthorized document read fails closed
- **WHEN** a request asks for a document from another work, a hidden document, a deleted or recycled document, or an unavailable version
- **THEN** the validation boundary returns a structured denial and does not expose document content

#### Scenario: Unknown tool is unavailable
- **WHEN** the Agent requests a tool outside the validation allowlist
- **THEN** the validation boundary rejects the request and does not execute a generic filesystem, shell, network, or writing operation

### Requirement: Tool lifecycle events have explicit terminal states
The validation harness SHALL record tool invocation start, success, failure, user-confirmation wait, user decision, cancellation, timeout, and late-result handling with request identity and SHALL prevent more than one terminal state from completing the same invocation.

#### Scenario: Tool succeeds and response continues
- **WHEN** an authorized read returns before cancellation or timeout
- **THEN** the harness records start and success, returns the material to the Agent Loop, and permits the response to continue

#### Scenario: Tool is denied by the user
- **WHEN** the Agent requests a broader read and the user rejects the confirmation
- **THEN** the harness records the denial, returns a structured refusal, and the Agent produces a response that does not claim to have read the denied material

#### Scenario: Cancelled tool result arrives late
- **WHEN** a tool invocation is cancelled or times out and its provider later emits a result
- **THEN** the harness records the result as late and does not deliver it as usable material or change the terminal state

### Requirement: Requests are isolated across sessions
The validation harness SHALL allow independent validation requests to be correlated by session and request identity, and cancellation, timeout, failure, and late events in one request SHALL NOT change another request.

#### Scenario: Two sessions receive their own results
- **WHEN** two active sessions issue requests concurrently against separate fixtures or turns
- **THEN** each session receives only its own text and tool events, even when events are interleaved

#### Scenario: Cancelling one request preserves the other
- **WHEN** one active request is cancelled while another request is generating
- **THEN** only the cancelled request reaches its cancellation terminal state and the other request may continue normally

### Requirement: Unsaved material enters through a controlled snapshot
The validation harness SHALL accept an explicitly identified unsaved document snapshot through the validation boundary and SHALL NOT grant the DSH stand-in direct access to editor objects, project paths, or story write operations.

#### Scenario: Latest unsaved snapshot is read
- **WHEN** the harness supplies a permitted unsaved snapshot newer than the saved fixture
- **THEN** the authorized read returns the snapshot version and its content rather than silently reading the older disk version

#### Scenario: Snapshot identity is invalid
- **WHEN** a snapshot has a mismatched work identity, document identity, version metadata, or disallowed visibility
- **THEN** the validation boundary rejects the snapshot without returning its content

### Requirement: Validation records reproducible timing evidence
The validation harness SHALL record submission time, first model text time, tool and confirmation wait time, queue time when applicable, and terminal completion time for fixed validation scenarios without treating progress text as a model response.

#### Scenario: Direct and read-assisted timings are comparable
- **WHEN** the fixed fixture runs a direct response and a one-read response under the same model configuration
- **THEN** the evidence records separate first-text, tool-wait, and full-completion durations for both runs

#### Scenario: Measurement is incomplete
- **WHEN** a run fails before a comparable terminal state or the timing source is unavailable
- **THEN** the evidence marks the measurement incomplete and does not claim a successful latency baseline

### Requirement: Validation keeps forbidden capabilities disabled
The validation configuration SHALL keep generic filesystem, shell, network, subagent, unrestricted loop, and story-writing capabilities unavailable throughout the validation run.

#### Scenario: Agent attempts a forbidden capability
- **WHEN** the Agent requests a forbidden capability or a write-like operation
- **THEN** the request is rejected, the story data remains unchanged, and the rejection is included in validation evidence
