import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { exportProjectToWord } from "../src/project-api.ts";

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

test("exportProjectToWord 先弹保存对话框再调用导出命令", async () => {
  const calls: { cmd: string; payload: unknown }[] = [];
  installWindow();
  try {
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      if (cmd === "plugin:dialog|save") return "/导出/我的剧本.docx";
      if (cmd === "export_project_to_word") {
        return { ok: true, path: "/导出/我的剧本.docx", message: null };
      }
      return undefined;
    });

    const result = await exportProjectToWord("/作品/我的剧本", "我的剧本");
    assert.equal(result.ok, true);
    assert.equal(result.path, "/导出/我的剧本.docx");

    // 保存对话框默认建议作品名称加 .docx
    const saveCall = calls.find((c) => c.cmd === "plugin:dialog|save");
    assert.ok(saveCall, "应先调用保存对话框");
    const options = (saveCall.payload as { options?: { defaultPath?: string } }).options;
    assert.equal(options?.defaultPath, "我的剧本.docx");

    // 导出命令参数映射
    const exportCall = calls.find((c) => c.cmd === "export_project_to_word");
    assert.ok(exportCall, "确认路径后应调用导出命令");
    assert.deepEqual(exportCall.payload, {
      projectPath: "/作品/我的剧本",
      targetPath: "/导出/我的剧本.docx",
    });
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("exportProjectToWord 用户取消时不调用导出命令且不视为错误", async () => {
  let exportCalled = false;
  installWindow();
  try {
    mockIPC((cmd) => {
      if (cmd === "plugin:dialog|save") return null;
      if (cmd === "export_project_to_word") exportCalled = true;
      return undefined;
    });

    const result = await exportProjectToWord("/作品/我的剧本", "我的剧本");
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.equal(result.path, null);
    assert.equal(exportCalled, false, "取消时不应调用导出命令");
  } finally {
    clearMocks();
    restoreWindow();
  }
});

test("exportProjectToWord 透传后端稳定失败结果", async () => {
  installWindow();
  try {
    mockIPC((cmd) => {
      if (cmd === "plugin:dialog|save") return "/导出/out.docx";
      if (cmd === "export_project_to_word") {
        return { ok: false, path: null, message: "写入目标文件失败" };
      }
      return undefined;
    });

    const result = await exportProjectToWord("/作品/我的剧本", "我的剧本");
    assert.equal(result.ok, false);
    assert.equal(result.message, "写入目标文件失败");
  } finally {
    clearMocks();
    restoreWindow();
  }
});