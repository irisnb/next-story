import type { AiPanelState } from "./ai-panel-state.ts";
import { canonicalNotebookJson } from "./structured-notebook.ts";
import type { SelectionEntryEditor } from "./selection-entry.ts";
import type { GenerateAiRequest } from "./types.ts";

/**
 * 关注文档材料组装（阶段五 A；extract-ai-request-orchestration 热身刀）。
 *
 * 从 `setupAiFeature` 闭包宇宙中提取，遵循 editor-module-boundaries 惯例：
 * 不引 DOM，只收显式依赖（状态外观 + 访问器）；访问器逐次求值，无快照化
 * （可见性红线，design D6）。本函数不写任何共享可变绑定。
 */
export interface RequestMaterialsDependencies {
  /** 面板状态外观（读取讨论的关注文档与首轮材料来源）。 */
  readonly state: AiPanelState;
  /** 当前作品路径访问器（随材料身份透传给后端）。 */
  readonly getCurrentProjectPath: () => string | null;
  /** 当前编辑器文档 ID 访问器。 */
  readonly getCurrentDocumentId: () => string | null;
  /** 当前编辑器访问器（仅当关注文档就是当前编辑器文档时取未保存快照）。 */
  readonly getCurrentEditor: () => SelectionEntryEditor | null;
  /** 当前文档版本访问器（版本即快照内容派生散列）。 */
  readonly getCurrentDocumentVersion: () => string | null;
}

/**
 * 为常规首轮 / 追问请求注入关注文档身份（阶段五 A：后端据此组装关注文档现场
 * 材料 + 目录投影 + 跨文档检索）。及时召唤不注入（保持快车道）。
 */
export function withFocusDocumentIdentity(
  request: GenerateAiRequest,
  conversationId: string,
  deps: RequestMaterialsDependencies,
): GenerateAiRequest {
  const { state, getCurrentProjectPath, getCurrentDocumentId, getCurrentEditor, getCurrentDocumentVersion } = deps;
  if (request.kind === "summon") return request;
  const discussion = state.getDiscussion(conversationId);
  // 及时召唤讨论的追问保持快车道：不经过常规取材（任务 3.2 的隔离）。
  if (discussion?.conversation?.initialUserMaterial.kind === "summon") return request;
  const focusDocumentId = discussion?.focusDocumentId ?? null;
  if (focusDocumentId === null) return request;
  const focusProjectPath = getCurrentProjectPath();
  // 仅当关注文档就是当前编辑器文档时，附带其未保存快照与版本身份（复用既有
  // `bodySnapshot` / `documentVersion` 契约，版本即快照内容派生散列）；非当前
  // 编辑器文档只用已保存正文，不传快照。
  const currentEditorDocId = getCurrentDocumentId();
  const editor = currentEditorDocId === focusDocumentId ? getCurrentEditor() : null;
  const focusVersion = editor !== null ? (getCurrentDocumentVersion() ?? undefined) : undefined;
  const focusSnapshot = editor !== null ? canonicalNotebookJson(editor.getDocument()) : undefined;
  return {
    ...request,
    focus_document_id: focusDocumentId,
    ...(focusProjectPath !== null ? { focus_project_path: focusProjectPath } : {}),
    ...(focusVersion !== undefined && focusSnapshot !== undefined
      ? { focus_document_version: focusVersion, focus_snapshot: focusSnapshot }
      : {}),
  };
}
