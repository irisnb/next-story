## 1. Case format and fixtures

- [x] 1.1 Define the JSON/JSONL case schema and validation errors.
- [x] 1.2 Add a small, version-controlled fixture set covering the required core scenarios.
- [x] 1.3 Record material versions, hashes, factual boundaries, allowed uncertainty, wrong conclusions, and evidence locations for every fixture.

## 2. Runner and driver client

- [x] 2.1 Add an independent Node/TypeScript runner entry point beside the existing driver regression script.
- [x] 2.2 Implement driver process lifecycle, JSONL messaging, per-step timeouts, terminal-state handling, and clean shutdown.
- [x] 2.3 Reuse existing driver protocol semantics without modifying the production driver contract.

## 3. Evidence and secret handling

- [x] 3.1 Define the per-case evidence record and deterministic output location/naming.
- [x] 3.2 Capture complete responses, relevant event summaries, timing, model/configuration summary, and runtime errors.
- [x] 3.3 Add redaction checks proving API keys do not appear in serialized evidence or diagnostics.

## 4. Conservative screening

- [x] 4.1 Implement deterministic runtime checks and the four automatic result states.
- [x] 4.2 Implement conservative factual-boundary checks for explicit facts, unknown answers, negation, quotation, and inference markers.
- [x] 4.3 Route ambiguous natural-language outcomes to `NEEDS_REVIEW` with a reason rather than forcing pass/fail.
- [x] 4.4 Keep automatic results separate from the human-review outcome fields.

## 5. Verification and documentation

- [x] 5.1 Add local tests for case validation, result classification, evidence serialization, and secret redaction.
- [x] 5.2 Run the core fixture suite through a configured real DSH driver where credentials are available; record runtime failures separately from model results. (2026-09-02 run: 9 cases, 0 runtime errors, 8 PASS_LIKELY, 1 NEEDS_REVIEW for quotation-negation.)
- [x] 5.3 Document the command, environment inputs, evidence format, and the boundary that this tester is offline and never writes user documents.
- [x] 5.4 Verify existing frontend, Rust, and resident driver regressions remain unchanged.
