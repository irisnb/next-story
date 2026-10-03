# fix-import-fidelity Complex Import Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete OpenSpec task 6.2 with independent expectations and real UI evidence for complex Markdown, DOCX and long FDX imports, or document precisely what remains unverified.

**Architecture:** Keep input generation and expected results separate from the application's importer. Freeze the source-derived expectations and hashes before importing into a fresh disposable work; then compare the UI preview, imported editor, saved content and reopened content against that frozen manifest. Preserve the existing product documents and avoid edits to product import code unless a newly discovered defect is separately scoped and approved.

**Tech Stack:** OpenSpec Markdown, Markdown/OOXML/FDX fixtures, Python standard-library ZIP/XML for independent source inspection, Windows Tauri app, CDP for read-only DOM assertions and real mouse interaction, native Windows file picker.

---

## File Responsibilities

- `docs/superpowers/plans/2026-10-03-fix-import-fidelity-acceptance.md`: execution gates and evidence method.
- `src-tauri/tests/fixtures/docx/acceptance-complex.docx`: newly generated complex Word input. Retain its generation recipe and source attribution in `src-tauri/tests/fixtures/docx/README.md`; do not derive expectations using the application importer.
- `C:\Users\Administrator\AppData\Local\Temp\opencode\acceptance-complex.md`: complex Markdown input kept outside the tracked product files; store its literal contents and hash in the acceptance record.
- `src-tauri/tests/fixtures/fdx/storyboarder-test.fdx`: existing long FDX input, read only.
- `openspec/changes/fix-import-fidelity/验收记录.md`: frozen source-derived expectations, input hashes, observed UI and disk results, discrepancies and remaining gaps.
- `openspec/changes/fix-import-fidelity/tasks.md`: mark 6.2 complete **only** when its gates are satisfied.

## Task 1: Freeze Independent Expectations

- [ ] Read `openspec/changes/fix-import-fidelity/验收记录.md` sections 1 and 5 before generating anything; do not reinterpret earlier small-sample evidence as complex acceptance.
- [ ] Construct a Markdown fixture with multiple parent items, at least two nested lists in one item, continuation paragraphs both before and after a sublist, an ordered list starting at 3 with a continuation and a further item, and distinguishable text in every paragraph. Record its literal source, SHA-256, expected full depth-first reading-order text, list starts, and every expected `list_overflow_degraded` category in the acceptance record.
- [ ] Construct a DOCX fixture independently with `word/document.xml`, `word/styles.xml`, and `word/numbering.xml` containing known and unknown `w:sym`, docDefaults, a basedOn paragraph-style chain, a character style and direct formatting overrides, two interleaved `numId` instances, an interrupted ordered list, and a nested level reset. Record the exact source-level paragraphs/runs, symbol font and hex codes, style hierarchy, expected resolved formatting and list counter sequence; document any intentional loss. Save the generator recipe or document the OOXML construction precisely enough to reproduce the fixture. Do not calculate expected results using `docx_import.rs` or its output.
- [ ] Audit the existing `src-tauri/tests/fixtures/fdx/storyboarder-test.fdx` directly via XML and record its hash, full 475-paragraph source text/order, its dual-dialogue position and expected split, representative character/dialogue/action formatting, and any allowed loss. Do not modify the source FDX or the unrelated untracked FDX work directory.
- [ ] Freeze all three manifests, hashes and expected degradation counts in `验收记录.md` **before** the first real UI import. If an expectation cannot be independently established, label it unverified instead of inferring correctness from the imported result.

## Task 2: Establish Fresh UI Baseline

- [ ] Verify `http://localhost:1420/` belongs to the current rebuilt Tauri app, and record the app build/run evidence. Confirm the destination is a fresh disposable work, never `C:\Users\Administrator\Desktop\test\导出验收-20261001`.
- [ ] Record the empty destination tree and input hashes before any import. Use `#fm-import-document` to launch each real native picker; use an actual picker selection, with the user choosing the exact path when reliable automation is unavailable. Browser `invoke` or replacing the file input cannot serve as UI evidence.

## Task 3: Import and Compare Each Format

- [ ] For each of Markdown, DOCX and FDX, record the preview character count, split options, loss labels/counts/details and destination before pressing `#btn-document-import-confirm`; check all new loss labels that the fixture actually triggers. Stop and record discrepancies rather than silently adjusting the frozen manifest.
- [ ] Confirm import through the visible button once per fixture; record the new document ID/name and verify existing tree entries are unchanged. Open it via the production `#current-doc-toggle` selector.
- [ ] Compare the complete editor text sequence, not just counts, with the frozen source-derived expectation; inspect list nesting/starts, symbols, style cascade and dual-dialogue ordering where relevant. Compare the saved document's complete text and important attributes without writing the user's document through an AI path.
- [ ] Close and reopen the disposable work and all three documents through production UI; repeat full-text and key-format assertions, then visually inspect beginning, middle, end and each structural transition. Record screenshots/locations or exact observed DOM and the verification limits.

## Task 4: Quality Gate and OpenSpec Record

- [ ] Rerun `cargo test --quiet` in `src-tauri` and `npm run test:frontend -- --run` in the workspace, recording exit codes and pass/ignore counts. Rerun `cargo clippy --lib --bins --tests -- -D warnings` in `src-tauri` and `npm run build` at root. Do not substitute these for real UI evidence.
- [ ] Run `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` from `src-tauri`; report their exact outcomes and differentiate unrelated pre-existing differences (notably `src-tauri/src/project/fdx_import.rs` and `src-tauri/examples/docx_read_spike.rs`) from current-scope issues. Do not format or modify unrelated files merely to clear this gate.
- [ ] Update `验收记录.md` with source hashes, frozen expectations, real picker/preview/confirm/reopen evidence, full comparison outcomes and remaining gaps. Mark `tasks.md` 6.2 complete only if complex coverage, loss reporting and quality criteria are actually satisfied. Do not archive, commit or push until the user confirms the evidence and next action.

## Self-Review

- [ ] Requirements covered: complex Markdown order/loss, DOCX symbols/style/numbering/loss, long FDX regression, full text and structure/format, native picker, save/reopen, multiple visual positions, independent expected results.
- [ ] Scan this plan for missing source provenance, unsupported UI claims and any accidental product-code or existing-work modification.
