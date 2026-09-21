import assert from "node:assert/strict";
import test from "node:test";

import { setupAiFeature } from "../src/ai-feature.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import { waitTiming } from "../src/ai-timing.ts";
import {
  exportWaitTimingJson,
  waitTimingFileName,
  type InvokeFn,
  type SaveDialogFn,
} from "../src/project-api.ts";
import type { AppDom } from "../src/dom.ts";
import {
  collectText,
  FakeElement,
  installAiFeatureEnvironment,
} from "./ai-panel-dom-fixture.ts";

async function flush(): Promise<void> {
  for (let i = 0; i < 64; i += 1) await Promise.resolve();
}

/** 等待计时导出的可控 IO 替身：保存对话框返回值 + 后端命令返回值都可指定。 */
interface TimingExportFakes {
  /** 系统保存对话框的返回路径；null 表示用户取消。 */
  dialogResult: string | null;
  /** 后端 `export_wait_timing_json` 命令的返回结果。 */
  invokeResult: { ok: boolean; path: string | null; message: string | null };
  /** 记录对话框收到的参数。 */
  saveCalls: Array<{ defaultPath?: string }>;
  /** 记录后端命令收到的参数。 */
  invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }>;
  saveDialog: SaveDialogFn;
  invoke: InvokeFn;
}

function makeTimingExportFakes(
  dialogResult: string | null,
  invokeResult: { ok: boolean; path: string | null; message: string | null },
): TimingExportFakes {
  const fakes: TimingExportFakes = {
    dialogResult,
    invokeResult,
    saveCalls: [],
    invokeCalls: [],
    saveDialog: (() => Promise.resolve(null)) as SaveDialogFn,
    invoke: (() => Promise.resolve({ ok: true, path: null, message: null })) as unknown as InvokeFn,
  };
  fakes.saveDialog = (options) => {
    fakes.saveCalls.push(options);
    return Promise.resolve(fakes.dialogResult);
  };
  fakes.invoke = ((cmd: string, args?: Record<string, unknown>) => {
    fakes.invokeCalls.push({ cmd, args: args ?? {} });
    return Promise.resolve(fakes.invokeResult);
  }) as unknown as InvokeFn;
  return fakes;
}

interface TimingHarness {
  env: ReturnType<typeof installAiFeatureEnvironment>;
  fakes: TimingExportFakes;
  controller: ReturnType<typeof setupAiFeature>;
  restore(): void;
}

/** 装配最小 ai-feature 环境：不发起任何 AI 请求，只为停靠区菜单与提示条服务。 */
function timingHarness(
  dialogResult: string | null,
  invokeResult: { ok: boolean; path: string | null; message: string | null },
): TimingHarness {
  const env = installAiFeatureEnvironment();
  const fakes = makeTimingExportFakes(dialogResult, invokeResult);
  const transport: AiSessionTransport = {
    sendViaResidentSession: () => Promise.resolve({ ok: true, content: "" }),
    cancelMessage: () => {},
    endSession: () => {},
    endAllSessions: () => {},
    replaySession: () => Promise.resolve(),
    onStreamText: () => () => {},
    onDriverLost: () => () => {},
    onToolCall: () => () => {},
    onReadingRequest: () => () => {},
    installSessionEventRouting: () => {},
    destroySessionEventRouting: () => {},
  };
  // 注入部分应用的真实导出函数：只替换保存对话框与后端命令两个 IO 边界，
  // 对话框取消 → cancelled、命令路由与参数组装仍走真实实现。
  const controller = setupAiFeature({
    aiDock: env.dom,
    editorTextarea: env.editor,
    btnToggleAi: env.btnToggleAi,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => null,
    getCurrentEditor: () => null,
    openConfigPage: () => {},
    getCurrentProjectPath: () => null,
  }, {
    transport,
    loadConfig: () => Promise.resolve(null),
    conversationList: () => Promise.resolve({ conversations: [], skipped: [] }),
    conversationSave: () => Promise.resolve(),
    conversationDelete: () => Promise.resolve(),
    exportWaitTimingJson: (content, defaultFileName) =>
      exportWaitTimingJson(content, defaultFileName, fakes.saveDialog, fakes.invoke),
  });
  return { env, fakes, controller, restore: () => { env.restore(); } };
}

/** 打开停靠区 ⋯ 菜单并返回菜单元素。 */
function openDockMenu(env: TimingHarness["env"]): FakeElement {
  env.elements.get("ai-dock-more")!.dispatch("click");
  const menu = env.body.children.find((el) => el.classList.contains("ai-menu"));
  assert.ok(menu, "停靠区 ⋯ 菜单应打开");
  return menu;
}

/** 按可见文字找菜单项按钮。 */
function menuItemByLabel(menu: FakeElement, labelPart: string): FakeElement {
  const item = menu.children.find((child) => collectText(child).includes(labelPart));
  assert.ok(item, `菜单应包含「${labelPart}」项`);
  return item;
}

function dockNotice(env: TimingHarness["env"]): FakeElement {
  return env.elements.get("ai-dock-notice")!;
}

test("无计时数据时两个开发者菜单项禁用并带说明", () => {
  const ui = timingHarness("D:\\dump\\x.json", { ok: true, path: "D:\\dump\\x.json", message: null });
  try {
    const menu = openDockMenu(ui.env);
    const exportItem = menuItemByLabel(menu, "导出等待计时数据（开发者用）");
    const clearItem = menuItemByLabel(menu, "清空等待计时数据");
    assert.equal(exportItem.disabled, true, "无数据时导出项应禁用");
    assert.equal(clearItem.disabled, true, "无数据时清空项应禁用");
    assert.equal((exportItem as unknown as { title?: string }).title, "还没有可导出的计时数据");
    assert.equal((clearItem as unknown as { title?: string }).title, "还没有可导出的计时数据");
  } finally {
    ui.restore();
  }
});

test("有计时数据时菜单项可用，开发者项之前有分隔线", () => {
  const ui = timingHarness("D:\\dump\\x.json", { ok: true, path: "D:\\dump\\x.json", message: null });
  try {
    waitTiming.submit("c1", "first");
    const menu = openDockMenu(ui.env);
    const labels = menu.children.map((child) => collectText(child));
    const exportIndex = labels.findIndex((label) => label.includes("导出等待计时数据（开发者用）"));
    const sepIndex = menu.children.findIndex((child) => child.classList.contains("ai-menu-sep"));
    assert.ok(exportIndex >= 0, "导出项应存在");
    assert.ok(sepIndex >= 0 && sepIndex < exportIndex, "开发者项之前应有分隔线");
    assert.equal(menuItemByLabel(menu, "导出等待计时数据（开发者用）").disabled, false);
    assert.equal(menuItemByLabel(menu, "清空等待计时数据").disabled, false);
  } finally {
    waitTiming.clear();
    ui.restore();
  }
});

test("导出成功：真实路由调用保存对话框与后端命令，提示条成功态显示条数", async () => {
  const ui = timingHarness("D:\\dump\\wait.json", { ok: true, path: "D:\\dump\\wait.json", message: null });
  try {
    waitTiming.submit("c1", "first");
    waitTiming.complete("c1");
    const menu = openDockMenu(ui.env);
    menuItemByLabel(menu, "导出等待计时数据（开发者用）").dispatch("click");
    await flush();

    assert.equal(ui.fakes.saveCalls.length, 1, "保存对话框应恰好打开一次");
    assert.match(ui.fakes.saveCalls[0].defaultPath ?? "", /^wait-timing-\d{8}-\d{4}\.json$/);
    assert.equal(ui.fakes.invokeCalls.length, 1, "后端导出命令应恰好调用一次");
    assert.equal(ui.fakes.invokeCalls[0].cmd, "export_wait_timing_json");
    const content = String(ui.fakes.invokeCalls[0].args.content);
    const parsed = JSON.parse(content) as { records: unknown[]; summary: unknown[] };
    assert.equal(parsed.records.length, 1, "导出内容应包含全部计时记录");
    assert.equal(parsed.summary.length, 1);

    const notice = dockNotice(ui.env);
    assert.equal(notice.classList.contains("hidden"), false);
    assert.equal(notice.classList.contains("ok"), true, "成功提示应为成功样式");
    assert.equal(notice.textContent, "已导出等待计时数据（1 条）");
  } finally {
    waitTiming.clear();
    ui.restore();
  }
});

test("用户取消保存对话框：不产生任何提示，也不调用后端命令", async () => {
  const ui = timingHarness(null, { ok: true, path: null, message: null });
  try {
    waitTiming.submit("c1", "first");
    const menu = openDockMenu(ui.env);
    menuItemByLabel(menu, "导出等待计时数据（开发者用）").dispatch("click");
    await flush();

    assert.equal(ui.fakes.saveCalls.length, 1);
    assert.equal(ui.fakes.invokeCalls.length, 0, "取消后不得调用后端命令");
    const notice = dockNotice(ui.env);
    assert.equal(notice.classList.contains("hidden"), true, "取消不得出现任何提示");
    assert.equal(waitTiming.getRecords().length, 1, "取消不得清掉计时数据");
  } finally {
    waitTiming.clear();
    ui.restore();
  }
});

test("导出失败：警示条提示失败原因且不自动消失样式为警告", async () => {
  const ui = timingHarness("D:\\dump\\wait.json", { ok: false, path: null, message: "无法写入文件" });
  try {
    waitTiming.submit("c1", "first");
    const menu = openDockMenu(ui.env);
    menuItemByLabel(menu, "导出等待计时数据（开发者用）").dispatch("click");
    await flush();

    const notice = dockNotice(ui.env);
    assert.equal(notice.classList.contains("hidden"), false);
    assert.equal(notice.classList.contains("warn"), true, "失败提示应为警示样式");
    assert.equal(notice.classList.contains("ok"), false);
    assert.equal(notice.textContent, "导出失败：无法写入文件");
  } finally {
    waitTiming.clear();
    ui.restore();
  }
});

test("顶替规则：失败警示条显示期间新出现的保存失败提示将其顶替", async () => {
  const ui = timingHarness("D:\\dump\\wait.json", { ok: false, path: null, message: "无法写入文件" });
  try {
    waitTiming.submit("c1", "first");
    const menu = openDockMenu(ui.env);
    menuItemByLabel(menu, "导出等待计时数据（开发者用）").dispatch("click");
    await flush();
    assert.equal(dockNotice(ui.env).textContent, "导出失败：无法写入文件");

    // 之后新出现的保存失败提示（后出现）应顶掉导出失败警示条。
    ui.controller.state.setSaveError("讨论保存失败，本次内容可能未落盘");
    assert.equal(dockNotice(ui.env).textContent, "讨论保存失败，本次内容可能未落盘");
  } finally {
    waitTiming.clear();
    ui.restore();
  }
});

test("清空确认流：先确认可取消；确认后清空内存并提示成功", async () => {
  const ui = timingHarness(null, { ok: true, path: null, message: null });
  try {
    waitTiming.submit("c1", "first");

    // 第一步：点「清空等待计时数据…」出现确认提示条。
    let menu = openDockMenu(ui.env);
    menuItemByLabel(menu, "清空等待计时数据").dispatch("click");
    const notice = dockNotice(ui.env);
    assert.equal(notice.classList.contains("hidden"), false);
    assert.match(collectText(notice), /清空等待计时数据？已导出的文件不受影响。/);
    const confirmBtn = notice.children.find((child) => child.textContent === "清空");
    const cancelBtn = notice.children.find((child) => child.textContent === "取消");
    assert.ok(confirmBtn && cancelBtn, "确认提示条应有「清空 / 取消」两个按钮");

    // 第二步：取消 → 提示消失，数据原样保留。
    cancelBtn!.dispatch("click");
    assert.equal(notice.classList.contains("hidden"), true, "取消后提示条消失");
    assert.equal(waitTiming.getRecords().length, 1, "取消不得清数据");

    // 第三步：重新走一遍并确认 → 内存清空、成功提示、菜单项转禁用。
    menu = openDockMenu(ui.env);
    menuItemByLabel(menu, "清空等待计时数据").dispatch("click");
    const confirmBtn2 = dockNotice(ui.env).children.find((child) => child.textContent === "清空");
    confirmBtn2!.dispatch("click");
    assert.equal(waitTiming.getRecords().length, 0, "确认后应清空全部计时记录");
    assert.equal(dockNotice(ui.env).textContent, "已清空等待计时数据");
    assert.equal(dockNotice(ui.env).classList.contains("ok"), true);

    const reopened = openDockMenu(ui.env);
    assert.equal(menuItemByLabel(reopened, "清空等待计时数据").disabled, true, "清空后菜单项应禁用");
  } finally {
    waitTiming.clear();
    ui.restore();
  }
});

test("导出成功提示数秒后自动消失（与撤销提示同寿命）", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = timingHarness("D:\\dump\\wait.json", { ok: true, path: "D:\\dump\\wait.json", message: null });
  try {
    waitTiming.submit("c1", "first");
    const menu = openDockMenu(ui.env);
    menuItemByLabel(menu, "导出等待计时数据（开发者用）").dispatch("click");
    await flush();
    assert.equal(dockNotice(ui.env).classList.contains("hidden"), false, "导出后提示条应出现");

    t.mock.timers.tick(6000);
    assert.equal(dockNotice(ui.env).classList.contains("hidden"), true, "6 秒后成功提示应自动消失");
  } finally {
    waitTiming.clear();
    ui.restore();
  }
});

test("默认文件名格式：wait-timing-YYYYMMDD-HHmm.json（本机时区，两位补零）", () => {
  assert.equal(waitTimingFileName(new Date(2026, 8, 21, 9, 5)), "wait-timing-20260921-0905.json");
  assert.equal(waitTimingFileName(new Date(2026, 11, 3, 14, 42)), "wait-timing-20261203-1442.json");
});
