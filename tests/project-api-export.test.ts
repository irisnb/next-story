import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { exportProject } from "../src/project-api.ts";

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

const FORMAT_CASES = [
  { format: "word" as const, extension: "docx", command: "export_project_to_word" },
  { format: "pdf" as const, extension: "pdf", command: "export_project_to_pdf" },
  { format: "markdown" as const, extension: "md", command: "export_project_to_markdown" },
];

for (const { format, extension, command } of FORMAT_CASES) {
  test(`exportProject（${format}）按格式弹保存对话框并调用对应导出命令（带范围）`, async () => {
    const calls: { cmd: string; payload: unknown }[] = [];
    installWindow();
    try {
      mockIPC((cmd, payload) => {
        calls.push({ cmd, payload });
        if (cmd === "plugin:dialog|save") return `/导出/小芳.${extension}`;
        if (cmd === command) {
          return { ok: true, path: `/导出/小芳.${extension}`, message: null };
        }
        return undefined;
      });

      const result = await exportProject(
        format,
        "/作品/我的剧本",
        { type: "document", id: "d1" },
        "小芳",
      );
      assert.equal(result.ok, true);
      assert.equal(result.path, `/导出/小芳.${extension}`);

      // 保存对话框：默认文件名按范围根生成、过滤器随格式。
      const saveCall = calls.find((c) => c.cmd === "plugin:dialog|save");
      assert.ok(saveCall, "应先调用保存对话框");
      const options = (saveCall.payload as {
        options?: { defaultPath?: string; filters?: { extensions: string[] }[] };
      }).options;
      assert.equal(options?.defaultPath, `小芳.${extension}`);
      assert.deepEqual(options?.filters?.[0]?.extensions, [extension]);

      // 导出命令参数映射（camelCase 顶层键 + 范围对象透传）。
      const exportCall = calls.find((c) => c.cmd === command);
      assert.ok(exportCall, "确认路径后应调用导出命令");
      assert.deepEqual(exportCall.payload, {
        projectPath: "/作品/我的剧本",
        targetPath: `/导出/小芳.${extension}`,
        scope: { type: "document", id: "d1" },
      });
    } finally {
      clearMocks();
      restoreWindow();
    }
  });
}

test("exportProject 文件夹范围与整作品范围的载荷形状", async () => {
  const scopes = [
    { type: "folder", id: "f1" },
    { type: "work" },
  ] as const;
  for (const scope of scopes) {
    const calls: { cmd: string; payload: unknown }[] = [];
    installWindow();
    try {
      mockIPC((cmd, payload) => {
        calls.push({ cmd, payload });
        if (cmd === "plugin:dialog|save") return "/导出/out.docx";
        if (cmd === "export_project_to_word") {
          return { ok: true, path: "/导出/out.docx", message: null };
        }
        return undefined;
      });

      await exportProject("word", "/作品/我的剧本", scope, "范围根");
      const exportCall = calls.find((c) => c.cmd === "export_project_to_word");
      assert.ok(exportCall);
      assert.deepEqual((exportCall.payload as { scope: unknown }).scope, scope);
    } finally {
      clearMocks();
      restoreWindow();
    }
  }
});

test("exportProject 用户取消时不调用导出命令且不视为错误", async () => {
  let exportCalled = false;
  installWindow();
  try {
    mockIPC((cmd) => {
      if (cmd === "plugin:dialog|save") return null;
      if (cmd === "export_project_to_word") exportCalled = true;
      return undefined;
    });

    const result = await exportProject(
      "word",
      "/作品/我的剧本",
      { type: "work" },
      "我的剧本",
    );
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.equal(result.path, null);
    assert.equal(exportCalled, false, "取消时不应调用导出命令");
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("exportProject 透传后端稳定失败结果", async () => {
  installWindow();
  try {
    mockIPC((cmd) => {
      if (cmd === "plugin:dialog|save") return "/导出/out.docx";
      if (cmd === "export_project_to_pdf") {
        return { ok: false, path: null, message: "打印超时，请重试" };
      }
      return undefined;
    });

    const result = await exportProject("pdf", "/作品/我的剧本", { type: "work" }, "我的剧本");
    assert.equal(result.ok, false);
    assert.equal(result.message, "打印超时，请重试");
  } finally {
    clearMocks();
    restoreWindow();
  }
});
