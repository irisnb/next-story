## 1. Implementation

- [x] 1.1 Update content-tree validation to resolve recycle-bin original parents from active nodes or recycle-bin subtrees.
- [x] 1.2 Add unit coverage for child-first then parent deletion and invalid recycle-bin parent references.
- [x] 1.3 Add or update project persistence coverage for reopening after nested deletion.

## 2. Verification

- [x] 2.1 Run focused Rust content-tree/project tests.
- [x] 2.2 Run the project Rust test suite and relevant frontend checks if affected.
- [x] 2.3 Run `openspec validate --all` and inspect the final diff.
