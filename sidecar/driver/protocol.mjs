// protocol.mjs — 驱动协议单一真相源的共享加载器（change: add-agent-on-demand-reading 任务 1.1/1.2，设计 D7）
//
// sidecar/driver/protocol.json 是宿主（Rust dsh_driver.rs）与驱动（node）之间行分隔 JSON 协议的
// 唯一词表来源：生产 driver.mjs 启动时经本模块加载并做一致性自检；验证替身 adapter.mjs 经本模块
// 取事件词表并在发出每条消息时校验（替身结构性地发不出协议外事件）；两端测试亦复用。
// 本模块只做加载与结构校验，无业务逻辑、无网络、无写入。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_PATH = join(__dirname, "protocol.json");

const DIRECTIONS = new Set(["inbound", "outbound"]);
const STATUSES = new Set(["active", "planned"]);

function fail(reason) {
  throw new Error(`protocol.json 结构错误：${reason}`);
}

function parseEntries(raw, kind, expectedDirection) {
  if (!Array.isArray(raw) || raw.length === 0) fail(`${kind} 必须是非空数组`);
  const seen = new Set();
  const entries = raw.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${kind} 条目必须是对象`);
    }
    if (typeof entry.name !== "string" || entry.name === "") fail(`${kind} 条目缺少 name`);
    if (seen.has(entry.name)) fail(`${kind} 存在重复 name：${entry.name}`);
    seen.add(entry.name);
    if (entry.direction !== expectedDirection) {
      fail(`${kind}.${entry.name}.direction 必须是 ${expectedDirection}`);
    }
    if (!STATUSES.has(entry.status)) fail(`${kind}.${entry.name}.status 必须是 active/planned`);
    if (typeof entry.description !== "string" || entry.description === "") {
      fail(`${kind}.${entry.name} 缺少 description`);
    }
    if (entry.fields === undefined) fail(`${kind}.${entry.name} 缺少 fields（可为空对象）`);
    return Object.freeze({ ...entry, fields: Object.freeze({ ...entry.fields }) });
  });
  return Object.freeze(entries);
}

let cached = null;

/**
 * 加载并结构校验协议真相源，返回只读视图（重复调用共享同一缓存实例）。
 *
 * 返回形状：
 *   protocolVersion   协议版本（与 Rust dsh_driver::PROTOCOL_VERSION 契约一致）
 *   commands/events   全部条目（含 active 与 planned），字段见 protocol.json
 *   activeCommands    status=active 的入站命令名（生产 v1 命令面）
 *   activeEvents      status=active 的出站事件名（生产 v1 事件面）
 *   plannedCommands / plannedEvents  已定义未投产的条目名
 *   knownCommands / knownEvents      任意状态的全部名称集合（替身发出校验用）
 */
export function loadProtocol() {
  if (cached) return cached;
  let raw;
  try {
    raw = JSON.parse(readFileSync(PROTOCOL_PATH, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 protocol.json（${PROTOCOL_PATH}）：${error?.message ?? error}`);
  }
  if (!Number.isInteger(raw.protocol_version) || raw.protocol_version <= 0) {
    fail("protocol_version 必须是正整数");
  }
  const commands = parseEntries(raw.commands, "commands", "inbound");
  const events = parseEntries(raw.events, "events", "outbound");
  const byStatus = (entries, status) =>
    Object.freeze(entries.filter((entry) => entry.status === status).map((entry) => entry.name));

  cached = Object.freeze({
    protocolVersion: raw.protocol_version,
    commands,
    events,
    activeCommands: byStatus(commands, "active"),
    plannedCommands: byStatus(commands, "planned"),
    activeEvents: byStatus(events, "active"),
    plannedEvents: byStatus(events, "planned"),
    knownCommands: new Set(commands.map((entry) => entry.name)),
    knownEvents: new Set(events.map((entry) => entry.name)),
  });
  return cached;
}
