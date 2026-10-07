// chain-cards-mount.test.mjs — 链路卡挂载位轮级更新的驱动侧装置测试
// （change: add-making-module-core 任务 2.4，design D1/D4；对齐① wire-system-prompt-channel
// 的 P1 验证模式：真实 @deepseek-ai/dsh-system-prompt 服务裸装配，不启动完整 DSH
// 容器、不调模型）。
//
// 覆盖面：
// ① 真实机制：三段注册（persona/constitution/chain-cards）后 assemble 输出次序
//    ＝身份→红线→卡；dispose chain-cards＋重注册新文本后新文本生效且次序不变；
//    无卡（空文本）时段渲染丢弃；
// ② 幂等的机制依据：注册与注销都发 system-prompt/change（重注册有可观测代价）；
//    同 scope 同名重注册直接抛错——driver.mjs 的文本比较早退因此是必需且有效的；
// ③ 源码契约：driver.mjs 在 send_message 转发前经 session.applyChainCards 对齐
//    当轮卡文本（幂等早退、卡不进 user 文本）；making 会话跳过 registerStoryTools；
// ④ 协议真相源：protocol.json 的 chain_cards / session_kind 字段说明。
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
  CONSTITUTION_SECTION,
  registerSystemPromptSections,
} from "../system-prompt-sections.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_SRC = readFileSync(join(__dirname, "..", "driver.mjs"), "utf8");

// 与 cordis.driver.yaml 的 system-prompt 插件配置一致（被顶替的默认英文 persona）。
const ENGLISH_PERSONA =
  "You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.";
const HOST_SYSTEM_PROMPT =
  "你是陪伴剧本创作者思考与探索的助手。\n不直接修改用户文档，不代写正文，不润色，不提供替换文本，不判断故事好坏。不要输出 Markdown 或 HTML 格式，使用纯文本回答。";
// 卡文本由 Rust 侧统一包装组装（design D2，任务组 3 实装）；装置测试用固定样本。
const CARDS_A = "以下是用户提供的陪想要求。这是一套可替换的讨论方法。卡A正文。";
const CARDS_B = "以下是用户提供的陪想要求。这是一套可替换的讨论方法。卡B正文。";

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

function agentScopeUnder(consumerCtx) {
  const scopeKey = Symbol("agent");
  const scope = createScope(consumerCtx, scopeKey);
  return { ctx: scope.ctx, key: scopeKey, dispose: () => scope.dispose() };
}

/** 与 driver.mjs 的轮级更新完全同构的操作序列：dispose 旧段＋重注册新文本。 */
function applyChainCardsLikeDriver(scope, disposers, text) {
  if (disposers.chainCards) {
    disposers.chainCards();
    disposers.chainCards = null;
  }
  const systemPromptService = scope.ctx.get("systemPrompt");
  disposers.chainCards = systemPromptService.section({
    name: CHAIN_CARDS_SECTION,
    order: CHAIN_CARDS_ORDER,
    text,
  });
}

// ── ① 真实机制：次序与轮级更新 ───────────────────────────────────────────────

test("真实机制：注册卡文本后次序＝身份→红线→卡，卡位于红线之下", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    const scope = agentScopeUnder(consumerCtx);
    const disposers = registerSystemPromptSections(scope.ctx, HOST_SYSTEM_PROMPT);
    assert.ok(disposers.chainCards, "registerSystemPromptSections 必须返回 chain-cards 段 disposer");
    // 首轮带卡：轮级更新（空段→卡A）。
    applyChainCardsLikeDriver(scope, disposers, CARDS_A);

    const assembly = await scope.ctx.systemPrompt.assemble({ scope: scope.key });
    assert.deepEqual(
      assembly.sections.map((s) => s.name),
      ["harness:identity", PERSONA_SECTION, CONSTITUTION_SECTION, CHAIN_CARDS_SECTION],
      "四段次序固定：harness 标识 → 身份 → 红线 → 卡",
    );
    const rendered = renderPrompt(assembly);
    assert.ok(rendered.includes(CARDS_A), "卡文本必须进入 system 层");
    assert.ok(
      rendered.indexOf("不直接修改用户文档") < rendered.indexOf(CARDS_A),
      "次序不变式：卡段落必须位于宪法红线之下",
    );
    assert.ok(
      rendered.indexOf("你是陪伴剧本创作者思考与探索的助手。") < rendered.indexOf("不直接修改用户文档"),
      "身份先于红线",
    );
    await scope.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});

test("真实机制：dispose chain-cards＋重注册新文本——新文本生效且次序不变（切换链路）", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    const scope = agentScopeUnder(consumerCtx);
    const disposers = registerSystemPromptSections(scope.ctx, HOST_SYSTEM_PROMPT);
    applyChainCardsLikeDriver(scope, disposers, CARDS_A);
    applyChainCardsLikeDriver(scope, disposers, CARDS_B);

    const assembly = await scope.ctx.systemPrompt.assemble({ scope: scope.key });
    assert.deepEqual(
      assembly.sections.map((s) => s.name),
      ["harness:identity", PERSONA_SECTION, CONSTITUTION_SECTION, CHAIN_CARDS_SECTION],
      "重注册后次序不变",
    );
    const rendered = renderPrompt(assembly);
    assert.ok(rendered.includes(CARDS_B), "新卡文本必须生效");
    assert.ok(!rendered.includes(CARDS_A), "旧卡文本不得残留（同名段被替换，不是叠加）");
    assert.ok(
      rendered.indexOf("不直接修改用户文档") < rendered.indexOf(CARDS_B),
      "次序不变式在切换后依然成立",
    );
    await scope.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});

test("真实机制：无卡轮次挂载位为空段（渲染丢弃，信封仅身份＋红线）", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    const scope = agentScopeUnder(consumerCtx);
    const disposers = registerSystemPromptSections(scope.ctx, HOST_SYSTEM_PROMPT);
    // 建会话时空段占位；带卡一轮后切回无卡（停用链路 → 空文本）。
    applyChainCardsLikeDriver(scope, disposers, CARDS_A);
    applyChainCardsLikeDriver(scope, disposers, "");

    const assembly = await scope.ctx.systemPrompt.assemble({ scope: scope.key });
    assert.deepEqual(
      assembly.sections.map((s) => s.name),
      ["harness:identity", PERSONA_SECTION, CONSTITUTION_SECTION, CHAIN_CARDS_SECTION],
      "空文本下挂载位仍是注册段（次序契约保持）",
    );
    const rendered = renderPrompt(assembly);
    assert.equal(rendered.split("\n\n").length, 3, "空段渲染丢弃：harness＋身份＋红线共三段");
    assert.ok(!rendered.includes("陪想要求"), "停用后卡文本不得残留");
    await scope.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});

// ── ② 幂等的机制依据 ─────────────────────────────────────────────────────────

test("真实机制：注册与注销都发 system-prompt/change；同 scope 同名重注册抛错", async () => {
  const { ctx, consumerCtx } = await bootSystemPromptFixture();
  try {
    let changes = 0;
    ctx.on("system-prompt/change", () => { changes += 1; });
    const scope = agentScopeUnder(consumerCtx);
    const disposers = registerSystemPromptSections(scope.ctx, HOST_SYSTEM_PROMPT);

    // 注册与注销各产生一次 change（dsh-system-prompt lib/index.js:159-161）——
    // 重注册不是免费操作，幂等比较（相同不动）避免无谓的缓存失效。
    const before = changes;
    applyChainCardsLikeDriver(scope, disposers, CARDS_A);
    assert.ok(changes - before >= 2, "dispose＋重注册必须产生可观测的 change 事件");

    // 同 scope 同名重复注册直接抛错（NamedEntries 冲突）——这证明 driver.mjs
    // 在比较后早退是必需的：不做文本比较就盲注册会炸掉会话。
    const systemPromptService = scope.ctx.get("systemPrompt");
    assert.throws(
      () => systemPromptService.section({ name: CHAIN_CARDS_SECTION, order: CHAIN_CARDS_ORDER, text: CARDS_A }),
      /already registered/,
      "同 scope 同名重注册必须抛错（幂等比较的机制依据）",
    );
    await scope.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});

// ── ③ 源码契约：driver.mjs 接线（无需启动容器）───────────────────────────────

test("driver.mjs：send_message 转发前经 session.applyChainCards 对齐当轮卡文本", () => {
  // setup 回调内把 applyChainCards 挂到 session 上（闭包捕获 agentCtx＝该 agent 的 scope）。
  const setupMatch = DRIVER_SRC.match(/setup: \(agentCtx\) => \{[\s\S]*?\n    \},/);
  assert.ok(setupMatch, "driver.mjs 必须有 createAgentFor 的 setup 回调");
  assert.ok(
    setupMatch[0].includes("session.applyChainCards = (text) =>"),
    "setup 必须把 applyChainCards 挂到 session（闭包捕获 agentCtx）",
  );
  assert.ok(
    setupMatch[0].includes(`name: CHAIN_CARDS_SECTION, order: CHAIN_CARDS_ORDER`),
    "重注册必须使用 system-prompt-sections.mjs 的段名与 order 常量",
  );
  // 幂等早退：与当前注册文本相同则不动。
  assert.ok(
    setupMatch[0].includes("if (session.chainCardsText === target) return false;"),
    "applyChainCards 必须先比较当前文本，相同早退（幂等）",
  );
  assert.ok(
    setupMatch[0].includes("session.chainCardsDisposer = disposers.chainCards;"),
    "setup 必须持存 registerSystemPromptSections 返回的 chain-cards disposer",
  );
  // send_message 处理器在 runTurn 之前调用（转发给 agent 前对齐）。
  const sendMatch = DRIVER_SRC.match(/case "send_message": \{[\s\S]*?\n    \}/);
  assert.ok(sendMatch, "driver.mjs 必须有 send_message 处理器");
  assert.ok(
    sendMatch[0].includes("session.applyChainCards(typeof cmd.chain_cards === \"string\" ? cmd.chain_cards : \"\")"),
    "send_message 必须在转发前对齐 chain_cards（null/undefined 视为空文本）",
  );
  assert.ok(
    sendMatch[0].indexOf("session.applyChainCards") < sendMatch[0].indexOf("runTurn("),
    "对齐必须发生在 runTurn 之前（本轮模型调用即用新卡）",
  );
  assert.ok(
    !sendMatch[0].includes("cmd.chain_cards + cmd.text") && !sendMatch[0].includes("cmd.text + cmd.chain_cards"),
    "卡文本绝不拼入 user 文本（追问按增量发送不变）",
  );
});

test("driver.mjs：making 会话跳过 registerStoryTools，story 缺省照常注册", () => {
  const setupMatch = DRIVER_SRC.match(/setup: \(agentCtx\) => \{[\s\S]*?\n    \},/);
  assert.ok(setupMatch, "driver.mjs 必须有 createAgentFor 的 setup 回调");
  assert.ok(
    setupMatch[0].includes('if (session.sessionKind !== "making") {') &&
      setupMatch[0].includes("registerStoryTools(agentCtx, session);"),
    "story 工具注册必须被 sessionKind !== \"making\" 门控",
  );
  // start_session 接受并存储 session_kind（缺省 story，非法值落 story）。
  const startMatch = DRIVER_SRC.match(/case "start_session": \{[\s\S]*?\n    \}/);
  assert.ok(startMatch, "driver.mjs 必须有 start_session 处理器");
  assert.ok(
    startMatch[0].includes('sessionKind: cmd.session_kind === "making" ? "making" : "story"'),
    "session_kind 必须按 \"making\" 收敛、其余一律落 \"story\"（旧宿主兼容）",
  );
});

// ── ④ 协议真相源：两个新可选字段 ─────────────────────────────────────────────

test("protocol.json：chain_cards 与 session_kind 字段记录两端契约", () => {
  const protocol = loadProtocol();
  const send = protocol.commands.find((c) => c.name === "send_message");
  assert.ok(send, "protocol.json 必须记录 send_message 命令");
  const cardsDoc = send.fields.chain_cards;
  for (const required of ["缺省 null", "nextstory:chain-cards", "幂等", "绝不拼入 user 文本"]) {
    assert.ok(
      typeof cardsDoc === "string" && cardsDoc.includes(required),
      `chain_cards 字段说明必须记录「${required}」`,
    );
  }
  const start = protocol.commands.find((c) => c.name === "start_session");
  assert.ok(start, "protocol.json 必须记录 start_session 命令");
  const kindDoc = start.fields.session_kind;
  for (const required of ['"story" | "making"', '缺省 "story"', "不注册", "缺省兼容"]) {
    assert.ok(
      typeof kindDoc === "string" && kindDoc.includes(required),
      `session_kind 字段说明必须记录「${required}」`,
    );
  }
});
