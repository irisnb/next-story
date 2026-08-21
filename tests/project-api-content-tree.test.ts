import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import {
  createDocument,
  createFolder,
  deleteNode,
  moveNode,
  openContentTree,
  readDocument,
  renameNode,
  reorderChildren,
  restoreNode,
  saveDocument,
} from "../src/project-api.ts";
import type { ContentTree } from "../src/types.ts";

let previousWindow: PropertyDescriptor | undefined;

/** mockIPC 需要全局 `window`；node 测试环境默认没有，这里临时补上（与 editor.test.ts 同法）。 */
function installWindow(): void {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
}

function restoreWindow(): void {
  if (previousWindow) {
    Object.defineProperty(globalThis, "window", previousWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
  previousWindow = undefined;
}

const TREE: ContentTree = {
  root_children: ["doc-1", "folder-1"],
  nodes: {
    "doc-1": { id: "doc-1", name: "草稿本", kind: "Document", children: [] },
    "folder-1": { id: "folder-1", name: "角色", kind: "Folder", children: ["doc-2"] },
    "doc-2": { id: "doc-2", name: "小芳", kind: "Document", children: [] },
  },
  recycle_bin: [
    {
      root_id: "doc-9",
      original_parent: null,
      original_index: 0,
      nodes: { "doc-9": { id: "doc-9", name: "旧草稿", kind: "Document", children: [] } },
    },
  ],
};

test("内容树命令封装：命令名与参数映射正确", async () => {
  const calls: { cmd: string; payload: unknown }[] = [];
  installWindow();
  try {
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      if (cmd === "open_content_tree") return TREE;
      if (cmd === "read_document") return `正文-${(payload as { documentId?: string })?.documentId}`;
      if (cmd === "create_folder" || cmd === "create_document") return "new-node-id";
      return undefined;
    });

    const tree = await openContentTree("/作品/我的剧本");
    assert.deepEqual(tree, TREE);

    const body = await readDocument("/作品/我的剧本", "doc-2");
    assert.equal(body, "正文-doc-2");

    await saveDocument("/作品/我的剧本", "doc-2", `{"format":"next-story-tiptap","version":2,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`);

    const folderId = await createFolder("/作品/我的剧本", null);
    assert.equal(folderId, "new-node-id");

    const docId = await createDocument("/作品/我的剧本", "folder-1");
    assert.equal(docId, "new-node-id");

    await renameNode("/作品/我的剧本", "doc-2", "角色设定");
    await moveNode("/作品/我的剧本", "doc-2", null);
    await moveNode("/作品/我的剧本", "doc-2", "folder-1");
    await reorderChildren("/作品/我的剧本", null, ["folder-1", "doc-1"]);
    await reorderChildren("/作品/我的剧本", "folder-1", ["doc-2"]);
    await deleteNode("/作品/我的剧本", "doc-2");
    await restoreNode("/作品/我的剧本", "doc-9");

    // 精确断言命令名与参数名（Tauri 自动把 camelCase 映射到 Rust 的 snake_case）。
    assert.deepEqual(
      calls.map((c) => c.cmd),
      [
        "open_content_tree",
        "read_document",
        "save_document",
        "create_folder",
        "create_document",
        "rename_node",
        "move_node",
        "move_node",
        "reorder_children",
        "reorder_children",
        "delete_node",
        "restore_node",
      ],
    );

    assert.deepEqual(calls[0].payload, { projectPath: "/作品/我的剧本" });
    assert.deepEqual(calls[1].payload, { projectPath: "/作品/我的剧本", documentId: "doc-2" });
    assert.deepEqual(calls[2].payload, {
      projectPath: "/作品/我的剧本",
      documentId: "doc-2",
      content: `{"format":"next-story-tiptap","version":2,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`,
    });
    assert.deepEqual(calls[3].payload, { projectPath: "/作品/我的剧本", parent: null });
    assert.deepEqual(calls[4].payload, { projectPath: "/作品/我的剧本", parent: "folder-1" });
    assert.deepEqual(calls[5].payload, { projectPath: "/作品/我的剧本", id: "doc-2", name: "角色设定" });
    assert.deepEqual(calls[6].payload, { projectPath: "/作品/我的剧本", id: "doc-2", newParent: null });
    assert.deepEqual(calls[7].payload, { projectPath: "/作品/我的剧本", id: "doc-2", newParent: "folder-1" });
    assert.deepEqual(calls[8].payload, { projectPath: "/作品/我的剧本", parent: null, order: ["folder-1", "doc-1"] });
    assert.deepEqual(calls[9].payload, { projectPath: "/作品/我的剧本", parent: "folder-1", order: ["doc-2"] });
    assert.deepEqual(calls[10].payload, { projectPath: "/作品/我的剧本", id: "doc-2" });
    assert.deepEqual(calls[11].payload, { projectPath: "/作品/我的剧本", id: "doc-9" });
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("saveDocument 在超过字节上限时不调用写盘命令", async () => {
  let invokeCalled = false;
  installWindow();
  try {
    mockIPC((cmd) => {
      if (cmd === "save_document") invokeCalled = true;
      return undefined;
    });

    // 10MB + 1 字节（UTF-8 下每个 ASCII 字符 1 字节），超过前端与后端一致的上限。
    const oversized = "x".repeat(10 * 1024 * 1024 + 1);
    await assert.rejects(
      saveDocument("/作品/我的剧本", "doc-1", oversized),
      /文档内容过大/,
    );
    assert.equal(invokeCalled, false);
  } finally {
    clearMocks();
    restoreWindow();
  }
});
