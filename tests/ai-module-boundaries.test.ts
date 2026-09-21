import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * ai-module-boundaries 静态边界测试（extract-ai-logic-seams 任务 6.1）。
 *
 * 扫描 `src/` 生产源码文本，锁定 AI 面板与编排前端的结构边界：
 * - reducer 迁移逻辑仅经 `AiPanelState` 外观消费；
 * - 面板事件类型单一事实源（ai-panel-events.ts）；
 * - `ai-feature-*` 编排聚焦模块不触碰 DOM 全局；
 * - 停靠区（ai-dock.ts）不反向依赖编排层（ai-feature.ts）。
 *
 * 匹配一律针对 import 语句形态与定义语句形态，不针对注释里的字样。
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
