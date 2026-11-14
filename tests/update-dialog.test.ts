import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { runLeaveGuard } from "../src/close-guard.ts";
import {
  createUpdateDialog,
  type DownloadProgressEvent,
  type UpdateDialogController,
  type UpdateEntrySnapshot,
  type UpdateHandle,
} from "../src/update-dialog.ts";

/**
 * 应用内更新对话框（add-auto-updater 任务 3.7 / 5.2）的规格测试：
 * - 状态机全部转换（含检查三态、失败→重试→成功、下载进度、转后台、稍后再入）；
 * - Enter 聚焦语义（无全局提交结构；焦点在非更新按钮时 Enter 不触发下载）；
 * - Esc 按状态映射（检查中/发现新版/下载中/已就绪；准备期锁定无动作）；
 * - 安装前离开守卫：取消中止、准备失败恢复、准备期重复触发被忽略、准备成功触发安装；
 * - 安装序列（design D5 修正）：prepare → stopDriver → install 顺序固定，停止
 *   成功后才触发安装；stopDriver 失败按准备失败处理（恢复现场、保留就绪、可重试）；
 * - 状态不跨重启：无任何持久化写入，dispose 后单例归零；
 * - 启动检查三路径：失败静默、无更新零提示、发现新版只标记不弹窗不抢焦点。
 *
 * happy-dom 桩说明（同 app-confirm.test.ts）：happy-dom 不把 Esc 合成为 dialog 的
 * cancel 事件，测试按真实浏览器契约直接派发 cancel 事件；Enter 在真实浏览器原生
 * 激活聚焦按钮，此处以「无 form＋按钮全 type=button＋Enter 不产生任何副作用」
 * 断言语义前提。
 */

/** 安装 happy-dom 的 document/HTMLElement 全局（模块运行时读取 globalThis）。 */
async function withDom(run: (window: Window) => Promise<void> | void): Promise<void> {
  const window = new Window();
  const previous = new Map(["document", "HTMLElement"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: window.document },
    HTMLElement: { configurable: true, value: window.HTMLElement },
  });
  try {
    await run(window);
  } finally {
    await window.happyDOM.abort();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

/** 手动可裁决的延迟值。 */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

/** 可控的假 Update 句柄（download 可失败/可裁决；install 模拟 Windows 接管后永不返回）。 */
interface FakeUpdate {
  handle: UpdateHandle;
  state: {
    downloadCalls: number;
    installCalls: number;
    failDownload: boolean;
    failInstall: boolean;
    lastListener: ((event: DownloadProgressEvent) => void) | null;
    resolveDownload: (() => void) | null;
  };
}

function fakeUpdate(version = "0.2.1", body = "修复与改进。"): FakeUpdate {
  const state: FakeUpdate["state"] = {
    downloadCalls: 0,
    installCalls: 0,
    failDownload: false,
    failInstall: false,
    lastListener: null,
    resolveDownload: null,
  };
  const handle: UpdateHandle = {
    version,
    currentVersion: "0.1.2",
    body,
    download(onEvent) {
      state.downloadCalls += 1;
      state.lastListener = onEvent ?? null;
      if (state.failDownload) return Promise.reject(new Error("download failed"));
      return new Promise<void>((resolve) => {
        state.resolveDownload = resolve;
      });
    },
    install() {
      state.installCalls += 1;
      if (state.failInstall) return Promise.reject(new Error("install failed"));
      // Windows：安装器接管后进程退出，本 promise 永不结算。
      return new Promise<void>(() => {});
    },
  };
  return { handle, state };
}

interface MountOptions {
  check?: () => Promise<UpdateHandle | null>;
  guard?: () => Promise<boolean>;
  prepare?: () => boolean;
  stopDriver?: () => Promise<void>;
  checkTimeoutMs?: number;
}

interface Harness {
  controller: UpdateDialogController;
  calls: { check: number; openDownloadPage: number; guard: number; prepare: number; restore: number; stopDriver: number };
  snapshots: UpdateEntrySnapshot[];
  errors: unknown[];
}

function mount(options: MountOptions = {}): Harness {
  const calls = { check: 0, openDownloadPage: 0, guard: 0, prepare: 0, restore: 0, stopDriver: 0 };
  const snapshots: UpdateEntrySnapshot[] = [];
  const errors: unknown[] = [];
  const controller = createUpdateDialog({
    checkUpdates: () => {
      calls.check += 1;
      return (options.check ?? (() => Promise.resolve(null)))();
    },
    openDownloadPage: () => {
      calls.openDownloadPage += 1;
    },
    runLeaveGuard: () => {
      calls.guard += 1;
      return (options.guard ?? (() => Promise.resolve(true)))();
    },
    preparation: {
      prepare: () => {
        calls.prepare += 1;
        return Promise.resolve((options.prepare ?? (() => true))());
      },
      restore: () => {
        calls.restore += 1;
      },
    },
    stopDriver: () => {
      calls.stopDriver += 1;
      return (options.stopDriver ?? (() => Promise.resolve()))();
    },
    onEntryState: (snapshot) => snapshots.push(snapshot),
    reportError: (error) => errors.push(error),
    checkTimeoutMs: options.checkTimeoutMs ?? 1000,
  });
  return { controller, calls, snapshots, errors };
}

function queryDialog(): HTMLDialogElement {
  const dialog = document.querySelector("dialog.update-dialog") as HTMLDialogElement | null;
  assert.ok(dialog, "更新对话框应挂载在 document.body");
  return dialog;
}

function dialogButtons(): HTMLButtonElement[] {
  return [...queryDialog().querySelectorAll<HTMLButtonElement>("footer button")];
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = dialogButtons().find((button) => button.textContent === label);
  assert.ok(found, `对话框应包含「${label}」按钮，实际：${dialogButtons().map((b) => b.textContent).join("/")}`);
  return found;
}

function bodyText(): string {
  return queryDialog().querySelector(".update-dialog-body")?.textContent ?? "";
}

/** 模拟浏览器在模态对话框上按 Esc（真实浏览器触发 dialog 的 cancel 事件）。 */
function pressEsc(window: Window): void {
  queryDialog().dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event);
}

// ========== 状态机：手动检查三态 ==========

test("手动检查：检查中（有限等待的进行态）→ 已是最新", async () => {
  await withDom(async () => {
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    assert.equal(h.controller.getStatus(), "checking");
    assert.ok(bodyText().includes("正在检查更新"), "检查中呈现进行态文案");
    check.resolve(null);
    await flush();
    assert.equal(h.controller.getStatus(), "up-to-date");
    assert.ok(bodyText().includes("已是最新版本"), "无更新呈现已是最新");
    const last = h.snapshots[h.snapshots.length - 1]!;
    assert.equal(last.statusText, "已是最新版本");
    assert.equal(last.badge, false);
  });
});

test("手动检查：发现新版——版本号＋更新说明＋[暂不][打开下载页][立即更新]", async () => {
  await withDom(async () => {
    const fake = fakeUpdate("0.2.1", "第一行说明。\n第二行说明。");
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    assert.equal(h.controller.getStatus(), "available");
    assert.ok(bodyText().includes("0.2.1"), "呈现新版本号");
    const notes = queryDialog().querySelector(".update-notes");
    assert.ok(notes, "呈现更新说明区域");
    assert.equal(notes!.textContent, "第一行说明。\n第二行说明。", "说明原样呈现不截断");
    const labels = dialogButtons().map((button) => button.textContent);
    assert.deepEqual(labels, ["暂不", "打开下载页", "立即更新"]);
    const last = h.snapshots[h.snapshots.length - 1]!;
    assert.equal(last.badge, true, "入口出现更新标记");
    assert.equal(last.statusText, "有新版本可用（0.2.1）");
  });
});

test("手动检查失败：固定文案「未能连接更新服务，当前版本仍可使用」，不显示已是最新", async () => {
  await withDom(async () => {
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.reject(new Error("network down"));
    await flush();
    assert.equal(h.controller.getStatus(), "failed");
    assert.ok(bodyText().includes("未能连接更新服务，当前版本仍可使用"));
    assert.doesNotMatch(bodyText(), /已是最新/, "失败不得谎报已是最新");
    const labels = dialogButtons().map((button) => button.textContent);
    assert.deepEqual(labels, ["打开下载页", "重试"], "失败态提供重试与打开下载页");
  });
});

test("手动检查有限等待：超时按失败呈现，迟到的真实结果作废", async () => {
  await withDom(async () => {
    const late = deferred<UpdateHandle | null>();
    const h = mount({ check: () => late.promise, checkTimeoutMs: 5 });
    h.controller.openManualCheck();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    assert.equal(h.controller.getStatus(), "failed", "等待上限内未连接即失败");
    assert.ok(bodyText().includes("未能连接更新服务"));
    late.resolve(fakeUpdate().handle);
    await flush();
    assert.equal(h.controller.getStatus(), "failed", "迟到结果不覆盖已呈现的失败");
  });
});

// ========== 下载：进度、失败重试、转后台 ==========

test("立即更新：有总大小显示百分比与进度条，完成进已就绪且不自动重启", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    assert.equal(h.controller.getStatus(), "downloading");
    assert.ok(bodyText().includes("正在下载"), "下载中呈现进行文案");
    const listener = fake.state.lastListener!;
    listener({ event: "Started", data: { contentLength: 200 } });
    listener({ event: "Progress", data: { chunkLength: 100 } });
    assert.ok(bodyText().includes("50%"), "有总大小时显示百分比");
    const fill = queryDialog().querySelector<HTMLElement>(".update-progress-fill");
    assert.ok(fill, "呈现进度条");
    assert.equal(fill!.style.width, "50%");
    fake.state.resolveDownload!();
    await flush();
    assert.equal(h.controller.getStatus(), "ready");
    assert.ok(bodyText().includes("本次打开软件期间可随时安装；关闭软件后需重新下载"), "已就绪呈现稍后提示文案");
    assert.ok(bodyText().includes("0.2.1"));
    assert.deepEqual(
      dialogButtons().map((button) => button.textContent),
      ["稍后", "现在重启安装"],
    );
    assert.equal(fake.state.installCalls, 0, "下载完成 MUST NOT 自动重启");
  });
});

test("立即更新：无总大小显示不确定进度（无百分比、不呈现进度条）", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    const listener = fake.state.lastListener!;
    listener({ event: "Started", data: {} });
    listener({ event: "Progress", data: { chunkLength: 64 } });
    listener({ event: "Progress", data: { chunkLength: 128 } });
    assert.ok(bodyText().includes("正在下载…"), "不确定进度只有文本");
    assert.doesNotMatch(bodyText(), /%\d|\d%/, "无总大小不得显示百分比");
    const track = queryDialog().querySelector<HTMLElement>(".update-progress-track");
    assert.ok(track?.classList.contains("hidden"), "无总大小不呈现进度条");
    fake.state.resolveDownload!();
    await flush();
    assert.equal(h.controller.getStatus(), "ready");
  });
});

test("下载失败→失败态→重试→成功进已就绪（失败→重试→成功路径）", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    fake.state.failDownload = true;
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    await flush();
    assert.equal(h.controller.getStatus(), "failed");
    assert.ok(bodyText().includes("下载未完成"), "下载失败如实呈现");
    assert.equal(h.snapshots[h.snapshots.length - 1]!.badge, true, "新版标记持续");
    fake.state.failDownload = false;
    buttonByLabel("重试").click();
    assert.equal(h.controller.getStatus(), "downloading", "重试重新下载");
    assert.equal(fake.state.downloadCalls, 2);
    fake.state.resolveDownload!();
    await flush();
    assert.equal(h.controller.getStatus(), "ready", "重试成功进已就绪");
  });
});

test("下载转后台继续：关闭不中断，完成不弹窗、只更新入口状态", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    buttonByLabel("转后台继续").click();
    const dialog = queryDialog();
    assert.equal(dialog.open, false, "对话框收起＝转后台");
    fake.state.resolveDownload!();
    await flush();
    assert.equal(h.controller.getStatus(), "ready");
    assert.equal(queryDialog().open, false, "后台下载完成 MUST NOT 弹窗");
    const last = h.snapshots[h.snapshots.length - 1]!;
    assert.equal(last.entryAction, "install", "入口变「重启安装更新」");
    assert.equal(last.statusText, "更新已就绪，可随时安装");
    assert.equal(fake.state.installCalls, 0);
  });
});

test("稍后：对话框收起，入口「重启安装更新」可再入安装确认", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    buttonByLabel("稍后").click();
    assert.equal(queryDialog().open, false);
    assert.equal(h.snapshots[h.snapshots.length - 1]!.entryAction, "install");
    // 再入：软件更新分区入口打开即呈现已就绪（不重新检查、不重新下载）
    h.controller.openEntry();
    assert.equal(queryDialog().open, true);
    assert.equal(h.controller.getStatus(), "ready");
    assert.ok(buttonByLabel("现在重启安装"), "再入即呈现安装确认");
    assert.equal(h.calls.check, 1, "再入不重复检查");
    assert.equal(fake.state.downloadCalls, 1, "再入不重复下载");
  });
});

// ========== 键盘与可访问性 ==========

test("Enter 聚焦语义：焦点在「打开下载页」时 Enter 不触发下载；无全局提交结构", async () => {
  await withDom(async (window) => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    // 结构前提：无 form、按钮全 type="button"——Enter 没有任何表单提交式全局映射，
    // 真实浏览器中只会原生激活当前聚焦按钮。
    assert.equal(queryDialog().querySelector("form"), null, "对话框不含 form");
    for (const button of dialogButtons()) {
      assert.equal(button.type, "button");
    }
    const page = buttonByLabel("打开下载页");
    page.focus();
    page.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event);
    await flush();
    assert.equal(fake.state.downloadCalls, 0, "Enter 不得开始下载");
    assert.equal(fake.state.installCalls, 0, "Enter 不得触发安装");
    assert.equal(h.controller.getStatus(), "available", "状态不变");
    // 对照：显式点击「立即更新」才进入下载。
    buttonByLabel("立即更新").click();
    assert.equal(h.controller.getStatus(), "downloading");
  });
});

test("Esc 按状态映射：检查中/发现新版/下载中/已就绪分别关闭且状态语义保留", async () => {
  await withDom(async (window) => {
    // 检查中＝关闭（检查随后静默出结果，只更新入口）
    const pendingCheck = deferred<UpdateHandle | null>();
    const h = mount({ check: () => pendingCheck.promise });
    h.controller.openManualCheck();
    assert.equal(h.controller.getStatus(), "checking");
    pressEsc(window);
    assert.equal(queryDialog().open, false, "检查中 Esc＝关闭");
    pendingCheck.resolve(null);
    await flush();
    assert.equal(h.controller.getStatus(), "up-to-date", "对话框已关时结果只落到入口状态");
    assert.equal(queryDialog().open, false, "迟到结果不重开对话框");
    h.controller.dispose();

    // 发现新版＝暂不（入口标记持续显示直到更新）
    const fake = fakeUpdate();
    const check2 = deferred<UpdateHandle | null>();
    const h2 = mount({ check: () => check2.promise });
    h2.controller.openManualCheck();
    check2.resolve(fake.handle);
    await flush();
    pressEsc(window);
    assert.equal(queryDialog().open, false, "发现新版 Esc＝暂不");
    assert.equal(h2.snapshots[h2.snapshots.length - 1]!.badge, true, "暂不后入口标记持续");

    // 下载中＝转后台继续（下载不中断）
    h2.controller.openEntry();
    buttonByLabel("立即更新").click();
    pressEsc(window);
    assert.equal(queryDialog().open, false, "下载中 Esc＝转后台");
    assert.equal(h2.controller.getStatus(), "downloading", "下载继续");
    fake.state.resolveDownload!();
    await flush();
    assert.equal(queryDialog().open, false, "转后台完成不弹窗");

    // 已就绪＝稍后（入口变「重启安装更新」）
    pressEsc; // 已由转后台关闭；重新打开走就绪态
    h2.controller.openEntry();
    assert.equal(h2.controller.getStatus(), "ready");
    pressEsc(window);
    assert.equal(queryDialog().open, false, "已就绪 Esc＝稍后");
    assert.equal(h2.snapshots[h2.snapshots.length - 1]!.entryAction, "install");
  });
});

test("可访问名称与焦点归还：aria-label「软件更新」，关闭后焦点回触发元素", async () => {
  await withDom(async () => {
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    const invoker = document.createElement("button");
    invoker.textContent = "检查更新";
    document.body.append(invoker);
    invoker.focus();
    h.controller.openManualCheck();
    assert.equal(queryDialog().getAttribute("aria-label"), "软件更新", "对话框具备可访问名称");
    assert.notEqual(document.activeElement, invoker, "打开时焦点移入对话框");
    buttonByLabel("关闭").click();
    assert.equal(queryDialog().open, false);
    assert.equal(document.activeElement, invoker, "关闭后焦点归还触发元素");
    check.resolve(null);
    await flush();
  });
});

// ========== 安装前离开守卫（任务 3.5） ==========

test("现在重启安装：守卫取消＝中止安装不退出，编辑与就绪状态保留", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise, guard: () => Promise.resolve(false) });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    assert.equal(h.controller.getStatus(), "ready");
    buttonByLabel("现在重启安装").click();
    await flush();
    assert.equal(h.controller.getStatus(), "ready", "取消守卫后回到已就绪");
    assert.equal(h.calls.guard, 1, "走了与正常退出相同的离开守卫");
    assert.equal(h.calls.prepare, 0, "取消守卫不得进入准备");
    assert.equal(fake.state.installCalls, 0, "不得触发安装");
    assert.ok(buttonByLabel("现在重启安装"), "就绪状态保留，可再次尝试");
  });
});

test("现在重启安装：准备失败＝中止并恢复正常操作、保留就绪状态", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise, guard: () => Promise.resolve(true), prepare: () => false });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    buttonByLabel("现在重启安装").click();
    await flush();
    assert.equal(h.controller.getStatus(), "ready", "准备失败回到已就绪");
    assert.equal(h.calls.prepare, 1);
    assert.equal(h.calls.restore, 1, "恢复正常操作（解锁编辑）");
    assert.equal(fake.state.installCalls, 0, "不得触发安装");
    assert.ok(bodyText().includes("安装准备未完成，可再次尝试"), "如实提示失败原因");
    assert.ok(buttonByLabel("现在重启安装"), "就绪状态保留");
  });
});

test("现在重启安装：准备成功→触发安装；install 未结算前不提前恢复", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise, guard: () => Promise.resolve(true), prepare: () => true });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    buttonByLabel("现在重启安装").click();
    await flush();
    assert.equal(h.calls.prepare, 1, "守卫通过后执行准备");
    assert.equal(fake.state.installCalls, 1, "准备完成后触发安装（Windows 由安装器接管退出）");
    assert.equal(h.calls.restore, 0, "等待进程退出，不提前恢复");
    assert.equal(h.controller.getStatus(), "preparing");
  });
});

test("现在重启安装：顺序固定——prepare → stopDriver → install（停止成功后才触发安装）", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const order: string[] = [];
    // 记录型假依赖：prepare、stopDriver、install 各自在执行时落序。
    const installImpl = fake.handle.install.bind(fake.handle);
    fake.handle.install = () => {
      order.push("install");
      return installImpl();
    };
    const check = deferred<UpdateHandle | null>();
    const h = mount({
      check: () => check.promise,
      guard: () => Promise.resolve(true),
      prepare: () => {
        order.push("prepare");
        return true;
      },
      stopDriver: () => {
        order.push("stopDriver");
        return Promise.resolve();
      },
    });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    buttonByLabel("现在重启安装").click();
    await flush();
    assert.deepEqual(order, ["prepare", "stopDriver", "install"], "安装序列顺序固定（design D5 修正）");
    assert.equal(h.calls.stopDriver, 1, "每次安装尝试恰好停止一次 sidecar");
    assert.equal(fake.state.installCalls, 1, "停止成功后才触发安装");
  });
});

test("现在重启安装：stopDriver 失败＝按准备失败处理——恢复现场、保留就绪状态、可重试", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    let stopAttempts = 0;
    const h = mount({
      check: () => check.promise,
      guard: () => Promise.resolve(true),
      prepare: () => true,
      stopDriver: () => {
        stopAttempts += 1;
        return stopAttempts === 1
          ? Promise.reject(new Error("stop driver failed"))
          : Promise.resolve();
      },
    });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    buttonByLabel("现在重启安装").click();
    await flush();
    assert.equal(h.controller.getStatus(), "ready", "停止失败回到已就绪");
    assert.equal(h.calls.restore, 1, "恢复现场（解锁编辑）");
    assert.equal(fake.state.installCalls, 0, "停止失败不得触发安装（sidecar 状态未知）");
    assert.ok(bodyText().includes("安装准备未完成，可再次尝试"), "如实按准备失败提示");
    assert.equal(h.errors.length, 1, "停止异常进入诊断日志");
    // 可重试：再次点击，停止恢复成功后安装照常触发。
    buttonByLabel("现在重启安装").click();
    await flush();
    assert.equal(h.calls.stopDriver, 2, "重试再次执行停止");
    assert.equal(fake.state.installCalls, 1, "停止成功后触发安装");
    assert.equal(h.controller.getStatus(), "preparing", "进入安装接管等待");
  });
});

test("准备期锁定：重复触发安装被忽略、无按钮、Esc 无动作", async () => {
  await withDom(async (window) => {
    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const guard = deferred<boolean>();
    const h = mount({ check: () => check.promise, guard: () => guard.promise, prepare: () => true });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    const installBtn = buttonByLabel("现在重启安装");
    installBtn.click();
    installBtn.click();
    await flush();
    assert.equal(h.calls.guard, 1, "重复触发被忽略（守卫只走一次）");
    assert.equal(fake.state.installCalls, 0, "守卫未通过前不触发安装");
    assert.equal(dialogButtons().length, 0, "准备期不呈现任何操作按钮");
    pressEsc(window);
    assert.equal(queryDialog().open, true, "准备期 Esc 无动作");
    // 取消守卫后恢复就绪，可再次尝试
    guard.resolve(false);
    await flush();
    assert.equal(h.controller.getStatus(), "ready");
    assert.ok(buttonByLabel("现在重启安装"), "取消守卫后回到就绪");
  });
});

test("install 抛错：中止并恢复正常操作、保留就绪状态", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    fake.state.failInstall = true;
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise, guard: () => Promise.resolve(true), prepare: () => true });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    buttonByLabel("现在重启安装").click();
    await flush();
    assert.equal(h.controller.getStatus(), "ready", "安装未完成回到已就绪");
    assert.equal(h.calls.restore, 1, "恢复正常操作");
    assert.ok(bodyText().includes("安装未能完成，可再次尝试"));
    assert.equal(h.errors.length, 1, "异常进入诊断日志");
  });
});

// ========== 状态不跨重启（design D12） ==========

test("状态不跨重启：全程无任何持久化写入；dispose 后单例归零、新实例从零开始", async () => {
  await withDom(async (window) => {
    // 监听一切持久化通道（localStorage / sessionStorage / cookie）
    const writes: string[] = [];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const original = storage.setItem.bind(storage);
      storage.setItem = (key: string, value: string) => {
        writes.push(`${storage === window.localStorage ? "local" : "session"}:${key}=${value}`);
        original(key, value);
      };
    }
    const cookieSetter = Object.getOwnPropertyDescriptor(window.Document.prototype, "cookie");
    if (cookieSetter?.set) {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        set(value: string) {
          writes.push(`cookie:${value}`);
        },
        get: cookieSetter.get,
      });
    }

    const fake = fakeUpdate();
    const check = deferred<UpdateHandle | null>();
    const h = mount({ check: () => check.promise });
    h.controller.openManualCheck();
    check.resolve(fake.handle);
    await flush();
    buttonByLabel("立即更新").click();
    fake.state.resolveDownload!();
    await flush();
    buttonByLabel("稍后").click();
    assert.equal(h.controller.getStatus(), "ready");

    // 无任何持久化写入：下载中/已就绪状态只在内存里
    assert.deepEqual(writes, [], "更新状态 MUST NOT 写入任何持久化存储");

    // 单例重置（进程销毁语义）
    h.controller.dispose();
    assert.equal(h.controller.getStatus(), "idle");
    const reset = h.snapshots[h.snapshots.length - 1]!;
    assert.deepEqual(
      { badge: reset.badge, statusText: reset.statusText, entryAction: reset.entryAction },
      { badge: false, statusText: "", entryAction: "check" },
      "dispose 后入口快照复位",
    );
    assert.equal(document.querySelector("dialog.update-dialog"), null, "对话框移除");

    // 模拟下次启动：新实例重新检查；重新下载前仍需用户确认
    const h2 = mount({ check: () => Promise.resolve(fakeUpdate("0.3.0").handle) });
    assert.equal(h2.controller.getStatus(), "idle");
    await h2.controller.startupCheck();
    assert.equal(h2.controller.getStatus(), "available", "重新检查发现新版（等待用户确认下载）");
    assert.equal(document.querySelectorAll("dialog.update-dialog").length, 0, "新实例不弹窗");
  });
});

// ========== 启动静默检查（任务 5.2） ==========

test("启动检查失败：完全静默——无弹窗、无入口状态、不抛错", async () => {
  await withDom(async () => {
    const h = mount({ check: () => Promise.reject(new Error("endpoint unreachable")) });
    await h.controller.startupCheck();
    assert.equal(h.controller.getStatus(), "idle");
    assert.equal(document.querySelector("dialog.update-dialog"), null, "不得创建/弹出对话框");
    assert.deepEqual(h.snapshots, [], "不得产生任何入口可见状态");
  });
});

test("启动检查无更新：零提示", async () => {
  await withDom(async () => {
    const h = mount({ check: () => Promise.resolve(null) });
    await h.controller.startupCheck();
    assert.equal(h.controller.getStatus(), "idle");
    assert.equal(document.querySelector("dialog.update-dialog"), null);
    assert.deepEqual(h.snapshots, [], "界面无任何新增提示");
  });
});

test("启动检查发现新版：只设置入口标记，不弹窗、不移动焦点（首启引导在场不冲突）", async () => {
  await withDom(async () => {
    // 模拟首启引导在场：一个引导按钮持有焦点
    const guideButton = document.createElement("button");
    guideButton.textContent = "开始使用";
    document.body.append(guideButton);
    guideButton.focus();
    const focusedBefore = document.activeElement;

    const fake = fakeUpdate("0.3.0");
    const h = mount({ check: () => Promise.resolve(fake.handle) });
    await h.controller.startupCheck();

    assert.equal(h.controller.getStatus(), "available");
    assert.equal(document.querySelector("dialog.update-dialog"), null, "MUST NOT 自动弹出对话框");
    assert.equal(document.activeElement, focusedBefore, "不得移动焦点");
    assert.equal(document.activeElement, guideButton, "不打断首启引导");
    const last = h.snapshots[h.snapshots.length - 1]!;
    assert.equal(last.badge, true, "仅设置软件更新分区入口更新标记");
    assert.equal(last.statusText, "有新版本可用（0.3.0）");
    assert.equal(last.entryAction, "check");
  });
});

// ========== 入口语义与离开守卫抽取 ==========

test("openEntry：idle 按手动检查打开；available 呈现现状不重复检查", async () => {
  await withDom(async () => {
    const fake = fakeUpdate();
    const h = mount({ check: () => Promise.resolve(fake.handle) });
    await h.controller.startupCheck();
    assert.equal(h.calls.check, 1);
    h.controller.openEntry();
    assert.equal(queryDialog().open, true);
    assert.equal(h.controller.getStatus(), "available");
    assert.equal(h.calls.check, 1, "已有结果时打开入口不重复检查");
    assert.ok(buttonByLabel("立即更新"), "入口打开即呈现发现新版");
  });
});

test("runLeaveGuard（close-guard 抽取）：不脏直接通过；脏时如实转达守卫结果", async () => {
  // 不脏：不弹三选一（guardLeave 不被调用）
  let guardCalled = false;
  assert.equal(
    await runLeaveGuard({
      isDirty: () => false,
      guardLeave: () => {
        guardCalled = true;
        return Promise.resolve(true);
      },
    }),
    true,
  );
  assert.equal(guardCalled, false, "不脏不得打扰用户");
  // 脏且用户取消：false
  assert.equal(
    await runLeaveGuard({ isDirty: () => true, guardLeave: () => Promise.resolve(false) }),
    false,
  );
  // 脏且守卫通过（保存/放弃）：true
  assert.equal(
    await runLeaveGuard({ isDirty: () => true, guardLeave: () => Promise.resolve(true) }),
    true,
  );
});
