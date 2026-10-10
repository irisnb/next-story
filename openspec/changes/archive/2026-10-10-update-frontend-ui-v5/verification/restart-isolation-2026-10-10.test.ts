import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setupAiFeature, type AiFeatureDependencies } from "../../../../src/ai-feature.ts";
import type { AiSessionTransport } from "../../../../src/ai-session-transport.ts";
import type { AppDom } from "../../../../src/dom.ts";
import { deriveConversationSummary, type ConversationRecord } from "../../../../src/conversation-archive.ts";
import type { GenerateAiResult, LlmConfigSummary } from "../../../../src/types.ts";
import {
  installAiFeatureEnvironment,
  type FakeElement,
} from "../../../../tests/ai-panel-dom-fixture.ts";

/**
 * task 7.9 隔离数据重启 / 有效运行态复验（独立验证本 lane，不改产品源码）。
 *
 * 层级声明（不夸大）：
 * - 使用真实 Node 磁盘存储（临时目录；`conversation_save` 写 JSON、`conversation_read`/`conversation_list`
 *   读回），档案由控制器自身保存路径产生，不手工构造非法档案。
 * - 传输层为 fake（不调用任何真实模型/网络），因此本轮**不是**真实模型链路，也**不是** Windows 进程重启；
 *   它是「两个独立控制器实例共享同一磁盘存储」的应用重启语义模拟。
 * - 未读取密钥 / 生产正文 / 全局链路；所有数据在 mkdtemp 隔离目录内，测试结束清理。
 */

async function flush(ticks = 32): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

const savedConfig: LlmConfigSummary = {
  api_base_url: "https://api.invalid/v1",
  model: "m",
  has_api_key: true,
};

interface DiskStore {
  readonly reads: string[];
  readonly list: (projectPath: string) => Promise<{ conversations: ReturnType<typeof deriveConversationSummary>[]; skipped: string[] }>;
  readonly read: (projectPath: string, id: string) => Promise<ConversationRecord>;
  readonly save: (projectPath: string, record: ConversationRecord) => Promise<void>;
  readonly remove: (projectPath: string, id: string) => Promise<void>;
}

/** 真实磁盘存储：写/读 JSON 档案（字段契约与 Rust conversation_store 一致）。 */
function diskStore(dir: string): DiskStore {
  const pathOf = (id: string): string => join(dir, `${id}.json`);
  const reads: string[] = [];
  return {
    reads,
    list: () => {
      const conversations = readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as ConversationRecord)
        .map(deriveConversationSummary);
      return Promise.resolve({ conversations, skipped: [] });
    },
    read: (_projectPath, id) => {
      reads.push(id);
      return Promise.resolve(JSON.parse(readFileSync(pathOf(id), "utf8")) as ConversationRecord);
    },
    save: (_projectPath, record) => {
      writeFileSync(pathOf(record.conversation_id), JSON.stringify(record));
      return Promise.resolve();
    },
    remove: (_projectPath, id) => {
      rmSync(pathOf(id), { force: true });
      return Promise.resolve();
    },
  };
}

interface Fixture {
  readonly controller: ReturnType<typeof setupAiFeature>;
  readonly env: ReturnType<typeof installAiFeatureEnvironment>;
  readonly store: DiskStore;
  readonly transport: { sends: Array<() => Promise<GenerateAiResult>>; readonly sendCount: () => number };
  restore(): void;
}

function fixture(dir: string, startId = 1): Fixture {
  const env = installAiFeatureEnvironment();
  const store = diskStore(dir);
  const sends: Array<() => Promise<GenerateAiResult>> = [];
  let sendCount = 0;
  let idSeed = startId - 1;
  const transport: AiSessionTransport = {
    sendViaResidentSession: () => {
      sendCount += 1;
      const behavior = sends.shift();
      return behavior ? behavior() : Promise.resolve({ ok: true, content: "回答", sent_confirmed: true });
    },
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
  const dependencies: AiFeatureDependencies = {
    transport,
    loadConfig: () => Promise.resolve(savedConfig),
    conversationList: store.list,
    conversationRead: store.read,
    conversationSave: store.save,
    conversationDelete: store.remove,
    newConversationId: () => {
      idSeed += 1;
      return `c-${idSeed}`;
    },
  };
  const controller = setupAiFeature(
    { aiDock: env.dom, editorTextarea: env.editor, btnToggleAi: env.btnToggleAi } as unknown as AppDom,
    {
      getCurrentDocumentId: () => "doc-1",
      getCurrentEditor: () => null,
      openConfigPage: () => {},
      getCurrentProjectPath: () => "隔离作品",
      getCurrentDocumentTitle: () => "草稿",
    },
    dependencies,
  );
  return {
    controller,
    env,
    store,
    transport: { sends, sendCount: () => sendCount },
    restore() {
      controller.destroy();
      env.restore();
    },
  };
}

function submitDirectQuestion(env: ReturnType<typeof installAiFeatureEnvironment>, question: string): void {
  const newBtn = env.elements.get("ai-new-conversation") as FakeElement;
  newBtn.dispatch("click");
  const win = env.windowRoots[env.windowRoots.length - 1];
  const input = win.queryResults.get('[data-role="direct-question-input"]') as FakeElement;
  input.value = question;
  input.dispatch("input");
  win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
}

/**
 * 经显示层提交追问（走 on-submit 动作，接受即持久化 pending 档案；
 * 控制器直呼 `submitFollowUp` 不持久化，属另一入口）。
 */
function submitFollowUpViaDom(env: ReturnType<typeof installAiFeatureEnvironment>, question: string): void {
  const win = env.windowRoots[env.windowRoots.length - 1];
  const input = win.queryResults.get('[data-role="follow-up-input"]') as FakeElement;
  input.value = question;
  input.dispatch("input");
  win.queryResults.get('[data-role="follow-up-form"]')!.dispatch("submit");
}

function newDir(): string {
  return mkdtempSync(join(tmpdir(), "ns-restart-"));
}

test("runtime reopen selects identity without disk load and preserves the in-flight request", async () => {
  const dir = newDir();
  const fx = fixture(dir);
  try {
    await fx.controller.beginProject();
    submitDirectQuestion(fx.env, "原问题"); // 首轮：默认成功
    await flush();
    // 追问发送挂起 → 背景生成中的运行期讨论（有对话）。
    let release!: (r: GenerateAiResult) => void;
    fx.transport.sends.push(() => new Promise<GenerateAiResult>((resolve) => { release = resolve; }));
    assert.equal(await fx.controller.submitFollowUp("生成中的追问"), true);
    await flush();

    const id = fx.controller.state.activeConversationId!;
    const summary = fx.controller.getConversations().find((s) => s.conversation_id === id)!;
    assert.ok(summary, "运行期讨论出现在列表");

    const readsBefore = fx.store.reads.length;
    fx.controller.openDiscussion(summary); // 重开背景生成中的讨论
    await flush();

    assert.equal(fx.store.reads.length, readsBefore, "有效运行态重开不读盘");
    const request = fx.controller.state.viewOf(id).request;
    assert.equal(request.kind, "loading", "在途请求状态保留");
    assert.equal(fx.store.reads.length, 0, "本用例未发生任何读档");

    release({ ok: true, content: "回答", sent_confirmed: true });
    await flush();
  } finally {
    fx.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart via disk store: unfinished in-flight round reopens interrupted with no auto-send", async () => {
  const dir = newDir();
  // ---- 进程实例 1：产生一个未完成轮并落盘，随后结束 ----
  let id = "";
  {
    const one = fixture(dir);
    try {
      await one.controller.beginProject();
      submitDirectQuestion(one.env, "原问题");
      await flush();
      one.transport.sends.push(() => new Promise<GenerateAiResult>(() => {})); // 追问永不返回
      submitFollowUpViaDom(one.env, "未完成追问"); // 经显示层提交 → 接受即持久化 pending 档案
      await flush();
      id = one.controller.state.activeConversationId!;
      await one.controller.drainPendingSaves();
      assert.ok(existsSync(join(dir, `${id}.json`)), "未完成轮档案已落盘");
    } finally {
      one.restore();
    }
  }

  const archived = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as ConversationRecord;
  assert.ok(
    archived.turns.some((turn) => turn.role === "assistant" && turn.status === "pending"),
    "磁盘档案含未完成（pending）轮",
  );

  // ---- 进程实例 2：新鲜控制器，仅从磁盘恢复 ----
  const two = fixture(dir, 100);
  try {
    await two.controller.beginProject();
    const summary = two.controller.getConversations().find((s) => s.conversation_id === id);
    assert.ok(summary, "重启后列表含该讨论");

    two.controller.openDiscussion(summary!);
    await flush();

    assert.equal(two.store.reads.length, 1, "重开无运行态讨论读盘一次");
    const conversation = two.controller.state.conversationOf(id);
    assert.ok(conversation, "已从磁盘恢复讨论");
    assert.equal(conversation!.pending?.question, "未完成追问");
    assert.equal(conversation!.pending?.interrupted, true, "未完成轮标中断");
    assert.equal(two.transport.sendCount(), 0, "重启重开不自动重发（零发送）");
  } finally {
    two.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart isolation does not touch the enabled chain or model (no side effects)", async () => {
  // 本 fixture 只注入 conversation 存储与 fake 传输；未注入任何链路库 / LLM 调用回调。
  // 结构性断言：真实模型调用不发生（fake 传输计数可控），且未读取任何密钥/生产正文。
  const dir = newDir();
  const fx = fixture(dir);
  try {
    await fx.controller.beginProject();
    assert.equal(fx.transport.sendCount(), 0, "beginProject 不发模型请求");
    assert.equal(fx.store.reads.length, 0, "项目加载仅列表，不读正文");
  } finally {
    fx.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
