## Why

The current reliability fixtures are useful smoke tests but do not measure the primary risk of using an LLM with a normal long-form work: losing, mixing, or inventing facts as the material grows to tens of thousands of Chinese characters. We need deterministic synthetic material and query sets that make long-context degradation observable before changing the scorer.

## What Changes

- Add deterministic synthetic Chinese fiction materials at approximately 10k, 30k, and 50k characters.
- Add hidden-in-material fact indexes and versioned metadata so every test answer has a known factual boundary.
- Add query cases for distant recall, cross-chapter relations, similar entities, version conflicts, unknown facts, false-premise correction, and multi-turn recall.
- Add three-trial matrix metadata so each query can be run three times and compared for systematic versus intermittent errors.
- Add validation and documentation for running one size tier at a time or the complete matrix.
- Do not change production driver behavior, user documents, or automatic screening semantics in this change.

## Capabilities

### New Capabilities

- `long-context-hallucination-fixtures`: Deterministic long-form synthetic materials, factual oracle metadata, and repeatable query matrices for LLM hallucination stress testing.

### Modified Capabilities

- None. Existing answer-reliability requirements are extended only by the new capability's fixtures and execution data.

## Impact

- Adds generated fixture files and generator/test tooling under `sidecar/reliability/`.
- Adds OpenSpec documentation for the fixture schema and staged execution.
- Uses the existing DSH driver and API configuration; no new runtime dependency or production API change.
- Generated evidence remains in the existing ignored evidence directory and must not contain API keys.
