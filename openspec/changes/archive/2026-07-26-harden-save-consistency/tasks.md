## 1. Save Transaction Test Harness

- [x] 1.1 Add project-domain test helpers that create a valid project with distinct old draft, old main, and old metadata values.
- [x] 1.2 Add a test-only way to force save failure after transaction staging but before visible project files are committed.
- [x] 1.3 Add a test-only way to force save failure after draft replacement but before main replacement.
- [x] 1.4 Add a test-only way to force save failure after main replacement but before metadata replacement.

## 2. Transaction Staging And Commit

- [x] 2.1 Add internal project-domain types for a manual-save transaction manifest under `next-story-system/save-transaction/`.
- [x] 2.2 Stage next-generation draft, main, and metadata files inside the transaction directory before replacing visible project files.
- [x] 2.3 Replace visible draft, main, and metadata from staged files with metadata committed last.
- [x] 2.4 Clean up the transaction directory after a successful committed save.

## 3. Interrupted Save Recovery

- [x] 3.1 Run recovery before opening project contents so interrupted transactions are handled before notebook text is loaded into the editor.
- [x] 3.2 Run recovery before starting a new save so a previous interrupted transaction cannot mix with a new save attempt.
- [x] 3.3 Recover interrupted transactions to one coherent visible generation when staged data and manifest are valid.
- [x] 3.4 Reject unrecoverable transaction states with a clear project read/write error before entering the editor.

## 4. Consistency Regression Tests

- [x] 4.1 Add Rust tests proving failure before visible replacement does not change the loaded project generation after reopen.
- [x] 4.2 Add Rust tests proving failure after draft replacement recovers to a coherent generation after reopen.
- [x] 4.3 Add Rust tests proving failure after main replacement but before metadata replacement recovers to a coherent generation after reopen.
- [x] 4.4 Add Rust tests proving unrecoverable transaction metadata prevents opening rather than loading mixed notebook contents.
- [x] 4.5 Add or preserve frontend save-state coverage proving a failed backend save keeps editor contents marked as unsaved.

## 5. Verification

- [x] 5.1 Run focused Rust project lifecycle tests for save transaction and recovery behavior. (Save-transaction staging/commit/cleanup verified; recovery deferred to sections 3-4.)
- [x] 5.2 Run existing project create-open-save-reopen regression tests to verify normal manual save behavior is unchanged.
- [x] 5.3 Run the repository check command for TypeScript, frontend tests, frontend build, and Rust tests.
- [x] 5.4 Manually verify a normal create-open-save-reopen workflow still preserves both notebooks and metadata without leaving a transaction directory.
