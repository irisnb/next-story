import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import {
  importDocxCommit,
  importDocxPreview,
  selectDocxFile,
  type ImportCommitResult,
  type ImportPreview,
} from "../src/project-api.ts";

// 契约依据：openspec/changes/add-word-import/design.md「Spike 补记」。
// Tauri 会把 camelCase 顶层参数自动映射为后端 snake_case 参数（projectPath → project_path），
// 与 open_project / export_project_to_* 等既有命令同法；字段值逐字断言防漂移。

let previousWindow: PropertyDescriptor | undefined;

/** mockIPC 需要全局 `window`；node 测试环境默认没有，这里临时补上（与 project-api-export.test.ts 同法）。 */
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

const PREVIEW: ImportPreview = {
  char_count: 55331,
  paragraph_count: 2718,
  default_doc_name: "61集短剧剧本",
  losses: [
    { kind: "table_flattened", count: 2, note: "逐格转为段落" },
    { kind: "image_dropped", count: 1, note: "" },
  ],
  split_suggestion: { marker_sample: "第X集", count: 61, doc_names: ["第1集", "第2集"] },
  content_hash: "sha256-abc",
  generator: "WPS Office 12.1.0.26375",
};

const COMMIT_RESULT: ImportCommitResult = {
  created_doc_ids: ["doc-1", "doc-2"],
  created_folder_id: "folder-new",
};

test("importDocxPreview 按契约调用 import_docx_preview 并透传预检结果", async () => {
  const calls: { cmd: string; payload: unknown }[] = [];
  installWindow();
  try {
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      if (cmd === "import_docx_preview") return PREVIEW;
      return undefined;
    });

    const result = await importDocxPreview("/作品/我的剧本", "D:\\剧本\\61集.docx");
    assert.deepEqual(result, PREVIEW, "预检结果字段应与契约同形（snake_case）");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.cmd, "import_docx_preview");
    assert.deepEqual(calls[0]!.payload, {
      projectPath: "/作品/我的剧本",
      filePath: "D:\\剧本\\61集.docx",
    });
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("importDocxCommit 按契约调用 import_docx_commit（folder / split）", async () => {
  const calls: { cmd: string; payload: unknown }[] = [];
  installWindow();
  try {
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      if (cmd === "import_docx_commit") return COMMIT_RESULT;
      return undefined;
    });

    const result = await importDocxCommit(
      "/作品/我的剧本",
      "D:\\剧本\\61集.docx",
      "folder-1",
      true,
      "sha256-abc",
    );
    assert.deepEqual(result, COMMIT_RESULT, "提交结果字段应与契约同形");
    assert.deepEqual(calls[0]!.payload, {
      projectPath: "/作品/我的剧本",
      filePath: "D:\\剧本\\61集.docx",
      parentId: "folder-1",
      split: true,
      expectedHash: "sha256-abc",
    });
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("importDocxCommit 根级目标 parent 为 null、默认不拆分", async () => {
  const calls: { cmd: string; payload: unknown }[] = [];
  installWindow();
  try {
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      if (cmd === "import_docx_commit") return COMMIT_RESULT;
      return undefined;
    });

    await importDocxCommit("/作品/我的剧本", "D:\\剧本\\61集.docx", null, false, "sha256-abc");
    assert.deepEqual(calls[0]!.payload, {
      projectPath: "/作品/我的剧本",
      filePath: "D:\\剧本\\61集.docx",
      parentId: null,
      split: false,
      expectedHash: "sha256-abc",
    });
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("hash_mismatch 前缀错误原样透传给调用方", async () => {
  installWindow();
  try {
    mockIPC((cmd) => {
      if (cmd === "import_docx_commit") {
        throw "hash_mismatch: expected=sha256-abc got=sha256-def";
      }
      return undefined;
    });

    let caught: unknown;
    try {
      await importDocxCommit("/作品", "D:\\剧本.docx", null, false, "sha256-abc");
    } catch (error) {
      caught = error;
    }
    assert.equal(String(caught), "hash_mismatch: expected=sha256-abc got=sha256-def");
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("selectDocxFile 弹文件选择对话框：.docx 过滤、单选、不依赖 MIME", async () => {
  const calls: { cmd: string; payload: unknown }[] = [];
  installWindow();
  try {
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      if (cmd === "plugin:dialog|open") return "D:\\剧本\\61集.docx";
      return undefined;
    });

    const selected = await selectDocxFile();
    assert.equal(selected, "D:\\剧本\\61集.docx");
    assert.equal(calls[0]!.cmd, "plugin:dialog|open");
    const options = (calls[0]!.payload as { options?: Record<string, unknown> }).options ?? {};
    assert.equal(options.multiple, false);
    assert.deepEqual(options.filters, [{ name: "Word 文档", extensions: ["docx"] }]);
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("selectDocxFile 用户取消返回 null", async () => {
  installWindow();
  try {
    mockIPC((cmd) => {
      if (cmd === "plugin:dialog|open") return null;
      return undefined;
    });
    assert.equal(await selectDocxFile(), null);
  } finally {
    clearMocks();
    restoreWindow();
  }
});
