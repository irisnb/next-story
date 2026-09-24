import type { EditorController } from "./editor.ts";
import type { SessionResult } from "./editor-document-session.ts";
import type { ContentTree, ProjectLoadIdentity, TreeRefreshAcceptance } from "./types.ts";

/** main 与真实装配测试共用；只接受原装载的最新树候选。 */
export function createWorkspaceTreeReceiver(editor: EditorController, onAccepted: (tree: ContentTree) => void) {
  return (tree: ContentTree, identity: ProjectLoadIdentity, acceptance: TreeRefreshAcceptance): Promise<SessionResult> => {
    const isCurrent = () => {
      const current = editor.getProjectIdentity();
      return current?.projectPath === identity.projectPath &&
        current.loadGeneration === identity.loadGeneration && acceptance.isCurrent();
    };
    if (!isCurrent()) return Promise.resolve({ status: "stale" });
    return editor.applyTree(tree, {
      isCurrent,
      installPeer: acceptance.installPeer,
      onAccepted: () => onAccepted(tree),
    });
  };
}
