// system-prompt-layering.test.mjs — 信封分层驱动侧契约测试
// （change: wire-system-prompt-channel 任务 1.4，design D1/D2/D5）
//
// 三层钉死：
// ① 真实机制：用真实 @deepseek-ai/dsh-system-prompt 服务（cordis Context 裸装配，
//    persona 配置与 cordis.driver.yaml 一致）验证 registerSystemPromptSections 的
//    遮蔽与次序——不启动完整 DSH 容器、不调模型；
// ② 纯函数：splitSystemPrompt 拆段协议（首行身份 / 换行后红线 / 逐字切片）；
// ③ 源码扫描：driver.mjs 的接线点（setup 内注册、两路共用、seed 死参数清场）
//    与 protocol.json 的新字段语义。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Context } from "@deepseek-ai/cordis";
import {
  SystemPrompt,
  PERSONA_SECTION,
  renderPrompt,
} from "@deepseek-ai/dsh-system-prompt";
import { createScope } from "@deepseek-ai/dsh-scope";

import { loadProtocol } from "../protocol.mjs";
import {
  CHAIN_CARDS_ORDER,
  CHAIN_CARDS_SECTION,
  CONSTITUTION_ORDER,
  CONSTITUTION_SECTION,
  registerSystemPromptSections,
  splitSystemPrompt,
} from "../system-prompt-sections.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_SRC = readFileSync(join(__dirname, "..", "driver.mjs"), "utf8");

// 与 cordis.driver.yaml 的 system-prompt 插件配置一致（被顶替的默认英文 persona）。
const ENGLISH_PERSONA =
  "You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.";
// 陪想身份句（2026-10-06 用户拍板备选 A；与 Rust 侧 IDENTITY_SENTENCE 逐字一致，
// 逐字锚点见拆段契约断言）。
const IDENTITY_SENTENCE = "你是陪伴剧本创作者思考与探索的助手。";
const HOST_SYSTEM_PROMPT =
  "你是陪伴剧本创作者思考与探索的助手。\n不直接修改用户文档，不代写正文，不润色，不提供替换文本，不判断故事好坏。不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

/**
 * 裸装配一个真实 SystemPrompt 服务（不启动 DSH 容器）。
 * 返回消费方上下文；用毕 dispose 整个 ctx。
 * agent-loop 在真实环境注册 model/cwd 变量（lib/index.js:1001-1003），
 * 默认英文 persona 模板引用它们，测试同构注册以便回退路径可渲染。
 */
async function bootSystemPromptFixture() {
  const ctx = new Context();
  const fiber = ctx.plugin(SystemPrompt, { persona: ENGLISH_PERSONA });
  await fiber.await();
  let consumerCtx = null;
  const consumerFiber = ctx.inject(["systemPrompt"], (c) => {
    c.systemPrompt.variable("model", () => "test-model");
    c.systemPrompt.variable("cwd", () => "/tmp");
    consumerCtx = c;
    return null;
  });
  await consumerFiber.await();
  return { ctx, consumerCtx };
}

/** 在 consumerCtx 下开一个 Agent 作用域（等价于 setup 回调收到的 agent.ctx）；assemble 需要作用域 key。 */
function agentScopeUnder(consumerCtx) {
  const scopeKey = Symbol("agent");
  const scope = createScope(consumerCtx, scopeKey);
  return { ctx: scope.ctx, key: scopeKey, dispose: () => scope.dispose() };
}

test("真实机制：system_prompt 非空时注册生效且次序正确（身份→红线→挂载位）", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    const scope = agentScopeUnder(consumerCtx);
    registerSystemPromptSections(scope.ctx, HOST_SYSTEM_PROMPT);

    const assembly = await scope.ctx.systemPrompt.assemble({ scope: scope.key });
    const names = assembly.sections.map((s) => s.name);
    assert.deepEqual(
      names,
      ["harness:identity", PERSONA_SECTION, CONSTITUTION_SECTION, CHAIN_CARDS_SECTION],
      "system 层段落与次序固定：harness 标识 → 陪想身份 → 宪法红线 → 链路卡挂载位",
    );
    const rendered = renderPrompt(assembly);
    // 次序不变式（红线永居卡挂载位之上）：渲染文本中身份先于红线。
    assert.ok(
      rendered.indexOf(IDENTITY_SENTENCE) < rendered.indexOf("不直接修改用户文档"),
      "渲染次序必须身份先于红线",
    );
    // 空挂载位不渲染（order 20 只占次序契约，本变更不填内容）。
    assert.equal(rendered.split("\n\n").length, 3, "空段渲染丢弃：harness＋身份＋红线共三段");
    await scope.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});

test("真实机制：默认英文 persona 被顶替不残留", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    const scope = agentScopeUnder(consumerCtx);
    registerSystemPromptSections(scope.ctx, HOST_SYSTEM_PROMPT);
    const assembly = await scope.ctx.systemPrompt.assemble({ scope: scope.key });
    const rendered = renderPrompt(assembly);
    assert.ok(!rendered.includes("coding agent"), "英文默认 persona 文案不得残留");
    assert.ok(!rendered.includes("{{model}}"), "英文 persona 模板变量不得残留");
    assert.ok(rendered.includes(IDENTITY_SENTENCE), "中文陪想身份在位");
    await scope.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});

test("真实机制：正常与重放两路一致（同一 system_prompt → 逐字相同的 system 层）", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    // 模拟两条建 Agent 路径：首条 send_message 建会话与 replay_done 重建
    // （生产中两者都经 createAgentFor 的同一 setup 注册，design D1）。
    const scopeA = agentScopeUnder(consumerCtx);
    const scopeB = agentScopeUnder(consumerCtx);
    registerSystemPromptSections(scopeA.ctx, HOST_SYSTEM_PROMPT);
    registerSystemPromptSections(scopeB.ctx, HOST_SYSTEM_PROMPT);
    const renderedA = renderPrompt(await scopeA.ctx.systemPrompt.assemble({ scope: scopeA.key }));
    const renderedB = renderPrompt(await scopeB.ctx.systemPrompt.assemble({ scope: scopeB.key }));
    assert.equal(renderedA, renderedB, "正常与重放两路的 system 层逐字一致");
    // 作用域隔离：一个 Agent 的注册不影响另一个未注册的 Agent（默认 persona 仍在）。
    const scopeC = agentScopeUnder(consumerCtx);
    const renderedC = renderPrompt(await scopeC.ctx.systemPrompt.assemble({ scope: scopeC.key }));
    assert.ok(renderedC.includes("coding agent"), "未注册的 Agent 维持默认 persona（作用域隔离）");
    await Promise.all([scopeA.dispose(), scopeB.dispose(), scopeC.dispose()]);
  } finally {
    await ctx.fiber.dispose();
  }
});

test("真实机制：system_prompt 为空时维持现状（向后兼容，默认 persona 不被顶替）", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    const scope = agentScopeUnder(consumerCtx);
    registerSystemPromptSections(scope.ctx, "");
    const assembly = await scope.ctx.systemPrompt.assemble({ scope: scope.key });
    assert.deepEqual(
      assembly.sections.map((s) => s.name),
      ["harness:identity", PERSONA_SECTION],
      "空 system_prompt 不注册任何自定义段",
    );
    const rendered = renderPrompt(assembly);
    assert.ok(rendered.includes("coding agent"), "默认英文 persona 维持现状");
    assert.ok(!rendered.includes(IDENTITY_SENTENCE), "空输入不得注入身份句");
    await scope.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});

// ── 纯函数：拆段协议（逐字切片，重放一致性依赖不加工）──────────────────────────

test("splitSystemPrompt：首行身份、换行后红线，逐字切片不修剪", () => {
  const split = splitSystemPrompt(HOST_SYSTEM_PROMPT);
  // 期望值用逐字字面量（备选 A）：与 Rust 侧 IDENTITY_SENTENCE 漂移时此处必须失败。
  assert.equal(split.identity, "你是陪伴剧本创作者思考与探索的助手。");
  assert.equal(
    split.constitution,
    "不直接修改用户文档，不代写正文，不润色，不提供替换文本，不判断故事好坏。不要输出 Markdown 或 HTML 格式，使用纯文本回答。",
  );

  // 无换行：整段为身份句（红线为空）。
  assert.deepEqual(splitSystemPrompt("只有身份。"), { identity: "只有身份。", constitution: "" });
  // 空与非字符串输入：两者皆空（不注册任何段）。
  assert.deepEqual(splitSystemPrompt(""), { identity: "", constitution: "" });
  assert.deepEqual(splitSystemPrompt(undefined), { identity: "", constitution: "" });
  // 红线内的换行保留（只在首个换行拆一次）。
  const multi = splitSystemPrompt("身份。\n红线一。\n红线二。");
  assert.equal(multi.constitution, "红线一。\n红线二。");
});

// ── 源码扫描：驱动接线点契约（无需启动容器）────────────────────────────────────

test("driver.mjs 在 createAgentFor 的 setup 内注册信封段落（两路共用的必经点）", () => {
  assert.ok(
    DRIVER_SRC.includes('from "./system-prompt-sections.mjs"'),
    "driver.mjs 必须导入信封注册模块",
  );
  // setup 回调内调用（per-agent 注册，先例 installModelSelection 同位）。
  const setupMatch = DRIVER_SRC.match(/setup: \(agentCtx\) => \{[\s\S]*?\n    \},/);
  assert.ok(setupMatch, "driver.mjs 必须有 createAgentFor 的 setup 回调");
  assert.ok(
    setupMatch[0].includes("registerSystemPromptSections(agentCtx, session.systemPrompt)"),
    "信封注册必须在 setup 回调内按 session.systemPrompt 调用（正常与重放两路一致）",
  );
  assert.ok(
    setupMatch[0].includes("installModelSelection(agentCtx"),
    "锚点自检：setup 块匹配的是 createAgentFor（先例同位）",
  );
});

test("buildSeedEvents 死参数已清场：制度性内容只走 section 通道", () => {
  assert.ok(
    !DRIVER_SRC.includes("function buildSeedEvents(turns, system)"),
    "buildSeedEvents 不得再有 system 死参数",
  );
  assert.ok(
    !DRIVER_SRC.includes("buildSeedEvents(session.seedTurns, session.systemPrompt)"),
    "调用点不得再把 systemPrompt 传给 seed 构造",
  );
  assert.ok(
    DRIVER_SRC.includes("function buildSeedEvents(turns)"),
    "buildSeedEvents 只按轮次构造 seed 事件",
  );
});

// ── 协议真相源：start_session.system_prompt 的新语义（设计 D5）────────────────

test("protocol.json：system_prompt 字段记录宿主必发与驱动注册语义", () => {
  const protocol = loadProtocol();
  const startSession = protocol.commands.find((c) => c.name === "start_session");
  assert.ok(startSession, "protocol.json 必须记录 start_session 命令");
  const doc = startSession.fields.system_prompt;
  for (const required of [
    "宿主必发",
    PERSONA_SECTION,
    CONSTITUTION_SECTION,
    CHAIN_CARDS_SECTION,
    "逐字一致",
    "空字符串＝旧宿主兼容",
  ]) {
    assert.ok(
      typeof doc === "string" && doc.includes(required),
      `system_prompt 字段说明必须记录「${required}」`,
    );
  }
});
