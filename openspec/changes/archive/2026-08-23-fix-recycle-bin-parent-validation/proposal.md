## Why

Deleting a folder after deleting an item inside it can leave a recycle-bin entry whose original parent is also in the recycle bin. The content-tree validator currently rejects this valid intermediate state, preventing the project from being reopened or modified.

## What Changes

- Allow a recycle-bin entry's original parent to be resolved from either the active tree or another recycle-bin subtree.
- Preserve rejection of missing or invalid original parents.
- Add regression coverage for deleting a child first, then its parent folder, and reopening the project.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `content-tree-storage`: Content-tree validation supports nested deletion history while continuing to reject malformed recycle-bin references.

## Impact

- Rust content-tree validation and its unit/integration tests.
- No changes to document formats, Tauri command names, AI behavior, or the user-document write boundary.
