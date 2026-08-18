## 1. Runtime Contract and Host Boundary

- [x] 1.1 Define the internal Runtime Contract types for task requests, task events, task results, stable errors, cancellation/timeout state, and capability declarations without changing the existing frontend `GenerateAi*` invoke contract.
- [x] 1.2 Create the DSH adapter boundary so DSH version-specific CLI arguments, output parsing, exit codes, profile, patch, and plugin configuration stay outside product-facing modules.
- [x] 1.3 Define the Next Story capability gateway and enforce the permanent prohibition on AI or plugins writing, appending, replacing, deleting, moving, or reorganizing user documents.

## 2. DSH Packaging and Lifecycle

- [ ] 2.1 Vendor the supported Node runtime and exact DSH `0.1.0-rc.7` dependency set in the sidecar package, including reproducible lockfile and build metadata.
- [ ] 2.2 Add Tauri packaging resources and runtime resource-directory resolution for `bin.js`, Node, adapter assets, profiles, patches, and plugins.
- [x] 2.3 Implement sidecar process startup, concurrent stdout/stderr draining, exit-code handling, timeout termination, child-process cleanup, and diagnostic redaction.
- [x] 2.4 Implement per-version `versions/<version>`, `homes/<version>`, and current-version pointer management, including validation-before-activation and rollback to the previously verified version.
- [x] 2.5 Load Next Story profile, patch, and plugin configuration from the version-isolated runtime without relying on the user global `~/.dsh` state.

## 3. Credentials and DSH Generation Integration

- [x] 3.1 Connect the DSH credentials adapter to the existing operating-system keyring and preserve the existing API key storage contract without writing plaintext keys to disk.
- [x] 3.2 Implement one-time compatibility handoff from the existing keyring slot to the DSH credential slot, retaining the original credential and making the operation idempotent.
- [x] 3.3 Route the existing AI first-invocation and follow-up backend calls through the DSH adapter while preserving frozen-selection anchoring, message validation, fixed system behavior, and stateless temporary conversation semantics.
- [x] 3.4 Preserve the existing stable `GenerateAiErrorCode` mapping for missing configuration, authentication, timeout, network, oversized request, service, invalid response, and sidecar failures.
- [x] 3.5 Expose DSH capabilities through the host gateway without reducing plugin-market loading, profile, patch, or future Agent/tool extension points to a string-only API.

## 4. Host Ownership and Cutover Preparation

- [x] 4.1 Keep LLM configuration ownership in Rust (keyring + disk atomic write); inject model name and API base URL into the DSH sidecar at spawn time without persisting plaintext keys.
- [x] 4.2 Keep project create/open/save and filesystem validation in the existing Rust implementation; do not migrate them to DSH.
- [x] 4.3 Keep the Tauri layer limited to desktop host responsibilities and preserve the current frontend project and AI APIs while the generation backend changes.
- [x] 4.4 Add migration-period diagnostics or an internal switch only where needed to compare old and DSH generation paths; ensure it is not exposed as a long-term product setting.

## 5. Verification and Cutover

- [x] 5.1 Add unit and integration tests for Runtime Contract conversion, DSH output parsing, capability declarations, stable error mapping, redaction, and invalid payload rejection.
- [x] 5.2 Add sidecar lifecycle tests for packaged resource resolution, startup, stdout/stderr draining, timeout, unexpected exit, child cleanup, and no residual process state on Windows.
- [x] 5.3 Add end-to-end tests for LLM configuration, keyring reuse/missing/invalid keys, first AI generation, anchored follow-up, and unchanged user-document bytes.
- [x] 5.4 Add plugin/profile/patch permission tests proving authorized capability routing works and document mutation, arbitrary file writes, and arbitrary command execution are rejected.
- [x] 5.5 Add upgrade and rollback tests proving a failed DSH version validation leaves the active version and user works untouched, and a successful validation changes only the current-version pointer.
- [x] 5.6 Run the complete Rust, frontend, sidecar, packaging, and end-to-end test suites against the DSH generation path and resolve all regressions.
- [x] 5.7 Remove the old Rust HTTP generation path, old generation entry, temporary A/B switch, compatibility branches, and obsolete configuration paths. `llm_config/http.rs` is retained for the connection-test command (`test_llm_connection`), which stays on Rust direct HTTP; generation no longer references it.
- [x] 5.8 Run the complete test suites again after deletion and record the final migration acceptance evidence.
