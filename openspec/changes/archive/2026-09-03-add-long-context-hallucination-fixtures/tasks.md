## 1. Fixture generator and materials

- [x] 1.1 Define the deterministic long-context fixture manifest, seed, tier targets, and size tolerance
- [x] 1.2 Implement the synthetic Chinese fiction material generator with chapters, distractors, entities, timeline, and version anchors
- [x] 1.3 Generate and check in the approximately 10k, 30k, and 50k character material tiers with hashes and estimated token counts

## 2. Oracle and query matrix

- [x] 2.1 Define separate oracle metadata for factual anchors, source locations, wrong conclusions, and risk categories
- [x] 2.2 Create the 10k tier query set with 12 cases and complete oracle expectations
- [x] 2.3 Create the 30k tier query set with 18 cases and complete oracle expectations
- [x] 2.4 Create the 50k tier query set with 24 cases and complete oracle expectations
- [x] 2.5 Add three-trial planning metadata and stable query identities without changing production driver behavior

## 3. Validation and staged operation

- [x] 3.1 Add fixture validation for deterministic hashes, size tiers, oracle separation, query counts, and risk coverage
- [x] 3.2 Add offline tests for generator determinism, fixture validation, and matrix coverage
- [x] 3.3 Document tier-by-tier execution, estimated 162-call full matrix, evidence paths, and result interpretation
- [x] 3.4 Run the offline validation and confirm no API key or oracle data is included in replay material

## 4. Coherent narrative comparison tier

- [x] 4.1 Author an approximately 10k-character coherent Chinese narrative with scene continuity, stable characters, and causal flow
- [x] 4.2 Embed deterministic facts as natural (not verbatim-marked) sentences covering all seven risk categories
- [x] 4.3 Author the coherent tier oracle with 12 queries mirroring the 10k template tier and a planned trial count of three
- [x] 4.4 Mark the coherent tier as handwritten and skip regeneration while keeping all other validation
- [x] 4.5 Add offline tests for the coherent tier and run the full validation to confirm no API key or oracle data is included in replay material
