## Context

Content-tree deletion stores each deleted subtree in the recycle bin and records its original parent ID for restoration. Deleting a child and then its parent is valid, but the child entry's original parent is then contained inside the parent's recycle-bin subtree rather than the active node map. Validation currently checks only the active node map.

## Goals / Non-Goals

**Goals:**

- Validate original-parent references against both active nodes and nodes contained in recycle-bin entries.
- Keep nested deletion history valid and restorable.
- Reject missing parents and parents that are not folders.
- Add a regression test covering child-first, parent-second deletion and reopen validation.

**Non-Goals:**

- Changing the content-tree data format or Tauri commands.
- Changing recycle-bin retention, ordering, or user interface behavior.
- Changing AI behavior or document storage.

## Decisions

- Resolve an original parent from the active `nodes` map first, then search recycle-bin subtrees. This preserves current behavior and allows a deleted ancestor to satisfy the reference without flattening or rewriting deletion history.
- Validate the resolved node's kind as `Folder` in the same validation path. A missing or non-folder reference remains invalid.
- Test the behavior at the `ContentTree` level and through project persistence/opening, so both structural validation and the real failing workflow are covered.

## Risks / Trade-offs

- [Risk] Searching recycle-bin subtrees adds work proportional to the number of deleted entries. → Recycle-bin entries are bounded project metadata and the lookup is performed only during validation; keep the implementation simple and avoid changing the serialized model.
- [Risk] A malformed recycle bin could contain duplicate IDs. → Existing subtree validation and global ID tracking remain in place; the new lookup does not weaken those checks.
