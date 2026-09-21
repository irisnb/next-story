import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * ai-module-boundaries 静态边界测试（extract-ai-logic-seams 任务 6.1 起建；
 * extract-ai-request-orchestration 任务 6.1 扩展后两条新要求）。
 *
 * 扫描 `src/` 生产源码文本，锁定 AI 面板与编排前端的结构边界：
 * - reducer 迁移逻辑仅经 `AiPanelState` 外观消费；
 * - 面板事件类型单一事实源（ai-panel-events.ts）；
 * - `ai-feature-*` 编排聚焦模块不触碰 DOM 全局；
 * - 停靠区（ai-dock.ts）不反向依赖编排层（ai-feature.ts）；
 * - 请求派发经统一网关（scheduler 准入与 coordinator 请求调用的组合仅在网关）；
 * - 组合根装配边界（ai-feature.ts 不含编排规则实现体）。
 *
 * 匹配一律针对 import 语句形态与实现特征符号，不针对注释里的字样。
 */

const srcDir = path.join(fileURLToPath(new URL("../src", import.meta.url)));
const productionFiles = readdirSync(srcDir).filter(
  (name) => name.endsWith(".ts"),
);
const sourceOf = (name: string): string =>
  readFileSync(path.join(srcDir, name), "utf8");

/** 静态 import / re-export 语句的来源说明符匹配（不含注释字样）。 */
function staticImportsFrom(source: string, moduleName: string): boolean {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`from\\s+["'][^"']*${escaped}["']`).test(source);
}

// ========== Requirement: reducer 迁移逻辑仅经状态外观消费 ==========

// 说明：`ai-panel-conversation.ts` 对 reducer 的内联 `import(...)` 引用是
// 经重导出使用的**类型**（PendingReadingRequest / ReadingProgress），规格明文
// 豁免（「类型模块的重导出不在此限」）；迁移函数本身由下方符号级检查锁定。

test("生产代码对 ai-panel-reducer 的 import 语句仅出现在状态外观模块", () => {
  const facade = "ai-panel-state.ts";
  const offenders = productionFiles.filter(
    (name) => name !== facade && name !== "ai-panel-reducer.ts" && staticImportsFrom(sourceOf(name), "ai-panel-reducer.ts"),
  );
  assert.deepEqual(
    offenders,
    [],
    `除 ${facade} 外的生产文件不得 import ai-panel-reducer（违反即越过了状态外观）`,
  );
  // 正向锚点：状态外观确实从 reducer 取迁移逻辑（防止外观被悄然改接别处）。
  assert.equal(
    staticImportsFrom(sourceOf(facade), "ai-panel-reducer.ts"),
    true,
    "状态外观应从 ai-panel-reducer 导入迁移逻辑",
  );
});

test("reducer 的迁移函数名不出现在状态外观之外的生产代码", () => {
  const facade = "ai-panel-state.ts";
  const migrationSymbols = ["reduceAiPanelState", "initialAiPanelCoreState", "activeRequestOf"];
  const offenders: string[] = [];
  for (const name of productionFiles) {
    if (name === facade || name === "ai-panel-reducer.ts") continue;
    const source = sourceOf(name);
    if (migrationSymbols.some((symbol) => new RegExp(`\\b${symbol}\\b`).test(source))) {
      offenders.push(name);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "迁移函数（含内联类型引用形态）只允许状态外观使用",
  );
});

// ========== Requirement: 面板事件类型单一事实源 ==========

test("AiPanelEvent 联合与配套请求/进度类型只在事件类型模块定义一份", () => {
  const eventTypeModule = "ai-panel-events.ts";
  const definitions: Array<[string, RegExp]> = [
    ["AiPanelEvent", /export type AiPanelEvent\b/],
    ["PendingReadingRequest", /export interface PendingReadingRequest\b/],
    ["ReadingProgress", /export interface ReadingProgress\b/],
  ];
  for (const [typeName, pattern] of definitions) {
    const definers = productionFiles.filter((name) => pattern.test(sourceOf(name)));
    assert.deepEqual(
      definers,
      [eventTypeModule],
      `${typeName} 只允许在 ${eventTypeModule} 定义一份`,
    );
  }
});

// ========== Requirement: AI 编排聚焦模块不触碰 DOM ==========

test("ai-feature-* 编排聚焦模块不访问 document / window DOM 全局", () => {
  // 组合根 ai-feature.ts 合法持有 AppDom；聚焦模块（连字符后缀）必须零 DOM。
  const focusedModules = productionFiles.filter((name) => name.startsWith("ai-feature-"));
  assert.ok(focusedModules.length >= 2, "应存在编排聚焦模块（本测试随之失效需更新）");
  const offenders = focusedModules.filter((name) =>
    /\b(document|window)\s*\./.test(sourceOf(name)),
  );
  assert.deepEqual(
    offenders,
    [],
    "编排聚焦模块不得访问 DOM 全局（状态与副作用须经显式依赖注入）",
  );
});

// ========== Requirement: 停靠区单向通信 ==========

test("ai-dock.ts 不导入 ai-feature.ts 及其内部模块（动作只经注入的 AiDockActions 传入）", () => {
  const source = sourceOf("ai-dock.ts");
  const specifiers = [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  const offenders = specifiers.filter((specifier) => /(^|\/)ai-feature[^/]*\.ts$/.test(specifier));
  assert.deepEqual(
    offenders,
    [],
    "停靠区不得反向依赖编排层及其内部模块（依赖方向保持编排层 → 停靠区单向）",
  );
});

// ========== Requirement: 请求派发经统一网关 ==========

// 调度器准入与协调器请求方法的组合调用按实现特征符号锁定：构造点（new）与
// 请求方法调用点只允许出现在网关模块；协调器 / 调度器自身定义文件除外。

const DISPATCH_CONSTRUCTION_SYMBOLS = [
  "new AiRequestScheduler",
  "new AiRequestCoordinator",
] as const;

const DISPATCH_REQUEST_SYMBOLS = [
  /\.requestFor\(/,
  /\.requestStructured\(/,
  /\.requestDirectQuestionFor\(/,
  /\.submit\(/,
] as const;

test("scheduler 准入与 coordinator 请求调用的组合仅出现在请求网关模块", () => {
  const gateway = "ai-feature-request-gateway.ts";
  const definitionModules = new Set(["ai-request.ts", "ai-request-scheduler.ts"]);
  const offenders = productionFiles.filter((name) => {
    if (name === gateway || definitionModules.has(name)) return false;
    const source = sourceOf(name);
    return (
      DISPATCH_CONSTRUCTION_SYMBOLS.some((symbol) => source.includes(symbol)) ||
      DISPATCH_REQUEST_SYMBOLS.some((pattern) => pattern.test(source))
    );
  });
  assert.deepEqual(
    offenders,
    [],
    "网关之外的生产代码不得自行组合调度准入与协调器请求调用",
  );
  // 正向锚点：网关确实持有调度器与协调器的构造点。
  const gatewaySource = sourceOf(gateway);
  for (const symbol of DISPATCH_CONSTRUCTION_SYMBOLS) {
    assert.equal(
      gatewaySource.includes(symbol),
      true,
      `请求网关应包含构造点 ${symbol}`,
    );
  }
});

// ========== Requirement: 组合根装配边界 ==========

// 组合根不得驻留编排规则实现体，按实现特征符号锁定：派发管道（构造 / 提交时间点 /
// 派发前复核装配）、材料组装（关注文档身份字段）、停止与重试规则（终态迁移与
// 重试快照读取）。均为实现形态符号，wiring 字段传递与重导出不会命中。

const ROOT_ORCHESTRATION_SYMBOLS = [
  "new AiRequestScheduler",
  "new AiRequestCoordinator",
  "waitTiming.submit(",
  "waitTiming.complete(",
  "beforeDispatch:",
  "focus_document_id:",
  ".stopRequest(",
  "retrySnapshot()",
  "retryFirstRequest(",
  "withFocusDocumentIdentity(",
] as const;

test("组合根（ai-feature.ts）不含派发、材料组装与停止/重试规则的实现体", () => {
  const source = sourceOf("ai-feature.ts");
  const offenders = ROOT_ORCHESTRATION_SYMBOLS.filter((symbol) => source.includes(symbol));
  assert.deepEqual(
    offenders,
    [],
    "编排规则实现体应住在聚焦模块（网关 / 材料组装 / 生命周期），组合根只做装配",
  );
});
