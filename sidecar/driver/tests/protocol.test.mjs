// protocol.test.mjs — 驱动协议单一真相源的契约测试（change: add-agent-on-demand-reading 任务 1.1/1.2/1.4/1.5，设计 D7/D14）
// 三方钉死：protocol.json ↔ 生产 driver.mjs（源码扫描）↔ 验证替身 adapter.mjs（旧协议面清场）；
// 以及 denied-capabilities.json ↔ cordis.driver.yaml / gen-config.mjs 一致性（禁用清单单一真相源）。
// Rust 侧对应契约测试在 src-tauri/src/dsh_driver.rs 与 capability_gateway.rs 的测试模块。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { loadProtocol } from "../protocol.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_SRC = readFileSync(join(__dirname, "..", "driver.mjs"), "utf8");
const ADAPTER_SRC = readFileSync(join(__dirname, "..", "adapter.mjs"), "utf8");
const GEN_CONFIG_SRC = readFileSync(join(__dirname, "..", "gen-config.mjs"), "utf8");
const CORDIS_ENTRIES = yaml.load(readFileSync(join(__dirname, "..", "cordis.driver.yaml"), "utf8"));
const DENIED = JSON.parse(readFileSync(join(__dirname, "..", "denied-capabilities.json"), "utf8"));

// ── 1.1 协议真相源：结构 + 生产 v1 命令/事件全集（含 message_sent 与工具桥接）──
test("protocol.json 覆盖生产 v1 全部命令与事件（含工具桥接两项），无 planned 残留", () => {
  const protocol = loadProtocol();
  assert.equal(protocol.protocolVersion, 1);

  // 生产 v1 事件全集显式钉一次（任务 1.5 + 任务组 5：工具桥接投产）。
  assert.deepEqual(protocol.activeEvents, [
    "ready", "session_started", "delta", "message_sent",
    "message_done", "message_failed", "replay_ok", "session_ended", "error",
    "tool_call",
  ]);
  assert.deepEqual(protocol.activeCommands, [
    "start_session", "send_message", "replay_history",
    "replay_done", "cancel_message", "end_session", "shutdown", "tool_result",
  ]);
  // 工具桥接两项已投产（任务组 5）：不再有 planned 条目。
  assert.deepEqual(protocol.plannedEvents, []);
  assert.deepEqual(protocol.plannedCommands, []);
  // tool_call / tool_result 方向符合设计 D2（驱动→宿主 / 宿主→驱动）。
  const call = protocol.events.find((e) => e.name === "tool_call");
  const result = protocol.commands.find((e) => e.name === "tool_result");
  assert.equal(call.direction, "outbound");
  assert.equal(result.direction, "inbound");
});

// ── 1.2 生产驱动与真相源钉死（源码扫描，无需启动 DSH 容器）───────────────────
test("生产 driver.mjs 接协议真相源：处理全部 active 命令、发出全部 active 事件", () => {
  const protocol = loadProtocol();

  // driver.mjs 经 protocol.mjs 读取定义（常量与校验来源）。
  assert.ok(
    DRIVER_SRC.includes('from "./protocol.mjs"'),
    "driver.mjs 必须从 protocol.mjs（protocol.json 加载器）读取协议定义",
  );

  for (const name of protocol.activeCommands) {
    assert.ok(
      DRIVER_SRC.includes(`"${name}"`),
      `driver.mjs 必须认识 active 命令 ${name}`,
    );
  }
  for (const name of protocol.activeEvents) {
    assert.ok(
      DRIVER_SRC.includes(`"${name}"`),
      `driver.mjs 必须能发出 active 事件 ${name}`,
    );
  }
});

// ── 任务组 5：工具桥接形态与零作品读取（负向能力锚点，设计 D2）────────────────
test("driver.mjs 注册四件套工具面且只桥接：不读取作品文件、不落盘", () => {
  // 四件套以 DSH 工具声明注册（defineTool + ctx.tools.register），名字与协议一致。
  assert.ok(DRIVER_SRC.includes('from "@deepseek-ai/dsh-tools"'), "driver.mjs 必须经 dsh-tools 注册工具");
  assert.ok(DRIVER_SRC.includes(".tools.register("), "工具必须注册进 ToolRuntime");
  for (const name of ["story-list", "story-read", "story-search", "story-request-reading"]) {
    assert.ok(DRIVER_SRC.includes(`"${name}"`), `driver.mjs 必须注册工具 ${name}`);
  }
  // node 驱动零作品读取、零写盘（任务 9.3 负向能力锚点）：不导入任何文件系统
  // 模块——读写两侧都不存在，作品执行只在 Rust 宿主（设计 D2）。
  assert.ok(
    !/from "node:fs/.test(DRIVER_SRC),
    "driver.mjs 不得导入 node:fs（读写都不允许）",
  );
  for (const forbidden of ["readFileSync", "readFile(", "createReadStream", "readdir(", "writeFileSync", "writeFile(", "appendFile", "unlink", "rmSync", "spawnSync", "execSync"]) {
    assert.ok(!DRIVER_SRC.includes(forbidden), `driver.mjs 不得出现文件/命令 API：${forbidden}`);
  }
  // 桥接转发：工具实现以 tool_call 事件交宿主，等 tool_result 回填。
  assert.ok(DRIVER_SRC.includes('type: "tool_call"'), "工具实现必须发出 tool_call 事件");
  assert.ok(DRIVER_SRC.includes("settlePendingToolCall"), "必须有挂起调用的落定路径（取消/迟到丢弃）");
});

// ── 任务 8.1（设计 D10）：max_tokens 命令行配置链的驱动侧锚点 ─────────────────
test("driver.mjs 解析 --max-tokens，缺省维持 131072（透传来自宿主的可选配置）", () => {
  assert.ok(
    DRIVER_SRC.includes('"--max-tokens"'),
    "driver.mjs 必须解析 --max-tokens 命令行参数",
  );
  assert.ok(
    DRIVER_SRC.includes("const MAX_TOKENS_DEFAULT = 131072;"),
    "缺省默认必须是 131072（现状不变）",
  );
  assert.ok(
    DRIVER_SRC.includes("Number.isSafeInteger(args.maxTokens) && args.maxTokens > 0"),
    "非法值（非正整数）回落默认，不透传坏值给端点",
  );
});

// ── 1.2/1.5 替身旧协议面清场：旧事件名与旧点分工具名不再出现 ─────────────────
test("验证替身不再携带旧协议事件名与旧点分工具名", () => {
  for (const stale of [
    "tool_request", "tool_decision", "approval_wait", "approval_decision",
    "tool_event", "tool_material", "tool_list", "shutdown_ok",
  ]) {
    assert.ok(!ADAPTER_SRC.includes(stale), `adapter.mjs 不得再出现旧事件名 ${stale}`);
  }
  for (const stale of ["story.list", "story.read_document", "story.read_snapshot"]) {
    assert.ok(!ADAPTER_SRC.includes(stale), `adapter.mjs 不得再出现旧工具名 ${stale}`);
  }
  assert.ok(ADAPTER_SRC.includes('from "./protocol.mjs"'), "adapter.mjs 必须经 protocol.mjs 读取协议词表");
});

// ── 1.4 禁用清单单一真相源 ↔ 生成产物一致 ───────────────────────────────────
test("denied-capabilities.json 驱动 cordis.driver.yaml：清单内全部条目默认拒绝", () => {
  const ids = DENIED.entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "清单 id 不得重复");

  const byId = new Map(CORDIS_ENTRIES.map((entry) => [entry.id, entry]));
  for (const entry of DENIED.entries) {
    const cordis = byId.get(entry.id);
    assert.ok(cordis, `cordis.driver.yaml 缺少禁用条目：${entry.id}`);
    assert.equal(cordis.disabled, true, `${entry.id} 必须 disabled:true`);
  }

  // gateway 危险子集非空且被 Rust 侧一一钉死（capability_gateway 契约测试）。
  assert.ok(
    DENIED.entries.some((entry) => entry.gateway === true),
    "清单必须含 gateway=true 的危险工具条目",
  );
  // Agent 只读工具面与系统取材工具不得出现在禁用清单。
  for (const name of ["story-list", "story-read", "story-search", "story-request-reading", "story-snapshot"]) {
    assert.ok(!ids.includes(name), `只读工具 ${name} 不得出现在禁用清单`);
  }
});

test("gen-config.mjs 的 DENY_IDS 由 denied-capabilities.json 派生，不再硬编码清单", () => {
  assert.ok(
    GEN_CONFIG_SRC.includes("denied-capabilities.json"),
    "gen-config.mjs 必须读取 denied-capabilities.json",
  );
  assert.ok(
    !/const DENY_IDS = \[\s*"/.test(GEN_CONFIG_SRC),
    "gen-config.mjs 不得再内联硬编码 DENY_IDS 数组",
  );
});
